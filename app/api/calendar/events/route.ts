import { NextRequest, NextResponse } from 'next/server';
import {
  CALENDAR_TIMEZONE,
  CalendarIntegrationError,
  calendarConfigured,
  calendarRange,
  configuredCalendarId,
  createCalendarEvent,
  getCalendarEvents,
  type CalendarCreateInput,
} from '@/lib/calendar';

export const runtime = 'nodejs';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createInput(value: unknown): CalendarCreateInput | null {
  if (!isRecord(value)) return null;
  return {
    mailId: typeof value.mailId === 'string' ? value.mailId : '',
    candidateId: typeof value.candidateId === 'string' ? value.candidateId : '',
    title: typeof value.title === 'string' ? value.title : '',
    start: typeof value.start === 'string' ? value.start : '',
    end: typeof value.end === 'string' ? value.end : null,
    allDay: value.allDay === true,
    ...(value.type === 'deadline' || value.type === 'event' ? { type: value.type } : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

export async function GET(req: NextRequest) {
  const requestedDays = Number(req.nextUrl.searchParams.get('days') || 14);
  const range = calendarRange(requestedDays);
  const base = { configured: calendarConfigured(), calendarId: configuredCalendarId(), timezone: CALENDAR_TIMEZONE, range };
  if (!base.configured) return NextResponse.json({ ...base, state: 'unconfigured', items: [] });
  try {
    const items = await getCalendarEvents(range.days);
    return NextResponse.json({ ...base, state: items.length ? 'ready' : 'empty', items });
  } catch (error) {
    const errorCode = error instanceof CalendarIntegrationError ? error.code : 'network_error';
    return NextResponse.json({ ...base, state: 'error', errorCode, items: [] }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!calendarConfigured()) {
    return NextResponse.json({ ok: false, errorCode: 'auth_error', error: 'Google Calendar 설정이 필요해.' }, { status: 503 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_request', error: 'Calendar 요청 형식을 확인해줘.' }, { status: 400 });
  }
  const input = createInput(raw);
  if (!input) return NextResponse.json({ ok: false, errorCode: 'invalid_request', error: 'Calendar 요청 형식을 확인해줘.' }, { status: 400 });
  try {
    const result = await createCalendarEvent(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const errorCode = error instanceof CalendarIntegrationError ? error.code : 'network_error';
    const status = errorCode === 'invalid_request' ? 400 : 502;
    return NextResponse.json({ ok: false, errorCode, error: error instanceof CalendarIntegrationError ? error.message : 'Google Calendar 연결을 확인해줘.' }, { status });
  }
}
