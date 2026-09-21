import { Outlet } from 'react-router-dom';
import { Dumbbell } from 'lucide-react';

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-gym-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Decorative Blur Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-cyan/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-brand-violet/10 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-brand-cyan to-sky-400 text-gym-950 font-bold shadow-xl shadow-sky-500/20">
            <Dumbbell className="w-8 h-8 stroke-[2.5]" />
          </div>
          <div>
            <span className="font-black text-2xl text-slate-100 tracking-tight">BE SMART </span>
            <span className="text-2xl font-black text-brand-cyan">GYM</span>
          </div>
        </div>
        <h2 className="text-center text-sm text-slate-400 font-medium">
          Management & Administration Platform
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <Outlet />
      </div>

      <footer className="mt-12 text-center text-xs text-slate-500 relative z-10">
        &copy; {new Date().getFullYear()} Be Smart Gym Management System. All rights reserved.
      </footer>
    </div>
  );
}
