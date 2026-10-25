import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, createSessionVerifier } from './auth.js';
import { detectCodex } from './codex.js';
import { openAgentDb } from './db.js';
import { createQueue } from './queue.js';
import { tokyoDate } from './schedule.js';
import { createStore } from './store.js';
import { ConflictError, NotFoundError, ValidationError, date, id, isRecord, oneOf, text } from './validate.js';

const PREFIX = '/agent/api';
const MAX_BODY = 512 * 1024;
// Job types the web app may request directly; collect/classify also run on schedule.
const USER_JOB_TYPES = ['recommend_focus', 'decompose_task', 'unblock_task', 'obsidian_merge', 'collect_mail', 'classify_inbox'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
}

function validateJobInput(type, input) {
  if (!isRecord(input)) throw new ValidationError('input must be an object');
  const task = (value) => {
    if (!isRecord(value)) throw new ValidationError('task is required');
    return { id: id(value.id, 'task.id'), title: text(value.title, 'task.title', { max: 500 }), memo: typeof value.memo === 'string' ? value.memo.slice(0, 5000) : '' };
  };
  switch (type) {
    case 'recommend_focus': {
      if (!Array.isArray(input.tasks) || input.tasks.length > 400) throw new ValidationError('tasks must be a list');
      return {
        date: date(input.date, 'date'),
        tasks: input.tasks.filter(isRecord).map((t) => ({
          id: id(t.id, 'task.id'), title: String(t.title ?? '').slice(0, 300), status: t.status === 'done' ? 'done' : 'open',
          due_date: typeof t.due_date === 'string' ? t.due_date : null, project_id: typeof t.project_id === 'string' ? t.project_id : null,
          category: typeof t.category === 'string' ? t.category : null, blocked: Boolean(t.blocked), parent_task_id: typeof t.parent_task_id === 'string' ? t.parent_task_id : null,
        })),
        pinned_ids: Array.isArray(input.pinned_ids) ? input.pinned_ids.filter((v) => typeof v === 'string').slice(0, 100) : [],
        free_slots: Array.isArray(input.free_slots) ? input.free_slots.filter(isRecord).slice(0, 20).map((s) => ({ start: String(s.start), end: String(s.end), minutes: Number(s.minutes) || 0 })) : [],
        condition: typeof input.condition === 'string' ? input.condition.slice(0, 300) : '',
      };
    }
    case 'decompose_task': return { task: task(input.task) };
    case 'unblock_task': return { task: task(input.task), reason: typeof input.reason === 'string' ? input.reason.slice(0, 2000) : '' };
    case 'obsidian_merge': {
      const path = text(input.path, 'path', { max: 400 });
      if (!/\.md$/i.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new ValidationError('path must be a Vault-relative .md path');
      return {
        path, base_sha: input.base_sha ? text(input.base_sha, 'base_sha', { max: 200 }) : null,
        current_text: typeof input.current_text === 'string' ? input.current_text.slice(0, 200000) : '',
        memo_id: id(input.memo_id, 'memo_id'), memo_text: text(input.memo_text, 'memo_text', { max: 20000 }),
        mode: oneOf(input.mode, 'mode', ['append', 'section', 'new']),
      };
    }
    case 'collect_mail': return {};
    case 'classify_inbox': return { item_id: id(input.item_id, 'item_id') };
    default: throw new ValidationError('job type not allowed');
  }
}

/** Request handler; collaborators are injectable for tests. */
export function createAgentApp({ db, verifySession, now = () => Date.now(), codexInfo = () => detectCodex() }) {
  const store = createStore(db);
  const queue = createQueue(db, { now });

  async function route(req, url) {
    const path = url.pathname.slice(PREFIX.length) || '/';
    const method = req.method;
    if (method === 'GET' && path === '/health') return [200, { ok: true }];

    const header = req.headers.authorization ?? '';
    await verifySession(header.startsWith('Bearer ') ? header.slice(7) : '');

    const body = method === 'POST' || method === 'PATCH' || method === 'PUT' ? await readJson(req) : undefined;
    let m;

    if (method === 'GET' && path === '/status') {
      const heartbeat = db.prepare("SELECT value FROM meta WHERE key = 'worker_heartbeat'").get()?.value;
      const context = store.settings.context();
      return [200, {
        worker: { paused: queue.paused(), heartbeat: heartbeat ? JSON.parse(heartbeat) : null, codex_found: Boolean(codexInfo()) },
        queue: queue.counts(), gmail: store.settings.collector('gmail'), mail_senders: store.settings.mailSenders().length,
        context_updated_at: context.updated_at,
      }];
    }
    if (method === 'POST' && path === '/worker/resume') { queue.resume(); store.audit('worker_resumed', 'user'); return [200, { paused: null }]; }

    // jobs
    if (method === 'GET' && path === '/jobs') {
      const states = url.searchParams.get('state')?.split(',').filter(Boolean);
      return [200, { jobs: queue.list({ states, limit: 100 }) }];
    }
    if (method === 'POST' && path === '/jobs') {
      const type = oneOf(body.type, 'type', USER_JOB_TYPES);
      const input = validateJobInput(type, body.input ?? {});
      const dedupeKey = body.dedupe_key ? text(body.dedupe_key, 'dedupe_key', { max: 300 }) : undefined;
      return [201, queue.enqueue({ type, input, source: 'user', dedupeKey })];
    }
    if ((m = path.match(/^\/jobs\/([\w-]+)$/)) && method === 'GET') {
      const job = queue.get(m[1]);
      if (!job) throw new NotFoundError('job not found');
      return [200, { job }];
    }
    if ((m = path.match(/^\/jobs\/([\w-]+)\/(cancel|retry)$/)) && method === 'POST') return [200, { job: m[2] === 'cancel' ? queue.cancel(m[1]) : queue.retry(m[1]) }];

    // memos
    if (method === 'GET' && path === '/memos') {
      const project = url.searchParams.get('project_id');
      return [200, { memos: store.memos.list(project === null ? {} : { projectId: project || null }) }];
    }
    if (method === 'POST' && path === '/memos') return [201, store.memos.create(body)];
    if ((m = path.match(/^\/memos\/([\w-]+)$/))) {
      if (method === 'PATCH') return [200, { memo: store.memos.update(m[1], body) }];
      if (method === 'DELETE') return [200, { memo: store.memos.remove(m[1]) }];
    }
    if ((m = path.match(/^\/memos\/([\w-]+)\/obsidian-state$/)) && method === 'POST') {
      return [200, { memo: store.memos.setObsidianState(m[1], oneOf(body.state, 'state', ['pending_retry', 'synced', 'none'])) }];
    }

    // milestones
    if (method === 'GET' && path === '/milestones') return [200, { milestones: store.milestones.list({ projectId: url.searchParams.get('project_id') || undefined }) }];
    if (method === 'POST' && path === '/milestones') return [201, store.milestones.create(body)];
    if ((m = path.match(/^\/milestones\/([\w-]+)$/))) {
      if (method === 'PATCH') return [200, { milestone: store.milestones.update(m[1], body) }];
      if (method === 'DELETE') return [200, { milestone: store.milestones.remove(m[1]) }];
    }
    if ((m = path.match(/^\/milestones\/([\w-]+)\/history$/)) && method === 'GET') return [200, { history: store.milestones.history(m[1]) }];

    // inbox
    if (method === 'GET' && path === '/inbox') {
      const states = url.searchParams.get('state')?.split(',').filter(Boolean);
      return [200, { items: store.inbox.list({ states }) }];
    }
    if (method === 'POST' && path === '/inbox') {
      const captured = store.inbox.capture(body, /^https?:\/\/\S+$/.test(String(body.text ?? '').trim()) ? 'link' : 'manual');
      if (!captured.duplicate) queue.enqueue({ type: 'classify_inbox', input: { item_id: captured.item.id }, source: 'user', dedupeKey: `classify:${captured.item.id}` });
      return [201, captured];
    }
    if ((m = path.match(/^\/inbox\/([\w-]+)\/state$/)) && method === 'POST') {
      const state = oneOf(body.state, 'state', ['applied', 'undone', 'dismissed', 'duplicate', 'classified']);
      return [200, { item: store.inbox.setState(m[1], state, {
        created_task_id: body.created_task_id ? id(body.created_task_id, 'created_task_id') : undefined,
        duplicate_of_task_id: body.duplicate_of_task_id ? id(body.duplicate_of_task_id, 'duplicate_of_task_id') : undefined,
      }) }];
    }
    if ((m = path.match(/^\/inbox\/([\w-]+)\/reclassify$/)) && method === 'POST') {
      store.inbox.get(m[1]);
      return [201, queue.enqueue({ type: 'classify_inbox', input: { item_id: m[1] }, source: 'user' })];
    }

    // approvals
    if (method === 'GET' && path === '/approvals') return [200, { approvals: store.approvals.list({ states: url.searchParams.get('state')?.split(',').filter(Boolean) }) }];
    if (method === 'GET' && path === '/approvals/urgent') return [200, { approvals: store.approvals.urgent(date(url.searchParams.get('date') || tokyoDate(now()), 'date')) }];
    if (method === 'POST' && path === '/approvals') return [201, { approval: store.approvals.create(body) }];
    if ((m = path.match(/^\/approvals\/([\w-]+)\/decide$/)) && method === 'POST') return [200, { approval: store.approvals.decide(m[1], body) }];
    if ((m = path.match(/^\/approvals\/([\w-]+)\/finish$/)) && method === 'POST') {
      return [200, { approval: store.approvals.finish(m[1], oneOf(body.outcome, 'outcome', ['applied', 'failed', 'stale']), typeof body.detail === 'string' ? body.detail : '') }];
    }
    if ((m = path.match(/^\/approvals\/([\w-]+)\/events$/)) && method === 'GET') return [200, { events: store.approvals.events(m[1]) }];

    // task extensions
    if (method === 'GET' && path === '/task-meta') return [200, { meta: store.taskMeta.all() }];
    if ((m = path.match(/^\/task-meta\/([\w-]+)$/)) && method === 'PUT') return [200, { meta: store.taskMeta.upsert(m[1], body) }];
    if ((m = path.match(/^\/task-meta\/([\w-]+)\/blocks$/))) {
      if (method === 'GET') return [200, { events: store.taskMeta.blockEvents(m[1]) }];
      if (method === 'POST') return [200, store.taskMeta.block(m[1], body)];
    }
    if (method === 'POST' && path === '/occurrences') return [200, store.taskMeta.recordOccurrence(body)];
    if ((m = path.match(/^\/occurrences\/([\w-]+)$/)) && method === 'GET') return [200, store.taskMeta.occurrences(m[1])];

    // focus
    if (method === 'GET' && path === '/focus') return [200, store.focus.latest(date(url.searchParams.get('date') || tokyoDate(now()), 'date'))];
    if (method === 'POST' && path === '/focus/feedback') return [200, store.focus.feedback(body.date, body.task_id, body.action)];

    // context, settings, search
    if (method === 'PUT' && path === '/context') return [200, store.settings.setContext(body)];
    if (path === '/settings/mail-senders') {
      if (method === 'GET') return [200, { senders: store.settings.mailSenders() }];
      if (method === 'PUT') return [200, { senders: store.settings.setMailSenders(body.senders) }];
    }
    if (method === 'GET' && path === '/search') return [200, store.search(url.searchParams.get('q'))];

    throw new HttpError(404, 'not found');
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    let status = 200;
    let payload;
    try {
      if (!url.pathname.startsWith(`${PREFIX}/`)) throw new HttpError(404, 'not found');
      [status, payload] = await route(req, url);
    } catch (error) {
      status = error instanceof HttpError ? error.status : error instanceof AuthError ? 401 : error instanceof ValidationError ? 400
        : error instanceof NotFoundError ? 404 : error instanceof ConflictError ? 409 : 500;
      if (status === 500) console.error('[mtos-agent]', error);
      payload = { error: status === 500 ? 'internal error' : error.message };
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
}

function main() {
  const env = process.env;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const db = openAgentDb(env.MTOS_AGENT_DB_PATH ?? join(root, 'data', 'mtos-agent.db'));
  const app = createAgentApp({ db, verifySession: createSessionVerifier({ p0Url: env.MTOS_P0_URL ?? 'http://127.0.0.1:8787' }) });
  const port = Number(env.MTOS_AGENT_PORT ?? 8788);
  // Loopback only; reachable from Vercel through the P0 Cloudflare tunnel path rule.
  createServer(app).listen(port, '127.0.0.1', () => console.log(`mtos-agent listening on 127.0.0.1:${port}`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
