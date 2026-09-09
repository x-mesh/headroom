# docs

Rack Mesh 설계 문서 모음. 최상위 PRD는 저장소 루트의 `infra-simulator-prd.md`(v0.5)이고, 이 폴더의 문서들은 모두 그것의 하위 문서다.

## 읽는 순서

처음 오는 사람은 `infra-simulator-prd.md` 1~5절과 8절을 먼저 읽는다. 1~5절이 계산 모델이고 8절이 벤더 데이터 취급 원칙이다. 8절은 금지 사항이라 나중에 읽으면 이미 어긴 상태가 된다.

구현에 바로 들어가려면 `display-layer-implementation.md`만 읽으면 된다. 그 문서는 단독으로 작업할 수 있게 썼다.

## 문서 목록

| 문서 | 성격 | 다루는 것 |
|---|---|---|
| `../infra-simulator-prd.md` | 상위 PRD | 계산 모델, 장비 라이브러리 2층 구조, 벤더 데이터 원칙, 검증 전략, 비기능 요구 |
| `display-layer-improvement-prd.md` | 개선 PRD | 표시 계층이 엔진 결과를 어떻게 말하는가. 출처 게이트 떨림, 손실 표기, 상태 칩, 정보 서열 |
| `display-layer-implementation.md` | 구현 명세 | 위 PRD 중 두 항목의 코드 수준 패치. 변경 전후 코드와 테스트 |
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

전부 v0.1 초안이다. 구현이 확정된 것은 `display-layer-implementation.md` 하나뿐이고 나머지는 검토 전이다.

상위 PRD의 최대 미결은 13절의 "성능 데이터 수집 방식"이다. `measured-import-prd.md`가 그 미결에 대한 답을 제안한다. 카탈로그 30종을 채우는 방향이 아니라 실제 운영 중인 장비를 실측으로 채우는 방향이다.

## 변경 원칙

문서를 고칠 때 `infra-simulator-prd.md`의 결정 사항을 뒤집으려면 그 문서의 13절 결정 목록을 먼저 고친다. 하위 문서에서 조용히 다르게 쓰지 않는다.

구현 명세는 특정 빌드의 코드에 묶인다. 코드가 바뀌면 구현 명세가 낡는다. PRD는 판단에 묶이므로 줄 번호와 함수명을 직접 들지 않는다. 이 분리를 유지한다.
