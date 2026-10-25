'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleDrivePanel } from '@/app/google-drive-panel';
import { LibraryPanel } from '@/app/library-panel';
import { PortalAttention } from '@/app/home-attention';
import { GmailMailPanel } from '@/app/gmail-mail-panel';
import { MailActionCandidates } from '@/app/mail-action-candidates';
import { MailPanel } from '@/app/mail-panel';
import { PlannerPanel } from '@/app/planner-panel';
import { P0HomeWorkspace } from '@/app/p0-home-workspace';
import { P0AuthGate, useP0Auth } from '@/app/p0-auth-gate';
import { P0SessionsPanel } from '@/app/p0-sessions-panel';
import { PortalNoticesPanel } from '@/app/portal-notices-panel';
import { MicrosoftMailPanel } from '@/app/microsoft-mail-panel';
import { ResearchPanel } from '@/app/research-panel';
import { researchText } from '@/lib/research-text';
import homeStyles from './home-layout.module.css';
import { ResearchMiniTrend } from '@/app/research-mini-trend';
import { ResultsPanel as ResultsDashboardPanel } from '@/app/results-panel';
import { DailyChecklist } from '@/app/daily-checklist';
import { InboxPanel, QuickCapturePanel } from '@/app/inbox-panel';
import { RewardSlotPanel } from '@/app/reward-slot';
import { SchoolMailPanel } from '@/app/school-mail-panel';
import { ShortcutList, ShortcutsPanel } from '@/app/shortcuts-panel';
import { dashboardApi, type CalendarApiResponse, type RepositorySource, type ShortcutSource } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import { CalendarAgenda } from '@/app/calendar-agenda';
import { daysUntil, groupCalendarEvents } from '@/lib/calendar-view';
import type { GitHubCommitSummary } from '@/lib/github';
import { projectStatusLabel, stageLabel, type ResearchProject } from '@/lib/projects';
import type { RepositoryItem } from '@/lib/repository';
import type { ResearchStatus } from '@/lib/research-status';
import type { DashboardBundle } from '@/lib/results';
import { BRIDGE_OFFLINE_MESSAGE, BRIDGE_TIMEOUT_MESSAGE, bridgeResponseMessage } from '@/lib/bridge-status';
import { getEnabledShortcuts, getHomeShortcuts, loadShortcutState, shortcuts, type Shortcut } from '@/lib/shortcuts';
import { useInboxWorkflow } from '@/app/use-inbox-workflow';
import { useMtosWorkspace } from '@/app/use-mtos-workspace';
import { AiInboxPanel, CaptureBox } from '@/app/ai-inbox';
import { GlobalSearch, UrgentApprovals, type SearchTarget } from '@/app/global-search';
import { initialKanbanState, type KanbanViewState } from '@/app/research-kanban';
import { p0TodayInTokyo } from '@/lib/p0-home';
import appPackage from '../package.json';

type Page = 'home' | 'research' | 'results' | 'library' | 'calendar' | 'slot' | 'shortcuts' | 'inbox' | 'mail' | 'portal' | 'planner' | 'settings';

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
  inbox: ['AI 인박스', '떠오른 내용을 저장하고 검토 후 정리'],
  research: ['연구', '프로젝트별 질문 · 진행 단계 · 다음 작업 · 관련 자료'],
  results: ['분석 결과', '프로젝트별 계산 결과와 산출물'],
  library: ['자료실', 'Google Drive · 주요 자료 · 대표 문헌 · 연구 Wiki'],
  calendar: ['캘린더', '앞으로 14일 일정 · 읽기 전용'],
  slot: ['슬롯', '다음 연구 작업을 작은 보상 단위로 관리'],
  shortcuts: ['바로가기', '반복해서 여는 연구 파일 · 폴더 · 웹 주소'],
  mail: ['메일', '학교 업무 · 국제과를 폴더별로 확인'],
  portal: ['학교 공지', 'RITSUMEIKAN STUDENT PORTAL의 ALL · DM 공지'],
  planner: ['플래너', '메일에서 나온 할 일과 일정 후보를 정리'],
  settings: ['설정', '연구 저장소 · Google Calendar · 학교 메일 · 로컬 브리지'],
};

type NavigationItem = { id: Page; label: string; icon: string };
type NavigationGroup = { label: string; items: NavigationItem[] };
type MobileNavigationItem = { id: Page | 'more'; label: string; icon: string };

const navigationGroups: NavigationGroup[] = [
  {
    label: 'WORK',
    items: [
      { id: 'home', label: '홈', icon: '⌂' },
      { id: 'research', label: '연구', icon: '⌕' },
      { id: 'results', label: '분석 결과', icon: '▥' },
      { id: 'library', label: '자료실', icon: '▤' },
      { id: 'calendar', label: '캘린더', icon: '▦' },
    ],
  },
  {
    label: 'INBOX',
    items: [
      { id: 'inbox', label: 'AI 인박스', icon: '✦' },
      { id: 'mail', label: '메일', icon: '✉' },
      { id: 'portal', label: '학교 공지', icon: '▣' },
      { id: 'planner', label: '플래너', icon: '✓' },
    ],
  },
  {
    label: 'TOOLS',
    items: [
      { id: 'slot', label: '슬롯', icon: '◉' },
      { id: 'shortcuts', label: '바로가기', icon: '↗' },
    ],
  },
];

const navigation: NavigationItem[] = [
  ...navigationGroups.flatMap((group) => group.items),
  { id: 'settings', label: '설정', icon: '⚙' },
];
const mobilePrimaryPages = new Set<Page>(['home', 'research', 'inbox']);
const mobileMoreItems = navigation.filter((item) => !mobilePrimaryPages.has(item.id));
const mobileNavigation: MobileNavigationItem[] = [
  { id: 'home', label: '홈', icon: '⌂' },
  { id: 'research', label: '연구 프로젝트', icon: '⌕' },
  { id: 'inbox', label: 'AI 인박스', icon: '✦' },
  { id: 'more', label: '더보기', icon: '•••' },
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
  return <P0AuthGate><AuthenticatedPage /></P0AuthGate>;
}

function AuthenticatedPage() {
  const { authBusy, logout } = useP0Auth();
  const [page, setPage] = useState<Page>('home');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const urlSynced = useRef(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [focusCreateRequest, setFocusCreateRequest] = useState(0);
  const [tree, setTree] = useState<RepositoryItem[]>([]);
  const [calendar, setCalendar] = useState<CalendarApiResponse>(initialCalendar);
  const [dashboard, setDashboard] = useState<DashboardBundle>(initialDashboard);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [commits, setCommits] = useState<GitHubCommitSummary[]>([]);
  const [repositorySource, setRepositorySource] = useState<RepositorySource>('none');
  const [shortcutItems, setShortcutItems] = useState<Shortcut[]>(shortcuts);
  const [shortcutSha, setShortcutSha] = useState<string | undefined>();
  const [shortcutSource, setShortcutSource] = useState<ShortcutSource>('fallback');
  const [shortcutMissing, setShortcutMissing] = useState(false);
  const [shortcutWritable, setShortcutWritable] = useState(false);
  const [researchProjectId, setResearchProjectId] = useState<string | null>(null);
  const [researchView, setResearchView] = useState<'board' | 'detail'>('board');
  const [kanbanState, setKanbanState] = useState<KanbanViewState>(initialKanbanState);
  const [selectTaskRequest, setSelectTaskRequest] = useState<{ id: string; n: number } | null>(null);
  const [expandedProjectFolders, setExpandedProjectFolders] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [todayLabel, setTodayLabel] = useState('');
  const enabledShortcuts = useMemo(() => getEnabledShortcuts(shortcutItems), [shortcutItems]);
  const homeShortcuts = useMemo(() => getHomeShortcuts(enabledShortcuts), [enabledShortcuts]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMoreOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMoreOpen]);

  useEffect(() => {
    const updateDate = () => setTodayLabel(formatTodayDate(new Date()));
    updateDate();
    const timer = window.setInterval(updateDate, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const {
    inboxEntries,
    inboxPreview,
    inboxLoaded,
    inboxStorageStatus,
    inboxStorageError,
    bridgeApiWarning,
    bridgeTokenWarning,
    inboxOrganizing,
    inboxAIError,
    inboxRouteMessage,
    projectTaskSavingId,
    inboxDeleteSavingId,
    addInboxEntry,
    organizeInbox,
    applyInboxPreview,
    discardInboxPreview,
    retryInboxSave,
    deleteInboxEntry,
    addInboxTaskToProject,
    bridgeTokenSaved,
  } = useInboxWorkflow({ projects, onNotice: pop, onOpenInbox: () => setPage('inbox') });
  const workspace = useMtosWorkspace(projects, pop);

  useEffect(() => {
    let cancelled = false;
    void dashboardApi.projects().then((result) => {
      if (cancelled) return;
      setProjects(Array.isArray(result.items) ? result.items : []);
      setProjectsError(result.error || '');
    }).catch((error) => {
      if (cancelled) return;
      setProjectsError(errorMessage(error, '연구 프로젝트를 불러오지 못했습니다.'));
    }).finally(() => {
      if (!cancelled) setProjectsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    (async () => {
      const results = await Promise.allSettled([
        dashboardApi.tree(),
        dashboardApi.calendar(),
        dashboardApi.results(),
        dashboardApi.commits(),
        dashboardApi.researchStatus(),
        dashboardApi.shortcuts(),
      ]);
      const nextErrors: string[] = [];
      const [treeResult, calendarResult, dashboardResult, commitResult, statusResult, shortcutResult] = results;

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

  async function signOut() {
    if (!await logout()) pop('로그아웃 요청에 실패했어. 연결을 확인한 뒤 다시 시도해줘.');
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

  function focusTodaySchedule() {
    const target = document.getElementById('today-schedule-card');
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
  }

  function openResearchProject(projectId: string) {
    setResearchProjectId(projectId);
    setResearchView('detail');
    setPage('research');
  }

  function openTask(taskId: string) {
    setPage('home');
    setSelectTaskRequest((current) => ({ id: taskId, n: (current?.n ?? 0) + 1 }));
  }

  function navigateToSearchResult(target: SearchTarget) {
    if (target.kind === 'task') openTask(target.id);
    else if (target.kind === 'project') openResearchProject(target.id);
    else setPage('inbox');
  }

  // The visible screen lives in ?p= so reload and the back button restore it.
  useEffect(() => {
    const restore = () => {
      const requested = new URLSearchParams(window.location.search).get('p') ?? 'home';
      if (requested in pageMeta) setPage(requested as Page);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    // The first run still holds the default page; writing it would erase the URL being restored.
    if (!urlSynced.current) { urlSynced.current = true; return; }
    const url = new URL(window.location.href);
    if ((url.searchParams.get('p') ?? 'home') === page) return;
    if (page === 'home') url.searchParams.delete('p');
    else url.searchParams.set('p', page);
    window.history.pushState(null, '', url);
  }, [page]);

  function showPage(next: Page) {
    // Returning to the research menu shows the board; tasks may have changed elsewhere.
    if (next === 'research') { setResearchView('board'); void workspace.reload(); }
    if (next === 'inbox') void workspace.reloadAgent();
    setPage(next);
  }

  const schedule = useMemo(() => groupCalendarEvents(calendar.items), [calendar.items]);
  const activeProject = useMemo(() => projects.find((project) => project.id === 'thesis') || projects.find((project) => project.status === 'active') || projects[0] || null, [projects]);
  const homeTasks = useMemo(() => {
    const projectTasks = activeProject?.nextTasks || [];
    return projectTasks.length ? projectTasks : researchStatus?.nextActions || [];
  }, [activeProject, researchStatus]);
  return (
    <div className={`shell${sidebarExpanded ? ' sidebar-expanded' : ''}`}>
      <aside className={`sidebar${sidebarExpanded ? ' expanded' : ''}`}>
        <div className="brand"><div className="logo">C</div><div><h1>Chocomint Lab</h1><p>Research Workspace · v{APP_VERSION}</p></div></div>
        <button className="sidebar-toggle" type="button" aria-label={sidebarExpanded ? '메뉴 접기' : '메뉴 펼치기'} aria-expanded={sidebarExpanded} onClick={() => setSidebarExpanded((expanded) => !expanded)}><span>{sidebarExpanded ? '‹' : '›'}</span></button>
        <nav className="nav" aria-label="주 메뉴">{navigationGroups.map((group) => <div className="nav-group" key={group.label}>
          <span className="nav-group-label">{group.label}</span>
          {group.items.filter((item) => item.id !== 'slot' && item.id !== 'planner').map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} aria-label={item.label} title={sidebarExpanded ? undefined : item.label} onClick={() => showPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}
        </div>)}</nav>
        <div className="sidebar-settings"><span className="nav-group-label">SYSTEM</span><button className={page === 'settings' ? 'active' : ''} aria-label="설정" title={sidebarExpanded ? undefined : '설정'} onClick={() => setPage('settings')}><span>⚙</span>설정</button></div>
        <div className="sidebar-source"><span>연구 기준</span><b>Obsidian Vault</b><small>projects/ + shared/ · {repositorySource === 'local' ? 'local live' : repositorySource === 'github' ? 'GitHub live' : '연결 필요'}</small></div>
      </aside>

      <main className="main">
        <header className={`top${page === 'home' ? ' top-home' : ''}`}>
          <div>{page === 'home' ? <><h2>Chocomint Lab</h2><p>{todayLabel || '오늘'} · 떠오른 생각을 기록하고 다음 행동을 시작하세요</p></> : <><h2>{pageMeta[page][0]}</h2><p>{pageMeta[page][1]}</p></>}</div>
          <div className="badges"><GlobalSearch tasks={workspace.tasks} projects={projects} onNavigate={navigateToSearchResult} /><details className={homeStyles.connections}><summary>연결 상태</summary><div><span>Vault {repositorySource === 'local' ? '로컬' : repositorySource === 'github' ? 'GitHub' : '설정 필요'}</span><span>Calendar {calendar.state === 'ready' || calendar.state === 'empty' ? '연결됨' : '확인 필요'}</span><span>v{APP_VERSION}</span></div></details><button className="mini" type="button" disabled={authBusy} onClick={() => void signOut()}>로그아웃</button></div>
        </header>

        {errors.length > 0 && <div className="error page-error">{errors[0]}</div>}

        {page === 'home' && <section className="page active home-page">
          <UrgentApprovals today={p0TodayInTokyo()} onOpenInbox={() => showPage('inbox')} />
          <section className={homeStyles.agenda} aria-label="다가오는 일정과 마감">
            <HomeStatusCard id="today-schedule-card" label="오늘 일정" value={schedule.today.length ? `${schedule.today.length}건` : calendar.state === 'ready' || calendar.state === 'empty' ? '없음' : '확인 필요'} detail={schedule.today[0]?.title || calendarStateText(calendar)} />
            <HomeStatusCard label="다음 마감" value={schedule.nextDeadline ? deadlineLabel(schedule.nextDeadline) : calendar.state === 'ready' || calendar.state === 'empty' ? '없음' : '확인 필요'} detail={schedule.nextDeadline?.title || calendarStateText(calendar)} />
          </section>
          <div className="section-gap"><P0HomeWorkspace projects={projects} onOpenPlanner={() => setPage('planner')} focusCreateRequest={focusCreateRequest}
            meta={workspace.meta} onMetaChanged={() => void workspace.reloadAgent()} calendarEvents={calendar.items} selectTaskRequest={selectTaskRequest} reloadSignal={workspace.taskReloadSignal} /></div>
          <div className={homeStyles.workspace}>
            <Card title="빠른 입력" right="AI 인박스" className="home-capture-card"><CaptureBox compact onSaved={() => void workspace.reloadAgent()} /><button className="mini" type="button" onClick={() => showPage('inbox')}>AI 인박스 열기</button></Card>
            <CurrentResearchCard project={activeProject} researchStatus={researchStatus} onOpen={openResearchProject} />
          </div>
          <div className="section-gap">
            <Card title="최근 분석 결과" right={dashboard.necessaryLabour?.source.yearRange || '결과 데이터'} className="home-results-card"><ResearchMiniTrend series={dashboard.necessaryLabour?.series || []} /></Card>
          </div>
          <div className="section-gap">
            <Card title="빠른 접근" right={homeShortcuts.length ? `${homeShortcuts.length}개` : '설정 필요'} className="home-quick-access"><ShortcutList shortcuts={homeShortcuts} onOpenFile={openLocal} onOpenFolder={openLocalFolder} /></Card>
          </div>
          <details className={homeStyles.operations}>
            <summary>일상 점검 · 메일·공지 연결 · 최근 변경</summary>
            <DailyChecklist todayEventCount={schedule.today.length} onShowToday={focusTodaySchedule} />
            <div className="home-attention-grid section-gap">
              <MailActionCandidates compact />
              <PortalAttention onOpen={() => setPage('portal')} />
              <Card title="최근 변경" right="연구 저장소 GitHub" className="home-recent-changes"><CommitList commits={commits.slice(0, 4)} /></Card>
            </div>
          </details>
        </section>}

        {page === 'research' && <section className="page active"><ResearchPanel
          workspaceData={workspace}
          researchStatus={researchStatus}
          view={researchView}
          onViewChange={setResearchView}
          kanbanState={kanbanState}
          onKanbanStateChange={setKanbanState}
          onOpenTask={openTask}
          projects={projects}
          projectsLoading={projectsLoading}
          projectsError={projectsError}
          tree={tree}
          selectedProjectId={researchProjectId || undefined}
          expandedFolders={expandedProjectFolders}
          onToggleProjectFolder={(path) => setExpandedProjectFolders((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
          })}
          onProjectSelected={setResearchProjectId}
          onProjectStatusChange={(updated) => setProjects((current) => current.map((project) => project.id === updated.id ? updated : project))}
          onOpen={openLocal}
          onOpenFolder={openLocalFolder}
        /></section>}
        {page === 'results' && <section className="page active"><ResultsDashboardPanel
          dashboard={dashboard}
          loading={dashboardLoading}
          projects={projects}
          tree={tree}
          onOpen={openLocal}
          onOpenFolder={openLocalFolder}
        /></section>}
        {page === 'library' && <section className="page active"><GoogleDrivePanel /><div className="section-gap"><LibraryPanel tree={tree} researchStatus={researchStatus} onOpen={openLocal} /></div></section>}
        {page === 'calendar' && <section className="page active"><Card title="캘린더" right={calendar.state === 'error' || calendar.state === 'unconfigured' ? '확인 실패' : `${calendar.items.length}건 · 읽기 전용`} className="calendar-card"><CalendarAgenda calendar={calendar} stateText={calendarStateText(calendar)} /></Card></section>}
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
        {page === 'mail' && <section className="page active"><GmailMailPanel /><div className="section-gap"><MailPanel /></div></section>}
        {page === 'portal' && <section className="page active"><PortalNoticesPanel /></section>}
        {page === 'planner' && <section className="page active"><PlannerPanel projects={projects} /></section>}
        {page === 'inbox' && <section className="page active"><AiInboxPanel projects={projects} onTasksChanged={() => { void workspace.reloadTasks(); workspace.bumpTaskReload(); }} />
          <details className="card section section-gap legacy-inbox"><summary>기존 로컬 인박스 (Local Bridge · 이 PC 전용)</summary>
          <QuickCapturePanel entries={inboxEntries} loaded={inboxLoaded} busy={inboxOrganizing} storageStatus={inboxStorageStatus} storageError={inboxStorageError} bridgeApiWarning={bridgeApiWarning} bridgeTokenWarning={bridgeTokenWarning} onAdd={addInboxEntry} onOrganize={() => void organizeInbox()} onOpenInbox={() => setPage('inbox')} onRetrySave={retryInboxSave} />
          <InboxPanel
          entries={inboxEntries}
          loaded={inboxLoaded}
          busy={inboxOrganizing}
          storageStatus={inboxStorageStatus}
          storageError={inboxStorageError}
          bridgeApiWarning={bridgeApiWarning}
          bridgeTokenWarning={bridgeTokenWarning}
          onAdd={addInboxEntry}
          onOrganize={() => void organizeInbox()}
          onRetrySave={retryInboxSave}
          preview={inboxPreview}
          error={inboxAIError}
          onApply={() => void applyInboxPreview()}
          onDiscardPreview={discardInboxPreview}
          routeMessage={inboxRouteMessage}
          projects={projects}
          projectTaskSavingId={projectTaskSavingId}
          deleteSavingId={inboxDeleteSavingId}
          onAddToProject={(entryId, projectId) => void addInboxTaskToProject(entryId, projectId)}
          onDelete={deleteInboxEntry}
        /></details></section>}

        {page === 'settings' && <section className="page active">
          <div className="grid2">
            <Card title="연구 저장소" right={repositorySource === 'none' ? '설정 필요' : repositorySource === 'local' ? '로컬' : 'GitHub'}><div className="note">Obsidian Vault가 연구 데이터의 기준이야. 프로젝트는 <code>projects/*/project.md</code>에서 자동 발견하고, 기존 <code>wiki/ · Calc/ · 연구/</code> 경로는 manifest가 연결해.</div></Card>
            <Card title="로컬 브리지" right="127.0.0.1 전용"><div className="note">로컬 파일·볼트 폴더 열기는 PC에서 bridge를 실행했을 때만 동작해. 토큰은 이 브라우저의 localStorage에 저장돼.</div><div className="toolbar bridge-toolbar"><button className="btn" type="button" onClick={() => openLocalFolder()}>볼트 폴더 열기</button></div><BridgeToken onSave={bridgeTokenSaved} onNotice={pop} /></Card>
          </div>
          <div className="grid2 section-gap">
            <Card title="Google Calendar" right={calendar.state === 'ready' || calendar.state === 'empty' ? '연결됨' : '확인 필요'}><div className="note">현재 상태: {calendarStateText(calendar)}</div></Card>
            <SchoolMailPanel variant="settings" folder="school-work" />
          </div>
          <div className="section-gap"><MicrosoftMailPanel variant="settings" /></div>
          <div className="section-gap"><P0SessionsPanel /></div>
          <div className="section-gap"><Card title="버전" right={`v${APP_VERSION}`}><div className="note">프로젝트 기반 연구탭 · repo project manifest · 한국어 UI · 큐레이션 자료실 · 모바일 내비게이션.</div></Card></div>
        </section>}
      </main>

      {mobileMoreOpen && <div className="mobile-more-backdrop" onClick={() => setMobileMoreOpen(false)}>
        <nav className="mobile-more-menu" aria-label="더 보기 메뉴" onClick={(event) => event.stopPropagation()}>
          {mobileMoreItems.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { showPage(item.id); setMobileMoreOpen(false); }}><span>{item.icon}</span>{item.label}</button>)}
        </nav>
      </div>}
      <nav className="mobile-nav" aria-label="모바일 메뉴">{mobileNavigation.map((item) => {
        const isMore = item.id === 'more';
        const active = isMore ? mobileMoreOpen || !mobilePrimaryPages.has(page) : page === item.id;
        return <button key={item.id} className={active ? 'active' : ''} aria-expanded={isMore ? mobileMoreOpen : undefined} aria-current={active && !isMore ? 'page' : undefined} onClick={() => {
          if (item.id === 'more') setMobileMoreOpen((open) => !open);
          else { showPage(item.id); setMobileMoreOpen(false); }
        }}><span>{item.icon}</span><small>{item.label}</small></button>;
      })}</nav>
      <button className="mobile-fab" type="button" aria-label="새 할 일 추가" onClick={() => { setMobileMoreOpen(false); setPage('home'); setFocusCreateRequest((request) => request + 1); }}>＋</button>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}

function CurrentResearchCard({ project, researchStatus, onOpen }: { project: ResearchProject | null; researchStatus: ResearchStatus | null; onOpen: (projectId: string) => void }) {
  const current = researchStatus?.sourcePath === project?.sourcePath ? researchStatus : null;
  const question = project?.questions[0] || current?.researchQuestion || '등록된 연구 질문이 없습니다.';
  const focus = current?.currentInterpretation || project?.currentFocus || '현재 집중 내용이 등록되지 않았습니다.';
  const stage = project ? stageLabel(project.stage) : '연구 단계 확인 필요';
  const status = project ? projectStatusLabel(project.status) : '연결 필요';

  return <Card title="현재 연구" className="home-current-research-card">
    <div className={homeStyles.research}>
      <h4>{researchText(project?.title || '현재 연구 프로젝트')}</h4>
      <b>연구 질문</b><p>{researchText(question)}</p>
      <b>{current?.currentInterpretation ? '현재 판단' : '현재 집중'}</b><p>{researchText(focus)}</p>
      <div className={homeStyles.meta}><span>{stage}</span><span>{status}</span></div>
      {project && <button className="mini" type="button" onClick={() => onOpen(project.id)}>연구 질문·근거·다음 행동 보기</button>}
    </div>
  </Card>;
}

function HomeStatusCard({ id, label, value, detail }: { id?: string; label: string; value: string; detail: string }) {
  return <div id={id} tabIndex={-1} className={homeStyles.status}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small title={detail}>{detail}</small>
  </div>;
}

function Card({ title, right, children, className = '' }: { title: string; right?: string; children: React.ReactNode; className?: string }) { return <div className={`card section${className ? ` ${className}` : ''}`}><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</div>; }
function calendarStateText(calendar: CalendarApiResponse) { if (calendar.state === 'unconfigured') return 'Google Calendar 설정이 필요해.'; if (calendar.state === 'empty') return '오늘부터 14일 안에 일정이 없어.'; if (calendar.errorCode === 'auth_error' || calendar.errorCode === 'insufficient_permissions') return 'Calendar 서비스 계정의 읽기/쓰기 권한을 확인해야 해.'; if (calendar.errorCode === 'provider_bad_request') return 'Calendar 요청 형식 또는 날짜·시간을 확인해줘.'; if (calendar.errorCode === 'invalid_calendar') return 'Calendar ID 또는 공유 권한을 확인해줘.'; if (calendar.errorCode === 'quota_error') return 'Google Calendar API quota를 확인해줘.'; if (calendar.errorCode === 'malformed_response') return 'Calendar 응답 형식을 확인할 수 없어.'; if (calendar.state === 'error') return 'Calendar 네트워크 연결을 확인해줘.'; return '해당 일정이 없어.'; }
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
function deadlineLabel(event: CalendarEvent) { const days = daysUntil(event); return days <= 0 ? '오늘' : `D-${days}`; }
function relativeDate(value: string) { if (!value) return '시간 정보 없음'; const diff = Date.now() - new Date(value).getTime(); const minutes = Math.max(0, Math.floor(diff / 60_000)); if (minutes < 60) return `${minutes}분 전`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}시간 전`; const days = Math.floor(hours / 24); if (days < 14) return `${days}일 전`; return formatDate(value); }
function formatTodayDate(value: Date) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(value); }
