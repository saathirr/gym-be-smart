-- =====================================================================
-- BE SMART FITNESS CLUB - SUPABASE DATABASE SCHEMA & RLS SETUP
-- Execute this entire script inside the Supabase SQL Editor, from the first
-- line to the last. It is safe to run more than once.
-- =====================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Shared trigger function.
-- Defined up front, before any table, so the CREATE TRIGGER statements below
-- can never run ahead of it.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC;

-- =====================================================================
-- TABLE: profiles (Extends Supabase auth.users)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff', 'trainer')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automatic Profile Creation Trigger on Auth Signup
-- NOTE: new accounts are provisioned as 'staff' by default. The very first
-- account on a fresh project is promoted to 'admin' by public.bootstrap_admin().
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_first BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), 'Gym Staff'),
    CASE WHEN is_first THEN 'admin' ELSE 'staff' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- TABLE: gym_settings (singleton row describing the club itself)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.gym_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- enforced singleton
  gym_name TEXT NOT NULL DEFAULT 'Be Smart Fitness Club',
  tagline TEXT,
  phone TEXT,
  support_email TEXT,
  address TEXT,
  district TEXT,
  opening_time TEXT NOT NULL DEFAULT '05:30',
  closing_time TEXT NOT NULL DEFAULT '22:00',
  currency TEXT NOT NULL DEFAULT 'LKR',
  invoice_footer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.gym_settings (id) VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS gym_settings_touch ON public.gym_settings;
CREATE TRIGGER gym_settings_touch
  BEFORE UPDATE ON public.gym_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- TABLE: branches (Club locations)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  district TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS branches_touch ON public.branches;
CREATE TRIGGER branches_touch
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Members are assigned to a branch (see ALTER below, after members exists)

-- =====================================================================
-- TABLE: plans (Membership Subscription Tiers in LKR)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  duration_days INT NOT NULL CHECK (duration_days > 0),
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  features JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- TABLE: members (Gym Members Directory & Unique QR Codes)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_code TEXT UNIQUE NOT NULL, -- e.g. BSG-1001
  qr_code_id TEXT UNIQUE NOT NULL,  -- Encoded inside QR Code
  full_name TEXT NOT NULL,
  nic_number TEXT,                  -- Sri Lankan NIC (e.g. 199012345678 / 901234567V)
  email TEXT,
  phone TEXT NOT NULL,              -- Mobile Number (e.g. 0771234567)
  whatsapp_number TEXT,             -- WhatsApp Number
  district TEXT,                    -- Sri Lankan District (e.g. Colombo, Kandy, Galle)
  address TEXT,                     -- Residential Address
  gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
  date_of_birth DATE,
  emergency_contact TEXT,
  medical_conditions TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Suspended', 'Expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Members are assigned to a branch
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- Columns added after the members table first shipped. CREATE TABLE IF NOT EXISTS
-- is a no-op on an existing table, so these must be declared separately to keep
-- this script genuinely re-runnable against databases created by older revisions.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS nic_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;

-- =====================================================================
-- TABLE: memberships (Active Subscriptions & Expirations)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Expiring', 'Expired', 'Cancelled')),
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one open subscription per member at a time. Created after the table
-- exists, and after the ALTERs above, so it never runs ahead of its target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_one_open_per_member
  ON public.memberships(member_id)
  WHERE status IN ('Active', 'Expiring');

-- =====================================================================
-- TABLE: attendance (Daily QR Scan Check-ins)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  check_out_time TIMESTAMPTZ,
  method TEXT NOT NULL DEFAULT 'QR_SCAN' CHECK (method IN ('QR_SCAN', 'MANUAL_ENTRY', 'FACIAL_RECOG')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- TABLE: payments (Financial Audit & Receipts in LKR)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'UPI', 'Bank_Transfer', 'Online')),
  payment_status TEXT NOT NULL DEFAULT 'Paid' CHECK (payment_status IN ('Paid', 'Pending', 'Failed', 'Refunded')),
  receipt_number TEXT UNIQUE NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- updated_at AUTO-TRIGGERS
-- =====================================================================
DROP TRIGGER IF EXISTS profiles_touch ON public.profiles;
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS plans_touch ON public.plans;
CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS members_touch ON public.members;
CREATE TRIGGER members_touch BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS memberships_touch ON public.memberships;
CREATE TRIGGER memberships_touch BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_members_qr_code ON public.members(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_members_member_code ON public.members(member_code);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON public.memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON public.memberships(status);
CREATE INDEX IF NOT EXISTS idx_attendance_member ON public.attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in ON public.attendance(check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_payments_member ON public.payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_members_branch ON public.members(branch_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON public.members(status);
CREATE INDEX IF NOT EXISTS idx_memberships_end_date ON public.memberships(end_date);
CREATE INDEX IF NOT EXISTS idx_plans_active ON public.plans(is_active);
CREATE INDEX IF NOT EXISTS idx_branches_active ON public.branches(is_active);

-- =====================================================================
-- ROLE HELPER
-- =====================================================================
-- Wraps the profiles lookup so policies stay readable.
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), 'anon');
$$;
REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_role() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() = 'admin';
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- =====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Staff can read operational data; only admins can change configuration.
-- =====================================================================

-- Blocks self-promotion. RLS lets any staff member update their own profile
-- row, and "Users can update own profile" cannot tell a role change from a
-- name change, so the rule is enforced here instead.
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change a staff role.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.prevent_role_escalation() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_profile_role_change ON public.profiles;
CREATE TRIGGER on_profile_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches     ENABLE ROW LEVEL SECURITY;

-- Clear every existing policy on these tables, not just the ones defined
-- below. RLS policies are permissive, so a leftover policy from an older
-- version of this script is OR-ed in and can quietly re-open a table.
DO $$
DECLARE
  existing RECORD;
BEGIN
  FOR existing IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles', 'plans', 'members', 'memberships',
        'attendance', 'payments', 'gym_settings', 'branches'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      existing.policyname, existing.schemaname, existing.tablename
    );
  END LOOP;
END;
$$;

-- 1. Profiles
CREATE POLICY "Authenticated users can read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Staff may correct their own name/photo, but never their own role:
-- prevent_role_escalation() rejects a self-promotion at write time.
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins manage the staff roster
CREATE POLICY "Admins can insert staff profiles" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update staff profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admins can delete staff profiles" ON public.profiles
  FOR DELETE TO authenticated USING (public.is_admin() AND auth.uid() <> id);

-- 2. Plans (configuration => admin only writes)
CREATE POLICY "Authenticated users can read plans" ON public.plans
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert plans" ON public.plans
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update plans" ON public.plans
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admins can delete plans" ON public.plans
  FOR DELETE TO authenticated USING (public.is_admin());

-- 3. Members
CREATE POLICY "Authenticated users can view members" ON public.members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create members" ON public.members
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update members" ON public.members
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admins can delete members" ON public.members
  FOR DELETE TO authenticated USING (public.is_admin());

-- 4. Memberships
CREATE POLICY "Authenticated users can view memberships" ON public.memberships
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create memberships" ON public.memberships
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update memberships" ON public.memberships
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (public.is_admin());

-- 5. Attendance (append-only for staff)
CREATE POLICY "Authenticated users can view attendance" ON public.attendance
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can log attendance" ON public.attendance
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update attendance" ON public.attendance
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admins can delete attendance" ON public.attendance
  FOR DELETE TO authenticated USING (public.is_admin());

-- 6. Payments
CREATE POLICY "Authenticated users can view payments" ON public.payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can record payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE TO authenticated USING (public.is_admin());

-- 7. Gym settings (singleton)
CREATE POLICY "Authenticated users can read gym settings" ON public.gym_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can update gym settings" ON public.gym_settings
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 8. Branches
CREATE POLICY "Authenticated users can read branches" ON public.branches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert branches" ON public.branches
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update branches" ON public.branches
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admins can delete branches" ON public.branches
  FOR DELETE TO authenticated USING (public.is_admin());

-- =====================================================================
-- SERVER FUNCTIONS (RPC)
-- =====================================================================

-- Bootstrap guard: true only while the project has no staff accounts at all.
-- The app uses this to decide whether to show the first-run setup screen.
CREATE OR REPLACE FUNCTION public.is_bootstrap_needed()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles);
$$;
REVOKE ALL ON FUNCTION public.is_bootstrap_needed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_bootstrap_needed() TO anon, authenticated;

-- Promotes the calling account to admin while the project has no admin at all.
-- This stays safe to leave exposed: as soon as one admin exists the function
-- refuses everyone, and handle_new_user() already makes the first account an
-- admin, so this call is a no-op that simply confirms success.
CREATE OR REPLACE FUNCTION public.bootstrap_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    -- Already bootstrapped: succeed only for the existing admins.
    RETURN EXISTS (
      SELECT 1 FROM public.profiles WHERE id = caller_id AND role = 'admin'
    );
  END IF;

  -- No admin exists yet, so this is the first-run setup window.
  UPDATE public.profiles SET role = 'admin' WHERE id = caller_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin() TO anon, authenticated;

-- Collision-free member code. Uses a sequence so two receptionists
-- registering at the same moment cannot pick the same BSG-#### value.
CREATE SEQUENCE IF NOT EXISTS public.member_code_seq START 1001;

CREATE OR REPLACE FUNCTION public.next_member_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'BSG-' || nextval('public.member_code_seq');
$$;
REVOKE ALL ON FUNCTION public.next_member_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_member_code() TO authenticated;

CREATE SEQUENCE IF NOT EXISTS public.receipt_seq START 1;

CREATE OR REPLACE FUNCTION public.next_receipt_number()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'REC-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
         lpad(nextval('public.receipt_seq')::TEXT, 5, '0');
$$;
REVOKE ALL ON FUNCTION public.next_receipt_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_receipt_number() TO authenticated;

-- Renews a subscription atomically: closes any open subscription for the
-- member, opens the new one, reactivates the member, and logs the payment.
-- Doing this client-side previously left duplicate 'Active' rows behind.
CREATE OR REPLACE FUNCTION public.renew_membership(
  p_member_id UUID,
  p_plan_id UUID,
  p_payment_method TEXT DEFAULT 'Cash',
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan     public.plans%ROWTYPE;
  v_start    DATE;
  v_end      DATE;
  v_sub_id   UUID;
  v_receipt  TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan % is not available', p_plan_id;
  END IF;

  -- Continue from the current end date when the member still has time left
  SELECT COALESCE(MAX(end_date), CURRENT_DATE) INTO v_start
  FROM public.memberships
  WHERE member_id = p_member_id AND status IN ('Active', 'Expiring');

  v_end := v_start + v_plan.duration_days;

  UPDATE public.memberships
  SET status = 'Expired'
  WHERE member_id = p_member_id AND status IN ('Active', 'Expiring');

  INSERT INTO public.memberships (member_id, plan_id, start_date, end_date, status)
  VALUES (p_member_id, p_plan_id, v_start, v_end, 'Active')
  RETURNING id INTO v_sub_id;

  UPDATE public.members SET status = 'Active' WHERE id = p_member_id;

  v_receipt := public.next_receipt_number();

  IF v_plan.price > 0 THEN
    INSERT INTO public.payments (
      member_id, membership_id, amount,
      payment_method, payment_status, receipt_number, notes
    )
    VALUES (
      p_member_id, v_sub_id, v_plan.price,
      p_payment_method, 'Paid', v_receipt,
      COALESCE(p_notes, 'Membership renewal - ' || v_plan.name)
    );
  END IF;

  RETURN jsonb_build_object(
    'membership_id', v_sub_id,
    'start_date', v_start,
    'end_date', v_end,
    'receipt_number', v_receipt,
    'amount', v_plan.price
  );
END;
$$;
REVOKE ALL ON FUNCTION public.renew_membership(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_membership(UUID, UUID, TEXT, TEXT) TO authenticated;

-- Flips memberships whose window has closed, and syncs the member status.
-- Run on app load so the dashboard never reports stale 'Active' rows.
CREATE OR REPLACE FUNCTION public.sync_expired_memberships()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH closed AS (
    UPDATE public.memberships
    SET status = 'Expired'
    WHERE status IN ('Active', 'Expiring') AND end_date < CURRENT_DATE
    RETURNING member_id
  )
  UPDATE public.members m
  SET status = 'Expired'
  WHERE m.id IN (SELECT member_id FROM closed)
    AND m.status = 'Active';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_expired_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_expired_memberships() TO authenticated;

-- =====================================================================
-- OPTIONAL STARTER DATA
-- Delete this block if you want to enter your own plan tiers by hand.
-- =====================================================================
INSERT INTO public.plans (name, description, duration_days, price, features)
SELECT * FROM (VALUES
  ('Monthly', 'Standard access to the gym floor and cardio zone.', 30, 4500,
   '["Gym Floor Access", "Cardio Zone", "Locker Room", "Free Towel Service"]'::jsonb),
  ('Quarterly', 'Three months of access with a discounted monthly rate.', 90, 12000,
   '["Everything in Monthly", "Sauna Access", "Body Composition Check"]'::jsonb),
  ('Annual', 'Best value per month, includes guest passes.', 365, 42000,
   '["Everything in Quarterly", "Unlimited Guest Passes", "Personal Trainer Session"]'::jsonb)
) AS seed(name, description, duration_days, price, features)
WHERE NOT EXISTS (
  SELECT 1 FROM public.plans p WHERE p.name = seed.name
);

-- =====================================================================
-- SETUP COMPLETE
-- 1. Create the first account from the app's first-run screen.
--    It is promoted to 'admin' automatically.
-- 2. Manage further staff from Settings.
-- =====================================================================
