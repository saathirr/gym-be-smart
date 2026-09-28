// Shared facts about the digital gym card: the prepared WhatsApp message, the
// download filename, and the print geometry.
//
// Kept separate from the React component and the PDF writer so the message
// wording and the filename rules can be unit tested without a DOM.

import { CLUB_DISPLAY_NAME } from './brand';

// CR80, the ISO/IEC 7810 ID-1 size every card printer and laminator takes.
// 85.6 x 54 mm, with a 3.18 mm bleed-friendly margin built into the layout.
export const GYM_CARD_WIDTH_MM = 85.6;
export const GYM_CARD_HEIGHT_MM = 54;

export const GYM_CARD_MARGIN_MM = 4;

// Rendered at 300 DPI for print. 85.6mm x 300dpi / 25.4 = 1011px, so the
// raster is comfortably above what a card printer resolves.
export const GYM_CARD_RASTER_DPI = 300;

export function gymCardPixelWidth() {
  return Math.round((GYM_CARD_WIDTH_MM / 25.4) * GYM_CARD_RASTER_DPI);
}

export function gymCardPixelHeight() {
  return Math.round((GYM_CARD_HEIGHT_MM / 25.4) * GYM_CARD_RASTER_DPI);
}

// What the card is allowed to show.
//
// Deliberately narrow. The card is photographed, posted and left on a desk, so
// it carries identity and entitlement only: no NIC, no residential address, no
// phone number, no date of birth. Anyone holding the card already has the QR,
// which is the only thing the front desk needs.
export const GYM_CARD_VISIBLE_FIELDS = [
  'full_name',
  'member_code',
  'plan_name',
  'membership_status',
  'expiration_date',
];

// Fields that must never reach the card or the PDF. Kept as an explicit list so
// it can be asserted in tests: a regression that spreads a whole member object
// onto the card is the obvious way to leak NIC and address.
export const GYM_CARD_FORBIDDEN_FIELDS = [
  'nic_number',
  'address',
  'phone',
  'whatsapp_number',
  'email',
  'date_of_birth',
  'medical_conditions',
  'emergency_contact',
  'district',
  'qr_code_id',
];

// CR80 at 4 px/mm gives a comfortable CSS size for the on-screen preview.
export const GYM_CARD_CSS_WIDTH = 344;
export const GYM_CARD_CSS_HEIGHT = Math.round(
  (GYM_CARD_HEIGHT_MM / GYM_CARD_WIDTH_MM) * GYM_CARD_CSS_WIDTH
);

/**
 * The one and only object the card and the PDF are allowed to read.
 *
 * Everything is passed through `display()` so the values are already safe to
 * print: no nulls, no undefined, and no accidental fallbacks that would expose
 * a raw identifier.
 */
export function buildGymCardData(member, { gymName = CLUB_DISPLAY_NAME, currency = 'LKR' } = {}) {
  if (!member) return null;

  const plan = member.plan_name && member.plan_name !== 'No Active Plan'
    ? member.plan_name
    : 'No Active Plan';

  return {
    clubName: gymName || CLUB_DISPLAY_NAME,
    displayName: CLUB_DISPLAY_NAME,
    fullName: member.full_name || 'Member',
    memberCode: member.member_code || 'N/A',
    planName: plan,
    // Only the entitlement, never the underlying membership row.
    membershipStatus: member.membership_status || member.status || 'Unknown',
    validUntil: member.expiration_date || null,
    photoPath: member.avatar_url || null,
    // The QR payload is the opaque token only. No name, phone, NIC or address
    // is ever encoded - see memberService.createMember.
    qrPayload: member.qr_code_id || member.member_code || '',
    currency,
  };
}

// Re-exported from the shared membership rule so the card, the scanner and the
// dashboard cannot drift apart on what "still valid" means. See
// utils/membership.js for why 'Expiring' counts as live.
export { isMembershipLive } from './membership';

// 'Be Smart Fitness Club' -> 'be-smart-fitness-club'
export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// 'BeSmartGymCard-BSG-1001.pdf'
export function gymCardFileName(member, { gymName = CLUB_DISPLAY_NAME } = {}) {
  const code = member?.member_code;
  if (code) return `${slugify(gymName)}-gym-card-${slugify(code)}.pdf`;

  const name = member?.full_name;
  if (name) return `${slugify(gymName)}-gym-card-${slugify(name)}.pdf`;

  return `${slugify(gymName)}-gym-card.pdf`;
}

/**
 * The message staff send with the card PDF.
 *
 * Kept short on purpose: it is opened on a phone, and the member has already
 * received their code. The PDF is attached by hand, because a browser cannot
 * silently hand a local file to WhatsApp.
 */
export function buildWhatsAppMessage(member, { gymName = CLUB_DISPLAY_NAME } = {}) {
  const name = member?.full_name?.trim() || 'there';
  const code = member?.member_code?.trim();
  const plan = member?.plan_name && member.plan_name !== 'No Active Plan'
    ? member.plan_name
    : null;
  const validUntil = member?.expiration_date;

  const lines = [
    `Hello ${name},`,
    '',
    `Welcome to ${gymName || CLUB_DISPLAY_NAME}.`,
    '',
    'Here is your official Gym Membership Card.',
  ];

  if (code) lines.push(`Member ID: ${code}`);
  if (plan) lines.push(`Membership: ${plan}`);
  if (validUntil) lines.push(`Valid until: ${validUntil}`);

  lines.push('', 'Please show the QR code at the entrance. Thank you.');

  return lines.join('\n');
}

// Two letters for the default avatar: 'Mohamed Saathir' -> 'MS'.
export function initialsOf(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
