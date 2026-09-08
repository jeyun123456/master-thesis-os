export type LibraryPaper = {
  author: string;
  year: string;
  title: string;
  path: string;
};

export type WikiCategory = 'current' | 'concepts' | 'methodology' | 'decisions' | 'findings' | 'data' | 'other';

export const wikiCategoryOrder: WikiCategory[] = ['current', 'concepts', 'methodology', 'decisions', 'findings', 'data', 'other'];

export const wikiCategoryLabels: Record<WikiCategory, string> = {
  current: '현재 상태',
  concepts: '개념',
  methodology: '방법론',
  decisions: '연구 결정',
  findings: '결과 · 발견',
  data: '데이터',
  other: '기타 Wiki',
};

function filename(path: string) {
  return path.split('/').pop() || path;
}

export function parsePaperIndex(markdown: string): LibraryPaper[] {
  const items: LibraryPaper[] = [];
  const seen = new Set<string>();
  const matcher = /\[\[([^\]|]+?\.pdf)(?:\|([^\]]+))?\]\]/gi;

  for (const match of markdown.matchAll(matcher)) {
    const path = match[1].trim();
    if (seen.has(path)) continue;
    seen.add(path);

    const display = (match[2] || filename(path)).trim().replace(/\.pdf$/i, '');
    const parsed = display.match(/^(.*?)\s+\(([^)]+)\)\s+-\s+(.+)$/);
    if (parsed) {
      items.push({ author: parsed[1].trim(), year: parsed[2].trim(), title: parsed[3].trim(), path });
    } else {
      items.push({ author: '저자 미상', year: '연도 미상', title: display, path });
    }
  }

  return items;
}

export function classifyWikiPath(path: string): WikiCategory {
  const value = path.replace(/\\/g, '/').toLocaleLowerCase();
  if (value === 'wiki/current_status.md' || value === 'wiki/readme.md') return 'current';
  if (value.startsWith('wiki/concepts/')) return 'concepts';
  if (value.startsWith('wiki/methodology/')) return 'methodology';
  if (value.startsWith('wiki/decisions/')) return 'decisions';
  if (value.startsWith('wiki/findings/')) return 'findings';
  if (value.startsWith('wiki/data/')) return 'data';
  return 'other';
}

const wikiTitleOverrides: Record<string, string> = {
  'wiki/current_status.md': '현재 연구 상태',
  'wiki/README.md': '연구 Wiki 안내',
  'wiki/findings/benchmark_results.md': '벤치마크 결과',
};

export function wikiDisplayTitle(path: string) {
  if (wikiTitleOverrides[path]) return wikiTitleOverrides[path];
  return filename(path)
    .replace(/\.md$/i, '')
    .replace(/^D\d+[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}
