import { randomUUID } from 'node:crypto';
import { nowIso, tx } from './db.js';
import { ConflictError, NotFoundError, ValidationError, date, id, isRecord, oneOf, projectId, text, url } from './validate.js';

export const MEMO_KINDS = ['task', 'note', 'reference', 'archive'];
export const MILESTONE_STATUSES = ['planned', 'done', 'missed', 'cancelled'];
export const APPROVAL_KINDS = ['deadline_change', 'stage_change', 'milestone_add', 'obsidian_write', 'duplicate_merge', 'sync_conflict'];
const INBOX_FINAL = ['applied', 'undone', 'duplicate', 'dismissed'];

const json = (value) => (value ? JSON.parse(value) : null);
const likeEscape = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createStore(db) {
  const audit = (event, detail = '') => db.prepare('INSERT INTO audit_log (event, detail, created_at) VALUES (?,?,?)').run(event, String(detail).slice(0, 2000), nowIso());
  const metaGet = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  const metaSet = (key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

  // ---------- memos ----------
  const memoRow = (memoId) => db.prepare('SELECT * FROM memos WHERE id = ?').get(memoId);
  const memos = {
    list({ projectId: project, includeDeleted = false } = {}) {
      const where = [includeDeleted ? '1=1' : 'deleted = 0'];
      const args = [];
      if (project !== undefined) { where.push(project === null ? 'project_id IS NULL' : 'project_id = ?'); if (project !== null) args.push(project); }
      return db.prepare(`SELECT * FROM memos WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`).all(...args);
    },
    get(memoId) {
      const row = memoRow(memoId);
      if (!row || row.deleted) throw new NotFoundError('memo not found');
      return row;
    },
    /** Idempotent on a client-generated id so a retried save never duplicates. */
    create(body) {
      if (!isRecord(body)) throw new ValidationError('invalid memo');
      const memoId = body.id === undefined ? randomUUID() : id(body.id);
      const existing = memoRow(memoId);
      if (existing) return { memo: existing, duplicate: true };
      const now = nowIso();
      db.prepare(`INSERT INTO memos (id, project_id, kind, body, source_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`).run(
        memoId, projectId(body.project_id), oneOf(body.kind, 'kind', MEMO_KINDS, 'note'), text(body.body, 'body', { max: 20000 }), url(body.source_url), now, now,
      );
      return { memo: memoRow(memoId), duplicate: false };
    },
    update(memoId, changes) {
      if (!isRecord(changes)) throw new ValidationError('invalid changes');
      const row = memos.get(memoId);
      const next = {
        project_id: 'project_id' in changes ? projectId(changes.project_id) : row.project_id,
        kind: 'kind' in changes ? oneOf(changes.kind, 'kind', MEMO_KINDS) : row.kind,
        body: 'body' in changes ? text(changes.body, 'body', { max: 20000 }) : row.body,
        source_url: 'source_url' in changes ? url(changes.source_url) : row.source_url,
      };
      db.prepare('UPDATE memos SET project_id = ?, kind = ?, body = ?, source_url = ?, updated_at = ? WHERE id = ?')
        .run(next.project_id, next.kind, next.body, next.source_url, nowIso(), memoId);
      return memoRow(memoId);
    },
    remove(memoId) {
      memos.get(memoId);
      db.prepare('UPDATE memos SET deleted = 1, updated_at = ? WHERE id = ?').run(nowIso(), memoId);
      audit('memo_deleted', memoId);
      return memoRow(memoId);
    },
    setObsidianState(memoId, state, path = null) {
      db.prepare('UPDATE memos SET obsidian_state = ?, obsidian_path = COALESCE(?, obsidian_path), updated_at = ? WHERE id = ?').run(state, path, nowIso(), memoId);
      return memoRow(memoId);
    },
  };

  // ---------- milestones ----------
  const milestoneRow = (milestoneId) => db.prepare('SELECT * FROM milestones WHERE id = ?').get(milestoneId);
  const writeMilestoneHistory = (milestoneId, version, actor, before, changes) => db.prepare(
    'INSERT INTO milestone_history (milestone_id, version, actor, before, changes, created_at) VALUES (?,?,?,?,?,?)',
  ).run(milestoneId, version, actor, JSON.stringify(before), JSON.stringify(changes), nowIso());
  const milestones = {
    list({ projectId: project } = {}) {
      return project
        ? db.prepare('SELECT * FROM milestones WHERE deleted = 0 AND project_id = ? ORDER BY date').all(project)
        : db.prepare('SELECT * FROM milestones WHERE deleted = 0 ORDER BY date').all();
    },
    get(milestoneId) {
      const row = milestoneRow(milestoneId);
      if (!row || row.deleted) throw new NotFoundError('milestone not found');
      return row;
    },
    create(body, actor = 'user') {
      if (!isRecord(body)) throw new ValidationError('invalid milestone');
      const milestoneId = body.id === undefined ? randomUUID() : id(body.id);
      if (milestoneRow(milestoneId)) return { milestone: milestoneRow(milestoneId), duplicate: true };
      const now = nowIso();
      const fields = {
        project_id: projectId(body.project_id, { required: true }),
        title: text(body.title, 'title', { max: 300 }),
        date: date(body.date, 'date'),
        status: oneOf(body.status, 'status', MILESTONE_STATUSES, 'planned'),
        kind: oneOf(body.kind, 'kind', ['official', 'internal']),
        source: text(body.source, 'source', { max: 1000, required: false }) ?? '',
        evidence_url: url(body.evidence_url, 'evidence_url'),
      };
      if (fields.kind === 'official' && !fields.source && !fields.evidence_url) {
        throw new ValidationError('an official deadline needs its source or evidence link');
      }
      return tx(db, () => {
        db.prepare(`INSERT INTO milestones (id, project_id, title, date, status, kind, source, evidence_url, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(milestoneId, fields.project_id, fields.title, fields.date, fields.status, fields.kind, fields.source, fields.evidence_url, now, now);
        writeMilestoneHistory(milestoneId, 1, actor, {}, fields);
        return { milestone: milestoneRow(milestoneId), duplicate: false };
      });
    },
    /**
     * Optimistic update. The date or kind of an official deadline only changes
     * with an explicit `confirm_official` from the user; AI proposals go
     * through approvals instead.
     */
    update(milestoneId, { base_version, changes, confirm_official = false }, actor = 'user') {
      if (!isRecord(changes)) throw new ValidationError('invalid changes');
      return tx(db, () => {
        const row = milestones.get(milestoneId);
        if (!Number.isInteger(base_version) || base_version !== row.version) throw new ConflictError('milestone changed; reload before saving');
        const next = {};
        if ('title' in changes) next.title = text(changes.title, 'title', { max: 300 });
        if ('date' in changes) next.date = date(changes.date, 'date');
        if ('status' in changes) next.status = oneOf(changes.status, 'status', MILESTONE_STATUSES);
        if ('kind' in changes) next.kind = oneOf(changes.kind, 'kind', ['official', 'internal']);
        if ('source' in changes) next.source = text(changes.source, 'source', { max: 1000, required: false }) ?? '';
        if ('evidence_url' in changes) next.evidence_url = url(changes.evidence_url, 'evidence_url');
        const effective = Object.fromEntries(Object.entries(next).filter(([key, value]) => row[key] !== value));
        if (!Object.keys(effective).length) return row;
        const touchesOfficial = row.kind === 'official' && ('date' in effective || 'kind' in effective);
        if (touchesOfficial && (!confirm_official || actor !== 'user')) {
          throw new ConflictError('official deadline date/kind changes need explicit user confirmation');
        }
        const before = Object.fromEntries(Object.keys(effective).map((key) => [key, row[key]]));
        const version = row.version + 1;
        const cols = Object.keys(effective);
        db.prepare(`UPDATE milestones SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = ?, updated_at = ? WHERE id = ?`)
          .run(...cols.map((c) => effective[c]), version, nowIso(), milestoneId);
        writeMilestoneHistory(milestoneId, version, actor, before, effective);
        return milestoneRow(milestoneId);
      });
    },
    remove(milestoneId, actor = 'user') {
      return tx(db, () => {
        const row = milestones.get(milestoneId);
        if (row.kind === 'official') throw new ConflictError('official deadlines are kept; mark them cancelled instead');
        db.prepare('UPDATE milestones SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ?').run(nowIso(), milestoneId);
        writeMilestoneHistory(milestoneId, row.version + 1, actor, { deleted: 0 }, { deleted: 1 });
        return milestoneRow(milestoneId);
      });
    },
    history(milestoneId) {
      return db.prepare('SELECT * FROM milestone_history WHERE milestone_id = ? ORDER BY version').all(milestoneId)
        .map((r) => ({ ...r, before: JSON.parse(r.before), changes: JSON.parse(r.changes) }));
    },
  };

  // ---------- inbox ----------
  const inboxRow = (itemId) => {
    const row = db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(itemId);
    return row && { ...row, classification: json(row.classification) };
  };
  const inbox = {
    /** Stores the raw text first; classification happens later and can fail without losing input. */
    capture(body, sourceKind = 'manual') {
      if (!isRecord(body)) throw new ValidationError('invalid capture');
      const raw = text(body.text, 'text', { max: 20000 });
      const dedupeKey = text(body.dedupe_key ?? (body.capture_id ? `manual:${id(body.capture_id, 'capture_id')}` : undefined), 'dedupe_key', { max: 300 });
      const existing = db.prepare('SELECT id FROM inbox_items WHERE dedupe_key = ?').get(dedupeKey);
      if (existing) return { item: inboxRow(existing.id), duplicate: true };
      const itemId = randomUUID();
      const now = nowIso();
      db.prepare(`INSERT INTO inbox_items (id, dedupe_key, source_kind, source_ref, source_url, raw_text, received_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        itemId, dedupeKey, oneOf(sourceKind, 'source_kind', ['manual', 'gmail', 'portal', 'link', 'school_mail']),
        text(body.source_ref, 'source_ref', { max: 500, required: false }), url(body.source_url),
        raw, typeof body.received_at === 'string' && !Number.isNaN(Date.parse(body.received_at)) ? new Date(body.received_at).toISOString() : now, now, now,
      );
      return { item: inboxRow(itemId), duplicate: false };
    },
    get(itemId) {
      const row = inboxRow(itemId);
      if (!row) throw new NotFoundError('inbox item not found');
      return row;
    },
    list({ states, limit = 200 } = {}) {
      const rows = states?.length
        ? db.prepare(`SELECT id FROM inbox_items WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY received_at DESC LIMIT ?`).all(...states, limit)
        : db.prepare('SELECT id FROM inbox_items ORDER BY received_at DESC LIMIT ?').all(limit);
      return rows.map((r) => inboxRow(r.id));
    },
    setState(itemId, state, fields = {}) {
      const row = inbox.get(itemId);
      if (INBOX_FINAL.includes(row.state) && state !== 'undone' && !(row.state === 'undone' && state === 'applied')) {
        throw new ConflictError(`item is already ${row.state}`);
      }
      db.prepare(`UPDATE inbox_items SET state = ?, classification = COALESCE(?, classification), created_task_id = COALESCE(?, created_task_id),
        duplicate_of_task_id = COALESCE(?, duplicate_of_task_id), error = ?, updated_at = ? WHERE id = ?`).run(
        state, fields.classification ? JSON.stringify(fields.classification) : null, fields.created_task_id ?? null,
        fields.duplicate_of_task_id ?? null, fields.error ?? null, nowIso(), itemId,
      );
      audit(`inbox_${state}`, itemId);
      return inboxRow(itemId);
    },
  };

  // ---------- approvals ----------
  const approvalRow = (approvalId) => {
    const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
    return row && { ...row, payload: JSON.parse(row.payload), blocks_today: !!row.blocks_today, data_loss_risk: !!row.data_loss_risk };
  };
  const approvalEvent = (approvalId, event, detail = '') => db.prepare('INSERT INTO approval_events (approval_id, event, detail, created_at) VALUES (?,?,?,?)')
    .run(approvalId, event, String(detail).slice(0, 2000), nowIso());
  const approvals = {
    create(body) {
      if (!isRecord(body) || !isRecord(body.payload)) throw new ValidationError('invalid approval');
      const kind = oneOf(body.kind, 'kind', APPROVAL_KINDS);
      const approvalId = randomUUID();
      // One open approval per target: a newer proposal replaces the old one.
      const targetRef = text(body.target_ref, 'target_ref', { max: 500, required: false });
      return tx(db, () => {
        if (targetRef) {
          for (const old of db.prepare("SELECT id FROM approvals WHERE kind = ? AND target_ref = ? AND state = 'pending'").all(kind, targetRef)) {
            db.prepare("UPDATE approvals SET state = 'stale', decided_at = ? WHERE id = ?").run(nowIso(), old.id);
            approvalEvent(old.id, 'superseded', approvalId);
          }
        }
        db.prepare(`INSERT INTO approvals (id, kind, state, title, payload, target_ref, target_version, official_deadline, blocks_today, data_loss_risk, source_ref, created_at)
          VALUES (?,?, 'pending', ?,?,?,?,?,?,?,?,?)`).run(
          approvalId, kind, text(body.title, 'title', { max: 300 }), JSON.stringify(body.payload), targetRef,
          text(body.target_version, 'target_version', { max: 200, required: false }), date(body.official_deadline, 'official_deadline', { required: false }),
          body.blocks_today ? 1 : 0, body.data_loss_risk ? 1 : 0, text(body.source_ref, 'source_ref', { max: 500, required: false }), nowIso(),
        );
        approvalEvent(approvalId, 'created');
        return approvalRow(approvalId);
      });
    },
    get(approvalId) {
      const row = approvalRow(approvalId);
      if (!row) throw new NotFoundError('approval not found');
      return row;
    },
    list({ states } = {}) {
      const rows = states?.length
        ? db.prepare(`SELECT id FROM approvals WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 300`).all(...states)
        : db.prepare('SELECT id FROM approvals ORDER BY created_at DESC LIMIT 300').all();
      return rows.map((r) => approvalRow(r.id));
    },
    /** approve | reject. An approve may carry a user-edited payload, which is recorded. */
    decide(approvalId, { decision, payload }) {
      return tx(db, () => {
        const row = approvals.get(approvalId);
        if (row.state !== 'pending') throw new ConflictError(`approval is ${row.state}`);
        const choice = oneOf(decision, 'decision', ['approved', 'rejected']);
        if (choice === 'approved' && payload !== undefined) {
          if (!isRecord(payload)) throw new ValidationError('payload must be an object');
          db.prepare('UPDATE approvals SET payload = ? WHERE id = ?').run(JSON.stringify(payload), approvalId);
          approvalEvent(approvalId, 'edited', JSON.stringify(payload).slice(0, 1500));
        }
        db.prepare('UPDATE approvals SET state = ?, decided_at = ? WHERE id = ?').run(choice, nowIso(), approvalId);
        approvalEvent(approvalId, choice);
        return approvalRow(approvalId);
      });
    },
    /** Only an approved item can be applied; applying re-checks nothing here — callers verify the target version first. */
    finish(approvalId, outcome, detail = '') {
      return tx(db, () => {
        const row = approvals.get(approvalId);
        const allowed = { applied: ['approved', 'failed'], failed: ['approved', 'failed'], stale: ['approved', 'pending', 'failed'] };
        if (!allowed[outcome]?.includes(row.state)) throw new ConflictError(`cannot mark ${row.state} approval as ${outcome}`);
        db.prepare(`UPDATE approvals SET state = ?, error = ?, applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END WHERE id = ?`)
          .run(outcome, outcome === 'applied' ? null : String(detail).slice(0, 1000), outcome, nowIso(), approvalId);
        approvalEvent(approvalId, outcome, detail);
        return approvalRow(approvalId);
      });
    },
    events(approvalId) {
      return db.prepare('SELECT * FROM approval_events WHERE approval_id = ? ORDER BY id').all(approvalId);
    },
    /** Home only shows approvals that meet one of the three urgency rules. */
    urgent(today) {
      const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
      return approvals.list({ states: ['pending'] }).filter((a) => a.blocks_today || a.data_loss_risk || (a.official_deadline && a.official_deadline <= limit));
    },
  };

  // ---------- task extensions ----------
  const metaRow = (taskId) => {
    const row = db.prepare('SELECT * FROM task_meta WHERE task_id = ?').get(taskId);
    return row && { ...row, ai_generated: !!row.ai_generated, recur: json(row.recur) };
  };
  const taskMeta = {
    all() {
      return db.prepare('SELECT task_id FROM task_meta').all().map((r) => metaRow(r.task_id));
    },
    get: metaRow,
    upsert(taskId, fields) {
      id(taskId, 'task_id');
      if (!isRecord(fields)) throw new ValidationError('invalid task meta');
      const current = metaRow(taskId) ?? {};
      const next = {
        parent_task_id: 'parent_task_id' in fields ? (fields.parent_task_id === null ? null : id(fields.parent_task_id, 'parent_task_id')) : current.parent_task_id ?? null,
        step_order: 'step_order' in fields ? (Number.isInteger(fields.step_order) ? fields.step_order : null) : current.step_order ?? null,
        ai_generated: 'ai_generated' in fields ? (fields.ai_generated ? 1 : 0) : current.ai_generated ? 1 : 0,
        source_ref: 'source_ref' in fields ? text(fields.source_ref, 'source_ref', { max: 500, required: false }) : current.source_ref ?? null,
        recur: 'recur' in fields ? (fields.recur === null ? null : JSON.stringify(validateRecur(fields.recur))) : current.recur ? JSON.stringify(current.recur) : null,
        series_id: 'series_id' in fields ? (fields.series_id === null ? null : id(fields.series_id, 'series_id')) : current.series_id ?? null,
      };
      if (next.parent_task_id === taskId) throw new ValidationError('a task cannot be its own parent');
      db.prepare(`INSERT INTO task_meta (task_id, parent_task_id, step_order, ai_generated, source_ref, recur, series_id, blocked_reason, snooze_until, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET parent_task_id = excluded.parent_task_id, step_order = excluded.step_order,
        ai_generated = excluded.ai_generated, source_ref = excluded.source_ref, recur = excluded.recur, series_id = excluded.series_id, updated_at = excluded.updated_at`)
        .run(taskId, next.parent_task_id, next.step_order, next.ai_generated, next.source_ref, next.recur, next.series_id, current.blocked_reason ?? null, current.snooze_until ?? null, nowIso());
      return metaRow(taskId);
    },
    /** Blocking keeps every earlier record; unblocking appends, it never erases. */
    block(taskId, { event, reason = '', until }) {
      id(taskId, 'task_id');
      const kind = oneOf(event, 'event', ['blocked', 'unblocked', 'snoozed', 'note']);
      const untilDate = date(until, 'until', { required: kind === 'snoozed' });
      const why = text(reason, 'reason', { max: 2000, required: kind === 'blocked', allowEmpty: kind !== 'blocked' }) ?? '';
      return tx(db, () => {
        if (!metaRow(taskId)) taskMeta.upsert(taskId, {});
        db.prepare('INSERT INTO block_events (task_id, event, reason, until_date, created_at) VALUES (?,?,?,?,?)').run(taskId, kind, why, untilDate, nowIso());
        if (kind === 'blocked') db.prepare('UPDATE task_meta SET blocked_reason = ?, updated_at = ? WHERE task_id = ?').run(why, nowIso(), taskId);
        if (kind === 'unblocked') db.prepare('UPDATE task_meta SET blocked_reason = NULL, snooze_until = NULL, updated_at = ? WHERE task_id = ?').run(nowIso(), taskId);
        if (kind === 'snoozed') db.prepare('UPDATE task_meta SET snooze_until = ?, updated_at = ? WHERE task_id = ?').run(untilDate, nowIso(), taskId);
        return { meta: metaRow(taskId), events: taskMeta.blockEvents(taskId) };
      });
    },
    blockEvents(taskId) {
      return db.prepare('SELECT * FROM block_events WHERE task_id = ? ORDER BY id').all(taskId);
    },
    recordOccurrence(body) {
      if (!isRecord(body)) throw new ValidationError('invalid occurrence');
      const series = id(body.series_id, 'series_id');
      const due = date(body.due_date, 'due_date');
      const state = oneOf(body.state, 'state', ['done', 'skipped', 'deferred']);
      const deferredTo = date(body.deferred_to, 'deferred_to', { required: state === 'deferred' });
      db.prepare(`INSERT INTO occurrences (series_id, due_date, state, task_id, deferred_to, created_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(series_id, due_date) DO UPDATE SET state = excluded.state, task_id = excluded.task_id, deferred_to = excluded.deferred_to`)
        .run(series, due, state, body.task_id ? id(body.task_id, 'task_id') : null, deferredTo, nowIso());
      return taskMeta.occurrences(series);
    },
    occurrences(seriesId) {
      const rows = db.prepare('SELECT * FROM occurrences WHERE series_id = ? ORDER BY due_date').all(seriesId);
      // Skipped occurrences are tracked but never counted as completed.
      return { items: rows, done: rows.filter((r) => r.state === 'done').length, skipped: rows.filter((r) => r.state === 'skipped').length };
    },
  };

  // ---------- focus ----------
  const focus = {
    save({ date: day, items, free_slots = [], job_id = null }) {
      const recId = randomUUID();
      db.prepare('INSERT INTO focus_recommendations (id, date, job_id, items, free_slots, created_at) VALUES (?,?,?,?,?,?)')
        .run(recId, date(day, 'date'), job_id, JSON.stringify(items), JSON.stringify(free_slots), nowIso());
      return focus.latest(day);
    },
    latest(day) {
      const row = db.prepare('SELECT * FROM focus_recommendations WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(day);
      const feedback = db.prepare('SELECT task_id, action FROM focus_feedback WHERE date = ?').all(day);
      if (!row) return { date: day, items: [], free_slots: [], feedback };
      return { ...row, items: JSON.parse(row.items), free_slots: JSON.parse(row.free_slots), feedback };
    },
    feedback(day, taskId, action) {
      db.prepare(`INSERT INTO focus_feedback (date, task_id, action, created_at) VALUES (?,?,?,?)
        ON CONFLICT(date, task_id) DO UPDATE SET action = excluded.action, created_at = excluded.created_at`)
        .run(date(day, 'date'), id(taskId, 'task_id'), oneOf(action, 'action', ['accepted', 'rejected']), nowIso());
      return focus.latest(day);
    },
  };

  // ---------- context / settings / collectors ----------
  const settings = {
    /** Minimal task/project snapshot the web app pushes so scheduled jobs can classify without P0 credentials. */
    setContext(context) {
      if (!isRecord(context) || !Array.isArray(context.projects) || !Array.isArray(context.tasks)) throw new ValidationError('invalid context');
      const projects = context.projects.slice(0, 200).flatMap((p) => (isRecord(p) && typeof p.id === 'string' && typeof p.title === 'string'
        ? [{ id: projectId(p.id, { required: true }), title: p.title.slice(0, 200), stage: typeof p.stage === 'string' ? p.stage.slice(0, 64) : '' }] : []));
      const tasks = context.tasks.slice(0, 1000).flatMap((t) => (isRecord(t) && typeof t.id === 'string' && typeof t.title === 'string'
        ? [{ id: id(t.id, 'task_id'), title: t.title.slice(0, 500), project_id: typeof t.project_id === 'string' ? t.project_id : null, due_date: typeof t.due_date === 'string' ? t.due_date : null, status: t.status === 'done' ? 'done' : 'open' }] : []));
      metaSet('context', JSON.stringify({ projects, tasks, updated_at: nowIso() }));
      return settings.context();
    },
    context() {
      return json(metaGet('context')) ?? { projects: [], tasks: [], updated_at: null };
    },
    mailSenders() {
      return json(metaGet('mail_senders')) ?? [];
    },
    setMailSenders(list) {
      if (!Array.isArray(list) || list.length > 50) throw new ValidationError('senders must be a list of up to 50 entries');
      const cleaned = [...new Set(list.map((value) => text(value, 'sender', { max: 200 }).toLowerCase()))];
      for (const sender of cleaned) {
        if (!/^[a-z0-9._%+-]*@?[a-z0-9.-]+\.[a-z]{2,}$/.test(sender)) throw new ValidationError(`invalid sender: ${sender}`);
      }
      metaSet('mail_senders', JSON.stringify(cleaned));
      audit('mail_senders_updated', String(cleaned.length));
      return cleaned;
    },
    collector(source) {
      return db.prepare('SELECT * FROM collector_state WHERE source = ?').get(source) ?? { source, last_checked_at: null, last_success_at: null, cursor: null, last_error: null };
    },
    setCollector(source, fields) {
      const current = settings.collector(source);
      const next = { ...current, ...fields };
      db.prepare(`INSERT INTO collector_state (source, last_checked_at, last_success_at, cursor, last_error) VALUES (?,?,?,?,?)
        ON CONFLICT(source) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_success_at = excluded.last_success_at,
        cursor = excluded.cursor, last_error = excluded.last_error`).run(source, next.last_checked_at, next.last_success_at, next.cursor, next.last_error);
      return settings.collector(source);
    },
  };

  // ---------- search ----------
  function search(query, limit = 30) {
    const q = text(query, 'q', { max: 200 });
    const like = `%${likeEscape(q)}%`;
    return {
      memos: db.prepare("SELECT id, project_id, kind, body, source_url, created_at FROM memos WHERE deleted = 0 AND body LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?").all(like, limit),
      milestones: db.prepare("SELECT id, project_id, title, date, kind, status FROM milestones WHERE deleted = 0 AND (title LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\') ORDER BY date LIMIT ?").all(like, like, limit),
      inbox: db.prepare("SELECT id, state, source_kind, source_url, raw_text, received_at FROM inbox_items WHERE raw_text LIKE ? ESCAPE '\\' ORDER BY received_at DESC LIMIT ?").all(like, limit),
    };
  }

  return { audit, memos, milestones, inbox, approvals, taskMeta, focus, settings, search };
}

export function validateRecur(value) {
  if (!isRecord(value)) throw new ValidationError('recur must be an object');
  const mode = oneOf(value.mode, 'recur.mode', ['fixed', 'after_completion']);
  if (!Number.isInteger(value.every_days) || value.every_days < 1 || value.every_days > 366) throw new ValidationError('recur.every_days must be 1-366');
  return { mode, every_days: value.every_days, anchor_date: date(value.anchor_date, 'recur.anchor_date', { required: mode === 'fixed' }) };
}
