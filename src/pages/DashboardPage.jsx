import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  CalendarCheck,
  CircleDollarSign,
  AlertTriangle,
  QrCode,
  UserPlus,
  CreditCard,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/common/StatCard';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../utils/formatters';
import { chartTheme } from '../utils/chartTheme';
import { dashboardService } from '../services/dashboardService';
import { useGym } from '../hooks/useGym';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { toMessage } from '../lib/supabaseErrors';

const EMPTY_SUMMARY = {
  activeMembersCount: 0,
  todayAttendanceCount: 0,
  monthRevenue: 0,
  totalRevenue: 0,
  expiringCount: 0,
  weeklyAttendance: [],
  monthlyRevenue: [],
  recentCheckIns: [],
  expiringMemberships: [],
};

export function DashboardPage() {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { currency } = useGym();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const chart = chartTheme(isDark);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setSummary(await dashboardService.getDashboardSummary());
    } catch (err) {
      setError(toMessage(err, 'Could not load the dashboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const hasChartData = summary.weeklyAttendance.length > 0;
  const hasRevenueData = summary.monthlyRevenue.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user?.full_name?.split(' ')[0] || 'there'}`}
        description="Live club metrics from the attendance, membership, and payment records."
      >
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={loadData}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button
          variant="primary"
          icon={QrCode}
          onClick={() => navigate('/qr-scanner')}
        >
          Launch QR Scanner
        </Button>
      </PageHeader>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadData}>
            Try again
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard
          title="Active Members"
          value={loading ? '...' : String(summary.activeMembersCount)}
          change="Registered"
          trend="up"
          icon={Users}
          variant="cyan"
          subtext="Currently running"
        />
        <StatCard
          title="Today's Attendance"
          value={loading ? '...' : String(summary.todayAttendanceCount)}
          change="Today"
          trend="up"
          icon={CalendarCheck}
          variant="emerald"
          subtext="Check-ins logged"
        />
        <StatCard
          title="Revenue This Month"
          value={loading ? '...' : formatCurrency(summary.monthRevenue, currency)}
          change="Paid only"
          trend="up"
          icon={CircleDollarSign}
          variant="violet"
          subtext={`${formatCurrency(summary.totalRevenue, currency)} all time`}
        />
        <StatCard
          title="Expiring Soon"
          value={loading ? '...' : String(summary.expiringCount)}
          change="Expiring"
          trend="down"
          icon={AlertTriangle}
          variant="amber"
          subtext="Within 7 days"
        />
      </div>

      <Card className="p-4 bg-gym-900/60 border-edge">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-300 font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-cyan" />
            Quick actions
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <Button
              variant="secondary"
              size="sm"
              icon={QrCode}
              onClick={() => navigate('/qr-scanner')}
              className="flex-1 sm:flex-none"
            >
              Scan Check-in
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={UserPlus}
              onClick={() => navigate('/members')}
              className="flex-1 sm:flex-none"
            >
              Add Member
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={CreditCard}
              onClick={() => navigate('/payments')}
              className="flex-1 sm:flex-none"
            >
              Record Payment
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <CalendarCheck className="w-5 h-5 text-brand-emerald" />
              Weekly Attendance
            </CardTitle>
            <Badge variant="emerald">Last 7 days</Badge>
          </CardHeader>
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary.weeklyAttendance}>
                <defs>
                  <linearGradient id="attendanceColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chart.emerald} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chart.emerald} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="day" stroke={chart.axis} fontSize={12} tickLine={false} />
                <YAxis
                  stroke={chart.axis}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: chart.tooltipBg, borderColor: chart.tooltipBorder, borderRadius: '8px' }}
                  itemStyle={{ color: chart.emerald }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Check-ins"
                  stroke={chart.emerald}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#attendanceColor)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {!loading && !hasChartData && (
            <p className="text-xs text-slate-400 text-center -mt-2">
              No attendance recorded in the last 7 days.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <CircleDollarSign className="w-5 h-5 text-brand-cyan" />
              Revenue Performance
            </CardTitle>
            <Badge variant="cyan">{currency}</Badge>
          </CardHeader>
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.monthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" stroke={chart.axis} fontSize={12} tickLine={false} />
                <YAxis
                  stroke={chart.axis}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    value >= 1000 ? `${Math.round(value / 1000)}k` : value
                  }
                />
                <Tooltip
                  contentStyle={{ backgroundColor: chart.tooltipBg, borderColor: chart.tooltipBorder, borderRadius: '8px' }}
                  itemStyle={{ color: chart.cyan }}
                  formatter={(value) => [formatCurrency(value, currency), 'Revenue']}
                />
                <Bar dataKey="revenue" name="Revenue" fill={chart.cyan} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!loading && !hasRevenueData && (
            <p className="text-xs text-slate-400 text-center -mt-2">
              No payments recorded in the last 6 months.
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <Clock className="w-5 h-5 text-brand-cyan" />
              Recent Check-ins
            </CardTitle>
            <button
              onClick={() => navigate('/attendance')}
              className="text-xs text-brand-cyan hover:underline inline-flex items-center gap-1"
            >
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </CardHeader>
          <div className="space-y-3">
            {loading ? (
              <p className="text-xs text-slate-400 py-4 text-center">Loading check-ins...</p>
            ) : summary.recentCheckIns.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No check-ins recorded yet.
              </p>
            ) : (
              summary.recentCheckIns.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-gym-950/60 border border-edge/60 hover:border-edge-strong transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gym-800 flex items-center justify-center font-bold text-brand-cyan text-sm">
                      {item.member_name?.charAt(0) || 'M'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">{item.member_name}</p>
                      <p className="text-xs text-slate-400 font-mono">{item.member_code}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">
                      {formatDate(item.check_in_time, 'MMM dd • hh:mm a')}
                    </span>
                    <Badge variant="emerald" className="mt-1">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      {item.method === 'MANUAL_ENTRY' ? 'Manual' : 'QR Scan'}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Expiring Memberships
            </CardTitle>
            <button
              onClick={() => navigate('/memberships')}
              className="text-xs text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              Manage all <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </CardHeader>
          <div className="space-y-3">
            {loading ? (
              <p className="text-xs text-slate-400 py-4 text-center">Loading memberships...</p>
            ) : summary.expiringMemberships.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Nothing expires before {formatDate(new Date(Date.now() + 7 * 86400000))}.
              </p>
            ) : (
              summary.expiringMemberships.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-gym-950/60 border border-edge/60 hover:border-amber-500/30 transition"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{item.full_name}</p>
                    <p className="text-xs text-slate-400">
                      {item.plan_name} • {item.member_code}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="amber">{formatDate(item.expiration_date)}</Badge>
                    <p className="text-[10px] text-slate-500 mt-1">{item.phone}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
