'use client';

import { useEffect, useRef, useState } from 'react';
import { dashboardApi, type CalendarApiResponse } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import type { ResearchProject } from '@/lib/projects';
import type { DashboardBundle } from '@/lib/results';
import { daysUntil } from '@/lib/calendar-view';
import { selectLatestWallpaperResults, selectWallpaperCalendar, selectWallpaperProject, wallpaperTasks, WALLPAPER_REFRESH_MS } from '@/lib/wallpaper-view';
import { BRIDGE_OFFLINE_MESSAGE, bridgeResponseMessage } from '@/lib/bridge-status';
import styles from './wallpaper.module.css';

const initialCalendar: CalendarApiResponse = {
  configured: false, state: 'unconfigured', calendarId: 'primary', timezone: 'Asia/Seoul',
  range: { days: 14, timeMin: '', timeMax: '' }, items: [],
};
const initialDashboard: DashboardBundle = { source: 'empty', necessaryLabour: null, decomposition: null, validation: null };

type ProjectResponse = Awaited<ReturnType<typeof dashboardApi.projects>>;

const dateFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short', month: 'long', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const eventFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const numberFormatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

export default function WallpaperPage() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [calendar, setCalendar] = useState<CalendarApiResponse>(initialCalendar);
  const [results, setResults] = useState<DashboardBundle>(initialDashboard);
  const [viewNow, setViewNow] = useState<Date | null>(null);
  const [bridgeMessage, setBridgeMessage] = useState('');
  const lastFetch = useRef(0);
  const refreshing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;

    const clearDataTimer = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const scheduleDataRefresh = (delay = WALLPAPER_REFRESH_MS) => {
      clearDataTimer();
      if (disposed || document.visibilityState === 'hidden') return;
      timer.current = setTimeout(() => { void refreshData(); }, Math.max(0, delay));
    };

    async function refreshData() {
      if (disposed || document.hidden || refreshing.current) return;
      refreshing.current = true;
      try {
        const responses = await Promise.allSettled([dashboardApi.projects(), dashboardApi.calendar(), dashboardApi.results()]);
        if (disposed || document.hidden) return;
        const [projectResponse, calendarResponse, resultsResponse] = responses;
        if (projectResponse.status === 'fulfilled') setProjects((projectResponse.value as ProjectResponse).items || []);
        if (calendarResponse.status === 'fulfilled') setCalendar(calendarResponse.value);
        if (resultsResponse.status === 'fulfilled') setResults(resultsResponse.value);
        const fetchedAt = Date.now();
        lastFetch.current = fetchedAt;
        setViewNow(new Date(fetchedAt));
        scheduleDataRefresh();
      } finally {
        refreshing.current = false;
      }
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearDataTimer();
        return;
      }
      const elapsed = lastFetch.current ? Date.now() - lastFetch.current : WALLPAPER_REFRESH_MS;
      if (elapsed >= WALLPAPER_REFRESH_MS) void refreshData();
      else scheduleDataRefresh(WALLPAPER_REFRESH_MS - elapsed);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    setViewNow(new Date());
    void refreshData();
    return () => {
      disposed = true;
      clearDataTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const displayNow = viewNow || new Date(0);
  const project = selectWallpaperProject(projects);
  const calendarView = selectWallpaperCalendar(calendar.items, displayNow);
  const resultView = selectLatestWallpaperResults(results);

  async function openLocal(endpoint: '/open' | '/open-folder', path = '') {
    const base = process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471';
    const token = localStorage.getItem('thesisBridgeToken') || '';
    try {
      const response = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, token }),
      });
      const data = await response.json() as { error?: unknown };
      if (!response.ok) {
        setBridgeMessage(bridgeResponseMessage(response.status, data.error));
        return;
      }
      setBridgeMessage(endpoint === '/open' ? '로컬 파일을 열었어' : '볼트 폴더를 열었어');
    } catch {
      setBridgeMessage(BRIDGE_OFFLINE_MESSAGE);
    }
  }

  return <main className={styles.wallpaper} aria-label="Master Thesis OS wallpaper">
    <section className={styles.header}>
      <div><p className={styles.eyebrow}>MASTER THESIS OS</p><h1>Research Desk</h1></div>
      <div className={styles.headerActions}><WallpaperClock /><div className={styles.localActions}><button type="button" onClick={() => openLocal('/open', project?.sourcePath || 'wiki/current_status.md')}>로컬 파일 열기</button><button type="button" onClick={() => openLocal('/open-folder')}>볼트 폴더 열기</button>{bridgeMessage && <span role="status">{bridgeMessage}</span>}</div></div>
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

function WallpaperClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let clock: ReturnType<typeof setInterval> | null = null;

    const stopClock = () => {
      if (clock) clearInterval(clock);
      clock = null;
    };
    const startClock = () => {
      if (clock || document.visibilityState === 'hidden') return;
      setNow(new Date());
      clock = setInterval(() => setNow(new Date()), 1000);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') stopClock();
      else startClock();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    startClock();
    return () => {
      stopClock();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const displayNow = now || new Date(0);
  return <time dateTime={now ? displayNow.toISOString() : undefined}><strong>{now ? formatTime(displayNow) : '—'}</strong><span>{now ? formatDate(displayNow) : ''}</span></time>;
}

function EventRow({ event }: { event: CalendarEvent }) { return <div className={styles.event}><b>{event.title}</b><span>{formatEvent(event)} · {event.category}</span></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div>; }
function formatDate(value: Date) { return dateFormatter.format(value); }
function formatTime(value: Date) { return timeFormatter.format(value); }
function formatEvent(event: CalendarEvent) { if (event.allDay) return `${event.start} 종일`; return eventFormatter.format(new Date(event.start)); }
function formatNumber(value: number) { return numberFormatter.format(value); }
function signed(value: number) { return `${value >= 0 ? '+' : ''}${formatNumber(value)}h`; }
function calendarMessage(calendar: CalendarApiResponse) { if (calendar.state === 'unconfigured') return 'Google Calendar 연결 대기 중'; if (calendar.state === 'ready' || calendar.state === 'empty') return '오늘 일정 없음'; if (calendar.errorCode === 'auth_error') return 'Calendar 인증을 확인해 주세요'; return '일정을 불러올 수 없음'; }
