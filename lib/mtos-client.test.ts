import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiTaskFields, applyApproval, applyAutoPending, type Approval, type InboxItem } from './mtos-client';
import type { P0Task } from './p0-tasks-client';

const item = (classification: Partial<NonNullable<InboxItem['classification']>> = {}, extra: Partial<InboxItem> = {}): InboxItem => ({
  id: 'item-1', dedupe_key: 'manual:c1', source_kind: 'manual', source_ref: null, source_url: null, raw_text: '원문 텍스트', received_at: '2026-10-25T00:00:00Z',
  state: 'auto_pending', created_task_id: null, duplicate_of_task_id: null, error: null,
  classification: { class: 'task', confidence: 0.9, title: '초고 보내기', summary: '', due_date: null, due_is_explicit: false, official: false, project_id: null, project_confidence: 0, duplicate_of_task_id: null, reason: '실행 가능', model: 'm', ...classification },
  ...extra,
});
const task = (extra: Partial<P0Task> = {}): P0Task => ({
  id: 't1', title: '전처리', status: 'open', due_date: '2026-11-10', is_today: false, category: 'research', project_id: 'thesis', memo: '', source_url: null,
  version: 4, created_at: '', updated_at: '', completed_at: null, deleted: false, ...extra,
});
const approval = (payload: Record<string, unknown>, extra: Partial<Approval> = {}): Approval => ({
  id: 'a1', kind: 'deadline_change', state: 'approved', title: 'x', payload, target_ref: null, target_version: null, official_deadline: null,
  blocks_today: false, data_loss_risk: false, error: null, created_at: '', decided_at: null, applied_at: null, ...extra,
});

describe('aiTaskFields', () => {
  it('never stores an estimated date as the due date, but keeps it visible in the memo', () => {
    const request = aiTaskFields(item({ due_date: '2026-11-01', due_is_explicit: false }), []);
    expect(request.fields.due_date).toBeNull();
    expect(request.fields.memo).toContain('추정 날짜 2026-11-01');
    expect(request.fields.memo).toContain('원문: 원문 텍스트');
    expect(aiTaskFields(item({ due_date: '2026-11-01', due_is_explicit: true }), []).fields.due_date).toBe('2026-11-01');
  });

  it('links a project only when it exists and the AI is confident', () => {
    expect(aiTaskFields(item({ project_id: 'thesis', project_confidence: 0.5 }), ['thesis']).fields.project_id).toBeNull();
    expect(aiTaskFields(item({ project_id: 'ghost', project_confidence: 0.95 }), ['thesis']).fields.project_id).toBeNull();
    expect(aiTaskFields(item({ project_id: 'thesis', project_confidence: 0.95 }), ['thesis']).fields).toMatchObject({ project_id: 'thesis', category: 'research' });
  });

  it('derives a stable id and op_id from the inbox item so retries are idempotent', () => {
    expect(aiTaskFields(item(), [])).toMatchObject({ id: 'ai-item-1', op_id: 'mtos-ai-create-item-1' });
  });
});

describe('approval and auto-apply flows', () => {
  const fetchMock = vi.fn();
  const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`);
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/p0/tasks')) return Response.json({ task: task({ due_date: '2026-11-03', version: 5 }), conflicts: [] });
      return Response.json({ approval: approval({}, { state: 'applied' }), item: {}, meta: {} });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

  it('marks a deadline approval stale when the task date already changed', async () => {
    await applyApproval(approval({ task_id: 't1', from: '2026-11-01', to: '2026-11-03' }), [task({ due_date: '2026-11-10' })]);
    expect(calls()).toEqual(['POST /api/mtos/approvals/a1/finish {"outcome":"stale","detail":"제안 이후 마감일이 이미 바뀌었어."}']);
  });

  it('applies a deadline approval against the current task version', async () => {
    await applyApproval(approval({ task_id: 't1', from: '2026-11-10', to: '2026-11-03' }), [task()]);
    expect(calls()[0]).toBe('PATCH /api/p0/tasks/t1 {"base_version":4,"changes":{"due_date":"2026-11-03"},"op_id":"mtos-approval-a1"}');
    expect(calls()[1]).toContain('"outcome":"applied"');
  });

  it('refuses to apply something that was not approved', async () => {
    await expect(applyApproval(approval({}, { state: 'pending' }), [])).rejects.toThrow('승인된');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto-apply creates the task, marks it AI-generated, then links the inbox item', async () => {
    const { created, errors } = await applyAutoPending([item(), item({}, { id: 'skip', state: 'classified' })], []);
    expect(errors).toEqual([]);
    expect(created).toHaveLength(1);
    const sequence = calls().map((c) => c.split(' ').slice(0, 2).join(' '));
    expect(sequence).toEqual(['POST /api/p0/tasks', 'PUT /api/mtos/task-meta/t1', 'POST /api/mtos/inbox/item-1/state']);
    expect(calls()[1]).toContain('"ai_generated":true');
  });
});
