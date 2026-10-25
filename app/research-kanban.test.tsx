import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { P0Task } from '@/lib/p0-tasks-client';
import type { ResearchProject } from '@/lib/projects';
import { initialKanbanState, kanbanStage, ResearchKanban } from './research-kanban';

const project = (id: string, stage: string, status = 'active', extra: Partial<ResearchProject> = {}): ResearchProject => ({
  id, title: `${id} 프로젝트`, status, priority: 'medium', stage, updated: '', sourcePath: `projects/${id}/project.md`, summary: '', currentFocus: '',
  questions: [], keyFiles: [], nextTasks: [], blocked: [], relatedPaths: [], resultPaths: [], ...extra,
});
const task = (id: string, extra: Partial<P0Task> = {}): P0Task => ({
  id, title: id, status: 'open', due_date: null, is_today: false, category: 'research', project_id: 'thesis', memo: '', source_url: null,
  version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '', completed_at: null, deleted: false, ...extra,
});

function render(props: Partial<React.ComponentProps<typeof ResearchKanban>>) {
  return renderToStaticMarkup(<ResearchKanban projects={[]} tasks={[]} tasksState="ready" meta={new Map()} milestones={[]} view={initialKanbanState}
    onViewChange={() => {}} onSelect={() => {}} {...props} />);
}

describe('ResearchKanban', () => {
  it('puts projects without a stage in their own column instead of planning', () => {
    expect(kanbanStage(project('a', 'unknown'))).toBe('unknown');
    expect(kanbanStage(project('b', ''))).toBe('unknown');
    expect(kanbanStage(project('c', 'labour'))).toBe('analysis');
    const html = render({ projects: [project('a', '')] });
    expect(html).toContain('단계 미확인');
    for (const label of ['기획', '자료 수집', '분석', '해석', '집필', '완료']) expect(html).toContain(label);
  });

  it('shows next task, remaining count and nearest deadline from P0', () => {
    const html = render({
      projects: [project('thesis', 'analysis')],
      tasks: [task('t1', { title: '회귀 돌리기', due_date: '2026-11-02' }), task('t2', { title: '그림 정리', due_date: '2026-11-20' }), task('t3', { status: 'done' })],
    });
    expect(html).toContain('회귀 돌리기');
    expect(html).toMatch(/남은 할 일 <b>2<\/b>/);
    expect(html).toContain('2026-11-02');
  });

  it('keeps project status separate from the stage', () => {
    const html = render({ projects: [project('thesis', 'writing', 'blocked')] });
    expect(html).toContain('집필');
    expect(html).toContain('막힘');
  });

  it('says the P0 connection failed rather than showing zero', () => {
    const html = render({ projects: [project('thesis', 'analysis')], tasksState: 'error' });
    expect(html).toContain('연결 오류');
    expect(html).not.toMatch(/남은 할 일 <b>0<\/b>/);
  });
});
