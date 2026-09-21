import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';

export function StatCard({
  title,
  value,
  change,
  trend = 'up',
  icon: Icon,
  variant = 'cyan',
  subtext,
}) {
  const iconVariants = {
    cyan: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };

  return (
    <Card className="hover:border-gym-700 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-400 tracking-wider uppercase">{title}</p>
          <div className="text-2xl font-bold text-slate-100 tracking-tight">{value}</div>
        </div>
        {Icon && (
          <div className={cn('p-3 rounded-xl border', iconVariants[variant])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>

      {(change || subtext) && (
        <div className="mt-4 pt-3 border-t border-gym-800/60 flex items-center justify-between text-xs">
          {change && (
            <span
              className={cn(
                'font-semibold flex items-center gap-1',
                trend === 'up' ? 'text-emerald-400' : 'text-rose-400'
              )}
            >
              {trend === 'up' ? '↑' : '↓'} {change}
            </span>
          )}
          {subtext && <span className="text-slate-400">{subtext}</span>}
        </div>
      )}
    </Card>
  );
}
