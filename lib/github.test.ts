import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('GitHub tree loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('GITHUB_OWNER', 'owner');
    vi.stubEnv('GITHUB_REPO', 'private-repo');
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
