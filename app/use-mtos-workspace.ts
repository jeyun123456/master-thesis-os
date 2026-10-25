'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { agentErrorText, applyAutoPending, mtosApi } from '@/lib/mtos-client';
import type { Milestone, TaskMeta } from '@/lib/mtos-planning';
import { listP0Tasks, type P0Task } from '@/lib/p0-tasks-client';
import type { ResearchProject } from '@/lib/projects';

export type LoadState = 'loading' | 'ready' | 'error';

/**
 * Shared P0 + agent data for the research board, project detail, search and
 * the AI inbox. P0 and agent load independently: an agent outage only shows a
 * notice and never hides P0 tasks.
 */
export function useMtosWorkspace(projects: ResearchProject[], onNotice: (message: string) => void) {
  const [tasks, setTasks] = useState<P0Task[]>([]);
  const [tasksState, setTasksState] = useState<LoadState>('loading');
  const [tasksError, setTasksError] = useState('');
  const [meta, setMeta] = useState<Map<string, TaskMeta>>(new Map());
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [agentState, setAgentState] = useState<LoadState>('loading');
  const [agentError, setAgentError] = useState('');
  const [taskReloadSignal, setTaskReloadSignal] = useState(0);
  const autoApplied = useRef(false);

  const reloadTasks = useCallback(async () => {
    try {
      const result = await listP0Tasks();
      setTasks(result.tasks.filter((task) => !task.deleted));
      setTasksState('ready');
      setTasksError('');
      return result.tasks;
    } catch (error) {
      setTasksState('error');
      setTasksError(error instanceof Error ? error.message : 'P0 할 일을 읽지 못했어.');
      return null;
    }
  }, []);

  const reloadAgent = useCallback(async () => {
    try {
      const [metaResult, milestoneResult] = await Promise.all([mtosApi.taskMeta(), mtosApi.milestones()]);
      setMeta(new Map(metaResult.meta.map((m) => [m.task_id, m])));
      setMilestones(milestoneResult.milestones);
      setAgentState('ready');
      setAgentError('');
    } catch (error) {
      setAgentState('error');
      setAgentError(agentErrorText(error, 'AI·연구 데이터 서버를 읽지 못했어.'));
    }
  }, []);

  const reload = useCallback(async () => {
    await Promise.all([reloadTasks(), reloadAgent()]);
  }, [reloadAgent, reloadTasks]);

  useEffect(() => { void reload(); }, [reload]);

  // Keep the agent's snapshot fresh so scheduled classification can match projects and spot duplicates.
  useEffect(() => {
    if (tasksState !== 'ready' || agentState !== 'ready') return;
    const timer = window.setTimeout(() => {
      void mtosApi.pushContext({
        projects: projects.map((p) => ({ id: p.id, title: p.title, stage: p.stage })),
        tasks: tasks.map(({ id, title, project_id, due_date, status }) => ({ id, title, project_id, due_date, status })),
      }).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [agentState, projects, tasks, tasksState]);

  // Create clear AI-classified tasks once per page load, using this session.
  useEffect(() => {
    if (autoApplied.current || tasksState !== 'ready' || agentState !== 'ready') return;
    autoApplied.current = true;
    void (async () => {
      try {
        const { items } = await mtosApi.inbox('auto_pending');
        if (!items.length) return;
        const { created, errors } = await applyAutoPending(items, projects.map((p) => p.id));
        if (created.length) {
          onNotice(`AI가 할 일 ${created.length}개를 새로 추가했어. AI 인박스에서 되돌릴 수 있어.`);
          await reload();
          setTaskReloadSignal((n) => n + 1);
        }
        if (errors.length) onNotice(`자동 등록 ${errors.length}건 실패: ${errors[0]}`);
      } catch {
        // The inbox page shows agent errors; home must not be interrupted.
      }
    })();
  }, [agentState, onNotice, projects, reload, tasksState]);

  return { tasks, tasksState, tasksError, meta, milestones, agentState, agentError, reload, reloadTasks, reloadAgent, taskReloadSignal, bumpTaskReload: () => setTaskReloadSignal((n) => n + 1) };
}

export type MtosWorkspace = ReturnType<typeof useMtosWorkspace>;
