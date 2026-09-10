# docs

Rack Mesh 설계 문서 모음. 기준 PRD는 이 폴더의 `infra-simulator-prd.md`(v0.5)다. 아래 기능 PRD는 기준 PRD의 계산·데이터 원칙을 바꾸지 않고 구현 순서와 화면 요구사항을 정한다.

## 읽는 순서

처음 오는 사람은 `infra-simulator-prd.md` 1~5절과 8절을 먼저 읽는다. 1~5절이 계산 모델이고 8절이 벤더 데이터 취급 원칙이다. 8절은 금지 사항이라 나중에 읽으면 이미 어긴 상태가 된다.

이어서 `prd-v0.6.md`를 읽어 제품 우선순위와 Phase 1 잔여 요구사항을 확인한다. 기능은 다음 순서로 구현한다. 먼저 `survival-multiplier-prd.md`를 읽어 N-1의 출력 지표를 고정한다. 다음 `domain-sweep-prd.md`로 장애 범위를 도메인과 N-2로 넓힌다. 이어서 `device-substitution-prd.md`로 병목 이동을 비교하고, `measured-import-prd.md`로 실측 근거를 넣는다. 마지막으로 `fault-sweep-surfacing-prd.md`와 `display-layer-improvement-prd.md`로 계산 결과의 첫 화면과 표시 규칙을 정한다.

`display-layer-improvement-prd.md`를 읽었으면 `verdict-delivery-prd.md`를 이어서 읽는다. 표시 계층 PRD의 P0 세 항목이 해결된 이후를 다루며, 그 문서 6.1과 6.4의 결정 두 개를 개정한다. 6.1의 도메인 구성을 그대로 구현하기 전에 반드시 확인한다.

## 문서 목록

| 문서 | 성격 | 다루는 것 |
|---|---|---|
| `infra-simulator-prd.md` | 기준 PRD | 계산 모델, 장비 라이브러리 2층 구조, 벤더 데이터 원칙, 검증 전략, 비기능 요구 |
| `prd-v0.6.md` | 방향·Phase 1 개정 | v0.5의 계산·데이터·벤더 원칙을 유지하며, 제품 우선순위와 Phase 1 잔여 요구사항을 정함 |
| `display-layer-improvement-prd.md` | 개선 PRD | 표시 계층이 엔진 결과를 어떻게 말하는가. 출처 게이트 떨림, 손실 표기, 상태 칩, 정보 서열 |
| `display-layer-implementation.md` | 구현 명세 | 패킷 점 속도 정규화와 출처 게이트 떨림의 코드 수준 변경과 검증 |
| `survival-multiplier-prd.md` | 기능 PRD | 최악 단일 장애 하의 여유 배수. `growthLadder`와 장애 스윕의 조합 |
| `domain-sweep-prd.md` | 기능 PRD | 장애 도메인 단위 스윕과 N-2. 공유 장애 도메인 판정 |
| `device-substitution-prd.md` | 기능 PRD | 장비 치환 시뮬레이션. 진단에서 처방으로 |
| `measured-import-prd.md` | 기능 PRD | 실측 한계값과 실측 부하의 파일 임포트 |
| `fault-sweep-surfacing-prd.md` | IA PRD | 장애 스윕 결과의 노출 위치와 첫 화면 경험 |
| `verdict-delivery-prd.md` | 개선 PRD | 계산된 판정이 첫 화면까지 도달하는 경로. 기본 시나리오 검증 객체, 요약의 도메인 흡수, 표시명·식별자 정합, 문구 위생 |

## 결정 소유권

같은 주제를 두 문서가 다루면 혼란이 생긴다. 충돌하면 아래 소유권을 따른다.

- **계산 의미론, 축 정의, 데이터 모델, 벤더 데이터 원칙:** `infra-simulator-prd.md`. 하위 문서가 이것을 바꿀 수 없다.
- **표시 계층의 수치 정확성과 모션 정책:** `display-layer-improvement-prd.md`. 떨림, 트윈, 패킷 점, 손실 표기, 상태 칩.
- **요약 타일 구성과 상단 정보 서열:** `display-layer-improvement-prd.md` 6.3절과 6.4절이 먼저 결정하고, `fault-sweep-surfacing-prd.md`가 스윕 결과의 자리만 추가로 정한다.
- **스윕 계산 범위(자원 단위, 도메인 단위, N-2):** `domain-sweep-prd.md`.
- **스윕 결과의 화면 배치:** `fault-sweep-surfacing-prd.md`.
- **기본 시나리오에 들어가는 검증 객체(서비스, 장애 도메인, 랙)의 구성:** `verdict-delivery-prd.md` 4.1과 5절. `display-layer-improvement-prd.md` 6.1이 처음 정했으나 그 처방이 목표한 교훈을 가르치지 못해 교체했다.
- **자원·링크·도메인의 화면 표시명과 내부 식별자의 분리:** `verdict-delivery-prd.md` 7절.
- **수치 문구 표기(단위 접미사, 자릿수, 조사, 부제 밀도):** `verdict-delivery-prd.md` 8절.
- **근거 출처(`source.type`)의 의미와 진폭 매핑:** `display-layer-improvement-prd.md` 4절이 정의하고, `measured-import-prd.md`가 `user_measured`를 채우는 경로를 제공한다.

## 지금 상태

기준 PRD는 v0.5 초안이고, 방향·Phase 1 개정은 v0.6 초안이다. 표시 계층 개선 PRD와 기능·IA PRD, 판정 전달 PRD는 v0.1 초안이다. PRD의 초안 상태는 제품 판단의 상태이며, 각 기능이 코드에 없는 상태를 뜻하지 않는다.

2026-09-10 실행 검토 기준으로 표시 계층 개선 PRD의 P0 세 항목(손실 표기 분리, 백분율·부하 산술 일치, 상태 칩 공존)은 해결됐고 여유 배수 타일도 들어갔다. 같은 문서 6.1(기본 시나리오 검증 객체)과 6.3(판정이 편집보다 위)은 미해결이다. 6.1은 `verdict-delivery-prd.md`가 처방을 교체해 이어받았다.

다음 경로는 구현되어 있다. 단일 장애 생존 배수, 도메인 단위 N-1·N-2 스윕, 장비 치환의 병목·배수·랙 비교, 한계 실측과 관측 부하 파일 임포트, 장애 목록의 심각도 정렬·필터·가상 목록, 저장 시나리오의 서비스별 판정표, SVG·PNG 익명 내보내기다. 700개 단일 장애 후보 측정은 `tests/performance-sweep.mjs`가 담당한다.

N-1 생존 배수는 자원 단일 장애만 대상으로 한다. 도메인 N-1과 N-2는 별도 결과로 표시하고 보고서에도 별도 섹션으로 남긴다. 이중화 무효는 단절 또는 구성원 단독 최악보다 최소 전달률이 절대 5%p 이상 낮을 때 표시한다. 도메인 결과는 장애 목록에서 자원 목록과 구분해 표시한다. 현재 관측 부하는 7일이 지나면 화면과 보고서에서 경고한다. 계산값은 바꾸지 않는다.

## 변경 원칙

문서를 고칠 때 `infra-simulator-prd.md`의 결정 사항을 뒤집으려면 그 문서의 13절 결정 목록을 먼저 고친다. 하위 문서에서 조용히 다르게 쓰지 않는다.

구현 명세는 특정 빌드의 코드에 묶인다. 코드가 바뀌면 구현 명세가 낡는다. PRD는 판단에 묶이므로 줄 번호와 함수명을 직접 들지 않는다. 이 분리를 유지한다.
