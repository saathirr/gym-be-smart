import { cn } from '../../utils/cn';

export function Card({ children, className, ...props }) {
  return (
    <div
      className={cn(
        'bg-gym-900/90 border border-gym-800/80 rounded-xl p-6 shadow-xl relative overflow-hidden backdrop-blur-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }) {
  return (
    <div className={cn('flex items-center justify-between pb-4 mb-4 border-b border-gym-800/80', className)}>
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
