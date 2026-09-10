export type SearchKeyAction = 'ignore' | 'submit' | 'clear' | 'none';

export function searchKeyAction(key: string, isComposing: boolean): SearchKeyAction {
  if (isComposing) return 'ignore';
  if (key === 'Enter') return 'submit';
  if (key === 'Escape') return 'clear';
  return 'none';
}

export function shouldHandleGlobalShortcut(isComposing: boolean) {
  return !isComposing;
}
