import { Loader2, RefreshCw, ImagePlus, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button';

// The message shown over the viewfinder whenever the live camera is not running.
//
// It has to be a sibling of the viewfinder rather than a child: html5-qrcode
// empties its own element on every start and clear, which would delete anything
// nested inside it. Keeping it separate also keeps the page down to camera
// orchestration, so the wording is unit tested without a camera.
export function CameraStatusOverlay({ status, issue, onRetry, onScanPhoto, decodingPhoto = false }) {
  if (status === 'running') return null;

  if (status === 'starting') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-gym-950/95">
        <Loader2 className="w-6 h-6 text-brand-cyan animate-spin" />
        <p className="text-xs text-slate-300">Starting the camera...</p>
        <p className="text-[11px] text-slate-500">
          Allow camera access if your phone asks.
        </p>
      </div>
    );
  }

  if (status === 'error' && issue) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-gym-950/95 overflow-y-auto">
        <ShieldAlert className="w-8 h-8 text-amber-400 shrink-0" />
        <p className="text-sm font-semibold text-slate-100">{issue.title}</p>
        <p className="text-xs text-slate-400 leading-relaxed max-w-sm">{issue.detail}</p>
        <p className="text-xs text-brand-cyan leading-relaxed max-w-sm">{issue.hint}</p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button variant="primary" size="sm" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={ImagePlus}
            disabled={decodingPhoto}
            onClick={onScanPhoto}
          >
            {decodingPhoto ? 'Reading photo...' : 'Scan a photo'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}