import { supabase } from '../lib/supabase';

export const PAYMENT_METHODS = ['Cash', 'Card', 'Bank_Transfer', 'Online'];
export const PAYMENT_STATUSES = ['Paid', 'Pending', 'Failed', 'Refunded'];

const PAYMENT_SELECT = `
  id,
  receipt_number,
  amount,
  payment_method,
  payment_status,
  transaction_date,
  notes,
  member_id,
  members ( id, full_name, member_code )
`;

function withMember(row) {
  return {
    id: row.id,
    receipt_number: row.receipt_number,
    member_id: row.members?.id ?? null,
    member_name: row.members?.full_name || 'Deleted member',
    member_code: row.members?.member_code || 'N/A',
    amount: Number(row.amount),
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    transaction_date: row.transaction_date,
    notes: row.notes,
  };
}

export const paymentService = {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,

  async getPayments({ search = '', method = 'ALL', status = 'ALL', limit = 300 } = {}) {
    let query = supabase
      .from('payments')
      .select(PAYMENT_SELECT)
      .order('transaction_date', { ascending: false })
      .limit(limit);

    if (method !== 'ALL') {
      query = query.eq('payment_method', method);
    }

    if (status !== 'ALL') {
      query = query.eq('payment_status', status);
    }

    const { data, error } = await query;
    if (error) throw error;

    const payments = (data || []).map(withMember);
    if (!search.trim()) return payments;

    const term = search.trim().toLowerCase();
    return payments.filter(
      (payment) =>
        payment.receipt_number?.toLowerCase().includes(term) ||
        payment.member_name?.toLowerCase().includes(term) ||
        payment.member_code?.toLowerCase().includes(term) ||
        payment.notes?.toLowerCase().includes(term)
    );
  },

  async recordPayment({ memberId, amount, paymentMethod = 'Cash', status = 'Paid', notes = '' }) {
    if (!memberId) throw new Error('Select a member for this payment.');
    if (!(Number(amount) > 0)) throw new Error('Enter an amount greater than zero.');

    const { data: receiptRow, error: receiptError } = await supabase.rpc(
      'next_receipt_number'
    );
    if (receiptError) throw receiptError;

    const { data, error } = await supabase
      .from('payments')
      .insert([
        {
          member_id: memberId,
          amount: Number(amount),
          payment_method: paymentMethod,
          payment_status: status,
          receipt_number: receiptRow,
          notes: notes?.trim() || null,
        },
      ])
      .select(PAYMENT_SELECT)
      .single();

    if (error) throw error;
    return withMember(data);
  },

  async updatePaymentStatus(id, status) {
    const { data, error } = await supabase
      .from('payments')
      .update({ payment_status: status })
      .eq('id', id)
      .select(PAYMENT_SELECT)
      .single();

    if (error) throw error;
    return withMember(data);
  },
};
