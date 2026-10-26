import type { P0Task, P0TaskCategory } from './p0-tasks-client';

export type P0HomeCategory = 'all' | P0TaskCategory;
export type P0HomeGroup = { id: 'overdue' | 'today' | 'upcoming' | 'unscheduled'; label: string; tasks: P0Task[] };

function dateInZone(value: Date | string, timeZone = 'Asia/Tokyo') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${part.year}-${part.month}-${part.day}`;
}

export function p0TodayInTokyo(now = new Date()) {
  return dateInZone(now);
}

export function buildP0HomeView(tasks: P0Task[], today: string, category: P0HomeCategory = 'all') {
  const visible = tasks.filter((task) => !task.deleted && (category === 'all' || task.category === category));
  const open = visible.filter((task) => task.status === 'open');
  const byDate = (left: P0Task, right: P0Task) => (left.due_date || '9999-99-99').localeCompare(right.due_date || '9999-99-99')
    || left.created_at.localeCompare(right.created_at);
  const focus = open.filter((task) => task.is_today).sort(byDate);
  const remaining = open.filter((task) => !task.is_today);
  const groups: P0HomeGroup[] = [
    { id: 'overdue', label: '기한 지남', tasks: remaining.filter((task) => task.due_date && task.due_date < today).sort(byDate) },
    { id: 'today', label: '오늘 기한', tasks: remaining.filter((task) => task.due_date === today).sort(byDate) },
    { id: 'upcoming', label: '예정', tasks: remaining.filter((task) => task.due_date && task.due_date > today).sort(byDate) },
    { id: 'unscheduled', label: '기한 없음', tasks: remaining.filter((task) => !task.due_date).sort(byDate) },
  ];
  const doneToday = visible.filter((task) => task.status === 'done' && task.completed_at && dateInZone(task.completed_at) === today)
    .sort((left, right) => (right.completed_at ?? '').localeCompare(left.completed_at ?? ''));
  const newTasks = visible.filter((task) => task.is_new);
  return {
    focus,
    groups: groups.filter((group) => group.tasks.length),
    doneToday,
    newTasks,
    openCount: open.length,
    focusCount: focus.length,
    overdueCount: groups[0].tasks.length,
  };
}

export const NOW_LIMIT = 3;

/** "Right now": today's focus first, then what is overdue, then what is due today. At most `limit`, each task once. */
export function pickNowTasks(view: ReturnType<typeof buildP0HomeView>, limit = NOW_LIMIT): P0Task[] {
  const overdue = view.groups.find((group) => group.id === 'overdue')?.tasks ?? [];
  const dueToday = view.groups.find((group) => group.id === 'today')?.tasks ?? [];
  const seen = new Set<string>();
  return [...view.focus, ...overdue, ...dueToday].filter((task) => !seen.has(task.id) && seen.add(task.id)).slice(0, limit);
}

/** Short deadline wording for a row: "2일 지남", "오늘까지", "내일까지", "10/29까지". */
export function dueLabel(dueDate: string | null, today: string): { text: string; level: 'late' | 'soon' | 'later' } | null {
  if (!dueDate) return null;
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / 86_400_000);
  if (Number.isNaN(days)) return { text: dueDate, level: 'later' };
  if (days < 0) return { text: `${-days}일 지남`, level: 'late' };
  if (days === 0) return { text: '오늘까지', level: 'soon' };
  if (days === 1) return { text: '내일까지', level: 'soon' };
  return { text: `${dueDate.slice(5).replace('-', '/')}까지`, level: 'later' };
}
