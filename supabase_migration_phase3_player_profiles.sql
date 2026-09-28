-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 3 MIGRATION
-- Player profiles: photos, gym cards, and the attendance check-in engine
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- ORDERING - IMPORTANT
--   1. Run the phase 2 migration
--      (supabase_migration_phase2_daypass_attendance.sql) FIRST.
--   2. If phase 3 stops with a duplicate-attendance error, follow the
--      instructions it prints: that is a data problem, not a code problem,
--      and it needs a decision from the club before it can be resolved.
--   3. Re-run this file. It will then complete and enforce the daily rule.
--
-- SAFETY PROPERTIES (please read before running)
--   * Additive only. No DROP TABLE, no DELETE, no TRUNCATE, and no rewrite of
--     the members / memberships / payments / attendance tables.
--   * Re-runnable. Every DDL statement is guarded (IF NOT EXISTS, ON CONFLICT
--     DO NOTHING, DROP POLICY IF EXISTS then CREATE, or CREATE OR REPLACE), so
--     running this file twice leaves the database exactly as running it once.
--   * It never merges or deletes attendance history. If duplicate check-ins
--     for the same member on the same day already exist, this file STOPS
--     before changing anything and tells you what to do about them.
--   * The only rows it writes are attendance_date on rows that have no date
--     yet. Each row keeps its own original check_in_time untouched.
--   * Row Level Security is unchanged. Every function below is SECURITY
--     INVOKER, so the existing policies still decide who may read and write.
--     Only `authenticated` is granted EXECUTE; `anon` and `PUBLIC` are not.
--
-- THE DATA CHANGES THIS SCRIPT MAKES
--   1. Ensures members.avatar_url exists. Photos are stored in the PRIVATE
--      `member-photos` bucket and only the object PATH is written to the
--      column - never a public URL, which would break the moment the bucket
--      policy is tightened.
--   2. Re-asserts the private `member-photos` bucket and its four staff
--      policies, repairing any that were dropped or edited by hand. These are
--      the same four policies phase 2 section 10 installs; none of them widen
--      access beyond signed-in staff.
--   3. Ensures attendance.attendance_date exists, is backfilled from each row's
--      own timestamp in club time, and defaults to the club's current day for
--      new check-ins.
--   4. Creates idx_attendance_member_date_unique, the database-level guarantee
--      that one member has at most ONE attendance row per club-local date.
--      Unlike the previous draft of this file, the index is never silently
--      skipped: the pre-flight refuses to continue while duplicates exist.
--   5. Adds public.log_attendance(member, method): an idempotent check-in that
--      returns the row already on file, instead of failing, when the member
--      has already been seen that day. Safe under concurrent scans.
--
-- NOT INCLUDED ON PURPOSE
--   * public.club_today(). Phase 2 already provides public.gym_today(), which
--     returns exactly the same thing. Duplicating it here would be two sources
--     of truth for "today" that could drift apart.
--   * A cryptographically random QR token. Existing qr_code_id values are
--     already printed on cards handed out at the desk, so rotating them is a
--     separate decision with its own migration plan.
--   * Photo resizing. That happens in the browser before upload, so no image
--     tooling is needed on the database.
--   * A second duplicate-merge implementation. Phase 2's
--     public.dedupe_attendance() already does the job and is admin-gated; two
--     implementations of "which same-day row survives" would be a second
--     source of truth that could disagree with each other.
-- =====================================================================


-- =====================================================================
-- 0. PRE-FLIGHT
-- ---------------------------------------------------------------------
-- Every check below is independent and every failure names the exact missing
-- dependency. They all run before the first change, so a database that fails
-- pre-flight is byte-for-byte unchanged.
--
-- 0a. gym_tz()  - without it, a check-in at 00:30 Colombo time would be filed
--                  under the previous UTC day, and at a month edge under the
--                  wrong month.
-- 0b. gym_today() - the authority on "today" for this club.
-- 0c. attendance.attendance_date - the column the daily rule is built on.
-- 0d. no duplicate member/day pairs - otherwise the unique index in section 4
--                  cannot be created, and the requirement that a member can
--                  only ever have one check-in per local date would not be
--                  enforced by the database.
-- =====================================================================

-- 0a ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'gym_tz'
       AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION
      'Phase 2 is not applied: public.gym_tz() is missing. Run supabase_migration_phase2_daypass_attendance.sql first, then run this file again. Nothing has been changed.';
  END IF;
END;
$$;

-- 0b ------------------------------------------------------------------
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
      'Phase 2 is not applied: public.gym_today() is missing. Run supabase_migration_phase2_daypass_attendance.sql first, then run this file again. Nothing has been changed.';
  END IF;
END;
$$;

-- 0c ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'attendance'
       AND column_name  = 'attendance_date'
  ) THEN
    RAISE EXCEPTION
      'Phase 2 is incomplete: public.attendance.attendance_date is missing, so the daily check-in rule has nothing to be built on. Re-run supabase_migration_phase2_daypass_attendance.sql, then run this file again. Nothing has been changed.';
  END IF;
END;
$$;

-- 0d ------------------------------------------------------------------
-- The date a row WILL carry once this file has run. attendance_date is used
-- where it already exists and derived from the row's own timestamp where it
-- does not, which is precisely what the backfill in section 3 writes. Checking
-- the derived value here is what lets the pre-flight stop the migration before
-- it changes anything, instead of discovering the duplicates halfway through.
DO $$
DECLARE
  v_dupes      BIGINT;
  v_affected   BIGINT;
  v_examples   TEXT;
  v_msg        TEXT;
BEGIN
  SELECT count(*), COALESCE(sum(n - 1), 0)
    INTO v_dupes, v_affected
    FROM (
      SELECT count(*) AS n
        FROM public.attendance a
       GROUP BY a.member_id,
                COALESCE(a.attendance_date,
                         (a.check_in_time AT TIME ZONE public.gym_tz())::date)
      HAVING count(*) > 1
    ) d;

  IF v_dupes > 0 THEN
    -- A short, human-readable sample of who is affected, so the message is
    -- actionable without having to go and run anything else first.
    SELECT string_agg(line, E'\n  ' ORDER BY line) INTO v_examples
      FROM (
        SELECT m.full_name || ' (' || m.member_code || ') on ' || d.day
               || ' has ' || d.n || ' check-ins' AS line
          FROM (
            SELECT a.member_id,
                   COALESCE(a.attendance_date,
                            (a.check_in_time AT TIME ZONE public.gym_tz())::date) AS day,
                   count(*) AS n
              FROM public.attendance a
             GROUP BY a.member_id,
                      COALESCE(a.attendance_date,
                               (a.check_in_time AT TIME ZONE public.gym_tz())::date)
            HAVING count(*) > 1
          ) d
          JOIN public.members m ON m.id = d.member_id
         ORDER BY d.day DESC, m.member_code
         LIMIT 10
      ) s;

    -- The message is assembled in a plain assignment, because RAISE itself
    -- only accepts a single constant as its format (adjacent string literals
    -- are not concatenated by PostgreSQL, and || is not allowed there). The
    -- USING MESSAGE form accepts any expression, so the variable is safe.
    v_msg := E'PHASE 3 STOPPED: duplicate attendance.\n'
             || E'\n'
             || v_dupes || E' member/day pair(s) already have more than one check-in row,\n'
             || E'  which means ' || v_affected || E' redundant row(s) in total.\n'
             || E'\n'
             || E'  The unique index that enforces "one check-in per member per day"\n'
             || E'  cannot be created until these are resolved, so this file has stopped\n'
             || E'  rather than creating it half-way or deleting your history silently.\n'
             || E'\n'
             || E'  Affected (first 10):\n  '
             || COALESCE(v_examples, '  (none)')
             || E'\n'
             || E'\n'
             || E'  TO RESOLVE, in this order:\n'
             || E'    1. Take a backup or a snapshot of the attendance table first.\n'
             || E'    2. Inspect the full list with the diagnostic query in section 7.\n'
             || E'    3. Merge them, keeping the earliest check-in of each member/day and\n'
             || E'       carrying the latest check-out onto it:\n'
             || E'\n'
             || E'         SELECT * FROM public.dedupe_attendance();\n'
             || E'\n'
             || E'       That function is admin-only and removes rows, which is why it is\n'
             || E'       never called automatically. Every visit for the day is preserved\n'
             || E'       as a single row; only the redundant same-day rows go.\n'
             || E'\n'
             || E'    4. Re-run this file. It will complete and create the index.\n'
             || E'\n'
             || E'  Nothing has been changed.';

    RAISE EXCEPTION USING MESSAGE = v_msg;
  END IF;
END;
$$;


-- =====================================================================
-- 1. MEMBER PHOTO COLUMN
-- ---------------------------------------------------------------------
-- Already present in supabase_schema.sql. Repeated with IF NOT EXISTS so this
-- file also works against a database created before avatar_url shipped.
-- =====================================================================
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;


-- =====================================================================
-- 2. PRIVATE MEMBER PHOTO BUCKET
-- ---------------------------------------------------------------------
-- Same effect as phase 2 section 10: a private bucket, so photos are served
-- through short-lived signed URLs and are never world-readable.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('member-photos', 'member-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Re-asserted rather than created-if-missing, so re-running this file repairs a
-- policy that was dropped or hand-edited.
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
-- 3. ATTENDANCE CALENDAR DATE
-- ---------------------------------------------------------------------
-- The column every monthly total is counted from. A check-in at 00:30 Colombo
-- time is the previous day in UTC, so deriving this from the raw timestamp in
-- UTC would file the visit under the wrong day, and at a month edge under the
-- wrong month.
-- =====================================================================
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS attendance_date DATE;

-- Backfill only rows that have no date. check_in_time is NOT NULL, so this
-- fills every row it can and discards nothing. Existing timestamps are left
-- exactly as they are.
UPDATE public.attendance a
   SET attendance_date = (a.check_in_time AT TIME ZONE public.gym_tz())::date
 WHERE a.attendance_date IS NULL;

-- Default written as an expression rather than a frozen constant, so a later
-- change to the club timezone applies to future check-ins without another
-- migration.
ALTER TABLE public.attendance
  ALTER COLUMN attendance_date
  SET DEFAULT ((now() AT TIME ZONE public.gym_tz())::date);


-- =====================================================================
-- 4. ONE ROW PER MEMBER PER DAY, ENFORCED BY THE DATABASE
-- ---------------------------------------------------------------------
-- This is the requirement: a member can have only ONE attendance record per
-- local calendar date. A repeated scan must not create a second present day,
-- and that has to hold for every write path, not just the app's own.
--
-- A unique index is the only thing that does that. It is the backstop behind
-- log_attendance(): it also blocks a direct INSERT from the app's fallback
-- path, from the SQL editor, and from any future code that forgets to call the
-- function.
--
-- The pre-flight in 0d has already proved there are no duplicates, so this
-- CREATE is expected to succeed. It is not wrapped in a "skip if it fails"
-- branch on purpose: if it ever does fail, that means duplicates arrived
-- between the pre-flight and here, and a loud error is the correct outcome.
-- A silently missing index would leave the daily rule unenforced while the
-- deployment looked healthy.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_member_date_unique
  ON public.attendance(member_id, attendance_date);


-- =====================================================================
-- 5. THE CHECK-IN ENGINE
-- ---------------------------------------------------------------------
-- Records one attendance row per member per club-local day and is safe to call
-- twice, which is what a front desk actually does: a member scans, the phone
-- is handed back, and they scan again because the first tap did not look like
-- it registered.
--
-- The second call is NOT an error. It returns the row already on file with
-- already_checked_in = true, so the app can say "already checked in at 07:12"
-- instead of showing a raw duplicate-key failure to a member at the door.
--
-- CONCURRENCY
--   Two scans of the same pass can genuinely be in flight at the same time
--   (double tap, a retried request, two staff at one door). A plain
--   "SELECT then INSERT" would let both see an empty table and both insert, so
--   the function takes a transaction-scoped advisory lock keyed on
--   (member, day) before it looks. The second caller blocks for the length of
--   the first transaction and then sees the committed row. Two different
--   members, or the same member on two different days, never contend.
--
--   The unique index from section 4 remains the authority. The INSERT below is
--   still written to expect a unique_violation and to answer it with the
--   existing row, so the function is correct even in the impossible case that
--   the index is ever dropped by hand.
--
-- SECURITY INVOKER on purpose: the existing attendance RLS policies still
-- apply to the INSERT and the SELECT, so this function cannot be used to bypass
-- them, and it grants no access the caller does not already have.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.log_attendance(
  p_member_id UUID,
  p_method    TEXT DEFAULT 'QR_SCAN'
)
RETURNS TABLE(
  id                 UUID,
  attendance_date    DATE,
  check_in_time      TIMESTAMPTZ,
  check_out_time     TIMESTAMPTZ,
  method             TEXT,
  already_checked_in BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_today  DATE := public.gym_today();
  v_method TEXT := COALESCE(NULLIF(trim(p_method), ''), 'QR_SCAN');
  v_row    public.attendance%ROWTYPE;
BEGIN
  IF p_member_id IS NULL THEN
    RAISE EXCEPTION 'A member id is required to record attendance'
      USING ERRCODE = '22004';
  END IF;

  -- Mirrors the CHECK constraint on attendance.method, so a client typo is
  -- corrected rather than failing the whole check-in at the door.
  IF v_method NOT IN ('QR_SCAN', 'MANUAL_ENTRY', 'FACIAL_RECOG') THEN
    v_method := 'QR_SCAN';
  END IF;

  -- Serialises concurrent check-ins for this one member on this one day. The
  -- lock is released when the surrounding transaction ends, so it cannot be
  -- leaked by a crash or by a client that simply disconnects.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_member_id::text),
    hashtext(v_today::text)
  );

  -- Under the lock, so this sees any row a concurrent caller has committed.
  SELECT * INTO v_row
    FROM public.attendance a
   WHERE a.member_id = p_member_id
     AND a.attendance_date = v_today
   ORDER BY a.check_in_time ASC, a.id ASC
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
      SELECT v_row.id, v_row.attendance_date, v_row.check_in_time,
             v_row.check_out_time, v_row.method, TRUE;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.attendance (member_id, check_in_time, method, attendance_date)
    VALUES (p_member_id, now(), v_method, v_today)
    RETURNING * INTO v_row;

    RETURN QUERY
      SELECT v_row.id, v_row.attendance_date, v_row.check_in_time,
             v_row.check_out_time, v_row.method, FALSE;
    RETURN;
  EXCEPTION
    WHEN unique_violation THEN
      -- The index in section 4 caught a row this transaction could not see.
      -- The failed INSERT is rolled back with its subtransaction, so nothing
      -- partial is left behind, and the day's real check-in is reported.
      NULL;
  END;

  SELECT * INTO v_row
    FROM public.attendance a
   WHERE a.member_id = p_member_id
     AND a.attendance_date = v_today
   ORDER BY a.check_in_time ASC, a.id ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not record the check-in'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT v_row.id, v_row.attendance_date, v_row.check_in_time,
           v_row.check_out_time, v_row.method, TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.log_attendance(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_attendance(UUID, TEXT) TO authenticated;


-- =====================================================================
-- 6. VERIFICATION
-- ---------------------------------------------------------------------
-- Read-only. Safe to run at any time; tells you whether the parts of the app
-- that depend on this migration are ready.
-- =====================================================================
DO $$
DECLARE
  v_undated       BIGINT;
  v_dupes         BIGINT;
  v_has_unique    BOOLEAN;
  v_has_locked    BOOLEAN;
  v_bucket_public BOOLEAN := NULL;
BEGIN
  SELECT count(*) INTO v_undated
    FROM public.attendance WHERE attendance_date IS NULL;

  SELECT count(*) INTO v_dupes
    FROM (
      SELECT member_id, attendance_date FROM public.attendance
       WHERE attendance_date IS NOT NULL
       GROUP BY member_id, attendance_date HAVING count(*) > 1
    ) d;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'attendance'
       AND indexname = 'idx_attendance_member_date_unique'
  ) INTO v_has_unique;

  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'log_attendance'
  ) INTO v_has_locked;

  -- "public" is the column name and also a schema keyword, so it is quoted.
  SELECT b."public" INTO v_bucket_public
    FROM storage.buckets b WHERE b.id = 'member-photos';

  RAISE NOTICE '---------------------------------------------------------------';
  RAISE NOTICE 'PHASE 3 CHECK';
  RAISE NOTICE '  gym_tz() ...................... present';
  RAISE NOTICE '  gym_today() ................... present';
  RAISE NOTICE '  member-photos bucket ........... %',
    CASE WHEN v_bucket_public IS NULL THEN 'MISSING'
         WHEN v_bucket_public          THEN 'PUBLIC - WRONG, must be private'
         ELSE 'private (correct)' END;
  RAISE NOTICE '  rows with no attendance_date ... %', v_undated;
  RAISE NOTICE '  duplicate member/day pairs .... %', v_dupes;
  RAISE NOTICE '  daily unique index ............. %', v_has_unique;
  RAISE NOTICE '  log_attendance() ............... %', v_has_locked;
  IF NOT v_has_unique THEN
    RAISE NOTICE '  WARNING: without the unique index the one-check-in-per-day';
    RAISE NOTICE '  rule is not enforced for writes that bypass the app.';
  END IF;
  IF v_dupes > 0 THEN
    RAISE NOTICE '  WARNING: duplicate member/day pairs still exist.';
  END IF;
  RAISE NOTICE '---------------------------------------------------------------';
END;
$$;


-- =====================================================================
-- 7. DIAGNOSTIC QUERY - NOT CALLED BY THIS SCRIPT
-- ---------------------------------------------------------------------
-- Run this by hand (nothing above executes it) to see exactly which attendance
-- rows would be affected by merging. Read it before deciding:
--
--   SELECT a.member_id,
--          m.member_code,
--          m.full_name,
--          a.attendance_date,
--          count(*)              AS rows_that_day,
--          min(a.check_in_time)  AS first_in,
--          max(a.check_out_time) AS last_out
--     FROM public.attendance a
--     JOIN public.members m ON m.id = a.member_id
--    WHERE a.attendance_date IS NOT NULL
--    GROUP BY a.member_id, m.member_code, m.full_name, a.attendance_date
--   HAVING count(*) > 1
--    ORDER BY a.attendance_date DESC;
--
-- If the result is empty, there is nothing to merge and this migration ran to
-- completion, index included.
--
-- If it is not empty, this migration refuses to run past its pre-flight. The
-- merge itself is public.dedupe_attendance() from phase 2 section 9: it keeps
-- the earliest check-in of each member/day, carries the latest check-out onto
-- it, and deletes the redundant rows. It is admin-only and is never called
-- automatically, because deleting rows is a decision for the club.
--
--   SELECT * FROM public.dedupe_attendance();
--
-- Back up the attendance table before calling it.
-- =====================================================================
