import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { addDays } from 'date-fns';

const fallbackMembers = [
  {
    id: 'm-101',
    member_code: 'BSG-1001',
    qr_code_id: 'QR-BSG-1001-MARCUS',
    full_name: 'Marcus Vance',
    email: 'marcus.vance@example.com',
    phone: '+1 555-0192',
    gender: 'Male',
    emergency_contact: '+1 555-9988 (Sarah Vance)',
    status: 'Active',
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    plan_name: 'VIP Annual',
    expiration_date: addDays(new Date(), 335).toISOString().split('T')[0],
  },
  {
    id: 'm-102',
    member_code: 'BSG-1002',
    qr_code_id: 'QR-BSG-1002-ELENA',
    full_name: 'Elena Rostova',
    email: 'elena.r@example.com',
    phone: '+1 555-0144',
    gender: 'Female',
    emergency_contact: '+1 555-8877 (Peter Rostov)',
    status: 'Active',
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    plan_name: 'Gold Quarterly',
    expiration_date: addDays(new Date(), 30).toISOString().split('T')[0],
  },
  {
    id: 'm-103',
    member_code: 'BSG-1003',
    qr_code_id: 'QR-BSG-1003-DAVID',
    full_name: 'David Miller',
    email: 'david.m@example.com',
    phone: '+1 555-0178',
    gender: 'Male',
    emergency_contact: '+1 555-7766 (Anna Miller)',
    status: 'Active',
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    plan_name: 'Basic Monthly',
    expiration_date: addDays(new Date(), 2).toISOString().split('T')[0],
  },
  {
    id: 'm-104',
    member_code: 'BSG-1004',
    qr_code_id: 'QR-BSG-1004-SOPHIA',
    full_name: 'Sophia Chen',
    email: 'sophia.c@example.com',
    phone: '+1 555-0123',
    gender: 'Female',
    emergency_contact: '+1 555-6655 (Michael Chen)',
    status: 'Expired',
    created_at: new Date(Date.now() - 90 * 86400000).toISOString(),
    plan_name: 'Basic Monthly',
    expiration_date: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0],
  },
];

export const memberService = {
  async getMembers(searchQuery = '', statusFilter = 'ALL') {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem('be_smart_members');
      let list = stored ? JSON.parse(stored) : fallbackMembers;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        list = list.filter(
          (m) =>
            m.full_name.toLowerCase().includes(q) ||
            m.member_code.toLowerCase().includes(q) ||
            (m.email && m.email.toLowerCase().includes(q)) ||
            (m.phone && m.phone.includes(q))
        );
      }

      if (statusFilter && statusFilter !== 'ALL') {
        list = list.filter((m) => m.status.toUpperCase() === statusFilter.toUpperCase());
      }

      return list;
    }

    let query = supabase.from('members').select(`
      *,
      memberships (
        id,
        start_date,
        end_date,
        status,
        plans ( name )
      )
    `).order('created_at', { ascending: false });

    if (searchQuery) {
      query = query.or(`full_name.ilike.%${searchQuery}%,member_code.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`);
    }

    if (statusFilter && statusFilter !== 'ALL') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching members:', error);
      return fallbackMembers;
    }

    return (data || []).map((m) => {
      const activeMembership = m.memberships?.find((sub) => sub.status === 'Active') || m.memberships?.[0];
      return {
        ...m,
        plan_name: activeMembership?.plans?.name || 'No Active Plan',
        expiration_date: activeMembership?.end_date || 'N/A',
      };
    });
  },

  async getMemberByQR(qrCodeId) {
    if (!isSupabaseConfigured) {
      const members = await this.getMembers();
      return members.find((m) => m.qr_code_id === qrCodeId || m.member_code === qrCodeId) || null;
    }

    const { data, error } = await supabase
      .from('members')
      .select(`
        *,
        memberships (
          id,
          start_date,
          end_date,
          status,
          plans ( name )
        )
      `)
      .or(`qr_code_id.eq.${qrCodeId},member_code.eq.${qrCodeId}`)
      .maybeSingle();

    if (error) {
      console.error('Error querying member by QR:', error);
      return null;
    }

    if (!data) return null;

    const activeMembership = data.memberships?.find((sub) => sub.status === 'Active') || data.memberships?.[0];
    return {
      ...data,
      plan_name: activeMembership?.plans?.name || 'No Active Plan',
      expiration_date: activeMembership?.end_date || 'N/A',
    };
  },

  async createMember(memberPayload, planId) {
    const randomCodeNum = Math.floor(1000 + Math.random() * 9000);
    const memberCode = `BSG-${randomCodeNum}`;
    const qrCodeId = `QR-${memberCode}-${Date.now().toString(36).toUpperCase()}`;

    if (!isSupabaseConfigured) {
      const existing = await this.getMembers();
      const newMember = {
        ...memberPayload,
        id: `m-${Date.now()}`,
        member_code: memberCode,
        qr_code_id: qrCodeId,
        status: 'Active',
        created_at: new Date().toISOString(),
        plan_name: memberPayload.plan_name || 'Basic Monthly',
        expiration_date: addDays(new Date(), 30).toISOString().split('T')[0],
      };

      const updated = [newMember, ...existing];
      localStorage.setItem('be_smart_members', JSON.stringify(updated));
      return newMember;
    }

    // Insert Member
    const { data: member, error: memberErr } = await supabase
      .from('members')
      .insert([
        {
          member_code: memberCode,
          qr_code_id: qrCodeId,
          full_name: memberPayload.full_name,
          email: memberPayload.email,
          phone: memberPayload.phone,
          gender: memberPayload.gender || 'Male',
          emergency_contact: memberPayload.emergency_contact,
          medical_conditions: memberPayload.medical_conditions,
          status: 'Active',
        },
      ])
      .select()
      .single();

    if (memberErr) throw memberErr;

    // Create Initial Membership
    if (planId) {
      const { data: plan } = await supabase.from('plans').select('duration_days, price').eq('id', planId).single();
      const durationDays = plan?.duration_days || 30;
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = addDays(new Date(), durationDays).toISOString().split('T')[0];

      await supabase.from('memberships').insert([
        {
          member_id: member.id,
          plan_id: planId,
          start_date: startDate,
          end_date: endDate,
          status: 'Active',
        },
      ]);

      // Record Payment
      if (plan?.price) {
        const receiptNo = `REC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
        await supabase.from('payments').insert([
          {
            member_id: member.id,
            amount: plan.price,
            payment_method: memberPayload.payment_method || 'Cash',
            payment_status: 'Paid',
            receipt_number: receiptNo,
          },
        ]);
      }
    }

    return member;
  },

  async updateMemberStatus(id, newStatus) {
    if (!isSupabaseConfigured) {
      const existing = await this.getMembers();
      const updated = existing.map((m) => (m.id === id ? { ...m, status: newStatus } : m));
      localStorage.setItem('be_smart_members', JSON.stringify(updated));
      return true;
    }

    const { error } = await supabase
      .from('members')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  async deleteMember(id) {
    if (!isSupabaseConfigured) {
      const existing = await this.getMembers();
      const updated = existing.filter((m) => m.id !== id);
      localStorage.setItem('be_smart_members', JSON.stringify(updated));
      return true;
    }

    const { error } = await supabase.from('members').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
};
