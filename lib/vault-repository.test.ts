import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('local vault repository', () => {
  it('creates, reads, updates, and detects concurrent changes atomically', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'master-thesis-os-vault-'));
    temporaryRoots.push(root);
    vi.resetModules();
    vi.stubEnv('GITHUB_OWNER', 'invalid/owner');
    vi.stubEnv('GITHUB_REPO', 'invalid/repo/extra');
    vi.stubEnv('GITHUB_REPOSITORY', 'invalid/repository/extra');
    vi.stubEnv('LOCAL_REPOSITORY_ROOT', root);
    const { VaultConflictError, readVaultBytes, readVaultText, readVaultTextIfPresent, vaultRepositoryTree, writeVaultText } = await import('./vault-repository');

    await expect(readVaultTextIfPresent('shared/shortcuts.md')).resolves.toBeNull();
    const created = await writeVaultText('shared/shortcuts.md', 'one\n', undefined, 'test create');
    expect(created.source).toBe('local');
    const current = await readVaultText('shared/shortcuts.md');
    expect(current.text).toBe('one\n');

    await writeFile(path.join(root, 'shared/shortcuts.md'), 'changed externally\n', 'utf8');
    await expect(writeVaultText('shared/shortcuts.md', 'two\n', current.sha, 'test conflict')).rejects.toBeInstanceOf(VaultConflictError);
    expect(await readFile(path.join(root, 'shared/shortcuts.md'), 'utf8')).toBe('changed externally\n');

    await mkdir(path.join(root, 'projects', 'alpha', 'results'), { recursive: true });
    await writeFile(path.join(root, 'projects', 'alpha', 'project.md'), 'project\n', 'utf8');
    await writeFile(path.join(root, 'projects', 'alpha', 'results', 'matrix.xlsx'), Uint8Array.from([0, 1, 255]));
    await mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'ignored', 'package.json'), '{}', 'utf8');
    const tree = await vaultRepositoryTree();
    expect(tree.map((item) => item.path)).toEqual(['projects/alpha/project.md', 'projects/alpha/results/matrix.xlsx', 'shared/shortcuts.md']);
    await expect(readVaultBytes('projects/alpha/results/matrix.xlsx')).resolves.toMatchObject({ source: 'local', bytes: Uint8Array.from([0, 1, 255]) });
  });

  it('requires explicit opt-in before a GitHub-backed vault can be written', async () => {
    vi.resetModules();
    vi.stubEnv('GITHUB_OWNER', 'owner');
    vi.stubEnv('GITHUB_REPO', 'vault');
    vi.stubEnv('GITHUB_TOKEN', 'test-write-token');
    vi.stubEnv('GITHUB_WRITE_ENABLED', 'false');
    const { vaultWritable } = await import('./vault-repository');
    expect(vaultWritable()).toBe(false);

    vi.stubEnv('GITHUB_WRITE_ENABLED', 'true');
    expect(vaultWritable()).toBe(true);
  });
});
