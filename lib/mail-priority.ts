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

const CRITICAL_ALWAYS_KEYWORDS = [
  'urgent',
  '至急',
  '중요',
  '必須',
  'required',
];

const IMMEDIATE_DEADLINE_KEYWORDS = [
  '오늘 마감',
  '내일 마감',
  '오늘까지',
  '내일까지',
  'today deadline',
  'deadline today',
  'due today',
  'tomorrow deadline',
  'deadline tomorrow',
  'due tomorrow',
  '本日締切',
  '明日締切',
];

const DEADLINE_KEYWORDS = [
  '제출',
  '기한',
  '마감',
  '締切',
  '提出',
  'deadline',
  'due',
];

const IMPORTANT_RULES: Array<{ category: MailCategory; reason: string; keywords: string[] }> = [
  {
    category: 'presentation',
    reason: '발표 관련',
    keywords: ['발표', 'presentation', '中間発表', '発表', '세미나', 'seminar'],
  },
  {
    category: 'meeting',
    reason: '면담·미팅 관련',
    keywords: ['면담', '미팅', 'meeting', '面談', '打合せ', 'appointment'],
  },
  {
    category: 'research',
    reason: '연구·논문 관련',
    keywords: ['연구', '논문', 'research', 'thesis', 'paper', '研究', '論文'],
  },
  {
    category: 'academic',
    reason: '교수·교직원 또는 학사 관련',
    keywords: ['교수', '교수님', '지도교수', '선생님', '교직원', '先生', '教員', 'faculty', 'professor', '수업', '成績', '履修', 'course', 'grade'],
  },
  {
    category: 'administrative',
    reason: '학사·행정 안내',
    keywords: ['학무', '교무', '学務', '教務'],
  },
];

const ADMINISTRATIVE_KEYWORDS = ['rainbow', 'maintenance', 'メンテナンス', '시스템 점검', '시스템 유지보수', 'service interruption'];
const ADMINISTRATIVE_ACTION_KEYWORDS = ['대응', '확인', '필요', '중단', '정지', '이용 불가', '영향', '作業', '対応', '要確認', '停止', '利用不可', '影響', 'action required', 'service interruption'];
const LOW_SIGNAL_KEYWORDS = ['광고', '홍보', '뉴스레터', 'newsletter', '프로모션', 'promotion', 'メルマガ', '宣伝', '자동 알림', '自動通知', 'notification', 'no-reply', 'noreply'];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function searchableText(item: MailPriorityInput): string {
  return [item.subject, item.senderName, item.senderAddress].map(normalize).join(' ');
}

function includesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(normalize(keyword)));
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
  const text = searchableText(item);
  const deadlineMatch = includesKeyword(text, DEADLINE_KEYWORDS);
  const urgentMatch = includesKeyword(text, CRITICAL_ALWAYS_KEYWORDS);
  const immediateDeadlineMatch = includesKeyword(text, IMMEDIATE_DEADLINE_KEYWORDS);
  const ageHours = hoursSince(item.receivedAt);

  if (urgentMatch || immediateDeadlineMatch || (deadlineMatch && (ageHours === null || ageHours <= 24))) {
    return result('critical', 'deadline', urgentMatch && !deadlineMatch ? '긴급·필수 안내' : '최근 제출·마감 기한 관련');
  }

  // A stale deadline remains actionable, but is shown one level below a fresh
  // deadline so the home card focuses on current action first.
  if (deadlineMatch) return result('important', 'deadline', '제출·마감 기한 관련');

  const lowSignal = includesKeyword(text, LOW_SIGNAL_KEYWORDS);
  const administrativeAction = includesKeyword(text, ADMINISTRATIVE_ACTION_KEYWORDS);
  if (lowSignal && !administrativeAction) return result('normal', 'other');

  const importantRule = IMPORTANT_RULES.find((rule) => includesKeyword(text, rule.keywords));
  if (importantRule) return result('important', importantRule.category, importantRule.reason);

  if (includesKeyword(text, ADMINISTRATIVE_KEYWORDS) && administrativeAction) {
    return result('important', 'administrative', '행정 시스템 대응 필요 가능성');
  }

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
    .map((item) => ({ ...item, ...classifyMailPriority(item) }))
    .sort((left, right) => priorityRank(right) - priorityRank(left) || timestamp(right.receivedAt) - timestamp(left.receivedAt))
    .slice(0, safeLimit);
}

export function mailPriorityLabel(priority: MailPriority): string {
  if (priority === 'critical') return '긴급';
  if (priority === 'important') return '중요';
  return '';
}
