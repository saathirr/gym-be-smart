import { Outlet } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useGym } from '../hooks/useGym';
import { useTheme } from '../hooks/useTheme';
import { GymLogo } from '../components/common/GymLogo';
import { CLUB_DISPLAY_NAME } from '../utils/brand';

export function AuthLayout() {
  const { gymName } = useGym();
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-gym-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Decorative Blur Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-cyan/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-brand-violet/10 rounded-full blur-3xl pointer-events-none" />

      <button
        onClick={toggleTheme}
          className="absolute top-5 right-5 z-20 p-2 rounded-xl bg-gym-900 text-slate-300 shadow-card hover:text-brand-gold-strong hover:bg-gym-800 transition"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex flex-col items-center gap-3 mb-3">
          <GymLogo
            size={80}
            frameClassName="shadow-xl shadow-sky-500/20 ring-1 ring-black/5"
          />
          <h1 className="font-black text-2xl text-slate-100 tracking-tight text-center">
            {gymName}
          </h1>
        </div>
        <h2 className="text-center text-xs text-slate-400 font-medium tracking-wider uppercase">
          {CLUB_DISPLAY_NAME}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <Outlet />
      </div>

      <footer className="mt-12 text-center text-xs text-slate-500 relative z-10">
        &copy; {new Date().getFullYear()} {gymName}. All rights reserved.
      </footer>
    </div>
  );
}
