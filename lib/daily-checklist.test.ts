import { describe, expect, it } from 'vitest';
import {
  createDailyChecklist,
  DAILY_CHECKLIST_STORAGE_KEY,
  dailyChecklistCompletedCount,
  loadDailyChecklist,
  saveDailyChecklist,
  seoulDateKey,
  setDailyChecklistItem,
} from './daily-checklist';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('daily checklist', () => {
  it('uses the Seoul calendar day across a UTC date boundary', () => {
    expect(seoulDateKey(new Date('2026-09-27T14:59:59.000Z'))).toBe('2026-09-27');
    expect(seoulDateKey(new Date('2026-09-27T15:00:00.000Z'))).toBe('2026-09-28');
  });

  it('persists manual checks for today and resets them on the next date', () => {
    const storage = memoryStorage();
    const today = setDailyChecklistItem(createDailyChecklist('2026-09-28'), 'mailSync', true);
    expect(saveDailyChecklist(today, storage)).toBe(true);
    expect(loadDailyChecklist(storage, '2026-09-28')).toEqual(today);
    expect(loadDailyChecklist(storage, '2026-09-29')).toEqual(createDailyChecklist('2026-09-29'));
  });

  it('supports manual toggles and computes a quiet completion count', () => {
    const start = createDailyChecklist('2026-09-28');
    const checked = setDailyChecklistItem(start, 'todaySchedule', true);
    const unchecked = setDailyChecklistItem(checked, 'todaySchedule', false);
    expect(checked.items.todaySchedule).toBe(true);
    expect(unchecked.items.todaySchedule).toBe(false);
    expect(dailyChecklistCompletedCount(setDailyChecklistItem(checked, 'portalSync', true))).toBe(2);
  });

  it('keeps the checklist key scoped to the Chocomint Lab app', () => {
    expect(DAILY_CHECKLIST_STORAGE_KEY).toBe('chocomintLab.daily-check.v1');
  });
});
