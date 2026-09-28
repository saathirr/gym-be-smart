import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toDateKey } from '../utils/attendanceMath';

const rpc = vi.fn();
const from = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    from: (...args) => from(...args),
  },
}));

const { dashboardService } = await import('./dashboardService');

const CLUB_TODAY = '2026-03-14';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();

  rpc.mockImplementation((fn) => {
    if (fn === 'gym_today') {
      return Promise.resolve({ data: CLUB_TODAY, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe('dashboardService - Timezone & Attendance Date Consistency', () => {
  it('uses attendance_date and club-local today for Today Attendance KPI', async () => {
    let queriedColumn = null;
    let queriedValue = null;

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn((cols, opts) => {
            if (opts?.count === 'exact') {
              return {
                eq: vi.fn((col, val) => {
                  queriedColumn = col;
                  queriedValue = val;
                  return Promise.resolve({ count: 12, error: null });
                }),
              };
            }
            return {
              gte: vi.fn(() => ({
                lte: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
              order: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          in: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockReturnValue({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
                then: (cb) => Promise.resolve({ count: 0, error: null }).then(cb),
              }),
            })),
          })),
        })),
      };
    });

    const summary = await dashboardService.getDashboardSummary();

    expect(summary.todayAttendanceCount).toBe(12);
    expect(queriedColumn).toBe('attendance_date');
    expect(queriedValue).toBe(CLUB_TODAY);
  });

  it('buckets weekly chart by attendance_date, independent of browser timezone', async () => {
    const weeklyData = [
      { attendance_date: '2026-03-14', check_in_time: '2026-03-13T19:00:00.000Z' },
      { attendance_date: '2026-03-14', check_in_time: '2026-03-14T02:00:00.000Z' },
      { attendance_date: '2026-03-13', check_in_time: '2026-03-13T08:00:00.000Z' },
    ];

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn((cols, opts) => {
            if (opts?.count === 'exact') {
              return {
                eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
              };
            }
            return {
              gte: vi.fn(() => ({
                lte: vi.fn().mockResolvedValue({ data: weeklyData, error: null }),
              })),
              order: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
          in: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockReturnValue({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
                then: (cb) => Promise.resolve({ count: 0, error: null }).then(cb),
              }),
            })),
          })),
        })),
      };
    });

    const summary = await dashboardService.getDashboardSummary();
    const march14Bucket = summary.weeklyAttendance.find((item) => item.day === 'Sat 14');
    const march13Bucket = summary.weeklyAttendance.find((item) => item.day === 'Fri 13');

    expect(march14Bucket?.count).toBe(2);
    expect(march13Bucket?.count).toBe(1);
  });

  it('calculates peak hours converting check_in_time to club timezone', async () => {
    const checkIns = [
      { check_in_time: '2026-03-14T13:00:00.000Z' },
      { check_in_time: '2026-03-13T19:30:00.000Z' },
    ];

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockResolvedValue({ data: checkIns, error: null }),
            })),
          })),
        };
      }
      return { select: vi.fn() };
    });

    const peakHours = await dashboardService.getPeakHours(7, { timeZone: 'Asia/Colombo' });

    const hour18 = peakHours.find((h) => h.hour === '18:00');
    const hour01 = peakHours.find((h) => h.hour === '01:00');
    const hour13 = peakHours.find((h) => h.hour === '13:00');

    expect(hour18?.count).toBe(1);
    expect(hour01?.count).toBe(1);
    expect(hour13?.count).toBe(0);
  });

  it('ensures same attendance record resolves to consistent date across dashboard and attendance service', async () => {
    const record = {
      id: 'rec-100',
      attendance_date: '2026-03-14',
      check_in_time: '2026-03-13T19:00:00.000Z',
    };

    const attendanceServiceDateKey = toDateKey(
      record.attendance_date ?? record.check_in_time,
      'Asia/Colombo'
    );

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn((cols, opts) => {
            if (opts?.count === 'exact') {
              return { eq: vi.fn().mockResolvedValue({ count: 1, error: null }) };
            }
            return {
              gte: vi.fn(() => ({
                lte: vi.fn().mockResolvedValue({ data: [record], error: null }),
              })),
              order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ gte: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          in: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockReturnValue({
                order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
                then: (cb) => Promise.resolve({ count: 0, error: null }).then(cb),
              }),
            })),
          })),
        })),
      };
    });

    const summary = await dashboardService.getDashboardSummary();
    const march14Bucket = summary.weeklyAttendance.find((item) => item.day.endsWith('14'));

    expect(attendanceServiceDateKey).toBe('2026-03-14');
    expect(march14Bucket?.count).toBe(1);
  });

  it('handles month and year boundaries correctly in weekly chart', async () => {
    rpc.mockImplementation((fn) => {
      if (fn === 'gym_today') {
        return Promise.resolve({ data: '2027-01-02', error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn((cols, opts) => {
            if (opts?.count === 'exact') {
              return { eq: vi.fn().mockResolvedValue({ count: 0, error: null }) };
            }
            return {
              gte: vi.fn(() => ({
                lte: vi.fn().mockResolvedValue({
                  data: [
                    { attendance_date: '2026-12-31', check_in_time: '2026-12-31T10:00:00.000Z' },
                    { attendance_date: '2027-01-01', check_in_time: '2027-01-01T10:00:00.000Z' },
                  ],
                  error: null,
                }),
              })),
              order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ gte: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          in: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockReturnValue({
                order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
                then: (cb) => Promise.resolve({ count: 0, error: null }).then(cb),
              }),
            })),
          })),
        })),
      };
    });

    const summary = await dashboardService.getDashboardSummary();
    const labels = summary.weeklyAttendance.map((item) => item.day);

    expect(labels).toEqual([
      'Sun 27',
      'Mon 28',
      'Tue 29',
      'Wed 30',
      'Thu 31',
      'Fri 01',
      'Sat 02',
    ]);
    expect(summary.weeklyAttendance.find((i) => i.day === 'Thu 31')?.count).toBe(1);
    expect(summary.weeklyAttendance.find((i) => i.day === 'Fri 01')?.count).toBe(1);
  });

  it('handles UTC timestamps crossing Colombo midnight correctly', async () => {
    const rows = [
      { attendance_date: '2026-03-14', check_in_time: '2026-03-13T18:30:00.000Z' },
      { attendance_date: '2026-03-13', check_in_time: '2026-03-13T18:29:59.000Z' },
    ];

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn((cols, opts) => {
            if (opts?.count === 'exact') {
              return { eq: vi.fn().mockResolvedValue({ count: 1, error: null }) };
            }
            return {
              gte: vi.fn(() => ({
                lte: vi.fn().mockResolvedValue({ data: rows, error: null }),
              })),
              order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ gte: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          in: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockReturnValue({
                order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
                then: (cb) => Promise.resolve({ count: 0, error: null }).then(cb),
              }),
            })),
          })),
        })),
      };
    });

    const summary = await dashboardService.getDashboardSummary();
    const mar14 = summary.weeklyAttendance.find((i) => i.day === 'Sat 14');
    const mar13 = summary.weeklyAttendance.find((i) => i.day === 'Fri 13');

    expect(mar14?.count).toBe(1);
    expect(mar13?.count).toBe(1);
  });

  it('supports pre-Phase-3 databases without attendance_date column', async () => {
    let fallbackGte = null;
    let fallbackLte = null;

    from.mockImplementation((table) => {
      if (table === 'attendance') {
        return {
          select: vi.fn((cols, opts) => {
            if (opts?.count === 'exact') {
              return {
                eq: vi.fn().mockResolvedValue({ count: null, error: { code: '42703' } }),
                gte: vi.fn((col, val) => {
                  fallbackGte = val;
                  return {
                    lte: vi.fn((col2, val2) => {
                      fallbackLte = val2;
                      return Promise.resolve({ count: 7, error: null });
                    }),
                  };
                }),
              };
            }
            return {
              gte: vi.fn((col) => ({
                lte: vi.fn(() => {
                  if (col === 'attendance_date') {
                    return Promise.resolve({ data: null, error: { code: '42703' } });
                  }
                  return Promise.resolve({ data: [], error: null });
                }),
              })),
              order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
            };
          }),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ gte: vi.fn().mockResolvedValue({ data: [], error: null }) })),
          in: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn().mockReturnValue({
                order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
                then: (cb) => Promise.resolve({ count: 0, error: null }).then(cb),
              }),
            })),
          })),
        })),
      };
    });

    const summary = await dashboardService.getDashboardSummary();

    expect(summary.todayAttendanceCount).toBe(7);
    expect(fallbackGte).toBe('2026-03-13T18:30:00.000Z');
    expect(fallbackLte).toBe('2026-03-14T18:29:59.999Z');
  });
});
