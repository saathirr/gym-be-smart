import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  QrCode,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  LogOut,
  CalendarDays,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { PlayerAttendanceModal } from '../components/members/PlayerAttendanceModal';
import { attendanceService } from '../services/attendanceService';
import { formatDate } from '../utils/formatters';
import { formatMinutes } from '../utils/attendanceMath';
import { useAuth } from '../hooks/useAuth';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';

const DATE_RANGES = [
  ['TODAY', 'Today'],
  ['ALL', 'All time'],
];

// One line describing what a manual entry just did, so the same form covers a
// check-in, a check-out, a second session and a refusal.
function manualResultMessage(result) {
  if (!result) return '';
  if (!result.success) return result.error;

  const who = `${result.member?.full_name} (${result.member?.member_code})`;
  if (result.action === 'OUT') {
    return `Checked out ${who}. Session ${result.session} closed.`;
  }
  if (result.reentry) return `Checked in ${who} for the second session.`;
  if (result.alreadyCheckedIn) return `${who} is already checked in today.`;
  return `Checked in ${who}.`;
}

export function AttendancePage() {
  const [logs, setLogs] = useState([]);
  const [todayCount, setTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('ALL');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [calendarMemberId, setCalendarMemberId] = useState(null);

  const { isAdmin } = useAuth();
  const { settings } = useGym();
  const navigate = useNavigate();
  // "Today" here means the club's today. On a machine set to another timezone
  // the browser's midnight is the wrong boundary, and the log would disagree
  // with the scanner and the dashboard about who is in the building.
  const timeZone = settings?.timezone;

  // The forgotten-check-out sweep runs once per visit, before the first fetch,
  // so last night's open sessions are already closed and flagged by the time
  // the table is drawn. A failure here is not fatal: the list simply shows the
  // sessions as still open.
  const sweptRef = useRef(false);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      if (!sweptRef.current) {
        sweptRef.current = true;
        await attendanceService.closeForgottenSessions().catch(() => {});
      }

      const [logRows, count] = await Promise.all([
        attendanceService.getAttendanceLogs({ search, date: dateRange, timeZone }),
        attendanceService.getTodayCount({ timeZone }),
      ]);

      setLogs(logRows);
      setTodayCount(count);
    } catch (err) {
      setError(toMessage(err, 'Could not load attendance logs.'));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [search, dateRange, timeZone]);

  useEffect(() => {
    const timer = setTimeout(loadLogs, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadLogs, search]);

  const handleManualCheckIn = async (e) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code || submitting) return;

    try {
      setSubmitting(true);
      // Same toggle as the scanner, so a manual entry can check in, check out,
      // start the second session, or be refused once both are complete.
      const result = await attendanceService.toggleAttendance(code, 'MANUAL_ENTRY', {
        timeZone,
      });
      setFeedback(result);
      if (result.success) {
        setManualCode('');
        await loadLogs();
      }
    } catch (err) {
      setFeedback({ success: false, error: toMessage(err, 'Could not record that entry.') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckout = async (log) => {
    try {
      // Close whichever session is still open. The second is checked first
      // because a row can only hold two sessions, and only one is ever open.
      const openSession = log.open_session || (log.second_check_in_time ? 2 : 1);
      if (openSession === 2) {
        await attendanceService.checkoutSecond(log.id, 'MANUAL_ENTRY');
      } else {
        await attendanceService.checkout(log.id, 'MANUAL_ENTRY');
      }
      await loadLogs();
    } catch (err) {
      setError(toMessage(err, 'Could not close that session.'));
    }
  };

  const closeModal = () => {
    setIsManualModalOpen(false);
    setFeedback(null);
    setManualCode('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Check-in and check-out audit trail from QR scans and manual desk entry."
      >
        <Button variant="secondary" icon={Plus} onClick={() => setIsManualModalOpen(true)}>
          Manual entry
        </Button>
        <Button variant="emerald" icon={QrCode} onClick={() => navigate('/qr-scanner')}>
          Open scanner
        </Button>
      </PageHeader>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadLogs}>
            Retry
          </Button>
        </div>
      )}

      <Card className="p-4 bg-gym-900/80">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search member name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {DATE_RANGES.map(([value, label]) => (
              <button
                key={value}
                onClick={() => setDateRange(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  dateRange === value
                    ? 'bg-brand-cyan text-white shadow-md'
                    : 'bg-gym-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Checked in today:</span>
              <Badge variant="emerald">{todayCount}</Badge>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Code</th>
                <th className="py-3.5 px-4">Plan</th>
                <th className="py-3.5 px-4">Check-in</th>
                <th className="py-3.5 px-4">Time spent</th>
                <th className="py-3.5 px-4">Method</th>
                <th className="py-3.5 px-4">Result</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-slate-400">
                    Loading attendance...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="8" className="text-center py-8 text-slate-400">
                    {search
                      ? `No check-ins match "${search}".`
                      : 'No check-ins recorded yet.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      <button
                        type="button"
                        onClick={() => log.member_id && setCalendarMemberId(log.member_id)}
                        className="hover:text-brand-gold text-left transition flex items-center gap-1.5 cursor-pointer"
                        title="View player attendance calendar"
                      >
                        <span>{log.member_name}</span>
                        <CalendarDays className="w-3.5 h-3.5 text-brand-gold/70" />
                      </button>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-brand-cyan">{log.member_code}</td>
                    <td className="py-3.5 px-4 text-slate-300">{log.plan_name}</td>
                    <td className="py-3.5 px-4 text-slate-400">
                      <div>{formatDate(log.check_in_time, 'MMM dd, yyyy • hh:mm a')}</div>
                      {log.check_out_time && (
                        <span className="block text-[10px] text-emerald-400">
                          out {formatDate(log.check_out_time, 'hh:mm a')}
                        </span>
                      )}
                      {log.second_check_in_time && (
                        <div className="mt-1 pt-1 border-t border-hairline/50">
                          <span className="block text-[10px] text-sky-400">
                            2nd in {formatDate(log.second_check_in_time, 'hh:mm a')}
                          </span>
                          {log.second_check_out_time && (
                            <span className="block text-[10px] text-emerald-400">
                              2nd out {formatDate(log.second_check_out_time, 'hh:mm a')}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {log.duration_minutes != null ? (
                        <div>
                          <span className="font-medium text-slate-200">
                            {formatMinutes(log.duration_minutes)}
                          </span>
                          {log.open_session ? (
                            <span className="block text-[10px] text-emerald-400">
                              + still in
                            </span>
                          ) : (
                            (log.checkout_method === 'AUTO_CLOSE' ||
                              log.second_checkout_method === 'AUTO_CLOSE') && (
                              <span className="block text-[10px] text-amber-400">no checkout</span>
                            )
                          )}
                        </div>
                      ) : log.open_session ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Still in
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-gym-950 font-mono text-[11px]">
                        {log.method === 'MANUAL_ENTRY' ? 'Manual' : 'QR scan'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={log.status === 'Verified' ? 'emerald' : 'rose'}>
                        {log.status === 'Verified' ? (
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                        ) : (
                          <AlertCircle className="w-3 h-3 mr-1" />
                        )}
                        {log.status}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {log.member_id && (
                        <button
                          onClick={() => setCalendarMemberId(log.member_id)}
                          className="p-1.5 mr-1 rounded-lg bg-gym-800 hover:bg-emerald-600 hover:text-white text-slate-300 transition"
                          title="View Attendance Calendar"
                        >
                          <CalendarDays className="w-4 h-4" />
                        </button>
                      )}
                      {log.open_session ? (
                        <button
                          onClick={() => handleCheckout(log)}
                          className="p-1.5 rounded-lg bg-gym-800 hover:bg-brand-emerald hover:text-white text-slate-300 transition"
                          title="Check out"
                        >
                          <LogOut className="w-4 h-4" />
                        </button>
                      ) : isAdmin ? (
                        <span className="text-[10px] text-slate-500">Closed</span>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        isOpen={isManualModalOpen}
        onClose={closeModal}
        title="Manual entry"
      >
        {feedback && (
          <div
            className={`p-3 rounded-lg text-xs mb-4 border flex items-start gap-2 ${
              feedback.success
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            {feedback.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            )}
            <span>{manualResultMessage(feedback)}</span>
          </div>
        )}

        <form onSubmit={handleManualCheckIn} className="space-y-4">
          <Input
            label="Member code or QR payload *"
            placeholder="e.g. BSG-1001"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeModal}>
              Close
            </Button>
            <Button
              type="submit"
              variant="emerald"
              icon={CalendarCheck}
              disabled={submitting}
            >
              {submitting ? 'Recording...' : 'Record'}
            </Button>
          </div>
        </form>
      </Modal>

      <PlayerAttendanceModal
        memberId={calendarMemberId}
        isOpen={Boolean(calendarMemberId)}
        onClose={() => setCalendarMemberId(null)}
      />
    </div>
  );
}
