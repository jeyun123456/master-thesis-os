import type { Shortcut } from './shortcuts';

const CHANNEL = 'master-thesis-os.shortcuts.v1';
const REQUEST_TIMEOUT_MS = 8000;

type WebViewMessageEvent = { data: unknown };
type WebViewBridge = {
  postMessage: (message: unknown) => void;
  addEventListener: (name: 'message', listener: (event: WebViewMessageEvent) => void) => void;
  removeEventListener: (name: 'message', listener: (event: WebViewMessageEvent) => void) => void;
};

type HostResponse = {
  channel?: string;
  requestId?: string;
  ok?: boolean;
  error?: string;
  path?: string;
  icon?: string;
};

export type PickShortcutResult = {
  available: boolean;
  path?: string;
  icon?: string;
  error?: string;
};

export async function pickShortcutTarget(kind: 'app' | 'file' | 'folder'): Promise<PickShortcutResult> {
  const response = await requestHost('pick', { kind });
  if (!response) return { available: false };
  if (!response.ok) return { available: true, error: response.error || '대상을 선택하지 못했어.' };
  return { available: true, path: response.path, icon: response.icon };
}

export async function launchExternalShortcut(shortcut: Shortcut): Promise<{ ok: boolean; message: string }> {
  const hostResponse = await requestHost('execute', { shortcut });
  if (hostResponse) {
    return hostResponse.ok
      ? { ok: true, message: '실행했어.' }
      : { ok: false, message: hostResponse.error || 'Windows에서 실행하지 못했어.' };
  }

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
    if (error instanceof DOMException && error.name === 'AbortError') return { ok: false, message: '로컬 실행 요청 시간이 초과됐어.' };
    return { ok: false, message: 'Windows Wallpaper Host 또는 로컬 브리지가 필요해.' };
  }
}

function getWebView(): WebViewBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as unknown as { chrome?: { webview?: WebViewBridge } };
  return candidate.chrome?.webview || null;
}

function requestHost(action: 'pick' | 'execute', payload: Record<string, unknown>): Promise<HostResponse | null> {
  const webview = getWebView();
  if (!webview) return Promise.resolve(null);
  const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: HostResponse | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      webview.removeEventListener('message', listener);
      resolve(response);
    };
    const listener = (event: WebViewMessageEvent) => {
      const data = event.data as HostResponse | null;
      if (!data || data.channel !== CHANNEL || data.requestId !== requestId) return;
      finish(data);
    };
    const timeout = window.setTimeout(() => finish({ channel: CHANNEL, requestId, ok: false, error: 'Windows Host 응답 시간이 초과됐어.' }), REQUEST_TIMEOUT_MS);
    webview.addEventListener('message', listener);
    webview.postMessage({ channel: CHANNEL, requestId, action, ...payload });
  });
}
