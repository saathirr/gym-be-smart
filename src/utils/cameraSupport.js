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
  if (hasMediaDevices === false) {
    return issue(
      'unsupported',
      'This browser cannot reach a camera',
      'The camera API is unavailable here. A very old browser, or a locked-down kiosk mode, can hide it.',
      'Open the scanner in the current Chrome, Edge, Safari or Firefox, and check that no policy is blocking the camera.'
    );
  }

  if (isSecureContext === false) {
    return issue(
      'insecure-context',
      'Camera blocked: this page is not on HTTPS',
      'Phones only allow camera access on a secure (https) address. Opening the app by its local IP (for example http://192.168.1.5:3000) is plain HTTP, so the browser refuses the camera before it can even ask you. The desktop is unaffected because localhost counts as secure.',
      `Open the same address through a temporary HTTPS tunnel instead: run ${HTTPS_TUNNEL_COMMANDS.join(' or ')} on the PC, then scan with the phone on the https address it prints.`
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

  // The one the phone throws over plain HTTP. Checked before the generic
  // permission case because it has an entirely different fix.
  if (/insecure context|not allowed by the user agent/i.test(message) && name !== 'NotAllowedError') {
    return detectCameraBlocker({ isSecureContext: false });
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return issue(
      'permission-denied',
      'Camera permission was declined',
      'The browser blocked camera access for this site, so no camera can be opened.',
      'Tap the camera or lock icon beside the address, set Camera to Allow, then reload the page. On iPhone also check Settings > Privacy & Security > Camera.'
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