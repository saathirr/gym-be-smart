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
    if (String(value).trim() !== '') return String(value);
  }
  return '';
}

function readTrimmed(row, aliases) {
  return readCell(row, aliases).trim();
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
 */
export function normalizeDateOfBirth(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const day = String(input.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const value = String(input ?? '').trim();
  return value || null;
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

  const errors = [];
  if (!fullName) errors.push('Missing Full Name');
  if (!phone) errors.push('Missing Mobile Phone');
  if (district.error) errors.push(district.error);
  if (gender.error) errors.push(gender.error);

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
    date_of_birth: normalizeDateOfBirth(readCell(row, COLUMN_ALIASES.dateOfBirth)),
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