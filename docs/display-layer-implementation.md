# Rack Mesh — 표시 계층 구현 명세

작성일: 2026-09-09
대상 빌드: engine 3.0.0
상위 문서: `docs/display-layer-improvement-prd.md` 4절, 6.2절
수정 파일: `public/app.js`, 스타일시트

이 문서 하나로 작업할 수 있게 썼다. 현재 코드의 실제 내용, 문제의 원인, 바꿀 코드, 통과 기준을 모두 담았다.

---

## 1. 범위

**이 문서가 다루는 것은 두 가지다.**

1. 패킷 점 속도 정규화. 점의 움직임이 링크 길이가 아니라 사용률을 말하게 하고, 통과하지 못하는 트래픽이 경로 끝에 도달하지 않게 한다.
2. 출처 게이트 떨림. 떨림의 의미를 "확정되지 않음"으로 바꾸고, 폭을 `source.type`이 정하게 한다. 여기에 백분율과 부하가 따로 흔들리는 산술 결함 수정이 포함된다.

**범위 밖.** 아래는 PRD에 있지만 이 문서로 하지 않는다. 같이 손대지 말 것.

- 요약 타일의 손실 표기(PRD 5.1)
- 헤더 상태 칩 분리(PRD 5.3)
- 기본 시나리오의 검증 객체 채우기(PRD 6.1)
- 레이아웃 순서 변경(PRD 6.3), 여유 배수 타일(PRD 6.4)
- 최초 진입 티저와 사건 펄스(PRD 7.1)
- 계산 엔진(`public/engine.js`). 이 문서의 모든 변경은 표시 계층에서 끝난다.

## 2. 이미 되어 있는 것

다시 만들지 말 것. 확인한 사실이다.

**재계산 트윈.** `MOTION.tween = 260ms`, `syncLiveNumbers()`가 이전 표시값을 기억하고 `stepMotion()`이 cubic ease-out으로 잇는다. 첫 렌더와 reduced-motion에서는 건너뛴다. 지금 이게 눈에 안 띄는 이유는 유휴 떨림이 위에서 계속 돌기 때문이고, 2번 변경이 그 소음을 걷어내면 드러난다.

**패킷 점 자체.** `.packet-dot` 요소가 SVG `animateMotion`으로 링크를 따라 흐른다. `healthy` / `warning` / `overloaded` 상태 클래스, 응답 방향의 빈 속 표현, `prefers-reduced-motion`에서 `display: none`이 모두 들어가 있다. 미확인 방향에는 점을 그리지 않는 처리도 있다. 이 판단들은 옳으니 유지한다.

**축별 출처.** `engine.js`가 축마다 `result.source`와 `result.evidenceApplicability`를 붙인다. `source.type`은 `datasheet | third_party_test | user_measured | estimate`이고 override에는 `user-correction`이 들어간다. 새로 계산할 것이 없고 DOM으로 실어 나르기만 하면 된다.

**판정 무오염.** 상태 클래스는 렌더 시점에 엔진 원값에서 결정되고, `paintLive()`는 `textContent`와 `--util` 막대 길이만 다시 칠한다. 떨림이 배지를 임계값 너머로 넘기지 못한다.

**내보내기 안전.** `diagramSvg()`가 `exportDiagramSvg(topology, current, ...)`를 호출한다. 화면 DOM을 직렬화하는 것이 아니라 엔진 결과에서 다시 그린다. PNG도 그 SVG를 캔버스에 옮긴다. 떨림 프레임이 파일에 굳지 않으므로 별도 가드가 필요 없다.

---

## 3. 변경 1 — 패킷 점 속도 정규화

### 3.1 문제

현재 코드는 속도를 사용률에 연동하고 있다. 밀도도 1~3개로 변한다. 결함은 연동 방식에 있다.

```js
const count = Math.min(3, Math.max(1, Math.ceil(share * 3)));
const duration = Math.max(1.25, 3.4 - Math.min(share, 1.5) * 1.25);
```

**기하가 섞인다.** `animateMotion`은 경로 전체를 `dur` 안에 지난다. 체감 속도는 `경로길이 / dur`이므로 링크가 길수록 빨라 보인다. 사용률 26%인 긴 링크가 85%인 짧은 링크보다 빠르게 보이는 상황이 실제로 나온다. 속도가 사용률이 아니라 그림의 길이를 말하고 있다.

**범위가 좁다.** 0%가 3.4초, 150%가 1.53초. 전 구간 2.2배다. 85%와 26%의 차이는 2.34초 대 3.08초라 사람이 차이로 읽지 못한다.

**과부하가 정직하지 않다.** `Math.min(share, 1.5)`로 잘려서 122%와 171%가 같게 움직인다. 더 큰 문제는 버려지는 트래픽까지 점이 경로 끝에 도착한다는 것이다. 서술 푸터가 "병목을 지나지 못한 2.2 Gbps가 버려집니다"라고 적는 동안 그림은 전부 도착한다고 그린다.

### 3.2 모듈 상수와 길이 측정

다른 렌더 도우미들 옆, 링크 렌더 블록보다 위에 둔다.

```js
// 점 속도는 px/s 로 고정한다. animateMotion 의 dur 는 경로 길이와 무관하므로 dur 만 맞추면
// 긴 링크의 점이 더 빨라 보인다. 그러면 속도가 사용률이 아니라 그림의 길이를 말하게 된다.
const PACKET = { idle: 30, full: 115, jam: 12, minDur: 0.8, maxDur: 7, maxDots: 4 };
const packetPixelSpeed = (share) => (share > 1
  ? PACKET.jam
  : PACKET.idle + (PACKET.full - PACKET.idle) * Math.min(share, 1));

// 경로 길이를 재려면 실제 path 가 필요하다. 떼어 놓은 요소의 getTotalLength 는 엔진마다 다르게
// 굴어서, link-layer 안에 숨긴 자 하나를 두고 재사용한다. display:none 이 아니라 visibility 다 -
// 없는 것으로 치면 길이가 0 으로 나오는 엔진이 있다.
let packetRuler = null;
function pathLength(geometry) {
  if (!packetRuler) {
    packetRuler = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    packetRuler.setAttribute('visibility', 'hidden');
    packetRuler.setAttribute('fill', 'none');
    element('link-layer').append(packetRuler);
  }
  packetRuler.setAttribute('d', geometry);
  try { return packetRuler.getTotalLength(); } catch { return 0; }
}
```

`packetRuler`는 `element('link-layer').innerHTML = ...` 로 매번 날아간다. `pathLength()`가 `packetRuler`를 다시 만들어 붙이므로 문제가 없지만, 자를 붙이기 전에 `innerHTML`이 실행되는 순서를 지켜야 한다. 아래 3.3에서 `innerHTML` 할당식 안에서 `pathLength()`를 부르므로 자는 매 렌더마다 새로 만들어진다. 그 상태에서도 정확하니 그대로 둔다. 렌더 밖에서 자를 참조하는 코드를 새로 만들지 말 것.

### 3.3 링크 렌더 진입부 (app.js 938 부근)

`geometry`가 `escapeAttribute()`를 거친 뒤라 길이 측정에 쓸 수 없다. 원본을 따로 남긴다.

```js
// 변경 전
const geometry = escapeAttribute(linkPath(routes.get(link.id), routeView.mode));

// 변경 후
const geometryRaw = linkPath(routes.get(link.id), routeView.mode);
const geometry = escapeAttribute(geometryRaw);
const linkLength = pathLength(geometryRaw);
```

### 3.4 packetStream 교체 (app.js 943-955)

주변 주석은 그대로 두고 함수 본문만 바꾼다.

```js
    const packetStream = (direction) => {
      const axis = link.directions?.[direction]?.axes?.forwarding_bps;
      const share = axis && axis.status !== 'unknown' ? axis.utilization : null;
      if (link.severed || onSeveredPath || !(share > 0)) return '';
      const count = Math.min(PACKET.maxDots, Math.max(1, Math.ceil(share * 3)));
      const back = direction === 'reverse';
      // 넘치는 링크에서는 통과한 몫만 끝까지 간다. 122% 면 82% 지점에서 사라진다. 링크 라벨이
      // 말하는 것과 같은 사실을 그림이 말한다. 버려지는 트래픽을 끝까지 흘려보내면, 서술이
      // "2.2 Gbps 가 버려집니다" 라고 적는 동안 화면은 모두 도착한다고 그리게 된다.
      const reach = Math.min(1, 1 / share);
      const span = linkLength * reach;
      const duration = span > 0
        ? Math.min(PACKET.maxDur, Math.max(PACKET.minDur, span / packetPixelSpeed(share)))
        : 3;
      // 경로는 출발지에서 도착지로 그려져 있다. 응답은 그 길을 거꾸로 달린다.
      const keyPoints = back ? `1;${(1 - reach).toFixed(4)}` : `0;${reach.toFixed(4)}`;
      return Array.from({ length: count }, (_, index) => `<circle class="packet-dot ${status}${back ? ' response' : ''}${share > 1 ? ' dropped' : ''}" r="${back ? 2.6 : 3}" style="--packet-dur:${duration.toFixed(2)}s">
        <animateMotion path="${geometry}" keyPoints="${keyPoints}" keyTimes="0;1" calcMode="linear" dur="${duration.toFixed(2)}s" begin="-${(duration * index / count).toFixed(2)}s" repeatCount="indefinite"></animateMotion>
      </circle>`).join('');
    };
```

주의할 점 두 가지.

`keyPoints`를 쓰면 `keyTimes`와 `calcMode="linear"`가 반드시 함께 있어야 한다. `animateMotion`의 기본 `calcMode`는 `paced`이고 그 모드에서는 `keyPoints`가 무시된다. 지금 코드의 역방향 처리에 이미 셋이 함께 있으니 정방향에도 똑같이 붙인다.

음수 `begin`은 마크업에 들어 있을 때만 소급 적용된다. 삽입 뒤에 `setAttribute('begin', ...)`로 고쳐도 이미 시작한 애니메이션에는 반영되지 않는다. 그래서 길이를 미리 재서 마크업 문자열 안에서 `dur`과 `begin`을 확정하는 방식을 택했다. 렌더 후 보정 패스로 바꾸지 말 것.

### 3.5 스타일

```css
/* 통과하지 못하는 점은 끝에 닿기 전에 흐려진다. 색만 바꾸면 붉은 트래픽이 잘 지나간다고 읽힌다.
   주기를 이동 시간에 묶어 두 애니메이션이 어긋나지 않게 한다. */
.packet-dot.dropped { animation: packet-drop var(--packet-dur, 3s) linear infinite; }
@keyframes packet-drop { 0%, 72% { opacity: 1; } 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) { .packet-dot.dropped { animation: none; } }
```

기존 reduced-motion 블록이 이미 `.packet-dot { display: none }`을 갖고 있으므로 위 규칙은 방어용이다. 둘 다 둔다.

### 3.6 결과

| 사용률 | 점 개수 | 이동 거리 | 체감 속도 |
|---|---|---|---|
| 0.26 | 1 | 전체 | 52 px/s |
| 0.85 | 3 | 전체 | 102 px/s |
| 1.00 | 3 | 전체 | 115 px/s |
| 1.22 | 4 | 82% 지점에서 소멸 | 12 px/s |
| 1.71 | 4 | 58% 지점에서 소멸 | 12 px/s |

과부하 링크가 빠른 빨간 선이 아니라 정체로 읽힌다. 지금 매핑은 정반대를 말한다.

---

## 4. 변경 2 — 출처 게이트 떨림

### 4.1 원칙

떨림은 장식이 아니라 **"이 값은 아직 확정되지 않았다"**는 뜻이다. 확정된 값은 움직이지 않는다. 그래서 폭은 `source.type`이 정한다.

부수 효과가 이 변경의 핵심이다. 근거를 채울수록 화면이 조용해진다. 정지 자체가 신호가 된다.

### 4.2 산술 결함의 원인

같은 축의 백분율 노드와 부하 노드에 **다른 시드**가 붙는다.

```js
// app.js 471 / 474 — 노드 카드
data-live-seed="${escapeAttribute(device.id)}:${key}"        // 백분율
data-live-seed="${escapeAttribute(device.id)}:${key}-load"   // 부하

// app.js 1407 / 1409 — 인스펙터 축 행, 같은 방식으로 갈림
```

`telemetryWave()`가 시드 문자열을 해시하므로 두 파동이 독립적으로 생성된다. 그 위에 적용 방식까지 다르다.

```js
// app.js 1487-1489
const wave = telemetryWave(seed, phase, MOTION.amplitude);
// 백분율에는 퍼센트포인트로 더하고, 부하 수치에는 비율로 곱한다.
paintLive(node, Math.max(0, kind === 'percent' ? value + wave : value * (1 + wave)), kind);
```

`percent = load / limit`을 만족해야 하는 두 숫자에 서로 다른 교란을 두 번 넣는다. 그래서 한계 10 Gbps 장비에서 `7.10G`가 `74%`로 찍힌다. 71%여야 한다.

실측 5회, 입력 변화 없음:

```
BPS 7.25G 70%   CPS 72.2K 173%
BPS 7.28G 72%   CPS 70.6K 170%
BPS 7.10G 74%   CPS 71.5K 170%
BPS 7.09G 72%   CPS 72.8K 172%
BPS 7.25G 71%   CPS 71.7K 172%
```

떨림 끔에서는 4회 모두 `BPS 7.20G 72% · CPS 72.0K 171%`로 고정된다.

### 4.3 상수 교체 (app.js 1418-1421)

기존 주석 세 줄과 `MOTION.amplitude`를 함께 바꾼다.

```js
// 트윈은 260ms, 떨림은 300ms 마다 한 걸음 나아간다.
const MOTION = { tween: 260, driftCadence: 300 };

// 떨림은 "이 값은 아직 확정되지 않았다"는 뜻이다. 그래서 폭은 출처가 정한다. 실측과 사용자가
// 단언한 값은 사실이므로 움직이지 않는다. 근거를 채울수록 화면이 조용해지고, 그 고요가 신호가
// 된다. 백분율에 곱을 쓰면 낮은 값이 반올림에 묻힌다는 문제는 estimate 의 넓은 폭이 대신
// 해결한다 - 20% 축이 ±0.8퍼센트포인트로 움직인다.
const DRIFT_AMPLITUDE = {
  estimate: 0.04,
  datasheet: 0.015,
  third_party_test: 0.01,
  user_measured: 0,
  'user-correction': 0,
};
// 출처를 모르는 값은 추정으로 다룬다. 모르는 것을 확정으로 바꾸지 않는다.
const DRIFT_FALLBACK = DRIFT_AMPLITUDE.estimate;
const driftAmplitude = (node) => DRIFT_AMPLITUDE[node.dataset.liveSource] ?? DRIFT_FALLBACK;
```

`MOTION.amplitude`를 참조하는 곳은 `stepMotion()` 한 군데뿐이다. 그곳도 아래에서 바꾼다.

### 4.4 stepMotion 교체 (app.js 1484-1489)

```js
    // 떨림은 헤드라인 숫자에 걸지 않는다(DESIGN.md). 고정된 비교 패널과 다른 말을 하면
    // 읽는 사람은 어느 쪽을 적어야 할지 알 수 없다. 확정된 값도 걸지 않는다.
    const amplitude = driftAmplitude(node);
    if (!drifting || !amplitude || node.closest('.binding-callout')) { paintLive(node, value, kind); continue; }
    // 백분율과 부하는 같은 축의 같은 숫자다. 시드가 갈리면 7.10G 가 74% 로 찍혀 한 라벨 안에서
    // 산술이 깨진다. 축 하나에 파동 하나를 만들고, 두 노드가 같은 비율로 곱한다.
    const factor = 1 + telemetryWave(node.dataset.liveDrift || seed, phase, amplitude);
    paintLive(node, Math.max(0, value * factor), kind);
```

`data-live-seed`는 그대로 둔다. 트윈이 노드를 구분하는 열쇠라 유일해야 한다. `data-live-drift`가 새로 들어가고 이쪽은 일부러 축 단위로 공유한다.

### 4.5 마크업 네 곳

`data-live-*`를 내보내는 곳은 정확히 네 군데다. 그중 셋에 두 속성을 붙인다. 네 번째(`binding-callout`)는 이미 떨림에서 제외되므로 손대지 않는다.

**노드 카드 (app.js 469-474).**

```js
function nodeAxisRow(device, key, axis, brief = false) {
  // 떨림 폭은 축의 출처가 정한다. 백분율과 부하가 같은 파동을 쓰도록 시드를 함께 넘긴다.
  const drift = ` data-live-drift="${escapeAttribute(device.id)}:${key}" data-live-source="${escapeAttribute(axis.source?.type ?? '')}"`;
  // unknown·invalid 축에는 data-live-util을 붙이지 않는다. 텔레메트리가 미확인 값을 숫자로 덮어쓰면 안 된다.
  const live = axis.utilization == null ? '' : ` data-live-util="${axis.utilization}" data-live-seed="${escapeAttribute(device.id)}:${key}"${drift}`;
  // 사용률만 떨고 부하는 그대로면 한쪽만 살아 있는 것처럼 보인다. 한계를 몰라 사용률이
  // 미확인인 축에도 부하는 알 수 있으므로, 부하는 부하대로 따라간다.
  const liveLoad = Number.isFinite(axis.load) ? ` data-live-load="${axis.load}" data-live-seed="${escapeAttribute(device.id)}:${key}-load"${drift}` : '';
```

**인스펙터 축 행 (app.js 1406-1409).** `axisRow` 안, `return` 직전에 `drift`를 만든다.

```js
  const drift = ` data-live-drift="${escapeAttribute(resourceId)}:${axis}" data-live-source="${escapeAttribute(result.source?.type ?? '')}"`;
  return `<div class="axis-row ${result.status}"${drag ? ' data-axis-editable=""' : ''}>
    <div class="axis-title"><span>${catalog.label}</span><span>${stateLabel(result.status)} · <b data-live-util="${result.utilization ?? ''}" data-live-seed="${resourceId}:${axis}"${drift}>${formatPercent(result.utilization)}</b></span></div>
    ${meter}
    <div class="axis-values"><span data-live-load="${result.load}" data-live-unit="${catalog.unit}" data-live-seed="${resourceId}:${axis}-load"${drift}>${formatCompact(result.load, catalog.unit)} load</span><span data-axis-limit="${escapeAttribute(axis)}">${formatCompact(result.limit, catalog.unit)} limit</span></div>
  </div>`;
```

**링크 라벨 (app.js 962).** 링크 축에는 `source`가 붙지 않을 수 있다. 포트 속도는 확정값이므로 `datasheet`를 기본값으로 명시한다. `estimate`로 흘러들어가 흔들리게 두면 안 된다.

```js
${spot ? `<text class="link-label"${link.severed ? '' : ` data-live-util="${utilization ?? ''}" data-live-seed="${link.id}" data-live-drift="${link.id}:forwarding_bps" data-live-source="${escapeAttribute(link.axes.forwarding_bps?.source?.type ?? 'datasheet')}"`} x="${spot.x}" y="${spot.y}" text-anchor="middle">${link.severed ? 'DOWN' : formatPercent(utilization)}</text>` : ''}
```

사용자가 링크 정격을 직접 입력하는 경로가 생기면 그때 `user-correction`으로 승격한다. 지금은 하지 않는다.

### 4.6 컨트롤 문구 (app.js 261 부근)

라벨이 `떨림`이면 새 의미를 전달하지 못한다.

```js
// 변경 전
group('떨림', 'number-motion', motionView.drift, [['off', '끔'], ['on', '켬']])

// 변경 후
group('미확정 표시', 'number-motion', motionView.drift, [['off', '끔'], ['on', '켬']])
```

컨트롤 옆 도움말: `확정되지 않은 값만 흔들립니다. 실측값은 움직이지 않습니다.`

app.js 427의 주석("떨림은 지어낸 값이다. 그래서 끄는 스위치를 늘 화면에 두고...")은 새 의미에 맞게 고친다. 스위치를 항상 노출한다는 판단 자체는 유지한다.

---

## 5. 테스트

`node --test`로 도는 기존 스위트에 넣는다. `packetPixelSpeed`와 `reach` 계산은 DOM 없이 검증할 수 있게 순수 함수로 뽑아 export 한다.

**결정성.** 떨림 끔 상태에서 같은 토폴로지를 두 번 렌더하면 모든 live 노드의 `textContent`가 바이트 단위로 같다.

**산술 일치.** 떨림 켬 상태에서 모든 축 노드 쌍의 표시 백분율과 `표시 부하 / 한계`가 1e-6 이내로 일치한다. **현재 빌드에서 실패한다.** 먼저 넣고 고치는 순서로 진행할 것.

**판정 무오염.** 임계값에서 2% 이내 값에 대해 떨림 켬과 끔의 상태 클래스가 동일하다.

**출처 게이트.** `driftAmplitude`가 `user_measured`와 `user-correction`에 0을 반환한다. 모든 축이 `user_measured`인 장비는 떨림 켬과 끔의 출력이 동일하다. `data-live-source`가 없는 노드는 `estimate` 폭을 받는다.

**패킷 속도 단조성.** `packetPixelSpeed`가 `[0, 1]`에서 단조 비감소이고, `PACKET.jam < PACKET.idle`이므로 `share > 1`이 항상 가장 느리다.

**패킷 기하 독립성.** 길이가 다른 두 링크가 같은 사용률일 때 `span / duration`이 클램프 구간 밖에서 일치한다.

**통과 비율.** `reach(share) === 1` for `share <= 1`. `reach(1.22)`가 `0.8196721...`와 1e-9 이내로 일치한다. `share > 1`인 링크의 `keyPoints` 끝값이 정방향에서 1 미만, 역방향에서 0 초과다.

---

## 6. 완료 기준

- [ ] 길이가 크게 다른 두 링크를 같은 사용률로 만들었을 때 점 속도가 같아 보인다.
- [ ] 사용률 100%를 넘는 링크의 점이 경로 끝에 닿지 않고, 넘는 정도가 클수록 더 일찍 사라진다.
- [ ] 과부하 링크의 점이 정상 링크보다 느리다.
- [ ] 떨림 켬 상태에서 아무 노드나 골라 부하를 한계로 나눈 값이 표시 백분율과 같다.
- [ ] 축의 출처를 `user_measured`로 바꾸면 그 축의 숫자가 멈춘다.
- [ ] 배율 슬라이더를 움직이면 260ms 트윈이 눈에 보인다.
- [ ] `prefers-reduced-motion`에서 점과 떨림이 모두 멈추고 숫자는 확정값을 보인다.
- [ ] 범위 밖 항목(1절)에 변경이 없다.
