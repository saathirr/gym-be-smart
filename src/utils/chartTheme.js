// Recharts writes colours into SVG presentation attributes, where var()
// substitution is not dependable across browsers. These are therefore resolved
// to literal values in JS from the active theme rather than read from CSS.
//
// Series colours follow the club logo: gold leads, with emerald and sky as
// supporting hues. Gold is only 2.17:1 against white, so on the light theme
// the darker gold-deep step is used for any mark that has to be read as a
// thin line or a small legend swatch.
const PALETTES = {
  dark: {
    grid: '#1A2233',
    axis: '#94A3B8',
    tooltipBg: '#131A26',
    tooltipBorder: '#1A2233',
    gold: '#E2BC30',
    emerald: '#34D399',
    cyan: '#38BDF8',
  },
  light: {
    grid: '#EDE9D6',
    axis: '#5A6B82',
    tooltipBg: '#FFFFFF',
    tooltipBorder: '#E9E5D6',
    gold: '#6E5402',
    emerald: '#047857',
    cyan: '#0369A1',
  },
};

export function chartTheme(isDark) {
  return PALETTES[isDark ? 'dark' : 'light'];
}
