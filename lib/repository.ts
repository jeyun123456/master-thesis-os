export type RepositoryItem = {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
  sha?: string;
};

export type RepositoryCategory =
  | 'wiki'
  | 'literature'
  | 'results'
  | 'research'
  | 'other';

const WIKI_ROOTS = ['02_Projects/', '03_Knowledge/', 'wiki/'];
const LITERATURE_ROOTS = ['03_Knowledge/sources/literature/', '연구/문헌/', '연구/선행연구/', 'wiki/literature/'];
const RESULTS_ROOTS = [
  '02_Projects/thesis/코드/결과/주요결과/',
  '02_Projects/thesis/results/',
  'projects/thesis/코드/결과/주요결과/',
  'calc/data/results/',
  'wiki/findings/',
];
const PROJECT_RESULT_SEGMENTS = new Set(['result', 'results', 'output', 'outputs', '결과', '산출물']);
const RESEARCH_ROOTS = ['01_Areas/Research/', '02_Projects/', '03_Knowledge/', '04_Data/', 'calc/', '연구/', 'wiki/'];

function normalized(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLocaleLowerCase();
}

function under(path: string, roots: string[]) {
  return roots.some((root) => path === root.slice(0, -1) || path.startsWith(root));
}

export function classifyRepositoryPath(path: string): RepositoryCategory {
  const value = normalized(path);
  if (under(value, LITERATURE_ROOTS)) return 'literature';
  if (under(value, RESULTS_ROOTS) || isProjectResultPath(value)) return 'results';
  if (under(value, WIKI_ROOTS)) return 'wiki';
  if (under(value, RESEARCH_ROOTS)) return 'research';
  return 'other';
}

function isProjectResultPath(path: string) {
  const segments = path.split('/');
  return ['projects', '02_projects'].includes(segments[0])
    && segments.length > 2
    && segments.slice(2).some((segment) => PROJECT_RESULT_SEGMENTS.has(segment));
}

export function classifyRepositoryItems(items: RepositoryItem[]) {
  return items.reduce<Record<RepositoryCategory, RepositoryItem[]>>(
    (groups, item) => {
      if (item.type === 'blob') groups[classifyRepositoryPath(item.path)].push(item);
      return groups;
    },
    { wiki: [], literature: [], results: [], research: [], other: [] },
  );
}

export function isSafeRepositoryPath(path: string) {
  if (!path || path.includes('\0') || path.includes('\\')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
