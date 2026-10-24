# P0 R1 운영 경계 확인

## 확인된 기준선

- 저장소 `jeyun123456/master-thesis-os`, 작업 브랜치 `feat/integrate-p0-tasks`; PR #15은 열린 상태다.
- 2026-10-24 확인 스냅샷에서 PR head `208351da306f9f333978286ed9175df3eaccd59c`의 GitHub Actions `verify`가 성공했고 Vercel Preview도 READY였다. 이는 스냅샷이며 이후 PR head 변경을 나타내지 않는다.
  - GitHub Preview deployment ID: `7299903692`
  - 배포 URL: `https://master-thesis-fsihz7y1u-jeyun123456.vercel.app`
- `main`은 `03c3d2564e8891c9e4353128c9d3acf96813970f`; 기존 Production 배포 기록은 성공 상태다.
  - GitHub Production deployment ID: `6855172211`
  - 배포 URL: `https://master-thesis-1dm1a9t94-jeyun123456.vercel.app`
  - 배포 기록 시각: 2026-10-05 09:03 UTC
- Windows P0 체크아웃은 `C:/worktrees/master-thesis-os-p0/tools/master-thesis-os-p0`, 확인 당시 HEAD는 `39b27d4844d5f0237f46b383002742b14217a084`이며 작업 트리는 clean이다.
- `127.0.0.1:8787`에서 Node 프로세스가 수신 중이고 실행 인자는 `src\\server.js`다. 로컬 `GET /api/config`는 HTTP 200을 반환하며 `google_client_id` 설정 여부는 true다. 값은 기록하지 않았다. 실행 프로세스의 작업 디렉터리를 독립 확인하지 못해 실제 프로세스가 위 체크아웃 HEAD를 실행 중인지는 미확인이다.
- 기존 Tailscale 매핑은 읽기만 확인했다: Funnel `:443` → `127.0.0.1:8000` 및 `/gravity-worker` → `127.0.0.1:8001`; tailnet-only `:8443` → `127.0.0.1:8767`; tailnet-only `:10000` → `127.0.0.1:3000`. 변경하지 않았다. P0 `:8787`은 이 매핑에 없다.
- `cloudflared` 2026.10.3이 설치되어 있으며 읽기 전용 목록에 기존 `hermes-dashboard`, `hermes-location` 터널이 보였다. P0 전용 터널은 없다. 로컬 `.cloudflared/config.yml`/`.yaml`은 없었다.
- 사용자가 P0에 쓸 예정이라고 한 `chocomintudon.com`은 RDAP상 Cloudflare, Inc.에서 2026-10-04에 등록되었고 Cloudflare nameserver를 사용한다. DNS도 Cloudflare edge로 해석된다. 다만 이 zone을 현재 `cloudflared` 인증 계정이 관리하는지, P0 hostname/Access 앱이 생성됐는지는 확인되지 않았다.
- 로컬 Vercel CLI는 없다. Vercel 대시보드는 로그인 화면으로, Cloudflare 대시보드는 봇 검증 페이지로 전환되어 설정을 확인할 수 없었다. Cloudflare/Vercel MCP 설치·OAuth 승인은 사용자가 열 링크를 기다리는 상태다.

## 미확인 / 병합 차단

- Vercel 프로젝트의 연결 브랜치 설정, 사용자 도메인/별칭, Preview/Production 환경변수의 **존재 여부**는 대시보드에서 확인하지 못했다. GitHub 배포 기록이 보여 주는 URL은 배포별 URL이며 사용자 도메인 별칭을 뜻하지 않는다.
- Cloudflare 계정에서 해당 domain zone을 실제로 관리하는지와 Access 애플리케이션·Service Auth 정책은 확인되지 않았다. 현재 두 Hermes 터널이나 포트를 P0에 재사용하지 않는다.
- P0 서버 코드 버전과 운영 SQLite 경로, 환경변수 값은 읽거나 기록하지 않았다.
- R1 보안 경로가 아직 구성되지 않았으므로 이 메모는 **R1 통과 또는 병합 승인으로 해석하면 안 된다.**

## 안전 확인

- 운영 P0 SQLite에는 쓰지 않았다. `/api/config` 조회만 했고, 로컬 P0 통합 테스트는 별도 임시 SQLite DB를 사용했다.
- 기존 Tailscale 설정과 Cloudflare 터널을 변경하지 않았다. Production 배포 및 PR 병합도 하지 않았다.

## R1-03 코드

- `lib/p0-server.ts`에 공통 `p0Fetch`를 두어 P0 API와 네이티브 프록시 요청을 같은 upstream 경로로 보낸다.
- 외부 HTTPS upstream에는 서버 전용 `P0_ACCESS_CLIENT_ID` / `P0_ACCESS_CLIENT_SECRET`을 필수로 적용하고, loopback에는 Access 헤더를 보내지 않는다. 리다이렉트는 거부한다.
- 구현 커밋 `208351da306f9f333978286ed9175df3eaccd59c`은 PR #15에 포함됐고, 해당 커밋의 CI와 Preview 배포가 통과했다. 값은 이 문서에 기록하지 않는다.
- 확인: `lib/p0-server.test.ts` 4개 통과, `pnpm lint`, `pnpm build`, 격리된 `pnpm test:p0:production` 통과. 외부 Cloudflare/Vercel 경로는 아직 실검증하지 않았다.
