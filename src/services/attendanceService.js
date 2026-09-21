import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { memberService } from './memberService';

export const attendanceService = {
  async getAttendanceLogs() {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem('be_smart_attendance');
      return stored ? JSON.parse(stored) : [];
    }

    const { data, error } = await supabase
      .from('attendance')
      .select(`
        id,
        check_in_time,
        method,
        notes,
        members (
          id,
          full_name,
          member_code,
          status,
          memberships (
            status,
            plans ( name )
          )
        )
      `)
      .order('check_in_time', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching attendance:', error);
      return [];
    }

    return (data || []).map((att) => {
      const activeMembership = att.members?.memberships?.find((s) => s.status === 'Active');
      return {
        id: att.id,
        member_id: att.members?.id,
        member_name: att.members?.full_name || 'Unknown Member',
        member_code: att.members?.member_code || 'N/A',
        check_in_time: att.check_in_time,
        method: att.method,
        status: att.members?.status === 'Active' ? 'Verified' : 'Flagged',
        plan_name: activeMembership?.plans?.name || 'No Active Plan',
      };
    });
  },

  async logCheckIn(qrOrMemberCode, method = 'QR_SCAN') {
    const member = await memberService.getMemberByQR(qrOrMemberCode);
    if (!member) {
      return {
        success: false,
        error: 'Member record not found. Invalid QR code or Member ID.',
      };
    }

    if (member.status !== 'Active') {
      return {
        success: false,
        member,
        error: `Check-in denied! Member status is '${member.status}'. Please renew subscription.`,
      };
    }

    if (!isSupabaseConfigured) {
      const existing = await this.getAttendanceLogs();
      const newEntry = {
        id: `att-${Date.now()}`,
        member_name: member.full_name,
        member_code: member.member_code,
        check_in_time: new Date().toISOString(),
        method,
        status: 'Verified',
        plan_name: member.plan_name,
      };

      const updated = [newEntry, ...existing];
      localStorage.setItem('be_smart_attendance', JSON.stringify(updated));
      return {
        success: true,
        member,
        attendance: newEntry,
      };
    }

    const { data, error } = await supabase
      .from('attendance')
      .insert([
        {
          member_id: member.id,
          check_in_time: new Date().toISOString(),
          method,
        },
      ])
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      member,
      attendance: data,
    };
  },
};
