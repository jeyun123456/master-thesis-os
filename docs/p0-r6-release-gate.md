# P0 integration release gate snapshot — 2026-10-25

**Decision: NO-GO for merge and Production promotion.** This is a staging/local implementation checkpoint, not a release approval. The local feature branch has not been pushed; PR #15 and the current Production deployment remain unchanged.

## G1 — Network and security: partial / block

- Dedicated Cloudflare tunnel and Access Service Auth policy were previously verified; unauthenticated external requests returned the Access sign-in response.
- Vercel Preview previously reached the configured P0 upstream through the service token.
- The latest home/sync/P0 server changes are local commits and have not been deployed or exercised through the current Preview. Tunnel reboot auto-start and the running P0 process's exact checkout remain unverified.

## G2 — Authentication: block

- Single-account Google sign-in/session UI and P0 API auth/session tests are implemented.
- The real Google OAuth origin/client and `ALLOWED_GOOGLE_SUB` have not been confirmed for the current Preview. No allowed-user login, rejected-user login, or post-logout 401 has been checked against the latest deployed build.

## G3 — Home CRUD: block pending browser check

- Home task workspace and create/update/complete/delete/read-state flows are implemented and unit/integration tested.
- The requested interactive sequence—create → edit → complete → undo → refresh—has not been exercised in a signed-in browser.

## G4 — Devices, offline, and conflict: block pending real devices

- P0 sync tests cover offline create/update/delete, restart persistence, idempotent retry, cross-device task state, and conflict resolution.
- PC↔mobile, a real offline/reconnect cycle, and a real same-field conflict have not been checked on the deployed Preview.

## G5 — Backup and restore: block pending real Drive

- The dedicated `drive.file` uploader/downloader, DPAPI setup, local encryption, hash verification, deduplication, and restore guard are implemented.
- Tests use temporary SQLite databases and a mocked Drive API. No actual Drive folder/service account, uploaded backup, Drive download, isolated full restore, or selective restore has been performed.
- The scheduled task has not been registered. Backup time and retention are not selected; automatic deletion is intentionally disabled.

## G6 — Existing data: partial / block

- P0 migration tests preserve legacy task data while introducing `unclassified` and shared seen-state. The live staging DB was not modified by these tests.
- No Production DB, Vault, or Planner data was changed. A representative research/material screen has not been opened and verified on the current Preview.

## G7 — CI: block

- Local `pnpm lint`, `pnpm build`, targeted Vitest (5 files / 19 tests), P0 `node --test` (40 tests), syntax checks, and PowerShell parser checks passed.
- GitHub Actions for the latest local commits have not run because the commits have not been pushed.

## Required before reconsidering merge

1. Configure and validate the actual Google allowlist and HTTPS origin through protected settings; verify both allowed and disallowed account behavior on current Preview.
2. Provision the dedicated Drive service account/folder, enter the existing P0 backup key only in the masked local DPAPI setup, then confirm a real upload, downloaded hash, and isolated full/selective restore.
3. Choose backup time and retention before registering the scheduled task or implementing pruning.
4. Push the reviewed feature commits to their respective branches; verify current Preview and latest GitHub Actions without changing Production.
5. Complete the G3/G4 real browser/device checks and G6 representative-screen check.
6. Recheck protected staging/Production boundaries and document the rollback target. Only then reconsider PR #15 merge and the automatic Production release.
