import { createP0Task, deleteP0Task, updateP0Task, type P0Task, type P0TaskCategory } from './p0-tasks-client';
import type { Milestone, TaskMeta } from './mtos-planning';

export type AgentErrorCode = 'agent_unconfigured' | 'agent_unreachable' | 'auth_required' | 'bad_path' | 'http';

/** Keeps "not configured / unreachable" apart from a real empty result. */
export class AgentRequestError extends Error {
  constructor(readonly status: number, readonly code: AgentErrorCode, message: string) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

export type Memo = { id: string; project_id: string | null; kind: 'task' | 'note' | 'reference' | 'archive'; body: string; source_url: string | null; obsidian_state: 'none' | 'proposed' | 'pending_retry' | 'synced'; obsidian_path: string | null; created_at: string; updated_at: string };
export type Classification = {
  class: 'task' | 'note' | 'reference' | 'schedule' | 'unclassified'; confidence: number; title: string; summary: string;
  due_date: string | null; due_is_explicit: boolean; official: boolean; project_id: string | null; project_confidence: number;
  duplicate_of_task_id: string | null; reason: string; model?: string;
};
export type InboxItem = {
  id: string; dedupe_key: string; source_kind: 'manual' | 'gmail' | 'portal' | 'link' | 'school_mail'; source_ref: string | null; source_url: string | null; raw_text: string;
  received_at: string; state: 'new' | 'classifying' | 'classified' | 'auto_pending' | 'applied' | 'undone' | 'duplicate' | 'dismissed' | 'failed';
  classification: Classification | null; created_task_id: string | null; duplicate_of_task_id: string | null; error: string | null;
};
export type ApprovalKind = 'deadline_change' | 'stage_change' | 'milestone_add' | 'obsidian_write' | 'duplicate_merge' | 'sync_conflict';
export type Approval = {
  id: string; kind: ApprovalKind; state: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'stale'; title: string;
  payload: Record<string, unknown>; target_ref: string | null; target_version: string | null; official_deadline: string | null;
  blocks_today: boolean; data_loss_risk: boolean; error: string | null; created_at: string; decided_at: string | null; applied_at: string | null;
};
export type ApprovalEvent = { id: number; event: string; detail: string; created_at: string };
export type AgentJob = {
  id: string; type: string; state: 'queued' | 'running' | 'done' | 'failed' | 'retry_wait' | 'cancelled'; priority: number; attempts: number; max_attempts: number;
  source: string; model: string | null; runner: string | null; error: string | null; result: unknown; created_at: string; finished_at: string | null; next_run_at: string;
};
export type FocusState = { date: string; items: Array<{ task_id: string; reason: string }>; free_slots: Array<{ start: string; end: string; minutes: number }>; feedback: Array<{ task_id: string; action: 'accepted' | 'rejected' }>; created_at?: string };
export type AgentStatus = {
  worker: { paused: { reason: string; message: string; at: string } | null; heartbeat: { at: string; owner: string; codex_model: string | null } | null; codex_found: boolean };
  queue: Record<string, number>; gmail: { last_checked_at: string | null; last_success_at: string | null; last_error: string | null }; mail_senders: number; context_updated_at: string | null;
};
export type SchoolAnalysis = { summary: string; importance: 'high' | 'normal' | 'low'; requires_action: boolean; suggested_task: string | null; deadline: string | null; project_id: string | null; reason: string | null; model: string | null; analyzed_at: string };
export type SchoolAttachment = { id: string; filename: string; mime: string | null; size: number | null; stored: boolean; url: string | null };
export type SchoolMailSummary = { app_seen?: boolean; id: string; folder_id: string; subject: string; from_addr: string; to_addr: string; received_at: string | null; sent_at: string | null; read_state: boolean; collected_at: string; attachment_count: number; analysis: SchoolAnalysis | null };
export type SchoolMailDetail = Omit<SchoolMailSummary, 'attachment_count'> & { account_id: string; message_id?: string | null; cc_addr: string; body_text: string; body_html?: string | null; attachments: SchoolAttachment[] };
export type SchoolNoticeSummary = { notice_id: string; notice_type: string; category: string; department: string; title: string; importance: string; published_at: string | null; deadline: string | null; expires_at: string | null; source_url: string | null; collected_at: string; changed_at: string; attachment_count: number; analysis: SchoolAnalysis | null };
export type SchoolNoticeDetail = Omit<SchoolNoticeSummary, 'attachment_count'> & { body_text: string; attachments: SchoolAttachment[]; history: Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string }> };
export type SchoolSourceStatus = { last_checked_at: string | null; last_success_at: string | null; last_error: string | null; connected: boolean; session: string | null; pending: number };
export type SchoolStatus = { mail: SchoolSourceStatus & { accounts: string[] }; notices: SchoolSourceStatus & { needs_login: boolean } };
export type AgentSearch = { memos: Memo[]; milestones: Milestone[]; inbox: InboxItem[] };

async function agent<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const params = new URLSearchParams(Object.entries(init.query ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1])));
  let response: Response;
  try {
    response = await fetch(`/api/mtos/${path}${params.size ? `?${params}` : ''}`, {
      method: init.method ?? 'GET',
      cache: 'no-store',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AgentRequestError(0, 'agent_unreachable', 'Master Thesis OS 서버에 연결할 수 없어.');
  }
  const data = await response.json().catch(() => ({})) as { error?: string; code?: AgentErrorCode };
  if (!response.ok) throw new AgentRequestError(response.status, data.code ?? 'http', data.error ?? `요청에 실패했어 (${response.status})`);
  return data as T;
}

export function agentErrorText(error: unknown, fallback: string) {
  if (error instanceof AgentRequestError) {
    if (error.code === 'agent_unconfigured') return `설정 필요: ${error.message}`;
    if (error.code === 'agent_unreachable') return `연결 오류: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

export const mtosApi = {
  status: () => agent<AgentStatus>('status'),
  ops: <T>(name: string, query?: Record<string, string | undefined>) => agent<T>(`ops/${name}`, { query }),
  opsSaveSettings: (settings: Record<string, number>) => agent<{ settings: Record<string, number> }>('ops/settings', { method: 'PUT', body: settings }),
  schoolStatus: () => agent<SchoolStatus>('school/status'),
  schoolMails: (limit = 50) => agent<{ mails: SchoolMailSummary[]; total: number }>('school/mails', { query: { limit: String(limit) } }),
  schoolMail: (id: string) => agent<{ mail: SchoolMailDetail }>(`school/mails/${id}`),
  schoolNotices: (type?: 'ALL' | 'DM', limit = 100) => agent<{ notices: SchoolNoticeSummary[] }>('school/notices', { query: { type, limit: String(limit) } }),
  schoolNotice: (id: string) => agent<{ notice: SchoolNoticeDetail }>(`school/notices/${id}`),
  markSchoolMailSeen: (id: string) => agent<{ ok: true }>('school/seen', { method: 'POST', body: { id } }),
  resumeWorker: () => agent<{ paused: null }>('worker/resume', { method: 'POST', body: {} }),
  jobs: (state?: string) => agent<{ jobs: AgentJob[] }>('jobs', { query: { state } }),
  job: (id: string) => agent<{ job: AgentJob }>(`jobs/${id}`),
  requestJob: (type: string, input: unknown, dedupeKey?: string) => agent<{ job: AgentJob; duplicate: boolean }>('jobs', { method: 'POST', body: { type, input, dedupe_key: dedupeKey } }),
  cancelJob: (id: string) => agent<{ job: AgentJob }>(`jobs/${id}/cancel`, { method: 'POST', body: {} }),
  retryJob: (id: string) => agent<{ job: AgentJob }>(`jobs/${id}/retry`, { method: 'POST', body: {} }),

  memos: (projectId?: string | null) => agent<{ memos: Memo[] }>('memos', { query: { project_id: projectId === undefined ? undefined : projectId ?? '' } }),
  createMemo: (body: { id: string; kind: Memo['kind']; body: string; project_id?: string | null; source_url?: string | null }) => agent<{ memo: Memo }>('memos', { method: 'POST', body }),
  updateMemo: (id: string, changes: Partial<Pick<Memo, 'kind' | 'body' | 'project_id' | 'source_url'>>) => agent<{ memo: Memo }>(`memos/${id}`, { method: 'PATCH', body: changes }),
  deleteMemo: (id: string) => agent<{ memo: Memo }>(`memos/${id}`, { method: 'DELETE' }),

  milestones: (projectId?: string) => agent<{ milestones: Milestone[] }>('milestones', { query: { project_id: projectId } }),
  createMilestone: (body: Partial<Milestone> & { id: string }) => agent<{ milestone: Milestone }>('milestones', { method: 'POST', body }),
  updateMilestone: (id: string, body: { base_version: number; changes: Partial<Milestone>; confirm_official?: boolean }) => agent<{ milestone: Milestone }>(`milestones/${id}`, { method: 'PATCH', body }),
  deleteMilestone: (id: string) => agent<{ milestone: Milestone }>(`milestones/${id}`, { method: 'DELETE' }),
  milestoneHistory: (id: string) => agent<{ history: Array<{ version: number; actor: string; before: Record<string, unknown>; changes: Record<string, unknown>; created_at: string }> }>(`milestones/${id}/history`),

  inbox: (state?: string) => agent<{ items: InboxItem[] }>('inbox', { query: { state } }),
  capture: (body: { text: string; capture_id: string; source_url?: string | null }) => agent<{ item: InboxItem; duplicate: boolean }>('inbox', { method: 'POST', body }),
  setInboxState: (id: string, body: { state: string; created_task_id?: string; duplicate_of_task_id?: string }) => agent<{ item: InboxItem }>(`inbox/${id}/state`, { method: 'POST', body }),
  reclassify: (id: string) => agent<{ job: AgentJob }>(`inbox/${id}/reclassify`, { method: 'POST', body: {} }),

  approvals: (state?: string) => agent<{ approvals: Approval[] }>('approvals', { query: { state } }),
  urgentApprovals: (date: string) => agent<{ approvals: Approval[] }>('approvals/urgent', { query: { date } }),
  createApproval: (body: { kind: ApprovalKind; title: string; payload: Record<string, unknown>; target_ref?: string; target_version?: string; official_deadline?: string | null; blocks_today?: boolean }) => agent<{ approval: Approval }>('approvals', { method: 'POST', body }),
  decideApproval: (id: string, decision: 'approved' | 'rejected', payload?: Record<string, unknown>) => agent<{ approval: Approval }>(`approvals/${id}/decide`, { method: 'POST', body: { decision, payload } }),
  finishApproval: (id: string, outcome: 'applied' | 'failed' | 'stale', detail = '') => agent<{ approval: Approval }>(`approvals/${id}/finish`, { method: 'POST', body: { outcome, detail } }),
  approvalEvents: (id: string) => agent<{ events: ApprovalEvent[] }>(`approvals/${id}/events`),

  taskMeta: () => agent<{ meta: TaskMeta[] }>('task-meta'),
  putTaskMeta: (taskId: string, fields: Partial<Omit<TaskMeta, 'task_id' | 'blocked_reason' | 'snooze_until'>>) => agent<{ meta: TaskMeta }>(`task-meta/${taskId}`, { method: 'PUT', body: fields }),
  blockTask: (taskId: string, body: { event: 'blocked' | 'unblocked' | 'snoozed' | 'note'; reason?: string; until?: string }) => agent<{ meta: TaskMeta; events: Array<{ event: string; reason: string; until_date: string | null; created_at: string }> }>(`task-meta/${taskId}/blocks`, { method: 'POST', body }),
  blockEvents: (taskId: string) => agent<{ events: Array<{ event: string; reason: string; until_date: string | null; created_at: string }> }>(`task-meta/${taskId}/blocks`),
  recordOccurrence: (body: { series_id: string; due_date: string; state: 'done' | 'skipped' | 'deferred'; task_id?: string; deferred_to?: string }) => agent<{ done: number; skipped: number }>('occurrences', { method: 'POST', body }),

  focus: (date: string) => agent<FocusState>('focus', { query: { date } }),
  focusFeedback: (date: string, taskId: string, action: 'accepted' | 'rejected') => agent<FocusState>('focus/feedback', { method: 'POST', body: { date, task_id: taskId, action } }),

  pushContext: (context: { projects: Array<{ id: string; title: string; stage?: string }>; tasks: Array<Pick<P0Task, 'id' | 'title' | 'project_id' | 'due_date' | 'status'>> }) => agent('context', { method: 'PUT', body: context }),
  mailSenders: () => agent<{ senders: string[] }>('settings/mail-senders'),
  setMailSenders: (senders: string[]) => agent<{ senders: string[] }>('settings/mail-senders', { method: 'PUT', body: { senders } }),
  search: (q: string) => agent<AgentSearch>('search', { query: { q } }),
};

/** Polls a job until it leaves the queue. Rejects on failure; never cancels the job. */
export async function waitForJob(jobId: string, { timeoutMs = 240_000, intervalMs = 2500 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { job } = await mtosApi.job(jobId);
    if (job.state === 'done') return job;
    if (job.state === 'failed' || job.state === 'cancelled') throw new Error(job.error || 'AI 작업이 실패했어.');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('AI 작업이 아직 끝나지 않았어. 잠시 뒤 AI 인박스에서 확인해줘.');
}

const safeTaskId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);
export const aiTaskId = (itemId: string) => `ai-${safeTaskId(itemId)}`;

/** Builds the P0 create request for an AI-classified inbox item. Only explicit dates become due dates. */
export function aiTaskFields(item: InboxItem, projectIds: string[]) {
  const c = item.classification;
  if (!c) throw new Error('분류 결과가 없어.');
  const projectId = c.project_id && projectIds.includes(c.project_id) && c.project_confidence >= 0.7 ? c.project_id : null;
  const category: P0TaskCategory = projectId ? 'research' : item.source_kind === 'gmail' || item.source_kind === 'portal' ? 'school' : 'unclassified';
  const memo = [
    `[AI 생성 · ${c.model ?? 'AI'}] ${c.reason}`,
    c.summary,
    !c.due_is_explicit && c.due_date ? `추정 날짜 ${c.due_date} — 원문에 명시되지 않아 마감일로 저장하지 않았어.` : '',
    `원문: ${item.raw_text.slice(0, 1500)}`,
  ].filter(Boolean).join('\n\n');
  return {
    id: aiTaskId(item.id),
    op_id: `mtos-ai-create-${item.id}`,
    fields: { title: c.title || item.raw_text.slice(0, 120), category, project_id: projectId, due_date: c.due_is_explicit ? c.due_date : null, memo, source_url: item.source_url, status: 'open', is_today: false },
  };
}

/**
 * Creates P0 tasks for auto_pending inbox items with the user's session.
 * Idempotent: the P0 op_id is derived from the inbox item, so a retry after a
 * partial failure never creates a second task.
 */
export async function applyAutoPending(items: InboxItem[], projectIds: string[]) {
  const created: P0Task[] = [];
  const errors: string[] = [];
  for (const item of items.filter((i) => i.state === 'auto_pending')) {
    try {
      const request = aiTaskFields(item, projectIds);
      const { task } = await createP0Task(request);
      await mtosApi.putTaskMeta(task.id, { ai_generated: true, source_ref: item.source_ref ?? `inbox:${item.id}` });
      await mtosApi.setInboxState(item.id, { state: 'applied', created_task_id: task.id });
      created.push(task);
    } catch (error) {
      errors.push(agentErrorText(error, '자동 등록에 실패했어.'));
    }
  }
  return { created, errors };
}

/** Undo of an AI-created task: soft-deletes it in P0 (revision kept) and records the undo. */
export async function undoAiTask(item: InboxItem) {
  if (!item.created_task_id) throw new Error('되돌릴 할 일이 없어.');
  await deleteP0Task(item.created_task_id);
  return mtosApi.setInboxState(item.id, { state: 'undone' });
}

/**
 * Applies an approved approval. Each kind re-checks the live target first and
 * marks the approval stale instead of overwriting something that changed.
 */
export async function applyApproval(approval: Approval, tasks: P0Task[]) {
  if (approval.state !== 'approved' && approval.state !== 'failed') throw new Error('승인된 항목만 반영할 수 있어.');
  const p = approval.payload;
  try {
    if (approval.kind === 'deadline_change') {
      const task = tasks.find((t) => t.id === p.task_id);
      if (!task || task.status !== 'open') return mtosApi.finishApproval(approval.id, 'stale', '대상 할 일이 없거나 이미 완료됐어.');
      if ((task.due_date ?? null) !== (p.from ?? null)) return mtosApi.finishApproval(approval.id, 'stale', '제안 이후 마감일이 이미 바뀌었어.');
      const result = await updateP0Task(task.id, { base_version: task.version, changes: { due_date: p.to }, op_id: `mtos-approval-${approval.id}` });
      if (result.conflicts.length) return mtosApi.finishApproval(approval.id, 'stale', '다른 기기의 변경과 충돌했어.');
      return mtosApi.finishApproval(approval.id, 'applied');
    }
    if (approval.kind === 'milestone_add') {
      await mtosApi.createMilestone({ id: `appr-${approval.id}`, project_id: String(p.project_id), title: String(p.title), date: String(p.date), kind: p.kind === 'official' ? 'official' : 'internal', source: String(p.source ?? ''), evidence_url: typeof p.evidence_url === 'string' ? p.evidence_url : null });
      return mtosApi.finishApproval(approval.id, 'applied');
    }
    if (approval.kind === 'duplicate_merge') {
      await mtosApi.setInboxState(String(p.inbox_item_id), { state: 'duplicate', duplicate_of_task_id: String(p.existing_task_id) });
      return mtosApi.finishApproval(approval.id, 'applied');
    }
    if (approval.kind === 'stage_change') {
      const response = await fetch('/api/research/projects/stage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.project_id, stage: p.stage, sha: approval.target_version }) });
      if (response.status === 409) return mtosApi.finishApproval(approval.id, 'stale', 'project.md가 제안 이후 바뀌었어.');
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? '단계 저장 실패');
      return mtosApi.finishApproval(approval.id, 'applied');
    }
    if (approval.kind === 'obsidian_write') {
      const response = await fetch('/api/obsidian/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approval_id: approval.id }) });
      const data = await response.json().catch(() => ({})) as { approval?: Approval; error?: string };
      if (!response.ok || !data.approval) throw new Error(data.error ?? 'Obsidian 반영에 실패했어.');
      return { approval: data.approval };
    }
    throw new Error('이 승인 유형은 여기서 반영할 수 없어.');
  } catch (error) {
    const message = agentErrorText(error, '반영에 실패했어.');
    await mtosApi.finishApproval(approval.id, 'failed', message).catch(() => undefined);
    throw new Error(message);
  }
}
