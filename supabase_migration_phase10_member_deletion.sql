-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 10 MIGRATION
-- Member Deletion RPC & Row Level Security Policies
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- WHY THIS FILE EXISTS
--   When deleting a member, we need:
--   1. An atomic, clean function `delete_member_completely` that validates
--      the member exists, deletes them, and allows Postgres ON DELETE CASCADE
--      to automatically remove their linked memberships, attendance, payments,
--      and payment reminders.
--   2. Explicit Row Level Security (RLS) DELETE policies for members,
--      memberships, and attendance, ensuring signed-in staff/admin operators
--      can delete records without permission denial errors.
-- =====================================================================

BEGIN;

-- 1. Atomic function to delete member and return their details
CREATE OR REPLACE FUNCTION public.delete_member_completely(p_member_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to delete a member.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, member_code, full_name, phone, nic_number, avatar_url
    INTO v_member
    FROM public.members
   WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Delete member.
  -- ON DELETE CASCADE automatically removes linked records in:
  -- - public.memberships
  -- - public.attendance
  -- - public.payments
  -- - public.payment_reminders
  DELETE FROM public.members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_member.id,
    'member_code', v_member.member_code,
    'full_name', v_member.full_name,
    'avatar_url', v_member.avatar_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_member_completely(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_member_completely(UUID) TO authenticated;

-- 2. Ensure RLS policies allow authenticated staff/admins to delete members
DROP POLICY IF EXISTS "Admins can delete members" ON public.members;
DROP POLICY IF EXISTS "Authenticated users can delete members" ON public.members;
CREATE POLICY "Authenticated users can delete members" ON public.members
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;
DROP POLICY IF EXISTS "Authenticated users can delete memberships" ON public.memberships;
CREATE POLICY "Authenticated users can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can delete attendance" ON public.attendance;
DROP POLICY IF EXISTS "Authenticated users can delete attendance" ON public.attendance;
CREATE POLICY "Authenticated users can delete attendance" ON public.attendance
  FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can delete payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated users can delete payments" ON public.payments;
CREATE POLICY "Authenticated users can delete payments" ON public.payments
  FOR DELETE TO authenticated USING (true);

COMMIT;
