import { describe, it, expect } from 'vitest';
import {
  SRI_LANKA_COUNTRY_CODE,
  buildWhatsAppUrl,
  formatPhone,
  formatSriLankan,
  normalisePhone,
  phoneSearchVariants,
} from './phone';

describe('normalisePhone - Sri Lankan local mobile', () => {
  it('converts the 10-digit local form to the international form', () => {
    const result = normalisePhone('0771234567');
    expect(result.isValid).toBe(true);
    expect(result.waNumber).toBe('94771234567');
    expect(result.isSriLankan).toBe(true);
  });

  it('ignores spaces', () => {
    expect(normalisePhone('077 123 4567').waNumber).toBe('94771234567');
    expect(normalisePhone('077   123   4567').waNumber).toBe('94771234567');
  });

  it('ignores dashes, dots and brackets', () => {
    expect(normalisePhone('077-123-4567').waNumber).toBe('94771234567');
    expect(normalisePhone('077.123.4567').waNumber).toBe('94771234567');
    expect(normalisePhone('(077) 123 4567').waNumber).toBe('94771234567');
  });

  it('accepts the +94 international form unchanged', () => {
    expect(normalisePhone('+94771234567').waNumber).toBe('94771234567');
    expect(normalisePhone('+94 77 123 4567').waNumber).toBe('94771234567');
  });

  it('accepts the 00 international prefix', () => {
    expect(normalisePhone('0094771234567').waNumber).toBe('94771234567');
  });

  it('accepts a national mobile typed without the trunk zero', () => {
    expect(normalisePhone('771234567').waNumber).toBe('94771234567');
  });

  it('accepts every current mobile prefix', () => {
    for (const prefix of ['70', '71', '72', '74', '75', '76', '77', '78']) {
      const result = normalisePhone(`0${prefix}1234567`);
      expect(result.isValid, `prefix 0${prefix} should be valid`).toBe(true);
      expect(result.waNumber).toBe(`94${prefix}1234567`);
    }
  });
});

describe('normalisePhone - rejects unusable numbers', () => {
  it('rejects a landline, because WhatsApp cannot deliver to one', () => {
    const result = normalisePhone('0112345678');
    expect(result.isValid).toBe(false);
    expect(result.isLandline).toBe(true);
    expect(result.waNumber).toBeNull();
    expect(result.reason).toMatch(/landline/i);
  });

  it('rejects a too-short number rather than guessing', () => {
    expect(normalisePhone('077123').isValid).toBe(false);
    expect(normalisePhone('12345').isValid).toBe(false);
  });

  it('rejects empty input', () => {
    expect(normalisePhone('').isValid).toBe(false);
    expect(normalisePhone('   ').isValid).toBe(false);
    expect(normalisePhone(null).isValid).toBe(false);
    expect(normalisePhone(undefined).isValid).toBe(false);
  });

  it('rejects a 94 number whose national part is not a mobile', () => {
    const result = normalisePhone('94112345678');
    expect(result.isValid).toBe(false);
    expect(result.reason).toMatch(/not a Sri Lankan mobile/i);
  });

  it('passes a number from another country through in international form', () => {
    const result = normalisePhone('+14155552671');
    expect(result.isValid).toBe(true);
    expect(result.isSriLankan).toBe(false);
    expect(result.waNumber).toBe('14155552671');
  });
});

describe('formatSriLankan', () => {
  it('formats the international number for display', () => {
    expect(formatSriLankan('94771234567')).toBe('+94 77 123 4567');
    expect(formatSriLankan('94711234567')).toBe('+94 71 123 4567');
  });

  it('degrades gracefully for a non-Sri Lankan number', () => {
    expect(formatSriLankan('14155552671')).toBe('+14155552671');
  });
});

describe('formatPhone', () => {
  it('formats a valid number', () => {
    expect(formatPhone('0771234567')).toBe('+94 77 123 4567');
  });

  it('falls back to what was typed when it cannot be normalised', () => {
    expect(formatPhone('0112345678')).toBe('0112345678');
    expect(formatPhone('')).toBe('N/A');
    expect(formatPhone(null)).toBe('N/A');
  });
});

describe('buildWhatsAppUrl', () => {
  it('builds a wa.me link with the prepared message', () => {
    const url = buildWhatsAppUrl('0771234567', 'Hello there');
    expect(url).toBe('https://wa.me/94771234567?text=Hello%20there');
  });

  it('works from the international form', () => {
    expect(buildWhatsAppUrl('+94771234567', 'Hi')).toBe(
      'https://wa.me/94771234567?text=Hi'
    );
  });

  it('percent-encodes newlines and punctuation so the link is valid', () => {
    const url = buildWhatsAppUrl('0771234567', 'Line one\nLine two & more?');
    expect(url).toContain('%0A');
    expect(url).toContain('%26');
    expect(url).toContain('%3F');
    // A raw newline or ampersand would truncate the query string.
    expect(url).not.toMatch(/[\n\r]/);
  });

  it('omits the text parameter when there is no message', () => {
    expect(buildWhatsAppUrl('0771234567')).toBe('https://wa.me/94771234567');
    expect(buildWhatsAppUrl('0771234567', '   ')).toBe('https://wa.me/94771234567');
  });

  it('returns null rather than a broken link for an unusable number', () => {
    expect(buildWhatsAppUrl('0112345678', 'Hi')).toBeNull();
    expect(buildWhatsAppUrl(null, 'Hi')).toBeNull();
    expect(buildWhatsAppUrl('', 'Hi')).toBeNull();
  });

  it('produces a link wa.me can actually resolve', () => {
    const url = buildWhatsAppUrl('077 123 4567', 'test');
    expect(url.startsWith('https://wa.me/')).toBe(true);
    // The path segment must be digits only: a + or a space here makes wa.me
    // show an error page instead of opening the chat.
    const path = new URL(url).pathname;
    expect(path).toMatch(/^\/\d+$/);
    expect(path.replace('/', '')).toHaveLength(11);
  });
});

describe('country code constant', () => {
  it('is Sri Lanka, not a hardcoded copy in two places', () => {
    expect(SRI_LANKA_COUNTRY_CODE).toBe('94');
  });
});

describe('phoneSearchVariants', () => {
  // Staff type phone numbers three ways: the international form they were given
  // on WhatsApp, the local 07... form, and the bare national number. The search
  // has to find the member in all three cases.

  it('expands the international form to the local and bare forms', () => {
    const variants = phoneSearchVariants('+94 77 123 4567');
    expect(variants).toContain('94771234567');
    expect(variants).toContain('0771234567');
    expect(variants).toContain('771234567');
  });

  it('expands the local form to the international and bare forms', () => {
    const variants = phoneSearchVariants('0771234567');
    expect(variants).toContain('94771234567');
    expect(variants).toContain('0771234567');
    expect(variants).toContain('771234567');
  });

  it('expands a bare mobile number typed without a prefix', () => {
    const variants = phoneSearchVariants('771234567');
    expect(variants).toContain('94771234567');
    expect(variants).toContain('0771234567');
    expect(variants).toContain('771234567');
  });

  it('ignores formatting characters', () => {
    expect(phoneSearchVariants('077-123 4567')).toEqual(phoneSearchVariants('0771234567'));
    expect(phoneSearchVariants('(077) 123.4567')).toEqual(phoneSearchVariants('0771234567'));
  });

  it('still finds the number when other text is typed with it', () => {
    // Reception searches "Kasun 0771234567" as often as a bare number, and the
    // name must not stop the digits from being tried as a number.
    const variants = phoneSearchVariants('Kasun 0771234567');
    expect(variants).toContain('0771234567');
    expect(variants).toContain('94771234567');
    expect(variants).toContain('771234567');
  });

  it('expands two numbers typed in the same box', () => {
    const variants = phoneSearchVariants('0771234567 or 0719876543');
    expect(variants).toContain('94771234567');
    expect(variants).toContain('0719876543');
    expect(variants).toContain('94719876543');
  });

  it('expands any other 10-digit trunk-prefixed number too', () => {
    // Landlines are stored on the same columns. A stored 0112345678 must be
    // findable when staff type it without the trunk 0, and the extra forms
    // cannot match a different person because they are the same digits.
    const variants = phoneSearchVariants('0112345678');
    expect(variants).toContain('0112345678');
    expect(variants).toContain('112345678');
    expect(variants).toContain('94112345678');
  });

  it('returns nothing for a name fragment or a too-short number', () => {
    // The member search also matches names, so a partial digit string that is
    // not a usable number must not widen the query into stray matches.
    expect(phoneSearchVariants('077')).toEqual([]);
    expect(phoneSearchVariants('77123456')).toEqual([]);
    expect(phoneSearchVariants('Kamal')).toEqual([]);
    expect(phoneSearchVariants('')).toEqual([]);
    expect(phoneSearchVariants(null)).toEqual([]);
    expect(phoneSearchVariants('abc')).toEqual([]);
  });
});
