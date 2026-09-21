import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  QrCode,
  CreditCard,
  Layers,
  CircleDollarSign,
  BarChart3,
  Settings,
  LogOut,
  Dumbbell,
  Menu,
  X,
  Bell,
  Search,
  ChevronDown,
  ShieldCheck,
  Building2,
  Clock,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../utils/cn';
import { formatDate } from '../utils/formatters';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Members', path: '/members', icon: Users },
  { name: 'Attendance', path: '/attendance', icon: CalendarCheck },
  { name: 'QR Scanner', path: '/qr-scanner', icon: QrCode },
  { name: 'Memberships', path: '/memberships', icon: CreditCard },
  { name: 'Plans', path: '/plans', icon: Layers },
  { name: 'Payments', path: '/payments', icon: CircleDollarSign },
  { name: 'Reports', path: '/reports', icon: BarChart3 },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Live Ticking Clock Effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gym-950 flex">
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gym-950/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Dark Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-gym-900 border-r border-gym-800/80 flex flex-col transition-transform duration-300 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-gym-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-brand-cyan to-sky-400 text-gym-950 font-bold shadow-lg shadow-sky-500/20">
              <Dumbbell className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="font-extrabold text-slate-100 tracking-tight text-sm">
                  BE SMART
                </span>
                <span className="px-1.5 py-0.5 text-[9px] font-bold bg-brand-cyan/20 text-brand-cyan rounded border border-brand-cyan/30 uppercase">
                  CLUB
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Fitness Club System</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg lg:hidden hover:bg-gym-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Branch Switcher Badge */}
        <div className="px-4 py-3 border-b border-gym-800/50">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gym-950 border border-gym-800 text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <Building2 className="w-4 h-4 text-brand-cyan shrink-0" />
              <span className="truncate">Sri Lanka HQ</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-brand-emerald animate-pulse"></span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.name}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group',
                    isActive
                      ? 'bg-brand-cyan text-white shadow-md shadow-sky-500/20 font-semibold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-gym-800/70'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn(
                        'w-5 h-5 shrink-0 transition-transform group-hover:scale-110',
                        isActive ? 'text-white' : 'text-slate-400 group-hover:text-brand-cyan'
                      )}
                    />
                    <span>{item.name}</span>
                  </>
                )}
              </NavLink>
            );
          })}

          {/* Logout Navigation Option */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all group mt-6"
          >
            <LogOut className="w-5 h-5 shrink-0 text-slate-400 group-hover:text-rose-400 transition-transform group-hover:scale-110" />
            <span>Logout</span>
          </button>
        </nav>

        {/* System Status Footer */}
        <div className="p-4 border-t border-gym-800/80 bg-gym-950/40">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-brand-emerald shrink-0" />
            <span>RLS Active</span>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-gym-800 text-slate-300 font-mono">
              v1.0.0
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <header className="h-16 bg-gym-900/90 border-b border-gym-800/80 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg lg:hidden hover:bg-gym-800"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Brand Logo & Name Header */}
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20">
                <Dumbbell className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm font-extrabold text-slate-100 tracking-tight leading-none">
                  Be Smart Fitness Club
                </h1>
                <p className="text-[10px] text-slate-400 mt-0.5 hidden sm:block">
                  Sri Lanka Gym Management System
                </p>
              </div>
            </div>

            {/* Quick Search */}
            <div className="relative hidden xl:block w-64 ml-4">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search member, ID, plan..."
                className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-gym-950 border border-gym-800/80 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Live Ticking Clock (Sri Lanka Local Time) */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gym-950 border border-gym-800 text-xs font-mono text-brand-cyan shadow-inner">
              <Clock className="w-4 h-4 text-brand-cyan animate-pulse shrink-0" />
              <div className="text-right leading-tight">
                <span className="font-bold text-slate-100 block">
                  {currentTime.toLocaleTimeString('en-LK', { hour12: true })}
                </span>
                <span className="text-[9px] text-slate-400 block font-sans">
                  {formatDate(currentTime, 'EEE, MMM dd')}
                </span>
              </div>
            </div>

            {/* Notifications */}
            <button className="p-2 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-gym-800/80 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-cyan ring-2 ring-gym-900"></span>
            </button>

            {/* User Profile Menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-gym-800/80 transition"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan to-brand-violet flex items-center justify-center font-bold text-white text-xs shadow-md">
                  {user?.email?.charAt(0).toUpperCase() || 'A'}
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-xs font-semibold text-slate-200 leading-tight">
                    {user?.full_name || 'Admin User'}
                  </p>
                  <p className="text-[10px] text-slate-400">{user?.email || 'admin@besmartfitness.lk'}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400 hidden md:block" />
              </button>

              {userMenuOpen && (
                <div
                  className="absolute right-0 mt-2 w-56 bg-gym-900 border border-gym-800 rounded-xl shadow-2xl py-2 z-50"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <div className="px-4 py-2.5 border-b border-gym-800">
                    <p className="text-xs font-semibold text-slate-200">
                      {user?.full_name || 'Admin User'}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
                  </div>
                  <NavLink
                    to="/settings"
                    className="flex items-center gap-2 px-4 py-2 text-xs text-slate-300 hover:bg-gym-800 hover:text-white"
                  >
                    <Settings className="w-4 h-4 text-slate-400" />
                    Account Settings
                  </NavLink>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-rose-400 hover:bg-rose-500/10"
                  >
                    <LogOut className="w-4 h-4 text-rose-400" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Dynamic Page Container */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
