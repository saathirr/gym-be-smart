// Attendance arithmetic, kept pure and free of Supabase so it can be unit
// tested in the node environment and reasoned about on its own.
//
// The rules this encodes, in the order they matter:
//
//   monthStart          first calendar day of the month being reported
//   today               the club's current calendar date, never later
//   registrationDate    when the player joined
//   effectiveStartDate  MAX(monthStart, registrationDate)
//   applicableDates     effectiveStartDate .. today
//   presentDays         DISTINCT attendance dates inside that window
//   leaveDays           applicableDates - presentDays
//
// Two traps this exists to avoid:
//
//  1. Timezone drift. A member who checks in at 00:30 Colombo time is on the
//     *previous* UTC day. `new Date().toISOString().slice(0,10)` would file
//     that check-in under the wrong date, so every key here is produced by
//     formatting in the club's timezone instead. See `toDateKey`.
//
//  2. Phantom absences. Counting from the 1st for a member who registered on
//     the 20th would report 19 days of absence they could not possibly have
//     avoided. Hence MAX(monthStart, registrationDate).
//
// Nothing here mutates anything or reads the clock without being told what
// "now" is, which is what makes the edge cases in the spec testable.

export const DEFAULT_CLUB_TIMEZONE = 'Asia/Colombo';

// The club timezone lives in gym_settings.timezone and is mirrored by
// public.gym_tz() in the database. Pass the stored value in so the app and the
// database agree; this default keeps the maths usable on its own.
function resolveTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_CLUB_TIMEZONE;
  }
}

// Calendar date in the club's timezone as 'YYYY-MM-DD'.
//
// Deliberately not toISOString(): that converts to UTC first, so for any
// timezone east of Greenwich an evening check-in lands on tomorrow's key
// (Colombo is UTC+5:30, so 22:00 local is 16:30 UTC the same day, but 02:00
// local is 20:30 UTC the *previous* day and would be misfiled).
//
// en-CA formats as YYYY-MM-DD, which is already the shape we need and sorts
// lexicographically.
export function toDateKey(value, timeZone = DEFAULT_CLUB_TIMEZONE) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: resolveTimeZone(timeZone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // A bare YYYY-MM-DD (or a datetime whose date part is already local, which
  // is the case for attendance.attendance_date) needs no timezone shift.
  const dateOnly = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;

  // Anything else is a real instant, so reinterpret it in the club timezone.
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toDateKey(parsed, timeZone);
}

// Today, in the club's timezone.
export function todayKey(timeZone = DEFAULT_CLUB_TIMEZONE, now = new Date()) {
  return toDateKey(now, timeZone);
}

export function parseKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isValidDateKey(key) {
  return parseKey(key) !== null;
}

// First and last calendar day of the month containing `key`.
//
// Built with Date.UTC and read back through getUTC*, never the local
// Date getters: using local getters would make the result depend on the
// receptionist's laptop timezone, which is exactly the bug class above.
export function monthBounds(key) {
  const parts = parseKey(key) || parseKey(toDateKey(new Date()));
  if (!parts) return null;

  const { year, month } = parts;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    monthStart: toKeyFromUtc(start),
    monthEnd: toKeyFromUtc(end),
    year,
    month,
  };
}

function toKeyFromUtc(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Whole days from `from` to `to`, both 'YYYY-MM-DD', inclusive of both ends.
// Returns 1 when they are the same day, and 0 when `to` precedes `from`.
//
// The clamp is what makes the function safe to call with an inverted range: a
// raw difference would go negative and a caller that only checked for truthiness
// would treat it as a valid window.
export function daysBetween(from, to) {
  const a = parseKey(from);
  const b = parseKey(to);
  if (!a || !b) return 0;

  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  const inclusive = Math.round((end - start) / 86400000) + 1;
  return inclusive > 0 ? inclusive : 0;
}

export function addDays(key, amount) {
  const parts = parseKey(key);
  if (!parts) return null;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return toKeyFromUtc(shifted);
}

// Inclusive list of date keys from `start` to `end`.
export function enumerateDays(start, end) {
  if (!parseKey(start) || !parseKey(end)) return [];
  const total = daysBetween(start, end);
  if (total <= 0) return [];

  const days = [];
  let cursor = start;
  for (let i = 0; i < total; i += 1) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

// MAX(monthStart, registrationDate).
//
// The guard clauses matter: a member with no recorded registration date would
// otherwise be assessed from the 1st of the month, and an unparseable date
// would produce an empty window and a 0% rate.
export function effectiveStartDate(monthStart, registrationDate) {
  if (!parseKey(monthStart)) return null;
  if (!parseKey(registrationDate)) return monthStart;
  return registrationDate > monthStart ? registrationDate : monthStart;
}

// Normalises a bag of attendance rows into distinct date keys, optionally
// carrying the check-in times seen on each day.
//
// Multiple scans on one date collapse to a single entry, which is the whole
// point: three scans on the 10th is one present day, not three.
export function collectAttendanceDays(rows = [], timeZone = DEFAULT_CLUB_TIMEZONE) {
  const byDate = new Map();

  for (const row of rows) {
    if (!row) continue;
    const key = toDateKey(row.attendance_date ?? row.date ?? row.check_in_time, timeZone);
    if (!key) continue;

    const checkIn = row.check_in_time || null;
    if (!byDate.has(key)) {
      byDate.set(key, { date: key, checkIns: [], checkOuts: [] });
    }
    const entry = byDate.get(key);
    if (checkIn) entry.checkIns.push(checkIn);
    if (row.check_out_time) entry.checkOuts.push(row.check_out_time);
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

// The spec's calculation, end to end.
//
// `today` and `monthStart` are injected rather than read from the clock so the
// month rollover, year rollover and "registered today" cases are directly
// testable.
export function buildMonthSummary({
  attendanceRows = [],
  registrationDate = null,
  monthStart,
  today,
  timeZone = DEFAULT_CLUB_TIMEZONE,
  weekStartsOn = 1,
} = {}) {
  // The club timezone has to be threaded through here, not defaulted: a `today`
  // passed in as a Date instant has to be resolved in the club's day, and
  // defaulting would silently use Colombo for any other configured zone.
  const resolvedToday = toDateKey(today, timeZone);

  // Deriving the bounds from the *resolved* key is what lets a caller inject
  // only `today` and still get the right month. Handing monthBounds a raw Date
  // would make it fall through to the real system clock, which is exactly the
  // dependency the injected clock exists to remove.
  const bounds = monthBounds(toDateKey(monthStart, timeZone) || resolvedToday);
  if (!bounds) {
    return emptySummary();
  }

  const reportToday = resolvedToday || bounds.monthEnd;
  // A month can only be reported up to today. Clamping means asking for a
  // future month yields an empty window rather than a wall of phantom absences.
  const windowEnd = reportToday < bounds.monthStart
    ? null
    : reportToday > bounds.monthEnd
      ? bounds.monthEnd
      : reportToday;

  const start = effectiveStartDate(bounds.monthStart, toDateKey(registrationDate, timeZone));

  // Before the player existed, or before this month started: nothing to report.
  if (!start || !windowEnd || start > windowEnd) {
    return {
      ...emptySummary(),
      monthStart: bounds.monthStart,
      monthEnd: bounds.monthEnd,
      today: reportToday,
      year: bounds.year,
      month: bounds.month,
      // Signal that this month is still in the future rather than that the
      // player skipped every day of it.
      notStarted: true,
    };
  }

  const allDays = collectAttendanceDays(attendanceRows, timeZone);
  const days = [];
  let presentDays = 0;

  for (const date of enumerateDays(start, windowEnd)) {
    const entry = allDays.find((d) => d.date === date) || null;
    if (entry) presentDays += 1;
    days.push({
      date,
      status: entry ? 'Present' : 'Leave',
      checkIns: entry ? entry.checkIns : [],
      checkOuts: entry ? entry.checkOuts : [],
    });
  }

  const applicableDays = days.length;
  const leaveDays = applicableDays - presentDays;

  return {
    monthStart: bounds.monthStart,
    monthEnd: bounds.monthEnd,
    today: reportToday,
    year: bounds.year,
    month: bounds.month,
    startDate: start,
    endDate: windowEnd,
    applicableDays,
    presentDays,
    leaveDays,
    // One decimal place: 17/26 is 65.4%, which is more honest than 65%, but
    // three places is noise on a number staff read at a glance.
    attendancePercentage: applicableDays
      ? Math.round((presentDays / applicableDays) * 1000) / 10
      : 0,
    days,
    checkIns: allDays,
    notStarted: false,
    weekStartsOn,
  };
}

function emptySummary() {
  return {
    monthStart: null,
    monthEnd: null,
    today: null,
    year: null,
    month: null,
    startDate: null,
    endDate: null,
    applicableDays: 0,
    presentDays: 0,
    leaveDays: 0,
    attendancePercentage: 0,
    days: [],
    checkIns: [],
    notStarted: false,
    weekStartsOn: 1,
  };
}

// The same summary for a whole page of members at once.
//
// Used by the members list, which shows a compact current-month figure on every
// row. The counting rules are buildMonthSummary's, unchanged and in one place:
// this function only groups the rows and calls it once per member, so the list
// can never disagree with the profile page about the same player.
//
// `rows` are the raw attendance rows for the month; `members` only needs `id`
// and the registration date, taken from `created_at` when not given explicitly
// (members has no registration_date column).
//
// A member with no row in `rows` still gets an entry, with zero present days,
// which is what makes "no attendance" render as a real 0 rather than a blank
// cell in the list.
export function buildMemberMonthSummaries({
  rows = [],
  members = [],
  monthStart,
  today,
  timeZone = DEFAULT_CLUB_TIMEZONE,
} = {}) {
  const byMember = new Map();
  for (const row of rows || []) {
    const id = row?.member_id;
    if (!id) continue;
    if (!byMember.has(id)) byMember.set(id, []);
    byMember.get(id).push(row);
  }

  const summaries = {};
  for (const member of members || []) {
    const id = member?.id;
    if (!id) continue;

    summaries[id] = buildMonthSummary({
      attendanceRows: byMember.get(id) || [],
      registrationDate: toDateKey(member.registrationDate ?? member.created_at, timeZone),
      monthStart,
      today,
      timeZone,
    });
  }

  return summaries;
}

// Every month from `fromKey` to `toKey`, newest first, for the history
// selector. Months with no data are still listed: a month the player did not
// come at all is exactly what they want to see.
export function listMonths(fromKey, toKey) {
  const from = monthBounds(fromKey);
  const to = monthBounds(toKey);
  if (!from || !to) return [];

  // An inverted range is an empty range. Without this guard the walk below
  // would step backwards until the iteration cap and return years of months
  // that were never asked for.
  if (from.year > to.year || (from.year === to.year && from.month > to.month)) {
    return [];
  }

  const months = [];
  let year = to.year;
  let month = to.month;

  // Belt and braces: the comparison above already guarantees termination, so
  // this cap can only be reached by a corrupt date.
  for (let guard = 0; guard < 600; guard += 1) {
    months.push({ year, month, key: `${year}-${String(month).padStart(2, '0')}` });
    if (year === from.year && month === from.month) break;
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  return months;
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(year, month, { short = false } = {}) {
  const name = MONTH_LABELS[month - 1] || '';
  return short ? `${name.slice(0, 3)} ${year}` : `${name} ${year}`;
}

export function weekdayLabel(key, { short = true } = {}) {
  const parts = parseKey(key);
  if (!parts) return '';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const index = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return short ? names[index] : full[index];
}

export function dayOfMonth(key) {
  const parts = parseKey(key);
  return parts ? parts.day : null;
}

// First check-in of the day, formatted for the daily status list.
export function firstCheckInLabel(checkIns = [], timeZone = DEFAULT_CLUB_TIMEZONE) {
  if (!Array.isArray(checkIns) || checkIns.length === 0) return null;

  const times = checkIns
    .map((value) => (value instanceof Date ? value : new Date(value)))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);

  if (times.length === 0) return null;

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(times[0]);
}

export function formatTimestamp(value, timeZone = DEFAULT_CLUB_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: resolveTimeZone(timeZone),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

// 0-23 hour in the club's timezone for any Date or ISO timestamp string,
// independent of the browser's local timezone.
export function getClubHour(value, timeZone = DEFAULT_CLUB_TIMEZONE) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hourPart = parts.find((p) => p.type === 'hour');
  if (!hourPart) return null;
  const hour = parseInt(hourPart.value, 10);
  return Number.isNaN(hour) ? null : hour;
}

// Converts a 'YYYY-MM-DD' calendar date key in timeZone into start & end UTC ISO strings.
// Used as a fallback when attendance_date is not present in the database table.
export function getClubDayRangeIso(dateKey, timeZone = DEFAULT_CLUB_TIMEZONE) {
  const parts = parseKey(dateKey);
  if (!parts) return { startIso: null, endIso: null };

  const utcApprox = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);

  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(utcApprox));

  const getPart = (type) => parseInt(formatted.find((p) => p.type === type)?.value || '0', 10);
  const localYear = getPart('year');
  const localMonth = getPart('month');
  const localDay = getPart('day');
  const localHour = getPart('hour');
  const localMinute = getPart('minute');

  const localUtcMs = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, 0, 0);
  const offsetMs = localUtcMs - utcApprox;

  const startMs = utcApprox - offsetMs;
  const endMs = startMs + 86400000 - 1;

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

