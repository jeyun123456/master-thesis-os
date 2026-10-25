# P0 integration release gate snapshot — 2026-10-25

**Decision: NO-GO for merge and Production promotion.** The app feature branch has been pushed to PR #15 and its latest Preview is READY, but the release gates below remain open. PR #15 is still unmerged; Production remains unchanged.

## G1 — Network and security: partial / block

- Dedicated Cloudflare tunnel and Access Service Auth policy were previously verified; unauthenticated external requests returned the Access sign-in response.
- Vercel Preview previously reached the configured P0 upstream through the service token.
- The dedicated tunnel is currently healthy. A limited-privilege `MTOS_P0_CloudflareTunnel` logon task was registered; a controlled stop/start through that task restored the tunnel. The active `MTOS_Staging_P0` task is enabled and `Run-Stage.ps1` launches from the expected P0 source checkout. P0/Next local checks returned HTTP 200; unauthenticated external P0 health returned HTTP 302. A real reboot/user-logon cycle has not been exercised. The staging Next process was serving stale build assets after a rebuild; only the verified `MTOS_Staging_Next` task/process was restarted, after which all 9 referenced scripts returned HTTP 200 and the local Google sign-in gate rendered correctly.
- The Preview deployment for app-code commit `171dcdc` is READY. Its root returns HTTP 200 with the app login-check screen; authenticated user flows remain untested.

## G2 — Authentication: block

- Single-account Google sign-in/session UI and P0 API auth/session tests are implemented.
- `Run-Stage.ps1 -Mode Preflight` passed for the staging configuration, whose protected P0 store requires both `GOOGLE_CLIENT_ID` and `ALLOWED_GOOGLE_SUB` before P0 can start. `/api/p0/session` returns configured=true and authenticated=false on both loopback and the tailnet-only HTTPS origin `https://hermes-laptop.tail315532.ts.net:10000`; the root renders the Google sign-in button with no horizontal overflow. No client ID or subject value was exposed or changed. Actual allowed-account sign-in and post-logout 401 remain unverified: no Google account has been selected for local staging, and interactive Preview access is behind Vercel SSO. Do not test a real disallowed account yet: P0 writes a rejected valid `sub` to its audit log.

## G3 — Home CRUD: block pending browser check

- Home task workspace and create/update/complete/delete/read-state flows are implemented and unit/integration tested.
- The signed-out local browser rendered the Google sign-in button after the staging Next asset refresh. The interactive task sequence—create → edit → complete → undo → refresh—has not been exercised in a signed-in browser.

## G4 — Devices, offline, and conflict: block pending real devices

- P0 sync tests cover offline create/update/delete, restart persistence, idempotent retry, cross-device task state, and conflict resolution. A 390px mobile-viewport emulation of the signed-out gate showed no horizontal overflow and rendered the Google button after GIS loaded; this is not a real-device check.
- PC↔mobile, a real offline/reconnect cycle, and a real same-field conflict have not been checked on the deployed Preview.

## G5 — Backup and restore: block pending real Drive

- The dedicated `drive.file` uploader/downloader, DPAPI setup, local encryption, hash verification, deduplication, restore guard, and Shared Drive API compatibility are implemented and covered by the P0 test suite.
- Local encrypted backup decryption, SQLite integrity, restore into an isolated staging clone, and a fresh staging-only `Run-Stage.ps1 -Mode Backup` create/verify run passed. An existing local-only Task Scheduler job, `MTOS_Staging_Backup`, is enabled daily at 03:30 Asia/Seoul; its 2026-10-25 run returned 0. It calls the guarded staging backup path, not Drive; retention has no automatic deletion. No live Drive upload/download was verified: the configured destination is a personal My Drive folder and the service-account upload returned 403.
- The user chose to keep authentication unchanged and pause Drive automation. Local encrypted backups remain available; no Drive scheduled task is registered. The 03:00 Asia/Seoul schedule is policy only if Drive automation is re-enabled; local backup artifacts have no automatic deletion.

## G6 — Existing data: partial / block

- P0 migration tests preserve legacy task data while introducing `unclassified` and shared seen-state. The live staging DB was not modified by these tests.
- No Production DB, Vault, or Planner data was changed. A representative research/material screen has not been opened and verified on the current Preview.

## G7 — CI: block

- Local `pnpm lint`, `pnpm build`, targeted Vitest (5 files / 19 tests), P0 `node --test` (40 tests), syntax checks, and PowerShell parser checks passed. GitHub Actions `verify` and the Vercel Preview check passed for app-code commit `171dcdc8`; the subsequent changes here are documentation-only. No Production deployment or promotion was performed.

## Current Production boundary / rollback reference

- Read-only Vercel deployment listing showed the current Production deployment is `dpl_GEEd7v1CSoSuFqEMX6iYYrw9bGfN` from `main` commit `03c3d2564e8891c9e4353128c9d3acf96813970f`, state READY. No Production deployment, promotion, or rollback was performed during this work.
- Treat that deployment as the rollback reference for any separately approved future release. Recheck the current target immediately before a future promotion; Production data and deployment were not modified.

## Required before reconsidering merge

1. Validate the already-protected staging Google client/allowlist and approved HTTPS origin without changing authentication settings; verify allowed-user login and post-logout 401. Do not attempt a real rejected-user login until audit logging no longer stores the rejected `sub`; use synthetic-token tests for denial-path coverage meanwhile.
2. If Drive backup remains in release scope, use an actual Workspace Shared Drive or obtain explicit approval for backup-only OAuth, then verify live upload, downloaded hash, and isolated restore. The current My Drive/service-account path is blocked.
3. Do not register a scheduled Drive task under the current local-only decision. If Drive automation is later re-enabled, validate a manual remote backup/restore first, then schedule 03:00 Asia/Seoul with indefinite retention and no automatic deletion.
4. The app feature branch is pushed and its latest Preview/CI are green. The P0 implementation remains on a local branch inside the Chocomint Lab workspace; confirm the intended publication route before pushing that separate source branch.
5. Complete the G3/G4 real browser/device checks and G6 representative-screen check.
6. Recheck protected staging/Production boundaries immediately before any merge or promotion; the current rollback reference is recorded above. Only then reconsider PR #15 merge and any automatic Production release.
