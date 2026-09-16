import type { MailPriority, PrioritizedMail } from './mail-priority';

export type MailFilter = 'all' | 'unread' | 'important' | 'critical';
export type MailSort = 'newest' | 'priority';

export const INITIAL_MAIL_VISIBLE_COUNT = 20;
export const MAIL_VISIBLE_INCREMENT = 20;
export const MAX_MAIL_VISIBLE_COUNT = 100;
export const MAIL_LIST_PREFERENCES_STORAGE_KEY = 'master-thesis-os:mail-list-preferences';

export const MAIL_FILTER_LABELS: Record<MailFilter, string> = {
  all: '전체',
  unread: '미읽음',
  important: '중요',
  critical: '긴급',
};

export const MAIL_SORT_LABELS: Record<MailSort, string> = {
  newest: '최신순',
  priority: '중요도순',
};

export type MailListPreferences = {
  query: string;
  filter: MailFilter;
  sort: MailSort;
  visibleCount: number;
};

export const DEFAULT_MAIL_LIST_PREFERENCES: MailListPreferences = {
  query: '',
  filter: 'all',
  sort: 'newest',
  visibleCount: INITIAL_MAIL_VISIBLE_COUNT,
};

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function priorityRank(priority: MailPriority): number {
  if (priority === 'critical') return 2;
  if (priority === 'important') return 1;
  return 0;
}

export function normalizeMailQuery(value: string): string {
  return normalize(value.trim());
}

export function filterMailItems(items: PrioritizedMail[], filter: MailFilter, query = ''): PrioritizedMail[] {
  const normalizedQuery = normalizeMailQuery(query);
  return items.filter((item) => {
    if (filter === 'unread' && item.isRead) return false;
    if (filter === 'important' && item.priority === 'normal') return false;
    if (filter === 'critical' && item.priority !== 'critical') return false;
    if (!normalizedQuery) return true;
    const searchable = normalize([item.subject, item.senderName, item.senderAddress].join(' '));
    return searchable.includes(normalizedQuery);
  });
}

export function sortMailItems(items: PrioritizedMail[], sort: MailSort): PrioritizedMail[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      if (sort === 'priority') {
        const priorityDifference = priorityRank(right.item.priority) - priorityRank(left.item.priority);
        if (priorityDifference) return priorityDifference;
      }
      return timestamp(right.item.receivedAt) - timestamp(left.item.receivedAt) || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function filterAndSortMailItems(
  items: PrioritizedMail[],
  options: { filter?: MailFilter; query?: string; sort?: MailSort } = {},
): PrioritizedMail[] {
  return sortMailItems(
    filterMailItems(items, options.filter || 'all', options.query || ''),
    options.sort || 'newest',
  );
}

export function clampMailVisibleCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return INITIAL_MAIL_VISIBLE_COUNT;
  return Math.min(MAX_MAIL_VISIBLE_COUNT, Math.max(INITIAL_MAIL_VISIBLE_COUNT, Math.floor(value)));
}

export function nextMailVisibleCount(value: number): number {
  return Math.min(MAX_MAIL_VISIBLE_COUNT, clampMailVisibleCount(value) + MAIL_VISIBLE_INCREMENT);
}

export function readMailListPreferences(raw: string | null): MailListPreferences {
  if (!raw) return DEFAULT_MAIL_LIST_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_MAIL_LIST_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    const filter = record.filter === 'all' || record.filter === 'unread' || record.filter === 'important' || record.filter === 'critical'
      ? record.filter
      : DEFAULT_MAIL_LIST_PREFERENCES.filter;
    const sort = record.sort === 'newest' || record.sort === 'priority' ? record.sort : DEFAULT_MAIL_LIST_PREFERENCES.sort;
    return {
      query: typeof record.query === 'string' ? record.query : DEFAULT_MAIL_LIST_PREFERENCES.query,
      filter,
      sort,
      visibleCount: clampMailVisibleCount(record.visibleCount),
    };
  } catch {
    return DEFAULT_MAIL_LIST_PREFERENCES;
  }
}
