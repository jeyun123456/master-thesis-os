// Shapes returned by the agent's read-only /ops endpoints (see services/mtos-agent/src/ops/api.js).
export type OpsDisk = { id: string; size: number; free: number; freePct: number | null };
export type OpsSample = {
  ts: number; cpu: number | null; memTotal: number; memAvail: number; memUsedPct: number; commitUsed: number; commitLimit: number; commitPct: number | null;
  standby: number | null; modified: number | null; compressedWs: number | null; pagefileUsedMb: number | null; pagefileSizeMb: number | null; procCount: number; disks: OpsDisk[];
};
export type OpsOverview = {
  now: number; stale: boolean; sample: OpsSample | null; bootAt: string | null; uptimeSec: number | null;
  services: { expected: number; running: number; down: string[] };
  alerts: { crit: number; warn: number; info: number };
  collector: { runs: number; failures: number; lastAt: number | null; lastMs: number | null; lastError: string | null; rssMb: number | null; inventoryAt: number | null; intervals: { fast: number; inventory: number; slow: number }; rows: Record<string, number> };
};
export type OpsProcess = {
  pid: number; ppid: number; name: string; group: string; label: string; category: string; role: string | null; path: string | null; cmd: string; startedAt: string | null;
  parentAlive: boolean; ws: number | null; priv: number | null; cpu: number | null; threads: number | null; mcp: { name: string; registered: boolean } | null;
};
export type OpsGroup = { id: string; label: string; category: string; role: string | null; expected: boolean; tracked: boolean; n: number; ws: number; priv: number; cpu: number };
export type OpsProcesses = { inventoryAt: number | null; total: number; processes: OpsProcess[]; groups: OpsGroup[]; note: string };
export type OpsCollectorState = { name: string; last_checked_at: string | null; last_success_at: string | null; last_error: string | null; connected: boolean; session: string | null; pending: number; lastJobError: string | null };
export type OpsServices = {
  services: Array<{ id: string; name: string; category: string; role: string | null; expected: boolean; status: string; pid: number | null; processCount: number; memory: number | null; workingSet: number | null; cpu: number | null; startedAt: string | null; launchMethod: string; via: string | null; restartsObserved7d: number; flags: string[] }>;
  windowsServiceErrors: Array<{ at: string; id: number; msg: string }>;
  logical: Array<{ name: string; port?: number; from: string; status: string }>;
  collectors: OpsCollectorState[];
  codexRuns: Array<{ type: string; state: string; model: string | null; started_at: string | null; finished_at: string | null }>;
};
export type OpsPoint = { ts: number; [key: string]: number | string | null };
export type OpsTrend = { range: '1h' | '24h' | '7d'; since: number; until: number; groups: string[]; system: OpsPoint[]; diskSeries: OpsPoint[]; groupSeries: Array<{ ts: number; grp: string; ws: number; priv: number; n: number }>; note: string };
export type OpsItem = {
  id: string; name: string; category: string; ownerApplication: string | null; launchMethod: string; launchCondition: string | null; processId: number | null; parentProcessId: number | null; executablePath: string | null;
  status: string; memoryUsage: number | null; cpuUsage: number | null; lastSeenAt: string | null; processCount: number; flags: string[]; notes: string; role?: string | null; expected?: boolean; lastResult?: number; nextRun?: string | null;
};
export type OpsFlag = { kind: 'duplicate_suspect' | 'orphan_suspect' | 'parallel_instances'; subject: string; severity: 'warn' | 'info'; detail: string };
export type OpsTreeNode = { pid: number; name: string; label: string; group: string; category: string; ws: number | null; priv: number | null; cpu: number | null; startedAt: string | null; cmd: string; mcp: { name: string; registered: boolean } | null; children: OpsTreeNode[] };
export type OpsBackground = {
  inventoryAt: number | null; total: number; items: OpsItem[]; flags: OpsFlag[]; tree: OpsTreeNode[]; tools: { docker: boolean; wsl: boolean; pm2: boolean } | null;
  counts: { registeredMcp: number; runningMcp: number; runningMcpProcesses: number; tasks: number; startup: number };
};
export type OpsAi = {
  school: { mail: Omit<OpsCollectorState, 'name' | 'lastJobError'>; notices: Omit<OpsCollectorState, 'name' | 'lastJobError'> };
  queue: Record<string, number>; pendingInbox: number; workerHeartbeat: { at?: string; [key: string]: unknown } | null;
  lastYolo: { id: string; mode: string; model: string | null; status: string; started_at: string; finished_at: string | null; error: string | null } | null;
  recentYolo: Array<{ status: string; n: number }>;
  jobsByType: Array<{ type: string; state: string; runner: string | null; model: string | null; finished_at: string | null; error: string | null }>;
};
export type OpsAlert = { id: string; kind: string; severity: 'crit' | 'warn' | 'info'; title: string; detail: string; since: number | null };
export type OpsAlerts = { alerts: OpsAlert[]; settings: Record<string, number>; defaults: Record<string, number>; bounds: Record<string, [number, number]> };
