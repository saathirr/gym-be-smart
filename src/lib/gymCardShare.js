// Directly shares both the Gym Card JPG and PDF to WhatsApp with the official welcome greeting message.
//
// Designed to deliver a seamless experience on both Phone and PC:
// 1. Mobile (Android / iOS) & supported Desktop (Windows / macOS Web Share):
//    Shares both the high-res JPG card image and the PDF document file together directly
//    to WhatsApp with the welcome greeting message.
// 2. PC / Desktop (WhatsApp Web fallback):
//    Automatically downloads BOTH the JPG image and PDF card to the user's computer,
//    and opens the member's WhatsApp chat with the pre-filled welcome message.

import { createGymCardPdf } from './gymCardPdf';
import { createGymCardJpg } from './gymCardImage';
import { buildWhatsAppMessage } from '../utils/gymCard';
import { buildWhatsAppUrl } from '../utils/phone';

/**
 * Triggers a silent download of a Blob file in the browser.
 */
export function triggerBrowserDownload(blob, filename) {
  if (typeof window === 'undefined' || !blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Directly shares both the Gym Card JPG image and PDF document to WhatsApp.
 *
 * @param {object} member
 * @param {object} [options]
 * @param {string} [options.photoDataUrl]
 * @param {string} [options.photoUrl]
 * @param {string} [options.gymName]
 * @returns {Promise<{ success: boolean, method: string, files: string[], cancelled?: boolean }>}
 */
export async function shareGymCardWhatsApp(
  member,
  { photoDataUrl = null, photoUrl = null, gymName } = {}
) {
  if (!member) {
    throw new Error('No member provided for WhatsApp gym card sharing');
  }

  // Generate both the JPG image and the PDF document concurrently for maximum speed
  const [jpgResult, pdfResult] = await Promise.all([
    createGymCardJpg(member, { photoDataUrl, photoUrl, gymName }),
    createGymCardPdf(member, { photoDataUrl, photoUrl, gymName }),
  ]);

  const message = buildWhatsAppMessage(member, { gymName });

  // 1. Direct Web Share API (Mobile phones, tablets, supported desktop OS)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    // Attempt to share both JPG and PDF files together in one share sheet
    if (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [jpgResult.file, pdfResult.file] })
    ) {
      try {
        await navigator.share({
          files: [jpgResult.file, pdfResult.file],
          title: `${gymName || 'Be Smart Fitness Club'} - Gym Membership Card`,
          text: message,
        });
        return {
          success: true,
          method: 'direct',
          files: [jpgResult.filename, pdfResult.filename],
        };
      } catch (err) {
        if (err?.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
        // Fall through to single-file share or web fallback if combined share threw
      }
    }

    // If the OS share target restricts sharing different MIME types together,
    // share the JPG directly (WhatsApp reliably displays image files in chat) and download the PDF
    if (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [jpgResult.file] })
    ) {
      try {
        await navigator.share({
          files: [jpgResult.file],
          title: `${gymName || 'Be Smart Fitness Club'} - Gym Membership Card`,
          text: message,
        });
        // Download the PDF card as well so member/staff has both formats
        triggerBrowserDownload(pdfResult.blob, pdfResult.filename);
        return {
          success: true,
          method: 'direct-jpg-with-pdf-download',
          files: [jpgResult.filename, pdfResult.filename],
        };
      } catch (err) {
        if (err?.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
      }
    }
  }

  // 2. PC / Desktop / WhatsApp Web fallback:
  // Auto-download BOTH the JPG image and PDF card to the user's computer
  triggerBrowserDownload(jpgResult.blob, jpgResult.filename);
  await new Promise((resolve) => setTimeout(resolve, 300));
  triggerBrowserDownload(pdfResult.blob, pdfResult.filename);

  // Open WhatsApp Web with the member's chat and greeting message pre-filled
  const waUrl = buildWhatsAppUrl(
    member.whatsapp_number || member.phone,
    message
  );
  if (waUrl && typeof window !== 'undefined') {
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  }

  return {
    success: true,
    method: 'web-fallback',
    files: [jpgResult.filename, pdfResult.filename],
  };
}
