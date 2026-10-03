// Row validation for the Excel / CSV bulk member import.
//
// Everything here is pure so the rules are unit tested rather than discovered by
// importing real members into the live directory.
//
// The reason this module exists is that the first version of the importer
// substituted a default for anything it did not recognise: an unknown district
// became "Colombo" and an unknown gender became "Male". Both look like correct
// data in the members table and neither raises an error, so a typo in a
// spreadsheet quietly produced a wrong record. The rule now is the opposite:
// blank means blank, a recognised value is normalised to its canonical spelling,
// and anything unrecognised rejects the row with the offending value named.
//
// Header matching stays deliberately forgiving. Spreadsheets arrive from Google
// Sheets exports, re-saved workbooks and hand-typed sheets, so the canonical
// header from the download template is accepted alongside the obvious variants.

import { SRI_LANKAN_DISTRICTS } from './constants';
import { phoneSearchVariants } from './phone';

export const IMPORT_GENDERS = ['Male', 'Female', 'Other'];

// The headers written by the template download, plus the aliases that have
// always been accepted. Order matters only in that the template header is
// checked first.
const COLUMN_ALIASES = {
  fullName: ['Full Name', 'full_name', 'Name', 'name'],
  nicNumber: ['NIC Number', 'nic_number', 'NIC', 'nic'],
  phone: ['Phone', 'phone', 'Mobile', 'mobile'],
  whatsappNumber: ['WhatsApp Number', 'whatsapp_number', 'WhatsApp', 'whatsapp'],
  email: ['Email', 'email', 'Email Address', 'Email address'],
  district: ['District', 'district'],
  address: ['Address', 'address'],
  gender: ['Gender', 'gender'],
  dateOfBirth: ['Date of Birth', 'date_of_birth', 'DOB', 'dob'],
  emergencyContact: ['Emergency Contact', 'emergency_contact'],
  medicalConditions: ['Medical Conditions', 'medical_conditions'],
};

// Lowercased lookup so matching is case-insensitive while the value that comes
// back is always the canonical spelling from the list above.
const DISTRICT_BY_LOWER = new Map(SRI_LANKAN_DISTRICTS.map((d) => [d.toLowerCase(), d]));
const GENDER_BY_LOWER = new Map(IMPORT_GENDERS.map((g) => [g.toLowerCase(), g]));

/**
 * Reads the first alias that holds a non-blank value.
 *
 * A whitespace-only cell is treated as absent so that a stray space does not
 * hide a real value sitting under a different alias, which is what the original
 * `a || b || c` chain did.
 */
function readCell(row, aliases) {
  for (const alias of aliases) {
    const value = row?.[alias];
    if (value === undefined || value === null) continue;
    // The raw value is returned rather than a string. A date-formatted cell
    // arrives from XLSX as a Date, and String(date) is
    // "Fri May 14 1995 00:00:00 GMT+0530 (...)", which no date parser and no
    // Postgres DATE column will accept. Only the blank test stringifies.
    if (String(value).trim() !== '') return value;
  }
  return '';
}

// The text columns all collapse to a trimmed string. Wrapping in String() keeps
// a spreadsheet that stores a number in a text column (a phone number typed as
// 771234567, say) from reaching createMember as a non-string and blowing up on
// .trim().
function readTrimmed(row, aliases) {
  return String(readCell(row, aliases) ?? '').trim();
}

/**
 * Case-insensitive, whitespace-tolerant match against a canonical list.
 *
 * @returns {{ value: string | null, invalid: string | null }}
 *   `value` is the canonical spelling, or null when the input was blank or
 *   unrecognised. `invalid` holds the trimmed offending input when it was
 *   unrecognised, and is null otherwise, so the caller can name it.
 */
function matchCanonical(input, lookup) {
  const value = String(input ?? '').trim();
  if (!value) return { value: null, invalid: null };

  const match = lookup.get(value.toLowerCase());
  if (match) return { value: match, invalid: null };

  return { value: null, invalid: value };
}

/**
 * @returns {{ value: string | null, error: string | null }}
 */
export function normalizeDistrict(input) {
  const { value, invalid } = matchCanonical(input, DISTRICT_BY_LOWER);
  if (invalid) return { value: null, error: `Invalid district: ${invalid}` };
  return { value, error: null };
}

/**
 * @returns {{ value: string | null, error: string | null }}
 */
export function normalizeGender(input) {
  const { value, invalid } = matchCanonical(input, GENDER_BY_LOWER);
  if (invalid) return { value: null, error: `Invalid gender: ${invalid}` };
  return { value, error: null };
}

/**
 * A stable key for "is this the same phone number as that one".
 *
 * Staff hold the same member as "0771234567", "+94 77 123 4567" and
 * "771234567", so a plain string compare would let all three through as three
 * different members. phoneSearchVariants already expands a number into every
 * digit form; the bare nine digit national number is preferred so all three
 * spellings collapse onto one key.
 *
 * Numbers outside the Sri Lankan shapes get their digits compared, which is
 * still stable for identical input.
 */
export function canonicalPhoneKey(input) {
  const variants = phoneSearchVariants(input);
  if (variants.length > 0) {
    return variants.find((v) => v.length === 9) || variants[0];
  }
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * Normalises a date-of-birth cell to YYYY-MM-DD.
 *
 * A real date-formatted cell arrives from XLSX as a Date object rather than a
 * string, and String(date) would otherwise produce "Fri May 14 1995 ..." which
 * Postgres rejects. The local date parts are read back rather than using
 * toISOString(), because a local midnight is a different UTC day in Sri Lanka
 * and toISOString() would shift the birthday by a day.
 *
 * Anything unreadable is rejected here rather than passed down. date_of_birth is
 * a DATE column, so a spreadsheet serial number such as 34335 reaches Postgres
 * as invalid syntax and fails the row with an error that names neither the cell
 * nor the column; failing it in the preview instead puts the offending value in
 * front of the person fixing the file.
 *
 * @returns {{ value: string | null, error: string | null }}
 */
export function normalizeDateOfBirth(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      return { value: null, error: 'Invalid date of birth: unreadable date' };
    }
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const day = String(input.getDate()).padStart(2, '0');
    return { value: `${year}-${month}-${day}`, error: null };
  }

  const value = String(input ?? '').trim();
  if (!value) return { value: null, error: null };

  // Already in the format the column wants.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    return isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
      ? { value, error: null }
      : { value: null, error: `Invalid date of birth: ${value}` };
  }

  // Day first, as written in Sri Lanka. Excel exports to a text date column in
  // this form often enough that rejecting it would be unhelpful.
  const sl = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (sl) {
    const day = Number(sl[1]);
    const month = Number(sl[2]);
    const year = Number(sl[3]);
    if (isRealDate(year, month, day)) {
      return {
        value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        error: null,
      };
    }
  }

  return { value: null, error: `Invalid date of birth: ${value}` };
}

// Guards against a well-shaped but impossible date such as 1995-02-31, which
// Postgres would reject with 22007 just as firmly as it rejects nonsense.
function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
  );
}

/**
 * Turns one raw spreadsheet row into the shape the importer stores.
 *
 * `excelRowNumber` is the row number as the user sees it in Excel, so the first
 * data row is 2 because row 1 holds the headers. That is the number a rejected
 * row has to be reported against, otherwise the person fixing the spreadsheet
 * has to count rows by hand.
 *
 * @returns {object} row with `errors`, `isValid` and `phoneKey` attached
 */
export function normalizeMemberRow(row, excelRowNumber) {
  const fullName = readTrimmed(row, COLUMN_ALIASES.fullName);
  const phone = readTrimmed(row, COLUMN_ALIASES.phone);
  const district = normalizeDistrict(readCell(row, COLUMN_ALIASES.district));
  const gender = normalizeGender(readCell(row, COLUMN_ALIASES.gender));
  const dateOfBirth = normalizeDateOfBirth(readCell(row, COLUMN_ALIASES.dateOfBirth));

  const errors = [];
  if (!fullName) errors.push('Missing Full Name');
  if (!phone) errors.push('Missing Mobile Phone');
  if (district.error) errors.push(district.error);
  if (gender.error) errors.push(gender.error);
  if (dateOfBirth.error) errors.push(dateOfBirth.error);

  return {
    rowId: Math.max(0, excelRowNumber - 2),
    excelRow: excelRowNumber,
    full_name: fullName || null,
    nic_number: readTrimmed(row, COLUMN_ALIASES.nicNumber) || null,
    phone: phone || null,
    whatsapp_number:
      readTrimmed(row, COLUMN_ALIASES.whatsappNumber) || phone || null,
    email: readTrimmed(row, COLUMN_ALIASES.email) || null,
    district: district.value,
    address: readTrimmed(row, COLUMN_ALIASES.address) || null,
    gender: gender.value,
    date_of_birth: dateOfBirth.value,
    emergency_contact: readTrimmed(row, COLUMN_ALIASES.emergencyContact) || null,
    medical_conditions: readTrimmed(row, COLUMN_ALIASES.medicalConditions) || null,
    phoneKey: phone ? canonicalPhoneKey(phone) : '',
    isValid: errors.length === 0,
    isDuplicate: false,
    errors,
  };
}

/**
 * Marks every repeat of a phone number inside the uploaded file.
 *
 * The first occurrence is kept and the later ones are rejected, so importing a
 * sheet with the same number twice still registers the member once.
 */
export function flagInFileDuplicates(rows) {
  const firstSeenAt = new Map();

  return rows.map((row) => {
    if (!row.phoneKey) return row;
    if (!firstSeenAt.has(row.phoneKey)) {
      firstSeenAt.set(row.phoneKey, row.excelRow);
      return row;
    }

    return {
      ...row,
      isValid: false,
      isDuplicate: true,
      errors: [
        ...row.errors,
        `Duplicate phone number, already listed on row ${firstSeenAt.get(row.phoneKey)}`,
      ],
    };
  });
}

/**
 * Marks rows whose phone number is already on file.
 *
 * members.phone carries no unique constraint, so nothing in the database stops
 * a second member being created with a number that is already registered. This
 * is the only thing standing between a re-imported sheet and duplicate
 * members.
 *
 * @param {object[]} rows
 * @param {Set<string>} existingPhoneKeys canonical keys of numbers already registered
 */
export function flagExistingDuplicates(rows, existingPhoneKeys) {
  if (!existingPhoneKeys || existingPhoneKeys.size === 0) return rows;

  return rows.map((row) => {
    if (!row.phoneKey || !existingPhoneKeys.has(row.phoneKey)) return row;

    return {
      ...row,
      isValid: false,
      isDuplicate: true,
      errors: [...row.errors, 'Phone number already belongs to an existing member'],
    };
  });
}

/**
 * Normalises a whole sheet, in the order the checks have to run: field rules
 * first, then the repeats inside the file. Doing duplicates last means the
 * "already listed on row N" message is not pre-empted by a field error on a row
 * that was going to be rejected anyway.
 */
export function buildImportRows(rawRows) {
  const normalized = rawRows.map((row, index) => normalizeMemberRow(row, index + 2));
  return flagInFileDuplicates(normalized);
}

/**
 * The four counts shown above the import preview.
 *
 * Duplicates are reported separately but are also counted as invalid, because a
 * duplicate is never inserted. The UI says so next to the numbers.
 */
export function summarizeImportRows(rows) {
  const total = rows.length;
  const duplicate = rows.filter((row) => row.isDuplicate).length;
  const valid = rows.filter((row) => row.isValid).length;

  return { total, valid, invalid: total - valid, duplicate };
}

/**
 * The rows that will not be imported, each with the reason, for display.
 */
export function rejectedImportRows(rows) {
  return rows
    .filter((row) => !row.isValid)
    .map((row) => ({
      excelRow: row.excelRow,
      name: row.full_name || '(no name)',
      reasons: row.errors,
    }));
}