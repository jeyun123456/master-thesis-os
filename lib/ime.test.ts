import { describe, expect, it } from 'vitest';
import { searchKeyAction, shouldHandleGlobalShortcut } from './ime';

describe('IME-safe keyboard handling', () => {
  it('suppresses search shortcuts while composing Korean or Japanese text', () => {
    expect(searchKeyAction('Enter', true)).toBe('ignore');
    expect(searchKeyAction('Escape', true)).toBe('ignore');
    expect(shouldHandleGlobalShortcut(true)).toBe(false);
  });

  it('handles completed input normally', () => {
    expect(searchKeyAction('Enter', false)).toBe('submit');
    expect(searchKeyAction('Escape', false)).toBe('clear');
    expect(shouldHandleGlobalShortcut(false)).toBe(true);
  });
});
