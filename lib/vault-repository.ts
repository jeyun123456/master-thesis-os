import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getFile, getTextFileWithSha, getTree, githubConfigured, githubWritable, putTextFile, type GitHubApiError } from './github';
import { projectManifestPaths } from './projects';
import { isSafeRepositoryPath, type RepositoryItem } from './repository';

export type VaultSource = 'github' | 'local';

export type VaultTextFile = {
  path: string;
  text: string;
  sha: string;
  source: VaultSource;
};

export type VaultBinaryFile = {
  path: string;
  bytes: Uint8Array;
  source: VaultSource;
};

export class VaultNotFoundError extends Error {
  constructor(repositoryPath: string) {
    super(`Vault file not found: ${repositoryPath}`);
    this.name = 'VaultNotFoundError';
  }
}

export class VaultConflictError extends Error {
  constructor(repositoryPath: string) {
    super(`Vault file changed while it was being edited: ${repositoryPath}`);
    this.name = 'VaultConflictError';
  }
}

export function vaultConfigured() {
  return githubConfigured() || Boolean(process.env.LOCAL_REPOSITORY_ROOT?.trim());
}

export function vaultWritable() {
  if (githubConfigured()) return process.env.GITHUB_WRITE_ENABLED?.trim().toLowerCase() === 'true' && githubWritable();
  return Boolean(process.env.LOCAL_REPOSITORY_ROOT?.trim());
}

export async function readVaultText(repositoryPath: string): Promise<VaultTextFile> {
  validatePath(repositoryPath);
  if (githubConfigured()) {
    try {
      const file = await getTextFileWithSha(repositoryPath);
      return { path: repositoryPath, text: file.decoded, sha: file.sha, source: 'github' };
    } catch (error) {
      if (isGithubNotFound(error)) throw new VaultNotFoundError(repositoryPath);
      throw error;
    }
  }

  const root = localRepositoryRoot();
  if (!root) throw new Error('Vault repository is not configured');
  const filePath = localFilePath(root, repositoryPath);
  try {
    const text = await readFile(filePath, 'utf8');
    return { path: repositoryPath, text, sha: hashText(text), source: 'local' };
  } catch (error) {
    if (isFileNotFound(error)) throw new VaultNotFoundError(repositoryPath);
    throw error;
  }
}

export async function readVaultTextIfPresent(repositoryPath: string): Promise<VaultTextFile | null> {
  try {
    return await readVaultText(repositoryPath);
  } catch (error) {
    if (error instanceof VaultNotFoundError) return null;
    throw error;
  }
}

export async function readVaultBytes(repositoryPath: string): Promise<VaultBinaryFile> {
  validatePath(repositoryPath);
  if (githubConfigured()) {
    try {
      const file = await getFile(repositoryPath, { noStore: true });
      if (Array.isArray(file) || file.encoding !== 'base64' || typeof file.content !== 'string') {
        throw new Error(`Vault file is not readable as binary: ${repositoryPath}`);
      }
      return { path: repositoryPath, bytes: new Uint8Array(Buffer.from(file.content.replace(/\n/g, ''), 'base64')), source: 'github' };
    } catch (error) {
      if (isGithubNotFound(error)) throw new VaultNotFoundError(repositoryPath);
      throw error;
    }
  }

  const root = localRepositoryRoot();
  if (!root) throw new Error('Vault repository is not configured');
  const filePath = localFilePath(root, repositoryPath);
  try {
    return { path: repositoryPath, bytes: new Uint8Array(await readFile(filePath)), source: 'local' };
  } catch (error) {
    if (isFileNotFound(error)) throw new VaultNotFoundError(repositoryPath);
    throw error;
  }
}

export async function writeVaultText(repositoryPath: string, text: string, expectedSha: string | undefined, message: string) {
  validatePath(repositoryPath);
  if (githubConfigured()) {
    if (!vaultWritable()) throw new Error('Vault GitHub write access is not enabled');
    try {
      const file = await putTextFile(repositoryPath, text, message, expectedSha);
      return { path: repositoryPath, sha: file.sha, source: 'github' as const };
    } catch (error) {
      if (isGithubConflict(error)) throw new VaultConflictError(repositoryPath);
      throw error;
    }
  }

  const root = localRepositoryRoot();
  if (!root) throw new Error('Vault repository is not configured');
  const filePath = localFilePath(root, repositoryPath);
  let currentText: string | null = null;
  try {
    currentText = await readFile(filePath, 'utf8');
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
  if (currentText !== null && (!expectedSha || hashText(currentText) !== expectedSha)) {
    throw new VaultConflictError(repositoryPath);
  }
  if (currentText === null && expectedSha) throw new VaultConflictError(repositoryPath);

  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, text, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    try { await unlink(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
  return { path: repositoryPath, sha: hashText(text), source: 'local' as const };
}

export async function vaultProjectManifestPaths(): Promise<string[]> {
  if (githubConfigured()) return projectManifestPaths(await getTree());
  const root = localRepositoryRoot();
  if (!root) return [];
  const projectsRoot = path.join(root, 'projects');
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) continue;
    const manifestPath = path.join(projectsRoot, entry.name, 'project.md');
    try {
      await stat(manifestPath);
      paths.push(`projects/${entry.name}/project.md`);
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }
  return paths.sort();
}

export async function vaultRepositoryTree(): Promise<RepositoryItem[]> {
  if (githubConfigured()) return getTree();
  const root = localRepositoryRoot();
  if (!root) return [];

  const items: RepositoryItem[] = [];
  await collectLocalTree(root, '', items);
  return items.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function validatePath(repositoryPath: string) {
  if (!isSafeRepositoryPath(repositoryPath)) throw new Error('Invalid repository-relative path');
}

function localRepositoryRoot() {
  const value = process.env.LOCAL_REPOSITORY_ROOT?.trim();
  return value ? path.resolve(value) : null;
}

function localFilePath(root: string, repositoryPath: string) {
  const filePath = path.resolve(root, ...repositoryPath.split('/'));
  const relative = path.relative(root, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Invalid repository-relative path');
  }
  return filePath;
}

const ignoredLocalDirectories = new Set(['.git', '.obsidian', '.trash', '.tmp', '__pycache__', 'node_modules', '.next']);

async function collectLocalTree(root: string, relativeDirectory: string, items: RepositoryItem[]) {
  const directory = relativeDirectory ? path.join(root, ...relativeDirectory.split('/')) : root;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isPermissionError(error)) return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (!isSafeRepositoryPath(relativePath)) continue;
    if (entry.isDirectory()) {
      if (ignoredLocalDirectories.has(entry.name.toLowerCase())) continue;
      await collectLocalTree(root, relativePath, items);
      continue;
    }
    if (!entry.isFile()) continue;
    let size: number | undefined;
    try { size = (await stat(path.join(root, ...relativePath.split('/')))).size; } catch { /* best effort metadata */ }
    items.push({ path: relativePath, type: 'blob', ...(size === undefined ? {} : { size }) });
  }
}

function hashText(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM');
}

function isGithubNotFound(error: unknown) {
  return isGithubStatus(error, 404);
}

function isGithubConflict(error: unknown) {
  return isGithubStatus(error, 409) || isGithubStatus(error, 422);
}

function isGithubStatus(error: unknown, status: number): error is GitHubApiError {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status;
}
