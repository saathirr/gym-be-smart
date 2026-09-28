import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

// Member photos in the private `member-photos` bucket.
//
// Two rules govern everything in this file:
//
//   1. members.avatar_url stores an object PATH like
//      `<member-id>/1712ab34-passport.jpg`, never a URL. The bucket is private,
//      so a stored public URL would 404 the moment the bucket policy tightened,
//      and a signed URL stored in the column would silently expire. Paths are
//      stable; the signature is resolved per request.
//
//   2. Photos are resized in the browser before upload. A modern phone camera
//      produces 4-8 MB files; storing those for every player is pointless when
//      the largest use is a 300px avatar and a 25mm print on the gym card.

export const MEMBER_PHOTO_BUCKET = 'member-photos';

// Short enough that a stolen link dies quickly, long enough to survive a page
// of scrolling and a slow connection.
export const PHOTO_URL_TTL_SECONDS = 300;

// Long edge of the stored image. Comfortably above the 300dpi gym-card print
// size and the largest avatar slot in the UI, at a fraction of the bytes.
const PHOTO_MAX_EDGE = 1024;

// What a front-desk iPad will realistically hand us. Anything larger is a
// mistake or a different file, and rejecting it early is clearer than an
// opaque upload timeout later.
export const PHOTO_MAX_INPUT_BYTES = 12 * 1024 * 1024;

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// A path is only ever `<safe-folder>/<safe-file>`. The folder character set here
// is exactly the one isStoredPhotoPath() accepts, so a folder this module builds
// can never be rejected by its own validator later. The file half of the
// validator is deliberately more permissive than the writer, so an object
// placed there by any other tool can still be deleted.
const SAFE_FOLDER = /[^a-z0-9_-]/g;

export function isStoredPhotoPath(value) {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path) return false;
  if (path.includes('..') || path.startsWith('/') || path.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
  return /^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(path);
}

// 'Passport Photo (1).JPG' -> 'passport-photo-1.jpg'
function safeFileStem(originalName) {
  const name = String(originalName || 'photo')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return name || 'photo';
}

// A new object name per upload. Re-uploading a photo overwrites nothing, so the
// old file can be deleted after the column is repointed and a cached signed URL
// for the previous photo can never serve the new image.
export function buildPhotoPath(memberId, originalName, now = Date.now()) {
  const folder = String(memberId || '')
    .trim()
    .toLowerCase()
    .replace(SAFE_FOLDER, '')
    .slice(0, 64);

  if (!folder) throw new Error('A member id is required before the photo can be stored.');

  const stamp = now.toString(36);
  return `${folder}/${stamp}-${safeFileStem(originalName)}.jpg`;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    image.src = url;
  });
}

/**
 * Downscale and re-encode a picked image to JPEG.
 *
 * Always re-encodes rather than passing the original through: it strips EXIF
 * (which carries GPS coordinates from a phone camera and would be stored in a
 * private bucket alongside the player's address) and drops any alpha channel,
 * which the opaque club logo background would otherwise show through.
 *
 * Returns the original file untouched if the browser cannot process it, so a
 * valid but exotic image still uploads instead of being rejected outright.
 */
export async function preparePhotoFile(file) {
  if (!file) throw new Error('No photo was selected.');

  if (file.size > PHOTO_MAX_INPUT_BYTES) {
    throw new Error('That photo is larger than 12 MB. Please choose a smaller one.');
  }

  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    throw new Error('Please choose a JPG, PNG or WebP image.');
  }

  let image;
  try {
    image = await loadImage(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return file;

  // Flatten onto white: JPEG has no transparency, and without this a PNG with
  // transparency would come out with black edges.
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.82);
  });
  if (!blob) return file;

  return new File([blob], `${safeFileStem(file.name)}.jpg`, { type: 'image/jpeg' });
}

function bucket() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured, so photos cannot be stored.');
  }
  return supabase.storage.from(MEMBER_PHOTO_BUCKET);
}

export const storageService = {
  isStoredPhotoPath,

  /** Uploads a picked photo and returns the path to store in avatar_url. */
  async uploadMemberPhoto({ memberId, file } = {}) {
    const prepared = await preparePhotoFile(file);
    const path = buildPhotoPath(memberId, prepared.name || file?.name);

    const { error } = await bucket().upload(path, prepared, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      // A collision means two uploads in the same millisecond, which the
      // base36 timestamp makes vanishingly unlikely. Overwriting would be the
      // wrong failure mode here, so surface it instead.
      upsert: false,
    });

    if (error) throw toMessage(error, 'The photo could not be uploaded.');
    return path;
  },

  /**
   * Resolves a stored path to a short-lived signed URL for display.
   *
   * Returns null for a member with no photo, and for a value that is not a
   * path. Legacy rows holding a bare hostname, or an already-public URL, come
   * back null rather than being passed to the storage API as a path.
   */
  async getPhotoUrl(path, { expiresIn = PHOTO_URL_TTL_SECONDS } = {}) {
    if (!isStoredPhotoPath(path)) return null;

    const { data, error } = await bucket().createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  },

  /**
   * Resolves many stored paths to signed URLs in ONE request.
   *
   * The members list renders up to 200 rows. Calling getPhotoUrl per row would
   * fire 200 storage requests every time the list is filtered or re-sorted, so
   * the list uses this instead. Paths that are not stored paths are dropped, and
   * a member with no photo is simply absent from the returned map.
   */
  async getPhotoUrls(paths, { expiresIn = PHOTO_URL_TTL_SECONDS } = {}) {
    const valid = [...new Set((paths || []).filter(isStoredPhotoPath))];
    if (valid.length === 0) return {};

    const { data, error } = await bucket().createSignedUrls(valid, expiresIn);
    if (error || !Array.isArray(data)) return {};

    const urls = {};
    for (const entry of data) {
      if (entry?.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
    }
    return urls;
  },

  /** Removes an object. Used to clear a photo or to tidy up after a re-upload. */
  async deletePhoto(path) {
    if (!isStoredPhotoPath(path)) return false;

    const { error } = await bucket().remove([path]);
    if (error) throw toMessage(error, 'The photo could not be removed.');
    return true;
  },

  /**
   * Clears a member's photo.
   *
   * The column is repointed at null BEFORE the object is deleted, for the same
   * reason as replaceMemberPhoto: a member whose avatar_url points at a deleted
   * object renders a broken image everywhere, whereas a leftover object is
   * invisible and can be reaped later.
   */
  async removeMemberPhoto({ memberId, currentPath } = {}) {
    if (!memberId) return null;

    const { error } = await supabase
      .from('members')
      .update({ avatar_url: null })
      .eq('id', memberId);

    if (error) throw toMessage(error, 'The photo could not be removed.');

    if (isStoredPhotoPath(currentPath)) {
      await this.deletePhoto(currentPath).catch(() => {});
    }

    return null;
  },

  /**
   * Swaps in a new photo: upload, repoint the column, then delete the old
   * object.
   *
   * The order matters. Repointing before uploading would leave the member with
   * a dangling path if the upload failed; deleting the old object first would
   * leave them with no photo at all if the repoint failed. Doing it in this
   * order means the worst case is an orphaned file, which is invisible to
   * everyone and cheap to reap, rather than a missing avatar.
   */
  async replaceMemberPhoto({ memberId, currentPath, file } = {}) {
    const nextPath = await this.uploadMemberPhoto({ memberId, file });

    const { error } = await supabase
      .from('members')
      .update({ avatar_url: nextPath })
      .eq('id', memberId);

    if (error) {
      // The column still points at the old photo, which is still valid. Clean
      // up the object we just orphaned so a failed save does not accumulate
      // files, then report the failure.
      await this.deletePhoto(nextPath).catch(() => {});
      throw toMessage(error, 'The photo could not be saved.');
    }

    if (isStoredPhotoPath(currentPath) && currentPath !== nextPath) {
      await this.deletePhoto(currentPath).catch(() => {});
    }

    return nextPath;
  },
};
