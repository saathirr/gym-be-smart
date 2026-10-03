import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  UserPlus,
  Users,
  AlertCircle,
  CheckCircle2,
  UserCheck,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { staffService } from '../services/staffService';
import { authService } from '../services/authService';
import { formatDate } from '../utils/formatters';
import { toMessage } from '../lib/supabaseErrors';

function roleBadgeVariant(role) {
  if (role === 'super_admin' || role === 'owner') return 'gold';
  if (role === 'admin') return 'cyan';
  return 'emerald';
}

function formatRoleLabel(role) {
  if (role === 'super_admin' || role === 'owner') return 'Super Admin (Owner)';
  if (role === 'admin') return 'Administrator';
  return 'Gym Staff';
}

export function AdminAccessPage() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadStaff = async () => {
    setLoading(true);
    try {
      const data = await staffService.listStaff();
      setStaffList(data);
    } catch (err) {
      setError(toMessage(err, 'Could not load staff accounts.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setFormError('Enter both an email and password.');
      return;
    }
    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    setCreating(true);
    setFormError('');
    try {
      await authService.createStaffAccount({
        email,
        password,
        fullName,
        role,
      });

      setSuccessMessage(`Account for ${fullName || email} created as ${formatRoleLabel(role)}.`);
      setIsModalOpen(false);
      setFullName('');
      setEmail('');
      setPassword('');
      setRole('staff');
      await loadStaff();
    } catch (err) {
      setFormError(toMessage(err, 'Could not create staff account.'));
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (staffId, newRole) => {
    try {
      await staffService.updateRole(staffId, newRole);
      setSuccessMessage(`Updated staff role successfully.`);
      await loadStaff();
    } catch (err) {
      setError(toMessage(err, 'Could not update role.'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Access & Staff Management"
        description="Super Admin workspace for managing staff permissions, creating admin accounts, and assigning access levels."
      >
        <div className="flex items-center gap-2">
          <Badge variant="gold" className="px-3 py-1 text-xs uppercase tracking-wider">
            Super Admin Control Panel
          </Badge>
          <Button variant="primary" icon={UserPlus} onClick={() => setIsModalOpen(true)}>
            Add New Staff Account
          </Button>
        </div>
      </PageHeader>

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button type="button" onClick={() => setSuccessMessage('')} className="text-slate-400 hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Role Level Legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 bg-gym-900/90 border-l-4 border-brand-gold space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-brand-gold uppercase tracking-wider">
              Super Admin (Owner)
            </span>
            <ShieldCheck className="w-4 h-4 text-brand-gold" />
          </div>
          <p className="text-xs text-slate-300 font-medium">Full Gym Access</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Full operational control + Activity Audit Logs, Change History, and Staff Account Management.
          </p>
        </Card>

        <Card className="p-4 bg-gym-900/90 border-l-4 border-brand-cyan space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-brand-cyan uppercase tracking-wider">
              Administrator
            </span>
            <UserCheck className="w-4 h-4 text-brand-cyan" />
          </div>
          <p className="text-xs text-slate-300 font-medium">Gym Operations & Reports</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Registers members, manages plans, views financial payments and exports attendance reports.
          </p>
        </Card>

        <Card className="p-4 bg-gym-900/90 border-l-4 border-emerald-400 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Gym Staff
            </span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xs text-slate-300 font-medium">Front Desk & Check-in</p>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Scans QR passes, logs member attendance, and looks up player profile cards.
          </p>
        </Card>
      </div>

      {/* Staff Accounts Table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand-gold" />
            Provisioned Staff & Admin Accounts ({staffList.length})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-hairline text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Staff Member</th>
                <th className="py-3.5 px-4">Email Address</th>
                <th className="py-3.5 px-4">Current Role</th>
                <th className="py-3.5 px-4">Created Date</th>
                <th className="py-3.5 px-4 text-right">Change Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="5" className="text-center py-8 text-slate-400">
                    Loading accounts...
                  </td>
                </tr>
              ) : staffList.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-8 text-slate-400">
                    No staff accounts found.
                  </td>
                </tr>
              ) : (
                staffList.map((member) => (
                  <tr key={member.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      {member.full_name || 'Staff Member'}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">{member.email}</td>
                    <td className="py-3.5 px-4">
                      <Badge variant={roleBadgeVariant(member.role)}>
                        {formatRoleLabel(member.role)}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono">
                      {formatDate(member.created_at, 'yyyy-MM-dd')}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <select
                        value={member.role || 'staff'}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        className="rounded-lg bg-gym-850 text-xs text-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40 border border-hairline"
                      >
                        <option value="staff">Gym Staff</option>
                        <option value="admin">Administrator</option>
                        <option value="super_admin">Super Admin (Owner)</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Staff Account Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Staff / Admin Account"
      >
        {formError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleCreateStaff} className="space-y-4">
          <Input
            label="Full Name"
            placeholder="e.g. Nimal Siriwardena"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />

          <Input
            label="Email Address *"
            type="email"
            placeholder="nimal@besmartfitness.lk"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <Input
            label="Initial Password *"
            type="password"
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Access Role Level
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
            >
              <option value="staff">Gym Staff (Front Desk Check-in)</option>
              <option value="admin">Administrator (Operations & Reports)</option>
              <option value="super_admin">Super Admin (Gym Owner - Full Access)</option>
            </select>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-2"
            disabled={creating}
            icon={UserPlus}
          >
            {creating ? 'Creating Account...' : 'Provision Account'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
