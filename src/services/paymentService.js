import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const paymentService = {
  async getPayments() {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem('be_smart_payments');
      return stored ? JSON.parse(stored) : [];
    }

    const { data, error } = await supabase
      .from('payments')
      .select(`
        id,
        receipt_number,
        amount,
        payment_method,
        payment_status,
        transaction_date,
        notes,
        members ( id, full_name, member_code )
      `)
      .order('transaction_date', { ascending: false });

    if (error) {
      console.error('Error fetching payments:', error);
      return [];
    }

    return (data || []).map((p) => ({
      id: p.id,
      receipt_number: p.receipt_number,
      member_id: p.members?.id,
      member_name: p.members?.full_name || 'N/A',
      member_code: p.members?.member_code || 'N/A',
      amount: p.amount,
      payment_method: p.payment_method,
      payment_status: p.payment_status,
      transaction_date: p.transaction_date,
    }));
  },

  async recordPayment(memberId, amount, paymentMethod = 'Cash', notes = '') {
    const receiptNumber = `REC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    if (!isSupabaseConfigured) {
      const existing = await this.getPayments();
      const newPayment = {
        id: `pay-${Date.now()}`,
        receipt_number: receiptNumber,
        member_name: 'Member Transaction',
        member_code: 'BSG-MEM',
        amount,
        payment_method: paymentMethod,
        payment_status: 'Paid',
        transaction_date: new Date().toISOString(),
        notes,
      };

      const updated = [newPayment, ...existing];
      localStorage.setItem('be_smart_payments', JSON.stringify(updated));
      return newPayment;
    }

    const { data, error } = await supabase
      .from('payments')
      .insert([
        {
          member_id: memberId,
          amount,
          payment_method: paymentMethod,
          payment_status: 'Paid',
          receipt_number: receiptNumber,
          notes,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
