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

// `icon` is optional. When it is not passed, nothing is rendered before the
// children, so every existing usage renders byte-for-byte as it did before.
//
// The base classes already had `flex items-center gap-2`, which is what an
// icon needs; the prop was simply never accepted. It is rendered `aria-hidden`
// because these are decorative: the heading text alone has to describe itself
// to a screen reader, and an unlabelled SVG would only add noise.
export function CardTitle({ children, icon: Icon, iconClassName, className, ...props }) {
  return (
    <h3
      className={cn('text-lg font-semibold text-slate-100 flex items-center gap-2', className)}
      {...props}
    >
      {Icon ? (
        <Icon
          className={cn('w-5 h-5 shrink-0 text-brand-cyan', iconClassName)}
          aria-hidden="true"
          focusable="false"
        />
      ) : null}
      {children}
    </h3>
  );
}
