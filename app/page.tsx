'use client';

import { useEffect, useMemo, useState } from 'react';
import { LibraryPanel } from '@/app/library-panel';
import { ResearchPanel } from '@/app/research-panel';
import { dashboardApi, type CalendarApiResponse } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import { daysUntil, groupCalendarEvents } from '@/lib/calendar-view';
import type { GitHubCommitSummary } from '@/lib/github';
import type { ResearchProject } from '@/lib/projects';
import type { RepositoryItem } from '@/lib/repository';
import type { ResearchStatus } from '@/lib/research-status';
import type { DashboardBundle } from '@/lib/results';

type Page = 'home' | 'research' | 'results' | 'library' | 'settings';

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
  necessaryLabour: null,
  decomposition: null,
  validation: null,
};

const pageMeta: Record<Page, [string, string]> = {
  home: ['홈', '오늘의 연구 작업과 다음 행동을 한눈에'],
  research: ['연구', '프로젝트별 질문 · 진행 단계 · 다음 작업 · 관련 자료'],
  results: ['분석 결과', '필요노동 추이 · 분해 · 검증 결과'],
  library: ['자료실', '주요 자료 · 대표 문헌 · 연구 Wiki'],
  settings: ['설정', '연구 저장소 · Google Calendar · 로컬 브리지'],
};

const navigation: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'home', label: '홈', icon: '⌂' },
  { id: 'research', label: '연구', icon: '⌕' },
  { id: 'results', label: '분석 결과', icon: '▥' },
  { id: 'library', label: '자료실', icon: '▤' },
  { id: 'settings', label: '설정', icon: '⚙' },
];

export default function Page() {
  const [page, setPage] = useState<Page>('home');
  const [tree, setTree] = useState<RepositoryItem[]>([]);
  const [calendar, setCalendar] = useState<CalendarApiResponse>(initialCalendar);
  const [dashboard, setDashboard] = useState<DashboardBundle>(initialDashboard);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [commits, setCommits] = useState<GitHubCommitSummary[]>([]);
  const [ghConfigured, setGhConfigured] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        dashboardApi.tree(),
        dashboardApi.calendar(),
        dashboardApi.results(),
        dashboardApi.commits(),
        dashboardApi.researchStatus(),
        dashboardApi.projects(),
      ]);
      const nextErrors: string[] = [];
      const [treeResult, calendarResult, dashboardResult, commitResult, statusResult, projectResult] = results;

      if (treeResult.status === 'fulfilled') {
        setGhConfigured(treeResult.value.configured);
        setTree(treeResult.value.items || []);
        if (treeResult.value.error) nextErrors.push(treeResult.value.error);
      } else nextErrors.push(errorMessage(treeResult.reason, 'GitHub 연구 저장소 연결에 실패했습니다.'));

      if (calendarResult.status === 'fulfilled') setCalendar(calendarResult.value);
      else setCalendar({ ...initialCalendar, state: 'error', errorCode: 'network_error' });

      if (dashboardResult.status === 'fulfilled') setDashboard(dashboardResult.value);
      if (commitResult.status === 'fulfilled') setCommits(commitResult.value.items || []);
      if (statusResult.status === 'fulfilled') setResearchStatus(statusResult.value.status);
      else nextErrors.push(errorMessage(statusResult.reason, '현재 연구 상태를 불러오지 못했습니다.'));

      if (projectResult.status === 'fulfilled') {
        setProjects(projectResult.value.items || []);
        if (projectResult.value.error) nextErrors.push(projectResult.value.error);
      } else nextErrors.push(errorMessage(projectResult.reason, '연구 프로젝트를 불러오지 못했습니다.'));

      setErrors(nextErrors);
    })();
  }, []);

  function pop(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 1700);
  }

  async function openLocal(path: string) {
    const base = process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471';
    const token = localStorage.getItem('thesisBridgeToken') || '';
    try {
      const response = await fetch(`${base}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'bridge error');
      pop('로컬에서 열었어');
    } catch {
      pop('로컬 브리지를 확인해줘');
    }
  }

  const schedule = useMemo(() => groupCalendarEvents(calendar.items), [calendar.items]);
  const activeProject = useMemo(() => projects.find((project) => project.id === 'thesis') || projects.find((project) => project.status === 'active') || projects[0] || null, [projects]);
  const quickFiles = useMemo(() => {
    const items = [
      ...(activeProject ? [{ label: `${activeProject.title} 프로젝트`, path: activeProject.sourcePath }] : []),
      ...(researchStatus ? [{ label: '현재 연구 상태', path: researchStatus.sourcePath }, ...researchStatus.importantFiles] : []),
    ];
    return items.filter((item, index) => items.findIndex((candidate) => candidate.path === item.path) === index).slice(0, 5);
  }, [activeProject, researchStatus]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo">M</div><div><h1>Master Thesis OS</h1><p>석사논문 연구 작업실 · v1.2.0</p></div></div>
        <nav className="nav">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-source"><span>연구 기준</span><b>Obsidian Vault</b><small>projects/ + shared/ · GitHub live</small></div>
      </aside>

      <main className="main">
        <header className="top">
          <div><h2>{pageMeta[page][0]}</h2><p>{pageMeta[page][1]}</p></div>
          <div className="badges"><div className="badge">GitHub {ghConfigured ? '● 연결됨' : '○ 설정 필요'}</div><div className="badge">Calendar {calendar.state === 'ready' || calendar.state === 'empty' ? '● 연결됨' : '○ 확인 필요'}</div><div className="badge">v1.2.0</div></div>
        </header>

        {errors.length > 0 && <div className="error page-error">{errors[0]}</div>}

        {page === 'home' && <section className="page active">
          <CurrentFocus project={activeProject} status={researchStatus} onOpen={openLocal} />
          <div className="kpis home-kpis">
            <Kpi label="활성 프로젝트" value={projects.length ? String(projects.filter((project) => project.status === 'active').length) : '—'} sub={activeProject?.title || 'projects/ 연결 대기'} />
            <Kpi label="다음 마감" value={schedule.nextDeadline ? deadlineLabel(schedule.nextDeadline) : '없음'} sub={schedule.nextDeadline?.title || '향후 일정에 마감 없음'} />
            <Kpi label="결과 검증" value={dashboard.validation?.status === 'pass' ? '통과' : '확인 필요'} sub="Exporter validation" />
            <Kpi label="연구 파일" value={ghConfigured ? String(tree.filter((item) => item.type === 'blob').length) : '—'} sub="GitHub live source" />
          </div>
          <div className="grid3">
            <CalendarCard title="오늘 일정" events={schedule.today} calendar={calendar} />
            <CalendarCard title="예정 일정" events={schedule.upcoming.slice(0, 6)} calendar={calendar} />
            <Card title="다음 마감" right="마감 · 미팅">{schedule.nextDeadline ? <div className="event priority-event"><b>{schedule.nextDeadline.title}</b><small>{formatCalendarEvent(schedule.nextDeadline)} · {deadlineLabel(schedule.nextDeadline)}</small>{schedule.nextDeadline.location && <small>{schedule.nextDeadline.location}</small>}</div> : <CalendarState calendar={calendar} />}</Card>
          </div>
          <div className="grid2 section-gap">
            <Card title="바로 다음 작업" right={activeProject ? activeProject.title : 'Wiki live'}><NumberedList items={activeProject?.nextTasks || researchStatus?.nextActions || []} empty="활성 프로젝트의 다음 작업을 표시해." /></Card>
            <Card title="막힌 부분" right={activeProject ? activeProject.title : '확인 필요'}><NumberedList items={activeProject?.blocked || researchStatus?.unresolved || []} empty="현재 등록된 막힌 부분이 없어." /></Card>
          </div>
          <div className="grid2 section-gap">
            <Card title="최근 변경" right="연구 저장소 GitHub"><CommitList commits={commits.slice(0, 6)} /></Card>
            <Card title="빠른 열기" right="로컬 작업">{quickFiles.length ? quickFiles.map((item) => <div className="quick-open" key={item.path}><div><b>{item.label}</b><small>{item.path}</small></div><button className="mini" onClick={() => openLocal(item.path)}>로컬에서 열기</button></div>) : <div className="empty compact-empty">프로젝트가 연결되면 주요 파일을 바로 열 수 있어.</div>}</Card>
          </div>
        </section>}

        {page === 'research' && <section className="page active"><ResearchPanel projects={projects} tree={tree} onOpen={openLocal} onCopy={(prompt) => { navigator.clipboard.writeText(prompt); pop('프롬프트를 복사했어'); }} /></section>}
        {page === 'results' && <section className="page active"><ResultsPanel dashboard={dashboard} /></section>}
        {page === 'library' && <section className="page active"><LibraryPanel tree={tree} researchStatus={researchStatus} onOpen={openLocal} /></section>}

        {page === 'settings' && <section className="page active">
          <div className="grid2">
            <Card title="연구 저장소" right={ghConfigured ? '연결됨' : '설정 필요'}><div className="note">GitHub의 Obsidian Vault가 연구 데이터의 기준이야. 프로젝트는 <code>projects/*/project.md</code>에서 자동 발견하고, 기존 <code>wiki/ · Calc/ · 연구/</code> 경로는 manifest가 연결해.</div></Card>
            <Card title="로컬 브리지" right="127.0.0.1 전용"><div className="note">로컬 파일 열기는 PC에서 bridge를 실행했을 때만 동작해. 토큰은 이 브라우저의 localStorage에 저장돼.</div><BridgeToken onSave={() => pop('브리지 토큰을 저장했어')} /></Card>
          </div>
          <div className="grid2 section-gap">
            <Card title="Google Calendar" right={calendar.state === 'ready' || calendar.state === 'empty' ? '연결됨' : '확인 필요'}><div className="note">현재 상태: {calendarStateText(calendar)}</div></Card>
            <Card title="버전" right="v1.2.0"><div className="note">프로젝트 기반 연구탭 · repo project manifest · 한국어 UI · 큐레이션 자료실 · 모바일 내비게이션.</div></Card>
          </div>
        </section>}
      </main>

      <nav className="mobile-nav" aria-label="모바일 메뉴">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

function CurrentFocus({ project, status, onOpen }: { project: ResearchProject | null; status: ResearchStatus | null; onOpen: (path: string) => void }) {
  const title = project?.currentFocus || status?.nextActions[0] || '연구 프로젝트를 불러오는 중이야.';
  const next = project?.nextTasks[0] || status?.nextActions[1] || '';
  const path = project?.sourcePath || status?.sourcePath || 'wiki/current_status.md';
  return <div className="focus-card card"><div className="focus-meta"><span>현재 집중 프로젝트</span><b>{project?.title || status?.currentStage || '연구 상태 연결 중'}</b></div><div className="focus-main"><h3>{title}</h3>{next && next !== title && <p>다음: {next}</p>}</div><button className="btn primary" onClick={() => onOpen(path)}>{project ? '프로젝트 열기' : '현재 상태 열기'}</button></div>;
}

function Card({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) { return <div className="card section"><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</div>; }
function CalendarCard({ title, events, calendar }: { title: string; events: CalendarEvent[]; calendar: CalendarApiResponse }) { return <Card title={title} right={calendar.state === 'ready' ? 'Google Calendar' : 'Calendar'}>{events.length ? events.map((event) => <div className="event" key={event.id}><b>{event.title}</b><small>{formatCalendarEvent(event)} · {event.category}</small>{event.location && <small>{event.location}</small>}</div>) : <CalendarState calendar={calendar} />}</Card>; }
function CalendarState({ calendar }: { calendar: CalendarApiResponse }) { return <div className={calendar.state === 'error' ? 'error' : 'empty compact-empty'}>{calendarStateText(calendar)}</div>; }
function calendarStateText(calendar: CalendarApiResponse) { if (calendar.state === 'unconfigured') return 'Google Calendar 설정이 필요해.'; if (calendar.state === 'empty') return '오늘부터 14일 안에 일정이 없어.'; if (calendar.errorCode === 'auth_error') return 'Calendar 인증정보를 갱신해야 해.'; if (calendar.errorCode === 'quota_error') return 'Google Calendar API quota를 확인해줘.'; if (calendar.errorCode === 'malformed_response') return 'Calendar 응답 형식을 확인할 수 없어.'; if (calendar.state === 'error') return 'Calendar 네트워크 연결을 확인해줘.'; return '해당 일정이 없어.'; }
function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) { return <div className="card kpi"><small>{label}</small><strong>{value}</strong><span>{sub}</span></div>; }
function NumberedList({ items, empty }: { items: string[]; empty: string }) { if (!items.length) return <div className="empty compact-empty">{empty}</div>; return <div className="numbered-list">{items.map((item, index) => <div className="numbered-item" key={`${index}-${item}`}><span>{index + 1}</span><p>{item}</p></div>)}</div>; }
function CommitList({ commits }: { commits: GitHubCommitSummary[] }) { if (!commits.length) return <div className="empty compact-empty">최근 GitHub 변경을 불러오는 중이거나 연결 정보가 없어.</div>; return <div>{commits.map((commit) => <div className="commit" key={commit.sha}><div><b>{commit.message}</b><small>{commit.author} · {relativeDate(commit.date)}</small></div><code>{commit.sha.slice(0, 7)}</code></div>)}</div>; }

function ResultsPanel({ dashboard }: { dashboard: DashboardBundle }) {
  if (!dashboard.necessaryLabour || !dashboard.decomposition || !dashboard.validation) return <div className="card empty result-empty"><h3>분석 결과를 불러올 수 없어</h3><p>{dashboard.error || 'exporter를 실행하고 검증된 JSON을 GitHub에 반영해줘.'}</p><code>python exporter/export_results.py</code></div>;
  const levels = dashboard.necessaryLabour.series;
  const periods = dashboard.decomposition.periods;
  const maxLevel = Math.max(...levels.map((item) => item.value));
  const focus = periods.find((item) => item.period === '2015-2020') || periods[0];
  const contributions = [...focus.contributions].sort((a, b) => Math.abs(b.totalChange) - Math.abs(a.totalChange)).slice(0, 8);
  return <>
    <div className="kpis">{levels.map((point) => <Kpi key={point.year} label={`${point.year}년`} value={`${formatHours(point.value)}h`} sub={`${point.sourceCell} · 2020년 가격`} />)}<Kpi label="검증 상태" value={dashboard.validation.status === 'pass' ? '통과' : dashboard.validation.status.toUpperCase()} sub={`${dashboard.validation.checks.length}개 exporter 검사`} /></div>
    <div className="grid2 results-grid"><Card title="필요노동 추이" right={dashboard.source === 'github' ? 'GitHub live' : dashboard.source}>{levels.map((point) => <div className="result-bar" key={point.year}><span>{point.year}</span><div className="result-track"><div style={{ width: `${point.value / maxLevel * 100}%` }} /></div><b>{formatHours(point.value)}h</b></div>)}</Card><Card title="기간별 2요인 분해" right="시간"><table className="result-table"><thead><tr><th>기간</th><th>변화량</th><th>바스켓</th><th>투하노동량</th></tr></thead><tbody>{periods.map((item) => <tr key={item.period}><td>{item.period}</td><td>{signed(item.totalChange)}</td><td>{signed(item.basketEffect)}</td><td>{signed(item.embodiedLabourEffect)}</td></tr>)}</tbody></table></Card></div>
    <div className="grid2 results-grid"><Card title={`주요 부문 변화 · ${focus.period}`} right="절대값 순"><table className="result-table"><thead><tr><th>코드</th><th>부문</th><th>변화량</th></tr></thead><tbody>{contributions.map((item) => <tr key={item.code}><td>{item.code}</td><td>{item.name}</td><td>{signed(item.totalChange)}</td></tr>)}</tbody></table></Card><Card title="결과 검증" right={dashboard.validation.scope}>{dashboard.validation.checks.map((check) => <div className="validation-row" key={check.id}><b>{check.status === 'pass' ? '통과' : check.status.toUpperCase()}</b><span>{check.message}</span></div>)}<p className="muted validation-limit">{dashboard.validation.limitation}</p></Card></div>
    <div className="note result-source">출처: <code>{dashboard.necessaryLabour.source.workbook}</code> · <code>{dashboard.decomposition.source.workbook}</code> · 생성 {formatDate(dashboard.validation.generatedAt)}</div>
  </>;
}

function BridgeToken({ onSave }: { onSave: () => void }) { const [value, setValue] = useState(''); useEffect(() => setValue(localStorage.getItem('thesisBridgeToken') || ''), []); return <div className="toolbar bridge-toolbar"><input className="search" placeholder="Bridge token" value={value} onChange={(event) => setValue(event.target.value)} /><button className="btn" onClick={() => { localStorage.setItem('thesisBridgeToken', value); onSave(); }}>저장</button></div>; }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatDate(value: string) { if (!value) return ''; try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; } }
function formatCalendarEvent(event: CalendarEvent) { if (event.allDay) return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' }).format(new Date(`${event.start}T00:00:00+09:00`)); return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(event.start)); }
function formatHours(value: number) { return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function signed(value: number) { return `${value >= 0 ? '+' : ''}${formatHours(value)}`; }
function deadlineLabel(event: CalendarEvent) { const days = daysUntil(event); return days <= 0 ? '오늘' : `D-${days}`; }
function relativeDate(value: string) { if (!value) return '시간 정보 없음'; const diff = Date.now() - new Date(value).getTime(); const minutes = Math.max(0, Math.floor(diff / 60_000)); if (minutes < 60) return `${minutes}분 전`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}시간 전`; const days = Math.floor(hours / 24); if (days < 14) return `${days}일 전`; return formatDate(value); }
