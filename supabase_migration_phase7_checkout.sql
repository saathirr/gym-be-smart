-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 7 MIGRATION
-- Check-out, time spent per day, and forgotten check-out clean-up
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- ORDERING
--   Run after phase 1 (supabase_schema.sql), phase 2
--   (supabase_migration_phase2_daypass_attendance.sql) and phase 3
--   (supabase_migration_phase3_player_profiles.sql). Phase 7 relies on
--   attendance.attendance_date and public.gym_today() from those files.
--
-- WHY THIS FILE EXISTS
--   The club already records when a member arrives. To know how long each
--   player actually trained, the same QR pass is scanned again when they
--   leave, and that second scan closes the day's session. Two things are
--   needed for that to be reliable:
--
--     1. A way to tell a normal check-out apart from one the app had to
--        invent because the member simply walked out without scanning.
--        That is the new checkout_method column: 'QR_SCAN' / 'MANUAL_ENTRY'
--        are real departures, 'AUTO_CLOSE' means "no scan, closed at the
--        club's closing time".
--
--     2. A safe way to close the sessions that were left open overnight.
--        public.close_forgotten_attendance() does exactly that: every past
--        day whose session never ended is closed at the club's closing time
--        (never earlier than the check-in itself, so a late arrival can
--        never produce a negative duration) and flagged AUTO_CLOSE.
--
-- SAFETY PROPERTIES
--   * Additive only. One nullable column, one check constraint, one
--     function. No DROP TABLE, no DELETE, no TRUNCATE, no rewrite of the
--     attendance table, and no existing timestamp is touched.
--   * Re-runnable. The column uses ADD COLUMN IF NOT EXISTS, the constraint
--     is dropped-then-added, and the function is CREATE OR REPLACE.
--   * The clean-up only ever writes check_out_time where it is still NULL
--     and the session is from a PREVIOUS club-local day. Today's open
--     sessions (people still in the building) are never touched.
--   * Today's row is excluded by comparing against public.gym_today(), not
--     the browser clock, so a machine set to another timezone cannot close
--     the session of someone who is currently training.
--
-- HOW THE APP USES IT
--   * Scanning a pass toggles the day: no session -> check in; open session
--     -> check out; already closed -> reopen (welcome back). The row keeps
--     the day's first arrival and its latest departure.
--   * Time spent = check_out_time - check_in_time, shown in the scanner, the
--     attendance log and the player's attendance history.
--   * The attendance screen calls close_forgotten_attendance() on load so an
--     overnight session is tidied up and flagged the next morning.
--   * If this migration has not been run yet the app keeps working: it simply
--     cannot flag or auto-close a forgotten check-out until the column and
--     the function exist.
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
     WHERE n.nspname = 'public'
       AND p.proname = 'gym_today'
       AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION
      'Phase 2 is not applied: public.gym_today() is missing. Run supabase_migration_phase2_daypass_attendance.sql first (and phase 3), then run this file again. Nothing has been changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'attendance'
       AND column_name  = 'attendance_date'
  ) THEN
    RAISE EXCEPTION
      'Phase 2/3 are incomplete: public.attendance.attendance_date is missing. Run phase 2 and phase 3 first, then run this file again. Nothing has been changed.';
  END IF;

  RAISE NOTICE 'Phase 7 pre-flight passed.';
END;
$$;


-- =====================================================================
-- 1. CHECK-OUT METHOD
-- ---------------------------------------------------------------------
-- NULL means "the day has no departure recorded yet" for an open session,
-- or "checked out before phase 7 shipped" for a historical closed row.
-- =====================================================================
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS checkout_method TEXT;

-- Re-assert the value set. DROP-then-ADD keeps this file re-runnable.
ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_checkout_method_check;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_checkout_method_check
  CHECK (
    checkout_method IS NULL
    OR checkout_method IN ('QR_SCAN', 'MANUAL_ENTRY', 'AUTO_CLOSE')
  );

-- Finding the sessions still open is the only query the clean-up runs, and
-- it is the one the attendance screen is built around.
CREATE INDEX IF NOT EXISTS idx_attendance_open_sessions
  ON public.attendance(attendance_date)
  WHERE check_out_time IS NULL;


-- =====================================================================
-- 2. CLOSE FORGOTTEN ATTENDANCE
-- ---------------------------------------------------------------------
-- Closes every session from a PREVIOUS club-local day that was never ended,
-- at the club's closing time, and flags it AUTO_CLOSE. Returns how many rows
-- were closed.
--
-- The departure is GREATEST(check_in_time, closing time that day): a member
-- who arrived after closing (a late session, a clock correction) is closed
-- at the moment they arrived, so the computed time spent can never be
-- negative.
--
-- Today is deliberately excluded: those sessions belong to people who are
-- still in the building and must not be closed underneath them.
--
-- SECURITY DEFINER so the maintenance sweep is not blocked by a row the
-- caller cannot see, but it is still gated on a signed-in user. It only
-- writes check_out_time / checkout_method on rows that are already open.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.close_forgotten_attendance()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today  DATE := public.gym_today();
  v_close  TIME;
  v_count  INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- closing_time is stored as free text ('22:00'). A malformed value falls
  -- back to 22:00 rather than failing the whole sweep.
  SELECT COALESCE(NULLIF(btrim(closing_time), '')::time, TIME '22:00')
    INTO v_close
    FROM public.gym_settings
   WHERE id;

  IF v_close IS NULL THEN
    v_close := TIME '22:00';
  END IF;

  WITH open_rows AS (
    SELECT a.id,
           GREATEST(
             a.check_in_time,
             ((a.attendance_date + v_close) AT TIME ZONE public.gym_tz())
           ) AS close_at
      FROM public.attendance a
     WHERE a.check_out_time IS NULL
       AND a.attendance_date IS NOT NULL
       AND a.attendance_date < v_today
  )
  UPDATE public.attendance a
     SET check_out_time  = r.close_at,
         checkout_method = 'AUTO_CLOSE'
    FROM open_rows r
   WHERE a.id = r.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.close_forgotten_attendance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_forgotten_attendance() TO authenticated;


-- =====================================================================
-- 3. VERIFICATION
-- ---------------------------------------------------------------------
-- Read-only. Safe to run at any time.
-- =====================================================================
DO $$
DECLARE
  v_col       BOOLEAN;
  v_fn        BOOLEAN;
  v_open_past BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'attendance'
       AND column_name = 'checkout_method'
  ) INTO v_col;

  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'close_forgotten_attendance'
  ) INTO v_fn;

  SELECT count(*) INTO v_open_past
    FROM public.attendance
   WHERE check_out_time IS NULL
     AND attendance_date < public.gym_today();

  RAISE NOTICE '---------------------------------------------------------------';
  RAISE NOTICE 'PHASE 7 CHECK';
  RAISE NOTICE '  attendance.checkout_method ....... %', v_col;
  RAISE NOTICE '  close_forgotten_attendance() ...... %', v_fn;
  RAISE NOTICE '  forgotten sessions waiting ....... %', v_open_past;
  IF v_open_past > 0 THEN
    RAISE NOTICE '  Run: SELECT public.close_forgotten_attendance();';
    RAISE NOTICE '  to close them at the club closing time and flag them.';
  END IF;
  RAISE NOTICE '---------------------------------------------------------------';
END;
$$;

-- =====================================================================
-- END OF MIGRATION
-- =====================================================================
