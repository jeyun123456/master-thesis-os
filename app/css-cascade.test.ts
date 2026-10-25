import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const globals = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

describe('mobile layout cascade', () => {
  it('keeps the three-column notice row desktop-only so the phone layout is not overridden', () => {
    const threeColumn = /\.portal-notice-row\{[^}]*grid-template-columns:auto minmax\(0,1fr\) minmax\(78px,auto\)/g;
    for (const match of globals.matchAll(threeColumn)) {
      const before = globals.slice(0, match.index);
      expect(before.slice(before.lastIndexOf('@media'))).toMatch(/^@media\(min-width:761px\)/);
    }
  });
  it('leaves no sub-12px text on the mail, notice and calendar screens', () => {
    const rules = [...globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => /mail|portal|calendar|planner|school/.test(selector) && !/data-density|axis/.test(selector));
    const small = rules.filter(([, , body]) => [...body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].some(([, size]) => Number(size) < 12));
    expect(small.map(([, selector]) => selector.trim())).toEqual([]);
  });
});
