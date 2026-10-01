import '../app/inbox-workflow-test-safety';
import { describe, expect, it } from 'vitest';
import { applyInboxSuggestions, createInboxEntry, INBOX_STORAGE_KEY, loadInboxEntries, saveInboxEntries } from './inbox';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('inbox', () => {
  it('persists the raw entry and timestamp in local storage', () => {
    const storage = memoryStorage();
    const entry = createInboxEntry('  실질보수 그래프 다시 확인  ', new Date('2026-09-28T08:00:00.000Z'), 'entry-1');

    expect(saveInboxEntries([entry], storage)).toBe(true);
    expect(storage.getItem(INBOX_STORAGE_KEY)).toContain(entry.rawText);
    expect(loadInboxEntries(storage)).toEqual([entry]);
  });

  it('adds AI results beside the original text without replacing it', () => {
    const entry = createInboxEntry('교수님께 결과 보내야 함', new Date('2026-09-28T08:00:00.000Z'), 'entry-2');
    const [updated] = applyInboxSuggestions([entry], [{
      entryId: 'entry-2',
      category: 'Todo',
      title: '교수님께 결과 보내기',
      summary: '결과를 교수님께 전달한다.',
      nextAction: '최신 결과 파일을 확인해 보낸다.',
      dueDate: null,
      relatedEntryIds: ['entry-2', 'missing'],
    }], new Date('2026-09-28T09:00:00.000Z'));

    expect(updated.rawText).toBe(entry.rawText);
    expect(updated).toMatchObject({
      processed: true,
      ai: {
        category: 'Todo',
        title: '교수님께 결과 보내기',
        nextAction: '최신 결과 파일을 확인해 보낸다.',
        dueDate: null,
        relatedEntryIds: [],
        processedAt: '2026-09-28T09:00:00.000Z',
      },
    });
  });

  it('keeps malformed storage data from breaking inbox loading', () => {
    const storage = memoryStorage();
    storage.setItem(INBOX_STORAGE_KEY, '{not json');
    expect(loadInboxEntries(storage)).toEqual([]);
  });
});
