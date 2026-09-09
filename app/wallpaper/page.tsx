'use client';

import { useEffect, useRef, useState } from 'react';
import { dashboardApi, type CalendarApiResponse } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import type { ResearchProject } from '@/lib/projects';
import type { DashboardBundle } from '@/lib/results';
import { daysUntil } from '@/lib/calendar-view';
import { selectLatestWallpaperResults, selectWallpaperCalendar, selectWallpaperProject, wallpaperTasks, WALLPAPER_REFRESH_MS } from '@/lib/wallpaper-view';
import styles from './wallpaper.module.css';

const initialCalendar: CalendarApiResponse = {
  configured: false, state: 'unconfigured', calendarId: 'primary', timezone: 'Asia/Seoul',
  range: { days: 14, timeMin: '', timeMax: '' }, items: [],
};
const initialDashboard: DashboardBundle = { source: 'empty', necessaryLabour: null, decomposition: null, validation: null };

type ProjectResponse = Awaited<ReturnType<typeof dashboardApi.projects>>;

export default function WallpaperPage() {
  const [now, setNow] = useState<Date | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [calendar, setCalendar] = useState<CalendarApiResponse>(initialCalendar);
  const [results, setResults] = useState<DashboardBundle>(initialDashboard);
  const lastFetch = useRef(0);
  const refreshing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let clock: ReturnType<typeof setInterval> | null = null;

    const clearDataTimer = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const scheduleDataRefresh = () => {
      clearDataTimer();
      if (document.visibilityState === 'hidden') return;
      timer.current = setTimeout(() => { void refreshData(); }, WALLPAPER_REFRESH_MS);
    };

    async function refreshData() {
      if (document.visibilityState === 'hidden' || refreshing.current) return;
      refreshing.current = true;
      const responses = await Promise.allSettled([dashboardApi.projects(), dashboardApi.calendar(), dashboardApi.results()]);
      if (!document.hidden) {
        const [projectResponse, calendarResponse, resultsResponse] = responses;
        if (projectResponse.status === 'fulfilled') setProjects((projectResponse.value as ProjectResponse).items || []);
        if (calendarResponse.status === 'fulfilled') setCalendar(calendarResponse.value);
        if (resultsResponse.status === 'fulfilled') setResults(resultsResponse.value);
        lastFetch.current = Date.now();
        scheduleDataRefresh();
      }
      refreshing.current = false;
    }

    const startClock = () => {
      if (clock || document.visibilityState === 'hidden') return;
      setNow(new Date());
      clock = setInterval(() => setNow(new Date()), 1000);
    };
    const stopClock = () => { if (clock) clearInterval(clock); clock = null; };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopClock();
        clearDataTimer();
        return;
      }
      startClock();
      if (Date.now() - lastFetch.current >= WALLPAPER_REFRESH_MS) void refreshData();
      else scheduleDataRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    startClock();
    void refreshData();
    return () => {
      stopClock();
      clearDataTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const displayNow = now || new Date(0);
  const project = selectWallpaperProject(projects);
  const calendarView = selectWallpaperCalendar(calendar.items, displayNow);
  const resultView = selectLatestWallpaperResults(results);

  return <main className={styles.wallpaper} aria-label="Master Thesis OS wallpaper">
    <section className={styles.header}>
      <div><p className={styles.eyebrow}>MASTER THESIS OS</p><h1>Research Desk</h1></div>
      <time dateTime={displayNow.toISOString()}><strong>{now ? formatTime(displayNow) : '—'}</strong><span>{now ? formatDate(displayNow) : ''}</span></time>
    </section>

    <section className={styles.grid}>
      <article className={styles.card}>
        <p className={styles.label}>현재 작성중 논문</p>
        <h2>{project?.title || '연구 프로젝트 없음'}</h2>
        <p className={styles.focus}>{project?.currentFocus || '현재 집중 항목이 없습니다.'}</p>
        {wallpaperTasks(project).map((task) => <p className={styles.task} key={task}>· {task}</p>)}
      </article>

      <article className={styles.card}>
        <p className={styles.label}>오늘 일정</p>
        {calendarView.today.length ? calendarView.today.map((event) => <EventRow event={event} key={event.id} />) : <p className={styles.muted}>{calendarMessage(calendar)}</p>}
      </article>

      <article className={styles.card}>
        <p className={styles.label}>다음 일정</p>
        {calendarView.next ? <><h2>{calendarView.next.title}</h2><p className={styles.focus}>{formatEvent(calendarView.next)} · {daysUntil(calendarView.next, displayNow) === 0 ? '오늘' : `D-${daysUntil(calendarView.next, displayNow)}`}</p></> : <p className={styles.muted}>예정된 마감·미팅 없음</p>}
      </article>

      <article className={styles.card}>
        <p className={styles.label}>분석 결과</p>
        <div className={styles.metrics}><Metric label={resultView.necessaryLabourYear ? `${resultView.necessaryLabourYear} 필요노동` : '필요노동'} value={resultView.necessaryLabour === null ? '—' : `${formatNumber(resultView.necessaryLabour)}h`} /><Metric label={resultView.period ? `${resultView.period} 변화` : '기간 변화'} value={resultView.totalChange === null ? '—' : signed(resultView.totalChange)} /><Metric label="검증" value={resultView.validationStatus === 'pass' ? '통과' : resultView.validationStatus || '—'} /></div>
      </article>
    </section>
  </main>;
}

function EventRow({ event }: { event: CalendarEvent }) { return <div className={styles.event}><b>{event.title}</b><span>{formatEvent(event)} · {event.category}</span></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div>; }
function formatDate(value: Date) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short', month: 'long', day: 'numeric' }).format(value); }
function formatTime(value: Date) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value); }
function formatEvent(event: CalendarEvent) { if (event.allDay) return `${event.start} 종일`; return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(event.start)); }
function formatNumber(value: number) { return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
function signed(value: number) { return `${value >= 0 ? '+' : ''}${formatNumber(value)}h`; }
function calendarMessage(calendar: CalendarApiResponse) { if (calendar.state === 'unconfigured') return 'Google Calendar 연결 대기 중'; if (calendar.state === 'empty') return '오늘 일정 없음'; if (calendar.errorCode === 'auth_error') return 'Calendar 인증을 확인해 주세요'; return '일정을 불러올 수 없음'; }
