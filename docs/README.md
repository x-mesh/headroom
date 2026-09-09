# docs

Rack Mesh 설계 문서 모음. 기준 PRD는 이 폴더의 `infra-simulator-prd.md`(v0.5)다. 아래 기능 PRD는 기준 PRD의 계산·데이터 원칙을 바꾸지 않고 구현 순서와 화면 요구사항을 정한다.

## 읽는 순서

처음 오는 사람은 `infra-simulator-prd.md` 1~5절과 8절을 먼저 읽는다. 1~5절이 계산 모델이고 8절이 벤더 데이터 취급 원칙이다. 8절은 금지 사항이라 나중에 읽으면 이미 어긴 상태가 된다.

이어서 `prd-v0.6.md`를 읽어 제품 우선순위와 Phase 1 잔여 요구사항을 확인한다. 기능은 다음 순서로 구현한다. 먼저 `survival-multiplier-prd.md`를 읽어 N-1의 출력 지표를 고정한다. 다음 `domain-sweep-prd.md`로 장애 범위를 도메인과 N-2로 넓힌다. 이어서 `device-substitution-prd.md`로 병목 이동을 비교하고, `measured-import-prd.md`로 실측 근거를 넣는다. 마지막으로 `fault-sweep-surfacing-prd.md`와 `display-layer-improvement-prd.md`로 계산 결과의 첫 화면과 표시 규칙을 정한다.

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

## 결정 소유권

같은 주제를 두 문서가 다루면 혼란이 생긴다. 충돌하면 아래 소유권을 따른다.

- **계산 의미론, 축 정의, 데이터 모델, 벤더 데이터 원칙:** `infra-simulator-prd.md`. 하위 문서가 이것을 바꿀 수 없다.
- **표시 계층의 수치 정확성과 모션 정책:** `display-layer-improvement-prd.md`. 떨림, 트윈, 패킷 점, 손실 표기, 상태 칩.
- **요약 타일 구성과 상단 정보 서열:** `display-layer-improvement-prd.md` 6.3절과 6.4절이 먼저 결정하고, `fault-sweep-surfacing-prd.md`가 스윕 결과의 자리만 추가로 정한다.
- **스윕 계산 범위(자원 단위, 도메인 단위, N-2):** `domain-sweep-prd.md`.
- **스윕 결과의 화면 배치:** `fault-sweep-surfacing-prd.md`.
- **근거 출처(`source.type`)의 의미와 진폭 매핑:** `display-layer-improvement-prd.md` 4절이 정의하고, `measured-import-prd.md`가 `user_measured`를 채우는 경로를 제공한다.

## 지금 상태

기준 PRD는 v0.5 초안이고, 방향·Phase 1 개정은 v0.6 초안이다. 표시 계층 개선 PRD와 기능·IA PRD는 v0.1 초안이다. `display-layer-implementation.md`는 표시 계층 일부의 코드 수준 구현 명세를 제공한다.

상위 PRD의 최대 미결은 13절의 "성능 데이터 수집 방식"이다. `measured-import-prd.md`가 그 미결에 대한 답을 제안한다. 카탈로그 30종을 채우는 방향이 아니라 실제 운영 중인 장비를 실측으로 채우는 방향이다.

## 변경 원칙

문서를 고칠 때 `infra-simulator-prd.md`의 결정 사항을 뒤집으려면 그 문서의 13절 결정 목록을 먼저 고친다. 하위 문서에서 조용히 다르게 쓰지 않는다.

구현 명세는 특정 빌드의 코드에 묶인다. 코드가 바뀌면 구현 명세가 낡는다. PRD는 판단에 묶이므로 줄 번호와 함수명을 직접 들지 않는다. 이 분리를 유지한다.
