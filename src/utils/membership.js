// The single source of truth for "may this member through the door today?".
//
// This rule was previously re-implemented in three places, and one of them
// quietly disagreed with the other two by treating the 'Expiring' status as a
// refusal. That is the kind of drift this module exists to prevent.
//
// WHAT 'Expiring' ACTUALLY MEANS IN THIS SCHEMA
//
//   It is not a lapsed state. The database groups it with 'Active' as an OPEN
//   membership, and does so in three separate places:
//
//     * idx_memberships_one_open_per_member
//         WHERE status IN ('Active', 'Expiring')
//       A member is only allowed one open subscription. If 'Expiring' were not
//       open, a member inside their final week could be sold a second plan and
//       end up with two live subscriptions.
//
//     * public.activate_member_plan / renewal helpers
//         WHERE status IN ('Active', 'Expiring')
//       The existing open subscription is the one that gets replaced.
//
//     * public.sync_expired_memberships()
//         SET status = 'Expired'
//      WHERE status IN ('Active', 'Expiring') AND end_date < CURRENT_DATE
//       'Expiring' becomes 'Expired' ONLY once the end date has passed. While
//       the date is still in the future the subscription is still paid for and
//       still valid.
//
//   So 'Expiring' is a still-valid membership that happens to be close to its
//   renewal date. Entry is allowed, and the card shows an amber status to prompt
//   a renewal conversation rather than to block the member.
//
// LABEL VS REALITY
//
// Admission is decided on the dates, not on the label alone, because the label
// can be stale. sync_expired_memberships() is a scheduled job, so a member whose
// end_date passed since the last run is still labelled 'Active'. Trusting that
// label would let an expired member in; checking the dates closes that gap. The
// reverse case is handled conservatively: a label of 'Expired' or 'Cancelled'
// always wins, because those states are set deliberately by staff and should
// stop entry immediately even if the dates look open.

import { toDateKey } from './attendanceMath';

// Memberships that count as still running. Mirrors the partial unique index in
// supabase_schema.sql; keep the two in step.
export const OPEN_MEMBERSHIP_STATUSES = ['Active', 'Expiring'];

// Reasons a member can be refused, in the order they are checked. Stable strings
// so callers and tests can assert on them.
export const DENIAL_REASONS = {
  NO_MEMBERSHIP: 'no-membership',
  NOT_OPEN: 'membership-not-open',
  NOT_STARTED: 'membership-not-started',
  LAPSED: 'membership-expired',
  MEMBER_INACTIVE: 'member-not-active',
};

export function isOpenMembershipStatus(status) {
  return OPEN_MEMBERSHIP_STATUSES.includes(status);
}

/**
 * Is the member record itself in a state that permits entry?
 *
 * members.status is separate from the subscription: it is the administrative
 * flag for Inactive, Suspended or Expired people. A suspended member is refused
 * regardless of how good their subscription looks.
 */
export function isMemberStatusAdmissible(status) {
  return status === 'Active';
}

/**
 * Decides admission for one member on one club-local day.
 *
 * @param {object}  member      member row as returned by memberService
 *                              (membership_id, membership_status, start_date,
 *                              expiration_date, status)
 * @param {string}  todayKey    'YYYY-MM-DD' for the club's current day
 * @returns {{allowed: boolean, reason: string|null, detail: string}}
 *          `detail` is a sentence safe to show to staff or a member.
 */
export function evaluateMembershipAdmission(member, todayKey) {
  const today = toDateKey(todayKey);

  const deny = (reason, detail) => ({ allowed: false, reason, detail });

  if (!member) {
    return deny(DENIAL_REASONS.NO_MEMBERSHIP, 'No member record was found.');
  }

  if (!isMemberStatusAdmissible(member.status)) {
    return deny(
      DENIAL_REASONS.MEMBER_INACTIVE,
      `The member is marked "${member.status}". Renew or reinstate the membership first.`
    );
  }

  if (!member.membership_id) {
    return deny(
      DENIAL_REASONS.NO_MEMBERSHIP,
      'There is no running membership on this account.'
    );
  }

  if (!isOpenMembershipStatus(member.membership_status)) {
    return deny(
      DENIAL_REASONS.NOT_OPEN,
      `The membership is "${member.membership_status || 'unknown'}". Renew it to regain entry.`
    );
  }

  // Dates are compared as 'YYYY-MM-DD' keys rather than Date objects, so the
  // club's day boundary is the one that decides, not the browser's timezone.
  const start = toDateKey(member.start_date);
  const end = toDateKey(member.expiration_date);

  if (start && today && start > today) {
    return deny(
      DENIAL_REASONS.NOT_STARTED,
      `The membership does not start until ${start}.`
    );
  }

  // end_date is inclusive: a membership ending today is valid for the whole of
  // that day.
  if (end && today && end < today) {
    return deny(
      DENIAL_REASONS.LAPSED,
      `The membership lapsed on ${end}.`
    );
  }

  return { allowed: true, reason: null, detail: '' };
}

/**
 * Label-only check, for places that have a status and nothing else (the card,
 * the dashboard). Deliberately narrower than evaluateMembershipAdmission: it
 * cannot judge dates, so it must not be used to decide entry on its own.
 */
export function isMembershipLive(status) {
  return isOpenMembershipStatus(status);
}
