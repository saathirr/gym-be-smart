import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, AlertCircle, XCircle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { membershipService } from '../services/membershipService';
import { planService } from '../services/planService';
import { formatCurrency, formatDate } from '../utils/formatters';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';

const STATUS_TABS = ['ALL', 'Active', 'Expiring', 'Expired', 'Cancelled'];

function expiryBadgeVariant(days, status) {
  if (status === 'Active' || status === 'Expiring') {
    if (days !== null && days < 0) return 'rose';
    if (days !== null && days <= 7) return 'amber';
  }
  return status === 'Active' || status === 'Expiring' ? 'emerald' : 'default';
}

export function MembershipsPage() {
  const [memberships, setMemberships] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('ALL');
  const [notice, setNotice] = useState('');

  const [selectedSub, setSelectedSub] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [renewError, setRenewError] = useState('');
  const [renewing, setRenewing] = useState(false);

  const { currency } = useGym();
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const synced = await membershipService.syncExpired();
      if (synced > 0) {
        setNotice(`${synced} membership${synced === 1 ? '' : 's'} closed out as expired.`);
      }

      const [subRows, planRows] = await Promise.all([
        membershipService.getMemberships({ status: statusTab }),
        planService.getPlans({ includeInactive: false }),
      ]);

      setMemberships(subRows);
      setPlans(planRows);
    } catch (err) {
      setError(toMessage(err, 'Could not load memberships.'));
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [statusTab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const handleOpenRenewModal = (sub) => {
    setSelectedSub(sub);
    setRenewError('');
    const samePlan = plans.find((p) => p.id === sub.plan_id) || plans[0];
    setSelectedPlanId(samePlan?.id || '');
    setPaymentMethod('Cash');
  };

  const handleProcessRenewal = async (e) => {
    e.preventDefault();
    if (!selectedSub?.member_id || !selectedPlanId) {
      setRenewError('Pick a plan to renew into.');
      return;
    }

    try {
      setRenewing(true);
      setRenewError('');

      const result = await membershipService.renewMembership(
        selectedSub.member_id,
        selectedPlanId,
        { paymentMethod }
      );

      setSelectedSub(null);
      setNotice(
        result?.end_date
          ? `Renewed through ${formatDate(result.end_date)}${
              result?.receipt_number ? ` • receipt ${result.receipt_number}` : ''
            }`
          : 'Membership renewed.'
      );
      await loadData();
    } catch (err) {
      setRenewError(toMessage(err, 'Could not renew this membership.'));
    } finally {
      setRenewing(false);
    }
  };

  const handleCancel = async (sub) => {
    if (!window.confirm(`Cancel the ${sub.plan_name} plan for ${sub.member_name}?`)) return;

    try {
      await membershipService.cancelMembership(sub.id);
      await loadData();
    } catch (err) {
      setError(toMessage(err, 'Could not cancel this membership.'));
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = term
    ? memberships.filter(
        (item) =>
          item.member_name?.toLowerCase().includes(term) ||
          item.member_code?.toLowerCase().includes(term) ||
          item.plan_name?.toLowerCase().includes(term)
      )
    : memberships;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Memberships"
        description="Track subscription windows, renewals, and upcoming expirations."
      />

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

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}

      <Card className="p-4 bg-gym-900/80 border-edge">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search member or plan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-950 border border-edge text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  statusTab === tab
                    ? 'bg-brand-cyan text-white shadow-md'
                    : 'bg-gym-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-edge text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Plan</th>
                <th className="py-3.5 px-4">Period</th>
                <th className="py-3.5 px-4">Price</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    Loading memberships...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    No subscriptions found. Register a member with a plan to create one.
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      {item.member_name}
                      <span className="block text-[11px] text-brand-cyan font-mono font-normal">
                        {item.member_code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-200">{item.plan_name}</td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(item.start_date)} &rarr; {formatDate(item.end_date)}
                      {item.days_remaining !== null &&
                        (item.days_remaining < 0
                          ? ` (${Math.abs(item.days_remaining)}d overdue)`
                          : ` (${item.days_remaining}d left)`)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                      {formatCurrency(item.amount, currency)}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={expiryBadgeVariant(item.days_remaining, item.status)}>
                        {item.status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {item.status === 'Active' || item.status === 'Expiring' ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={RefreshCw}
                            onClick={() => handleOpenRenewModal(item)}
                          >
                            Renew
                          </Button>
                          <button
                            onClick={() => handleCancel(item)}
                            className="p-1.5 ml-1 rounded-lg bg-gym-800 hover:bg-rose-500/20 text-rose-400 transition"
                            title="Cancel membership"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setSelectedSub(item);
                            setSelectedPlanId(item.plan_id || plans[0]?.id || '');
                            setRenewError('');
                            setPaymentMethod('Cash');
                          }}
                        >
                          Reactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={Boolean(selectedSub)}
        onClose={() => setSelectedSub(null)}
        title="Renew membership"
      >
        {selectedSub && (
          <form onSubmit={handleProcessRenewal} className="space-y-4">
            <div className="p-3 rounded-lg bg-gym-950 border border-edge space-y-1">
              <p className="text-xs font-semibold text-slate-200">{selectedSub.member_name}</p>
              <p className="text-[11px] text-slate-400 font-mono">{selectedSub.member_code}</p>
              <p className="text-[11px] text-slate-400">
                Current plan: {selectedSub.plan_name} &middot; ends{' '}
                {formatDate(selectedSub.end_date)}
              </p>
            </div>

            {renewError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                <span>{renewError}</span>
              </div>
            )}

            {plans.length === 0 ? (
              <p className="text-xs text-amber-400">
                No active plans exist. Create one on the Plans page before renewing.
              </p>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Renewal plan
                  </label>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="w-full rounded-lg bg-gym-950 border border-edge text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} &mdash; {formatCurrency(plan.price, currency)} ({plan.duration_days} days)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Payment method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full rounded-lg bg-gym-950 border border-edge text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="Bank_Transfer">Bank transfer</option>
                    <option value="Online">Online wallet</option>
                  </select>
                </div>

                <p className="text-[11px] text-slate-500">
                  The current subscription is closed and a new one opened in a single
                  transaction, so a member can never hold two active plans.
                </p>

                <div className="pt-2 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setSelectedSub(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={renewing} icon={RefreshCw}>
                    {renewing ? 'Renewing...' : 'Confirm renewal'}
                  </Button>
                </div>
              </>
            )}

            {!selectedSub.member_id && (
              <Button
                variant="secondary"
                onClick={() => navigate('/members')}
                className="w-full"
              >
                Open member directory
              </Button>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
