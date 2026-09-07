import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { calculateScenario } from '../src/engine.js';
import { buildTemplate, templates } from '../src/templates.js';

// 화면이 "이 설계에서 확인할 것"으로 내보내는 문장이다. 계산이 실제로 그렇게 나오지 않으면
// 도구가 스스로 틀린 말을 가르치게 된다. 그래서 문구에 적힌 숫자를 엔진과 대조한다.
const percentsIn = (text) => [...String(text).matchAll(/(\d+)%/g)].map((match) => Number(match[1]));

function utilizations(result) {
  return new Set([...result.devices, ...result.links]
    .flatMap((resource) => Object.values(resource.axes || {}))
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
