const MB = 1024 * 1024;

export const DEFAULT_SETTINGS = {
  minAvailRamMb: 500, ramSustainMin: 5, commitPct: 90, commitSustainMin: 5, diskFreePct: 10, mailStaleMin: 6, noticeStaleMin: 15, opsStaleMin: 5,
};
// [min, max] accepted by PUT /ops/settings
export const SETTING_BOUNDS = {
  minAvailRamMb: [50, 4096], ramSustainMin: [1, 120], commitPct: [50, 100], commitSustainMin: [1, 120], diskFreePct: [1, 50], mailStaleMin: [1, 1440], noticeStaleMin: [1, 1440], opsStaleMin: [2, 120],
};

export function settingsFromEnv(env = process.env) {
  const out = { ...DEFAULT_SETTINGS };
  const names = { minAvailRamMb: 'MIN_AVAIL_RAM_MB', ramSustainMin: 'RAM_SUSTAIN_MIN', commitPct: 'COMMIT_PCT', commitSustainMin: 'COMMIT_SUSTAIN_MIN', diskFreePct: 'DISK_FREE_PCT', mailStaleMin: 'MAIL_STALE_MIN', noticeStaleMin: 'NOTICE_STALE_MIN', opsStaleMin: 'OPS_STALE_MIN' };
  for (const [key, suffix] of Object.entries(names)) {
    const n = Number(env[`MTOS_OPS_ALERT_${suffix}`]);
    const [lo, hi] = SETTING_BOUNDS[key];
    if (Number.isFinite(n) && n >= lo && n <= hi) out[key] = n;
  }
  return out;
}

/** True when every sample in the last `minutes` satisfies `test` and the samples actually span most of that window. */
function sustained(samples, now, minutes, test) {
  const from = now - minutes * 60_000;
  const window = samples.filter((s) => s.ts >= from);
  if (window.length < 2 || window[0].ts > from + minutes * 60_000 * 0.25) return null;
  return window.every(test) ? window[0].ts : null;
}

const minutesSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 60_000 : null);

export function evaluateAlerts({ samples, latest, settings, items = [], school = null, collectorStat = null, intervalMs = 60_000, now = Date.now() }) {
  const alerts = [];
  const add = (a) => alerts.push({ severity: 'warn', since: null, ...a });

  if (!latest || now - latest.ts > Math.max(settings.opsStaleMin * 60_000, intervalMs * 3)) {
    add({ id: 'ops_collector_stale', kind: 'monitoring', severity: 'crit', title: '서버 모니터링 수집 중단', detail: latest ? `마지막 수집 ${Math.round((now - latest.ts) / 60_000)}분 전` : '수집된 데이터 없음' });
  }
  if (latest) {
    const ramSince = sustained(samples, now, settings.ramSustainMin, (s) => s.mem_avail < settings.minAvailRamMb * MB);
    if (ramSince) add({ id: 'low_available_ram', kind: 'memory', severity: 'crit', since: ramSince, title: '사용 가능 RAM 부족', detail: `${Math.round(latest.mem_avail / MB)}MB 사용 가능 (기준 ${settings.minAvailRamMb}MB 미만이 ${settings.ramSustainMin}분 이상 지속)` });
    const commitSince = sustained(samples, now, settings.commitSustainMin, (s) => s.commit_limit && (s.commit_used / s.commit_limit) * 100 >= settings.commitPct);
    if (commitSince) add({ id: 'commit_high', kind: 'memory', since: commitSince, title: 'Commit 사용률 과다', detail: `${((latest.commit_used / latest.commit_limit) * 100).toFixed(1)}% (기준 ${settings.commitPct}% 이상이 ${settings.commitSustainMin}분 이상 지속)` });
    for (const d of JSON.parse(latest.disks || '[]')) {
      const pct = d.size ? (d.free / d.size) * 100 : 100;
      if (pct < settings.diskFreePct) add({ id: `disk_low:${d.id}`, kind: 'disk', severity: 'crit', title: `${d.id} 디스크 여유 부족`, detail: `${pct.toFixed(1)}% 남음 (기준 ${settings.diskFreePct}% 미만)` });
    }
  }

  // expected services: only judged when the inventory is fresh enough to trust
  for (const item of items) {
    if (item.id.startsWith('proc:') && item.expected && item.status !== 'running') add({ id: `service_down:${item.id}`, kind: 'service', severity: 'crit', title: `${item.name} 실행 중 아님`, detail: '상시 실행되어야 하는 서비스의 프로세스가 확인되지 않음' });
    if (item.flags?.includes('duplicate_suspect')) add({ id: `duplicate:${item.id}`, kind: 'service', title: `${item.name} 중복 실행 의심`, detail: '동일 서비스의 주 프로세스가 둘 이상 확인됨' });
  }

  if (school) {
    const check = (key, label, limitMin) => {
      const s = school[key];
      if (!s) return;
      const paused = s.session === 'session_expired' || s.session === 'login_required';
      if (paused) { add({ id: `${key}_paused`, kind: 'collector', severity: 'info', title: `${label} 중지 (세션 만료)`, detail: '로그인 세션이 만료되어 의도적으로 중지됨 — 일반 장애 아님. 포털 재로그인 필요.' }); return; }
      if (!s.connected) return;
      const age = minutesSince(s.last_success_at, now);
      if (s.last_error && s.last_checked_at && (!s.last_success_at || Date.parse(s.last_checked_at) > Date.parse(s.last_success_at))) add({ id: `${key}_failing`, kind: 'collector', title: `${label} 수집 연속 실패`, detail: String(s.last_error).slice(0, 160) });
      else if (age !== null && age > limitMin) add({ id: `${key}_stale`, kind: 'collector', title: `${label} 수집 지연`, detail: `마지막 성공 ${Math.round(age)}분 전 (기준 ${limitMin}분)` });
      else if (age === null) add({ id: `${key}_never`, kind: 'collector', severity: 'info', title: `${label} 아직 수집 성공 기록 없음`, detail: '' });
    };
    check('mail', '학교 메일', settings.mailStaleMin);
    check('notices', '학교 공지', settings.noticeStaleMin);
  }
  if (collectorStat?.lastError) add({ id: 'ops_collect_error', kind: 'monitoring', severity: 'info', title: '모니터링 수집 오류', detail: String(collectorStat.lastError).slice(0, 160) });

  const order = { crit: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
