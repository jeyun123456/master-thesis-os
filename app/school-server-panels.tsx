'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  agentErrorText, mtosApi,
  type SchoolMailDetail, type SchoolMailSummary, type SchoolNoticeDetail, type SchoolNoticeSummary, type SchoolSourceStatus,
} from '../lib/mtos-client';
import { fromNotice, fromSchoolMail } from '../lib/detail-model';
import type { PrioritizedMail } from '../lib/mail-priority';
import { DetailDrawer, useDetailSelection, useSelectedDetail } from './detail-drawer';
import { DetailState, MailDetailBody, NoticeDetailBody, SourceActions } from './detail-views';
import { MailErrorNotice } from './mail-error-notice';
import { SchoolMailRow } from './school-mail-panel';

function formatDate(value: string | null | undefined): string {
  if (!value) return '정보 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function syncLabel(status: SchoolSourceStatus | null): string {
  if (!status) return '확인 중';
  return status.last_success_at ? `마지막 동기화 ${formatDate(status.last_success_at)}` : '아직 동기화 전';
}

function toRow(mail: SchoolMailSummary): PrioritizedMail {
  return {
    id: mail.id, subject: mail.subject || '(제목 없음)', senderName: mail.from_addr || '발신자 정보 없음', senderAddress: '',
    receivedAt: mail.received_at ?? mail.sent_at ?? mail.collected_at, isRead: mail.read_state,
    priority: mail.analysis?.importance === 'high' ? 'important' : 'normal', category: 'other',
  };
}

/** 학교 Outlook 메일: Thunderbird가 받은 메일을 서버가 수집해 둔 사본. */
export function ThunderbirdMailPanel() {
  const [mails, setMails] = useState<SchoolMailSummary[]>([]);
  const [status, setStatus] = useState<SchoolSourceStatus | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { selectedId, select, close } = useDetailSelection('school-mail');
  const detail = useSelectedDetail<SchoolMailDetail>(selectedId, async (id) => (await mtosApi.schoolMail(id)).mail, '메일을 열지 못했어.');
  const model = useMemo(() => (detail.data ? fromSchoolMail(detail.data) : null), [detail.data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [state, list] = await Promise.all([mtosApi.schoolStatus(), mtosApi.schoolMails(50)]);
      setStatus(state.mail);
      setAccounts(state.mail.accounts);
      setMails(list.mails);
    } catch (e) {
      setError(agentErrorText(e, '학교 메일을 불러오지 못했어.'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const summary = mails.find((m) => m.id === selectedId);
  const waiting = !loading && !error && status && !status.connected;
  return <section className="card section microsoft-mail-card school-mail-card">
    <div className="head"><h3>학교 Outlook (Thunderbird)</h3><span>{waiting ? '연결 준비 중' : syncLabel(status)}</span></div>
    <div className="muted"><small>{accounts.length ? accounts.map(maskAccount).join(', ') : '서버 Thunderbird'} · 서버가 2분마다 확인 · 읽기 전용</small></div>
    {loading && <div className="microsoft-mail-state">학교 메일을 불러오는 중이야…</div>}
    {error && <MailErrorNotice message={error} code="school_mail" onRetry={() => void load()} />}
    {!error && status?.last_error && <div className="note">최근 동기화 오류: {status.last_error}. 이미 받은 메일은 그대로 보여줘.</div>}
    {waiting && <div className="empty compact-empty">Thunderbird 이메일 연결 준비 중</div>}
    {!loading && !error && status?.connected && (mails.length
      ? <div className="microsoft-mail-list">{mails.map((mail) => <SchoolMailRow
          key={mail.id} item={toRow(mail)} onOpen={(item) => select(item.id)}
          analysisSummary={mail.analysis?.summary || undefined}
        />)}</div>
      : <div className="empty compact-empty">최근 90일 안에 수집된 학교 메일이 없어.</div>)}
    <div className="toolbar school-mail-actions"><button className="mini" onClick={() => void load()} type="button">새로고침</button></div>
    <DetailDrawer open={selectedId !== null} title={model?.subject ?? summary?.subject ?? '메일'} onClose={close}
      footer={model ? <SourceActions source={model.source} kind="outlook-web" /> : undefined}>
      <DetailState loading={detail.loading} error={detail.error} onRetry={detail.retry} />
      {model && <MailDetailBody mail={model} />}
    </DetailDrawer>
  </section>;
}

const maskAccount = (value: string) => value.replace(/^(..)[^@]*(@.*)$/, '$1***$2');

/** 학교 공지: 서버의 포털 로그인 세션으로 수집한 ALL · DM 공지. */
export function SchoolNoticesPanel() {
  const [notices, setNotices] = useState<SchoolNoticeSummary[]>([]);
  const [status, setStatus] = useState<(SchoolSourceStatus & { needs_login: boolean }) | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'DM' | 'both'>('both');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { selectedId, select, close } = useDetailSelection('school-notice');
  const detail = useSelectedDetail<SchoolNoticeDetail>(selectedId, async (id) => (await mtosApi.schoolNotice(id)).notice, '공지를 열지 못했어.');
  const model = useMemo(() => (detail.data ? fromNotice(detail.data) : null), [detail.data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [state, list] = await Promise.all([mtosApi.schoolStatus(), mtosApi.schoolNotices(filter === 'both' ? undefined : filter)]);
      setStatus(state.notices);
      setNotices(list.notices);
    } catch (e) {
      setError(agentErrorText(e, '학교 공지를 불러오지 못했어.'));
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const summary = notices.find((n) => n.notice_id === selectedId);
  const waiting = !loading && !error && status && !status.connected && !status.needs_login;
  return <section className="card section school-notices">
    <div className="head"><h3>학교 공지</h3><span>{status?.needs_login ? '학교 포털 재로그인 필요' : waiting ? '연결 준비 중' : syncLabel(status)}</span></div>
    <div className="muted"><small>RITSUMEIKAN STUDENT PORTAL · ALL · DM · 서버가 5분마다 확인 · 읽기 전용</small></div>
    {status?.needs_login && <div className="error" role="alert"><b>학교 포털 재로그인 필요</b> 포털 세션이 만료돼 수집을 멈췄어. 서버에서 <code>node scripts/portal-login.js</code>를 실행해 직접 로그인하면 다시 시작해. 이미 받은 공지는 그대로 보여줘.</div>}
    {!status?.needs_login && status?.last_error && <div className="note">최근 동기화 오류: {status.last_error}. 이미 받은 공지는 그대로 보여줘.</div>}
    {loading && <div className="microsoft-mail-state">학교 공지를 불러오는 중이야…</div>}
    {error && <div className="error" role="alert">{error} <button className="mini" onClick={() => void load()} type="button">다시 시도</button></div>}
    {waiting && <div className="empty compact-empty">학교 공지 연결 준비 중 — 서버에서 포털 로그인이 필요해.</div>}
    {(status?.connected || status?.needs_login) && <div className="toolbar">{(['both', 'ALL', 'DM'] as const).map((value) => <button key={value} className={`mini${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)} type="button">{value === 'both' ? '전체' : value}</button>)}</div>}
    {!loading && !error && status?.connected && (notices.length
      ? <div className="microsoft-mail-list">{notices.map((notice) => <button key={notice.notice_id} className="microsoft-mail-row school-mail-row-button" onClick={() => select(notice.notice_id)} type="button" aria-label={`${notice.title} 공지 열기`}>
          <span className="microsoft-mail-main">
            <b>{notice.analysis?.importance === 'high' && <span className="school-mail-priority-label important">중요</span>}[{notice.notice_type || 'ALL'}] {notice.title}</b>
            <small>{notice.department || '담당 부서 정보 없음'} · 게시 {formatDate(notice.published_at)}{notice.deadline ? ` · 기한 ${notice.deadline}` : ''}{notice.attachment_count ? ` · 첨부 ${notice.attachment_count}` : ''}</small>
            {notice.analysis?.summary && <small className="school-mail-ai-summary"><b>AI 요약</b> {notice.analysis.summary}</small>}
          </span>
        </button>)}</div>
      : <div className="empty compact-empty">최근 90일 안에 수집된 공지가 없어.</div>)}
    <div className="toolbar school-mail-actions"><button className="mini" onClick={() => void load()} type="button">새로고침</button></div>
    <DetailDrawer open={selectedId !== null} title={model ? `[${model.noticeType}] ${model.title}` : summary ? `[${summary.notice_type || 'ALL'}] ${summary.title}` : '공지'} onClose={close}
      footer={model ? <SourceActions source={model.source} kind="school-notice" /> : undefined}>
      <DetailState loading={detail.loading} error={detail.error} onRetry={detail.retry} />
      {model && <NoticeDetailBody notice={model} />}
    </DetailDrawer>
  </section>;
}
