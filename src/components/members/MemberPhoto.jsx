import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { storageService } from '../../services/storageService';
import { initialsOf } from '../../utils/gymCard';
import { cn } from '../../utils/cn';

// The player's photo, stored in the private member-photos bucket.
//
// avatar_url holds an object PATH, never a URL. The signed URL used to display
// it is short-lived and resolved on mount, so this component deliberately
// re-fetches when the path changes rather than caching the signed URL in state
// and showing a broken image an hour later.

const SIGNED_URL_REFRESH_MS = 4 * 60 * 1000;

function Avatar({ src, name, size = 'md' }) {
  const sizes = {
    sm: 'w-10 h-10 text-xs',
    md: 'w-16 h-16 text-base',
    lg: 'w-24 h-24 text-xl',
    xl: 'w-32 h-32 text-2xl',
  };

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn(
          sizes[size],
          'rounded-xl object-cover bg-gym-850 shrink-0 ring-1 ring-white/10'
        )}
      />
    );
  }

  // No photo is the normal case for most players, so the fallback is a
  // deliberate monogram rather than a broken image or a generic silhouette.
  return (
    <div
      aria-hidden="true"
      className={cn(
        sizes[size],
        'rounded-xl bg-gym-800 text-slate-400 flex items-center justify-center font-semibold shrink-0 ring-1 ring-white/10'
      )}
    >
      {initialsOf(name)}
    </div>
  );
}

/**
 * Displays and optionally replaces a member photo.
 *
 * @param {object} props
 * @param {string} props.photoPath   the stored object path (avatar_url)
 * @param {string} props.name        used for the monogram fallback
 * @param {string} props.memberId    required when `editable`
 * @param {boolean} props.editable   shows the upload and remove controls
 * @param {Function} props.onChanged called with the new path, or null on remove
 */
export function MemberPhoto({
  photoPath,
  name,
  memberId,
  editable = false,
  size = 'lg',
  className,
  onChanged,
}) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Resolve the path to a signed URL whenever the path changes, and refresh it
  // well before the signature lapses.
  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!photoPath) {
        setUrl(null);
        return;
      }

      setLoading(true);
      const signed = await storageService.getPhotoUrl(photoPath);
      if (cancelled) return;

      setUrl(signed);
      setLoading(false);
    }

    resolve();
    const timer = photoPath ? setInterval(resolve, SIGNED_URL_REFRESH_MS) : null;

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [photoPath]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires onChange.
    event.target.value = '';
    if (!file || !memberId) return;

    setBusy(true);
    setError(null);
    try {
      const nextPath = await storageService.replaceMemberPhoto({
        memberId,
        currentPath: photoPath,
        file,
      });
      onChanged?.(nextPath);
    } catch (err) {
      setError(err.message || 'The photo could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!memberId) return;

    setBusy(true);
    setError(null);
    try {
      // The service clears avatar_url before deleting the object, so the member
      // is never left pointing at a file that no longer exists.
      await storageService.removeMemberPhoto({ memberId, currentPath: photoPath });
      onChanged?.(null);
    } catch (err) {
      setError(err.message || 'The photo could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('flex items-start gap-4', className)}>
      <div className="relative">
        <Avatar src={url} name={name} size={size} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gym-950/60">
            <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
          </div>
        )}
        {editable && busy && !loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-gym-950/70">
            <Loader2 className="w-5 h-5 text-brand-gold animate-spin" />
          </div>
        )}
      </div>

      {editable && (
        <div className="space-y-2 min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFile}
            className="hidden"
          />

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={photoPath ? Camera : Upload}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {photoPath ? 'Replace photo' : 'Add photo'}
            </Button>

            {photoPath && (
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                disabled={busy}
                onClick={handleRemove}
              >
                Remove
              </Button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            {photoPath
              ? 'Stored privately. Only signed-in staff can view it.'
              : 'Optional. A JPG, PNG or WebP works best.'}
          </p>

          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
      )}

      {!editable && !photoPath && !loading && (
        <p className="text-xs text-slate-500 self-center">No photo on file</p>
      )}
    </div>
  );
}

export { Avatar };
