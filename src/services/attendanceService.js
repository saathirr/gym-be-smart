import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { memberService } from './memberService';
import {
  DEFAULT_CLUB_TIMEZONE,
  getClubDayRangeIso,
  sessionMinutes,
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
  checkout_method,
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

// Pre-phase-7 databases have no checkout_method column, and PostgREST rejects
// the whole select when one column is unknown. This variant is retried once on
// that error so the attendance screen keeps working (minus the forgotten
// check-out flag) until the phase 7 migration is run.
const ATTENDANCE_SELECT_LEGACY = ATTENDANCE_SELECT.replace(/\n\s*checkout_method,/, '');

// PostgREST reports an unknown column as PGRST204, Postgres as 42703. Both mean
// "this database predates that column", which is a fallback and not an error
// worth surfacing: the caller retries with the older select instead.
function isMissingColumn(error) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

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
    checkout_method: row.checkout_method || null,
    duration_minutes: sessionMinutes(row.check_in_time, row.check_out_time),
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
  if (!isMissingColumn(error)) throw toMessage(error);

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

/**
 * Why a member may not be admitted, or null when they may.
 *
 * The three checks run in order of specificity so the front desk gets the
 * clearest message: a suspended account, then a lapsed membership with the
 * exact expiry date, then the shared admission rule (an OPEN subscription
 * whose dates actually cover today). Check-out never calls this - a member is
 * always allowed to leave.
 */
function membershipRefusal(member, today) {
  if (member.status !== 'Active') {
    return `Access denied - ${member.full_name} is marked "${member.status}". Renew the membership first.`;
  }

  // An end_date is inclusive: a membership ending today is still valid for
  // the whole of that day. Comparing dates as keys in the club's zone avoids
  // both the UTC-midnight trap and the browser's own timezone.
  if (member.expiration_date && toDateKey(member.expiration_date) < today) {
    return `Access denied - the membership for ${member.full_name} expired on ${member.expiration_date}.`;
  }

  // Final authority, shared with the gym card and the dashboard: an OPEN
  // subscription (Active or Expiring) whose dates actually cover today.
  const admission = evaluateMembershipAdmission(member, today);
  if (!admission.allowed) {
    return `Access denied - ${admission.detail}`;
  }

  return null;
}

export const attendanceService = {
  getClubToday,

  async getAttendanceLogs({ search = '', date = 'ALL', limit = 300, timeZone } = {}) {
    const today = date === 'TODAY' ? await getClubToday({ timeZone }) : null;

    const run = (columns) => {
      let query = supabase
        .from('attendance')
        .select(columns)
        .order('check_in_time', { ascending: false })
        .limit(limit);

      if (date === 'TODAY') {
        // Filtered on the stored club-local date, not on the timestamp, so the
        // log is correct regardless of where the browser thinks it is.
        query = query.eq('attendance_date', today);
      }

      return query;
    };

    let { data, error } = await run(ATTENDANCE_SELECT);
    if (error && isMissingColumn(error)) {
      ({ data, error } = await run(ATTENDANCE_SELECT_LEGACY));
    }
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

    const MEMBER_COLUMNS =
      'id, attendance_date, check_in_time, check_out_time, checkout_method, method, notes';
    const MEMBER_COLUMNS_LEGACY =
      'id, attendance_date, check_in_time, check_out_time, method, notes';

    const run = (columns) => {
      let query = supabase
        .from('attendance')
        .select(columns)
        .eq('member_id', memberId)
        .order('attendance_date', { ascending: false })
        .limit(limit);

      // Both bounds are inclusive club-local dates.
      if (from) query = query.gte('attendance_date', from);
      if (to) query = query.lte('attendance_date', to);
      return query;
    };

    let { data, error } = await run(MEMBER_COLUMNS);
    if (error && isMissingColumn(error)) {
      ({ data, error } = await run(MEMBER_COLUMNS_LEGACY));
    }
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

    const run = (columns) =>
      supabase
        .from('attendance')
        .select(columns)
        .eq('attendance_date', date)
        .order('check_in_time', { ascending: true })
        .limit(limit);

    let { data, error } = await run(ATTENDANCE_SELECT);
    if (error && isMissingColumn(error)) {
      ({ data, error } = await run(ATTENDANCE_SELECT_LEGACY));
    }
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

    const today = await getClubToday({ timeZone });
    const refusal = membershipRefusal(member, today);
    if (refusal) {
      return { success: false, member, error: refusal };
    }

    const result = await this.recordCheckIn(member.id, method);
    if (result.error) throw toMessage(result.error, 'Could not record the check-in.');

    // A second scan on the same day is a success from the front desk's point of
    // view - the member is in the building - so it is reported as success with
    // a flag, not as an error.
    return {
      success: true,
      action: 'IN',
      alreadyCheckedIn: result.alreadyCheckedIn,
      member,
      attendance: result.attendance,
      date: today,
    };
  },

  /**
   * One scan at the door, resolved into a check-in, a check-out, or a welcome
   * back, without the member or staff pressing anything.
   *
   * The day's row holds the first arrival and the latest departure, so the
   * scan is a toggle:
   *
   *   no session today        -> check in  (action 'IN')
   *   session open            -> check out (action 'OUT')
   *   session already closed  -> reopen    (action 'IN', reentry: true)
   *
   * Leaving is never gated on membership: a member whose plan lapsed during
   * the day must still be able to close their session. Only the arrival side
   * runs the admission checks.
   */
  async toggleAttendance(passValue, method = 'QR_SCAN', { timeZone } = {}) {
    const member = await memberService.getMemberByPass(passValue);
    if (!member) {
      return {
        success: false,
        error: 'No member matches that code. Check the QR pass or member ID.',
      };
    }

    const today = await getClubToday({ timeZone });
    const session = await this.getTodaySession(member.id, { timeZone, today });

    // Open session: this scan is a departure.
    if (session && !session.check_out_time) {
      const result = await this.recordCheckOut(session.id, method);
      if (result.error) throw toMessage(result.error, 'Could not record the check-out.');
      return {
        success: true,
        action: 'OUT',
        member,
        attendance: result.attendance,
        date: today,
      };
    }

    // Arrival (first of the day, or back after an earlier check-out), so the
    // membership rules apply.
    const refusal = membershipRefusal(member, today);
    if (refusal) {
      return { success: false, member, error: refusal };
    }

    if (session && session.check_out_time) {
      const result = await this.recordReentry(session.id);
      if (result.error) throw toMessage(result.error, 'Could not record the check-in.');
      return {
        success: true,
        action: 'IN',
        reentry: true,
        member,
        attendance: result.attendance,
        date: today,
      };
    }

    const result = await this.recordCheckIn(member.id, method);
    if (result.error) throw toMessage(result.error, 'Could not record the check-in.');

    return {
      success: true,
      action: 'IN',
      alreadyCheckedIn: result.alreadyCheckedIn,
      member,
      attendance: result.attendance,
      date: today,
    };
  },

  /**
   * Today's attendance row for one member, or null.
   *
   * The daily unique index guarantees at most one row; the order + limit keep
   * maybeSingle() from erroring on a pre-migration database that still holds
   * duplicates.
   */
  async getTodaySession(memberId, { timeZone, today } = {}) {
    if (!memberId) return null;

    const date = today || (await getClubToday({ timeZone }));

    const { data, error } = await supabase
      .from('attendance')
      .select('id, attendance_date, check_in_time, check_out_time, method, checkout_method')
      .eq('member_id', memberId)
      .eq('attendance_date', date)
      .order('check_in_time', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      // checkout_method may not exist yet; retry without it rather than
      // failing the whole scan.
      if (!isMissingColumn(error)) throw toMessage(error);

      const legacy = await supabase
        .from('attendance')
        .select('id, attendance_date, check_in_time, check_out_time, method')
        .eq('member_id', memberId)
        .eq('attendance_date', date)
        .order('check_in_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (legacy.error) throw toMessage(legacy.error);
      return legacy.data || null;
    }

    return data || null;
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

  /**
   * Closes an open session by id. Used by the manual check-out button on the
   * attendance screen, where the actor is staff at the desk, so the default
   * method is MANUAL_ENTRY.
   *
   * The `.is('check_out_time', null)` guard makes a double click (or two staff
   * at once) close the session only once: the second update matches no row.
   */
  async checkout(attendanceId, method = 'MANUAL_ENTRY') {
    if (!attendanceId) throw new Error('No attendance row given.');

    let { data, error } = await supabase
      .from('attendance')
      .update({ check_out_time: new Date().toISOString(), checkout_method: method })
      .eq('id', attendanceId)
      .is('check_out_time', null)
      .select('id, attendance_date, check_in_time, check_out_time, method, checkout_method')
      .maybeSingle();

    // A pre-phase-7 database has no checkout_method column; retry without it so
    // the manual close still works.
    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase
        .from('attendance')
        .update({ check_out_time: new Date().toISOString() })
        .eq('id', attendanceId)
        .is('check_out_time', null)
        .select('id, attendance_date, check_in_time, check_out_time, method')
        .maybeSingle());
    }

    if (error) throw toMessage(error);

    // No row matched: it was already closed. Not an error for the desk.
    if (!data) return { alreadyClosed: true, attendance: null };
    return { alreadyClosed: false, attendance: data };
  },

  /**
   * Closes today's open session, returning the row and how long the member
   * stayed. Delegates to checkout() so the guard and the method are shared.
   */
  async recordCheckOut(attendanceId, method = 'QR_SCAN') {
    try {
      const result = await this.checkout(attendanceId, method);
      if (result.alreadyClosed) {
        return { attendance: null, error: { message: 'That session was already closed.' } };
      }
      return { attendance: result.attendance, error: null };
    } catch (err) {
      return { attendance: null, error: err };
    }
  },

  /**
   * Reopens a session the member already closed earlier today.
   *
   * The check-in time is deliberately left alone: the day's row keeps the
   * FIRST arrival and takes the NEXT departure, so "time spent" measures the
   * whole span they were at the club rather than only the last visit.
   */
  async recordReentry(attendanceId) {
    if (!attendanceId) return { attendance: null, error: { message: 'No attendance row given.' } };

    let { data, error } = await supabase
      .from('attendance')
      .update({ check_out_time: null, checkout_method: null })
      .eq('id', attendanceId)
      .select('id, attendance_date, check_in_time, check_out_time, method, checkout_method')
      .maybeSingle();

    if (error && isMissingColumn(error)) {
      ({ data, error } = await supabase
        .from('attendance')
        .update({ check_out_time: null })
        .eq('id', attendanceId)
        .select('id, attendance_date, check_in_time, check_out_time, method')
        .maybeSingle());
    }

    if (error) return { attendance: null, error };
    return { attendance: data || null, error: null };
  },

  /**
   * Closes every session left open on a previous club-local day, at the club's
   * closing time, and flags those rows AUTO_CLOSE (phase 7).
   *
   * Backed by public.close_forgotten_attendance(), which keeps the whole sweep
   * in one statement inside the database so the club timezone and the closing
   * time are applied there, not by whichever browser is open. On a database
   * where phase 7 has not been applied the function is simply missing, and the
   * screen carries on: nothing to tidy yet.
   */
  async closeForgottenSessions() {
    const { data, error } = await supabase.rpc('close_forgotten_attendance');

    if (!error) return { closed: Number(data) || 0, skipped: false };

    // 42883 undefined_function / PGRST202: phase 7 not applied yet.
    if (error.code === '42883' || error.code === 'PGRST202') {
      return { closed: 0, skipped: true };
    }

    throw toMessage(error);
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
