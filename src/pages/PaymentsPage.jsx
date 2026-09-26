import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Printer, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { paymentService } from '../services/paymentService';
import { memberService } from '../services/memberService';
import { formatCurrency, formatDate } from '../utils/formatters';
import { useGym } from '../hooks/useGym';
import { useAuth } from '../hooks/useAuth';
import { toMessage } from '../lib/supabaseErrors';

const METHOD_LABELS = {
  Cash: 'Cash',
  Card: 'Card',
  Bank_Transfer: 'Bank transfer',
  Online: 'Online wallet',
};

export function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  const [formData, setFormData] = useState({
    member_id: '',
    amount: '',
    payment_method: 'Cash',
    payment_status: 'Paid',
    notes: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { currency, settings } = useGym();
  const { isAdmin } = useAuth();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [paymentRows, memberRows] = await Promise.all([
        paymentService.getPayments({ method: methodFilter, status: statusFilter }),
        memberService.getMembers({ status: 'Active' }),
      ]);

      setPayments(paymentRows);
      setMembers(memberRows);
    } catch (err) {
      setError(toMessage(err, 'Could not load payments.'));
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [methodFilter, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openRecordModal = () => {
    setFormData({
      member_id: members[0]?.id || '',
      amount: '',
      payment_method: 'Cash',
      payment_status: 'Paid',
      notes: '',
    });
    setFormError('');
    setIsRecordModalOpen(true);
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();

    if (!formData.member_id) {
      setFormError('Select a member.');
      return;
    }
    if (!(Number(formData.amount) > 0)) {
      setFormError('Enter an amount greater than zero.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      await paymentService.recordPayment({
        memberId: formData.member_id,
        amount: Number(formData.amount),
        paymentMethod: formData.payment_method,
        status: formData.payment_status,
        notes: formData.notes,
      });

      setIsRecordModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(toMessage(err, 'Could not record this payment.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (payment, status) => {
    try {
      await paymentService.updatePaymentStatus(payment.id, status);
      await loadData();
    } catch (err) {
      setError(toMessage(err, 'Could not update that payment.'));
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = term
    ? payments.filter(
        (payment) =>
          payment.receipt_number?.toLowerCase().includes(term) ||
          payment.member_name?.toLowerCase().includes(term) ||
          payment.member_code?.toLowerCase().includes(term) ||
          payment.notes?.toLowerCase().includes(term)
      )
    : payments;

  const total = filtered.reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Receipts, revenue audit trail, and outstanding balances."
      >
        <Button variant="emerald" icon={Plus} onClick={openRecordModal}>
          Record payment
        </Button>
      </PageHeader>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      <Card className="p-4 bg-gym-900/80 border-gym-800">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search receipt, member, note..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-950 border border-gym-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Method:</span>
              {['ALL', ...paymentService.PAYMENT_METHODS].map((method) => (
                <button
                  key={method}
                  onClick={() => setMethodFilter(method)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    methodFilter === method
                      ? 'bg-brand-cyan text-white shadow-md'
                      : 'bg-gym-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {method === 'ALL' ? 'All' : METHOD_LABELS[method]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Status:</span>
              {['ALL', ...paymentService.PAYMENT_STATUSES].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    statusFilter === status
                      ? 'bg-brand-cyan text-white shadow-md'
                      : 'bg-gym-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gym-800/60 flex items-center justify-between text-xs">
          <span className="text-slate-400">
            {filtered.length} transaction{filtered.length === 1 ? '' : 's'} shown
          </span>
          <span className="font-mono font-bold text-brand-cyan">
            {formatCurrency(total, currency)}
          </span>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-gym-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Receipt</th>
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Method</th>
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gym-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    Loading payments...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    No payments match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-brand-cyan">
                      {item.receipt_number}
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-slate-100">{item.member_name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{item.member_code}</p>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-sm font-bold text-slate-100">
                      {formatCurrency(item.amount, currency)}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {METHOD_LABELS[item.payment_method] || item.payment_method}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(item.transaction_date, 'MMM dd, yyyy')}
                    </td>
                    <td className="py-3.5 px-4">
                      {isAdmin && item.payment_status !== 'Paid' ? (
                        <select
                          value={item.payment_status}
                          onChange={(e) => handleStatusChange(item, e.target.value)}
                          className="rounded-lg bg-gym-950 border border-gym-800 text-[11px] text-slate-200 px-2 py-1 focus:outline-none focus:border-brand-cyan"
                        >
                          {paymentService.PAYMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge
                          variant={
                            item.payment_status === 'Paid'
                              ? 'emerald'
                              : item.payment_status === 'Refunded'
                              ? 'violet'
                              : item.payment_status === 'Failed'
                              ? 'rose'
                              : 'amber'
                          }
                        >
                          {item.payment_status === 'Paid' && (
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                          )}
                          {item.payment_status}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedReceipt(item)}
                        className="p-1.5 rounded-lg bg-gym-800 hover:bg-brand-cyan hover:text-white text-slate-300 transition"
                        title="View receipt"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        title="Record a payment"
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{formError}</span>
            </div>
          )}

          {members.length === 0 ? (
            <p className="text-xs text-amber-400">
              There are no active members to charge. Register a member first.
            </p>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Member *</label>
              <select
                value={formData.member_id}
                onChange={(e) => setFormData({ ...formData, member_id: e.target.value })}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name} ({member.member_code})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={`Amount (${currency}) *`}
              type="number"
              min="1"
              step="1"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
            />

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Method *</label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
              >
                {paymentService.PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Status</label>
              <select
                value={formData.payment_status}
                onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
              >
                {paymentService.PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            label="Notes / transaction reference"
            placeholder="e.g. Monthly renewal fees"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsRecordModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="emerald"
              disabled={submitting || members.length === 0}
            >
              {submitting ? 'Recording...' : 'Record and issue receipt'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(selectedReceipt)}
        onClose={() => setSelectedReceipt(null)}
        title="Payment receipt"
      >
        {selectedReceipt && (
          <div className="space-y-4 py-2">
            <div className="p-6 rounded-2xl bg-gym-950 border border-gym-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gym-800">
                <div>
                  <h3 className="font-extrabold text-slate-100 text-lg uppercase">
                    {settings.gym_name}
                  </h3>
                  <p className="text-[11px] text-slate-400">Official receipt</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-brand-cyan font-bold text-sm">
                    {selectedReceipt.receipt_number}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {formatDate(selectedReceipt.transaction_date)}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Member</span>
                  <span className="font-semibold text-slate-200 text-right">
                    {selectedReceipt.member_name}
                    <span className="block font-mono text-[10px] text-slate-400">
                      {selectedReceipt.member_code}
                    </span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Method</span>
                  <span className="text-slate-200">
                    {METHOD_LABELS[selectedReceipt.payment_method] ||
                      selectedReceipt.payment_method}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <span
                    className={
                      selectedReceipt.payment_status === 'Paid'
                        ? 'text-emerald-400 font-semibold'
                        : 'text-amber-400 font-semibold'
                    }
                  >
                    {selectedReceipt.payment_status}
                  </span>
                </div>
                {selectedReceipt.notes && (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Notes</span>
                    <span className="text-slate-200 text-right">{selectedReceipt.notes}</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-gym-800 flex justify-between items-center text-sm font-bold">
                <span className="text-slate-300">Total paid</span>
                <span className="text-brand-cyan text-lg font-mono">
                  {formatCurrency(selectedReceipt.amount, currency)}
                </span>
              </div>

              {settings.invoice_footer && (
                <p className="text-[10px] text-slate-500 text-center pt-2">
                  {settings.invoice_footer}
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
                Print receipt
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
