import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  QrCode,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  LogOut,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { attendanceService } from '../services/attendanceService';
import { formatDate } from '../utils/formatters';
import { useAuth } from '../hooks/useAuth';
import { toMessage } from '../lib/supabaseErrors';

const DATE_RANGES = [
  ['TODAY', 'Today'],
  ['ALL', 'All time'],
];

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

  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const [logRows, count] = await Promise.all([
        attendanceService.getAttendanceLogs({ search, date: dateRange }),
        attendanceService.getTodayCount(),
      ]);

      setLogs(logRows);
      setTodayCount(count);
    } catch (err) {
      setError(toMessage(err, 'Could not load attendance logs.'));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [search, dateRange]);

  useEffect(() => {
    const timer = setTimeout(loadLogs, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadLogs, search]);

  const handleManualCheckIn = async (e) => {
    e.preventDefault();
    if (!manualCode.trim()) return;

    try {
      setSubmitting(true);
      const result = await attendanceService.logCheckIn(manualCode, 'MANUAL_ENTRY');
      setFeedback(result);

      if (result.success) {
        setManualCode('');
        await loadLogs();
      }
    } catch (err) {
      setFeedback({ success: false, error: toMessage(err, 'Check-in failed.') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckout = async (log) => {
    try {
      await attendanceService.checkout(log.id);
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
        description="Check-in audit trail from QR scans and manual desk entry."
      >
        <Button variant="secondary" icon={Plus} onClick={() => setIsManualModalOpen(true)}>
          Manual check-in
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
                <th className="py-3.5 px-4">Method</th>
                <th className="py-3.5 px-4">Result</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    Loading attendance...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-slate-400">
                    {search
                      ? `No check-ins match "${search}".`
                      : 'No check-ins recorded yet.'}
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      {log.member_name}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-brand-cyan">{log.member_code}</td>
                    <td className="py-3.5 px-4 text-slate-300">{log.plan_name}</td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(log.check_in_time, 'MMM dd, yyyy • hh:mm a')}
                      {log.check_out_time && (
                        <span className="block text-[10px] text-emerald-400">
                          out {formatDate(log.check_out_time, 'hh:mm a')}
                        </span>
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
                    <td className="py-3.5 px-4 text-right">
                      {!log.check_out_time ? (
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
        title="Manual check-in"
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
            <span>
              {feedback.success
                ? `Checked in ${feedback.member?.full_name} (${feedback.member?.member_code}).`
                : feedback.error}
            </span>
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
              {submitting ? 'Checking...' : 'Log check-in'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
