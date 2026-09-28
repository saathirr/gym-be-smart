import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { memberService } from './memberService';
import {
  DEFAULT_CLUB_TIMEZONE,
  getClubDayRangeIso,
  toDateKey,
  todayKey,
} from '../utils/attendanceMath';
import { evaluateMembershipAdmission } from '../utils/membership';

// Attendance is counted in club-local calendar days, not UTC days and not the
// receptionist's browser days.
//
// Three things follow from that and are easy to get wrong:
//
//   * The DATE the row is filed under is written by the database
//     (attendance.attendance_date defaults to
//     `(now() AT TIME ZONE gym_tz())::date`). The client deliberately does not
//     compute it. A check-in at 00:30 Colombo time is the previous day in UTC,
//     so a client-computed key would file it under the wrong day and, at a
//     month edge, the wrong month.
//
//   * "Today" on a filter has to be the club's today. Comparing a timestamp
//     against the browser's local midnight is wrong for anyone whose laptop is
//     not set to Colombo, which on a shared front-desk machine is most of them.
//
//   * One member has one attendance row per day. The unique index from phase 2
//     enforces it, so a second scan has to be reported as "already checked in",
//     not surfaced as a raw duplicate-key error at the front desk.

const ATTENDANCE_SELECT = `
  id,
  member_id,
  attendance_date,
  check_in_time,
  check_out_time,
  method,
  notes,
  members (
    id,
    full_name,
    member_code,
    status,
    memberships ( status, plans ( name ) )
  )
`;

function withMember(row) {
  const activeMembership = row.members?.memberships?.find(
    (sub) => sub.status === 'Active' || sub.status === 'Expiring'
  );

  return {
    id: row.id,
    member_id: row.members?.id ?? null,
    member_name: row.members?.full_name || 'Unknown Member',
    member_code: row.members?.member_code || 'N/A',
    attendance_date: row.attendance_date || null,
    check_in_time: row.check_in_time,
    check_out_time: row.check_out_time,
    method: row.method,
    notes: row.notes,
    status: row.members?.status === 'Active' ? 'Verified' : 'Flagged',
    plan_name: activeMembership?.plans?.name || 'No Active Plan',
  };
}

// 'YYYY-MM-DD' for the club's current day.
//
// Prefers the database, which is the authority on the club's zone, and falls
// back to the configured default when phase 2 has not been applied yet. A
// wrong "today" would mislabel the whole attendance log, so the fallback only
// applies in that one case and is never cached.
export async function getClubToday({ timeZone = DEFAULT_CLUB_TIMEZONE } = {}) {
  try {
    const { data, error } = await supabase.rpc('gym_today');
    if (!error && typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return data;
    }
  } catch {
    // Function not present yet. Fall through to the configured default.
  }

  return todayKey(timeZone);
}

// How many member ids go into one request.
//
// PostgREST puts the `in` list in the query string, and 200 UUIDs is roughly
// 8 kB of URL, which is where proxies start rejecting requests. 100 keeps every
// chunk comfortably short and costs one extra round trip at worst.
const CHUNK_SIZE = 100;

const MONTH_ROW_SELECT = 'member_id, attendance_date, check_in_time, check_out_time';

// PostgREST reports an unknown column as PGRST204, Postgres as 42703. Both mean
// "this database predates the attendance_date column", which is a fallback and
// not an error worth surfacing.
function isMissingAttendanceDate(error) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

async function fetchMonthAttendanceChunk(
  memberIds,
  { monthStart, monthEnd, timeZone, limit }
) {
  const { data, error } = await supabase
    .from('attendance')
    .select(MONTH_ROW_SELECT)
    .in('member_id', memberIds)
    .gte('attendance_date', monthStart)
    .lte('attendance_date', monthEnd)
    .limit(limit);

  if (!error) return data || [];
  if (!isMissingAttendanceDate(error)) throw toMessage(error);

  // Before the column existed, the same window is expressed against the raw
  // timestamp, converted into UTC instants by the club's own offset. The rows
  // still carry no attendance_date, so the caller's fallback in
  // buildMemberMonthSummaries re-derives the day from check_in_time.
  const { startIso } = getClubDayRangeIso(monthStart, timeZone);
  const { endIso } = getClubDayRangeIso(monthEnd, timeZone);

  const fallback = await supabase
    .from('attendance')
    .select('member_id, check_in_time, check_out_time')
    .in('member_id', memberIds)
    .gte('check_in_time', startIso)
    .lte('check_in_time', endIso)
    .limit(limit);

  if (fallback.error) throw toMessage(fallback.error);
  return fallback.data || [];
}

export const attendanceService = {
  getClubToday,

  async getAttendanceLogs({ search = '', date = 'ALL', limit = 300, timeZone } = {}) {
    let query = supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .order('check_in_time', { ascending: false })
      .limit(limit);

    if (date === 'TODAY') {
      // Filtered on the stored club-local date, not on the timestamp, so the
      // log is correct regardless of where the browser thinks it is.
      const today = await getClubToday({ timeZone });
      query = query.eq('attendance_date', today);
    }

    const { data, error } = await query;
    if (error) throw toMessage(error);

    const logs = (data || []).map(withMember);

    if (!search.trim()) return logs;
    const term = search.trim().toLowerCase();

    return logs.filter(
      (log) =>
        log.member_name.toLowerCase().includes(term) ||
        log.member_code.toLowerCase().includes(term)
    );
  },

  async getTodayCount({ timeZone } = {}) {
    const today = await getClubToday({ timeZone });

    const { count, error } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('attendance_date', today);

    if (error) throw toMessage(error);
    return count ?? 0;
  },

  async getCheckInCountSince(startIso) {
    const { count, error } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .gte('check_in_time', startIso);

    if (error) throw toMessage(error);
    return count ?? 0;
  },

  /**
   * Every attendance row for one member, newest first.
   *
   * Used by the profile page. Returns raw rows so the caller can hand them to
   * buildMonthSummary, which does the distinct-day counting in the club's
   * timezone. No limit is applied by default beyond `limit`, because a member
   * who has been training for years has a few hundred rows, not thousands.
   */
  async getMemberAttendance({ memberId, from = null, to = null, limit = 1000 } = {}) {
    if (!memberId) return [];

    let query = supabase
      .from('attendance')
      .select('id, attendance_date, check_in_time, check_out_time, method, notes')
      .eq('member_id', memberId)
      .order('attendance_date', { ascending: false })
      .limit(limit);

    // Both bounds are inclusive club-local dates.
    if (from) query = query.gte('attendance_date', from);
    if (to) query = query.lte('attendance_date', to);

    const { data, error } = await query;
    if (error) throw toMessage(error);
    return data || [];
  },

  /**
   * Members present on one club-local day.
   *
   * Filtering on the stored attendance_date rather than the timestamp is what
   * keeps a check-in logged at 00:30 local on the day it happened, instead of
   * spilling into the previous day.
   */
  async getAttendanceForDate({ date, limit = 500 } = {}) {
    if (!date) return [];

    const { data, error } = await supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .eq('attendance_date', date)
      .order('check_in_time', { ascending: true })
      .limit(limit);

    if (error) throw toMessage(error);
    return (data || []).map(withMember);
  },

  async logCheckIn(passValue, method = 'QR_SCAN', { timeZone } = {}) {
    const member = await memberService.getMemberByPass(passValue);

    if (!member) {
      return {
        success: false,
        error: 'No member matches that code. Check the QR pass or member ID.',
      };
    }

    if (member.status !== 'Active') {
      return {
        success: false,
        member,
        error: `Access denied - ${member.full_name} is marked "${member.status}". Renew the membership first.`,
      };
    }

    // An end_date is inclusive: a membership ending today is still valid for
    // the whole of that day. Comparing dates as keys in the club's zone avoids
    // both the UTC-midnight trap and the browser's own timezone.
    const today = await getClubToday({ timeZone });
    if (member.expiration_date && toDateKey(member.expiration_date) < today) {
      return {
        success: false,
        member,
        error: `Access denied - the membership for ${member.full_name} expired on ${member.expiration_date}.`,
      };
    }

    // Final authority, shared with the gym card and the dashboard: an OPEN
    // subscription (Active or Expiring) whose dates actually cover today.
    //
    // The two checks above stay because they produce the more specific message
    // for the two most common cases, and because evaluateMembershipAdmission
    // repeats them as a safety net rather than trusting this function's ordering.
    const admission = evaluateMembershipAdmission(member, today);
    if (!admission.allowed) {
      return {
        success: false,
        member,
        error: `Access denied - ${admission.detail}`,
      };
    }

    const result = await this.recordCheckIn(member.id, method);
    if (result.error) throw toMessage(result.error, 'Could not record the check-in.');

    // A second scan on the same day is a success from the front desk's point of
    // view - the member is in the building - so it is reported as success with
    // a flag, not as an error.
    return {
      success: true,
      alreadyCheckedIn: result.alreadyCheckedIn,
      member,
      attendance: result.attendance,
      date: today,
    };
  },

  /**
   * Writes the attendance row, at most one per member per club-local day.
   *
   * Prefers the log_attendance() helper, which is atomic and returns the
   * existing row when the member has already been seen today. When that helper
   * is not installed yet the same outcome is reproduced with a direct insert
   * plus a duplicate-key catch, so the app behaves correctly before and after
   * the migration is run.
   */
  async recordCheckIn(memberId, method = 'QR_SCAN') {
    if (!memberId) return { attendance: null, alreadyCheckedIn: false, error: 'No member given.' };

    const { data, error } = await supabase.rpc('log_attendance', {
      p_member_id: memberId,
      p_method: method,
    });

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return {
        attendance: row || null,
        alreadyCheckedIn: Boolean(row?.already_checked_in),
        error: null,
      };
    }

    // 42883 undefined_function / PGRST202: the helper is not installed.
    const missingFunction = error.code === '42883' || error.code === 'PGRST202';
    if (!missingFunction) return { attendance: null, alreadyCheckedIn: false, error };

    return this.recordCheckInWithoutHelper(memberId, method);
  },

  /**
   * Fallback path for a database where log_attendance() does not exist yet.
   *
   * attendance_date is left to the column default so the database still decides
   * which club-local day the row belongs to, exactly as the RPC does.
   */
  async recordCheckInWithoutHelper(memberId, method = 'QR_SCAN') {
    const { data, error } = await supabase
      .from('attendance')
      .insert([{ member_id: memberId, check_in_time: new Date().toISOString(), method }])
      .select('id, attendance_date, check_in_time, method')
      .single();

    if (!error) {
      return { attendance: data, alreadyCheckedIn: false, error: null };
    }

    // 23505 unique_violation: the daily unique index already holds a row for
    // this member and day. Read it back so the UI can show when they arrived.
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('attendance')
        .select('id, attendance_date, check_in_time, method')
        .eq('member_id', memberId)
        .order('check_in_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      return { attendance: existing || null, alreadyCheckedIn: true, error: null };
    }

    return { attendance: null, alreadyCheckedIn: false, error };
  },

  async checkout(attendanceId) {
    const { error } = await supabase
      .from('attendance')
      .update({ check_out_time: new Date().toISOString() })
      .eq('id', attendanceId);

    if (error) throw toMessage(error);
    return true;
  },

  /**
   * Attendance rows for many members over one month, in as few queries as
   * possible.
   *
   * Backs the current-month figure on the members list. The list shows up to 200
   * rows, so one query per member is not an option; this does it in chunks of
   * CHUNK_SIZE and hands the raw rows back for buildMemberMonthSummaries to
   * count, which keeps the arithmetic in one tested place.
   *
   * `monthEnd` is normally the club's today, because a month cannot be assessed
   * past today. It defaults to that so a caller cannot accidentally ask for the
   * whole month and report phantom absences for days that have not happened.
   */
  async getMonthAttendance({
    memberIds = [],
    monthStart,
    monthEnd,
    timeZone = DEFAULT_CLUB_TIMEZONE,
    limit = 6000,
  } = {}) {
    const ids = [...new Set((memberIds || []).filter(Boolean))];
    if (ids.length === 0) return [];

    const resolvedEnd = monthEnd || (await getClubToday({ timeZone }));
    if (!monthStart || !resolvedEnd || monthStart > resolvedEnd) return [];

    const collected = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const rows = await fetchMonthAttendanceChunk(chunk, {
        monthStart,
        monthEnd: resolvedEnd,
        timeZone,
        limit,
      });
      collected.push(...rows);
    }

    return collected;
  },

  async deleteLog(id) {
    const { error } = await supabase.from('attendance').delete().eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },
};
