/**
 * Minimal P0 task API client for the on-box agent. It authenticates with the
 * loopback-only service token, so P0 records every write with actor 'ai'.
 */
export class P0Error extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createP0Client({ baseUrl = 'http://127.0.0.1:8787', token, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('P0_SERVICE_TOKEN is required for YOLO task management');
  async function call(method, path, body) {
    const response = await fetchImpl(`${baseUrl}/api/tasks${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new P0Error(`P0 ${method} ${path || '/'} failed: ${data.error ?? response.status}`, response.status);
    return data;
  }
  return {
    async listTasks() { return (await call('GET', '')).tasks; },
    async create(id, fields) { return call('POST', '', { id, op_id: id, fields }); },
    async update(id, baseVersion, changes, opId) { return call('PATCH', `/${id}`, { base_version: baseVersion, changes, ...(opId ? { op_id: opId } : {}) }); },
    async archive(id) { return (await call('DELETE', `/${id}`)).task; },
    async restore(id) { return (await call('POST', `/${id}/restore`)).task; },
    async revisions(id) { return (await call('GET', `/${id}/revisions`)).revisions; },
  };
}
