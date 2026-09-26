import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

const MEMBERSHIP_SELECT = `
  id,
  start_date,
  end_date,
  status,
  auto_renew,
  notes,
  members ( id, full_name, member_code, status ),
  plans ( id, name, price, duration_days )
`;

function withMember(row) {
  return {
    id: row.id,
    member_id: row.members?.id ?? null,
    member_name: row.members?.full_name || 'N/A',
    member_code: row.members?.member_code || 'N/A',
    member_status: row.members?.status || 'N/A',
    plan_id: row.plans?.id ?? null,
    plan_name: row.plans?.name || 'N/A',
    duration_days: row.plans?.duration_days ?? null,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    auto_renew: row.auto_renew,
    notes: row.notes,
    amount: Number(row.plans?.price ?? 0),
  };
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export const membershipService = {
  async getMemberships({ status = 'ALL' } = {}) {
    let query = supabase
      .from('memberships')
      .select(MEMBERSHIP_SELECT)
      .order('end_date', { ascending: true });

    if (status !== 'ALL') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw toMessage(error);

    return (data || []).map((row) => ({
      ...withMember(row),
      days_remaining: daysUntil(row.end_date),
    }));
  },

  // Delegates to the atomic database function so the previous subscription is
  // closed in the same transaction. Doing this from the client left members
  // with two rows both flagged 'Active'.
  async renewMembership(memberId, planId, { paymentMethod = 'Cash', notes = null } = {}) {
    const { data, error } = await supabase.rpc('renew_membership', {
      p_member_id: memberId,
      p_plan_id: planId,
      p_payment_method: paymentMethod,
      p_notes: notes,
    });

    if (error) throw toMessage(error);
    return data;
  },

  async cancelMembership(id) {
    const { error } = await supabase
      .from('memberships')
      .update({ status: 'Cancelled' })
      .eq('id', id);

    if (error) throw toMessage(error);
    return true;
  },

  async setAutoRenew(id, autoRenew) {
    const { error } = await supabase
      .from('memberships')
      .update({ auto_renew: autoRenew })
      .eq('id', id);

    if (error) throw toMessage(error);
    return true;
  },

  // Closes out subscriptions whose window has passed and syncs member status.
  async syncExpired() {
    const { data, error } = await supabase.rpc('sync_expired_memberships');
    if (error) throw toMessage(error);
    return data ?? 0;
  },
};
