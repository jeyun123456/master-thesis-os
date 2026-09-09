# Master Thesis OS

필요노동 석사논문 저장소를 읽는 Next.js 대시보드다. 앱 코드는 이 독립 repository에 두고, 연구 자료의 source of truth는 별도 private repository [`jeyun123456/Obsidian-Vault`](https://github.com/jeyun123456/Obsidian-Vault)로 유지한다. 앱 DB로 연구 파일을 복제하지 않는다. dashboard JSON이 없거나 검증되지 않으면 수치 대신 명확한 empty state를 표시한다.

## 구성

- `app/`: 9개 필수 페이지 UI와 서버 API routes
- `lib/`: GitHub·Calendar 서버 클라이언트, repository 분류, Results 데이터 계약
- `schemas/`: Excel과 UI 사이의 dashboard JSON Schema
- `exporter/`: canonical 결과 workbook을 검증된 dashboard JSON으로 변환
- `local-bridge/`: GitHub 상대경로로 로컬 파일을 여는 loopback 전용 브리지

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
pnpm test:bridge
pnpm test:exporter
pnpm test:web
```

### 별도 app repository와 Vercel

Vercel project는 앱 code repository `jeyun123456/master-thesis-os`를 연결하고 **Root Directory는 repository root**로 둔다. Vercel의 Production/Preview 환경변수에는 `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_TOKEN` 및 필요한 Google Calendar 변수를 설정한다. `LOCAL_REPOSITORY_ROOT`, bridge token, `local-bridge/config.json`은 개인 PC 전용이므로 Vercel에 올리지 않는다.

로컬에서 별도 app repository를 clone한 경우에는 `.env.local`에 기존 연구 Vault의 절대 경로를 지정한다.

```dotenv
LOCAL_REPOSITORY_ROOT=D:\path\to\Obsidian-Vault
```

이 값은 Results의 credentials-free local fallback과 exporter 입력/출력 위치에만 사용한다. Files, Literature, Wiki와 production Results는 GitHub API의 repository-relative path를 사용하므로 app checkout의 부모 경로에 의존하지 않는다.

## 환경변수

GitHub·Google 비밀값은 `.env.local` 또는 배포 플랫폼의 서버 환경변수로만 설정한다. `NEXT_PUBLIC_` 브리지 URL 외에는 브라우저 번들에 포함하지 않는다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_OWNER` | GitHub 연결 시 | private repository 소유자 |
| `GITHUB_REPO` | GitHub 연결 시 | repository 이름 |
| `GITHUB_BRANCH` | 아니오 | 기본값 `master` |
| `GITHUB_TOKEN` | private repo에서 필수 | Contents 읽기 권한의 fine-grained token |
| `GITHUB_RESULTS_PATH` | 아니오 | 기본값 `projects/interim-presentation/코드/결과/주요결과/dashboard` |
| `LOCAL_REPOSITORY_ROOT` | 별도 checkout의 로컬 fallback/exporter 시 | 기존 `Obsidian-Vault` checkout의 절대 경로. Vercel에는 설정하지 않음 |
| `GOOGLE_CLIENT_ID` | Calendar 연결 시 | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Calendar 연결 시 | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Calendar 연결 시 | Calendar read scope refresh token |
| `GOOGLE_CALENDAR_ID` | 아니오 | 기본값 `primary` |
| `NEXT_PUBLIC_LOCAL_BRIDGE_URL` | 아니오 | 기본값 `http://127.0.0.1:38471` |

데이터 remote는 `Obsidian-Vault`이며 `https://github.com/jeyun123456/Obsidian-Vault.git`을 가리킨다. 따라서 앱의 데이터 설정은 계속 `GITHUB_OWNER=jeyun123456`, `GITHUB_REPO=Obsidian-Vault`, `GITHUB_BRANCH=master`다. 이것은 앱 code repository와 별개다. private repo token은 직접 설정해야 하며 서버는 토큰이나 OAuth 오류 응답 본문을 브라우저에 노출하지 않는다.

## GitHub 자동 분류

GitHub tree의 상대경로를 공통 식별자로 사용한다. 실제 저장소 구조에 맞춘 기본 분류는 다음과 같다.

- Wiki: `wiki/**` (기존 `concepts`, `methodology`, `data`, `decisions`, `findings`, `literature` 유지)
- Literature: `연구/문헌/**`, `연구/선행연구/**`, `wiki/literature/**`
- Results: `projects/interim-presentation/코드/결과/주요결과/**` (legacy `Calc/data/results/**`, `wiki/findings/**`도 분류)
- Research: 나머지 `Calc/**`, `연구/**`, `wiki/**`

GitHub recursive tree가 API 한계로 잘리면 불완전한 목록을 사용하지 않고 오류를 표시한다.

## Google Calendar

Calendar 연결은 OAuth refresh token을 서버에서 access token으로 교환하는 읽기 전용 방식이다. 다음 순서로 설정한다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 project를 만들거나 선택한다.
2. API Library에서 **Google Calendar API**를 활성화한다.
3. Google Auth Platform의 Branding, Audience, Data Access를 설정한다. 앱이 Testing 상태라면 사용할 Google 계정을 test user로 추가한다.
4. OAuth client를 만든다. OAuth Playground로 token을 발급할 경우 **Web application** client에 `https://developers.google.com/oauthplayground`를 authorized redirect URI로 등록한다.
5. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) 설정에서 **Use your own OAuth credentials**를 켜고 생성한 client ID와 client secret을 입력한다.
6. scope로 `https://www.googleapis.com/auth/calendar.readonly`를 선택해 승인하고 authorization code를 token으로 교환한다. 응답의 `refresh_token`을 복사한다. 이미 같은 권한을 승인해 refresh token이 나오지 않으면 기존 앱 권한을 취소한 뒤 다시 동의한다.
7. `.env.example`을 `.env.local`로 복사하고 다음 값을 설정한다.

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_CALENDAR_ID=primary
```

`GOOGLE_CALENDAR_ID=primary`는 인증한 사용자의 기본 calendar를 읽는다. 별도 연구용 calendar는 Google Calendar 설정의 **Integrate calendar → Calendar ID** 값을 대신 넣는다. 해당 calendar가 OAuth 계정에 공유돼 있어야 한다.

개발 서버를 재시작한 뒤 `http://localhost:3000/api/calendar/events?days=14`를 연다. 정상 연결이면 `state`가 `ready` 또는 `empty`이고, Home에 Today, Upcoming, Next Deadline 카드가 표시된다. API의 `days`는 1~365 범위로 제한되며 기본값은 14다.

서버는 Google 응답에서 event id, title, start/end, all-day 여부, description, location, calendar id, HTML link, status와 UI category만 정규화해 반환한다. 원본 응답과 OAuth 오류 본문은 브라우저로 전달하지 않는다. client ID, client secret, refresh token은 `NEXT_PUBLIC_` 접두사를 사용하지 않으며 client bundle에 포함하지 않는다. 일정 결과는 서버 메모리에 5분간 cache된다.

표시는 `Asia/Seoul` 기준이다. 날짜만 있는 all-day event는 자정 변환 없이 해당 calendar 날짜를 유지한다. 제목·설명에 포함된 한글/영문 키워드로 Meeting, Deadline, Research, Presentation, Other를 분류하지만 Google Calendar 원본은 수정하지 않는다.

상태별 동작은 다음과 같다.

- `unconfigured`: 환경변수 미설정
- `empty`: 연결은 정상이지만 조회 기간에 일정 없음
- `auth_error`: refresh token 취소·만료 또는 권한 문제
- `quota_error`: Calendar API quota/rate limit
- `network_error`: Google endpoint 연결 실패 또는 기타 upstream 오류
- `malformed_response`: token/event 응답 형식이 예상 계약과 다름

OAuth 및 API 동작의 기준 문서는 [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scope 안내](https://developers.google.com/workspace/calendar/api/auth), [Events.list reference](https://developers.google.com/calendar/api/v3/reference/events/list)다.

### Google OAuth 장기 운영

`calendar.readonly`는 Google Calendar 데이터를 읽는 sensitive scope다. External 앱이 **Testing** 상태이면 refresh token은 동의 시점부터 7일 후 만료한다. 현재 운영 프로젝트는 **In production**으로 전환했고, Production 전환 뒤 발급한 refresh token을 서버 환경에서 사용한다.

개인용(100명 미만) 운영의 권장 절차는 다음과 같다.

1. Google Auth Platform → **Branding**에서 실제 앱 이름, 지원·개발자 연락처와 공개 가능한 홈페이지·개인정보처리방침 URL을 완성한다. URL이나 도메인은 임의로 만들지 않는다.
2. **Data Access**에는 앱이 실제 사용하는 `https://www.googleapis.com/auth/calendar.readonly`만 선언한다. 더 넓은 Calendar scope는 추가하지 않는다.
3. **Audience**에서 External 앱을 **In production**으로 게시한다. 개인용 앱은 검증 전에도 사용할 수 있지만 unverified warning 및 평생 100명 신규 사용자 제한이 적용될 수 있다. 외부 배포가 필요하면 branding 및 sensitive-scope verification을 별도로 완료한다.
4. Production 전환 뒤 OAuth Playground의 own credentials 흐름으로 새 refresh token을 발급하고 기존 `GOOGLE_REFRESH_TOKEN`을 `.env.local`에서 교체한다. Testing 중 발급한 token은 재사용하지 않는다.
5. 개발 서버를 재시작하고 `/api/calendar/events?days=14`가 `ready` 또는 `empty`인지 확인한다. `auth_error`가 나오면 같은 절차로 재인증한다.

refresh token은 Testing 7일 제한이 없어져도 사용자가 권한을 취소하거나 계정·조직 정책이 바뀌면 무효화될 수 있다. 따라서 Home의 Calendar error state와 위 smoke test를 정기적으로 확인한다. 운영 상태와 scope 정책은 [Google OAuth token lifecycle](https://developers.google.com/identity/protocols/oauth2), [App Audience](https://support.google.com/cloud/answer/15549945), [personal-use verification exception](https://support.google.com/cloud/answer/13464323)를 기준으로 한다.

## localhost bridge

```powershell
Set-Location local-bridge
Copy-Item config.example.json config.json
# config.json의 master_path, token 수정
python bridge.py
```

`token`은 32자 이상의 임의 문자열이어야 한다.

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

브리지는 `127.0.0.1` bind, 명시된 localhost와 `https://master-thesis-os.vercel.app` origin allowlist, token 상수시간 비교, 16 KiB 요청 한도, `Path.resolve()` 후 Master Path 내부의 실제 파일·디렉터리만 허용, health 응답의 경로 비공개를 강제한다. 웹 Settings에 같은 token을 저장하면 `{master_path}/{GitHub 상대경로}`를 기본 앱으로 열고, **볼트 폴더 열기**는 `/open-folder`로 master path 또는 지정 파일의 안전한 부모 폴더를 연다. 실제 `config.json`은 git에서 제외된다.

### 브리지 상시 실행

Windows에서 `local-bridge/start_bridge.bat`을 실행하면 설정을 확인한 뒤 브리지를 계속 실행한다. 브리지가 비정상 종료되면 3초 후 자동으로 재시작한다. 콘솔 없이 실행하려면 `start_bridge_hidden.vbs`를 사용한다. 시스템 트레이 아이콘과 상태 확인·종료 메뉴를 쓰려면 `start_bridge_tray.vbs`를 사용한다. Windows 로그인 때마다 트레이 실행기를 자동 시작하려면 해당 VBS 파일의 바로가기를 `Win+R` → `shell:startup` 폴더에 넣는다. 일반 브라우저 개발 시에는 `start_bridge.bat`을 사용하고, 중지는 콘솔 창에서 `Ctrl+C` 또는 창 닫기로 수행한다.

## Sucrose Wallpaper

Sucrose Wallpaper에는 `https://master-thesis-os.vercel.app/wallpaper`을 웹 wallpaper URL로 지정한다. 이 경로는 일반 대시보드와 분리된 가벼운 화면이며, 데이터 polling은 화면이 숨겨진 동안 멈췄다가 다시 보일 때 필요한 경우에만 재개한다. 시계는 별도의 1초 갱신으로 동작한다.

Wallpaper의 **로컬 파일 열기**와 **볼트 폴더 열기**는 클릭했을 때만 loopback bridge를 호출한다. 먼저 일반 대시보드 Settings에서 같은 bridge token을 저장하고, 로컬 PC에서 bridge를 실행해야 한다. Sucrose가 로컬 브리지를 호출할 수 있도록 `config.json`의 `allowed_origins`에 실제 Sucrose page origin을 명시적으로 추가한다; allowlist에 wildcard는 사용하지 않는다.

## Results JSON 계약

웹은 Excel을 파싱하지 않는다. 별도 Python exporter가 연구 Vault의 canonical workbook을 read-only로 열어 다음 JSON을 `projects/interim-presentation/코드/결과/주요결과/dashboard/`에 생성한다.

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
→ projects/interim-presentation/코드/결과/주요결과/dashboard/*.json
→ Git commit/push
→ /api/results
→ Master Thesis OS Results
```

`validation.json`의 범위는 `exporter-only`다. 저장 workbook에서 값을 빠짐없이 추출했는지, 05와 06의 endpoint가 일치하는지, 저장된 2요인 합계와 산업합계가 맞는지를 확인한다. 원자료부터 Calc 파이프라인을 재실행하거나 계산 방법론을 독립 검증했다는 뜻은 아니다.

## 인증정보 없는 동작

- GitHub 미설정: 빈 repository 목록
- Calendar 미설정·인증 실패·quota/network 오류: 원인을 구분한 일정 empty/error state
- Results JSON 미설정·누락·invalid: 오류 이유가 포함된 empty state

로컬 개발에서 `LOCAL_REPOSITORY_ROOT`가 설정되면 서버는 지정한 Vault 작업트리의 검증된 JSON을 읽는다. GitHub 환경변수가 설정되면 같은 상대경로를 GitHub API에서 읽는다.

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
- [x] OAuth longevity: Google Auth Platform Production 전환 후 새 refresh token으로 `/api/calendar/events?days=14`가 `ready`를 반환하는 것을 확인
- [x] bridge startup: `local-bridge/config.json` 설정 후 `python bridge.py`, `/health` 확인

Release 직전에는 `git status`, `/api/results`, `/api/calendar/events?days=14`, `/api/github/tree`, `http://127.0.0.1:38471/health`를 다시 확인한다. GitHub와 로컬 파일의 공통 식별자는 repository root 기준 `/` 구분 상대경로다.
