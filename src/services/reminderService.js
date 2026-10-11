import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { memberService } from './memberService';
import { getClubToday } from './attendanceService';
import { evaluatePaymentReminder, REMINDER_DAYS_AFTER_START } from '../utils/reminders';

const REMINDER_COLUMNS = `
  id,
  member_id,
  membership_id,
  channel,
  phone,
  message,
  status,
  days_since_start,
  sent_at
`;

// PostgREST reports an unknown table as PGRST205, Postgres as 42P01. Both mean
// phase 6 has not been run yet, which the screen should survive rather than
// fail on.
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);

function isMissingTable(error) {
  return Boolean(error) && MISSING_TABLE_CODES.has(error.code);
}

function toReminder(row) {
  return {
    id: row.id,
    member_id: row.member_id,
    membership_id: row.membership_id,
    channel: row.channel,
    phone: row.phone,
    message: row.message,
    status: row.status,
    days_since_start: row.days_since_start,
    sent_at: row.sent_at,
  };
}

export const reminderService = {
  REMINDER_DAYS_AFTER_START,

  /**
   * Every player whose next payment is due a reminder today, newest to fall
   * due first.
   *
   * The due rule is applied in the browser over the member list rather than in
   * SQL so the same pure function that the profile and the tests use is the only
   * place the 28-day rule lives. The list is capped, which is fine for a single
   * club; a chain larger than the cap would need paging here.
   *
   * Every member is scanned, not just the active ones: the sync job flips a
   * member to 'Expired' the day their membership lapses, and that unpaid renewal
   * is exactly who needs chasing. evaluatePaymentReminder() decides who is
   * chaseable from the membership history it was given.
   */
  async getDueReminders({ timeZone, limit = 1000 } = {}) {
    const today = await getClubToday({ timeZone });
    const members = await memberService.getMembers({ status: 'ALL', limit });

    const due = members
      .map((member) => ({ member, reminder: evaluatePaymentReminder(member, today) }))
      .filter((row) => row.reminder.isDue);

    const lastByMember = await this.getLastReminders(due.map((row) => row.member.id));

    const reminders = due
      .map((row) => ({ ...row, lastReminder: lastByMember[row.member.id] || null }))
      .sort((a, b) => b.reminder.daysSinceStart - a.reminder.daysSinceStart);

    return { today, reminders };
  },

  // The most recent reminder per member, keyed by member id. Missing table
  // returns an empty map so the screen still lists who is due.
  async getLastReminders(memberIds = []) {
    const ids = memberIds.filter(Boolean);
    if (ids.length === 0) return {};

    const { data, error } = await supabase
      .from('payment_reminders')
      .select(REMINDER_COLUMNS)
      .in('member_id', ids)
      .order('sent_at', { ascending: false })
      .limit(2000);

    if (error) {
      if (isMissingTable(error)) return {};
      throw toMessage(error, 'Could not load the reminder history.');
    }

    const latest = {};
    for (const row of data || []) {
      if (!latest[row.member_id]) latest[row.member_id] = toReminder(row);
    }
    return latest;
  },

  // The reminder trail for one player, shown on the payment history screen.
  async getRemindersForMember(memberId, { limit = 50 } = {}) {
    if (!memberId) return [];

    const { data, error } = await supabase
      .from('payment_reminders')
      .select(REMINDER_COLUMNS)
      .eq('member_id', memberId)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) {
      if (isMissingTable(error)) return [];
      throw toMessage(error, 'Could not load the reminder history.');
    }
    return (data || []).map(toReminder);
  },

  async recordReminder({
    memberId,
    membershipId = null,
    phone = null,
    message = '',
    status = 'Sent',
    daysSinceStart = null,
    channel = 'WhatsApp',
  }) {
    if (!memberId) throw new Error('A member is required to record a reminder.');

    const { data, error } = await supabase
      .from('payment_reminders')
      .insert([
        {
          member_id: memberId,
          membership_id: membershipId || null,
          channel,
          phone: phone || null,
          message: message?.trim() || null,
          status,
          days_since_start: Number.isFinite(daysSinceStart) ? daysSinceStart : null,
        },
      ])
      .select(REMINDER_COLUMNS)
      .single();

    if (error) throw toMessage(error, 'Could not record this reminder.');
    return toReminder(data);
  },
};
