export type PortalNoticeType = 'ALL' | 'DM';
export type PortalSyncState = 'idle' | 'running' | 'completed' | 'failed';
export type PortalSessionState = 'login_required' | 'session_expired' | 'saved' | 'unknown';

type RecordValue = Record<string, unknown>;
type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

const REQUEST_TIMEOUT_MS = 10_000;

export interface PortalNoticeAttachment {
  id: string;
  noticeId: string;
  filename: string;
  url: string;
}

export interface PortalNoticeDepartment {
  value: string;
  name: string;
  count: number;
  counts: { ALL: number; DM: number };
}

export interface PortalNoticeStatePatch {
  isRead?: boolean;
  isImportant?: boolean;
  isArchived?: boolean;
}

export interface PortalNoticeSummary {
  noticeId: string;
  type: PortalNoticeType;
  title: string;
  department: string;
  publishedAt: string;
  expiresAt: string;
  deadline: string;
  importance: string;
  category: string;
  sourceUrl: string;
  syncedAt: string;
  lastChangedAt: string | null;
  changeCount: number;
  isRead: boolean;
  isImportant: boolean;
  isArchived: boolean;
  firstSeenAt: string;
  readAt: string | null;
  stateUpdatedAt: string;
  attachments: PortalNoticeAttachment[];
  /** Full body text kept only for local list searching; detail rendering uses `body`. */
  searchText?: string;
}

export interface PortalNotice extends PortalNoticeSummary {
  body: string;
}

export interface PortalSyncStatus {
  source: 'ritsumei';
  lastSyncAt: string | null;
  status: PortalSyncState;
  storedCount: number;
  counts: { ALL: number; DM: number };
  totalCount: number;
  newCount: number;
  updatedCount: number;
  detailFailedCount: number;
  lastErrorCode?: string;
  lastError?: string;
  session?: { state: PortalSessionState };
  jobRunning?: boolean;
  jobKind?: 'sync' | 'login';
  jobError?: string;
  jobErrorCode?: string;
  history?: PortalSyncRun[];
}

export interface PortalSyncRun {
  syncId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'completed' | 'failed';
  totalCount: number;
  newCount: number;
  updatedCount: number;
  detailCount: number;
  detailFailedCount: number;
  errorCode: string | null;
  error: string | null;
}

export type PortalClientErrorCode =
  | 'bridge_offline'
  | 'bridge_auth'
  | 'malformed_response'
  | 'server_error'
  | 'login_required'
  | 'session_expired'
  | 'portal_unreachable'
  | 'parsing_failed'
  | 'notice_detail_failed'
  | 'database_error'
  | 'sync_interrupted'
  | 'sync_already_running'
  | 'portal_job_already_running';

export class PortalNoticesClientError extends Error {
  constructor(public readonly code: PortalClientErrorCode | string, message: string) {
    super(message);
    this.name = 'PortalNoticesClientError';
  }
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1;
}

function bridgeUrl(): string {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

function requestInit(
  token: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | undefined,
  signal: AbortSignal,
): BridgeRequestInit {
  const init: BridgeRequestInit = {
    method,
    headers: method === 'GET' ? { 'X-Bridge-Token': token } : { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify({ token, ...body }) } : method === 'POST' ? { body: JSON.stringify({ token }) } : {}),
    signal,
  };
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }
  return init;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new PortalNoticesClientError('malformed_response', '학교 공지 응답을 읽지 못했어.');
  }
}

async function requestBridge(
  endpoint: string,
  token: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!token.trim()) throw new PortalNoticesClientError('bridge_auth', 'Settings에서 Local Bridge token을 확인해줘.');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${bridgeUrl()}${endpoint}`, requestInit(token, method, body, controller.signal));
    const data = await readJson(response);
    if (!response.ok) {
      const errorValue = isRecord(data) ? textValue(data.error) : '';
      const code = isRecord(data) && textValue(data.errorCode)
        ? textValue(data.errorCode)
        : response.status === 403
          ? 'bridge_auth'
          : response.status >= 500
            ? 'bridge_offline'
            : 'server_error';
      throw new PortalNoticesClientError(code, errorValue || '학교 공지 요청을 처리하지 못했어.');
    }
    return data;
  } catch (error) {
    if (error instanceof PortalNoticesClientError) throw error;
    throw new PortalNoticesClientError('bridge_offline', 'Local Bridge가 실행 중인지 확인해줘.');
  } finally {
    clearTimeout(timeoutId);
  }
}

function noticeType(value: unknown): PortalNoticeType {
  return value === 'DM' ? 'DM' : 'ALL';
}

function normalizeAttachment(raw: unknown): PortalNoticeAttachment {
  const value = isRecord(raw) ? raw : {};
  return {
    id: textValue(value.id),
    noticeId: textValue(value.noticeId),
    filename: textValue(value.filename),
    url: textValue(value.url),
  };
}

function normalizeNotice(raw: unknown, includeBody: boolean): PortalNoticeSummary | PortalNotice {
  const value = isRecord(raw) ? raw : {};
  const base: PortalNoticeSummary = {
    noticeId: textValue(value.noticeId),
    type: noticeType(value.type),
    title: textValue(value.title),
    department: textValue(value.department),
    publishedAt: textValue(value.publishedAt),
    expiresAt: textValue(value.expiresAt),
    deadline: textValue(value.deadline),
    importance: textValue(value.importance),
    category: textValue(value.category),
    sourceUrl: textValue(value.sourceUrl),
    syncedAt: textValue(value.syncedAt),
    lastChangedAt: typeof value.lastChangedAt === 'string' ? value.lastChangedAt : null,
    changeCount: numberValue(value.changeCount),
    isRead: booleanValue(value.isRead),
    isImportant: booleanValue(value.isImportant),
    isArchived: booleanValue(value.isArchived),
    firstSeenAt: textValue(value.firstSeenAt),
    readAt: typeof value.readAt === 'string' ? value.readAt : null,
    stateUpdatedAt: textValue(value.stateUpdatedAt),
    attachments: Array.isArray(value.attachments) ? value.attachments.map(normalizeAttachment) : [],
    searchText: textValue(value.searchText),
  };
  if (includeBody) return { ...base, body: textValue(value.body) };
  return base;
}

function sessionState(value: unknown): PortalSessionState {
  return value === 'login_required' || value === 'session_expired' || value === 'saved' || value === 'unknown'
    ? value
    : 'unknown';
}

function syncState(value: unknown): PortalSyncState {
  return value === 'running' || value === 'completed' || value === 'failed' ? value : 'idle';
}

function normalizeDepartment(raw: unknown): PortalNoticeDepartment {
  const value = isRecord(raw) ? raw : {};
  const counts = isRecord(value.counts) ? value.counts : {};
  return {
    value: textValue(value.value),
    name: textValue(value.name) || '담당부서 미상',
    count: numberValue(value.count),
    counts: { ALL: numberValue(counts.ALL), DM: numberValue(counts.DM) },
  };
}

function normalizePortalSyncRun(raw: unknown): PortalSyncRun {
  const value = isRecord(raw) ? raw : {};
  const status = value.status === 'running' || value.status === 'failed' ? value.status : 'completed';
  return {
    syncId: textValue(value.syncId),
    startedAt: textValue(value.startedAt),
    finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null,
    status,
    totalCount: numberValue(value.totalCount),
    newCount: numberValue(value.newCount),
    updatedCount: numberValue(value.updatedCount),
    detailCount: numberValue(value.detailCount),
    detailFailedCount: numberValue(value.detailFailedCount),
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
    error: typeof value.error === 'string' ? value.error : null,
  };
}

export function normalizePortalSyncStatus(raw: unknown): PortalSyncStatus {
  if (!isRecord(raw)) throw new PortalNoticesClientError('malformed_response', '학교 공지 동기화 상태 응답 형식을 확인해줘.');
  const counts = isRecord(raw.counts) ? raw.counts : {};
  const session = isRecord(raw.session) ? { state: sessionState(raw.session.state) } : undefined;
  const result: PortalSyncStatus = {
    source: 'ritsumei',
    lastSyncAt: typeof raw.lastSyncAt === 'string' ? raw.lastSyncAt : null,
    status: syncState(raw.status),
    storedCount: numberValue(raw.storedCount),
    counts: { ALL: numberValue(counts.ALL), DM: numberValue(counts.DM) },
    totalCount: numberValue(raw.totalCount),
    newCount: numberValue(raw.newCount),
    updatedCount: numberValue(raw.updatedCount),
    detailFailedCount: numberValue(raw.detailFailedCount),
    ...(session ? { session } : {}),
    ...(textValue(raw.lastErrorCode) ? { lastErrorCode: textValue(raw.lastErrorCode) } : {}),
    ...(textValue(raw.lastError) ? { lastError: textValue(raw.lastError) } : {}),
    ...(typeof raw.jobRunning === 'boolean' ? { jobRunning: raw.jobRunning } : {}),
    ...(raw.jobKind === 'sync' || raw.jobKind === 'login' ? { jobKind: raw.jobKind } : {}),
    ...(textValue(raw.jobError) ? { jobError: textValue(raw.jobError) } : {}),
    ...(textValue(raw.jobErrorCode) ? { jobErrorCode: textValue(raw.jobErrorCode) } : {}),
    ...(Array.isArray(raw.history) ? { history: raw.history.map(normalizePortalSyncRun) } : {}),
  };
  return result;
}

function readBridgeTokenFromStorage(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}

export async function getPortalStatus(token = readBridgeTokenFromStorage(), fetchImpl: typeof fetch = fetch): Promise<PortalSyncStatus> {
  const raw = await requestBridge('/portal/status', token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new PortalNoticesClientError('malformed_response', '학교 공지 상태 응답 형식을 확인해줘.');
  }
  return normalizePortalSyncStatus(raw);
}

export async function getPortalNotices(
  token = readBridgeTokenFromStorage(),
  options: { type?: PortalNoticeType; department?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: PortalNoticeSummary[]; departments: PortalNoticeDepartment[]; sync: PortalSyncStatus }> {
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.department) params.set('department', options.department);
  params.set('limit', String(Math.max(1, Math.min(500, options.limit || 500))));
  const raw = await requestBridge(`/portal/notices?${params.toString()}`, token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite' || !Array.isArray(raw.items)) {
    throw new PortalNoticesClientError('malformed_response', '저장된 학교 공지 응답 형식을 확인해줘.');
  }
  const syncRaw = isRecord(raw.sync) ? raw.sync : raw;
  return {
    items: raw.items.map((item) => normalizeNotice(item, false) as PortalNoticeSummary),
    departments: Array.isArray(raw.departments) ? raw.departments.map(normalizeDepartment) : [],
    sync: normalizePortalSyncStatus(syncRaw),
  };
}

export async function getPortalNotice(
  noticeId: string,
  token = readBridgeTokenFromStorage(),
  fetchImpl: typeof fetch = fetch,
): Promise<PortalNotice> {
  const raw = await requestBridge(`/portal/notices/${encodeURIComponent(noticeId)}`, token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new PortalNoticesClientError('malformed_response', '저장된 학교 공지 상세 응답 형식을 확인해줘.');
  }
  return normalizeNotice(raw.item, true) as PortalNotice;
}

export async function startPortalSync(token = readBridgeTokenFromStorage(), fetchImpl: typeof fetch = fetch): Promise<void> {
  await requestBridge('/portal/sync', token, 'POST', {}, fetchImpl);
}

export async function startPortalLogin(token = readBridgeTokenFromStorage(), fetchImpl: typeof fetch = fetch): Promise<void> {
  await requestBridge('/portal/login', token, 'POST', {}, fetchImpl);
}

export async function updatePortalNoticeState(
  noticeId: string,
  state: PortalNoticeStatePatch,
  token = readBridgeTokenFromStorage(),
  fetchImpl: typeof fetch = fetch,
): Promise<PortalNotice> {
  const raw = await requestBridge(
    `/portal/notices/${encodeURIComponent(noticeId)}/state`,
    token,
    'POST',
    { ...state },
    fetchImpl,
  );
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new PortalNoticesClientError('malformed_response', '학교 공지 상태 응답 형식을 확인해줘.');
  }
  return normalizeNotice(raw.item, true) as PortalNotice;
}

export function readPortalBridgeToken(): string {
  return readBridgeTokenFromStorage();
}
