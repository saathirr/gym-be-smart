import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import {
  Plus,
  Search,
  Printer,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  CreditCard,
  RefreshCw,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { paymentService } from '../services/paymentService';
import { memberService } from '../services/memberService';
import { membershipService } from '../services/membershipService';
import { planService } from '../services/planService';
import { formatCurrency, formatDate } from '../utils/formatters';
import { formatPhone } from '../utils/phone';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const [payments, setPayments] = useState([]);
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
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
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [renewCycle, setRenewCycle] = useState(true);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { currency, settings } = useGym();
  const { isAdmin } = useAuth();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [paymentRows, memberRows, planRows] = await Promise.all([
        paymentService.getPayments({ method: methodFilter, status: statusFilter }),
        memberService.getMembers({ status: 'ALL', limit: 1000 }),
        planService.getPlans({ includeInactive: false }),
      ]);

      setPayments(paymentRows);
      setMembers(memberRows);
      setPlans(planRows);
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

  // Handle redirect from /payment-reminders or members directory
  useEffect(() => {
    const targetId = location.state?.memberId || searchParams.get('memberId');
    const shouldOpen =
      location.state?.openRecord ||
      searchParams.get('action') === 'record' ||
      Boolean(targetId);

    if (targetId && members.length > 0) {
      const found = members.find((m) => m.id === targetId);
      if (found) {
        setFormData({
          member_id: found.id,
          amount: found.plan_price ? String(found.plan_price) : '',
          payment_method: 'Cash',
          payment_status: 'Paid',
          notes:
            found.plan_name && found.plan_name !== 'No Active Plan'
              ? `Membership payment - ${found.plan_name}`
              : 'Membership payment',
        });
        setRenewCycle(Boolean(found.plan_id));
        setFormError('');
        setMemberSearchQuery('');
        setIsRecordModalOpen(true);

        // Clean up search parameters so refreshing doesn't keep reopening
        if (searchParams.get('memberId') || searchParams.get('action')) {
          const next = new URLSearchParams(searchParams);
          next.delete('memberId');
          next.delete('action');
          setSearchParams(next, { replace: true });
        }
      }
    } else if (shouldOpen && !targetId && members.length > 0 && !isRecordModalOpen) {
      openRecordModal();
    }
  }, [members, searchParams, location.state]);

  const openRecordModal = () => {
    setFormData({
      member_id: '',
      amount: '',
      payment_method: 'Cash',
      payment_status: 'Paid',
      notes: '',
    });
    setRenewCycle(true);
    setMemberSearchQuery('');
    setFormError('');
    setIsRecordModalOpen(true);
  };

  const selectedMember = useMemo(() => {
    return members.find((m) => m.id === formData.member_id) || null;
  }, [members, formData.member_id]);

  const memberSearchTerm = memberSearchQuery.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    if (!memberSearchTerm) {
      return members.slice(0, 30);
    }
    return members.filter((m) => {
      const name = (m.full_name || '').toLowerCase();
      const code = (m.member_code || '').toLowerCase();
      const nic = (m.nic_number || '').toLowerCase();
      const phone = (m.phone || '').toLowerCase();
      const wa = (m.whatsapp_number || '').toLowerCase();
      return (
        name.includes(memberSearchTerm) ||
        code.includes(memberSearchTerm) ||
        nic.includes(memberSearchTerm) ||
        phone.includes(memberSearchTerm) ||
        wa.includes(memberSearchTerm)
      );
    });
  }, [members, memberSearchTerm]);

  const handleSelectMember = (m) => {
    setFormData((prev) => ({
      ...prev,
      member_id: m.id,
      amount: m.plan_price ? String(m.plan_price) : prev.amount || '',
      notes:
        m.plan_name && m.plan_name !== 'No Active Plan'
          ? `Membership renewal - ${m.plan_name}`
          : prev.notes || 'Membership payment',
    }));
    setRenewCycle(Boolean(m.plan_id));
    setMemberSearchQuery('');
    setFormError('');
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();

    if (!formData.member_id) {
      setFormError('Please search and select a member.');
      return;
    }
    if (!(Number(formData.amount) > 0)) {
      setFormError('Enter an amount greater than zero.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      let receiptData = null;

      // When renew cycle is selected and member has a plan, renew atomically
      if (renewCycle && selectedMember?.plan_id) {
        const result = await membershipService.renewMembership(
          formData.member_id,
          selectedMember.plan_id,
          {
            paymentMethod: formData.payment_method,
            notes: formData.notes,
          }
        );

        receiptData = {
          id: result?.membership_id || Date.now().toString(),
          receipt_number: result?.receipt_number || 'RECEIPT',
          member_id: selectedMember.id,
          member_name: selectedMember.full_name,
          member_code: selectedMember.member_code,
          amount: Number(selectedMember.plan_price || formData.amount),
          payment_method: formData.payment_method,
          payment_status: 'Paid',
          transaction_date: new Date().toISOString(),
          notes: formData.notes,
        };
      } else {
        // Standard payment recording
        const recorded = await paymentService.recordPayment({
          memberId: formData.member_id,
          amount: Number(formData.amount),
          paymentMethod: formData.payment_method,
          status: formData.payment_status,
          notes: formData.notes,
        });
        receiptData = recorded;
      }

      // If this member was dismissed in reminders, clear their dismissal key
      try {
        const raw = localStorage.getItem('gym_dismissed_payment_reminders');
        if (raw) {
          const map = JSON.parse(raw);
          if (map[formData.member_id]) {
            delete map[formData.member_id];
            localStorage.setItem('gym_dismissed_payment_reminders', JSON.stringify(map));
          }
        }
      } catch {
        // ignore storage errors
      }

      setIsRecordModalOpen(false);
      if (receiptData) {
        setSelectedReceipt(receiptData);
      }
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

      <Card className="p-4 bg-gym-900/80">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search receipt, member, note..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
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

        <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs">
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
              <tr className="bg-gym-950/80 border-b text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Receipt</th>
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Method</th>
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
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
                          className="rounded-lg bg-gym-850 text-[11px] text-slate-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
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

          {/* Member Selection Section */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Member *
            </label>

            {selectedMember ? (
              <div className="p-3 rounded-xl bg-gym-950 border border-brand-cyan/30 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-100 text-sm">
                      {selectedMember.full_name}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30">
                      {selectedMember.member_code}
                    </span>
                    <Badge
                      variant={
                        selectedMember.status === 'Active'
                          ? 'emerald'
                          : selectedMember.status === 'Expired'
                          ? 'rose'
                          : 'amber'
                      }
                    >
                      {selectedMember.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                    {selectedMember.nic_number && (
                      <span>
                        <span className="text-slate-500 font-normal">NIC:</span>{' '}
                        {selectedMember.nic_number}
                      </span>
                    )}
                    {(selectedMember.phone || selectedMember.whatsapp_number) && (
                      <span>
                        <span className="text-slate-500 font-normal">Phone:</span>{' '}
                        {formatPhone(selectedMember.phone || selectedMember.whatsapp_number)}
                      </span>
                    )}
                    <span>
                      <span className="text-slate-500 font-normal">Plan:</span>{' '}
                      {selectedMember.plan_name || 'No Plan'}
                      {selectedMember.plan_price
                        ? ` (${formatCurrency(selectedMember.plan_price, currency)})`
                        : ''}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, member_id: '' }));
                    setMemberSearchQuery('');
                  }}
                  className="shrink-0 text-slate-300 hover:text-white"
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search by Name, NIC, Phone, or Register No (BSG-...)"
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 rounded-lg bg-gym-850 text-xs text-slate-100 placeholder-slate-500 border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-brand-cyan"
                  />
                  {memberSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setMemberSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filtered members list */}
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-gym-950/90 divide-y divide-slate-800/60">
                  {filteredMembers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      {memberSearchQuery
                        ? `No members found matching "${memberSearchQuery}". Try NIC, phone, or register number.`
                        : 'No members available on file.'}
                    </div>
                  ) : (
                    filteredMembers.map((m) => (
                      <div
                        key={m.id}
                        onClick={() => handleSelectMember(m)}
                        className="p-2.5 hover:bg-brand-cyan/10 hover:border-brand-cyan/20 cursor-pointer transition flex items-center justify-between gap-3 group"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-xs text-slate-200 group-hover:text-brand-cyan">
                              {m.full_name}
                            </span>
                            <span className="font-mono text-[10px] text-brand-cyan px-1.5 py-0.5 rounded bg-gym-850">
                              {m.member_code}
                            </span>
                            <Badge
                              variant={
                                m.status === 'Active'
                                  ? 'emerald'
                                  : m.status === 'Expired'
                                  ? 'rose'
                                  : 'default'
                              }
                            >
                              {m.status}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                            {m.nic_number && <span>NIC: {m.nic_number}</span>}
                            {(m.phone || m.whatsapp_number) && (
                              <span>{formatPhone(m.phone || m.whatsapp_number)}</span>
                            )}
                            <span>{m.plan_name || 'No Plan'}</span>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono font-semibold text-slate-300 shrink-0">
                          {m.plan_price ? formatCurrency(m.plan_price, currency) : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  Showing {filteredMembers.length} of {members.length} members. Type name, NIC, phone or code to filter.
                </p>
              </div>
            )}
          </div>

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
                className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
              >
                {paymentService.PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedMember?.plan_id && (
            <div className="p-3 rounded-lg bg-gym-950 border border-slate-800 space-y-1.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={renewCycle}
                  onChange={(e) => setRenewCycle(e.target.checked)}
                  className="mt-0.5 rounded bg-gym-850 border-slate-700 text-brand-cyan focus:ring-brand-cyan"
                />
                <div>
                  <span className="text-xs font-semibold text-slate-200">
                    Renew / advance membership cycle
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Restarts the 28-day billing cycle for {selectedMember.plan_name}, extends expiration,
                    and clears this member from the payment reminders list.
                  </p>
                </div>
              </label>
            </div>
          )}

          {isAdmin && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Status</label>
              <select
                value={formData.payment_status}
                onChange={(e) => setFormData({ ...formData, payment_status: e.target.value })}
                className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
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
              disabled={submitting || !formData.member_id}
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
            <div className="p-6 rounded-2xl bg-gym-950 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b">
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

              <div className="pt-3 border-t flex justify-between items-center text-sm font-bold">
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
