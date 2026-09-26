import { cn } from '../../utils/cn';

export function Badge({ children, variant = 'default', className }) {
  // Badges are pills, not boxes: the tinted fill plus the text colour is
  // enough to tell the states apart, so there is no border here.
  const variants = {
    default: 'bg-brand-gold/15 text-brand-gold-strong',
    cyan: 'bg-sky-500/10 text-sky-400',
    emerald: 'bg-emerald-500/10 text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-400',
    rose: 'bg-rose-500/10 text-rose-400',
    violet: 'bg-violet-500/10 text-violet-400',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
