import React from 'react';
import { cn } from '../../utils/cn';

export const Input = React.forwardRef(function Input(
  { label, error, icon: Icon, className, type = 'text', ...props },
  ref
) {
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label className="block text-xs font-medium text-slate-300">
          {label}
        </label>
      )}
      <div className="relative rounded-lg shadow-sm">
        {Icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <input
          ref={ref}
          type={type}
          className={cn(
            'w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 placeholder-slate-500 text-sm px-3.5 py-2.5 transition focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan',
            Icon && 'pl-10',
            error && 'border-brand-rose focus:border-brand-rose focus:ring-brand-rose',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-brand-rose mt-1">{error}</p>}
    </div>
  );
});
