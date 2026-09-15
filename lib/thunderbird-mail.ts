export type MailSource = 'thunderbird' | 'microsoft-graph' | 'none';

export type ThunderbirdMail = {
  id: string;
  subject: string;
  senderName: string;
  senderAddress: string;
  receivedAt: string;
  isRead: boolean;
  messageId?: string;
};

export type ThunderbirdMailErrorCode =
  | 'bridge_offline'
  | 'bridge_auth'
  | 'thunderbird_not_installed'
  | 'profile_not_found'
  | 'account_not_found'
  | 'inbox_not_found'
  | 'local_sync_required'
  | 'unsupported_store'
  | 'parse_error'
  | 'malformed_response';

export class ThunderbirdMailError extends Error {
  constructor(public readonly code: ThunderbirdMailErrorCode, message: string) {
    super(message);
    this.name = 'ThunderbirdMailError';
  }
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 5000;

const ERROR_MESSAGES: Record<ThunderbirdMailErrorCode, string> = {
  bridge_offline: 'Local Bridge가 실행 중인지 확인해줘.',
  bridge_auth: 'Local Bridge token을 확인해줘.',
  thunderbird_not_installed: 'Thunderbird 설치를 찾지 못했어.',
  profile_not_found: 'Thunderbird profile을 찾지 못했어.',
  account_not_found: 'Thunderbird 학교 계정을 찾지 못했어.',
  inbox_not_found: 'Thunderbird 받은편지함을 찾지 못했어.',
  local_sync_required: 'Thunderbird에서 이 계정의 메시지를 이 컴퓨터에 보관해줘.',
  unsupported_store: 'Thunderbird 로컬 메일 저장 방식을 아직 읽을 수 없어.',
  parse_error: 'Thunderbird 메일 헤더를 읽지 못했어.',
  malformed_response: 'Local Bridge 메일 응답 형식을 확인할 수 없어.',
};

type RecordValue = Record<string, unknown>;
type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(code: ThunderbirdMailErrorCode): string {
  return ERROR_MESSAGES[code];
}

function isValidDate(value: string): boolean {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function readErrorCode(value: unknown, status: number): ThunderbirdMailErrorCode {
  const code = stringValue(value).toLocaleLowerCase();
  if (code === 'invalid token' || code === 'bridge_auth' || status === 403) return 'bridge_auth';
  if (code === 'thunderbird_not_installed') return 'thunderbird_not_installed';
  if (code === 'profile_not_found') return 'profile_not_found';
  if (code === 'account_not_found') return 'account_not_found';
  if (code === 'inbox_not_found') return 'inbox_not_found';
  if (code === 'local_sync_required') return 'local_sync_required';
  if (code === 'unsupported_store') return 'unsupported_store';
  if (code === 'parse_error') return 'parse_error';
  if (status === 404 || status === 408 || status >= 500) return 'bridge_offline';
  return 'malformed_response';
}

export function thunderbirdMailErrorMessage(code: ThunderbirdMailErrorCode): string {
  return errorMessage(code);
}

export function normalizeThunderbirdMail(raw: unknown): ThunderbirdMail {
  if (!isRecord(raw)) {
    throw new ThunderbirdMailError('malformed_response', errorMessage('malformed_response'));
  }
  const id = stringValue(raw.id);
  const receivedAt = stringValue(raw.receivedAt);
  if (!id || !isValidDate(receivedAt)) {
    throw new ThunderbirdMailError('malformed_response', errorMessage('malformed_response'));
  }
  const messageId = stringValue(raw.messageId);
  return {
    id,
    subject: stringValue(raw.subject) || '(제목 없음)',
    senderName: stringValue(raw.senderName) || '(발신자 알 수 없음)',
    senderAddress: stringValue(raw.senderAddress),
    receivedAt,
    isRead: raw.isRead === true,
    ...(messageId ? { messageId } : {}),
  };
}

export function normalizeThunderbirdMailResponse(raw: unknown): { account: string; items: ThunderbirdMail[] } {
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'thunderbird' || !Array.isArray(raw.items)) {
    throw new ThunderbirdMailError('malformed_response', errorMessage('malformed_response'));
  }
  const items = raw.items
    .map(normalizeThunderbirdMail)
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
    .slice(0, MAX_LIMIT);
  return { account: stringValue(raw.account), items };
}

function requestInit(body: Record<string, unknown>, signal: AbortSignal): BridgeRequestInit {
  const init: BridgeRequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }
  return init;
}

function bridgeUrl(): string {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new ThunderbirdMailError('malformed_response', errorMessage('malformed_response'));
  }
}

async function requestBridge(
  endpoint: '/mail/recent' | '/mail/open',
  token: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!token.trim()) {
    throw new ThunderbirdMailError('bridge_auth', errorMessage('bridge_auth'));
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${bridgeUrl()}${endpoint}`, requestInit({ token, ...body }, controller.signal));
    const data = await readJson(response);
    if (!response.ok) {
      const error = isRecord(data) ? data.error : undefined;
      throw new ThunderbirdMailError(readErrorCode(error, response.status), errorMessage(readErrorCode(error, response.status)));
    }
    return data;
  } catch (error) {
    if (error instanceof ThunderbirdMailError) throw error;
    throw new ThunderbirdMailError('bridge_offline', errorMessage('bridge_offline'));
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getRecentThunderbirdMail(
  token: string,
  fetchImpl: typeof fetch = fetch,
  limit = DEFAULT_LIMIT,
): Promise<{ account: string; items: ThunderbirdMail[] }> {
  const raw = await requestBridge('/mail/recent', token, { limit: Math.max(1, Math.min(MAX_LIMIT, limit)) }, fetchImpl);
  return normalizeThunderbirdMailResponse(raw);
}

export async function openThunderbird(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const raw = await requestBridge('/mail/open', token, {}, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'thunderbird') {
    throw new ThunderbirdMailError('malformed_response', errorMessage('malformed_response'));
  }
}
