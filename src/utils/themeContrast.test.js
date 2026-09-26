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

// The surfaces any text can land on: page background, card, and the inputs
// which reuse the page tone.
const SURFACES = ['gym-950', 'gym-900', 'gym-850'];

// Everything the app renders as a foreground colour.
const FOREGROUNDS = [
  'slate-100', 'slate-200', 'slate-300', 'slate-400', 'slate-500',
  'rose-300', 'rose-400', 'emerald-300', 'emerald-400',
  'amber-300', 'amber-400', 'sky-300', 'sky-400', 'violet-300', 'violet-400',
  'brand-cyan', 'brand-emerald', 'brand-violet', 'brand-amber', 'brand-rose',
];

const AA = 4.5;

describe('theme tokens', () => {
  it.each(Object.keys(THEMES))('%s theme defines every token', (name) => {
    const tokens = THEMES[name];
    const missing = [...SURFACES, ...FOREGROUNDS, 'edge', 'edge-strong'].filter(
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

  it('keeps the dark palette identical to the original hard-coded design', () => {
    // Guards the requirement that dark mode must look as it did. The two
    // exceptions are muted text shades that were already below WCAG AA in the
    // shipped dark theme and were nudged just far enough to pass:
    // slate-500 #64748B -> #74839A (was 4.03:1 on a card)
    // brand-violet #8B5CF6 -> #A78BFA (was 4.19:1 on gym-850)
    expect(dark['gym-950']).toEqual([7, 10, 15]);
    expect(dark['gym-900']).toEqual([11, 15, 23]);
    expect(dark['gym-800']).toEqual([22, 30, 46]);
    expect(dark['gym-700']).toEqual([31, 41, 55]);
    expect(dark.edge).toEqual([22, 30, 46]);
    expect(dark['edge-strong']).toEqual([31, 41, 55]);
    expect(dark['slate-100']).toEqual([241, 245, 249]);
    expect(dark['slate-500']).toEqual([116, 131, 154]);
    expect(dark['brand-cyan']).toEqual([14, 165, 233]);
  });

  it('orients each theme the right way round', () => {
    const lum = (t, k) => relativeLuminance(t[k]);

    // In both themes the card sits slightly brighter than the page behind it,
    // so the card reads as a raised surface.
    expect(lum(light, 'gym-900')).toBeGreaterThan(lum(light, 'gym-950'));
    expect(lum(dark, 'gym-900')).toBeGreaterThan(lum(dark, 'gym-950'));

    // Foreground ramps run from prominent to muted, in opposite directions.
    expect(lum(light, 'slate-100')).toBeLessThan(lum(light, 'slate-500'));
    expect(lum(dark, 'slate-100')).toBeGreaterThan(lum(dark, 'slate-500'));
  });

  it('keeps borders visible against the surfaces they sit on', () => {
    // WCAG sets no minimum for borders, and the two themes need different
    // floors. Dark cards are already separated from the page by the surface
    // step, so their border stays deliberately faint - that is the existing
    // design. On white a border is the only thing defining the card edge, so
    // it has to carry the separation itself.
    const FLOOR = { dark: 1.05, light: 1.3 };

    for (const [name, tokens] of Object.entries(THEMES)) {
      expect(contrast(tokens.edge, tokens['gym-900']), `${name} edge on card`).toBeGreaterThan(
        FLOOR[name]
      );
      expect(contrast(tokens.edge, tokens['gym-950']), `${name} edge on page`).toBeGreaterThan(
        FLOOR[name]
      );
      expect(
        contrast(tokens['edge-strong'], tokens['gym-900']),
        `${name} edge-strong on card`
      ).toBeGreaterThan(contrast(tokens.edge, tokens['gym-900']));
    }
  });
});
