# Local staging runbook — Master Thesis OS + P0

This is an operator checklist, not a deployment script. It records the local staging topology as of 2026-10-25; the Windows staging tasks and dedicated P0 tunnel are already registered separately. Reading this runbook does not change DNS, Tailscale/Cloudflare ingress, Google OAuth, Production configuration, or data.

## Recommended connection shape

```text
Phone (member of the private tailnet)
  └─ HTTPS, tailnet-only ingress (Tailscale Serve; not Funnel)
       └─ Next.js on this Windows host, 127.0.0.1:3000
            └─ P0_API_URL=http://127.0.0.1:8787
                 └─ P0 on this same host, bound to 127.0.0.1:8787
```

Keep P0 loopback-only. Vercel's `localhost` is the Vercel runtime, not this Windows host. In the read-only check, `https://master-thesis-os.vercel.app/` returned HTTP 200 while `/api/p0/session` returned 404, so that deployed URL is not evidence of the P0-integrated build. Do not point Vercel at `127.0.0.1:8787` and do not expose P0 through Funnel.

The host currently has two separate Node requirements: Next.js declares `22.x`; P0 declares `>=24`. Run them as separate processes with separate runtimes. The system `node.exe` is v26.7.0, suitable for P0 but not the declared Next.js runtime. Use Node 22.x for Next build/start and Node 24+ for P0.

## Current ingress observations

- Tailscale Serve `:8443` remains tailnet-only and proxies to `127.0.0.1:8767`; the original baseline check found no listener on 8767 at that time. It is not the Next.js route.
- The existing public Tailscale Funnel maps `/` to port 8000 and `/gravity-worker` to port 8001. Those are unrelated services and must not be reused or changed.
- Current verified listeners are Next.js `127.0.0.1:3000` and P0 `127.0.0.1:8787`. Next is exposed through tailnet-only Tailscale Serve `:10000`; P0 uses a separate Cloudflare tunnel with Access protection. Local health/session checks passed; unauthenticated external P0 health returns the Access response.
- The staging tasks `MTOS_Staging_P0`, `MTOS_Staging_Next`, and `MTOS_P0_CloudflareTunnel` are registered. After rebuilding `.next`, restart only `MTOS_Staging_Next`; its prior process served stale chunk URLs (404), while a controlled restart made all nine referenced script assets return 200.
- New Serve/Funnel routes and domain/TLS changes require explicit approval. Funnel is public ingress and is not acceptable for P0.

## Templates and environment separation

- `ops/staging/.env.example` is for the Next.js process only. Set `MTOS_PUBLIC_ORIGIN` to the exact HTTPS origin (scheme + host + optional non-default port; no path/query). The route layer fails closed for mutations if this origin is absent or invalid. `P0_API_URL` should remain `http://127.0.0.1:8787`.
- `ops/staging/.env.p0.example` is a reference for a separate P0 process. Do not load P0 secrets into the Next.js environment. Set `MTOS_DB_PATH` to a staging-only absolute path outside both repositories; otherwise P0 falls back to `data/mtos.db` inside its checkout. Keep `MTOS_BACKUP_DIR` outside the database directory and both repositories.
- `MTOS_BACKUP_KEY` must be exactly 64 hexadecimal characters (32 random bytes for AES-256-GCM). Generate and store it in an approved secret manager; keep it separate from the backup files. Never echo it, paste it into chat, or commit a populated environment file. Do not use a real key for the automated test.
- The example files are references and are not automatically loaded. Use protected per-process environment injection. Do not capture environment values in logs or screenshots.

## Local build, startup, and diagnostics

Run commands from `C:\worktrees\master-thesis-os-standalone` in PowerShell. Replace the Node path with the locally installed Node 22 executable; do not put credentials in command arguments.

```powershell
$node22 = 'C:\path\to\node-v22\node.exe'
& $node22 --version
& $node22 node_modules/next/dist/bin/next build --webpack
```

`start-next.ps1` runs a preflight, refuses an occupied port, and binds Next only to `127.0.0.1`. Keep P0 and Next in **separate PowerShell processes** so P0's backup key and Google account allowlist are not inherited by Next.

In the P0-only process, set its protected environment, then from `C:\worktrees\master-thesis-os-p0\tools\master-thesis-os-p0` run the diagnostic and start the server with Node 24+:

```powershell
node.exe C:\worktrees\master-thesis-os-standalone\ops\staging\staging-doctor.mjs --p0
node.exe src\server.js
```

Before starting P0, verify `MTOS_DB_PATH` is explicitly set to a staging-only database path; the P0 source otherwise uses a database under its checkout. Do not run this against an existing or production database.

In a **separate Next-only process** with no P0 secrets, set only the Next environment (`MTOS_PUBLIC_ORIGIN`, `P0_API_URL`, and `PORT`), then start Next from `C:\worktrees\master-thesis-os-standalone` with Node 22:

```powershell
$node22 = 'C:\path\to\node-v22\node.exe'
.\ops\staging\start-next.ps1 -Node22Exe $node22
& $node22 ops/staging/staging-doctor.mjs
```

- `node.exe ...staging-doctor.mjs --p0` checks the P0 runtime, required variables, key format, and path separation. It prints only pass/block status, never values.
- `start-next.ps1` invokes the Next preflight, which checks the 22.x runtime, HTTPS origin, and P0 loopback endpoint before starting the server.
- The full Next doctor checks the local Next session route after startup. A blocker is a diagnostic result, not permission to weaken a security check.

## Authentication, CSRF, and offline-cache boundaries

- The Planner integration keeps the P0 bearer token in an `HttpOnly`, `SameSite=Strict` cookie; production responses add `Secure`. JavaScript/localStorage does not receive that token.
- Native P0 uses a separate same-origin proxy cookie scoped to `/api/p0/native`; the proxy allowlist and methods remain bounded. The service worker caches only its app/static resources and bypasses the proxy API paths, so session/API responses are not put in offline caches.
- Mutation routes require the configured `MTOS_PUBLIC_ORIGIN`; an absent/invalid setting fails closed. Exact `Origin` and Fetch Metadata checks reject cross-origin writes. The HTTP integration suite covers cross-origin create/login rejection and production cookie flags.
- Do not add a broad CORS exception, trust client-supplied `X-Forwarded-For`, or cache `/api/p0/**` to make mobile testing pass.

## Login rate-limit limitation

P0's login limiter allows 10 attempts per 60 seconds per `req.socket.remoteAddress`; it ignores `X-Forwarded-For`, which avoids spoofing but means every phone proxied through the same Next.js process appears as the same P0 peer. That is a shared throttle and can let one client temporarily block other clients. Keep the current safe behavior for this staging run. A future P0 change should use layered limits: keep a server-side network/ingress limit, add an account-level limit only after cryptographically verifying the Google token, or accept a forwarded client identity only when a fixed trusted proxy is the immediate peer and that proxy overwrites the header. Do not trust arbitrary forwarding headers. This integration did not alter the limiter to trust forwarded-IP headers.

Privacy note: the current P0 code writes a rejected, but otherwise valid, Google `sub` into its SQLite audit log when the account is not allowlisted. Do not run a real-user denial test for this staging rehearsal. Redacting or hashing that identifier requires a separate approved P0-source change.

## Google OAuth domain gate

Google's web-client rules require HTTPS JavaScript origins outside localhost, reject raw-IP hosts, require the explicit port when it is not 80, and require a public-suffix-list TLD. Google documents that development/testing/staging projects do not need brand verification when the consent screen remains in **Testing** and only explicitly listed test users can sign in. The P0 protected staging store currently passes a value-free preflight for `GOOGLE_CLIENT_ID` and `ALLOWED_GOOGLE_SUB`, and the local Next session route reports the P0 as configured; neither check exposes the values or verifies Google's cloud-side origin allowlist. The candidate local origin is `https://hermes-laptop.tail315532.ts.net:10000` via tailnet-only Serve; Next uses `:10000`, while the existing `:8443` route to `8767` is unrelated. Verify the exact origin in the existing OAuth client without changing authentication settings, then perform an allowed-account sign-in. No live Google sign-in is claimed. For a published external app, Google requires ownership verification of the top private domains used by the app page, origins, and redirect URIs, so use an owner-controlled domain for production branding.

Sources: [Google Web client origins](https://support.google.com/cloud/answer/6158849?hl=en), [Google OAuth domain ownership and testing/staging exception](https://developers.google.com/identity/verification/authentication-verification), [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve), [Tailscale Funnel](https://tailscale.com/kb/1223/funnel).

## Encrypted-backup rehearsal

Run only the isolated automated rehearsal:

```powershell
pnpm test:p0:backup:isolated
```

It creates a random one-run key in memory and a disposable SQLite database under Hermes `TMPDIR`, calls the read-only P0 backup CLI with only those test paths, verifies/decrypts the backup, checks that the sentinel is not plaintext, mutates and fully restores the test DB, verifies the pre-restore snapshot, runs SQLite `integrity_check`, and deletes the temporary tree. It does not touch the P0 checkout's `data` directory or any real database.

To create and verify a local encrypted snapshot of the protected **staging** DB only (no Drive upload), use the guarded launcher:

```powershell
powershell.exe -NoProfile -File "$env:LOCALAPPDATA\master-thesis-os-staging\p0\ops\Run-Stage.ps1" -Mode Backup
```

A successful run prints only `BACKUP_VERIFIED (path and secrets omitted)`. Re-run after a `.next` rebuild only if needed; restart the Next task separately to refresh served static assets.

For real operations, keep encrypted backups and the 32-byte key in separate protected locations, restrict backup-directory ACLs, and rehearse restore against a disposable copy first. Full restore requires the P0 server to be stopped and overwrites its target DB after preserving a pre-restore snapshot; never use `restore-full` against production without a separately approved recovery plan.

## Real-device checklist (manual; not replaced by desktop automation)

Repeat on **iOS Safari** and **Android Chrome**, on the private HTTPS origin and a tailnet-enrolled phone. Record only pass/fail; never capture tokens, `sub`, cookies, task contents, or account details.

1. Open the exact HTTPS origin; confirm no certificate warning or mixed content. Verify Google sign-in only after the staging OAuth client, test account, and exact origin are approved and accepted by Google Cloud.
2. Inspect session storage without copying values: cookie is `HttpOnly`, `Secure`, `SameSite=Strict`; no bearer token in localStorage, CacheStorage, or service-worker responses.
3. Create, edit, complete, reload, and confirm a task persists. Check that a retry does not duplicate it.
4. With the app loaded, enable airplane mode; exercise only the UI's supported offline actions. Confirm static assets load and API requests are not served from cache.
5. Restore connectivity; confirm queued changes synchronize once and survive reload. Exercise a conflict if the UI supports it.
6. Log out while online; confirm the cookie clears and server session is revoked. Repeat a network-failure logout and verify the UI reports that server revocation could not be confirmed.
7. Repeat after closing/reopening the browser and after a service-worker update. Compare platform behavior; iOS background sync and storage eviction need real-device testing.

Automated HTTP→SQLite, auth-failure, cookie, origin, proxy, and service-worker boundary checks cover the deterministic server behavior. They do not prove Google OAuth acceptance, HTTPS ingress, iOS/Android offline behavior, or background resynchronization.
