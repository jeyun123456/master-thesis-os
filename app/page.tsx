'use client';

import { useEffect, useMemo, useState } from 'react';
import { GoogleDrivePanel } from '@/app/google-drive-panel';
import { LibraryPanel } from '@/app/library-panel';
import { GmailMailPanel } from '@/app/gmail-mail-panel';
import { P0HomeWorkspace } from '@/app/p0-home-workspace';
import { P0AuthGate, useP0Auth } from '@/app/p0-auth-gate';
import { P0SessionsPanel } from '@/app/p0-sessions-panel';
import { MicrosoftMailPanel } from '@/app/microsoft-mail-panel';
import { ResearchPanel } from '@/app/research-panel';
import { ResearchMiniTrend } from '@/app/research-mini-trend';
import { ResultsPanel as ResultsDashboardPanel } from '@/app/results-panel';
import { DailyChecklist } from '@/app/daily-checklist';
import { RewardSlotPanel } from '@/app/reward-slot';
import { EmptyFeature } from '@/app/empty-feature';
import { P0TasksPanel } from '@/app/p0-tasks-panel';
import { ShortcutList, ShortcutsPanel } from '@/app/shortcuts-panel';
import { isSafeRepositoryPath } from '@/lib/repository';
import { dashboardApi, type CalendarApiResponse, type RepositorySource, type ShortcutSource } from '@/lib/client-api';
import type { CalendarEvent } from '@/lib/calendar';
import { daysUntil, eventDateKey, groupCalendarEvents } from '@/lib/calendar-view';
import type { GitHubCommitSummary } from '@/lib/github';
import { isThesisProject, projectStatusLabel, stageLabel, type ResearchProject } from '@/lib/projects';
import type { RepositoryItem } from '@/lib/repository';
import type { ResearchStatus } from '@/lib/research-status';
import type { DashboardBundle } from '@/lib/results';
import { getEnabledShortcuts, getHomeShortcuts, loadShortcutState, shortcuts, type Shortcut } from '@/lib/shortcuts';
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
  planner: ['플래너', '서버 P0 할 일 관리 · AI가 자동으로 정리'],
  settings: ['설정', '연구 저장소 · Google Calendar · 메일 · 세션'],
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

const REPOSITORY_WEB_URL = 'https://github.com/jeyun123456/Chocomint-Lab';

function repositoryWebUrl(kind: 'blob' | 'tree', path: string) {
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `${REPOSITORY_WEB_URL}/${kind}/HEAD${encoded ? `/${encoded}` : ''}`;
}

export default function Page() {
  return <P0AuthGate><AuthenticatedPage /></P0AuthGate>;
}

function AuthenticatedPage() {
  const { authBusy, logout } = useP0Auth();
  const [page, setPage] = useState<Page>('home');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
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

  function openRepoFile(path: string) {
    if (!isSafeRepositoryPath(path)) { pop('연구 저장소 안의 경로만 열 수 있어.'); return; }
    window.open(repositoryWebUrl('blob', path), '_blank', 'noopener,noreferrer');
  }

  function openRepoFolder(path = '') {
    if (path && !isSafeRepositoryPath(path)) { pop('연구 저장소 안의 경로만 열 수 있어.'); return; }
    window.open(repositoryWebUrl('tree', path), '_blank', 'noopener,noreferrer');
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

  function showPage(next: Page) {
    // Returning to the research menu shows the board; tasks may have changed elsewhere.
    if (next === 'research') { setResearchView('board'); void workspace.reload(); }
    if (next === 'inbox') void workspace.reloadAgent();
    setPage(next);
  }

  const schedule = useMemo(() => groupCalendarEvents(calendar.items), [calendar.items]);
  const activeProject = useMemo(() => projects.find(isThesisProject) || projects.find((project) => project.status === 'active') || projects[0] || null, [projects]);
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
        <div className="sidebar-source"><span>연구 기준</span><b>Chocomint-Lab</b><small>02_Projects/ + shared/ · {repositorySource === 'local' ? 'local live' : repositorySource === 'github' ? 'GitHub live' : '연결 필요'}</small></div>
      </aside>

      <main className="main">
        <header className={`top${page === 'home' ? ' top-home' : ''}`}>
          <div>{page === 'home' ? <><h2>Chocomint Lab</h2><p>{todayLabel || '오늘'} · 떠오른 생각을 기록하고 다음 행동을 시작하세요</p></> : <><h2>{pageMeta[page][0]}</h2><p>{pageMeta[page][1]}</p></>}</div>
          <div className="badges"><GlobalSearch tasks={workspace.tasks} projects={projects} onNavigate={navigateToSearchResult} /><div className="badge">Vault {repositorySource === 'local' ? '● 로컬' : repositorySource === 'github' ? '● GitHub' : '○ 설정 필요'}</div><div className="badge">Calendar {calendar.state === 'ready' || calendar.state === 'empty' ? '● 연결됨' : '○ 확인 필요'}</div><div className="badge">v{APP_VERSION}</div><button className="mini" type="button" disabled={authBusy} onClick={() => void signOut()}>로그아웃</button></div>
        </header>

        {errors.length > 0 && <div className="error page-error">{errors[0]}</div>}

        {page === 'home' && <section className="page active home-page">
          <UrgentApprovals today={p0TodayInTokyo()} onOpenInbox={() => showPage('inbox')} />
          <div className="section-gap"><P0HomeWorkspace projects={projects} onOpenPlanner={() => setPage('planner')} focusCreateRequest={focusCreateRequest}
            meta={workspace.meta} onMetaChanged={() => void workspace.reloadAgent()} calendarEvents={calendar.items} selectTaskRequest={selectTaskRequest} reloadSignal={workspace.taskReloadSignal} /></div>
          <div className="home-workspace-grid">
            <Card title="빠른 입력" right="AI 인박스" className="home-capture-card"><CaptureBox compact onSaved={() => void workspace.reloadAgent()} /><button className="mini" type="button" onClick={() => showPage('inbox')}>AI 인박스 열기</button></Card>
            <DailyChecklist todayEventCount={schedule.today.length} onShowToday={focusTodaySchedule} />
          </div>
          <div className="home-status-grid">
            <HomeStatusCard id="today-schedule-card" label="오늘 일정" value={schedule.today.length ? `${schedule.today.length}건` : '없음'} detail={schedule.today[0]?.title || calendarStateText(calendar)} tone="blue" />
            <HomeStatusCard label="다음 마감" value={schedule.nextDeadline ? deadlineLabel(schedule.nextDeadline) : '없음'} detail={schedule.nextDeadline?.title || '등록된 마감이 없어.'} tone="orange" />
          </div>
          <div className="home-lower-grid section-gap">
            <CurrentResearchCard project={activeProject} researchStatus={researchStatus} onOpen={openResearchProject} />
            <Card title="최근 분석 결과" right={dashboard.necessaryLabour?.source.yearRange || (dashboard.source === 'empty' ? '미연결' : '결과 데이터')} className="home-results-card"><ResearchMiniTrend series={dashboard.necessaryLabour?.series || []} /></Card>
          </div>
          <div className="home-attention-grid section-gap">
            <Card title="최근 변경" right="연구 저장소 GitHub" className="home-recent-changes"><CommitList commits={commits.slice(0, 4)} /></Card>
          </div>
          <div className="section-gap">
            <Card title="빠른 접근" right={homeShortcuts.length ? `${homeShortcuts.length}개` : '설정 필요'} className="home-quick-access"><ShortcutList shortcuts={homeShortcuts} onOpenFile={openRepoFile} onOpenFolder={openRepoFolder} /></Card>
          </div>
        </section>}

        {page === 'research' && <section className="page active"><ResearchPanel
          workspaceData={workspace}
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
          onOpen={openRepoFile}
          onOpenFolder={openRepoFolder}
        /></section>}
        {page === 'results' && <section className="page active"><ResultsDashboardPanel
          dashboard={dashboard}
          loading={dashboardLoading}
          projects={projects}
          tree={tree}
          onOpen={openRepoFile}
          onOpenFolder={openRepoFolder}
        /></section>}
        {page === 'library' && <section className="page active"><GoogleDrivePanel /><div className="section-gap"><LibraryPanel tree={tree} researchStatus={researchStatus} onOpen={openRepoFile} /></div></section>}
        {page === 'calendar' && <section className="page active"><Card title="캘린더" right={`${calendar.items.length}건 · 읽기 전용`} className="calendar-card"><CalendarAgenda calendar={calendar} /></Card></section>}
        {page === 'slot' && <section className="page active"><RewardSlotPanel tasks={activeProject?.nextTasks || researchStatus?.nextActions || []} projectTitle={activeProject ? activeProject.title : 'Wiki live'} onNotice={pop} /></section>}
        {page === 'shortcuts' && <section className="page active"><ShortcutsPanel
          shortcuts={shortcutItems}
          source={shortcutSource}
          missing={shortcutMissing}
          writable={shortcutWritable}
          onSave={saveShortcuts}
          onItemsChange={setShortcutItems}
          onOpenFile={openRepoFile}
          onOpenFolder={openRepoFolder}
        /></section>}
        {page === 'mail' && <section className="page active"><GmailMailPanel /><div className="section-gap"><MicrosoftMailPanel variant="home" /></div><div className="section-gap"><EmptyFeature title="Thunderbird 이메일" message="Thunderbird 이메일 연결 준비 중" /></div></section>}
        {page === 'portal' && <section className="page active"><EmptyFeature title="학교 공지" message="학교 공지 연결 준비 중" /></section>}
        {page === 'planner' && <section className="page active"><P0TasksPanel /></section>}
        {page === 'inbox' && <section className="page active"><AiInboxPanel projects={projects} onTasksChanged={() => { void workspace.reloadTasks(); workspace.bumpTaskReload(); }} /></section>}

        {page === 'settings' && <section className="page active">
          <div className="grid2">
            <Card title="연구 저장소" right={repositorySource === 'none' ? '설정 필요' : repositorySource === 'local' ? '로컬' : 'GitHub'}><div className="note">GitHub <code>jeyun123456/Chocomint-Lab</code>이 연구 데이터의 기준이야. 프로젝트는 <code>02_Projects/*/project.md</code>에서 자동 발견해. 할 일은 서버 P0 SQLite가 원본이야.</div></Card>
          </div>
          <div className="grid2 section-gap">
            <Card title="Google Calendar" right={calendar.state === 'ready' || calendar.state === 'empty' ? '연결됨' : '확인 필요'}><div className="note">현재 상태: {calendarStateText(calendar)}</div></Card>
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
  const focus = project?.currentFocus || researchStatus?.currentInterpretation || '현재 문제의식이 등록되지 않았어.';
  const stage = project ? stageLabel(project.stage) : researchStatus?.currentStage || '연구 단계 확인 필요';
  const status = project ? projectStatusLabel(project.status) : '연결 필요';
  const summary = project?.summary || researchStatus?.currentInterpretation || '02_Projects와 wiki/current_status.md에서 현재 연구 상태를 읽어와.';

  return <Card title="현재 연구" right={status} className="home-current-research-card">
    <div className="home-current-research">
      <span className="home-eyebrow">ACTIVE PROJECT</span>
      <h4>{project?.title || '현재 연구 프로젝트'}</h4>
      <div className="home-current-focus"><b>핵심 문제의식 / 해석</b><p>{focus}</p></div>
      <p className="home-current-summary">{summary}</p>
      <div className="home-current-meta"><span>현재 단계</span><strong>{stage}</strong><span>진행 상태</span><strong>{status}</strong></div>
      {project && <button className="mini" type="button" onClick={() => onOpen(project.id)}>연구 열기 <span aria-hidden="true">↗</span></button>}
    </div>
  </Card>;
}

function HomeStatusCard({ id, label, value, detail, tone }: { id?: string; label: string; value: string; detail: string; tone: 'blue' | 'orange' | 'green' | 'slate' }) {
  return <div id={id} tabIndex={-1} className={`card home-status-card ${tone}`}>
    <span className="home-status-label">{label}</span>
    <strong>{value}</strong>
    <small title={detail}>{detail}</small>
  </div>;
}

function Card({ title, right, children, className = '' }: { title: string; right?: string; children: React.ReactNode; className?: string }) { return <div className={`card section${className ? ` ${className}` : ''}`}><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</div>; }
function CalendarAgenda({ calendar }: { calendar: CalendarApiResponse }) {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of calendar.items) {
    const date = eventDateKey(event);
    grouped.set(date, [...(grouped.get(date) ?? []), event]);
  }
  if (!calendar.items.length) return <div className="calendar-agenda-empty">{calendarStateText(calendar)}</div>;
  return <div className="calendar-agenda">
    {[...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, events]) => <section className="calendar-agenda-day" key={date}>
      <h4>{formatCalendarDay(date)}</h4>
      <div className="calendar-events">{events.map((event) => <article className="event calendar-agenda-event" key={event.id}>
        <span className="calendar-agenda-time">{event.allDay ? '종일' : formatCalendarTime(event.start, event.end)}</span>
        <div className="calendar-agenda-copy"><b>{event.title}</b><small>{event.category}{event.location ? ` · ${event.location}` : ''}</small></div>
      </article>)}</div>
    </section>)}
  </div>;
}
function formatCalendarDay(value: string) {
  const date = new Date(`${value}T12:00:00+09:00`);
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}
function formatCalendarTime(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(end))}`;
}
function calendarStateText(calendar: CalendarApiResponse) { if (calendar.state === 'unconfigured') return 'Google Calendar 설정이 필요해.'; if (calendar.state === 'empty') return '오늘부터 14일 안에 일정이 없어.'; if (calendar.errorCode === 'auth_error' || calendar.errorCode === 'insufficient_permissions') return 'Calendar 서비스 계정의 읽기/쓰기 권한을 확인해야 해.'; if (calendar.errorCode === 'provider_bad_request') return 'Calendar 요청 형식 또는 날짜·시간을 확인해줘.'; if (calendar.errorCode === 'invalid_calendar') return 'Calendar ID 또는 공유 권한을 확인해줘.'; if (calendar.errorCode === 'quota_error') return 'Google Calendar API quota를 확인해줘.'; if (calendar.errorCode === 'malformed_response') return 'Calendar 응답 형식을 확인할 수 없어.'; if (calendar.state === 'error') return 'Calendar 네트워크 연결을 확인해줘.'; return '해당 일정이 없어.'; }
function CommitList({ commits }: { commits: GitHubCommitSummary[] }) { if (!commits.length) return <div className="empty compact-empty">최근 GitHub 변경을 불러오는 중이거나 연결 정보가 없어.</div>; return <div>{commits.map((commit) => <div className="commit" key={commit.sha}><div><b>{commit.message}</b><small>{commit.author} · {relativeDate(commit.date)}</small></div><code>{commit.sha.slice(0, 7)}</code></div>)}</div>; }

function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function formatDate(value: string) { if (!value) return ''; try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; } }
function deadlineLabel(event: CalendarEvent) { const days = daysUntil(event); return days <= 0 ? '오늘' : `D-${days}`; }
function relativeDate(value: string) { if (!value) return '시간 정보 없음'; const diff = Date.now() - new Date(value).getTime(); const minutes = Math.max(0, Math.floor(diff / 60_000)); if (minutes < 60) return `${minutes}분 전`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}시간 전`; const days = Math.floor(hours / 24); if (days < 14) return `${days}일 전`; return formatDate(value); }
function formatTodayDate(value: Date) { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(value); }
