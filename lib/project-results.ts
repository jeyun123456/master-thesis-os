import type { ResearchProject } from './projects';
import type { RepositoryItem } from './repository';

const RESULT_DIRECTORY_NAMES = new Set(['result', 'results', 'output', 'outputs', '결과', '산출물']);
const DASHBOARD_FILES = new Set(['necessary_labour.json', 'decomposition.json', 'validation.json']);

export type ProjectResultInventory = {
  roots: string[];
  files: RepositoryItem[];
  totalFiles: number;
  dashboardPath: string | null;
};

export function projectResultInventory(project: ResearchProject, tree: RepositoryItem[], limit = 240): ProjectResultInventory {
  const roots = new Set<string>();
  const projectRoot = `projects/${project.id}/`;

  for (const value of project.resultPaths) {
    for (const candidate of projectPathCandidates(project, value, tree)) roots.add(rootPath(candidate, tree));
  }

  for (const candidate of [
    `${projectRoot}코드/결과/`,
    `${projectRoot}code/results/`,
    `${projectRoot}results/`,
    `${projectRoot}result/`,
    `${projectRoot}outputs/`,
    `${projectRoot}output/`,
    `${projectRoot}산출물/`,
  ]) {
    if (hasBlobUnder(tree, candidate)) roots.add(rootPath(candidate, tree));
  }

  for (const item of tree) {
    if (item.type !== 'blob' || !item.path.startsWith(projectRoot)) continue;
    const segments = item.path.split('/');
    const resultSegment = segments.findIndex((segment, index) => index >= 2 && RESULT_DIRECTORY_NAMES.has(segment.toLocaleLowerCase()));
    if (resultSegment >= 0) roots.add(`${segments.slice(0, resultSegment + 1).join('/')}/`);
  }

  for (const value of project.relatedPaths) {
    if (!isResultLikePath(value)) continue;
    for (const candidate of projectPathCandidates(project, value, tree)) {
      if (hasBlobUnder(tree, candidate)) roots.add(rootPath(candidate, tree));
    }
  }

  const sortedRoots = [...roots].filter(Boolean).sort(compareText);
  const matchingFiles = tree
    .filter((item) => item.type === 'blob' && sortedRoots.some((root) => item.path === root.slice(0, -1) || item.path.startsWith(root)))
    .sort((a, b) => compareText(a.path, b.path));
  const dashboardPath = findDashboardPath(matchingFiles);

  return {
    roots: sortedRoots,
    files: matchingFiles.slice(0, Math.max(0, limit)),
    totalFiles: matchingFiles.length,
    dashboardPath,
  };
}

export function emptyProjectResultInventory(): ProjectResultInventory {
  return { roots: [], files: [], totalFiles: 0, dashboardPath: null };
}

function projectPathCandidates(project: ResearchProject, value: string, tree: RepositoryItem[]) {
  const normalized = normalizePath(value);
  if (!normalized) return [];
  if (normalized.startsWith('projects/')) return [normalized];

  const candidates = [`projects/${project.id}/${normalized}`, normalized];
  return candidates.filter((candidate, index) => index === 0 || hasBlobUnder(tree, candidate));
}

function hasBlobUnder(tree: RepositoryItem[], candidate: string) {
  const normalized = normalizePath(candidate).replace(/\/$/, '');
  if (!normalized) return false;
  return tree.some((item) => item.type === 'blob' && (item.path === normalized || item.path.startsWith(`${normalized}/`)));
}

function rootPath(candidate: string, tree: RepositoryItem[]) {
  const normalized = normalizePath(candidate).replace(/\/$/, '');
  const exactFile = tree.some((item) => item.type === 'blob' && item.path === normalized);
  if (exactFile) {
    const separator = normalized.lastIndexOf('/');
    return separator === -1 ? '' : `${normalized.slice(0, separator)}/`;
  }
  return normalized ? `${normalized}/` : '';
}

function findDashboardPath(files: RepositoryItem[]) {
  const directories = new Map<string, Set<string>>();
  for (const item of files) {
    const name = item.path.split('/').pop()?.toLocaleLowerCase() || '';
    if (!DASHBOARD_FILES.has(name)) continue;
    const separator = item.path.lastIndexOf('/');
    const directory = separator === -1 ? '' : item.path.slice(0, separator);
    const names = directories.get(directory) || new Set<string>();
    names.add(name);
    directories.set(directory, names);
  }

  return [...directories.entries()]
    .filter(([, names]) => DASHBOARD_FILES.size === names.size)
    .map(([directory]) => directory)
    .sort((left, right) => {
      const leftDashboard = basename(left).toLocaleLowerCase() === 'dashboard' ? 0 : 1;
      const rightDashboard = basename(right).toLocaleLowerCase() === 'dashboard' ? 0 : 1;
      return leftDashboard - rightDashboard || depth(left) - depth(right) || compareText(left, right);
    })[0] || null;
}

function isResultLikePath(value: string) {
  const segments = normalizePath(value).split('/');
  return segments.some((segment) => RESULT_DIRECTORY_NAMES.has(segment.toLocaleLowerCase()));
}

function normalizePath(value: string) {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

function basename(value: string) {
  return value.split('/').pop() || value;
}

function depth(value: string) {
  return value ? value.split('/').length : 0;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
