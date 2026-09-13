import { describe, expect, it } from 'vitest';
import { detectShortcutType, getEnabledShortcuts, getHomeShortcuts, isAbsoluteLocalTarget, parseShortcuts } from './shortcuts';

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

  it('accepts local apps and commands with launcher options', () => {
    const items = parseShortcuts([
      { id: 'app', title: 'App', type: 'app', target: 'C:\\Tools\\tool.exe', args: '--profile thesis', workingDirectory: 'D:\\Research', runAsAdmin: true },
      { id: 'cmd', title: 'Dev', type: 'command', target: 'npm run dev', workingDirectory: 'D:\\Research' },
      { id: 'relative-app', title: 'Bad', type: 'app', target: 'tool.exe' },
    ]);
    expect(items.map((item) => item.id)).toEqual(['app', 'cmd']);
    expect(items[0]).toMatchObject({ args: '--profile thesis', workingDirectory: 'D:\\Research', runAsAdmin: true });
  });

  it('detects common targets for the add dialog', () => {
    expect(detectShortcutType('https://example.com')).toBe('web');
    expect(detectShortcutType('C:\\Apps\\Obsidian.exe')).toBe('app');
    expect(detectShortcutType('D:\\Research')).toBe('folder');
    expect(detectShortcutType('D:\\Research\\paper.pdf')).toBe('file');
    expect(isAbsoluteLocalTarget('C:\\Apps\\app.exe')).toBe(true);
    expect(isAbsoluteLocalTarget('wiki/note.md')).toBe(false);
  });

  it('defaults optional flags without inventing a target', () => {
    const [item] = parseShortcuts([{ id: 'x', title: 'X', type: 'file', target: 'wiki/x.md' }]);
    expect(item).toMatchObject({ enabled: true, pinnedToHome: false, description: undefined, icon: undefined });
  });
});
