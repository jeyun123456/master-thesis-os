import { describe, expect, it } from 'vitest';
import { classifyWikiPath, parsePaperIndex, wikiDisplayTitle } from './library';

describe('parsePaperIndex', () => {
  it('extracts author, year, title, and path from Obsidian wikilinks', () => {
    const markdown = '| 1 | [[연구/문헌/논문/Rieu (2008) - Estimating Sectoral Rates of Surplus Value.pdf | Rieu (2008) - Estimating Sectoral Rates of Surplus Value.pdf]] |';
    expect(parsePaperIndex(markdown)).toEqual([
      {
        author: 'Rieu',
        year: '2008',
        title: 'Estimating Sectoral Rates of Surplus Value',
        path: '연구/문헌/논문/Rieu (2008) - Estimating Sectoral Rates of Surplus Value.pdf',
      },
    ]);
  });

  it('deduplicates repeated PDF paths', () => {
    const link = '[[연구/문헌/논문/Okishio (1959) - 剰余価値率の測定.pdf]]';
    expect(parsePaperIndex(`${link}\n${link}`)).toHaveLength(1);
  });
});

describe('wiki library helpers', () => {
  it('classifies wiki folders into research categories', () => {
    expect(classifyWikiPath('wiki/current_status.md')).toBe('current');
    expect(classifyWikiPath('wiki/methodology/decomposition.md')).toBe('methodology');
    expect(classifyWikiPath('wiki/decisions/D003_constant_price_main.md')).toBe('decisions');
    expect(classifyWikiPath('wiki/findings/benchmark_results.md')).toBe('findings');
  });

  it('creates readable wiki titles', () => {
    expect(wikiDisplayTitle('wiki/findings/benchmark_results.md')).toBe('벤치마크 결과');
    expect(wikiDisplayTitle('wiki/decisions/D003_constant_price_main.md')).toBe('constant price main');
  });
});
