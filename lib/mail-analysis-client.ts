import {
  THUNDERBIRD_ANALYSIS_FOLDER_IDS,
  type ThunderbirdAnalysisFolderId,
  normalizeThunderbirdMail,
} from './thunderbird-mail';
import type {
  MailAnalysisItem,
  MailAnalysisRecord,
  MailAnalysisStatus,
  MailCalendarCandidateStatus,
  MailSyncStatus,
  StoredMailCalendarCandidate,
} from './mail-analysis';
import type { MailPlanning, MailTask, MailTaskStatus } from './mail-planning';

type RecordValue = Record<string, unknown>;
type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

const REQUEST_TIMEOUT_MS = 10_000;

export class MailAnalysisClientError extends Error {
  constructor(public readonly code: 'bridge_offline' | 'bridge_auth' | 'malformed_response' | 'server_error', message: string) {
    super(message);
    this.name = 'MailAnalysisClientError';
  }
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bridgeUrl(): string {
  return (process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471').replace(/\/+$/, '');
}

function requestInit(token: string, method: 'GET' | 'POST', body: Record<string, unknown> | undefined, signal: AbortSignal): BridgeRequestInit {
  const init: BridgeRequestInit = {
    method,
    headers: method === 'GET'
      ? { 'X-Bridge-Token': token }
      : { 'Content-Type': 'application/json' },
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
    throw new MailAnalysisClientError('malformed_response', 'Local Bridge 응답을 읽지 못했어.');
  }
}

async function requestBridge(
  endpoint: string,
  token: string,
  method: 'GET' | 'POST',
  body: Record<string, unknown> | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  if (!token.trim()) throw new MailAnalysisClientError('bridge_auth', 'Settings에서 Local Bridge token을 확인해줘.');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${bridgeUrl()}${endpoint}`, requestInit(token, method, body, controller.signal));
    const data = await readJson(response);
    if (!response.ok) {
      const error = isRecord(data) ? textValue(data.error) : '';
      const code = response.status === 403 ? 'bridge_auth' : response.status >= 500 ? 'bridge_offline' : 'server_error';
      throw new MailAnalysisClientError(code, error || (code === 'bridge_auth' ? 'Local Bridge token을 확인해줘.' : '메일 분석 요청을 처리하지 못했어.'));
    }
    return data;
  } catch (error) {
    if (error instanceof MailAnalysisClientError) throw error;
    throw new MailAnalysisClientError('bridge_offline', 'Local Bridge가 실행 중인지 확인해줘.');
  } finally {
    clearTimeout(timeoutId);
  }
}

function folderValue(value: unknown): ThunderbirdAnalysisFolderId | null {
  return typeof value === 'string' && (THUNDERBIRD_ANALYSIS_FOLDER_IDS as readonly string[]).includes(value)
    ? value as ThunderbirdAnalysisFolderId
    : null;
}

function analysisStatus(value: unknown): MailAnalysisStatus {
  return value === 'processing' || value === 'completed' || value === 'failed' ? value : 'queued';
}

function normalizeAnalysisRecord(raw: unknown, mailId: string): MailAnalysisRecord {
  const value = isRecord(raw) ? raw : {};
  return {
    mailId,
    status: analysisStatus(value.status),
    summary: typeof value.summary === 'string' ? value.summary : null,
    action: typeof value.action === 'string' ? value.action : null,
    error: typeof value.error === 'string' ? value.error : null,
    analyzedAt: typeof value.analyzedAt === 'string' ? value.analyzedAt : null,
    promptVersion: typeof value.promptVersion === 'string' ? value.promptVersion : null,
    model: typeof value.model === 'string' ? value.model : null,
  };
}

function normalizeCandidate(raw: unknown): StoredMailCalendarCandidate | null {
  if (!isRecord(raw)) return null;
  const id = textValue(raw.id);
  const mailId = textValue(raw.mailId);
  const title = textValue(raw.title);
  const start = textValue(raw.start);
  const type = raw.type === 'deadline' ? 'deadline' : raw.type === 'event' ? 'event' : null;
  const status: MailCalendarCandidateStatus = raw.status === 'added' || raw.status === 'ignored' ? raw.status : 'pending';
  if (!id || !mailId || !title || !start || !type) return null;
  return {
    id,
    title,
    start,
    end: typeof raw.end === 'string' && raw.end.trim() ? raw.end.trim() : null,
    allDay: raw.allDay === true,
    type,
    reason: textValue(raw.reason),
    status,
    ...(textValue(raw.calendarEventId) ? { calendarEventId: textValue(raw.calendarEventId) } : {}),
  };
}

function normalizeAnalysisItem(raw: unknown): MailAnalysisItem {
  if (!isRecord(raw) || !isRecord(raw.mail)) {
    throw new MailAnalysisClientError('malformed_response', '저장된 메일 분석 응답 형식을 확인해줘.');
  }
  const mail = normalizeThunderbirdMail(raw.mail);
  const folder = folderValue(raw.folder);
  if (!folder) throw new MailAnalysisClientError('malformed_response', '메일 분석 폴더 응답 형식을 확인해줘.');
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  return {
    mail,
    folder,
    analysis: normalizeAnalysisRecord(raw.analysis, mail.id),
    candidates: rawCandidates.map(normalizeCandidate).filter((value): value is StoredMailCalendarCandidate => value !== null),
  };
}

function taskStatus(value: unknown): MailTaskStatus {
  return value === 'done' || value === 'snoozed' || value === 'dismissed' ? value : 'pending';
}

function normalizeTask(raw: unknown): MailTask {
  if (!isRecord(raw) || !isRecord(raw.mail)) {
    throw new MailAnalysisClientError('malformed_response', '메일 할 일 응답 형식을 확인해줘.');
  }
  const id = textValue(raw.id);
  const mailId = textValue(raw.mailId);
  const folder = folderValue(raw.folder);
  if (!id || !mailId || !folder) {
    throw new MailAnalysisClientError('malformed_response', '메일 할 일 응답 형식을 확인해줘.');
  }
  return {
    id,
    mailId,
    folder,
    title: textValue(raw.title) || '메일에서 확인할 일',
    description: textValue(raw.description),
    dueAt: textValue(raw.dueAt) || null,
    status: taskStatus(raw.status),
    createdAt: textValue(raw.createdAt),
    updatedAt: textValue(raw.updatedAt),
    completedAt: textValue(raw.completedAt) || null,
    mail: normalizeThunderbirdMail(raw.mail),
  };
}

function syncStatusValue(value: unknown): MailSyncStatus['status'] {
  return value === 'running' || value === 'completed' || value === 'failed' ? value : 'idle';
}

function normalizeSyncStatus(raw: unknown): MailSyncStatus {
  if (!isRecord(raw)) throw new MailAnalysisClientError('malformed_response', '메일 동기화 상태 응답 형식을 확인해줘.');
  const progress = isRecord(raw.progress) ? raw.progress : {};
  const countsValue = isRecord(raw.counts) ? raw.counts : {};
  const folders = Array.isArray(raw.folders) ? raw.folders.map((folder) => {
    if (!isRecord(folder)) return null;
    const id = folderValue(folder.folder);
    if (!id) return null;
    return {
      folder: id,
      lastSyncAt: typeof folder.lastSyncAt === 'string' ? folder.lastSyncAt : null,
      status: syncStatusValue(folder.status),
      phase: textValue(folder.phase),
      processed: Number(folder.processed) || 0,
      total: Number(folder.total) || 0,
      newCount: Number(folder.newCount) || 0,
      analysisCompleted: Number(folder.analysisCompleted) || 0,
      analysisFailed: Number(folder.analysisFailed) || 0,
      ...(textValue(folder.error) ? { error: textValue(folder.error) } : {}),
    };
  }).filter((value): value is MailSyncStatus['folders'][number] => value !== null) : [];
  return {
    status: syncStatusValue(raw.status),
    phase: textValue(raw.phase),
    lastSyncAt: typeof raw.lastSyncAt === 'string' ? raw.lastSyncAt : null,
    newCount: Number(raw.newCount) || 0,
    analysisCompleted: Number(raw.analysisCompleted) || 0,
    analysisFailed: Number(raw.analysisFailed) || 0,
    progress: { current: Number(progress.current) || 0, total: Number(progress.total) || 0 },
    counts: {
      queued: Number(countsValue.queued) || 0,
      processing: Number(countsValue.processing) || 0,
      completed: Number(countsValue.completed) || 0,
      failed: Number(countsValue.failed) || 0,
    },
    folders,
    ...(raw.jobRunning === true ? { jobRunning: true } : raw.jobRunning === false ? { jobRunning: false } : {}),
    ...(raw.jobKind === 'sync' || raw.jobKind === 'reanalyze' ? { jobKind: raw.jobKind } : {}),
    ...(textValue(raw.jobError) ? { jobError: textValue(raw.jobError) } : {}),
  };
}

export async function getMailSyncStatus(token: string, fetchImpl: typeof fetch = fetch): Promise<MailSyncStatus> {
  const raw = await requestBridge('/mail/sync-status', token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new MailAnalysisClientError('malformed_response', '메일 동기화 상태 응답 형식을 확인해줘.');
  }
  return normalizeSyncStatus(raw);
}

export async function getMailAnalysis(
  token: string,
  options: { folder?: ThunderbirdAnalysisFolderId; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ items: MailAnalysisItem[]; sync: MailSyncStatus }> {
  const params = new URLSearchParams();
  if (options.folder) params.set('folder', options.folder);
  params.set('limit', String(Math.max(1, Math.min(100, options.limit || 100))));
  const raw = await requestBridge(`/mail/analysis?${params.toString()}`, token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite' || !Array.isArray(raw.items)) {
    throw new MailAnalysisClientError('malformed_response', '저장된 메일 분석 응답 형식을 확인해줘.');
  }
  const syncRaw = isRecord(raw.sync) ? raw.sync : raw;
  return { items: raw.items.map(normalizeAnalysisItem), sync: normalizeSyncStatus(syncRaw) };
}

export async function getMailPlanning(token: string, fetchImpl: typeof fetch = fetch): Promise<MailPlanning> {
  const raw = await requestBridge('/mail/planning', token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite' || !Array.isArray(raw.items) || !Array.isArray(raw.tasks)) {
    throw new MailAnalysisClientError('malformed_response', '메일 플래너 응답 형식을 확인해줘.');
  }
  const syncRaw = isRecord(raw.sync) ? raw.sync : raw;
  return {
    tasks: raw.tasks.map(normalizeTask),
    items: raw.items.map(normalizeAnalysisItem),
    sync: normalizeSyncStatus(syncRaw),
  };
}

export async function getMailAnalysisItem(token: string, mailId: string, fetchImpl: typeof fetch = fetch): Promise<MailAnalysisItem> {
  const raw = await requestBridge(`/mail/analysis/${encodeURIComponent(mailId)}`, token, 'GET', undefined, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new MailAnalysisClientError('malformed_response', '저장된 메일 분석 응답 형식을 확인해줘.');
  }
  return normalizeAnalysisItem(raw.item);
}

export async function startMailSync(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await requestBridge('/mail/sync', token, 'POST', {}, fetchImpl);
}

export async function reanalyzeMail(token: string, mailId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await requestBridge(`/mail/analysis/${encodeURIComponent(mailId)}/reanalyze`, token, 'POST', {}, fetchImpl);
}

export async function updateMailCandidate(
  token: string,
  input: {
    mailId: string;
    candidateId: string;
    status: MailCalendarCandidateStatus;
    title?: string;
    start?: string;
    end?: string | null;
    allDay?: boolean;
    calendarEventId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<StoredMailCalendarCandidate> {
  const raw = await requestBridge('/mail/analysis/candidate', token, 'POST', input, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new MailAnalysisClientError('malformed_response', '일정 후보 상태 응답 형식을 확인해줘.');
  }
  const candidate = normalizeCandidate(raw.candidate);
  if (!candidate) throw new MailAnalysisClientError('malformed_response', '일정 후보 응답 형식을 확인해줘.');
  return candidate;
}

export async function updateMailTask(
  token: string,
  input: {
    taskId: string;
    status: MailTaskStatus;
    title?: string;
    description?: string;
    dueAt?: string | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<MailTask> {
  const raw = await requestBridge('/mail/task', token, 'POST', input, fetchImpl);
  if (!isRecord(raw) || raw.ok !== true || raw.source !== 'sqlite') {
    throw new MailAnalysisClientError('malformed_response', '메일 할 일 상태 응답 형식을 확인해줘.');
  }
  return normalizeTask(raw.task);
}

export function readBridgeToken(): string {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    return '';
  }
}
