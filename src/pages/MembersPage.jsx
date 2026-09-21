import { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Plus,
  Search,
  QrCode,
  CheckCircle,
  XCircle,
  Trash2,
  Filter,
  Download,
  Dumbbell,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { memberService } from '../services/memberService';
import { planService } from '../services/planService';

export function MembersPage() {
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedQRMember, setSelectedQRMember] = useState(null);

  // New member form
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    gender: 'Male',
    emergency_contact: '',
    plan_id: '',
    payment_method: 'Cash',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersData, plansData] = await Promise.all([
        memberService.getMembers(search, statusFilter),
        planService.getPlans(),
      ]);
      setMembers(membersData);
      setPlans(plansData);
      if (plansData.length > 0 && !formData.plan_id) {
        setFormData((prev) => ({ ...prev, plan_id: plansData[0].id }));
      }
    } catch (err) {
      console.error('Error loading members page data:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, formData.plan_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateMember = async (e) => {
    e.preventDefault();
    if (!formData.full_name || !formData.phone) {
      setFormError('Please enter full name and phone number.');
      return;
    }

    try {
      setFormError('');
      setSubmitting(true);
      const selectedPlan = plans.find((p) => p.id === formData.plan_id);
      await memberService.createMember(
        {
          ...formData,
          plan_name: selectedPlan?.name || 'Basic Monthly',
        },
        formData.plan_id
      );
      setIsAddModalOpen(false);
      setFormData({
        full_name: '',
        email: '',
        phone: '',
        gender: 'Male',
        emergency_contact: '',
        plan_id: plans[0]?.id || '',
        payment_method: 'Cash',
      });
      await loadData();
    } catch (err) {
      console.error('Failed to create member:', err);
      setFormError(err.message || 'Failed to register member.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (member) => {
    const newStatus = member.status === 'Active' ? 'Inactive' : 'Active';
    await memberService.updateMemberStatus(member.id, newStatus);
    await loadData();
  };

  const handleDeleteMember = async (id) => {
    if (window.confirm('Are you sure you want to delete this member?')) {
      await memberService.deleteMember(id);
      await loadData();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members Management"
        description="View, register, search, and manage gym member directory and digital pass QR codes."
      >
        <Button variant="primary" icon={Plus} onClick={() => setIsAddModalOpen(true)}>
          Add New Member
        </Button>
      </PageHeader>

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-gym-900/80 border-gym-800">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name, code, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-950 border border-gym-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Filter:
            </span>
            {['ALL', 'Active', 'Inactive', 'Expired'].map((status) => (
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
      </Card>

      {/* Members Directory Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-gym-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member Info</th>
                <th className="py-3.5 px-4">Code / QR ID</th>
                <th className="py-3.5 px-4">Assigned Plan</th>
                <th className="py-3.5 px-4">Expiration</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gym-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    Loading member database...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    No members matching search query or filter.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gym-800 flex items-center justify-center font-bold text-brand-cyan text-sm">
                          {member.full_name ? member.full_name.charAt(0) : 'M'}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-100">{member.full_name}</p>
                          <p className="text-[11px] text-slate-400">{member.phone || member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      <span className="px-2 py-0.5 rounded bg-gym-950 border border-gym-800 font-semibold text-brand-cyan">
                        {member.member_code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-200">
                      {member.plan_name || 'Basic Monthly'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {member.expiration_date || 'N/A'}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge
                        variant={
                          member.status === 'Active'
                            ? 'emerald'
                            : member.status === 'Expired'
                            ? 'rose'
                            : 'amber'
                        }
                      >
                        {member.status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => setSelectedQRMember(member)}
                        className="p-1.5 rounded-lg bg-gym-800 hover:bg-brand-cyan hover:text-white text-slate-300 transition"
                        title="View Digital QR Pass"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(member)}
                        className="p-1.5 rounded-lg bg-gym-800 hover:bg-gym-700 text-slate-300 transition"
                        title="Toggle Active Status"
                      >
                        {member.status === 'Active' ? (
                          <XCircle className="w-4 h-4 text-amber-400" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteMember(member.id)}
                        className="p-1.5 rounded-lg bg-gym-800 hover:bg-rose-500/20 text-rose-400 transition"
                        title="Delete Member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Member Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Register New Gym Member"
      >
        {formError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 mb-4">
            {formError}
          </div>
        )}
        <form onSubmit={handleCreateMember} className="space-y-4">
          <Input
            label="Full Name *"
            placeholder="John Doe"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Phone Number *"
              placeholder="+1 555-0199"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
            />
            <Input
              label="Email Address"
              type="email"
              placeholder="member@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2 focus:outline-none focus:border-brand-cyan"
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Assigned Plan Tier</label>
              <select
                value={formData.plan_id}
                onChange={(e) => setFormData({ ...formData, plan_id: e.target.value })}
                className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2 focus:outline-none focus:border-brand-cyan"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (${p.price} / {p.duration_days} days)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Input
            label="Emergency Contact"
            placeholder="+1 555-9900 (Relation)"
            value={formData.emergency_contact}
            onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Registering...' : 'Register Member & Generate QR'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Digital Pass QR Modal */}
      <Modal
        isOpen={Boolean(selectedQRMember)}
        onClose={() => setSelectedQRMember(null)}
        title="Member Digital QR Pass"
      >
        {selectedQRMember && (
          <div className="flex flex-col items-center justify-center text-center space-y-4 py-2">
            <div className="p-6 rounded-2xl bg-white shadow-2xl border-4 border-brand-cyan">
              <QRCodeSVG
                value={selectedQRMember.qr_code_id || selectedQRMember.member_code}
                size={180}
                level="H"
                includeMargin={true}
              />
            </div>

            <div>
              <div className="flex items-center justify-center gap-2">
                <Dumbbell className="w-5 h-5 text-brand-cyan" />
                <h3 className="text-xl font-bold text-slate-100">{selectedQRMember.full_name}</h3>
              </div>
              <p className="text-xs font-mono text-brand-cyan font-bold mt-1">
                {selectedQRMember.member_code}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Plan: {selectedQRMember.plan_name} • Expires: {selectedQRMember.expiration_date}
              </p>
            </div>

            <div className="w-full pt-4 border-t border-gym-800 flex justify-center gap-3">
              <Button
                variant="secondary"
                icon={Download}
                onClick={() => window.print()}
              >
                Print / Download Pass
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
