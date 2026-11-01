import { NextResponse, type NextRequest } from 'next/server';
import { calendarConfigured, getCalendarEvents, type CalendarEvent } from './calendar';
import { buildP0HomeView, p0TodayInTokyo, pickNowTasks } from './p0-home';
import { noStore, p0ErrorResponse, p0Request } from './p0-server';
import type { P0Task } from './p0-tasks-client';

export const MOBILE_CALENDAR_DAYS = 3;
export const MOBILE_EVENT_LIMIT = 12;
export const MOBILE_TASK_LIMIT = 3;
const bearer = /^Bearer ([A-Za-z0-9._~+/=-]{8,4096})$/;

/** Bearer token for `/api/mobile/**` only. Web cookies are intentionally not accepted here. */
export function mobileBearerToken(request: NextRequest | Request) {
  return bearer.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
}

export function mobileUnauthorized() {
  return noStore(NextResponse.json({ error: '로그인이 필요해.' }, { status: 401 }));
}

export function mobileErrorResponse(error: unknown, fallback?: string) {
  return p0ErrorResponse(error, fallback);
}

type SourceState = 'ready' | 'empty' | 'unconfigured' | 'error';

export type MobileEvent = Pick<CalendarEvent, 'id' | 'title' | 'start' | 'end' | 'allDay' | 'location'>;

export function toMobileEvents(items: CalendarEvent[]): MobileEvent[] {
  return items
    .filter((item) => item.status !== 'cancelled')
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
    .slice(0, MOBILE_EVENT_LIMIT)
    .map(({ id, title, start, end, allDay, location }) => ({ id, title, start, end, allDay, location }));
}

export function toMobileTasks(tasks: P0Task[], today: string) {
  const view = buildP0HomeView(tasks, today);
  const pick = (task: P0Task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.due_date,
    isToday: task.is_today,
    version: task.version,
  });
  return {
    items: pickNowTasks(view, MOBILE_TASK_LIMIT).map(pick),
    openCount: view.openCount,
    overdueCount: view.overdueCount,
    focusCount: view.focusCount,
    doneTodayCount: view.doneToday.length,
  };
}

async function calendarSection(now: Date, today: string): Promise<{ state: SourceState; events: MobileEvent[] }> {
  if (!calendarConfigured()) return { state: 'unconfigured', events: [] };
  try {
    const events = toMobileEvents(await getCalendarEvents(MOBILE_CALENDAR_DAYS, { startDate: today, now }));
    return { state: events.length ? 'ready' : 'empty', events };
  } catch {
    return { state: 'error', events: [] };
  }
}

/** Throws P0ApiError when the task source (or the session) fails; calendar failure is only a partial response. */
export async function buildMobileWidget(token: string, now = new Date()) {
  const today = p0TodayInTokyo(now);
  const [taskResult, calendar] = await Promise.all([
    p0Request<{ tasks?: P0Task[] }>('/api/tasks', { token }),
    calendarSection(now, today),
  ]);
  const tasks = toMobileTasks(Array.isArray(taskResult.tasks) ? taskResult.tasks : [], today);
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    date: today,
    timeZone: 'Asia/Tokyo',
    calendar,
    tasks: { state: (tasks.openCount || tasks.doneTodayCount ? 'ready' : 'empty') as SourceState, ...tasks },
  };
}
