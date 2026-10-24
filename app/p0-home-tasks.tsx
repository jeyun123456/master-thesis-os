'use client';

import { useCallback, useEffect, useState } from 'react';
import { getP0Session, listP0Tasks, type P0Task } from '@/lib/p0-tasks-client';

const categoryLabels = { research: '연구', school: '학교', personal: '개인' } as const;
type HomeState = 'loading' | 'ready' | 'empty' | 'login' | 'unconfigured' | 'error';

export function P0HomeTasks({ onOpenPlanner }: { onOpenPlanner: () => void }) {
  const [state, setState] = useState<HomeState>('loading');
  const [tasks, setTasks] = useState<P0Task[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const session = await getP0Session();
      if (!session.configured) { setState('unconfigured'); return; }
      if (!session.authenticated) { setState('login'); return; }
      const result = await listP0Tasks();
      const active = result.tasks.filter((task) => !task.deleted && task.status === 'open').sort((left, right) =>
        Number(right.is_today) - Number(left.is_today)
        || (left.due_date || '9999-99-99').localeCompare(right.due_date || '9999-99-99')
        || Date.parse(left.created_at) - Date.parse(right.created_at));
      setTasks(active.slice(0, 4));
      setState(active.length ? 'ready' : 'empty');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'P0 할 일을 읽지 못했어.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <section className="card section home-attention-card p0-home-card" aria-labelledby="p0-home-title">
    <div className="head"><div><h3 id="p0-home-title">오늘 집중할 일</h3><small>P0 SQLite 기준</small></div><button className="mini" type="button" disabled={state === 'loading'} onClick={() => void load()}>새로고침</button></div>
    {state === 'loading' && <div className="home-attention-state">P0 할 일을 확인하는 중…</div>}
    {state === 'unconfigured' && <div className="home-attention-state">P0 Google 로그인 설정이 필요해.</div>}
    {state === 'login' && <div className="home-attention-state">P0에 연결하면 오늘 할 일과 기한 순서를 여기서 볼 수 있어.</div>}
    {state === 'error' && <div className="home-attention-state home-attention-error">{error}</div>}
    {state === 'empty' && <div className="empty compact-empty">미완료 P0 할 일이 없어. 드문 일이네.</div>}
    {state === 'ready' && <div className="p0-home-list">{tasks.map((task) => <div className="p0-home-task" key={task.id}><span className={task.is_today ? 'p0-home-focus' : 'p0-home-dot'}>{task.is_today ? '오늘' : '·'}</span><b>{task.title}</b><small>{categoryLabels[task.category]}{task.due_date ? ` · ${task.due_date}` : ''}</small></div>)}</div>}
    <div className="home-attention-actions"><button className="mini" type="button" onClick={onOpenPlanner}>Planner에서 할 일 관리</button></div>
  </section>;
}
