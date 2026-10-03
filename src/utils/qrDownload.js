import QRCode from 'qrcode';
import { slugify } from './gymCard';
import { CLUB_DISPLAY_NAME } from './brand';

// Saving a member's QR code.
//
// On screen the QR is an inline SVG drawn by qrcode.react, which offers no way to
// save it. Scrape-the-DOM-and-rasterise-through-a-canvas would work, but it fails
// quietly on a tainted canvas and it re-implements encoding that is already
// available. The qrcode package is a direct dependency, so the same token is
// re-encoded straight to a PNG instead. Both encode the identical payload, which
// is the only part a scanner reads, so the saved file means exactly what the one
// on screen means.

// 1024px is well past the ~500px any QR module grid actually needs, so the file
// stays sharp in a WhatsApp chat and still prints cleanly, and it is nowhere near
// a canvas limit.
const QR_PIXELS = 1024;

// Two modules of light margin, matching the quiet zone on the printed card. A QR
// saved without one is the most common reason a pass fails to scan at the door.
const QR_MARGIN = 2;

// 'M' is the same correction level the card and the player profile render, so the
// downloaded file is the same symbol rather than a denser or more fragile variant
// the front desk has not seen before.
const QR_ERROR_CORRECTION = 'M';

// Forced white on black. A transparent background scans on most apps and fails on
// whatever the receiving app decides to paint behind it.
const QR_COLORS = { dark: '#000000ff', light: '#ffffffff' };

/**
 * 'be-smart-fitness-club-qr-BSG-1001.png', matching gymCardFileName so a member
 * who downloads both files sees one naming scheme.
 */
export function qrFileName(member, { gymName = CLUB_DISPLAY_NAME } = {}) {
  const code = member?.member_code;
  if (code) return `${slugify(gymName)}-qr-${slugify(code)}.png`;

  const name = member?.full_name;
  if (name) return `${slugify(gymName)}-qr-${slugify(name)}.png`;

  return `${slugify(gymName)}-qr.png`;
}

/**
 * Encodes `value` as a PNG and hands it to the browser as a download.
 *
 * Throws rather than downloading a blank image when there is nothing to encode,
 * so the caller can show the reason instead of writing an unusable file.
 */
export async function downloadQrPng(value, fileName = 'gym-qr.png') {
  const token = String(value ?? '').trim();
  if (!token) {
    throw new Error('This member has no QR code to download yet.');
  }

  const dataUrl = await QRCode.toDataURL(token, {
    width: QR_PIXELS,
    margin: QR_MARGIN,
    errorCorrectionLevel: QR_ERROR_CORRECTION,
    color: QR_COLORS,
  });

  // Safari ignores the download attribute on anything but a Blob or data URL
  // object URL, but this attribute is set on a data URL anchor, which it honours.
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();

  return dataUrl;
}