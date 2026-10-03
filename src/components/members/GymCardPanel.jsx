import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, MessageCircle, ShieldAlert } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { buildGymCardData, buildWhatsAppMessage, gymCardFileName } from '../../utils/gymCard';
import { buildWhatsAppUrl, formatPhone, normalisePhone } from '../../utils/phone';
import { downloadGymCardPdf } from '../../lib/gymCardPdf';
import { storageService } from '../../services/storageService';
import { LOGO_SRC } from '../../utils/brand';
import { cn } from '../../utils/cn';

// The player's digital gym card.
//
// The card shows only what the front desk needs: who they are, which plan they
// are on, and the QR token. No NIC, no address, no phone, no date of birth -
// the card gets photographed and left on a desk, and the QR already resolves to
// the member record.

const CARD_ASPECT = '54 / 85.6';

// className is applied last and goes through tailwind-merge, so a caller can
// override max-w-sm with a narrower value without editing the card. The preview
// does exactly that: at the natural 24rem the 54:85.6 ratio makes the card about
// 609px tall, which does not fit a 768px laptop once the dialog header and footer
// are accounted for, so the preview narrows it rather than letting the dialog
// scroll a card the member has already seen.
function CardFace({ card, photoUrl = null, qrSize = 120, className }) {
  const live = card.membershipStatus === 'Active' || card.membershipStatus === 'Expiring';
  const initials = String(card.fullName || 'Member')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div
      className={cn(
        'w-full max-w-sm rounded-2xl overflow-hidden bg-white text-gray-900 shadow-2xl',
        className
      )}
      style={{ aspectRatio: CARD_ASPECT }}
    >
      <div className="bg-emerald-600 px-4 py-2.5 flex items-center gap-2.5">
        <img
          src={LOGO_SRC}
          alt=""
          className="w-9 h-9 rounded object-cover shrink-0"
          // The logo is a 640x640 JPEG with no alpha channel, so it needs an
          // explicit frame rather than a transparent one.
          style={{ backgroundColor: '#FFFFFF' }}
        />
        <div className="min-w-0">
          <p className="text-white font-bold text-xs leading-tight truncate">
            BE SMART FITNESS CLUB
          </p>
          <p className="text-white/80 text-[10px] leading-tight">Gym Membership Card</p>
        </div>
      </div>

      <div className="p-4 flex gap-3 h-[calc(100%-3.25rem)]">
        <div className="min-w-0 flex-1 flex gap-2.5">
          {/* Same box the PDF uses, so the preview matches the print. */}
          <div className="w-[3.4rem] h-[3.4rem] rounded-lg bg-gray-200 shrink-0 overflow-hidden flex items-center justify-center">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="w-full h-full object-cover"
                // The photo comes from a private signed URL that expires, so a
                // failed refresh must not show a broken-image icon on a card
                // that is about to be printed.
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <span className="text-[10px] font-bold text-gray-500">{initials}</span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="font-bold text-sm leading-tight truncate">{card.fullName}</p>
            <p className="text-[11px] text-gray-500">Member ID: {card.memberCode}</p>

            <div className="space-y-1.5 pt-1">
              <Row label="Membership" value={card.planName} />
              <Row
                label="Status"
                value={card.membershipStatus}
                className={live ? '' : 'text-amber-600 font-semibold'}
              />
              {card.validUntil && <Row label="Valid until" value={card.validUntil} />}
            </div>
          </div>
        </div>

        <div className="shrink-0 self-start">
          <div className="p-1 bg-white border border-gray-200 rounded-lg">
            <QRCodeSVG
              value={card.qrPayload}
              size={qrSize}
              level="M"
              // Matches the four-module quiet zone baked into the PDF's QR, so
              // the preview and the print behave the same way with a scanner.
              marginSize={2}
              // The QR is the front desk's only job on this card, so the encoded
              // value is the opaque token and nothing else.
              style={{ display: 'block' }}
            />
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 -mt-1">
        <p className="text-[9px] text-gray-400 border-t border-gray-100 pt-2">
          Show this QR code at the entrance.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, className }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[8px] uppercase tracking-wide text-gray-400 w-14 shrink-0">
        {label}
      </span>
      <span className={cn('text-[11px] truncate', className || 'text-gray-800')}>{value}</span>
    </div>
  );
}

/**
 * Gym card preview plus the two ways staff hand it over.
 *
 * WhatsApp cannot be given a file by a web page, so the flow is honest about it:
 * download the PDF, then open WhatsApp with the message already written, then
 * attach the file by hand. Pretending otherwise would produce a chat with no
 * card in it.
 */
export function GymCardPanel({ member, gymName, className }) {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  // Private bucket: the preview and the PDF both go through a short-lived
  // signed URL. The object path in members.avatar_url is never rendered
  // directly, and the bucket stays private.
  const [photoUrl, setPhotoUrl] = useState(null);

  // Hooks first: the early return for a missing card below must come after every
  // hook call, or the hook order changes between renders.
  useEffect(() => {
    const path = member?.avatar_url;
    if (!path) {
      setPhotoUrl(null);
      return undefined;
    }

    let cancelled = false;
    storageService.getPhotoUrl(path).then((url) => {
      if (!cancelled) setPhotoUrl(url || null);
    });

    return () => {
      cancelled = true;
    };
  }, [member?.avatar_url]);

  const card = buildGymCardData(member, { gymName });
  if (!card) return null;

  const whatsApp = normalisePhone(member.whatsapp_number || member.phone);
  const canShare = Boolean(whatsApp.isValid);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      // A fresh URL is signed at download time: the one used for the preview may
      // already have expired, and an expired URL would silently drop the photo
      // out of the printed card.
      const freshPhotoUrl = member.avatar_url
        ? await storageService.getPhotoUrl(member.avatar_url)
        : null;

      await downloadGymCardPdf(member, { gymName, photoUrl: freshPhotoUrl });
    } catch (err) {
      setError(err.message || 'The card could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(card.qrPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('The code could not be copied.');
    }
  }

  function handleWhatsApp() {
    const url = buildWhatsAppUrl(
      member.whatsapp_number || member.phone,
      buildWhatsAppMessage(member, { gymName })
    );
    if (!url) {
      setError('That number cannot be used for WhatsApp.');
      return;
    }
    // Opened in a new tab so the app is not navigated away from if WhatsApp
    // Web is unavailable on the desktop.
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      <div className={cn('space-y-3', className)}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Download} disabled={busy} onClick={handleDownload}>
            {busy ? 'Preparing...' : 'Download PDF'}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            icon={MessageCircle}
            disabled={!canShare}
            onClick={handleWhatsApp}
          >
            Send on WhatsApp
          </Button>

          <Button
            size="sm"
            variant="ghost"
            icon={copied ? Check : Copy}
            onClick={handleCopyCode}
          >
            {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>

        {!canShare && (
          <p className="text-xs text-amber-400 flex items-start gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              {whatsApp.reason || 'No WhatsApp number on file.'} Add a mobile number to send the
              card by WhatsApp.
            </span>
          </p>
        )}

        {canShare && (
          <p className="text-xs text-slate-500">
            WhatsApp opens with the message ready. Download the PDF first, then attach it to the
            chat.
          </p>
        )}

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-xs text-brand-gold-strong hover:underline"
        >
          Preview card
        </button>
      </div>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Gym Membership Card"
        className="w-[min(430px,94vw)] max-w-none"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              variant="ghost"
              size="sm"
              icon={ArrowLeft}
              onClick={() => setIsOpen(false)}
              className="w-full sm:w-auto"
            >
              Back
            </Button>

            <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
              <Button
                size="sm"
                icon={Download}
                disabled={busy}
                onClick={handleDownload}
                className="w-full sm:w-auto"
              >
                {busy ? 'Preparing...' : 'Download PDF'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={MessageCircle}
                disabled={!canShare}
                onClick={handleWhatsApp}
                className="w-full sm:w-auto"
              >
                Send on WhatsApp
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex justify-center">
            <CardFace card={card} photoUrl={photoUrl} qrSize={96} className="max-w-[310px]" />
          </div>

          <div className="text-xs text-slate-400 space-y-1">
            <p>
              File name: <span className="text-slate-300">{gymCardFileName(member, { gymName })}</span>
            </p>
            <p>WhatsApp: {formatPhone(member.whatsapp_number || member.phone)}</p>
            <p>
              The QR encodes only the member token, never the name, phone or NIC.
            </p>
          </div>

          {/* The WhatsApp button is disabled without a usable number, and a
              disabled button with no stated reason reads as a broken app. */}
          {!canShare && (
            <p className="text-xs text-amber-400 flex items-start gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{whatsApp.reason || 'No WhatsApp number on file.'}</span>
            </p>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

export { CardFace };
