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
    ...(value.source === 'portal' || value.source === 'mail' ? { source: value.source } : {}),
  };
}

function calendarWriteErrorMessage(errorCode: string): string {
  if (errorCode === 'insufficient_permissions') return 'Google Calendar API가 일정 등록 권한을 거부했어. Service Account와 Calendar ID가 실제 공유 대상과 같은지 확인해줘.';
  if (errorCode === 'provider_bad_request') return 'Google Calendar 요청 형식이 잘못됐어. 날짜·시간 형식을 확인해줘.';
  if (errorCode === 'auth_error') return 'Google Calendar 등록 권한이 없어. Calendar 공유 설정에서 Service Account에 “Make changes to events” 권한을 부여해줘.';
  if (errorCode === 'invalid_calendar') return 'Calendar ID가 잘못됐거나 Service Account에 해당 Calendar가 공유되지 않았어.';
  if (errorCode === 'quota_error') return 'Google Calendar API quota 또는 rate limit을 확인해줘.';
  if (errorCode === 'malformed_response') return 'Google Calendar 응답 형식을 확인할 수 없어.';
  if (errorCode === 'conflict') return '같은 Calendar event가 이미 존재해.';
  return 'Google Calendar 연결을 확인해줘.';
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
    console.error('[calendar] POST /api/calendar/events failed', JSON.stringify({
      errorCode,
      httpStatus: error instanceof CalendarIntegrationError ? error.httpStatus || null : null,
      providerReason: error instanceof CalendarIntegrationError ? error.providerReason || null : null,
      providerMessage: error instanceof CalendarIntegrationError ? error.providerMessage || null : null,
    }));
    return NextResponse.json({ ok: false, errorCode, error: error instanceof CalendarIntegrationError ? calendarWriteErrorMessage(errorCode) : 'Google Calendar 연결을 확인해줘.' }, { status });
  }
}
