'use client';

import { useEffect, useMemo, useState } from 'react';
import { LibraryPanel } from '@/app/library-panel';
import { MailActionCandidates } from '@/app/mail-action-candidates';
import { MailPanel } from '@/app/mail-panel';
import { MicrosoftMailPanel } from '@/app/microsoft-mail-panel';
import { ResearchPanel } from '@/app/research-panel';
import { ResultsPanel as ResultsDashboardPanel } from '@/app/results-panel';
import { RewardSlotPanel } from '@/app/reward-slot';
import { SchoolMailPanel } from '@/app/school-mail-panel';
import { ShortcutList, ShortcutsPanel } from '@/app/shortcuts-panel';
import { dashboardApi, type CalendarApiResponse, type RepositorySource, type ShortcutSource } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import { daysUntil, groupCalendarEvents } from '@/lib/calendar-view';
import type { GitHubCommitSummary } from '@/lib/github';
import { stageLabel, type ResearchProject } from '@/lib/projects';
import type { RepositoryItem } from '@/lib/repository';
import type { ResearchStatus } from '@/lib/research-status';
import type { DashboardBundle } from '@/lib/results';
import { BRIDGE_OFFLINE_MESSAGE, BRIDGE_TIMEOUT_MESSAGE, bridgeResponseMessage } from '@/lib/bridge-status';
import { getEnabledShortcuts, getHomeShortcuts, loadShortcutState, shortcuts, type Shortcut } from '@/lib/shortcuts';
import appPackage from '../package.json';

type Page = 'home' | 'research' | 'results' | 'library' | 'slot' | 'shortcuts' | 'mail' | 'settings';

const APP_VERSION = appPackage.version;

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

const pageMeta: Record<Page, [string, string]> = {
  home: ['홈', '오늘의 연구 작업과 다음 행동을 한눈에'],
  research: ['연구', '프로젝트별 질문 · 진행 단계 · 다음 작업 · 관련 자료'],
  results: ['분석 결과', '필요노동 추이 · 분해 · 검증 결과'],
  library: ['자료실', '주요 자료 · 대표 문헌 · 연구 Wiki'],
  slot: ['슬롯', '다음 연구 작업을 작은 보상 단위로 관리'],
  shortcuts: ['바로가기', '반복해서 여는 연구 파일 · 폴더 · 웹 주소'],
  mail: ['메일', '학교 업무 · 국제과 · 받은 편지함을 폴더별로 확인'],
  settings: ['설정', '연구 저장소 · Google Calendar · 학교 메일 · 로컬 브리지'],
};

const navigation: Array<{ id: Page; label: string; icon: string }> = [
  { id: 'home', label: '홈', icon: '⌂' },
  { id: 'research', label: '연구', icon: '⌕' },
  { id: 'results', label: '분석 결과', icon: '▥' },
  { id: 'library', label: '자료실', icon: '▤' },
  { id: 'slot', label: '슬롯', icon: '◉' },
  { id: 'shortcuts', label: '바로가기', icon: '↗' },
  { id: 'mail', label: '메일', icon: '✉' },
  { id: 'settings', label: '설정', icon: '⚙' },
];

const BRIDGE_REQUEST_TIMEOUT_MS = 5000;
type BridgeRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

function bridgeRequestInit(body: { path: string; token: string }, signal: AbortSignal): BridgeRequestInit {
  const init: BridgeRequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
  // Sucrose's Chromium runtime may require an explicit loopback address space
  // for a secure production page calling the local bridge.
  if (typeof navigator !== 'undefined' && navigator.userAgent.startsWith('Sucrose')) {
    init.targetAddressSpace = 'loopback';
  }
  return init;
}

function isBridgeAbort(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function readBridgeToken() {
  try {
    return localStorage.getItem('thesisBridgeToken') || '';
  } catch {
    // Some embedded runtimes can deny storage access; let the bridge return
    // its normal invalid-token response instead of making the button silent.
    return '';
  }
}

async function postBridge(endpoint: string, path: string, token: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), BRIDGE_REQUEST_TIMEOUT_MS);
  try {
    const base = process.env.NEXT_PUBLIC_LOCAL_BRIDGE_URL || 'http://127.0.0.1:38471';
    const response = await fetch(`${base}${endpoint}`, bridgeRequestInit({ path, token }, controller.signal));
    const data = await response.json().catch(() => ({} as { error?: unknown }));
    return { response, data };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function Page() {
  const [page, setPage] = useState<Page>('home');
  const [tree, setTree] = useState<RepositoryItem[]>([]);
  const [calendar, setCalendar] = useState<CalendarApiResponse>(initialCalendar);
  const [dashboard, setDashboard] = useState<DashboardBundle>(initialDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [commits, setCommits] = useState<GitHubCommitSummary[]>([]);
  const [repositorySource, setRepositorySource] = useState<RepositorySource>('none');
  const [shortcutItems, setShortcutItems] = useState<Shortcut[]>(shortcuts);
  const [shortcutSha, setShortcutSha] = useState<string | undefined>();
  const [shortcutSource, setShortcutSource] = useState<ShortcutSource>('fallback');
  const [shortcutMissing, setShortcutMissing] = useState(false);
  const [shortcutWritable, setShortcutWritable] = useState(false);
  const [researchProjectId, setResearchProjectId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const enabledShortcuts = useMemo(() => getEnabledShortcuts(shortcutItems), [shortcutItems]);
  const homeShortcuts = useMemo(() => getHomeShortcuts(enabledShortcuts), [enabledShortcuts]);
  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        dashboardApi.tree(),
        dashboardApi.calendar(),
        dashboardApi.results(),
        dashboardApi.commits(),
        dashboardApi.researchStatus(),
        dashboardApi.projects(),
        dashboardApi.shortcuts(),
      ]);
      const nextErrors: string[] = [];
      const [treeResult, calendarResult, dashboardResult, commitResult, statusResult, projectResult, shortcutResult] = results;

      if (treeResult.status === 'fulfilled') {
        setRepositorySource(treeResult.value.source || (treeResult.value.configured ? 'github' : 'none'));
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

      if (shortcutResult.status === 'fulfilled') {
        const loaded = shortcutResult.value.source === 'fallback' ? loadShortcutState(shortcutResult.value.items) : shortcutResult.value.items;
        setShortcutItems(loaded);
        setShortcutSha(shortcutResult.value.sha);
        setShortcutSource(shortcutResult.value.source);
        setShortcutMissing(shortcutResult.value.missing === true);
        setShortcutWritable(shortcutResult.value.writable === true);
        if (shortcutResult.value.error) nextErrors.push(shortcutResult.value.error);
      } else nextErrors.push(errorMessage(shortcutResult.reason, '저장소 바로가기를 불러오지 못했습니다.'));

      setErrors(nextErrors);
      setDashboardLoading(false);
    })();
  }, []);

  function pop(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 1700);
  }

  async function openLocal(path: string) {
    pop('로컬 파일을 여는 중…');
    try {
      const { response, data } = await postBridge('/open', path, readBridgeToken());
      if (!response.ok) {
        pop(bridgeResponseMessage(response.status, data.error));
        return;
      }
      pop('로컬에서 열었어');
    } catch (error) {
      pop(isBridgeAbort(error) ? BRIDGE_TIMEOUT_MESSAGE : BRIDGE_OFFLINE_MESSAGE);
    }
  }

  async function openLocalFolder(path = '') {
    pop('로컬 폴더를 여는 중…');
    try {
      const { response, data } = await postBridge('/open-folder', path, readBridgeToken());
      if (!response.ok) {
        pop(bridgeResponseMessage(response.status, data.error));
        return;
      }
      pop('로컬 볼트 폴더를 열었어');
    } catch (error) {
      pop(isBridgeAbort(error) ? BRIDGE_TIMEOUT_MESSAGE : BRIDGE_OFFLINE_MESSAGE);
    }
  }

  async function saveShortcuts(next: Shortcut[]) {
    const result = await dashboardApi.saveShortcuts(next, shortcutSha);
    setShortcutItems(result.items);
    setShortcutSha(result.sha);
    setShortcutSource(result.source);
    setShortcutMissing(false);
    setShortcutWritable(result.writable === true);
    return result.items;
  }

  function openResearchProject(projectId: string) {
    setResearchProjectId(projectId);
    setPage('research');
  }

  const schedule = useMemo(() => groupCalendarEvents(calendar.items), [calendar.items]);
  const activeProject = useMemo(() => projects.find((project) => project.id === 'thesis') || projects.find((project) => project.status === 'active') || projects[0] || null, [projects]);
  const activeProjects = useMemo(() => projects.filter((project) => project.status === 'active' || project.status === 'writing'), [projects]);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo">M</div><div><h1>Master Thesis OS</h1><p>석사논문 연구 작업실 · v{APP_VERSION}</p></div></div>
        <nav className="nav">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="sidebar-source"><span>연구 기준</span><b>Obsidian Vault</b><small>projects/ + shared/ · {repositorySource === 'local' ? 'local live' : repositorySource === 'github' ? 'GitHub live' : '연결 필요'}</small></div>
      </aside>

      <main className="main">
        <header className="top">
          <div><h2>{pageMeta[page][0]}</h2><p>{pageMeta[page][1]}</p></div>
          <div className="badges"><div className="badge">Vault {repositorySource === 'local' ? '● 로컬' : repositorySource === 'github' ? '● GitHub' : '○ 설정 필요'}</div><div className="badge">Calendar {calendar.state === 'ready' || calendar.state === 'empty' ? '● 연결됨' : '○ 확인 필요'}</div><div className="badge">v{APP_VERSION}</div></div>
        </header>

        {errors.length > 0 && <div className="error page-error">{errors[0]}</div>}

        {page === 'home' && <section className="page active">
          <ActiveProjects projects={activeProjects} onOpen={openResearchProject} />
          <div className="grid3">
            <CalendarCard title="오늘 일정" events={schedule.today} calendar={calendar} />
            <CalendarCard title="예정 일정" events={schedule.upcoming} calendar={calendar} />
            <Card title="다음 마감" right="마감 · 미팅">{schedule.nextDeadline ? <div className="event priority-event"><b>{schedule.nextDeadline.title}</b><small>{formatCalendarEvent(schedule.nextDeadline)} · {deadlineLabel(schedule.nextDeadline)}</small>{schedule.nextDeadline.location && <small>{schedule.nextDeadline.location}</small>}</div> : <CalendarState calendar={calendar} />}</Card>
          </div>
          <div className="section-gap"><SchoolMailPanel variant="home" folder="school-work" /></div>
          <div className="section-gap"><MailActionCandidates /></div>
          <div className="grid2 section-gap">
            <Card title="막힌 부분" right={activeProject ? activeProject.title : '확인 필요'}><NumberedList items={activeProject?.blocked || researchStatus?.unresolved || []} empty="현재 등록된 막힌 부분이 없어." /></Card>
            <Card title="최근 변경" right="연구 저장소 GitHub"><CommitList commits={commits.slice(0, 6)} /></Card>
          </div>
          <div className="section-gap">
            <Card title="작성 중 프로젝트 바로가기" right={homeShortcuts.length ? `${homeShortcuts.length}개` : '설정 필요'}><ShortcutList shortcuts={homeShortcuts} onOpenFile={openLocal} onOpenFolder={openLocalFolder} /></Card>
          </div>
        </section>}

        {page === 'research' && <section className="page active"><ResearchPanel
          projects={projects}
          tree={tree}
          selectedProjectId={researchProjectId || undefined}
          onProjectSelected={setResearchProjectId}
          onProjectStatusChange={(updated) => setProjects((current) => current.map((project) => project.id === updated.id ? updated : project))}
          onOpen={openLocal}
          onOpenFolder={openLocalFolder}
        /></section>}
        {page === 'results' && <section className="page active"><ResultsDashboardPanel dashboard={dashboard} loading={dashboardLoading} projects={projects} tree={tree} onOpen={openLocal} onOpenFolder={openLocalFolder} /></section>}
        {page === 'library' && <section className="page active"><LibraryPanel tree={tree} researchStatus={researchStatus} onOpen={openLocal} /></section>}
        {page === 'slot' && <section className="page active"><RewardSlotPanel tasks={activeProject?.nextTasks || researchStatus?.nextActions || []} projectTitle={activeProject ? activeProject.title : 'Wiki live'} onNotice={pop} /></section>}
        {page === 'shortcuts' && <section className="page active"><ShortcutsPanel
          shortcuts={shortcutItems}
          source={shortcutSource}
          missing={shortcutMissing}
          writable={shortcutWritable}
          onSave={saveShortcuts}
          onItemsChange={setShortcutItems}
          onOpenFile={openLocal}
          onOpenFolder={openLocalFolder}
        /></section>}
        {page === 'mail' && <section className="page active"><MailPanel /></section>}

        {page === 'settings' && <section className="page active">
          <div className="grid2">
            <Card title="연구 저장소" right={repositorySource === 'none' ? '설정 필요' : repositorySource === 'local' ? '로컬' : 'GitHub'}><div className="note">Obsidian Vault가 연구 데이터의 기준이야. 프로젝트는 <code>projects/*/project.md</code>에서 자동 발견하고, 기존 <code>wiki/ · Calc/ · 연구/</code> 경로는 manifest가 연결해.</div></Card>
            <Card title="로컬 브리지" right="127.0.0.1 전용"><div className="note">로컬 파일·볼트 폴더 열기는 PC에서 bridge를 실행했을 때만 동작해. 토큰은 이 브라우저의 localStorage에 저장돼.</div><div className="toolbar bridge-toolbar"><button className="btn" type="button" onClick={() => openLocalFolder()}>볼트 폴더 열기</button></div><BridgeToken onSave={() => pop('브리지 토큰을 저장했어')} onNotice={pop} /></Card>
          </div>
          <div className="grid2 section-gap">
            <Card title="Google Calendar" right={calendar.state === 'ready' || calendar.state === 'empty' ? '연결됨' : '확인 필요'}><div className="note">현재 상태: {calendarStateText(calendar)}</div></Card>
            <SchoolMailPanel variant="settings" folder="school-work" />
          </div>
          <div className="section-gap"><MicrosoftMailPanel variant="settings" /></div>
          <div className="section-gap"><Card title="버전" right={`v${APP_VERSION}`}><div className="note">프로젝트 기반 연구탭 · repo project manifest · 한국어 UI · 큐레이션 자료실 · 모바일 내비게이션.</div></Card></div>
        </section>}
      </main>

      <nav className="mobile-nav" aria-label="모바일 메뉴">{navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

function ActiveProjects({ projects, onOpen }: { projects: ResearchProject[]; onOpen: (projectId: string) => void }) {
  return <section className="card section active-projects-card">
    <div className="head"><h3>작동 중인 프로젝트</h3><span>{projects.length ? `${projects.length}개 · active / writing` : '없음'}</span></div>
    {projects.length ? <div className="active-project-list">{projects.map((project) => <button className="active-project-item" key={project.id} type="button" onClick={() => onOpen(project.id)}>
      <span className="active-project-icon" aria-hidden="true">{project.status === 'writing' ? '✎' : '●'}</span>
      <span className="active-project-main"><b>{project.title}</b><small>{project.status === 'writing' ? '작성중' : '진행 중'} · {project.currentFocus || project.nextTasks[0] || '현재 작업 미등록'}</small></span>
      <span className="active-project-stage">{stageLabel(project.stage)} ↗</span>
    </button>)}</div> : <div className="empty compact-empty">상태가 active 또는 writing인 프로젝트가 없어.</div>}
  </section>;
}

function Card({ title, right, children, className = '' }: { title: string; right?: string; children: React.ReactNode; className?: string }) { return <div className={`card section${className ? ` ${className}` : ''}`}><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</div>; }
function CalendarCard({ title, events, calendar }: { title: string; events: CalendarEvent[]; calendar: CalendarApiResponse }) {
  const visibleEvents = events.slice(0, 3);
  const remaining = Math.max(0, events.length - visibleEvents.length);
  return <Card title={title} right={calendar.state === 'ready' ? 'Google Calendar' : 'Calendar'} className="calendar-card">
    {visibleEvents.length ? <div className="calendar-events">{visibleEvents.map((event) => <div className="event" key={`${event.calendarId}:${event.id}:${event.start}`}><b>{event.title}</b><small>{formatCalendarEvent(event)} · {event.category}</small>{event.location && <small>{event.location}</small>}</div>)}{remaining > 0 && <div className="calendar-more">+{remaining}개 일정 더 있음</div>}</div> : <CalendarState calendar={calendar} />}
  </Card>;
}
function CalendarState({ calendar }: { calendar: CalendarApiResponse }) { return <div className={calendar.state === 'error' ? 'error' : 'empty compact-empty'}>{calendarStateText(calendar)}</div>; }
function calendarStateText(calendar: CalendarApiResponse) { if (calendar.state === 'unconfigured') return 'Google Calendar 설정이 필요해.'; if (calendar.state === 'empty') return '오늘부터 14일 안에 일정이 없어.'; if (calendar.errorCode === 'auth_error') return 'Calendar 서비스 계정 권한을 확인해야 해.'; if (calendar.errorCode === 'invalid_calendar') return 'Calendar ID 또는 공유 권한을 확인해줘.'; if (calendar.errorCode === 'quota_error') return 'Google Calendar API quota를 확인해줘.'; if (calendar.errorCode === 'malformed_response') return 'Calendar 응답 형식을 확인할 수 없어.'; if (calendar.state === 'error') return 'Calendar 네트워크 연결을 확인해줘.'; return '해당 일정이 없어.'; }
function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) { return <div className="card kpi"><small>{label}</small><strong>{value}</strong><span>{sub}</span></div>; }
function NumberedList({ items, empty }: { items: string[]; empty: string }) { if (!items.length) return <div className="empty compact-empty">{empty}</div>; return <div className="numbered-list">{items.map((item, index) => <div className="numbered-item" key={`${index}-${item}`}><span>{index + 1}</span><p>{item}</p></div>)}</div>; }
function CommitList({ commits }: { commits: GitHubCommitSummary[] }) { if (!commits.length) return <div className="empty compact-empty">최근 GitHub 변경을 불러오는 중이거나 연결 정보가 없어.</div>; return <div>{commits.map((commit) => <div className="commit" key={commit.sha}><div><b>{commit.message}</b><small>{commit.author} · {relativeDate(commit.date)}</small></div><code>{commit.sha.slice(0, 7)}</code></div>)}</div>; }

function BridgeToken({ onSave, onNotice }: { onSave: () => void; onNotice: (message: string) => void }) {
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  useEffect(() => setValue(localStorage.getItem('thesisBridgeToken') || ''), []);
  async function pasteToken() {
    try {
      if (!navigator.clipboard?.readText) throw new Error('clipboard unavailable');
      const clipboardValue = await navigator.clipboard.readText();
      if (!clipboardValue.trim()) {
        onNotice('클립보드에 토큰이 없어');
        return;
      }
      setValue(clipboardValue.trim());
      onNotice('클립보드에서 토큰을 가져왔어');
    } catch {
      onNotice('브라우저의 클립보드 접근을 허용해줘');
    }
  }
  async function copyToken() {
    if (!value.trim()) {
      onNotice('저장된 Bridge token이 없어');
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      onNotice('Bridge token을 클립보드에 복사했어');
    } catch {
      onNotice('브라우저의 클립보드 접근을 허용해줘');
    }
  }
  return <div className="toolbar bridge-toolbar"><input className="search" type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="Bridge token" value={value} onChange={(event) => setValue(event.target.value)} /><button className="btn" type="button" onClick={() => setVisible((current) => !current)}>{visible ? '숨기기' : '보기'}</button><button className="btn" type="button" onClick={() => void copyToken()}>복사</button><button className="btn" type="button" onClick={() => void pasteToken()}>붙여넣기</button><button className="btn" type="button" onClick={() => { localStorage.setItem('thesisBridgeToken', value); onSave(); }}>저장</button></div>;
}
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatDate(value: string) { if (!value) return ''; try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; } }
function formatCalendarEvent(event: CalendarEvent) { if (event.allDay) return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' }).format(new Date(`${event.start}T00:00:00+09:00`)); return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(event.start)); }
function deadlineLabel(event: CalendarEvent) { const days = daysUntil(event); return days <= 0 ? '오늘' : `D-${days}`; }
function relativeDate(value: string) { if (!value) return '시간 정보 없음'; const diff = Date.now() - new Date(value).getTime(); const minutes = Math.max(0, Math.floor(diff / 60_000)); if (minutes < 60) return `${minutes}분 전`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}시간 전`; const days = Math.floor(hours / 24); if (days < 14) return `${days}일 전`; return formatDate(value); }
