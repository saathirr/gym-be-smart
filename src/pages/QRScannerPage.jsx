import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5QrcodeScanner } from 'html5-qrcode';
import {
  QrCode,
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  KeyRound,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Avatar } from '../components/members/MemberPhoto';
import { attendanceService } from '../services/attendanceService';
import { useGym } from '../hooks/useGym';
import { useMemberPhotoUrls } from '../hooks/useMemberPhotoUrls';
import { firstCheckInLabel, formatTimestamp } from '../utils/attendanceMath';
import { toMessage } from '../lib/supabaseErrors';

export function QRScannerPage() {
  const [manualCode, setManualCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);

  const scannerRef = useRef(null);
  const busyRef = useRef(false);

  const navigate = useNavigate();
  const { settings } = useGym();
  const timeZone = settings?.timezone;

  const handleScanPayload = useCallback(async (decodedText) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setProcessing(true);

    try {
      setScanResult(await attendanceService.logCheckIn(decodedText, 'QR_SCAN'));
    } catch (err) {
      setScanResult({ success: false, error: toMessage(err, 'Check-in failed.') });
    } finally {
      setProcessing(false);
      setTimeout(() => {
        busyRef.current = false;
      }, 1200);
    }
  }, []);

  useEffect(() => {
    let scanner = null;

    if (cameraOn) {
      scanner = new Html5QrcodeScanner(
        'qr-reader',
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );

      scanner.render(
        (decodedText) => {
          handleScanPayload(decodedText);
        },
        () => {}
      );

      scannerRef.current = scanner;
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [cameraOn, handleScanPayload]);

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!manualCode.trim() || processing) return;

    setProcessing(true);
    try {
      setScanResult(
        await attendanceService.logCheckIn(manualCode.trim(), 'MANUAL_ENTRY')
      );
      setManualCode('');
    } catch (err) {
      setScanResult({ success: false, error: toMessage(err, 'Check-in failed.') });
    } finally {
      setProcessing(false);
    }
  };

  // On a repeat scan the service returns the original row for the day, so this
  // time is the first check-in either way.
  const resultCheckInTime = scanResult?.success
    ? firstCheckInLabel(
        scanResult.attendance?.check_in_time ? [scanResult.attendance.check_in_time] : [],
        timeZone
      )
    : null;

  // The photo on the result screen, so staff confirm the face and not just the
  // name. Signed in one batched request by the same hook the members list uses;
  // a member with no photo falls back to their initials, which is also what
  // happens on the profile and the card.
  const scannedPhotoPath = scanResult?.member?.avatar_url || null;
  const { urls: scannedPhotoUrls } = useMemberPhotoUrls(
    scannedPhotoPath ? [scannedPhotoPath] : []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="QR scanner"
        description="Scan a member pass at the door to verify access and log the check-in."
      >
        <Button
          variant="secondary"
          size="sm"
          icon={cameraOn ? CameraOff : Camera}
          onClick={() => setCameraOn((prev) => !prev)}
        >
          {cameraOn ? 'Stop camera' : 'Start camera'}
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 flex flex-col items-center justify-center space-y-4">
          <div className="flex items-center justify-between w-full pb-3 border-b">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-brand-cyan" />
              <h3 className="text-sm font-semibold text-slate-100">Camera view</h3>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => setCameraOn((prev) => !prev)}
            >
              {cameraOn ? 'Restart' : 'Start'}
            </Button>
          </div>

          <div className="w-full max-w-md mx-auto bg-gym-950 rounded-2xl p-4 min-h-[300px] flex items-center justify-center overflow-hidden">
            {cameraOn ? (
              <div id="qr-reader" className="w-full text-slate-100" />
            ) : (
              <div className="text-center py-12 text-slate-400">
                <CameraOff className="w-12 h-12 mx-auto text-gym-700 mb-2" />
                <p className="text-xs">Camera is stopped.</p>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6 space-y-4">
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-brand-cyan" />
              Manual fallback
            </h4>
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <Input
                placeholder="Member code or QR payload"
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
                {processing ? 'Verifying...' : 'Verify check-in'}
              </Button>
            </form>
          </Card>

          <Card className="p-6 space-y-4">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Entry rules
            </h4>
            <ul className="text-xs text-slate-400 space-y-2.5">
              <li className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-emerald shrink-0 mt-1" />
                Member must be Active with a running subscription
              </li>
              <li className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-cyan shrink-0 mt-1" />
                The first scan of the day is recorded against the club&rsquo;s local
                date
              </li>
              <li className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0 mt-1" />
                Scanning again shows the original check-in time instead of adding a
                second record
              </li>
              <li className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0 mt-1" />
                Expired, inactive, or suspended members are refused
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        isOpen={Boolean(scanResult)}
        onClose={() => setScanResult(null)}
        title="Verification result"
      >
        {scanResult && (
          <div className="text-center py-4 space-y-4">
            <div
              className={`p-4 rounded-full inline-block ${
                scanResult.success
                  ? scanResult.alreadyCheckedIn
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              {scanResult.success ? (
                <CheckCircle2 className="w-12 h-12" />
              ) : (
                <AlertTriangle className="w-12 h-12" />
              )}
            </div>

            <div>
              {scanResult.member && (
                <div className="flex justify-center mb-3">
                  <Avatar
                    src={scannedPhotoPath ? scannedPhotoUrls[scannedPhotoPath] : null}
                    name={scanResult.member.full_name}
                    size="lg"
                  />
                </div>
              )}

              <h3 className="text-xl font-bold text-slate-100">
                {scanResult.success
                  ? scanResult.alreadyCheckedIn
                    ? 'Already checked in'
                    : 'Access granted'
                  : 'Access denied'}
              </h3>
              {scanResult.member && (
                <p className="text-sm font-semibold text-brand-cyan mt-1">
                  {scanResult.member.full_name} ({scanResult.member.member_code})
                </p>
              )}
              <p className="text-xs text-slate-300 mt-2">
                {scanResult.success
                  ? `Plan: ${scanResult.member?.plan_name}${
                      scanResult.member?.expiration_date
                        ? ` • valid until ${scanResult.member.expiration_date}`
                        : ''
                    }`
                  : scanResult.error}
              </p>

              {scanResult.success && (
                <p className="text-xs text-slate-400 mt-2">
                  {scanResult.alreadyCheckedIn ? (
                    <>
                      Already recorded today at{' '}
                      <span className="text-slate-200 font-medium">
                        {resultCheckInTime || 'an unrecorded time'}
                      </span>
                      . This scan did not add a second record.
                    </>
                  ) : (
                    <>
                      Checked in at{' '}
                      <span className="text-slate-200 font-medium">
                        {resultCheckInTime || 'now'}
                      </span>{' '}
                      •{' '}
                      {formatTimestamp(scanResult.attendance?.check_in_time, timeZone)}
                    </>
                  )}
                </p>
              )}

              {scanResult.member && (
                <button
                  type="button"
                  onClick={() => {
                    setScanResult(null);
                    navigate(`/members/${scanResult.member.id}`);
                  }}
                  className="mt-3 text-xs text-brand-gold-strong hover:underline"
                >
                  Open player profile
                </button>
              )}
            </div>

            <Button
              variant="primary"
              className="w-full mt-4"
              onClick={() => setScanResult(null)}
            >
              Dismiss and scan next
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
