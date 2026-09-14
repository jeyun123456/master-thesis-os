import { describe, expect, it } from 'vitest';
import { detectShortcutType, getEnabledShortcuts, getHomeShortcuts, isAbsoluteLocalTarget, isSupportedExternalUri, isWindowsShellTarget, parseShortcuts } from './shortcuts';
import { parseShortcutMarkdown, serializeShortcutMarkdown } from './shortcut-markdown';

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
    expect(detectShortcutType('steam://rungameid/3548580')).toBe('uri');
    expect(detectShortcutType('shell:RecycleBinFolder')).toBe('shell');
    expect(detectShortcutType('C:\\Apps\\Obsidian.exe')).toBe('app');
    expect(detectShortcutType('D:\\Research')).toBe('folder');
    expect(detectShortcutType('D:\\Research\\paper.pdf')).toBe('file');
    expect(isAbsoluteLocalTarget('C:\\Apps\\app.exe')).toBe(true);
    expect(isAbsoluteLocalTarget('wiki/note.md')).toBe(false);
  });

  it('accepts allowlisted external URI and Windows shell targets only', () => {
    const items = parseShortcuts([
      { id: 'steam', title: 'Steam', type: 'uri', target: 'steam://rungameid/3548580' },
      { id: 'recycle-bin', title: '휴지통', type: 'shell', target: 'shell:RecycleBinFolder' },
      { id: 'bad-uri', title: 'Bad URI', type: 'uri', target: 'javascript:alert(1)' },
      { id: 'bad-shell', title: 'Bad shell', type: 'shell', target: 'shell:bad target' },
    ]);
    expect(items.map((item) => item.id)).toEqual(['steam', 'recycle-bin']);
    expect(isSupportedExternalUri('steam://rungameid/3548580')).toBe(true);
    expect(isSupportedExternalUri('javascript:alert(1)')).toBe(false);
    expect(isWindowsShellTarget('shell:RecycleBinFolder')).toBe(true);
    expect(isWindowsShellTarget('shell:bad target')).toBe(false);
  });

  it('defaults optional flags without inventing a target', () => {
    const [item] = parseShortcuts([{ id: 'x', title: 'X', type: 'file', target: 'wiki/x.md' }]);
    expect(item).toMatchObject({ enabled: true, pinnedToHome: false, description: undefined, icon: undefined });
  });

  it('round-trips repository shortcuts through the Markdown contract', () => {
    const markdown = `# 설명\n\n<!-- master-thesis-os:shortcuts:start -->\n\n### steam\ntitle: "Steam 게임"\ntype: "uri"\ntarget: "steam://rungameid/3548580"\npinnedToHome: true\nenabled: true\norder: 0\n\n### recycle-bin\ntitle: "휴지통"\ntype: "shell"\ntarget: "shell:RecycleBinFolder"\nenabled: false\norder: 1\n\n<!-- master-thesis-os:shortcuts:end -->\n`;
    const items = parseShortcutMarkdown(markdown);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'steam', type: 'uri', target: 'steam://rungameid/3548580', pinnedToHome: true });
    expect(items[1]).toMatchObject({ id: 'recycle-bin', type: 'shell', target: 'shell:RecycleBinFolder', enabled: false });
    const rewritten = serializeShortcutMarkdown(items, markdown);
    expect(rewritten).toContain('# 설명');
    expect(rewritten).toContain('### steam');
    expect(parseShortcutMarkdown(rewritten)).toEqual(items);
  });

  it('does not rewrite a shortcut document with an incomplete marker block', () => {
    expect(() => serializeShortcutMarkdown([], '<!-- master-thesis-os:shortcuts:start -->\n')).toThrow('end marker');
  });
});
