import {
  GYM_CARD_HEIGHT_MM,
  GYM_CARD_MARGIN_MM,
  GYM_CARD_WIDTH_MM,
  buildGymCardData,
  gymCardFileName,
  isMembershipLive,
} from '../utils/gymCard';
import { LOGO_SRC } from '../utils/brand';

// The physical gym card, as a one-page CR80 PDF.
//
// jsPDF and the QR encoder are both loaded on demand. Together they add roughly
// 400 kB of JavaScript, and the overwhelming majority of sessions never print a
// card, so pulling them into the main bundle would slow down the login screen
// and the members list to serve a feature used once per registration.

// jsPDF wants a unit for every measurement. 'mm' keeps the arithmetic in the
// same space as the card constants, so a layout change moves the PDF and the
// on-screen preview together.
const UNIT = 'mm';

const INK = '#111827';
const MUTED = '#6B7280';
const ACCENT = '#16A34A';
const WARN = '#D97706';
const HAIRLINE = '#E5E7EB';

// ---------------------------------------------------------------------
// Layout, all in millimetres from the top-left of the card.
//
// These are constants rather than scattered literals so the whole card can be
// re-proportioned by editing one block, and so the on-screen preview in
// GymCard.jsx can be checked against the same numbers.
// ---------------------------------------------------------------------
const HEADER_HEIGHT = 12.5;
const QR_SIZE = 20;
const PHOTO_SIZE = 12;
const BODY_TOP = GYM_CARD_MARGIN_MM + HEADER_HEIGHT + 4;

const LEFT = GYM_CARD_MARGIN_MM + 3;
const RIGHT = GYM_CARD_WIDTH_MM - GYM_CARD_MARGIN_MM;

const QR_X = RIGHT - QR_SIZE - 0.5;
const QR_Y = BODY_TOP - 1.5;

// Text column. When there is a photo the text starts to the right of it, which
// is why these are functions of hasPhoto rather than constants.
const textLeft = (hasPhoto) => (hasPhoto ? LEFT + PHOTO_SIZE + 2.5 : LEFT);
const textWidth = (hasPhoto) => QR_X - 2.5 - textLeft(hasPhoto);

/**
 * Renders the QR payload as a PNG data URL.
 *
 * The payload is the opaque qr_code_id and nothing else. A card gets
 * photographed, posted and left on a desk, so the code only has to resolve to a
 * member id - it must not become a carrier for name, phone or NIC.
 */
async function renderQrDataUrl(payload) {
  if (!payload) return null;

  const QR = await import('qrcode');
  return QR.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    // The QR specification asks for a four-module quiet zone. The white plate
    // drawn under the code adds more, but a QR that is generated without its
    // own margin is the part that gets missed, and an unscannable card is worse
    // than a slightly smaller one.
    margin: 4,
    // Comfortably above what the ~20mm QR needs on a 300dpi card printer, and
    // small enough to keep the embedded PNG cheap.
    width: 600,
    color: { dark: INK, light: '#FFFFFF' },
  });
}

// ---------------------------------------------------------------------
// Image plumbing.
//
// jsPDF's addImage() decodes the image it is given. It does not fetch: a
// `blob:` URL, which is what URL.createObjectURL() produces, is not a format it
// can read, and passing one silently yields a blank box on the card. The logo
// was being loaded exactly that way before, so it never appeared in a printed
// card and the failure was swallowed by the surrounding try/catch.
//
// Everything is therefore converted to a real base64 data URL, and the format
// string handed to addImage() is derived from the bytes' own MIME type instead
// of being assumed to be JPEG.
// ---------------------------------------------------------------------

// Formats jsPDF can decode natively.
const PDF_FORMATS = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
};

export function imageFormatFromMime(mime) {
  return PDF_FORMATS[String(mime || '').toLowerCase().trim()] || null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Re-encodes a format jsPDF cannot decode as JPEG.
 *
 * The upload pipeline already flattens every member photo to JPEG, so this is
 * only reached for a WebP that slipped through a failed re-encode, and for the
 * logo if it is ever replaced with one. Canvas is used rather than another
 * dependency, and a failure here is not fatal: the caller falls back to the
 * placeholder rather than failing the whole card.
 */
async function reencodeAsJpeg(blob) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return null;
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    // JPEG has no alpha channel, so transparency has to be flattened or the
    // card comes out with black edges.
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);

    const jpeg = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
    if (!jpeg) return null;

    return { blob: jpeg, format: 'JPEG' };
  } catch {
    return null;
  }
}

/**
 * Turns a Blob or a fetchable URL into something jsPDF can draw.
 *
 * @param {Blob|string} source
 * @returns {Promise<{dataUrl: string, format: string}|null>} null when the image
 *          cannot be read at all, which the caller treats as "draw the
 *          placeholder".
 */
export async function imageToPdfAsset(source) {
  let blob = source;

  if (typeof source === 'string') {
    const response = await fetch(source);
    if (!response.ok) return null;
    blob = await response.blob();
  }

  if (!blob || typeof blob.arrayBuffer !== 'function') return null;

  let format = imageFormatFromMime(blob.type);
  let chosen = blob;

  if (!format) {
    const converted = await reencodeAsJpeg(blob);
    if (converted) {
      chosen = converted.blob;
      format = converted.format;
    } else {
      // Last resort: hand the bytes over with their own type and let jsPDF
      // decide. A card with a missing photo is still a valid card.
      format = 'JPEG';
    }
  }

  const dataUrl = await blobToDataUrl(chosen);
  if (!dataUrl.startsWith('data:')) return null;

  return { dataUrl, format };
}

// Assets may be passed as a bare data URL string (handy in tests) or as the
// { dataUrl, format } pair the loaders return.
function assetData(asset) {
  if (!asset) return null;
  return typeof asset === 'string' ? asset : asset.dataUrl || null;
}

function assetFormat(asset, fallback = 'JPEG') {
  if (asset && typeof asset === 'object' && asset.format) return asset.format;
  return fallback;
}

async function loadLogo() {
  try {
    return await imageToPdfAsset(LOGO_SRC);
  } catch {
    // A missing logo must not stop someone printing a card.
    return null;
  }
}

function safeText(value, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Trims a name so it cannot overflow the card.
 *
 * jsPDF does not wrap or ellipsise, and a long name would be printed on the edge
 * of every badge. The budget is derived from the width of the text column, so it
 * stays correct if the font size or the column width changes.
 */
function fitName(name, maxChars) {
  const full = String(name ?? '').trim() || 'Member';
  if (full.length <= maxChars) return full;

  // Prefer breaking on a space near the limit; hard-cut a single unbroken run.
  const cut = full.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 4 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

// Helvetic at 11pt is roughly 0.55 * fontSize per character in millimetres, so
// this converts the available column into a character budget rather than
// hard-coding a number that would silently break on a rename.
function maxChars(widthMm, fontSize) {
  return Math.max(8, Math.floor(widthMm / (fontSize * 0.155)));
}

/**
 * Draws the card onto an existing jsPDF document.
 *
 * Exported separately from the download so the same layout can be reused for a
 * multi-card print sheet without repeating any of the drawing code.
 */
export function drawGymCard(
  doc,
  card,
  { qrDataUrl = null, logo = null, photo = null, logoDataUrl = null, photoDataUrl = null } = {}
) {
  // Bare strings are still accepted so the layout can be driven from a test
  // without building real image assets.
  const logoAsset = logo || logoDataUrl;
  const photoAsset = photo || photoDataUrl;
  const photoSrc = assetData(photoAsset);
  const hasPhoto = Boolean(photoSrc);

  // Page background, then a hairline inset so the card has a visible edge when
  // it is printed on white paper and a defined border on a coloured sheet.
  doc.setFillColor('#FFFFFF');
  doc.rect(0, 0, GYM_CARD_WIDTH_MM, GYM_CARD_HEIGHT_MM, 'F');

  doc.setDrawColor(HAIRLINE);
  doc.setLineWidth(0.3);
  doc.rect(
    GYM_CARD_MARGIN_MM,
    GYM_CARD_MARGIN_MM,
    GYM_CARD_WIDTH_MM - GYM_CARD_MARGIN_MM * 2,
    GYM_CARD_HEIGHT_MM - GYM_CARD_MARGIN_MM * 2
  );

  // ---- Header band -------------------------------------------------
  doc.setFillColor(ACCENT);
  doc.rect(
    GYM_CARD_MARGIN_MM,
    GYM_CARD_MARGIN_MM,
    GYM_CARD_WIDTH_MM - GYM_CARD_MARGIN_MM * 2,
    HEADER_HEIGHT,
    'F'
  );

  let wordmarkLeft = GYM_CARD_MARGIN_MM + 2.5;
  const logoSrc = assetData(logoAsset);

  if (logoSrc) {
    const logoSize = 8.5;
    try {
      // The logo is a square 640x640 JPEG with no alpha channel, so it is drawn
      // into a square box to avoid stretching it.
      doc.addImage(
        logoSrc,
        assetFormat(logoAsset),
        wordmarkLeft,
        GYM_CARD_MARGIN_MM + (HEADER_HEIGHT - logoSize) / 2,
        logoSize,
        logoSize
      );
      wordmarkLeft += logoSize + 2;
    } catch {
      // Fall through to the wordmark alone.
    }
  }

  doc.setTextColor('#FFFFFF');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('BE SMART FITNESS CLUB', wordmarkLeft, GYM_CARD_MARGIN_MM + 5.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.text('Gym Membership Card', wordmarkLeft, GYM_CARD_MARGIN_MM + 9.8);

  // ---- Optional photo ----------------------------------------------
  if (hasPhoto) {
    // A neutral plate is painted first, so a photo that fails to decode leaves
    // a clean placeholder rather than a torn or stretched image.
    doc.setFillColor('#E5E7EB');
    doc.rect(LEFT, BODY_TOP - 1, PHOTO_SIZE, PHOTO_SIZE, 'F');

    try {
      doc.addImage(
        photoSrc,
        assetFormat(photoAsset),
        LEFT,
        BODY_TOP - 1,
        PHOTO_SIZE,
        PHOTO_SIZE
      );
    } catch {
      // Fall through to the initials placeholder drawn below.
    }
  }

  // ---- Photo initials, shown when there is no usable photo ------------
  if (!hasPhoto || photoAsset?.failed) {
    const initials = String(card.fullName || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');

    if (initials) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      doc.setTextColor('#6B7280');
      doc.text(
        initials,
        LEFT + PHOTO_SIZE / 2,
        BODY_TOP - 1 + PHOTO_SIZE / 2 + 2.2,
        { align: 'center' }
      );
      doc.setFont('helvetica', 'normal');
    }
  }

  // ---- Identity ----------------------------------------------------
  const columnLeft = textLeft(hasPhoto);
  const columnWidth = textWidth(hasPhoto);
  const live = isMembershipLive(card.membershipStatus);

  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(fitName(card.fullName, maxChars(columnWidth, 10.5)), columnLeft, BODY_TOP + 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(MUTED);
  doc.text(`Member ID: ${safeText(card.memberCode, 20) || 'N/A'}`, columnLeft, BODY_TOP + 6.5);

  // ---- Entitlement rows --------------------------------------------
  // Exactly three facts, the same ones the front desk needs to decide whether
  // to let someone in. No NIC, no address, no phone: the card is a public object.
  const rows = [
    ['Membership', safeText(card.planName, 26) || 'No Active Plan'],
    ['Status', safeText(card.membershipStatus, 20) || 'Unknown'],
    ['Valid until', safeText(card.validUntil, 24)],
  ].filter(([, value]) => Boolean(value));

  let rowY = BODY_TOP + 12.5;
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(MUTED);
    doc.text(label.toUpperCase(), columnLeft, rowY);

    doc.setFontSize(7);
    doc.setTextColor(live ? INK : WARN);
    doc.setFont('helvetica', live ? 'normal' : 'bold');
    doc.text(value, columnLeft + 16, rowY);
    doc.setFont('helvetica', 'normal');
    rowY += 4.6;
  }

  // ---- QR block ----------------------------------------------------
  // White plate plus hairline border: scanners need a quiet zone, and a QR
  // sitting directly on the card fill is unreliable on cheap scanners.
  doc.setFillColor('#FFFFFF');
  doc.rect(QR_X - 1, QR_Y - 1, QR_SIZE + 2, QR_SIZE + 2, 'F');
  doc.setDrawColor(HAIRLINE);
  doc.setLineWidth(0.2);
  doc.rect(QR_X - 1, QR_Y - 1, QR_SIZE + 2, QR_SIZE + 2);

  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', QR_X, QR_Y, QR_SIZE, QR_SIZE);
    } catch {
      // A card that looks valid but cannot be scanned is worse than one that
      // admits the problem, so the placeholder is explicit.
      doc.setFontSize(5);
      doc.setTextColor(WARN);
      doc.text('QR unavailable', QR_X + QR_SIZE / 2, QR_Y + QR_SIZE / 2, { align: 'center' });
    }
  } else {
    doc.setFontSize(5);
    doc.setTextColor(WARN);
    doc.text('No QR token', QR_X + QR_SIZE / 2, QR_Y + QR_SIZE / 2, { align: 'center' });
  }

  // ---- Footer ------------------------------------------------------
  const footerY = GYM_CARD_HEIGHT_MM - GYM_CARD_MARGIN_MM - 3.2;
  doc.setDrawColor(HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(LEFT, footerY - 2.6, RIGHT, footerY - 2.6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.setTextColor(MUTED);
  doc.text('Show this QR code at the entrance.', LEFT, footerY);

  return doc;
}

/**
 * Builds the PDF and hands it to the browser's download.
 *
 * @param {object} member          member row, as returned by memberService
 * @param {object} [options]
 * @param {string} [options.photoDataUrl]  ready-made image data URL
 * @param {string} [options.photoUrl]      a PRIVATE signed URL, as returned by
 *                                         storageService.getPhotoUrl. The bytes
 *                                         are fetched with the caller's
 *                                         credentials and embedded into the PDF;
 *                                         the URL itself is never printed and
 *                                         the bucket is never made public.
 * @param {string} [options.gymName]
 * @returns {Promise<string>} the filename that was used
 */
export async function downloadGymCardPdf(
  member,
  { photoDataUrl = null, photoUrl = null, gymName } = {}
) {
  const card = buildGymCardData(member, { gymName });
  if (!card) throw new Error('There is no member to print a card for.');

  // Dynamic imports, in parallel: neither library is in the main bundle.
  const [jspdfModule, qrDataUrl, logo, photo] = await Promise.all([
    import('jspdf'),
    renderQrDataUrl(card.qrPayload),
    loadLogo(),
    photoDataUrl
      ? Promise.resolve({ dataUrl: photoDataUrl, format: 'JPEG' })
      : photoUrl
        ? imageToPdfAsset(photoUrl).catch(() => null)
        : Promise.resolve(null),
  ]);

  // jspdf exposes a named `jsPDF` export and a default object that also carries
  // it; which one is present has changed between major versions.
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default?.jsPDF || jspdfModule.default;
  if (typeof JsPDF !== 'function') {
    throw new Error('The PDF library could not be loaded.');
  }

  const doc = new JsPDF({
    orientation: 'landscape',
    unit: UNIT,
    format: [GYM_CARD_WIDTH_MM, GYM_CARD_HEIGHT_MM],
    compress: true,
  });

  // Both assets are already base64 data URLs, so there is nothing to revoke and
  // nothing left to fetch at save() time.
  drawGymCard(doc, card, { qrDataUrl, logo, photo });

  const filename = gymCardFileName(member, { gymName });
  doc.save(filename);
  return filename;
}
