import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  TrendingUp,
  Users,
  Calendar,
  BarChart3,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { paymentService } from '../services/paymentService';
import { memberService } from '../services/memberService';
import { attendanceService } from '../services/attendanceService';
import { dashboardService } from '../services/dashboardService';
import { formatDate } from '../utils/formatters';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return [headers.map(escapeCsv).join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join(
    '\r\n'
  );
}

const BOM = '\uFEFF';

function download(filename, csv) {
  // The BOM keeps Excel from mangling non-ASCII names on open.
  const blob = new Blob([BOM, csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [peakHours, setPeakHours] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const { gymName, currency } = useGym();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setPeakHours(await dashboardService.getPeakHours(7));
    } catch (err) {
      setError(toMessage(err, 'Could not load report data.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = async (type) => {
    setExporting(type);
    setError('');

    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = gymName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

      if (type === 'revenue') {
        const payments = await paymentService.getPayments();
        const rows = payments.map((payment) => [
          payment.receipt_number,
          payment.member_name,
          payment.member_code,
          payment.amount,
          payment.payment_method,
          payment.payment_status,
          payment.transaction_date,
          payment.notes || '',
        ]);
        download(
          `${slug}_revenue_${stamp}.csv`,
          toCsv(
            ['Receipt', 'Member', 'Member Code', 'Amount', 'Method', 'Status', 'Date', 'Notes'],
            rows
          )
        );
      } else if (type === 'members') {
        const members = await memberService.getMembers({ limit: 2000 });
        const rows = members.map((member) => [
          member.member_code,
          member.full_name,
          member.nic_number || '',
          member.phone || '',
          member.email || '',
          member.district || '',
          member.gender || '',
          member.status,
          member.plan_name,
          member.expiration_date || '',
          member.created_at,
        ]);
        download(
          `${slug}_members_${stamp}.csv`,
          toCsv(
            [
              'Member Code',
              'Full Name',
              'NIC',
              'Phone',
              'Email',
              'District',
              'Gender',
              'Status',
              'Plan',
              'Expires',
              'Registered',
            ],
            rows
          )
        );
      } else {
        const logs = await attendanceService.getAttendanceLogs({ limit: 2000 });
        const rows = logs.map((log) => [
          log.member_code,
          log.member_name,
          log.plan_name,
          log.check_in_time,
          log.check_out_time || '',
          log.method,
          log.status,
        ]);
        download(
          `${slug}_attendance_${stamp}.csv`,
          toCsv(
            ['Member Code', 'Member Name', 'Plan', 'Check In', 'Check Out', 'Method', 'Result'],
            rows
          )
        );
      }
    } catch (err) {
      setError(toMessage(err, 'Could not generate that report.'));
    } finally {
      setExporting('');
    }
  };

  const busiest = peakHours.reduce(
    (best, slot) => (slot.count > (best?.count ?? -1) ? slot : best),
    null
  );

  const exports = [
    {
      id: 'revenue',
      icon: TrendingUp,
      iconClass: 'bg-sky-500/10 text-sky-400',
      title: 'Revenue ledger',
      body: 'Every receipt with amount, channel, status, and date for your accountant.',
    },
    {
      id: 'members',
      icon: Users,
      iconClass: 'bg-emerald-500/10 text-emerald-400',
      title: 'Member directory',
      body: 'Contact details, plan assignment, and subscription end dates.',
    },
    {
      id: 'attendance',
      icon: Calendar,
      iconClass: 'bg-violet-500/10 text-violet-400',
      title: 'Attendance log',
      body: 'Check-in and check-out timestamps per member, including the entry method.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Export club data as CSV for accounting, or review facility usage patterns."
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {exports.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.id} className="p-6 space-y-3 border-gym-800 flex flex-col">
              <div className={`p-3 rounded-xl w-fit ${item.iconClass}`}>
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-100">{item.title}</h3>
              <p className="text-xs text-slate-400 flex-1">{item.body}</p>
              <Button
                variant="secondary"
                size="sm"
                icon={FileSpreadsheet}
                onClick={() => handleExport(item.id)}
                disabled={exporting === item.id}
              >
                {exporting === item.id ? 'Building...' : 'Download CSV'}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-gym-800/80">
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-cyan" />
            Busiest hours this week
          </h3>
          {busiest && busiest.count > 0 && (
            <span className="text-xs text-slate-400">
              Peak around <span className="text-brand-cyan font-semibold">{busiest.hour}</span> (
              {busiest.count} check-ins)
            </span>
          )}
        </div>

        <div className="h-64 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={peakHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
              <XAxis
                dataKey="hour"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                interval={1}
              />
              <YAxis
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0B0F17',
                  borderColor: '#1F2937',
                  borderRadius: '8px',
                }}
                itemStyle={{ color: '#0EA5E9' }}
                formatter={(value) => [value, 'Check-ins']}
              />
              <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {!loading && peakHours.every((slot) => slot.count === 0) && (
          <p className="text-xs text-slate-400 text-center -mt-2">
            No check-ins recorded in the last 7 days.
          </p>
        )}
      </Card>

      <Card className="p-5 space-y-2">
        <h3 className="text-sm font-bold text-slate-100">Export notes</h3>
        <ul className="text-xs text-slate-400 space-y-1.5">
          <li className="flex items-start gap-2">
            <Download className="w-3.5 h-3.5 shrink-0 mt-px text-brand-cyan" />
            Files are generated in your browser straight from the database, in CSV format.
          </li>
          <li className="flex items-start gap-2">
            <Download className="w-3.5 h-3.5 shrink-0 mt-px text-brand-cyan" />
            Amounts are exported as raw numbers in {currency} with no formatting applied.
          </li>
          <li className="flex items-start gap-2">
            <Download className="w-3.5 h-3.5 shrink-0 mt-px text-brand-cyan" />
            Exported {formatDate(new Date())}.
          </li>
        </ul>
      </Card>
    </div>
  );
}
