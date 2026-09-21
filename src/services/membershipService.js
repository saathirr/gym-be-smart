import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { addDays } from 'date-fns';

export const membershipService = {
  async getMemberships() {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem('be_smart_memberships');
      return stored ? JSON.parse(stored) : [];
    }

    const { data, error } = await supabase
      .from('memberships')
      .select(`
        id,
        start_date,
        end_date,
        status,
        auto_renew,
        notes,
        members ( id, full_name, member_code ),
        plans ( id, name, price )
      `)
      .order('end_date', { ascending: true });

    if (error) {
      console.error('Error fetching memberships:', error);
      return [];
    }

    return (data || []).map((m) => ({
      id: m.id,
      member_id: m.members?.id,
      member_name: m.members?.full_name || 'N/A',
      member_code: m.members?.member_code || 'N/A',
      plan_id: m.plans?.id,
      plan_name: m.plans?.name || 'N/A',
      start_date: m.start_date,
      end_date: m.end_date,
      status: m.status,
      amount: m.plans?.price || 0,
    }));
  },

  async renewMembership(memberId, planId, durationDays = 30, amount = 5000) {
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = addDays(new Date(), durationDays).toISOString().split('T')[0];

    if (!isSupabaseConfigured) {
      const existing = await this.getMemberships();
      const updated = existing.map((sub) =>
        sub.member_id === memberId || sub.id === memberId
          ? { ...sub, start_date: startDate, end_date: endDate, status: 'Active' }
          : sub
      );
      localStorage.setItem('be_smart_memberships', JSON.stringify(updated));
      return true;
    }

    const { data, error } = await supabase
      .from('memberships')
      .insert([
        {
          member_id: memberId,
          plan_id: planId,
          start_date: startDate,
          end_date: endDate,
          status: 'Active',
        },
      ])
      .select()
      .single();

    if (error) throw error;

    // Also update member status to Active
    await supabase.from('members').update({ status: 'Active' }).eq('id', memberId);

    // Record renewal payment
    const receiptNo = `REC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
    await supabase.from('payments').insert([
      {
        member_id: memberId,
        membership_id: data.id,
        amount,
        payment_method: 'Cash',
        payment_status: 'Paid',
        receipt_number: receiptNo,
      },
    ]);

    return data;
  },
};
