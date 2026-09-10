import { describe, expect, it } from 'vitest';
import { getEnabledShortcuts, getHomeShortcuts, parseShortcuts } from './shortcuts';

describe('shortcuts', () => {
  it('filters invalid entries and sorts enabled shortcuts predictably', () => {
    const result = parseShortcuts([
      { id: 'z', title: 'Z', type: 'file', target: 'wiki/z.md', order: 2 },
      { id: 'a', title: 'A', type: 'web', target: 'https://example.com', order: 1 },
      { id: 'bad', title: 'Bad', type: 'file', target: '../secret', order: 0 },
      { id: 'also-bad', title: 'Bad', type: 'web', target: 'javascript:alert(1)' },
    ]);
    expect(result.map((item) => item.id)).toEqual(['a', 'z']);
    expect(result.every((item) => item.enabled)).toBe(true);
  });

  it('keeps file, folder, and web actions and applies home filtering', () => {
    const items = parseShortcuts([
      { id: 'folder', title: 'Folder', type: 'folder', target: '', pinnedToHome: true, order: 2 },
      { id: 'file', title: 'File', type: 'file', target: 'wiki/a.md', pinnedToHome: true, enabled: false, order: 1 },
      { id: 'web', title: 'Web', type: 'web', target: 'http://example.com', pinnedToHome: true, order: 3 },
    ]);
    expect(items.map((item) => item.type)).toEqual(['file', 'folder', 'web']);
    expect(getEnabledShortcuts(items).map((item) => item.id)).toEqual(['folder', 'web']);
    expect(getHomeShortcuts(items).map((item) => item.id)).toEqual(['folder', 'web']);
  });

  it('defaults optional flags without inventing a target', () => {
    const [item] = parseShortcuts([{ id: 'x', title: 'X', type: 'file', target: 'wiki/x.md' }]);
    expect(item).toMatchObject({ enabled: true, pinnedToHome: false, description: undefined, icon: undefined });
  });
});
