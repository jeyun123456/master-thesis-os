import type { RepositoryItem } from './repository';

export type ProjectStatus = string;

export const projectStatusOptions = [
  { value: '아이디어', label: '아이디어' },
  { value: '계획', label: '계획' },
  { value: '진행중', label: '진행 중' },
  { value: '대기', label: '대기' },
  { value: '막힘', label: '막힘' },
  { value: '완료', label: '완료' },
  { value: '취소', label: '취소' },
  { value: '보관', label: '보관' },
] as const;

const legacyProjectStatusValues = ['writing', 'active', 'paused', 'waiting', 'blocked', 'complete'] as const;
const legacyProjectStatusMap: Record<string, ProjectStatus> = {
  writing: '진행중',
  active: '진행중',
  paused: '대기',
  waiting: '대기',
  blocked: '막힘',
  complete: '완료',
};

export const projectStatusValues = [...projectStatusOptions.map((option) => option.value), ...legacyProjectStatusValues];

export function normalizeProjectStatus(status: string): ProjectStatus {
  return legacyProjectStatusMap[status] || status || '대기';
}

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
  keyFiles: string[];
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

const sectionAliases: Record<string, keyof Pick<ResearchProject, 'currentFocus' | 'questions' | 'keyFiles' | 'nextTasks' | 'blocked' | 'relatedPaths' | 'resultPaths'>> = {
  '현재 집중': 'currentFocus',
  '연구 질문': 'questions',
  '주요 파일': 'keyFiles',
  '다음 작업': 'nextTasks',
  '막힌 부분': 'blocked',
  '관련 경로': 'relatedPaths',
  '결과 경로': 'resultPaths',
};

export function parseProjectManifest(markdown: string, sourcePath: string): ResearchProject {
  markdown = stripBom(markdown);
  const frontmatter = parseFrontmatter(markdown);
  const sections = parseSections(markdown);
  const title = frontmatter.title || headingOne(markdown) || frontmatter.id || sourcePath;

  return {
    id: frontmatter.id || projectIdFromPath(sourcePath),
    title,
    status: normalizeProjectStatus(frontmatter.status || '대기'),
    priority: frontmatter.priority || 'medium',
    stage: frontmatter.stage || 'unknown',
    updated: frontmatter.updated || '',
    sourcePath,
    summary: firstBodyParagraph(markdown),
    currentFocus: sections.currentFocus[0] || '',
    questions: sections.questions,
    keyFiles: sections.keyFiles,
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
    .filter((item) => item.type === 'blob' && /^(?:projects|02_Projects)\/[^/]+\/project\.md$/i.test(item.path))
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
  const candidates = relatedPath.startsWith('projects/') || relatedPath.startsWith('02_Projects/')
    ? [relatedPath]
    : [relatedPath, `${projectFolder(project)}/${relatedPath}`];
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

/**
 * `stage` is a per-project workflow state, not a global enum. Any manifest value is preserved;
 * these are only the canonical candidates offered for Research Projects.
 */
export const researchPipelineStages = [
  { value: '탐색', label: '탐색' },
  { value: '설계', label: '설계' },
  { value: '자료수집', label: '자료수집' },
  { value: '분석', label: '분석' },
  { value: '집필', label: '집필' },
  { value: '제출', label: '제출' },
] as const;

const researchStageAliases: Record<string, string> = {
  exploration: '탐색', explore: '탐색',
  planning: '설계', 기획: '설계',
  collection: '자료수집', data: '자료수집', mapping: '자료수집', literature: '자료수집', 자료: '자료수집', '자료 수집': '자료수집', 부문통합: '자료수집',
  analysis: '분석', labour: '분석', calculation: '분석', validation: '분석', interpretation: '분석', interpret: '분석', 해석: '분석',
  writing: '집필', draft: '집필', write: '집필', presentation: '집필',
  complete: '제출', completed: '제출', done: '제출', 완료: '제출',
};

/** Canonical Research stage for a manifest value, or null when the value belongs to another workflow (e.g. 구현). */
export function pipelineStageValue(stage: string): string | null {
  const trimmed = stage.trim();
  if (researchPipelineStages.some((candidate) => candidate.value === trimmed)) return trimmed;
  return researchStageAliases[trimmed.toLocaleLowerCase()] || null;
}

/** A stage is any single-line, bounded string; the manifest value is stored as given. */
export function isValidStageValue(value: unknown): value is string {
  return typeof value === 'string' && /^[^\r\n\x00-\x1f]{1,64}$/.test(value.trim());
}

export function stageLabel(stage: string): string {
  const value = stage.trim();
  return pipelineStageValue(value) || value || '미지정';
}

export function updateProjectStageMarkdown(markdown: string, stage: string): string {
  return updateFrontmatterValue(markdown, 'stage', stage.trim());
}

export function appendProjectTaskMarkdown(markdown: string, value: string): { markdown: string; added: boolean } {
  const task = value.replace(/\s+/g, ' ').trim();
  if (!task || task.length > 1200) throw new Error('A project task between 1 and 1200 characters is required');
  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n';
  const taskLine = `- ${task}`;
  const headings = [...markdown.matchAll(/^##\s+다음 작업\s*$/gm)];
  if (headings.length) {
    const heading = headings[headings.length - 1];
    const start = (heading.index || 0) + heading[0].length;
    const nextHeading = /^##\s+/gm;
    nextHeading.lastIndex = start;
    const next = nextHeading.exec(markdown);
    const end = next ? next.index : markdown.length;
    const section = markdown.slice(start, end);
    if (section.split(/\r?\n/).some((line) => line.trim() === taskLine || line.trim() === `* ${task}`)) {
      return { markdown, added: false };
    }
    const prefix = section && !section.endsWith('\n') && !section.endsWith('\r') ? lineBreak : '';
    return { markdown: `${markdown.slice(0, end)}${prefix}${taskLine}${lineBreak}${markdown.slice(end)}`, added: true };
  }
  const separator = markdown && !markdown.endsWith('\n') && !markdown.endsWith('\r') ? lineBreak : '';
  return { markdown: `${markdown}${separator}${separator ? '' : lineBreak}## 다음 작업${lineBreak}${taskLine}${lineBreak}`, added: true };
}

function updateFrontmatterValue(markdown: string, key: string, value: string): string {
  markdown = stripBom(markdown);
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('project.md frontmatter is missing');
  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = match[1].split(/\r?\n/);
  let replaced = false;
  const updatedLines = lines.map((line) => {
    if (!new RegExp(`^\\s*${key}\\s*:`, 'i').test(line)) return line;
    replaced = true;
    return `${key}: ${value}`;
  });
  if (!replaced) updatedLines.push(`${key}: ${value}`);
  const updatedFrontmatter = `---${lineBreak}${updatedLines.join(lineBreak)}${lineBreak}---`;
  return `${updatedFrontmatter}${markdown.slice(match[0].length)}`;
}

/** Folder that holds a project's project.md (e.g. 02_Projects/thesis). Falls back to the legacy projects/<id> layout. */
export function projectFolder(project: Pick<ResearchProject, 'id' | 'sourcePath'>): string {
  const separator = project.sourcePath.lastIndexOf('/');
  return separator > 0 ? project.sourcePath.slice(0, separator) : `projects/${project.id}`;
}

export function projectStatusLabel(status: string): string {
  const labels = Object.fromEntries(projectStatusOptions.map((option) => [option.value, option.label]));
  return labels[status] || status || '미지정';
}

export function updateProjectStatusMarkdown(markdown: string, status: string): string {
  markdown = stripBom(markdown);
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

/** project.md files saved by Windows tools may start with a UTF-8 BOM. */
function stripBom(markdown: string): string {
  return markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
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
    keyFiles: [] as string[],
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
