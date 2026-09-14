import type { RepositoryItem } from './repository';

export type ProjectStatus = 'writing' | 'active' | 'paused' | 'waiting' | 'blocked' | 'complete' | string;

export const projectStatusOptions = [
  { value: 'writing', label: '작성중' },
  { value: 'active', label: '진행 중' },
  { value: 'paused', label: '보류' },
  { value: 'waiting', label: '대기' },
  { value: 'blocked', label: '막힘' },
  { value: 'complete', label: '완료' },
] as const;

export const projectStatusValues = projectStatusOptions.map((option) => option.value);

export type ResearchProject = {
  id: string;
  title: string;
  status: ProjectStatus;
  priority: string;
  stage: string;
  updated: string;
  sourcePath: string;
  sourceSha?: string;
  summary: string;
  currentFocus: string;
  questions: string[];
  nextTasks: string[];
  blocked: string[];
  relatedPaths: string[];
  resultPaths: string[];
};

export type RelatedFolderGroup = {
  path: string;
  label: string;
  files: RepositoryItem[];
};

const sectionAliases: Record<string, keyof Pick<ResearchProject, 'currentFocus' | 'questions' | 'nextTasks' | 'blocked' | 'relatedPaths' | 'resultPaths'>> = {
  '현재 집중': 'currentFocus',
  '연구 질문': 'questions',
  '다음 작업': 'nextTasks',
  '막힌 부분': 'blocked',
  '관련 경로': 'relatedPaths',
  '결과 경로': 'resultPaths',
};

export function parseProjectManifest(markdown: string, sourcePath: string): ResearchProject {
  const frontmatter = parseFrontmatter(markdown);
  const sections = parseSections(markdown);
  const title = frontmatter.title || headingOne(markdown) || frontmatter.id || sourcePath;

  return {
    id: frontmatter.id || projectIdFromPath(sourcePath),
    title,
    status: frontmatter.status || 'waiting',
    priority: frontmatter.priority || 'medium',
    stage: frontmatter.stage || 'unknown',
    updated: frontmatter.updated || '',
    sourcePath,
    summary: firstBodyParagraph(markdown),
    currentFocus: sections.currentFocus[0] || '',
    questions: sections.questions,
    nextTasks: sections.nextTasks,
    blocked: sections.blocked,
    relatedPaths: sections.relatedPaths.map(normalizeRelatedPath).filter(Boolean),
    resultPaths: uniquePaths([
      ...sections.resultPaths,
      frontmatter.results_path || frontmatter.result_path || frontmatter.results || '',
    ]),
  };
}

export function projectManifestPaths(tree: RepositoryItem[]): string[] {
  return tree
    .filter((item) => item.type === 'blob' && /^projects\/[^/]+\/project\.md$/i.test(item.path))
    .map((item) => item.path)
    .sort();
}

export function projectRelatedFiles(project: ResearchProject, tree: RepositoryItem[], limit = 24): RepositoryItem[] {
  if (!project.relatedPaths.length) return [];
  const matched = tree.filter((item) => {
    if (item.type !== 'blob') return false;
    return project.relatedPaths.some((path) => relatedPathMatches(project, item.path, path));
  });
  return matched.sort((a, b) => compareText(a.path, b.path)).slice(0, Math.max(0, limit));
}

function relatedPathMatches(project: ResearchProject, itemPath: string, relatedPath: string) {
  const candidates = relatedPath.startsWith('projects/')
    ? [relatedPath]
    : [relatedPath, `projects/${project.id}/${relatedPath}`];
  return candidates.some((path) => path.endsWith('/') ? itemPath.startsWith(path) : itemPath === path);
}

export function groupFilesByParentFolder(items: RepositoryItem[]): RelatedFolderGroup[] {
  const groups = new Map<string, RepositoryItem[]>();
  for (const item of items) {
    if (item.type !== 'blob') continue;
    const separator = item.path.lastIndexOf('/');
    const path = separator === -1 ? '' : item.path.slice(0, separator);
    const files = groups.get(path) || [];
    files.push(item);
    groups.set(path, files);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([path, files]) => ({
      path,
      label: path ? path.split('/').pop() || path : 'Vault root',
      files: files.sort((a, b) => compareText(a.path, b.path)),
    }));
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    data: '자료',
    mapping: '부문통합',
    labour: '노동시간',
    calculation: '계산',
    validation: '검증',
    interpretation: '해석',
    writing: '집필',
    literature: '문헌 정리',
    presentation: '발표 준비',
    complete: '완료',
  };
  return labels[stage] || stage || '미지정';
}

export function projectStatusLabel(status: string): string {
  const labels = Object.fromEntries(projectStatusOptions.map((option) => [option.value, option.label]));
  return labels[status] || status || '미지정';
}

export function updateProjectStatusMarkdown(markdown: string, status: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('project.md frontmatter is missing');
  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = match[1].split(/\r?\n/);
  let replaced = false;
  const updatedLines = lines.map((line) => {
    if (!/^\s*status\s*:/i.test(line)) return line;
    replaced = true;
    return `status: ${status}`;
  });
  if (!replaced) {
    const idIndex = updatedLines.findIndex((line) => /^\s*id\s*:/i.test(line));
    updatedLines.splice(idIndex >= 0 ? idIndex + 1 : 0, 0, `status: ${status}`);
  }
  const updatedFrontmatter = `---${lineBreak}${updatedLines.join(lineBreak)}${lineBreak}---`;
  return `${updatedFrontmatter}${markdown.slice(match[0].length)}`;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!pair) continue;
    result[pair[1]] = stripQuotes(pair[2]);
  }
  return result;
}

function parseSections(markdown: string) {
  const result = {
    currentFocus: [] as string[],
    questions: [] as string[],
    nextTasks: [] as string[],
    blocked: [] as string[],
    relatedPaths: [] as string[],
    resultPaths: [] as string[],
  };
  const headings = [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index][1].trim();
    const key = sectionAliases[heading];
    if (!key) continue;
    const start = (headings[index].index || 0) + headings[index][0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index || markdown.length : markdown.length;
    const body = markdown.slice(start, end).trim();
    if (key === 'currentFocus') {
      const paragraph = body.split(/\n\s*\n/).map((value) => cleanInline(value)).find(Boolean);
      if (paragraph) result.currentFocus.push(paragraph);
    } else {
      result[key] = body
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)?.[1] || '')
        .map(cleanInline)
        .filter(Boolean);
    }
  }
  return result;
}

function headingOne(markdown: string): string {
  return markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || '';
}

function firstBodyParagraph(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*/, '');
  const lines = withoutFrontmatter.split(/\r?\n/);
  let buffer: string[] = [];
  for (const line of lines) {
    if (/^#/.test(line.trim())) {
      if (buffer.length) break;
      continue;
    }
    if (!line.trim()) {
      if (buffer.length) break;
      continue;
    }
    buffer.push(line.trim());
  }
  return cleanInline(buffer.join(' '));
}

function projectIdFromPath(path: string): string {
  return path.split('/')[1] || path;
}

function stripQuotes(value: string): string {
  return value.replace(/^(?:"|')|(?:"|')$/g, '').trim();
}

function normalizeRelatedPath(value: string): string {
  return value.replace(/^\[\[|\]\]$/g, '').trim().replace(/^\.\//, '');
}

function uniquePaths(values: string[]) {
  return [...new Set(values
    .flatMap((value) => value.split(','))
    .map(normalizeRelatedPath)
    .filter(Boolean))];
}

function cleanInline(value: string): string {
  return value
    .replace(/^\s+|\s+$/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
