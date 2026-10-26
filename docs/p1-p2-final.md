# Master Thesis OS P1·P2 최종 구현 기록 (2026-10-25)

브랜치 `feat/mtos-p1-p2-final-and-wallpaper-removal` (기준 `origin/main` 493ea11). 원본 기획 문서 `Master_Thesis_OS_제품기획서_v1.0_20261022.docx`, `Master_Thesis_OS_대화_전체정리_20261023.md`는 메인 PC에서 찾지 못해 작업 지시서를 기준선으로 사용했다.

## 1. 확인된 실행 구조

| 구성 | 실제 위치 | 비고 |
| --- | --- | --- |
| 웹앱 | Vercel `master-thesis-os` (main → Production) | 이번 작업은 main에 병합하지 않음 |
| P0 API + SQLite | 서버 PC `DESKTOP-PDIRJHA`, `C:\worktrees\master-thesis-os-p0\tools\master-thesis-os-p0` (`feat/master-thesis-os-p0`, 2843657d), `127.0.0.1:8787` | **원격 게시 경로 없음**(로컬 브랜치). 이번 작업은 P0 코드·DB를 바꾸지 않음 |
| Cloudflare Tunnel/Access | 서버 PC, `config-p0.yml`, `p0-api.chocomintudon.com` | 변경하지 않음 |
| Local Bridge | 메인 PC `yun`, `%LOCALAPPDATA%\MasterThesisOS\bridge-runtime`, `127.0.0.1:38471` | Wallpaper에서 분리(아래) |
| Codex CLI | 메인 PC 0.163.0, 서버 PC 0.164.0, ChatGPT 로그인 | 메인 PC에서 실제 1회 호출 성공(아래) |
| 신규 mtos-agent | `services/mtos-agent` → 서버 PC `127.0.0.1:8789` | 2026-10-25 서버 설치 완료(8788은 Hermes owntracks 수신기가 사용 중이라 8789) |

## 2. 요구사항 분류

상태: **완료**(코드+자동 테스트) / **부분** / **미구현** / **외부 설정 필요**(코드는 있으나 계정·서버 작업 전 실행 불가). 실사용 브라우저·모바일 시험은 범위 밖이라 모두 **실사용 미검증**이다.

| 영역 | 상태 | 근거 |
| --- | --- | --- |
| Wallpaper Companion 제거(코드·빌드·버전 검사·문서) | 완료 | 커밋 346d447 |
| Wallpaper 설치본 제거(메인 PC) | 완료 | 제거 스크립트 `-PurgeData` 없이 실행, Run 키·시작 메뉴·app 폴더 삭제 |
| Local Bridge 독립 실행 | 완료 | 실행 중이던 런타임 그대로 복사, Startup 바로가기 재지정, `/health` v8·`/inbox`·`/portal/status`·`/mail/sync-status`·`/planner/tasks` 200 |
| 6단계 칸반 + 단계 미확인 열 | 완료 | `app/research-kanban.tsx`, 테스트 |
| 카드: 다음 실행 작업·남은 할 일·가장 가까운 마감(P0 집계) | 완료 | `summarizeProject` (P0 `project_id`만 사용) |
| 상태와 단계 분리 | 완료 | 카드에 별도 배지 |
| 상세 전체 화면·지정 순서·뒤로 가기 시 필터/스크롤 복원 | 완료 | `research-panel.tsx` |
| 기존 파일 탐색·결과 뷰어·원본 열기 보존 | 완료 | 기존 컴포넌트 유지 |
| 프로젝트별 미완료·완료·임박 P0 할 일, 연결 오류와 0건 구분 | 완료 | `ProjectTasksSection` |
| 모호한 프로젝트 연결 미지정 | 완료 | AI는 확신도 0.7 미만·미존재 ID면 연결하지 않음 |
| 마일스톤(공식/내부, 근거, 이력, 공식 마감 보호) | 완료 | agent `milestones` + history, 공식 날짜 변경은 사용자 명시 확인만 |
| 연구 메모(4유형, P0측 영속 DB) | 완료 | agent `memos` (서버 PC SQLite) |
| 전역 검색(접힘, 할 일·프로젝트·메모·마일스톤·인박스·원본 링크) | 완료 | `global-search.tsx`; agent 불가 시 명시 |
| 영속 작업 큐(중복 방지·우선순위·재시도·비정상 종료 복구·인증 정지/재개) | 완료 | `queue.js`, 49개 agent 테스트 |
| AI 결과 스키마 검증 | 완료 | `--output-schema` + 재검증 |
| Worker 장애와 P0 분리 | 완료 | 별도 프로세스·DB, agent 오류 시 홈은 안내만 |
| Windows 자동 시작·제한 재시작·저우선순위·로그 | 외부 설정 필요 | `register-tasks.ps1` 작성, 서버 PC 등록 전 |
| Codex CLI 무인 실행 | 부분 | 메인 PC에서 실제 decompose 1회 성공(8초, gpt-5.6-luna). 서버 PC에서는 미실행. ChatGPT 구독 이용 한도는 확인할 공식 수단이 없어 한도 초과 시 재시도·정지로만 처리 |
| AI 인박스 수집·분류·자동 등록·실행 취소·이력 | 완료(실행은 외부 설정 필요) | 원문 선저장, 오프라인 보관함 |
| 중복 처리(명백=자동 연결, 애매=승인) | 완료 | `obviousDuplicate`, `duplicate_merge` |
| 승인 대기(마감·단계·마일스톤·Obsidian·중복·충돌) | 완료 | AI가 단계 변경을 제안하는 경로는 만들지 않음(승인 유형·적용은 지원) |
| 메일 06:00·18:00 JST 증분 수집·지금 확인 | 외부 설정 필요 | 서버 PC에 Gmail OAuth(gmail.readonly) 필요. 발신자 허용 목록 없으면 수집 안 함 |
| 학교 포털 공지 정기 수집 | 미구현 | 포털은 메인 PC의 로그인 브라우저 세션(Local Bridge)에만 있어 서버 정기 수집 불가. 기존 학교 공지 화면은 유지 |
| 오늘 집중 AI 추천 1~5개·고정 보호·중복 표시 없음·이유·거부 | 완료 | `focus-recommendations.tsx` |
| 바쁜 시간 병합·15~60분 구간 제안·캘린더 미기록 | 완료 | `focusSlots` |
| 큰 작업 분해·다음 한 단계·상위 자동 완료 금지 | 완료 | `task-assist.tsx` |
| 막힘 기록·작게 나누기·대안·미루기·다시 표시 | 완료 | append-only `block_events` |
| 반복(고정/완료 기준)·완료/건너뛰기/미루기, 건너뛰기 비집계 | 완료 | `mtos-task-actions.ts` |
| Obsidian 승인형 쓰기·차이 비교·SHA 재검증·실패 시 재시도 대기 | 완료(실행은 외부 설정 필요) | Vercel에서 Vault 쓰기는 `GITHUB_WRITE_ENABLED=true` 필요 |
| 홈 긴급 승인(3일·오늘 막힘·데이터 손실만) | 완료 | `UrgentApprovals` |
| 모바일 주요 메뉴(홈·연구·AI 인박스·더보기), Planner 숨김·보존 | 완료 | 기존 구조 유지 |
| 새 데이터 백업(메모·마일스톤·큐·승인 이력) | 완료(등록은 외부 설정 필요) | P0와 같은 `MTOSBK1` 형식, 로컬 전용, 03:40 작업 |
| Google Drive 자동 백업 | 의도적 미재개 | 사용자 결정 유지 |

## 3. 데이터 보존

- P0 코드·SQLite, Obsidian Vault, 기존 Planner, Local Bridge DB는 수정·마이그레이션하지 않았다.
- P0 할 일과 Planner 할 일을 통합하거나 복제하지 않았다. Planner 항목은 프로젝트 상세에 읽기 전용으로 남겼다.
- Wallpaper 제거 전 `%LOCALAPPDATA%\MasterThesisOSWallpaper\backups\20261025-wallpaper-removal\`에 브리지 런타임(`portal-notices.db` 포함), Run 키, 원래 Startup 바로가기를 백업했다. 설정·mail.env·포털 프로필·로그·기존 백업은 그대로다.
- 실행 중이던 브리지 `workspace_store.py`에는 저장소에 없는 수정(`02_Projects` 지원, `refactor/architecture-ownership` 브랜치와 같은 내용)이 있다. 동작을 바꾸지 않으려고 독립 런타임에 그대로 복사했다. main에는 없는 변경이므로 별도 정리가 필요하다.

## 4. 서버 PC 배포 순서 (사용자 작업)

1. 이 브랜치를 서버 PC에 받아 `services/mtos-agent`만 사용한다(Next 배포와 별개).
2. `codex login status` 확인 후 `services/mtos-agent/README.md`의 `agent.env` 작성.
3. `scripts\register-tasks.ps1` 실행 → `MTOS_Agent_API`, `MTOS_Agent_Worker`, `MTOS_Agent_Backup`.
4. `config-p0.yml`에 `^/agent/` → `127.0.0.1:8789` 경로 규칙을 P0 규칙 위에 추가하고 tunnel 작업 재시작.
5. Vercel Preview에 `MTOS_AGENT_URL=https://p0-api.chocomintudon.com` 설정 → Preview에서 확인 → 승인 후 main 병합.
6. Gmail 수집이 필요하면 gmail.readonly 동의가 포함된 refresh token을 `agent.env`에 넣고 AI 인박스 → 발신자 목록을 저장.

## 5. 검증 기록 (메인 PC, 2026-10-25)

- `pnpm version:check`, `pnpm lint`(tsc), `pnpm build` 통과.
- `vitest`(통합 제외) 49 files / 303 tests 통과. `lib/p0-tasks.integration.test.ts` 8 통과.
- `pnpm test:agent` 49 통과. `pnpm test:bridge` 152 통과, exporter 통과.
- `pnpm test:p0:integration`, `pnpm test:p0:production` 각 7개 PASS(임시 SQLite). 기존 main에서도 실패하던 "오늘 집중할 일" 단정문을 현재 로그인 게이트 기준으로 고치고, 신규 쓰기 경로의 미인증 401 검사를 추가했다.
- `test:p0:backup:isolated` 3개 PASS(P0 CLI 출력 형식 변화에 맞춰 파싱 수정).
- P0 자체 테스트 39개 통과(서버 PC 소스의 읽기 전용 스냅샷, 메인 PC `D:\worktrees\master-thesis-os-p0`).
- Codex 실제 호출 1회: 격리 메모리 DB, decompose_task 성공.
