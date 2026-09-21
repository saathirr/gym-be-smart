-- =====================================================================
-- BE SMART FITNESS CLUB - SUPABASE DATABASE SCHEMA & RLS SETUP
-- Execute this entire script inside the Supabase SQL Editor
-- =====================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Gym Administrator'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'admin')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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
  email TEXT,
  phone TEXT,
  gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
  date_of_birth DATE,
  emergency_contact TEXT,
  medical_conditions TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive', 'Suspended', 'Expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
-- INDEXES FOR MAXIMUM QUERY PERFORMANCE
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_members_qr_code ON public.members(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_members_member_code ON public.members(member_code);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON public.memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON public.memberships(status);
CREATE INDEX IF NOT EXISTS idx_attendance_member ON public.attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_check_in ON public.attendance(check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_payments_member ON public.payments(member_id);

-- =====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Strict Security: Row Level Security is Enabled on All Tables
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
CREATE POLICY "Authenticated users can read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- 2. Plans Policies
CREATE POLICY "Authenticated users can read plans" ON public.plans
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated admins can insert plans" ON public.plans
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated admins can update plans" ON public.plans
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated admins can delete plans" ON public.plans
  FOR DELETE TO authenticated USING (true);

-- 3. Members Policies
CREATE POLICY "Authenticated users can view members" ON public.members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create members" ON public.members
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update members" ON public.members
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete members" ON public.members
  FOR DELETE TO authenticated USING (true);

-- 4. Memberships Policies
CREATE POLICY "Authenticated users can view memberships" ON public.memberships
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create memberships" ON public.memberships
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update memberships" ON public.memberships
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (true);

-- 5. Attendance Policies
CREATE POLICY "Authenticated users can view attendance" ON public.attendance
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can log attendance" ON public.attendance
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update attendance" ON public.attendance
  FOR UPDATE TO authenticated USING (true);

-- 6. Payments Policies
CREATE POLICY "Authenticated users can view payments" ON public.payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can record payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update payments" ON public.payments
  FOR UPDATE TO authenticated USING (true);

-- =====================================================================
-- INITIAL SUBSCRIPTION PLAN TIERS (IN LKR)
-- =====================================================================

INSERT INTO public.plans (name, description, duration_days, price, features) VALUES
('Basic Monthly', 'Standard gym floor access and cardio zone', 30, 5000.00, '["Gym Floor Access", "Cardio Zone", "Locker Room"]'::jsonb),
('Gold Quarterly', 'Full access including group fitness classes and sauna', 90, 13500.00, '["Gym Floor Access", "Group Fitness Classes", "Steam & Sauna", "1 Guest Pass / Month"]'::jsonb),
('VIP Annual', 'All access VIP membership with free towel service', 365, 45000.00, '["24/7 Priority Access", "All Gym Facilities", "Free Towel & Drinks", "Unlimited Guest Passes"]'::jsonb),
('Personal Training', 'Dedicated 1-on-1 certified coaching package', 30, 20000.00, '["12 PT Sessions", "Custom Nutrition Plan", "Body Composition Tracking"]'::jsonb)
ON CONFLICT DO NOTHING;
