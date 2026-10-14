-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 8 MIGRATION
-- A second training session per day, and closing it overnight
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- ORDERING
--   Run after phase 1 (supabase_schema.sql), phase 2
--   (supabase_migration_phase2_daypass_attendance.sql), phase 3
--   (supabase_migration_phase3_player_profiles.sql) and phase 7
--   (supabase_migration_phase7_checkout.sql). It redefines the function that
--   phase 7 created, so phase 7 must be present first.
--
-- WHY THIS FILE EXISTS
--   Many members train twice a day: once in the morning, once in the evening.
--   Phase 7 recorded a single arrival and a single departure per day, so a
--   second visit either looked like the member never left (a span that counted
--   the whole gap between visits) or was refused outright.
--
--   This phase stores a SECOND session on the same daily row, so a day can
--   hold up to two complete visits:
--
--     session 1  = check_in_time        / check_out_time
--     session 2  = second_check_in_time / second_check_out_time
--
--   Time spent is the SUM of the two closed sessions, so the gap between them
--   is not counted. The app refuses a THIRD session at the door with a message
--   ("the two sessions for today are already complete"); that rule lives in the
--   app because it is a front-desk courtesy, not a data-integrity constraint.
--
--   The one-row-per-member-per-day unique index from phase 3 is untouched: the
--   second session is more columns on the same row, not a second row, so every
--   existing report that counts present days keeps working unchanged.
--
-- SAFETY PROPERTIES
--   * Additive only. Three nullable columns, one check constraint, and a
--     CREATE OR REPLACE of close_forgotten_attendance(). No DROP TABLE, no
--     DELETE, no TRUNCATE, no rewrite, and no existing timestamp is touched.
--   * Re-runnable. Columns use ADD COLUMN IF NOT EXISTS, the constraint is
--     dropped-then-added, and the function is CREATE OR REPLACE.
--   * The overnight clean-up only ever writes a departure where it is still
--     NULL and the session is from a PREVIOUS club-local day. Today's open
--     sessions (people still in the building) are never touched.
--   * Closing the second session can never produce a negative duration: the
--     departure is GREATEST(check-in, closing time that day).
--
-- HOW THE APP USES IT
--   * Scanning a pass walks the day forward: session 1 in, session 1 out,
--     session 2 in (welcome back), session 2 out. A further scan is refused
--     with "the two sessions for today are already complete".
--   * Time spent = (out1 - in1) + (out2 - in2), shown in the scanner, the
--     attendance log and the player's history.
--   * If this migration has not been run yet the app keeps working: it simply
--     keeps to a single session per day, exactly as it did after phase 7.
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
      'Phase 2 is not applied: public.gym_today() is missing. Run phase 2 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'attendance'
       AND column_name = 'check_out_time'
  ) THEN
    RAISE EXCEPTION
      'The attendance table is missing check_out_time. Run phase 1 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'attendance'
       AND column_name = 'checkout_method'
  ) THEN
    RAISE EXCEPTION
      'Phase 7 is not applied: attendance.checkout_method is missing. Run supabase_migration_phase7_checkout.sql first.';
  END IF;
END $$;


-- =====================================================================
-- 1. THE SECOND SESSION
-- =====================================================================
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS second_check_in_time  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS second_check_out_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS second_checkout_method TEXT;

-- A check-out may not exist without its check-in, and may not precede it. The
-- app never writes such a row, so a violation here means a real bug rather
-- than a front-desk mistake, and a loud error is the right outcome.
ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_second_session_check;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_second_session_check
  CHECK (
    (second_check_in_time IS NULL AND second_check_out_time IS NULL)
    OR (second_check_in_time IS NOT NULL AND second_check_out_time IS NULL)
    OR (second_check_in_time IS NOT NULL AND second_check_out_time >= second_check_in_time)
  );

ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS attendance_second_checkout_method_check;

ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_second_checkout_method_check
  CHECK (
    second_checkout_method IS NULL
    OR second_checkout_method IN ('QR_SCAN', 'MANUAL_ENTRY', 'AUTO_CLOSE')
  );

-- Finding rows with an open second session is the same access pattern as the
-- phase 7 index, so it is worth the same partial index.
CREATE INDEX IF NOT EXISTS idx_attendance_open_second_sessions
  ON public.attendance(attendance_date)
  WHERE second_check_out_time IS NULL;


-- =====================================================================
-- 2. CLOSE FORGOTTEN ATTENDANCE (now both sessions)
-- ---------------------------------------------------------------------
-- Redefines the function from phase 7 so the overnight sweep closes an open
-- FIRST session and an open SECOND session independently. A member who came
-- for one visit and forgot to scan out gets one AUTO_CLOSE; a member who
-- forgot on their second visit gets the second session flagged and the first
-- left exactly as it was recorded.
--
-- Today is still excluded, and every departure is still
-- GREATEST(check-in, closing time that day) so no duration can go negative.
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

  SELECT COALESCE(NULLIF(btrim(closing_time), '')::time, TIME '22:00')
    INTO v_close
    FROM public.gym_settings
   WHERE id;

  IF v_close IS NULL THEN
    v_close := TIME '22:00';
  END IF;

  WITH open_rows AS (
    SELECT a.id,
           CASE
             WHEN a.check_out_time IS NULL AND a.check_in_time IS NOT NULL
               THEN GREATEST(
                 a.check_in_time,
                 ((a.attendance_date + v_close) AT TIME ZONE public.gym_tz())
               )
           END AS close_1,
           CASE
             WHEN a.second_check_out_time IS NULL AND a.second_check_in_time IS NOT NULL
               THEN GREATEST(
                 a.second_check_in_time,
                 ((a.attendance_date + v_close) AT TIME ZONE public.gym_tz())
               )
           END AS close_2
      FROM public.attendance a
     WHERE a.attendance_date IS NOT NULL
       AND a.attendance_date < v_today
       AND (
         (a.check_out_time IS NULL AND a.check_in_time IS NOT NULL)
         OR (a.second_check_out_time IS NULL AND a.second_check_in_time IS NOT NULL)
       )
  )
  UPDATE public.attendance a
     SET check_out_time  = COALESCE(a.check_out_time, r.close_1),
         checkout_method = CASE
           WHEN a.check_out_time IS NULL AND r.close_1 IS NOT NULL THEN 'AUTO_CLOSE'
           ELSE a.checkout_method
         END,
         second_check_out_time  = COALESCE(a.second_check_out_time, r.close_2),
         second_checkout_method = CASE
           WHEN a.second_check_out_time IS NULL AND r.close_2 IS NOT NULL THEN 'AUTO_CLOSE'
           ELSE a.second_checkout_method
         END
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
  v_cols      INTEGER;
  v_has_check BOOLEAN;
  v_open      BIGINT;
BEGIN
  SELECT count(*)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'attendance'
     AND column_name IN
         ('second_check_in_time', 'second_check_out_time', 'second_checkout_method');

  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'attendance_second_session_check'
  ) INTO v_has_check;

  SELECT count(*)
    INTO v_open
    FROM public.attendance
   WHERE attendance_date < public.gym_today()
     AND (
       (check_out_time IS NULL AND check_in_time IS NOT NULL)
       OR (second_check_out_time IS NULL AND second_check_in_time IS NOT NULL)
     );

  RAISE NOTICE '---------------------------------------------------------------';
  RAISE NOTICE 'PHASE 8 VERIFICATION';
  RAISE NOTICE '  new session columns (expect 3) ..... %', v_cols;
  RAISE NOTICE '  session order constraint present ... %', v_has_check;
  RAISE NOTICE '  forgotten sessions waiting ......... %', v_open;
  IF v_open > 0 THEN
    RAISE NOTICE '  Run: SELECT public.close_forgotten_attendance();';
  END IF;
  RAISE NOTICE '---------------------------------------------------------------';
END $$;

-- =====================================================================
-- END OF MIGRATION
-- =====================================================================
