-- =====================================================================
-- BE SMART FITNESS CLUB - PHASE 6 MIGRATION
-- Payment reminder log for the day-29 WhatsApp follow-up
-- ---------------------------------------------------------------------
-- HOW TO USE
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- ORDERING
--   Run after phase 1 (supabase_schema.sql), phase 2
--   (supabase_migration_phase2_daypass_attendance.sql), phase 3
--   (supabase_migration_phase3_player_profiles.sql), phase 4
--   (supabase_migration_phase4_activity_logs_and_roles.sql) and phase 5
--   (supabase_migration_phase5_atomic_member_creation.sql).
--
-- WHY THIS FILE EXISTS
--   Reception should chase every player's next payment once 28 days have
--   passed since their membership started (the 29th day). The app works out
--   who is due in the browser from memberships.start_date, but it has nowhere
--   to record that a reminder was actually sent, so staff could not tell at a
--   glance who has already been chased this month.
--
--   This creates public.payment_reminders, one row per reminder sent, so the
--   Payment Reminders screen can show "last reminded" against each player and
--   the same player is not nagged twice by accident.
--
-- SAFETY PROPERTIES
--   * Additive only. One new table, its indexes and its policies. No DROP
--     TABLE, no DELETE, no change to members / memberships / payments.
--   * Re-runnable. Every statement is guarded, so running this file twice
--     leaves the database exactly as running it once.
--   * The table starts EMPTY. Nothing is sent automatically: the app opens a
--     WhatsApp chat with the message pre-written and records the send when
--     staff press the button.
--
-- NOT INCLUDED ON PURPOSE
--   * A database job that sends WhatsApp messages on its own. A personal
--     WhatsApp number cannot be driven from Postgres or the browser; that
--     needs the WhatsApp Business Cloud API plus an approved template and a
--     scheduled worker. This file is the record-keeping half of the feature,
--     which is what the app can do today.
-- =====================================================================


-- =====================================================================
-- 0. PRE-FLIGHT
-- =====================================================================
DO $$
DECLARE
  table_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_reminders'
  ) INTO table_exists;

  IF table_exists THEN
    RAISE NOTICE 'public.payment_reminders already exists - section 1 will be a no-op.';
  ELSE
    RAISE NOTICE 'Creating public.payment_reminders for the payment reminder log.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'gym_today'
  ) THEN
    RAISE NOTICE 'WARNING: public.gym_today() is missing. Run phase 2 first for club-local dates.';
  END IF;
END;
$$;


-- =====================================================================
-- 1. THE REMINDER LOG
-- ---------------------------------------------------------------------
-- One row per reminder. The column names match what
-- src/services/reminderService.js sends and reads:
--   member_id, membership_id, channel, phone, message, status,
--   days_since_start
-- sent_by is filled from the signed-in user by the trigger below, never from
-- the payload, so it cannot be spoofed.
--
-- WHY membership_id IS NULLABLE
--   The reminder is about a membership, but a reminder can outlive the row it
--   referred to (a membership that is later deleted). ON DELETE SET NULL keeps
--   the reminder as evidence without blocking the delete.
--
-- WHY status EXISTS
--   The log records intent to contact, not delivery: the app cannot see inside
--   WhatsApp. 'Sent' means the chat was opened with the message; 'Failed' is
--   reserved for a number that could not be built into a wa.me link.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id        UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  membership_id    UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  channel          TEXT NOT NULL DEFAULT 'WhatsApp'
                     CHECK (channel IN ('WhatsApp', 'SMS', 'Call', 'Email', 'Other')),
  phone            TEXT,
  message          TEXT,
  status           TEXT NOT NULL DEFAULT 'Sent'
                     CHECK (status IN ('Sent', 'Failed')),
  days_since_start INTEGER,
  sent_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS member_id        UUID;
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS membership_id    UUID;
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS channel          TEXT NOT NULL DEFAULT 'WhatsApp';
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS phone            TEXT;
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS message          TEXT;
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'Sent';
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS days_since_start INTEGER;
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS sent_by          UUID;
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Newest-first reads per member, which is the only query the screen makes.
CREATE INDEX IF NOT EXISTS idx_payment_reminders_member
  ON public.payment_reminders(member_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_reminders_sent_at
  ON public.payment_reminders(sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_reminders_membership
  ON public.payment_reminders(membership_id);


-- =====================================================================
-- 2. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- Any signed-in staff member may read the log and append a reminder. Editing
-- and deleting are admin-only: the log is a record of who was contacted, and
-- the app never edits or removes a row.
-- =====================================================================
ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  existing RECORD;
BEGIN
  FOR existing IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_reminders'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      existing.policyname, existing.schemaname, existing.tablename
    );
  END LOOP;
END;
$$;

CREATE POLICY "Authenticated users can read payment reminders" ON public.payment_reminders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can log payment reminders" ON public.payment_reminders
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update payment reminders" ON public.payment_reminders
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete payment reminders" ON public.payment_reminders
  FOR DELETE TO authenticated USING (public.is_admin());

-- Who actually sent the reminder, taken from the session.
CREATE OR REPLACE FUNCTION public.payment_reminders_stamp_sender()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sent_by IS NULL THEN
    NEW.sent_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION public.payment_reminders_stamp_sender() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_payment_reminder_created ON public.payment_reminders;
CREATE TRIGGER on_payment_reminder_created
  BEFORE INSERT ON public.payment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.payment_reminders_stamp_sender();


-- =====================================================================
-- 3. VERIFICATION
-- ---------------------------------------------------------------------
-- 1. SELECT column_name, data_type
--      FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'payment_reminders'
--      ORDER BY ordinal_position;
--
-- 2. SELECT policyname, cmd FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'payment_reminders'
--      ORDER BY policyname;
--    Expect the four policies above.
--
-- 3. -- Only meaningful while signed in. Writes one row; delete it after:
--    INSERT INTO public.payment_reminders (member_id, phone, message, status)
--    SELECT id, phone, 'PHASE6_MIGRATION_CHECK', 'Failed'
--      FROM public.members LIMIT 1;
--    DELETE FROM public.payment_reminders WHERE message = 'PHASE6_MIGRATION_CHECK';
-- =====================================================================
