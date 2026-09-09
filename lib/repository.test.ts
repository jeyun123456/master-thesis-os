import { describe, expect, it } from 'vitest';

import { classifyRepositoryItems, classifyRepositoryPath, isSafeRepositoryPath } from './repository';

describe('repository path classification', () => {
  it.each([
    ['wiki/current_status.md', 'wiki'],
    ['wiki/literature/source-card.md', 'literature'],
    ['wiki/findings/benchmark.md', 'results'],
    ['연구/문헌/価値に関する15の命題原文.pdf', 'literature'],
    ['연구/선행연구/日本語 자료.md', 'literature'],
    ['Calc/data/results/dashboard/necessary_labour.json', 'results'],
    ['projects/interim-presentation/코드/결과/주요결과/dashboard/necessary_labour.json', 'results'],
    ['연구/발표·세미나/中間報告用_v6.pptx', 'research'],
    ['master-thesis-os/lib/calendar.ts', 'other'],
  ] as const)('classifies %s as %s', (path, expected) => {
    expect(classifyRepositoryPath(path)).toBe(expected);
  });

  it('keeps blobs in exactly one group and ignores tree entries', () => {
    const groups = classifyRepositoryItems([
      { path: 'wiki/current_status.md', type: 'blob' },
      { path: '연구/문헌/資料.pdf', type: 'blob' },
      { path: 'Calc/data/results/dashboard/validation.json', type: 'blob' },
      { path: 'wiki', type: 'tree' },
    ]);

    expect(groups.wiki).toHaveLength(1);
    expect(groups.literature).toHaveLength(1);
    expect(groups.results).toHaveLength(1);
    expect(Object.values(groups).flat()).toHaveLength(3);
  });
});

describe('repository-relative path safety', () => {
  it.each(['wiki/current_status.md', '연구/문헌/資料.pdf', 'Calc/data/results/dashboard/validation.json'])(
    'accepts %s',
    (path) => expect(isSafeRepositoryPath(path)).toBe(true),
  );

  it.each(['../secret', '/absolute/path', 'C:/absolute/path', 'wiki\\note.md', 'wiki//note.md'])(
    'rejects %s',
    (path) => expect(isSafeRepositoryPath(path)).toBe(false),
  );
});
