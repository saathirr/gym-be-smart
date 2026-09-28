import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CLUB_DISPLAY_NAME } from './brand';
import {
  GYM_CARD_CSS_HEIGHT,
  GYM_CARD_CSS_WIDTH,
  GYM_CARD_FORBIDDEN_FIELDS,
  GYM_CARD_HEIGHT_MM,
  GYM_CARD_MARGIN_MM,
  GYM_CARD_WIDTH_MM,
  GYM_CARD_VISIBLE_FIELDS,
  buildGymCardData,
  buildWhatsAppMessage,
  gymCardFileName,
  initialsOf,
  isMembershipLive,
  slugify,
} from './gymCard';

const member = {
  id: 'a1b2c3',
  full_name: 'Mohamed Saathir',
  member_code: 'BSG-1001',
  qr_code_id: 'BSG-1001.MFHI6C',
  nic_number: '199012345678',
  address: '42 Temple Road, Colombo 05',
  phone: '0771234567',
  whatsapp_number: '0771234567',
  email: 'saathir@example.lk',
  date_of_birth: '1990-04-12',
  medical_conditions: 'Asthma',
  emergency_contact: '0779999999',
  district: 'Colombo',
  plan_name: 'Monthly',
  membership_status: 'Active',
  status: 'Active',
  expiration_date: '2026-10-20',
  avatar_url: 'a1b2c3/passport.jpg',
};

describe('gym card geometry', () => {
  it('is CR80, the size card printers and laminators take', () => {
    expect(GYM_CARD_WIDTH_MM).toBe(85.6);
    expect(GYM_CARD_HEIGHT_MM).toBe(54);
  });

  it('leaves a margin that fits the layout', () => {
    expect(GYM_CARD_MARGIN_MM).toBeGreaterThan(0);
    expect(GYM_CARD_MARGIN_MM * 2).toBeLessThan(GYM_CARD_HEIGHT_MM);
  });

  it('keeps the on-screen preview at the physical aspect ratio', () => {
    const physical = GYM_CARD_HEIGHT_MM / GYM_CARD_WIDTH_MM;
    const css = GYM_CARD_CSS_HEIGHT / GYM_CARD_CSS_WIDTH;
    expect(Math.abs(css - physical)).toBeLessThan(0.01);
  });
});

describe('buildGymCardData', () => {
  const card = buildGymCardData(member, { gymName: 'Be Smart Fitness Club' });

  it('exposes exactly the fields the card is allowed to show', () => {
    expect(card.fullName).toBe('Mohamed Saathir');
    expect(card.memberCode).toBe('BSG-1001');
    expect(card.planName).toBe('Monthly');
    expect(card.membershipStatus).toBe('Active');
    expect(card.validUntil).toBe('2026-10-20');
  });

  it('carries the club name in both display casings', () => {
    expect(card.clubName).toBe('Be Smart Fitness Club');
    expect(card.displayName).toBe(CLUB_DISPLAY_NAME);
  });

  it('never carries sensitive identity data', () => {
    const serialised = JSON.stringify(card);
    for (const field of GYM_CARD_FORBIDDEN_FIELDS) {
      if (field === 'qr_code_id') continue; // the opaque token is intentional
      expect(card[field], `card must not expose ${field}`).toBeUndefined();
    }
    // The actual values, not just the keys.
    expect(serialised).not.toContain('199012345678');
    expect(serialised).not.toContain('Temple Road');
    expect(serialised).not.toContain('saathir@example.lk');
    expect(serialised).not.toContain('Asthma');
  });

  it('encodes only the opaque QR token, never personal data', () => {
    expect(card.qrPayload).toBe('BSG-1001.MFHI6C');
    expect(card.qrPayload).not.toContain('Mohamed');
    expect(card.qrPayload).not.toContain('0771234567');
    expect(card.qrPayload).not.toContain('199012345678');
  });

  it('falls back to the member code when no QR token exists', () => {
    expect(buildGymCardData({ ...member, qr_code_id: null }).qrPayload).toBe('BSG-1001');
  });

  it('normalises a missing plan to a readable label', () => {
    expect(buildGymCardData({ ...member, plan_name: 'No Active Plan' }).planName).toBe(
      'No Active Plan'
    );
    expect(buildGymCardData({ ...member, plan_name: null }).planName).toBe('No Active Plan');
  });

  it('survives a sparse member object', () => {
    const sparse = buildGymCardData({ full_name: 'A B', member_code: 'BSG-1' });
    expect(sparse.fullName).toBe('A B');
    expect(sparse.membershipStatus).toBe('Unknown');
    expect(sparse.validUntil).toBeNull();
  });

  it('returns null for a missing member rather than a blank card', () => {
    expect(buildGymCardData(null)).toBeNull();
  });

  it('keeps a reference to the stored photo path, not a public URL', () => {
    // The bucket is private, so the card holds a path that is resolved to a
    // short-lived signed URL at render time.
    expect(card.photoPath).toBe('a1b2c3/passport.jpg');
  });
});

describe('GYM_CARD_VISIBLE_FIELDS', () => {
  it('is a short, printable list', () => {
    expect(GYM_CARD_VISIBLE_FIELDS).toEqual([
      'full_name',
      'member_code',
      'plan_name',
      'membership_status',
      'expiration_date',
    ]);
  });

  it('disjoint from the forbidden list', () => {
    const overlap = GYM_CARD_VISIBLE_FIELDS.filter((f) =>
      GYM_CARD_FORBIDDEN_FIELDS.includes(f)
    );
    expect(overlap).toEqual([]);
  });
});

describe('buildWhatsAppMessage', () => {
  const message = buildWhatsAppMessage(member, { gymName: 'Be Smart Fitness Club' });

  it('greets the player by name', () => {
    expect(message).toContain('Hello Mohamed Saathir,');
  });

  it('states the club and the member id', () => {
    expect(message).toContain('Be Smart Fitness Club');
    expect(message).toContain('Member ID: BSG-1001');
  });

  it('includes the plan and the valid-until date', () => {
    expect(message).toContain('Membership: Monthly');
    expect(message).toContain('Valid until: 2026-10-20');
  });

  it('does not leak the NIC, address or phone number', () => {
    expect(message).not.toContain('199012345678');
    expect(message).not.toContain('Temple Road');
    expect(message).not.toContain('0771234567');
  });

  it('omits the optional lines when the data is missing', () => {
    const sparse = buildWhatsAppMessage(
      { full_name: 'X Y', member_code: 'BSG-9', plan_name: null, expiration_date: null },
      { gymName: 'Be Smart Fitness Club' }
    );
    expect(sparse).not.toContain('Membership:');
    expect(sparse).not.toContain('Valid until:');
    expect(sparse).toContain('Member ID: BSG-9');
  });

  it('falls back to a neutral greeting with no name', () => {
    expect(buildWhatsAppMessage({ member_code: 'BSG-1' })).toContain('Hello there,');
  });
});

describe('gymCardFileName', () => {
  it('is derived from the club and the member code', () => {
    expect(gymCardFileName(member)).toBe('be-smart-fitness-club-gym-card-bsg-1001.pdf');
  });

  it('falls back to the name, then to a generic filename', () => {
    expect(gymCardFileName({ full_name: 'A B' })).toBe(
      'be-smart-fitness-club-gym-card-a-b.pdf'
    );
    expect(gymCardFileName({})).toBe('be-smart-fitness-club-gym-card.pdf');
  });

  it('produces a filesystem-safe name', () => {
    const name = gymCardFileName({ full_name: '../../etc/passwd', member_code: 'A/B' });
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Be Smart Fitness Club')).toBe('be-smart-fitness-club');
  });

  it('strips punctuation and trims separators', () => {
    expect(slugify('  ---Hello, World!!!  ')).toBe('hello-world');
  });

  it('caps the length so the name cannot blow past path limits', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('initialsOf', () => {
  it('takes the first and last word', () => {
    expect(initialsOf('Mohamed Saathir')).toBe('MS');
    expect(initialsOf('Kasun Kalhara Perera').length).toBe(2);
  });

  it('handles a single name', () => {
    expect(initialsOf('Cher')).toBe('CH');
  });

  it('degrades safely', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });
});

describe('isMembershipLive', () => {
  it('treats Active and Expiring as live', () => {
    expect(isMembershipLive('Active')).toBe(true);
    expect(isMembershipLive('Expiring')).toBe(true);
  });

  it('treats everything else as not live', () => {
    expect(isMembershipLive('Expired')).toBe(false);
    expect(isMembershipLive('Cancelled')).toBe(false);
    expect(isMembershipLive(null)).toBe(false);
  });
});

describe('the shipped logo is what the card and PDF use', () => {
  it('exists in public/ at the path brand.js exports', () => {
    const logo = path.resolve(process.cwd(), 'public', 'logo.jpg');
    expect(existsSync(logo)).toBe(true);
    expect(readFileSync(logo).length).toBeGreaterThan(0);
  });
});
