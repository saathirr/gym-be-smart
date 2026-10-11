import { describe, it, expect } from 'vitest';
import {
  REMINDER_DAYS_AFTER_START,
  buildPaymentReminderMessage,
  buildReminderWhatsAppUrl,
  daysSince,
  daysUntil,
  evaluatePaymentReminder,
} from './reminders';

// A monthly membership that began on 2026-01-01. Day 29 falls on 2026-01-29
// (28 whole days after the start), which is the day reception should chase.
const START = '2026-01-01';
const DAY_29 = '2026-01-29';

function member(overrides = {}) {
  return {
    id: 'm-1',
    full_name: 'Kasun Perera',
    membership_id: 'sub-1',
    membership_status: 'Active',
    start_date: START,
    expiration_date: '2026-01-31',
    plan_name: 'Monthly',
    plan_price: 2500,
    ...overrides,
  };
}

describe('daysSince', () => {
  it('is zero on the start day', () => {
    expect(daysSince(START, START)).toBe(0);
  });

  it('counts whole days and never goes negative', () => {
    expect(daysSince(START, DAY_29)).toBe(28);
    expect(daysSince(DAY_29, START)).toBe(0);
  });
});

describe('daysUntil', () => {
  it('is signed so an expired date reads as negative', () => {
    expect(daysUntil('2026-01-20', '2026-01-31')).toBe(11);
    expect(daysUntil('2026-01-31', '2026-01-31')).toBe(0);
    expect(daysUntil('2026-02-05', '2026-01-31')).toBe(-5);
  });
});

describe('evaluatePaymentReminder', () => {
  it('is not due one day before the 29th day', () => {
    const result = evaluatePaymentReminder(member(), '2026-01-28');
    expect(result.isDue).toBe(false);
    expect(result.daysSinceStart).toBe(27);
  });

  it('is due on the 29th day', () => {
    const result = evaluatePaymentReminder(member(), DAY_29);
    expect(result.isDue).toBe(true);
    expect(result.daysSinceStart).toBe(REMINDER_DAYS_AFTER_START);
    expect(result.dueDate).toBe(DAY_29);
    expect(result.reason).toBe('due');
  });

  it('stays due after the 29th day', () => {
    const result = evaluatePaymentReminder(member(), '2026-02-10');
    expect(result.isDue).toBe(true);
    expect(result.daysSinceStart).toBe(40);
  });

  it('treats Expiring as an open membership', () => {
    expect(evaluatePaymentReminder(member({ membership_status: 'Expiring' }), DAY_29).isDue).toBe(
      true
    );
  });

  it('keeps chasing a lapsed membership until it is renewed', () => {
    const result = evaluatePaymentReminder(
      member({ membership_status: 'Expired' }),
      '2026-06-01'
    );
    expect(result.isDue).toBe(true);
    expect(result.reason).toBe('due');
    expect(result.status).toBe('Expired');
  });

  it('stops reminding a membership staff cancelled', () => {
    const result = evaluatePaymentReminder(member({ membership_status: 'Cancelled' }), DAY_29);
    expect(result.isDue).toBe(false);
    expect(result.reason).toBe('membership-cancelled');
  });

  it('leaves a suspended member off the list even when a payment is late', () => {
    const result = evaluatePaymentReminder(
      member({ status: 'Suspended', membership_status: 'Expired' }),
      '2026-06-01'
    );
    expect(result.isDue).toBe(false);
    expect(result.reason).toBe('member-suspended');
  });

  it('reads the current cycle from the nested history, not an older one', () => {
    const rows = [
      { status: 'Expired', start_date: '2026-01-01', end_date: '2026-01-31' },
      { status: 'Active', start_date: '2026-04-01', end_date: '2026-05-01' },
    ];
    expect(evaluatePaymentReminder(member({ memberships: rows }), '2026-04-10').isDue).toBe(false);
  });

  it('reminds a lapsed member read from the nested history', () => {
    const rows = [{ status: 'Expired', start_date: '2026-01-01', end_date: '2026-01-31' }];
    const result = evaluatePaymentReminder(member({ memberships: rows }), '2026-02-15');
    expect(result.isDue).toBe(true);
    expect(result.daysSinceStart).toBe(45);
  });

  it('reports a member with no membership', () => {
    const result = evaluatePaymentReminder(
      member({ membership_id: null, start_date: null, membership_status: null }),
      DAY_29
    );
    expect(result.hasMembership).toBe(false);
    expect(result.isDue).toBe(false);
    expect(result.reason).toBe('no-membership');
  });

  it('handles a null member without throwing', () => {
    expect(evaluatePaymentReminder(null, DAY_29).isDue).toBe(false);
  });
});

describe('buildPaymentReminderMessage', () => {
  it('names the player, the amount and the due date', () => {
    const message = buildPaymentReminderMessage(member(), { gymName: 'Be Smart Fitness Club' });
    expect(message).toContain('Kasun Perera');
    expect(message).toContain('Be Smart Fitness Club');
    expect(message).toContain('Monthly');
    expect(message).toContain(DAY_29);
    expect(message).toMatch(/Rs\.?\s?2,500/);
  });

  it('falls back to a neutral greeting when the name is missing', () => {
    const message = buildPaymentReminderMessage(member({ full_name: '' }));
    expect(message).toContain('Hello there,');
  });
});

describe('buildReminderWhatsAppUrl', () => {
  it('builds a wa.me link with the encoded message', () => {
    const url = buildReminderWhatsAppUrl('0771234567', member());
    expect(url).toMatch(/^https:\/\/wa\.me\/94771234567\?text=/);
  });

  it('returns null when the number cannot receive WhatsApp', () => {
    expect(buildReminderWhatsAppUrl('0112345678', member())).toBeNull();
  });
});
