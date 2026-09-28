import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { getClubToday } from './attendanceService';
import {
  DEFAULT_CLUB_TIMEZONE,
  addDays,
  dayOfMonth,
  getClubDayRangeIso,
  getClubHour,
  monthBounds,
  parseKey,
  toDateKey,
  weekdayLabel,
} from '../utils/attendanceMath';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dashboardService = {
  async getDashboardSummary({ timeZone = DEFAULT_CLUB_TIMEZONE } = {}) {
    // Best-effort: without this the "active members" tile is stale until
    // somebody opens the Memberships screen.
    await supabase.rpc('sync_expired_memberships').then(null, () => {});

    const clubToday = await getClubToday({ timeZone });
    const weekStartKey = addDays(clubToday, -6);
    const expiringCutoffKey = addDays(clubToday, 7);

    const bounds = monthBounds(clubToday);
    const monthStart = bounds ? bounds.monthStart : `${clubToday.slice(0, 7)}-01`;

    const todayParts = parseKey(clubToday);
    let sixMonthsStart = monthStart;
    if (todayParts) {
      let y = todayParts.year;
      let m = todayParts.month - 5;
      if (m <= 0) {
        m += 12;
        y -= 1;
      }
      sixMonthsStart = `${y}-${String(m).padStart(2, '0')}-01`;
    }

    const [
      activeMembers,
      todayAttendance,
      monthRevenue,
      totalRevenue,
      weeklyRows,
      revenueRows,
      expiringCount,
      expiringMembers,
      recentCheckIns,
    ] = await Promise.all([
      supabase
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Active'),

      getTodayAttendanceQuery(clubToday, timeZone),

      supabase
        .from('payments')
        .select('amount')
        .eq('payment_status', 'Paid')
        .gte('transaction_date', monthStart),

      supabase
        .from('payments')
        .select('amount')
        .eq('payment_status', 'Paid'),

      getWeeklyAttendanceQuery(weekStartKey, clubToday, timeZone),

      supabase
        .from('payments')
        .select('amount, transaction_date')
        .eq('payment_status', 'Paid')
        .gte('transaction_date', sixMonthsStart),

      supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .in('status', ['Active', 'Expiring'])
        .gte('end_date', clubToday)
        .lte('end_date', expiringCutoffKey),

      supabase
        .from('memberships')
        .select(
          `
            id,
            end_date,
            plans ( name, price ),
            members ( id, full_name, member_code, phone, status )
          `
        )
        .in('status', ['Active', 'Expiring'])
        .gte('end_date', clubToday)
        .lte('end_date', expiringCutoffKey)
        .order('end_date', { ascending: true })
        .limit(6),

      supabase
        .from('attendance')
        .select(
          `
            id,
            check_in_time,
            method,
            members ( id, full_name, member_code )
          `
        )
        .order('check_in_time', { ascending: false })
        .limit(6),
    ]);

    const failures = [
      activeMembers.error,
      todayAttendance.error,
      monthRevenue.error,
      totalRevenue.error,
      weeklyRows.error,
      revenueRows.error,
      expiringCount.error,
      expiringMembers.error,
      recentCheckIns.error,
    ].filter(Boolean);

    if (failures.length > 0) {
      throw failures[0];
    }

    return {
      activeMembersCount: activeMembers.count ?? 0,
      todayAttendanceCount: todayAttendance.count ?? 0,
      monthRevenue: sumAmounts(monthRevenue.data),
      totalRevenue: sumAmounts(totalRevenue.data),
      expiringCount: expiringCount.count ?? 0,
      weeklyAttendance: buildWeeklyAttendance(weeklyRows.data || [], clubToday, timeZone),
      monthlyRevenue: buildMonthlyRevenue(revenueRows.data || [], clubToday),
      recentCheckIns: (recentCheckIns.data || []).map((row) => ({
        id: row.id,
        check_in_time: row.check_in_time,
        method: row.method,
        member_name: row.members?.full_name || 'Unknown Member',
        member_code: row.members?.member_code || 'N/A',
      })),
      expiringMemberships: (expiringMembers.data || []).map((row) => ({
        id: row.id,
        full_name: row.members?.full_name || 'Unknown Member',
        member_code: row.members?.member_code || 'N/A',
        phone: row.members?.phone || 'No phone',
        plan_name: row.plans?.name || 'No plan',
        expiration_date: row.end_date,
      })),
    };
  },

  // Head-count hour by hour, used by the Reports screen.
  async getPeakHours(days = 7, { timeZone = DEFAULT_CLUB_TIMEZONE } = {}) {
    const clubToday = await getClubToday({ timeZone });
    const startDateKey = addDays(clubToday, -(days - 1));

    const { data, error } = await getPeakHoursQuery(startDateKey, clubToday, timeZone);
    if (error) throw toMessage(error);

    const buckets = Array.from({ length: 24 }, () => 0);
    (data || []).forEach((row) => {
      if (row.check_in_time) {
        const hour = getClubHour(row.check_in_time, timeZone);
        if (hour !== null && hour >= 0 && hour < 24) {
          buckets[hour] += 1;
        }
      }
    });

    return buckets.map((count, hour) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      count,
    }));
  },
};

async function getTodayAttendanceQuery(clubToday, timeZone) {
  const res = await supabase
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('attendance_date', clubToday);

  if (res.error && res.error.code === '42703') {
    const { startIso, endIso } = getClubDayRangeIso(clubToday, timeZone);
    return supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .gte('check_in_time', startIso)
      .lte('check_in_time', endIso);
  }

  return res;
}

async function getWeeklyAttendanceQuery(startDateKey, endDateKey, timeZone) {
  const res = await supabase
    .from('attendance')
    .select('id, attendance_date, check_in_time')
    .gte('attendance_date', startDateKey)
    .lte('attendance_date', endDateKey);

  if (res.error && res.error.code === '42703') {
    const { startIso } = getClubDayRangeIso(startDateKey, timeZone);
    const { endIso } = getClubDayRangeIso(endDateKey, timeZone);
    return supabase
      .from('attendance')
      .select('id, check_in_time')
      .gte('check_in_time', startIso)
      .lte('check_in_time', endIso);
  }

  return res;
}

async function getPeakHoursQuery(startDateKey, endDateKey, timeZone) {
  const res = await supabase
    .from('attendance')
    .select('check_in_time')
    .gte('attendance_date', startDateKey)
    .lte('attendance_date', endDateKey);

  if (res.error && res.error.code === '42703') {
    const { startIso } = getClubDayRangeIso(startDateKey, timeZone);
    const { endIso } = getClubDayRangeIso(endDateKey, timeZone);
    return supabase
      .from('attendance')
      .select('check_in_time')
      .gte('check_in_time', startIso)
      .lte('check_in_time', endIso);
  }

  return res;
}

function sumAmounts(rows) {
  return (rows || []).reduce((total, row) => total + (Number(row.amount) || 0), 0);
}

function buildWeeklyAttendance(rows, clubToday, timeZone = DEFAULT_CLUB_TIMEZONE) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    days.push(addDays(clubToday, -i));
  }

  const countsMap = {};
  days.forEach((key) => {
    countsMap[key] = 0;
  });

  rows.forEach((row) => {
    const key = row.attendance_date
      ? toDateKey(row.attendance_date, timeZone)
      : toDateKey(row.check_in_time, timeZone);

    if (key && countsMap[key] !== undefined) {
      countsMap[key] += 1;
    }
  });

  return days.map((key) => ({
    day: `${weekdayLabel(key)} ${String(dayOfMonth(key)).padStart(2, '0')}`,
    count: countsMap[key],
  }));
}

function buildMonthlyRevenue(rows, clubToday) {
  const totals = new Array(12).fill(0);
  const parts = parseKey(clubToday);
  const currentMonthZeroIndexed = parts ? parts.month - 1 : new Date().getMonth();
  const startIndex = (currentMonthZeroIndexed - 5 + 12) % 12;

  rows.forEach((row) => {
    if (!row.transaction_date) return;
    const dKey = toDateKey(row.transaction_date);
    const dParts = parseKey(dKey);
    if (!dParts) return;
    const month = dParts.month - 1;
    const offset = (month - startIndex + 12) % 12;
    if (offset < 6) {
      totals[offset] += Number(row.amount) || 0;
    }
  });

  return totals.map((revenue, index) => ({
    month: MONTH_LABELS[(startIndex + index) % 12],
    revenue,
  }));
}
