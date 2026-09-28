import { describe, expect, it } from 'vitest';
import { ensureInboxPlannerTasks, plannerTaskFromInboxEntry, parsePlannerTasks } from './planner-tasks';
import type { InboxEntry } from './inbox';

function inboxTodo(id: string): InboxEntry {
  return {
    id,
    rawText: '교수님께 연구 방향 질문하기',
    createdAt: '2026-09-28T08:00:00.000Z',
    processed: true,
    ai: {
      entryId: id,
      category: 'todo',
      title: '연구 방향 확인',
      summary: '다음 미팅 전에 질문한다.',
      nextAction: '교수님께 연구 방향 질문하기',
      dueDate: null,
      relatedEntryIds: [],
      processedAt: '2026-09-28T08:10:00.000Z',
    },
  };
}

describe('Inbox to Planner task mapping', () => {
  it('maps todos to stable Inbox-linked IDs and skips other categories', () => {
    const task = plannerTaskFromInboxEntry(inboxTodo('capture-7'));
    expect(task).toMatchObject({
      id: 'inbox:capture-7',
      source: 'inbox',
      inboxItemId: 'capture-7',
      projectId: null,
      status: 'pending',
      title: '교수님께 연구 방향 질문하기',
    });
    expect(plannerTaskFromInboxEntry({ ...inboxTodo('idea-1'), ai: { ...inboxTodo('idea-1').ai!, category: 'idea' } })).toBeNull();
  });

  it('adds each Inbox item once and keeps existing completion and project routing', () => {
    const existing = parsePlannerTasks([{
      ...plannerTaskFromInboxEntry(inboxTodo('capture-7'))!,
      projectId: 'thesis',
      status: 'done',
      completedAt: '2026-09-29T01:00:00.000Z',
      updatedAt: '2026-09-29T01:00:00.000Z',
    }]);
    const result = ensureInboxPlannerTasks([inboxTodo('capture-7'), inboxTodo('capture-8')], existing);
    expect(result.added).toHaveLength(1);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.find((task) => task.id === 'inbox:capture-7')).toMatchObject({ projectId: 'thesis', status: 'done' });
  });
});
