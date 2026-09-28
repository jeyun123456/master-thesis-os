export type DailySyncStatus = {
  status: string;
  jobRunning?: boolean;
  lastSyncAt?: string | null;
  jobError?: string;
  jobErrorCode?: string;
  lastError?: string;
  lastErrorCode?: string;
};

type WaitOptions<TStatus extends DailySyncStatus> = {
  start: () => Promise<void>;
  readStatus: () => Promise<TStatus>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
};

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isRunning(status: DailySyncStatus): boolean {
  return status.jobRunning === true || status.status === 'running';
}

export async function startAndWaitForDailySync<TStatus extends DailySyncStatus>({
  start,
  readStatus,
  timeoutMs = 180_000,
  pollIntervalMs = 1_000,
  delay = sleep,
}: WaitOptions<TStatus>): Promise<TStatus> {
  const before = await readStatus();
  const startedAlready = isRunning(before);
  if (!startedAlready) await start();

  const baselineSyncAt = before.lastSyncAt || null;
  let sawRunning = startedAlready;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await delay(pollIntervalMs);
    const current = await readStatus();
    if (isRunning(current)) {
      sawRunning = true;
      continue;
    }

    if (current.status === 'failed' || current.jobErrorCode || current.jobError) {
      throw new Error(current.jobError || current.lastError || '동기화에 실패했어요.');
    }
    if (current.status === 'completed' && (sawRunning || (current.lastSyncAt && current.lastSyncAt !== baselineSyncAt))) {
      return current;
    }
  }

  throw new Error('동기화가 제한 시간 안에 끝나지 않았어요. 상태를 다시 확인해 주세요.');
}
