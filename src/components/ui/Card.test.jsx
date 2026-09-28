import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardTitle } from './Card';
import { CalendarDays } from 'lucide-react';

// Rendered to static markup rather than mounted in a DOM, so this needs no
// jsdom and still exercises the real component output.

describe('CardTitle', () => {
  it('renders the heading text on its own when no icon is passed', () => {
    const html = renderToStaticMarkup(<CardTitle>Attendance</CardTitle>);

    expect(html).toContain('Attendance');
    expect(html).not.toContain('<svg');
  });

  it('renders the icon before the title when one is passed', () => {
    const withIcon = renderToStaticMarkup(
      <CardTitle icon={CalendarDays}>Attendance</CardTitle>
    );
    const withoutIcon = renderToStaticMarkup(<CardTitle>Attendance</CardTitle>);

    expect(withIcon).toContain('<svg');
    // The icon comes first, so the text is not pushed to the left of it.
    expect(withIcon.indexOf('<svg')).toBeLessThan(withIcon.indexOf('Attendance'));
    // And it is genuinely additive.
    expect(withIcon.length).toBeGreaterThan(withoutIcon.length);
  });

  it('hides the decorative icon from assistive technology', () => {
    const html = renderToStaticMarkup(<CardTitle icon={CalendarDays}>Attendance</CardTitle>);

    // The heading text alone must describe the section.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    // The icon must not be the only thing carrying meaning, so it gets no role.
    expect(html).not.toContain('role="img"');
  });

  it('keeps a real heading element so the page outline is unchanged', () => {
    const html = renderToStaticMarkup(<CardTitle icon={CalendarDays}>Attendance</CardTitle>);

    expect(html.startsWith('<h3')).toBe(true);
    expect(html).toContain('Attendance');
  });

  it('preserves the existing layout classes and accepts overrides', () => {
    const plain = renderToStaticMarkup(<CardTitle>Attendance</CardTitle>);
    const customised = renderToStaticMarkup(
      <CardTitle
        className="text-sm"
        icon={CalendarDays}
        iconClassName="w-3 h-3 text-rose-400"
      >
        Attendance
      </CardTitle>
    );

    // Unchanged usages keep the original classes.
    expect(plain).toContain('text-lg');
    expect(plain).toContain('flex items-center gap-2');
    expect(customised).toContain('text-sm');
    expect(customised).toContain('text-rose-400');
    // The icon is prevented from being squashed by a long title.
    expect(customised).toContain('shrink-0');
  });

  it('forwards extra props such as id and data attributes to the heading', () => {
    const html = renderToStaticMarkup(
      <CardTitle id="attendance-heading" data-testid="card-title" icon={CalendarDays}>
        Attendance
      </CardTitle>
    );

    expect(html).toContain('id="attendance-heading"');
    expect(html).toContain('data-testid="card-title"');
  });

  it('does not spread an undefined icon into the DOM', () => {
    // A guard against the classic React "unknown prop on a DOM element" warning
    // if icon is ever passed as undefined.
    const html = renderToStaticMarkup(<CardTitle icon={undefined}>Attendance</CardTitle>);

    expect(html).not.toContain('icon=');
    expect(html).not.toContain('<svg');
  });
});
