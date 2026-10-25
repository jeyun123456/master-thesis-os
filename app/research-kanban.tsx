'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { summarizeProject, type Milestone, type TaskMeta } from '@/lib/mtos-planning';
import type { P0Task } from '@/lib/p0-tasks-client';
import { pipelineStageValue, projectStatusLabel, researchPipelineStages, type ResearchProject } from '@/lib/projects';
import styles from './research-kanban.module.css';

export type KanbanFilter = 'all' | 'active' | 'paused';
export type KanbanViewState = { filter: KanbanFilter; boardScrollLeft: number; pageScrollY: number };
export const initialKanbanState: KanbanViewState = { filter: 'all', boardScrollLeft: 0, pageScrollY: 0 };

const PAUSED = ['paused', 'waiting', 'blocked', '대기', '막힘'];
const UNKNOWN = ['', 'unknown', '미확인', '미지정'];

/** Stage and status are separate fields: an unknown stage goes to its own column, never to "기획". */
export function kanbanStage(project: ResearchProject) {
  return UNKNOWN.includes(project.stage.trim().toLowerCase()) ? 'unknown' : pipelineStageValue(project.stage);
}

export function ResearchKanban({ projects, tasks, tasksState, meta, milestones, view, onViewChange, onSelect }: {
  projects: ResearchProject[];
  tasks: P0Task[];
  tasksState: 'loading' | 'ready' | 'error';
  meta: Map<string, TaskMeta>;
  milestones: Milestone[];
  view: KanbanViewState;
  onViewChange: (next: KanbanViewState) => void;
  onSelect: (id: string, view: KanbanViewState) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => projects.filter((project) => {
    if (view.filter === 'all') return true;
    if (view.filter === 'paused') return PAUSED.includes(project.status);
    return !PAUSED.includes(project.status) && !['complete', '완료'].includes(project.status);
  }), [projects, view.filter]);
  const columns = visible.some((p) => kanbanStage(p) === 'unknown') ? [...researchPipelineStages, { value: 'unknown', label: '단계 미확인' }] : [...researchPipelineStages];

  // Restore where the user was before opening a project.
  useLayoutEffect(() => {
    if (board.current) board.current.scrollLeft = view.boardScrollLeft;
    window.scrollTo({ top: view.pageScrollY });
    // Only on mount: later scrolling is the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(id: string) {
    onSelect(id, { ...view, boardScrollLeft: board.current?.scrollLeft ?? 0, pageScrollY: window.scrollY });
  }

  return <div className={styles.root}>
    <div className={styles.toolbar}>
      <div><h3>연구 프로젝트 보드</h3><p>단계별로 보고, 카드를 눌러 프로젝트 상세로 이동해.</p></div>
      <div className={styles.filters} role="group" aria-label="프로젝트 상태 필터">
        {([['all', `전체 ${projects.length}`], ['active', '진행 중'], ['paused', '대기·보류·막힘']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={view.filter === value} className={view.filter === value ? styles.active : ''} onClick={() => onViewChange({ ...view, filter: value })}>{label}</button>
        ))}
      </div>
    </div>
    {tasksState === 'error' && <p className={styles.warning} role="status">P0 할 일에 연결하지 못해 카드의 할 일 수를 표시할 수 없어. 0건이 아니라 연결 오류야.</p>}
    <div className={styles.board} ref={board} style={{ ['--columns' as string]: columns.length }} aria-label="연구 단계별 프로젝트">
      {columns.map((stage) => {
        const entries = visible.filter((project) => kanbanStage(project) === stage.value);
        return <section className={styles.column} key={stage.value} aria-label={stage.label}>
          <header className={styles.columnHeading}><h4>{stage.label}</h4><span>{entries.length}</span></header>
          <div className={styles.cards}>
            {entries.map((project) => {
              const summary = summarizeProject(project.id, tasks, milestones, meta);
              return <button className={styles.card} key={project.id} type="button" onClick={() => open(project.id)} aria-label={`${project.title} 상세 열기`}>
                <span className={styles.badges}>
                  <span className={styles.stage}>{stage.label}</span>
                  <span className={`${styles.status} ${PAUSED.includes(project.status) ? styles.statusPaused : ''}`}>{projectStatusLabel(project.status)}</span>
                </span>
                <strong>{project.title}</strong>
                <span className={styles.next}>
                  <small>다음 실행</small>
                  {tasksState === 'ready'
                    ? <b>{summary.nextTask?.title ?? (project.nextTasks[0] ? `project.md: ${project.nextTasks[0]}` : '연결된 할 일 없음')}</b>
                    : <b>{tasksState === 'loading' ? '불러오는 중…' : '확인 불가'}</b>}
                </span>
                <span className={styles.metrics}>
                  <span>남은 할 일 <b>{tasksState === 'ready' ? summary.remaining : '–'}</b></span>
                  <span>가까운 마감 <b>{summary.nearestDue ? `${summary.nearestDue.date}${summary.nearestDue.kind === 'official' ? ' · 공식' : ''}` : '없음'}</b></span>
                </span>
              </button>;
            })}
            {!entries.length && <p className={styles.empty}>해당 단계에 프로젝트가 없어.</p>}
          </div>
        </section>;
      })}
    </div>
    <p className={styles.footnote}>단계는 project.md의 stage, 상태는 status 값이야. 할 일 수와 다음 실행은 P0 할 일 중 이 프로젝트에 연결된 것만 집계해.</p>
  </div>;
}
