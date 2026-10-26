import { describe, expect, it } from 'vitest';
import { isNoticeOfInterest, loadSeen, mailPriorityFromRating, markSeen } from './school-rating';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

describe('mail colour level', () => {
  it('high importance is critical, action needed is important, everything else (including no rating) is normal', () => {
    expect(mailPriorityFromRating({ importance: 'high', requires_action: false })).toBe('critical');
    expect(mailPriorityFromRating({ importance: 'high', requires_action: true })).toBe('critical');
    expect(mailPriorityFromRating({ importance: 'normal', requires_action: true })).toBe('important');
    expect(mailPriorityFromRating({ importance: 'low', requires_action: false })).toBe('normal');
    expect(mailPriorityFromRating(null)).toBe('normal');
    expect(mailPriorityFromRating(undefined)).toBe('normal');
  });
});

describe('notice interest', () => {
  it('highlights only notices the AI rated important or that need action; unrated notices stay plain', () => {
    expect(isNoticeOfInterest({ importance: 'high', requires_action: false })).toBe(true);
    expect(isNoticeOfInterest({ importance: 'normal', requires_action: true })).toBe(true);
    expect(isNoticeOfInterest({ importance: 'normal', requires_action: false })).toBe(false);
    expect(isNoticeOfInterest({ importance: 'low', requires_action: false })).toBe(false);
    expect(isNoticeOfInterest(null)).toBe(false);
  });
});

describe('seen state (this device only)', () => {
  it('remembers opened ids per list and survives missing or broken storage', () => {
    const store = memory();
    expect(loadSeen('school-mail', store).size).toBe(0);
    markSeen('school-mail', 'a', store);
    const seen = markSeen('school-mail', 'b', store);
    expect([...seen].sort()).toEqual(['a', 'b']);
    expect([...loadSeen('school-mail', store)].sort()).toEqual(['a', 'b']);
    expect(loadSeen('other', store).size).toBe(0);
    expect(loadSeen('school-mail', null).size).toBe(0);
    store.setItem('mtos.seen.v1', '{not json');
    expect(loadSeen('school-mail', store).size).toBe(0);
    expect(markSeen('school-mail', 'c', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } }).has('c')).toBe(true);
  });
});
