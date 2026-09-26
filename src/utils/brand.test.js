import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  LOGO_SRC,
  LOGO_INTRINSIC_WIDTH,
  LOGO_INTRINSIC_HEIGHT,
  LOGO_ASPECT_RATIO,
  CLUB_DISPLAY_NAME,
} from './brand';

const publicDir = path.resolve(process.cwd(), 'public');
const logoPath = path.join(publicDir, LOGO_SRC);

describe('brand assets', () => {
  it('ships the logo inside public/ so Vite serves it from the site root', () => {
    expect(LOGO_SRC.startsWith('/')).toBe(true);
    expect(existsSync(logoPath)).toBe(true);
    expect(statSync(logoPath).size).toBeGreaterThan(0);
  });

  it('is exactly square, which is what makes the square render box safe', () => {
    expect(LOGO_INTRINSIC_WIDTH).toBe(LOGO_INTRINSIC_HEIGHT);
    expect(LOGO_ASPECT_RATIO).toBe(1);
  });

  it('exposes the club name for card and PDF rendering', () => {
    expect(CLUB_DISPLAY_NAME).toBe('BE SMART FITNESS CLUB');
  });
});
