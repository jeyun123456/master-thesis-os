import type { MailPriority } from './mail-priority';

type Rating = { importance?: string | null; requires_action?: boolean | null } | null | undefined;

/** Mail colour level from the AI's stored rating: high importance -> critical, action needed -> important, else normal. */
export function mailPriorityFromRating(rating: Rating): MailPriority {
  if (!rating) return 'normal';
  if (rating.importance === 'high') return 'critical';
  if (rating.requires_action) return 'important';
  return 'normal';
}

/** A notice is highlighted as "of interest" when the AI rated it important or something has to be done about it. */
export function isNoticeOfInterest(rating: Rating): boolean {
  return Boolean(rating && (rating.importance === 'high' || rating.requires_action));
}

const SEEN_KEY = 'mtos.seen.v1';
const MAX_SEEN = 2000;

type SeenStore = Pick<Storage, 'getItem' | 'setItem'>;

function safeStore(): SeenStore | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * Items opened in this app on this device. It only affects how the list looks here: nothing is written to the
 * mailbox, so Thunderbird/Outlook/Gmail keep their own read state.
 */
export function loadSeen(kind: string, store: SeenStore | null = safeStore()): Set<string> {
  try {
    const all = JSON.parse(store?.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>;
    const list = all[kind];
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch { return new Set(); }
}

export function markSeen(kind: string, id: string, store: SeenStore | null = safeStore()): Set<string> {
  const seen = loadSeen(kind, store);
  seen.add(id);
  try {
    const all = JSON.parse(store?.getItem(SEEN_KEY) ?? '{}') as Record<string, unknown>;
    all[kind] = [...seen].slice(-MAX_SEEN);
    store?.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the in-memory set still works for this visit */ }
  return seen;
}
