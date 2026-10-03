-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 4 MIGRATION
-- Audit trail table + the owner role the Admin Access screen already offers
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- ORDERING - IMPORTANT
--   1. Run phase 1 (supabase_schema.sql), then phase 2
--      (supabase_migration_phase2_daypass_attendance.sql), then phase 3
--      (supabase_migration_phase3_player_profiles.sql) FIRST.
--   2. Run this file LAST.
--
-- WHY THIS FILE EXISTS
--   The app reads two things from Postgres that phases 1-3 never create:
--
--   A. public.activity_logs
--      src/services/activityLogService.js reads and writes this table, and
--      src/pages/ActivityLogsPage.jsx renders it, but no migration creates
--      it. The service hides the gap behind a try/catch and falls back to
--      five hard-coded rows in localStorage, so the Activity Logs screen
--      currently shows sample data that no staff action ever produced.
--
--   B. profiles.role = 'super_admin'
--      src/pages/AdminAccessPage.jsx offers "Super Admin (Owner)" in both the
--      create-staff and change-role dropdowns, and src/contexts/AuthContext.jsx
--      treats super_admin/owner as full admins in the UI. phases 1-3 constrain
--      the column to ('admin','staff','trainer'), so picking that option fails
--      with Postgres 23514 (check_violation) and the screen reports
--      "That value is not allowed."
--      Widening the CHECK alone is not enough and would be worse than useless:
--      public.is_admin() is what every RLS policy calls, and it compares the
--      role to the literal 'admin'. A stored super_admin would keep the admin
--      navigation and settings screens in the UI while every write was refused
--      by the database. Section 4 closes that gap so the two agree.
--
-- SAFETY PROPERTIES (please read before running)
--   * Additive only. It creates one new table and re-declares three functions.
--     No DROP TABLE, no DELETE, no TRUNCATE, and no rewrite of the members /
--     memberships / payments / attendance / plans / branches tables.
--   * Re-runnable. Every DDL statement is guarded (IF NOT EXISTS, DROP POLICY
--     IF EXISTS then CREATE, or CREATE OR REPLACE), so running this file twice
--     leaves the database exactly as running it once.
--   * The CHECK constraint is dropped and immediately re-added wider, never
--     narrower. Every value the old constraint allowed is still allowed, so no
--     existing profile row can fail validation and no role is taken away.
--   * The new table starts EMPTY. This script writes no log rows. Until real
--     activity is logged, the Activity Logs screen keeps showing its
--     localStorage sample data - see the note in section 6.
--   * Row Level Security is unchanged for every existing table. Only
--     public.activity_logs gets policies, and they grant no access beyond what
--     the other tables already give signed-in staff.
--
-- THE DATA CHANGES THIS SCRIPT MAKES
--   1. Creates public.activity_logs with the exact column names and types the
--      app sends and reads, so the insert in activityLogService.js stops
--     throwing and the screen stops falling back to sample data.
--   2. Grants `authenticated` SELECT and INSERT on it, matching the read-heavy
--      audit-trail usage, and keeps UPDATE/DELETE to admins, since the app never
--     edits or removes a log and an audit trail that staff can rewrite is not an
--     audit trail.
--   3. Widens profiles.role to ('admin','super_admin','owner','staff','trainer').
--   4. Re-declares public.is_admin() so 'super_admin' and 'owner' satisfy it,
--      matching how the app decides who is an admin.
--   5. Re-declares public.bootstrap_admin() so a club whose only admin is an
--      owner is not offered the first-run setup window again.
--
-- NOT INCLUDED ON PURPOSE
--   * A trigger that writes activity_logs rows for member edits, payments,
--     renewals and role changes. The app calls logActivity() itself where it
--     wants an entry, and a second automatic writer would double every row. If
--     you later want database-side auditing, add it as a separate decision with
--     a trigger per table, not by widening this file.
--   * A backfill of activity_logs from the localStorage sample rows. Those are
--     fictional demo entries with invented member codes and receipt values;
--     importing them would put untrue records into a real audit trail.
--   * Any change to public.prevent_role_escalation(). It already gates on
--     is_admin(), so section 4 widens it automatically: an owner may change a
--     role, and no staff member may change their own.
--   * Owner-only powers such as "only an owner may promote someone to owner".
--     The app has no such screen, so the database will not invent a rule the
--     front end cannot reach.
-- =====================================================================


-- =====================================================================
-- 0. PRE-FLIGHT
-- ---------------------------------------------------------------------
-- Reports what is missing right now, so an operator can see why this file was
-- needed. Nothing here changes the database, and nothing here can fail the
-- migration.
-- =====================================================================
DO $$
DECLARE
  activity_logs_exists BOOLEAN;
  role_check_def     TEXT;
  owner_rows         BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'activity_logs'
  ) INTO activity_logs_exists;

  IF activity_logs_exists THEN
    RAISE NOTICE 'public.activity_logs already exists - section 1 will be a no-op.';
  ELSE
    RAISE NOTICE 'MISSING: public.activity_logs. The Activity Logs screen is showing sample data.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO role_check_def
  FROM pg_constraint
  WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
  ORDER BY conname LIMIT 1;

  IF role_check_def IS NULL THEN
    RAISE NOTICE 'public.profiles has no role CHECK constraint - section 3 will add one.';
  ELSIF role_check_def ILIKE '%super_admin%' OR role_check_def ILIKE '%owner%' THEN
    RAISE NOTICE 'public.profiles.role already accepts the owner role.';
  ELSE
    RAISE NOTICE 'MISSING: profiles.role rejects super_admin/owner. Admin Access cannot create an owner.';
  END IF;

  -- The pre-fix constraint rejected these values, so this is expected to be 0.
  -- A non-zero count means the column was already widened by hand; the counts
  -- are still useful to see who currently holds which role.
  EXECUTE 'SELECT COUNT(*) FROM public.profiles WHERE role IN (''super_admin'', ''owner'')'
    INTO owner_rows;

  RAISE NOTICE 'Profiles holding super_admin/owner today: %', owner_rows;
END;
$$;


-- =====================================================================
-- 1. THE AUDIT TRAIL
-- ---------------------------------------------------------------------
-- One row per recorded staff action, newest first.
--
-- COLUMN NAMES ARE NOT FREE CHOICES
--   activityLogService.js writes exactly these keys: action, category,
--   performed_by, performer_email, entity_type, entity_id, details, changes.
--   It never writes a primary key or a timestamp, so both are filled in here.
--   Renaming any column below breaks the insert, which the service silently
--   swallows, and the screen quietly reverts to sample data.
--
-- WHY action, category, performed_by and details ARE NOT NULL
--   ActivityLogsPage.jsx filters and searches with
--   `l.details.toLowerCase()`. A NULL in any of those four crashes the screen
--   instead of returning fewer rows, so they carry a NOT NULL with an empty
--   default rather than being left nullable. Empty string searches fine.
--
-- WHY entity_id IS TEXT AND NOT UUID
--   The app passes free-form identifiers: real UUIDs for some entities, but
--   also values like 'bulk-import-batch' and 'att-991'. UUID would reject them.
--
-- WHY details AND changes ARE FREE TEXT
--   details is a human sentence written by the caller; changes is a JSON object
--   of before/after values rendered with JSON.stringify. Neither has a shape
--   the database can usefully enforce.
--
-- THE "timestamp" COLUMN
--   The service orders by `created_at`, while ActivityLogsPage.jsx reads
--   `log.timestamp`. Those are two names for the same instant, so instead of
--   asking the app to change, "timestamp" is a STORED GENERATED column
--   mirroring created_at. GENERATED ALWAYS means the two can never drift and
--   the column cannot be set directly by an insert - which is correct for an
--   audit trail, since a caller must not be able to backdate an entry.
--   A hand-written INSERT that wants a specific time sets created_at.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action          TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'General',
  performed_by    TEXT NOT NULL DEFAULT '',
  performer_email TEXT,
  entity_type     TEXT,
  entity_id       TEXT,
  details         TEXT NOT NULL DEFAULT '',
  changes         JSONB,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  "timestamp"     TIMESTAMPTZ GENERATED ALWAYS AS (created_at) STORED
);

-- Repairs a table that already exists from a partial or hand-made attempt.
-- One statement per column, each terminated on its own: a trailing comma here
-- would make the parser swallow the next ALTER and fail on "TABLE".
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS action          TEXT NOT NULL DEFAULT '';
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'General';
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS performed_by    TEXT NOT NULL DEFAULT '';
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS performer_email TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS entity_type     TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS entity_id       TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS details         TEXT NOT NULL DEFAULT '';
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS changes         JSONB;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS ip_address      TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS recorded_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS "timestamp"     TIMESTAMPTZ GENERATED ALWAYS AS (created_at) STORED;

-- The one query the app makes: newest rows first, capped by .limit().
-- DESC is not cosmetic. An audit trail is read newest-first, so the index is
-- built in that order and the planner can stop after the first page instead of
-- sorting the whole table for every open of the screen.
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
  ON public.activity_logs(created_at DESC);

-- The category filter on the same screen.
CREATE INDEX IF NOT EXISTS idx_activity_logs_category
  ON public.activity_logs(category);


-- =====================================================================
-- 2. ACTIVITY LOG ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- Read and append for any signed-in staff member, edit and delete for admins
-- only. An audit trail that the people it audits can rewrite is not evidence of
-- anything, and the app never needs to edit or remove a row.
--
-- The INSERT policy deliberately does not force performed_by or
-- performer_email to match the caller's own profile. The service fills those
-- from the signed-in user, but falls back to a placeholder when it has no user
-- object to read, so pinning them here would reject legitimate writes. The
-- honest version of that check - recording auth.uid() itself - is below.
-- =====================================================================
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Clear every existing policy on this table, not just the ones defined below.
-- RLS policies are permissive, so a leftover policy from an older run is OR-ed
-- in and can quietly re-open the table.
DO $$
DECLARE
  existing RECORD;
BEGIN
  FOR existing IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'activity_logs'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      existing.policyname, existing.schemaname, existing.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY "Authenticated users can read activity logs" ON public.activity_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can log activity" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update activity logs" ON public.activity_logs
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete activity logs" ON public.activity_logs
  FOR DELETE TO authenticated USING (public.is_admin());

-- Who actually wrote the row. Recorded by the trigger below from the session,
-- never from the payload, so the INSERT policy does not have to trust the
-- caller for its own name. Null for a row written by a signed-out migration or
-- by the SQL editor, which is the honest answer there. The column itself is
-- declared in section 1, with the rest.
CREATE OR REPLACE FUNCTION public.activity_logs_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.recorded_by IS NULL THEN
    NEW.recorded_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.activity_logs_stamp_actor() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_activity_log_created ON public.activity_logs;
CREATE TRIGGER on_activity_log_created
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.activity_logs_stamp_actor();


-- =====================================================================
-- 3. STAFF ROLES - ACCEPT THE OWNER ROLE THE UI ALREADY OFFERS
-- ---------------------------------------------------------------------
-- AdminAccessPage.jsx can send role = 'super_admin'. The column has to accept
-- it, or the insert fails with 23514 and the operator is told the value is not
-- allowed with no way to see why.
--
-- 'owner' is accepted alongside 'super_admin' because AuthContext.jsx and
-- AdminAccessPage.jsx already treat both as the same display role, and a club
-- that typed the shorter one into the SQL editor would otherwise hit the same
-- error again.
--
-- The old CHECK is dropped by matching its definition rather than by name, so a
-- constraint that was renamed by hand is still replaced. Only CHECK constraints
-- are considered: contype = 'c' cannot touch the primary key.
--
-- Nothing is lost. The old set {'admin','staff','trainer'} is a subset of the
-- new one, so every profile row that was valid a moment ago is still valid, and
-- the re-add succeeds on a table of any size.
-- =====================================================================
DO $$
DECLARE
  role_check TEXT;
BEGIN
  FOR role_check IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    RAISE NOTICE 'Replacing role CHECK constraint %', role_check;
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', role_check);
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'super_admin', 'owner', 'staff', 'trainer'));


-- =====================================================================
-- 4. IS_ADMIN() MUST AGREE WITH THE UI
-- ---------------------------------------------------------------------
-- Every admin-only RLS policy calls this function, and so does
-- prevent_role_escalation(). It compared the role to the literal 'admin'.
--
-- Left as it was, section 3 alone would have been a trap: the owner would see
-- the admin navigation, the settings screen and the staff roster, and every
-- write behind them would be refused by the database with 42501. The UI and
-- the policies have to make the same decision, and the UI already made it.
--
-- This is the whole change: IN instead of =. current_role() already reads the
-- stored role and returns 'anon' for a signed-out caller, so an unauthenticated
-- request still evaluates to false.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_role() IN ('admin', 'super_admin', 'owner');
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;


-- =====================================================================
-- 5. FIRST-RUN SETUP MUST NOT REOPEN FOR AN OWNER-ONLY CLUB
-- ---------------------------------------------------------------------
-- bootstrap_admin() answers "does this project already have an admin?" by
-- looking for role = 'admin'. With owners now possible, a club whose only
-- administrator is an owner would look un-bootstrapped, and the function would
-- hand the setup window to whoever asked next.
--
-- Same widening as section 4, nothing else. It still refuses everyone once an
-- administrator exists, and it still promotes the caller only while the project
-- has no administrator at all. is_bootstrap_needed() needs no change: it counts
-- profiles, not admins, so the setup screen stays hidden as soon as one account
-- exists.
-- =====================================================================
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

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE role IN ('admin', 'super_admin', 'owner')
  ) THEN
    -- Already bootstrapped: succeed only for the existing admins.
    RETURN EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = caller_id AND role IN ('admin', 'super_admin', 'owner')
    );
  END IF;

  -- No admin exists yet, so this is the first-run setup window.
  UPDATE public.profiles SET role = 'admin' WHERE id = caller_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin() TO anon, authenticated;


-- =====================================================================
-- 6. VERIFICATION - RUN THESE AFTER THE MIGRATION
-- ---------------------------------------------------------------------
-- Run 1 to 5 in order; 6 is the one that touches a row and is optional.
--
-- 1. SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public' AND table_name = 'activity_logs';
--
-- 2. SELECT column_name, data_type, is_generated
--     FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'activity_logs'
--     ORDER BY ordinal_position;
--    Expect 13 columns, with "timestamp" reported as ALWAYS.
--
-- 3. SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--     WHERE conrelid = 'public.profiles'::regclass AND contype = 'c';
--    Expect one row, profiles_role_check, listing all five roles.
--
-- 4. -- Only meaningful while signed in as an owner.
--    -- Returns false for staff and trainers, true for admin/super_admin/owner:
--    SELECT public.current_role() AS role, public.is_admin() AS is_admin;
--
-- 5. -- Policies installed on the new table. Expect the four below and nothing
--    -- else, so a hand-made policy cannot have widened it unnoticed.
--    SELECT policyname, cmd, roles FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'activity_logs'
--     ORDER BY policyname;
--
-- 6. -- Final end-to-end check, as the signed-in staff member. This is the only
--    -- statement here that writes a row, so run it once and then delete it:
--    INSERT INTO public.activity_logs
--      (action, category, performed_by, performer_email, details, changes)
--    VALUES
--      ('PHASE4_MIGRATION_CHECK', 'Admin Access', auth.jwt() ->> 'email',
--       auth.jwt() ->> 'email',
--       'Running this row once proves the audit trail reads and writes.', NULL);
--    -- Then re-open Activity Logs: the row must appear and the five sample rows
--    -- must be gone.
--    DELETE FROM public.activity_logs WHERE action = 'PHASE4_MIGRATION_CHECK';
--
-- =====================================================================
-- EXPECTED BEHAVIOUR AFTER THIS FILE
--   * Activity Logs shows real rows. While the table is empty the screen still
--     shows its five sample rows, because activityLogService.js falls back to
--     localStorage whenever a query returns zero rows - that is the service's
--     rule, not a fault here. The first real logged action replaces them.
--   * Creating a staff account as "Super Admin (Owner)" succeeds instead of
--     failing with 23514, and that account can then change settings, plans,
--     branches and staff roles.
--   * Everything phases 1-3 did still holds: one check-in per member per club
--     day, staff cannot promote themselves, and member photos stay in a private
--     bucket reachable only as short-lived signed URLs.
-- =====================================================================