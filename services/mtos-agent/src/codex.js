import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as osConstants, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';

export class AiAuthError extends Error {}
export class AiRateLimitError extends Error {}
export class AiRunError extends Error {}

const AUTH_PATTERN = /not logged in|log ?in required|please (run|use) [`']?codex login|unauthorized|\b401\b|authentication (failed|required)|token (expired|invalid)/i;
const RATE_PATTERN = /rate.?limit|usage limit|\b429\b|quota|too many requests/i;
const MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

/**
 * Finds a Codex CLI entry point that can be spawned without a shell.
 * npm installs a .cmd shim on Windows, which Node refuses to spawn directly,
 * so the npm package's JS entry is run with the current Node binary instead.
 */
export function detectCodex(env = process.env) {
  const configured = env.MTOS_CODEX_COMMAND?.trim();
  const candidates = [];
  if (configured) candidates.push(configured);
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  if (env.APPDATA) candidates.push(join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return candidate.endsWith('.js')
      ? { command: process.execPath, prefix: [candidate], path: candidate }
      : { command: candidate, prefix: [], path: candidate };
  }
  return null;
}

/**
 * Runs one `codex exec` turn with a JSON-schema-constrained final message.
 * Read-only sandbox, ephemeral session, user config ignored (no MCP servers or
 * hooks), below-normal CPU priority, hard timeout. The prompt goes over stdin
 * and never appears in argv or logs.
 */
export function createCodexRunner({ env = process.env, timeoutMs = 180_000, spawnImpl = spawn } = {}) {
  const model = env.MTOS_AI_MODEL?.trim() || 'gpt-5.6-luna';
  if (!MODEL_PATTERN.test(model)) throw new Error('MTOS_AI_MODEL is invalid');

  async function run({ prompt, schema }) {
    const codex = detectCodex(env);
    if (!codex) throw new AiRunError('Codex CLI not found; set MTOS_CODEX_COMMAND');
    const dir = await mkdtemp(join(tmpdir(), 'mtos-agent-'));
    try {
      const schemaPath = join(dir, 'schema.json');
      const outPath = join(dir, 'last-message.json');
      await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
      const args = [...codex.prefix, 'exec', '--model', model, '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
        '--sandbox', 'read-only', '--color', 'never', '-C', dir, '--output-schema', schemaPath, '--output-last-message', outPath, '-'];
      const { code, output } = await new Promise((resolve, reject) => {
        const child = spawnImpl(codex.command, args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
        let log = '';
        const keep = (chunk) => { log = (log + chunk.toString('utf8')).slice(-8000); };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        const timer = setTimeout(() => { child.kill(); reject(new AiRunError('Codex CLI timed out')); }, timeoutMs);
        child.on('error', (error) => { clearTimeout(timer); reject(new AiRunError(`Codex CLI failed to start: ${error.code ?? error.message}`)); });
        child.on('close', (exitCode) => { clearTimeout(timer); resolve({ code: exitCode, output: log }); });
        child.stdin.end(prompt, 'utf8');
      });
      if (code !== 0) {
        if (AUTH_PATTERN.test(output)) throw new AiAuthError('Codex CLI is not authenticated; run `codex login` on the worker PC');
        if (RATE_PATTERN.test(output)) throw new AiRateLimitError('Codex usage or rate limit reached');
        throw new AiRunError(`Codex CLI exited with code ${code}`);
      }
      const content = await readFile(outPath, 'utf8').catch(() => '');
      try {
        return { output: JSON.parse(content), runner: 'codex-cli', model };
      } catch {
        throw new AiRunError('Codex CLI returned non-JSON output');
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** `codex login status` exits 0 when a login exists; used to auto-resume after an auth pause. */
  async function loginOk() {
    const codex = detectCodex(env);
    if (!codex) return false;
    return new Promise((resolve) => {
      const child = spawnImpl(codex.command, [...codex.prefix, 'login', 'status'], { windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); resolve(false); }, 20_000);
      child.on('error', () => { clearTimeout(timer); resolve(false); });
      child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    });
  }

  return { run, loginOk, model };
}
