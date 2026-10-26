import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OpsAi, OpsAlerts, OpsBackground, OpsOverview, OpsProcesses, OpsServices, OpsTrend } from '../lib/ops-types';
import { ServerOpsPanel } from './server-ops-panel';

const MB = 1024 ** 2;
const NOW = Date.parse('2026-10-26T07:30:00Z');

const overview: OpsOverview = {
  now: NOW, stale: false, bootAt: '2026-10-15T00:26:50Z', uptimeSec: 976_000,
  sample: {
    ts: NOW - 20_000, cpu: 37.5, memTotal: 8050 * MB, memAvail: 319 * MB, memUsedPct: 96, commitUsed: 31.4 * 1024 * MB, commitLimit: 32.6 * 1024 * MB, commitPct: 96.2, standby: 360 * MB, modified: 20 * MB,
    compressedWs: 1156 * MB, pagefileUsedMb: 2326, pagefileSizeMb: 24576, procCount: 444,
    disks: [{ id: 'C:', size: 220 * 1024 * MB, free: 28.7 * 1024 * MB, freePct: 13 }, { id: 'G:', size: 220 * 1024 * MB, free: 14 * 1024 * MB, freePct: 6.4 }],
  },
  services: { expected: 5, running: 4, down: ['Thunderbird (학교 메일 수집)'] },
  alerts: { crit: 2, warn: 0, info: 1 },
  collector: { runs: 10, failures: 0, lastAt: NOW, lastMs: 900, lastError: null, rssMb: 49, inventoryAt: NOW, intervals: { fast: 60_000, inventory: 300_000, slow: 1_800_000 }, rows: {} },
};
const processes: OpsProcesses = {
  inventoryAt: NOW, total: 2, note: 'Working Set은 공유 메모리를 포함하므로 합산값이 실제 물리 메모리 사용량과 같지 않음. 종료/재시작 기능은 제공하지 않음.',
  processes: [{ pid: 21788, ppid: 2332, name: 'node.exe', group: 'mtos-agent-api', label: 'MTOS Agent API', category: 'server', role: 'always', path: 'C:\\Program Files\\nodejs\\node.exe', cmd: 'node C:\\worktrees\\mtos-agent-1.4.0\\services\\mtos-agent\\src\\server.js --token ***', startedAt: '2026-10-26T06:30:00Z', parentAlive: true, ws: 20 * MB, priv: 37 * MB, cpu: 0.4, threads: 11, mcp: null }],
  groups: [{ id: 'mtos-agent-api', label: 'MTOS Agent API', category: 'server', role: 'always', expected: true, tracked: true, n: 1, ws: 20 * MB, priv: 37 * MB, cpu: 0.4 }],
};
const services: OpsServices = {
  services: [{ id: 'proc:p0-api', name: 'P0 API', category: 'server', role: 'always', expected: true, status: 'running', pid: 10556, processCount: 1, memory: 63 * MB, workingSet: 12 * MB, cpu: 0, startedAt: '2026-10-26T02:23:00Z', launchMethod: 'task-scheduler', via: '\\MTOS_Staging_P0', restartsObserved7d: 0, flags: [] }],
  windowsServiceErrors: [], logical: [{ name: 'P0 API', port: 8787, from: 'p0-api', status: 'running' }, { name: 'Thunderbird', from: 'thunderbird', status: 'not_running' }],
  collectors: [{ name: '학교 공지 수집기', last_checked_at: null, last_success_at: null, last_error: null, connected: true, session: 'session_expired', pending: 0, lastJobError: null }], codexRuns: [],
};
const trend: OpsTrend = {
  range: '1h', since: NOW - 3_600_000, until: NOW, groups: ['claude-code'],
  system: [0, 1, 2].map((i) => ({ ts: NOW - 3_600_000 + i * 60_000, cpu: 20 + i, memAvail: (400 - i) * MB, memTotal: 8050 * MB, commitUsed: 30e9, commitLimit: 34e9, diskFreePct: 6 })),
  diskSeries: [{ ts: NOW - 60_000, 'C:': 13, 'G:': 6.4 }], groupSeries: [{ ts: NOW - 60_000, grp: 'claude-code', ws: 1, priv: 500 * MB, n: 2 }], note: '',
};
const background: OpsBackground = {
  inventoryAt: NOW, total: 1, tools: { docker: false, wsl: false, pm2: false }, counts: { registeredMcp: 3, runningMcp: 2, runningMcpProcesses: 4, tasks: 52, startup: 12 },
  flags: [{ kind: 'orphan_suspect', subject: 'hermes-browser-harness#13616', severity: 'info', detail: '부모 PID 13840 종료됨' }],
  items: [{ id: 'mcp-reg:Hermes:aside', name: 'aside', category: 'mcp', ownerApplication: 'Hermes', launchMethod: 'stdio (부모 프로그램이 실행)', launchCondition: null, processId: 26568, parentProcessId: 23436, executablePath: 'aside.exe', status: 'running', memoryUsage: 76 * MB, cpuUsage: 0, lastSeenAt: null, processCount: 2, flags: [], notes: '' }],
  tree: [{ pid: 23436, name: 'python.exe', label: 'Hermes', group: 'hermes', category: 'ai', ws: 1, priv: 380 * MB, cpu: 0, startedAt: null, cmd: '', mcp: null, children: [{ pid: 26568, name: 'aside.exe', label: 'MCP · aside', group: 'mcp:aside', category: 'mcp', ws: 1, priv: 76 * MB, cpu: 0, startedAt: null, cmd: '', mcp: { name: 'aside', registered: true }, children: [] }] }],
};
const ai: OpsAi = {
  school: { mail: { last_checked_at: null, last_success_at: null, last_error: null, connected: true, session: null, pending: 0 }, notices: { last_checked_at: null, last_success_at: null, last_error: 'login', connected: true, session: 'session_expired', pending: 0 } },
  queue: { done: 4 }, pendingInbox: 3, workerHeartbeat: null, recentYolo: [{ status: 'done', n: 5 }], jobsByType: [],
  lastYolo: { id: 'y1', mode: 'incoming', model: 'gpt-6-luna', status: 'done', started_at: '2026-10-26T06:00:00Z', finished_at: null, error: null },
};
const alerts: OpsAlerts = {
  alerts: [{ id: 'commit_high', kind: 'memory', severity: 'crit', title: 'Commit 사용률 과다', detail: '96.2%', since: NOW - 600_000 }],
  settings: { minAvailRamMb: 500 }, defaults: { minAvailRamMb: 500 }, bounds: { minAvailRamMb: [50, 4096] },
};
const preload = { overview, processes, services, trend, background, ai, alerts };
const html = (tab: Parameters<typeof ServerOpsPanel>[0]['initialTab']) => renderToStaticMarkup(<ServerOpsPanel initialTab={tab} preload={preload} />);

describe('ServerOpsPanel', () => {
  it('overview shows memory, commit, disks, uptime, services and the stale/alert banner', () => {
    const out = html('overview');
    for (const text of ['서버 관리', '37.5%', '319MB', '96.2%', '디스크 C: 여유', '디스크 G: 여유', '4/5', 'Thunderbird (학교 메일 수집)', '활성 경고 2건', '메모리 구성', '추정'].filter((t) => t !== '추정')) expect(out).toContain(text);
    expect(out).toContain('11일'); // uptime in days
  });

  it('every tab renders from data without any kill / restart / execute control', () => {
    const expectations: Array<[Parameters<typeof ServerOpsPanel>[0]['initialTab'], string[]]> = [
      ['processes', ['MTOS Agent API', '--token ***', '종료/재시작 기능 없음']],
      ['services', ['P0 API', '작업 스케줄러', '세션 만료']],
      ['trend', ['CPU 사용률', 'Commit 사용률', '디스크 여유 공간', '채우지 않고']],
      ['background', ['등록된 MCP 서버', '고아 프로세스 의심', 'aside', '관계도']],
      ['ai', ['마지막 YOLO 실행', 'gpt-6-luna', '세션 만료 · 재로그인 필요']],
      ['alerts', ['Commit 사용률 과다', '경고 기준']],
    ];
    for (const [tab, texts] of expectations) {
      const out = html(tab);
      for (const text of texts) expect(out, `${tab}: ${text}`).toContain(text);
      expect(out).not.toMatch(/종료하기|강제 종료|재시작하기|Kill|실행하기/);
    }
  });
});
