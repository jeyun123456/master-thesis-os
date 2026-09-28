export const DAILY_CHECKLIST_STORAGE_KEY = 'chocomintLab.daily-check.v1';

export const DAILY_CHECKLIST_ITEM_IDS = ['mailSync', 'portalSync', 'todaySchedule'] as const;
export type DailyChecklistItemId = (typeof DAILY_CHECKLIST_ITEM_IDS)[number];

export type DailyChecklistRecord = {
  date: string;
  items: Record<DailyChecklistItemId, boolean>;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function seoulDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function createDailyChecklist(date = seoulDateKey()): DailyChecklistRecord {
  return { date, items: { mailSync: false, portalSync: false, todaySchedule: false } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadDailyChecklist(storage?: StorageLike, date = seoulDateKey()): DailyChecklistRecord {
  const target = resolveStorage(storage);
  if (!target) return createDailyChecklist(date);
  try {
    const serialized = target.getItem(DAILY_CHECKLIST_STORAGE_KEY);
    if (!serialized) return createDailyChecklist(date);
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.date !== date || !isRecord(value.items)) return createDailyChecklist(date);
    return {
      date,
      items: {
        mailSync: value.items.mailSync === true,
        portalSync: value.items.portalSync === true,
        todaySchedule: value.items.todaySchedule === true,
      },
    };
  } catch {
    return createDailyChecklist(date);
  }
}

export function saveDailyChecklist(record: DailyChecklistRecord, storage?: StorageLike): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(DAILY_CHECKLIST_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function setDailyChecklistItem(
  record: DailyChecklistRecord,
  item: DailyChecklistItemId,
  checked: boolean,
): DailyChecklistRecord {
  return { ...record, items: { ...record.items, [item]: checked } };
}

export function dailyChecklistCompletedCount(record: DailyChecklistRecord): number {
  return DAILY_CHECKLIST_ITEM_IDS.filter((id) => record.items[id]).length;
}
