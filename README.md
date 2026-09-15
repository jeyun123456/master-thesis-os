# Master Thesis OS

필요노동 석사논문 저장소를 읽는 Next.js 대시보드다. 앱 코드는 이 독립 repository에 두고, 연구 자료의 source of truth는 별도 private repository [`jeyun123456/Obsidian-Vault`](https://github.com/jeyun123456/Obsidian-Vault)로 유지한다. 앱 DB로 연구 파일을 복제하지 않는다. dashboard JSON이 없거나 검증되지 않으면 수치 대신 명확한 empty state를 표시한다.

## 제품 버전

- Master Thesis OS 웹 앱: `1.3.0` — canonical source는 root `package.json`
- Wallpaper Companion: `0.6.1` — canonical source는 `experiments/wallpaper-host-poc/WallpaperHostPoc.csproj`
- 버전 규칙과 release 절차: [`VERSIONING.md`](./VERSIONING.md)

## 구성

- `app/`: 9개 필수 페이지 UI와 서버 API routes
- `lib/`: GitHub·Calendar 서버 클라이언트, Thunderbird Local Bridge·Microsoft Graph 브라우저 클라이언트, project/result discovery, repository 분류, Results 데이터 계약
- `schemas/`: Excel과 UI 사이의 dashboard JSON Schema
- `exporter/`: canonical 결과 workbook을 검증된 dashboard JSON으로 변환
- `local-bridge/`: GitHub 상대경로와 Thunderbird 로컬 메일 메타데이터를 읽는 loopback 전용 브리지

이 repository는 앱 코드만 담는다. 기존 `Obsidian-Vault`의 `Calc/`, `wiki/`, `연구/` 구조와 결과 파일은 이동하거나 복제하지 않는다. 기존 Vault 안의 `master-thesis-os/` checkout은 로컬 개발용으로 계속 둘 수 있다.

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
pnpm test:bridge
pnpm test:exporter
pnpm test:web
```

### 별도 app repository와 Vercel

Vercel project는 앱 code repository `jeyun123456/master-thesis-os`를 연결하고 **Root Directory는 repository root**로 둔다. Vercel의 Production/Preview 환경변수에는 `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_TOKEN`, Microsoft 365 public client ID 및 필요한 Google Calendar 변수를 설정한다. `LOCAL_REPOSITORY_ROOT`, bridge token, `local-bridge/config.json`은 개인 PC 전용이므로 Vercel에 올리지 않는다.

로컬에서 별도 app repository를 clone한 경우에는 `.env.local`에 기존 연구 Vault의 절대 경로를 지정한다.

```dotenv
LOCAL_REPOSITORY_ROOT=D:\path\to\Obsidian-Vault
```

이 값은 로컬 project/shortcut 읽기·쓰기와 Results의 credentials-free fallback, exporter 입력/출력 위치에 사용한다. GitHub 환경변수가 설정되면 GitHub API가 우선하며, 어느 경우에도 Files·Literature·Wiki 경로는 repository-relative path를 사용한다.

## 환경변수

GitHub·Google 비밀값은 `.env.local` 또는 배포 플랫폼의 서버 환경변수로만 설정한다. Microsoft 365의 `NEXT_PUBLIC_` client ID와 authority는 SPA 브라우저 설정이라 공개되어도 되지만, client secret은 만들지 않고 access token은 저장하지 않는다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_OWNER` | GitHub 연결 시 | private repository 소유자 |
| `GITHUB_REPO` | GitHub 연결 시 | repository 이름 |
| `GITHUB_BRANCH` | 아니오 | 기본값 `master` |
| `GITHUB_TOKEN` | private repo에서 필수 | 기본 읽기 전용 Contents 권한. GitHub 모드에서 앱 편집을 허용할 때만 Contents 읽기·쓰기 권한이 필요하며, 공개 배포에 쓰기 토큰을 넣지 않음 |
| `GITHUB_WRITE_ENABLED` | 아니오 | 기본 `false`. 보호된 개인 배포에서만 `true`로 설정해 프로젝트 상태·바로가기 변경을 GitHub에 저장 |
| `GITHUB_RESULTS_PATH` | 아니오 | 프로젝트별 경로가 없을 때 사용하는 전역 dashboard fallback. 기본값 `projects/interim-presentation/코드/결과/주요결과/dashboard` |
| `LOCAL_REPOSITORY_ROOT` | 로컬 Vault 모드·fallback/exporter 시 | 기존 `Obsidian-Vault` checkout의 절대 경로. Vercel에는 설정하지 않음 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Calendar 연결 시 | Google Service Account 이메일 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Calendar 연결 시 | Service Account RS256 private key. Vercel에서는 `\n` escape를 허용 |
| `GOOGLE_CALENDAR_IDS` | Calendar 연결 시 | 쉼표로 구분한 하나 이상의 Calendar ID |
| `GOOGLE_CALENDAR_ID` | 임시 fallback | 기존 단일 Calendar ID. `GOOGLE_CALENDAR_IDS`가 우선 |
| `NEXT_PUBLIC_LOCAL_BRIDGE_URL` | 아니오 | 기본값 `http://127.0.0.1:38471` |
| `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` | Microsoft 연결 시 | Entra SPA App Registration의 Application (client) ID. secret 아님 |
| `NEXT_PUBLIC_MICROSOFT_AUTHORITY` | 아니오 | 기본값 `https://login.microsoftonline.com/organizations` |

데이터 remote는 `Obsidian-Vault`이며 `https://github.com/jeyun123456/Obsidian-Vault.git`을 가리킨다. 따라서 앱의 데이터 설정은 계속 `GITHUB_OWNER=jeyun123456`, `GITHUB_REPO=Obsidian-Vault`, `GITHUB_BRANCH=master`다. 이것은 앱 code repository와 별개다. private repo token은 직접 설정해야 하며 서버는 토큰이나 Google 인증 오류 응답 본문을 브라우저에 노출하지 않는다.

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

`web`은 HTTP/HTTPS 링크, `uri`는 허용된 외부 앱 URI(`steam://`, `steamlink:`), `shell`은 제한된 Windows Shell 항목(`shell:RecycleBinFolder` 등)으로 열고, `file`은 기존 Local Bridge의 `/open`, `folder`는 `/open-folder`로 전달한다. `app`은 실행 파일과 인자를, `command`는 명령어를 사용한다. `enabled: false`는 모든 화면에서 숨기며, Home에는 `enabled: true`와 `pinnedToHome: true`인 항목만 표시한다. 파일·폴더 target은 연구 repository root 기준 안전한 상대경로여야 하고, 잘못된 항목은 무시된다. 외부 URI와 Windows Shell 항목은 명령어로 실행하지 않고 OS Shell에 직접 전달한다. 파일·폴더와 외부 대상 실행을 사용하려면 로컬 PC에서 bridge를 실행하고 Settings에 같은 token을 저장해야 한다.

예를 들어 `shared/shortcuts.md`의 마커 안에 다음처럼 등록할 수 있다.

```json
[
  { "id": "maple-story", "title": "메이플스토리", "type": "uri", "target": "steam://rungameid/3548580", "enabled": true, "pinnedToHome": false, "order": 50 },
  { "id": "recycle-bin", "title": "휴지통", "type": "shell", "target": "shell:RecycleBinFolder", "enabled": true, "pinnedToHome": false, "order": 60 }
]
```

자료실 검색창은 한국어·일본어 IME 조합 중 Enter/Escape와 전역 단축키 처리를 중지하고 composition이 끝난 뒤에만 처리한다. 따라서 조합 중인 입력이 검색어를 지우거나 제출하는 문제를 피한다.

## 프로젝트 작업공간

연구 탭은 `projects/<project-id>/project.md`를 자동 발견한다. Home 상단에는 `writing` 또는 `active` 상태인 프로젝트를 표시하고, 연구 탭의 상태 선택기는 해당 manifest의 frontmatter `status`만 수정한다. 제목·질문·결과 경로 등 나머지 Markdown은 그대로 보존한다. 상태 저장에도 파일 SHA를 사용하므로 다른 편집이 먼저 반영된 경우 덮어쓰지 않는다. 프로젝트가 표준 결과를 가지면 분석 결과 탭에서 기존 dashboard fallback과 함께 선택할 수 있다.

## Google Calendar

Calendar 연결은 Service Account JWT bearer 인증을 사용하는 서버 전용 읽기 방식이다. 사용자 OAuth와 refresh token이 runtime 경로에 필요하지 않으므로 반복 재인증에 의존하지 않는다.

### Service Account 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 project를 만들거나 선택한다.
2. API Library에서 **Google Calendar API**를 활성화한다.
3. IAM 및 관리자 → **Service Accounts**에서 Service Account를 만들고 credentials를 생성한다. JSON key 파일은 로컬에서만 사용하며 Git에 추가하지 않는다.
4. 읽을 각 Google Calendar의 **Settings and sharing → Share with specific people**에서 Service Account 이메일을 추가하고 **See all event details** 권한을 부여한다.
5. `.env.example`을 `.env.local`로 복사하고 서버 환경변수에 다음 값을 설정한다.

```dotenv
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@example.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CALENDAR_IDS=calendar-id@example.com,research-id@group.calendar.google.com
```

`GOOGLE_CALENDAR_IDS`는 쉼표 구분 목록이며 공백·빈 항목은 무시하고 중복 ID는 한 번만 조회한다. 현재 하나의 Calendar만 사용한다면 ID 하나만 넣으면 된다. Service Account에는 사용자의 `primary` calendar라는 개념이 없으므로 실제 Calendar ID를 공유해야 한다. 기존 설정을 잠시 유지해야 하는 경우 `GOOGLE_CALENDAR_ID`를 단일 ID fallback으로 사용할 수 있지만, 새 배포에서는 `GOOGLE_CALENDAR_IDS`를 사용한다.

개발 서버를 재시작한 뒤 `http://localhost:3000/api/calendar/events?days=14`를 연다. 정상 연결이면 `state`가 `ready` 또는 `empty`이고, Home에 Today, Upcoming, Next Deadline 카드가 표시된다. API의 `days`는 1~365 범위로 제한되며 기본값은 14다.

서버는 Service Account private key로 RS256 JWT를 만들고 Google token endpoint에서 access token을 교환한다. private key와 access token은 서버 메모리에서만 사용하며 브라우저 응답·로그·client bundle에 포함하지 않는다. access token은 만료 직전까지 best-effort 메모리 cache되며, Vercel 인스턴스가 새로 시작해 cache가 없어도 정상적으로 다시 발급한다. 일정 결과는 서버 메모리에 5분간 cache된다.

여러 Calendar를 설정하면 각 Calendar의 `events.list`를 `singleEvents=true`, `orderBy=startTime`으로 조회한 뒤 하나의 목록으로 합치고 Asia/Seoul 기준 시작 시간으로 정렬한다. 반환 이벤트에는 source `calendarId`가 유지되며, 동일 Calendar·event ID·시작 시각만 중복 제거한다. 한 Calendar 조회가 실패해도 성공한 Calendar의 일정은 반환하고 서버에 비민감 진단만 남긴다. 모든 Calendar가 실패하면 API는 오류 상태를 반환한다.

표시는 `Asia/Seoul` 기준이다. 날짜만 있는 all-day event는 자정 변환 없이 해당 calendar 날짜를 유지한다. 제목·설명에 포함된 한글/영문 키워드로 Meeting, Deadline, Research, Presentation, Other를 분류하지만 Google Calendar 원본은 수정하지 않는다.

상태별 동작은 다음과 같다.

- `unconfigured`: 환경변수 미설정
- `empty`: 연결은 정상이지만 조회 기간에 일정 없음
- `auth_error`: Service Account 인증 또는 Calendar 공유 권한 문제
- `invalid_calendar`: 잘못된 Calendar ID 또는 해당 Service Account에 공유되지 않은 Calendar
- `quota_error`: Calendar API quota/rate limit
- `network_error`: Google endpoint 연결 실패 또는 기타 upstream 오류
- `malformed_response`: token/event 응답 형식이 예상 계약과 다름

기준 문서는 [Service Account OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/service-account), [Calendar API 인증](https://developers.google.com/workspace/calendar/api/auth), [Events.list reference](https://developers.google.com/calendar/api/v3/reference/events/list)다.

### 다른 Calendar 추가

1. 새 Calendar를 같은 Service Account 이메일에 **See all event details** 권한으로 공유한다.
2. 해당 Calendar ID를 `GOOGLE_CALENDAR_IDS` 쉼표 목록에 추가한다.
3. Vercel 환경변수를 갱신하고 필요하면 재배포한다.

기존 OAuth runtime 경로(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`)는 Service Account 전환으로 더 이상 사용하지 않는다. 배포 검증 후 Vercel과 로컬 `.env.local`에서 제거할 수 있다. `GOOGLE_CALENDAR_ID`는 구버전 단일 ID의 임시 fallback으로만 남아 있다.

환경변수 migration:

```text
GOOGLE_CLIENT_ID                  -> 제거
GOOGLE_CLIENT_SECRET              -> 제거
GOOGLE_REFRESH_TOKEN              -> 제거
GOOGLE_CALENDAR_ID                -> GOOGLE_CALENDAR_IDS (쉼표 구분)
신규 GOOGLE_SERVICE_ACCOUNT_EMAIL -> Service Account 이메일
신규 GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY -> RS256 private key
```

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

## Thunderbird Local 학교 메일

현재 기본 학교 메일 소스는 Thunderbird Local이다. Thunderbird가 OAuth 또는 IMAP/Graph로 이미 동기화한 로컬 profile의 받은편지함 mbox/maildir에서 메일 **헤더 메타데이터만** Local Bridge가 read-only로 읽는다. Microsoft Graph access token, Thunderbird OAuth token·password·cookie, `logins.json`, `key4.db`, 메일 본문과 첨부파일은 읽지 않는다. `global-messages-db.sqlite`와 `.msf` 파일도 canonical source로 사용하지 않는다.

기존 `local-bridge/config.json`은 그대로 동작한다. 자동 탐지가 애매할 때만 다음 선택 설정을 추가한다. 실제 이메일 주소나 profile 절대 경로는 repository에 넣지 않는다.

```json
{
  "thunderbird": {
    "account": "school-account@example.edu",
    "profile_path": "C:\\Users\\your-name\\AppData\\Roaming\\Thunderbird\\Profiles\\profile.default"
  }
}
```

`account`와 `profile_path`가 비어 있으면 `%APPDATA%\\Thunderbird\\profiles.ini`의 우선 profile과 `prefs.js`를 자동 탐색한다. mbox는 확장자 없는 받은편지함 파일을, maildir은 `cur/new/tmp`를 읽으며 요청당 기본 5개·최대 20개의 제목·발신자·Date·read 상태만 반환한다. mbox가 변경되면 mtime/size 기반의 메타데이터 cache를 무효화한다. Thunderbird profile에는 어떤 write도 수행하지 않는다.

Home의 **학교 메일** 카드는 `Thunderbird ● 로컬`을 primary source로 표시하고, Local Bridge가 꺼져 있거나 local sync가 부족하면 해당 상태만 보여준다. 받은 metadata 중 최근 최대 20개를 웹의 규칙 기반 classifier로 평가해 긴급·중요 메일을 최대 5개 우선 표시한다. 이 분류는 제목·발신자·수신 시각·read 상태만 사용하며 본문을 읽거나 외부 API로 전송하지 않는다. 메시지별 Outlook URL은 만들지 않으며, 가능한 경우 인증된 `/mail/open`을 통해 Thunderbird 프로그램만 연다.

## localhost bridge

```powershell
Set-Location local-bridge
Copy-Item config.example.json config.json
# config.json의 master_path, token 수정
python bridge.py
```

Wallpaper Companion과 Bridge tray는 다음 공용 설정을 우선 사용한다.
`%LOCALAPPDATA%\MasterThesisOSWallpaper\bridge\config.json`이 없으면 기존 `local-bridge\config.json`을 fallback으로 사용한다. 공용 config가 존재하면 유효성 오류가 있어도 다른 config로 조용히 fallback하지 않는다. 다른 위치를 사용해야 하면 `MTO_BRIDGE_CONFIG` 환경변수로 config 경로를 지정할 수 있으며, override가 설정되면 해당 경로만 사용한다. Companion 설치 시 기존 local config가 공용 위치에 없을 때만 한 번 복사하며, 기존 공용 config는 덮어쓰지 않는다.

`token`은 32자 이상의 임의 문자열이어야 한다. Companion과 Bridge는 선택된 동일 config를 사용하며, token은 공백을 임의로 제거하지 않는다. 설정 파일을 변경한 뒤에는 실행 중인 Bridge와 tray를 다시 시작한다.

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

브리지는 `127.0.0.1` bind, 명시된 localhost와 `https://master-thesis-os.vercel.app` origin allowlist, token 상수시간 비교, 16 KiB 요청 한도, `Path.resolve()` 후 Master Path 내부의 실제 파일·디렉터리만 허용, health 응답의 경로 비공개를 강제한다. 웹 Settings에 같은 token을 저장하면 `{master_path}/{GitHub 상대경로}`를 기본 앱으로 열고, **볼트 폴더 열기**는 `/open-folder`로 master path 또는 지정 파일의 안전한 부모 폴더를 연다. 학교 메일은 같은 인증 모델의 `POST /mail/recent`와 `POST /mail/open`을 사용하며, 메일 endpoint는 경로·본문·제목·발신자·token을 로그에 남기지 않는다. Settings의 token은 `보기/숨기기`와 `복사`로 관리할 수 있고, Local Bridge tray와 Wallpaper Companion tray의 **Bridge token 보기/복사**에서도 로컬 config 값을 확인·복사할 수 있다. token을 HTTP endpoint나 원격 페이지에 자동 노출하지는 않는다. 실제 `config.json`은 git에서 제외된다.

### 브리지 상시 실행

Windows에서 `local-bridge/start_bridge.bat`을 실행하면 설정을 확인한 뒤 브리지를 계속 실행한다. 브리지가 일시적인 오류로 종료되면 3초 후 자동으로 재시작하지만, `config.json` 영구 설정 오류는 exit code 78로 식별해 재시작하지 않는다. 콘솔 없이 실행하려면 `start_bridge_hidden.vbs`를 사용한다. 시스템 트레이 아이콘과 상태 확인·종료 메뉴를 쓰려면 `start_bridge_tray.vbs`를 사용한다. Local Bridge tray 또는 Wallpaper Companion tray의 **Bridge token 복사**를 누른 뒤 Production Settings의 **붙여넣기**와 **저장**을 누르면 토큰을 설정할 수 있다. 브라우저 보안상 트레이가 웹페이지에 token을 자동 주입하지는 않는다. 트레이에서 상태 확인을 누르면 공용 또는 override config의 `port`를 사용하며, 생략 시 `38471`을 사용한다. 잘못된 port는 트레이에 설정 오류로 표시된다. 설정 오류 balloon이 표시되면 `config.json`을 수정한 뒤 트레이 실행기를 다시 시작한다. Windows 로그인 때마다 트레이 실행기를 자동 시작하려면 해당 VBS 파일의 바로가기를 `Win+R` → `shell:startup` 폴더에 넣는다. 일반 브라우저 개발 시에는 `start_bridge.bat`을 사용하고, 중지는 콘솔 창에서 `Ctrl+C` 또는 창 닫기로 수행한다.

## Sucrose 설정

Sucrose에서는 별도 전용 경로 대신 일반 대시보드 `https://master-thesis-os.vercel.app/`를 사용한다. 일반 대시보드의 기존 레이아웃과 데이터 로딩을 그대로 사용한다.

일반 대시보드의 **로컬 파일 열기**와 **볼트 폴더 열기**는 클릭했을 때만 loopback bridge를 호출한다. 먼저 Settings에서 같은 bridge token을 저장하고, 로컬 PC에서 bridge를 실행해야 한다. 브리지의 `config.json`에는 `https://master-thesis-os.vercel.app`를 명시적으로 허용하고 wildcard는 사용하지 않는다.

### Sucrose WebViewLive에서 Local Bridge가 차단될 때

정상적인 Production 페이지 context는 다음과 같다.

```text
location.href   = https://master-thesis-os.vercel.app/
location.origin = https://master-thesis-os.vercel.app
window.isSecureContext = true
```

`GET http://127.0.0.1:38471/health`가 `200 {"ok":true}`인데 자료실의 **열기** 또는 설정의 **볼트 폴더 열기**에서 다음 메시지가 나오면 Sucrose의 browser argument를 확인한다.

```text
Origin blocked: bridge allowed_origins에 Vercel 주소를 추가해줘.
```

Sucrose DevTools Network에서 `/open` 또는 `/open-folder` 요청을 확인한다.

- 문제 상태: 요청은 bridge에 도달하지만 `Origin` header가 없고 `403 {"error":"origin not allowed"}`가 반환됨
- 정상 상태: `Origin: https://master-thesis-os.vercel.app`가 포함되고 `200 OK`가 반환됨

원인은 Sucrose `WebArguments`의 `--disable-web-security`가 WebViewLive의 cross-site localhost 요청에서 `Origin` header를 누락시킬 수 있기 때문이다. 해결하려면 Sucrose를 완전히 종료한 뒤 `Engine.json`의 `WebArguments`에서 **`--disable-web-security`만 제거**하고 Sucrose를 다시 시작한다. 다른 browser argument는 현재 동작에 필요할 수 있으므로 임의로 초기화하지 않는다. `DeveloperMode`는 진단 중에만 켤 수 있고, 확인 후에는 꺼도 된다.

이 문제를 해결하기 위해 bridge 보안을 완화하지 않는다. `Access-Control-Allow-Origin: *`, 모든 Origin, `null` 또는 Origin 없는 요청, Sucrose User-Agent만을 허용하지 않는다. bridge는 계속 `127.0.0.1`에만 bind하고, exact production/localhost allowlist, token 검증, 요청 크기 제한, Vault 내부 path containment를 적용한다. 거부 로그에는 원인 확인을 위해 origin만 남기며 token, request body, local path, secret/config 값은 기록하지 않는다.

앱의 Sucrose UA 감지 시 `targetAddressSpace: 'loopback'`을 지정하는 로직은 유지한다. 이는 현재 WebViewLive에서 `/health`와 bridge 요청의 loopback/LNA 호환성을 위한 보조 설정이며, Origin 검증을 대체하지 않는다.

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

표준 bundle을 읽지 못하거나 해당 프로젝트에 bundle이 없으면 기존 dashboard JSON 또는 결과 파일 목록 fallback을 사용한다. 표준 계약의 예시는 별도 `Obsidian-Vault` repository의 `projects/<project-id>/results/` 아래에서 확인한다.

legacy dashboard 경로에서는 별도 Python exporter가 연구 Vault의 canonical workbook을 read-only로 열어 선택한 프로젝트의 dashboard 폴더에 다음 JSON을 생성한다. 현재 필요노동 dashboard의 canonical 경로는 `projects/interim-presentation/코드/결과/주요결과/dashboard/`다.

- `necessary_labour.json`: 연도별 필요노동 시간
- `decomposition.json`: 기간별 총변화·바스켓 효과·투하노동량 효과
- `validation.json`: 생성 시 수행한 검증 상태와 메시지

계약은 `schemas/*.schema.json`에 있다. exporter는 임시 파일에 세 문서를 모두 작성하고 schema, 연도, endpoint, 분해 항등식, 산업합계를 검증한 후에만 기존 JSON을 교체한다.

```powershell
# Standalone app checkout: the output is written into the existing data repository.
python exporter/export_results.py --repository-root "D:\path\to\Obsidian-Vault"

# In the Obsidian-Vault checkout, commit the generated data there.
Set-Location "D:\path\to\Obsidian-Vault"
git add "projects/interim-presentation/코드/결과/주요결과/dashboard"
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
- [x] GitHub live data: `jeyun123456/Obsidian-Vault`의 `master`를 read-only fine-grained token으로 확인. `/api/github/tree`는 `configured: true`와 실제 tree 항목을 반환하고, Results JSON은 GitHub source에서 로드됨
- [x] Open Local: PDF, XLSX, PPTX, Markdown, TypeScript 파일을 repository 상대경로로 bridge에 전달
- [x] Open Local 보안: origin/token, Master Path escape, 없는 파일, 디렉터리 요청 거부
- [x] Calendar, Results, GitHub 미설정·빈 결과·오류 상태 처리
- [x] `.env.local`과 `local-bridge/config.json`이 Git에서 제외되고 client bundle에 server secret을 넣지 않음
- [x] production build와 자동 테스트 통과
- [ ] Calendar Service Account live data: Service Account에 Calendar를 공유하고 `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_CALENDAR_IDS`를 Vercel에 설정한 뒤 `/api/calendar/events?days=14`가 `ready` 또는 `empty`를 반환하는지 확인
- [x] bridge startup: `local-bridge/config.json` 설정 후 `python bridge.py`, `/health` 확인

Release 직전에는 `git status`, `/api/results`, `/api/calendar/events?days=14`, `/api/github/tree`, `http://127.0.0.1:38471/health`를 다시 확인한다. GitHub와 로컬 파일의 공통 식별자는 repository root 기준 `/` 구분 상대경로다.
