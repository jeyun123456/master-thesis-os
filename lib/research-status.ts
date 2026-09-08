export type ResearchLink = {
  label: string;
  path: string;
};

export type ResearchStatus = {
  sourcePath: string;
  auditedAt?: string;
  scope?: string;
  currentStage: string;
  researchQuestion: string;
  currentInterpretation: string;
  unresolved: string[];
  nextActions: string[];
  decisions: ResearchLink[];
  importantFiles: ResearchLink[];
};

const DEFAULT_SOURCE_PATH = 'wiki/current_status.md';

function section(markdown: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`));
  return match?.[1]?.trim() || '';
}

function cleanInline(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\\\((.*?)\\\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstParagraph(value: string) {
  return cleanInline(value.split(/\n\s*\n/).find(Boolean) || '');
}

function numberedItems(value: string) {
  return value
    .split('\n')
    .map((line) => line.match(/^\s*\d+\.\s+(.+)$/)?.[1])
    .filter((item): item is string => Boolean(item))
    .map(cleanInline);
}

function resolveRelativePath(sourcePath: string, href: string) {
  if (!href || /^(?:https?:|mailto:|#)/i.test(href)) return null;
  const cleanHref = href.split('#')[0].split('?')[0];
  const parts = sourcePath.split('/').slice(0, -1);
  for (const segment of cleanHref.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

function links(markdown: string, sourcePath: string, predicate: (path: string) => boolean) {
  const found: ResearchLink[] = [];
  const seen = new Set<string>();
  const matcher = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(matcher)) {
    const path = resolveRelativePath(sourcePath, match[2]);
    if (!path || !predicate(path) || seen.has(path)) continue;
    seen.add(path);
    found.push({ label: cleanInline(match[1]), path });
  }
  return found;
}

export function parseResearchStatus(markdown: string, sourcePath = DEFAULT_SOURCE_PATH): ResearchStatus {
  const researchQuestion = firstParagraph(section(markdown, '연구 주제와 문제의식'));
  const currentInterpretation = firstParagraph(section(markdown, '최근 결과와 현재 해석'));
  const unresolved = numberedItems(section(markdown, '미해결 문제'));
  const nextActions = numberedItems(section(markdown, '바로 다음 작업'));
  const auditedAt = markdown.match(/최종 감사:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const scope = markdown.match(/범위:\s*([^\n.]+)/)?.[1]?.trim();
  const decisions = links(markdown, sourcePath, (path) => path.toLocaleLowerCase().includes('/decisions/'));
  const importantFiles = links(markdown, sourcePath, (path) => /calc\/data\/results\//i.test(path));

  let currentStage = '연구 진행';
  if (currentInterpretation) currentStage = '결과 해석';
  if (/집필|원고|발표자료/.test(nextActions.join(' '))) currentStage = '해석 · 집필 준비';

  return {
    sourcePath,
    auditedAt,
    scope,
    currentStage,
    researchQuestion,
    currentInterpretation,
    unresolved,
    nextActions,
    decisions,
    importantFiles,
  };
}
