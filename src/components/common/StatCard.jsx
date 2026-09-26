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
    cyan: 'bg-sky-500/10 text-sky-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
    violet: 'bg-violet-500/10 text-violet-400',
    rose: 'bg-rose-500/10 text-rose-400',
  };

  return (
    // The hover cue is elevation now; the card no longer has a border to tint.
    <Card className="transition-all duration-300 hover:shadow-card-hover">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-400 tracking-wider uppercase">{title}</p>
          <div className="text-2xl font-bold text-slate-100 tracking-tight">{value}</div>
        </div>
        {Icon && (
          <div className={cn('p-3 rounded-xl', iconVariants[variant])}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>

      {(change || subtext) && (
        <div className="mt-4 pt-3 flex items-center justify-between text-xs">
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
