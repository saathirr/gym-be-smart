import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { addDays } from 'date-fns';

const MEMBER_SELECT = `
  id,
  member_code,
  qr_code_id,
  full_name,
  nic_number,
  email,
  phone,
  whatsapp_number,
  district,
  address,
  gender,
  date_of_birth,
  emergency_contact,
  medical_conditions,
  branch_id,
  status,
  created_at,
  memberships (
    id,
    start_date,
    end_date,
    status,
    plans ( id, name, price, duration_days )
  )
`;

function withPlanSummary(member) {
  const open = member.memberships?.find(
    (sub) => sub.status === 'Active' || sub.status === 'Expiring'
  );
  const current = open || member.memberships?.[0];

  return {
    ...member,
    plan_id: current?.plans?.id ?? null,
    plan_name: current?.plans?.name || 'No Active Plan',
    plan_price: current?.plans?.price ?? null,
    membership_id: current?.id ?? null,
    membership_status: current?.status ?? null,
    start_date: current?.start_date ?? null,
    expiration_date: current?.end_date || null,
  };
}

function emptyMemberForm() {
  return {
    full_name: '',
    nic_number: '',
    phone: '',
    whatsapp_number: '',
    email: '',
    district: 'Colombo',
    address: '',
    gender: 'Male',
    date_of_birth: '',
    emergency_contact: '',
    medical_conditions: '',
    branch_id: '',
  };
}

export const memberService = {
  emptyMemberForm,

  async getMembers({ search = '', status = 'ALL', branchId = 'ALL', limit = 200 } = {}) {
    let query = supabase
      .from('members')
      .select(MEMBER_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search.trim()) {
      const term = search.trim().replace(/[%,()]/g, ' ');
      query = query.or(
        `full_name.ilike.%${term}%,member_code.ilike.%${term}%,nic_number.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`
      );
    }

    if (status && status !== 'ALL') {
      query = query.eq('status', status);
    }

    if (branchId && branchId !== 'ALL') {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw toMessage(error);

    return (data || []).map(withPlanSummary);
  },

  async getMemberById(id) {
    const { data, error } = await supabase
      .from('members')
      .select(MEMBER_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw toMessage(error);
    return data ? withPlanSummary(data) : null;
  },

  // Accepts either the QR payload or the human-readable member code.
  async getMemberByPass(passValue) {
    const value = passValue?.trim();
    if (!value) return null;

    const { data, error } = await supabase
      .from('members')
      .select(MEMBER_SELECT)
      .or(`qr_code_id.eq.${value},member_code.eq.${value}`)
      .limit(1);

    if (error) throw toMessage(error);
    if (!data || data.length === 0) return null;

    return withPlanSummary(data[0]);
  },

  async createMember(payload, planId) {
    const { data: codeRow, error: codeError } = await supabase.rpc('next_member_code');
    if (codeError) throw toMessage(codeError, 'Could not generate a member code.');

    const memberCode = codeRow;
    const qrCodeId = `${memberCode}.${Date.now().toString(36).toUpperCase()}`;

    const { data: member, error } = await supabase
      .from('members')
      .insert([
        {
          member_code: memberCode,
          qr_code_id: qrCodeId,
          full_name: payload.full_name.trim(),
          nic_number: payload.nic_number?.trim() || null,
          email: payload.email?.trim() || null,
          phone: payload.phone.trim(),
          whatsapp_number: payload.whatsapp_number?.trim() || null,
          district: payload.district || null,
          address: payload.address?.trim() || null,
          gender: payload.gender || 'Male',
          date_of_birth: payload.date_of_birth || null,
          emergency_contact: payload.emergency_contact?.trim() || null,
          medical_conditions: payload.medical_conditions?.trim() || null,
          branch_id: payload.branch_id || null,
          status: 'Active',
        },
      ])
      .select(MEMBER_SELECT)
      .single();

    if (error) throw toMessage(error);

    if (planId) {
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('id, name, price, duration_days')
        .eq('id', planId)
        .maybeSingle();

      if (planError) throw toMessage(planError, 'Could not load that plan.');

      if (plan) {
        const startDate = new Date().toISOString().slice(0, 10);
        const endDate = addDays(new Date(), plan.duration_days).toISOString().slice(0, 10);

        const { data: membership, error: membershipError } = await supabase
          .from('memberships')
          .insert([
            {
              member_id: member.id,
              plan_id: plan.id,
              start_date: startDate,
              end_date: endDate,
              status: 'Active',
            },
          ])
          .select('id')
          .single();

        if (membershipError) throw toMessage(membershipError, 'Could not start the membership.');

        if (Number(plan.price) > 0) {
          const { data: receiptRow, error: receiptError } = await supabase.rpc(
            'next_receipt_number'
          );
          if (receiptError) throw toMessage(receiptError, 'Could not generate a receipt number.');

          const { error: paymentError } = await supabase.from('payments').insert([
            {
              member_id: member.id,
              membership_id: membership.id,
              amount: plan.price,
              payment_method: payload.payment_method || 'Cash',
              payment_status: 'Paid',
              receipt_number: receiptRow,
              notes: `New membership - ${plan.name}`,
            },
          ]);

          if (paymentError) throw toMessage(paymentError, 'Could not record the payment.');
        }
      }
    }

    return withPlanSummary(member);
  },

  async updateMember(id, payload) {
    const { data, error } = await supabase
      .from('members')
      .update({
        full_name: payload.full_name.trim(),
        nic_number: payload.nic_number?.trim() || null,
        email: payload.email?.trim() || null,
        phone: payload.phone.trim(),
        whatsapp_number: payload.whatsapp_number?.trim() || null,
        district: payload.district || null,
        address: payload.address?.trim() || null,
        gender: payload.gender || 'Male',
        date_of_birth: payload.date_of_birth || null,
        emergency_contact: payload.emergency_contact?.trim() || null,
        medical_conditions: payload.medical_conditions?.trim() || null,
        branch_id: payload.branch_id || null,
      })
      .eq('id', id)
      .select(MEMBER_SELECT)
      .single();

    if (error) throw toMessage(error);
    return withPlanSummary(data);
  },

  async updateMemberStatus(id, status) {
    const { error } = await supabase.from('members').update({ status }).eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },

  async deleteMember(id) {
    const { error } = await supabase.from('members').delete().eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },
};
