import rawShortcuts from '../config/shortcuts.json';
import { isSafeRepositoryPath } from './repository';

export type ShortcutType = 'web' | 'app' | 'file' | 'folder' | 'command';

export type Shortcut = {
  id: string;
  title: string;
  type: ShortcutType;
  target: string;
  description?: string;
  icon?: string;
  args?: string;
  workingDirectory?: string;
  runAsAdmin?: boolean;
  pinnedToHome: boolean;
  enabled: boolean;
  order: number;
};

const shortcutTypes = new Set<ShortcutType>(['web', 'app', 'file', 'folder', 'command']);
const SHORTCUT_STORAGE_KEY = 'masterThesisOs.shortcuts.v2';

export function parseShortcuts(input: unknown): Shortcut[] {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set<string>();
  return input.flatMap((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.title !== 'string' || !value.title.trim() || typeof value.target !== 'string' || !shortcutTypes.has(value.type as ShortcutType)) return [];
    const id = value.id.trim();
    if (seenIds.has(id)) return [];
    seenIds.add(id);
    const type = value.type as ShortcutType;
    const target = value.target.trim();
    if (!validTarget(type, target)) return [];
    const workingDirectory = optionalString(value.workingDirectory);
    if (workingDirectory && !isAbsoluteLocalTarget(workingDirectory)) return [];
    return [{
      id,
      title: value.title.trim(),
      type,
      target,
      description: optionalString(value.description),
      icon: optionalString(value.icon),
      args: optionalString(value.args),
      workingDirectory,
      runAsAdmin: value.runAsAdmin === true,
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

export function isAbsoluteLocalTarget(target: string) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(target.trim());
}

export function isRepositoryShortcut(shortcut: Shortcut) {
  return (shortcut.type === 'file' || shortcut.type === 'folder') && !isAbsoluteLocalTarget(shortcut.target);
}

export function detectShortcutType(target: string): ShortcutType {
  const value = target.trim();
  if (/^https?:\/\//i.test(value)) return 'web';
  if (/\.exe(?:$|\s)/i.test(value)) return 'app';
  const leaf = value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  if (value.endsWith('\\') || value.endsWith('/') || (isAbsoluteLocalTarget(value) && !leaf.includes('.'))) return 'folder';
  return 'file';
}

export function shortcutTitleFromTarget(target: string, type: ShortcutType) {
  const value = target.trim();
  if (!value) return '';
  if (type === 'web') {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return value;
    }
  }
  if (type === 'command') return value.length > 28 ? `${value.slice(0, 28)}…` : value;
  const leaf = value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || value;
  return type === 'app' ? leaf.replace(/\.exe$/i, '') : leaf;
}

export function loadShortcutState(fallback: Shortcut[]): Shortcut[] {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (!stored) return fallback;
    const raw = JSON.parse(stored);
    return Array.isArray(raw) ? parseShortcuts(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveShortcutState(items: Shortcut[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Embedded browser storage can be unavailable. Keep the in-memory state usable.
  }
}

function validTarget(type: ShortcutType, target: string) {
  if (type === 'web') {
    try {
      const url = new URL(target);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
  if (type === 'command') return target.length > 0;
  if (type === 'app') return isAbsoluteLocalTarget(target);
  if (type === 'folder' && target === '') return true;
  if (isAbsoluteLocalTarget(target)) return true;
  return isSafeRepositoryPath(target);
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
