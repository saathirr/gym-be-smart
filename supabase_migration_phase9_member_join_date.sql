-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 9 MIGRATION
-- Member join date: a real, editable date of joining per player
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- ORDERING
--   Run after phase 1 (supabase_schema.sql) through phase 8
--   (supabase_migration_phase8_second_session.sql). Phase 2 is required
--   because the backfill below uses public.gym_tz().
--
-- WHY THIS FILE EXISTS
--   Members had no join date of their own. The profile used members.created_at
--   as a stand-in, and the billing cycle (and so the payment reminder) was
--   driven entirely by memberships.start_date, which registration always set to
--   CURRENT_DATE. Importing a whole directory in one sitting therefore stamped
--   every player with the same day, and there was no way to correct a single
--   player without touching the table by hand.
--
--   This adds public.members.join_date and makes it authoritative:
--     * Registering a member now stores the join date that was typed, and
--       starts the membership from it.
--     * Editing the join date on an existing member moves the current
--       membership's start_date to it and re-derives end_date from the plan,
--       so the payment due date and the reminder cycle follow the join date.
--
-- SAFETY PROPERTIES
--   * Additive. One new column, one new function, and a recreate of
--     create_member_with_membership with one extra argument. No DROP TABLE, no
--     DELETE, no data is discarded.
--   * Re-runnable. The column add is IF NOT EXISTS, the backfill only fills
--     rows that are still NULL, and both functions are CREATE OR REPLACE.
--   * The backfill never invents a wrong-looking date: it uses the member's
--     earliest membership start_date when there is one, and otherwise the day
--     they were registered, in the club's own timezone. Staff then correct the
--     handful that differ using the member edit form.
--
-- NOT INCLUDED ON PURPOSE
--   * Rewriting payments. A receipt records money that was actually taken on
--     the day it was taken, so this file leaves transaction_date alone. What
--     the join date drives is the billing cycle, which is what the payment
--     reminder screen reads.
--   * Shifting historical memberships. Only the current open membership is
--     moved. Earlier, already-finished cycles stay as they were recorded.
-- =====================================================================


-- =====================================================================
-- 0. PRE-FLIGHT
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'gym_tz'
  ) THEN
    RAISE EXCEPTION
      'Phase 2 is not applied: public.gym_tz() is missing, so the join-date backfill cannot resolve club-local days. Run supabase_migration_phase2_daypass_attendance.sql first. Nothing has been changed.';
  END IF;
END;
$$;


-- =====================================================================
-- 1. THE JOIN DATE COLUMN
-- =====================================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS join_date DATE;

-- Backfill. Only rows that have no join date yet, so re-running this file
-- leaves an already-corrected directory untouched.
--
-- The first choice is the earliest membership start_date, which is the closest
-- thing to a real join date the club has already recorded. Where a member has
-- no membership at all, registration day in club-local time is used. Both are
-- only a starting point: reception adjusts the ones that are wrong from the
-- member edit form.
UPDATE public.members m
   SET join_date = COALESCE(
     (SELECT MIN(ms.start_date)
        FROM public.memberships ms
       WHERE ms.member_id = m.id),
     (m.created_at AT TIME ZONE public.gym_tz())::date
   )
 WHERE m.join_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_members_join_date
  ON public.members(join_date);


-- =====================================================================
-- 2. REGISTRATION STARTS THE MEMBERSHIP FROM THE JOIN DATE
-- ---------------------------------------------------------------------
-- create_member_with_membership gains one argument, so the old signature has to
-- be dropped before the new one can be created. The browser calls it with named
-- arguments and always sends p_join_date, so the default is only a safety net.
-- =====================================================================
DROP FUNCTION IF EXISTS public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT
);

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
  p_payment_method    TEXT    DEFAULT 'Cash',
  p_join_date         DATE    DEFAULT NULL
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
  v_join_date       DATE := COALESCE(p_join_date, CURRENT_DATE);
  v_end_date        DATE;
  v_receipt_number  TEXT;
BEGIN
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
    join_date,
    status
  )
  VALUES (
    v_member_code,
    v_qr_code_id,
    btrim(p_full_name),
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
    v_join_date,
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
      RAISE EXCEPTION 'That membership plan is not available.'
        USING ERRCODE = '23503';
    END IF;

    -- The billing cycle starts on the join date, so the expiry and the payment
    -- reminder are measured from the day the player actually joined.
    v_end_date := v_join_date + v_plan_days;

    INSERT INTO public.memberships (member_id, plan_id, start_date, end_date, status)
    VALUES (v_member_id, v_plan_id, v_join_date, v_end_date, 'Active')
    RETURNING id INTO v_membership_id;

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
    'receipt_number', v_receipt_number,
    'join_date', v_join_date
  );
END;
$$;

COMMENT ON FUNCTION public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT, DATE
) IS
  'Creates a member together with their membership and first payment in one transaction. The membership starts from p_join_date (or today when omitted). Rolls back everything on failure.';

REVOKE ALL ON FUNCTION public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT, DATE
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_member_with_membership(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, UUID, UUID, TEXT, DATE
) TO authenticated;


-- =====================================================================
-- 3. EDITING THE JOIN DATE MOVES THE BILLING CYCLE
-- ---------------------------------------------------------------------
-- Used by the member edit form. In one transaction it:
--   1. stores the new join date on the member, and
--   2. moves the current open membership's start_date onto that date and
--      re-derives end_date from the plan's duration.
--
-- Re-deriving end_date (rather than keeping the old one) is what makes the
-- expiry and the "payment due after 28 days" reminder follow the join date.
-- Only the open membership is touched; finished cycles are history and are left
-- exactly as they were.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_member_join_date(
  p_member_id UUID,
  p_join_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_membership_id UUID;
  v_plan_days     INT;
  v_end_date      DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to change a join date.'
      USING ERRCODE = '42501';
  END IF;

  IF p_join_date IS NULL THEN
    RAISE EXCEPTION 'A join date is required.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.members
     SET join_date = p_join_date
   WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That member could not be found.' USING ERRCODE = '23503';
  END IF;

  -- At most one open membership is guaranteed by
  -- idx_memberships_one_open_per_member.
  SELECT ms.id, pl.duration_days
    INTO v_membership_id, v_plan_days
    FROM public.memberships ms
    JOIN public.plans pl ON pl.id = ms.plan_id
   WHERE ms.member_id = p_member_id
     AND ms.status IN ('Active', 'Expiring')
   ORDER BY ms.start_date DESC
   LIMIT 1;

  IF v_membership_id IS NOT NULL THEN
    v_end_date := p_join_date + v_plan_days;

    UPDATE public.memberships
       SET start_date = p_join_date,
           end_date   = v_end_date
     WHERE id = v_membership_id;
  END IF;

  RETURN jsonb_build_object(
    'member_id', p_member_id,
    'join_date', p_join_date,
    'membership_id', v_membership_id,
    'start_date', p_join_date,
    'end_date', v_end_date
  );
END;
$$;

COMMENT ON FUNCTION public.set_member_join_date(UUID, DATE) IS
  'Stores a member join date and moves their current open membership to start from it, re-deriving the end date from the plan. Used by the member edit form.';

REVOKE ALL ON FUNCTION public.set_member_join_date(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_join_date(UUID, DATE) TO authenticated;


-- =====================================================================
-- 4. VERIFICATION
-- ---------------------------------------------------------------------
-- 1. SELECT column_name, data_type
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'members'
--        AND column_name = 'join_date';
--
-- 2. SELECT count(*) AS members_without_join_date
--      FROM public.members WHERE join_date IS NULL;
--    Expect 0 after the backfill.
--
-- 3. -- Signed in. Moves the current membership of one member:
--    SELECT public.set_member_join_date('<member-uuid>', '2026-01-15');
-- =====================================================================
