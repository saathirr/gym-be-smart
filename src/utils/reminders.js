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
 * @param {object} member   flattened member row from memberService
 *                          (membership_id, membership_status, start_date,
 *                          expiration_date, plan_name, plan_price)
 * @param {string} todayKey club-local 'YYYY-MM-DD'
 * @returns {{
 *   hasMembership: boolean,
 *   isOpen: boolean,
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

  const start = toDateKey(member.start_date);
  const expiry = toDateKey(member.expiration_date);
  const hasMembership = Boolean(member.membership_id || start);
  const isOpen = OPEN_MEMBERSHIP_STATUSES.includes(member.membership_status);

  const base = {
    hasMembership,
    isOpen,
    startDate: start,
    expiryDate: expiry,
    dueDate: start ? addDays(start, reminderDays) : null,
    daysSinceStart: start ? daysSince(start, today) : 0,
    daysUntilExpiry: expiry ? daysUntil(today, expiry) : null,
  };

  if (!hasMembership) return { ...blank('no-membership'), ...base };
  if (!isOpen) return { ...blank('not-open'), ...base };
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
