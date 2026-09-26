// Single source of truth for club branding assets.
//
// logo.jpg lives in /public so Vite serves it from the site root. The file is
// a 640x640, 24bpp JPEG (no alpha channel), so it must always be rendered
// inside a SQUARE box with object-contain. A non-square box would stretch it,
// and the opaque background means it needs a deliberate frame on dark surfaces.

export const LOGO_SRC = '/logo.jpg';

export const LOGO_INTRINSIC_WIDTH = 640;
export const LOGO_INTRINSIC_HEIGHT = 640;

// Exact 1:1. Consumers should size with a square Tailwind class (w-10 h-10).
export const LOGO_ASPECT_RATIO = LOGO_INTRINSIC_WIDTH / LOGO_INTRINSIC_HEIGHT;

export const CLUB_DISPLAY_NAME = 'BE SMART FITNESS CLUB';
