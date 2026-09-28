import { describe, it, expect, beforeEach, vi } from 'vitest';

// A small in-memory stand-in for public.log_attendance().
//
// The real function is PL/pgSQL and enforces one-row-per-member-per-day with a
// transaction-scoped advisory lock plus a unique index. That guarantee cannot be
// reproduced in a JavaScript mock, so what is verified here is the CLIENT
// contract: the service must read already_checked_in off the RPC result, must
// treat a repeat scan as a success rather than an error, and must never write a
// second row for the same member and day. The database-side enforcement is
// covered by the assertions in supabase_migration_phase3_player_profiles.sql
// and the manual verification steps.

const rpc = vi.fn();
const from = vi.fn();
const getMemberByPass = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    from: (...args) => from(...args),
  },
}));

vi.mock('./memberService', () => ({
  memberService: {
    getMemberByPass: (...args) => getMemberByPass(...args),
  },
}));

const { attendanceService } = await import('./attendanceService');

const MEMBER_ID = '3f1c9a20-7b4e-4d1a-9c33-2b8e5f0a1d44';
const CLUB_TODAY = '2026-03-14';

function member(overrides = {}) {
  return {
    id: MEMBER_ID,
    full_name: 'Kasun Kalhara Perera',
    member_code: 'M-0001',
    status: 'Active',
    membership_id: 'a1b2c3d4-0000-4000-8000-000000000001',
    membership_status: 'Active',
    start_date: '2026-03-01',
    expiration_date: '2026-03-31',
    ...overrides,
  };
}

function rpcRow({ alreadyCheckedIn = false, checkInTime = '2026-03-14T01:42:00.000Z' } = {}) {
  return {
    id: 'row-1',
    attendance_date: CLUB_TODAY,
    check_in_time: checkInTime,
    check_out_time: null,
    method: 'QR_SCAN',
    already_checked_in: alreadyCheckedIn,
  };
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  getMemberByPass.mockReset();

  // gym_today() is the authority on the club's day.
  rpc.mockImplementation((fn) => {
    if (fn === 'gym_today') {
      return Promise.resolve({ data: CLUB_TODAY, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe('logCheckIn - first scan of the day', () => {
  it('records a check-in and reports it as new', async () => {
    getMemberByPass.mockResolvedValue(member());
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: [rpcRow()], error: null });
    });

    const result = await attendanceService.logCheckIn('BS-0001');

    expect(result.success).toBe(true);
    expect(result.alreadyCheckedIn).toBe(false);
    expect(result.date).toBe(CLUB_TODAY);
    expect(result.attendance.check_in_time).toBe('2026-03-14T01:42:00.000Z');
  });

  it('sends the member id and method to log_attendance, not a client-computed date', async () => {
    getMemberByPass.mockResolvedValue(member());
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: [rpcRow()], error: null });
    });

    await attendanceService.logCheckIn('BS-0001', 'QR_SCAN');

    const call = rpc.mock.calls.find(([fn]) => fn === 'log_attendance');
    expect(call).toBeDefined();
    // attendance_date is deliberately absent: the database owns the club-local
    // day, because a client-computed key would file a 00:30 check-in under the
    // wrong day at the UTC boundary.
    expect(call[1]).toEqual({ p_member_id: MEMBER_ID, p_method: 'QR_SCAN' });
  });
});

describe('logCheckIn - repeated scan on the same day', () => {
  it('succeeds with alreadyCheckedIn and returns the original timestamp', async () => {
    getMemberByPass.mockResolvedValue(member());
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({
        data: [rpcRow({ alreadyCheckedIn: true, checkInTime: '2026-03-14T01:42:00.000Z' })],
        error: null,
      });
    });

    const result = await attendanceService.logCheckIn('BS-0001');

    // A repeat scan is not an error: the member is in the building.
    expect(result.success).toBe(true);
    expect(result.alreadyCheckedIn).toBe(true);
    // The timestamp of the FIRST check-in, not of the second scan.
    expect(result.attendance.check_in_time).toBe('2026-03-14T01:42:00.000Z');
  });

  it('does not write a second row: only one log_attendance call is made per scan', async () => {
    getMemberByPass.mockResolvedValue(member());
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: [rpcRow({ alreadyCheckedIn: true })], error: null });
    });

    await attendanceService.logCheckIn('BS-0001');

    const logCalls = rpc.mock.calls.filter(([fn]) => fn === 'log_attendance');
    expect(logCalls).toHaveLength(1);
    // No direct INSERT fallback was needed.
    expect(from).not.toHaveBeenCalled();
  });
});

describe('recordCheckIn - concurrent scans', () => {
  it('two scans in flight at once both resolve, and only one is "new"', async () => {
    // Models the database's advisory lock: the first caller to arrive commits,
    // and the second is answered with that same committed row.
    let committed = null;
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      if (!committed) {
        committed = rpcRow();
        return Promise.resolve({
          data: [{ ...committed, already_checked_in: false }],
          error: null,
        });
      }
      return Promise.resolve({ data: [{ ...committed, already_checked_in: true }], error: null });
    });

    const [first, second] = await Promise.all([
      attendanceService.recordCheckIn(MEMBER_ID),
      attendanceService.recordCheckIn(MEMBER_ID),
    ]);

    // Exactly one caller is told this is a first check-in; the other is told it
    // already happened, and both point at the same row.
    expect([first.alreadyCheckedIn, second.alreadyCheckedIn].sort()).toEqual([false, true]);
    expect(first.attendance.id).toBe(second.attendance.id);
    expect(first.attendance.check_in_time).toBe(second.attendance.check_in_time);
  });

  it('falls back to a guarded insert when log_attendance is not installed yet', async () => {
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    // The insert chain: .insert().select().single()
    const single = vi.fn().mockResolvedValue({
      data: { id: 'row-1', attendance_date: CLUB_TODAY, check_in_time: 'x', method: 'QR_SCAN' },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const result = await attendanceService.recordCheckIn(MEMBER_ID);

    expect(result.alreadyCheckedIn).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('reads the existing row back when the daily unique index rejects the insert', async () => {
    // 23505 is the database enforcing one row per member per day on the fallback
    // path. The service must turn it into "already checked in", not an error.
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: null, error: { code: '42883' } });
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'row-existing',
        attendance_date: CLUB_TODAY,
        check_in_time: 'x',
        method: 'QR_SCAN',
      },
      error: null,
    });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const insertSingle = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } });
    // Chain: select().eq().order().limit().maybeSingle()
    const select = vi
      .fn()
      .mockReturnValueOnce({ single: insertSingle })
      .mockReturnValueOnce({ eq });

    // The same builder object backs both queries, as it does in supabase-js.
    from.mockReturnValue({ insert: vi.fn(() => ({ select })), select });

    const result = await attendanceService.recordCheckIn(MEMBER_ID);

    expect(insertSingle).toHaveBeenCalledTimes(1);
    expect(result.alreadyCheckedIn).toBe(true);
    expect(result.attendance.id).toBe('row-existing');
    expect(result.error).toBeNull();
    expect(eq).toHaveBeenCalledWith('member_id', MEMBER_ID);
  });
});

describe('QR admission - membership validity', () => {
  it('allows an Active membership whose dates cover today', async () => {
    getMemberByPass.mockResolvedValue(member());
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: [rpcRow()], error: null });
    });

    const result = await attendanceService.logCheckIn('BS-0001');
    expect(result.success).toBe(true);
  });

  it('allows an Expiring membership that has not lapsed yet', async () => {
    // 'Expiring' means "valid, close to renewal", not "lapsed". The schema's own
    // partial unique index groups it with Active as an open subscription, and
    // sync_expired_memberships() only flips it to Expired once end_date passes.
    getMemberByPass.mockResolvedValue(
      member({ membership_status: 'Expiring', expiration_date: '2026-03-20' })
    );
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: [rpcRow()], error: null });
    });

    const result = await attendanceService.logCheckIn('BS-0001');
    expect(result.success).toBe(true);
    expect(result.alreadyCheckedIn).toBe(false);
  });

  it('allows a membership whose end_date is today, because the date is inclusive', async () => {
    getMemberByPass.mockResolvedValue(
      member({ membership_status: 'Expiring', expiration_date: CLUB_TODAY })
    );
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') return Promise.resolve({ data: CLUB_TODAY, error: null });
      return Promise.resolve({ data: [rpcRow()], error: null });
    });

    const result = await attendanceService.logCheckIn('BS-0001');
    expect(result.success).toBe(true);
  });

  it('refuses an Expired membership and writes no attendance row', async () => {
    getMemberByPass.mockResolvedValue(
      member({ membership_status: 'Expired', expiration_date: '2026-03-13' })
    );

    const result = await attendanceService.logCheckIn('BS-0001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired on 2026-03-13/i);
    // No log_attendance call at all.
    expect(rpc.mock.calls.some(([fn]) => fn === 'log_attendance')).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a stale Active label whose end_date has already passed', async () => {
    // sync_expired_memberships() is a scheduled job, so between runs the label
    // can still say Active after the plan lapsed. The dates are the authority.
    getMemberByPass.mockResolvedValue(
      member({ membership_status: 'Active', expiration_date: '2026-03-01' })
    );

    const result = await attendanceService.logCheckIn('BS-0001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired on 2026-03-01/i);
  });

  it('refuses a membership that has not started yet', async () => {
    getMemberByPass.mockResolvedValue(member({ start_date: '2026-04-01' }));

    const result = await attendanceService.logCheckIn('BS-0001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not start until 2026-04-01/i);
  });

  it('refuses a member with no membership at all', async () => {
    getMemberByPass.mockResolvedValue(member({ membership_id: null, membership_status: null }));

    const result = await attendanceService.logCheckIn('BS-0001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no running membership/i);
  });

  it('refuses a Suspended member even with a perfectly valid membership', async () => {
    getMemberByPass.mockResolvedValue(member({ status: 'Suspended' }));

    const result = await attendanceService.logCheckIn('BS-0001');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/suspended/i);
  });

  it('refuses an unknown QR payload without touching the database', async () => {
    getMemberByPass.mockResolvedValue(null);

    const result = await attendanceService.logCheckIn('BS-NOBODY');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no member matches/i);
    expect(rpc.mock.calls.some(([fn]) => fn === 'log_attendance')).toBe(false);
  });
});

describe('getMonthAttendance - the current-month column on the members list', () => {
  // The list shows a Present/Leave figure for every visible row, and it may be
  // showing 200 of them. One request per member would be unusable, so the ids
  // are batched; and the window is filtered in the database rather than by
  // pulling the month into memory.

  // Chain: select().in().gte().lte().limit()
  function monthQuery({ data = [], error = null } = {}) {
    const limit = vi.fn(() => Promise.resolve({ data, error }));
    const lte = vi.fn(() => ({ limit }));
    const gte = vi.fn(() => ({ lte }));
    const inFilter = vi.fn(() => ({ gte }));
    const select = vi.fn(() => ({ in: inFilter }));
    from.mockReturnValue({ select });
    return { select, in: inFilter, gte, lte, limit };
  }

  function ids(count) {
    return Array.from({ length: count }, (_, i) => `member-${i}`);
  }

  it('asks the database for the window in club days, not a client-side filter', async () => {
    const query = monthQuery({ data: [{ member_id: 'member-0', attendance_date: '2026-03-02' }] });

    const rows = await attendanceService.getMonthAttendance({
      memberIds: ['member-0'],
      monthStart: '2026-03-01',
      monthEnd: CLUB_TODAY,
    });

    expect(query.gte).toHaveBeenCalledWith('attendance_date', '2026-03-01');
    // The window stops at today, so the list can never report absences for days
    // that have not happened.
    expect(query.lte).toHaveBeenCalledWith('attendance_date', CLUB_TODAY);
    expect(rows).toHaveLength(1);
  });

  it('splits the member ids into chunks instead of one request per row', async () => {
    const batchSizes = [];
    from.mockImplementation(() => {
      const limit = vi.fn(() =>
        Promise.resolve({
          data: [{ member_id: 'x', attendance_date: '2026-03-02' }],
          error: null,
        })
      );
      const lte = vi.fn(() => ({ limit }));
      const gte = vi.fn(() => ({ lte }));
      const inFilter = vi.fn((_column, values) => {
        batchSizes.push(values.length);
        return { gte };
      });
      return { select: vi.fn(() => ({ in: inFilter })) };
    });

    const rows = await attendanceService.getMonthAttendance({
      memberIds: ids(250),
      monthStart: '2026-03-01',
      monthEnd: CLUB_TODAY,
    });

    // 250 ids at 100 per request: 3 round trips, never one URL full of UUIDs.
    expect(batchSizes).toEqual([100, 100, 50]);
    // Every chunk's rows come back, in order, for the caller to count.
    expect(rows).toHaveLength(3);
  });

  it('sends each member id once', async () => {
    const query = monthQuery({ data: [] });

    await attendanceService.getMonthAttendance({
      memberIds: ['member-0', 'member-0', 'member-1', null],
      monthStart: '2026-03-01',
      monthEnd: CLUB_TODAY,
    });

    expect(query.in).toHaveBeenCalledWith('member_id', ['member-0', 'member-1']);
  });

  it('makes no request at all when there is nobody to count', async () => {
    await attendanceService.getMonthAttendance({ memberIds: [], monthStart: '2026-03-01' });

    expect(from).not.toHaveBeenCalled();
  });

  it('uses the club today as the end of the window when the caller gives none', async () => {
    const query = monthQuery({ data: [] });

    await attendanceService.getMonthAttendance({ memberIds: ['member-0'], monthStart: '2026-03-01' });

    // gym_today() from the database, so the list and the check-in engine agree on
    // which day it is even on a machine set to another timezone.
    expect(rpc.mock.calls.some(([fn]) => fn === 'gym_today')).toBe(true);
    expect(query.lte).toHaveBeenCalledWith('attendance_date', CLUB_TODAY);
  });

  it('asks for nothing when the window is empty or reversed', async () => {
    await attendanceService.getMonthAttendance({ memberIds: ['member-0'] });
    await attendanceService.getMonthAttendance({
      memberIds: ['member-0'],
      monthStart: '2026-03-01',
      monthEnd: '2026-02-01',
    });

    expect(from).not.toHaveBeenCalled();
  });

  it('falls back to the timestamp column on a database that predates attendance_date', async () => {
    // Phase 2 adds the column. Until that migration is run, PostgREST rejects the
    // select, and the list would otherwise show every member as never having
    // come in. The same window is expressed against the raw instant instead.
    const limit = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST204' } })
      .mockResolvedValueOnce({
        data: [{ member_id: 'member-0', check_in_time: '2026-03-02T05:00:00.000Z' }],
        error: null,
      });
    const lte = vi.fn(() => ({ limit }));
    const gte = vi.fn(() => ({ lte }));
    const inFilter = vi.fn(() => ({ gte }));
    from.mockReturnValue({ select: vi.fn(() => ({ in: inFilter })) });

    const rows = await attendanceService.getMonthAttendance({
      memberIds: ['member-0'],
      monthStart: '2026-03-01',
      monthEnd: CLUB_TODAY,
      timeZone: 'Asia/Colombo',
    });

    // Club-local midnight in UTC: 1 March 00:00 Colombo is 28 Feb 18:30 UTC.
    expect(gte).toHaveBeenCalledWith('check_in_time', '2026-02-28T18:30:00.000Z');
    expect(lte).toHaveBeenCalledWith('check_in_time', '2026-03-14T18:29:59.999Z');
    expect(rows).toHaveLength(1);
    // No attendance_date in the fallback, so the caller re-derives it from the
    // timestamp.
    expect(rows[0].attendance_date).toBeUndefined();
  });

  it('treats a missing column as a fallback, but a real error as an error', async () => {
    monthQuery({ data: null, error: { code: '42501', message: 'permission denied' } });

    await expect(
      attendanceService.getMonthAttendance({
        memberIds: ['member-0'],
        monthStart: '2026-03-01',
        monthEnd: CLUB_TODAY,
      })
    ).rejects.toBeTruthy();
  });
});
