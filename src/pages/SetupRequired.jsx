import { AlertTriangle, Terminal } from 'lucide-react';

// Read each variable through a static `import.meta.env.X` access. A dynamic
// `import.meta.env[key]` cannot be replaced at build time, which makes Vite
// inline the whole env object into the bundle and publish every VITE_* var.
const CONFIGURED = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL?.trim(),
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY?.trim(),
};

const MISSING = [
  ['VITE_SUPABASE_URL', 'Your Supabase project URL'],
  ['VITE_SUPABASE_ANON_KEY', 'Your Supabase anon public key'],
].filter(([key]) => !CONFIGURED[key]);

export function SetupRequired() {
  return (
    <div className="min-h-screen bg-gym-950 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Database not connected</h1>
            <p className="text-sm text-slate-400">
              Be Smart Fitness Club needs its Supabase project before it can load any data.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gym-800 bg-gym-900/80 p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-300">
            <Terminal className="w-4 h-4 text-brand-cyan" />
            <span className="text-sm font-semibold">Complete these two steps</span>
          </div>

          <ol className="space-y-3 text-sm text-slate-400 list-decimal list-inside">
            <li>
              Run <code className="px-1.5 py-0.5 rounded bg-gym-950 font-mono text-xs text-brand-cyan">
                supabase_schema.sql
              </code>{' '}
              in your Supabase SQL editor.
            </li>
            <li>
              Add the missing values to your <code className="px-1.5 py-0.5 rounded bg-gym-950 font-mono text-xs text-brand-cyan">.env</code> file
              and restart the dev server.
            </li>
          </ol>

          <div className="rounded-lg bg-gym-950 border border-gym-800 p-4 space-y-1">
            {MISSING.map(([key, label]) => (
              <p key={key} className="font-mono text-xs text-rose-400">
                {key} &mdash; {label}
              </p>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-500">
          This screen appears instead of a working dashboard so the club can never
          silently run on placeholder data.
        </p>
      </div>
    </div>
  );
}
