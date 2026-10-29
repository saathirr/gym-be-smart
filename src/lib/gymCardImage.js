import {
  buildGymCardData,
  buildWhatsAppMessage,
  formatFirstLastName,
  gymCardImageFileName,
  gymCardPixelHeight,
  gymCardPixelWidth,
  isMembershipLive,
} from '../utils/gymCard';
import { buildWhatsAppUrl } from '../utils/phone';
import { LOGO_SRC } from '../utils/brand';

/**
 * Loads an image from a URL or data URL and returns an HTMLImageElement.
 */
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Generates a high-resolution QR code data URL.
 */
async function renderQrDataUrl(payload) {
  if (!payload) return null;
  const QR = await import('qrcode');
  return QR.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 600,
    color: { dark: '#111827', light: '#FFFFFF' },
  });
}

/**
 * Helper to draw a rounded rectangle on a 2D canvas.
 */
function drawRoundRect(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Renders the Gym Card onto an off-screen HTML5 Canvas at 300 DPI (1011x638 px).
 */
export async function renderGymCardCanvas(
  member,
  { photoDataUrl = null, photoUrl = null, gymName } = {}
) {
  if (!member) throw new Error('There is no member to generate a card for.');
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('Canvas rendering is only available in browser environments.');
  }

  const card = buildGymCardData(member, { gymName });
  if (!card) throw new Error('There is no member to generate a card for.');

  const width = gymCardPixelWidth();
  const height = gymCardPixelHeight();

  const [qrDataUrl, logoImg, photoImg] = await Promise.all([
    renderQrDataUrl(card.qrPayload),
    loadImage(LOGO_SRC),
    photoDataUrl ? loadImage(photoDataUrl) : photoUrl ? loadImage(photoUrl) : Promise.resolve(null),
  ]);

  const qrImg = qrDataUrl ? await loadImage(qrDataUrl) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D rendering context.');

  const live = isMembershipLive(card.membershipStatus);
  const displayName = card.cardDisplayName || formatFirstLastName(card.fullName);

  // 1. Card Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // 2. Outer hairline border
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // 3. Header band (Emerald)
  const headerHeight = 132;
  ctx.fillStyle = '#16A34A';
  ctx.fillRect(0, 0, width, headerHeight);

  // Logo plate & image
  let textLeft = 40;
  if (logoImg) {
    const logoPlateSize = 92;
    const logoY = Math.round((headerHeight - logoPlateSize) / 2);
    ctx.fillStyle = '#FFFFFF';
    drawRoundRect(ctx, 36, logoY, logoPlateSize, logoPlateSize, 10);
    ctx.fill();

    const logoInner = 84;
    const logoInnerOffset = logoY + Math.round((logoPlateSize - logoInner) / 2);
    ctx.drawImage(logoImg, 40, logoInnerOffset, logoInner, logoInner);
    textLeft = 148;
  }

  // Header Typography
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('BE SMART FITNESS CLUB', textLeft, 58);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.font = '500 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  ctx.fillText('Gym Membership Card', textLeft, 96);

  // Status Badge in Header
  const badgeWidth = 146;
  const badgeHeight = 44;
  const badgeX = width - badgeWidth - 36;
  const badgeY = Math.round((headerHeight - badgeHeight) / 2);
  drawRoundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 22);
  ctx.fillStyle = live ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(card.membershipStatus.toUpperCase(), badgeX + badgeWidth / 2, badgeY + 28);
  ctx.textAlign = 'left';

  // 4. Photo Frame / Initials Placeholder (Left)
  const photoSize = 180;
  const photoX = 40;
  const photoY = 168;
  const photoRadius = 16;

  if (photoImg) {
    ctx.save();
    drawRoundRect(ctx, photoX, photoY, photoSize, photoSize, photoRadius);
    ctx.clip();
    ctx.drawImage(photoImg, photoX, photoY, photoSize, photoSize);
    ctx.restore();

    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 2;
    drawRoundRect(ctx, photoX, photoY, photoSize, photoSize, photoRadius);
    ctx.stroke();
  } else {
    drawRoundRect(ctx, photoX, photoY, photoSize, photoSize, photoRadius);
    ctx.fillStyle = '#F3F4F6';
    ctx.fill();
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 2;
    ctx.stroke();

    const initials = String(displayName || 'Member')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('');

    ctx.fillStyle = '#6B7280';
    ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(initials, photoX + photoSize / 2, photoY + photoSize / 2 + 18);
    ctx.textAlign = 'left';
  }

  // 5. Member Details (Middle)
  const infoX = 248;

  // First & Last Name
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Fit long name within available column
  const maxNameWidth = 470;
  let fittedName = displayName;
  while (ctx.measureText(fittedName).width > maxNameWidth && fittedName.length > 5) {
    fittedName = fittedName.slice(0, -2).trim() + '…';
  }
  ctx.fillText(fittedName, infoX, 222);

  // Member ID
  ctx.fillStyle = '#6B7280';
  ctx.font = '600 21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace';
  ctx.fillText(`MEMBER ID: ${card.memberCode}`, infoX, 260);

  // Separator rule
  ctx.strokeStyle = '#F3F4F6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(infoX, 282);
  ctx.lineTo(730, 282);
  ctx.stroke();

  // Entitlement Rows
  const rows = [
    ['MEMBERSHIP', card.planName, '#1F2937', false],
    ['STATUS', card.membershipStatus, live ? '#16A34A' : '#D97706', true],
    card.validUntil ? ['VALID UNTIL', card.validUntil, '#1F2937', false] : null,
  ].filter(Boolean);

  let currentY = 325;
  for (const [label, val, color, isBold] of rows) {
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(label, infoX, currentY);

    ctx.fillStyle = color;
    ctx.font = `${isBold ? 'bold' : '600'} 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(val, infoX + 160, currentY);
    currentY += 46;
  }

  // 6. QR Code Block (Right)
  const qrBoxSize = 220;
  const qrBoxX = 750;
  const qrBoxY = 168;

  drawRoundRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 16);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (qrImg) {
    const qrInner = 200;
    const qrInnerOffset = qrBoxY + Math.round((qrBoxSize - qrInner) / 2);
    ctx.drawImage(qrImg, qrBoxX + 10, qrInnerOffset, qrInner, qrInner);
  } else {
    ctx.fillStyle = '#D97706';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QR Unavailable', qrBoxX + qrBoxSize / 2, qrBoxY + qrBoxSize / 2);
    ctx.textAlign = 'left';
  }

  // 7. Footer
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(40, 560);
  ctx.lineTo(width - 40, 560);
  ctx.stroke();

  ctx.fillStyle = '#9CA3AF';
  ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Show this QR code at the entrance.', 40, 598);

  ctx.font = '600 16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('CR80 ID', width - 40, 598);
  ctx.textAlign = 'left';

  return canvas;
}

/**
 * Creates the high-resolution JPG image Blob, File, dataUrl, and filename.
 */
export async function createGymCardJpg(
  member,
  options = {}
) {
  const canvas = await renderGymCardCanvas(member, options);
  const filename = gymCardImageFileName(member, { gymName: options.gymName, ext: 'jpg' });

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to generate JPEG blob from canvas.'));
      },
      'image/jpeg',
      0.95
    );
  });

  const file = new File([blob], filename, { type: 'image/jpeg' });
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

  return { canvas, blob, file, filename, dataUrl };
}

/**
 * Downloads the Gym Card as a high-resolution JPG image file.
 */
export async function downloadGymCardJpg(
  member,
  options = {}
) {
  const { blob, filename } = await createGymCardJpg(member, options);
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 4000);
  return filename;
}

/**
 * Directly shares the Gym Card JPG image to WhatsApp.
 *
 * In mobile/tablet browsers with Web Share API:
 *   Shares the JPEG image file directly into WhatsApp, displaying it as an instant photo message!
 *
 * Fallback (WhatsApp Web on desktop):
 *   Auto-downloads the .jpg card to the computer and opens the member's WhatsApp chat with the greeting message.
 */
export async function shareGymCardJpgWhatsApp(
  member,
  { photoDataUrl = null, photoUrl = null, gymName } = {}
) {
  const { blob, file, filename } = await createGymCardJpg(member, {
    photoDataUrl,
    photoUrl,
    gymName,
  });
  const message = buildWhatsAppMessage(member, { gymName });

  // 1. Direct Web Share API (Mobile / supported desktop browsers)
  if (
    typeof navigator !== 'undefined' &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: `${gymName || 'Be Smart Fitness Club'} - Gym Card`,
        text: message,
      });
      return { success: true, method: 'direct', filename };
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
    }
  }

  // 2. Seamless WhatsApp Web fallback
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 4000);

  const waUrl = buildWhatsAppUrl(
    member.whatsapp_number || member.phone,
    `${message}\n\n📷 (Official Gym Card Image is attached)`
  );
  if (waUrl) {
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  return { success: true, method: 'web-fallback', filename };
}
