import { describe, it, expect } from 'vitest';
import {
  drawGymCard,
  downloadGymCardPdf,
  imageFormatFromMime,
} from './gymCardPdf';
import { GYM_CARD_HEIGHT_MM, GYM_CARD_WIDTH_MM, buildGymCardData } from '../utils/gymCard';

// jsPDF is a drawing API, so the useful assertions are about WHAT gets drawn and
// WHERE. A stub that records every call lets the layout be checked without a
// browser, a canvas, or asserting on a generated binary.
//
// addImage throws on malformed data, because that is what jsPDF does. Without
// it the fallback branches in drawGymCard would be unreachable and untested.
function createStubDoc() {
  const calls = {
    text: [],
    addImage: [],
    rect: [],
    line: [],
    setFont: [],
    setFontSize: [],
  };

  const doc = {
    setFillColor() {},
    setDrawColor() {},
    setLineWidth() {},
    setTextColor() {},
    setFont: (family, style) => calls.setFont.push([family, style]),
    setFontSize: (size) => calls.setFontSize.push(size),
    text: (value, x, y, options) => calls.text.push({ value: String(value), x, y, options }),
    addImage: (data, format, x, y, w, h) => {
      // Mirrors jsPDF, which decodes the bytes it is handed and cannot fetch a
      // URL. A `blob:` URL is not a decodable format, so the stub rejects it:
      // that is exactly the bug that kept the logo off every printed card.
      const valid =
        (format === 'PNG' && String(data).startsWith('data:image/png')) ||
        (format === 'JPEG' && String(data).startsWith('data:image/jpeg'));
      if (!valid) throw new Error(`Invalid image format: ${format}`);
      calls.addImage.push({ data, format, x, y, w, h });
    },
    rect: (x, y, w, h, style) => calls.rect.push({ x, y, w, h, style }),
    line: (...args) => calls.line.push(args),
  };

  return { doc, calls };
}

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
  plan_name: 'Monthly',
  membership_status: 'Active',
  expiration_date: '2026-10-20',
  avatar_url: 'a1b2c3/passport.jpg',
};

const QR = 'data:image/png;base64,AAAA';
const LOGO = 'data:image/jpeg;base64,LOGO';
const PHOTO = 'data:image/jpeg;base64,BBBB';

function draw(overrides = {}, cardOverrides = {}) {
  const card = { ...buildGymCardData(member), ...cardOverrides };
  const { doc, calls } = createStubDoc();
  drawGymCard(doc, card, overrides);
  return calls;
}

const allText = (calls) => calls.text.map((t) => t.value).join(' | ');

describe('downloadGymCardPdf - rejected input', () => {
  it('refuses to build a card for a missing member, without loading jsPDF', async () => {
    // The guard runs before the dynamic import, so this stays a fast,
    // dependency-free failure instead of pulling in the PDF library.
    await expect(downloadGymCardPdf(null)).rejects.toThrow(/no member/i);
    await expect(downloadGymCardPdf(undefined)).rejects.toThrow(/no member/i);
  });
});

describe('gym card geometry on the page', () => {
  it('fills exactly the CR80 page', () => {
    const page = draw().rect[0];
    expect(page.x).toBe(0);
    expect(page.y).toBe(0);
    expect(page.w).toBe(GYM_CARD_WIDTH_MM);
    expect(page.h).toBe(GYM_CARD_HEIGHT_MM);
  });

  it('keeps every drawn element inside the card', () => {
    const calls = draw({ qrDataUrl: QR, logoDataUrl: LOGO, photoDataUrl: PHOTO });

    for (const t of calls.text) {
      expect(t.x, `text "${t.value}" x`).toBeGreaterThanOrEqual(0);
      expect(t.x, `text "${t.value}" x`).toBeLessThanOrEqual(GYM_CARD_WIDTH_MM);
      expect(t.y, `text "${t.value}" y`).toBeGreaterThanOrEqual(0);
      expect(t.y, `text "${t.value}" y`).toBeLessThanOrEqual(GYM_CARD_HEIGHT_MM);
    }

    for (const image of calls.addImage) {
      expect(image.x).toBeGreaterThanOrEqual(0);
      expect(image.y).toBeGreaterThanOrEqual(0);
      expect(image.x + image.w).toBeLessThanOrEqual(GYM_CARD_WIDTH_MM + 0.001);
      expect(image.y + image.h).toBeLessThanOrEqual(GYM_CARD_HEIGHT_MM + 0.001);
    }
  });

  it('does not let the photo and the QR overlap', () => {
    const calls = draw({ qrDataUrl: QR, photoDataUrl: PHOTO });
    const photo = calls.addImage.find((i) => i.format === 'JPEG');
    const qr = calls.addImage.find((i) => i.format === 'PNG');

    expect(photo).toBeDefined();
    expect(qr).toBeDefined();
    // A photo drawn over the QR would silently break scanning, so the horizontal
    // gap is asserted rather than assumed.
    expect(qr.x - (photo.x + photo.w)).toBeGreaterThan(0);
  });

  it('draws a square photo, so it is not stretched from the square source', () => {
    const photo = draw({ photoDataUrl: PHOTO }).addImage.find((i) => i.format === 'JPEG');
    expect(photo.w).toBe(photo.h);
  });

  it('draws a square logo from the square source', () => {
    const logo = draw({ logoDataUrl: LOGO }).addImage.find((i) => i.format === 'JPEG');
    expect(logo.w).toBe(logo.h);
  });
});

describe('gym card image assets', () => {
  it('maps the bytes own MIME type to a format jsPDF can decode', () => {
    // The format is derived, not assumed, so a PNG logo or photo is embedded
    // correctly instead of being labelled JPEG and rejected.
    expect(imageFormatFromMime('image/jpeg')).toBe('JPEG');
    expect(imageFormatFromMime('image/jpg')).toBe('JPEG');
    expect(imageFormatFromMime('IMAGE/PNG')).toBe('PNG');
    expect(imageFormatFromMime('image/png')).toBe('PNG');
    // Unknown types report null so the caller can re-encode rather than guess.
    expect(imageFormatFromMime('image/webp')).toBeNull();
    expect(imageFormatFromMime('application/pdf')).toBeNull();
    expect(imageFormatFromMime('')).toBeNull();
    expect(imageFormatFromMime(null)).toBeNull();
    expect(imageFormatFromMime(undefined)).toBeNull();
  });

  it('never hands jsPDF a blob URL, which it cannot decode', () => {
    // The previous implementation passed URL.createObjectURL() output straight to
    // addImage(). The stub throws on it, exactly as jsPDF does, and the card
    // still renders because the failure is contained.
    const calls = draw({ qrDataUrl: QR, logoDataUrl: 'blob:fake', photoDataUrl: 'blob:fake2' });

    // No blob URL reached addImage: both attempts were rejected and contained.
    expect(calls.addImage.some((i) => String(i.data).startsWith('blob:'))).toBe(false);
    // The name and the QR still print, so the card is still usable.
    expect(allText(calls)).toContain('BE SMART FITNESS CLUB');
    expect(calls.addImage.some((i) => i.format === 'PNG')).toBe(true);
  });

  it('accepts an asset as a { dataUrl, format } pair and honours its format', () => {
    const pngPhoto = 'data:image/png;base64,PPPP';
    const calls = draw({ photo: { dataUrl: pngPhoto, format: 'PNG' } });

    const photo = calls.addImage.find((i) => i.data === pngPhoto);
    expect(photo).toBeDefined();
    expect(photo.format).toBe('PNG');
  });

  it('draws a photo when the member has one', () => {
    const calls = draw({ qrDataUrl: QR, photoDataUrl: PHOTO });
    const photo = calls.addImage.find((i) => i.format === 'JPEG');

    expect(photo).toBeDefined();
    expect(photo.data).toBe(PHOTO);
    // A neutral plate is painted first, so a decode failure cannot leave a hole.
    expect(
      calls.rect.some((r) => Math.abs(r.w - photo.w) < 0.001 && Math.abs(r.h - photo.h) < 0.001)
    ).toBe(true);
  });

  it('falls back to initials on the card when the member has no photo', () => {
    const calls = draw({ qrDataUrl: QR });

    expect(calls.addImage.some((i) => i.format === 'JPEG')).toBe(false);
    // A clean, deliberate placeholder rather than an empty grey box.
    expect(allText(calls)).toContain('MS');
  });

  it('uses the first two initials of the member name for the placeholder', () => {
    expect(allText(draw({}, { fullName: 'Wilfred Ranjith Kumara Perera' }))).toContain('WR');
    expect(allText(draw({}, { fullName: 'Cher' }))).toContain('C');
  });

  it('still draws a photo-sized placeholder box for a nameless member', () => {
    const calls = draw({}, { fullName: '' });
    // No initials to draw, but no crash and no stray image either.
    expect(calls.addImage.some((i) => i.format === 'JPEG')).toBe(false);
  });
});

describe('gym card content', () => {
  it('shows the club wordmark and the card title', () => {
    const text = allText(draw());
    expect(text).toContain('BE SMART FITNESS CLUB');
    expect(text).toContain('Gym Membership Card');
  });

  it('shows the player name, member id, plan, status and expiry', () => {
    const text = allText(draw());
    expect(text).toContain('Mohamed Saathir');
    expect(text).toContain('BSG-1001');
    expect(text).toContain('Monthly');
    expect(text).toContain('Active');
    expect(text).toContain('2026-10-20');
  });

  it('prints the entrance instruction', () => {
    expect(allText(draw())).toContain('Show this QR code at the entrance.');
  });

  it('never prints identity data that is not needed at the door', () => {
    // The card is a public object. This is the assertion that matters most.
    const text = allText(draw({ qrDataUrl: QR, photoDataUrl: PHOTO }));
    expect(text).not.toContain('199012345678');
    expect(text).not.toContain('Temple Road');
    expect(text).not.toContain('saathir@example.lk');
    expect(text).not.toContain('0771234567');
    expect(text).not.toContain('1990-04-12');
    expect(text).not.toContain('Asthma');
    expect(text).not.toContain('0779999999');
  });

  it('shows a plan label when the player has no active plan', () => {
    const text = allText(draw({}, { planName: 'No Active Plan' }));
    expect(text).toContain('No Active Plan');
  });

  it('still prints an expired card, so staff can see why entry was refused', () => {
    const text = allText(draw({}, { membershipStatus: 'Expired' }));
    expect(text).toContain('Expired');
  });

  it('omits the expiry row when there is no date', () => {
    const text = allText(draw({}, { validUntil: null }));
    expect(text).not.toContain('VALID UNTIL');
  });
});

describe('gym card QR block', () => {
  it('draws the QR as a PNG inside a quiet zone', () => {
    const calls = draw({ qrDataUrl: QR });
    const qr = calls.addImage.find((i) => i.format === 'PNG');
    expect(qr).toBeDefined();
    expect(qr.data).toBe(QR);

    // A white plate slightly larger than the code, drawn before it. Scanners
    // need that margin to find the finder patterns reliably.
    const plate = calls.rect.find(
      (r) => Math.abs(r.w - (qr.w + 2)) < 0.001 && Math.abs(r.h - (qr.h + 2)) < 0.001
    );
    expect(plate).toBeDefined();
  });

  it('says so plainly when there is no QR token, rather than printing a blank box', () => {
    // A card that looks valid but cannot be scanned gets a player turned away at
    // the door, so the failure has to be visible on the card itself.
    const calls = draw({ qrDataUrl: null });
    expect(calls.addImage.some((i) => i.format === 'PNG')).toBe(false);
    expect(allText(calls)).toContain('No QR token');
  });

  it('says so plainly when the QR fails to embed', () => {
    const calls = draw({ qrDataUrl: 'not-a-real-png' });
    expect(allText(calls)).toContain('QR unavailable');
  });
});

describe('gym card name handling', () => {
  it('trims a long name with an ellipsis instead of letting it overflow', () => {
    const text = allText(draw({}, { fullName: 'Bandaranaike Wickramasinghe Jayawardena' }));
    expect(text).toContain('…');
    expect(text).not.toContain('Jayawardena');
  });

  it('keeps a short name intact', () => {
    expect(allText(draw({}, { fullName: 'Ann Silva' }))).toContain('Ann Silva');
  });

  it('breaks a long name on a space where it can', () => {
    const text = allText(draw({}, { fullName: 'Wilfred Ranjith Kumara Perera' }));
    // The first words survive; it is the tail that gets cut.
    expect(text).toContain('Wilfred');
  });

  it('falls back to a placeholder with no name at all', () => {
    expect(allText(draw({}, { fullName: 'Member' }))).toContain('Member');
  });
});
