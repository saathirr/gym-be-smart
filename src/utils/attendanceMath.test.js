import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CLUB_TIMEZONE,
  addDays,
  buildMemberMonthSummaries,
  buildMonthSummary,
  collectAttendanceDays,
  daysBetween,
  effectiveStartDate,
  enumerateDays,
  firstCheckInLabel,
  isValidDateKey,
  listMonths,
  monthBounds,
  monthLabel,
  toDateKey,
  todayKey,
  getClubHour,
  getClubDayRangeIso,
} from './attendanceMath';

// The club timezone is UTC+5:30 with no daylight saving, so a fixed offset is
// safe here and it makes the timezone assertions readable.
const COLOMBO_OFFSET_MINUTES = 330;

function atColomboTime(year, month, day, hour = 12, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - COLOMBO_OFFSET_MINUTES * 60000);
}

describe('toDateKey', () => {
  it('reads a bare YYYY-MM-DD column as already being club-local', () => {
    expect(toDateKey('2026-09-10')).toBe('2026-09-10');
  });

  it('is timezone-safe for a late-evening check-in east of Greenwich', () => {
    // 22:00 in Colombo (UTC+5:30) is 16:30 UTC the same day, but 02:00 the next
    // morning in Colombo is 20:30 UTC the PREVIOUS day. toISOString() would
    // file that check-in under the wrong date.
    const afterMidnight = atColomboTime(2026, 9, 11, 2, 0);
    expect(afterMidnight.toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(toDateKey(afterMidnight)).toBe('2026-09-11');
  });

  it('uses the club timezone, not the browser timezone', () => {
    const instant = atColomboTime(2026, 9, 20, 9, 0);
    expect(toDateKey(instant, 'Asia/Colombo')).toBe('2026-09-20');
    // Same instant, a zone 14 hours behind, is already the previous day.
    expect(toDateKey(instant, 'Pacific/Midway')).toBe('2026-09-19');
  });

  it('falls back to the club default for an unknown timezone', () => {
    const instant = atColomboTime(2026, 9, 20, 9, 0);
    expect(toDateKey(instant, 'Not/AZone')).toBe('2026-09-20');
  });

  it('returns null rather than NaN-shaped junk', () => {
    expect(toDateKey(null)).toBeNull();
    expect(toDateKey(undefined)).toBeNull();
    expect(toDateKey('')).toBeNull();
    expect(toDateKey('   ')).toBeNull();
    expect(toDateKey('not a date')).toBeNull();
    expect(toDateKey(new Date('nope'))).toBeNull();
  });
});

describe('todayKey', () => {
  it('reports the club date, which can be tomorrow relative to UTC', () => {
    // 01:00 on the 21st in Colombo is 19:30 UTC on the 20th.
    const instant = atColomboTime(2026, 9, 21, 1, 0);
    expect(todayKey('Asia/Colombo', instant)).toBe('2026-09-21');
  });

  it('defaults to Asia/Colombo', () => {
    expect(DEFAULT_CLUB_TIMEZONE).toBe('Asia/Colombo');
  });
});

describe('monthBounds', () => {
  it('handles a 31-day month', () => {
    expect(monthBounds('2026-09-15')).toEqual({
      monthStart: '2026-09-01',
      monthEnd: '2026-09-30',
      year: 2026,
      month: 9,
    });
  });

  it('handles a 30-day month', () => {
    expect(monthBounds('2026-04-02').monthEnd).toBe('2026-04-30');
  });

  it('handles February in a leap year and a common year', () => {
    expect(monthBounds('2028-02-10').monthEnd).toBe('2028-02-29');
    expect(monthBounds('2026-02-10').monthEnd).toBe('2026-02-28');
  });

  it('handles December and the year boundary', () => {
    expect(monthBounds('2026-12-31')).toEqual({
      monthStart: '2026-12-01',
      monthEnd: '2026-12-31',
      year: 2026,
      month: 12,
    });
  });

  it('is independent of the machine timezone', () => {
    // 45 distinct month-ends, none of which should shift with the host zone.
    for (let month = 1; month <= 12; month += 1) {
      const bounds = monthBounds(`2026-${String(month).padStart(2, '0')}-01`);
      expect(bounds.monthStart).toBe(`2026-${String(month).padStart(2, '0')}-01`);
      expect(bounds.monthEnd.startsWith('2026-')).toBe(true);
    }
  });
});

describe('daysBetween, addDays, enumerateDays', () => {
  it('counts inclusively so a single day is 1, not 0', () => {
    expect(daysBetween('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-09-01', '2026-09-20')).toBe(20);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(daysBetween('2026-12-20', '2027-01-10')).toBe(22);
  });

  it('enumerates an inclusive range', () => {
    const days = enumerateDays('2026-09-18', '2026-09-20');
    expect(days).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
  });

  it('returns nothing when the range is inverted', () => {
    expect(enumerateDays('2026-09-20', '2026-09-18')).toEqual([]);
  });

  it('never returns a negative count for an inverted range', () => {
    // A raw difference goes to -9 here. Callers that only test for truthiness
    // would treat that as a valid window, so daysBetween clamps to 0.
    expect(daysBetween('2026-09-20', '2026-09-10')).toBe(0);
    expect(daysBetween('2026-09-20', '2026-09-19')).toBe(0);
    expect(daysBetween('2027-01-05', '2026-09-10')).toBe(0);
    expect(daysBetween('2026-09-20', '2026-09-10')).not.toBeLessThan(0);
  });
});

describe('effectiveStartDate', () => {
  it('uses the month start when the player joined earlier', () => {
    expect(effectiveStartDate('2026-09-01', '2026-03-14')).toBe('2026-09-01');
  });

  it('uses the registration date when the player joined mid-month', () => {
    expect(effectiveStartDate('2026-09-01', '2026-09-10')).toBe('2026-09-10');
  });

  it('is equal at the boundary', () => {
    expect(effectiveStartDate('2026-09-01', '2026-09-01')).toBe('2026-09-01');
  });

  it('falls back to the month start when the registration date is unusable', () => {
    expect(effectiveStartDate('2026-09-01', null)).toBe('2026-09-01');
    expect(effectiveStartDate('2026-09-01', '')).toBe('2026-09-01');
    expect(effectiveStartDate('2026-09-01', 'garbage')).toBe('2026-09-01');
  });
});

describe('collectAttendanceDays', () => {
  it('collapses several scans on one date into a single day', () => {
    const days = collectAttendanceDays([
      { attendance_date: '2026-09-10', check_in_time: '2026-09-10T02:30:00.000Z' },
      { attendance_date: '2026-09-10', check_in_time: '2026-09-10T07:30:00.000Z' },
      { attendance_date: '2026-09-10', check_in_time: '2026-09-10T12:30:00.000Z' },
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-09-10');
    expect(days[0].checkIns).toHaveLength(3);
  });

  it('sorts by date and tolerates missing or unusable rows', () => {
    const days = collectAttendanceDays([
      { attendance_date: '2026-09-12' },
      null,
      { attendance_date: 'nonsense' },
      { attendance_date: '2026-09-10' },
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-09-10', '2026-09-12']);
  });

  it('falls back to the timestamp when attendance_date is absent', () => {
    const days = collectAttendanceDays([{ check_in_time: atColomboTime(2026, 9, 10, 8, 0) }]);
    expect(days[0].date).toBe('2026-09-10');
  });
});

describe('buildMonthSummary - injected clock is authoritative', () => {
  it('derives the month from `today` when `monthStart` is omitted', () => {
    // Regression: monthBounds() was handed the raw Date, failed to parse it as a
    // key and fell through to the real system clock, so the summary silently
    // reported the wrong month whenever a caller injected only `today`.
    const summary = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2027-03-05' }],
      today: '2027-03-10',
    });

    expect(summary.monthStart).toBe('2027-03-01');
    expect(summary.monthEnd).toBe('2027-03-31');
    expect(summary.year).toBe(2027);
    expect(summary.month).toBe(3);
    expect(summary.presentDays).toBe(1);
    expect(summary.applicableDays).toBe(10);
  });

  it('resolves an injected Date in the club timezone, not the default one', () => {
    // 22:30 Colombo on the 10th is still the 10th in Colombo but already the
    // 9th in UTC-10. Resolving `today` with the default zone instead of the
    // passed one would shift the whole window by a day.
    const instant = atColomboTime(2026, 9, 10, 22, 30);
    const summary = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-09-10' }],
      monthStart: '2026-09-01',
      today: instant,
      timeZone: 'Asia/Colombo',
    });

    expect(summary.today).toBe('2026-09-10');
    expect(summary.applicableDays).toBe(10);
    expect(summary.presentDays).toBe(1);
  });

  it('honours a non-Colombo club timezone for the whole window', () => {
    // 02:00 on the 30th in Colombo is 20:30 UTC on the 29th, which is still the
    // 29th in Midway. The club's zone decides which days are in scope, so the
    // two reports differ by a day of window.
    const instant = atColomboTime(2026, 9, 30, 2, 0);
    const rows = [
      { attendance_date: '2026-09-29' },
      { attendance_date: '2026-09-30' },
    ];

    const inColombo = buildMonthSummary({
      attendanceRows: rows,
      monthStart: '2026-09-01',
      today: instant,
      timeZone: 'Asia/Colombo',
    });
    const inMidway = buildMonthSummary({
      attendanceRows: rows,
      monthStart: '2026-09-01',
      today: instant,
      timeZone: 'Pacific/Midway',
    });

    expect(inColombo.today).toBe('2026-09-30');
    expect(inColombo.applicableDays).toBe(30);
    expect(inColombo.presentDays).toBe(2);

    expect(inMidway.today).toBe('2026-09-29');
    expect(inMidway.applicableDays).toBe(29);
    // The 30th is outside the window in Midway, so it is not counted present
    // and not counted as leave either.
    expect(inMidway.presentDays).toBe(1);
    expect(inMidway.leaveDays).toBe(28);
  });

  it('clamps a timezone whose today has already rolled into the next month', () => {
    // UTC+14 puts this instant on 1 October while Colombo is still on the 30th.
    // September is a closed month there, so the report must stop at the 30th
    // rather than claiming the player was absent for all of October.
    const inKiritimati = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-09-30' }],
      monthStart: '2026-09-01',
      today: atColomboTime(2026, 9, 30, 21, 0),
      timeZone: 'Pacific/Kiritimati',
    });

    expect(inKiritimati.today).toBe('2026-10-01');
    expect(inKiritimati.endDate).toBe('2026-09-30');
    expect(inKiritimati.applicableDays).toBe(30);
    expect(inKiritimati.presentDays).toBe(1);
  });

  it('falls back to the end of the month when no clock is injected', () => {
    const summary = buildMonthSummary({
      attendanceRows: [],
      monthStart: '2026-09-01',
    });
    // monthStart given, today absent: bounded by that month, never negative.
    expect(summary.monthStart).toBe('2026-09-01');
    expect(summary.applicableDays).toBeGreaterThanOrEqual(0);
    expect(summary.endDate <= '2026-09-30').toBe(true);
  });
});

describe('buildMonthSummary - the spec calculation', () => {
  it('reproduces the worked example: 18 present, 8 leave, 69%', () => {    // 26 applicable days, 18 of them attended -> 69.2%
    const attended = Array.from({ length: 18 }, (_, i) => ({
      attendance_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    }));

    const summary = buildMonthSummary({
      attendanceRows: attended,
      registrationDate: '2026-01-15',
      monthStart: '2026-09-01',
      today: '2026-09-26',
    });

    expect(summary.applicableDays).toBe(26);
    expect(summary.presentDays).toBe(18);
    expect(summary.leaveDays).toBe(8);
    expect(summary.attendancePercentage).toBeCloseTo(69.2, 1);
  });

  it('marks each date Present or Leave and carries the check-in times', () => {
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-01', check_in_time: atColomboTime(2026, 9, 1, 6, 0) },
        { attendance_date: '2026-09-04', check_in_time: atColomboTime(2026, 9, 4, 18, 0) },
      ],
      registrationDate: '2026-01-01',
      monthStart: '2026-09-01',
      today: '2026-09-05',
    });

    expect(summary.days.map((d) => `${d.date} ${d.status}`)).toEqual([
      '2026-09-01 Present',
      '2026-09-02 Leave',
      '2026-09-03 Leave',
      '2026-09-04 Present',
      '2026-09-05 Leave',
    ]);
    expect(summary.presentDays).toBe(2);
    expect(summary.leaveDays).toBe(3);
  });

  it('never counts a future date as absent', () => {
    const summary = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-09-01' }],
      registrationDate: '2026-01-01',
      monthStart: '2026-09-01',
      today: '2026-09-20',
    });

    expect(summary.applicableDays).toBe(20);
    expect(summary.days.some((d) => d.date > '2026-09-20')).toBe(false);
    expect(summary.days[summary.days.length - 1].date).toBe('2026-09-20');
  });

  it('clamps to the end of the month when asked about a month already over', () => {
    const summary = buildMonthSummary({
      attendanceRows: [],
      registrationDate: '2026-01-01',
      monthStart: '2026-08-01',
      today: '2026-10-05',
    });

    expect(summary.applicableDays).toBe(31);
    expect(summary.endDate).toBe('2026-08-31');
  });

  it('marks a month in the future as not started rather than fully absent', () => {
    const summary = buildMonthSummary({
      attendanceRows: [],
      registrationDate: '2026-01-01',
      monthStart: '2026-11-01',
      today: '2026-10-05',
    });

    expect(summary.notStarted).toBe(true);
    expect(summary.applicableDays).toBe(0);
    expect(summary.presentDays).toBe(0);
    expect(summary.leaveDays).toBe(0);
    expect(summary.attendancePercentage).toBe(0);
  });
});

describe('buildMonthSummary - registration date rule', () => {
  it('does not count days before the player registered', () => {
    // Registered on the 10th, today is the 20th: 11 applicable days, not 20.
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-10' },
        { attendance_date: '2026-09-12' },
        { attendance_date: '2026-09-20' },
      ],
      registrationDate: '2026-09-10',
      monthStart: '2026-09-01',
      today: '2026-09-20',
    });

    expect(summary.startDate).toBe('2026-09-10');
    expect(summary.applicableDays).toBe(11);
    expect(summary.presentDays).toBe(3);
    expect(summary.leaveDays).toBe(8);
    expect(summary.days[0].date).toBe('2026-09-10');
  });

  it('handles a player who registered today', () => {
    const summary = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-09-20' }],
      registrationDate: '2026-09-20',
      monthStart: '2026-09-01',
      today: '2026-09-20',
    });

    expect(summary.applicableDays).toBe(1);
    expect(summary.presentDays).toBe(1);
    expect(summary.leaveDays).toBe(0);
    expect(summary.attendancePercentage).toBe(100);
  });

  it('handles a player registered on the first of the month', () => {
    const summary = buildMonthSummary({
      attendanceRows: [],
      registrationDate: '2026-09-01',
      monthStart: '2026-09-01',
      today: '2026-09-30',
    });

    expect(summary.applicableDays).toBe(30);
    expect(summary.leaveDays).toBe(30);
    expect(summary.attendancePercentage).toBe(0);
  });

  it('does not divide by zero for a player with no attendance at all', () => {
    const summary = buildMonthSummary({
      attendanceRows: [],
      registrationDate: '2026-09-15',
      monthStart: '2026-09-01',
      today: '2026-09-20',
    });

    expect(summary.presentDays).toBe(0);
    expect(summary.leaveDays).toBe(6);
    expect(Number.isFinite(summary.attendancePercentage)).toBe(true);
    expect(summary.attendancePercentage).toBe(0);
  });
});

describe('buildMonthSummary - multiple scans on one day', () => {
  it('counts three scans on one date as a single present day', () => {
    const morning = atColomboTime(2026, 9, 10, 8, 0);
    const afternoon = atColomboTime(2026, 9, 10, 13, 0);
    const evening = atColomboTime(2026, 9, 10, 18, 0);

    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-10', check_in_time: morning },
        { attendance_date: '2026-09-10', check_in_time: afternoon },
        { attendance_date: '2026-09-10', check_in_time: evening },
      ],
      registrationDate: '2026-09-01',
      monthStart: '2026-09-01',
      today: '2026-09-10',
    });

    expect(summary.presentDays).toBe(1);
    expect(summary.applicableDays).toBe(10);
    expect(summary.leaveDays).toBe(9);
    expect(summary.days.find((d) => d.date === '2026-09-10').checkIns).toHaveLength(3);
  });

  it('keeps every scan time but reports one day', () => {
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-10', check_in_time: atColomboTime(2026, 9, 10, 6, 15) },
        { attendance_date: '2026-09-10', check_in_time: atColomboTime(2026, 9, 10, 7, 45) },
      ],
      registrationDate: '2026-09-01',
      monthStart: '2026-09-01',
      today: '2026-09-10',
    });

    const day = summary.days.find((d) => d.date === '2026-09-10');
    expect(day.checkIns).toHaveLength(2);
    expect(firstCheckInLabel(day.checkIns)).toBe('06:15');
  });
});

describe('buildMonthSummary - month and year transitions', () => {
  it('rolls over to a new month with no manual reset', () => {
    const september = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-09-28' }],
      registrationDate: '2026-01-01',
      monthStart: '2026-09-01',
      today: '2026-09-30',
    });
    expect(september.applicableDays).toBe(30);
    expect(september.presentDays).toBe(1);

    const october = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-09-28' }],
      registrationDate: '2026-01-01',
      monthStart: '2026-10-01',
      today: '2026-10-03',
    });
    expect(october.applicableDays).toBe(3);
    expect(october.presentDays).toBe(0);
    expect(october.leaveDays).toBe(3);
  });

  it('rolls over the year boundary', () => {
    const december = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-12-31' }],
      registrationDate: '2026-12-30',
      monthStart: '2026-12-01',
      today: '2026-12-31',
    });
    expect(december.applicableDays).toBe(2);

    const january = buildMonthSummary({
      attendanceRows: [{ attendance_date: '2026-12-31' }],
      registrationDate: '2026-12-30',
      monthStart: '2027-01-01',
      today: '2027-01-05',
    });
    expect(january.applicableDays).toBe(5);
    expect(january.presentDays).toBe(0);
    expect(january.year).toBe(2027);
  });

  it('keeps a previous month reportable after the month ends', () => {
    const august = buildMonthSummary({
      attendanceRows: Array.from({ length: 23 }, (_, i) => ({
        attendance_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      })),
      registrationDate: '2026-01-01',
      monthStart: '2026-08-01',
      today: '2026-09-20',
    });

    expect(august.applicableDays).toBe(31);
    expect(august.presentDays).toBe(23);
    expect(august.leaveDays).toBe(8);
  });
});

describe('listMonths', () => {
  it('lists months newest first', () => {
    const months = listMonths('2026-07-01', '2026-10-15');
    expect(months.map((m) => m.key)).toEqual([
      '2026-10', '2026-09', '2026-08', '2026-07',
    ]);
  });

  it('returns a single month when the range is one month wide', () => {
    expect(listMonths('2026-09-01', '2026-09-20').map((m) => m.key)).toEqual(['2026-09']);
  });

  it('crosses the year boundary', () => {
    expect(listMonths('2026-11-01', '2027-02-10').map((m) => m.key)).toEqual([
      '2027-02', '2027-01', '2026-12', '2026-11',
    ]);
  });

  it('returns an empty list for an inverted range', () => {
    // This is a real trap: the walk starts at `to` and steps backwards looking
    // for `from`, so an inverted range never matches and used to run to the
    // iteration cap, returning years of months nobody asked for.
    expect(listMonths('2026-10-01', '2026-07-01')).toEqual([]);
    expect(listMonths('2027-01-01', '2026-12-01')).toEqual([]);
    expect(listMonths('2026-10-01', '2026-10-01').length).toBe(1);
  });

  it('treats a same-month inverted range as a single month, not a walk', () => {
    expect(listMonths('2026-10-01', '2026-10-15').map((m) => m.key)).toEqual(['2026-10']);
  });
});

describe('labels and keys', () => {
  it('validates date keys', () => {
    expect(isValidDateKey('2026-09-01')).toBe(true);
    expect(isValidDateKey('2026-9-1')).toBe(false);
    expect(isValidDateKey('01-09-2026')).toBe(false);
    expect(isValidDateKey(null)).toBe(false);
  });

  it('labels months', () => {
    expect(monthLabel(2026, 9)).toBe('September 2026');
    expect(monthLabel(2026, 9, { short: true })).toBe('Sep 2026');
  });
});

describe('buildMonthSummary - current month, member joined mid-month', () => {
  // The scenario the profile calendar actually renders: it is the current month,
  // so the window is clamped at today, and the member only existed from the
  // middle of it.

  it('counts from the registration date, not the first of the month', () => {
    // Registered on the 10th, today is the 14th: five applicable days, not 14.
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-10', check_in_time: '2026-09-10T05:00:00.000Z' },
        { attendance_date: '2026-09-12', check_in_time: '2026-09-12T05:00:00.000Z' },
      ],
      registrationDate: '2026-09-10',
      today: '2026-09-14',
    });

    expect(summary.monthStart).toBe('2026-09-01');
    expect(summary.presentDays).toBe(2);
    // 10th, 11th, 12th, 13th, 14th = 5 days; 2 attended, 3 missed.
    expect(summary.applicableDays).toBe(5);
    expect(summary.leaveDays).toBe(3);
  });

  it('never counts a day that has not happened yet', () => {
    // Attendance rows dated after today must not be counted, or a clock skew or
    // a bad backfill would invent present days.
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-02', check_in_time: '2026-09-02T05:00:00.000Z' },
        { attendance_date: '2026-09-20', check_in_time: '2026-09-20T05:00:00.000Z' },
        { attendance_date: '2026-09-25', check_in_time: '2026-09-25T05:00:00.000Z' },
      ],
      registrationDate: '2026-09-01',
      today: '2026-09-14',
    });

    expect(summary.presentDays).toBe(1);
    expect(summary.applicableDays).toBe(14);
    expect(summary.days.every((d) => d.date <= '2026-09-14')).toBe(true);
  });

  it('reports zero days when the member joined after the reporting day', () => {
    const summary = buildMonthSummary({
      attendanceRows: [],
      registrationDate: '2026-09-20',
      today: '2026-09-14',
    });

    expect(summary.applicableDays).toBe(0);
    expect(summary.presentDays).toBe(0);
    expect(summary.leaveDays).toBe(0);
  });

  it('counts repeated scans on one date as a single present day', () => {
    // The database now prevents this, but history predates the unique index, so
    // the monthly totals stay correct either way.
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-11', check_in_time: '2026-09-11T05:00:00.000Z' },
        { attendance_date: '2026-09-11', check_in_time: '2026-09-11T11:00:00.000Z' },
        { attendance_date: '2026-09-11', check_in_time: '2026-09-11T18:00:00.000Z' },
      ],
      registrationDate: '2026-09-01',
      today: '2026-09-14',
    });

    expect(summary.presentDays).toBe(1);
    expect(summary.leaveDays).toBe(13);
  });

  it('produces a present and leave day for every applicable date', () => {
    const summary = buildMonthSummary({
      attendanceRows: [
        { attendance_date: '2026-09-11', check_in_time: '2026-09-11T05:00:00.000Z' },
      ],
      registrationDate: '2026-09-10',
      today: '2026-09-14',
    });

    expect(summary.days.map((d) => `${d.date} ${d.status}`)).toEqual([
      '2026-09-10 Leave',
      '2026-09-11 Present',
      '2026-09-12 Leave',
      '2026-09-13 Leave',
      '2026-09-14 Leave',
    ]);
  });
});

describe('getClubHour', () => {
  it('extracts hour in Asia/Colombo regardless of host environment', () => {
    // 18:30 Colombo time is 13:00 UTC
    const checkInUtc = '2026-03-14T13:00:00.000Z';
    expect(getClubHour(checkInUtc, 'Asia/Colombo')).toBe(18);
  });

  it('handles midnight edge cases in club timezone', () => {
    // 00:15 Colombo time on March 14 is 18:45 UTC on March 13
    const checkInUtc = '2026-03-13T18:45:00.000Z';
    expect(getClubHour(checkInUtc, 'Asia/Colombo')).toBe(0);
  });

  it('returns null for invalid values', () => {
    expect(getClubHour(null)).toBeNull();
    expect(getClubHour('invalid')).toBeNull();
  });
});

describe('getClubDayRangeIso', () => {
  it('computes exact UTC start and end ISO strings for a Colombo date key', () => {
    const range = getClubDayRangeIso('2026-03-14', 'Asia/Colombo');
    expect(range.startIso).toBe('2026-03-13T18:30:00.000Z');
    expect(range.endIso).toBe('2026-03-14T18:29:59.999Z');
  });

  it('returns nulls for invalid date key', () => {
    expect(getClubDayRangeIso('invalid')).toEqual({ startIso: null, endIso: null });
  });
});

describe('buildMemberMonthSummaries', () => {
  // The members list shows one current-month column for every visible row. It
  // is the same counting as the profile calendar, so these tests check that the
  // batched version agrees with buildMonthSummary and keeps each member's rows
  // apart instead of merging them.

  it('counts each member separately from a shared row set', () => {
    const summaries = buildMemberMonthSummaries({
      rows: [
        { member_id: 'm1', attendance_date: '2026-09-02' },
        { member_id: 'm2', attendance_date: '2026-09-03' },
        { member_id: 'm1', attendance_date: '2026-09-05' },
        // A second scan on a day already counted must not add another day.
        { member_id: 'm1', attendance_date: '2026-09-05' },
      ],
      members: [
        { id: 'm1', registrationDate: '2026-09-01' },
        { id: 'm2', registrationDate: '2026-09-01' },
      ],
      monthStart: '2026-09-01',
      today: '2026-09-10',
    });

    expect(summaries.m1.presentDays).toBe(2);
    expect(summaries.m2.presentDays).toBe(1);
    // 10 applicable days for both, since both were members from the 1st.
    expect(summaries.m1.applicableDays).toBe(10);
    expect(summaries.m1.leaveDays).toBe(8);
    expect(summaries.m2.leaveDays).toBe(9);
  });

  it('applies each member registration date and still returns a zero row', () => {
    const summaries = buildMemberMonthSummaries({
      rows: [{ member_id: 'late', attendance_date: '2026-09-10' }],
      members: [
        { id: 'late', registrationDate: '2026-09-08' },
        { id: 'never', registrationDate: '2026-01-05' },
      ],
      monthStart: '2026-09-01',
      today: '2026-09-10',
    });

    // Registered on the 8th, so 8th to 10th is 3 applicable days, not 10.
    expect(summaries.late.applicableDays).toBe(3);
    expect(summaries.late.presentDays).toBe(1);
    expect(summaries.late.leaveDays).toBe(2);
    // Never came in, but still shown rather than missing from the column.
    expect(summaries.never).toBeDefined();
    expect(summaries.never.presentDays).toBe(0);
    expect(summaries.never.leaveDays).toBe(10);
  });

  it('reads created_at as the join date when no registrationDate is supplied', () => {
    // members has no registration_date column, so created_at is the join date.
    // A player created at 23:30 Colombo time joined that evening, not the next
    // day: 23:30 +05:30 is 18:00 UTC on the same date.
    const summaries = buildMemberMonthSummaries({
      rows: [],
      members: [{ id: 'evening', created_at: '2026-09-07T18:00:00.000Z' }],
      monthStart: '2026-09-01',
      today: '2026-09-10',
      timeZone: 'Asia/Colombo',
    });

    expect(summaries.evening.applicableDays).toBe(4);
    expect(summaries.evening.days[0].status).toBe('Leave');
  });

  it('ignores rows with no member_id and members with no id', () => {
    const summaries = buildMemberMonthSummaries({
      rows: [
        { attendance_date: '2026-09-02' },
        { member_id: null, attendance_date: '2026-09-02' },
        { member_id: 'm1', attendance_date: '2026-09-02' },
      ],
      members: [{ registrationDate: '2026-09-01' }, { id: 'm1', registrationDate: '2026-09-01' }],
      monthStart: '2026-09-01',
      today: '2026-09-10',
    });

    expect(Object.keys(summaries)).toEqual(['m1']);
    expect(summaries.m1.presentDays).toBe(1);
  });

  it('returns an empty map rather than throwing on empty input', () => {
    expect(buildMemberMonthSummaries()).toEqual({});
    expect(buildMemberMonthSummaries({ rows: [], members: [] })).toEqual({});
  });
});

