export const BRIDGE_OFFLINE_MESSAGE = 'Bridge offline: 로컬 브리지가 실행 중인지 확인해줘.';
export const BRIDGE_TIMEOUT_MESSAGE = 'Bridge timeout: 로컬 브리지가 5초 안에 응답하지 않았어.';
export const SUPPORTED_LOCAL_BRIDGE_API_VERSION = 2;

export type BridgeApiVersionCheck =
  | { state: 'current'; apiVersion: number }
  | { state: 'mismatch'; apiVersion: number | null }
  | { state: 'unavailable' };

type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

export function bridgeApiVersionMismatchMessage(apiVersion: number | null): string {
  const reported = apiVersion === null ? '확인할 수 없음' : `v${apiVersion}`;
  return `Local Bridge API 버전이 앱(v${SUPPORTED_LOCAL_BRIDGE_API_VERSION})과 맞지 않습니다. 현재 Bridge: ${reported}. Companion/Local Bridge를 업데이트한 뒤 다시 시작해 주세요.`;
}

export class BridgeApiVersionMismatchError extends Error {
  constructor(public readonly apiVersion: number | null) {
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
    if (response.status === 404) return { state: 'mismatch', apiVersion: null };
    if (!response.ok) return { state: 'unavailable' };
    const data: unknown = await response.json();
    const apiVersion = typeof data === 'object' && data !== null && 'apiVersion' in data
      && Number.isInteger(data.apiVersion)
      ? data.apiVersion as number
      : null;
    return apiVersion === SUPPORTED_LOCAL_BRIDGE_API_VERSION
      ? { state: 'current', apiVersion }
      : { state: 'mismatch', apiVersion };
  } catch {
    return { state: 'unavailable' };
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
