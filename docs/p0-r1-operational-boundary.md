# P0 R1 운영 경계 확인

## 확인된 기준선

- 저장소 `jeyun123456/master-thesis-os`, 작업 브랜치 `feat/integrate-p0-tasks`; PR #15은 열린 상태다.
- PR #15은 열린 상태이며 현재 head는 `cb615d09b89acb55a4df1a3985a76ea32e26c306`이다. Vercel Preview deployment `dpl_E5aWpEAJrg3L8trBtAqdxpBt7nM7`가 `READY`다.
- `main` Production은 `03c3d2564e8891c9e4353128c9d3acf96813970f`의 deployment `dpl_8QWSmUCD1wU3k1ESwpkyLyVgjApy`로 계속 `READY`다. Production 배포를 새로 만들거나 promote하지 않았다.
- Windows P0 체크아웃은 `C:/worktrees/master-thesis-os-p0/tools/master-thesis-os-p0`, 확인 당시 HEAD는 `39b27d4844d5f0237f46b383002742b14217a084`이며 작업 트리는 clean이다.
- `127.0.0.1:8787`에서 Node 프로세스가 수신 중이고 실행 인자는 `src\\server.js`다. 로컬 `GET /api/config`는 HTTP 200을 반환하며 `google_client_id` 설정 여부는 true다. 값은 기록하지 않았다. 실행 프로세스의 작업 디렉터리를 독립 확인하지 못해 실제 프로세스가 위 체크아웃 HEAD를 실행 중인지는 미확인이다.
- 기존 Tailscale 매핑은 읽기만 확인했다: Funnel `:443` → `127.0.0.1:8000` 및 `/gravity-worker` → `127.0.0.1:8001`; tailnet-only `:8443` → `127.0.0.1:8767`; tailnet-only `:10000` → `127.0.0.1:3000`. 변경하지 않았다. P0 `:8787`은 이 매핑에 없다.
- 기존 `hermes-dashboard`, `hermes-location` 터널은 변경하지 않았다. 별도 tunnel `master-thesis-os-p0`를 만들고 로컬 설정 `C:/Users/yeonj/.cloudflared/config-p0.yml`에서 `127.0.0.1:8787`로 라우팅했다. `cloudflared tunnel info`에서 connector 연결을 확인했다. Windows 서비스나 재부팅 자동 시작은 구성하지 않았다.
- `p0-api.chocomintudon.com` DNS CNAME은 새 P0 tunnel을 가리키며 proxied 상태다. 해당 hostname의 Cloudflare Access 앱 `Master Thesis OS P0 API`와 `everyone` 대상 `deny` 정책을 만들었다.
- 외부 unauthenticated GET은 P0 JSON 대신 Cloudflare Access의 `Sign in` HTML을 반환했다. 따라서 Access 경계는 응답 수준에서 확인했지만, machine service-token 인증 성공은 아직 확인하지 않았다.
- Vercel MCP로 `master-thesis-os` 프로젝트와 팀 OWNER 권한을 확인했다. `P0_API_URL=https://p0-api.chocomintudon.com`을 Preview/Production 대상으로 추가했다. 그 뒤 커밋 `ee4a370d5f0affc414db37d260fc69fda0d4ec1b`의 Preview deployment `dpl_EVqNxLPyQcHfACGZKZXiDZneHS2x`는 `READY`로 빌드됐다. 기존 Production deployment는 새 환경변수 설정 전의 `main` 빌드로 유지 중이다.
- Vercel Preview/Production 환경에서 `P0_ACCESS_CLIENT_ID`와 `P0_ACCESS_CLIENT_SECRET`은 아직 설정되지 않았다. 비밀값은 조회하거나 기록하지 않았다.

## 미확인 / 병합 차단

- Cloudflare service token을 아직 만들지 않았다. 다음 단계는 Cloudflare에서 service token을 만들고 그 Client ID/Secret을 Vercel Preview/Production 환경에 직접 입력하는 것이다. secret은 채팅으로 보내지 않는다. 이후 해당 token만 허용하는 Service Auth 정책을 구성하고 Vercel Preview에서 authenticated upstream을 검증해야 한다.
- 현재 Vercel Production 배포에는 새 `P0_API_URL` 설정이 반영되지 않았다. R1 인증이 완성되기 전 Production 배포 및 PR 병합은 보류한다.
- P0 서버 코드 버전과 운영 SQLite 경로, 환경변수 값은 읽거나 기록하지 않았다.
- unauthenticated Access 차단은 확인했지만 service-token 인증 및 외부 Vercel→Windows P0 요청은 미검증이므로 이 메모는 **R1 통과 또는 병합 승인으로 해석하면 안 된다.**

## 안전 확인

- 운영 P0 SQLite에는 쓰지 않았다. `/api/config` 조회만 했고, 로컬 P0 통합 테스트는 별도 임시 SQLite DB를 사용했다.
- 기존 Tailscale 설정과 기존 Cloudflare 터널은 변경하지 않았다. 새 P0 전용 tunnel/DNS/Access 앱은 추가했다. 운영 SQLite에는 쓰지 않았고, Production 배포 및 PR 병합도 하지 않았다.

## R1-03 코드

- `lib/p0-server.ts`에 공통 `p0Fetch`를 두어 P0 API와 네이티브 프록시 요청을 같은 upstream 경로로 보낸다.
- 외부 HTTPS upstream에는 서버 전용 `P0_ACCESS_CLIENT_ID` / `P0_ACCESS_CLIENT_SECRET`을 필수로 적용하고, loopback에는 Access 헤더를 보내지 않는다. 리다이렉트는 거부한다.
- 구현 커밋 `208351da306f9f333978286ed9175df3eaccd59c`은 PR #15에 포함됐고, 해당 커밋의 CI와 Preview 배포가 통과했다. 값은 이 문서에 기록하지 않는다.
- 확인: `lib/p0-server.test.ts` 4개 통과, `pnpm lint`, `pnpm build`, 격리된 `pnpm test:p0:production` 통과. 외부 unauthenticated Access 차단은 실검증했고, service-token 경유 Cloudflare/Vercel→P0 경로는 아직 실검증하지 않았다.
