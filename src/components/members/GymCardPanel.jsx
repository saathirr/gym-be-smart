import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  ShieldAlert,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import {
  buildGymCardData,
  formatFirstLastName,
  gymCardFileName,
  gymCardImageFileName,
} from '../../utils/gymCard';
import { formatPhone, normalisePhone } from '../../utils/phone';
import { downloadGymCardPdf, shareGymCardPdfWhatsApp } from '../../lib/gymCardPdf';
import { downloadGymCardJpg, shareGymCardJpgWhatsApp } from '../../lib/gymCardImage';
import { shareGymCardWhatsApp } from '../../lib/gymCardShare';
import { storageService } from '../../services/storageService';
import { LOGO_SRC } from '../../utils/brand';
import { cn } from '../../utils/cn';

// CR80 Physical landscape ratio: 85.6mm width / 54mm height (~1.585)
const CARD_ASPECT = '85.6 / 54';

/**
 * Realistic CR80 landscape gym card face.
 * Matches the generated PDF & JPG layout, margins, and letter spacing.
 */
function CardFace({ card, photoUrl = null, qrSize = 74, className }) {
  const live = card.membershipStatus === 'Active' || card.membershipStatus === 'Expiring';
  const displayName = card.cardDisplayName || formatFirstLastName(card.fullName);
  const initials = String(displayName || 'Member')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div
      className={cn(
        'w-full max-w-[420px] rounded-xl overflow-hidden bg-white text-gray-900 shadow-xl border border-gray-200/80 flex flex-col justify-between select-none',
        className
      )}
      style={{ aspectRatio: CARD_ASPECT }}
    >
      {/* Header bar */}
      <div className="bg-emerald-600 px-3.5 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={LOGO_SRC}
            alt="Club Logo"
            className="w-7 h-7 rounded object-cover shrink-0 bg-white p-0.5"
          />
          <div className="min-w-0">
            <p className="text-white font-bold text-[11px] leading-tight tracking-wider uppercase truncate">
              BE SMART FITNESS CLUB
            </p>
            <p className="text-white/80 text-[9px] leading-tight tracking-wide">
              Gym Membership Card
            </p>
          </div>
        </div>
        <span
          className={cn(
            'text-[9px] font-semibold px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wider',
            live ? 'bg-emerald-500/30 text-white' : 'bg-amber-500/30 text-amber-100'
          )}
        >
          {card.membershipStatus}
        </span>
      </div>

      {/* Main content body */}
      <div className="px-3.5 py-1.5 flex items-center justify-between gap-2.5 flex-1 min-h-0">
        {/* Member Photo or Initials */}
        <div className="w-[52px] h-[52px] rounded-lg bg-gray-100 border border-gray-200 shrink-0 overflow-hidden flex items-center justify-center">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={displayName}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <span className="text-xs font-bold text-gray-500 tracking-wider">{initials}</span>
          )}
        </div>

        {/* Member details (First & Last Name only) */}
        <div className="min-w-0 flex-1 space-y-1">
          <div>
            <p className="font-bold text-[13px] leading-tight text-gray-900 tracking-wide truncate">
              {displayName}
            </p>
            <p className="text-[10px] text-gray-500 font-mono leading-tight">
              ID: {card.memberCode}
            </p>
          </div>

          <div className="space-y-0.5 pt-0.5 border-t border-gray-100">
            <Row label="Plan" value={card.planName} />
            {card.validUntil && <Row label="Valid" value={card.validUntil} />}
          </div>
        </div>

        {/* QR Code */}
        <div className="shrink-0">
          <div className="p-1 bg-white border border-gray-200 rounded-lg shadow-sm">
            <QRCodeSVG
              value={card.qrPayload}
              size={qrSize}
              level="M"
              marginSize={2}
              style={{ display: 'block' }}
            />
          </div>
        </div>
      </div>

      {/* Footer bar */}
      <div className="px-3.5 py-1.5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
        <p className="text-[8.5px] text-gray-400 tracking-tight">
          Show this QR code at the entrance.
        </p>
        <span className="text-[8.5px] text-gray-400 font-mono">CR80 ID</span>
      </div>
    </div>
  );
}

function Row({ label, value, className }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[7.5px] uppercase tracking-wider text-gray-400 w-9 shrink-0 font-medium">
        {label}
      </span>
      <span className={cn('text-[9.5px] truncate font-medium', className || 'text-gray-800')}>
        {value}
      </span>
    </div>
  );
}

/**
 * Gym Card Panel with Live Preview, JPG image download, PDF download, and WhatsApp sharing.
 */
export function GymCardPanel({ member, gymName, className }) {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [waNotice, setWaNotice] = useState(null);
  const [copied, setCopied] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(null);

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

  async function handleDownloadJpg() {
    setBusy('jpg');
    setError(null);
    try {
      const freshPhotoUrl = member.avatar_url
        ? await storageService.getPhotoUrl(member.avatar_url)
        : null;

      await downloadGymCardJpg(member, { gymName, photoUrl: freshPhotoUrl });
    } catch (err) {
      setError(err.message || 'The JPG card could not be generated.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadPdf() {
    setBusy('pdf');
    setError(null);
    try {
      const freshPhotoUrl = member.avatar_url
        ? await storageService.getPhotoUrl(member.avatar_url)
        : null;

      await downloadGymCardPdf(member, { gymName, photoUrl: freshPhotoUrl });
    } catch (err) {
      setError(err.message || 'The PDF card could not be created.');
    } finally {
      setBusy(null);
    }
  }

  async function handleWhatsApp() {
    setBusy('wa');
    setError(null);
    setWaNotice(null);
    try {
      const freshPhotoUrl = member.avatar_url
        ? await storageService.getPhotoUrl(member.avatar_url)
        : null;

      const result = await shareGymCardWhatsApp(member, {
        gymName,
        photoUrl: freshPhotoUrl,
      });

      if (result?.cancelled) {
        return;
      }

      if (result?.method === 'direct') {
        setWaNotice('Gym Card JPG & PDF sent directly to WhatsApp with welcome greeting!');
      } else if (result?.method === 'direct-jpg-with-pdf-download') {
        setWaNotice('Gym Card JPG shared to WhatsApp & PDF card downloaded! Both formats ready.');
      } else if (result?.method === 'web-fallback') {
        setWaNotice(
          'Card JPG & PDF downloaded! WhatsApp chat opened with your welcome message — simply attach (📎) the downloaded card files.'
        );
      }
    } catch (err) {
      setError(err.message || 'Failed to share gym card via WhatsApp.');
    } finally {
      setBusy(null);
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

  return (
    <>
      <div className={cn('space-y-4', className)}>
        {/* Main Action Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            variant="secondary"
            icon={Eye}
            onClick={() => setIsOpen(true)}
            className="font-medium"
          >
            Preview Card
          </Button>

          <Button
            size="sm"
            icon={ImageIcon}
            disabled={Boolean(busy)}
            onClick={handleDownloadJpg}
            className="font-medium"
          >
            {busy === 'jpg' ? 'Generating...' : 'Download JPG'}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            icon={FileText}
            disabled={Boolean(busy)}
            onClick={handleDownloadPdf}
            className="font-medium"
          >
            {busy === 'pdf' ? 'Preparing...' : 'Download PDF'}
          </Button>

          <Button
            size="sm"
            variant="primary"
            icon={MessageCircle}
            disabled={!canShare || Boolean(busy)}
            onClick={handleWhatsApp}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium border-emerald-500/30"
          >
            {busy === 'wa' ? 'Sending...' : 'Send on WhatsApp'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            icon={copied ? Check : Copy}
            onClick={handleCopyCode}
          >
            {copied ? 'Copied' : 'Copy Code'}
          </Button>
        </div>

        {/* WhatsApp Phone Status / Notice */}
        {!canShare && (
          <p className="text-xs text-amber-400 flex items-start gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>
              {whatsApp.reason || 'No mobile or WhatsApp number on file.'} Add a mobile number to enable direct WhatsApp sharing.
            </span>
          </p>
        )}

        {canShare && !waNotice && (
          <p className="text-xs text-slate-400">
            Click <strong className="text-emerald-400">Send on WhatsApp</strong> to send both <strong className="text-slate-200">JPG & PDF cards</strong> with the welcome greeting directly to{' '}
            <span className="font-mono text-slate-300">{formatPhone(member.whatsapp_number || member.phone)}</span>.
          </p>
        )}

        {waNotice && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            <span>{waNotice}</span>
          </div>
        )}

        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {/* Gym Card Preview Modal */}
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Gym Membership Card Preview"
        className="w-[min(540px,96vw)] max-w-none"
        footer={
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between w-full">
            <Button
              variant="secondary"
              size="sm"
              icon={ArrowLeft}
              onClick={() => setIsOpen(false)}
              className="w-full sm:w-auto font-medium"
            >
              Back to Member Profile
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon={ImageIcon}
                disabled={Boolean(busy)}
                onClick={handleDownloadJpg}
                className="w-full sm:w-auto"
              >
                {busy === 'jpg' ? 'Generating...' : 'Download JPG'}
              </Button>

              <Button
                size="sm"
                variant="secondary"
                icon={FileText}
                disabled={Boolean(busy)}
                onClick={handleDownloadPdf}
                className="w-full sm:w-auto"
              >
                {busy === 'pdf' ? 'Preparing...' : 'Download PDF'}
              </Button>

              <Button
                size="sm"
                variant="primary"
                icon={MessageCircle}
                disabled={!canShare || Boolean(busy)}
                onClick={handleWhatsApp}
                className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {busy === 'wa' ? 'Sending...' : 'WhatsApp Card'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Card Preview Container */}
          <div className="flex justify-center py-2">
            <CardFace card={card} photoUrl={photoUrl} qrSize={74} />
          </div>

          {/* Card & Member Info Details */}
          <div className="text-xs text-slate-400 space-y-1.5 p-3 rounded-lg bg-gym-900/60 border border-hairline">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Image File:</span>
              <span className="font-mono text-slate-200 text-[11px] truncate max-w-[260px]">
                {gymCardImageFileName(member, { gymName, ext: 'jpg' })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">PDF Document:</span>
              <span className="font-mono text-slate-200 text-[11px] truncate max-w-[260px]">
                {gymCardFileName(member, { gymName })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Card Display Name:</span>
              <span className="font-semibold text-slate-200">
                {card.cardDisplayName || formatFirstLastName(card.fullName)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Recipient WhatsApp:</span>
              <span className="font-mono text-slate-200">
                {formatPhone(member.whatsapp_number || member.phone)}
              </span>
            </div>
          </div>

          {waNotice && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span>{waNotice}</span>
            </div>
          )}

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

