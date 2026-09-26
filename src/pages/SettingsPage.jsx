import { useCallback, useEffect, useState } from 'react';
import {
  Save,
  Building2,
  MapPin,
  Users,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Database,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { settingsService } from '../services/settingsService';
import { staffService } from '../services/staffService';
import { authService } from '../services/authService';
import { useAuth } from '../hooks/useAuth';
import { useGym } from '../hooks/useGym';
import { SRI_LANKAN_DISTRICTS } from '../utils/constants';
import { toMessage } from '../lib/supabaseErrors';

const ROLES = ['admin', 'staff', 'trainer'];

function Tab({ active, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium rounded-lg transition flex items-center gap-2 ${
        active ? 'bg-brand-cyan text-white shadow-md' : 'bg-gym-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
      {count !== undefined && (
        <span
          className={`px-1.5 rounded-full text-[10px] ${
            active ? 'bg-white/20' : 'bg-gym-950'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState('profile');
  const { user, isAdmin, refreshUser } = useAuth();
  const { settings, reload } = useGym();

  const [form, setForm] = useState(settings);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState('');
  const [error, setError] = useState('');

  const [branches, setBranches] = useState([]);
  const [editingBranch, setEditingBranch] = useState(null);
  const [branchForm, setBranchForm] = useState({ name: '', code: '', phone: '', address: '' });
  const [savingBranch, setSavingBranch] = useState(false);

  const [staff, setStaff] = useState([]);
  const [staffForm, setStaffForm] = useState({ email: '', password: '', fullName: '', role: 'staff' });
  const [staffError, setStaffError] = useState('');
  const [staffNotice, setStaffNotice] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const loadBranches = useCallback(async () => {
    try {
      setBranches(await settingsService.getBranches());
    } catch (err) {
      setError(toMessage(err, 'Could not load branches.'));
    }
  }, []);

  const loadStaff = useCallback(async () => {
    try {
      setStaff(await staffService.listStaff());
    } catch (err) {
      setError(toMessage(err, 'Could not load staff accounts.'));
    }
  }, []);

  useEffect(() => {
    if (tab === 'branches') loadBranches();
    if (tab === 'staff') loadStaff();
  }, [tab, loadBranches, loadStaff]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      setSavingProfile(true);
      setError('');
      setProfileNotice('');
      await settingsService.saveGymSettings(form);
      await reload();
      setProfileNotice('Club profile saved.');
    } catch (err) {
      setError(toMessage(err, 'Could not save the club profile.'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveBranch = async (e) => {
    e.preventDefault();
    try {
      setSavingBranch(true);
      setError('');
      await settingsService.saveBranch(branchForm);
      setEditingBranch(null);
      setBranchForm({ name: '', code: '', phone: '', address: '' });
      await Promise.all([loadBranches(), reload()]);
    } catch (err) {
      setError(toMessage(err, 'Could not save the branch.'));
    } finally {
      setSavingBranch(false);
    }
  };

  const handleDeleteBranch = async (branch) => {
    if (!window.confirm(`Delete the "${branch.name}" branch? Members keep their records.`)) {
      return;
    }
    try {
      await settingsService.deleteBranch(branch.id);
      await Promise.all([loadBranches(), reload()]);
    } catch (err) {
      setError(toMessage(err, 'Could not delete that branch.'));
    }
  };

  const handleCreateStaff = async (e) => {
    e.preventDefault();
    try {
      setCreatingStaff(true);
      setStaffError('');
      setStaffNotice('');

      await authService.createStaffAccount(staffForm);
      setStaffForm({ email: '', password: '', fullName: '', role: 'staff' });
      setStaffNotice('Staff account created.');
      await loadStaff();
    } catch (err) {
      setStaffError(toMessage(err, 'Could not create that staff account.'));
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleRoleChange = async (account, role) => {
    try {
      setError('');
      await staffService.updateRole(account.id, role);
      await loadStaff();
      if (account.id === user?.id) await refreshUser();
    } catch (err) {
      setError(toMessage(err, 'Could not change that role.'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Club identity, locations, and who can access this system."
      >
        <div className="flex items-center gap-2">
          <Tab active={tab === 'profile'} label="Club profile" onClick={() => setTab('profile')} />
          <Tab active={tab === 'branches'} label="Branches" onClick={() => setTab('branches')} />
          <Tab
            active={tab === 'staff'}
            label="Staff"
            onClick={() => setTab('staff')}
          />
        </div>
      </PageHeader>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-xs text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {tab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 p-6 space-y-6 border-gym-800">
            <div className="flex items-center gap-2 pb-3 border-b border-gym-800">
              <Building2 className="w-5 h-5 text-brand-cyan" />
              <h3 className="text-base font-bold text-slate-100">Club profile</h3>
            </div>

            {profileNotice && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {profileNotice}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Club name"
                  value={form.gym_name}
                  onChange={(e) => setForm({ ...form, gym_name: e.target.value })}
                  required
                />
                <Input
                  label="Tagline"
                  placeholder="Train smarter. Live stronger."
                  value={form.tagline || ''}
                  onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Phone"
                  value={form.phone || ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <Input
                  label="Support email"
                  type="email"
                  value={form.support_email || ''}
                  onChange={(e) => setForm({ ...form, support_email: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">District</label>
                  <select
                    value={form.district || 'Colombo'}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                    className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
                  >
                    {SRI_LANKAN_DISTRICTS.map((district) => (
                      <option key={district} value={district}>
                        {district}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Opens"
                  type="time"
                  value={form.opening_time || '05:30'}
                  onChange={(e) => setForm({ ...form, opening_time: e.target.value })}
                />
                <Input
                  label="Closes"
                  type="time"
                  value={form.closing_time || '22:00'}
                  onChange={(e) => setForm({ ...form, closing_time: e.target.value })}
                />
              </div>

              <Input
                label="Address"
                value={form.address || ''}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Currency</label>
                  <select
                    value={form.currency || 'LKR'}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
                  >
                    <option value="LKR">LKR (Rs.)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
                <Input
                  label="Receipt footer"
                  placeholder="Thank you for training with us."
                  value={form.invoice_footer || ''}
                  onChange={(e) => setForm({ ...form, invoice_footer: e.target.value })}
                />
              </div>

              <div className="pt-2 flex justify-end">
                <Button type="submit" variant="primary" icon={Save} disabled={savingProfile}>
                  {savingProfile ? 'Saving...' : 'Save profile'}
                </Button>
              </div>
            </form>
          </Card>

          <div className="space-y-6">
            <Card className="p-6 space-y-4 border-gym-800">
              <div className="flex items-center gap-2 pb-2 border-b border-gym-800">
                <Database className="w-5 h-5 text-brand-emerald" />
                <h3 className="text-sm font-bold text-slate-100">Database</h3>
              </div>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Supabase</span>
                  <Badge variant="emerald">Connected</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Row level security</span>
                  <Badge variant="emerald">Enforced</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Your role</span>
                  <Badge variant="cyan">{user?.role || 'staff'}</Badge>
                </div>
              </div>
            </Card>

            <Card className="p-6 space-y-3 border-gym-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-brand-violet" />
                <h3 className="text-sm font-bold text-slate-100">Access control</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Row level security limits every table to signed-in staff. Only
                administrators can change plan pricing, delete records, or manage staff
                accounts.
              </p>
            </Card>
          </div>
        </div>
      )}

      {tab === 'branches' && (
        <Card className="p-6 space-y-5 border-gym-800">
          <div className="flex items-center justify-between pb-3 border-b border-gym-800">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-brand-cyan" />
              <h3 className="text-base font-bold text-slate-100">Branch locations</h3>
            </div>
            {isAdmin && (
              <Button
                variant="primary"
                size="sm"
                icon={Plus}
                onClick={() => {
                  setEditingBranch({});
                  setBranchForm({ name: '', code: '', phone: '', address: '' });
                }}
              >
                Add branch
              </Button>
            )}
          </div>

          {branches.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">
              No branches yet. Add your main location so members can be assigned to it.
            </p>
          ) : (
            <div className="space-y-3">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-gym-950/60 border border-gym-800/60"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {branch.name}
                      {branch.code && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-gym-950 border border-gym-800 font-mono text-[10px] text-brand-cyan">
                          {branch.code}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {[branch.address, branch.district, branch.phone].filter(Boolean).join(' • ') ||
                        'No address on file'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={branch.is_active ? 'emerald' : 'default'}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => {
                            setEditingBranch(branch);
                            setBranchForm({
                              name: branch.name || '',
                              code: branch.code || '',
                              phone: branch.phone || '',
                              address: branch.address || '',
                            });
                          }}
                          className="p-1.5 rounded-lg bg-gym-800 hover:bg-sky-500 hover:text-white text-slate-300 transition"
                          title="Edit branch"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBranch(branch)}
                          className="p-1.5 rounded-lg bg-gym-800 hover:bg-rose-500/20 text-rose-400 transition"
                          title="Delete branch"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Modal
            isOpen={Boolean(editingBranch)}
            onClose={() => setEditingBranch(null)}
            title={editingBranch?.id ? 'Edit branch' : 'Add branch'}
          >
            <form onSubmit={handleSaveBranch} className="space-y-4">
              <Input
                label="Branch name *"
                placeholder="e.g. Colombo Main"
                value={branchForm.name}
                onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Code"
                  placeholder="CMB"
                  value={branchForm.code}
                  onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                />
                <Input
                  label="Phone"
                  value={branchForm.phone}
                  onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                />
              </div>
              <Input
                label="Address"
                value={branchForm.address}
                onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
              />
              <div className="pt-2 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditingBranch(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={savingBranch}>
                  {savingBranch ? 'Saving...' : 'Save branch'}
                </Button>
              </div>
            </form>
          </Modal>
        </Card>
      )}

      {tab === 'staff' && (
        <Card className="p-6 space-y-5 border-gym-800">
          <div className="flex items-center gap-2 pb-3 border-b border-gym-800">
            <Users className="w-5 h-5 text-brand-cyan" />
            <h3 className="text-base font-bold text-slate-100">Staff accounts</h3>
          </div>

          {!isAdmin ? (
            <p className="text-xs text-amber-400">
              Only administrators can manage staff accounts.
            </p>
          ) : (
            <form onSubmit={handleCreateStaff} className="space-y-4 p-4 rounded-xl bg-gym-950/60 border border-gym-800">
              {staffError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                  <span>{staffError}</span>
                </div>
              )}
              {staffNotice && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {staffNotice}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Full name"
                  value={staffForm.fullName}
                  onChange={(e) => setStaffForm({ ...staffForm, fullName: e.target.value })}
                />
                <Input
                  label="Email *"
                  type="email"
                  placeholder="staff@besmartfitness.lk"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                  required
                />
                <Input
                  label="Temporary password *"
                  type="text"
                  placeholder="At least 8 characters"
                  value={staffForm.password}
                  onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                  required
                />
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Role</label>
                  <select
                    value={staffForm.role}
                    onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                    className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:border-brand-cyan"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={creatingStaff} icon={Plus}>
                  {creatingStaff ? 'Creating...' : 'Create staff account'}
                </Button>
              </div>
            </form>
          )}

          <div className="space-y-2">
            {staff.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between p-3 rounded-xl bg-gym-950/60 border border-gym-800/60"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-100">
                    {account.full_name || 'Unnamed'}
                    {account.id === user?.id && (
                      <span className="ml-2 text-[10px] text-brand-cyan">you</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">{account.email}</p>
                </div>
                {isAdmin && account.id !== user?.id ? (
                  <select
                    value={account.role}
                    onChange={(e) => handleRoleChange(account, e.target.value)}
                    className="rounded-lg bg-gym-950 border border-gym-800 text-xs text-slate-200 px-2 py-1.5 focus:outline-none focus:border-brand-cyan"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant={account.role === 'admin' ? 'cyan' : 'default'}>
                    {account.role}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
