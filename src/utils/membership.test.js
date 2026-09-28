import { describe, it, expect } from 'vitest';
import {
  DENIAL_REASONS,
  OPEN_MEMBERSHIP_STATUSES,
  evaluateMembershipAdmission,
  isMembershipLive,
  isOpenMembershipStatus,
} from './membership';

const TODAY = '2026-03-14';

function member(overrides = {}) {
  return {
    id: 'member-1',
    full_name: 'Kasun Kalhara Perera',
    status: 'Active',
    membership_id: 'mem-1',
    membership_status: 'Active',
    start_date: '2026-03-01',
    expiration_date: '2026-03-31',
    ...overrides,
  };
}

describe('what "Expiring" means', () => {
  it('is an OPEN membership status, alongside Active', () => {
    // Mirrors idx_memberships_one_open_per_member and every query in the
    // existing schema that treats status IN ('Active','Expiring') as live.
    expect(OPEN_MEMBERSHIP_STATUSES).toEqual(['Active', 'Expiring']);
    expect(isOpenMembershipStatus('Active')).toBe(true);
    expect(isOpenMembershipStatus('Expiring')).toBe(true);
    expect(isOpenMembershipStatus('Expired')).toBe(false);
    expect(isOpenMembershipStatus('Cancelled')).toBe(false);
  });

  it('is reported as live by the shared label helper used by the card', () => {
    expect(isMembershipLive('Active')).toBe(true);
    expect(isMembershipLive('Expiring')).toBe(true);
    expect(isMembershipLive('Expired')).toBe(false);
  });
});

describe('evaluateMembershipAdmission', () => {
  it('allows an Active membership covering today', () => {
    const verdict = evaluateMembershipAdmission(member(), TODAY);

    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('allows an Expiring membership that has not lapsed', () => {
    const verdict = evaluateMembershipAdmission(
      member({ membership_status: 'Expiring', expiration_date: '2026-03-20' }),
      TODAY
    );

    expect(verdict.allowed).toBe(true);
  });

  it('allows an Expiring membership whose end_date is today, since the date is inclusive', () => {
    const verdict = evaluateMembershipAdmission(
      member({ membership_status: 'Expiring', expiration_date: TODAY }),
      TODAY
    );

    expect(verdict.allowed).toBe(true);
  });

  it('refuses an Expiring membership that lapsed yesterday', () => {
    const verdict = evaluateMembershipAdmission(
      member({ membership_status: 'Expiring', expiration_date: '2026-03-13' }),
      TODAY
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.LAPSED);
    expect(verdict.detail).toContain('2026-03-13');
  });

  it('refuses an Expired membership', () => {
    const verdict = evaluateMembershipAdmission(
      member({ membership_status: 'Expired' }),
      TODAY
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.NOT_OPEN);
  });

  it('refuses a stale Active label once end_date has passed', () => {
    // The label is only corrected when sync_expired_memberships() runs, so the
    // dates have to be able to refuse entry on their own.
    const verdict = evaluateMembershipAdmission(
      member({ membership_status: 'Active', expiration_date: '2026-03-01' }),
      TODAY
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.LAPSED);
  });

  it('refuses a Cancelled membership even while its dates are still open', () => {
    // Cancellation is deliberate, so it outranks the date window.
    const verdict = evaluateMembershipAdmission(
      member({ membership_status: 'Cancelled' }),
      TODAY
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.NOT_OPEN);
  });

  it('refuses a membership that has not started yet', () => {
    const verdict = evaluateMembershipAdmission(member({ start_date: '2026-04-01' }), TODAY);

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.NOT_STARTED);
  });

  it('allows a membership starting today', () => {
    expect(evaluateMembershipAdmission(member({ start_date: TODAY }), TODAY).allowed).toBe(true);
  });

  it('refuses a member with no membership row', () => {
    const verdict = evaluateMembershipAdmission(
      member({ membership_id: null, membership_status: null }),
      TODAY
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.NO_MEMBERSHIP);
  });

  it.each(['Inactive', 'Suspended', 'Expired'])('refuses a member whose record is %s', (status) => {
    const verdict = evaluateMembershipAdmission(member({ status }), TODAY);

    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(DENIAL_REASONS.MEMBER_INACTIVE);
  });

  it('refuses a missing member without throwing', () => {
    expect(evaluateMembershipAdmission(null, TODAY).allowed).toBe(false);
    expect(evaluateMembershipAdmission(undefined, TODAY).reason).toBe(
      DENIAL_REASONS.NO_MEMBERSHIP
    );
  });

  it('does not invent a date check when the membership has no dates on file', () => {
    // Older rows may predate the summary fields. A missing end_date must not
    // silently deny a member whose status says the subscription is open.
    const verdict = evaluateMembershipAdmission(
      member({ start_date: null, expiration_date: null }),
      TODAY
    );

    expect(verdict.allowed).toBe(true);
  });

  it('always returns a human-readable detail for a refusal', () => {
    const denied = [
      member({ status: 'Suspended' }),
      member({ membership_status: 'Expired' }),
      member({ membership_id: null }),
      member({ start_date: '2026-05-01' }),
      member({ expiration_date: '2026-01-01' }),
    ];

    for (const m of denied) {
      const verdict = evaluateMembershipAdmission(m, TODAY);
      expect(verdict.allowed).toBe(false);
      expect(verdict.detail).toBeTruthy();
      expect(typeof verdict.detail).toBe('string');
    }
  });
});
