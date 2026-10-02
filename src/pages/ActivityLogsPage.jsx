import { useEffect, useState, useMemo } from 'react';
import {
  History,
  ShieldCheck,
  Search,
  Filter,
  Download,
  FileSpreadsheet,
  UserCheck,
  Clock,
  CheckCircle2,
  RefreshCw,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { activityLogService } from '../services/activityLogService';
import { formatDate } from '../utils/formatters';

const CATEGORIES = ['ALL', 'Attendance', 'Members', 'Plans', 'Admin Access'];

function actionBadgeVariant(action) {
  if (/check_in|login|granted/i.test(action)) return 'emerald';
  if (/import|register|create/i.test(action)) return 'cyan';
  if (/role|access|admin/i.test(action)) return 'amber';
  if (/delete|remove|cancel/i.test(action)) return 'rose';
  return 'gold';
}

export function ActivityLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [activeTab, setActiveTab] = useState('audit'); // 'audit' | 'changes'
  const [selectedLog, setSelectedLog] = useState(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await activityLogService.getLogs({ search, category, limit: 200 });
      setLogs(data);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [category]);

  const filteredLogs = useMemo(() => {
    if (!search.trim()) return logs;
    const term = search.toLowerCase().trim();
    return logs.filter(
      (l) =>
        l.details.toLowerCase().includes(term) ||
        l.performed_by.toLowerCase().includes(term) ||
        l.action.toLowerCase().includes(term)
    );
  }, [logs, search]);

  const changeLogs = useMemo(() => {
    return filteredLogs.filter((l) => l.changes && Object.keys(l.changes).length > 0);
  }, [filteredLogs]);

  const exportLogsToExcel = () => {
    const exportData = filteredLogs.map((l) => ({
      Timestamp: formatDate(l.timestamp, 'yyyy-MM-dd HH:mm:ss'),
      Action: l.action,
      Category: l.category,
      'Performed By': l.performed_by,
      Email: l.performer_email,
      Details: l.details,
      Changes: l.changes ? JSON.stringify(l.changes) : 'N/A',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activity Logs');
    XLSX.writeFile(wb, `Be_Smart_Gym_Activity_Logs_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin Activity & Change Logs"
        description="Comprehensive audit trails of gym operations, staff actions, and database modifications."
      >
        <div className="flex items-center gap-2">
          <Badge variant="gold" className="px-3 py-1 text-xs uppercase tracking-wider">
            Super Admin Access Only
          </Badge>
          <Button variant="secondary" icon={Download} onClick={exportLogsToExcel}>
            Export Audit Logs
          </Button>
          <Button variant="secondary" icon={RefreshCw} onClick={loadLogs}>
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-hairline pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
            activeTab === 'audit'
              ? 'bg-brand-cyan text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-gym-800'
          }`}
        >
          <History className="w-4 h-4" />
          Activity Trail ({filteredLogs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('changes')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
            activeTab === 'changes'
              ? 'bg-brand-cyan text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-gym-800'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          System Change Logs ({changeLogs.length})
        </button>
      </div>

      {/* Filters Bar */}
      <Card className="p-4 bg-gym-900/80">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search action, details, staff name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
            <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0">
              <Filter className="w-3.5 h-3.5" /> Category:
            </span>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  category === cat
                    ? 'bg-brand-gold text-gym-950 font-bold'
                    : 'bg-gym-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Activity Logs Table */}
      {activeTab === 'audit' ? (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gym-950/80 border-b border-hairline text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-3.5 px-4">Timestamp</th>
                  <th className="py-3.5 px-4">Performed By</th>
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Details</th>
                  <th className="py-3.5 px-4 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="text-center py-8 text-slate-400">
                      Loading audit logs...
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-8 text-slate-400">
                      No activity logs recorded matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gym-800/40 transition">
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono text-slate-400">
                        {formatDate(log.timestamp, 'MMM dd, yyyy • HH:mm:ss')}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-100">{log.performed_by}</div>
                        <div className="text-[10px] text-slate-500">{log.performer_email}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge variant={actionBadgeVariant(log.action)}>{log.action}</Badge>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-400">{log.category}</td>
                      <td className="py-3.5 px-4 text-slate-200 max-w-md truncate">
                        {log.details}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="p-1.5 rounded-lg bg-gym-800 hover:bg-brand-cyan hover:text-white text-slate-300 transition"
                          title="View log metadata"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Change Logs View */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {changeLogs.length === 0 ? (
            <Card className="col-span-2 p-8 text-center text-slate-400">
              No parameter change logs recorded yet.
            </Card>
          ) : (
            changeLogs.map((log) => (
              <Card key={log.id} className="p-5 space-y-3 bg-gym-900/90 border border-hairline">
                <div className="flex items-center justify-between">
                  <Badge variant={actionBadgeVariant(log.action)}>{log.action}</Badge>
                  <span className="text-[11px] font-mono text-slate-500">
                    {formatDate(log.timestamp, 'MMM dd, HH:mm')}
                  </span>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-100">{log.details}</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">By: {log.performed_by}</p>
                </div>
                <div className="p-3 rounded-lg bg-gym-950 border border-hairline/60 font-mono text-[11px] space-y-1">
                  <p className="text-slate-400 font-bold uppercase tracking-wider text-[9px] mb-1">
                    Record Modification Diff:
                  </p>
                  {Object.entries(log.changes || {}).map(([key, val]) => (
                    <div key={key} className="flex justify-between border-b border-hairline/30 py-0.5">
                      <span className="text-brand-cyan">{key}:</span>
                      <span className="text-slate-200">{String(val)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Log Details Modal */}
      <Modal
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Activity Log Details"
      >
        {selectedLog && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-xl bg-gym-850 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Action:</span>
                <Badge variant={actionBadgeVariant(selectedLog.action)}>{selectedLog.action}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Timestamp:</span>
                <span className="font-mono text-slate-200">
                  {formatDate(selectedLog.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Performed By:</span>
                <span className="text-slate-200 font-semibold">{selectedLog.performed_by}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">User Email:</span>
                <span className="text-slate-300 font-mono">{selectedLog.performer_email}</span>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Description:</label>
              <p className="p-3 rounded-lg bg-gym-950 text-slate-200 leading-relaxed">
                {selectedLog.details}
              </p>
            </div>

            {selectedLog.changes && (
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Audit Changes Payload:</label>
                <pre className="p-3 rounded-lg bg-gym-950 text-emerald-400 font-mono text-[11px] overflow-x-auto">
                  {JSON.stringify(selectedLog.changes, null, 2)}
                </pre>
              </div>
            )}

            <Button variant="primary" className="w-full mt-2" onClick={() => setSelectedLog(null)}>
              Close Audit Entry
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
