# Master Thesis OS ↔ P0 통합 작업 보고서

> **2026-10-25 진행 상태 갱신:** 아래 본문 1차 보고는 2026-10-24 당시의 기준 상태를 기록한 이력이다. 아래 현재 진행 요약이 이후 변경사항에 대해 우선한다. 이 문서는 R1–R6의 전체 완료 또는 Production 배포 승인을 뜻하지 않는다.

## 현재 진행 요약 (2026-10-25)

- Standalone: `C:\worktrees\master-thesis-os-standalone`, branch `feat/integrate-p0-tasks`; home/offline UI 작업은 로컬 커밋에 포함됐고 아직 push하지 않았다. PR #15 원격에는 마지막으로 확인된 `90422a87c0741eb241d56434036fb713bbfe2823`가 남아 있다.
- P0: `C:\worktrees\master-thesis-os-p0\tools\master-thesis-os-p0`, branch `feat/master-thesis-os-p0`; task category/read-state/offline delete/Drive backup 구현은 로컬 커밋 `5f8c0282`에 포함됐고 아직 push하지 않았다.
- R1: 전용 Cloudflare tunnel/Access와 Vercel Preview upstream 경로는 구성됐지만 tunnel 재부팅 자동 시작 및 최신 브랜치 Preview 검증은 미완료다.
- R2: 앱 공통 Google sign-in/session UI와 P0 API 인증 테스트가 구현됐지만 실제 `ALLOWED_GOOGLE_SUB`/OAuth 설정 및 최신 Preview에서의 로그인 검증은 미완료다. Vercel MCP 인증 상태는 변경하지 않았다.
- R3–R4: 홈 중심 P0 task workspace, 미분류/read-state, offline CRUD queue/bridge, 모바일 More 메뉴의 캘린더·메일·공지·바로가기·설정 접근을 구현했다. Planner/Slot은 데스크톱 주 내비게이션에서 숨기고 More에는 보존했다.
- R5: 전용 Drive service account(`drive.file`), encrypted upload/download/hash verification, DPAPI setup 및 restore guard를 구현했다. 지금까지는 mock Drive API와 임시 SQLite만 테스트했으며 실제 credentials/folder, 실제 backup/restore, schedule, retention은 설정하지 않았다.
- 검증: Standalone `pnpm lint`, `pnpm build`, 선택 Vitest 5 files/19 tests 통과. P0 `node --test` 40 tests 통과, JS syntax checks와 PowerShell parser 통과. 통합 브라우저 로그인/오프라인 실기기 검증은 미완료.
- PR #15은 열려 있고 Production deployment/SQLite, 기존 Cloudflare/Tailscale 매핑은 건드리지 않았다. Merge/Production 승격은 R1–R5 운영 설정과 R6 확인 전까지 금지한다.

## 1. 기획서의 작업 목적

- 작성일: 2026-10-24 13:13 KST
- 작업 저장소: `C:\worktrees\master-thesis-os-standalone`
- 작업 브랜치: `feat/integrate-p0-tasks`
- 최종 커밋: `26773391ddf88df23d4f9a7ffdfccc2703608adc`
- 기준 커밋: `03c3d2564e8891c9e4353128c9d3acf96813970f`

## 1. 기획서의 작업 목적

초기 기획서의 목적은 새로운 기능을 처음부터 재설계하는 것이 아니라, 이미 구현된 Master Thesis OS ↔ P0 통합을 다음 기준으로 안전하게 확정하는 것이었다.

1. 통합 변경분만 집중 코드 리뷰
2. Planner 세션, Native P0 UI, 프록시, 쿠키, 서비스 워커의 인증·보안 경계 점검
3. 실제 결함 재현 후 최소 수정과 회귀 테스트 추가
4. Next.js와 P0 전체 회귀 검증
5. 통합 변경만 로컬 커밋
6. 실제 로그인·배포 전에 필요한 OAuth, HTTPS, 백업, 모바일 검증 절차 문서화

작업 범위에서 다음은 명시적으로 금지되었다.

- P0 원본 수정
- Vault 수정·정리·리셋
- 원격 push 및 Vercel 배포
- 실서비스 데이터 이전
- Hermes Gateway 재시작
- P0 스키마 변경 및 미분류 필터 구현
- 운영 인증 우회 또는 P0 동기화 프로토콜 복제

## 2. 작업 대상과 보존 상태

초기 확인 상태는 다음과 같았다.

- Standalone: `C:\worktrees\master-thesis-os-standalone`, 기준 `03c3d25`, 통합 관련 미커밋 변경 존재
- P0 원본: `C:\worktrees\master-thesis-os-p0\tools\master-thesis-os-p0`, 기준 `39b27d48`
- Vault: `C:\work\chocomint-lab`, 기존 미커밋 변경 142개

최종 상태:

- P0 원본은 `39b27d4844d5f0237f46b383002742b14217a084`에서 변경 없이 clean
- Vault의 기존 미커밋 변경 142개는 그대로 유지
- Standalone 통합 변경만 커밋
- 원격 push, 배포, 데이터 이전은 수행하지 않음
- 최종 Standalone 작업 트리는 커밋 후 clean

## 3. 구현 및 통합 결과

### 3.1 Next.js ↔ P0 서버 통합

- Next.js 서버 라우트에서 P0 세션 로그인·상태·로그아웃을 중계
- P0 작업 목록·생성·수정·완료 흐름을 Planner와 연결
- P0 API 요청은 서버 측 프록시를 거치며, 브라우저가 P0 서버에 직접 접근하지 않도록 구성
- P0 원본의 `/api/tasks` 프로토콜과 idempotency 및 `base_version` 기반 수정 흐름을 유지
- 기존 Vault JSON/local-cache 데이터는 삭제·자동 이전하지 않음

### 3.2 Planner·홈 화면·Inbox 연결

- Planner에 P0 작업 생성·조회·제목 수정·완료 흐름 연결
- 홈 화면에 P0 작업 카드 추가
- Inbox todo 자동 라우팅에 P0 작업 연결
- 기존 Planner 작업과의 결정적 ID·중복 검사 유지
- 응답이 유실된 생성 요청의 재시도에서 같은 idempotency key를 유지하도록 보강
- `sessionStorage` 저장이 불가능한 경우 사용자에게 재시도 중복 위험을 알림

### 3.3 기존 Native P0 UI 연결

- `/api/p0/native/...` 제한 프록시를 추가
- 허용 경로·HTTP 메서드·요청 body 크기를 제한
- 쿼리와 허용 헤더 전달 범위를 제한
- Native P0 로그인 토큰은 브라우저 응답 JSON으로 노출하지 않고 `HttpOnly`, `SameSite=Strict` 쿠키에 저장
- Native API 요청에서만 서버가 쿠키의 bearer token을 upstream Authorization 헤더로 전달
- 로그아웃·upstream 401에서 Native 세션 쿠키를 만료
- 서비스 워커 캐시를 Native P0 전용 namespace로 분리
- Native 복구 UI에서 오프라인 큐·충돌·거부된 변경 상태를 확인할 수 있게 연결

### 3.4 P0 스키마 범위

P0 스키마가 허용하는 분류는 `research`, `school`, `personal`이며 기본값은 `personal`이다. 미분류 필터는 P0 스키마 변경이 필요하므로 이번 작업에서는 구현하지 않았다.

## 4. 리뷰에서 발견하고 수정한 결함

### 4.1 Origin·Fetch Metadata 검사 fail-open

초기 리뷰에서 `Origin`과 `Sec-Fetch-Site`가 모두 없는 mutation 요청을 허용할 수 있는 경로가 발견되었다.

수정 내용:

- Origin이 있으면 설정된 정상 origin과 정확히 비교
- Origin이 없으면 `Sec-Fetch-Site: same-origin`일 때만 허용
- Fetch Metadata가 없거나 `cross-site`, `same-site`, `none`이면 변경 요청 거부
- Origin·Metadata가 없는 POST, cross-site POST 회귀 테스트 추가

### 4.2 forwarded header 신뢰에 따른 origin 우회 가능성

두 번째 독립 리뷰에서 요청자가 임의로 보낸 `X-Forwarded-Host`·`X-Forwarded-Proto`를 expected origin 계산에 사용할 경우, 신뢰 경계가 잘못 설정된 프록시에서 검사를 우회할 수 있다는 조건부 위험이 발견되었다.

수정 내용:

- CSRF 기준 origin 계산에서 forwarded host/protocol을 제거
- 운영 환경에서는 검증된 `MTOS_PUBLIC_ORIGIN`을 반드시 사용
- 설정값은 origin 형식만 허용하고, 운영에서 없거나 잘못되면 fail-closed
- 로컬 개발·HTTP 테스트에서는 요청의 Host와 protocol을 사용
- 공격자 origin과 spoofed forwarded header를 함께 보내는 회귀 테스트 추가

### 4.3 Native bearer token의 브라우저 노출

초기 리뷰에서 Native `/api/auth/google` 응답이 bearer token을 JSON으로 브라우저 JavaScript에 반환할 수 있는 문제가 발견되었다. 이 경우 same-origin script나 브라우저 저장소를 통해 토큰이 노출될 수 있다.

수정 내용:

- bearer token을 응답 body에 반환하지 않음
- 서버 전용 Native 세션 쿠키로 보관
- 허용된 Native API 요청에 대해서만 서버 측에서 Authorization bearer로 전달
- 로그인 응답은 성공 sentinel만 반환
- 로그아웃·401 시 쿠키 만료 및 `no-store` 적용
- 브라우저 localStorage에 기존 토큰이 남지 않는지 HTTP 테스트에서 확인

### 4.4 세션·캐시·재시도 경계

- Planner/P0 세션의 stale cookie를 401 응답에서 정리
- Native 쿠키에 경로·HttpOnly·SameSite·production Secure 속성을 적용
- 서비스 워커가 다른 애플리케이션 캐시를 조회하거나 삭제하지 않도록 Native 전용 캐시만 사용
- 생성 응답 유실 후 재시도 시 idempotency key를 보존
- 요청 body 제한과 과대 요청 거부를 추가

## 5. 검증 결과

모든 필수 검증은 통과했다.

- Next `pnpm test`: **43개 테스트 파일, 273개 테스트 통과**
- `pnpm lint`: 통과
- `pnpm build`: 통과
- `pnpm test:p0:integration`: 통과
- `pnpm test:p0:production`: 통과
- 개발·프로덕션 HTTP→SQLite 통합: 각 실행 통과
- P0 `npm test`: **28개 통과**
- P0 `npm run test:ui:rejected`: **16개 통과**
- `node --check scripts/test-p0-http-integration.mjs`: 통과
- `git diff --check`: 통과
- `git diff --cached --check`: 통과
- 보안 정적 패턴 검사: hardcoded secret, shell injection, eval/exec, pickle deserialization, formatted SQL 패턴 모두 **0건**
- 최신 독립 staged diff 리뷰: **차단할 security concern 및 logic error 없음**

통합 HTTP 테스트는 실제 Next.js HTTP route → P0 test server → SQLite 경로를 대상으로 세션·작업 CRUD·수정·완료·재접속·idempotency·Native asset/proxy·쿠키 보안 속성을 확인했다. 운영 OAuth 설정이 없는 상태에서 인증을 우회하지 않고 테스트 전용 인증 경로만 사용했다.

## 6. 커밋 결과

커밋:

```text
26773391ddf88df23d4f9a7ffdfccc2703608adc
[verified] Integrate P0 tasks with secure same-origin proxy
```

커밋 내용:

- 24개 파일
- 1,604 insertions
- 72 deletions
- 통합 API, UI, 클라이언트, 테스트, HTTP 통합 스크립트, 실사용 준비 체크리스트 포함

커밋 전 staged diff를 확인했고, 다른 저장소의 변경은 포함하지 않았다.

## 7. 실제 로그인·배포 전 필수 작업

다음은 아직 수행하지 않은 실사용 준비 작업이다.

1. Google OAuth Web client ID를 생성하고 실제 HTTPS origin을 승인된 JavaScript origin에 등록
2. 허용할 Google `sub` 하나를 서버의 보호된 환경변수에 설정
3. 운영 Next.js에 정확한 `MTOS_PUBLIC_ORIGIN` 설정
4. P0는 계속 `127.0.0.1:8787`에만 바인딩하고, 외부 노출은 HTTPS reverse proxy를 통해서만 수행
5. `MTOS_BACKUP_KEY`를 32바이트 무작위 값의 64자리 hex로 생성해 비밀 저장소에 보관
6. 백업 디렉터리를 DB·저장소와 분리하고 격리된 사본에서 backup/verify/preview/restore 시험
7. 실제 iOS Safari 및 Android Chrome에서 로그인·로그아웃·작업 동기화·오프라인 큐·서비스 워커를 확인
8. P0 로그인 rate limit이 loopback proxy 뒤에서 여러 기기를 하나의 IP bucket으로 묶을 수 있는지 스테이징에서 확인

위 설정값은 채팅·Git·스크린샷에 기록하지 않는다. 실제 OAuth 설정과 모바일 검증이 끝나기 전에는 운영 로그인·배포가 검증되었다고 보면 안 된다.

## 8. 남은 위험과 이번 작업의 비범위

- P0 로그인 rate limit의 원격 주소가 Next.js 프록시 뒤에서 동일하게 보일 수 있다. 임의의 forwarded-IP 헤더를 신뢰해 우회하지 말고, 다중 사용자 공개 전에 신뢰 가능한 프록시 IP 처리 방식을 별도로 검토해야 한다.
- HTTPS 인증서·도메인·reverse proxy 운영 설정은 구성하지 않았다.
- 실제 Google OAuth client ID와 허용 `sub`는 설정하지 않았다.
- 암호화 백업 키 생성·운영 백업 스케줄·Windows 서비스 등록·터널 구성은 하지 않았다.
- P0 스키마 변경 및 미분류 필터는 하지 않았다.
- 원격 push, Vercel 배포, 실서비스 데이터 이전은 하지 않았다.

## 9. 작업 효율 기록

확인 가능한 기록만 적는다.

- 첫 소스 수정 전 수동 기록: tool subcall 38회, 고유 파일 17개, 초기 읽기 후 반복 읽기 2회
- 첫 compaction 전 기록: reads/searches 82회, compaction 1회
- 전체 작업 종료 시 확인된 누적 기록: reads/searches 164회, compaction 3회
- 첫 패치까지의 정확한 전체 호출 수와 전체 중복 읽기 수는 복원 가능한 기록이 없어 확정하지 않는다.

## 10. 결론

초기 기획서의 핵심 목표인 “기존 P0 통합을 변경분 중심으로 검토하고, 인증 경계의 실제 결함을 최소 수정·회귀 검증한 뒤 통합 변경만 로컬 확정”은 완료되었다.

코드는 로컬 커밋되어 있고 P0 원본·Vault는 보존되어 있다. 다만 실제 OAuth 설정, HTTPS 스테이징, 암호화 백업 키, 모바일 브라우저 검증이 남아 있으므로, 현재 상태를 **코드 통합 완료·운영 배포 전 단계**로 분류한다.
