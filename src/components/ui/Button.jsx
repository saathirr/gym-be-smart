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
    // Gold is the logo colour. As a fill it carries near-black text at 8.2:1,
    // so the primary action is a gold button with dark type rather than a
    // white-on-gold one.
    primary: 'bg-brand-gold text-brand-ink hover:bg-brand-gold-strong focus:ring-brand-gold/50 shadow-md active:scale-[0.98]',
    emerald: 'bg-brand-emerald hover:bg-emerald-500 text-white focus:ring-emerald-400 shadow-lg shadow-emerald-500/20 active:scale-[0.98]',
    // The secondary and outline variants are distinguished by fill depth
    // rather than by a border, which no longer exists.
    secondary: 'bg-gym-850 hover:bg-gym-800 text-slate-200 focus:ring-brand-gold/40',
    outline: 'bg-gym-850/60 hover:bg-gym-800 text-slate-300 hover:text-brand-gold-strong focus:ring-brand-gold/40',
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
