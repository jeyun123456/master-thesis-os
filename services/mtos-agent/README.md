# mtos-agent

P1/P2 backend for Master Thesis OS: research memos, milestones, the AI inbox, approvals, task extensions (steps, blockers, recurrence), focus recommendations, and the Codex CLI worker. Zero dependencies, Node ≥ 22.13 (`node:sqlite`).

## Boundaries

- **P0 owns tasks and sessions.** The agent never writes the P0 SQLite file and holds no P0 credentials. It accepts a request only when P0 accepts the same bearer token (`GET /api/sessions` on loopback, cached 60 s).
- **Separate DB, separate processes.** `mtos-agent.db` is its own SQLite file. The API (`src/server.js`) and the worker (`src/worker.js`) are separate processes, so a stuck Codex run or a worker crash cannot stop P0 task reads or writes.
- **AI proposes, people approve.** The worker never writes P0, the Vault, or Calendar. Clear inbox tasks are marked `auto_pending`, and the web app creates them with the user's session (idempotent `op_id`, shown as new, undoable). Deadline, stage, milestone, Obsidian, duplicate and conflict changes go through approvals.
- **Loopback only.** The API listens on `127.0.0.1:8788`. Vercel reaches it through the existing P0 Cloudflare tunnel and Access policy using a path rule (see below).

## Worker

- Persistent queue: dedupe keys, priority (user 0 < system 5 < scheduled 10), leases with heartbeat, recovery of jobs whose worker died, exponential backoff (1 min doubling, max 30 min), three attempts by default, and manual retry or cancel of waiting jobs. A running job is never cancelled from the API.
- Codex CLI: `codex exec --ephemeral --sandbox read-only --ignore-user-config --ignore-rules --output-schema …`, prompt over stdin, 180 s timeout, below-normal CPU priority. Every output is re-validated against its schema.
- Auth failure (`Not logged in`, 401 …) pauses the whole queue without spending attempts. The worker re-checks `codex login status` every 10 minutes and resumes by itself; `POST /agent/api/worker/resume` resumes manually. Usage or rate limits count as retryable failures. The worker does not work around either one.
- Mail: `collect_mail` runs at **06:00 and 18:00 Asia/Tokyo** (one job per slot via dedupe key `collect_mail:slot:YYYY-MM-DDTHH`; a missed slot runs once if the worker comes back within 11 hours). It queries Gmail only for allow-listed senders (Settings → mail senders), `gmail.readonly` metadata plus snippet, incrementally from the last success with a 2-hour overlap, deduped by message id.

## Running on the P0 server PC

1. `codex login` as the Windows user that runs the tasks; check with `codex login status`.
2. Create `%LOCALAPPDATA%\MasterThesisOS\agent\agent.env` (keep it private):

   ```dotenv
   MTOS_P0_URL=http://127.0.0.1:8787
   MTOS_AGENT_PORT=8788
   MTOS_AI_MODEL=gpt-5.6-luna
   # Optional: Gmail collection (needs gmail.readonly consent on the refresh token)
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_REFRESH_TOKEN=
   # Same key as P0 backups
   MTOS_BACKUP_KEY=
   MTOS_BACKUP_DIR=
   ```

3. `powershell -File scripts\register-tasks.ps1`, then `Start-ScheduledTask MTOS_Agent_API; Start-ScheduledTask MTOS_Agent_Worker`. Tasks start at logon of that user only.
4. Add a path rule to the P0 tunnel config **above** the existing P0 rule, then restart the tunnel task:

   ```yaml
   ingress:
     - hostname: p0-api.chocomintudon.com
       path: ^/agent/
       service: http://127.0.0.1:8788
     - hostname: p0-api.chocomintudon.com
       service: http://127.0.0.1:8787
   ```

   The existing Access application on that hostname already covers `/agent/*`.
5. Vercel: `MTOS_AGENT_URL=https://p0-api.chocomintudon.com` (same Access service token as P0).

## Backup

`node scripts/backup-cli.js backup | verify <file> | restore-full <file>` with absolute `MTOS_AGENT_DB_PATH`, `MTOS_BACKUP_DIR`, and the P0 `MTOS_BACKUP_KEY`. Same `MTOSBK1` AES-256-GCM container as P0. Local only; Drive upload is intentionally not wired. Restore refuses to run while the API port is open.

## Tests

`node --test test/` (45 tests, temp/in-memory SQLite, fake AI and fake Gmail; no network or real Codex call).
