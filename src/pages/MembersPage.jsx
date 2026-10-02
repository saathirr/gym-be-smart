import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Pencil,
  AlertCircle,
  CheckCircle2,
  UserRound,
  TrendingUp,
  CalendarDays,
  FileSpreadsheet,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PhotoField } from '../components/members/PhotoField';
import { PlayerAttendanceModal } from '../components/members/PlayerAttendanceModal';
import { ImportMembersModal } from '../components/members/ImportMembersModal';
import { memberService } from '../services/memberService';
import { attendanceService, getClubToday } from '../services/attendanceService';
import { storageService } from '../services/storageService';
import { planService, pickDefaultPlan } from '../services/planService';
import { formatCurrency, formatDate } from '../utils/formatters';
import { useAuth } from '../hooks/useAuth';
import { useGym } from '../hooks/useGym';
import { useMemberPhotoUrls } from '../hooks/useMemberPhotoUrls';
import {
  buildMemberMonthSummaries,
  monthLabel,
  parseKey,
} from '../utils/attendanceMath';
import { SRI_LANKAN_DISTRICTS } from '../utils/constants';
import { toMessage } from '../lib/supabaseErrors';

const STATUSES = ['ALL', 'Active', 'Inactive', 'Suspended', 'Expired'];

function blankForm() {
  return {
    full_name: '',
    nic_number: '',
    phone: '',
    whatsapp_number: '',
    email: '',
    district: 'Colombo',
    address: '',
    gender: 'Male',
    date_of_birth: '',
    emergency_contact: '',
    medical_conditions: '',
    branch_id: '',
    plan_id: '',
    payment_method: 'Cash',
  };
}

const selectClass =
  'w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40';

export function MembersPage() {
  const [members, setMembers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') || '';
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [passMember, setPassMember] = useState(null);
  const [calendarMember, setCalendarMember] = useState(null);
  // True only for a pass opened straight after a registration, so the modal can
  // confirm the pass was issued rather than re-showing an old one.
  const [passJustIssued, setPassJustIssued] = useState(false);

  const handleBulkImport = async ({ rows, planId, paymentMethod, onProgress }) => {
    const summary = await memberService.bulkImportMembers({
      rows,
      planId,
      paymentMethod,
      onProgress,
    });
    await loadData();
    return summary;
  };

  // Current-month attendance for the rows on screen. Fetched separately from the
  // member list so filtering the list does not also re-count the month.
  const [monthAttendance, setMonthAttendance] = useState([]);
  const [clubToday, setClubToday] = useState(null);

  const [formData, setFormData] = useState(blankForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The picked photo is held as a File, not an upload, until the member row
  // exists: the storage path is namespaced by member id, which is only known
  // after the insert returns.
  const [photoFile, setPhotoFile] = useState(null);

  const { isAdmin } = useAuth();
  const { branches, currency, settings } = useGym();
  const timeZone = settings?.timezone;
  const navigate = useNavigate();

  // One batched signing request for every visible row, rather than one request
  // per member on every keystroke in the search box.
  const { urls: photoUrls } = useMemberPhotoUrls(members.map((m) => m.avatar_url));

  // Compared by value: the list re-renders on every keystroke, and a fresh
  // array with the same contents must not re-count the month.
  const memberIdsKey = useMemo(() => members.map((m) => m.id).join(','), [members]);

  const setSearch = useCallback(
    (value) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set('q', value);
          else next.delete('q');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // Debounced so typing does not fire a query per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [memberRows, planRows] = await Promise.all([
        memberService.getMembers({
          search: debouncedSearch,
          status: statusFilter,
          branchId: branchFilter,
        }),
        planService.getPlans({ includeInactive: false }),
      ]);

      setMembers(memberRows);
      setPlans(planRows);
    } catch (err) {
      setError(toMessage(err, 'Could not load the member directory.'));
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, branchFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The current month, for the per-row figure. The club's today comes from the
  // database, so the number here is the same one the check-in engine writes and
  // the same one the profile page counts against.
  useEffect(() => {
    const memberIds = memberIdsKey ? memberIdsKey.split(',') : [];
    if (memberIds.length === 0) {
      setMonthAttendance([]);
      setClubToday(null);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const today = await getClubToday({ timeZone });
        if (cancelled) return;
        setClubToday(today);

        const rows = await attendanceService.getMonthAttendance({
          memberIds,
          monthStart: `${today.slice(0, 7)}-01`,
          timeZone,
        });
        if (!cancelled) setMonthAttendance(rows);
      } catch {
        // A missing month total is not worth an error banner over the whole
        // directory: the rows still show, they just show a dash.
        if (!cancelled) setMonthAttendance([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [memberIdsKey, timeZone]);

  // The same counting rules the profile page uses, applied to every visible row
  // at once. Distinct days, from the later of the 1st and the join date, up to
  // the club's today - so a player who joined on the 20th is never shown as
  // absent for the 19 days before they existed.
  const monthSummaries = useMemo(() => {
    if (!clubToday) return {};

    return buildMemberMonthSummaries({
      rows: monthAttendance,
      members,
      monthStart: `${clubToday.slice(0, 7)}-01`,
      today: clubToday,
      timeZone,
    });
  }, [members, monthAttendance, clubToday, timeZone]);

  const monthCaption = useMemo(() => {
    const parts = parseKey(clubToday);
    return parts ? monthLabel(parts.year, parts.month) : null;
  }, [clubToday]);

  const openAddModal = () => {
    setEditingMember(null);
    setFormData({ ...blankForm(), plan_id: pickDefaultPlan(plans)?.id || '' });
    setFormError('');
    setPhotoFile(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (member) => {
    setEditingMember(member);
    setFormData({
      full_name: member.full_name || '',
      nic_number: member.nic_number || '',
      phone: member.phone || '',
      whatsapp_number: member.whatsapp_number || '',
      email: member.email || '',
      district: member.district || 'Colombo',
      address: member.address || '',
      gender: member.gender || 'Male',
      date_of_birth: member.date_of_birth || '',
      emergency_contact: member.emergency_contact || '',
      medical_conditions: member.medical_conditions || '',
      branch_id: member.branch_id || '',
      plan_id: '',
      payment_method: 'Cash',
    });
    setFormError('');
    // Cleared so a photo picked for a previous member is never attached to this
    // one by accident.
    setPhotoFile(null);
    setIsAddModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.full_name.trim() || !formData.phone.trim()) {
      setFormError('Full name and mobile number are required.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      if (editingMember) {
        await memberService.updateMember(editingMember.id, formData);

        // The photo is replaced through the storage service rather than through
        // updateMember, so the row is repointed at the new object only after the
        // upload succeeds.
        if (photoFile) {
          await storageService.replaceMemberPhoto({
            memberId: editingMember.id,
            currentPath: editingMember.avatar_url,
            file: photoFile,
          });
        }
      } else {
        if (!formData.nic_number.trim()) {
          setFormError('NIC number is required for new registrations.');
          return;
        }
        const created = await memberService.createMember(
          formData,
          formData.plan_id || null,
          photoFile
        );

        // A photo failure must not read as a failed registration: the member is
        // on file either way, so the photo is offered as a follow-up instead.
        if (created?.photoError) {
          setError(
            `${created.full_name} was registered, but the photo was not saved: ${created.photoError}`
          );
        }

        // The pass is issued with the member, so it is shown immediately rather
        // than making staff find the new row and click the QR button. This is
        // the only moment the member can be handed their code, and it is the
        // moment they are standing at the desk.
        setPassMember(created);
        setPassJustIssued(true);
      }

      setPhotoFile(null);
      setIsAddModalOpen(false);
      await loadData();
    } catch (err) {
      setFormError(toMessage(err, 'Could not save this member.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (member) => {
    const next = member.status === 'Active' ? 'Inactive' : 'Active';
    try {
      await memberService.updateMemberStatus(member.id, next);
      await loadData();
    } catch (err) {
      setError(toMessage(err, 'Could not change that member status.'));
    }
  };

  const handleDeleteMember = async (member) => {
    if (
      !window.confirm(
        `Delete ${member.full_name}? Their attendance and payment history will be removed too.`
      )
    ) {
      return;
    }

    try {
      await memberService.deleteMember(member.id);
      await loadData();
    } catch (err) {
      setError(toMessage(err, 'Could not delete this member.'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description="Register members, issue QR passes, and manage subscription status."
      >
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={FileSpreadsheet}
            onClick={() => setIsImportModalOpen(true)}
          >
            Import Members
          </Button>
          <Button variant="primary" icon={Plus} onClick={openAddModal}>
            Add New Member
          </Button>
        </div>
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
          <div className="relative w-full lg:w-96">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search name, NIC, member code, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Status:
            </span>
            {STATUSES.map((status) => (
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

            {branches.length > 1 && (
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="rounded-lg bg-gym-850 text-xs text-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
              >
                <option value="ALL">All branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">NIC / Code</th>
                <th className="py-3.5 px-4">Contact</th>
                <th className="py-3.5 px-4">Plan</th>
                <th className="py-3.5 px-4">Expires</th>
                <th
                  className="py-3.5 px-4"
                  title={`Present and missed days so far in ${monthCaption || 'the current month'}. The day-by-day record is on the player profile.`}
                >
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    This month
                  </span>
                </th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-slate-400">
                    Loading members...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-slate-400">
                    {search
                      ? `No members match "${search}".`
                      : 'No members registered yet. Use "Add New Member" to register the first one.'}
                  </td>
                </tr>
              ) : (
                members.map((member) => {
                  const month = monthSummaries[member.id];

                  return (
                  <tr key={member.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gym-800 flex items-center justify-center font-bold text-brand-cyan text-sm shrink-0 overflow-hidden">
                          {member.avatar_url && photoUrls[member.avatar_url] ? (
                            <img
                              src={photoUrls[member.avatar_url]}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            member.full_name?.charAt(0) || 'M'
                          )}
                        </div>
                        <div>
                          {/* The name is the way into the profile, so the whole
                              row reads as clickable rather than only the small
                              icon in the actions column. */}
                          <button
                            type="button"
                            onClick={() => navigate(`/members/${member.id}`)}
                            className="font-semibold text-slate-100 hover:text-brand-gold text-left transition"
                          >
                            {member.full_name}
                          </button>
                          <p className="text-[11px] text-slate-400">
                            {member.gender || 'N/A'}
                            {member.district ? ` • ${member.district}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 space-y-1">
                      <span className="px-2 py-0.5 rounded bg-gym-950 font-mono font-semibold text-brand-cyan block w-fit">
                        {member.member_code}
                      </span>
                      {member.nic_number && (
                        <span className="text-[11px] font-mono text-slate-400 block">
                          {member.nic_number}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="text-slate-200 font-medium">{member.phone || 'N/A'}</p>
                      <p className="text-[11px] text-slate-400">{member.email || 'No email'}</p>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-200">
                      {member.plan_name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {member.expiration_date ? formatDate(member.expiration_date) : 'N/A'}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {month ? (
                        <button
                          type="button"
                          onClick={() => setCalendarMember(member)}
                          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-gym-850 hover:bg-gym-800 border border-hairline/60 transition cursor-pointer"
                          title="Click to view full attendance calendar"
                        >
                          <span className="text-emerald-300 font-semibold">
                            {month.presentDays}P
                          </span>
                          <span className="text-slate-600">/</span>
                          <span className="text-rose-300/80">
                            {month.leaveDays}L
                          </span>
                          <CalendarDays className="w-3 h-3 text-brand-gold ml-0.5 opacity-80" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCalendarMember(member)}
                          className="text-slate-500 hover:text-slate-300 text-[11px]"
                          title="Click to view attendance calendar"
                        >
                          View calendar
                        </button>
                      )}
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
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => navigate(`/members/${member.id}`)}
                        className="p-1.5 rounded-lg bg-gym-800 hover:bg-brand-gold hover:text-gym-950 text-slate-300 transition"
                        title="Open player profile"
                      >
                        <UserRound className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setCalendarMember(member)}
                        className="p-1.5 ml-1 rounded-lg bg-gym-800 hover:bg-emerald-600 hover:text-white text-slate-300 transition"
                        title="View Attendance Calendar"
                      >
                        <CalendarDays className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setPassJustIssued(false);
                          setPassMember(member);
                        }}
                        className="p-1.5 ml-1 rounded-lg bg-gym-800 hover:bg-brand-cyan hover:text-white text-slate-300 transition"
                        title="View QR pass"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEditModal(member)}
                        className="p-1.5 ml-1 rounded-lg bg-gym-800 hover:bg-sky-500 hover:text-white text-slate-300 transition"
                        title="Edit member"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(member)}
                        className="p-1.5 ml-1 rounded-lg bg-gym-800 hover:bg-gym-700 text-slate-300 transition"
                        title={member.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                      >
                        {member.status === 'Active' ? (
                          <XCircle className="w-4 h-4 text-amber-400" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        )}
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => handleDeleteMember(member)}
                          className="p-1.5 ml-1 rounded-lg bg-gym-800 hover:bg-rose-500/20 text-rose-400 transition"
                          title="Delete member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={editingMember ? `Edit ${editingMember.full_name}` : 'Register new member'}
        className="max-w-2xl"
      >
        {formError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <PhotoField
            file={photoFile}
            existingPath={editingMember?.avatar_url}
            existingName={editingMember?.full_name}
            onPick={setPhotoFile}
          />

          <Input
            label="Full name *"
            placeholder="e.g. Kasun Kalhara Perera"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label={editingMember ? 'NIC number' : 'NIC number *'}
              placeholder="199512345678 or 951234567V"
              value={formData.nic_number}
              onChange={(e) => setFormData({ ...formData, nic_number: e.target.value })}
              required={!editingMember}
            />
            <Input
              label="Mobile number *"
              placeholder="077 123 4567"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-medium text-slate-300">WhatsApp number</label>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, whatsapp_number: formData.phone })}
                  className="text-[10px] text-brand-cyan hover:underline font-medium"
                >
                  Same as mobile
                </button>
              </div>
              <input
                type="text"
                placeholder="077 123 4567"
                value={formData.whatsapp_number}
                onChange={(e) => setFormData({ ...formData, whatsapp_number: e.target.value })}
                className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
              />
            </div>
            <Input
              label="Email address"
              type="email"
              placeholder="e.g. kasun@gmail.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">District</label>
              <select
                value={formData.district}
                onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                className={selectClass}
              >
                {SRI_LANKAN_DISTRICTS.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Gender</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className={selectClass}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <Input
              label="Date of birth"
              type="date"
              value={formData.date_of_birth || ''}
              onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
            />
          </div>

          {branches.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Branch</label>
              <select
                value={formData.branch_id}
                onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                className={selectClass}
              >
                <option value="">Unassigned</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            label="Residential address"
            placeholder="e.g. No. 45, Temple Road, Nugegoda"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          />

          {!editingMember && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Membership plan
                </label>
                <select
                  value={formData.plan_id}
                  onChange={(e) => setFormData({ ...formData, plan_id: e.target.value })}
                  className={selectClass}
                >
                  <option value="">No plan for now</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({formatCurrency(plan.price, currency)} / {plan.duration_days}d)
                    </option>
                  ))}
                </select>
                {plans.length === 0 && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Create a plan on the Plans page first.
                  </p>
                )}
              </div>

              {formData.plan_id && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Payment method
                  </label>
                  <select
                    value={formData.payment_method}
                    onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                    className={selectClass}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="Bank_Transfer">Bank transfer</option>
                    <option value="Online">Online wallet</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <Input
            label="Emergency contact"
            placeholder="e.g. 077 765 4321"
            value={formData.emergency_contact}
            onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
          />

          <Input
            label="Medical conditions / health notes"
            placeholder="e.g. None / Asthma / Previous knee surgery"
            value={formData.medical_conditions}
            onChange={(e) => setFormData({ ...formData, medical_conditions: e.target.value })}
          />

          <div className="pt-3 border-t flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting
                ? 'Saving...'
                : editingMember
                ? 'Save changes'
                : 'Register and issue pass'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(passMember)}
        onClose={() => {
          setPassMember(null);
          setPassJustIssued(false);
        }}
        title={passJustIssued ? 'Pass issued' : 'Member QR pass'}
      >
        {passMember && (
          <div className="flex flex-col items-center justify-center text-center space-y-4 py-2">
            {passJustIssued && (
              <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {passMember.full_name} is registered. This is their unique pass.
              </p>
            )}

            <div className="p-6 rounded-2xl bg-white shadow-2xl border-4 border-brand-cyan">
              <QRCodeSVG
                value={passMember.qr_code_id || passMember.member_code}
                size={180}
                level="H"
                includeMargin
              />
            </div>

            <div>
              <div className="flex items-center justify-center gap-2">
                <Dumbbell className="w-5 h-5 text-brand-cyan" />
                <h3 className="text-xl font-bold text-slate-100">{passMember.full_name}</h3>
              </div>
              <p className="text-xs font-mono text-brand-cyan font-bold mt-1">
                {passMember.member_code}
              </p>
              {passMember.nic_number && (
                <p className="text-xs font-mono text-slate-300 mt-1">NIC: {passMember.nic_number}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {passMember.plan_name} •{' '}
                {passMember.expiration_date
                  ? `Expires ${formatDate(passMember.expiration_date)}`
                  : 'No active plan'}
              </p>
              <div className="mt-2">
                <Badge
                  variant={
                    passMember.status === 'Active'
                      ? 'emerald'
                      : passMember.status === 'Expired'
                      ? 'rose'
                      : 'amber'
                  }
                >
                  {passMember.status === 'Active' ? (
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                  ) : (
                    <AlertCircle className="w-3 h-3 mr-1" />
                  )}
                  {passMember.status}
                </Badge>
              </div>
            </div>

            <div className="w-full pt-4 border-t flex flex-col sm:flex-row items-center justify-center gap-2">
              <Button variant="primary" icon={Download} onClick={() => window.print()}>
                Print pass
              </Button>
              <Button
                variant="secondary"
                icon={UserRound}
                onClick={() => {
                  const id = passMember.id;
                  setPassMember(null);
                  setPassJustIssued(false);
                  navigate(`/members/${id}`);
                }}
              >
                Open player profile
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <PlayerAttendanceModal
        member={calendarMember}
        isOpen={Boolean(calendarMember)}
        onClose={() => setCalendarMember(null)}
      />

      <ImportMembersModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        plans={plans}
        currency={currency}
        onImportComplete={handleBulkImport}
      />
    </div>
  );
}
