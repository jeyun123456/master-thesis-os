// Asia/Tokyo has no DST, so a fixed +09:00 offset is exact.
const JST_OFFSET_MS = 9 * 3600_000;
export const COLLECT_HOURS_JST = [6, 18];

/** Calendar date (YYYY-MM-DD) in Asia/Tokyo. */
export function tokyoDate(ms = Date.now()) {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The most recent 06:00/18:00 JST slot at or before `ms`, as
 * { key: 'YYYY-MM-DDTHH', at: epoch ms }. The key doubles as the job dedupe
 * key, so a slot runs once even if the worker restarts or two ticks race.
 */
export function latestCollectSlot(ms = Date.now(), hours = COLLECT_HOURS_JST) {
  const shifted = new Date(ms + JST_OFFSET_MS);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const sorted = [...hours].sort((a, b) => b - a);
  for (const dayOffset of [0, -1]) {
    for (const hour of sorted) {
      const slotShifted = day + dayOffset * 86_400_000 + hour * 3600_000;
      const at = slotShifted - JST_OFFSET_MS;
      if (at <= ms) return { key: `${new Date(slotShifted).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}`, at };
    }
  }
  throw new Error('no collect slot found');
}

/**
 * Whether the latest slot should be enqueued now. A slot missed while the PC
 * was off still runs once when the worker comes back, but only within
 * `maxLateMs` so a long outage does not trigger a stale catch-up run.
 */
export function slotDue(slot, ms, maxLateMs = 11 * 3600_000) {
  return ms - slot.at <= maxLateMs;
}
