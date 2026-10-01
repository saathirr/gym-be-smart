import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraStatusOverlay } from './CameraStatusOverlay';
import { detectCameraBlocker } from '../../utils/cameraSupport';

// Rendered to static markup rather than mounted in a DOM, so this needs no
// jsdom and still exercises the real component output.

const insecure = detectCameraBlocker({ isSecureContext: false });

describe('CameraStatusOverlay', () => {
  it('shows nothing while the camera is running, so the video stays clear', () => {
    expect(
      renderToStaticMarkup(
        <CameraStatusOverlay status="running" issue={insecure} onRetry={() => {}} onScanPhoto={() => {}} />
      )
    ).toBe('');
  });

  it('asks for the permission prompt while the camera is starting', () => {
    const html = renderToStaticMarkup(
      <CameraStatusOverlay status="starting" onRetry={() => {}} onScanPhoto={() => {}} />
    );

    expect(html).toContain('Starting the camera');
    expect(html).toContain('Allow camera access');
  });

  it('gives the plain-HTTP phone the HTTPS reason and the tunnel command', () => {
    const html = renderToStaticMarkup(
      <CameraStatusOverlay status="error" issue={insecure} onRetry={() => {}} onScanPhoto={() => {}} />
    );

    expect(html).toContain(insecure.title);
    expect(html).toContain('192.168');
    expect(html).toContain('cloudflared');
    // The photo route is the one fallback that works without a live camera.
    expect(html).toContain('Scan a photo');
    expect(html).toContain('Try again');
  });

  it('waits for the photo to be read instead of inviting another scan', () => {
    const html = renderToStaticMarkup(
      <CameraStatusOverlay
        status="error"
        issue={insecure}
        decodingPhoto
        onRetry={() => {}}
        onScanPhoto={() => {}}
      />
    );

    expect(html).toContain('Reading photo');
    expect(html).not.toContain('>Scan a photo<');
  });

  it('renders nothing for a stopped camera with no issue to explain', () => {
    expect(
      renderToStaticMarkup(<CameraStatusOverlay status="idle" onRetry={() => {}} onScanPhoto={() => {}} />)
    ).toBe('');
  });
});