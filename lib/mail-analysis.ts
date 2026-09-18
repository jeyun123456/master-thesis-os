import type {
  ThunderbirdAnalysisFolderId,
  ThunderbirdMail,
} from './thunderbird-mail';

export type MailCalendarCandidateType = 'event' | 'deadline';
export type MailCalendarCandidate = {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  type: MailCalendarCandidateType;
  reason: string;
};

export type MailCalendarCandidateStatus = 'pending' | 'added' | 'ignored';
export type StoredMailCalendarCandidate = MailCalendarCandidate & {
  id: string;
  status: MailCalendarCandidateStatus;
  calendarEventId?: string;
};

export type MailAnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type MailAnalysisRecord = {
  mailId: string;
  status: MailAnalysisStatus;
  summary: string | null;
  action: string | null;
  error: string | null;
  analyzedAt: string | null;
  promptVersion: string | null;
  model: string | null;
};

export type MailAnalysisItem = {
  mail: ThunderbirdMail;
  folder: ThunderbirdAnalysisFolderId;
  analysis: MailAnalysisRecord;
  candidates: StoredMailCalendarCandidate[];
};

export type MailSyncStatusValue = 'idle' | 'running' | 'completed' | 'failed';
export type MailSyncFolderStatus = {
  folder: ThunderbirdAnalysisFolderId;
  lastSyncAt: string | null;
  status: MailSyncStatusValue;
  phase: string;
  processed: number;
  total: number;
  newCount: number;
  analysisCompleted: number;
  analysisFailed: number;
  error?: string;
};

export type MailSyncStatus = {
  status: MailSyncStatusValue;
  phase: string;
  lastSyncAt: string | null;
  newCount: number;
  analysisCompleted: number;
  analysisFailed: number;
  progress: { current: number; total: number };
  counts: Record<MailAnalysisStatus, number>;
  folders: MailSyncFolderStatus[];
  jobRunning?: boolean;
  jobKind?: 'sync' | 'reanalyze';
  jobError?: string;
};

export type MailAnalysisResult = {
  summary: string;
  action: string | null;
  calendarCandidates: MailCalendarCandidate[];
};

export const MAX_MAIL_ANALYSIS_CANDIDATES = 8;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validDateOnly(value: string): boolean {
  if (!dateOnly(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const DATE_TIME_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

function dateTimeValue(value: string): string {
  return DATE_TIME_WITHOUT_ZONE_RE.test(value) ? `${value}+09:00` : value;
}

function validTimedDateTime(value: string): boolean {
  return value.includes('T') && !Number.isNaN(Date.parse(dateTimeValue(value)));
}

function seoulDate(now: Date): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function candidateIsPast(start: string, allDay: boolean, now: Date): boolean {
  if (allDay || dateOnly(start)) return start < seoulDate(now);
  const timestamp = Date.parse(dateTimeValue(start));
  return Number.isNaN(timestamp) || timestamp < now.getTime();
}

function candidateTimestamp(value: string, allDay: boolean): number {
  const timestamp = Date.parse(allDay ? `${value}T00:00:00+09:00` : dateTimeValue(value));
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

export function normalizeMailCalendarCandidate(raw: unknown, now = new Date(), options: { allowPast?: boolean } = {}): MailCalendarCandidate | null {
  if (!isRecord(raw)) return null;
  const title = textValue(raw.title);
  const start = textValue(raw.start);
  if (!title || !start) return null;

  const allDay = raw.allDay === true || dateOnly(start);
  if (allDay ? !validDateOnly(start) : !validTimedDateTime(start)) return null;
  if (!options.allowPast && candidateIsPast(start, allDay, now)) return null;

  const rawEnd = textValue(raw.end);
  let end: string | null = rawEnd || null;
  if (end && (allDay ? !validDateOnly(end) : !validTimedDateTime(end))) end = null;
  if (end && candidateTimestamp(end, allDay) <= candidateTimestamp(start, allDay)) end = null;

  const type: MailCalendarCandidateType = raw.type === 'deadline' ? 'deadline' : 'event';
  return {
    title,
    start,
    end,
    allDay,
    type,
    reason: textValue(raw.reason) || (type === 'deadline' ? '제출·마감으로 판단된 날짜' : '참석 가능성이 높은 일정으로 판단된 날짜'),
  };
}

/** Normalize the structured shape when it is used by tests or import tools.
 * The local CLI is the canonical AI caller; this helper never invents a
 * summary, action, or calendar candidate.
 */
export function normalizeMailAnalysis(raw: unknown, now = new Date()): MailAnalysisResult {
  if (!isRecord(raw)) return { summary: '', action: null, calendarCandidates: [] };
  const rawCandidates = Array.isArray(raw.calendarCandidates) ? raw.calendarCandidates : [];
  const calendarCandidates = rawCandidates
    .map((candidate) => normalizeMailCalendarCandidate(candidate, now))
    .filter((candidate): candidate is MailCalendarCandidate => candidate !== null)
    .slice(0, MAX_MAIL_ANALYSIS_CANDIDATES);
  return {
    summary: textValue(raw.summary),
    action: textValue(raw.action) || null,
    calendarCandidates,
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function mailCalendarCandidateId(mailId: string, candidate: MailCalendarCandidate, index = 0): string {
  return `mail-calendar:${stableHash(`${mailId}\u0000${index}\u0000${candidate.title}\u0000${candidate.start}\u0000${candidate.type}`)}`;
}
