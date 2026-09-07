import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario, sweepSingleFaults } from '../public/engine.js';
import { buildTemplate, templates } from '../public/templates.js';
import { serializeProject } from '../public/project.js';
import { cardBox, LINK_ROUTES, linkPath, NODE_REACH, formatNodePercent, placeLinkLabels, routeLink, segmentHitsBox } from '../public/node-view.js';

// 화면이 "이 설계에서 확인할 것"으로 내보내는 문장이다. 계산이 실제로 그렇게 나오지 않으면
// 도구가 스스로 틀린 말을 가르치게 된다. 그래서 문구에 적힌 숫자를 엔진과 대조한다.
const percentsIn = (text) => [...String(text).matchAll(/(\d+)%/g)].map((match) => Number(match[1]));

function utilizations(result) {
  // 링크의 평면 축은 바쁜 쪽 방향만 말한다. 방향마다 한계가 다른 회선은 인스펙터가 두 방향을
  // 나란히 펴 보이므로, 문구가 인용할 수 있는 값도 그만큼 넓다.
  const axesOf = (resource) => [resource.axes, ...Object.values(resource.directions || {}).map(({ axes }) => axes)];
  return new Set([...result.devices, ...result.links]
    .flatMap((resource) => axesOf(resource).flatMap((axes) => Object.values(axes || {})))
    .map((axis) => (axis.utilization == null ? null : Math.round(axis.utilization * 100)))
    .filter((value) => value != null));
}

function runExperiment(topology, action) {
  if (action.type === 'scale') return calculateScenario(topology, { scale: Number(action.value) });
  if (action.type === 'fault-device') return calculateScenario(topology, { disabledDevices: [action.id] });
  if (action.type === 'fault-link') return calculateScenario(topology, { disabledLinks: [action.id] });
  throw new Error(`알 수 없는 실험 동작: ${action.type}`);
}

test('every design a newcomer can open says what it is for', () => {
  for (const template of templates) {
    if (template.id === 'blank') continue;
    assert.ok(template.teaches, `${template.id} 에 확인할 것이 없습니다.`);
    assert.ok(template.experiment, `${template.id} 에 눌러 볼 실험이 없습니다.`);
  }
  // 첫 화면도 예외가 아니다. 처음 오는 사람이 보는 화면에만 설명이 없으면 안내가 없는 것이다.
  const demo = cloneTopology();
  assert.ok(demo.template?.teaches, '첫 화면에 확인할 것이 없습니다.');
  assert.ok(demo.template?.experiment, '첫 화면에 눌러 볼 실험이 없습니다.');
});

test('an experiment points at something that exists and can be run', () => {
  const designs = [['demo', cloneTopology()], ...templates.filter(({ experiment }) => experiment).map(({ id }) => [id, buildTemplate(id)])];
  for (const [id, topology] of designs) {
    const { experiment } = topology.template ?? templates.find((item) => item.id === id);
    const { action } = experiment;
    assert.ok(experiment.prompt && experiment.observe, `${id} 실험에 질문 또는 관찰이 없습니다.`);
    if (action.type === 'fault-device') assert.ok(topology.devices.some(({ id: deviceId }) => deviceId === action.id), `${id}: ${action.id} 장비가 없습니다.`);
    if (action.type === 'fault-link') assert.ok(topology.links.some(({ id: linkId }) => linkId === action.id), `${id}: ${action.id} 링크가 없습니다.`);
    // 슬라이더 범위 밖의 배율은 버튼이 눌려도 화면과 어긋난다.
    if (action.type === 'scale') assert.ok(Number(action.value) >= 0.5 && Number(action.value) <= 1.8, `${id}: 배율 ${action.value} 는 슬라이더 범위 밖입니다.`);
  }
});

test('what an experiment claims is what the engine actually computes', () => {
  const designs = [['demo', cloneTopology()], ...templates.filter(({ experiment }) => experiment).map(({ id }) => [id, buildTemplate(id)])];
  let checked = 0;
  for (const [id, topology] of designs) {
    const { experiment } = topology.template ?? templates.find((item) => item.id === id);
    const result = runExperiment(topology, experiment.action);
    const actual = utilizations(result);
    for (const claimed of percentsIn(experiment.observe)) {
      // 반올림 자리에서 1 정도는 벌어질 수 있다. 그 밖은 문구가 계산과 다른 말을 하는 것이다.
      assert.ok([claimed - 1, claimed, claimed + 1].some((value) => actual.has(value)),
        `${id}: 관찰 문구가 ${claimed}% 라고 적었지만 계산에 그 값이 없습니다.`);
      checked += 1;
    }
  }
  assert.ok(checked >= 15, `대조한 수치가 ${checked}개뿐입니다.`);
});

test('the demo everyone lands on teaches the claim the tool is built on', () => {
  const topology = cloneTopology();
  const before = calculateScenario(topology).devices.find(({ id }) => id === 'fw-a');
  // 한 장비가 서로 독립인 한계를 여럿 갖는다는 것이 이 화면의 요지다. 축들이 실제로 갈려야 한다.
  assert.ok(before.axes.forwarding_bps.utilization < 0.5);
  assert.ok(before.axes.new_sessions_per_sec.utilization > 0.8);
  const after = runExperiment(topology, topology.template.experiment.action).devices.find(({ id }) => id === 'fw-b');
  assert.equal(after.axes.forwarding_bps.status, 'healthy', '남은 쪽 대역폭은 아직 여유가 있어야 실험이 성립한다');
  assert.equal(after.axes.new_sessions_per_sec.status, 'overloaded', '넘치는 축은 대역폭이 아니라 세션이어야 한다');
});

// ── 새 설계가 넘지 못할 선 ────────────────────────────────────────────────
// 아래 셋은 지금 21개가 이미 지키고 있다. 먼저 적어 두는 것은, 앞으로 더 복잡한 설계를
// 넣을 때 무엇을 잃으면 안 되는지가 사람의 기억이 아니라 테스트에 있어야 하기 때문이다.

// 편집 한 번은 calculateScenario 한 번과 sweepSingleFaults 한 번이다(app.js recalculate).
// 훑기 비용은 자원 수를 따라 가파르게 붙어 자원 97개에서 99ms 로 PRD 의 100ms 목표에 닿는다.
// 가르칠 것이 하나 더 있다고 도구를 느리게 만들지는 않는다.
const RESOURCE_LIMIT = 95;

test('a design the picker can open is a design the file format can hold', () => {
  for (const { id } of templates) {
    // 저장 경로가 safeContent 와 id 규칙과 calculateScenario 를 전부 돌린다. 여기서 걸리는
    // 설계는 화면에서 편집할 때마다 작업 사본 저장이 조용히 실패한다.
    assert.doesNotThrow(() => serializeProject(buildTemplate(id), { scale: 1, disabledDevices: [], disabledLinks: [] }),
      `${id} 를 저장할 수 없습니다.`);
  }
});

test('no design opens with its numbers already gone', () => {
  for (const { id } of templates) {
    // invalid 는 판정 하나가 아니라 설계 전체의 숫자를 지운다. 불러오자마자 그 상태인
    // 설계는 배울 것이 없다. 컬렉션이 없는 자원을 가리키는 것이 가장 흔한 원인이다.
    const { summary, validationIssues } = calculateScenario(buildTemplate(id), { scale: 1 });
    assert.notEqual(summary.evaluationStatus, 'invalid', `${id}: ${JSON.stringify(validationIssues)}`);
  }
});

test('a design stays inside the budget one edit has', () => {
  for (const { id } of templates) {
    const topology = buildTemplate(id);
    const resources = topology.devices.length + topology.links.length;
    assert.ok(resources <= RESOURCE_LIMIT, `${id} 의 자원이 ${resources}개입니다. 상한은 ${RESOURCE_LIMIT}개입니다.`);
  }
});

// 등급을 정의에 적어 두면 설계 고르기를 열 때 목록 전체를 훑지 않아도 된다. 대신 적어 둔 값이
// 계산과 갈라질 수 있으므로, observe 의 퍼센트를 대조하는 것과 같은 방식으로 여기서 묶어 둔다.
test('the verdict a design claims on its card is the verdict the sweep reaches', () => {
  for (const template of templates) {
    const sweep = sweepSingleFaults(buildTemplate(template.id));
    if (!sweep.resources.length) {
      assert.equal(template.grade, undefined, `${template.id}: 훑을 자원이 없는데 등급을 적었습니다.`);
      continue;
    }
    assert.ok(template.grade, `${template.id} 에 등급이 없습니다.`);
    assert.equal(template.grade.verdict, sweep.grade, `${template.id} 의 판정`);
    // 단일 장애점만 개수를 카드에 적는다. 나머지는 개수를 말하지 않으므로 적어 두지 않는다.
    assert.equal(template.grade.severs, sweep.grade === 'single-point' ? sweep.severs : undefined, `${template.id} 의 단절 개수`);
  }
});

test('a design answers what fills up first, or it has nothing to show', () => {
  for (const { id } of templates) {
    if (id === 'blank') continue;
    const result = calculateScenario(buildTemplate(id), { scale: 1 });
    const binding = [...result.devices, ...result.links].find((resource) => resource.id === result.summary.bindingResourceId);
    assert.ok(binding, `${id} 에 병목이 없습니다.`);
    // 모든 축이 미확인이면 화면 제목이 "무엇이 먼저 차는가"에 답하지 못한다. 데이터시트로 짠
    // 설계가 워크로드 조건을 채운 채로 배포되는 이유가 이것이다.
    assert.notEqual(binding.axes[result.summary.bindingAxis]?.utilization, null, `${id}: 병목 축에 사용률이 없습니다.`);
  }
});

// 엔진이 할 줄 아는 것을 아무 설계도 보여 주지 않으면, 그 코드 경로는 단위 테스트만 지나고
// 사용자는 존재를 모른다. 그래서 선언이 아니라 계산 결과를 본다 — 랙을 적어 놓고 전력 metadata 를
// 빠뜨리면 조용히 unknown 으로 남는 것처럼, 필드만 있고 가르치지는 않는 상태를 막는다.
test('a capability the engine has is a capability some design actually shows', () => {
  const shown = {
    '랙 전력과 U': false, '서비스 수용 기준': false, '장애 도메인': false,
    '방향별 링크 용량': false, '데이터시트 근거': false, '경로 열거 한계': false,
    '명시 경로': false, '명시 백엔드 풀': false, '응답 반환 경로': false,
  };
  for (const { id } of templates) {
    const topology = buildTemplate(id);
    const result = calculateScenario(topology, { scale: 1 });
    shown['랙 전력과 U'] ||= result.racks.some(({ status, powerWatts, usedU }) => status !== 'unknown' && powerWatts != null && usedU != null);
    shown['서비스 수용 기준'] ||= result.services.some(({ status }) => status === 'pass' || status === 'fail');
    // 두 방향의 한계가 다르고 양쪽에 실제로 부하가 흘러야 비대칭을 가르치는 것이다.
    shown['방향별 링크 용량'] ||= result.links.some(({ directions }) => directions
      && directions.forward.axes.forwarding_bps?.limit !== directions.reverse.axes.forwarding_bps?.limit
      && directions.forward.axes.forwarding_bps?.load > 0 && directions.reverse.axes.forwarding_bps?.load > 0);
    shown['데이터시트 근거'] ||= result.devices.some(({ axes }) => Object.values(axes)
      .some(({ evidenceApplicability, utilization }) => ['applicable', 'user-asserted'].includes(evidenceApplicability) && utilization != null));
    shown['경로 열거 한계'] ||= result.demands.some(({ pathEnumeration }) => pathEnumeration?.complete === false);
    shown['명시 경로'] ||= topology.demands.some(({ pathMode, paths }) => pathMode === 'explicit' && paths?.length);
    shown['명시 백엔드 풀'] ||= topology.demands.some(({ backendPool }) => backendPool != null);
    // 반환 경로는 되돌아오는 홉에 실제로 부하가 실려야 무언가를 가르친 것이다. 선언만으로는 그림이 그대로다.
    shown['응답 반환 경로'] ||= result.demands.some(({ returnPaths }) => returnPaths?.length)
      && result.links.some(({ directions }) => directions?.reverse.axes.forwarding_bps?.load > 0);
    // 도메인은 켜고 끈 결과가 달라야 무언가를 실제로 묶은 것이다.
    for (const { id: domainId } of topology.failureDomains || []) {
      const after = calculateScenario(topology, { scale: 1, disabledDomains: [domainId] });
      shown['장애 도메인'] ||= after.summary.unreachableCount !== result.summary.unreachableCount;
    }
  }
  for (const [capability, exercised] of Object.entries(shown)) {
    assert.ok(exercised, `${capability} 를 결과로 보여 주는 설계가 없습니다. 선언만 하고 가르치지 않습니다.`);
  }
});

// 링크가 50개를 넘으면 라벨의 절반이 서로를 덮어 하나도 못 읽게 된다. 선은 하나도 지우지 않지만
// 글자는 같은 자리에 둘을 놓을 수 없다. 노드 카드가 라벨 위에 그려진다는 것도 함께 봐야 한다 —
// 겹침만 세면 카드 뒤로 숨은 라벨을 자리를 얻은 것으로 잘못 센다.
test('every link label the canvas draws is a label a person can actually read', () => {
  const RANK = { overloaded: 0, invalid: 1, disabled: 2, warning: 4, unknown: 5, healthy: 6 };
  for (const { id } of templates) {
    const topology = buildTemplate(id);
    if (!topology.links.length) continue;
    const result = calculateScenario(topology, { scale: 1 });
    const position = new Map(topology.devices.map((device) => [device.id, device.position]));
    const entries = result.links.map((link) => ({
      id: link.id,
      text: link.severed ? 'DOWN' : formatNodePercent(link.axes.forwarding_bps?.utilization ?? null),
      status: link.severed ? 'disabled' : link.primaryStatus,
      util: link.axes.forwarding_bps?.utilization ?? null,
      binding: link.id === result.summary.bindingResourceId,
      from: position.get(link.source), to: position.get(link.target),
    }));
    const spots = placeLinkLabels(entries, topology.devices.map(({ position: at }) => at));

    const boxes = [...spots].map(([linkId, spot]) => ({ ...spot, width: entries.find((entry) => entry.id === linkId).text.length * 5.4 + 3 }));
    for (let a = 0; a < boxes.length; a += 1) for (let b = a + 1; b < boxes.length; b += 1) {
      assert.ok(Math.abs(boxes[a].x - boxes[b].x) >= (boxes[a].width + boxes[b].width) / 2 || Math.abs(boxes[a].y - boxes[b].y) >= 11,
        `${id}: 두 라벨이 같은 자리에 놓였습니다.`);
    }
    const cards = topology.devices.map(({ position: at }) => ({ x1: at.x - NODE_REACH.left, x2: at.x + NODE_REACH.right, y1: at.y - NODE_REACH.top, y2: at.y + NODE_REACH.bottom }));
    for (const box of boxes) {
      assert.ok(!cards.some((card) => box.x > card.x1 && box.x < card.x2 && box.y > card.y1 && box.y < card.y2),
        `${id}: 라벨이 노드 카드 뒤로 숨었습니다.`);
    }
    // 자리가 모자라면 덜 심각한 것부터 밀린다. 넘치거나 끊기거나 미확인인 링크는 밀리면 안 된다.
    for (const entry of entries) {
      if ((RANK[entry.status] ?? 9) >= RANK.healthy) continue;
      assert.ok(spots.has(entry.id), `${id}: ${entry.status} 링크 ${entry.id} 의 라벨이 밀렸습니다.`);
    }
  }
});

test('a four-node consensus cluster keeps its ledger while a quorum stands', () => {
  const topology = buildTemplate('raft-cluster');
  const ledger = (options) => calculateScenario(topology, { scale: 1, ...options }).services.find(({ id }) => id === 'svc-term');
  assert.equal(ledger({}).status, 'pass');
  // 팔로워 한 대는 잃어도 커밋이 이어진다. 넷의 정족수는 셋이다.
  assert.equal(ledger({ disabledDevices: ['node-3'] }).status, 'pass');
  assert.equal(ledger({ disabledDevices: ['node-3'] }).endpointGroups[0].available, 3);
  // 두 대를 잃으면 정족수가 깨진다. 넷은 셋과 같은 내구성에 값만 더 든다.
  assert.equal(ledger({ disabledDevices: ['node-3', 'node-4'] }).status, 'fail');
  // 리더가 멈추면 정족수가 살아 있어도 쓰기가 들어갈 곳이 없다. 재선출까지가 그 공백이다.
  const leaderDown = ledger({ disabledDevices: ['node-1'] });
  // 리더를 잃어도 정족수는 셋으로 선다. 이 임기의 쓰기 경로만 끊기는 것이고, 그 구분이
  // 수용 기준의 이름과 endpointGroups 에 나뉘어 있어야 클러스터가 죽었다고 읽히지 않는다.
  assert.equal(leaderDown.endpointGroups[0].available, 3, '리더를 잃어도 셋은 남는다');
  assert.equal(leaderDown.status, 'fail', '이 임기의 쓰기 경로는 리더와 함께 끊긴다');
});

test('consensus spends packets, not bytes', () => {
  const result = calculateScenario(buildTemplate('raft-cluster'), { scale: 1 });
  const leader = result.devices.find(({ id }) => id === 'node-1');
  const follower = result.devices.find(({ id }) => id === 'node-2');
  // 리더의 부담이 팔로워의 몇 배인지가 이 설계의 요지다. 리더는 돌아가며 맡으므로 넷의 사양이 같다.
  assert.ok(leader.axes.nic_pps.utilization > follower.axes.nic_pps.utilization * 4,
    `리더 ${leader.axes.nic_pps.utilization} 가 팔로워 ${follower.axes.nic_pps.utilization} 의 네 배를 넘지 못합니다`);
  assert.ok(leader.axes.nic_pps.utilization > leader.axes.nic_bps.utilization * 2, '대역폭이 아니라 패킷이 먼저 차야 한다');
  assert.equal(result.summary.bindingResourceId, 'node-1');
  // 로그는 한쪽으로만 흐르는데 수락 응답은 보낸 것 하나에 하나씩이다. 바이트는 기울고 패킷은 같다.
  const link = result.links.find(({ id }) => id === 'node-1-node-2');
  assert.equal(link.directions.forward.axes.forwarding_pps.load, link.directions.reverse.axes.forwarding_pps.load);
  assert.ok(link.directions.forward.axes.forwarding_bps.load > link.directions.reverse.axes.forwarding_bps.load * 10);
});


test('a bent line goes around the cards a straight one cuts through', () => {
  const counted = { straight: 0, orthogonal: 0, curved: 0 };
  let links = 0;
  for (const { id } of templates) {
    const topology = buildTemplate(id);
    if (!topology.links.length) continue;
    links += topology.links.length;
    const boxes = new Map(topology.devices.map((device) => [device.id, cardBox(device.position)]));
    const at = new Map(topology.devices.map((device) => [device.id, device.position]));
    for (const link of topology.links) {
      // 양 끝의 카드는 셈에서 뺀다. 자기 장비에서 나가는 선은 그 카드를 지날 수밖에 없다.
      const obstacles = [...boxes].filter(([memberId]) => memberId !== link.source && memberId !== link.target).map(([, box]) => box);
      for (const mode of LINK_ROUTES) {
        const points = routeLink(at.get(link.source), at.get(link.target), obstacles, mode);
        if (points.some((point, index) => index && obstacles.some((box) => segmentHitsBox(points[index - 1], point, box)))) counted[mode] += 1;
      }
    }
  }
  // 곧게 그으면 남의 카드를 뚫고 지나가는 선이 이만큼 있다. 굽히는 선택지가 있는 이유다.
  assert.ok(counted.straight > 20, `직선이 카드를 지나는 링크가 ${counted.straight}개뿐이라 굽힐 이유를 못 보여 줍니다`);
  assert.equal(counted.orthogonal, 0, `직각이 카드를 ${counted.orthogonal}개 링크에서 지납니다`);
  assert.equal(counted.curved, 0, `곡선이 카드를 ${counted.curved}개 링크에서 지납니다`);
  assert.ok(links > 200);
});

test('every route mode draws a path that starts and ends on the devices it joins', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 120 };
  const wall = [{ left: 150, right: 250, top: -60, bottom: 60 }];
  for (const mode of LINK_ROUTES) {
    for (const obstacles of [[], wall]) {
      const points = routeLink(from, to, obstacles, mode);
      assert.deepEqual(points[0], from, `${mode}: 선은 출발 장비에서 시작해야 한다`);
      assert.deepEqual(points.at(-1), to, `${mode}: 선은 도착 장비에서 끝나야 한다`);
      const d = linkPath(points, mode);
      assert.match(d, /^M 0 0/, `${mode}: 경로가 출발점에서 열려야 한다`);
      // 좌표쌍이 명령 없이 이어지면 앞 곡선의 인자로 읽혀 길이 엉뚱한 곳으로 간다.
      assert.doesNotMatch(d, /Q [-\d. ]+ Q/, `${mode}: 곡선 뒤에 명령 없는 좌표를 두면 경로가 깨진다`);
    }
  }
  // 곧게 갈 수 있어도 곡선은 부풀린다. 겹쳐 지나는 두 선이 갈려 보이게 하는 것이 이 모드의 값이다.
  assert.equal(routeLink(from, to, [], 'curved').length, 3);
  assert.equal(routeLink(from, to, [], 'orthogonal').length, 2, '곧게 갈 수 있으면 직각은 굽히지 않는다');
});
