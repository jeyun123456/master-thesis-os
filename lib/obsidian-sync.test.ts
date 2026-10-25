import { describe, expect, it } from 'vitest';
import { decideObsidianWrite, safeNotePath } from './obsidian-sync';

describe('safeNotePath', () => {
  it('accepts Vault-relative markdown paths only', () => {
    expect(safeNotePath('projects/thesis/notes.md')).toBe('projects/thesis/notes.md');
    for (const bad of ['../x.md', '/abs.md', 'projects/a.txt', '.obsidian/app.md', 'a//b.md', 'a\\b.md', 'projects/./x.md']) {
      expect(safeNotePath(bad)).toBeNull();
    }
  });
});

describe('decideObsidianWrite', () => {
  it('writes only when the note still matches the reviewed SHA', () => {
    expect(decideObsidianWrite('append', 'sha-1', { sha: 'sha-1' })).toEqual({ action: 'write', expectedSha: 'sha-1' });
    expect(decideObsidianWrite('append', 'sha-1', { sha: 'sha-2' }).action).toBe('stale');
    expect(decideObsidianWrite('section', 'sha-1', null).action).toBe('stale');
  });

  it('creates a new note only if nothing appeared at that path meanwhile', () => {
    expect(decideObsidianWrite('new', null, null)).toEqual({ action: 'write', expectedSha: undefined });
    expect(decideObsidianWrite('new', null, { sha: 'x' }).action).toBe('stale');
  });
});
