# Master Thesis OS — Refactor Draft

작성일: 2026-09-30. **Proposed 초안, 실행 승인 아님.** Source: [Architecture Assessment](master_thesis_os_architecture_assessment.md).

Baseline: `main` / `origin/main` / remote main `8706d9e3a14aaa367bee7c7d4c4a871d65904909`. 지금 만든 것은 이 두 문서뿐이다. manifest/log/branch/source edits/chunk execution 없음.

## Execution contract for a later phase

- 실행 전 최신 Git tip·deployment/runtime provenance·status를 다시 확인. 기존 exporter/schema local changes는 손대지 않는다. 필요하면 사용자 변경을 보존하는 별도 checkout/worktree를 사용한다.
- baseline failure는 기록하고 unrelated repair를 시작하지 않는다. 실행 승인 후 isolated scratch data와 mocked provider로 targeted checks를 먼저 수행. installed config/token/Vault/SQLite/profile를 tests에 전달하지 않는다.
- 현재 source-level baseline contradiction: `test_bridge.py:412` health version=5 기대 vs source/client v7. 기존 테스트의 이 기대값 정정은 별도 baseline correction으로 먼저 승인·기록할 항목이며 이 audit에서 수정하지 않았다. 전체 suite all-green을 확인하지 못한 채 C1 실행하지 않는다.
- 모든 chunk는 유효한 behavior 상태에서 한 commit, targeted verification, 관련 typecheck, 필요한 package completeness 검증을 거친다. schema/env/API/runtime behavior 변경은 금지.
- 실제 runtime 설치·restart·Vercel deploy·sync·AI·Calendar write는 source refactor 승인과 분리된 작업. 이 초안의 verification은 그런 live action을 요구하지 않는다.
- 앞으로 새 module을 만들면 같은 commit에서 `Publish-Release.ps1` file allowlist, `BridgeProcessManager.RequiredBridgeFiles`, 기존 packaging test를 대조한다. source에만 파일을 넣고 끝내면 chunk 완료가 아니다.
- rollback은 해당 chunk commit만 revert. `git checkout .`, wholesale stash/reset/clean, user changes restore 금지. on-disk schema와 계약을 그대로 두므로 code rollback이 기존 data를 재해석하지 않게 한다.
- 문서의 후보 경로는 책임 중심 초안이다. 구현 중 interface가 helper 나열로 커지거나 net coupling이 증가하면 scope를 재검토하고 멈춘다. 새 framework를 즉석 추가하지 않는다.

## Chunk graph and size

7개 candidate. 순서: **1 → 2 → 3 → 4 → 5 → 6 → 7**. 실제 hard dependencies는 C2←C1(pattern 검증), C5←C3(store seam), C7←C1/C2/C3(final packaging). C4/C6는 기술적으로 독립이지만 integration writer는 하나로 유지한다. C7 전에도 각 Python chunk packaging correctness는 필수다.

shared JobRunner, generic DB repository, all-feature relocation, transport framework, legacy deletion chunk는 넣지 않았다. 이미 충분한 module은 그대로 둔다.

## C1 — Mail execution ownership를 HTTP에서 분리

- **목적 / architectural rationale:** F1/F2의 작은 사례부터 해결. `start/status/reanalyze` interface 뒤에 thread·collector gate·queue drain·recovery를 숨기는 deep concrete module. HTTP보다 execution lifetime이 더 자연스러운 owner다.
- **변경 대상:** `local-bridge/bridge.py` Mail globals 및 `_mail_job_active`, `_mail_ai_active`, `_remember_job_end`, `_remember_mail_ai_end`, `_run_sync_job`, `_run_mail_ai_job`, `_ensure_mail_ai_worker`, `start_sync_job`; 후보 `local-bridge/mail_jobs.py`; `test_bridge.py`, `test_mail_analysis.py`; publish/C# required lists. `mail_cli`/DB public function 계약 유지.
- **Entry condition:** 승인된 assessment; local-only user changes 보호; scratch baseline와 existing Mail tests의 side effects 확인; provider mock path 확정. 현재 status/job fields 및 recovery 순서를 fixture로 기록.
- **구체적 변경:** bootstrap가 config/DB path를 concrete owner에 전달. thread handles/locks/error를 owner 내부로 옮긴다. sync는 analyze=False, 완료 후 AI start; AI는 analyze_new→DB queued count→drain 그대로. Handler는 기존 timing에 owner operation을 호출하고 기존 envelope/status-code를 조립. module import로 config read/server/thread start가 발생하지 않게 한다. DB/schema에는 손대지 않는다.
- **Invariant:** target folders, collection/analysis 분리, sync-active AI start gate, conditional DB claim, interrupted processing→queued, queued drain, status GET wakeup, raw error precedence와 v7 response 유지.
- **Verification (나중에):** isolated Mail DB tests, fake collector/analyzer/thread seam checks; non-empty→drained queue, active worker 중복 start 거부, sync failure/AI failure/status snapshots. DB path는 temp, provider 호출은 stub. `pnpm lint` 및 relevant client tests. packaging text/completeness assertions. 기존 test suite 전체가 live-safe라고 가정하지 않음.
- **Exit condition:** HTTP가 Mail thread globals를 소유하지 않음; same envelope/ordering fixtures 일치; new module import 무부작용; packaging list 포함; source diff에 behavior change 없음.
- **Dependency:** 없음.
- **Rollback:** single commit revert; schema/data 변경 없음, installed runtime untouched.
- **예상 commit boundary:** `refactor: isolate mail execution ownership`; tests와 package list 변경 포함. 새 generic worker helper는 제외.

## C2 — Portal execution 및 batch orchestration 분리

- **목적 / architectural rationale:** F1/F2. HTTP 파일 안의 Portal batch claim/provider/save/lifecycle을 concrete domain owner로 옮겨 Locality 확보. Mail과 다른 recovery/freshness policy를 보존한다.
- **변경 대상:** `bridge.py` Portal globals/functions `:892–1102`, `_portal_status`의 execution policy 호출; 후보 `portal_jobs.py`; `portal_db`, `portal_ai`, `portal_cli` 기존 interface의 callers; relevant tests 및 package lists.
- **Entry condition:** C1의 import-safe owner 방식 검증; queued/processing→ai_interrupted→backfill 순서 fixture; login/sync/AI concurrency와 current error fields baseline 확보.
- **구체적 변경:** sync/login/start-analysis/backfill/drain/status execution을 owner로 옮김. DB batch claim 및 provider→per-item saves는 그대로. config ROOT/DB path를 bootstrap가 주입. Handler는 session/query parsing·auth·HTTP envelope/error mapping 유지. DB-derived ai_progress와 thread liveness를 구분한 snapshot을 반환하되 현재 응답 shape/timing 유지.
- **Invariant:** notices/terms/archive/local state 유지, prompt/model/content freshness, include_failed 의미, conditional force queue, interrupted recovery policy, sync 성공을 AI failure로 뒤집지 않는 behavior, batch size/order, per-item transaction, status GET backfill.
- **Verification:** mocked sync/login/provider + temporary DB의 start/duplicate-start/drain/recovery/failed retry/freshness 및 status contract fixtures. 정상 save failure 경로와 missing-result/failed-marker failure의 **현재 중단 behavior**를 characterization; 개선은 별도 제안. panel/client normalization tests, package allowlist assertions, typecheck. live browser/session/AI 없음.
- **Exit condition:** Bridge는 Portal DB worker choreography를 알지 않아도 route 가능; batch processing은 owner 안에만 존재; existing policy 차이를 하나의 공통 enum lifecycle로 덮지 않음.
- **Dependency:** C1의 패턴 검증. Mail/Portal generic unification은 dependency 아님.
- **Rollback:** single commit revert, DB schema/status contract 불변. installed process 업데이트 안 함.
- **예상 commit boundary:** `refactor: isolate portal execution ownership`.

## C3 — Vault workspace persistence 및 linkage 한 owner로 추출

- **목적 / architectural rationale:** F1/F4. Inbox/Planner/project metadata의 lock/atomic write/path/conflict invariant가 router에 노출되지 않도록 deep workspace module로 묶는다. **가장 위험한 chunk**: related JSON write와 lock 순서가 데이터 보존에 직접 영향.
- **변경 대상:** `bridge.py:87–772` normalization/read/write/merge/delete/sync/link/manifest/workspace operations; 후보 `workspace_store.py`; `test_bridge.py` Inbox/project tests 및 신규 좁은 scratch-data characterization; package required lists. `bridge_config/security` 기존 public function 유지.
- **Entry condition:** source/config/root/data path snapshot, temp fixture 준비; raw immutability, tombstones, completion/project preservation, metadata SHA conflict, failure-before-replace, dual-file write order tests 준비. existing tests는 실제 Bridge subprocess를 띄우는 부분이 있으므로 scratch isolation 확인.
- **구체적 변경:** related locks/paths/operations를 한 concrete owner에 이동. HTTP max body parsing은 router, domain limits/validation 및 file size checks는 store. Inbox→Planner lock order 그대로. atomic temp/fsync/replace와 delete ordering 그대로. ProjectManifestConflict identity를 mapping 가능하게 유지. Handler는 domain operation 호출만 수행. generic JSON repository/base class 없음.
- **Invariant:** Vault raw id/rawText/createdAt authority, newest AI processedAt, tombstones resurrection 방지, stable inbox ID/legacy linked ID normalization, existing status/projectId, bulk status-only merge, path traversal protection, expected manifest SHA, metadata target project, 파일 format/version, resolved storage paths.
- **Verification:** temp Vault + no provider로 operation/endpoint fixtures. raw overwrite attempt, stale-cache resurrection, duplicate Inbox todo sync, complete/uncomplete, project association 유지, partial write fault/order, expected SHA conflict. C1/C2 scratch regression 및 packaging completeness. 기존 dual-file crash consistency 한계를 기록하고 transaction 강화 테스트를 기존 보장으로 착각하지 않음.
- **Exit condition:** same input→same bytes/response 또는 의도된 동일 normalization; all preservation fixtures 통과; router에 file merge/lock choreography 없음; production data untouched.
- **Dependency:** C1/C2 후 순차 integration 권장; domain 로직 dependency 자체는 없음.
- **Rollback:** 단일 commit revert; storage format/path 불변. 실제 데이터에 rollback script 실행할 필요 없어야 함.
- **예상 commit boundary:** `refactor: isolate vault workspace persistence`. 하나의 관련 store라 meaningful commit이며 Inbox와 Planner 사이 기계적 move를 별도 commits로 쪼개지 않음. inspection으로 scope가 과대하면 실행 전에 재분할 승인 필요.

## C4 — Inbox workflow를 application composition에서 분리

- **목적 / architectural rationale:** F4. composition이 write revision/serialization/AI apply/link routing을 소유하지 않게 한다. capture→hydrate→preview→apply라는 현재 cohesive workflow를 하나의 feature controller 뒤에 숨긴다.
- **변경 대상:** `app/page.tsx:174–248,314–345,386–510,521–538` 관련 state/actions; 후보 `app/use-inbox-workflow.ts`; `inbox-panel` props call site; `inbox*.test.ts` 및 최소 controller seam tests. existing clients/domain functions는 유지.
- **Entry condition:** page callback/props inventory와 revision/write queue/error behavior fixtures. AI/Bridge/Calendar APIs 전부 mocked. existing cache keys/version/legacy normalization 보존.
- **구체적 변경:** Inbox hydration, cache-save checks, queued Vault writes, revision guard, preview/organize/apply/delete/retry/project association를 controller로 옮긴다. toast/navigation 같은 composition 결과는 기존 callback로 전달. feature clients를 controller에서 호출; global state store/event bus/context framework 없음. page는 navigation/dashboard/panel composition 유지.
- **Invariant:** input raw 유지, AI preview/discard, batch size 4, explicit dates only, token/version warnings, stale response 무시, save failures cache retention, current apply persistence→Planner/Calendar dispatch 순서 및 failure messages, project sync→association, deletion guarded ordering.
- **Verification:** fake async response ordering으로 older save가 newer state 덮지 않음; failed save/retry, delete vs pending write, AI apply todo/schedule route, cache failure 시 원문/preview 유지. 실제 Calendar writes 금지. `pnpm test:web`는 승인된 later sandbox에서, `pnpm lint`; relevant UI render snapshots/class/props semantics 확인.
- **Exit condition:** workflow 알고리즘은 controller 하나; page가 persistence helpers를 별도로 복제하지 않음; UI hierarchy/style/storage unchanged. 이미 존재하는 현재 문제를 behavior fix로 섞지 않음.
- **Dependency:** 독립; C3 뒤 수행하면 server owner와 함께 비교하기 쉬움.
- **Rollback:** single commit revert; cache schema/API 불변.
- **예상 commit boundary:** `refactor: isolate inbox workflow from app composition`.

## C5 — Planner cache reconciliation과 Research projection 책임 명확화

- **목적 / architectural rationale:** F4. 같은 task source를 새 UX에서 다시 구현하지 않도록 현재 domain helper를 재사용. 새 centralized global state owner를 만드는 것이 목적은 아니다.
- **변경 대상:** existing `lib/planner-tasks.ts`, `planner-tasks.test.ts`, `app/planner-panel.tsx:58–88`, `app/research-panel.tsx:89–113`. client 계약 및 server store 불변.
- **Entry condition:** C3 store seam stable; Planner의 newer-cache completion replay와 Research의 stored snapshot policy 차이를 fixture로 확인. project.md manual nextTasks와 linked projection 분리 inventory.
- **구체적 변경:** 동일 tombstone/filter/sort/normalization 부분만 기존 helper에 집약하고 caller가 자기 load/retry/presentation policy를 유지. project-linked projection을 existing helper로 설명할 수 있으면 재사용. single-item add와 bulk completion merge의 다른 계약 유지. new files/store/subscription/event bus 없음.
- **Invariant:** stable inbox:<id>와 unique link, done↔pending/completedAt, projectId 보존, persisted tombstones 우선, offline cached completion restore, Research에 같은 task 상태 표시, manifest list에 task 복제 금지.
- **Verification:** cached newer/older task, deletion marker, legacy link ID, complete→uncomplete, project filtering 및 sorting fixtures; offline Research/Planner policy difference; scratch endpoint linkage 비교; typecheck. 실제 multi-panel freshness 변화 없음.
- **Exit condition:** helper reuse로 repeated invariant code 감소; current policies 동일. 동일한 코드가 없다면 chunk를 **skip**하고 owner documentation만 유지한다. extraction 자체를 완료 조건으로 삼지 않는다.
- **Dependency:** C3. C4와 technical dependency 없음.
- **Rollback:** single commit revert; data unchanged.
- **예상 commit boundary:** `refactor: clarify planner reconciliation and project projections`; 필요한 substantive change가 없으면 commit 없음.

## C6 — Calendar Google provider 내부 seam

- **목적 / architectural rationale:** F5. 이미 deep한 calendar 외부 interface를 유지하고 auth/token/HTTP/error 구현만 감춘다. third-party boundary의 fetchImpl stand-in을 유지한다.
- **변경 대상:** `lib/calendar.ts` JWT/accessToken/provider error/Google fetch helpers, 후보 `lib/calendar-google.ts`, `calendar.test.ts`; route와 callers의 public imports 유지. 기존 calendar-dates/view/client 그대로.
- **Entry condition:** current JWT/error class/normalization/cache fixtures; exact deterministic ID, first-calendar target, partial/all-fail read fixtures 확보. circular-import-free dependency sketch 확정.
- **구체적 변경:** Google auth/token cache와 provider HTTP response/error 구현을 하나의 내부 module로 옮김. calendar facade는 config policy, normalized events/read aggregation, event cache 및 invalidation, deterministic candidate/write policy 유지. shared error class는 한 definition으로 유지하고 기존 export identity를 보존. 필요하면 HTTP helpers는 raw Google response를 반환하고 facade가 normalization. service-account strategy/provider registry/interface hierarchy 없음.
- **Invariant:** GOOGLE_CALENDAR_IDS order/dedup/legacy fallback, service account RS256 scope, token TTL/skew, range/timezone, dedup key, sort/partial failure including successful empty response, event cache TTL, first write target, event ID bytes, 409 handling/sendUpdates=none/write invalidation, input validation/errorCodes/log redaction.
- **Verification:** existing fake-fetch Calendar tests + multi-calendar successful-empty/one-fail fixture, token refresh/cache-clear singleton, insert/conflict/GET existing, failure classifications; route response fixtures and typecheck. test private key는 generated fixture만 사용; actual env/service account/read/write calls 없음.
- **Exit condition:** external exports/behavior unchanged; provider auth complexity hidden; token/event caches each single owner; no circular import; maximum +1 runtime module. migration/new Calendar features 없음.
- **Dependency:** 독립.
- **Rollback:** single commit revert; env/API/event IDs 불변.
- **예상 commit boundary:** `refactor: isolate google calendar provider internals`.

## C7 — Runtime artifact provenance와 packaging completeness

- **목적 / architectural rationale:** F6. repo/source와 installed runtime의 다른 lifecycle을 인정하고 설명 가능한 release artifact를 만든다. complex updater 없이 누락/drift diagnosis 개선.
- **변경 대상:** existing `experiments/wallpaper-host-poc/scripts/Publish-Release.ps1`, `scripts/check-versions.mjs` 또는 existing packaging checks, `local-bridge/test_bridge.py` packaging assertions, `VERSIONING.md`; 필요 시 C# required list의 source consistency check만. installed runtime untouched.
- **Entry condition:** C1/C2/C3의 final packaged files 확정; offline verification 경로와 scratch output 확정. 현재 installer lifecycle/config/data preservation 이해. deployed/installed SHA 미확인 상태를 명시.
- **구체적 변경:** publish artifact에 source commit/API-v7/file hashes의 작은 build provenance record 추가하고 existing offline check에서 required files/import closure 대조. build metadata와 health protocol 분리. two version sources(web/Companion) 보존. installer replace/copy/config logic와 runtime auto-start/health behavior는 그대로.
- **Invariant:** independently versioned deliverables, packaged-runtime-first selection, existing process reuse, config precedence/token/origins 보존, existing data DB paths, source module completeness, no automatic deploy/install/migration.
- **Verification:** source-only packaging list/import closure assertions; scratch artifact fixtures로 missing module/hash/revision mismatch 탐지. current health JSON exact contract fixture. live installer/publish/Companion build를 이 계획 승인만으로 실행하지 않음. 별도 release verification이 필요한 부분은 구분.
- **Exit condition:** runtime source origin를 artifact로 설명 가능하고 file 누락을 offline에서 탐지. new updater/module registry/DB metadata schema 없음.
- **Dependency:** C1/C2/C3 final package content. C4–C6와 독립.
- **Rollback:** single commit revert; artifact format은 diagnostics 전용이고 runtime required input이 아니어야 함. installed runtime reset 없음.
- **예상 commit boundary:** `chore: verify bridge package completeness and provenance`.

## Deferred correctness and behavior changes

이것들은 extraction chunk에 포함하지 않는다: 모든 failed-marker write 실패를 격리하도록 보강, cross-file Inbox/Planner transaction/recovery protocol, status GET pure-read로 변경, cross-process worker lease, Home/slot/wallpaper next-task source 통일, Calendar pagination/cache redesign. current limitations를 preservation baseline의 성공 보장으로 바꾸지 않는다. 별도 issue/승인/targeted failure tests가 필요하다.

또한 F9의 Inbox durable save 성공 확인 후에만 dispatch하거나 failed Calendar route 재시도를 제공하는 변경도 별도 behavior/correctness 작업이다. C4의 추출이 이 문제를 해결했다고 표현하지 않는다. test coverage 추가는 현재 semantics를 확인하며 제품 동작을 몰래 바꾸지 않는다.

## Verification disposition at assessment completion

현재 tests/build/runtime verification는 **실행하지 않았다**. source/read-only Git evidence와 두 문서의 path/scope/hash 검증만 수행한다. C1–C7은 pending candidate이며 completed task가 아니다. refactor-manifest나 actual execution log를 만들지 않는다.

Assessment-only gates passed: required headings, 7 candidate count, relative document link, UTF-8, routing record validation, static source evidence assertions, and unchanged hashes for all 252 tracked files. The task-routing policy's pure in-memory self-check ran with `python -B` and passed; this is not a project test run.

Wiki update: not required
Reason: proposed application refactor plan only; research method and results unchanged.
