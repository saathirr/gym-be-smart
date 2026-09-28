import { describe, it, expect, beforeEach, vi } from 'vitest';

// The profile's photo contract.
//
// members.avatar_url holds an object PATH inside a private bucket, never a URL.
// Anything that renders it directly would either 404 or, worse, tempt someone
// into making the bucket public so the path "works". These tests pin the
// boundary: the service passes the path through untouched, and the storage
// service is the only thing that turns it into something an <img> can load.

const maybeSingle = vi.fn();

// Dispatched by table name rather than by call order, so the tests do not depend
// on the order in which the service happens to issue its queries.
let membershipsData = [];
let paymentsData = [];

// Captured from the members list query so the search tests can assert on the
// filter that was actually sent to PostgREST.
let listOrFilter = null;
let listFilters = [];
let listResult = { data: [], error: null };

function membersQuery() {
  const query = {
    select: () => query,
    or: (conditions) => {
      listOrFilter = conditions;
      return query;
    },
    eq: (column, value) => {
      listFilters.push(`${column}=${value}`);
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle,
    // PostgrestBuilder is both chainable and awaitable, which is why the
    // service can call .or() after .limit(). Mirrored here so the same chain
    // works in the tests.
    then: (resolve, reject) => Promise.resolve(listResult).then(resolve, reject),
  };
  return query;
}

const from = vi.fn((table) => {
  if (table === 'members') {
    return { select: () => membersQuery() };
  }

  const rows = table === 'memberships' ? membershipsData : paymentsData;
  return {
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
  };
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args) => from(...args),
  },
}));

vi.mock('../lib/supabaseErrors', () => ({
  toMessage: (error, fallback) => fallback || String(error),
}));

const { memberService } = await import('./memberService');
const { storageService, isStoredPhotoPath } = await import('./storageService');

const MEMBER_ID = '3f1c9a20-7b4e-4d1a-9c33-2b8e5f0a1d44';
const PHOTO_PATH = `${MEMBER_ID}/mfk3n2-passport.jpg`;

const MEMBERSHIP_HISTORY = [
  {
    id: 'mem-1',
    start_date: '2026-03-01',
    end_date: '2026-03-31',
    status: 'Active',
    plans: { id: 'plan-1', name: 'Monthly', price: 5000, duration_days: 30 },
  },
];

function memberRow(overrides = {}) {
  return {
    id: MEMBER_ID,
    full_name: 'Kasun Kalhara Perera',
    member_code: 'M-0001',
    status: 'Active',
    avatar_url: PHOTO_PATH,
    memberships: MEMBERSHIP_HISTORY,
    ...overrides,
  };
}

beforeEach(() => {
  maybeSingle.mockReset();
  from.mockClear();
  membershipsData = [];
  paymentsData = [];
  listOrFilter = null;
  listFilters = [];
  listResult = { data: [], error: null };
});

describe('getMemberProfile - member with a photo', () => {
  it('carries the stored object path through untouched', async () => {
    maybeSingle.mockResolvedValue({ data: memberRow(), error: null });

    const profile = await memberService.getMemberProfile(MEMBER_ID);

    expect(profile.avatar_url).toBe(PHOTO_PATH);
    // Still a path, not a URL: nothing has widened it into a public address.
    expect(isStoredPhotoPath(profile.avatar_url)).toBe(true);
    expect(String(profile.avatar_url)).not.toMatch(/^https?:/);
  });

  it('produces a path the storage service can turn into a signed URL', async () => {
    maybeSingle.mockResolvedValue({ data: memberRow(), error: null });

    const profile = await memberService.getMemberProfile(MEMBER_ID);

    // The path is a valid input to the storage layer, which is the only place a
    // short-lived signed URL is minted.
    expect(storageService.isStoredPhotoPath(profile.avatar_url)).toBe(true);
  });
});

describe('getMemberProfile - member without a photo', () => {
  it('reports no photo and still loads the rest of the profile', async () => {
    maybeSingle.mockResolvedValue({ data: memberRow({ avatar_url: null }), error: null });

    const profile = await memberService.getMemberProfile(MEMBER_ID);

    expect(profile.avatar_url).toBeNull();
    // The page renders a placeholder rather than an error state.
    expect(profile.full_name).toBe('Kasun Kalhara Perera');
    expect(profile.member_code).toBe('M-0001');
  });

  it('treats an empty-string photo as no photo', async () => {
    maybeSingle.mockResolvedValue({ data: memberRow({ avatar_url: '' }), error: null });

    const profile = await memberService.getMemberProfile(MEMBER_ID);

    // An empty string would fail the path validator, so the UI falls back to
    // initials; the important part is that it is not treated as a usable path.
    expect(isStoredPhotoPath(profile.avatar_url)).toBe(false);
  });

  it('returns null for a member that does not exist', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    expect(await memberService.getMemberProfile('missing-id')).toBeNull();
  });
});

describe('getMemberProfile - history alongside the photo', () => {
  it('flattens the current membership and keeps the full history separate', async () => {
    maybeSingle.mockResolvedValue({ data: memberRow(), error: null });
    membershipsData = MEMBERSHIP_HISTORY;
    paymentsData = [{ id: 'pay-1', amount: 5000, payment_status: 'Paid' }];

    const profile = await memberService.getMemberProfile(MEMBER_ID);

    // withPlanSummary picks the open subscription for the header and the card.
    expect(profile.membership_status).toBe('Active');
    expect(profile.plan_name).toBe('Monthly');
    expect(profile.expiration_date).toBe('2026-03-31');
    // The history is complete, so a cancelled or renewed plan stays visible.
    expect(profile.membershipHistory).toHaveLength(1);
    expect(profile.paymentHistory).toHaveLength(1);
    // And the photo is unaffected by either query.
    expect(profile.avatar_url).toBe(PHOTO_PATH);
  });
});

describe('getMembers - search', () => {
  // Staff hold three different forms of the same number: the international one
  // from a WhatsApp contact, the local 07... one from a printed card, and the
  // bare national one typed from memory. The member row holds whichever form
  // was entered, so the search has to try all of them or people go missing from
  // the directory.

  function conditionsFor() {
    return (listOrFilter || '').split(',').filter(Boolean);
  }

  it('searches every form of a number typed in the local format', async () => {
    await memberService.getMembers({ search: '0771234567' });

    const conditions = conditionsFor('0771234567');
    expect(conditions).toContain('phone.ilike.%0771234567%');
    expect(conditions).toContain('phone.ilike.%94771234567%');
    expect(conditions).toContain('phone.ilike.%771234567%');
    expect(conditions).toContain('whatsapp_number.ilike.%94771234567%');
    // The name/code columns are still searched, so one box does everything.
    expect(conditions).toContain('full_name.ilike.%0771234567%');
  });

  it('finds a member stored in the international form when the local one is typed', async () => {
    await memberService.getMembers({ search: '077 123 4567' });

    const conditions = conditionsFor('077 123 4567');
    // Spaces in the typed text stay literal in the text term...
    expect(conditions).toContain('full_name.ilike.%077 123 4567%');
    // ...but the phone variants are digits only, so the digits match.
    expect(conditions).toContain('phone.ilike.%94771234567%');
  });

  it('finds a member stored in the local form when the international one is typed', async () => {
    await memberService.getMembers({ search: '+94 77 123 4567' });

    const conditions = conditionsFor('+94 77 123 4567');
    expect(conditions).toContain('phone.ilike.%0771234567%');
    expect(conditions).toContain('whatsapp_number.ilike.%771234567%');
  });

  it('does not add phone variants for a name', async () => {
    await memberService.getMembers({ search: 'Kasun' });

    const conditions = conditionsFor('Kasun');
    expect(conditions).toContain('full_name.ilike.%Kasun%');
    expect(conditions).toContain('member_code.ilike.%Kasun%');
    // A name is not a number, so no stray numeric patterns join the filter.
    expect(conditions).toHaveLength(6);
  });

  it('sends no or() filter at all for an empty search', async () => {
    await memberService.getMembers({ search: '   ' });

    expect(listOrFilter).toBeNull();
  });

  it('keeps PostgREST reserved characters out of the pattern', async () => {
    // or() takes a comma separated list, so a comma typed into the box would
    // otherwise turn into a second bogus column filter.
    await memberService.getMembers({ search: 'Perera, (077) 100%' });

    const conditions = conditionsFor('Perera, (077) 100%');
    conditions.forEach((condition) => {
      const pattern = condition.slice(condition.indexOf('.ilike.'));
      expect(pattern).not.toContain(',');
      expect(pattern).not.toContain('(');
      expect(pattern).not.toContain(')');
      expect(pattern).not.toContain('%100%');
    });
    // Bracketed fragments are not numbers, so they add no phone variants.
    expect(conditions.filter((c) => c.startsWith('phone.'))).toHaveLength(1);
  });

  it('finds a phone number typed together with a name', async () => {
    await memberService.getMembers({ search: 'Kasun 0771234567' });

    const conditions = conditionsFor('Kasun 0771234567');
    expect(conditions).toContain('phone.ilike.%94771234567%');
    expect(conditions).toContain('whatsapp_number.ilike.%0771234567%');
  });

  it('applies the status and branch filters on top of the search', async () => {
    await memberService.getMembers({ search: '0771234567', status: 'Active', branchId: 'branch-2' });

    expect(listFilters).toContain('status=Active');
    expect(listFilters).toContain('branch_id=branch-2');
  });
});
