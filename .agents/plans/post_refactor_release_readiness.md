# Post-Refactor Regression Verification + Release Readiness

검증일: 2026-10-01 (Asia/Seoul). 범위: C0–C7 현재 commit chain의 read-only regression 및 staged-release readiness. Source 수정, actual artifact publish, deploy, install, restart는 수행하지 않았다.

## Baseline

- Branch: `refactor/architecture-ownership`.
- HEAD: `7a1c6c4009a4b6a3c61a7ef206bda5072344f975` — C7 `chore: verify bridge package completeness and provenance`.
- `origin/main`: `8706d9e3a14aaa367bee7c7d4c4a871d65904909`; `git ls-remote origin refs/heads/main`도 같은 SHA를 반환했다.
- C0–C7 커밋은 모두 HEAD의 ancestor다. C5는 **SKIPPED**, source/module/LOC change 0이다.
- C0–C7 commit chain:
  - C0 `69ec6538d1a076b2869d8af00cf95893bd8a0eaf`
  - C1 `d466e693e4bb64f64085bd59f4f847472025e791`
  - C2 `b9cae7eb8a35380724f3f3d663b243dfab93b98b`
  - C3 `b463233240f10fdb6d8cce391fa2d636568443c2`
  - C4 `74d24c24ac2ee2f5654f65b9d2ecdd3700af9724`
  - C5 SKIPPED; no commit
  - C6 `b9f52d6c515a68eb3feb84d974dbd71c518704fa`
  - C7 `7a1c6c4009a4b6a3c61a7ef206bda5072344f975`
- Before this report, user-local changes were `exporter/export_results.py`, `schemas/decomposition.schema.json`, and `schemas/necessary_labour.schema.json`; all three SHA-256 hashes match `refactor-manifest.json`. The untracked architecture assessment and draft remain untouched. This report is the only file added by this readiness task.
- Tooling: Node `v26.8.2`, Vitest `5.0.0`, TypeScript `5.9.3`, Python `3.14.7`; `pnpm` is unavailable. Existing local `node_modules` tools were used without installing dependencies.
- The assessment records pre-refactor LOC as `bridge.py` 1,816, `calendar.ts` 616, and `page.tsx` 738. Direct counts from the assessment's pinned `origin/main` commit are 1,660, 561, and 684 respectively. This report uses the exact Git object counts below; the assessment/log count discrepancy is unresolved and is a measurement discrepancy, not a runtime finding.

## Verification Results

### Python / Bridge

**PASS.** Safe targeted Python tests: Mail 14, Portal 56, Workspace 18, Thunderbird/shortcut fixtures 24, and the in-process safe subset of `test_bridge.py` 32. The C7 scratch packaging/provenance suite passed 8/8. Total distinct passing Python test cases: 152. Separate fail-closed negative checks for Mail, Portal, and Workspace passed 3/3; those cases also belong to the suites above.

Commands included:

- `python -m unittest test_mail_jobs test_mail_analysis`
- `python -m unittest test_portal_jobs test_portal_ai test_portal`
- `python -m unittest test_workspace_store`
- `python -m unittest test_thunderbird_mail test_shortcut_launcher`
- `scripts/test_bridge_package.py`
- `scripts/check_bridge_package.py --repo-root .`

The safe Bridge subset excluded `InboxBridgeEndpointTests` (8 tests), whose `setUpClass` starts `bridge.py`, binds loopback, and calls `/health`; it also excluded `BridgeConfigurationTests.test_bridge_process_exits_with_config_error_code`, which launches a Python subprocess. This avoids process creation and live Bridge HTTP under this phase's safety boundary. The full `test:bridge` discovery was therefore not run. Current source and client both specify API v7; C0's API-v7 baseline assertion and current static Bridge/package checks agree.

Fail-closed checks deny and record provider, network, browser, process, real-config, outside-fixture DB/filesystem attempts; swallowed attempts still fail at test teardown. All executed Mail/Portal/Workspace owner suites retained their safety mixins and passed. Tests used temporary data and fakes; no real DB, Thunderbird profile, Portal session, AI provider, installed Companion, or actual Bridge process was used.

The source package checker reports a complete 15-file package (14 local Python modules plus `start_bridge.ps1`) at Bridge API v7. The 8 scratch tests cover missing imported modules, publish/C# list mismatch, missing artifact files, hash mismatch, source revision mismatch, deterministic provenance, and relative-path/secret leakage checks. `version:check` also passed. No actual release artifact was published; artifact-level checks used scratch fixtures only.

### Web

**PASS with two confirmed pre-existing test expectation mismatches.** `node_modules/.bin/vitest.CMD run` reported 35/37 test files passed and 237/239 tests passed. Both failures are isolated to stale assertions:

1. `lib/inbox.test.ts` expects category `Todo`; `lib/inbox.ts` intentionally normalizes that legacy input to canonical `todo`. Both the implementation and original assertion are present at `origin/main`; C4 added only the test safety import to the test file. The behavior is unchanged and matches the current category type.
2. `lib/bridge-status.test.ts` expects API v5 to be compatible. `lib/bridge-status.ts` has required version 7, and `local-bridge/bridge.py` reports API v7. The source and test are unchanged from `origin/main`; the fixture expectation is stale.

These are **NON-BLOCKING BASELINE** test mismatches with low product-behavior risk, not refactor regressions. Neither assertion was changed. TypeScript passed with `node_modules/.bin/tsc.CMD --noEmit --incremental false`.

### Calendar

**PASS.** `node_modules/.bin/vitest.CMD run lib/calendar.test.ts` passed 25/25, including generated-key JWT/token-cache tests, error identity, multi-calendar partial/success-empty behavior, deterministic create/first-calendar target, 409 handling, cache invalidation, and the network-denial sentinel. No Google API request or real credential was used.

### Packaging

**PASS.** `scripts/check_bridge_package.py --repo-root .` verified the current local import closure against the publish allowlist and `BridgeProcessManager.RequiredBridgeFiles`; C1–C3 owner modules are included. Scratch tests verified provenance SHA and mismatch paths. The provenance file remains a release artifact diagnostic, not a runtime required file. PowerShell publish, Companion build, installer, and actual artifact generation were not run.

### Build

**PASS.** `node_modules/.bin/next.CMD build --webpack` completed compilation, typecheck, page-data collection, 18/18 static pages, and build tracing. `NEXT_TELEMETRY_DISABLED=1` was set; Google, GitHub, and local Vault environment values were blanked for this process. Next reported `.env.local` as a loaded environment file; its contents were not printed or changed. No API route or external provider operation was invoked. Companion build/publish/install was skipped by instruction.

Also **PASS**: `git diff --check origin/main..HEAD`. The committed C7 `Publish-Release.ps1` syntax/parser check is recorded as passing in `refactor-log.md`; it was not rerun here.

## Architecture Check

- **C1 Mail:** `MailJobs` owns collection/AI worker handles, queue drain, recovery, and process-local execution state. `bridge.py` retains bootstrap, HTTP mapping, and operation dispatch.
- **C2 Portal:** `PortalJobs` owns sync/login execution, recovery/backfill, and batch orchestration. `portal_db.py` remains durable state owner; status GET continues to trigger the existing recovery/wakeup behavior.
- **C3 Workspace:** `WorkspaceStore` owns Inbox/Planner/project persistence operations, locks, normalization, tombstones, atomic file writes, and manifest SHA checks. Handler retains transport parsing and mapping.
- **C4 Inbox:** `useInboxWorkflow` owns hydration, serialized saves/revision guards, AI preview/apply, delete/retry, and Planner/Calendar routing; `page.tsx` composes the hook.
- **C5:** skipped; existing shared pure task helpers were sufficient and the remaining Planner/Research load/cache policies differ.
- **C6 Calendar:** `calendar-google.ts` owns Google auth/JWT/token cache/HTTP/provider errors; `calendar.ts` retains configuration, event policy, aggregation, cache, identity, and write target. Error class identity is re-exported from one definition.
- **C7 Packaging:** offline checker and release script provide completeness/provenance diagnostics. Bridge runtime startup and health do not require the provenance record.

### LOC and module effect

Using the exact `origin/main` file contents as baseline:

| File | Baseline | Current | Delta |
| --- | ---: | ---: | ---: |
| `local-bridge/bridge.py` | 1,660 | 736 | −924 |
| `lib/calendar.ts` | 561 | 387 | −174 |
| `app/page.tsx` | 684 | 513 | −171 |

The extracted production modules are `mail_jobs.py` 114 LOC, `portal_jobs.py` 267, `workspace_store.py` 631, `use-inbox-workflow.ts` 312, and `calendar-google.ts` 275. This is a net increase of about 330 LOC across these host/owner files, with five additional production modules: three Bridge runtime modules and two feature modules. The Bridge local import closure is 11 Python files at the baseline versus 14 now. C5 added zero modules/LOC; C7 adds two offline tooling files, not Bridge runtime modules. The LOC increase reflects moved ownership and added concrete tests/seams; LOC reduction was not the acceptance criterion.

Commit stats are scoped to each chunk: C1–C3 transfer Bridge ownership and update packaging lists/tests; C4 changes Inbox composition/controller/tests; C6 changes Calendar facade/provider/tests; C7 changes release diagnostics and documentation. No rebase, squash, or history rewrite was performed.

## Regressions

No new regression was attributable to C0–C7 in the performed safe checks. The full Web suite is not completely green because of the two pre-existing expectation mismatches documented above. Process-based Bridge HTTP tests were intentionally skipped under the no-process/no-live-endpoint boundary; current owner/handler characterization and packaging checks passed, and C4–C7 did not change Bridge route implementation.

## Known Deferred Issues

Preserved and not addressed in this assessment:

- Inbox `Todo`/`todo` assertion mismatch (baseline test expectation).
- Portal failed-marker write isolation limitation.
- Inbox/Planner cross-file writes are not transactional.
- Inbox durable-save failure may still be followed by downstream Planner/Calendar dispatch.
- Portal status GET retains recovery/backfill/worker-start side effects.
- No cross-process worker lease exists.
- Home/slot/wallpaper `nextTasks` sources remain separate.
- Calendar pagination and cache redesign remain deferred.
- Live Google, Portal, Mail, production data, and installed Companion behavior were not exercised in this phase.

## Release Blockers

None identified for a staged release. The two Web failures are confirmed baseline expectation mismatches; safe Bridge owner/characterization, typecheck, Calendar, packaging/provenance, version, and Next build checks passed. Process-based Bridge HTTP coverage and Companion build/publish/install remain intentionally outside this verification. The feature branch has not been deployed or installed; normal review/merge and staged artifact generation remain separate release steps.

## Release Recommendation

**READY FOR STAGED RELEASE**

This is a readiness assessment only. It does not authorize or perform Vercel deployment, release publishing, Companion installation, Bridge restart, or production smoke testing.
