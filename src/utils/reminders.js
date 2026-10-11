// Payment-reminder rules, kept pure and free of Supabase and React so the day
// counting and the message wording can be unit tested on their own.
//
// THE RULE
//   The club bills in monthly cycles. Once 28 days have passed since the
//   current membership started, the next payment is due and reception should
//   chase it. The count is measured from memberships.start_date, not from the
//   last payment, so every renewal restarts the clock exactly once and a
//   member cannot be chased twice for the same cycle.
//
// WHY THE CLUB DAY DECIDES
//   Dates are compared as 'YYYY-MM-DD' keys resolved in the club's timezone,
//   never by subtracting timestamps. A membership that started at 23:30 must
//   not be counted as a day older at 00:30 the next morning.

import { addDays, parseKey, toDateKey } from './attendanceMath';
import { formatCurrency } from './formatters';
import { buildWhatsAppUrl } from './phone';
import { CLUB_DISPLAY_NAME } from './brand';
import { OPEN_MEMBERSHIP_STATUSES } from './membership';

export const REMINDER_DAYS_AFTER_START = 28;

// A reminder chases a payment, so it is aimed at people the club still bills:
// an active member, or one whose membership has lapsed and has not renewed yet.
// Suspended and manually deactivated members are deliberately left off the list.
const CHASEABLE_MEMBER_STATUSES = ['Active', 'Expired'];

// Membership statuses that keep a payment due. 'Expired' is included on purpose:
// the sync job flips a membership to Expired the moment its end date passes, and
// that unpaid renewal is exactly the one reception needs to chase. Only states
// staff set deliberately (Cancelled) stop the reminders.
function isChaseableMembershipStatus(status) {
  return OPEN_MEMBERSHIP_STATUSES.includes(status) || status === 'Expired';
}

// Picks the membership that represents the member's current billing cycle.
//
// When the memberService row carries the nested history, the newest membership
// that is still open wins; if none is open, the most recently started one is the
// cycle that just lapsed and is the one being chased. The flattened fields are
// the fallback for callers (the profile, the tests) that only pass one.
function selectReminderCycle(member) {
  const list = Array.isArray(member.memberships)
    ? member.memberships.filter((sub) => sub && sub.start_date)
    : [];

  if (list.length > 0) {
    const open = list.find((sub) => OPEN_MEMBERSHIP_STATUSES.includes(sub.status));
    const newest = [...list].sort((a, b) =>
      String(b.start_date).localeCompare(String(a.start_date))
    )[0];
    const chosen = open || newest;
    return { status: chosen.status, startDate: chosen.start_date, endDate: chosen.end_date };
  }

  if (member.membership_id || member.start_date) {
    return {
      status: member.membership_status,
      startDate: member.start_date,
      endDate: member.expiration_date,
    };
  }

  return null;
}

function dayDiff(fromKey, toKey) {
  const from = parseKey(fromKey);
  const to = parseKey(toKey);
  if (!from || !to) return null;

  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((end - start) / 86400000);
}

// Whole days elapsed from `fromKey` to `toKey`. 0 on the same day, never
// negative.
export function daysSince(fromKey, toKey) {
  const diff = dayDiff(fromKey, toKey);
  return diff === null ? 0 : Math.max(0, diff);
}

// Signed distance in days from `fromKey` to `toKey`: positive when `toKey` is
// still ahead, 0 on the day itself, negative once it has passed. Null when
// either date is unreadable.
export function daysUntil(fromKey, toKey) {
  return dayDiff(fromKey, toKey);
}

/**
 * Works out whether one member's next payment is due a reminder today.
 *
 * @param {object} member   member row from memberService. May carry the nested
 *                          `memberships` history (members list) or the
 *                          flattened current fields (membership_id,
 *                          membership_status, start_date, expiration_date,
 *                          plan_name, plan_price).
 * @param {string} todayKey club-local 'YYYY-MM-DD'
 * @returns {{
 *   hasMembership: boolean,
 *   isOpen: boolean,
 *   status: string | null,
 *   startDate: string | null,
 *   expiryDate: string | null,
 *   dueDate: string | null,
 *   daysSinceStart: number,
 *   daysUntilExpiry: number | null,
 *   isDue: boolean,
 *   reason: string
 * }}
 */
export function evaluatePaymentReminder(
  member,
  todayKey,
  { reminderDays = REMINDER_DAYS_AFTER_START } = {}
) {
  const today = toDateKey(todayKey);

  const blank = (reason, extra = {}) => ({
    hasMembership: false,
    isOpen: false,
    startDate: null,
    expiryDate: null,
    dueDate: null,
    daysSinceStart: 0,
    daysUntilExpiry: null,
    isDue: false,
    reason,
    ...extra,
  });

  if (!member) return blank('no-member');

  // A suspended or deactivated member is not chaseable even if a membership row
  // is still attached.
  if (member.status && !CHASEABLE_MEMBER_STATUSES.includes(member.status)) {
    return blank(`member-${String(member.status).toLowerCase()}`);
  }

  const cycle = selectReminderCycle(member);
  if (!cycle) return blank('no-membership');

  const start = toDateKey(cycle.startDate);
  const expiry = toDateKey(cycle.endDate);
  const isOpen = OPEN_MEMBERSHIP_STATUSES.includes(cycle.status);

  const base = {
    hasMembership: true,
    isOpen,
    status: cycle.status ?? null,
    startDate: start,
    expiryDate: expiry,
    dueDate: start ? addDays(start, reminderDays) : null,
    daysSinceStart: start ? daysSince(start, today) : 0,
    daysUntilExpiry: expiry ? daysUntil(today, expiry) : null,
  };

  // 'Cancelled' (and anything else staff set deliberately) ends the reminders.
  if (!isChaseableMembershipStatus(cycle.status)) {
    return { ...blank(`membership-${String(cycle.status || 'unknown').toLowerCase()}`), ...base };
  }
  if (!start) return { ...blank('no-start-date'), ...base };

  const isDue = base.daysSinceStart >= reminderDays;
  return { ...base, isDue, reason: isDue ? 'due' : 'not-due' };
}

/**
 * The reminder text staff send over WhatsApp.
 *
 * Short and factual: the player's name, the amount, the date it was due and
 * the day access lapses, so the message stands on its own without a phone
 * call to the desk.
 */
export function buildPaymentReminderMessage(
  member,
  { gymName = CLUB_DISPLAY_NAME, currency = 'LKR', reminderDays = REMINDER_DAYS_AFTER_START } = {}
) {
  const name = member?.full_name?.trim() || 'there';
  const plan = member?.plan_name && member.plan_name !== 'No Active Plan' ? member.plan_name : null;
  const start = toDateKey(member?.start_date);
  const dueDate = start ? addDays(start, reminderDays) : null;
  const expiry = toDateKey(member?.expiration_date);
  const price = Number(member?.plan_price);

  const lines = [
    `Hello ${name},`,
    '',
    `A friendly reminder from ${gymName || CLUB_DISPLAY_NAME}.`,
  ];

  if (plan) lines.push(`Your ${plan} membership payment is due${dueDate ? ` on ${dueDate}` : ''}.`);
  else lines.push('Your membership payment is due.');
  if (Number.isFinite(price) && price > 0) {
    lines.push(`Amount: ${formatCurrency(price, currency)}`);
  }
  if (expiry) lines.push(`Your membership is valid until ${expiry}.`);

  lines.push('', 'Please renew at reception so your access is not interrupted. Thank you.');

  return lines.join('\n');
}

/**
 * The wa.me link for one member, or null when no WhatsApp-usable number is on
 * file. `phone` is passed explicitly so the caller controls the fallback from
 * whatsapp_number to phone.
 */
export function buildReminderWhatsAppUrl(phone, member, options = {}) {
  return buildWhatsAppUrl(phone, buildPaymentReminderMessage(member, options));
}
