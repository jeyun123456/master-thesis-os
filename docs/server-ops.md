# 서버 관리 대시보드 (Server Ops)

초코민트랩 웹앱의 **서버 관리** 화면과, 이를 채우는 MTOS Agent의 경량 읽기 전용 수집기.
기본값은 **꺼짐**이다. 환경변수로 켜기 전에는 라우트(`/agent/api/ops/*`)가 존재하지 않는다(404).

## 구성

```
Windows (PowerShell, 읽기 전용 프로브)
  scripts/ops-collect.ps1 -Tier fast|inventory|slow     ← 1회 실행 후 종료, 상주 프로세스 없음
        │ JSON (stdout, 2MB·45초 제한)
MTOS Agent API 프로세스 (src/ops/*)
  collector.js  순차 스케줄러 (겹침 없음) → classify.js 분류 → store.js 저장 → alerts.js 경고
  api.js        GET /agent/api/ops/{overview,processes,services,trend,background,ai,alerts,events}
        │ P0 세션 + x-ops-admin
Vercel Next.js  /api/mtos/ops/*  (lib/agent-server.ts 프록시, 관리자 비밀값은 서버 환경변수)
  app/server-ops-panel.tsx  화면 A~F + 백그라운드 작업
```

수집 주기(기본): 시스템·프로세스·서비스 지표 60초 / 프로세스 구성(부모·명령줄·포트·서비스) 5분 / 예약 작업·시작 프로그램·MCP 설정·서비스 오류 30분.

## 저장 구조

별도 SQLite 파일 `ops.db` (기본: 에이전트 DB와 같은 폴더). **에이전트 운영 DB 스키마는 변경하지 않는다.**

| 테이블 | 내용 | 보존 |
|---|---|---|
| `ops_samples` | 60초 시스템 지표(CPU, RAM, Commit, Standby, 디스크…) | 원시 7일 |
| `ops_group` | 60초 프로세스 그룹별 Working Set/Private (추적 그룹 + 상위 10) | 원시 7일 |
| `ops_rollup_*` | 7일 지난 원시 행을 15분 집계로 변환 | 30일 |
| `ops_events` | 추적 그룹의 시작/종료 이벤트 | 30일 |
| `ops_state` | 최신 구성 스냅샷(마스킹된 명령줄), 경고 기준, 수집기 상태 | 최신 1건 |

프로세스 개별 행·명령줄 전체는 시계열로 저장하지 않는다. 정리는 시작 시와 6시간마다 실행된다.

## 환경변수

에이전트(`%LOCALAPPDATA%\MasterThesisOS\agent\agent.env`):

| 변수 | 기본 | 설명 |
|---|---|---|
| `MTOS_OPS_ENABLED` | 없음(꺼짐) | `1`이면 수집기·API 활성화 |
| `MTOS_OPS_ADMIN_SECRET` | 없음 | 설정하면 `x-ops-admin` 헤더가 일치해야 응답 (**운영 시 필수 권장**) |
| `MTOS_OPS_DB_PATH` | 에이전트 DB 폴더의 `ops.db` | |
| `MTOS_OPS_INTERVAL_SEC` / `_INVENTORY_SEC` / `_CONFIG_SEC` | 60 / 300 / 1800 | 최소 15초 |
| `MTOS_OPS_ALERT_MIN_AVAIL_RAM_MB` 등 | 500 … | 화면에서도 변경 가능(`PUT /ops/settings`, 범위 검증) |

Vercel(서버 환경변수, `NEXT_PUBLIC_` 아님): `MTOS_OPS_ADMIN_SECRET` — 에이전트와 같은 값. 브라우저로 전달되지 않는다.

## 보안

- 모든 `/ops/*`는 기존 P0 세션 검증 뒤에서만 동작 + 관리자 비밀값(`x-ops-admin`, 상수시간 비교) + 분당 90회 제한.
- 읽기 전용: `GET`만 허용(설정 저장 `PUT /ops/settings` 예외, 숫자 범위만 허용). 프로세스 종료·서비스 재시작·명령 실행·파일 읽기 API는 없다.
- 명령줄은 토큰/비밀번호/쿠키/Bearer/URL 쿼리·사용자 정보/긴 불투명 문자열/`-EncodedCommand`가 마스킹되고 Windows 사용자 폴더명이 제거된다(`src/ops/redact.js`).
- MCP 설정은 이름·전송 방식·실행 파일명·대상 호스트만 읽는다. args, env, URL 경로·쿼리는 읽지 않는다.
- 응답 크기: 프로세스 최대 200행, 인벤토리 300행, 추세 최대 240점.

## 서버 적용 절차 (사용자 승인 후)

1. 이 브랜치(`feat/server-ops-dashboard`)를 에이전트 실행 worktree(`C:\worktrees\mtos-agent-1.4.0`)에 병합하거나 해당 worktree를 이 커밋으로 이동한다.
2. `agent.env`에 `MTOS_OPS_ENABLED=1`, `MTOS_OPS_ADMIN_SECRET=<긴 임의 문자열>` 추가.
3. **MTOS_Agent_API 작업만** 재시작한다(Worker/P0/터널은 건드리지 않는다). 수집기는 API 프로세스 안에서 돈다.
4. Vercel Preview에 `MTOS_OPS_ADMIN_SECRET` 설정 → Preview에서 화면 확인 → 승인 후 production 병합.
5. 첫 1분 후 `서버 관리 > 서버 개요`에서 마지막 수집 시각이 갱신되는지 확인.

## 운영 영향

- 60초마다 PowerShell 1회(약 1.1초, CPU 약 0.9초, 피크 약 90MB 후 종료). 5분/30분 주기의 구성 조사는 약 3초·130MB 피크.
- 상주 메모리 증가는 에이전트 프로세스 안의 수십 MB 이하(실측값은 최종 보고 참조).
- 메모리가 극도로 부족한 상태(Commit ≥ 95%)에서는 프로브 자체가 실패할 수 있다. 이 경우 화면에 "수집 중단" 경고가 뜬다.

## 롤백

`agent.env`에서 `MTOS_OPS_ENABLED`를 지우고 API 작업을 재시작하면 즉시 비활성(라우트 404, 수집 중지). 데이터 정리는 `ops.db*` 파일 삭제로 끝난다. 에이전트 DB는 변경되지 않았으므로 복구가 필요 없다.
