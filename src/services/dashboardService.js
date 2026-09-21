import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { memberService } from './memberService';
import { attendanceService } from './attendanceService';
import { paymentService } from './paymentService';

export const dashboardService = {
  async getDashboardSummary() {
    if (!isSupabaseConfigured) {
      const members = await memberService.getMembers();
      const attendance = await attendanceService.getAttendanceLogs();
      const payments = await paymentService.getPayments();

      const activeMembersCount = members.filter((m) => m.status === 'Active').length || 482;
      const todayAttendanceCount = attendance.length || 174;
      const totalRevenue = payments.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0) || 19450;
      const expiringCount = members.filter((m) => m.status === 'Expired' || m.expiration_date?.includes('day')).length || 18;

      return {
        activeMembersCount,
        todayAttendanceCount,
        totalRevenue,
        expiringCount,
        recentCheckIns: attendance.slice(0, 4),
        expiringMemberships: members.slice(0, 3),
      };
    }

    try {
      // Fetch active members count
      const { count: activeMembersCount } = await supabase
        .from('members')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Active');

      // Fetch today's attendance count
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { count: todayAttendanceCount } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .gte('check_in_time', todayStart.toISOString());

      // Fetch total payments amount
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('payment_status', 'Paid');

      const totalRevenue = (payments || []).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

      // Fetch expiring memberships (ending within 7 days)
      const { count: expiringCount } = await supabase
        .from('memberships')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Active')
        .lte('end_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);

      // Fetch recent check-ins
      const recentCheckIns = await attendanceService.getAttendanceLogs();
      const membersList = await memberService.getMembers();

      return {
        activeMembersCount: activeMembersCount || 0,
        todayAttendanceCount: todayAttendanceCount || 0,
        totalRevenue: totalRevenue || 0,
        expiringCount: expiringCount || 0,
        recentCheckIns: recentCheckIns.slice(0, 5),
        expiringMemberships: membersList.slice(0, 4),
      };
    } catch (err) {
      console.error('Error fetching dashboard summary:', err);
      return {
        activeMembersCount: 0,
        todayAttendanceCount: 0,
        totalRevenue: 0,
        expiringCount: 0,
        recentCheckIns: [],
        expiringMemberships: [],
      };
    }
  },
};
