// Why the QR scanner cannot open a camera, in words a staff member can act on.
//
// The browser is the only thing that can refuse a camera, and it refuses in
// several different ways that all look identical on screen if the raw
// `NotAllowedError: The request is not allowed by the user agent or the platform
// in the current context` is shown as-is. So every refusal is mapped to a plain
// reason plus the specific fix, and the scanner renders that instead of the
// exception text.

// A phone only grants camera access on HTTPS. `http://192.168.1.5:3000` looks
// like the internet to the phone and counts as insecure, so the camera is
// blocked before any permission prompt appears. localhost is the one exception,
// which is why this never shows up on the desk PC.
export const HTTPS_TUNNEL_COMMANDS = [
  'npx cloudflared tunnel --url http://localhost:3000',
  'ngrok http 3000',
];

function issue(code, title, detail, hint) {
  return { code, title, detail, hint };
}

/**
 * Checks the browser capabilities that gate getUserMedia, before asking for a
 * camera that cannot be delivered. Returns null when the camera is worth trying.
 */
export function detectCameraBlocker({ isSecureContext = true, hasMediaDevices = true } = {}) {
  const isHttp =
    typeof window !== 'undefined' &&
    window.location.protocol === 'http:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  if (isSecureContext === false || isHttp) {
    return issue(
      'insecure-context',
      'Camera blocked: this page is not on HTTPS',
      'Mobile phone browsers strictly block camera access over plain HTTP (e.g. http://192.168.1.5:3000). Camera access is only granted on HTTPS addresses or localhost.',
      `Deploy to GitHub Pages (HTTPS) or open the app through an HTTPS tunnel for phone testing: run ${HTTPS_TUNNEL_COMMANDS.join(' or ')} on your PC, then open the https link on your phone.`
    );
  }

  if (hasMediaDevices === false) {
    return issue(
      'unsupported',
      'This browser cannot reach a camera',
      'The camera API is unavailable here. A very old browser, or a locked-down kiosk mode, can hide it.',
      'Open the scanner in the current Chrome, Edge, Safari or Firefox, and check that no policy is blocking the camera.'
    );
  }

  return null;
}

/**
 * Maps a failed getUserMedia / start() rejection to the same shape as
 * detectCameraBlocker, so the scanner has one place to render errors.
 */
export function describeCameraError(error) {
  const name = error?.name || '';
  const message = String(error?.message || error || '');

  const isHttp =
    typeof window !== 'undefined' &&
    window.location?.protocol === 'http:' &&
    window.location?.hostname !== 'localhost' &&
    window.location?.hostname !== '127.0.0.1';

  const isInsecure =
    isHttp ||
    (typeof window !== 'undefined' && window.isSecureContext === false) ||
    /insecure context/i.test(message);

  if (isInsecure || (/not allowed by the user agent/i.test(message) && name !== 'NotAllowedError')) {
    return detectCameraBlocker({ isSecureContext: false });
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return issue(
      'permission-denied',
      'Camera permission was declined or blocked',
      'The browser or phone OS blocked camera access for this site.',
      '1. If testing on phone over HTTP, open via HTTPS or GitHub Pages instead.\n2. Tap the lock/tune icon beside the web address in your mobile browser, set Camera to "Allow", and reload.\n3. On iPhone: check Settings > Privacy & Security > Camera > enable Safari/Chrome.'
    );
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return issue(
      'no-camera',
      'No camera found',
      'This device reports no usable camera to the browser.',
      'Check that nothing is covering the lens, then pick a camera from the list. A webcam plugged in after the page loaded also needs a reload.'
    );
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return issue(
      'camera-busy',
      'The camera is already in use',
      'Another app or tab is holding the camera, so this page cannot open it.',
      'Close the other camera app or tab, including the system camera app, then press Try again.'
    );
  }

  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return issue(
      'camera-unsupported',
      'That camera cannot start',
      'The selected camera rejected the requested resolution or facing mode.',
      'Choose a different camera from the list, or press Try again to let the app pick one automatically.'
    );
  }

  return issue(
    'camera-failed',
    'The camera could not be started',
    message || 'The browser refused to open the camera for an unknown reason.',
    'Press Try again. If it keeps failing, reload the page or use Scan from a photo with the member code typed in by hand.'
  );
}

const BACK_CAMERA = /back|rear|environment|main|world|后置/i;
const FRONT_CAMERA = /front|user|selfie|前置/i;

/**
 * Picks the camera to open first. A phone listed both ways, and the rear lens
 * is the only one that can focus on a pass held at arm's length, so it wins.
 * Falls back to the first device, which is what single-webcam PCs expose.
 */
export function pickPreferredCameraId(devices = []) {
  const list = Array.isArray(devices) ? devices.filter((d) => d?.id) : [];
  if (list.length === 0) return '';

  const labelled = list.filter((d) => d.label);
  if (labelled.length === 0) return '';

  return (labelled.find((d) => BACK_CAMERA.test(d.label)) || labelled[0]).id;
}

/**
 * A readable name for the camera picker. Before permission is granted browsers
 * hand back devices with an empty label, so those are numbered rather than
 * shown as a row of identical blank entries.
 */
export function cameraOptionLabel(device, index = 0) {
  const label = String(device?.label || '').trim();
  if (label) {
    return FRONT_CAMERA.test(label) ? `Front camera - ${label}` : label;
  }
  return `Camera ${index + 1} (name hidden until permission is granted)`;
}