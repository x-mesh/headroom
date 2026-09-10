# 판정 전달 작업 분할

기준: [구현 준비 PRD](verdict-delivery-implementation-prd.md)
상태: 작업 분할 초안. Q1·Q2 결정 전 실행 불가. 코드 구현, commit, 배포는 포함하지 않는다.

## 실행 순서

T1 → T2 → T3 → T4 → T5 → T6 → T7. 같은 파일을 수정하므로 순차 실행한다. 여러 에이전트는 사용하지 않는다.

## T1. 기본 도메인과 첫 실험

요구사항: R1. 선행: 없음.

예상 파일:

- `public/data.js`
- `tests/conditions.test.js`
- `tests/templates.test.js`

완료 기준:

- PDU-3가 두 SPINE을 묶고 기존 두 도메인을 보존한다.
- 기본 실험 대상도 PDU-3로 정한다.
- N-1=3, N-2=3, PDU-3 단절 및 이중화 무효, 단독 대비 전달률 감소 ≥0.05를 검증한다.

## T2. 서비스 정상 판정 기준 확정

요구사항: R2. 선행: T1.

예상 파일:

- `public/data.js`
- `tests/conditions.test.js`
- `tests/engine.test.js`

완료 기준:

- Q1 답변 후 정상 상태의 기대 판정을 고정한다.
- Public API 서비스와 0.99를 중복 생성하지 않는다.
- EDGE A 주입은 fail, PDU-3 주입은 단절이다.
- 미확인 축을 표시 코드에서 pass로 바꾸지 않는다.

## T3. 랙 명판 합성 데이터

요구사항: R3. 선행: T2.

예상 파일:

- `public/data.js`
- `tests/conditions.test.js`
- `tests/report.test.js`

완료 기준:

- RACK 04와 구성 장비의 powerBasis 및 maximumDrawWatts를 함께 맞춘다.
- 제안 합성값은 LEAF A 300 W, API A/01 600 W, 예산 1400 W, 공간 42 U, 사용 3 U다.
- 기존 SECURITY와 RACK 07 예산을 보존한다.
- 화면 및 JSON·보고서의 합성 표시를 검증한다. 누락 시 표시 수정 파일을 특정하고 계획을 갱신한다.

## T4. 표시명과 기본 이름 정합

요구사항: R5, R6. 선행: T3.

예상 파일:

- `public/app.js`
- `public/data.js`
- `tests/browser-smoke.mjs`
- `tests/project.test.js`

완료 기준:

- 기존 resourceName을 링크 체크박스·headroom·N-2 조합 표시까지 일관되게 적용한다.
- N-2는 domainIds를 도메인 name으로 해석한다. 엔진의 name과 저장 ID는 바꾸지 않는다.
- 권고안은 ID를 유지하고 기본 표시명을 API A/B로 맞추는 것이다. 승인 전 이름 변경은 보류한다.
- 저장 JSON 왕복의 ID·경로·계산 결과와 사용자 지정 이름을 보존한다.
- 이름의 HTML 특수문자를 이스케이프하고 유효하지 않은 참조는 명시적으로 미확인으로 표시한다.

## T5. 도메인을 포함한 요약 판정

요구사항: R4. 선행: T4.

예상 파일:

- `public/app.js`
- `tests/browser-smoke.mjs`

완료 기준:

- 도메인 N-1 severs만 센다. N-2 건수를 합산하지 않는다.
- SPOF>0 및 도메인>0이면 N + 도메인 M, SPOF=0이면 도메인 M을 표시한다.
- 단절 도메인 중 이중화 무효 우선, 전달률 오름차순, ID 순으로 대표를 정하고 하단 CTA와 공유한다.
- 도메인 단절이 없으면 기존 자원 표시를 유지한다. N-2만 단절인 사례는 N-2 패널에 남긴다.
- 계산 중이거나 결과가 오래됐으면 계산 중을 표시하고 이전 결과로 안전을 단정하지 않는다.
- 활성 장애 상태에도 부제와 접근명에서 도메인 단절을 누락하지 않는다.
- 타일 수는 유지한다.

## T6. 수치 문구·조사·접근명

요구사항: R7, R8. 선행: T5.

예상 파일:

- `public/app.js`
- `tests/browser-smoke.mjs`

완료 기준:

- 생존 배수 0은 생존 불가, 양수는 수치, bounded인 양수에만 이하를 붙인다.
- null·계산 중·반올림하면 0인 작은 양수를 실제 0과 구분한다.
- 개수의 padStart를 제거하고 무경로 0에는 무경로 수요 없음을 표시한다.
- 여유 배수 부제는 병목과 생존만 남기고 끝점 제외 문구는 삭제하는 안을 적용한다.
- 기존 withParticle을 확장하여 을/를·이/가·은/는·와/과를 지원한다.
- 숫자는 한자음, 영문 끝 글자는 알파벳 이름 기준으로 처리한다. 발음이 불명확한 입력에는 조사가 필요 없는 문장과 표시명을 사용한다.
- 한글 받침 유무·숫자 3/4·영문 L/A·빈 이름·특수문자 사례를 검증한다.
- 도메인 항목 접근명은 이름으로 시작하고 삭제 버튼에도 대상 이름을 포함한다.

## T7. 통합 인수 검증

요구사항: R1, R2, R3, R4, R5, R6, R7, R8. 선행: T6.

예상 파일:

- `tests/browser-smoke.mjs`
- `tests/report.test.js`
- `tests/project.test.js`

완료 기준:

- 새 기본 데모와 저장 프로젝트 복원 경로를 각각 검증한다.
- 요약·하단·도메인 패널의 대상과 판정을 비교한다.
- 자동 생성 ID 목록을 이용해 가시 텍스트 누출을 검사한다. 사용자 이름의 하이픈은 금지하지 않는다.
- 모든 부분집합이 아닌 기본 3개 도메인의 8개 주입 부분집합과 SPOF=0 전용 fixture를 검증한다.
- 기존 npm test, npm run check, npm run smoke가 통과한다.

## 검증 명령

```sh
node --test tests/conditions.test.js tests/engine.test.js tests/templates.test.js tests/project.test.js tests/report.test.js
npm test
npm run check
npm run smoke
```

명령은 package.json과 기존 테스트 파일에서 확인했다. 계획 작성 중에는 메모리 복제본의 엔진 계산만 실행했다. 위 회귀 검증은 구현 후 실행한다. 성능 계산을 바꾸지 않으므로 별도 대규모 성능 측정은 기본 통과 조건에서 제외한다.

## 복구

각 작업을 독립적인 변경 단위로 유지한다. 기본 데이터와 표시 코드 변경을 되돌리면 이전 동작으로 복구한다. 사용자 저장 데이터를 자동 변환하거나 삭제하지 않는다.

