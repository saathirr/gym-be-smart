import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

export function Modal({ isOpen, onClose, title, children, className, footer }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // A footer turns the panel into three fixed areas: a header that never moves,
  // a body that is the only thing that scrolls, and a footer that stays pinned.
  // Without one the panel keeps its original single-block markup, so every
  // existing modal renders exactly as it did before.
  const isPinned = Boolean(footer);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-gym-950/80 backdrop-blur-sm animate-fade-in">
      <div
        className={cn(
          'w-full bg-gym-900 rounded-2xl shadow-2xl relative',
          isPinned
            ? 'flex flex-col max-h-[92vh] min-h-0'
            : 'max-w-lg p-6 space-y-4 transform transition-all',
          className
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between shrink-0',
            isPinned ? 'px-5 py-3.5 sm:px-6 border-b border-hairline' : 'pb-3 border-b'
          )}
        >
          <h3 className="text-base sm:text-lg font-semibold text-slate-100">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-gym-800 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* min-h-0 is required on a flex child that scrolls, otherwise the
            child refuses to shrink below its content height and the panel grows
            past the viewport instead of scrolling inside it. */}
        <div className={cn(isPinned && 'flex-1 min-h-0 overflow-y-auto px-5 py-4 sm:px-6')}>
          {children}
        </div>

        {isPinned && (
          <div className="shrink-0 border-t border-hairline bg-gym-900 px-5 py-3 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
