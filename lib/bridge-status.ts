export const BRIDGE_OFFLINE_MESSAGE = 'Bridge offline: 로컬 브리지가 실행 중인지 확인해줘.';
export const BRIDGE_TIMEOUT_MESSAGE = 'Bridge timeout: 로컬 브리지가 5초 안에 응답하지 않았어.';
export const SUPPORTED_LOCAL_BRIDGE_API_VERSION = 5;

export type BridgeApiVersionCheck =
  | { state: 'compatible'; apiVersion: number }
  | { state: 'outdated'; apiVersion: number }
  | { state: 'unknown'; apiVersion: null }
  | { state: 'offline' };

type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

export function bridgeApiVersionMismatchMessage(apiVersion: number): string {
  return `Companion Bridge 업데이트 필요: 현재 v${apiVersion}, 앱은 v${SUPPORTED_LOCAL_BRIDGE_API_VERSION} 이상을 요구해. Companion을 업데이트한 뒤 다시 시작해줘.`;
}

export class BridgeApiVersionMismatchError extends Error {
  constructor(public readonly apiVersion: number) {
    super(bridgeApiVersionMismatchMessage(apiVersion));
    this.name = 'BridgeApiVersionMismatchError';
  }
}

export async function checkLocalBridgeApiVersion(fetchImpl: typeof fetch = fetch): Promise<BridgeApiVersionCheck> {
  const base = (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  const init: BridgeRequestInit = { method: 'GET', cache: 'no-store', signal: controller.signal };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }

  try {
    const response = await fetchImpl(`${base}/health`, init);
    if (!response.ok) return { state: 'unknown', apiVersion: null };
    let data: unknown;
    try { data = await response.json(); } catch { return { state: 'unknown', apiVersion: null }; }
    const apiVersion = typeof data === 'object' && data !== null && 'apiVersion' in data
      && Number.isInteger(data.apiVersion)
      ? data.apiVersion as number
      : null;
    if (apiVersion === null) return { state: 'unknown', apiVersion: null };
    return apiVersion < SUPPORTED_LOCAL_BRIDGE_API_VERSION
      ? { state: 'outdated', apiVersion }
      : { state: 'compatible', apiVersion };
  } catch {
    return { state: 'offline' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function bridgeResponseMessage(status: number, error: unknown): string {
  const code = typeof error === 'string' ? error : '';
  if (status === 403 && code === 'origin not allowed') return 'Origin blocked: bridge allowed_origins에 Vercel 주소를 추가해줘.';
  if (status === 403 && code === 'invalid token') return 'Invalid token: Settings의 bridge token을 확인해줘.';
  if (status === 404 && code === 'local file not found') return 'Local file not found: 로컬 파일 경로를 확인해줘.';
  return 'Bridge request failed: 로컬 브리지 요청이 거부됐어.';
}
