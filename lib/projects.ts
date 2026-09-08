import type { RepositoryItem } from './repository';

export type ProjectStatus = 'active' | 'waiting' | 'blocked' | 'complete' | string;

export type ResearchProject = {
  id: string;
  title: string;
  status: ProjectStatus;
  priority: string;
  stage: string;
  updated: string;
  sourcePath: string;
  summary: string;
  currentFocus: string;
  questions: string[];
  nextTasks: string[];
  blocked: string[];
  relatedPaths: string[];
};

const sectionAliases: Record<string, keyof Pick<ResearchProject, 'currentFocus' | 'questions' | 'nextTasks' | 'blocked' | 'relatedPaths'>> = {
  '현재 집중': 'currentFocus',
  '연구 질문': 'questions',
  '다음 작업': 'nextTasks',
  '막힌 부분': 'blocked',
  '관련 경로': 'relatedPaths',
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
    return project.relatedPaths.some((path) => path.endsWith('/') ? item.path.startsWith(path) : item.path === path);
  });
  return matched.slice(0, Math.max(0, limit));
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
  const labels: Record<string, string> = {
    active: '진행 중',
    waiting: '대기',
    blocked: '막힘',
    complete: '완료',
  };
  return labels[status] || status || '미지정';
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

function cleanInline(value: string): string {
  return value
    .replace(/^\s+|\s+$/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
