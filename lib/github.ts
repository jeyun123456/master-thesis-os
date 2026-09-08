const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const branch = process.env.GITHUB_BRANCH || 'master';
const token = process.env.GITHUB_TOKEN;
const TREE_CACHE_TTL_MS = 60_000;

let treeCache: { expiresAt: number; items: RepositoryItem[] } | null = null;

import { isSafeRepositoryPath, type RepositoryItem } from './repository';

export type GitHubCommitSummary = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

export function githubConfigured() { return Boolean(owner && repo); }

async function gh<T>(path: string, options: { noStore?: boolean } = {}): Promise<T> {
  if (!owner || !repo) throw new Error('GitHub is not configured');
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(options.noStore ? { cache: 'no-store' } : { next: { revalidate: 60 } }),
  });
  if (!res.ok) throw new Error(`GitHub API request failed (${res.status})`);
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

export async function getFile(path: string) {
  if (!isSafeRepositoryPath(path)) throw new Error('Invalid repository-relative path');
  const data = await gh<{ encoding?: string; content?: string } | unknown[]>(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`);
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

export async function getJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await getTextFile(path)) as T;
}
