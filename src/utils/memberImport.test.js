import { describe, it, expect } from 'vitest';

import {
  normalizeDistrict,
  normalizeGender,
  normalizeMemberRow,
  normalizeDateOfBirth,
  canonicalPhoneKey,
  flagInFileDuplicates,
  flagExistingDuplicates,
  buildImportRows,
  summarizeImportRows,
  rejectedImportRows,
} from './memberImport';
import { SRI_LANKAN_DISTRICTS } from './constants';

// The bulk importer used to substitute a default for anything it did not
// recognise: an unknown district became "Colombo" and an unknown gender became
// "Male". Both produced records that look correct in the members table, and
// neither raised anything, so a typo in a spreadsheet silently became a wrong
// member. These tests pin the replacement rule: blank stays blank, a recognised
// value is normalised, and an unrecognised value rejects the row with the
// offending value named.

const NAME = 'Kasun Kalhara Perera';
const PHONE = '0771234567';

// A row that is valid apart from whatever the test overrides, so each case
// states only the field it is about.
function sheetRow(overrides = {}) {
  return {
    'Full Name': NAME,
    Phone: PHONE,
    'NIC Number': '199512345678',
    'WhatsApp Number': PHONE,
    Email: 'kasun@gmail.com',
    District: 'Colombo',
    Address: 'No. 45, Temple Road, Nugegoda',
    Gender: 'Male',
    'Date of Birth': '1995-05-14',
    'Emergency Contact': '0777654321',
    'Medical Conditions': 'None',
    ...overrides,
  };
}

describe('normalizeDistrict', () => {
  it('accepts a district exactly as the canonical list spells it', () => {
    expect(normalizeDistrict('Ampara')).toEqual({ value: 'Ampara', error: null });
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeDistrict(' Ampara ').value).toBe('Ampara');
  });

  it('matches case-insensitively and returns the canonical spelling', () => {
    expect(normalizeDistrict('AMPARA').value).toBe('Ampara');
    expect(normalizeDistrict('ampara').value).toBe('Ampara');
    expect(normalizeDistrict('nUwarA eliYa').value).toBe('Nuwara Eliya');
  });

  it('rejects an unknown district instead of defaulting to Colombo', () => {
    const result = normalizeDistrict('Amparaaa');

    expect(result.value).toBeNull();
    expect(result.error).toBe('Invalid district: Amparaaa');
  });

  it('rejects a district with the word District appended', () => {
    // This is the value the old importer turned into Colombo without a word.
    expect(normalizeDistrict('Ampara District').error).toBe(
      'Invalid district: Ampara District'
    );
  });

  it('leaves a blank district null without complaining', () => {
    expect(normalizeDistrict('')).toEqual({ value: null, error: null });
    expect(normalizeDistrict('   ')).toEqual({ value: null, error: null });
    expect(normalizeDistrict(undefined)).toEqual({ value: null, error: null });
  });

  it('accepts every one of the 25 districts', () => {
    expect(SRI_LANKAN_DISTRICTS).toHaveLength(25);
    SRI_LANKAN_DISTRICTS.forEach((district) => {
      expect(normalizeDistrict(district)).toEqual({ value: district, error: null });
    });
  });
});

describe('normalizeGender', () => {
  it('accepts the three allowed values', () => {
    ['Male', 'Female', 'Other'].forEach((gender) => {
      expect(normalizeGender(gender)).toEqual({ value: gender, error: null });
    });
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeGender(' male ').value).toBe('Male');
  });

  it('matches case-insensitively', () => {
    expect(normalizeGender('FEMALE').value).toBe('Female');
    expect(normalizeGender('other').value).toBe('Other');
  });

  it('rejects an unknown gender instead of defaulting to Male', () => {
    const result = normalizeGender('Malee');

    expect(result.value).toBeNull();
    expect(result.error).toBe('Invalid gender: Malee');
  });

  it('leaves a blank gender null rather than inventing one', () => {
    expect(normalizeGender('')).toEqual({ value: null, error: null });
    expect(normalizeGender('  ')).toEqual({ value: null, error: null });
  });
});

describe('normalizeMemberRow - required fields', () => {
  it('accepts a complete row', () => {
    const row = normalizeMemberRow(sheetRow(), 2);

    expect(row.isValid).toBe(true);
    expect(row.errors).toEqual([]);
    expect(row.full_name).toBe(NAME);
  });

  it('trims the name before the required check', () => {
    const row = normalizeMemberRow(sheetRow({ 'Full Name': '   ' }), 2);

    expect(row.isValid).toBe(false);
    expect(row.errors).toContain('Missing Full Name');
  });

  it('rejects a missing phone', () => {
    const row = normalizeMemberRow(sheetRow({ Phone: '' }), 2);

    expect(row.isValid).toBe(false);
    expect(row.errors).toContain('Missing Mobile Phone');
  });

  it('rejects a missing name', () => {
    const row = normalizeMemberRow(sheetRow({ 'Full Name': '' }), 2);

    expect(row.isValid).toBe(false);
    expect(row.errors).toContain('Missing Full Name');
  });

  it('reports every problem on a row at once', () => {
    const row = normalizeMemberRow({ 'Full Name': '', District: 'Nowhere' }, 2);

    expect(row.errors).toEqual(
      expect.arrayContaining(['Missing Full Name', 'Missing Mobile Phone', 'Invalid district: Nowhere'])
    );
  });
});

describe('normalizeMemberRow - district and gender carried through', () => {
  it('stores the normalised district rather than a default', () => {
    expect(normalizeMemberRow(sheetRow({ District: ' gampaha ' }), 2).district).toBe('Gampaha');
  });

  it('leaves district null when the column is blank', () => {
    // District is optional, so a blank stays absent instead of becoming Colombo.
    const row = normalizeMemberRow(sheetRow({ District: '' }), 2);

    expect(row.district).toBeNull();
    expect(row.isValid).toBe(true);
  });

  it('leaves gender null when the column is blank', () => {
    const row = normalizeMemberRow(sheetRow({ Gender: '' }), 2);

    expect(row.gender).toBeNull();
    expect(row.isValid).toBe(true);
  });

  it('rejects the row and names the offending district', () => {
    const row = normalizeMemberRow(sheetRow({ District: 'Amparaaa' }), 2);

    expect(row.isValid).toBe(false);
    expect(row.district).toBeNull();
    expect(row.errors).toContain('Invalid district: Amparaaa');
  });

  it('rejects the row and names the offending gender', () => {
    const row = normalizeMemberRow(sheetRow({ Gender: 'Malee' }), 2);

    expect(row.isValid).toBe(false);
    expect(row.gender).toBeNull();
    expect(row.errors).toContain('Invalid gender: Malee');
  });
});

describe('normalizeMemberRow - header flexibility', () => {
  it('still accepts the alternative header spellings', () => {
    const row = normalizeMemberRow(
      {
        Name: NAME,
        Mobile: PHONE,
        nic_number: '199512345678',
        gender: 'female',
        district: 'kandy',
      },
      2
    );

    expect(row.isValid).toBe(true);
    expect(row.full_name).toBe(NAME);
    expect(row.gender).toBe('Female');
    expect(row.district).toBe('Kandy');
  });

  it('falls through a whitespace-only alias to the one that holds a value', () => {
    const row = normalizeMemberRow({ 'Full Name': '   ', Name: NAME, Phone: PHONE }, 2);

    expect(row.full_name).toBe(NAME);
  });

  it('defaults the WhatsApp number to the phone number', () => {
    const row = normalizeMemberRow(sheetRow({ 'WhatsApp Number': '' }), 2);

    expect(row.whatsapp_number).toBe(PHONE);
  });
});

describe('normalizeMemberRow - excel row numbers', () => {
  it('reports the row number the user sees, counting the header as row 1', () => {
    expect(normalizeMemberRow(sheetRow(), 2).excelRow).toBe(2);
  });

  it('numbers the rows of a sheet from the second row down', () => {
    const rows = buildImportRows([
      sheetRow(),
      sheetRow({ Phone: '0719876543' }),
      sheetRow({ Phone: '0755550000' }),
    ]);

    expect(rows.map((row) => row.excelRow)).toEqual([2, 3, 4]);
  });
});

describe('canonicalPhoneKey', () => {
  it('collapses the three ways of writing one number onto one key', () => {
    const local = canonicalPhoneKey('0771234567');
    const international = canonicalPhoneKey('+94 77 123 4567');
    const national = canonicalPhoneKey('771234567');

    expect(local).toBe(international);
    expect(local).toBe(national);
  });

  it('keeps different numbers apart', () => {
    expect(canonicalPhoneKey('0771234567')).not.toBe(canonicalPhoneKey('0777654321'));
  });
});

describe('flagInFileDuplicates', () => {
  it('keeps the first occurrence and rejects the repeat', () => {
    const rows = flagInFileDuplicates(
      buildImportRows([
        sheetRow({ Phone: '0771234567' }),
        sheetRow({ 'Full Name': 'Same Person Again', Phone: '0771234567' }),
      ])
    );

    expect(rows[0].isValid).toBe(true);
    expect(rows[1].isValid).toBe(false);
    expect(rows[1].isDuplicate).toBe(true);
    expect(rows[1].errors).toContain('Duplicate phone number, already listed on row 2');
  });

  it('catches a duplicate written in a different format', () => {
    const rows = flagInFileDuplicates(
      buildImportRows([
        sheetRow({ Phone: '0771234567' }),
        sheetRow({ 'Full Name': 'Same Person Again', Phone: '+94 77 123 4567' }),
      ])
    );

    expect(rows[1].isValid).toBe(false);
    expect(rows[1].isDuplicate).toBe(true);
  });

  it('leaves distinct numbers alone', () => {
    const rows = flagInFileDuplicates(
      buildImportRows([sheetRow({ Phone: '0771234567' }), sheetRow({ Phone: '0719876543' })])
    );

    expect(rows.every((row) => row.isValid)).toBe(true);
    expect(rows.some((row) => row.isDuplicate)).toBe(false);
  });
});

describe('flagExistingDuplicates', () => {
  it('rejects a row whose number is already registered', () => {
    // members.phone carries no unique constraint, so without this check a
    // re-imported sheet creates a second member for the same person.
    const rows = buildImportRows([sheetRow()]);
    const flagged = flagExistingDuplicates(rows, new Set([canonicalPhoneKey(PHONE)]));

    expect(flagged[0].isValid).toBe(false);
    expect(flagged[0].isDuplicate).toBe(true);
    expect(flagged[0].errors).toContain(
      'Phone number already belongs to an existing member'
    );
  });

  it('rejects a row matching an existing number in a different format', () => {
    const rows = buildImportRows([sheetRow({ Phone: '+94 77 123 4567' })]);
    const flagged = flagExistingDuplicates(rows, new Set([canonicalPhoneKey('0771234567')]));

    expect(flagged[0].isValid).toBe(false);
  });

  it('lets a genuinely new number through', () => {
    const rows = buildImportRows([sheetRow({ Phone: '0719876543' })]);
    const flagged = flagExistingDuplicates(rows, new Set([canonicalPhoneKey('0779999999')]));

    expect(flagged[0].isValid).toBe(true);
  });

  it('handles an empty set of existing numbers', () => {
    const rows = buildImportRows([sheetRow()]);

    expect(flagExistingDuplicates(rows, new Set())).toEqual(rows);
  });
});

describe('summarizeImportRows', () => {
  it('reports total, valid, invalid and duplicate counts', () => {
    const rows = flagExistingDuplicates(
      buildImportRows([
        sheetRow({ Phone: '0771111111' }),
        sheetRow({ Phone: '0772222222', District: 'Nowhere' }),
        sheetRow({ Phone: '0773333333', Gender: 'Malee' }),
        sheetRow({ Phone: '0771111111' }),
      ]),
      new Set([canonicalPhoneKey('0719999999')])
    );

    expect(summarizeImportRows(rows)).toEqual({
      total: 4,
      valid: 1,
      invalid: 3,
      duplicate: 1,
    });
  });

  it('counts duplicates within the invalid total rather than beside it', () => {
    const rows = buildImportRows([sheetRow(), sheetRow({ Phone: '0771234567' })]);
    const counts = summarizeImportRows(rows);

    // A duplicate is never inserted, so it must not appear to be valid.
    expect(counts.invalid).toBe(1);
    expect(counts.duplicate).toBe(1);
  });

  it('handles an empty sheet', () => {
    expect(summarizeImportRows([])).toEqual({
      total: 0,
      valid: 0,
      invalid: 0,
      duplicate: 0,
    });
  });
});

describe('rejectedImportRows', () => {
  it('lists each rejected row with its spreadsheet row number and reason', () => {
    const rows = buildImportRows([
      sheetRow({ Phone: '0771111111' }),
      sheetRow({ 'Full Name': 'Bad District', Phone: '0772222222', District: 'Amparaaa' }),
    ]);

    expect(rejectedImportRows(rows)).toEqual([
      {
        excelRow: 3,
        name: 'Bad District',
        reasons: ['Invalid district: Amparaaa'],
      },
    ]);
  });

  it('names an unnamed row rather than showing a blank', () => {
    const rows = buildImportRows([{ Phone: PHONE }]);

    expect(rejectedImportRows(rows)[0].name).toBe('(no name)');
  });
});

describe('normalizeDateOfBirth', () => {
  it('keeps an already formatted string', () => {
    expect(normalizeDateOfBirth('1995-05-14')).toBe('1995-05-14');
  });

  it('converts a real date cell to YYYY-MM-DD', () => {
    // A date-formatted cell arrives as a Date, and String(date) would otherwise
    // become "Fri May 14 1995 ...", which Postgres rejects.
    expect(normalizeDateOfBirth(new Date(1995, 4, 14))).toBe('1995-05-14');
  });

  it('reads local date parts so the day does not shift by timezone', () => {
    // Sri Lanka is UTC+5:30, so a local midnight is the previous day in UTC and
    // toISOString() would report the wrong birthday.
    expect(normalizeDateOfBirth(new Date(1995, 0, 1))).toBe('1995-01-01');
  });

  it('treats a blank value as no date of birth', () => {
    expect(normalizeDateOfBirth('')).toBeNull();
    expect(normalizeDateOfBirth(undefined)).toBeNull();
    expect(normalizeDateOfBirth(new Date('nonsense'))).toBeNull();
  });
});

describe('buildImportRows', () => {
  it('never invents a district or gender for a row it could not read', () => {
    // The original regression in one assertion: neither field silently became
    // Colombo or Male.
    const rows = buildImportRows([
      sheetRow({ Phone: '0771111111', District: 'Ampara District', Gender: 'unknown' }),
      sheetRow({ Phone: '0772222222', District: '', Gender: '' }),
    ]);

    expect(rows[0]).toMatchObject({ district: null, gender: null, isValid: false });
    expect(rows[0].errors).toEqual(
      expect.arrayContaining(['Invalid district: Ampara District', 'Invalid gender: unknown'])
    );
    expect(rows[1]).toMatchObject({ district: null, gender: null, isValid: true });
  });
});