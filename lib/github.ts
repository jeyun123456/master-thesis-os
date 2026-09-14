import { isSafeRepositoryPath, type RepositoryItem } from './repository';

export function normalizeGithubRepository(value: string | null | undefined): string | null {
  if (!value) return null;
  const input = value.trim();
  if (!input || input.includes('\0')) return null;

  let path = input;
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const host = url.hostname.toLowerCase();
      if ((host !== 'github.com' && host !== 'www.github.com') || url.port || url.username || url.password || url.search || url.hash) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  } else if (/^(?:ssh:\/\/)?git@github\.com[:/]/i.test(input)) {
    path = input.replace(/^(?:ssh:\/\/)?git@github\.com[:/]/i, '');
  } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    return null;
  }

  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const [ownerPart, repoPart, extra] = path.split('/');
  if (extra !== undefined || !ownerPart || !repoPart) return null;
  if (![ownerPart, repoPart].every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) return null;
  return `${ownerPart}/${repoPart}`;
}

export const normalizeGitHubRepository = normalizeGithubRepository;
export const parseGitHubRepository = normalizeGithubRepository;
export const parseRepositoryIdentifier = normalizeGithubRepository;

const configuredRepository = normalizeGithubRepository(process.env.GITHUB_REPO)
  ?? normalizeGithubRepository(process.env.GITHUB_REPOSITORY)
  ?? normalizeGithubRepository([process.env.GITHUB_OWNER, process.env.GITHUB_REPO].filter(Boolean).join('/'));
const [owner, repo] = configuredRepository?.split('/') ?? ['', ''];
const branch = process.env.GITHUB_BRANCH || 'master';
const token = process.env.GITHUB_TOKEN;
const TREE_CACHE_TTL_MS = 60_000;

let treeCache: { expiresAt: number; items: RepositoryItem[] } | null = null;

export type GitHubCommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

export type GitHubTextFile = {
  path: string;
  sha: string;
  decoded: string;
};

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export function githubConfigured() { return Boolean(owner && repo); }
export function githubWritable() { return githubConfigured() && Boolean(token); }

async function gh<T>(path: string, options: { noStore?: boolean; method?: 'GET' | 'PUT'; body?: unknown } = {}): Promise<T> {
  if (!owner || !repo) throw new Error('GitHub is not configured');
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    ...(options.noStore ? { cache: 'no-store' } : { next: { revalidate: 60 } }),
  });
  if (!res.ok) throw new GitHubApiError(`GitHub API request failed (${res.status})`, res.status);
  return res.json() as Promise<T>;
}

export async function getTree(): Promise<RepositoryItem[]> {
  const now = Date.now();
  if (treeCache && treeCache.expiresAt > now) return treeCache.items;

  const data = await gh<{ tree?: RepositoryItem[]; truncated?: boolean }>(`/git/trees/${encodeURIComponent(branch)}?recursive=1`, { noStore: true });
  if (data.truncated) throw new Error('GitHub tree is truncated; narrow the repository or use a contents-based index');
  const items = data.tree || [];
  treeCache = { items, expiresAt: now + TREE_CACHE_TTL_MS };
  return items;
}

export function clearGithubTreeCacheForTests() {
  treeCache = null;
}

export async function getCommits(limit = 8): Promise<GitHubCommitSummary[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 30);
  const items = await gh<Array<{
    sha?: string;
    html_url?: string;
    commit?: {
      message?: string;
      author?: { name?: string; date?: string } | null;
    };
    author?: { login?: string } | null;
  }>>(`/commits?sha=${encodeURIComponent(branch)}&per_page=${safeLimit}`);

  return items.map((item) => ({
    sha: item.sha || '',
    message: item.commit?.message?.split('\n')[0] || '(커밋 메시지 없음)',
    author: item.author?.login || item.commit?.author?.name || 'unknown',
    date: item.commit?.author?.date || '',
    url: item.html_url || '',
  }));
}

export async function getFile(path: string, options: { noStore?: boolean } = {}) {
  if (!isSafeRepositoryPath(path)) throw new Error('Invalid repository-relative path');
  const data = await gh<{ encoding?: string; content?: string; sha?: string; path?: string } | unknown[]>(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, options);
  if (Array.isArray(data)) return data;
  if (data.encoding === 'base64' && data.content) {
    return { ...data, decoded: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8') };
  }
  return data;
}

export async function getTextFile(path: string): Promise<string> {
  const file = await getFile(path);
  if (Array.isArray(file) || !('decoded' in file) || typeof file.decoded !== 'string') {
    throw new Error(`GitHub file is not decodable text: ${path}`);
  }
  return file.decoded;
}

export async function getTextFileWithSha(path: string): Promise<GitHubTextFile> {
  const file = await getFile(path, { noStore: true });
  if (Array.isArray(file) || !('decoded' in file) || typeof file.decoded !== 'string' || typeof file.sha !== 'string') {
    throw new Error(`GitHub file is not decodable text: ${path}`);
  }
  return { path, sha: file.sha, decoded: file.decoded };
}

export async function putTextFile(path: string, content: string, message: string, sha?: string): Promise<{ path: string; sha: string }> {
  if (!isSafeRepositoryPath(path)) throw new Error('Invalid repository-relative path');
  if (!githubWritable()) throw new Error('GitHub write access is not configured');
  const data = await gh<{
    content?: { path?: string; sha?: string };
  }>(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    noStore: true,
    body: {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    },
  });
  const resultPath = data.content?.path || path;
  const resultSha = data.content?.sha;
  if (!resultSha) throw new Error(`GitHub did not return a file SHA: ${path}`);
  return { path: resultPath, sha: resultSha };
}

export async function getJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await getTextFile(path)) as T;
}
