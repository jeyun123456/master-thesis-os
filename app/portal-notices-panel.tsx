'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addCalendarEvent } from '../lib/calendar-client';
import { PortalNoticeAI } from './portal-notice-ai';
import type { CalendarCandidateEdit } from './mail-analysis-details';
import {
  getPortalNotice,
  getPortalNotices,
  getPortalStatus,
  openPortalUrl,
  PortalNoticesClientError,
  readPortalBridgeToken,
  startPortalLogin,
  startPortalNoticeAnalysis,
  startPortalSync,
  updatePortalNoticeCandidate,
  updatePortalNoticeState,
  type PortalNoticeCalendarCandidate,
  type PortalNotice,
  type PortalNoticeDepartment,
  type PortalNoticeSummary,
  type PortalNoticeStatePatch,
  type PortalNoticeType,
  type PortalSessionState,
  type PortalSyncStatus,
} from '../lib/portal-notices-client';

const INITIAL_STATUS: PortalSyncStatus = {
  source: 'ritsumei',
  lastSyncAt: null,
  status: 'idle',
  storedCount: 0,
  counts: { ALL: 0, DM: 0 },
  totalCount: 0,
  newCount: 0,
  updatedCount: 0,
  detailFailedCount: 0,
  session: { state: 'unknown' },
  jobRunning: false,
};

const PORTAL_JOB_TIMEOUT_MS = 15 * 60_000;
const PORTAL_AI_TIMEOUT_MS = 5 * 60_000;

export type PortalNoticeViewFilter = 'all' | 'unread' | 'important' | 'archived' | 'deadline' | 'expired';
export type PortalNoticeSort = 'published_desc' | 'deadline_asc' | 'title_asc';
export type PortalNoticeDeadlineState = 'none' | 'upcoming' | 'expired';

type PortalNoticeDepartmentSummary = PortalNoticeDepartment & {
  unreadCount: number;
  importantCount: number;
  latestPublishedAt: string;
};

export function filterPortalNotices(
  items: PortalNoticeSummary[],
  type: PortalNoticeType,
  viewFilter: PortalNoticeViewFilter = 'all',
  department = '',
  query = '',
): PortalNoticeSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (item.type !== type) return false;
    if (department === '__unknown__' ? item.department.trim() !== '' : department && item.department !== department) return false;
    if (viewFilter === 'unread' && item.isRead) return false;
    if (viewFilter === 'important' && !item.isImportant) return false;
    if (viewFilter === 'archived' && !item.isArchived) return false;
    if (viewFilter === 'deadline' && !item.deadline.trim() && !item.expiresAt.trim()) return false;
    if (viewFilter === 'expired' && portalNoticeDeadlineState(item) !== 'expired') return false;
    if (normalizedQuery) {
      const haystack = [
        item.noticeId,
        item.title,
        item.department,
        item.category,
        item.importance,
        item.deadline,
        item.expiresAt,
        item.searchText || '',
      ].join('\n').toLocaleLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });
}

function portalNoticeDateValue(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = new Date(text.replaceAll('/', '-'));
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const fallback = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    match[4] ? Number(match[4]) : 23,
    match[5] ? Number(match[5]) : 59,
    match[4] ? 0 : 59,
  );
  return Number.isNaN(fallback.getTime()) ? null : fallback.getTime();
}

export function portalNoticeDeadlineState(
  notice: Pick<PortalNoticeSummary, 'deadline' | 'expiresAt'>,
  now = Date.now(),
): PortalNoticeDeadlineState {
  const dates = [notice.deadline, notice.expiresAt]
    .map(portalNoticeDateValue)
    .filter((value): value is number => value !== null);
  if (!dates.length) return 'none';
  return Math.min(...dates) < now ? 'expired' : 'upcoming';
}

export function sortPortalNotices(items: PortalNoticeSummary[], sort: PortalNoticeSort): PortalNoticeSummary[] {
  return [...items].sort((left, right) => {
    if (sort === 'title_asc') return left.title.localeCompare(right.title, 'ja');
    if (sort === 'deadline_asc') {
      const leftDate = [left.deadline, left.expiresAt].map(portalNoticeDateValue).find((value) => value !== null) ?? Number.POSITIVE_INFINITY;
      const rightDate = [right.deadline, right.expiresAt].map(portalNoticeDateValue).find((value) => value !== null) ?? Number.POSITIVE_INFINITY;
      return leftDate - rightDate || right.publishedAt.localeCompare(left.publishedAt);
    }
    return right.publishedAt.localeCompare(left.publishedAt) || right.syncedAt.localeCompare(left.syncedAt);
  });
}

export function portalNoticeStatusLabel(status: PortalSyncStatus['status'], sessionState: PortalSessionState = 'unknown'): string {
  if (status === 'running') return '동기화 중';
  if (sessionState === 'login_required') return '로그인 필요';
  if (sessionState === 'session_expired') return '세션 만료';
  if (status === 'failed') return '오류 확인 필요';
  if (sessionState === 'saved') return '세션 유지됨';
  return '대기 중';
}

export function portalNoticeErrorMessage(error: unknown): string {
  if (!(error instanceof PortalNoticesClientError)) return '학교 공지 요청을 처리하지 못했어.';
  const messages: Record<string, string> = {
    bridge_auth: 'Settings에서 Local Bridge token을 확인해줘.',
    bridge_offline: 'Local Bridge가 실행 중인지 확인해줘.',
    invalid_url: '기본 브라우저로 열 수 없는 URL이야.',
    default_browser_failed: '기본 브라우저를 열지 못했어. 기본 브라우저 설정을 확인해줘.',
    login_cancelled: '로그인 창이 닫혀서 작업을 취소했어. 다시 로그인 창을 열어줘.',
    login_required: '먼저 로그인 창에서 학교 포털에 직접 로그인해줘.',
    session_expired: '학교 포털 세션이 만료됐어. 로그인 창을 다시 열어줘.',
    portal_unreachable: '학교 포털에 연결하지 못했어.',
    parsing_failed: '공지 페이지 구조를 해석하지 못했어. portal-debug.log를 확인해줘.',
    notice_detail_failed: '일부 공지 상세를 읽지 못했어. 목록은 계속 저장돼.',
    database_error: '학교 공지 SQLite를 사용할 수 없어.',
    ai_body_missing: '본문이 없는 공지는 AI 분석할 수 없어.',
    ai_provider_unconfigured: 'AI provider 설정이 없어. MAIL_AI_* 환경변수를 확인해줘.',
    ai_provider_failed: 'AI provider 요청에 실패했어. 잠시 후 다시 시도해줘.',
    ai_response_invalid: 'AI 응답 형식을 해석하지 못했어. 다시 분석해줘.',
    ai_interrupted: '이전 AI 분석이 중단됐어. 다시 분석해줘.',
    ai_job_already_running: '공지 AI 분석이 이미 진행 중이야.',
    notice_not_found: '공지 상세를 찾지 못했어. 먼저 다시 동기화해줘.',
    sync_interrupted: '이전 동기화가 중단되어 상태를 정리했어. 다시 동기화해줘.',
    sync_already_running: '학교 공지 동기화가 이미 진행 중이야.',
    portal_job_already_running: '학교 포털 작업이 이미 진행 중이야.',
  };
  return messages[error.code] || error.message || '학교 공지 요청을 처리하지 못했어.';
}

export function portalSyncRunStatusLabel(status: 'running' | 'completed' | 'failed'): string {
  if (status === 'running') return '진행 중';
  if (status === 'failed') return '실패';
  return '완료';
}

function dateParts(value: string): Record<string, string> | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

export function formatPortalSyncDate(value: string | null): string {
  if (!value) return '아직 동기화하지 않음';
  const parts = dateParts(value);
  if (!parts) return value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatPortalNoticeDate(value: string): string {
  if (!value) return '—';
  const parts = dateParts(value);
  if (!parts) return value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function sessionState(status: PortalSyncStatus): PortalSessionState {
  return status.session?.state || 'unknown';
}

function noticeUpdatedInSync(notice: PortalNoticeSummary, status: PortalSyncStatus): boolean {
  return status.status === 'completed'
    && Boolean(notice.lastChangedAt)
    && Boolean(status.lastSyncAt)
    && notice.lastChangedAt === status.lastSyncAt;
}

export function PortalNoticesPanel() {
  const [status, setStatus] = useState<PortalSyncStatus>(INITIAL_STATUS);
  const [items, setItems] = useState<PortalNoticeSummary[]>([]);
  const [departments, setDepartments] = useState<PortalNoticeDepartment[]>([]);
  const [tab, setTab] = useState<PortalNoticeType>('ALL');
  const [viewFilter, setViewFilter] = useState<PortalNoticeViewFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<PortalNoticeSort>('published_desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortalNotice | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stateAction, setStateAction] = useState<string | null>(null);
  const [externalAction, setExternalAction] = useState<string | null>(null);
  const [action, setAction] = useState<'idle' | 'sync' | 'login'>('idle');
  const [aiAction, setAiAction] = useState<'idle' | 'analyze'>('idle');
  const [error, setError] = useState<unknown>(null);

  const loadStored = useCallback(async () => {
    const token = readPortalBridgeToken();
    const [nextStatus, noticeResponse] = await Promise.all([
      getPortalStatus(token),
      getPortalNotices(token, { limit: 500 }),
    ]);
    setStatus(noticeResponse.sync || nextStatus);
    setItems(noticeResponse.items);
    setDepartments(noticeResponse.departments);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadStored()
      .catch((nextError) => {
        if (active) setError(nextError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadStored]);

  const visibleItems = useMemo(
    () => sortPortalNotices(filterPortalNotices(items, tab, viewFilter, departmentFilter, searchQuery), sort),
    [items, tab, viewFilter, departmentFilter, searchQuery, sort],
  );

  const visibleUnreadCount = useMemo(
    () => visibleItems.filter((item) => !item.isRead).length,
    [visibleItems],
  );

  const departmentSummaries = useMemo<PortalNoticeDepartmentSummary[]>(() => {
    const summaryByValue = new Map<string, PortalNoticeDepartmentSummary>();
    departments.forEach((department) => {
      summaryByValue.set(department.value, {
        ...department,
        unreadCount: 0,
        importantCount: 0,
        latestPublishedAt: '',
      });
    });
    items.forEach((item) => {
      const value = item.department.trim();
      const existing = summaryByValue.get(value) || {
        value,
        name: value || '담당부서 미상',
        count: 0,
        counts: { ALL: 0, DM: 0 },
        unreadCount: 0,
        importantCount: 0,
        latestPublishedAt: '',
      };
      if (!existing.latestPublishedAt || (item.publishedAt && item.publishedAt > existing.latestPublishedAt)) {
        existing.latestPublishedAt = item.publishedAt;
      }
      if (!item.isRead) existing.unreadCount += 1;
      if (item.isImportant) existing.importantCount += 1;
      summaryByValue.set(value, existing);
    });
    return Array.from(summaryByValue.values()).sort((left, right) => (
      right.unreadCount - left.unreadCount
      || right.count - left.count
      || left.name.localeCompare(right.name, 'ja')
    ));
  }, [departments, items]);

  async function waitForJob(): Promise<PortalSyncStatus> {
    const started = Date.now();
    while (Date.now() - started < PORTAL_JOB_TIMEOUT_MS) {
      await sleep(1000);
      const nextStatus = await getPortalStatus(readPortalBridgeToken());
      setStatus(nextStatus);
      if (nextStatus.jobRunning !== true && nextStatus.status !== 'running') return nextStatus;
    }
    throw new PortalNoticesClientError('portal_unreachable', '학교 공지 작업이 제한 시간 안에 끝나지 않았어.');
  }

  async function runPortalAction(kind: 'sync' | 'login') {
    if (action !== 'idle') return;
    setAction(kind);
    setError(null);
    try {
      const token = readPortalBridgeToken();
      if (kind === 'sync') {
        await startPortalSync(token);
        const nextStatus = await waitForJob();
        if (nextStatus.status === 'failed' || nextStatus.jobErrorCode) {
          throw new PortalNoticesClientError(
            nextStatus.jobErrorCode || nextStatus.lastErrorCode || 'portal_unreachable',
            nextStatus.jobError || nextStatus.lastError || '학교 포털 작업이 실패했어.',
          );
        }
        await loadStored();
      } else {
        await startPortalLogin(token);
      }
    } catch (nextError) {
      setError(nextError);
    } finally {
      setAction('idle');
    }
  }

  async function runNoticeAnalysis(force = false) {
    if (!detail || aiAction !== 'idle') return;
    const noticeId = detail.noticeId;
    setAiAction('analyze');
    setError(null);
    try {
      await startPortalNoticeAnalysis(noticeId, force, readPortalBridgeToken());
      const started = Date.now();
      while (Date.now() - started < PORTAL_AI_TIMEOUT_MS) {
        const nextDetail = await getPortalNotice(noticeId, readPortalBridgeToken());
        setDetail((current) => current?.noticeId === noticeId ? nextDetail : current);
        if (nextDetail.ai.status === 'completed') return;
        if (nextDetail.ai.status === 'failed') {
          throw new PortalNoticesClientError(
            nextDetail.ai.errorCode || 'ai_provider_failed',
            nextDetail.ai.error || '공지 AI 분석을 완료하지 못했어.',
          );
        }
        await sleep(1000);
      }
      throw new PortalNoticesClientError('ai_provider_failed', '공지 AI 분석이 제한 시간 안에 끝나지 않았어.');
    } catch (nextError) {
      setError(nextError);
    } finally {
      setAiAction('idle');
    }
  }

  async function addPortalCandidate(candidate: PortalNoticeCalendarCandidate, edit: CalendarCandidateEdit) {
    if (!detail) return;
    const noticeId = detail.noticeId;
    setError(null);
    const result = await addCalendarEvent({
      mailId: `portal-notice:${noticeId}`,
      candidateId: candidate.id,
      source: 'portal',
      title: edit.title,
      start: edit.start,
      end: edit.end,
      allDay: edit.allDay,
      type: candidate.type,
      reason: candidate.reason,
    });
    const updated = await updatePortalNoticeCandidate(
      noticeId,
      {
        candidateId: candidate.id,
        status: 'added',
        title: edit.title,
        start: edit.start,
        end: edit.end,
        allDay: edit.allDay,
        calendarEventId: result.eventId,
      },
      readPortalBridgeToken(),
    );
    setDetail((current) => current?.noticeId === noticeId
      ? { ...current, calendarCandidates: current.calendarCandidates.map((item) => item.id === updated.id ? updated : item) }
      : current);
  }

  async function ignorePortalCandidate(candidate: PortalNoticeCalendarCandidate) {
    if (!detail) return;
    const noticeId = detail.noticeId;
    setError(null);
    const updated = await updatePortalNoticeCandidate(
      noticeId,
      { candidateId: candidate.id, status: 'ignored' },
      readPortalBridgeToken(),
    );
    setDetail((current) => current?.noticeId === noticeId
      ? { ...current, calendarCandidates: current.calendarCandidates.map((item) => item.id === updated.id ? updated : item) }
      : current);
  }

  async function openDetail(notice: PortalNoticeSummary) {
    if (selectedId === notice.noticeId) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setSelectedId(notice.noticeId);
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    try {
      const loaded = await getPortalNotice(notice.noticeId, readPortalBridgeToken());
      setDetail(loaded);
      if (!loaded.isRead) {
        try {
          const markedRead = await updatePortalNoticeState(
            notice.noticeId,
            { isRead: true },
            readPortalBridgeToken(),
          );
          setDetail(markedRead);
          setItems((current) => current.map((item) => item.noticeId === markedRead.noticeId ? { ...item, ...markedRead } : item));
        } catch (nextError) {
          setError(nextError);
        }
      }
    } catch (nextError) {
      setError(nextError);
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeNoticeState(patch: PortalNoticeStatePatch) {
    if (!detail || stateAction) return;
    const noticeId = detail.noticeId;
    setStateAction(noticeId);
    setError(null);
    try {
      const updated = await updatePortalNoticeState(noticeId, patch, readPortalBridgeToken());
      setDetail(updated);
      setItems((current) => current.map((item) => item.noticeId === updated.noticeId ? { ...item, ...updated } : item));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setStateAction(null);
    }
  }

  async function openNoticeUrl(url: string, actionId: string) {
    if (externalAction) return;
    setExternalAction(actionId);
    setError(null);
    try {
      await openPortalUrl(url, readPortalBridgeToken());
    } catch (nextError) {
      setError(nextError);
    } finally {
      setExternalAction(null);
    }
  }

  const currentSessionState = sessionState(status);
  const needsLogin = currentSessionState === 'login_required' || currentSessionState === 'session_expired';
  const actionLabel = action === 'sync' ? '동기화 중…' : '공지 동기화';
  const loginActionLabel = action === 'login' ? '기본 브라우저 여는 중…' : '기본 브라우저로 로그인';

  return <div className="portal-notices-panel">
    <div className="card section portal-notices-summary">
      <div className="head portal-notices-summary-head">
        <div>
          <h3>학교 공지</h3>
          <small>RITSUMEIKAN STUDENT PORTAL · 저장된 공지만 표시</small>
        </div>
        <div className="portal-notice-actions">
          {needsLogin && <button className="btn" type="button" disabled={action !== 'idle'} onClick={() => void runPortalAction('login')}>{loginActionLabel}</button>}
          <button className="btn primary" type="button" disabled={action !== 'idle' || aiAction !== 'idle'} onClick={() => void runPortalAction('sync')}>{actionLabel}</button>
        </div>
      </div>
      <div className="portal-notices-summary-status">
        <div className="portal-notices-meta">
          <span>마지막 동기화: <b>{formatPortalSyncDate(status.lastSyncAt)}</b></span>
          <span className={`portal-session-state ${needsLogin ? 'warning' : ''}`}>{portalNoticeStatusLabel(status.status, currentSessionState)}</span>
        </div>
        <div className="portal-notices-health">
          <span>최근 결과: 신규 {status.newCount} · 수정 {status.updatedCount} · 상세 실패 {status.detailFailedCount}</span>
          {status.lastError && <span className="portal-notices-last-error" title={status.lastError}>최근 오류: {status.lastError}</span>}
        </div>
      </div>
      <div className="portal-notice-kpis">
        <div><small>ALL</small><b>{status.counts.ALL}</b></div>
        <div><small>DM</small><b>{status.counts.DM}</b></div>
        <div><small>저장 공지</small><b>{status.storedCount}</b></div>
        <div><small>이번 신규</small><b>{status.newCount}</b></div>
        <div><small>이번 수정</small><b>{status.updatedCount}</b></div>
        <div><small>상세 실패</small><b>{status.detailFailedCount}</b></div>
      </div>
      {status.history && status.history.length > 0 && <details className="portal-sync-history">
        <summary>최근 동기화 이력 ({status.history.length})</summary>
        <div className="portal-sync-history-list">
          {status.history.slice(0, 5).map((run) => <div className="portal-sync-history-row" key={run.syncId}>
            <div><b>{formatPortalSyncDate(run.startedAt)}</b><small>{portalSyncRunStatusLabel(run.status)}</small></div>
            <span>신규 {run.newCount} · 수정 {run.updatedCount} · 상세 {run.detailCount} · 실패 {run.detailFailedCount}</span>
            {run.error && <small className="portal-sync-history-error" title={run.error}>{run.errorCode || '오류'}: {run.error}</small>}
          </div>)}
        </div>
      </details>}
      <details className="portal-notice-department-summary">
        <summary className="portal-notice-department-summary-head">
          <span className="portal-notice-department-summary-label"><b>발신처·담당부서별</b><small>개인 발신자명이 아니라 포털의 担当部課 기준</small></span>
          <span>{departmentSummaries.length}곳</span>
        </summary>
        <div className="portal-notice-department-summary-grid">
          {departmentSummaries.slice(0, 8).map((department) => {
            const selected = departmentFilter === (department.value || '__unknown__');
            return <button
              className={`portal-notice-department-card ${selected ? 'active' : ''}`}
              key={department.value || '__unknown__'}
              type="button"
              aria-pressed={selected}
              onClick={() => setDepartmentFilter((current) => current === (department.value || '__unknown__') ? '' : (department.value || '__unknown__'))}
            >
              <span className="portal-notice-department-card-title"><b>{department.name}</b><strong>{department.count}</strong></span>
              <small>ALL {department.counts.ALL} · DM {department.counts.DM}</small>
              <small>미읽음 {department.unreadCount} · 중요 {department.importantCount}</small>
              <small>{department.latestPublishedAt ? `최근 ${formatPortalNoticeDate(department.latestPublishedAt)}` : '최근 게시일 없음'}</small>
            </button>;
          })}
        </div>
        {departmentSummaries.length > 8 && <small className="portal-notice-department-summary-note">전체 담당부서는 아래 필터에서 선택할 수 있어.</small>}
      </details>
    </div>

    {error !== null && <div className="error portal-notices-error">{portalNoticeErrorMessage(error)}</div>}

    <div className={`portal-notice-master-detail ${selectedId ? 'has-selection' : ''}`}>
      <div className="card section portal-notices-list-card">
        <div className="portal-notice-toolbar">
          <div className="tabs" role="tablist" aria-label="학교 공지 유형">
            {(['ALL', 'DM'] as PortalNoticeType[]).map((type) => <button key={type} className={tab === type ? 'active' : ''} type="button" role="tab" aria-selected={tab === type} onClick={() => setTab(type)}>{type} <span>{status.counts[type]}</span></button>)}
          </div>
          <small>{loading ? '불러오는 중…' : `${visibleItems.length}건 표시 · 미읽음 ${visibleUnreadCount}건`}</small>
        </div>
        <div className="portal-notice-filters">
          <label className="portal-notice-department-filter">발신자/담당부서
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="">전체 담당부서</option>
              {departments.filter((department) => department.counts[tab] > 0).map((department) => <option key={department.value || '__unknown__'} value={department.value || '__unknown__'}>{department.name} ({department.counts[tab]})</option>)}
            </select>
          </label>
          <div className="portal-notice-filter-tools">
            <label className="portal-notice-search">
              <span className="sr-only">공지 검색</span>
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="제목·본문·담당부서 검색" aria-label="공지 제목, 본문, 담당부서 검색" />
            </label>
            <label className="portal-notice-sort">
              <span className="sr-only">공지 정렬</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as PortalNoticeSort)} aria-label="공지 정렬">
                <option value="published_desc">최신 게시순</option>
                <option value="deadline_asc">마감 임박순</option>
                <option value="title_asc">제목순</option>
              </select>
            </label>
          </div>
          <div className="portal-notice-view-filters" role="tablist" aria-label="학교 공지 상태">
            {([['all', '전체'], ['unread', '미읽음'], ['important', '중요'], ['archived', '보관'], ['deadline', '마감 있음'], ['expired', '기한 종료']] as [PortalNoticeViewFilter, string][]).map(([filter, label]) => <button key={filter} className={viewFilter === filter ? 'active' : ''} type="button" role="tab" aria-selected={viewFilter === filter} onClick={() => setViewFilter(filter)}>{label}</button>)}
          </div>
        </div>
        {loading ? <div className="empty compact-empty">저장된 학교 공지를 불러오는 중이야.</div> : visibleItems.length ? <div className="portal-notice-list">
          {visibleItems.map((notice) => <button className={`portal-notice-row ${selectedId === notice.noticeId ? 'selected' : ''} ${!notice.isRead ? 'unread' : ''} ${notice.isArchived ? 'archived' : ''}`} type="button" key={notice.noticeId} onClick={() => void openDetail(notice)} aria-expanded={selectedId === notice.noticeId}>
            <span className={`portal-notice-type ${notice.type === 'DM' ? 'dm' : ''}`}>{notice.type}</span>
            <span className="portal-notice-main"><span className="portal-notice-title-line"><b title={notice.title || '(제목 없음)'}>{notice.title || '(제목 없음)'}</b>{!notice.isRead && <i className="portal-notice-unread-dot" aria-label="읽지 않음" />}</span><small>{notice.department || '담당부서 미상'} · 게시 {formatPortalNoticeDate(notice.publishedAt)}{notice.deadline ? ` · 마감 ${notice.deadline}` : ''}</small></span>
            <span className="portal-notice-extra">{notice.firstSeenAt === status.lastSyncAt && <em className="notice-new">신규</em>}{noticeUpdatedInSync(notice, status) && <em className="notice-updated">수정됨</em>}{notice.isImportant && <em className="user-important">내 중요</em>}{notice.importance && <em>{notice.importance}</em>}{notice.isArchived && <small>보관</small>}{portalNoticeDeadlineState(notice) === 'expired' && <em className="notice-expired">기한 종료</em>}</span>
          </button>)}
        </div> : <div className="empty compact-empty">{searchQuery ? '검색 조건에 맞는 공지가 없어.' : `저장된 ${tab} 공지가 없어. 상단의 공지 동기화를 눌러줘.`}</div>}
      </div>

      <div className="portal-notice-detail-pane">
        {detailLoading && <div className="card section portal-notice-detail portal-notice-detail-empty"><div className="empty compact-empty">공지 상세를 불러오는 중이야.</div></div>}
        {detail && !detailLoading && <article className="card section portal-notice-detail">
          <div className="head portal-notice-detail-head">
            <div className="portal-notice-detail-title"><span className={`portal-notice-type ${detail.type === 'DM' ? 'dm' : ''}`}>{detail.type}</span><h3 title={detail.title || '(제목 없음)'}>{detail.title || '(제목 없음)'}</h3></div>
            <button className="mini portal-notice-back-button" type="button" aria-label="공지 목록으로 돌아가기" onClick={() => { setSelectedId(null); setDetail(null); }}>← 목록</button>
          </div>
          <dl className="portal-notice-core-meta">
            <div><dt>담당부서</dt><dd>{detail.department || '—'}</dd></div>
            <div><dt>게시일</dt><dd>{formatPortalNoticeDate(detail.publishedAt)}</dd></div>
            <div><dt>마감일</dt><dd>{detail.deadline || '—'}</dd></div>
            <div><dt>기한 상태</dt><dd>{portalNoticeDeadlineState(detail) === 'expired' ? '기한 종료' : portalNoticeDeadlineState(detail) === 'upcoming' ? '기한 있음' : '기한 없음'}</dd></div>
          </dl>
          <div className="portal-notice-detail-actions">
            <button className="mini" type="button" disabled={stateAction !== null} onClick={() => void changeNoticeState({ isRead: !detail.isRead })}>{detail.isRead ? '읽지 않음으로 표시' : '읽음 처리'}</button>
            <button className="mini" type="button" disabled={stateAction !== null} onClick={() => void changeNoticeState({ isImportant: !detail.isImportant })}>{detail.isImportant ? '중요 해제' : '중요 표시'}</button>
            <button className="mini" type="button" disabled={stateAction !== null} onClick={() => void changeNoticeState({ isArchived: !detail.isArchived })}>{detail.isArchived ? '보관 해제' : '보관'}</button>
            <button className="mini portal-notice-source-button" type="button" disabled={externalAction !== null} onClick={() => void openNoticeUrl(detail.sourceUrl, 'source')}>
              {externalAction === 'source' ? '기본 브라우저 여는 중…' : '원문 열기 ↗'}
            </button>
          </div>
          <div className="portal-notice-body">{detail.body ? detail.body.split(/\r?\n/).map((line, index) => <p key={`${index}-${line}`}>{line || '\u00a0'}</p>) : <span className="muted">저장된 본문이 없어.</span>}</div>
          {detail.attachments.length > 0 && <div className="portal-notice-attachments"><b>첨부파일 metadata</b>{detail.attachments.map((attachment) => <button
            className="portal-notice-attachment-link"
            key={attachment.id}
            type="button"
            disabled={externalAction !== null}
            title={attachment.url ? '저장된 첨부파일 URL을 기본 브라우저에서 열기' : '직접 링크가 없어 포털 원문을 기본 브라우저에서 열기'}
            onClick={() => void openNoticeUrl(attachment.url || detail.sourceUrl, `attachment:${attachment.id}`)}
          >
            <span>{attachment.filename || attachment.url || '첨부파일'}</span>
            <small>{externalAction === `attachment:${attachment.id}` ? '기본 브라우저 여는 중…' : attachment.url ? '기본 브라우저에서 열기' : '포털에서 열기'}</small>
          </button>)}</div>}
          <PortalNoticeAI
            ai={detail.ai}
            candidates={detail.calendarCandidates}
            busy={aiAction === 'analyze'}
            onAnalyze={runNoticeAnalysis}
            onAddCandidate={addPortalCandidate}
            onIgnoreCandidate={ignorePortalCandidate}
          />
          <details className="portal-notice-extra-details">
            <summary>상세 정보</summary>
            <dl className="portal-notice-detail-meta">
              <div><dt>공개 종료일</dt><dd>{formatPortalNoticeDate(detail.expiresAt)}</dd></div>
              <div><dt>중요도</dt><dd>{detail.importance || '—'}</dd></div>
              <div><dt>카테고리</dt><dd>{detail.category || '—'}</dd></div>
              <div><dt>최근 수정</dt><dd>{formatPortalNoticeDate(detail.lastChangedAt || '')}</dd></div>
              <div><dt>수정 횟수</dt><dd>{detail.changeCount}</dd></div>
            </dl>
          </details>
          <div className="portal-notice-source"><small>notice_id: {detail.noticeId}</small></div>
        </article>}
        {!detailLoading && !detail && <div className="card section portal-notice-detail portal-notice-detail-empty"><div className="empty compact-empty">{selectedId ? '공지 상세를 표시하지 못했어.' : '왼쪽 목록에서 공지를 선택해줘.'}</div></div>}
      </div>
    </div>
  </div>;
}
