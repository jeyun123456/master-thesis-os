export const INBOX_STORAGE_KEY = 'chocomintLab.inbox.v1';
export const INBOX_MAX_RAW_CHARS = 1200;
export const INBOX_AI_BATCH_SIZE = 4;

export const INBOX_CATEGORIES = ['Todo', 'Idea', 'Research Note', 'Later / Reference'] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

export type InboxSuggestion = {
  entryId: string;
  category: InboxCategory;
  title: string;
  summary: string;
  nextAction: string;
  dueDate: string | null;
  relatedEntryIds: string[];
};

export type InboxAIResult = InboxSuggestion & { processedAt: string };

export type InboxEntry = {
  id: string;
  rawText: string;
  createdAt: string;
  processed: boolean;
  ai: InboxAIResult | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInboxCategory(value: unknown): value is InboxCategory {
  return INBOX_CATEGORIES.includes(value as InboxCategory);
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeAIResult(value: unknown, entryId: string): InboxAIResult | null {
  if (!isRecord(value) || !isInboxCategory(value.category)) return null;
  const relatedEntryIds = Array.isArray(value.relatedEntryIds)
    ? value.relatedEntryIds.filter((id): id is string => typeof id === 'string' && id !== entryId).slice(0, 4)
    : [];
  return {
    entryId,
    category: value.category,
    title: typeof value.title === 'string' ? value.title : '',
    summary: typeof value.summary === 'string' ? value.summary : '',
    nextAction: typeof value.nextAction === 'string' ? value.nextAction : '',
    dueDate: typeof value.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) ? value.dueDate : null,
    relatedEntryIds,
    processedAt: typeof value.processedAt === 'string' ? value.processedAt : '',
  };
}

export function parseInboxEntries(value: unknown): InboxEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): InboxEntry[] => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.rawText !== 'string' || !raw.rawText || typeof raw.createdAt !== 'string') return [];
    const ai = normalizeAIResult(raw.ai, raw.id);
    return [{
      id: raw.id,
      rawText: raw.rawText,
      createdAt: raw.createdAt,
      processed: Boolean(raw.processed && ai),
      ai: raw.processed ? ai : null,
    }];
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Merge the Vault source with the browser cache without replacing canonical raw fields. */
export function mergeInboxEntries(persistent: InboxEntry[], cached: InboxEntry[]): InboxEntry[] {
  const merged = new Map(persistent.map((entry) => [entry.id, entry]));

  for (const cachedEntry of cached) {
    const persistedEntry = merged.get(cachedEntry.id);
    if (!persistedEntry) {
      merged.set(cachedEntry.id, cachedEntry);
      continue;
    }

    const cachedAIIsNewer = cachedEntry.processed
      && cachedEntry.ai !== null
      && (!persistedEntry.processed
        || persistedEntry.ai === null
        || Date.parse(cachedEntry.ai.processedAt) > Date.parse(persistedEntry.ai.processedAt));
    merged.set(cachedEntry.id, {
      ...persistedEntry,
      ...(cachedAIIsNewer ? { processed: true, ai: cachedEntry.ai } : {}),
    });
  }

  return Array.from(merged.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadInboxEntries(storage?: StorageLike): InboxEntry[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const serialized = target.getItem(INBOX_STORAGE_KEY);
    return serialized ? parseInboxEntries(JSON.parse(serialized) as unknown) : [];
  } catch {
    return [];
  }
}

export function saveInboxEntries(entries: InboxEntry[], storage?: StorageLike): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(INBOX_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export function createInboxEntry(rawText: string, now = new Date(), id = createId()): InboxEntry {
  if (!rawText.trim()) throw new Error('인박스에 저장할 내용을 입력해줘.');
  if (rawText.length > INBOX_MAX_RAW_CHARS) throw new Error(`한 항목은 ${INBOX_MAX_RAW_CHARS}자까지 저장할 수 있어.`);
  return { id, rawText, createdAt: now.toISOString(), processed: false, ai: null };
}

export function applyInboxSuggestions(
  entries: InboxEntry[],
  suggestions: InboxSuggestion[],
  now = new Date(),
): InboxEntry[] {
  const byId = new Map(suggestions.map((suggestion) => [suggestion.entryId, suggestion]));
  const entryIds = new Set(entries.map((entry) => entry.id));
  const processedAt = now.toISOString();
  return entries.map((entry) => {
    const suggestion = byId.get(entry.id);
    if (!suggestion) return entry;
    const ai: InboxAIResult = {
      ...suggestion,
      entryId: entry.id,
      nextAction: suggestion.category === 'Todo' ? suggestion.nextAction : '',
      dueDate: suggestion.dueDate,
      relatedEntryIds: suggestion.relatedEntryIds.filter((id) => id !== entry.id && entryIds.has(id)).slice(0, 4),
      processedAt,
    };
    return { ...entry, processed: true, ai };
  });
}
