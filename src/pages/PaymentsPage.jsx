import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, Printer, FileText, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { paymentService } from '../services/paymentService';
import { memberService } from '../services/memberService';
import { formatCurrency, formatDate } from '../utils/formatters';

export function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');

  // Modals
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  // New Payment Form
  const [formData, setFormData] = useState({
    member_id: '',
    amount: 49.00,
    payment_method: 'Cash',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [paymentsData, membersData] = await Promise.all([
        paymentService.getPayments(),
        memberService.getMembers(),
      ]);
      setPayments(paymentsData);
      setMembers(membersData);
      if (membersData.length > 0 && !formData.member_id) {
        setFormData((prev) => ({ ...prev, member_id: membersData[0].id }));
      }
    } catch (err) {
      console.error('Error loading payments:', err);
    } finally {
      setLoading(false);
    }
  }, [formData.member_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!formData.member_id || !formData.amount) return;

    try {
      setSubmitting(true);
      await paymentService.recordPayment(
        formData.member_id,
        Number(formData.amount),
        formData.payment_method,
        formData.notes
      );
      setIsRecordModalOpen(false);
      await loadData();
    } catch (err) {
      console.error('Record payment error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredPayments = payments.filter((item) => {
    const matchesSearch =
      item.member_name?.toLowerCase().includes(search.toLowerCase()) ||
      item.receipt_number?.toLowerCase().includes(search.toLowerCase());
    const matchesMethod = methodFilter === 'ALL' || item.payment_method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Transactions & Audits"
        description="Audit revenue transactions, filter payment methods (Cash, Card, UPI), and print official receipts."
      >
        <Button variant="emerald" icon={Plus} onClick={() => setIsRecordModalOpen(true)}>
          Record New Payment
        </Button>
      </PageHeader>

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-gym-900/80 border-gym-800">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search receipt # or member..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-950 border border-gym-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
            <span className="text-xs text-slate-400">Method:</span>
            {['ALL', 'Cash', 'Card', 'UPI'].map((m) => (
              <button
                key={m}
                onClick={() => setMethodFilter(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  methodFilter === m
                    ? 'bg-brand-cyan text-white shadow-md'
                    : 'bg-gym-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Transactions Audit Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-gym-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Receipt Number</th>
                <th className="py-3.5 px-4">Member Name</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Method</th>
                <th className="py-3.5 px-4">Transaction Date</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gym-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    Loading payment audit log...
                  </td>
                </tr>
              ) : filteredPayments.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    No payment transactions matching search.
                  </td>
                </tr>
              ) : (
                filteredPayments.map((item) => (
                  <tr key={item.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-brand-cyan">
                      {item.receipt_number}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      {item.member_name}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-sm font-bold text-slate-100">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-gym-950 border border-gym-800 font-mono text-[11px]">
                        {item.payment_method}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(item.transaction_date, 'MMM dd, yyyy • hh:mm a')}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant="emerald">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {item.payment_status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedReceipt(item)}
                        className="p-1.5 rounded-lg bg-gym-800 hover:bg-brand-cyan hover:text-white text-slate-300 transition"
                        title="View Official Receipt"
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

      {/* Record Payment Modal */}
      <Modal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        title="Record New Transaction"
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Select Member *</label>
            <select
              value={formData.member_id}
              onChange={(e) => setFormData({ ...formData, member_id: e.target.value })}
              className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.member_code})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Amount ($) *"
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              required
            />

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Payment Method *</label>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
              >
                <option value="Cash">Cash</option>
                <option value="Card">Credit/Debit Card</option>
                <option value="UPI">UPI / Digital Wallet</option>
                <option value="Bank_Transfer">Bank Transfer</option>
              </select>
            </div>
          </div>

          <Input
            label="Notes / Transaction Ref"
            placeholder="e.g. Monthly renewal fees"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsRecordModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="emerald" disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Payment & Issue Receipt'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Official Receipt Preview Modal */}
      <Modal
        isOpen={Boolean(selectedReceipt)}
        onClose={() => setSelectedReceipt(null)}
        title="Official Payment Receipt"
      >
        {selectedReceipt && (
          <div className="space-y-4 py-2">
            <div className="p-6 rounded-2xl bg-gym-950 border border-gym-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gym-800">
                <div>
                  <h3 className="font-extrabold text-slate-100 text-lg">BE SMART GYM</h3>
                  <p className="text-[11px] text-slate-400">Payment Tax Receipt</p>
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
                <div className="flex justify-between">
                  <span className="text-slate-400">Member:</span>
                  <span className="font-semibold text-slate-200">{selectedReceipt.member_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Payment Method:</span>
                  <span className="font-mono text-slate-200">{selectedReceipt.payment_method}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status:</span>
                  <span className="text-emerald-400 font-semibold">{selectedReceipt.payment_status}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-gym-800 flex justify-between items-center text-sm font-bold">
                <span className="text-slate-300">Total Paid:</span>
                <span className="text-brand-cyan text-lg font-mono">
                  {formatCurrency(selectedReceipt.amount)}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                icon={Printer}
                onClick={() => window.print()}
              >
                Print Receipt
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
