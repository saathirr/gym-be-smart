import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';
import { addDays } from 'date-fns';
import { phoneSearchVariants } from '../utils/phone';
import { storageService } from './storageService';

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
  avatar_url,
  memberships (
    id,
    start_date,
    end_date,
    status,
    plans ( id, name, price, duration_days )
  )
`;

// Everything the player profile shows below the identity card. Fetched as one
// extra pair of queries rather than through MEMBER_SELECT, because the members
// list renders 200 rows at a time and joining every historical membership and
// payment onto all of them would be a lot of data for a table that shows a
// name and a plan badge.
const MEMBERSHIP_HISTORY_SELECT = `
  id,
  start_date,
  end_date,
  status,
  auto_renew,
  notes,
  created_at,
  plans ( id, name, price, duration_days )
`;

const PAYMENT_HISTORY_SELECT = `
  id,
  membership_id,
  amount,
  payment_method,
  payment_status,
  receipt_number,
  transaction_date,
  notes
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
      // PostgREST's or() filter is a comma-separated list of column.pattern
      // pairs, so the pattern itself must not contain a comma, percent sign or
      // parenthesis. The text term is flattened to spaces for that reason; the
      // phone variants are digits only and need no escaping.
      const term = search.trim().replace(/[%,()]/g, ' ').trim();
      const conditions = [];
      if (term) {
        conditions.push(
          `full_name.ilike.%${term}%`,
          `member_code.ilike.%${term}%`,
          `nic_number.ilike.%${term}%`,
          `phone.ilike.%${term}%`,
          `whatsapp_number.ilike.%${term}%`,
          `email.ilike.%${term}%`
        );
      }

      // "077 123 4567" has to find a member stored as "0771234567", and
      // "94771234567" has to find them too, so every form of the number is
      // searched instead of only the one that was typed. Empty for a name or a
      // member code, which is what keeps the filter to one round trip.
      for (const variant of phoneSearchVariants(search)) {
        conditions.push(`phone.ilike.%${variant}%`, `whatsapp_number.ilike.%${variant}%`);
      }

      if (conditions.length > 0) {
        query = query.or(conditions.join(','));
      }
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

  /**
   * One member with their full subscription and payment history.
   *
   * The two history queries run in parallel because they are independent, and
   * each is ordered by date so the profile can show them newest-first without
   * sorting in the browser. Both are separate from getMemberById so the
   * members list does not pay for them.
   */
  async getMemberProfile(id) {
    const member = await this.getMemberById(id);
    if (!member) return null;

    const [memberships, payments] = await Promise.all([
      supabase
        .from('memberships')
        .select(MEMBERSHIP_HISTORY_SELECT)
        .eq('member_id', id)
        .order('start_date', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw toMessage(error, 'Could not load the membership history.');
          return data || [];
        }),

      supabase
        .from('payments')
        .select(PAYMENT_HISTORY_SELECT)
        .eq('member_id', id)
        .order('transaction_date', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw toMessage(error, 'Could not load the payment history.');
          return data || [];
        }),
    ]);

    return {
      ...member,
      // withPlanSummary already flattens the *current* membership onto the
      // member. The history keeps every row, including the current one, so the
      // profile can show a plan that has since been renewed or cancelled.
      membershipHistory: memberships,
      paymentHistory: payments,
    };
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

  async createMember(payload, planId, photoFile = null) {
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

    // The photo is uploaded after the row exists, because the storage path is
    // namespaced by member id. Doing it the other way round would mean either a
    // client-generated folder that does not match the member, or an orphaned
    // file when the insert fails.
    //
    // A photo failure does NOT fail the registration. The member is already on
    // file and losing them because a jpeg failed to upload would be the far
    // worse outcome, so the error is handed back for the UI to show and the
    // photo can be added later from the profile.
    let photoError = null;
    if (photoFile) {
      try {
        const avatarUrl = await storageService.uploadMemberPhoto({
          memberId: member.id,
          file: photoFile,
        });

        const { error: avatarError } = await supabase
          .from('members')
          .update({ avatar_url: avatarUrl })
          .eq('id', member.id);

        if (avatarError) throw toMessage(avatarError);

        member.avatar_url = avatarUrl;
      } catch (error) {
        photoError = toMessage(error, 'The photo could not be saved.');
      }
    }

    return { ...withPlanSummary(member), photoError };
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

  async bulkImportMembers({ rows, planId = null, paymentMethod = 'Cash', onProgress }) {
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        await this.createMember(
          {
            full_name: row.full_name,
            nic_number: row.nic_number || null,
            phone: row.phone,
            whatsapp_number: row.whatsapp_number || row.phone,
            email: row.email || null,
            district: row.district || 'Colombo',
            address: row.address || null,
            gender: row.gender || 'Male',
            date_of_birth: row.date_of_birth || null,
            emergency_contact: row.emergency_contact || null,
            medical_conditions: row.medical_conditions || null,
            payment_method: paymentMethod,
          },
          planId,
          null
        );
        successCount++;
      } catch (err) {
        errorCount++;
        errors.push({ row: row.rowId, name: row.full_name, error: err?.message || String(err) });
      }

      if (onProgress) {
        onProgress(i + 1, rows.length);
      }
    }

    return { successCount, errorCount, errors };
  },
};
