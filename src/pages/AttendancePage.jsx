import { useEffect, useState, useCallback } from 'react';
import { CalendarCheck, QrCode, Plus, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { attendanceService } from '../services/attendanceService';
import { formatDate } from '../utils/formatters';

export function AttendancePage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [feedback, setFeedback] = useState(null);

  const navigate = useNavigate();

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await attendanceService.getAttendanceLogs();
      setLogs(data);
    } catch (err) {
      console.error('Error loading attendance logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleManualCheckIn = async (e) => {
    e.preventDefault();
    if (!manualCode) return;

    const result = await attendanceService.logCheckIn(manualCode, 'MANUAL_ENTRY');
    setFeedback(result);
    if (result.success) {
      setManualCode('');
      await loadLogs();
    }
  };

  const filteredLogs = logs.filter((item) =>
    item.member_name?.toLowerCase().includes(search.toLowerCase()) ||
    item.member_code?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Records"
        description="Daily check-in activity, historical attendance logs, and manual entries."
      >
        <Button
          variant="secondary"
          icon={Plus}
          onClick={() => setIsManualModalOpen(true)}
        >
          Manual Entry
        </Button>
        <Button
          variant="emerald"
          icon={QrCode}
          onClick={() => navigate('/qr-scanner')}
        >
          Camera Check-in Scanner
        </Button>
      </PageHeader>

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-gym-900/80 border-gym-800">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search member name, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-950 border border-gym-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Total Recorded Today:</span>
            <Badge variant="emerald">{logs.length} Check-ins</Badge>
          </div>
        </div>
      </Card>

      {/* Attendance Audit Log Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b border-gym-800 text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member Name</th>
                <th className="py-3.5 px-4">Member Code</th>
                <th className="py-3.5 px-4">Assigned Plan</th>
                <th className="py-3.5 px-4">Check-in Timestamp</th>
                <th className="py-3.5 px-4">Entry Method</th>
                <th className="py-3.5 px-4">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gym-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    Loading attendance audit logs...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    No check-in entries found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gym-800/40 transition">
                    <td className="py-3.5 px-4 font-semibold text-slate-100">
                      {log.member_name}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-brand-cyan">
                      {log.member_code}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      {log.plan_name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400">
                      {formatDate(log.check_in_time, 'MMM dd, yyyy • hh:mm a')}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-gym-950 border border-gym-800 font-mono text-[11px]">
                        {log.method}
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Manual Check-in Modal */}
      <Modal
        isOpen={isManualModalOpen}
        onClose={() => {
          setIsManualModalOpen(false);
          setFeedback(null);
        }}
        title="Manual Member Check-in"
      >
        {feedback && (
          <div
            className={`p-3 rounded-lg text-xs mb-4 border ${
              feedback.success
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            {feedback.success
              ? `Check-in Verified for ${feedback.member?.full_name} (${feedback.member?.member_code})!`
              : feedback.error}
          </div>
        )}
        <form onSubmit={handleManualCheckIn} className="space-y-4">
          <Input
            label="Member Code or QR Payload *"
            placeholder="e.g. BSG-1001"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            required
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setIsManualModalOpen(false);
                setFeedback(null);
              }}
            >
              Close
            </Button>
            <Button type="submit" variant="emerald" icon={CalendarCheck}>
              Log Check-in
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
