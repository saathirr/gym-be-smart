import { QrCode, Camera } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function QRScannerPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Live QR Scanner"
        description="Scan member digital pass or printed QR card for instant check-in."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800 min-h-[380px]">
          <div className="p-4 rounded-full bg-gym-800/80 text-brand-cyan mb-4 animate-pulse">
            <Camera className="w-10 h-10" />
          </div>
          <h3 className="text-lg font-semibold text-slate-200">Camera Feed Scanner</h3>
          <p className="text-sm text-slate-400 max-w-md mt-1 mb-4">
            Camera-based QR scanner using html5-qrcode dependency will activate upon Supabase backend configuration.
          </p>
          <Button variant="secondary" icon={QrCode}>
            Simulate Scan
          </Button>
        </Card>

        <Card className="space-y-4">
          <h4 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Verification Rules
          </h4>
          <ul className="text-xs text-slate-400 space-y-2.5">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-emerald"></span>
              Validates Active Subscriptions
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
              Logs Check-in Timestamp automatically
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              Alerts staff if membership has expired
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
