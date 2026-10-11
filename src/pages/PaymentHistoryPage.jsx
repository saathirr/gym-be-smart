import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, FileText, Printer, Receipt } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { memberService } from '../services/memberService';
import { reminderService } from '../services/reminderService';
import { paymentService } from '../services/paymentService';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';
import { formatCurrency, formatDate } from '../utils/formatters';
import { formatTimestamp } from '../utils/attendanceMath';

const METHOD_LABELS = {
  Cash: 'Cash',
  Card: 'Card',
  Bank_Transfer: 'Bank transfer',
  Online: 'Online wallet',
  UPI: 'UPI',
};

function methodLabel(method) {
  return METHOD_LABELS[method] || method || 'N/A';
}

function statusVariant(status) {
  if (status === 'Paid') return 'emerald';
  if (status === 'Refunded') return 'violet';
  if (status === 'Failed') return 'rose';
  return 'amber';
}

// Time of day in the club's timezone. The date is a separate column, so this
// deliberately prints only the clock.
function formatTime(value, timeZone) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function PaymentHistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currency, settings, gymName } = useGym();

  const [member, setMember] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedReceipt, setSelectedReceipt] = useState(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [profile, reminderRows] = await Promise.all([
        memberService.getMemberProfile(id),
        reminderService.getRemindersForMember(id),
      ]);

      if (!profile) {
        setError('That player could not be found.');
        setMember(null);
        return;
      }

      setMember(profile);
      setReminders(reminderRows);
    } catch (err) {
      setError(toMessage(err, 'Could not load the payment history.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const payments = useMemo(() => member?.paymentHistory || [], [member]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return payments.filter((payment) => {
      if (methodFilter !== 'ALL' && payment.payment_method !== methodFilter) return false;
      if (statusFilter !== 'ALL' && payment.payment_status !== statusFilter) return false;
      if (!term) return true;
      return (
        payment.receipt_number?.toLowerCase().includes(term) ||
        payment.notes?.toLowerCase().includes(term) ||
        String(payment.amount).includes(term)
      );
    });
  }, [payments, search, methodFilter, statusFilter]);

  const stats = useMemo(() => {
    const paid = payments.filter((payment) => payment.payment_status === 'Paid');
    const total = paid.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const last = payments[0] || null;
    return {
      total,
      count: payments.length,
      paidCount: paid.length,
      last,
      average: paid.length ? total / paid.length : 0,
    };
  }, [payments]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 rounded-lg bg-gym-850/60 animate-pulse" />
        <div className="h-64 rounded-xl bg-gym-900/70 animate-pulse" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <Card>
        <CardHeader>
          <CardTitle icon={Receipt}>Payment history</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-300">{error || 'That player could not be found.'}</p>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/members')}>Back to members</Button>
            <Button variant="ghost" onClick={load}>
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment history"
        description={`${member.full_name} · ${member.member_code}`}
      >
        <Button
          variant="ghost"
          icon={ArrowLeft}
          onClick={() => navigate(`/members/${id}`)}
        >
          Profile
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryTile label="Total paid" value={formatCurrency(stats.total, currency)} />
        <SummaryTile label="Transactions" value={stats.count} />
        <SummaryTile
          label="Last payment"
          value={stats.last ? formatDate(stats.last.transaction_date, 'MMM dd, yyyy') : 'None'}
        />
        <SummaryTile label="Average payment" value={formatCurrency(stats.average, currency)} />
      </div>

      <Card className="p-4 bg-gym-900/80">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <input
            type="text"
            placeholder="Search receipt, note or amount..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full lg:w-80 px-4 py-2 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
          />

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <div className="flex flex-wrap items-center gap-2">
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
                  {method === 'ALL' ? 'All' : methodLabel(method)}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Receipt</th>
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-4">Time</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Method</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Notes</th>
                <th className="py-3.5 px-4 text-right">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-slate-400">
                    {payments.length === 0
                      ? 'No payments recorded yet.'
                      : 'No payments match these filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-mono font-bold text-brand-cyan">
                      {payment.receipt_number}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {formatDate(payment.transaction_date, 'MMM dd, yyyy')}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatTime(payment.transaction_date, settings?.timezone)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-sm font-bold text-slate-100">
                      {formatCurrency(payment.amount, currency)}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {methodLabel(payment.payment_method)}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={statusVariant(payment.payment_status)}>
                        {payment.payment_status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 max-w-[220px] truncate">
                      {payment.notes || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedReceipt(payment)}
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

      {reminders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle icon={Receipt}>WhatsApp reminders sent</CardTitle>
          </CardHeader>
          <ul className="space-y-2">
            {reminders.map((reminder) => (
              <li
                key={reminder.id}
                className="rounded-xl bg-gym-850/50 p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-200">
                    {reminder.days_since_start != null
                      ? `Day ${reminder.days_since_start + 1} reminder`
                      : 'Payment reminder'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatTimestamp(reminder.sent_at, settings?.timezone)} · {reminder.channel}
                  </p>
                </div>
                <Badge variant={reminder.status === 'Sent' ? 'emerald' : 'amber'}>
                  {reminder.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
                  <h3 className="font-extrabold text-slate-100 text-lg uppercase">{gymName}</h3>
                  <p className="text-[11px] text-slate-400">Official receipt</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-brand-cyan font-bold text-sm">
                    {selectedReceipt.receipt_number}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {formatTimestamp(selectedReceipt.transaction_date, settings?.timezone)}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <Row label="Member" value={`${member.full_name} (${member.member_code})`} />
                <Row label="Method" value={methodLabel(selectedReceipt.payment_method)} />
                <Row label="Status" value={selectedReceipt.payment_status} />
                {selectedReceipt.notes && <Row label="Notes" value={selectedReceipt.notes} />}
              </div>

              <div className="pt-3 border-t flex justify-between items-center text-sm font-bold">
                <span className="text-slate-300">Total paid</span>
                <span className="text-brand-cyan text-lg font-mono">
                  {formatCurrency(selectedReceipt.amount, currency)}
                </span>
              </div>

              {settings?.invoice_footer && (
                <p className="text-[10px] text-slate-500 text-center pt-2">
                  {settings.invoice_footer}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Link
                to={`/members/${id}`}
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gym-850 text-xs text-slate-200 hover:bg-gym-800"
              >
                Back to profile
              </Link>
              <Button variant="secondary" icon={Printer} onClick={() => window.print()}>
                Print receipt
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {member.paymentHistory.length === 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>
            No payments on file for this player. Record one from the Payments screen to start their
            history.
          </span>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold font-mono text-slate-100 mt-1">{value}</p>
    </Card>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  );
}
