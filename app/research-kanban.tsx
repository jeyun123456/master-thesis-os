'use client';

import { useMemo, useState } from 'react';
import { pipelineStageValue, projectStatusLabel, researchPipelineStages, type ResearchProject } from '@/lib/projects';
import styles from './research-kanban.module.css';

export function ResearchKanban({ projects, onSelect }: { projects: ResearchProject[]; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const visible = useMemo(() => projects.filter((project) => {
    if (filter === 'all') return true;
    if (filter === 'paused') return ['paused', 'waiting', 'blocked'].includes(project.status);
    return !['paused', 'waiting', 'blocked', 'complete'].includes(project.status);
  }), [projects, filter]);

  return <div className={styles.root}>
    <div className={styles.toolbar}>
      <div><h3>연구 프로젝트 보드</h3><p>연구 단계를 한눈에 보고, 카드를 눌러 기존 프로젝트 작업공간으로 이동해.</p></div>
      <div className={styles.filters} role="group" aria-label="프로젝트 상태 필터">
        <button type="button" className={filter === 'all' ? styles.active : ''} onClick={() => setFilter('all')}>전체 {projects.length}</button>
        <button type="button" className={filter === 'active' ? styles.active : ''} onClick={() => setFilter('active')}>진행 중</button>
        <button type="button" className={filter === 'paused' ? styles.active : ''} onClick={() => setFilter('paused')}>대기·보류</button>
      </div>
    </div>
    <div className={styles.board} aria-label="연구 단계별 프로젝트">
      {researchPipelineStages.map((stage) => {
        const entries = visible.filter((project) => pipelineStageValue(project.stage) === stage.value);
        return <section className={styles.column} key={stage.value} aria-label={stage.label}>
          <header className={styles.columnHeading}><h4>{stage.label}</h4><span>{entries.length}</span></header>
          <div className={styles.cards}>
            {entries.map((project) => <button className={styles.card} key={project.id} type="button" onClick={() => onSelect(project.id)} aria-label={`${project.title} 상세 열기`}>
              <span className={styles.status}>{projectStatusLabel(project.status)}</span>
              <strong>{project.title}</strong>
              {project.currentFocus && <p>{project.currentFocus}</p>}
              {!project.currentFocus && project.summary && <p>{project.summary}</p>}
              {project.nextTasks.length > 0 && <div className={styles.next}><span>다음 작업</span>{project.nextTasks.slice(0, 2).map((task, i) => <small key={i}>· {task}</small>)}</div>}
            </button>)}
            {!entries.length && <p className={styles.empty}>해당 단계에 프로젝트가 없어.</p>}
          </div>
        </section>;
      })}
    </div>
    <p className={styles.footnote}>연구 단계는 project.md에 저장된 값을 읽어 표시해. 프로젝트 상태(진행·보류)와 연구 단계(기획·분석·집필)는 별도로 관리해.</p>
  </div>;
}
