'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { searchKeyAction } from '@/lib/ime';
import { agentErrorText, mtosApi, type Approval, type AgentSearch } from '@/lib/mtos-client';
import { localSearch } from '@/lib/mtos-planning';
import type { P0Task } from '@/lib/p0-tasks-client';
import type { ResearchProject } from '@/lib/projects';
import styles from './global-search.module.css';

export type SearchTarget =
  | { kind: 'task'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'inbox' };

/**
 * Collapsed by default. Searches P0 tasks and projects locally, and memos,
 * milestones and inbox items on the agent. If the agent is unreachable it
 * says so instead of showing an empty result.
 */
export function GlobalSearch({ tasks, projects, onNavigate }: { tasks: P0Task[]; projects: ResearchProject[]; onNavigate: (target: SearchTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [remote, setRemote] = useState<AgentSearch | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSubmitted(q);
    setBusy(true);
    setRemoteError('');
    try {
      setRemote(await mtosApi.search(q));
    } catch (error) {
      setRemote(null);
      setRemoteError(agentErrorText(error, '메모·인박스 검색을 할 수 없어.'));
    } finally {
      setBusy(false);
    }
  }

  const local = submitted ? localSearch(submitted, tasks, projects) : { tasks: [], projects: [] };
  const projectTitle = (id: string | null) => projects.find((p) => p.id === id)?.title ?? id ?? '';
  const go = (target: SearchTarget) => { onNavigate(target); setOpen(false); };
  const links = [
    ...local.tasks.filter((t) => t.source_url).map((t) => ({ key: `t${t.id}`, url: t.source_url as string, label: t.title })),
    ...(remote?.memos ?? []).filter((m) => m.source_url).map((m) => ({ key: `m${m.id}`, url: m.source_url as string, label: m.body.slice(0, 60) })),
    ...(remote?.inbox ?? []).filter((i) => i.source_url).map((i) => ({ key: `i${i.id}`, url: i.source_url as string, label: i.raw_text.slice(0, 60) })),
  ];
  const total = local.tasks.length + local.projects.length + (remote ? remote.memos.length + remote.milestones.length + remote.inbox.length : 0);

  if (!open) return <button className="mini" type="button" aria-label="전체 검색 열기" onClick={() => setOpen(true)}>⌕ 검색</button>;
  return <div className={styles.root} role="search">
    <form className={styles.bar} onSubmit={(event) => void search(event)}>
      <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="할 일·프로젝트·메모·인박스 검색" aria-label="전체 검색어"
        onKeyDown={(e) => {
          // Korean/Japanese IME: Enter/Escape while composing must not submit or close.
          const action = searchKeyAction(e.key, e.nativeEvent.isComposing || e.keyCode === 229);
          if (action === 'ignore' && (e.key === 'Enter' || e.key === 'Escape')) e.preventDefault();
          if (action === 'clear') setOpen(false);
        }} />
      <button className="mini primary" type="submit" disabled={busy || !query.trim()}>{busy ? '검색 중…' : '검색'}</button>
      <button className="mini" type="button" onClick={() => setOpen(false)}>닫기</button>
    </form>
    {submitted && <div className={styles.results}>
      {remoteError && <p className={styles.warn}>메모·마일스톤·인박스는 검색하지 못했어: {remoteError}</p>}
      {!total && !remoteError && !busy && <p className={styles.empty}>“{submitted}”에 맞는 결과가 없어.</p>}
      {local.tasks.length > 0 && <Group title="할 일">{local.tasks.map((t) => <button key={t.id} type="button" onClick={() => go({ kind: 'task', id: t.id })}><b>{t.title}</b><small>{t.status === 'done' ? '완료' : '미완료'}{t.due_date ? ` · ${t.due_date}` : ''}{t.project_id ? ` · ${projectTitle(t.project_id)}` : ''}</small></button>)}</Group>}
      {local.projects.length > 0 && <Group title="연구 프로젝트">{local.projects.map((p) => <button key={p.id} type="button" onClick={() => go({ kind: 'project', id: p.id })}><b>{p.title}</b><small>{p.id}</small></button>)}</Group>}
      {remote && remote.memos.length > 0 && <Group title="연구 메모">{remote.memos.map((m) => <button key={m.id} type="button" onClick={() => go(m.project_id ? { kind: 'project', id: m.project_id } : { kind: 'inbox' })}><b>{m.body.slice(0, 80)}</b><small>{m.project_id ? projectTitle(m.project_id) : '프로젝트 없음'}</small></button>)}</Group>}
      {remote && remote.milestones.length > 0 && <Group title="마일스톤">{remote.milestones.map((m) => <button key={m.id} type="button" onClick={() => go({ kind: 'project', id: m.project_id })}><b>{m.title}</b><small>{m.date} · {m.kind === 'official' ? '공식 마감' : '내부 목표'} · {projectTitle(m.project_id)}</small></button>)}</Group>}
      {remote && remote.inbox.length > 0 && <Group title="AI 인박스">{remote.inbox.map((i) => <button key={i.id} type="button" onClick={() => go({ kind: 'inbox' })}><b>{i.raw_text.slice(0, 80)}</b><small>{new Date(i.received_at).toLocaleDateString('ko-KR')}</small></button>)}</Group>}
      {links.length > 0 && <Group title="원본 링크">{links.map((l) => <a key={l.key} href={l.url} target="_blank" rel="noreferrer"><b>{l.label}</b><small>{l.url}</small></a>)}</Group>}
    </div>}
  </div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={styles.group}><h4>{title}</h4>{children}</section>;
}

/** Home banner: only approvals that are urgent (official deadline ≤ 3 days, blocking today, data-loss risk). */
export function UrgentApprovals({ today, onOpenInbox }: { today: string; onOpenInbox: () => void }) {
  const [items, setItems] = useState<Approval[]>([]);
  useEffect(() => { void mtosApi.urgentApprovals(today).then((r) => setItems(r.approvals)).catch(() => setItems([])); }, [today]);
  if (!items.length) return null;
  return <div className={styles.urgent} role="alert">
    <b>긴급 승인 {items.length}건</b>
    <span>{items.slice(0, 2).map((a) => `${a.title}${a.official_deadline ? ` (공식 마감 ${a.official_deadline})` : a.data_loss_risk ? ' (데이터 손실 위험)' : ' (오늘 작업 막힘)'}`).join(' · ')}</span>
    <button className="mini" type="button" onClick={onOpenInbox}>AI 인박스에서 확인</button>
  </div>;
}
