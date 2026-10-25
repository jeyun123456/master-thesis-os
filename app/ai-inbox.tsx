'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { agentErrorText, aiTaskFields, AgentRequestError, applyApproval, mtosApi, undoAiTask, type AgentJob, type AgentStatus, type Approval, type ApprovalEvent, type InboxItem } from '@/lib/mtos-client';
import { blockDiff } from '@/lib/mtos-planning';
import { createP0Task, listP0Tasks, type P0Task } from '@/lib/p0-tasks-client';
import type { ResearchProject } from '@/lib/projects';
import styles from './ai-inbox.module.css';

const OUTBOX_KEY = 'mtos.capture.outbox.v1';
type OutboxEntry = { capture_id: string; text: string; at: string };
type P0Conflict = { id: number; task_id: string; field: string; server_value: unknown; client_value: unknown };

const CLASS_LABEL: Record<string, string> = { task: '할 일', note: '연구 메모', reference: '참고자료', schedule: '일정 후보', unclassified: '미분류' };
const APPROVAL_LABEL: Record<string, string> = { deadline_change: '마감일 변경', stage_change: '연구 단계 변경', milestone_add: '마일스톤 등록', obsidian_write: 'Obsidian 반영', duplicate_merge: '중복 통합', sync_conflict: '동기화 충돌' };
const STATE_LABEL: Record<string, string> = { applied: '반영됨', rejected: '거부됨', stale: '무효(원본 변경)', failed: '실패', approved: '승인됨(반영 전)', pending: '승인 대기' };

function readOutbox(): OutboxEntry[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') as OutboxEntry[]; } catch { return []; }
}
function writeOutbox(entries: OutboxEntry[]) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries)); return true; } catch { return false; }
}

/**
 * Saves a capture. Unsent text is kept in this browser and resent with the
 * same capture_id, so a failure never loses input and a retry never duplicates.
 */
export async function submitCapture(text: string) {
  const entry: OutboxEntry = { capture_id: crypto.randomUUID(), text, at: new Date().toISOString() };
  writeOutbox([...readOutbox(), entry]);
  return flushOutbox();
}

export async function flushOutbox() {
  const pending = readOutbox();
  const remaining: OutboxEntry[] = [];
  let sent = 0;
  let lastError = '';
  for (const entry of pending) {
    try {
      await mtosApi.capture({ text: entry.text, capture_id: entry.capture_id });
      sent += 1;
    } catch (error) {
      remaining.push(entry);
      lastError = agentErrorText(error, '저장하지 못했어.');
    }
  }
  writeOutbox(remaining);
  return { sent, waiting: remaining.length, error: lastError };
}

export function CaptureBox({ onSaved, compact = false }: { onSaved?: () => void; compact?: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    setWaiting(readOutbox().length);
    if (readOutbox().length) void flushOutbox().then((r) => { setWaiting(r.waiting); if (r.sent) onSaved?.(); });
  }, [onSaved]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const result = await submitCapture(text.trim());
    setText('');
    setWaiting(result.waiting);
    setMessage(result.waiting ? `서버에 아직 못 보냈어. 이 기기에 보관했고 다시 연결되면 자동으로 보낼게. (${result.error})` : 'AI 인박스에 저장했어. 분류는 잠시 뒤에 끝나.');
    setBusy(false);
    if (result.sent) onSaved?.();
  }

  return <form className={`${styles.capture} ${compact ? styles.captureCompact : ''}`} onSubmit={(event) => void save(event)}>
    <label className={styles.captureLabel}>빠른 입력
      <textarea rows={compact ? 2 : 3} value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} placeholder="할 일, 생각, 링크를 그냥 적어. AI가 분류해." />
    </label>
    <div className={styles.captureActions}>
      <button className="mini primary" type="submit" disabled={busy || !text.trim()}>{busy ? '저장 중…' : '인박스에 저장'}</button>
      {waiting > 0 && <button className="mini" type="button" onClick={() => void flushOutbox().then((r) => { setWaiting(r.waiting); setMessage(r.waiting ? `아직 ${r.waiting}건 대기 중: ${r.error}` : '보관해둔 입력을 모두 보냈어.'); if (r.sent) onSaved?.(); })}>미전송 {waiting}건 다시 보내기</button>}
    </div>
    {message && <p className={styles.note} role="status">{message}</p>}
  </form>;
}

export function AiInboxPanel({ projects, onTasksChanged }: { projects: ResearchProject[]; onTasksChanged: () => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [failedJobs, setFailedJobs] = useState<AgentJob[]>([]);
  const [tasks, setTasks] = useState<P0Task[]>([]);
  const [conflicts, setConflicts] = useState<P0Conflict[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loadCode, setLoadCode] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const load = useCallback(async () => {
    try {
      const [inbox, approvalList, agentStatus, jobs] = await Promise.all([mtosApi.inbox(), mtosApi.approvals(), mtosApi.status(), mtosApi.jobs('failed')]);
      setItems(inbox.items);
      setApprovals(approvalList.approvals);
      setStatus(agentStatus);
      setFailedJobs(jobs.jobs);
      setLoadError('');
      setLoadCode('');
    } catch (error) {
      setLoadError(agentErrorText(error, 'AI 인박스를 불러오지 못했어.'));
      setLoadCode(error instanceof AgentRequestError ? error.code : '');
    } finally {
      setLoaded(true);
    }
    try {
      const result = await listP0Tasks();
      setTasks(result.tasks);
      setConflicts((result.conflicts as P0Conflict[]).filter((c) => typeof c?.id === 'number'));
    } catch { /* P0 errors are shown on the home list */ }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Classification runs in the background; refresh while something is in flight.
  useEffect(() => {
    if (!items.some((i) => i.state === 'new' || i.state === 'classifying')) return;
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [items, load]);

  async function act(key: string, action: () => Promise<unknown>, done?: string) {
    setBusyId(key);
    setMessage('');
    try {
      await action();
      if (done) setMessage(done);
    } catch (error) {
      setMessage(agentErrorText(error, '처리하지 못했어.'));
    } finally {
      setBusyId(null);
      await load();
    }
  }

  const pending = approvals.filter((a) => a.state === 'pending' || a.state === 'approved' || a.state === 'failed');
  const history = approvals.filter((a) => !pending.includes(a));
  const aiCreated = items.filter((i) => i.state === 'applied' && i.created_task_id);
  const classified = items.filter((i) => i.state === 'classified' || i.state === 'auto_pending');
  const inFlight = items.filter((i) => i.state === 'new' || i.state === 'classifying' || i.state === 'failed');
  const closed = items.filter((i) => ['undone', 'duplicate', 'dismissed'].includes(i.state));
  const taskTitle = (id: string | null) => tasks.find((t) => t.id === id)?.title ?? id ?? '';

  return <div className={styles.root}>
    <section className="card section">
      <div className="head"><h3>AI 인박스</h3><span>{loaded ? `승인 대기 ${pending.length} · 분류됨 ${classified.length}` : '불러오는 중…'}</span></div>
      <CaptureBox onSaved={() => void load()} />
      <WorkerStatus status={status} busy={busyId === 'collect'} onCollect={() => void act('collect', () => mtosApi.requestJob('collect_mail', {}, `collect_mail:now:${new Date().toISOString().slice(0, 16)}`), '메일 확인을 요청했어. 지정한 발신자의 새 메일만 가져와.')}
        onResume={() => void act('resume', () => mtosApi.resumeWorker(), 'AI 작업을 다시 시작했어.')} />
      {loadError && <p className={loadCode === 'agent_unconfigured' ? styles.config : 'error'} role="alert">{loadError}</p>}
      {message && <p className={styles.note} role="status">{message}</p>}
    </section>

    {conflicts.length > 0 && <section className="card section section-gap">
      <div className="head"><h3>동기화 충돌 · 최종 선택</h3><span>{conflicts.length}건</span></div>
      <ul className={styles.list}>{conflicts.map((c) => <li key={c.id} className={styles.item}>
        <div><b>{taskTitle(c.task_id)}</b> · {c.field}<small>서버 값: {JSON.stringify(c.server_value)} / 이 기기 값: {JSON.stringify(c.client_value)}</small></div>
        <div className={styles.actions}>
          {(['server', 'client'] as const).map((choice) => <button key={choice} className="mini" type="button" disabled={busyId === `c${c.id}`} onClick={() => void act(`c${c.id}`, async () => {
            const response = await fetch(`/api/p0/conflicts/${c.id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ choice }) });
            if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? '충돌 해결 실패');
            onTasksChanged();
          }, '충돌을 해결했어.')}>{choice === 'server' ? '서버 값 유지' : '이 기기 값 적용'}</button>)}
        </div>
      </li>)}</ul>
    </section>}

    <section className="card section section-gap">
      <div className="head"><h3>승인 대기</h3><span>{pending.length}건 · 승인 전에는 아무것도 바뀌지 않아</span></div>
      {pending.length ? <ul className={styles.list}>{pending.map((a) => <ApprovalCard key={a.id} approval={a} busy={busyId === a.id}
        onDecide={(decision, payload) => void act(a.id, async () => {
          const { approval } = a.state === 'pending' ? await mtosApi.decideApproval(a.id, decision, payload) : { approval: a };
          if (decision === 'approved') { await applyApproval(approval, tasks); onTasksChanged(); }
        }, decision === 'approved' ? '승인하고 반영했어.' : '거부했어. 기록은 이력에 남아.')} />)}</ul>
        : <div className="empty compact-empty">{loadError ? '서버 연결 후 표시돼.' : '승인할 항목이 없어.'}</div>}
    </section>

    <section className="card section section-gap">
      <div className="head"><h3>AI가 새로 추가한 할 일</h3><span>{aiCreated.length}개</span></div>
      {aiCreated.length ? <ul className={styles.list}>{aiCreated.map((i) => <li key={i.id} className={styles.item}>
        <div><span className={styles.aiBadge}>AI 생성</span>{tasks.find((t) => t.id === i.created_task_id)?.is_new && <span className={styles.newBadge}>새로 추가됨</span>}
          <b>{taskTitle(i.created_task_id)}</b><small>{sourceLine(i)}</small></div>
        <div className={styles.actions}><button className="mini" type="button" disabled={busyId === i.id} onClick={() => window.confirm('이 할 일을 되돌릴까? P0에서 삭제 처리되고 원문은 인박스에 남아.') && void act(i.id, async () => { await undoAiTask(i); onTasksChanged(); }, '되돌렸어.')}>실행 취소</button></div>
      </li>)}</ul> : <div className="empty compact-empty">아직 없어.</div>}
    </section>

    <section className="card section section-gap">
      <div className="head"><h3>분류됨 · 확인 필요</h3><span>{classified.length}개</span></div>
      {classified.length ? <ul className={styles.list}>{classified.map((i) => {
        const c = i.classification;
        return <li key={i.id} className={styles.item}>
          <div>
            <span className={styles.classBadge}>{c ? CLASS_LABEL[c.class] : '분류 전'}</span>
            <b>{c?.title || i.raw_text.slice(0, 80)}</b>
            <small>{[c?.due_date ? (c.due_is_explicit ? `기한 ${c.due_date}` : `추정 날짜 ${c.due_date} (확인 필요)`) : '', c?.project_id ? `프로젝트 ${projects.find((p) => p.id === c.project_id)?.title ?? c.project_id}` : '', c ? `확신도 ${Math.round(c.confidence * 100)}%` : '', c?.reason].filter(Boolean).join(' · ')}</small>
            <small>{sourceLine(i)}</small>
          </div>
          <div className={styles.actions}>
            <button className="mini primary" type="button" disabled={busyId === i.id || !c} onClick={() => void act(i.id, async () => {
              const request = aiTaskFields(i, projectIds);
              const { task } = await createP0Task(request);
              await mtosApi.putTaskMeta(task.id, { ai_generated: true, source_ref: i.source_ref ?? `inbox:${i.id}` });
              await mtosApi.setInboxState(i.id, { state: 'applied', created_task_id: task.id });
              onTasksChanged();
            }, '할 일로 등록했어.')}>할 일로 등록</button>
            <button className="mini" type="button" disabled={busyId === i.id} onClick={() => void act(i.id, async () => {
              await mtosApi.createMemo({ id: `inbox-${i.id}`, kind: c?.class === 'reference' ? 'reference' : 'note', body: i.raw_text, project_id: c?.project_id ?? null, source_url: i.source_url });
              await mtosApi.setInboxState(i.id, { state: 'dismissed' });
            }, '메모로 저장했어. 원문은 인박스 이력에도 남아.')}>메모로 저장</button>
            <button className="mini" type="button" disabled={busyId === i.id} onClick={() => void act(i.id, () => mtosApi.reclassify(i.id), '다시 분류를 요청했어.')}>다시 분류</button>
            <button className="mini" type="button" disabled={busyId === i.id} onClick={() => void act(i.id, () => mtosApi.setInboxState(i.id, { state: 'dismissed' }))}>보관</button>
          </div>
        </li>;
      })}</ul> : <div className="empty compact-empty">확인할 항목이 없어.</div>}
    </section>

    {(inFlight.length > 0 || failedJobs.length > 0) && <section className="card section section-gap">
      <div className="head"><h3>처리 중 · 실패</h3><span>{inFlight.length + failedJobs.length}건</span></div>
      <ul className={styles.list}>
        {inFlight.map((i) => <li key={i.id} className={styles.item}><div><b>{i.raw_text.slice(0, 100)}</b><small>{i.state === 'new' ? '분류 대기' : i.state === 'classifying' ? '분류 중' : '실패'}{i.error ? ` · ${i.error}` : ''} · 원문은 안전하게 저장돼 있어</small></div>
          {i.state === 'failed' && <div className={styles.actions}><button className="mini" type="button" disabled={busyId === i.id} onClick={() => void act(i.id, () => mtosApi.reclassify(i.id), '다시 분류를 요청했어.')}>다시 분류</button></div>}</li>)}
        {failedJobs.map((j) => <li key={j.id} className={styles.item}><div><b>{j.type}</b><small>{j.error} · 시도 {j.attempts}/{j.max_attempts}{j.model ? ` · ${j.model}` : ''}</small></div>
          <div className={styles.actions}><button className="mini" type="button" onClick={() => void act(j.id, () => mtosApi.retryJob(j.id), '다시 시도할게.')}>다시 시도</button></div></li>)}
      </ul>
    </section>}

    <details className="card section section-gap">
      <summary>처리 이력 ({history.length + closed.length})</summary>
      <ul className={styles.list}>
        {history.map((a) => <HistoryRow key={a.id} approval={a} />)}
        {closed.map((i) => <li key={i.id} className={styles.item}><div><b>{i.classification?.title || i.raw_text.slice(0, 80)}</b><small>{i.state === 'undone' ? '실행 취소됨' : i.state === 'duplicate' ? `중복으로 연결됨: ${taskTitle(i.duplicate_of_task_id)}` : '보관됨'} · {sourceLine(i)}</small></div></li>)}
      </ul>
    </details>

    <MailSenders />
  </div>;
}

function sourceLine(item: InboxItem) {
  const when = new Date(item.received_at).toLocaleString('ko-KR');
  const from = item.source_kind === 'gmail' ? 'Gmail' : item.source_kind === 'portal' ? '학교 공지' : item.source_kind === 'link' ? '링크' : '직접 입력';
  return `${from} · ${when}${item.source_url ? ` · ${item.source_url}` : ''}`;
}

function WorkerStatus({ status, busy, onCollect, onResume }: { status: AgentStatus | null; busy: boolean; onCollect: () => void; onResume: () => void }) {
  if (!status) return null;
  const beat = status.worker.heartbeat ? Math.round((Date.now() - Date.parse(status.worker.heartbeat.at)) / 60_000) : null;
  return <div className={styles.status}>
    <span>AI 작업기: {status.worker.paused ? <b className={styles.warn}>정지됨 ({status.worker.paused.message})</b> : beat === null ? '실행 기록 없음' : beat > 3 ? <b className={styles.warn}>{beat}분째 응답 없음</b> : '작동 중'}
      {status.worker.heartbeat?.codex_model ? ` · ${status.worker.heartbeat.codex_model}` : ''} · 대기 {(status.queue.queued ?? 0) + (status.queue.retry_wait ?? 0)} · 실행 {status.queue.running ?? 0}</span>
    <span>메일: {status.gmail.last_success_at ? `마지막 확인 ${new Date(status.gmail.last_success_at).toLocaleString('ko-KR')}` : '아직 확인 안 함'}{status.gmail.last_error ? <b className={styles.warn}> · 오류: {status.gmail.last_error}</b> : ''} · 발신자 {status.mail_senders}명 · 매일 06:00·18:00 (JST)</span>
    <span className={styles.actions}>
      <button className="mini" type="button" disabled={busy} onClick={onCollect}>지금 확인</button>
      {status.worker.paused && <button className="mini" type="button" onClick={onResume}>다시 시작</button>}
    </span>
  </div>;
}

function ApprovalCard({ approval, busy, onDecide }: { approval: Approval; busy: boolean; onDecide: (decision: 'approved' | 'rejected', payload?: Record<string, unknown>) => void }) {
  const [payload, setPayload] = useState<Record<string, unknown>>(approval.payload);
  const p = payload;
  const editable = approval.state === 'pending';
  return <li className={styles.approval}>
    <div className={styles.approvalHead}>
      <span className={styles.classBadge}>{APPROVAL_LABEL[approval.kind]}</span>
      <b>{approval.title}</b>
      {approval.official_deadline && <span className={styles.official}>공식 마감 {approval.official_deadline}</span>}
      {approval.state !== 'pending' && <span className={styles.warn}>{STATE_LABEL[approval.state]}{approval.error ? `: ${approval.error}` : ''}</span>}
    </div>
    {approval.kind === 'deadline_change' && <p>{String(p.title)}: {String(p.from ?? '기한 없음')} → <input type="date" value={String(p.to ?? '')} disabled={!editable} onChange={(e) => setPayload({ ...p, to: e.target.value })} aria-label="새 마감일" />
      {p.source_url ? <> · <a href={String(p.source_url)} target="_blank" rel="noreferrer">근거 원문</a></> : null}</p>}
    {approval.kind === 'milestone_add' && <div className={styles.inline}>
      <input value={String(p.title ?? '')} disabled={!editable} onChange={(e) => setPayload({ ...p, title: e.target.value })} aria-label="마일스톤 이름" />
      <input type="date" value={String(p.date ?? '')} disabled={!editable} onChange={(e) => setPayload({ ...p, date: e.target.value })} aria-label="날짜" />
      <select value={String(p.kind)} disabled={!editable} onChange={(e) => setPayload({ ...p, kind: e.target.value })} aria-label="종류"><option value="internal">내부 목표</option><option value="official" disabled={!p.evidence_url}>학교 공식 마감</option></select>
    </div>}
    {approval.kind === 'duplicate_merge' && <p>기존: <b>{String(p.existing_title)}</b> ↔ 새 항목: <b>{String(p.candidate_title)}</b>. 승인하면 새 항목을 기존 할 일에 연결하고 원문은 보존해.</p>}
    {approval.kind === 'stage_change' && <p>{String(p.project_id)}: {String(p.from ?? '')} → {String(p.stage)}</p>}
    {approval.kind === 'obsidian_write' && <ObsidianReview payload={p} editable={editable} onChange={(after) => setPayload({ ...p, after_text: after })} />}
    <div className={styles.actions}>
      <button className="mini primary" type="button" disabled={busy} onClick={() => onDecide('approved', editable ? payload : undefined)}>{approval.state === 'pending' ? '승인하고 반영' : '다시 반영'}</button>
      {approval.state === 'pending' && <button className="mini" type="button" disabled={busy} onClick={() => onDecide('rejected')}>거부</button>}
    </div>
  </li>;
}

function ObsidianReview({ payload, editable, onChange }: { payload: Record<string, unknown>; editable: boolean; onChange: (after: string) => void }) {
  const [editing, setEditing] = useState(false);
  const before = String(payload.before_text ?? '');
  const after = String(payload.after_text ?? '');
  return <div className={styles.obsidian}>
    <small>{String(payload.path)} · {payload.mode === 'new' ? '새 노트' : payload.mode === 'append' ? '끝에 추가' : 'AI 통합 수정'} · {String(payload.summary ?? '')}</small>
    <div className={styles.diff} aria-label="변경 전후 차이">{blockDiff(before, after).map((block, index) => <p key={index} className={block.kind === 'added' ? styles.added : block.kind === 'removed' ? styles.removed : styles.same}>
      <span aria-hidden="true">{block.kind === 'added' ? '+' : block.kind === 'removed' ? '−' : ' '}</span>{block.text}
    </p>)}</div>
    {editable && <button className="mini" type="button" onClick={() => setEditing((v) => !v)}>{editing ? '편집 닫기' : '반영할 내용 직접 수정'}</button>}
    {editing && <textarea rows={12} value={after} onChange={(e) => onChange(e.target.value)} aria-label="반영할 노트 전체" />}
    <small>승인 시점의 노트 버전(SHA)과 지금 노트가 다르면 쓰지 않고 다시 제안받게 돼.</small>
  </div>;
}

function HistoryRow({ approval }: { approval: Approval }) {
  const [events, setEvents] = useState<ApprovalEvent[] | null>(null);
  return <li className={styles.item}>
    <div><b>{APPROVAL_LABEL[approval.kind]} · {approval.title}</b><small>{STATE_LABEL[approval.state]}{approval.error ? ` · ${approval.error}` : ''} · {new Date(approval.created_at).toLocaleString('ko-KR')}</small>
      {events && <ol className={styles.events}>{events.map((e) => <li key={e.id}>{new Date(e.created_at).toLocaleString('ko-KR')} · {e.event}{e.detail ? ` · ${e.detail.slice(0, 120)}` : ''}</li>)}</ol>}</div>
    <div className={styles.actions}><button className="mini" type="button" onClick={() => events ? setEvents(null) : void mtosApi.approvalEvents(approval.id).then((r) => setEvents(r.events)).catch(() => setEvents([]))}>{events ? '접기' : '기록'}</button></div>
  </li>;
}

function MailSenders() {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { void mtosApi.mailSenders().then((r) => setValue(r.senders.join('\n'))).catch(() => undefined); }, []);
  return <details className="card section section-gap">
    <summary>메일 수집 대상 발신자</summary>
    <p className={styles.note}>여기에 적은 주소나 도메인(예: 지도교수 주소, 대학원 도메인)의 메일만 수집해. 비워두면 아무 메일도 가져오지 않아.</p>
    <textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} aria-label="발신자 목록 (줄마다 하나)" placeholder={'prof@univ.ac.jp\ngrad.univ.ac.jp'} />
    <button className="mini" type="button" onClick={() => void mtosApi.setMailSenders(value.split(/\s+/).filter(Boolean)).then((r) => { setValue(r.senders.join('\n')); setMessage(`${r.senders.length}개 저장했어.`); }).catch((e) => setMessage(agentErrorText(e, '저장하지 못했어.')))}>저장</button>
    {message && <p className={styles.note}>{message}</p>}
  </details>;
}
