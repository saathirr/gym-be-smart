import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { storageService } from '../../services/storageService';
import { initialsOf } from '../../utils/gymCard';

// Photo picker for the registration form.
//
// The picked file is held in memory and uploaded only on submit, because the
// storage path is namespaced by member id and that id does not exist until the
// member row has been inserted. Uploading on pick would leave an orphan file
// every time someone opens the form and changes their mind.
//
// When editing, the currently stored photo is shown and resolved to a signed
// URL so the staff member can see what is already on file before replacing it.

const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function PhotoField({ file, existingPath, existingName, onPick }) {
  const [preview, setPreview] = useState(null);
  const [existingUrl, setExistingUrl] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Local preview of the newly picked file. Object URLs are revoked on change so
  // a long registration session does not accumulate them.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    if (!existingPath) {
      setExistingUrl(null);
      return undefined;
    }

    storageService.getPhotoUrl(existingPath).then((url) => {
      if (!cancelled) setExistingUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [existingPath]);

  async function handleChange(event) {
    const picked = event.target.files?.[0];
    // Reset so choosing the same file twice still fires onChange.
    event.target.value = '';
    if (!picked) return;

    setError(null);

    if (picked.size > MAX_INPUT_BYTES) {
      setError('That photo is larger than 12 MB. Please choose a smaller one.');
      return;
    }
    if (picked.type && !['image/jpeg', 'image/png', 'image/webp'].includes(picked.type)) {
      setError('Please choose a JPG, PNG or WebP image.');
      return;
    }

    // Verified here rather than at upload time so a bad file is reported while
    // the person is still looking at the form, not after they press Register.
    try {
      await readAsDataUrl(picked);
    } catch (err) {
      setError(err.message);
      return;
    }

    onPick(picked);
  }

  const shown = preview || existingUrl;
  const isNew = Boolean(preview);

  return (
    <div className="rounded-xl bg-gym-850/40 p-3">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-xl bg-gym-800 flex items-center justify-center shrink-0 overflow-hidden ring-1 ring-white/10">
          {shown ? (
            <img src={shown} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-slate-400 text-lg font-semibold">
              {initialsOf(existingName)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-slate-300">
            Photo <span className="text-slate-500 font-normal">(optional)</span>
          </p>

          <div className="flex flex-wrap gap-2 mt-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={handleChange}
              className="hidden"
            />

            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={isNew || existingPath ? Camera : Upload}
              onClick={() => inputRef.current?.click()}
            >
              {isNew ? 'Change photo' : existingPath ? 'Replace photo' : 'Choose photo'}
            </Button>

            {isNew && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={Trash2}
                onClick={() => {
                  onPick(null);
                  setError(null);
                }}
              >
                Remove
              </Button>
            )}
          </div>

          <p className="text-[11px] text-slate-500 mt-2">
            {isNew
              ? 'Will be uploaded when you save.'
              : existingPath
                ? 'A photo is already on file. Replacing it keeps the current one until the new one saves.'
                : 'A clear, square headshot works best on the printed card.'}
          </p>

          {error && <p className="text-[11px] text-rose-400 mt-1">{error}</p>}
        </div>
      </div>
    </div>
  );
}
