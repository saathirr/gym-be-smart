import { supabase } from '../lib/supabase';
import { memberService } from './memberService';

const ATTENDANCE_SELECT = `
  id,
  member_id,
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
    check_in_time: row.check_in_time,
    check_out_time: row.check_out_time,
    method: row.method,
    notes: row.notes,
    status: row.members?.status === 'Active' ? 'Verified' : 'Flagged',
    plan_name: activeMembership?.plans?.name || 'No Active Plan',
  };
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

// An end_date is inclusive: a membership ending 2026-09-26 is still valid
// for the whole of that day. Comparing raw Date objects would parse it as
// midnight and lock the member out from 00:00.
function isExpired(endDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${endDate}T00:00:00`) < today;
}

export const attendanceService = {
  async getAttendanceLogs({ search = '', date = 'ALL', limit = 300 } = {}) {
    let query = supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .order('check_in_time', { ascending: false })
      .limit(limit);

    if (date === 'TODAY') {
      query = query.gte('check_in_time', startOfToday());
    }

    const { data, error } = await query;
    if (error) throw error;

    const logs = (data || []).map(withMember);

    if (!search.trim()) return logs;
    const term = search.trim().toLowerCase();

    return logs.filter(
      (log) =>
        log.member_name.toLowerCase().includes(term) ||
        log.member_code.toLowerCase().includes(term)
    );
  },

  async getTodayCount() {
    const { count, error } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .gte('check_in_time', startOfToday());

    if (error) throw error;
    return count ?? 0;
  },

  async getCheckInCountSince(startIso) {
    const { count, error } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .gte('check_in_time', startIso);

    if (error) throw error;
    return count ?? 0;
  },

  async logCheckIn(passValue, method = 'QR_SCAN') {
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

    if (!member.membership_id || member.membership_status !== 'Active') {
      return {
        success: false,
        member,
        error: `Access denied - ${member.full_name} has no running membership.`,
      };
    }

    if (member.expiration_date && isExpired(member.expiration_date)) {
      return {
        success: false,
        member,
        error: `Access denied - the membership for ${member.full_name} expired on ${member.expiration_date}.`,
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
      .select('id, check_in_time, method')
      .single();

    if (error) throw error;

    return { success: true, member, attendance: data };
  },

  async checkout(attendanceId) {
    const { error } = await supabase
      .from('attendance')
      .update({ check_out_time: new Date().toISOString() })
      .eq('id', attendanceId);

    if (error) throw error;
    return true;
  },

  async deleteLog(id) {
    const { error } = await supabase.from('attendance').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
};
