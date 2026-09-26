import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Parses the shipped stylesheet rather than re-declaring the palette, so this
// suite can never pass while the real CSS regresses.
const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

function parseBlock(selector) {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Could not find "${selector}" block in index.css`);

  const tokens = {};
  for (const [, name, r, g, b] of match[1].matchAll(
    /--([\w-]+):\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*;/g
  )) {
    tokens[name] = [Number(r), Number(g), Number(b)];
  }
  return tokens;
}

const light = parseBlock(':root');
const dark = parseBlock('\\.dark');

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { light, dark };

// The surfaces any text can land on. gym-950 is the page, gym-900 the card,
// and gym-850 the warm inset used by inputs and table headers.
const SURFACES = ['gym-950', 'gym-900', 'gym-850'];

// Everything the app renders as a foreground colour. brand-gold is excluded on
// purpose: it is the logo fill colour, only 2.17:1 on white, and must never
// carry text. The text-safe steps are brand-gold-strong and brand-gold-deep.
const FOREGROUNDS = [
  'slate-100', 'slate-200', 'slate-300', 'slate-400', 'slate-500',
  'rose-300', 'rose-400', 'emerald-300', 'emerald-400',
  'amber-300', 'amber-400', 'sky-300', 'sky-400', 'violet-300', 'violet-400',
  'brand-cyan', 'brand-emerald', 'brand-violet', 'brand-amber', 'brand-rose',
  'brand-gold-strong', 'brand-gold-deep',
];

const AA = 4.5;

describe('theme tokens', () => {
  it.each(Object.keys(THEMES))('%s theme defines every token', (name) => {
    const tokens = THEMES[name];
    const missing = [...SURFACES, ...FOREGROUNDS, 'hairline', 'brand-gold'].filter(
      (token) => !tokens[token]
    );
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(THEMES))(
    '%s theme keeps all foreground text at WCAG AA on every surface',
    (name) => {
      const tokens = THEMES[name];
      const failures = [];

      for (const fg of FOREGROUNDS) {
        for (const surface of SURFACES) {
          const ratio = contrast(tokens[fg], tokens[surface]);
          if (ratio < AA) {
            failures.push(`${fg} on ${surface} = ${ratio.toFixed(2)}:1`);
          }
        }
      }

      expect(failures).toEqual([]);
    }
  );

  it('keeps the dark page as the near-black the original design used', () => {
    // The night theme keeps its identity. The only deliberate change is the
    // card surface, lifted from #0B0F17 so it stays visible now that the
    // border and the drop shadow are both gone.
    expect(dark['gym-950']).toEqual([7, 10, 15]);
    expect(dark['gym-900']).toEqual([19, 26, 38]);
    expect(dark['gym-800']).toEqual([33, 43, 62]);
    expect(dark['gym-700']).toEqual([44, 56, 80]);
    expect(dark['slate-100']).toEqual([241, 245, 249]);
    expect(dark.hairline).toEqual([30, 39, 56]);
  });

  it('uses the logo gold sampled from public/logo.jpg', () => {
    // #D3AC11 is 68% of the chromatic pixels in the shipped logo.
    expect(light['brand-gold']).toEqual([211, 172, 17]);
  });

  it('keeps the logo gold out of small-text duty', () => {
    // brand-gold is a fill. If it ever creeps above the AA floor on white it
    // is being used as text somewhere and needs the text-safe step instead.
    const onWhite = contrast(light['brand-gold'], light['gym-950']);
    expect(onWhite).toBeLessThan(AA);

    // Dark type on the gold fill is what the primary button uses.
    expect(contrast(light['brand-ink'], light['brand-gold'])).toBeGreaterThan(AA);
  });

  it('orients each theme the right way round', () => {
    const lum = (t, k) => relativeLuminance(t[k]);

    // In both themes the card sits brighter than the page behind it.
    expect(lum(light, 'gym-900')).toBeGreaterThanOrEqual(lum(light, 'gym-950'));
    expect(lum(dark, 'gym-900')).toBeGreaterThan(lum(dark, 'gym-950'));

    // Foreground ramps run from prominent to muted, in opposite directions.
    expect(lum(light, 'slate-100')).toBeLessThan(lum(light, 'slate-500'));
    expect(lum(dark, 'slate-100')).toBeGreaterThan(lum(dark, 'slate-500'));
  });

  it('keeps cards separable from the page now that borders are gone', () => {
    // With no border and no visible shadow in dark mode, the only thing
    // defining a card edge is the surface step. In light mode the card and
    // the page are both pure white, so the separation is carried entirely by
    // the elevation shadow and this test instead guards that the shadow token
    // exists and is not a no-op.
    expect(contrast(dark['gym-900'], dark['gym-950'])).toBeGreaterThan(1.05);

    const lightShadow = css.match(/--shadow-card:\s*([^;]+);/);
    const darkBlock = css.match(/\.dark\s*\{[^}]*\}/)[0];
    const darkShadow = darkBlock.match(/--shadow-card:\s*([^;]+);/);
    expect(lightShadow).not.toBeNull();
    expect(darkShadow).not.toBeNull();
    // Light gets a real drop shadow; dark is deliberately transparent.
    expect(lightShadow[1]).toMatch(/rgba?\(/);
    expect(darkShadow[1]).toMatch(/0 0 0 0/);
  });

  it('keeps the hairline faint enough to read as a row rule, not a box', () => {
    for (const [name, tokens] of Object.entries(THEMES)) {
      const ratio = contrast(tokens.hairline, tokens['gym-900']);
      expect(ratio, `${name} hairline on card`).toBeGreaterThan(1.02);
      expect(ratio, `${name} hairline on card`).toBeLessThan(2.2);
    }
  });
});
