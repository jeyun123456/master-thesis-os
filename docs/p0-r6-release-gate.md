# PR #15 — 정적 구성 대조 결과 (2026-10-25)

**판정: 연구·자료 빈 화면은 PR 회귀로 입증되지 않음. 코드 변경 필요 없음.**
**릴리스 상태: 조건부 병합 준비.** 실사용·기기·운영 호출 검증은 사용자 요청으로 생략한다. 실제 `main` 병합과 자동 Production 배포는 별도 최종 승인 전까지 수행하지 않는다.

## 근거와 조치

- `main` 및 `feat/integrate-p0-tasks`의 `lib/github.ts`, `lib/vault-repository.ts`, `lib/google-drive.ts`, `lib/projects.ts`는 Git blob SHA까지 동일하다. 연구 프로젝트/Drive API의 핵심 데이터 조회 동작은 미변경이고 P0 세션 인증만 앞에 추가됐다.
- Windows 스테이징의 `ops/staging/.env.example`은 Next/P0 관련 설정만 안내하며, Vault용 `GITHUB_OWNER`/`GITHUB_REPO`/`GITHUB_BRANCH`/`GITHUB_TOKEN` 및 자료실용 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`의 운영 값을 제공하지 않는다. 따라서 **그 스테이징에서의 'Vault 설정 필요' 및 'Drive OAuth 필요'는 데이터 삭제나 PR 회귀의 증거가 아니다.**
- Vercel의 Production/Preview에는 GitHub·Drive 관련 환경변수 *등록 항목*이 존재한다. 다만 민감 변수의 값은 접근 권한상 가려져 있어 유효성·실제 조회 성공을 증명하지 못했다. Production `MTOS_PUBLIC_ORIGIN`은 `https://master-thesis-os.vercel.app`, `P0_API_URL`은 `https://p0-api.chocomintudon.com`으로 등록돼 있다.
- API 보호 로직의 **P0 세션 의존성은 실제 동작 변경**이다. P0가 중단되거나 미인증이면 기존 연구·자료 API도 데이터를 내주지 않는다. 이를 단순한 환경 미구성과 혼동하지 않는다.
- 최신 확인 당시 PR HEAD `052a505`의 GitHub Actions CI는 성공, Vercel Preview는 READY였다. 코드·운영 환경·사용자 데이터를 수정하지 않고 정적 비교만 수행했다.

## 최소 후속 처리

1. **병합 전:** Production/Preview의 Vault·Drive 민감 환경변수 값이 유효한지 확인할 수 있는 권한 있는 운영자가 설정을 확인한다. 이 단계에서 값이나 토큰을 문서·채팅·로그에 기록하지 않는다. 실사용 테스트를 생략한다는 결정은 별도로 유지한다.
2. **병합 판단:** 연구·자료 화면은 **'스테이징 구성 미확인 / 회귀 증거 없음'**으로 분류한다. 테스트용 할 일 정리와 로그아웃 401 수동 재확인은 별도 선택 항목이며 PR 회귀 판정의 근거가 아니다.
3. **병합 후:** 기존 Vercel 자동 배포 유지. 이전 Production 배포를 복구 기준으로 확보한다. 사용자가 실전 테스트를 보류한 이상 실제 운영 기능은 **미검증 상태**로 명시한다. 장애 신고 또는 배포 실패 시 기존 배포로 롤백한다.
4. Google Drive **백업 자동화**는 계속 보류한다. 이는 초코민트랩 **자료실 읽기 OAuth**와 별개의 기능이다.
5. P0 소스 별도 브랜치 게시, 실기기 동기화, Windows 재부팅 검증은 후속 운영 작업으로 남긴다.

**참고:** 아래 원문 G1–G7 목록은 당시의 엄격한 검증 기준을 기록한 이력이다. 위 사용자 승인 범위의 정적 판단을 덮어쓰지 않는다.

---

# 이전 릴리스 게이트 기록 — 2026-10-25 (보존)

**Decision: NO-GO for merge and Production promotion.** The app feature branch has been pushed to PR #15 and its latest Preview is READY, but the release gates below remain open. PR #15 is still unmerged; Production remains unchanged.

## G1 — Network and security: partial / block

- Dedicated Cloudflare tunnel and Access Service Auth policy were previously verified; unauthenticated external requests returned the Access sign-in response.
- Vercel Preview previously reached the configured P0 upstream through the service token.
- The dedicated tunnel is currently healthy. A limited-privilege `MTOS_P0_CloudflareTunnel` logon task was registered; a controlled stop/start through that task restored the tunnel. The active `MTOS_Staging_P0` task is enabled and `Run-Stage.ps1` launches from the expected P0 source checkout. P0/Next local checks returned HTTP 200; unauthenticated external P0 health returned HTTP 302. A real reboot/user-logon cycle has not been exercised. The staging Next process was serving stale build assets after a rebuild; only the verified `MTOS_Staging_Next` task/process was restarted, after which all 9 referenced scripts returned HTTP 200 and the local Google sign-in gate rendered correctly.
- The Preview deployment for app-code commit `171dcdc` is READY. Its root returns HTTP 200 with the app login-check screen; authenticated user flows remain untested.

## G2 — Authentication: block

- Single-account Google sign-in/session UI and P0 API auth/session tests are implemented.
- `Run-Stage.ps1 -Mode Preflight` passed for the staging configuration, whose protected P0 store requires both `GOOGLE_CLIENT_ID` and `ALLOWED_GOOGLE_SUB` before P0 can start. `/api/p0/session` returns configured=true and authenticated=false on the isolated browser harness; the tailnet-only HTTPS origin `https://hermes-laptop.tail315532.ts.net:10000` rendered the Google sign-in button without horizontal overflow. The user completed sign-in; a read-only check found a new unrevoked staging session at 2026-10-25 13:34 KST (no identity or token printed), confirming P0 accepted an allowed account. The browser harness uses a separate cookie jar, so post-logout 401 and signed-in CRUD remain unverified. Preview interaction is still behind Vercel SSO. Do not test a real disallowed account: P0 writes a rejected valid `sub` to its audit log.

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
