import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { memberService } from './memberService';
import {
  DEFAULT_CLUB_TIMEZONE,
  getClubDayRangeIso,
  toDateKey,
  todayKey,
  totalSessionMinutes,
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
  second_check_in_time,
  second_check_out_time,
  second_checkout_method,
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

// Older databases reject the whole select when one column is unknown, and
// PostgREST reports that as PGRST204 / Postgres as 42703. Two variants let the
// screen keep working while the club catches up:
//   * phase 7 present but not phase 8 -> drop the second-session columns
//   * neither present                  -> also drop checkout_method
const ATTENDANCE_SELECT_P7 = ATTENDANCE_SELECT
  .replace(/\n\s*second_check_in_time,/, '')
  .replace(/\n\s*second_check_out_time,/, '')
  .replace(/\n\s*second_checkout_method,/, '');
const ATTENDANCE_SELECT_P6 = ATTENDANCE_SELECT_P7.replace(/\n\s*checkout_method,/, '');

function isMissingColumn(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || error.details || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST200' ||
    code === 'PGRST100' ||
    msg.includes('column') ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  );
}

// The row's sessions in order: the first visit, then the optional second one.
// A row written before phase 8 simply has no second-session fields, so this
// returns a single pair for it and every downstream count is unchanged.
function sessionPairs(row) {
  return [
    {
      checkIn: row.check_in_time,
      checkOut: row.check_out_time,
      method: row.checkout_method || null,
    },
    {
      checkIn: row.second_check_in_time,
      checkOut: row.second_check_out_time,
      method: row.second_checkout_method || null,
    },
  ].filter((session) => session.checkIn);
}

// Which session is still open, if any: 2 takes precedence because it is only
// ever started after the first has been closed.
function openSessionNumber(row) {
  if (row.second_check_in_time && !row.second_check_out_time) return 2;
  if (row.check_in_time && !row.check_out_time) return 1;
  return 0;
}

function withMember(row) {
  const activeMembership = row.members?.memberships?.find(
    (sub) => sub.status === 'Active' || sub.status === 'Expiring'
  );

  const pairs = sessionPairs(row);

  return {
    id: row.id,
    member_id: row.members?.id ?? null,
    member_name: row.members?.full_name || 'Unknown Member',
    member_code: row.members?.member_code || 'N/A',
    attendance_date: row.attendance_date || null,
    check_in_time: row.check_in_time,
    check_out_time: row.check_out_time,
    checkout_method: row.checkout_method || null,
    second_check_in_time: row.second_check_in_time || null,
    second_check_out_time: row.second_check_out_time || null,
    second_checkout_method: row.second_checkout_method || null,
    // Sum of the sessions that have ended. A day with a still-open session
    // reports only what is already measured, plus open_session for the UI.
    duration_minutes: totalSessionMinutes(pairs),
    open_session: hasOpenSession(row) ? openSessionNumber(row) : 0,
    sessions_count: pairs.length,
    method: row.method,
    notes: row.notes,
    status: row.members?.status === 'Active' ? 'Verified' : 'Flagged',
    plan_name: activeMembership?.plans?.name || 'No Active Plan',
  };
}

// True when any session on the row is still open.
function hasOpenSession(row) {
  return Boolean(
    (row.check_in_time && !row.check_out_time) ||
      (row.second_check_in_time && !row.second_check_out_time)
  );
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
    if (error && isMissingColumn(error)) ({ data, error } = await run(ATTENDANCE_SELECT_P7));
    if (error && isMissingColumn(error)) ({ data, error } = await run(ATTENDANCE_SELECT_P6));
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
      'id, attendance_date, check_in_time, check_out_time, checkout_method, second_check_in_time, second_check_out_time, second_checkout_method, method, notes';
    const MEMBER_COLUMNS_P7 =
      'id, attendance_date, check_in_time, check_out_time, checkout_method, method, notes';
    const MEMBER_COLUMNS_P6 =
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
    if (error && isMissingColumn(error)) ({ data, error } = await run(MEMBER_COLUMNS_P7));
    if (error && isMissingColumn(error)) ({ data, error } = await run(MEMBER_COLUMNS_P6));
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
    if (error && isMissingColumn(error)) ({ data, error } = await run(ATTENDANCE_SELECT_P7));
    if (error && isMissingColumn(error)) ({ data, error } = await run(ATTENDANCE_SELECT_P6));
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
   * One scan at the door, resolved into the day's next step, without the member
   * or staff pressing anything.
   *
   * A member may train twice a day, so the day holds up to two sessions and the
   * scan walks them forward:
   *
   *   no session today               -> session 1 check-in   (action 'IN',  session 1)
   *   session 1 open                 -> session 1 check-out  (action 'OUT', session 1)
   *   session 1 closed, no session 2 -> session 2 check-in   (action 'IN',  session 2, reentry)
   *   session 2 open                 -> session 2 check-out  (action 'OUT', session 2)
   *   both sessions closed           -> refused              (limitReached)
   *
   * Time spent is the sum of the two closed sessions, so the gap between them
   * is not counted.
   *
   * Leaving is never gated on membership: a member whose plan lapsed during the
   * day must still be able to close their session. Only the arrival side runs
   * the admission checks.
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
    const row = await this.getTodaySession(member.id, { timeZone, today });

    if (row) {
      const session1Open = row.check_in_time && !row.check_out_time;
      const session2Open = row.second_check_in_time && !row.second_check_out_time;

      // Departure: close whichever session is still open (the second first,
      // in the impossible case both are).
      if (session2Open || session1Open) {
        const session = session2Open ? 2 : 1;
        const result = await this.recordCheckOut(row.id, method, session);
        if (result.error) throw toMessage(result.error, 'Could not record the check-out.');
        return {
          success: true,
          action: 'OUT',
          session,
          member,
          attendance: result.attendance,
          date: today,
        };
      }

      // Both sessions complete: the day's allowance is spent.
      if (
        row.check_in_time &&
        row.check_out_time &&
        row.second_check_in_time &&
        row.second_check_out_time
      ) {
        return {
          success: false,
          limitReached: true,
          member,
          error: `${member.full_name} has already completed both sessions for today.`,
        };
      }

      // Session 1 done and no session 2 yet: the second arrival of the day.
      if (row.check_in_time && row.check_out_time && !row.second_check_in_time) {
        const refusal = membershipRefusal(member, today);
        if (refusal) return { success: false, member, error: refusal };

        const result = await this.recordCheckInSecond(row.id);
        if (result.error) throw toMessage(result.error, 'Could not record the check-in.');
        return {
          success: true,
          action: 'IN',
          session: 2,
          reentry: true,
          member,
          attendance: result.attendance,
          date: today,
        };
      }
    }

    // First arrival of the day, so the membership rules apply.
    const refusal = membershipRefusal(member, today);
    if (refusal) return { success: false, member, error: refusal };

    const result = await this.recordCheckIn(member.id, method);
    if (result.error) throw toMessage(result.error, 'Could not record the check-in.');

    return {
      success: true,
      action: 'IN',
      session: 1,
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

    // Each variant drops the columns the previous one could not find.
    const variants = [
      'id, attendance_date, check_in_time, check_out_time, method, checkout_method, second_check_in_time, second_check_out_time, second_checkout_method',
      'id, attendance_date, check_in_time, check_out_time, method, checkout_method',
      'id, attendance_date, check_in_time, check_out_time, method',
    ];

    let result = null;
    for (const columns of variants) {
      // eslint-disable-next-line no-await-in-loop
      result = await supabase
        .from('attendance')
        .select(columns)
        .eq('member_id', memberId)
        .eq('attendance_date', date)
        .order('check_in_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!result.error || !isMissingColumn(result.error)) break;
    }

    if (result.error) throw toMessage(result.error);
    return result.data || null;
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
   * Closes session 1 by id. Used by the manual check-out button on the
   * attendance screen, where the actor is staff at the desk, so the default
   * method is MANUAL_ENTRY.
   *
   * The `.is('check_out_time', null)` guard makes a double click (or two staff
   * at once) close the session only once: the second update matches no row.
   */
  async checkout(attendanceId, method = 'MANUAL_ENTRY') {
    return this.closeAttendanceSession(attendanceId, 1, method);
  },

  /**
   * Closes an open SECOND session by id. Same contract as checkout().
   */
  async checkoutSecond(attendanceId, method = 'MANUAL_ENTRY') {
    return this.closeAttendanceSession(attendanceId, 2, method);
  },

  /**
   * The shared close: writes a departure on session 1 or session 2, guarded on
   * that session still being open so a double click closes it once. Session 1
   * steps down through the phase 7 / phase 6 columns; session 2 only exists
   * from phase 8, so it has a single attempt.
   */
  async closeAttendanceSession(attendanceId, session = 1, method = 'MANUAL_ENTRY') {
    if (!attendanceId) throw new Error('No attendance row given.');

    const isSecond = session === 2;
    const stamp = new Date().toISOString();
    const guard = isSecond ? 'second_check_out_time' : 'check_out_time';

    const attempts = isSecond
      ? [
          {
            update: { second_check_out_time: stamp, second_checkout_method: method },
            columns:
              'id, attendance_date, check_in_time, check_out_time, method, checkout_method, second_check_in_time, second_check_out_time, second_checkout_method',
          },
        ]
      : [
          {
            update: { check_out_time: stamp, checkout_method: method },
            columns: 'id, attendance_date, check_in_time, check_out_time, method, checkout_method',
          },
          {
            update: { check_out_time: stamp },
            columns: 'id, attendance_date, check_in_time, check_out_time, method',
          },
        ];

    let data = null;
    let error = null;
    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop
      ({ data, error } = await supabase
        .from('attendance')
        .update(attempt.update)
        .eq('id', attendanceId)
        .is(guard, null)
        .select(attempt.columns)
        .maybeSingle());

      if (!error || !isMissingColumn(error)) break;
    }

    if (error) throw toMessage(error);

    // No row matched: it was already closed. Not an error for the desk.
    if (!data) return { alreadyClosed: true, attendance: null };
    return { alreadyClosed: false, attendance: data };
  },

  /**
   * Scanner-facing close: returns the row and never throws, so the scan result
   * can report a friendly message. `session` selects which of the two the scan
   * is ending.
   */
  async recordCheckOut(attendanceId, method = 'QR_SCAN', session = 1) {
    try {
      const result = await this.closeAttendanceSession(attendanceId, session, method);
      if (result.alreadyClosed) {
        return { attendance: null, error: { message: 'That session was already closed.' } };
      }
      return { attendance: result.attendance, error: null };
    } catch (err) {
      return { attendance: null, error: err };
    }
  },

  /**
   * Starts the day's SECOND session on an existing row, leaving the first
   * session's arrival and departure exactly as they were.
   *
   * Before phase 8 the second-session columns do not exist, so this falls back
   * to reopening the first session - the phase 7 "welcome back" behaviour - and
   * the day simply stays single-session until the migration is applied.
   */
  async recordCheckInSecond(attendanceId) {
    if (!attendanceId) {
      return { attendance: null, error: { message: 'No attendance row given.' } };
    }

    const { data, error } = await supabase
      .from('attendance')
      .update({ second_check_in_time: new Date().toISOString(), second_checkout_method: null })
      .eq('id', attendanceId)
      .select(
        'id, attendance_date, check_in_time, check_out_time, method, checkout_method, second_check_in_time, second_check_out_time, second_checkout_method'
      )
      .maybeSingle();

    if (error && isMissingColumn(error)) {
      const reopened = await supabase
        .from('attendance')
        .update({ check_out_time: null })
        .eq('id', attendanceId)
        .select('id, attendance_date, check_in_time, check_out_time, method, checkout_method')
        .maybeSingle();

      if (reopened.error) return { attendance: null, error: reopened.error };
      return { attendance: reopened.data || null, error: null };
    }

    if (error) return { attendance: null, error };
    return { attendance: data || null, error: null };
  },

  /**
   * Closes every session left open on a previous club-local day, at the club's
   * closing time, and flags those rows AUTO_CLOSE. Both the first and the
   * second session of a day are closed independently (phase 8).
   *
   * Backed by public.close_forgotten_attendance(), which keeps the whole sweep
   * in one statement inside the database so the club timezone and the closing
   * time are applied there, not by whichever browser is open. On a database
   * where the function has not been applied the function is simply missing, and
   * the screen carries on: nothing to tidy yet.
   */
  async closeForgottenSessions() {
    const { data, error } = await supabase.rpc('close_forgotten_attendance');

    if (!error) return { closed: Number(data) || 0, skipped: false };

    // 42883 undefined_function / PGRST202: phase 7/8 not applied yet.
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
