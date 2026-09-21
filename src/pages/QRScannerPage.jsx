import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Camera, CheckCircle2, AlertTriangle, RefreshCw, KeyRound } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { attendanceService } from '../services/attendanceService';

export function QRScannerPage() {
  const [manualCode, setManualCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);

  const scannerRef = useRef(null);

  const handleScanPayload = useCallback(async (decodedText) => {
    if (processing) return;
    setProcessing(true);

    try {
      const result = await attendanceService.logCheckIn(decodedText, 'QR_SCAN');
      setScanResult(result);
    } catch (err) {
      setScanResult({
        success: false,
        error: err.message || 'Check-in processing error.',
      });
    } finally {
      setProcessing(false);
    }
  }, [processing]);

  useEffect(() => {
    let scanner = null;
    if (cameraActive) {
      scanner = new Html5QrcodeScanner('qr-reader', {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      }, false);

      scanner.render(
        (decodedText) => {
          handleScanPayload(decodedText);
        },
        () => {
          // Frame scanner without QR code
        }
      );
      scannerRef.current = scanner;
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch((err) => console.error('Error clearing scanner:', err));
      }
    };
  }, [cameraActive, handleScanPayload]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualCode) return;
    setProcessing(true);
    const result = await attendanceService.logCheckIn(manualCode, 'MANUAL_ENTRY');
    setScanResult(result);
    setManualCode('');
    setProcessing(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live QR Scanner & Verification"
        description="Scan member digital pass or printed QR card for instant check-in authentication."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Camera Scanner View */}
        <Card className="lg:col-span-2 p-6 flex flex-col items-center justify-center space-y-4">
          <div className="flex items-center justify-between w-full pb-3 border-b border-gym-800">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-brand-cyan" />
              <h3 className="text-sm font-semibold text-slate-100">Live Camera Stream</h3>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => setCameraActive(!cameraActive)}
            >
              {cameraActive ? 'Restart Camera' : 'Start Camera'}
            </Button>
          </div>

          <div className="w-full max-w-md mx-auto bg-gym-950 border border-gym-800 rounded-2xl p-4 min-h-[300px] flex items-center justify-center overflow-hidden">
            {cameraActive ? (
              <div id="qr-reader" className="w-full text-slate-100" />
            ) : (
              <div className="text-center py-12 text-slate-400">
                <Camera className="w-12 h-12 mx-auto text-gym-700 mb-2" />
                <p className="text-xs">Camera scanner is paused. Click Restart Camera above.</p>
              </div>
            )}
          </div>
        </Card>

        {/* Manual Lookup & Verification Rules */}
        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-brand-cyan" />
              Manual Check-in Fallback
            </h4>
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <Input
                placeholder="Enter BSG-1001 or QR Payload..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
              />
              <Button
                type="submit"
                variant="emerald"
                className="w-full"
                disabled={processing}
                icon={QrCode}
              >
                {processing ? 'Verifying...' : 'Submit Manual Check-in'}
              </Button>
            </form>
          </Card>

          <Card className="p-6 space-y-4">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Scan Audit Rules
            </h4>
            <ul className="text-xs text-slate-400 space-y-2.5">
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-emerald"></span>
                Instant database status lookup
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-cyan"></span>
                Logs check-in timestamp in attendance audit
              </li>
              <li className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                Flag & alert on expired or suspended members
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Verification Pop-up Result Modal */}
      <Modal
        isOpen={Boolean(scanResult)}
        onClose={() => setScanResult(null)}
        title="Check-in Verification Result"
      >
        {scanResult && (
          <div className="text-center py-4 space-y-4">
            {scanResult.success ? (
              <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-block">
                <CheckCircle2 className="w-12 h-12" />
              </div>
            ) : (
              <div className="p-4 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 inline-block">
                <AlertTriangle className="w-12 h-12" />
              </div>
            )}

            <div>
              <h3 className="text-xl font-bold text-slate-100">
                {scanResult.success ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
              </h3>
              {scanResult.member && (
                <p className="text-sm font-semibold text-brand-cyan mt-1">
                  {scanResult.member.full_name} ({scanResult.member.member_code})
                </p>
              )}
              <p className="text-xs text-slate-300 mt-2">
                {scanResult.success
                  ? `Member verified successfully! Assigned Plan: ${scanResult.member?.plan_name}`
                  : scanResult.error}
              </p>
            </div>

            <Button variant="primary" className="w-full mt-4" onClick={() => setScanResult(null)}>
              Dismiss & Ready Next Scan
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
