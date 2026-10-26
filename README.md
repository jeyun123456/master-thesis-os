# Master Thesis OS

필요노동 석사논문 저장소를 읽는 Next.js 대시보드다. 앱 코드는 이 독립 repository에 두고, 연구 자료의 source of truth는 별도 private repository [`jeyun123456/Chocomint-Lab`](https://github.com/jeyun123456/Chocomint-Lab)로 유지한다. 앱 DB로 연구 파일을 복제하지 않는다. dashboard JSON이 없거나 검증되지 않으면 수치 대신 명확한 empty state를 표시한다.

## 제품 버전

- Master Thesis OS 웹 앱: `1.4.0` — canonical source는 root `package.json`
- Wallpaper Companion은 1.4.0에서 제거됐다. 과거 `v0.6.1` 태그와 Release는 기록으로 보존한다.
- 버전 규칙과 release 절차: [`VERSIONING.md`](./VERSIONING.md)

## 구성

- `app/`: 연구 대시보드 페이지 UI와 서버 API routes
- `lib/`: GitHub·Calendar 서버 클라이언트, Microsoft Graph 브라우저 클라이언트, project/result discovery, repository 분류, Results 데이터 계약
- `schemas/`: Excel과 UI 사이의 dashboard JSON Schema
- `exporter/`: canonical 결과 workbook을 검증된 dashboard JSON으로 변환

이 repository는 앱 코드만 담는다. 기존 `Chocomint-Lab`의 `Calc/`, `wiki/`, `연구/` 구조와 결과 파일은 이동하거나 복제하지 않는다. 기존 Vault 안의 `master-thesis-os/` checkout은 로컬 개발용으로 계속 둘 수 있다.

## 설치와 실행

Node.js 20 이상과 npm, pnpm 또는 yarn이 필요하다. 로컬 파일 열기에는 Python 3.10 이상도 필요하다.

```powershell
Copy-Item .env.example .env.local
pnpm install
python -m pip install -r exporter/requirements.txt
pnpm dev
```

브라우저에서 `http://localhost:3000`을 연다. 검증 명령은 다음과 같다.

```powershell
pnpm lint
pnpm build
pnpm version:check
pnpm test:exporter
pnpm test:web
```

### 별도 app repository와 Vercel

Vercel project는 앱 code repository `jeyun123456/master-thesis-os`를 연결하고 **Root Directory는 repository root**로 둔다. Vercel의 Production/Preview 환경변수에는 `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_TOKEN`, Microsoft 365 public client ID 및 필요한 Google Calendar 변수를 설정한다. `LOCAL_REPOSITORY_ROOT`, bridge token, `local-bridge/config.json`은 개인 PC 전용이므로 Vercel에 올리지 않는다.

로컬에서 별도 app repository를 clone한 경우에는 `.env.local`에 기존 연구 Vault의 절대 경로를 지정한다.

```dotenv
LOCAL_REPOSITORY_ROOT=D:\path\to\Chocomint-Lab
```

이 값은 로컬 project/shortcut 읽기·쓰기와 Results의 credentials-free fallback, exporter 입력/출력 위치에 사용한다. GitHub 환경변수가 설정되면 GitHub API가 우선하며, 어느 경우에도 Files·Literature·Wiki 경로는 repository-relative path를 사용한다.

## 환경변수

GitHub·Google·AI provider 비밀값은 `.env.local` 또는 배포 플랫폼의 서버 환경변수로만 설정한다. Microsoft 365의 `NEXT_PUBLIC_` client ID와 authority는 SPA 브라우저 설정이라 공개되어도 되지만, client secret은 만들지 않고 access token은 저장하지 않는다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_OWNER` | GitHub 연결 시 | private repository 소유자 |
| `GITHUB_REPO` | GitHub 연결 시 | repository 이름 |
| `GITHUB_BRANCH` | 아니오 | 기본값 `master` |
| `GITHUB_TOKEN` | private repo에서 필수 | 기본 읽기 전용 Contents 권한. GitHub 모드에서 앱 편집을 허용할 때만 Contents 읽기·쓰기 권한이 필요하며, 공개 배포에 쓰기 토큰을 넣지 않음 |
| `GITHUB_WRITE_ENABLED` | 아니오 | 기본 `false`. 보호된 개인 배포에서만 `true`로 설정해 프로젝트 상태·바로가기 변경을 GitHub에 저장 |
| `GITHUB_RESULTS_PATH` | 아니오 | 프로젝트별 경로가 없을 때 사용하는 전역 dashboard fallback. 기본값 `projects/thesis/코드/결과/주요결과/dashboard` |
| `LOCAL_REPOSITORY_ROOT` | 로컬 Vault 모드·fallback/exporter 시 | 기존 `Chocomint-Lab` checkout의 절대 경로. Vercel에는 설정하지 않음 |
| `GOOGLE_CLIENT_ID` | OAuth Calendar 연결 시 | Google OAuth client ID. 서버 전용 |
| `GOOGLE_CLIENT_SECRET` | OAuth Calendar 연결 시 | Google OAuth client secret. 서버 전용 |
| `GOOGLE_REFRESH_TOKEN` | OAuth Calendar 연결 시 | Calendar read/write consent가 포함된 user refresh token. 서버 전용 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service Account fallback 시 | Google Service Account 이메일 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service Account fallback 시 | Service Account RS256 private key. Vercel에서는 `\n` escape를 허용 |
| `GOOGLE_CALENDAR_IDS` | Calendar 연결 시 | 쉼표로 구분한 하나 이상의 Calendar ID. OAuth에서는 `primary` 사용 가능 |
| `GOOGLE_CALENDAR_ID` | 임시 fallback | 기존 단일 Calendar ID. `GOOGLE_CALENDAR_IDS`가 우선 |
| `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` | Microsoft 연결 시 | Entra SPA App Registration의 Application (client) ID. secret 아님 |
| `NEXT_PUBLIC_MICROSOFT_AUTHORITY` | 아니오 | 기본값 `https://login.microsoftonline.com/organizations` |

데이터 remote는 `Chocomint-Lab`이며 `https://github.com/jeyun123456/Chocomint-Lab.git`을 가리킨다. 따라서 앱의 데이터 설정은 계속 `GITHUB_OWNER=jeyun123456`, `GITHUB_REPO=Chocomint-Lab`, `GITHUB_BRANCH=master`다. 이것은 앱 code repository와 별개다. private repo token은 직접 설정해야 하며 서버는 토큰이나 Google 인증 오류 응답 본문을 브라우저에 노출하지 않는다.

## GitHub 자동 분류

GitHub tree의 상대경로를 공통 식별자로 사용한다. 실제 저장소 구조에 맞춘 기본 분류는 다음과 같다.

- Wiki: `wiki/**` (기존 `concepts`, `methodology`, `data`, `decisions`, `findings`, `literature` 유지)
- Literature: `연구/문헌/**`, `연구/선행연구/**`, `wiki/literature/**`
- Results: 모든 프로젝트의 `projects/<id>/(코드/결과|results|outputs|산출물)/**`와 기존 `Calc/data/results/**`, `wiki/findings/**`
- Research: 나머지 `Calc/**`, `연구/**`, `wiki/**`

GitHub recursive tree가 API 한계로 잘리면 불완전한 목록을 사용하지 않고 오류를 표시한다.

## 바로가기와 Library 입력

상단의 **바로가기** 탭과 Home의 **작성 중 프로젝트 바로가기**는 Obsidian Vault의 `shared/shortcuts.md`를 기준으로 함께 구성한다. 파일이 없거나 저장소가 연결되지 않으면 기존 `config/shortcuts.json`을 호환용 기본값으로 사용하고, 브라우저 `localStorage`는 이 fallback을 보완하는 로컬 백업으로만 사용한다. `shared/shortcuts.md`의 마커 안 항목은 앱에서 추가·편집·복제·삭제·순서 변경할 수 있고, 마커 바깥의 Markdown 설명은 보존된다.

```text
shared/shortcuts.md
├─ <!-- master-thesis-os:shortcuts:start -->
├─ ### shortcut-id
├─ title / type / target / ...
└─ <!-- master-thesis-os:shortcuts:end -->
```

로컬 개발에서 `LOCAL_REPOSITORY_ROOT`를 지정하고 GitHub 저장소 변수를 비워 두면 해당 Vault 작업트리에 원자적으로 저장한다. GitHub 모드에서는 Contents API로 파일을 갱신할 수 있지만, 이 앱의 기본 UI에는 사용자 인증이 없으므로 공개 배포에는 쓰기 토큰을 넣지 않는다. GitHub 모드 편집이 정말 필요한 경우 별도의 인증·접근제어가 있는 개인 배포에서만 Contents 읽기·쓰기 토큰을 설정한다. 파일이 동시에 바뀌면 SHA를 비교해 저장을 거부하므로 먼저 새로고침해야 한다.

```json
{
  "id": "unique-id",
  "title": "표시 이름",
  "type": "web | uri | shell | app | file | folder | command",
  "target": "URL, 외부 URI, shell 항목, 절대 경로 또는 Vault 기준 상대경로",
  "description": "선택 설명",
  "icon": "선택 아이콘",
  "pinnedToHome": true,
  "enabled": true,
  "order": 10
}
```

`web`은 HTTP/HTTPS 링크, `uri`는 허용된 외부 앱 URI(`steam://`, `steamlink:`), `shell`은 제한된 Windows Shell 항목(`shell:RecycleBinFolder` 등)으로 열고, `file`은 기존 Local Bridge의 `/open`, `folder`는 `/open-folder`로 전달한다. `app`은 실행 파일과 인자를, `command`는 명령어를 사용한다. `enabled: false`는 모든 화면에서 숨기며, Home에는 `enabled: true`와 `pinnedToHome: true`인 항목만 표시한다. 파일·폴더 target은 연구 repository root 기준 안전한 상대경로여야 하고, 잘못된 항목은 무시된다. 외부 URI와 Windows Shell 항목은 명령어로 실행하지 않고 OS Shell에 직접 전달한다. 파일·폴더와 외부 대상 실행을 사용하려면 로컬 PC에서 bridge를 실행하고 Settings에 같은 token을 저장해야 한다. **서버 전환 후에는 `web` 링크와 저장소 경로 바로가기만 열린다(개인 PC 앱·파일·shell 항목은 지원하지 않음).**

예를 들어 `shared/shortcuts.md`의 마커 안에 다음처럼 등록할 수 있다.

```json
[
  { "id": "maple-story", "title": "메이플스토리", "type": "uri", "target": "steam://rungameid/3548580", "enabled": true, "pinnedToHome": false, "order": 50 },
  { "id": "recycle-bin", "title": "휴지통", "type": "shell", "target": "shell:RecycleBinFolder", "enabled": true, "pinnedToHome": false, "order": 60 }
]
```

자료실 검색창은 한국어·일본어 IME 조합 중 Enter/Escape와 전역 단축키 처리를 중지하고 composition이 끝난 뒤에만 처리한다. 따라서 조합 중인 입력이 검색어를 지우거나 제출하는 문제를 피한다.

## P1·P2: 연구 칸반, AI 인박스, AI Worker

연구 탭은 6단계 칸반(기획·자료 수집·분석·해석·집필·완료, 단계가 없으면 "단계 미확인")으로 시작하고, 카드를 누르면 전체 화면 프로젝트 상세로 들어간다. 카드의 다음 실행 작업·남은 할 일·가까운 마감은 P0 할 일 중 `project_id`가 그 프로젝트인 것만 집계한다.

메모·마일스톤·AI 인박스·승인·작업 확장 정보는 별도 서비스 [`services/mtos-agent`](./services/mtos-agent/README.md)가 서버 PC에서 소유한다. P0는 여전히 할 일과 세션의 유일한 원본이고, AI는 P0·Vault·Calendar에 직접 쓰지 않는다. 브라우저는 `/api/mtos/*`(P0 세션을 bearer로 전달)와 `/api/obsidian/*`를 통해서만 접근한다. 운영 배포 순서와 요구사항별 상태는 [`docs/p1-p2-final.md`](./docs/p1-p2-final.md)를 따른다.

## 프로젝트 작업공간

연구 탭은 Chocomint-Lab의 `02_Projects/<폴더>/project.md`를 자동 발견한다(폴더명이 프로젝트 id). Home 상단에는 `writing` 또는 `active` 상태인 프로젝트를 표시하고, 연구 탭의 상태 선택기는 해당 manifest의 frontmatter `status`만 수정한다. 제목·질문·결과 경로 등 나머지 Markdown은 그대로 보존한다. 상태 저장에도 파일 SHA를 사용하므로 다른 편집이 먼저 반영된 경우 덮어쓰지 않는다. 프로젝트가 표준 결과를 가지면 분석 결과 탭에서 기존 dashboard fallback과 함께 선택할 수 있다.

## Google Calendar

Calendar 연결은 서버에서만 수행한다. **사용자 OAuth refresh token을 우선 사용**하고, OAuth 3종 값이 없을 때만 기존 Service Account JWT 경로를 fallback으로 사용한다. 두 방식 모두 Calendar API read/write scope(`https://www.googleapis.com/auth/calendar`)를 전제로 하며 access token은 서버 메모리에서만 캐시한다.

### 사용자 OAuth 설정(권장)

이미 Google OAuth 인증을 완료해 refresh token을 확보했다면 Vercel Production/Preview와 로컬 `.env.local`에 다음 값을 넣는다. 이 값들은 절대 `NEXT_PUBLIC_`로 노출하지 않는다.

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_CALENDAR_IDS=primary
```

- `GOOGLE_REFRESH_TOKEN`은 사용하는 Google 기능의 consent scope가 포함된 계정에서 발급된 값이어야 한다. 현재 통합은 Calendar read/write, Gmail read-only, Drive read-only를 사용한다.
- 개인 기본 캘린더만 쓰면 `GOOGLE_CALENDAR_IDS=primary`가 가장 단순하다.
- 여러 캘린더를 함께 보려면 `primary,research-id@group.calendar.google.com`처럼 쉼표로 추가한다.
- OAuth와 Service Account 변수가 모두 있으면 **OAuth가 우선**한다. 따라서 전환 중에도 기존 Service Account 값을 잠시 남겨둘 수 있다.

서버는 refresh token을 `https://oauth2.googleapis.com/token`에 `grant_type=refresh_token`으로 교환해 access token을 얻는다. 같은 OAuth credential을 Calendar, Gmail read-only, Drive read-only에서 재사용한다. client secret·refresh token·access token은 브라우저 응답이나 로그에 출력하지 않는다. access token은 만료 직전까지 best-effort 메모리 cache하며, Vercel 인스턴스가 재시작되면 refresh token으로 다시 발급한다.

### Service Account fallback

OAuth를 쓰지 않는 배포에서는 기존 방식도 그대로 동작한다.

1. Google Cloud Console에서 Calendar API를 활성화한다.
2. Service Account와 JSON key를 만든다.
3. 대상 Calendar의 **Settings and sharing → Share with specific people**에서 Service Account 이메일을 추가하고 **Make changes to events** 권한을 준다.
4. 다음 서버 환경변수를 설정한다.

```dotenv
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@example.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_IDS=calendar-id@example.com,research-id@group.calendar.google.com
```

Service Account에는 사용자 `primary` 개념이 없으므로 실제 Calendar ID를 공유해야 한다. 기존 단일 ID 설정은 `GOOGLE_CALENDAR_ID`가 임시 fallback으로 남아 있지만 새 설정은 `GOOGLE_CALENDAR_IDS`를 사용한다.

### 동작과 검증

개발 서버를 재시작한 뒤 `http://localhost:3000/api/calendar/events?days=14`를 연다. 정상 연결이면 `state`가 `ready` 또는 `empty`이고, Home에 Today, Upcoming, Next Deadline 카드가 표시된다. API의 `days`는 1~365 범위로 제한되며 기본값은 14다.

여러 Calendar를 설정하면 각 Calendar의 `events.list`를 `singleEvents=true`, `orderBy=startTime`으로 조회한 뒤 하나의 목록으로 합치고 Asia/Seoul 기준 시작 시간으로 정렬한다. 반환 이벤트에는 source `calendarId`가 유지되며 동일 Calendar·event ID·시작 시각만 중복 제거한다. 한 Calendar 조회가 실패해도 성공한 Calendar의 일정은 반환하고, 모든 Calendar가 실패하면 API는 오류 상태를 반환한다.

메일·학교 공지에서 검토한 일정 후보를 추가할 때는 첫 번째 `GOOGLE_CALENDAR_IDS` 대상에 `events.insert`를 호출한다. 메일 ID와 candidate ID로 결정적 event ID를 만들어 재시도 시 중복 등록을 피한다.

표시는 `Asia/Seoul` 기준이다. 날짜만 있는 all-day event는 자정 변환 없이 해당 calendar 날짜를 유지한다. 제목·설명 키워드로 Meeting, Deadline, Research, Presentation, Other를 분류하지만 Google Calendar 원본은 수정하지 않는다.

상태별 동작은 다음과 같다.

- `unconfigured`: OAuth/Service Account 또는 Calendar ID 환경변수 미설정
- `empty`: 연결은 정상이지만 조회 기간에 일정 없음
- `auth_error`: OAuth refresh token/client credential 문제, Service Account 인증 문제 또는 공유 권한 문제
- `insufficient_permissions`: OAuth consent scope 또는 Calendar 권한 부족
- `invalid_calendar`: 잘못된 Calendar ID 또는 접근할 수 없는 Calendar
- `quota_error`: Calendar API quota/rate limit
- `network_error`: Google endpoint 연결 실패 또는 기타 upstream 오류
- `malformed_response`: token/event 응답 형식이 예상 계약과 다름

### 기존 Service Account 배포에서 OAuth로 전환

기존 Calendar 코드는 그대로 두고 환경변수만 다음처럼 추가하면 된다.

```text
GOOGLE_CLIENT_ID       -> 추가
GOOGLE_CLIENT_SECRET   -> 추가
GOOGLE_REFRESH_TOKEN   -> 추가
GOOGLE_CALENDAR_IDS    -> 유지 (개인 기본 캘린더라면 primary 가능)

GOOGLE_SERVICE_ACCOUNT_EMAIL        -> OAuth 검증 후 제거 가능
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  -> OAuth 검증 후 제거 가능
```

OAuth live 검증이 끝나기 전까지 Service Account 변수를 남겨도 된다. OAuth가 완전하게 설정된 동안에는 OAuth가 우선되므로 fallback credential은 사용되지 않는다.

기준 문서는 Google OAuth 2.0, OAuth refresh token, Calendar API, Gmail API, Drive API reference다. 자료실의 Google Drive 카드는 `drive.readonly` 범위에서 최근 수정 파일 metadata를 조회하고 원본 수정·삭제는 하지 않는다. 선택한 Google Docs·Slides는 plain text, Google Sheets는 첫 시트를 CSV, `text/*`·JSON/XML/JavaScript 파일은 원문 텍스트로 읽어 최대 200,000자까지 미리보기·내부 검색에 사용한다. 통합 연구자료 검색은 Drive API의 `fullText contains`/`name contains` 인덱스로 후보를 찾은 뒤 읽을 수 있는 상위 문서의 실제 본문에서 최대 3개 문맥 스니펫을 만든다. PDF와 기타 binary 파일은 Drive 인덱스 검색 결과에는 포함될 수 있지만 본문 텍스트 추출은 하지 않는다.

## Microsoft 365 학교 메일 Graph 연결(선택)

학교 메일은 IMAP이나 서버 저장소를 사용하지 않고, 브라우저의 `@azure/msal-browser`가 Microsoft Entra ID Authorization Code Flow + PKCE로 delegated token을 받은 뒤 Microsoft Graph를 직접 호출한다. MSAL cache는 현재 브라우저 탭/session에 한정된 `sessionStorage`를 사용하며 앱 서버·DB·Vercel 환경변수에 token을 저장하지 않는다. 현재 요청하는 Graph delegated permission은 `User.Read`와 `Mail.ReadBasic`뿐이다. 메일 본문·preview·첨부파일·메일 변경 API는 요청하지 않는다.

### Entra App Registration 설정

1. Azure Portal 또는 Microsoft Entra admin center의 **App registrations**에서 새 앱을 만들고, Supported account types는 `Accounts in any organizational directory`로 둔다. 현재 코드의 `organizations` authority와 맞추기 위한 설정이다.
2. **Authentication → Add a platform → Single-page application (SPA)**에 다음 redirect URI를 등록한다.
   - `http://localhost:3000`
   - `https://master-thesis-os.vercel.app`
3. **API permissions → Microsoft Graph → Delegated permissions**에 `User.Read`와 `Mail.ReadBasic`을 추가한다. 이 PoC에는 Application permission을 추가하지 않는다.
4. 앱의 **Application (client) ID**를 Vercel과 로컬 `.env.local`의 `NEXT_PUBLIC_MICROSOFT_CLIENT_ID`에 넣는다. `NEXT_PUBLIC_MICROSOFT_AUTHORITY`는 비워두거나 `https://login.microsoftonline.com/organizations`로 둔다.
5. SPA이므로 **client secret은 필요하지 않으며** `NEXT_PUBLIC_*`에 secret을 넣지 않는다. public 환경변수는 `next build` 전에 설정해야 한다.
6. 학교 계정으로 최초 로그인하고 MFA 및 consent 화면을 테스트한다.

설정의 **Microsoft Graph 연결(선택)**은 위 경로를 보조하는 기존 PoC다. 학교 tenant 정책이 `AADSTS65001`, `AADSTS90094` 또는 Graph 403으로 consent/admin approval을 요구하면 앱은 raw provider 오류 대신 접근 승인 필요 메시지를 표시한다.

## 학교 공지와 Thunderbird 이메일

두 기능은 진입점과 빈 화면(`학교 공지 연결 준비 중`, `Thunderbird 이메일 연결 준비 중`)만 남아 있다. 개인 PC Local Bridge와 로컬 수집기는 제거했고, 서버 기반 연결은 별도 작업으로 구축한다.

## AI YOLO 할 일 관리

할 일의 단일 원본은 서버 P0 SQLite다. 서버의 MTOS Agent worker가 `gpt-6-luna`(Codex CLI)에 구조화된 결과를 요청하고, 검증을 통과한 변경만 P0 task API(서비스 토큰, actor `ai`)로 반영한다. 설정은 `.env.example`의 `MTOS_YOLO_*`·`P0_SERVICE_TOKEN`, 변경 이력과 되돌리기는 `/agent/api/yolo/runs`를 본다. 기본값은 꺼져 있다(`MTOS_YOLO_ENABLED=0`).

## 프로젝트별 결과 구조

분석 결과 탭은 연구 탭과 마찬가지로 `projects/*/project.md`를 기준으로 프로젝트 목록을 만들고, 선택한 프로젝트의 결과 파일을 Vault tree에서 자동 발견한다. 계산 원자료나 결과 파일을 앱 repository에 복제하지 않는다.

권장 구조는 다음과 같다.

```text
projects/<project-id>/
├─ project.md
└─ 코드/
   └─ 결과/
      ├─ <run-or-method>/      # CSV, XLSX, 검증·재현 산출물
      └─ dashboard/            # 선택적 UI용 검증 bundle
         ├─ necessary_labour.json
         ├─ decomposition.json
         └─ validation.json
```

기존 Vault의 `코드/결과`, `results`, `outputs`, `산출물` 폴더는 별도 이동 없이 자동 인식한다. 더 특수한 위치를 사용하면 `project.md` frontmatter의 `results_path` 또는 `## 결과 경로` 목록에 repository-relative 경로를 등록한다. dashboard는 위 세 JSON이 같은 폴더에 모두 있고 `validation.json.status`가 `pass`일 때만 대표 결과로 표시된다. 나머지 CSV·XLSX·PDF 등의 결과 파일은 프로젝트별 파일 목록에서 확인하고 로컬 브리지로 열 수 있다.

선택한 프로젝트에 dashboard bundle이 없으면 다른 프로젝트의 수치를 섞어 표시하지 않고, 결과 파일 목록과 명확한 empty state만 표시한다. 프로젝트 선택 전의 `/api/results`와 `GITHUB_RESULTS_PATH`는 기존 사용자를 위한 전역 fallback으로 유지된다.

표준 결과 bundle이 있으면 legacy dashboard보다 우선한다. 표준 Results 화면은 bundle 안의 각 metric·table·chart 항목마다 호환되는 dataset을 선택할 수 있고, 우측 `추가`로 표시 항목을 만들거나 각 카드의 `삭제`로 뺄 수 있다. 표는 행/열 전환, 차트는 선·막대·산점도 선택과 축 방향 전환·가로축·값 열·X/Y 축 범위 선택을 지원한다. 이 조정은 현재 화면에만 적용되며 원격 `view.json`을 자동으로 수정하지 않는다. 확정한 설정은 화면의 `view.json 복사` 또는 `view.json 다운로드`로 내보낸 뒤 검토하여 저장소에 반영한다.

## Results JSON 계약

### 프로젝트 표준 결과 계약

표준 bundle은 다음 네 파일을 하나의 결과 경계로 사용한다.

```text
projects/<project-id>/results/
├─ result.json
├─ view.json
└─ sources/
   ├─ scalar.csv
   └─ matrix.xlsx
```

`result.json`은 `scalar.csv`와 `matrix.xlsx`의 dataset ID, kind(`metrics`, `table`, `chart`), XLSX sheet 이름을 연결한다. `view.json`은 표시 순서와 항목별 dataset 참조를 정의한다. chart의 `chartType`은 `line`, `bar`, `scatter` 중 하나이고 `transpose`는 표에서는 행/열, 차트에서는 category/series 방향 전환으로 해석한다. chart의 선택적 `xMin`, `xMax`, `yMin`, `yMax`는 숫자 축 범위이며 생략하면 자동 범위를 사용한다. 원자료는 수정하지 않고 표시 설정만 `view.json`에 둔다. XLSX는 서버의 표준 결과 loader가 sheet별 dataset으로 읽어 화면에 전달한다.

표준 bundle을 읽지 못하거나 해당 프로젝트에 bundle이 없으면 기존 dashboard JSON 또는 결과 파일 목록 fallback을 사용한다. 표준 계약의 예시는 별도 `Chocomint-Lab` repository의 `projects/<project-id>/results/` 아래에서 확인한다.

legacy dashboard 경로에서는 별도 Python exporter가 연구 Vault의 canonical workbook을 read-only로 열어 선택한 프로젝트의 dashboard 폴더에 다음 JSON을 생성한다. 현재 필요노동 dashboard의 canonical 경로는 `projects/thesis/코드/결과/주요결과/dashboard/`다.

- `necessary_labour.json`: 연도별 필요노동 시간
- `decomposition.json`: 기간별 총변화·바스켓 효과·투하노동량 효과
- `validation.json`: 생성 시 수행한 검증 상태와 메시지

계약은 `schemas/*.schema.json`에 있다. exporter는 임시 파일에 세 문서를 모두 작성하고 schema, 연도, endpoint, 분해 항등식, 산업합계를 검증한 후에만 기존 JSON을 교체한다.

```powershell
# Standalone app checkout: the output is written into the existing data repository.
python exporter/export_results.py --repository-root "D:\path\to\Chocomint-Lab"

# In the Chocomint-Lab checkout, commit the generated data there.
Set-Location "D:\path\to\Chocomint-Lab"
git add "projects/thesis/코드/결과/주요결과/dashboard"
git commit -m "data(results): refresh dashboard export"
git push origin master
```

재현 흐름은 다음과 같다.

```text
Calc result workbook
→ exporter/export_results.py
→ projects/<project-id>/코드/결과/**
→ dashboard/*.json (선택)
→ Git commit/push
→ /api/results?path=<dashboard-path>
→ Master Thesis OS Results
```

`validation.json`의 범위는 `exporter-only`다. 저장 workbook에서 값을 빠짐없이 추출했는지, 05와 06의 endpoint가 일치하는지, 저장된 2요인 합계와 산업합계가 맞는지를 확인한다. 원자료부터 Calc 파이프라인을 재실행하거나 계산 방법론을 독립 검증했다는 뜻은 아니다.

## 인증정보 없는 동작

- GitHub와 `LOCAL_REPOSITORY_ROOT`가 모두 미설정: 빈 repository 목록
- Calendar 미설정·인증 실패·quota/network 오류: 원인을 구분한 일정 empty/error state
- Results JSON 미설정·누락·invalid: 오류 이유가 포함된 empty state

로컬 개발에서 `LOCAL_REPOSITORY_ROOT`가 설정되고 GitHub 환경변수가 비어 있으면 서버는 지정한 Vault 작업트리에서 project manifest, shortcut Markdown, 표준 결과와 검증된 JSON을 읽고 필요한 변경을 원자적으로 저장한다. GitHub 환경변수가 설정되면 같은 상대경로를 GitHub API에서 읽으며, GitHub 쓰기는 `GITHUB_WRITE_ENABLED=true`인 보호된 배포에서만 허용한다.

## v1 release checklist

2026-09-08 기준 검증 상태다. `[ ]` 항목은 release 전에 실제 환경에서 완료해야 한다.

- [x] Results exporter JSON을 `/api/results`와 Results UI에서 실제 값으로 로딩
- [x] Google Calendar live 응답과 Home의 Today, Upcoming, Next Deadline 표시
- [x] GitHub live data: `jeyun123456/Chocomint-Lab`의 `master`를 read-only fine-grained token으로 확인. `/api/github/tree`는 `configured: true`와 실제 tree 항목을 반환하고, Results JSON은 GitHub source에서 로드됨
- [x] Calendar, Results, GitHub 미설정·빈 결과·오류 상태 처리
- [x] `.env.local`이 Git에서 제외되고 client bundle에 server secret을 넣지 않음
- [x] production build와 자동 테스트 통과
- [ ] Calendar OAuth live data: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_IDS`를 Vercel에 설정한 뒤 `/api/calendar/events?days=14`가 `ready` 또는 `empty`를 반환하는지 확인

Release 직전에는 `git status`, `/api/results`, `/api/calendar/events?days=14`, `/api/github/tree`를 다시 확인한다. GitHub와 로컬 파일의 공통 식별자는 repository root 기준 `/` 구분 상대경로다.
