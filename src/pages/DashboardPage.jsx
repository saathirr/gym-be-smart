import { useEffect, useState } from 'react';
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
import { dashboardService } from '../services/dashboardService';

const attendanceData = [
  { day: 'Mon', count: 142 },
  { day: 'Tue', count: 168 },
  { day: 'Wed', count: 155 },
  { day: 'Thu', count: 189 },
  { day: 'Fri', count: 174 },
  { day: 'Sat', count: 210 },
  { day: 'Sun', count: 130 },
];

const revenueData = [
  { month: 'May', revenue: 12400 },
  { month: 'Jun', revenue: 14200 },
  { month: 'Jul', revenue: 15800 },
  { month: 'Aug', revenue: 17100 },
  { month: 'Sep', revenue: 19450 },
];

export function DashboardPage() {
  const [summary, setSummary] = useState({
    activeMembersCount: 0,
    todayAttendanceCount: 0,
    totalRevenue: 0,
    expiringCount: 0,
    recentCheckIns: [],
    expiringMemberships: [],
  });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await dashboardService.getDashboardSummary();
      setSummary(data);
    } catch (err) {
      console.error('Error loading dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Overview"
        description="Real-time performance metrics, facility attendance, and financial analytics."
      >
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={loadData}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh Stats'}
        </Button>
        <Button
          variant="primary"
          icon={QrCode}
          onClick={() => navigate('/qr-scanner')}
        >
          Launch QR Scanner
        </Button>
      </PageHeader>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <StatCard
          title="Active Members"
          value={loading ? '...' : summary.activeMembersCount.toString()}
          change="+12% this month"
          trend="up"
          icon={Users}
          variant="cyan"
          subtext="Total active subscribers"
        />
        <StatCard
          title="Today's Attendance"
          value={loading ? '...' : summary.todayAttendanceCount.toString()}
          change="+8% vs last Mon"
          trend="up"
          icon={CalendarCheck}
          variant="emerald"
          subtext="Verified check-in logs"
        />
        <StatCard
          title="Monthly Revenue"
          value={loading ? '...' : formatCurrency(summary.totalRevenue)}
          change="+15.4%"
          trend="up"
          icon={CircleDollarSign}
          variant="violet"
          subtext="Target $20,000"
        />
        <StatCard
          title="Expiring Soon"
          value={loading ? '...' : summary.expiringCount.toString()}
          change="Requires action"
          trend="down"
          icon={AlertTriangle}
          variant="amber"
          subtext="Next 7 days"
        />
      </div>

      {/* Quick Action Shortcuts Bar */}
      <Card className="p-4 bg-gym-900/60 border-gym-800">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-300 font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
            Quick Operational Actions:
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

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance Trends Chart */}
        <Card>
          <CardHeader>
            <CardTitle>
              <CalendarCheck className="w-5 h-5 text-brand-emerald" />
              Weekly Attendance Trend
            </CardTitle>
            <Badge variant="emerald">Live Logs</Badge>
          </CardHeader>
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={attendanceData}>
                <defs>
                  <linearGradient id="attendanceColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                <XAxis dataKey="day" stroke="#9CA3AF" fontSize={12} tickLine={false} />
                <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0B0F17', borderColor: '#1F2937', borderRadius: '8px' }}
                  itemStyle={{ color: '#10B981' }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#10B981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#attendanceColor)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Revenue Growth Chart */}
        <Card>
          <CardHeader>
            <CardTitle>
              <CircleDollarSign className="w-5 h-5 text-brand-cyan" />
              Monthly Revenue Performance
            </CardTitle>
            <Badge variant="cyan">USD ($)</Badge>
          </CardHeader>
          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                <XAxis dataKey="month" stroke="#9CA3AF" fontSize={12} tickLine={false} />
                <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0B0F17', borderColor: '#1F2937', borderRadius: '8px' }}
                  itemStyle={{ color: '#0EA5E9' }}
                />
                <Bar dataKey="revenue" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Tables Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live Check-ins */}
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
            {summary.recentCheckIns.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No check-in logs recorded today.</p>
            ) : (
              summary.recentCheckIns.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-gym-950/60 border border-gym-800/60 hover:border-gym-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gym-800 flex items-center justify-center font-bold text-brand-cyan text-sm">
                      {item.member_name ? item.member_name.charAt(0) : 'M'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">{item.member_name}</p>
                      <p className="text-xs text-slate-400">{item.plan_name || 'Standard'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">{formatDate(item.check_in_time, 'hh:mm a')}</span>
                    <Badge variant="emerald" className="mt-1">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Verified
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Expiring Subscriptions Alert */}
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
            {summary.expiringMemberships.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">No expiring memberships found.</p>
            ) : (
              summary.expiringMemberships.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-gym-950/60 border border-gym-800/60 hover:border-amber-500/30 transition"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{item.full_name}</p>
                    <p className="text-xs text-slate-400">{item.plan_name} • {item.phone || 'No phone'}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="amber">{item.expiration_date || 'Expires Soon'}</Badge>
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
