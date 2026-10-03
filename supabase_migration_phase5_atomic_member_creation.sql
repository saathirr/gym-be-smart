-- Phase 5: atomic member creation for the single-member form and the bulk import.
--
-- WHY THIS EXISTS
-- ---------------
-- Registering a member is three writes in the wrong order of risk:
--
--   1. INSERT members
--   2. INSERT memberships      (only when a plan was chosen)
--   3. INSERT payments         (only when the plan costs money)
--
-- Done from the browser these are three independent PostgREST requests, each its
-- own transaction. If step 2 or 3 fails, step 1 has already committed, so the
-- directory is left holding a member with no subscription and no receipt. For a
-- 20 row import that is up to 20 such members, and each one then collides with
-- the phone check on the next attempt, so a retry compounds the mess.
--
-- This function moves all three writes into one server-side transaction. Any
-- failure raises, and the whole thing rolls back, so a member either exists
-- complete or does not exist at all.
--
-- The client prefers this function and falls back to the old multi-request path
-- only while this function is absent, so applying this file is a strict
-- improvement with no coordinated deploy required in either order.
--
-- SAFE TO RUN TWICE: CREATE OR REPLACE plus REVOKE/GRANT are both idempotent.
-- Nothing is dropped, no table is truncated and no existing row is read or
-- rewritten. Running it a second time only redefines the function body.

BEGIN;

-- p_full_name and p_phone are the two required fields, but they carry DEFAULT ''
-- purely to satisfy Postgres, which insists that once a parameter has a default
-- every parameter after it does too. Their requiredness is enforced in the body
-- below, which raises 23514 on a blank value. The browser always sends all
-- fourteen arguments by name, so the defaults are never relied on in practice.
CREATE OR REPLACE FUNCTION public.create_member_with_membership(
  p_full_name         TEXT    DEFAULT '',
  p_nic_number        TEXT    DEFAULT NULL,
  p_email             TEXT    DEFAULT NULL,
  p_phone             TEXT    DEFAULT '',
  p_whatsapp_number   TEXT    DEFAULT NULL,
  p_district          TEXT    DEFAULT NULL,
  p_address           TEXT    DEFAULT NULL,
  p_gender            TEXT    DEFAULT NULL,
  p_date_of_birth     DATE    DEFAULT NULL,
  p_emergency_contact TEXT    DEFAULT NULL,
  p_medical_conditions TEXT   DEFAULT NULL,
  p_branch_id         UUID    DEFAULT NULL,
  p_plan_id           UUID    DEFAULT NULL,
  p_payment_method    TEXT    DEFAULT 'Cash'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_member_code     TEXT;
  v_qr_code_id      TEXT;
  v_member_id       UUID;
  v_membership_id   UUID;
  v_plan_id         UUID;
  v_plan_name       TEXT;
  v_plan_price      NUMERIC(10, 2);
  v_plan_days       INT;
  v_start_date      DATE := CURRENT_DATE;
  v_end_date        DATE;
  v_receipt_number  TEXT;
BEGIN
  -- SECURITY INVOKER keeps the existing row level security policies as the
  -- authority on these inserts. It is deliberately not SECURITY DEFINER: this
  -- function writes to members, memberships and payments, and bypassing RLS on
  -- those tables is not a trade worth making for convenience.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to register a member.'
      USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'Full name is required.' USING ERRCODE = '23514';
  END IF;

  IF btrim(COALESCE(p_phone, '')) = '' THEN
    RAISE EXCEPTION 'Mobile phone is required.' USING ERRCODE = '23514';
  END IF;

  -- next_member_code() is SECURITY DEFINER and takes nextval() on the shared
  -- sequence, so concurrent imports cannot collide on member_code.
  v_member_code := public.next_member_code();

  -- member_code is UNIQUE, so appending a suffix keeps this UNIQUE too. The
  -- suffix mirrors the format the browser used before this function existed, so
  -- an already printed QR pass keeps resolving through getMemberByPass().
  v_qr_code_id := v_member_code
    || '.'
    || upper(to_char((extract(epoch FROM clock_timestamp()) * 1000)::bigint, 'FM999999999999'));

  INSERT INTO public.members (
    member_code,
    qr_code_id,
    full_name,
    nic_number,
    email,
    phone,
    whatsapp_number,
    district,
    address,
    gender,
    date_of_birth,
    emergency_contact,
    medical_conditions,
    branch_id,
    status
  )
  VALUES (
    v_member_code,
    v_qr_code_id,
    btrim(p_full_name),
    -- NULLIF(btrim(x), '') turns a blank spreadsheet cell into a real NULL
    -- rather than an empty string, which is what the browser's `|| null` did.
    NULLIF(btrim(p_nic_number), ''),
    NULLIF(btrim(p_email), ''),
    btrim(p_phone),
    NULLIF(btrim(p_whatsapp_number), ''),
    NULLIF(btrim(p_district), ''),
    NULLIF(btrim(p_address), ''),
    NULLIF(btrim(p_gender), ''),
    p_date_of_birth,
    NULLIF(btrim(p_emergency_contact), ''),
    NULLIF(btrim(p_medical_conditions), ''),
    p_branch_id,
    'Active'
  )
  RETURNING id INTO v_member_id;

  IF p_plan_id IS NOT NULL THEN
    SELECT id, price, duration_days, name
      INTO v_plan_id, v_plan_price, v_plan_days, v_plan_name
      FROM public.plans
     WHERE id = p_plan_id
       AND is_active;

    IF v_plan_id IS NULL THEN
      -- A plan id that no longer resolves used to leave a member behind with no
      -- subscription at all. Failing here rolls the member insert back.
      RAISE EXCEPTION 'That membership plan is not available.'
        USING ERRCODE = '23503';
    END IF;

    v_end_date := v_start_date + v_plan_days;

    INSERT INTO public.memberships (member_id, plan_id, start_date, end_date, status)
    VALUES (v_member_id, v_plan_id, v_start_date, v_end_date, 'Active')
    RETURNING id INTO v_membership_id;

    -- A free plan gets a membership but no payment row, which is what the
    -- browser did too, because payments.amount carries CHECK (amount > 0).
    IF v_plan_price > 0 THEN
      v_receipt_number := public.next_receipt_number();

      INSERT INTO public.payments (
        member_id,
        membership_id,
        amount,
        payment_method,
        payment_status,
        receipt_number,
        notes
      )
      VALUES (
        v_member_id,
        v_membership_id,
        v_plan_price,
        COALESCE(NULLIF(btrim(p_payment_method), ''), 'Cash'),
        'Paid',
        v_receipt_number,
        'New membership - ' || v_plan_name
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'member_code', v_member_code,
    'qr_code_id', v_qr_code_id,
    'membership_id', v_membership_id,
    'receipt_number', v_receipt_number
  );
END;
$$;

COMMENT ON FUNCTION public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT
) IS
  'Creates a member together with their membership and first payment in one transaction. Rolls back everything on failure. Used by single-member registration and bulk import.';

REVOKE ALL ON FUNCTION public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT
) TO authenticated;

COMMIT;