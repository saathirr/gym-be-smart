import { describe, it, expect } from 'vitest';
import {
  MEMBER_PHOTO_BUCKET,
  PHOTO_MAX_INPUT_BYTES,
  buildPhotoPath,
  isStoredPhotoPath,
  preparePhotoFile,
  storageService,
} from './storageService';

const MEMBER_ID = '3f1c9a20-7b4e-4d1a-9c33-2b8e5f0a1d44';

describe('MEMBER_PHOTO_BUCKET', () => {
  it('is the private bucket created by the phase 2 migration', () => {
    // Changing this silently would break every existing avatar_url, because the
    // stored value is a path relative to the bucket.
    expect(MEMBER_PHOTO_BUCKET).toBe('member-photos');
  });
});

describe('isStoredPhotoPath', () => {
  it('accepts the path shape uploadMemberPhoto writes', () => {
    expect(isStoredPhotoPath(`${MEMBER_ID}/mfk3n2-passport-photo.jpg`)).toBe(true);
    expect(isStoredPhotoPath('abc123/photo.jpg')).toBe(true);
  });

  it('rejects a full URL, so it is never passed to the storage client as a path', () => {
    expect(
      isStoredPhotoPath('https://project.supabase.co/storage/v1/object/public/member-photos/a/b.jpg')
    ).toBe(false);
    expect(isStoredPhotoPath('http://example.com/a/b.jpg')).toBe(false);
  });

  it('rejects traversal and absolute paths', () => {
    expect(isStoredPhotoPath('../../etc/passwd')).toBe(false);
    expect(isStoredPhotoPath('a/../../b.jpg')).toBe(false);
    expect(isStoredPhotoPath('/leading-slash.jpg')).toBe(false);
    expect(isStoredPhotoPath('a\\b.jpg')).toBe(false);
  });

  it('rejects values that are not strings or are empty', () => {
    expect(isStoredPhotoPath(null)).toBe(false);
    expect(isStoredPhotoPath(undefined)).toBe(false);
    expect(isStoredPhotoPath('')).toBe(false);
    expect(isStoredPhotoPath('   ')).toBe(false);
    expect(isStoredPhotoPath(42)).toBe(false);
    expect(isStoredPhotoPath({})).toBe(false);
  });

  it('rejects a path with no folder or an unexpected shape', () => {
    // Storage keys are always <folder>/<file>; a bare filename would land at
    // the bucket root and escape the per-member folder.
    expect(isStoredPhotoPath('photo.jpg')).toBe(false);
    expect(isStoredPhotoPath('a/b/c.jpg')).toBe(false);
  });

  it('is exposed on the service so callers can validate before hitting the API', () => {
    expect(storageService.isStoredPhotoPath).toBe(isStoredPhotoPath);
  });
});

describe('buildPhotoPath', () => {
  it('nests the object under the member id', () => {
    const path = buildPhotoPath(MEMBER_ID, 'passport.jpg', 1717171717171);
    expect(path.startsWith(`${MEMBER_ID}/`)).toBe(true);
    expect(path.endsWith('.jpg')).toBe(true);
  });

  it('gives every upload a distinct name, so a re-upload never overwrites', () => {
    const a = buildPhotoPath(MEMBER_ID, 'a.jpg', 1717171717171);
    const b = buildPhotoPath(MEMBER_ID, 'b.jpg', 1717171717172);
    expect(a).not.toBe(b);
  });

  it('produces the same path for the same id and instant, so it is testable', () => {
    expect(buildPhotoPath(MEMBER_ID, 'a.jpg', 1717171717171)).toBe(
      buildPhotoPath(MEMBER_ID, 'a.jpg', 1717171717171)
    );
  });

  it('sanitises the original filename', () => {
    const path = buildPhotoPath(MEMBER_ID, 'Passport Photo (1).JPG', 1717171717171);
    expect(path).toMatch(/^[\w-]+\/[\w]+-passport-photo-1\.jpg$/);
  });

  it('neutralises a traversal attempt in the filename', () => {
    const path = buildPhotoPath(MEMBER_ID, '../../../../etc/passwd', 1717171717171);
    expect(path.includes('..')).toBe(false);
    expect(path.includes('/etc')).toBe(false);
    expect(isStoredPhotoPath(path)).toBe(true);
  });

  it('falls back to a usable name when the filename has nothing safe in it', () => {
    expect(buildPhotoPath(MEMBER_ID, '***', 1717171717171)).toMatch(/-photo\.jpg$/);
    expect(buildPhotoPath(MEMBER_ID, '', 1717171717171)).toMatch(/-photo\.jpg$/);
    expect(buildPhotoPath(MEMBER_ID, null, 1717171717171)).toMatch(/-photo\.jpg$/);
  });

  it('lowercases the member id and strips anything unexpected', () => {
    const path = buildPhotoPath('AB-CD_EF', 'a.jpg', 1717171717171);
    expect(path.startsWith('ab-cd_ef/')).toBe(true);
  });

  it('caps an absurdly long member id so the key cannot blow past path limits', () => {
    const path = buildPhotoPath('x'.repeat(300), 'a.jpg', 1717171717171);
    const folder = path.split('/')[0];
    expect(folder.length).toBeLessThanOrEqual(64);
    expect(isStoredPhotoPath(path)).toBe(true);
  });

  it('refuses to build a path with no member id', () => {
    // Without a folder the object would land at the bucket root, where it
    // belongs to nobody and cannot be cleaned up per player.
    expect(() => buildPhotoPath('', 'a.jpg', 1717171717171)).toThrow(/member id/i);
    expect(() => buildPhotoPath(null, 'a.jpg', 1717171717171)).toThrow(/member id/i);
  });

  it('always builds a path its own validator accepts', () => {
    // The round trip that matters: a photo written by replaceMemberPhoto must
    // later be deletable by deletePhoto. buildPhotoPath and isStoredPhotoPath
    // are two separate regexes, and they drifted apart once already.
    const hostile = [
      MEMBER_ID,
      'AB-CD_EF',
      'MiXeD CaSe 123',
      'with.dots',
      'with spaces and (parens)',
      '../../escape',
      'a'.repeat(200),
      '!!!',
    ];
    const names = ['a.jpg', 'Passport Photo (1).PNG', '../../x', '***', '', null];

    for (const id of hostile) {
      for (const name of names) {
        let path;
        try {
          path = buildPhotoPath(id, name, 1717171717171);
        } catch {
          continue; // rejected outright, which is also safe
        }
        expect(isStoredPhotoPath(path), `${id} / ${name} -> ${path}`).toBe(true);
      }
    }
  });
});

describe('preparePhotoFile - rejections that need no browser', () => {
  it('rejects a missing file', async () => {
    await expect(preparePhotoFile(null)).rejects.toThrow(/no photo/i);
  });

  it('rejects a file over the size limit before doing any work', async () => {
    const huge = { size: PHOTO_MAX_INPUT_BYTES + 1, type: 'image/jpeg', name: 'a.jpg' };
    await expect(preparePhotoFile(huge)).rejects.toThrow(/12 MB/);
  });

  it('rejects a non-image type', async () => {
    const pdf = { size: 1024, type: 'application/pdf', name: 'a.pdf' };
    await expect(preparePhotoFile(pdf)).rejects.toThrow(/JPG, PNG or WebP/i);
  });

  it('falls back to the original file when the browser cannot process it', () => {
    // Node has no canvas, so this exercises the documented degradation path: a
    // legitimate image that cannot be re-encoded still uploads rather than
    // being rejected, which matters for a valid but exotic format.
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      const file = { size: 1024, type, name: 'a.jpg' };
      return expect(preparePhotoFile(file)).resolves.toBe(file);
    }
  });

  it('accepts a file with no reported MIME type', async () => {
    // Some Android pickers hand over a blob with an empty type. Rejecting on
    // that would block a real photo, so the type check is skipped instead.
    const file = { size: 1024, type: '', name: 'a.jpg' };
    await expect(preparePhotoFile(file)).resolves.toBe(file);
  });
});
