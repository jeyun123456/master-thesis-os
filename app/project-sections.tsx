'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { agentErrorText, mtosApi, type Memo } from '@/lib/mtos-client';
import { projectTaskBuckets, type Milestone, type TaskMeta } from '@/lib/mtos-planning';
import { createP0Task, type P0Task } from '@/lib/p0-tasks-client';
import { p0TodayInTokyo } from '@/lib/p0-home';
import styles from './project-sections.module.css';

type LoadState = 'loading' | 'ready' | 'error';

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return <section className={`card section ${styles.section}`}><div className="head"><h3>{title}</h3><span>{right}</span></div>{children}</section>;
}

/** 1. Project tasks from P0 (linked by project_id). */
export function ProjectTasksSection({ projectId, tasks, tasksState, tasksError, meta, onChanged, onOpenTask }: {
  projectId: string; tasks: P0Task[]; tasksState: LoadState; tasksError: string; meta: Map<string, TaskMeta>; onChanged: () => void; onOpenTask: (taskId: string) => void;
}) {
  const today = p0TodayInTokyo();
  const buckets = projectTaskBuckets(projectId, tasks, today);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    const id = crypto.randomUUID();
    try {
      await createP0Task({ id, op_id: `mtos-project-create-${id}`, fields: { title: title.trim(), due_date: due || null, category: 'research', project_id: projectId, status: 'open', is_today: false } });
      setTitle('');
      setDue('');
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '할 일을 저장하지 못했어.');
    } finally {
      setBusy(false);
    }
  }

  const row = (task: P0Task) => {
    const m = meta.get(task.id);
    const overdue = task.status === 'open' && task.due_date && task.due_date < today;
    return <li key={task.id} className={styles.taskRow}>
      <span aria-hidden="true">{task.status === 'done' ? '✓' : m?.blocked_reason ? '⛔' : '○'}</span>
      <button type="button" onClick={() => onOpenTask(task.id)}>
        <b>{task.status === 'done' ? <s>{task.title}</s> : task.title}</b>
        <small className={overdue ? styles.overdue : ''}>{[task.due_date ?? '기한 없음', m?.blocked_reason ? `막힘: ${m.blocked_reason}` : '', m?.ai_generated ? 'AI 생성' : '', task.is_new ? '새 항목' : ''].filter(Boolean).join(' · ')}</small>
      </button>
    </li>;
  };

  return <Section title="프로젝트 할 일" right={tasksState === 'ready' ? `미완료 ${buckets.open.length} · 임박 ${buckets.dueSoon.length}` : 'P0'}>
    <form className={styles.inlineForm} onSubmit={(event) => void add(event)}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} placeholder="이 프로젝트의 다음 행동" aria-label="새 프로젝트 할 일" />
      <input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="기한" />
      <button className="mini primary" type="submit" disabled={busy || !title.trim()}>{busy ? '저장 중…' : '추가'}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {tasksState === 'loading' && <div className="empty compact-empty">P0 할 일을 불러오는 중…</div>}
    {tasksState === 'error' && <div className="error" role="alert">P0 연결 오류: {tasksError} (0건이 아니라 불러오지 못한 상태야)</div>}
    {tasksState === 'ready' && <>
      {buckets.dueSoon.length > 0 && <><h4 className={styles.subhead}>기한 임박 (7일 이내·지남)</h4><ul className={styles.list}>{buckets.dueSoon.map(row)}</ul></>}
      <h4 className={styles.subhead}>미완료</h4>
      {buckets.open.length ? <ul className={styles.list}>{buckets.open.filter((t) => !buckets.dueSoon.includes(t)).map(row)}</ul> : <div className="empty compact-empty">이 프로젝트에 연결된 미완료 할 일이 없어 (실제 0건).</div>}
      <button className="mini" type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>완료 {buckets.done.length}개 {showDone ? '접기' : '보기'}</button>
      {showDone && <ul className={styles.list}>{buckets.done.map(row)}</ul>}
    </>}
  </Section>;
}

const STATUS_LABEL: Record<Milestone['status'], string> = { planned: '예정', done: '완료', missed: '놓침', cancelled: '취소' };

/** 3. Milestones: official deadlines vs internal goals, with history. */
export function MilestonesSection({ projectId, milestones, agentState, agentError, onChanged }: {
  projectId: string; milestones: Milestone[]; agentState: LoadState; agentError: string; onChanged: () => void;
}) {
  const items = milestones.filter((m) => m.project_id === projectId);
  const [draft, setDraft] = useState({ title: '', date: '', kind: 'internal' as Milestone['kind'], source: '', evidence_url: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ version: number; actor: string; before: Record<string, unknown>; changes: Record<string, unknown>; created_at: string }>>([]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (reason) {
      setError(agentErrorText(reason, '마일스톤을 저장하지 못했어.'));
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await mtosApi.createMilestone({ id: crypto.randomUUID(), project_id: projectId, title: draft.title, date: draft.date, kind: draft.kind, source: draft.source, evidence_url: draft.evidence_url || null });
      setDraft({ title: '', date: '', kind: 'internal', source: '', evidence_url: '' });
    });
  }

  async function changeDate(m: Milestone) {
    const next = window.prompt(m.kind === 'official'
      ? `공식 마감일이야. 학교 공지 등 근거가 바뀐 경우에만 수정해.\n새 날짜(YYYY-MM-DD):` : '새 날짜(YYYY-MM-DD):', m.date);
    if (!next || next === m.date) return;
    if (m.kind === 'official' && !window.confirm(`공식 마감일을 ${m.date} → ${next}로 바꿀까? 변경 이력에 남아.`)) return;
    await run(() => mtosApi.updateMilestone(m.id, { base_version: m.version, changes: { date: next }, confirm_official: m.kind === 'official' }));
  }

  async function showHistory(id: string) {
    if (historyFor === id) { setHistoryFor(null); return; }
    try {
      setHistory((await mtosApi.milestoneHistory(id)).history);
      setHistoryFor(id);
    } catch (reason) {
      setError(agentErrorText(reason, '이력을 읽지 못했어.'));
    }
  }

  return <Section title="마일스톤" right={agentState === 'ready' ? `${items.length}개` : ''}>
    {agentState === 'error' && <div className="error" role="alert">{agentError}</div>}
    {agentState === 'ready' && <>
      {items.length ? <ul className={styles.list}>{items.map((m) => <li key={m.id} className={styles.milestone}>
        <span className={m.kind === 'official' ? styles.official : styles.internal}>{m.kind === 'official' ? '공식 마감' : '내부 목표'}</span>
        <div>
          <b>{m.title}</b>
          <small>{m.date} · {STATUS_LABEL[m.status]}{m.source ? ` · 근거: ${m.source}` : ''}{m.evidence_url ? ' · ' : ''}{m.evidence_url && <a href={m.evidence_url} target="_blank" rel="noreferrer">원문</a>}</small>
          {historyFor === m.id && <ol className={styles.history}>{history.map((h) => <li key={h.version}>v{h.version} · {h.actor} · {new Date(h.created_at).toLocaleString('ko-KR')} · {Object.entries(h.changes).map(([k, v]) => `${k}: ${String(h.before[k] ?? '–')} → ${String(v)}`).join(', ')}</li>)}</ol>}
        </div>
        <div className={styles.rowActions}>
          <select aria-label={`${m.title} 상태`} value={m.status} disabled={busy} onChange={(event) => void run(() => mtosApi.updateMilestone(m.id, { base_version: m.version, changes: { status: event.target.value as Milestone['status'] } }))}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button className="mini" type="button" disabled={busy} onClick={() => void changeDate(m)}>날짜</button>
          <button className="mini" type="button" onClick={() => void showHistory(m.id)}>이력</button>
          {m.kind === 'internal' && <button className="mini" type="button" disabled={busy} onClick={() => window.confirm('이 내부 목표를 삭제할까?') && void run(() => mtosApi.deleteMilestone(m.id))}>삭제</button>}
        </div>
      </li>)}</ul> : <div className="empty compact-empty">등록된 마일스톤이 없어.</div>}
      <form className={styles.milestoneForm} onSubmit={(event) => void add(event)}>
        <input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="마일스톤 이름" aria-label="마일스톤 이름" />
        <input required type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="날짜" />
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Milestone['kind'] })} aria-label="종류">
          <option value="internal">내부 목표</option><option value="official">학교 공식 마감</option>
        </select>
        <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder={draft.kind === 'official' ? '근거 (필수: 공지명 등)' : '근거·메모 (선택)'} aria-label="근거" />
        <input type="url" value={draft.evidence_url} onChange={(e) => setDraft({ ...draft, evidence_url: e.target.value })} placeholder="원문 링크 (선택)" aria-label="원문 링크" />
        <button className="mini primary" type="submit" disabled={busy}>추가</button>
      </form>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </Section>;
}

const MEMO_KIND: Record<Memo['kind'], string> = { task: '실행할 일', note: '메모·아이디어', reference: '자료·링크', archive: '보관' };
const OBSIDIAN_STATE: Record<Memo['obsidian_state'], string> = { none: 'DB에만 저장', proposed: 'Obsidian 반영 승인 대기', pending_retry: 'Obsidian 반영 재시도 필요', synced: 'Obsidian 반영 완료' };

/** 5. Research memos (DB first; Obsidian only through an approved proposal). */
export function MemosSection({ projectId, onConvertToTask }: { projectId: string | null; onConvertToTask?: (memo: Memo) => void }) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<Memo['kind']>('note');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      setMemos((await mtosApi.memos(projectId)).memos);
      setState('ready');
    } catch (reason) {
      setError(agentErrorText(reason, '메모를 읽지 못했어.'));
      setState('error');
    }
  }
  useEffect(() => { setState('loading'); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await mtosApi.createMemo({ id: crypto.randomUUID(), kind, body: body.trim(), project_id: projectId, source_url: link.trim() || null });
      setBody('');
      setLink('');
      await load();
    } catch (reason) {
      setError(agentErrorText(reason, '메모를 저장하지 못했어. 입력은 그대로 남겨둘게.'));
    } finally {
      setBusy(false);
    }
  }

  async function proposeObsidian(memo: Memo) {
    const fallback = projectId ? `projects/${projectId}/memos.md` : 'shared/inbox-memos.md';
    const path = window.prompt('반영할 Obsidian 노트 경로 (Vault 기준 .md)', memo.obsidian_path ?? fallback);
    if (!path) return;
    const mode = window.prompt('반영 방식: append(끝에 추가) / section(AI가 알맞은 부분 수정) / new(새 노트)', 'append');
    if (!mode || !['append', 'section', 'new'].includes(mode)) return;
    setNotice('노트를 읽고 반영 제안을 만드는 중…');
    try {
      const response = await fetch('/api/obsidian/propose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memo_id: memo.id, path, mode }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '제안을 만들지 못했어.');
      setNotice('제안을 만들고 있어. AI 인박스의 승인 대기에서 변경 전·후를 비교하고 승인해줘. 승인 전에는 Obsidian이 바뀌지 않아.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '제안을 만들지 못했어.');
    }
  }

  return <Section title={projectId ? '연구 메모·자료' : '메모'} right={state === 'ready' ? `${memos.length}개` : ''}>
    <form className={styles.memoForm} onSubmit={(event) => void add(event)}>
      <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="떠오른 생각, 참고자료, 해야 할 일을 적어둬" aria-label="새 메모" />
      <div className={styles.inlineForm}>
        <select value={kind} onChange={(e) => setKind(e.target.value as Memo['kind'])} aria-label="메모 유형">{Object.entries(MEMO_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="원본 링크 (선택)" aria-label="원본 링크" />
        <button className="mini primary" type="submit" disabled={busy || !body.trim()}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {state === 'loading' && <div className="empty compact-empty">메모를 불러오는 중…</div>}
    {state === 'ready' && (memos.length ? <ul className={styles.list}>{memos.map((memo) => <li key={memo.id} className={styles.memo}>
      <span className={styles.kind}>{MEMO_KIND[memo.kind]}</span>
      <div>
        <p>{memo.body}</p>
        <small>{new Date(memo.created_at).toLocaleString('ko-KR')} · {OBSIDIAN_STATE[memo.obsidian_state]}{memo.source_url && <> · <a href={memo.source_url} target="_blank" rel="noreferrer">원본</a></>}</small>
      </div>
      <div className={styles.rowActions}>
        {memo.kind === 'task' && onConvertToTask && <button className="mini" type="button" onClick={() => onConvertToTask(memo)}>할 일로 등록</button>}
        <button className="mini" type="button" onClick={() => void proposeObsidian(memo)}>Obsidian에 저장</button>
        <button className="mini" type="button" onClick={() => window.confirm('메모를 보관함에서 지울까? (DB 기록은 남아)') && void mtosApi.deleteMemo(memo.id).then(load)}>삭제</button>
      </div>
    </li>)}</ul> : <div className="empty compact-empty">아직 메모가 없어.</div>)}
  </Section>;
}

/** 4. Blockers: project.md "막힌 부분" plus P0 tasks of this project marked blocked or snoozed. */
export function BlockersSection({ projectId, manifestBlocked, tasks, meta }: { projectId: string; manifestBlocked: string[]; tasks: P0Task[]; meta: Map<string, TaskMeta> }) {
  const today = p0TodayInTokyo();
  const blockedTasks = tasks.filter((t) => t.project_id === projectId && t.status === 'open' && (meta.get(t.id)?.blocked_reason || (meta.get(t.id)?.snooze_until ?? '') > today));
  return <Section title="막힘 요소 · 해결 대기" right={`${manifestBlocked.length + blockedTasks.length}건`}>
    {!manifestBlocked.length && !blockedTasks.length && <div className="empty compact-empty">막힌 항목이 없어.</div>}
    {manifestBlocked.length > 0 && <><h4 className={styles.subhead}>project.md 막힌 부분</h4><ul className={styles.plain}>{manifestBlocked.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
    {blockedTasks.length > 0 && <><h4 className={styles.subhead}>막힌·미룬 할 일</h4><ul className={styles.plain}>{blockedTasks.map((t) => {
      const m = meta.get(t.id);
      return <li key={t.id}><b>{t.title}</b> — {m?.blocked_reason ? `막힘: ${m.blocked_reason}` : ''}{m?.snooze_until && m.snooze_until > today ? ` · ${m.snooze_until}에 다시 표시` : ''}</li>;
    })}</ul></>}
    <p className={styles.hint}>할 일의 막힘 기록·다시 보기 날짜는 홈의 할 일 상세에서 관리해. 기존 기록은 지워지지 않아.</p>
  </Section>;
}

