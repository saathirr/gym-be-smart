import { describe, expect, it } from 'vitest';
import {
  HTTPS_TUNNEL_COMMANDS,
  cameraOptionLabel,
  describeCameraError,
  detectCameraBlocker,
  pickPreferredCameraId,
} from './cameraSupport';

describe('detectCameraBlocker', () => {
  it('allows the camera when the page is secure and the API exists', () => {
    expect(detectCameraBlocker({ isSecureContext: true, hasMediaDevices: true })).toBeNull();
  });

  it('explains the plain-HTTP phone case and how to get around it', () => {
    const issue = detectCameraBlocker({ isSecureContext: false, hasMediaDevices: true });

    expect(issue.code).toBe('insecure-context');
    expect(issue.detail).toMatch(/192\.168/i);
    expect(issue.hint).toContain(HTTPS_TUNNEL_COMMANDS[0]);
    expect(issue.hint).toContain(HTTPS_TUNNEL_COMMANDS[1]);
  });

  it('reports a missing camera API before a missing camera', () => {
    expect(
      detectCameraBlocker({ isSecureContext: true, hasMediaDevices: false }).code
    ).toBe('unsupported');
  });

  it('defaults to a healthy browser when nothing is passed', () => {
    expect(detectCameraBlocker()).toBeNull();
  });
});

describe('describeCameraError', () => {
  it('routes the insecure-context wording to the HTTPS fix, not the permission fix', () => {
    const issue = describeCameraError({
      name: 'NotSupportedError',
      message:
        'NotAllowedError: The request is not allowed by the user agent or the platform in the current context',
    });

    expect(issue.code).toBe('insecure-context');
  });

  it('names the permission fix for a declined prompt', () => {
    expect(describeCameraError({ name: 'NotAllowedError' }).code).toBe('permission-denied');
    expect(describeCameraError({ name: 'SecurityError' }).code).toBe('permission-denied');
  });

  it('separates an absent camera from a busy one', () => {
    expect(describeCameraError({ name: 'NotFoundError' }).code).toBe('no-camera');
    expect(describeCameraError({ name: 'NotReadableError' }).code).toBe('camera-busy');
  });

  it('offers another camera for a rejected constraint', () => {
    const issue = describeCameraError({ name: 'OverconstrainedError' });
    expect(issue.code).toBe('camera-unsupported');
    expect(issue.hint).toMatch(/different camera/i);
  });

  it('always returns a title, detail and hint, even for an unknown error', () => {
    const issue = describeCameraError(new Error('something odd'));

    expect(issue.title).toBeTruthy();
    expect(issue.detail).toBe('something odd');
    expect(issue.hint).toBeTruthy();
  });

  it('survives a thrown string with no error shape at all', () => {
    expect(describeCameraError('boom').title).toBeTruthy();
  });
});

describe('pickPreferredCameraId', () => {
  it('prefers the rear lens when a phone exposes both', () => {
    expect(
      pickPreferredCameraId([
        { id: 'front', label: 'Front camera' },
        { id: 'back', label: 'Back camera' },
      ])
    ).toBe('back');
  });

  it('falls back to the first device on a single-webcam PC', () => {
    expect(pickPreferredCameraId([{ id: 'usb', label: 'Integrated Webcam' }])).toBe('usb');
  });

  it('returns nothing when no device is usable', () => {
    expect(pickPreferredCameraId([])).toBe('');
    expect(pickPreferredCameraId(null)).toBe('');
    expect(pickPreferredCameraId([{ id: '', label: 'x' }])).toBe('');
  });

  it('returns nothing when the browser hides every label', () => {
    expect(pickPreferredCameraId([{ id: 'a', label: '' }, { id: 'b', label: '' }])).toBe('');
  });
});

describe('cameraOptionLabel', () => {
  it('uses the real name when the browser has given one', () => {
    expect(cameraOptionLabel({ label: 'Back camera' })).toBe('Back camera');
  });

  it('marks the selfie lens so it is not opened by mistake', () => {
    expect(cameraOptionLabel({ label: 'User Front' })).toMatch(/^Front camera/);
  });

  it('numbers cameras whose labels are hidden until permission is granted', () => {
    expect(cameraOptionLabel({ label: '' }, 1)).toBe(
      'Camera 2 (name hidden until permission is granted)'
    );
  });
});