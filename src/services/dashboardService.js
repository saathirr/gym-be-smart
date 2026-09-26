import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { startOfDay, startOfMonth, subDays, subMonths, addDays, format } from 'date-fns';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfToday() {
  return startOfDay(new Date()).toISOString();
}

function toDateString(date) {
  return format(date, 'yyyy-MM-dd');
}

export const dashboardService = {
  async getDashboardSummary() {
    // Best-effort: without this the "active members" tile is stale until
    // somebody opens the Memberships screen.
    await supabase.rpc('sync_expired_memberships').then(null, () => {});

    const today = startOfToday();
    const weekAgo = subDays(new Date(), 6).toISOString();
    const monthStart = startOfMonth(new Date()).toISOString();
    const sixMonthsAgo = startOfMonth(subMonths(new Date(), 5)).toISOString();
    // The card is labelled "within 7 days", so the list has to match that
    // window instead of the whole month.
    const expiringCutoff = toDateString(addDays(new Date(), 7));

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

      supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .gte('check_in_time', today),

      supabase
        .from('payments')
        .select('amount')
        .eq('payment_status', 'Paid')
        .gte('transaction_date', monthStart),

      supabase
        .from('payments')
        .select('amount')
        .eq('payment_status', 'Paid'),

      supabase
        .from('attendance')
        .select('check_in_time')
        .gte('check_in_time', weekAgo),

      supabase
        .from('payments')
        .select('amount, transaction_date')
        .eq('payment_status', 'Paid')
        .gte('transaction_date', sixMonthsAgo),

      supabase
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .in('status', ['Active', 'Expiring'])
        .gte('end_date', toDateString(new Date()))
        .lte('end_date', expiringCutoff),

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
        .gte('end_date', toDateString(new Date()))
        .lte('end_date', expiringCutoff)
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
      weeklyAttendance: buildWeeklyAttendance(weeklyRows.data || []),
      monthlyRevenue: buildMonthlyRevenue(revenueRows.data || []),
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
  async getPeakHours(days = 7) {
    const since = subDays(new Date(), days - 1).toISOString();

    const { data, error } = await supabase
      .from('attendance')
      .select('check_in_time')
      .gte('check_in_time', since);

    if (error) throw toMessage(error);

    const buckets = Array.from({ length: 24 }, () => 0);
    (data || []).forEach((row) => {
      const hour = new Date(row.check_in_time).getHours();
      buckets[hour] += 1;
    });

    return buckets.map((count, hour) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      count,
    }));
  },
};

function sumAmounts(rows) {
  return (rows || []).reduce((total, row) => total + (Number(row.amount) || 0), 0);
}

function buildWeeklyAttendance(rows) {
  const counts = Array(7).fill(0);
  const today = startOfDay(new Date());

  rows.forEach((row) => {
    const date = startOfDay(new Date(row.check_in_time));
    const diffDays = Math.round((today - date) / 86400000);
    if (diffDays >= 0 && diffDays < 7) {
      counts[6 - diffDays] += 1;
    }
  });

  // Label the actual dates in the window rather than assuming it starts on a
  // Monday, which is only true when today happens to be a Sunday.
  return counts.map((count, index) => ({
    day: format(addDays(today, index - 6), 'EEE dd'),
    count,
  }));
}

function buildMonthlyRevenue(rows) {
  const totals = new Array(12).fill(0);
  const now = new Date();
  const startIndex = (now.getMonth() - 5 + 12) % 12;

  rows.forEach((row) => {
    const date = new Date(row.transaction_date);
    const month = date.getMonth();
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
