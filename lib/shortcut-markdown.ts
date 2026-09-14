import { parseShortcuts, type Shortcut } from './shortcuts';

export const SHORTCUTS_MARKER_START = '<!-- master-thesis-os:shortcuts:start -->';
export const SHORTCUTS_MARKER_END = '<!-- master-thesis-os:shortcuts:end -->';

const SERIALIZED_FIELDS: Array<keyof Shortcut> = [
  'title',
  'type',
  'target',
  'description',
  'icon',
  'args',
  'workingDirectory',
  'runAsAdmin',
  'pinnedToHome',
  'enabled',
  'order',
];

export function parseShortcutMarkdown(markdown: string): Shortcut[] {
  const start = markdown.indexOf(SHORTCUTS_MARKER_START);
  if (start < 0) return [];
  const contentStart = start + SHORTCUTS_MARKER_START.length;
  const end = markdown.indexOf(SHORTCUTS_MARKER_END, contentStart);
  const content = markdown.slice(contentStart, end < 0 ? markdown.length : end);
  const headings = [...content.matchAll(/^###\s+([^\r\n]+?)\s*$/gm)];
  const rawItems = headings.map((heading, index) => {
    const blockStart = (heading.index || 0) + heading[0].length;
    const blockEnd = index + 1 < headings.length ? headings[index + 1].index || content.length : content.length;
    const raw: Record<string, unknown> = { id: heading[1].trim() };
    for (const line of content.slice(blockStart, blockEnd).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
      if (!match) continue;
      raw[match[1]] = parseScalar(match[2]);
    }
    return raw;
  });
  return parseShortcuts(rawItems);
}

export function serializeShortcutMarkdown(items: Shortcut[], existingMarkdown = ''): string {
  const normalized = parseShortcuts(items);
  const lines = [
    SHORTCUTS_MARKER_START,
    '',
    ...normalized.flatMap((item) => [
      `### ${item.id}`,
      ...SERIALIZED_FIELDS.filter((field) => item[field] !== undefined).map((field) => `${field}: ${serializeScalar(item[field])}`),
      '',
    ]),
    SHORTCUTS_MARKER_END,
  ];
  const block = lines.join('\n');
  const start = existingMarkdown.indexOf(SHORTCUTS_MARKER_START);
  if (start >= 0) {
    const end = existingMarkdown.indexOf(SHORTCUTS_MARKER_END, start + SHORTCUTS_MARKER_START.length);
    if (end < 0) throw new Error('Shortcut Markdown end marker is missing');
    const afterEnd = end + SHORTCUTS_MARKER_END.length;
    return `${existingMarkdown.slice(0, start)}${block}${existingMarkdown.slice(afterEnd)}`.replace(/\r?\n?$/, '\n');
  }

  const prefix = existingMarkdown.trimEnd();
  return `${prefix ? `${prefix}\n\n` : '# Master Thesis OS 바로가기\n\n'}${block}\n`;
}

function parseScalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed);
      if (typeof decoded === 'string') return decoded;
    } catch {
      // Fall through and retain the original text.
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function serializeScalar(value: Shortcut[keyof Shortcut]) {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}
