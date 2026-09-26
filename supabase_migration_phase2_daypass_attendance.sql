-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 2 MIGRATION
-- Day Pass + Monthly pricing, attendance calendar dates, month reporting
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- SAFETY PROPERTIES (please read before running)
--   * Additive only. No DROP TABLE, no DELETE, no TRUNCATE, no column
--     removal, and no rewrite of the members / memberships / payments /
--     attendance tables.
--   * Re-runnable. Every DDL statement is guarded (IF NOT EXISTS, ON
--     CONFLICT DO NOTHING, or an existence check), so running this file
--     twice leaves the database in the same state as running it once.
--   * It does NOT recreate any existing table. The live database already
--     has all members profile columns (nic_number, whatsapp_number,
--     district, address) in place; those statements below are no-ops here
--     and only exist to keep the file portable to older databases.
--   * Nothing is executed automatically against attendance rows. If the
--     table already holds two check-ins for the same member on the same
--     day, this script reports the count and SKIPS the unique index
--     instead of silently merging or deleting your records. See section 5.
--
-- THE ONE DATA CHANGE THIS SCRIPT MAKES
--   The "Monthly" plan price is set to LKR 2500 (the schema seed says
--   4500) and a "Day Pass" plan is created at LKR 250 for 1 day. Only the
--   plans table is touched. Historical payments and existing membership
--   rows are NOT affected, because the amount charged is stored on each
--   payments row, not read from the plan at reporting time.
--
--   If you have other plans (Quarterly / Annual) they are left exactly as
--   they are. Their prices are not part of this change.
--
-- NOT INCLUDED ON PURPOSE
--   * The check-in RPC / attendance engine. That is Phase 3 application
--     work, not schema.
--   * A cryptographically random QR token. The existing qr_code_id values
--     are already issued and printed on cards, so rotating them is a
--     separate decision made in a later phase.
--   * Business rule for buying a day pass while a monthly is running.
--     renew_membership() currently expires an open subscription first, so
--     selling a day pass to an active monthly member would close the
--     monthly. That is a product decision and is left for Phase 3.
-- =====================================================================


-- =====================================================================
-- 1. CLUB TIMEZONE
-- ---------------------------------------------------------------------
-- Every date below is a club-local calendar date, not a UTC date. A check-in
-- at 2026-01-01 00:30 Colombo time is 2025-12-31 18:30 UTC, so deriving the
-- attendance date from the raw timestamp in UTC would file it under the
-- wrong day and under the wrong month at the edges of a month.
-- Storing the zone on gym_settings keeps the app from hardcoding it.
-- =====================================================================
ALTER TABLE public.gym_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT;

UPDATE public.gym_settings
   SET timezone = 'Asia/Colombo'
 WHERE timezone IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'gym_settings'
       AND column_name = 'timezone' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.gym_settings ALTER COLUMN timezone SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not set gym_settings.timezone NOT NULL: %', SQLERRM;
END;
$$;

ALTER TABLE public.gym_settings
  ALTER COLUMN timezone SET DEFAULT 'Asia/Colombo';

-- Resolves the club timezone, falling back to Sri Lanka time if the
-- settings row is ever missing.
CREATE OR REPLACE FUNCTION public.gym_tz()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
           (SELECT timezone FROM public.gym_settings WHERE id),
           'Asia/Colombo'
         );
$$;
REVOKE ALL ON FUNCTION public.gym_tz() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_tz() TO anon, authenticated;

-- "Today" as the club sees it.
CREATE OR REPLACE FUNCTION public.gym_today()
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE public.gym_tz())::date;
$$;
REVOKE ALL ON FUNCTION public.gym_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_today() TO authenticated;

-- First and last calendar day of a month, so the app never has to guess
-- whether a month ends on the 30th, 31st, or in a leap February.
CREATE OR REPLACE FUNCTION public.gym_month_bounds(p_month DATE)
RETURNS TABLE(month_start DATE, month_end DATE)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', p_month::timestamp)::date,
         (date_trunc('month', p_month::timestamp) + INTERVAL '1 month')::date - 1;
$$;
REVOKE ALL ON FUNCTION public.gym_month_bounds(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_month_bounds(DATE) TO anon, authenticated;


-- =====================================================================
-- 2. MEMBER PROFILE COLUMNS
-- ---------------------------------------------------------------------
-- ALREADY PRESENT in the live database. Left in place so this file stays
-- safe to run against an older database that predates them. All four are
-- no-ops on the current database.
-- =====================================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS nic_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS district TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;


-- =====================================================================
-- 3. ATTENDANCE CALENDAR DATE
-- ---------------------------------------------------------------------
-- One row per member per club-local day, holding the first arrival and the
-- last departure. This is the column the monthly totals are counted from.
-- =====================================================================
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS attendance_date DATE;

-- Backfill every existing row from its own timestamp, converted into club
-- time. check_in_time is NOT NULL, so this fills every row and no record
-- is discarded. Existing rows keep their original timestamp untouched.
UPDATE public.attendance a
   SET attendance_date = (a.check_in_time AT TIME ZONE public.gym_tz())::date
 WHERE a.attendance_date IS NULL;

-- New check-ins default to the club's current day. Written as an
-- expression rather than a frozen constant so a later change to the club
-- timezone applies to future check-ins only.
ALTER TABLE public.attendance
  ALTER COLUMN attendance_date
  SET DEFAULT ((now() AT TIME ZONE public.gym_tz())::date);

-- Enforce NOT NULL only once the backfill has actually covered the table.
DO $$
DECLARE
  v_missing BIGINT;
BEGIN
  SELECT count(*) INTO v_missing
    FROM public.attendance
   WHERE attendance_date IS NULL;

  IF v_missing = 0 THEN
    ALTER TABLE public.attendance ALTER COLUMN attendance_date SET NOT NULL;
  ELSE
    RAISE WARNING
      'attendance.attendance_date left NULLABLE: % row(s) could not be dated. Inspect them before enforcing NOT NULL.',
      v_missing;
  END IF;
END;
$$;


-- =====================================================================
-- 4. INDEXES FOR MONTHLY REPORTING
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_attendance_date
  ON public.attendance(attendance_date DESC);

-- Servves both "attendance history for one member" and "who attended on
-- this date".
CREATE INDEX IF NOT EXISTS idx_attendance_member_date
  ON public.attendance(member_id, attendance_date DESC);

CREATE INDEX IF NOT EXISTS idx_memberships_start_date
  ON public.memberships(start_date DESC);

CREATE INDEX IF NOT EXISTS idx_memberships_plan
  ON public.memberships(plan_id);


-- =====================================================================
-- 5. UNIQUE DAILY ATTENDANCE
-- ---------------------------------------------------------------------
-- Prevents a second check-in for the same member on the same day, which is
-- what the duplicate-scan bug in the attendance engine was producing.
--
-- The index is only created when the table is already free of duplicates.
-- If history contains duplicates this script does NOT merge or delete
-- anything - it reports the count and moves on, so running the migration
-- can never lose attendance records.
-- =====================================================================
DO $$
DECLARE
  v_dupes BIGINT;
BEGIN
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT member_id, attendance_date
        FROM public.attendance
       WHERE attendance_date IS NOT NULL
       GROUP BY member_id, attendance_date
      HAVING count(*) > 1
    ) d;

  IF v_dupes = 0 THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_member_date_unique
               ON public.attendance(member_id, attendance_date)';
    RAISE NOTICE 'Created unique daily-attendance index.';
  ELSE
    RAISE WARNING
      'SKIPPED idx_attendance_member_date_unique: % member/day pair(s) already have more than one attendance row. Nothing was deleted. To merge them yourself, run the queries at the end of this file, then re-run this script to create the index.',
      v_dupes;
  END IF;
END;
$$;


-- =====================================================================
-- 6. DAY PASS PLAN SUPPORT
-- ---------------------------------------------------------------------
-- A day pass is a real one-day membership row, not a separate table, so it
-- flows through the existing payment and expiry logic. is_day_pass is a
-- convenience flag for reporting; the authoritative signal is
-- plans.duration_days = 1.
-- =====================================================================
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS is_day_pass BOOLEAN;

UPDATE public.plans
   SET is_day_pass = FALSE
 WHERE is_day_pass IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'plans'
       AND column_name = 'is_day_pass' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.plans ALTER COLUMN is_day_pass SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'Could not set plans.is_day_pass NOT NULL: %', SQLERRM;
END;
$$;

ALTER TABLE public.plans
  ALTER COLUMN is_day_pass SET DEFAULT FALSE;


-- =====================================================================
-- 7. PLAN PRICING - DAY PASS LKR 250, MONTHLY LKR 2500
-- ---------------------------------------------------------------------
-- Matched on the trimmed, case-insensitive name so this is re-runnable and
-- works whether or not the plans table is currently empty. Quarterly and
-- Annual are deliberately not touched.
-- =====================================================================
DO $$
DECLARE
  v_id UUID;
BEGIN
  -- Day Pass ------------------------------------------------------------
  SELECT id INTO v_id
    FROM public.plans
   WHERE lower(btrim(name)) = 'day pass'
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.plans
      (name, description, duration_days, price, features, is_active, is_day_pass)
    VALUES
      ('Day Pass',
       'Single day access, sold as a one-day membership.',
       1, 250,
       '["Gym Floor Access", "Cardio Zone", "Locker Room"]'::jsonb,
       TRUE, TRUE);
    RAISE NOTICE 'Created plan "Day Pass" - 1 day, LKR 250.';
  ELSE
    UPDATE public.plans
       SET duration_days = 1,
           price = 250,
           is_day_pass = TRUE,
           description = COALESCE(
             description, 'Single day access, sold as a one-day membership.')
     WHERE id = v_id;
    RAISE NOTICE 'Updated existing plan "Day Pass" to 1 day / LKR 250.';
  END IF;

  -- Monthly -------------------------------------------------------------
  SELECT id INTO v_id
    FROM public.plans
   WHERE lower(btrim(name)) = 'monthly'
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.plans
      (name, description, duration_days, price, features, is_active, is_day_pass)
    VALUES
      ('Monthly',
       'Standard access to the gym floor and cardio zone.',
       30, 2500,
       '["Gym Floor Access", "Cardio Zone", "Locker Room", "Free Towel Service"]'::jsonb,
       TRUE, FALSE);
    RAISE NOTICE 'Created plan "Monthly" - 30 days, LKR 2500.';
  ELSE
    UPDATE public.plans
       SET duration_days = 30,
           price = 2500,
           is_day_pass = FALSE
     WHERE id = v_id;
    RAISE NOTICE 'Updated existing plan "Monthly" to 30 days / LKR 2500.';
  END IF;
END;
$$;

-- Plan names are configuration, and the app looks a plan up by name. Two
-- rows called "Monthly" would make pricing ambiguous, so add a unique
-- index - but only when no duplicate name already exists, so this can
-- never fail the migration.
DO $$
DECLARE
  v_dupes BIGINT;
BEGIN
  SELECT count(*) INTO v_dupes
    FROM (
      SELECT lower(btrim(name))
        FROM public.plans
       GROUP BY lower(btrim(name))
      HAVING count(*) > 1
    ) d;

  IF v_dupes = 0 THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_name_unique
               ON public.plans (lower(btrim(name)))';
  ELSE
    RAISE WARNING
      'SKIPPED idx_plans_name_unique: % duplicate plan name(s) exist. Nothing was changed.',
      v_dupes;
  END IF;
END;
$$;


-- =====================================================================
-- 8. CURRENT-MONTH ATTENDANCE REPORTING
-- ---------------------------------------------------------------------
-- Counts distinct attended days per member for a club-local calendar
-- month, defaulting to the current month. Doing this server-side keeps the
-- dashboard correct across the UTC / Colombo day boundary instead of
-- grouping by a timestamp the browser happened to format.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.monthly_attendance(p_month DATE DEFAULT NULL)
RETURNS TABLE(
  member_id      UUID,
  member_code    TEXT,
  full_name      TEXT,
  days_attended  BIGINT,
  first_check_in TIMESTAMPTZ,
  last_check_out TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT b.month_start, b.month_end
      FROM public.gym_month_bounds(COALESCE(p_month, public.gym_today())) b
  ),
  agg AS (
    SELECT a.member_id,
           count(DISTINCT a.attendance_date) AS days,
           min(a.check_in_time)              AS first_in,
           max(a.check_out_time)             AS last_out
      FROM public.attendance a
      CROSS JOIN bounds b
     WHERE a.attendance_date BETWEEN b.month_start AND b.month_end
     GROUP BY a.member_id
  )
  SELECT m.id, m.member_code, m.full_name, agg.days, agg.first_in, agg.last_out
    FROM agg
    JOIN public.members m ON m.id = agg.member_id
   ORDER BY agg.days DESC, m.full_name;
$$;
REVOKE ALL ON FUNCTION public.monthly_attendance(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.monthly_attendance(DATE) TO authenticated;

-- Day-pass sales for a month, so the dashboard can separate walk-in day
-- passes from monthly subscribers.
CREATE OR REPLACE FUNCTION public.monthly_day_pass_sales(p_month DATE DEFAULT NULL)
RETURNS TABLE(
  member_id   UUID,
  member_code TEXT,
  full_name   TEXT,
  sold_on     DATE,
  end_date    DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT b.month_start, b.month_end
      FROM public.gym_month_bounds(COALESCE(p_month, public.gym_today())) b
  )
  SELECT m.id, m.member_code, m.full_name, ms.start_date, ms.end_date
    FROM public.memberships ms
    JOIN public.members m ON m.id = ms.member_id
    JOIN public.plans   p ON p.id = ms.plan_id
    CROSS JOIN bounds b
   WHERE (p.is_day_pass OR p.duration_days = 1)
     AND ms.start_date BETWEEN b.month_start AND b.month_end
   ORDER BY ms.start_date DESC, m.full_name;
$$;
REVOKE ALL ON FUNCTION public.monthly_day_pass_sales(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.monthly_day_pass_sales(DATE) TO authenticated;


-- =====================================================================
-- 9. OPTIONAL: MERGE EXISTING DUPLICATE ATTENDANCE
-- ---------------------------------------------------------------------
-- NOT CALLED by this script. It exists so that if section 5 reported
-- duplicates, you can merge them deliberately as an administrator:
--
--   SELECT * FROM public.dedupe_attendance();
--
-- It keeps the earliest check-in of each member/day, carries the latest
-- check-out onto that row, and deletes the rest. READ THE DIAGNOSTIC QUERY
-- IN SECTION 12 FIRST so you know exactly which rows it will remove.
-- Until you call it, no attendance record is touched.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.dedupe_attendance()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can merge attendance rows'
      USING ERRCODE = '42501';
  END IF;

  -- Fold each group onto its earliest row.
  WITH ranked AS (
    SELECT id, member_id, attendance_date,
           row_number() OVER (
             PARTITION BY member_id, attendance_date
             ORDER BY check_in_time ASC, id ASC
           ) AS rn
      FROM public.attendance
     WHERE attendance_date IS NOT NULL
  ),
  merged AS (
    SELECT member_id,
           attendance_date,
           min(check_in_time)  AS first_in,
           max(check_out_time) AS last_out
      FROM public.attendance
     WHERE attendance_date IS NOT NULL
     GROUP BY member_id, attendance_date
  )
  UPDATE public.attendance a
     SET check_in_time  = m.first_in,
         check_out_time = m.last_out
    FROM ranked r
    JOIN merged m
      ON m.member_id = r.member_id
     AND m.attendance_date = r.attendance_date
   WHERE r.rn = 1
     AND a.id = r.id
     AND (a.check_in_time  IS DISTINCT FROM m.first_in
       OR a.check_out_time IS DISTINCT FROM m.last_out);

  DELETE FROM public.attendance a
   USING (
     SELECT id,
            row_number() OVER (
              PARTITION BY member_id, attendance_date
              ORDER BY check_in_time ASC, id ASC
            ) AS rn
       FROM public.attendance
      WHERE attendance_date IS NOT NULL
   ) r
   WHERE a.id = r.id
     AND r.rn > 1;

  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN v_removed;
END;
$$;
REVOKE ALL ON FUNCTION public.dedupe_attendance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dedupe_attendance() TO authenticated;


-- =====================================================================
-- 10. MEMBER PHOTO STORAGE (needed later, safe to run now)
-- ---------------------------------------------------------------------
-- Private bucket: photos are served through short-lived signed URLs, never
-- public. Authenticated staff can read and manage photos, matching the
-- existing members table policy. No change to existing storage buckets.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('member-photos', 'member-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Staff can view member photos" ON storage.objects;
CREATE POLICY "Staff can view member photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'member-photos');

DROP POLICY IF EXISTS "Staff can upload member photos" ON storage.objects;
CREATE POLICY "Staff can upload member photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'member-photos');

DROP POLICY IF EXISTS "Staff can update member photos" ON storage.objects;
CREATE POLICY "Staff can update member photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'member-photos')
  WITH CHECK (bucket_id = 'member-photos');

DROP POLICY IF EXISTS "Staff can delete member photos" ON storage.objects;
CREATE POLICY "Staff can delete member photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'member-photos');


-- =====================================================================
-- 11. RLS STATUS CHECK
-- ---------------------------------------------------------------------
-- No policy is loosened by this migration. This block only re-asserts that
-- RLS stays enabled on every table, in case a table was ever altered
-- outside this script.
-- =====================================================================
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches     ENABLE ROW LEVEL SECURITY;


-- =====================================================================
-- 12. VERIFICATION - RUN THESE AFTER THE MIGRATION
-- =====================================================================

-- 12a. New columns present?
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (table_name, column_name) IN (
     ('attendance', 'attendance_date'),
     ('plans', 'is_day_pass'),
     ('gym_settings', 'timezone')
   )
 ORDER BY table_name;

-- 12b. Indexes present?  idx_attendance_member_date_unique should be here.
--      If it is missing, section 5 found duplicates - go to 12d.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN (
     'idx_attendance_date',
     'idx_attendance_member_date',
     'idx_attendance_member_date_unique',
     'idx_plans_name_unique',
     'idx_memberships_start_date',
     'idx_memberships_plan'
   )
 ORDER BY indexname;

-- 12c. Plans and prices
SELECT name, duration_days, price, is_active, is_day_pass
  FROM public.plans
 ORDER BY is_day_pass, name;

-- 12d. Duplicate member/day pairs.  Expect zero.
--      If this returns rows, run the diagnostic below BEFORE calling
--      public.dedupe_attendance().
SELECT m.member_code, m.full_name, a.attendance_date, count(*) AS rows_that_day
  FROM public.attendance a
  JOIN public.members m ON m.id = a.member_id
 WHERE a.attendance_date IS NOT NULL
 GROUP BY m.member_code, m.full_name, a.attendance_date
HAVING count(*) > 1
 ORDER BY a.attendance_date DESC;

-- 12e. Exactly which rows dedupe_attendance() would remove, if you run it.
--      Purely informational - it deletes nothing.
SELECT a.id, m.member_code, a.attendance_date, a.check_in_time, a.check_out_time
  FROM public.attendance a
  JOIN public.members m ON m.id = a.member_id
  JOIN (
    SELECT id,
           member_id,
           attendance_date,
           row_number() OVER (
             PARTITION BY member_id, attendance_date
             ORDER BY check_in_time ASC, id ASC
           ) AS rn
      FROM public.attendance
     WHERE attendance_date IS NOT NULL
  ) r ON r.id = a.id
 WHERE r.rn > 1
 ORDER BY a.attendance_date DESC, a.check_in_time;

-- 12f. Nothing was dated into the future by the timezone conversion
SELECT min(attendance_date) AS earliest, max(attendance_date) AS latest,
       count(*) FILTER (WHERE attendance_date > public.gym_today()) AS future_dated
  FROM public.attendance;

-- 12g. Club timezone actually in effect
SELECT id, gym_name, timezone, currency FROM public.gym_settings;

-- =====================================================================
-- END OF MIGRATION
-- =====================================================================
