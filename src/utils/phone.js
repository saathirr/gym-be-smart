// Sri Lankan phone handling for the WhatsApp share workflow.
//
// Sri Lanka moved to a single 9-digit mobile number without the trunk prefix,
// so a local mobile looks like 077 123 4567 (10 digits, leading 0) and the
// international form is +94 77 123 4567. WhatsApp's wa.me endpoint only accepts
// the international form with no +, spaces or dashes, so anything typed by
// reception has to be normalised before it goes in a URL.
//
// Pure and dependency-free so the formatting rules are unit tested rather than
// eyeballed on a phone.

export const SRI_LANKA_COUNTRY_CODE = '94';
export const SRI_LANKA_TRUNK_PREFIX = '0';

// Mobile prefixes in use since the 2017 re-numbering, plus the older ranges
// that are still printed on membership cards. 070/071/072/074/075/076/077/078.
const SRI_LANKAN_MOBILE_PREFIXES = ['70', '71', '72', '74', '75', '76', '77', '78'];

// Strips formatting a human would type: spaces, dashes, dots, brackets, and a
// leading + or 00 international marker.
function toRawDigits(input) {
  if (input === null || input === undefined) return '';

  const raw = String(input).trim();
  if (!raw) return '';

  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';

  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);

  return digits;
}

// Sri Lankan landline area codes. These cannot be used for WhatsApp personal
// accounts, so they are detected separately to give a clear message rather
// than a silently wrong wa.me link.
const SRI_LANKAN_LANDLINE_PREFIXES = [
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '32', '33', '34', '35', '36', '37', '38', '39',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '59',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
];

/**
 * Normalises a phone number for WhatsApp.
 *
 * @returns {{
 *   raw: string,
 *   digits: string,
 *   waNumber: string | null,
 *   isValid: boolean,
 *   isSriLankan: boolean,
 *   isLandline: boolean,
 *   formatted: string,
 *   reason: string | null
 * }}
 */
export function normalisePhone(input) {
  const digits = toRawDigits(input);
  const blank = {
    raw: input ?? '',
    digits,
    waNumber: null,
    isValid: false,
    isSriLankan: false,
    isLandline: false,
    formatted: '',
    reason: null,
  };

  if (!digits) {
    return { ...blank, reason: 'No phone number was provided.' };
  }

  // Already fully international: 94 followed by 9 digits.
  if (digits.startsWith(SRI_LANKA_COUNTRY_CODE) && digits.length === 11) {
    const national = digits.slice(2);
    if (!SRI_LANKAN_MOBILE_PREFIXES.includes(national.slice(0, 2))) {
      return {
        ...blank,
        digits,
        isSriLankan: true,
        reason: `${SRI_LANKA_COUNTRY_CODE}${national} is not a Sri Lankan mobile number.`,
      };
    }
    return {
      raw: input,
      digits,
      waNumber: digits,
      isValid: true,
      isSriLankan: true,
      isLandline: false,
      formatted: formatSriLankan(digits),
      reason: null,
    };
  }

  // Local 10-digit number starting with the trunk 0. The second and third
  // digits decide whether it is a mobile or a landline area code, and only a
  // mobile can receive WhatsApp messages.
  if (digits.length === 10 && digits.startsWith(SRI_LANKA_TRUNK_PREFIX)) {
    const national = digits.slice(1);
    const area = national.slice(0, 2);

    if (!SRI_LANKAN_MOBILE_PREFIXES.includes(area)) {
      return {
        ...blank,
        digits,
        isSriLankan: true,
        isLandline: SRI_LANKAN_LANDLINE_PREFIXES.includes(area),
        reason: SRI_LANKAN_LANDLINE_PREFIXES.includes(area)
          ? 'Landline numbers cannot receive WhatsApp messages.'
          : `${digits} is not a Sri Lankan mobile number.`,
      };
    }

    const waNumber = `${SRI_LANKA_COUNTRY_CODE}${national}`;
    return {
      raw: input,
      digits,
      waNumber,
      isValid: true,
      isSriLankan: true,
      isLandline: false,
      formatted: formatSriLankan(waNumber),
      reason: null,
    };
  }

  // A bare 9-digit national mobile, typed without the trunk 0.
  if (digits.length === 9 && SRI_LANKAN_MOBILE_PREFIXES.includes(digits.slice(0, 2))) {
    const waNumber = `${SRI_LANKA_COUNTRY_CODE}${digits}`;
    return {
      raw: input,
      digits,
      waNumber,
      isValid: true,
      isSriLankan: true,
      isLandline: false,
      formatted: formatSriLankan(waNumber),
      reason: null,
    };
  }

  // A number from another country, already in international form.
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith(SRI_LANKA_TRUNK_PREFIX)) {
    return {
      raw: input,
      digits,
      waNumber: digits,
      isValid: true,
      isSriLankan: false,
      isLandline: false,
      formatted: `+${digits}`,
      reason: null,
    };
  }

  return {
    ...blank,
    digits,
    reason: 'That does not look like a complete phone number.',
  };
}

// 94771234567 -> '+94 77 123 4567'
export function formatSriLankan(waNumber) {
  const digits = String(waNumber || '').replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith(SRI_LANKA_COUNTRY_CODE)) {
    return `+${digits}`;
  }

  const national = digits.slice(2);
  return `+94 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

// The number as the member would like to read it, falling back to the raw
// input when it is not a number we can format.
export function formatPhone(input) {
  const result = normalisePhone(input);
  if (result.isValid) return result.formatted;
  const raw = String(input ?? '').trim();
  return raw || 'N/A';
}

/**
 * The digit forms a stored number could have, for the members search box.
 *
 * A member is registered with whatever the receptionist typed - "0771234567",
 * "077 123 4567", "+94 77 123 4567" - because the raw value is what is stored.
 * Searching with the other form of the same number has to still find them, and a
 * plain ILIKE on the column cannot do that: "077 123 4567" is not a substring
 * of "0771234567".
 *
 * Only digits are returned. The variants end up inside a PostgREST `or` filter,
 * where punctuation would need escaping, and a bare digit string is always safe
 * there.
 *
 * Returns an empty array for anything that is not a complete number, so a name
 * or a member code is never turned into a phone filter. A number typed alongside
 * other text, as in "Kasun 0771234567", is still expanded.
 *
 * @param {string} input
 * @returns {string[]}
 */
export function phoneSearchVariants(input) {
  if (input === null || input === undefined) return [];

  const raw = String(input).trim();
  if (!raw) return [];

  // A number typed next to other text still has to be found, because the search
  // box takes "Kasun 0771234567" as readily as a bare number. So each run of
  // digits that is long enough to be a number is expanded, and a name typed
  // alongside it does not spoil the number the way concatenating every digit in
  // the box would ("0771234567" + "077" = a 13 digit non-number).
  const runs = raw.match(/\d{9,}/g) || [];

  // A number written with separators only, such as "077 123 4567" or
  // "(077) 123.4567", is split into runs that are all too short. Joining its
  // digits back together is safe because the box holds nothing but the number.
  if (runs.length === 0 && /^[\d\s+().-]+$/.test(raw)) {
    const whole = toRawDigits(raw);
    return whole ? expandOneNumber(whole) : [];
  }

  const variants = [];
  for (const run of runs) {
    for (const variant of expandOneNumber(toRawDigits(run))) {
      if (!variants.includes(variant)) variants.push(variant);
    }
  }
  return variants;
}

function expandOneNumber(rawDigits) {
  const digits = toRawDigits(rawDigits);
  if (!digits) return [];

  const variants = new Set([digits]);

  // 94 7X XXXXXXX -> also 07XXXXXXXXX and the bare national number.
  if (digits.length === 11 && digits.startsWith(SRI_LANKA_COUNTRY_CODE)) {
    const national = digits.slice(2);
    variants.add(`${SRI_LANKA_TRUNK_PREFIX}${national}`);
    variants.add(national);
  } else if (digits.length === 10 && digits.startsWith(SRI_LANKA_TRUNK_PREFIX)) {
    // 07XXXXXXXXX -> also 947XXXXXXXX and 7XXXXXXXXX.
    const national = digits.slice(1);
    variants.add(`${SRI_LANKA_COUNTRY_CODE}${national}`);
    variants.add(national);
  } else if (digits.length === 9 && SRI_LANKAN_MOBILE_PREFIXES.includes(digits.slice(0, 2))) {
    // 77XXXXXXX, typed without the trunk prefix.
    variants.add(`${SRI_LANKA_TRUNK_PREFIX}${digits}`);
    variants.add(`${SRI_LANKA_COUNTRY_CODE}${digits}`);
  } else {
    return [];
  }

  return [...variants];
}

/**
 * Builds a wa.me deep link.
 *
 * @param {string} phone      the member's WhatsApp number
 * @param {string} message    prepared message body
 * @returns {string | null}   null when the number cannot be used for WhatsApp
 */
export function buildWhatsAppUrl(phone, message = '') {
  const result = normalisePhone(phone);
  if (!result.isValid) return null;

  const text = String(message ?? '').trim();
  const base = `https://wa.me/${result.waNumber}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
