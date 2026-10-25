import type { Shortcut } from './shortcuts';

const REQUEST_TIMEOUT_MS = 8000;
const steamIconCache = new Map<string, Promise<string | null>>();

export async function launchExternalShortcut(shortcut: Shortcut): Promise<{ ok: boolean; message: string }> {
  try {
    const token = window.localStorage.getItem('thesisBridgeToken') || '';
    const base = process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const init: RequestInit & { targetAddressSpace?: 'loopback' } = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        type: shortcut.type,
        target: shortcut.target,
        args: shortcut.args || '',
        workingDirectory: shortcut.workingDirectory || '',
        runAsAdmin: shortcut.runAsAdmin === true,
      }),
      signal: controller.signal,
    };
    if (navigator.userAgent.startsWith('Sucrose')) init.targetAddressSpace = 'loopback';
    try {
      const response = await fetch(`${base}/launch`, init);
      const data = await response.json().catch(() => ({} as { error?: string }));
      return response.ok
        ? { ok: true, message: '실행했어.' }
        : { ok: false, message: typeof data.error === 'string' ? data.error : '로컬 브리지에서 실행하지 못했어.' };
    } finally {
      window.clearTimeout(timeout);
    }
  } catch (error) {
    if (shortcut.type === 'web') {
      window.open(shortcut.target, '_blank', 'noopener,noreferrer');
      return { ok: true, message: '' };
    }
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, message: '로컬 실행 요청 시간이 초과됐어.' };
    return { ok: false, message: '로컬 브리지가 필요해. PC에서 bridge를 실행했는지 확인해줘.' };
  }
}

export function getSteamShortcutIcon(target: string): Promise<string | null> {
  const match = target.match(/^steam:\/\/rungameid\/(\d+)\/?$/i);
  if (!match) return Promise.resolve(null);

  const appId = match[1];
  const cached = steamIconCache.get(appId);
  if (cached) return cached;

  const pending = fetch(`/api/shortcut-icon?appId=${encodeURIComponent(appId)}`, { cache: 'force-cache' })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json() as { icon?: unknown };
      return typeof data.icon === 'string' ? data.icon : null;
    })
    .catch(() => null);
  steamIconCache.set(appId, pending);
  return pending;
}
