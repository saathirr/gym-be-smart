import { cn } from '../../utils/cn';

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  icon: Icon,
  onClick,
  ...props
}) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-brand-cyan hover:bg-sky-500 text-white focus:ring-sky-400 shadow-lg shadow-sky-500/20 active:scale-[0.98]',
    emerald: 'bg-brand-emerald hover:bg-emerald-500 text-white focus:ring-emerald-400 shadow-lg shadow-emerald-500/20 active:scale-[0.98]',
    secondary: 'bg-gym-800 hover:bg-gym-700 text-slate-200 border border-edge-strong focus:ring-slate-400',
    outline: 'border border-edge-strong text-slate-300 hover:border-brand-cyan hover:text-brand-cyan bg-transparent',
    ghost: 'text-slate-400 hover:text-slate-100 hover:bg-gym-800/60',
    danger: 'bg-brand-rose hover:bg-rose-600 text-white focus:ring-rose-500 shadow-lg shadow-rose-500/20',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2.5',
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      {...props}
    >
      {Icon && <Icon className="w-4 h-4 shrink-0" />}
      {children}
    </button>
  );
}
