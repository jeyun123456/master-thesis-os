'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { agentErrorText, mtosApi } from '../lib/mtos-client';
import type {
  OpsAi, OpsAlerts, OpsBackground, OpsOverview, OpsPoint, OpsProcesses, OpsServices, OpsTreeNode, OpsTrend,
} from '../lib/ops-types';
import styles from './server-ops.module.css';

const REFRESH_MS = 60_000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const PALETTE = ['#3f715e', '#b65c56', '#9a7451', '#4f6f9a', '#7a5c8f', '#8a8a3c', '#3c8a8a', '#a05a8a'];

type Tab = 'overview' | 'processes' | 'services' | 'trend' | 'background' | 'ai' | 'alerts';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: '서버 개요' }, { id: 'processes', label: '프로세스' }, { id: 'services', label: '서비스' }, { id: 'trend', label: '자원 추세' },
  { id: 'background', label: '백그라운드 작업' }, { id: 'ai', label: 'AI·수집기' }, { id: 'alerts', label: '운영 경고' },
];

const CATEGORY: Record<string, string> = {
  server: '서버', collector: '수집기', ai: 'AI', mcp: 'MCP', scheduled: '예약 작업', 'vendor-scheduled': '예약(제조사/기타)', startup: '시작 프로그램', 'windows-service': 'Windows 서비스', app: '앱', other: '기타',
};
const STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' | '' }> = {
  running: { label: '실행 중', tone: 'ok' }, not_running: { label: '미실행', tone: 'warn' }, registered_not_running: { label: '등록만 됨 · 미실행', tone: '' }, remote: { label: '원격 연결', tone: '' },
  disabled: { label: '비활성', tone: '' }, ready: { label: '대기', tone: '' }, stopped: { label: '중지', tone: 'warn' },
};
const SETTING_LABEL: Record<string, string> = {
  minAvailRamMb: '사용 가능 RAM 하한 (MB)', ramSustainMin: 'RAM 부족 지속 시간 (분)', commitPct: 'Commit 사용률 상한 (%)', commitSustainMin: 'Commit 과다 지속 시간 (분)',
  diskFreePct: '디스크 여유 하한 (%)', mailStaleMin: '메일 수집 지연 기준 (분)', noticeStaleMin: '공지 수집 지연 기준 (분)', opsStaleMin: '모니터링 수집 중단 기준 (분)',
};

const fmtBytes = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n >= GB ? `${(n / GB).toFixed(1)}GB` : `${Math.round(n / MB)}MB`);
const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n.toFixed(1)}%`);
const fmtTime = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return '–';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
};
const fmtAgo = (value: number | string | null | undefined, now = Date.now()) => {
  if (value === null || value === undefined) return '기록 없음';
  const sec = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (sec < 90) return `${sec}초 전`;
  if (sec < 5400) return `${Math.round(sec / 60)}분 전`;
  if (sec < 172_800) return `${Math.round(sec / 3600)}시간 전`;
  return `${Math.round(sec / 86_400)}일 전`;
};
const fmtUptime = (sec: number | null) => (sec === null ? '–' : `${Math.floor(sec / 86_400)}일 ${Math.floor((sec % 86_400) / 3600)}시간`);
const launchLabel = (m: string) => (m === 'task-scheduler' ? '작업 스케줄러' : m === 'windows-service' ? 'Windows 서비스' : m === 'startup' ? '시작 프로그램' : m === 'unknown' ? '실행 주체 미확인' : m.startsWith('spawned-by:') ? `부모: ${m.slice(11)}` : m);

/** Optional server-side/test snapshot keyed by endpoint name; when present the hook starts with it and still refreshes. */
const OpsPreload = createContext<Record<string, unknown> | null>(null);

function useOps<T>(name: string, query: Record<string, string | undefined> = {}, enabled = true) {
  const key = JSON.stringify(query);
  const preload = useContext(OpsPreload);
  const initial = (preload?.[name] ?? null) as T | null;
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: initial, error: null, loading: enabled && !initial });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () => {
      mtosApi.ops<T>(name, JSON.parse(key) as Record<string, string | undefined>)
        .then((data) => { if (alive) setState({ data, error: null, loading: false }); })
        .catch((error) => { if (alive) setState((s) => ({ data: s.data, error: agentErrorText(error, '서버 관리 데이터를 불러오지 못했어.'), loading: false })); });
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [name, key, enabled, tick]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

function Status({ status, expected }: { status: string; expected?: boolean }) {
  const s = STATUS[status] ?? { label: status, tone: '' as const };
  const tone = status === 'not_running' && expected ? 'bad' : s.tone;
  return <span className={`${styles.chip} ${tone ? styles[tone] : ''}`}>{s.label}</span>;
}

function Loading({ error, loading, data }: { error: string | null; loading: boolean; data: unknown }) {
  if (error) return <div className={styles.err} role="alert">{error}</div>;
  if (loading && !data) return <div className={styles.empty}>불러오는 중…</div>;
  return null;
}

function Kpi({ label, value, hint, pct, tone }: { label: string; value: string; hint?: ReactNode; pct?: number | null; tone?: 'warn' | 'crit' }) {
  return <div className={`${styles.kpi} ${tone ? styles[tone] : ''}`}>
    <div className={styles.label}>{label}</div>
    <div className={styles.value}>{value}</div>
    {pct !== undefined && pct !== null && <div className={styles.meter}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>}
    {hint && <div className={styles.hint}>{hint}</div>}
  </div>;
}

type Series = { name: string; color: string; points: Array<{ t: number; v: number | null }> };

/** Plain SVG line chart. Gaps in collection break the line instead of being interpolated. */
function LineChart({ title, series, since, until, format, yMax, height = 150 }: { title: string; series: Series[]; since: number; until: number; format: (v: number) => string; yMax?: number; height?: number }) {
  const W = 640; const pl = 46; const pr = 8; const pt = 8; const pb = 20;
  const values = series.flatMap((s) => s.points.map((p) => p.v)).filter((v): v is number => v !== null);
  if (!values.length) return <div className={styles.card}><h3>{title}</h3><div className={styles.empty}>이 기간에 수집된 데이터가 없어.</div></div>;
  const top = yMax ?? (Math.max(...values) * 1.1 || 1);
  const x = (t: number) => pl + ((t - since) / Math.max(1, until - since)) * (W - pl - pr);
  const y = (v: number) => pt + (1 - Math.min(v, top) / top) * (height - pt - pb);
  const paths = series.map((s) => {
    const pts = s.points.filter((p) => p.v !== null).sort((a, b) => a.t - b.t);
    const gaps = pts.slice(1).map((p, i) => p.t - pts[i].t).sort((a, b) => a - b);
    const limit = Math.max((gaps[Math.floor(gaps.length / 2)] ?? 60_000) * 3.5, 150_000);
    let d = ''; let prev: number | null = null;
    for (const p of pts) { d += `${prev === null || p.t - prev > limit ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v as number).toFixed(1)} `; prev = p.t; }
    return { s, d, last: pts.at(-1)?.v ?? null, single: pts.length === 1 ? pts[0] : null };
  });
  return <div className={styles.card}>
    <h3>{title}</h3>
    <svg className={styles.chart} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title}: ${paths.map((p) => `${p.s.name} 최근 ${p.last === null ? '없음' : format(p.last)}`).join(', ')}`}>
      {[0, 0.5, 1].map((f) => <g key={f}><line className={styles.grid} x1={pl} x2={W - pr} y1={y(top * f)} y2={y(top * f)} /><text x={pl - 6} y={y(top * f) + 3} textAnchor="end">{format(top * f)}</text></g>)}
      <text x={pl} y={height - 4}>{fmtTime(since)}</text><text x={W - pr} y={height - 4} textAnchor="end">{fmtTime(until)}</text>
      {paths.map(({ s, d, single }) => <g key={s.name}><path d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" />{single && <circle cx={x(single.t)} cy={y(single.v as number)} r={2.5} fill={s.color} />}</g>)}
    </svg>
    <div className={styles.legend}>{paths.map(({ s, last }) => <span key={s.name}><i style={{ background: s.color }} />{s.name} {last === null ? '' : format(last)}</span>)}</div>
  </div>;
}

function OverviewTab({ overview }: { overview: OpsOverview }) {
  const s = overview.sample;
  const procs = useOps<OpsProcesses>('processes', { limit: '1' });
  if (!s) return <div className={styles.note}>아직 수집된 서버 지표가 없어. 수집기가 시작되면 1분 안에 표시돼.</div>;
  const ram = s.memAvail < 500 * MB ? 'crit' : s.memAvail < 1024 * MB ? 'warn' : undefined;
  const commit = (s.commitPct ?? 0) >= 90 ? 'crit' : (s.commitPct ?? 0) >= 80 ? 'warn' : undefined;
  const svcTone = overview.services.down.length ? 'crit' : undefined;
  return <div className={styles.root}>
    <div className={styles.kpis}>
      <Kpi label="CPU 사용률" value={fmtPct(s.cpu)} pct={s.cpu} hint={`논리 프로세서 기준 · 프로세스 ${s.procCount}개`} />
      <Kpi label="메모리 사용률" value={fmtPct(s.memUsedPct)} pct={s.memUsedPct} tone={ram} hint={`총 ${fmtBytes(s.memTotal)}`} />
      <Kpi label="사용 가능한 RAM" value={fmtBytes(s.memAvail)} tone={ram} hint={`Standby 캐시 ${fmtBytes(s.standby)} 포함 (필요하면 Windows가 회수)`} />
      <Kpi label="Commit 사용률" value={fmtPct(s.commitPct)} pct={s.commitPct} tone={commit} hint={`${fmtBytes(s.commitUsed)} / ${fmtBytes(s.commitLimit)}`} />
      {s.disks.map((d) => <Kpi key={d.id} label={`디스크 ${d.id} 여유`} value={fmtBytes(d.free)} pct={d.freePct === null ? null : 100 - d.freePct} tone={(d.freePct ?? 100) < 10 ? 'crit' : undefined} hint={`${fmtPct(d.freePct)} 남음 / 총 ${fmtBytes(d.size)}`} />)}
      <Kpi label="서버 가동 시간" value={fmtUptime(overview.uptimeSec)} hint={`부팅 ${fmtTime(overview.bootAt)}`} />
      <Kpi label="주요 서비스" value={`${overview.services.running}/${overview.services.expected}`} tone={svcTone} hint={overview.services.down.length ? `중지: ${overview.services.down.join(', ')}` : '상시 실행 대상 모두 실행 중'} />
      <Kpi label="마지막 수집" value={fmtAgo(s.ts, overview.now)} tone={overview.stale ? 'crit' : undefined} hint={`${fmtTime(s.ts)} · 수집기 메모리 ${overview.collector.rssMb ?? '–'}MB`} />
    </div>
    <div className={styles.grid2}>
      <div className={styles.card}>
        <h3>메모리 구성 (Windows 지표)</h3>
        <table className={styles.table}><tbody>
          <tr><td>실제 사용 가능</td><td className={styles.num}>{fmtBytes(s.memAvail)}</td></tr>
          <tr><td>Standby(캐시, 필요 시 회수)</td><td className={styles.num}>{fmtBytes(s.standby)}</td></tr>
          <tr><td>Modified(디스크 기록 대기)</td><td className={styles.num}>{fmtBytes(s.modified)}</td></tr>
          <tr><td>메모리 압축 저장소(Working Set)</td><td className={styles.num}>{fmtBytes(s.compressedWs)}</td></tr>
          <tr><td>Commit (사용 / 한도)</td><td className={styles.num}>{fmtBytes(s.commitUsed)} / {fmtBytes(s.commitLimit)}</td></tr>
          <tr><td>Pagefile (사용 / 크기)</td><td className={styles.num}>{s.pagefileUsedMb ?? '–'}MB / {s.pagefileSizeMb ?? '–'}MB</td></tr>
        </tbody></table>
        <p className={styles.sub}>사용 가능 메모리가 적다는 사실만으로 누수라고 판단하지 않아. 추세 탭에서 시간에 따른 변화를 확인해.</p>
      </div>
      <div className={styles.card}>
        <h3>메모리 상위 그룹 (Private Bytes)</h3>
        <Loading error={procs.error} loading={procs.loading} data={procs.data} />
        {procs.data && <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>그룹</th><th className={styles.num}>프로세스</th><th className={styles.num}>Private</th><th className={styles.num}>Working Set</th></tr></thead>
          <tbody>{procs.data.groups.slice(0, 10).map((g) => <tr key={g.id}><td>{g.label}</td><td className={styles.num}>{g.n}</td><td className={styles.num}>{fmtBytes(g.priv)}</td><td className={styles.num}>{fmtBytes(g.ws)}</td></tr>)}</tbody>
        </table></div>}
        <p className={styles.sub}>Working Set은 프로세스 간 공유 메모리를 중복 포함하므로 합산이 물리 메모리 사용량과 같지 않아.</p>
      </div>
    </div>
  </div>;
}

function ProcessesTab() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState('mem');
  const [view, setView] = useState<'processes' | 'groups'>('processes');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading } = useOps<OpsProcesses>('processes', { q: debounced || undefined, sort, limit: '120' });
  return <div className={styles.root}>
    <div className={styles.controls}>
      <input type="search" placeholder="프로세스 이름·PID 검색" aria-label="프로세스 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value)}><option value="mem">메모리(Private) 순</option><option value="cpu">CPU 순</option><option value="name">이름 순</option><option value="pid">PID 순</option></select>
      <button className={styles.btn} aria-pressed={view === 'processes'} onClick={() => setView('processes')}>프로세스별</button>
      <button className={styles.btn} aria-pressed={view === 'groups'} onClick={() => setView('groups')}>그룹별</button>
      <span className={styles.sub}>읽기 전용 · 종료/재시작 기능 없음</span>
    </div>
    <Loading error={error} loading={loading} data={data} />
    {data && view === 'groups' && <div className={styles.card}><div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>그룹</th><th>분류</th><th className={styles.num}>개수</th><th className={styles.num}>CPU</th><th className={styles.num}>Private</th><th className={styles.num}>Working Set</th></tr></thead>
      <tbody>{data.groups.map((g) => <tr key={g.id}><td>{g.label}</td><td>{CATEGORY[g.category] ?? g.category}</td><td className={styles.num}>{g.n}</td><td className={styles.num}>{fmtPct(g.cpu)}</td><td className={styles.num}>{fmtBytes(g.priv)}</td><td className={styles.num}>{fmtBytes(g.ws)}</td></tr>)}</tbody>
    </table></div></div>}
    {data && view === 'processes' && <div className={styles.card}>
      <div className={styles.sub}>{data.total}개 중 상위 {data.processes.length}개 · 구성 갱신 {fmtAgo(data.inventoryAt)}</div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th className={styles.num}>PID</th><th>이름</th><th>그룹</th><th className={styles.num}>CPU</th><th className={styles.num}>Private</th><th className={styles.num}>WS</th><th className={styles.num}>스레드</th><th>시작</th><th>명령 (민감정보 제거됨)</th></tr></thead>
        <tbody>{data.processes.map((p) => <tr key={p.pid}>
          <td className={styles.num}>{p.pid}</td><td>{p.name}</td><td>{p.label}</td><td className={styles.num}>{p.cpu === null ? '–' : `${p.cpu}%`}</td><td className={styles.num}>{fmtBytes(p.priv)}</td><td className={styles.num}>{fmtBytes(p.ws)}</td>
          <td className={styles.num}>{p.threads ?? '–'}</td><td>{fmtTime(p.startedAt)}</td><td className={`${styles.mono} ${styles.cmd}`} title={p.path ?? undefined}>{p.cmd || p.path || '–'}</td>
        </tr>)}</tbody>
      </table></div>
      <p className={styles.sub}>{data.note}</p>
    </div>}
  </div>;
}

function ServicesTab() {
  const { data, error, loading } = useOps<OpsServices>('services');
  return <div className={styles.root}>
    <Loading error={error} loading={loading} data={data} />
    {data && <>
      <div className={styles.kpis}>{data.logical.map((l) => <div key={l.name} className={styles.kpi}><div className={styles.label}>{l.name}{l.port ? ` · :${l.port}` : ''}</div><div className={styles.value} style={{ fontSize: '1.1rem' }}><Status status={l.status} expected /></div></div>)}</div>
      <div className={styles.card}><h3>서비스·상시 프로세스</h3><div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>이름</th><th>상태</th><th className={styles.num}>PID</th><th className={styles.num}>개수</th><th className={styles.num}>Private</th><th>시작</th><th>실행 방식</th><th className={styles.num}>7일 재시작 관측</th></tr></thead>
        <tbody>{data.services.map((s) => <tr key={s.id}><td>{s.name}{s.flags.length > 0 && <> <span className={`${styles.chip} ${styles.warn}`}>{s.flags.includes('duplicate_suspect') ? '중복 의심' : '확인 필요'}</span></>}</td><td><Status status={s.status} expected={s.expected} /></td><td className={styles.num}>{s.pid ?? '–'}</td><td className={styles.num}>{s.processCount}</td><td className={styles.num}>{fmtBytes(s.memory)}</td><td>{fmtTime(s.startedAt)}</td><td>{launchLabel(s.launchMethod)}{s.via ? ` · ${s.via}` : ''}</td><td className={styles.num}>{s.restartsObserved7d}</td></tr>)}</tbody>
      </table></div></div>
      <div className={styles.card}><h3>수집기</h3><div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>수집기</th><th>세션</th><th>마지막 확인</th><th>마지막 성공</th><th>최근 오류</th></tr></thead>
        <tbody>{data.collectors.map((c) => <tr key={c.name}><td>{c.name}</td><td>{!c.connected ? '미연결' : c.session === 'session_expired' || c.session === 'login_required' ? <span className={`${styles.chip} ${styles.warn}`}>세션 만료 · 의도적 중지</span> : (c.session ?? '정상')}</td><td>{fmtAgo(c.last_checked_at)}</td><td>{fmtAgo(c.last_success_at)}</td><td>{c.last_error ?? c.lastJobError ?? '없음'}</td></tr>)}</tbody>
      </table></div></div>
      <div className={styles.grid2}>
        <div className={styles.card}><h3>최근 Codex/AI 작업</h3>{data.codexRuns.length ? <table className={styles.table}><tbody>{data.codexRuns.map((j, i) => <tr key={i}><td>{j.type}</td><td>{j.state}</td><td>{j.model ?? '–'}</td><td>{fmtTime(j.started_at)}</td></tr>)}</tbody></table> : <div className={styles.empty}>기록 없음</div>}</div>
        <div className={styles.card}><h3>Windows 서비스 오류 (24시간)</h3>{data.windowsServiceErrors.length ? data.windowsServiceErrors.map((e) => <div key={`${e.at}${e.id}`} className={styles.sub}>{fmtTime(e.at)} · {e.msg}</div>) : <div className={styles.empty}>최근 24시간 서비스 비정상 종료 기록 없음</div>}</div>
      </div>
    </>}
  </div>;
}

function TrendTab() {
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('1h');
  const { data, error, loading } = useOps<OpsTrend>('trend', { range });
  const charts = useMemo(() => {
    if (!data) return null;
    const pts = (key: string, map: (v: number) => number = (v) => v): Series['points'] => data.system.map((p: OpsPoint) => ({ t: p.ts, v: typeof p[key] === 'number' ? map(p[key] as number) : null }));
    const total = data.system.find((p) => typeof p.memTotal === 'number')?.memTotal as number | undefined;
    const driveIds = [...new Set(data.diskSeries.flatMap((p) => Object.keys(p).filter((k) => k !== 'ts')))];
    const group = (g: string): Series['points'] => data.groupSeries.filter((r) => r.grp === g).map((r) => ({ t: r.ts, v: r.priv / MB }));
    return {
      cpu: [{ name: 'CPU %', color: PALETTE[0], points: pts('cpu') }],
      ram: [{ name: '사용 가능(MB)', color: PALETTE[0], points: pts('memAvail', (v) => v / MB) }, { name: '사용 중(MB)', color: PALETTE[1], points: data.system.map((p) => ({ t: p.ts, v: typeof p.memAvail === 'number' && typeof p.memTotal === 'number' ? (p.memTotal - p.memAvail) / MB : null })) }],
      commit: [{ name: 'Commit %', color: PALETTE[2], points: data.system.map((p) => ({ t: p.ts, v: typeof p.commitUsed === 'number' && typeof p.commitLimit === 'number' && p.commitLimit ? (p.commitUsed / p.commitLimit) * 100 : null })) }],
      disks: driveIds.map((id, i) => ({ name: `${id} 여유 %`, color: PALETTE[i % PALETTE.length], points: data.diskSeries.map((p) => ({ t: p.ts, v: typeof p[id] === 'number' ? (p[id] as number) : null })) })),
      groups: data.groups.map((g, i) => ({ name: g, color: PALETTE[i % PALETTE.length], points: group(g) })),
      totalMb: total ? total / MB : undefined,
    };
  }, [data]);
  return <div className={styles.root}>
    <div className={styles.controls}>{(['1h', '24h', '7d'] as const).map((r) => <button key={r} className={styles.btn} aria-pressed={range === r} onClick={() => setRange(r)}>{r === '1h' ? '최근 1시간' : r === '24h' ? '최근 24시간' : '최근 7일'}</button>)}<span className={styles.sub}>수집되지 않은 시간대는 채우지 않고 선을 끊어서 표시해.</span></div>
    <Loading error={error} loading={loading} data={data} />
    {data && charts && <div className={styles.grid2}>
      <LineChart title="CPU 사용률" series={charts.cpu} since={data.since} until={data.until} yMax={100} format={(v) => `${Math.round(v)}%`} />
      <LineChart title="RAM (사용 중 / 사용 가능)" series={charts.ram} since={data.since} until={data.until} yMax={charts.totalMb} format={(v) => `${Math.round(v)}MB`} />
      <LineChart title="Commit 사용률" series={charts.commit} since={data.since} until={data.until} yMax={100} format={(v) => `${Math.round(v)}%`} />
      <LineChart title="디스크 여유 공간" series={charts.disks} since={data.since} until={data.until} yMax={100} format={(v) => `${Math.round(v)}%`} />
      <div style={{ gridColumn: '1 / -1' }}><LineChart title="주요 프로세스 그룹 메모리 (Private Bytes)" series={charts.groups} since={data.since} until={data.until} height={200} format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)}GB` : `${Math.round(v)}MB`)} /></div>
    </div>}
  </div>;
}

function Tree({ nodes, depth = 0 }: { nodes: OpsTreeNode[]; depth?: number }) {
  return <ul className={depth ? undefined : styles.tree}>{nodes.map((n) => {
    const head = <><b>{n.label}</b><span className={styles.meta}>PID {n.pid} · {fmtBytes(n.priv)}{n.cpu ? ` · ${n.cpu}%` : ''}{n.mcp ? ' · MCP' : ''}</span></>;
    return <li key={n.pid}>{n.children.length ? <details open={depth < 2}><summary>{head}</summary><Tree nodes={n.children} depth={depth + 1} /></details> : head}</li>;
  })}</ul>;
}

function BackgroundTab() {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('');
  const [minMb, setMinMb] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [view, setView] = useState<'list' | 'tree'>('list');
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, error, loading } = useOps<OpsBackground>('background', { kind, status: status || undefined, minMb: minMb || undefined, q: debounced || undefined });
  return <div className={styles.root}>
    {data && <div className={styles.kpis}>
      <Kpi label="등록된 MCP 서버" value={String(data.counts.registeredMcp)} hint="설정 파일에 등록된 수 (실행 여부와 별개)" />
      <Kpi label="실행 중인 MCP" value={`${data.counts.runningMcp}`} hint={`MCP 프로세스 ${data.counts.runningMcpProcesses}개 · stdio MCP는 부모 프로그램이 필요할 때 실행`} />
      <Kpi label="예약 작업" value={String(data.counts.tasks)} hint="Microsoft 기본 작업 제외" />
      <Kpi label="시작 프로그램" value={String(data.counts.startup)} hint={data.tools ? `Docker ${data.tools.docker ? '있음' : '없음'} · WSL ${data.tools.wsl ? '실행 중' : '없음'} · PM2 ${data.tools.pm2 ? '있음' : '없음'}` : undefined} />
    </div>}
    {data && data.flags.length > 0 && <div className={styles.card}><h3>확인이 필요한 항목 (의심 — 확정 아님)</h3><div className={styles.stack}>{data.flags.map((f, i) => <div key={i} className={`${styles.alert} ${f.severity === 'warn' ? styles.warn : styles.info}`}><b>{f.kind === 'duplicate_suspect' ? '중복 실행 의심' : f.kind === 'orphan_suspect' ? '고아 프로세스 의심' : '병렬 인스턴스'} · {f.subject}</b><span>{f.detail}</span></div>)}</div></div>}
    <div className={styles.controls}>
      <select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="all">전체</option><option value="mcp">MCP</option><option value="ai">AI 에이전트</option><option value="server">서버 서비스</option><option value="scheduled">예약 작업</option><option value="startup">시작 프로그램</option><option value="service">Windows 서비스</option><option value="background">일반 백그라운드</option>
      </select>
      <select aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">모든 상태</option><option value="running">실행 중</option><option value="not_running">미실행</option><option value="registered_not_running">등록만 됨</option><option value="ready">대기</option><option value="disabled">비활성</option><option value="stopped">중지</option></select>
      <input type="number" min={0} placeholder="최소 메모리 MB" aria-label="최소 메모리 MB" value={minMb} onChange={(e) => setMinMb(e.target.value)} style={{ width: 130 }} />
      <input type="search" placeholder="이름·경로 검색" aria-label="검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className={styles.btn} aria-pressed={view === 'list'} onClick={() => setView('list')}>목록</button>
      <button className={styles.btn} aria-pressed={view === 'tree'} onClick={() => setView('tree')}>관계도</button>
    </div>
    <Loading error={error} loading={loading} data={data} />
    {data && view === 'tree' && <div className={styles.card}><h3>실행 관계 (부모 → 자식)</h3>{data.tree.length ? <Tree nodes={data.tree} /> : <div className={styles.empty}>표시할 항목이 없어.</div>}<p className={styles.sub}>부모가 이미 종료된 프로세스는 최상위에 표시돼. 실행 주체를 증명할 수 없으면 추정하지 않아.</p></div>}
    {data && view === 'list' && <div className={styles.card}><div className={styles.sub}>{data.total}개 항목 · 구성 갱신 {fmtAgo(data.inventoryAt)}</div><div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>이름</th><th>분류</th><th>실행 주체</th><th>실행 방식 / 조건</th><th className={styles.num}>PID(부모)</th><th>상태</th><th className={styles.num}>메모리</th><th className={styles.num}>CPU</th><th>마지막 실행/확인</th><th>비고</th></tr></thead>
      <tbody>{data.items.map((i) => <tr key={i.id}>
        <td>{i.name}{i.flags.length > 0 && <> <span className={`${styles.chip} ${styles.warn}`}>확인 필요</span></>}</td><td>{CATEGORY[i.category] ?? i.category}</td><td>{i.ownerApplication ?? '–'}</td>
        <td>{launchLabel(i.launchMethod)}{i.launchCondition ? ` · ${i.launchCondition}` : ''}</td><td className={styles.num}>{i.processId ?? '–'}{i.parentProcessId ? ` (${i.parentProcessId})` : ''}</td>
        <td><Status status={i.status} expected={i.expected} /></td><td className={styles.num}>{fmtBytes(i.memoryUsage)}</td><td className={styles.num}>{i.cpuUsage === null ? '–' : `${i.cpuUsage}%`}</td><td>{fmtTime(i.lastSeenAt)}</td><td>{i.notes || ''}</td>
      </tr>)}</tbody>
    </table></div></div>}
  </div>;
}

function AiTab() {
  const { data, error, loading } = useOps<OpsAi>('ai');
  return <div className={styles.root}>
    <Loading error={error} loading={loading} data={data} />
    {data && <>
      <div className={styles.kpis}>
        <Kpi label="마지막 YOLO 실행" value={data.lastYolo ? fmtAgo(data.lastYolo.started_at) : '기록 없음'} hint={data.lastYolo ? `${data.lastYolo.status} · 모델 ${data.lastYolo.model ?? '–'} · ${data.lastYolo.mode}` : undefined} tone={data.lastYolo?.status === 'failed' ? 'warn' : undefined} />
        <Kpi label="처리 대기 Inbox" value={String(data.pendingInbox)} hint={`큐: ${Object.entries(data.queue).map(([k, v]) => `${k} ${v}`).join(' · ') || '비어 있음'}`} />
        <Kpi label="Worker 하트비트" value={data.workerHeartbeat?.at ? fmtAgo(String(data.workerHeartbeat.at)) : '기록 없음'} />
        <Kpi label="최근 YOLO 20회" value={data.recentYolo.map((r) => `${r.status} ${r.n}`).join(' · ') || '–'} />
      </div>
      <div className={styles.grid2}>
        {(['mail', 'notices'] as const).map((k) => {
          const c = data.school[k];
          const paused = c.session === 'session_expired' || c.session === 'login_required';
          return <div key={k} className={styles.card}><h3>{k === 'mail' ? '학교 메일 수집 (Thunderbird)' : '학교 공지 수집 (포털)'}</h3>
            <table className={styles.table}><tbody>
              <tr><td>연결</td><td>{c.connected ? '연결됨' : '아직 초기화 전'}</td></tr>
              <tr><td>세션 상태</td><td>{paused ? <span className={`${styles.chip} ${styles.warn}`}>세션 만료 · 재로그인 필요</span> : (c.session ?? '정상')}</td></tr>
              <tr><td>마지막 확인</td><td>{fmtAgo(c.last_checked_at)}</td></tr><tr><td>마지막 성공(동기화)</td><td>{fmtAgo(c.last_success_at)}</td></tr>
              <tr><td>대기 항목</td><td>{c.pending}</td></tr><tr><td>최근 오류</td><td>{c.last_error ?? '없음'}</td></tr>
            </tbody></table></div>;
        })}
      </div>
      <div className={styles.card}><h3>작업 종류별 마지막 실행</h3><div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>작업</th><th>상태</th><th>실행기</th><th>모델</th><th>완료</th><th>오류</th></tr></thead>
        <tbody>{data.jobsByType.map((j) => <tr key={j.type}><td>{j.type}</td><td>{j.state}</td><td>{j.runner ?? '–'}</td><td>{j.model ?? '–'}</td><td>{fmtAgo(j.finished_at)}</td><td>{j.error ?? ''}</td></tr>)}</tbody>
      </table></div><p className={styles.sub}>메일 본문·비밀번호·토큰·세션 쿠키는 이 화면에 표시되지 않아.</p></div>
    </>}
  </div>;
}

function AlertsTab({ onChanged }: { onChanged: () => void }) {
  const { data, error, loading, reload } = useOps<OpsAlerts>('alerts');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (data) setDraft(Object.fromEntries(Object.entries(data.settings).map(([k, v]) => [k, String(v)]))); }, [data]);
  const save = async () => {
    if (!data) return;
    const changed = Object.fromEntries(Object.entries(draft).filter(([k, v]) => Number(v) !== data.settings[k]).map(([k, v]) => [k, Number(v)]));
    if (!Object.keys(changed).length) { setMessage('바뀐 값이 없어.'); return; }
    try { await mtosApi.opsSaveSettings(changed); setMessage('저장했어.'); reload(); onChanged(); } catch (e) { setMessage(agentErrorText(e, '저장하지 못했어.')); }
  };
  return <div className={styles.root}>
    <Loading error={error} loading={loading} data={data} />
    {data && <>
      <div className={styles.card}><h3>현재 경고 ({data.alerts.length})</h3>
        {data.alerts.length === 0 ? <div className={styles.empty}>현재 활성 경고가 없어.</div> : <div className={styles.stack}>{data.alerts.map((a) => <div key={a.id} className={`${styles.alert} ${styles[a.severity]}`}><b>{a.title}</b><span>{a.detail}{a.since ? ` · ${fmtTime(a.since)}부터` : ''}</span></div>)}</div>}
      </div>
      <div className={styles.card}><h3>경고 기준</h3>
        <div className={styles.fields}>{Object.keys(data.defaults).map((k) => <label key={k} className={styles.field}>{SETTING_LABEL[k] ?? k}
          <input type="number" value={draft[k] ?? ''} min={data.bounds[k]?.[0]} max={data.bounds[k]?.[1]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
          <span className={styles.sub}>기본 {data.defaults[k]} · 허용 {data.bounds[k]?.[0]}–{data.bounds[k]?.[1]}</span></label>)}</div>
        <div className={styles.controls} style={{ marginTop: 12 }}><button className={`${styles.btn} ${styles.primary}`} onClick={() => void save()}>기준 저장</button>{message && <span className={styles.sub} role="status">{message}</span>}</div>
      </div>
    </>}
  </div>;
}

export function ServerOpsPanel({ initialTab = 'overview', preload = null }: { initialTab?: Tab; preload?: Record<string, unknown> | null }) {
  return <OpsPreload.Provider value={preload}><ServerOpsContent initialTab={initialTab} /></OpsPreload.Provider>;
}

function ServerOpsContent({ initialTab }: { initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const overview = useOps<OpsOverview>('overview');
  const o = overview.data;
  const alertCount = o ? o.alerts.crit + o.alerts.warn : 0;
  return <div className={styles.root}>
    <div className={styles.head}><h2>서버 관리</h2><span className={styles.sub}>읽기 전용 · 60초마다 자동 갱신{o ? ` · 마지막 수집 ${fmtAgo(o.sample?.ts ?? null, o.now)}` : ''}</span></div>
    {o && (o.stale || alertCount > 0) && <div className={`${styles.banner} ${o.stale || o.alerts.crit ? styles.crit : styles.warn}`} role="status">
      {o.stale && <b>모니터링 수집이 멈춘 것 같아.</b>}{alertCount > 0 && <span>활성 경고 {alertCount}건 (긴급 {o.alerts.crit})</span>}
      <button className={styles.btn} onClick={() => setTab('alerts')}>경고 보기</button>
    </div>}
    <div className={styles.tabs} role="tablist">{TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={styles.tab} onClick={() => setTab(t.id)}>{t.label}{t.id === 'alerts' && alertCount > 0 && <span className={styles.badge}>{alertCount}</span>}</button>)}</div>
    {tab === 'overview' && (<><Loading error={overview.error} loading={overview.loading} data={o} />{o && <OverviewTab overview={o} />}</>)}
    {tab === 'processes' && <ProcessesTab />}
    {tab === 'services' && <ServicesTab />}
    {tab === 'trend' && <TrendTab />}
    {tab === 'background' && <BackgroundTab />}
    {tab === 'ai' && <AiTab />}
    {tab === 'alerts' && <AlertsTab onChanged={overview.reload} />}
  </div>;
}
