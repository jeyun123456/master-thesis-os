# Chocomint Research OS 1차 UI 리빌딩

## 구현 상태

공통 디자인 기반과 홈·연구 화면을 변경했다. 운영 배포·push·commit은 하지 않았다. 인증·승인·API·canonical 문서는 변경하지 않았다. 구현은 완료했지만, 인증 이후의 전체 브라우저 검증은 환경 부재로 미완료다.

## 구현 전 확인

- Production: Vercel deployment `dpl_7NPECz1PnN5zsFdVB17RjxzL2gUn`, main `af315f62d763bef14491281cc6d61b685b659f9f`.
- Local HEAD: `e7988a3256594b164c56f5517a67f3948404ed5c`, `refactor/architecture-ownership`. Production 이후 Vault 경로·project discovery 관련 변경과 merge가 있으며 사용자 미커밋 변경도 있다. 버전 번호 1.4.0만으로 동일 코드라고 판단하지 않았다.
- 로컬 `.env.local`에는 P0 endpoint/Access 설정이 없고 기본 `127.0.0.1:8787`에 listener가 없다. 직접 config 요청은 ECONNREFUSED다. Next의 `/api/p0/session`은503, 비인증 `/api/p0/tasks`와 `/api/research/status`는401이다.
- 사용자가 기존 P0 직접 실행을 승인했으나 문서의 checkout·보호 런처·예정 작업이 이 환경에 없었다. sibling P0 테스트 도우미도 없다. 새 DB·가짜 토큰·임의 인증 설정을 만들지 않았다.
- 기존 tracked 변경16개 파일의 binary diff를 작업 전 snapshot과 비교해 동일함을 확인했다. 기존 untracked 산출물도 수정하지 않았다.
- 변경 전 파일·사용자 diff·상태는 로컬 `.git/ui-rebuild-20261025/`에 보존했다. 비밀 환경 파일은 백업 대상에 포함하지 않았다.

## 변경 단위와 파일

### 1. 공통 기반

- `app/globals.css`: 기존 reset·layout·control 정의를 보존하면서 기본 본문15px, 작은 공통 글씨와 모바일 메뉴 가독성 개선.
- `app/chocomint-theme.css`: 최종 팔레트·타입·간격 토큰을 한 곳에 정의. accent/surface/card/danger/warning alias를 연결. 접힌 메뉴의232px 고정 폭 제거. 배경 장식·강한 그림자 축소. 모바일 입력16px, 공통 버튼 최소44px.
- `app/research-os-theme.css`: 중복 root 토큰 제거, 공통 구조만 유지. 세이지 focus/primary-hover와 기본 focus-visible 처리.
- `app/p0-home-tasks.module.css`: 보라색 fallback 제거, 실제 공통 토큰 사용. 동기화 disclosure 스타일.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`: 이번에 확정된 제품 제약과 실제 디자인 토큰 기록. 기존 다른 화면의 스타일 이행이 끝났다는 뜻은 아니다.

### 2. 홈

- `app/page.tsx`: 일정·다가오는 마감과 오늘 작업을 앞에 배치. 빠른 입력·현재 연구·분석 미리보기·바로가기 유지. 일상 점검·메일/공지 연결·최근 변경을 native disclosure로 이동. 상단 연결 배지는 연결 상태 disclosure로 정리.
- `app/home-layout.module.css`: 홈의 일정 요약·현재 연구·빠른 입력 배치를 국소화. 열을 늘려 카드 높이가 억지로 맞춰지는 것을 피하고980px 이하에서 한 열로 전환.
- `app/p0-home-workspace.tsx`: 동기화/복구 UI를 보조 영역으로 이동. 기존 이벤트·요청·승인·복구 흐름과 iframe mount는 유지. 로딩 중0개로 보이던 문구는 확인 중으로 표시.

### 3. 연구

- `app/research-panel.tsx`: 연구 개요를 먼저 표시하고 프로젝트 상태·단계 편집은 disclosure로 이동. 기존 할 일·원본·결과·메모·마일스톤·막힘·폴더 기능 유지. 개요 이동 링크의 실제 목적지 ID 연결.
- `app/research-overview.tsx`, `app/research-overview.module.css`: 연구 질문 → 같은 원문에서 읽은 현재 판단 → 연결된 근거·출처 → 원문 순서의 다음 행동. 다음 행동은 앞3개를 표시하고 나머지 원문 항목도 펼쳐볼 수 있다. 목적·진행 단계로 판단을 대신하지 않는다. 연결된 Decision을 모두 채택된 것으로 표시하지 않는다.
- `lib/research-text.ts`: 원문을 변경하지 않고 표시용 Markdown 강조·코드·링크 라벨·주석 정리. HTML을 주입하지 않고 React의 문자열 escaping을 유지한다.
- `lib/research-text.test.ts`, `app/research-overview.test.tsx`: 표시 텍스트·HTML escaping·출처 격리·정보 순서·긴 목록 보존·이동 링크 목적지 회귀 테스트.

## 개선 전후

| 대상 | 이전 | 이후 |
|---|---|---|
| 공통 글씨 | 여러 공통 요소8–10px, 보라색 fallback | 본문15px·보조12–13px 기준, 세이지 의미 토큰 |
| 메뉴 | 접어도232px | 접힘72px/펼침248px의 기존 규칙을 실제 적용 |
| 홈 상단 | 작업 아래로 밀린 일정·마감 | 일정·마감 요약과 오늘 작업 우선 |
| 운영 정보 | 연결 배지·동기화·점검 상시 노출 | native disclosure를 통한 보조 접근 |
| 현재 연구 | 목적·요약·판단 혼합 | 질문과 실제 출처에 연결된 판단/집중 구분 |
| 연구 상세 | 프로젝트 작업·관리 이후 질문 | 질문·판단·근거·다음 행동을 먼저 표시 |
| 원문 표시 | 강조 기호·링크 구문·주석 노출 가능 | 읽기용 텍스트로 표시, 원문·API 그대로 유지 |

## 검증 결과

- `pnpm lint`: 통과.
- `pnpm build`: 최종 구현에서 통과. Node26.8.2에서 실행했으며 package의 권장 Node22와 다르다는 engine warning이 있었다.
- `pnpm test:web`: 실행 당시312개 테스트 통과, P0 sibling repository의 `test/helpers.js` 부재로1개 통합 테스트 파일 로드 실패. UI 변경으로 발생한 실패는 아니다.
- `pnpm exec vitest run --exclude lib/p0-tasks.integration.test.ts`: 최종 회귀 테스트 포함51개 파일·313개 테스트 통과.
- 임시 renderer는 실제 로컬 canonical project.md를 사용해 변경 전후 컴포넌트 HTML을 생성했고 테스트 통과 후 소스 트리에서 제거했다. 모의 연구 수치·판단은 넣지 않았다. 이 HTML은 인증된 앱의 전체 동작을 대체하지 않는다.
- 연구 컴포넌트의360/390/430/768/1440px 중간 캡처·측정에서 질문 줄바꿈과 열 전환을 확인했다. 그 과정에서 공통 reset 누락을 발견해 보존본으로 복구했다. 최종 CSS 반영 후 HTML은 갱신했지만 브라우저가 최소화/확장 UI 차단 상태가 되어 최종 재캡처를 완료하지 못했다. 다섯 폭의 최종 합격으로 기록하지 않는다.
- `git diff --check`, JSON parse, CSS brace count, 기존 box-sizing reset 확인 통과.
- 핵심 정적 색상 대비 계산: muted/paper5.41:1, ink/cream12.63:1, white/primary5.62:1. 실제 전체 화면 AA 준수 판정은 아니다.
- 별도 Luna 소스 리뷰에서 끊어진 결과 anchor를 발견해 수정하고 목적지 회귀 테스트를 추가했다.
- Jev Review는 JEV_API_KEY 미설정으로 점수를 반환하지 않았다. 리뷰 점수나 통과를 주장하지 않는다.

## 디자인 검사와 남은 부채

전체 app 정적 검사:849건(권고843, 경고6). 디자인 문서가 생기면서 기존 화면의 비표준 색상486·반경127·글씨 크기228건이 새로 계측된다. 그 외 Inter 선언3·강조선3·기존 격자1·슬롯 bounce1건이다. 기존 critique의8건과 같은 측정 집합이 아니므로 단순 증감 비교를 하지 않는다. 이번 범위 밖 화면을 수정하거나 경고를 무조건 삭제하지 않았다.

## 검증하지 못한 항목

- 인증 이후 주요 버튼·전체 검색·빠른 입력의 실제 저장·응답·승인 동작.
- 실제 P0 데이터·동기화·충돌 복구의 통합 동작.
- 최종 화면의 전체 키보드 탐색·200% 브라우저 확대.
- 최종 CSS의 다섯 폭 재캡처 및 모바일 입력 키보드와 고정 버튼 간섭.
- 검토 브라우저의 임시 viewport override 해제도 확장 UI 차단으로 확인하지 못했다. 검토용 서버는 종료했다.
- 범위 밖 개별 화면에 남은 작은 고정 글씨와 전역 토큰 이행.

## 다음 작업 우선순위

1. 기존 P0 실행 checkout/보호 설정과 정상 인증 환경을 복구하고 누락된 통합 테스트를 실행한다.
2. 최신 로컬 앱에서 다섯 폭·키보드·200% 확대와 저장/검색/빠른 입력을 검증한다.
3. 검증에서 확인된 홈·연구 문제를 먼저 수정한 뒤, 다른 화면의 토큰 이행을 별도 범위로 진행한다.
4. URL 기반 탐색과 기타 critique 항목은 이번 변경에 추가하지 않았다. 운영 배포는 수행하지 않았다.

## 종료 후크 검토

후크의 attribution unknown 항목은 보존본과 대조했다. 메일 우선순위선과 Inter fallback은 작업 전에도 있었다.

- 수정: 사용 중인 TSX 참조가 없는 `.active-projects-card::before`의3px 장식선을 제거했다.
- 예외 기록: Inter fallback은 Operate UI의 기존 글꼴 스택을 유지하는 선택으로 `overused-font=Inter`를 `app/globals.css`와 `app/chocomint-theme.css`에만 제한했다. 사용자에게 Inter 확인을 받았다고 기록하지 않았다.
- 예외 기록: critical/important 텍스트와 함께 쓰는 기존 메일 우선순위선은 보존하고 `side-tab=*`를 `app/globals.css`에만 제한했다. 다른 파일이나 다른 규칙은 숨기지 않았다.
- 유지: 전체 정적 검사의 레거시 토큰 이행 권고, 범위 밖 격자·슬롯 동작은 그대로 남겼다. 이를 새 회귀로 분류하지 않았다.
- 문서: DESIGN.md의 기존 결정을 바꾸지 않고 sidecar의 설명 메타데이터와 생성 시각을 갱신했다.

## 3차: 운영 main(f58bc31) 이식 기록

- 홈·연구 UI를 `refactor/architecture-ownership`와 분리해 `origin/main` 위에 이식했다. Vault 경로 리팩터(`projectFolder`, `02_Projects` 기본 경로, 상태값 정규화)는 포함하지 않았고 `lib/*`, API, 설정은 변경하지 않았다.
- `research-panel.tsx`는 main의 `projects/<id>` 경로 로직을 유지한다. `MemosSection`에는 `projectRoot`를 넘기지 않는다.
- main의 `/api/research/status`는 `wiki/current_status.md`를 반환하고 프로젝트 원문은 `projects/<id>/project.md`라 경로가 서로 다르다. 그래서 "현재 판단"은 이 데이터에서는 표시되지 않고, 연결 정보가 없다는 안내와 상태 문서 열기 버튼을 보여 준다. 판단을 임의로 연결하지 않았다. 해결에는 상태 문서와 프로젝트의 연결 정보(데이터 구조)가 필요하다.
- 상태 파서의 제목은 main 기준 `최근 결과와 현재 해석`이다.
