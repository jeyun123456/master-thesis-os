'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResearchMiniTrend } from '@/app/research-mini-trend';
import { dashboardApi, type CalendarApiResponse } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import { eventDateKey, seoulDateKey } from '@/lib/calendar-view';
import { stageLabel, type ResearchProject } from '@/lib/projects';
import type { ResearchStatus } from '@/lib/research-status';
import type { DashboardBundle } from '@/lib/results';

const initialCalendar: CalendarApiResponse = {
  configured: false,
  state: 'unconfigured',
  calendarId: 'primary',
  timezone: 'Asia/Seoul',
  range: { days: 14, timeMin: '', timeMax: '' },
  items: [],
};

const initialDashboard: DashboardBundle = {
  source: 'empty',
  resultPath: null,
  necessaryLabour: null,
  decomposition: null,
  validation: null,
};

export default function WallpaperPage() {
  const [clock, setClock] = useState<Date | null>(null);
  const [calendar, setCalendar] = useState<CalendarApiResponse>(initialCalendar);
  const [dashboard, setDashboard] = useState<DashboardBundle>(initialDashboard);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const updateClock = () => setClock(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const results = await Promise.allSettled([
        dashboardApi.calendar(),
        dashboardApi.results(),
        dashboardApi.projects(),
        dashboardApi.researchStatus(),
      ]);
      if (!active) return;

      let failed = false;
      const [calendarResult, dashboardResult, projectResult, statusResult] = results;
      if (calendarResult.status === 'fulfilled') setCalendar(calendarResult.value);
      else failed = true;
      if (dashboardResult.status === 'fulfilled') setDashboard(dashboardResult.value);
      else failed = true;
      if (projectResult.status === 'fulfilled') setProjects(projectResult.value.items || []);
      else failed = true;
      if (statusResult.status === 'fulfilled') setResearchStatus(statusResult.value.status);
      else failed = true;
      setHasError(failed);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === 'thesis') || projects.find((project) => project.status === 'active' || project.status === 'writing') || projects[0] || null,
    [projects],
  );
  const tasks = useMemo(() => {
    const projectTasks = activeProject?.nextTasks || [];
    return (projectTasks.length ? projectTasks : researchStatus?.nextActions || []).slice(0, 3);
  }, [activeProject, researchStatus]);
  const nextEvent = useMemo(() => findNextEvent(calendar.items, clock || new Date()), [calendar.items, clock]);
  const focus = activeProject?.currentFocus || researchStatus?.nextActions[0] || researchStatus?.currentStage || '현재 집중 항목이 등록되지 않았어.';
  const stage = activeProject ? stageLabel(activeProject.stage) : researchStatus?.currentStage || '연구 상태 확인 중';

  return <main className="wallpaper-view">
    <div className="wallpaper-visual" aria-hidden="true" />
    <aside className="wallpaper-rail">
      <div className="wallpaper-brand">
        <span className="wallpaper-brand-mark">M</span>
        <div><strong>Master Thesis OS</strong><small>ambient research HUD</small></div>
      </div>

      <div className="wallpaper-clock" aria-live="polite">
        <time>{clock ? formatClock(clock) : '--:--'}</time>
        <span>{clock ? formatWallpaperDate(clock) : '날짜 확인 중'}</span>
      </div>

      <section className="wallpaper-section wallpaper-current">
        <div className="wallpaper-label">CURRENT</div>
        <h1>{activeProject?.title || 'Master Thesis 연구'}</h1>
        <p>{focus}</p>
        <div className="wallpaper-status"><i aria-hidden="true" />{stage}</div>
      </section>

      <section className="wallpaper-section">
        <div className="wallpaper-label">NEXT</div>
        {nextEvent ? <>
          <strong className="wallpaper-next-title">{nextEvent.title}</strong>
          <span className="wallpaper-detail">{formatWallpaperEvent(nextEvent)}{nextEvent.location ? ` · ${nextEvent.location}` : ''}</span>
        </> : <span className="wallpaper-detail">{calendarStateText(calendar)}</span>}
      </section>

      <section className="wallpaper-section">
        <div className="wallpaper-label">TODO</div>
        {tasks.length ? <div className="wallpaper-tasks">{tasks.map((task) => <div className="wallpaper-task" key={task}><span aria-hidden="true">□</span><strong>{task}</strong></div>)}</div> : <span className="wallpaper-detail">현재 등록된 다음 작업이 없어.</span>}
      </section>

      <section className="wallpaper-section wallpaper-trend">
        <div className="wallpaper-label">TREND</div>
        <ResearchMiniTrend
          series={dashboard.necessaryLabour?.series || []}
          sourceLabel="필요노동 · 시간"
          className="research-mini-trend--wallpaper"
        />
      </section>

      <div className="wallpaper-footer">
        <span>{loading ? 'research sources loading' : hasError ? 'some sources need attention' : 'live from research sources'}</span>
        <span>Ctrl + Alt + W · open dashboard</span>
      </div>
    </aside>
  </main>;
}

function findNextEvent(events: CalendarEvent[], now: Date) {
  const today = seoulDateKey(now);
  return events
    .filter((event) => {
      if (event.allDay) return eventDateKey(event) >= today;
      const timestamp = Date.parse(event.start);
      return Number.isFinite(timestamp) && timestamp >= now.getTime();
    })
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right) || left.id.localeCompare(right.id))[0] || null;
}

function eventTimestamp(event: CalendarEvent) {
  if (event.allDay) return Date.parse(`${event.start}T00:00:00+09:00`);
  return Date.parse(event.start);
}

function formatClock(value: Date) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
}

function formatWallpaperDate(value: Date) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long', month: 'long', day: 'numeric' }).format(value);
}

function formatWallpaperEvent(event: CalendarEvent) {
  if (event.allDay) return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' }).format(new Date(`${event.start}T00:00:00+09:00`));
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(event.start));
}

function calendarStateText(calendar: CalendarApiResponse) {
  if (calendar.state === 'unconfigured') return 'Google Calendar 설정이 필요해.';
  if (calendar.state === 'empty') return '예정된 일정이 없어.';
  if (calendar.state === 'error') return 'Calendar 연결을 확인해줘.';
  return '다음 일정이 없어.';
}
