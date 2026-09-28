import { parseInboxEntries, type InboxEntry } from './inbox';

type RecordValue = Record<string, unknown>;
type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };
const REQUEST_TIMEOUT_MS = 10_000;

export type InboxPersistenceErrorCode = 'bridge_auth' | 'bridge_offline' | 'bridge_unknown' | 'bridge_outdated' | 'malformed_response' | 'persistence_failed';

export class InboxPersistenceError extends Error {
  constructor(public readonly code: InboxPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'InboxPersistenceError';
  }
}

export function readBridgeToken(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}

function bridgeUrl(): string {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

function requestInit(token: string, method: 'GET' | 'POST', entries?: InboxEntry[], signal?: AbortSignal, entryId?: string): BridgeRequestInit {
  const init: BridgeRequestInit = {
    method,
    headers: method === 'GET'
      ? { 'X-Bridge-Token': token }
      : { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ token, ...(entries !== undefined ? { entries } : {}), ...(entryId !== undefined ? { entryId } : {}) }) } : {}),
    ...(signal ? { signal } : {}),
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }
  return init;
}

async function readResponse(response: Response): Promise<RecordValue> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
  } catch {
    return {};
  }
}

async function requestInbox(
  method: 'GET' | 'POST',
  entries: InboxEntry[] | undefined,
  token: string,
  fetchImpl: typeof fetch,
  entryId?: string,
): Promise<InboxEntry[]> {
  if (!token.trim()) {
    throw new InboxPersistenceError('bridge_auth', 'Local Bridge token이 없습니다. Settings > 로컬 브리지에서 token을 저장해야 Vault 인박스를 읽고 쓸 수 있어요.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const path = entryId === undefined ? '/inbox' : '/inbox/delete';
    const response = await fetchImpl(`${bridgeUrl()}${path}`, requestInit(token, method, entries, controller.signal, entryId));
    const data = await readResponse(response);
    if (!response.ok) {
      if (response.status === 404) {
        throw new InboxPersistenceError('bridge_unknown', 'Bridge Inbox API를 찾을 수 없어. Bridge 버전을 확인하거나 Companion을 다시 시작해줘.');
      }
      const message = typeof data.error === 'string' ? data.error : '';
      const code: InboxPersistenceErrorCode = response.status === 403
        ? 'bridge_auth'
        : response.status >= 500
          ? 'persistence_failed'
          : 'malformed_response';
      throw new InboxPersistenceError(code, message || 'Vault 인박스를 저장하지 못했어요. 브라우저 캐시는 유지됩니다.');
    }
    if (data.ok !== true || data.source !== 'vault' || data.version !== 1 || !Array.isArray(data.entries)) {
      throw new InboxPersistenceError('malformed_response', 'Vault 인박스 응답 형식을 확인할 수 없어요.');
    }
    return parseInboxEntries(data.entries);
  } catch (error) {
    if (error instanceof InboxPersistenceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new InboxPersistenceError('bridge_offline', 'Local Bridge 응답이 늦어 Vault 저장을 완료하지 못했어요. 브라우저 캐시는 유지됩니다.');
    }
    if (error instanceof TypeError) {
      throw new InboxPersistenceError('bridge_offline', 'Local Bridge에 연결할 수 없어요. 브라우저 캐시는 유지됩니다.');
    }
    throw new InboxPersistenceError('persistence_failed', 'Vault 인박스를 저장하지 못했어요. 브라우저 캐시는 유지됩니다.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export function loadPersistedInbox(token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<InboxEntry[]> {
  return requestInbox('GET', undefined, token, fetchImpl);
}

export function savePersistedInbox(entries: InboxEntry[], token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<InboxEntry[]> {
  return requestInbox('POST', entries, token, fetchImpl);
}

export function deletePersistedInboxEntry(entryId: string, token = readBridgeToken(), fetchImpl: typeof fetch = fetch): Promise<InboxEntry[]> {
  if (!entryId.trim() || entryId.length > 256) {
    return Promise.reject(new InboxPersistenceError('malformed_response', '삭제할 인박스 항목을 확인할 수 없어요.'));
  }
  return requestInbox('POST', undefined, token, fetchImpl, entryId);
}
