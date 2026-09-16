import type { ThunderbirdMail } from './thunderbird-mail';

export type MailPriority = 'critical' | 'important' | 'normal';

export type MailCategory =
  | 'deadline'
  | 'meeting'
  | 'research'
  | 'presentation'
  | 'academic'
  | 'administrative'
  | 'other';

export type MailPriorityInput = Pick<
  ThunderbirdMail,
  'subject' | 'senderName' | 'senderAddress' | 'receivedAt' | 'isRead'
>;

export type MailPriorityResult = {
  priority: MailPriority;
  category: MailCategory;
  priorityReason?: string;
};

export type PrioritizedMail = ThunderbirdMail & MailPriorityResult;

export const MAX_DISPLAY_MAILS = 5;

const CRITICAL_SUBJECT_KEYWORDS = [
  'urgent',
  '긴급',
  '至急',
  '緊急',
  'emergency',
  '즉시',
  'immediately',
  '필수',
  '必須',
  'required',
];

const IMMEDIATE_TIME_KEYWORDS = [
  '오늘',
  '금일',
  '내일',
  '본일',
  '本日',
  '明日',
  'today',
  'tomorrow',
];

const DEADLINE_KEYWORDS = [
  '제출',
  '제출기한',
  '제출 기한',
  '기한',
  '마감',
  '締切',
  '提出',
  '期限',
  'submission',
  'submit',
  'deadline',
  'due',
];

const REQUEST_KEYWORDS = [
  '요청',
  '확인 필요',
  '확인 요청',
  '확인해',
  '대응',
  'request',
  'please',
  'action required',
  '対応',
  '要確認',
  '依頼',
];

const SCHEDULE_CHANGE_KEYWORDS = [
  '일정 변경',
  '일정이 변경',
  '변경 안내',
  'schedule change',
  'rescheduled',
  'postponed',
  'cancelled',
  '日程変更',
  '変更のお知らせ',
  '延期',
  '中止',
];

const IMPORTANT_SUBJECT_KEYWORDS = ['중요', 'important', '必須', 'required'];

const IMPORTANT_RULES: Array<{ category: MailCategory; reason: string; keywords: string[] }> = [
  {
    category: 'presentation',
    reason: '발표 관련',
    keywords: ['발표', '중간발표', 'presentation', '中間発表', '発表', '세미나', 'seminar'],
  },
  {
    category: 'meeting',
    reason: '면담·미팅 관련',
    keywords: ['면담', '미팅', '회의', 'meeting', '面談', '打合せ', '会議', 'appointment', 'interview'],
  },
  {
    category: 'research',
    reason: '연구·논문 관련',
    keywords: ['연구', '논문', 'research', 'thesis', 'paper', '研究', '論文'],
  },
  {
    category: 'academic',
    reason: '교수·교직원 또는 학사 관련',
    keywords: ['교수', '교수님', '지도교수', '선생님', '교직원', '先生', '教員', 'faculty', 'professor', '수업', '성적', '시험', '成績', '履修', '試験', 'course', 'grade', 'exam'],
  },
  {
    category: 'administrative',
    reason: '학사·행정 안내',
    keywords: ['학무', '교무', '행정', '장학', '등록', '신청', '절차', 'administrative', '学務', '教務', '行政', '奨学', '手続', '申請'],
  },
];

const ADMINISTRATIVE_KEYWORDS = ['rainbow', 'maintenance', 'メンテナンス', '시스템 점검', '시스템 유지보수', 'service interruption', '서비스 점검'];
const ADMINISTRATIVE_ACTION_KEYWORDS = ['대응', '확인', '필요', '중단', '정지', '이용 불가', '영향', '작업', '作業', '対応', '要確認', '停止', '利用不可', '影響', 'action required', 'service interruption'];
const LOW_SIGNAL_KEYWORDS = ['광고', '홍보', '뉴스레터', 'newsletter', '프로모션', 'promotion', 'campaign', 'メルマガ', '宣伝', 'キャンペーン', '자동 알림', '자동안내', '自動通知', 'notification', 'maintenance', 'メンテナンス'];
const AUTOMATED_SENDER_KEYWORDS = ['no-reply', 'noreply', 'do-not-reply', 'mailer-daemon', 'automated', 'bounces'];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function includesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

function subjectText(item: MailPriorityInput): string {
  return normalize(item.subject);
}

function senderText(item: MailPriorityInput): string {
  return normalize([item.senderName, item.senderAddress].join(' '));
}

function hoursSince(value: string): number | null {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Date.now() - timestamp) / 3_600_000;
}

function result(priority: MailPriority, category: MailCategory, priorityReason?: string): MailPriorityResult {
  return priorityReason ? { priority, category, priorityReason } : { priority, category };
}

export function classifyMailPriority(item: MailPriorityInput): MailPriorityResult {
  const subject = subjectText(item);
  const sender = senderText(item);
  const deadlineMatch = includesKeyword(subject, DEADLINE_KEYWORDS);
  const urgentMatch = includesKeyword(subject, CRITICAL_SUBJECT_KEYWORDS);
  const immediateMatch = includesKeyword(subject, IMMEDIATE_TIME_KEYWORDS);
  const requestMatch = includesKeyword(subject, REQUEST_KEYWORDS);
  const scheduleChangeMatch = includesKeyword(subject, SCHEDULE_CHANGE_KEYWORDS);
  const importantSubjectMatch = includesKeyword(subject, IMPORTANT_SUBJECT_KEYWORDS);
  const ageHours = hoursSince(item.receivedAt);
  const lowSignal = includesKeyword(subject, LOW_SIGNAL_KEYWORDS) || includesKeyword(sender, AUTOMATED_SENDER_KEYWORDS);
  const directAction = deadlineMatch || urgentMatch || requestMatch || scheduleChangeMatch || importantSubjectMatch;

  // A newsletter, advertisement, or automatic notice should not become
  // important merely because it mentions a seminar, course, or maintenance.
  if (lowSignal && !directAction) return result('normal', 'other', '자동 알림');

  if (urgentMatch || (deadlineMatch && (immediateMatch || (ageHours !== null && ageHours <= 24)))) {
    return result('critical', 'deadline', deadlineMatch ? '마감 표현 감지' : '긴급 안내');
  }

  // A stale deadline remains actionable, but is shown one level below a fresh
  // deadline so the home card focuses on current action first.
  if (deadlineMatch) return result('important', 'deadline', requestMatch ? '제출 요청' : '마감 표현 감지');

  const importantRule = IMPORTANT_RULES.find((rule) => includesKeyword(subject, rule.keywords));
  if (importantRule && immediateMatch && (importantRule.category === 'meeting' || importantRule.category === 'presentation') && (ageHours === null || ageHours <= 72)) {
    return result('critical', importantRule.category, '일정 임박');
  }

  if (scheduleChangeMatch) {
    return result('important', importantRule?.category || 'academic', '일정 변경');
  }

  if (importantRule) return result('important', importantRule.category, requestMatch ? '제출·확인 요청' : importantRule.reason);

  const administrativeAction = includesKeyword(subject, ADMINISTRATIVE_ACTION_KEYWORDS);
  if (includesKeyword(subject, ADMINISTRATIVE_KEYWORDS) && (administrativeAction || !lowSignal)) {
    return result('important', 'administrative', administrativeAction ? '행정 대응 필요' : '학사·행정 절차');
  }

  if (requestMatch && includesKeyword(sender, ['교수', '교직원', '先生', '教員', '教授', 'professor', 'faculty'])) {
    return result('important', 'academic', '교수·교직원 요청');
  }

  if (importantSubjectMatch) return result('important', 'other', '중요 표시');

  return result('normal', 'other');
}

function priorityRank(item: PrioritizedMail): number {
  if (item.priority === 'critical') return item.isRead ? 4 : 6;
  if (item.priority === 'important') return item.isRead ? 3 : 5;
  return item.isRead ? 1 : 2;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function prioritizeMails(items: ThunderbirdMail[], limit = MAX_DISPLAY_MAILS): PrioritizedMail[] {
  const safeLimit = Math.min(MAX_DISPLAY_MAILS, Math.max(1, Math.floor(limit)));
  return items
    .map(prioritizeMail)
    .sort((left, right) => priorityRank(right) - priorityRank(left) || timestamp(right.receivedAt) - timestamp(left.receivedAt))
    .slice(0, safeLimit);
}

export function prioritizeMail(item: ThunderbirdMail): PrioritizedMail {
  return { ...item, ...classifyMailPriority(item) };
}

export function mailPriorityLabel(priority: MailPriority): string {
  if (priority === 'critical') return '긴급';
  if (priority === 'important') return '중요';
  return '';
}
