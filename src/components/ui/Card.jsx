import { cn } from '../../utils/cn';

export function Card({ children, className, ...props }) {
  return (
    <div
      className={cn(
        // shadow-card resolves to a soft elevation in light mode and to no
        // shadow at all in dark mode, where the surface step does the work.
        'bg-gym-900/90 rounded-xl p-6 shadow-card relative overflow-hidden backdrop-blur-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }) {
  // The rule under the header is gone; the bottom margin carries the split.
  return (
    <div className={cn('flex items-center justify-between pb-4 mb-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }) {
  return (
    <h3 className={cn('text-lg font-semibold text-slate-100 flex items-center gap-2', className)}>
      {children}
    </h3>
  );
}
