import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Smoke benchmark check
describe('GitHub tree loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('GITHUB_OWNER', 'owner');
    vi.stubEnv('GITHUB_REPO', 'private-repo');
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.stubEnv('GITHUB_BRANCH', 'master');
    vi.stubEnv('GITHUB_TOKEN', 'test-read-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses a short server-memory cache instead of Next data cache for a large tree', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tree: [{ path: 'wiki/current_status.md', type: 'blob' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getTree } = await import('./github');
    await expect(getTree()).resolves.toHaveLength(1);
    await expect(getTree()).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/private-repo/git/trees/master?recursive=1',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer test-read-token' }),
      }),
    );
  });
});

describe('normalizeGithubRepository', () => {
  it.each([
    ['HTTPS', 'https://github.com/openai/codex', 'openai/codex'],
    ['HTTPS + .git', 'https://github.com/openai/codex.git', 'openai/codex'],
    ['HTTPS + trailing slash', 'https://github.com/openai/codex/', 'openai/codex'],
    ['SSH', 'git@github.com:openai/codex.git', 'openai/codex'],
    ['Already normalized form', 'openai/codex', 'openai/codex'],
    ['HTTPS + .git + trailing slash', 'https://github.com/openai/codex.git/', 'openai/codex'],
    ['HTTP', 'http://github.com/openai/codex', 'openai/codex'],
    ['SSH without .git', 'git@github.com:openai/codex', 'openai/codex'],
    ['SSH with ssh:// prefix', 'ssh://git@github.com/openai/codex.git', 'openai/codex'],
    ['SSH with ssh:// and colon', 'ssh://git@github.com:openai/codex.git', 'openai/codex'],
    ['www subdomain', 'https://www.github.com/openai/codex', 'openai/codex'],
    ['Leading and trailing whitespace', '  openai/codex  ', 'openai/codex'],
  ])('supports %s: %s -> %s', async (_name, input, expected) => {
    const { normalizeGithubRepository, normalizeGitHubRepository, parseGitHubRepository } = await import('./github');
    expect(normalizeGithubRepository(input)).toBe(expected);
    expect(normalizeGitHubRepository(input)).toBe(expected);
    expect(parseGitHubRepository(input)).toBe(expected);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['undefined', undefined],
    ['non-github domain (gitlab)', 'https://gitlab.com/openai/codex'],
    ['non-github SSH (gitlab)', 'git@gitlab.com:openai/codex.git'],
    ['missing repo in URL', 'https://github.com/openai'],
    ['extra URL segments', 'https://github.com/openai/codex/pulls'],
    ['query string in URL', 'https://github.com/openai/codex?tab=readme'],
    ['port in URL', 'https://github.com:8080/openai/codex'],
    ['missing repo in identifier', 'openai'],
    ['extra identifier segments', 'openai/codex/extra'],
    ['consecutive slashes', 'openai//codex'],
    ['empty repo name after .git strip', 'openai/.git'],
    ['path traversal', '../openai/codex'],
    ['unsupported scheme', 'ftp://github.com/openai/codex'],
  ])('safely rejects malformed input (%s): %s', async (_name, input) => {
    const { normalizeGithubRepository } = await import('./github');
    expect(normalizeGithubRepository(input)).toBeNull();
  });
});
