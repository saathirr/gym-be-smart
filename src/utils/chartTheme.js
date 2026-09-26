// Recharts writes colours into SVG presentation attributes, where var()
// substitution is not dependable across browsers. These are therefore resolved
// to literal values in JS from the active theme rather than read from CSS.
//
// Dark values reproduce the previous hard-coded chart palette exactly.
const PALETTES = {
  dark: {
    grid: '#1F2937',
    axis: '#9CA3AF',
    tooltipBg: '#0B0F17',
    tooltipBorder: '#1F2937',
    emerald: '#10B981',
    cyan: '#0EA5E9',
  },
  light: {
    grid: '#E2E8F0',
    axis: '#64748B',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#CBD5E1',
    emerald: '#047857',
    cyan: '#0369A1',
  },
};

export function chartTheme(isDark) {
  return PALETTES[isDark ? 'dark' : 'light'];
}
