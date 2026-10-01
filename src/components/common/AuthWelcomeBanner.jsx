import { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { takeAdminWelcome } from '../../lib/authWelcome';
import { formatDate } from '../../utils/formatters';

const AUTO_HIDE_MS = 8000;

export function AuthWelcomeBanner() {
  const [welcome, setWelcome] = useState(null);

  useEffect(() => {
    const pending = takeAdminWelcome();
    if (!pending) return undefined;

    setWelcome(pending);
    const timer = setTimeout(() => setWelcome(null), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!welcome) return null;

  const firstName = welcome.name.split(' ')[0];

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-brand-emerald shrink-0 mt-px" />
        <div>
          <p className="text-sm font-semibold text-slate-100">
            Authentication successful. Welcome, {firstName}!
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Signed in as administrator at {formatDate(welcome.at, 'hh:mm a')} &middot; You have
            full access to plans, staff accounts, payments, and deletions.
          </p>
        </div>
      </div>
      <button
        onClick={() => setWelcome(null)}
        className="text-slate-400 hover:text-slate-100 transition shrink-0"
        aria-label="Dismiss welcome message"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}