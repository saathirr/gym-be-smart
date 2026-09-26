import { useEffect, useState } from 'react';
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
  Menu,
  X,
  Search,
  ChevronDown,
  Building2,
  Clock,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useGym } from '../hooks/useGym';
import { useTheme } from '../hooks/useTheme';
import { GymLogo } from '../components/common/GymLogo';
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
  const [globalSearch, setGlobalSearch] = useState('');

  const { user, logout } = useAuth();
  const { gymName, settings, branches } = useGym();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('Could not sign out:', err);
    }
  };

  const handleGlobalSearch = (e) => {
    e.preventDefault();
    const term = globalSearch.trim();
    if (!term) return;
    navigate(`/members?q=${encodeURIComponent(term)}`);
    setGlobalSearch('');
  };

  const activeBranch =
    branches.find((branch) => branch.is_active) || branches[0] || null;

  return (
    <div className="min-h-screen bg-gym-950 flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gym-950/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
 'fixed inset-y-0 left-0 z-50 w-64 bg-gym-900 border-r flex flex-col transition-transform duration-300 lg:static lg:translate-x-0',
 sidebarOpen ? 'translate-x-0' : '-translate-x-full'
 )}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b">
          <div className="flex items-center gap-3 min-w-0">
            <GymLogo size={40} frameClassName="shadow-md ring-1 ring-black/5" />
            <div className="min-w-0">
              <p className="font-extrabold text-slate-100 tracking-tight text-sm truncate">
                {gymName}
              </p>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                {settings.tagline || 'Gym management system'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg lg:hidden hover:bg-gym-800 shrink-0"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {activeBranch && (
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gym-950 text-xs">
              <div className="flex items-center gap-2 text-slate-300 font-medium min-w-0">
                <Building2 className="w-4 h-4 text-brand-cyan shrink-0" />
                <span className="truncate">{activeBranch.name}</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-brand-emerald shrink-0" />
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
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

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all group mt-6"
          >
            <LogOut className="w-5 h-5 shrink-0 transition-transform group-hover:scale-110" />
            <span>Sign out</span>
          </button>
        </nav>

        <div className="p-4 border-t bg-gym-950/40">
          <p className="text-[10px] text-slate-500 leading-relaxed">
            {settings.opening_time} - {settings.closing_time}
            {settings.phone ? ` • ${settings.phone}` : ''}
          </p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-gym-900/90 border-b sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-6 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-slate-400 hover:text-slate-100 rounded-lg lg:hidden hover:bg-gym-800 shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 min-w-0">
              <GymLogo
                size={32}
                className="lg:hidden"
                frameClassName="shadow-sm ring-1 ring-black/5"
              />
              <div className="min-w-0">
                <h1 className="text-sm font-extrabold text-slate-100 tracking-tight leading-none truncate">
                  {gymName}
                </h1>
                <p className="text-[10px] text-slate-400 mt-0.5 hidden sm:block truncate">
                  {settings.address || 'Gym management system'}
                </p>
              </div>
            </div>

            <form onSubmit={handleGlobalSearch} className="relative hidden xl:block w-64 ml-4">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search members..."
                aria-label="Search members"
                className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
              />
            </form>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl bg-gym-850 text-slate-300 hover:text-brand-gold-strong hover:bg-gym-800 transition"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gym-950 text-xs font-mono text-brand-cyan shadow-inner">
              <Clock className="w-4 h-4 text-brand-cyan shrink-0" />
              <div className="text-right leading-tight">
                <span className="font-bold text-slate-100 block">
                  {currentTime.toLocaleTimeString('en-LK', { hour12: true })}
                </span>
                <span className="text-[9px] text-slate-400 block font-sans">
                  {formatDate(currentTime, 'EEE, MMM dd')}
                </span>
              </div>
            </div>

            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-gym-800/80 transition"
                aria-label="Account menu"
                aria-expanded={userMenuOpen}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-cyan to-brand-violet flex items-center justify-center font-bold text-white text-xs shadow-md shrink-0">
                  {user?.full_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'S'}
                </div>
                <div className="hidden md:block text-left min-w-0">
                  <p className="text-xs font-semibold text-slate-200 leading-tight truncate max-w-[140px]">
                    {user?.full_name || 'Staff'}
                  </p>
                  <p className="text-[10px] text-slate-400 capitalize">{user?.role || 'staff'}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400 hidden md:block shrink-0" />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-gym-900 rounded-xl shadow-2xl py-2 z-50">
                  <div className="px-4 py-2.5 border-b">
                    <p className="text-xs font-semibold text-slate-200 truncate">
                      {user?.full_name || 'Staff'}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
                  </div>
                  <NavLink
                    to="/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-xs text-slate-300 hover:bg-gym-800 hover:text-white"
                  >
                    <Settings className="w-4 h-4 text-slate-400" />
                    Account settings
                  </NavLink>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-rose-400 hover:bg-rose-500/10"
                  >
                    <LogOut className="w-4 h-4 text-rose-400" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
