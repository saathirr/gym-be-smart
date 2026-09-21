import { supabase, isSupabaseConfigured } from '../lib/supabase';

const fallbackPayments = [
  {
    id: 'pay-1',
    receipt_number: 'REC-2026-8812',
    member_name: 'Marcus Vance',
    member_code: 'BSG-1001',
    amount: 449.00,
    payment_method: 'Card',
    payment_status: 'Paid',
    transaction_date: new Date(Date.now() - 2 * 86400000).toISOString(),
    plan_name: 'VIP Annual',
  },
  {
    id: 'pay-2',
    receipt_number: 'REC-2026-8813',
    member_name: 'Elena Rostova',
    member_code: 'BSG-1002',
    amount: 129.00,
    payment_method: 'UPI',
    payment_status: 'Paid',
    transaction_date: new Date(Date.now() - 5 * 86400000).toISOString(),
    plan_name: 'Gold Quarterly',
  },
  {
    id: 'pay-3',
    receipt_number: 'REC-2026-8814',
    member_name: 'David Miller',
    member_code: 'BSG-1003',
    amount: 49.00,
    payment_method: 'Cash',
    payment_status: 'Paid',
    transaction_date: new Date(Date.now() - 10 * 86400000).toISOString(),
    plan_name: 'Basic Monthly',
  },
  {
    id: 'pay-4',
    receipt_number: 'REC-2026-8815',
    member_name: 'Sophia Chen',
    member_code: 'BSG-1004',
    amount: 199.00,
    payment_method: 'Card',
    payment_status: 'Paid',
    transaction_date: new Date(Date.now() - 14 * 86400000).toISOString(),
    plan_name: 'Personal Training',
  },
];

export const paymentService = {
  async getPayments() {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem('be_smart_payments');
      return stored ? JSON.parse(stored) : fallbackPayments;
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
      return fallbackPayments;
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
