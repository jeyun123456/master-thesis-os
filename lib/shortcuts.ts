import rawShortcuts from '../config/shortcuts.json';
import { isSafeRepositoryPath } from './repository';

export type ShortcutType = 'web' | 'file' | 'folder';

export type Shortcut = {
  id: string;
  title: string;
  type: ShortcutType;
  target: string;
  description?: string;
  icon?: string;
  pinnedToHome: boolean;
  enabled: boolean;
  order: number;
};

const shortcutTypes = new Set<ShortcutType>(['web', 'file', 'folder']);

export function parseShortcuts(input: unknown): Shortcut[] {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set<string>();
  return input.flatMap((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.title !== 'string' || !value.title.trim() || typeof value.target !== 'string' || !shortcutTypes.has(value.type as ShortcutType)) return [];
    const id = value.id.trim();
    if (seenIds.has(id)) return [];
    seenIds.add(id);
    const type = value.type as ShortcutType;
    if (type === 'web') {
      try {
        const url = new URL(value.target);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
      } catch {
        return [];
      }
    } else if (type === 'file' ? !isSafeRepositoryPath(value.target) : value.target !== '' && !isSafeRepositoryPath(value.target)) {
      return [];
    }
    return [{
      id,
      title: value.title.trim(),
      type,
      target: value.target,
      description: optionalString(value.description),
      icon: optionalString(value.icon),
      pinnedToHome: value.pinnedToHome === true,
      enabled: value.enabled !== false,
      order: typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : index,
    }];
  }).sort(compareShortcuts);
}

export const shortcuts = parseShortcuts(rawShortcuts);

export function getEnabledShortcuts(items: Shortcut[] = shortcuts): Shortcut[] {
  return items.filter((item) => item.enabled).sort(compareShortcuts);
}

export function getHomeShortcuts(items: Shortcut[] = shortcuts): Shortcut[] {
  return getEnabledShortcuts(items).filter((item) => item.pinnedToHome);
}

function compareShortcuts(a: Shortcut, b: Shortcut) {
  return a.order - b.order || compareText(a.title, b.title) || compareText(a.id, b.id);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
