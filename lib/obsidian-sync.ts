/** Vault-relative Markdown path the app may propose writes to. Hidden folders (e.g. `.obsidian/`) are excluded. */
export function safeNotePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path || path.length > 400 || !/\.md$/i.test(path) || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
  return path;
}

export type ObsidianWriteDecision =
  | { action: 'write'; expectedSha: string | undefined }
  | { action: 'stale'; reason: string };

/**
 * Re-checks the note right before writing an approved change. An approval is
 * only valid for the exact version the user reviewed: any change since then
 * (or a note that appeared/disappeared) makes it stale instead of overwriting.
 */
export function decideObsidianWrite(mode: unknown, approvedBaseSha: unknown, current: { sha: string } | null): ObsidianWriteDecision {
  if (mode === 'new') {
    return current ? { action: 'stale', reason: '새 노트를 만들려던 경로에 이미 노트가 생겼어.' } : { action: 'write', expectedSha: undefined };
  }
  if (!current) return { action: 'stale', reason: '승인한 노트가 Vault에서 사라졌어.' };
  if (typeof approvedBaseSha !== 'string' || approvedBaseSha !== current.sha) return { action: 'stale', reason: '승인 이후 노트가 바뀌었어. 다시 비교해서 제안받아줘.' };
  return { action: 'write', expectedSha: current.sha };
}
