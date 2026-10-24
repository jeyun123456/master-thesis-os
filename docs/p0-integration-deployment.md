# P0 통합 — HTTPS 스테이징·실사용 전 체크리스트

이 문서는 `master-thesis-os-standalone`의 same-origin P0 연결을 실제 로그인·배포 전에 안전하게 설정하기 위한 절차야. 원격 배포나 실서비스 데이터 이전은 이 작업에서 수행하지 않았어.

## 1. 네트워크 경계와 Next.js 설정

- HTTPS 도메인과 TLS 인증서를 먼저 준비해. 브라우저에서는 HTTPS만 제공하고, P0 서버는 기존처럼 `127.0.0.1:8787`에만 바인딩해. P0 포트를 인터넷에 직접 공개하지 마.
- Next.js와 P0는 같은 서버에서 실행하고, 브라우저는 Next.js의 `/api/p0/native/*` 프록시만 사용하게 해. 리버스 프록시가 외부 요청의 `Host`/forwarded 헤더를 보존·덮어쓰는지 확인하되, `X-Forwarded-Host`나 `X-Forwarded-Proto`를 CSRF 검증의 신뢰 근거로 삼지 마.
- Next.js 운영 환경에 `MTOS_PUBLIC_ORIGIN`을 **정확한 공개 origin 하나**로 설정해. 예: `https://tasks.example.org` (경로·쿼리·사용자정보 없이). 운영에서 이 값이 없거나 유효하지 않으면 변경 요청은 fail-closed로 차단돼.
- P0와 같은 호스트에 둔 경우 Next.js의 `P0_API_URL`은 `http://127.0.0.1:8787`로 설정해. 다른 호스트로 옮기려면 네트워크·인증 경계를 별도로 검토하고, P0를 공개 주소에 바인딩하지 마.

## 2. Google 로그인 설정

P0 서버 PC의 보호된 환경변수/비밀 저장소에만 설정하고, 채팅·Git·스크린샷에 값이나 로그를 붙이지 마.

- `GOOGLE_CLIENT_ID`: P0용 Google OAuth **Web client ID**. Google Cloud의 승인된 JavaScript origin에는 실제 HTTPS 스테이징 origin만 등록해.
- `ALLOWED_GOOGLE_SUB`: 허용할 계정의 Google `sub` 값 하나. 이메일 주소로 대체하지 마. P0 README의 L1/L2 절차대로 로컬 감사 로그에서 확인하고, 값을 채팅으로 보내지 말고 서버의 보호된 환경변수에 직접 저장해.
- 허용 계정으로 성공, 다른 Google 계정으로 거부, 로그아웃 뒤 재인증 요구를 확인해. 실제 OAuth 설정 전에는 운영 로그인 검증이 완료된 것으로 간주하지 마.

## 3. 암호화 백업

- `MTOS_BACKUP_KEY`는 비밀번호 관리자 또는 조직의 비밀 저장소에서 **32바이트 무작위 값(64자리 hex)**으로 생성해. 이 문서나 대화에 키를 붙여 넣지 마.
- 키는 백업 파일·DB·저장소와 분리해 보관하고, `MTOS_BACKUP_DIR`은 저장소 밖의 접근 제한된 위치로 지정해.
- 스테이징 데이터로 `node scripts/backup-cli.js backup`, `verify`, `preview`를 확인하고, 복구는 운영 DB가 아닌 격리된 사본에서 먼저 시험해. 복구 전 스냅샷을 보존해.

## 4. 모바일 및 오프라인 검증

실제 HTTPS 스테이징에서 iOS Safari와 Android Chrome 등 사용할 모바일 브라우저로 확인해.

1. 허용 계정 로그인, 비허용 계정 거부, 로그아웃 후 보호된 API의 401을 확인해.
2. 브라우저 저장소에 bearer token이 남지 않고, 세션 쿠키가 HttpOnly·SameSite로 보호되며 HTTPS에서 Secure인지 확인해.
3. 할 일 생성·수정·완료가 PC와 모바일에서 일치하는지 확인해.
4. 비행기 모드에서 추가/수정 후 재연결해 큐가 중복 없이 한 번만 반영되는지 확인해.
5. 서비스워커 오프라인 동작·로그아웃·앱 재실행 뒤에도 캐시와 세션 경계가 유지되는지 확인해.

## 5. 남은 위험과 범위

- P0 로그인 rate limit은 loopback P0 앞의 Next.js 프록시 요청을 동일한 서버 원격 주소로 볼 수 있어, 로그인 시도가 한 IP 버킷으로 합쳐져 여러 기기에서 함께 제한될 가능성이 있어. 스테이징에서 제한 동작을 확인하고, 우회 목적으로 임의의 forwarded-IP 헤더를 신뢰하지 마. 여러 사용자에게 공개하기 전에 신뢰 가능한 프록시 IP 처리 방식을 별도 검토해야 해.
- 실제 OAuth client ID, 허용 `sub`, HTTPS 스테이징, 백업 키, 모바일 브라우저 검증은 아직 운영 설정·검증되지 않았어.
- 이번 통합에서는 P0 스키마 변경 및 미분류 필터 구현을 하지 않았어.
