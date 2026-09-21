import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { membershipService } from '../services/membershipService';
import { planService } from '../services/planService';
import { formatCurrency, formatDate } from '../utils/formatters';

export function MembershipsPage() {
  const [memberships, setMemberships] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Renewal Modal
  const [selectedSub, setSelectedSub] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [renewing, setRenewing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [subsData, plansData] = await Promise.all([
        membershipService.getMemberships(),
        planService.getPlans(),
      ]);
      setMemberships(subsData);
      setPlans(plansData);
      if (plansData.length > 0 && !selectedPlanId) {
        setSelectedPlanId(plansData[0].id);
      }
    } catch (err) {
      console.error('Error loading memberships:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenRenewModal = (sub) => {
    setSelectedSub(sub);
    const matchedPlan = plans.find((p) => p.name === sub.plan_name) || plans[0];
    if (matchedPlan) setSelectedPlanId(matchedPlan.id);
  };

  const handleProcessRenewal = async (e) => {
    e.preventDefault();
    if (!selectedSub || !selectedPlanId) return;

    try {
      setRenewing(true);
      const plan = plans.find((p) => p.id === selectedPlanId);
      await membershipService.renewMembership(
        selectedSub.member_id || selectedSub.id,
        selectedPlanId,
        plan?.duration_days || 30,
        plan?.price || 49
      );
      setSelectedSub(null);
      await loadData();
    } catch (err) {
      console.error('Renewal error:', err);
    } finally {
      setRenewing(false);
    }
  };

  const filteredMemberships = memberships.filter((item) =>
    item.member_name?.toLowerCase().includes(search.toLowerCase()) ||
    item.member_code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Active Memberships & Subscriptions"
        description="Monitor active member subscription lifecycles, expiration alerts, and renewal workflows."
      />

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-gym-900/80 border-gym-800">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by member name, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-950 border border-gym-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Total Enrolled Subscriptions:</span>
            <Badge variant="cyan">{memberships.length} Active</Badge>
          </div>
        </div>
      </Card>

      {/* Memberships Directory Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-gym-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Subscription Plan</th>
                <th className="py-3.5 px-4">Start Date</th>
                <th className="py-3.5 px-4">Expiration Date</th>
                <th className="py-3.5 px-4">Price</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gym-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    Loading active memberships...
                  </td>
                </tr>
              ) : filteredMemberships.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    No subscriptions matching search criteria.
                  </td>
                </tr>
              ) : (
                filteredMemberships.map((item) => (
                  <tr key={item.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      {item.member_name}
                      <span className="block text-[11px] text-brand-cyan font-mono font-normal">
                        {item.member_code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-200">
                      {item.plan_name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(item.start_date)}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(item.end_date)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={item.status === 'Active' ? 'emerald' : 'amber'}>
                        {item.status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={RefreshCw}
                        onClick={() => handleOpenRenewModal(item)}
                      >
                        Renew Plan
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Subscription Renewal Modal */}
      <Modal
        isOpen={Boolean(selectedSub)}
        onClose={() => setSelectedSub(null)}
        title="Renew Member Subscription"
      >
        {selectedSub && (
          <form onSubmit={handleProcessRenewal} className="space-y-4">
            <div className="p-3 rounded-lg bg-gym-950 border border-gym-800 space-y-1">
              <p className="text-xs font-semibold text-slate-200">{selectedSub.member_name}</p>
              <p className="text-[11px] text-slate-400">Code: {selectedSub.member_code}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Select Renewal Package Tier
              </label>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.price} ({p.duration_days} Days)
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedSub(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={renewing} icon={RefreshCw}>
                {renewing ? 'Renewing...' : 'Confirm Renewal & Record Payment'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
