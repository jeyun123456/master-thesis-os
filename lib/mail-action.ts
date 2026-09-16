import type { MailCategory, MailPriority, PrioritizedMail } from './mail-priority';

export type MailActionType =
  | 'deadline'
  | 'meeting'
  | 'presentation'
  | 'research'
  | 'academic'
  | 'administrative'
  | 'review';

export type MailActionCandidate = {
  id: string;
  mailId: string;
  title: string;
  type: MailActionType;
  priority: Exclude<MailPriority, 'normal'>;
  reason: string;
  receivedAt: string;
  dueAt?: string;
  senderName?: string;
  messageId?: string;
};

export type MailActionOptions = {
  now?: Date;
  dismissedIds?: Iterable<string>;
  limit?: number;
};

export const MAIL_ACTION_DISMISSED_STORAGE_KEY = 'master-thesis-os:mail-action-dismissed';
export const MAX_ACTION_CANDIDATES = 5;

const ACTION_TYPE_LABELS: Record<MailActionType, string> = {
  deadline: '마감',
  meeting: '면담·미팅',
  presentation: '발표',
  research: '연구',
  academic: '학사',
  administrative: '행정',
  review: '확인',
};

const ACTION_RULES: Record<MailCategory, { type: MailActionType; reason: string }> = {
  deadline: { type: 'deadline', reason: '제출·마감 관련 메일' },
  meeting: { type: 'meeting', reason: '면담 일정 관련 메일' },
  presentation: { type: 'presentation', reason: '발표 관련 메일' },
  research: { type: 'research', reason: '연구·논문 관련 메일' },
  academic: { type: 'academic', reason: '학사 확인 필요' },
  administrative: { type: 'administrative', reason: '행정 안내 확인 필요' },
  other: { type: 'review', reason: '중요 메일 확인 필요' },
};

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalizeSubject(subject: string): string {
  return subject.normalize('NFKC').trim();
}

function dateString(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dateForMonthDay(month: number, day: number, now: Date): string | undefined {
  const current = Number.isNaN(now.getTime()) ? new Date() : now;
  let year = current.getFullYear();
  let candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return undefined;
  if (candidate.getTime() < startOfDay(current).getTime()) {
    year += 1;
    candidate = new Date(year, month - 1, day);
  }
  return dateString(year, month, day);
}

function relativeDate(subject: string, now: Date): string | undefined {
  const offsets: Array<{ keywords: string[]; days: number }> = [
    { keywords: ['모레', '明後日', 'day after tomorrow'], days: 2 },
    { keywords: ['오늘', '금일', '本日', 'today'], days: 0 },
    { keywords: ['내일', '明日', 'tomorrow'], days: 1 },
  ];
  const match = offsets.find(({ keywords }) => keywords.some((keyword) => subject.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())));
  if (!match) return undefined;
  const current = Number.isNaN(now.getTime()) ? new Date() : now;
  const candidate = new Date(startOfDay(current).getTime() + match.days * 86_400_000);
  return dateString(candidate.getFullYear(), candidate.getMonth() + 1, candidate.getDate());
}

export function extractSubjectDueDate(subject: string, now = new Date()): string | undefined {
  const normalized = normalizeSubject(subject);
  if (!normalized) return undefined;

  const fullNumeric = normalized.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (fullNumeric) return dateString(Number(fullNumeric[1]), Number(fullNumeric[2]), Number(fullNumeric[3]));

  const fullAsian = normalized.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (fullAsian) return dateString(Number(fullAsian[1]), Number(fullAsian[2]), Number(fullAsian[3]));

  const korean = normalized.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) return dateForMonthDay(Number(korean[1]), Number(korean[2]), now);

  const japanese = normalized.match(/(\d{1,2})月\s*(\d{1,2})日/);
  if (japanese) return dateForMonthDay(Number(japanese[1]), Number(japanese[2]), now);

  const english = normalized.match(/\b(January|February|March|April|May|June|July|August|September|Sept|Sep|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i);
  if (english) {
    const month = ENGLISH_MONTHS[english[1].toLocaleLowerCase()];
    const day = Number(english[2]);
    return english[3] ? dateString(Number(english[3]), month, day) : dateForMonthDay(month, day, now);
  }

  const slash = normalized.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (slash) return dateForMonthDay(Number(slash[1]), Number(slash[2]), now);

  return relativeDate(normalized, now);
}

export function mailActionCandidateId(mailId: string): string {
  return `mail-action:${mailId}`;
}

export function mailActionTypeLabel(type: MailActionType): string {
  return ACTION_TYPE_LABELS[type];
}

export function createMailActionCandidate(mail: PrioritizedMail, now = new Date()): MailActionCandidate | null {
  if (!mail.id.trim() || mail.priority === 'normal') return null;
  const rule = ACTION_RULES[mail.category] || ACTION_RULES.other;
  const candidate: MailActionCandidate = {
    id: mailActionCandidateId(mail.id),
    mailId: mail.id,
    title: mail.subject.trim() || '(제목 없음)',
    type: rule.type,
    priority: mail.priority,
    reason: rule.reason,
    receivedAt: mail.receivedAt,
    ...(mail.senderName.trim() ? { senderName: mail.senderName.trim() } : {}),
    ...(mail.messageId?.trim() ? { messageId: mail.messageId.trim() } : {}),
  };
  if (rule.type === 'deadline') {
    const dueAt = extractSubjectDueDate(mail.subject, now);
    if (dueAt) candidate.dueAt = dueAt;
  }
  return candidate;
}

function receivedTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function dueTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date.getTime();
}

function priorityRank(priority: Exclude<MailPriority, 'normal'>): number {
  return priority === 'critical' ? 1 : 0;
}

function dueGroup(candidate: MailActionCandidate): number {
  if (candidate.dueAt) return candidate.priority === 'critical' ? 4 : 3;
  return candidate.priority === 'critical' ? 2 : 1;
}

function compareDueDates(left: MailActionCandidate, right: MailActionCandidate, now: Date): number {
  const leftDue = dueTimestamp(left.dueAt);
  const rightDue = dueTimestamp(right.dueAt);
  if (leftDue === null || rightDue === null) return 0;
  const today = startOfDay(now).getTime();
  const leftFuture = leftDue >= today;
  const rightFuture = rightDue >= today;
  if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
  if (leftFuture) return leftDue - rightDue;
  return rightDue - leftDue;
}

export function compareMailActionCandidates(left: MailActionCandidate, right: MailActionCandidate, now = new Date()): number {
  return dueGroup(right) - dueGroup(left)
    || (left.dueAt && right.dueAt ? compareDueDates(left, right, now) : 0)
    || priorityRank(right.priority) - priorityRank(left.priority)
    || receivedTimestamp(right.receivedAt) - receivedTimestamp(left.receivedAt);
}

export function filterDismissedMailActions(candidates: MailActionCandidate[], dismissedIds: Iterable<string>): MailActionCandidate[] {
  const dismissed = new Set(dismissedIds);
  return candidates.filter((candidate) => !dismissed.has(candidate.id) && !dismissed.has(candidate.mailId));
}

export function createMailActionCandidates(items: PrioritizedMail[], options: MailActionOptions = {}): MailActionCandidate[] {
  const now = options.now || new Date();
  const limit = Number.isFinite(options.limit) ? Math.min(MAX_ACTION_CANDIDATES, Math.max(0, Math.floor(options.limit as number))) : MAX_ACTION_CANDIDATES;
  const candidates = items
    .map((item) => createMailActionCandidate(item, now))
    .filter((candidate): candidate is MailActionCandidate => candidate !== null);
  return filterDismissedMailActions(candidates, options.dismissedIds || [])
    .sort((left, right) => compareMailActionCandidates(left, right, now))
    .slice(0, limit);
}

export function isMailActionOverdue(candidate: MailActionCandidate, now = new Date()): boolean {
  const due = dueTimestamp(candidate.dueAt);
  return due !== null && due < startOfDay(now).getTime();
}
