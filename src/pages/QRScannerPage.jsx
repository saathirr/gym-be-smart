import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import {
  QrCode,
  Camera,
  CameraOff,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  KeyRound,
  ImagePlus,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { CameraStatusOverlay } from '../components/common/CameraStatusOverlay';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Avatar } from '../components/members/MemberPhoto';
import { attendanceService } from '../services/attendanceService';
import { useGym } from '../hooks/useGym';
import { useMemberPhotoUrls } from '../hooks/useMemberPhotoUrls';
import { firstCheckInLabel, formatTimestamp } from '../utils/attendanceMath';
import {
  cameraOptionLabel,
  describeCameraError,
  detectCameraBlocker,
  pickPreferredCameraId,
} from '../utils/cameraSupport';
import { toMessage } from '../lib/supabaseErrors';

const READER_ID = 'qr-reader';
const CAMERA_FPS = 20;

export function QRScannerPage() {
  const [manualCode, setManualCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  // idle -> starting -> running, or error when the browser refused a camera.
  const [cameraStatus, setCameraStatus] = useState('idle');
  const [cameraIssue, setCameraIssue] = useState(null);
  const [photoIssue, setPhotoIssue] = useState(null);
  const [decodingPhoto, setDecodingPhoto] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [attempt, setAttempt] = useState(0);

  const scannerRef = useRef(null);
  const busyRef = useRef(false);
  const photoInputRef = useRef(null);

  const navigate = useNavigate();
  const { settings } = useGym();
  const timeZone = settings?.timezone;

  const submitPayload = useCallback(async (payload, method) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setProcessing(true);

    try {
      setScanResult(await attendanceService.logCheckIn(payload, method));
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
    if (!cameraOn) {
      setCameraStatus('idle');
      setCameraIssue(null);
      return undefined;
    }

    // Checked before touching the library so the phone gets the HTTPS reason
    // rather than a bare NotAllowedError it cannot act on.
    const blocker = detectCameraBlocker({
      isSecureContext: window.isSecureContext !== false,
      hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
    });

    if (blocker) {
      setCameras([]);
      setCameraStatus('error');
      setCameraIssue(blocker);
      return undefined;
    }

    let cancelled = false;
    const scanner = new Html5Qrcode(READER_ID, {
      verbose: false,
      useBarCodeDetectorIfSupported: true,
    });
    scannerRef.current = scanner;

    const stopScanner = () => {
      const running = scannerRef.current;
      scannerRef.current = null;
      if (!running) return;
      // stop() rejects when nothing is running, which happens when the start
      // attempt failed or a photo scan already closed the camera.
      running.stop().catch(() => {}).finally(() => {
        try {
          running.clear();
        } catch {
          // The element is already detached; nothing left to clear.
        }
      });
    };

    const start = async () => {
      setCameraStatus('starting');
      setCameraIssue(null);

      try {
        let target = cameraId;

        if (!target) {
          // Device labels stay hidden until the first permission grant, so an
          // empty list here is normal and not a reason to give up: start() then
          // falls back to a facingMode constraint and lets the browser choose.
          const devices = await Html5Qrcode.getCameras().catch(() => []);
          if (cancelled) return;
          setCameras(devices);
          target = pickPreferredCameraId(devices);
        }

        if (cancelled) {
          stopScanner();
          return;
        }

        await scanner.start(
          target || { facingMode: { ideal: 'environment' } },
          {
            fps: CAMERA_FPS,
            // Square, and a share of the smaller viewfinder side so the box
            // still fits when a phone is held in portrait.
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const side = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.8);
              return { width: side, height: side };
            },
            aspectRatio: 1,
            disableFlip: true,
          },
          (decodedText) => {
            submitPayload(decodedText, 'QR_SCAN');
          },
          () => {}
        );

        if (cancelled) {
          stopScanner();
          return;
        }
        setCameraStatus('running');
      } catch (err) {
        if (cancelled) return;
        stopScanner();
        setCameraStatus('error');
        setCameraIssue(describeCameraError(err));
      }
    };

    start();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [cameraOn, cameraId, attempt, submitPayload]);

  // Camera pick-and-place fails on purpose, so picking a photo always works.
  // This also stops the empty video box from sitting there pretending to scan.
  const handlePhotoSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || decodingPhoto) return;

    setDecodingPhoto(true);
    setPhotoIssue(null);

    const wasRunning = cameraStatus === 'running';
    const running = scannerRef.current;
    if (running) {
      scannerRef.current = null;
      await running.stop().catch(() => {});
    }

    const reader = new Html5Qrcode(READER_ID);
    try {
      const decodedText = await reader.scanFile(file, false);
      await submitPayload(decodedText, 'QR_SCAN');
      if (wasRunning) setAttempt((n) => n + 1);
    } catch {
      setPhotoIssue({
        title: 'No member pass found in that photo',
        detail: 'The photo was read, but no QR code was recognised in it.',
        hint: 'Fill the frame with the code and keep the photo sharp. If the code is printed small on a card, take the photo closer.',
      });
      if (wasRunning) setAttempt((n) => n + 1);
    } finally {
      try {
        reader.clear();
      } catch {
        // Nothing to clear.
      }
      setDecodingPhoto(false);
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code || processing) return;

    setManualCode('');
    await submitPayload(code, 'MANUAL_ENTRY');
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

  // Which camera the picker shows as current. Empty until the first successful
  // start, at which point the browsers that hide labels still get a numbered
  // entry to switch back to.
  const activeCameraId = cameraId || pickPreferredCameraId(cameras) || cameras[0]?.id || '';

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
            <div className="flex items-center gap-2">
              {cameras.length > 1 && (
                <select
                  value={activeCameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  aria-label="Camera to scan with"
                  className="rounded-lg bg-gym-850 text-xs text-slate-200 px-2 py-1.5 max-w-[220px] focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                >
                  {cameras.map((device, index) => (
                    <option key={device.id} value={device.id}>
                      {cameraOptionLabel(device, index)}
                    </option>
                  ))}
                </select>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </Button>
            </div>
          </div>

          <div className="relative w-full max-w-md mx-auto bg-gym-950 rounded-2xl p-4 min-h-[300px] flex items-center justify-center overflow-hidden">
            {cameraOn ? (
              <>
                {/* The library empties this element whenever it (re)starts, so
                    every overlay is a sibling of it, never a child. */}
                <div id={READER_ID} className="w-full text-slate-100" />

                <CameraStatusOverlay
                  status={cameraStatus}
                  issue={cameraIssue}
                  decodingPhoto={decodingPhoto}
                  onRetry={() => setAttempt((n) => n + 1)}
                  onScanPhoto={() => photoInputRef.current?.click()}
                />
              </>
            ) : (
              <div className="text-center py-12 text-slate-400">
                <CameraOff className="w-12 h-12 mx-auto text-gym-700 mb-2" />
                <p className="text-xs">Camera is stopped.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Camera}
                  className="mt-3"
                  onClick={() => setCameraOn(true)}
                >
                  Start camera
                </Button>
              </div>
            )}
          </div>

          <div className="w-full max-w-md mx-auto">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelected}
              className="hidden"
              aria-label="Scan a photo of a member pass"
            />
            <Button
              variant="secondary"
              size="sm"
              icon={ImagePlus}
              className="w-full"
              disabled={decodingPhoto}
              onClick={() => photoInputRef.current?.click()}
            >
              {decodingPhoto ? 'Reading photo...' : 'Scan a photo of the pass'}
            </Button>
            <p className="text-[11px] text-slate-500 mt-2 text-center">
              Opens the phone camera and reads the code as a picture. Works even where
              the browser blocks live camera access.
            </p>

            {photoIssue && (
              <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <p className="text-xs font-semibold text-amber-300">{photoIssue.title}</p>
                <p className="text-xs text-slate-400 mt-1">{photoIssue.detail}</p>
                <p className="text-xs text-slate-300 mt-1">{photoIssue.hint}</p>
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