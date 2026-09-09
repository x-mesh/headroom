import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario, calculateSurvivalMultiplier, compareScenarios, createExport, createFailureDomainSweepTask, createSingleFaultSweepTask, createSurvivalMultiplierTask, deliveryRoleOf, sweepFailureDomains, sweepSingleFaults } from '../public/engine.js';
import { addDemand, addDevice, addLink, createEmptyTopology } from '../public/editor.js';
import { buildTemplate, templates } from '../public/templates.js';

test('splits demand evenly across active ECMP paths', () => {
  const result = calculateScenario(cloneTopology());
  const publicDemand = result.demands.find(({ id }) => id === 'public-api');
  assert.equal(publicDemand.paths.length, 2);
  assert.equal(publicDemand.paths[0].share, 0.5);
  assert.deepEqual(publicDemand.paths[0].devices, ['edge-a', 'fw-a', 'spine-a', 'leaf-a', 'api-a']);
  assert.deepEqual(publicDemand.paths[0].hops.map(({ direction }) => direction), ['forward', 'forward', 'forward', 'forward']);
  const linkA = result.links.find(({ id }) => id === 'edge-a-fw-a');
  const linkB = result.links.find(({ id }) => id === 'edge-b-fw-b');
  assert.equal(linkA.load.forwarding_bps + linkB.load.forwarding_bps, 7.2e9);
});

test('reroutes traffic and exposes the overloaded firewall after a peer failure', () => {
  const result = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] });
  const firewallB = result.devices.find(({ id }) => id === 'fw-b');
  assert.equal(result.demands.find(({ id }) => id === 'public-api').paths.length, 1);
  assert.ok(result.demands.find(({ id }) => id === 'public-api').paths[0].hops.length > 0);
  assert.equal(firewallB.axes.new_sessions_per_sec.load, 72e3);
  assert.equal(firewallB.axes.new_sessions_per_sec.status, 'overloaded');
});

test('preserves unreachable demand and its original scaled load', () => {
  const result = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a', 'fw-b'], scale: 1.25 });
  const demand = result.demands.find(({ id }) => id === 'public-api');
  assert.equal(demand.status, 'unreachable');
  assert.equal(demand.load.forwarding_bps, 9e9);
  assert.equal(result.summary.unreachableCount, 1);
});

test('keeps missing capacity unknown instead of healthy', () => {
  const result = calculateScenario(cloneTopology());
  const api = result.devices.find(({ id }) => id === 'api-a');
  assert.equal(api.axes.nic_pps.status, 'unknown');
  assert.equal(api.axes.nic_pps.utilization, null);
  assert.ok(api.statuses.includes('unknown'));
});

test('reports a resource with no limits as unknown, never healthy', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'bare', limits: {} });
  const [device] = calculateScenario(topology).devices;
  assert.equal(device.axes.forwarding_bps.status, 'unknown');
  assert.equal(device.axes.forwarding_pps.status, 'unknown');
  assert.equal(device.bindingAxis, null);
  assert.equal(device.primaryStatus, 'unknown', 'knowing no limit is not the same as passing every limit');
});

test('reports a dangling path reference without refusing the editable document', () => {
  const topology = cloneTopology();
  topology.demands[0].paths[0].links.push('missing-link');
  assert.equal(calculateScenario(topology).summary.validationStatus, 'invalid');
});

test('compares a fixed baseline with a failure scenario', () => {
  const topology = cloneTopology();
  const baseline = calculateScenario(topology);
  const current = calculateScenario(topology, { disabledDevices: ['fw-a'] });
  const comparison = compareScenarios(baseline, current);
  assert.equal(comparison.bindingChanged, true);
  assert.ok(comparison.minHeadroomDelta < 0);
  assert.ok(comparison.overloadedDelta > 0);
});

// 리팩터가 계산을 바꾸지 않았음을 증명하는 스냅샷이다. 방향성을 도입할 때 링크 값이
// 의도적으로 갱신되며, 그때 무엇이 왜 바뀌는지가 이 diff에 드러나야 한다.
const round4 = (value) => (value == null ? null : Math.round(value * 10000) / 10000);
const snapshot = (scenario) => ({
  links: Object.fromEntries(scenario.links.map((link) => [link.id, round4(link.axes.forwarding_bps.utilization)])),
  devices: Object.fromEntries(scenario.devices.map((device) => [device.id, [device.bindingAxis, round4(device.minHeadroom), device.primaryStatus]])),
  binding: [scenario.summary.bindingResourceId, scenario.summary.bindingAxis, round4(scenario.summary.minHeadroom)],
  counts: [scenario.summary.overloadedCount, scenario.summary.warningCount, scenario.summary.unreachableCount],
  delivery: scenario.demands.map(({ id, status, deliveredRatio, paths }) => [id, status, round4(deliveredRatio), paths.length]),
});

test('holds the healthy demo calculation', () => {
  assert.deepEqual(snapshot(calculateScenario(cloneTopology())), {
    links: {
      'edge-a-fw-a': 0.36, 'edge-b-fw-b': 0.36, 'fw-a-spine-a': 0.36, 'fw-b-spine-b': 0.36,
      'spine-a-leaf-a': 0.36, 'spine-b-leaf-a': 0.25, 'spine-a-leaf-b': 0.25, 'spine-b-leaf-b': 0.61,
      'leaf-a-api-a': 0.5, 'leaf-b-api-b': 0.86,
    },
    devices: {
      'edge-a': ['forwarding_bps', 0.64, 'healthy'], 'edge-b': ['forwarding_bps', 0.64, 'healthy'],
      'fw-a': ['new_sessions_per_sec', 0.1429, 'warning'], 'fw-b': ['new_sessions_per_sec', 0.1429, 'warning'],
      'spine-a': ['forwarding_bps', 0.695, 'healthy'], 'spine-b': ['forwarding_bps', 0.695, 'healthy'],
      'leaf-a': ['forwarding_bps', 0.2833, 'healthy'], 'leaf-b': ['forwarding_bps', 0.2833, 'healthy'],
      'api-a': ['nic_bps', 0.2833, 'unknown'], 'api-b': ['nic_bps', 0.2833, 'unknown'],
    },
    binding: ['leaf-b-api-b', 'forwarding_bps', 0.14],
    counts: [0, 3, 0],
    delivery: [['public-api', 'delivered', 1, 2], ['east-west', 'delivered', 1, 2]],
  });
});

test('holds the demo calculation with the primary firewall down', () => {
  const scenario = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] });
  assert.deepEqual(snapshot(scenario), {
    links: {
      'edge-a-fw-a': 0, 'edge-b-fw-b': 0.72, 'fw-a-spine-a': 0, 'fw-b-spine-b': 0.72,
      'spine-a-leaf-a': 0.25, 'spine-b-leaf-a': 0.25, 'spine-a-leaf-b': 0.25, 'spine-b-leaf-b': 0.97,
      'leaf-a-api-a': 0.5, 'leaf-b-api-b': 1.22,
    },
    devices: {
      'edge-a': ['forwarding_bps', 1, 'healthy'], 'edge-b': ['forwarding_bps', 0.28, 'healthy'],
      'fw-a': ['forwarding_bps', 1, 'healthy'], 'fw-b': ['new_sessions_per_sec', -0.7143, 'overloaded'],
      'spine-a': ['forwarding_bps', 0.875, 'healthy'], 'spine-b': ['forwarding_bps', 0.515, 'healthy'],
      'leaf-a': ['forwarding_bps', 0.5833, 'healthy'], 'leaf-b': ['forwarding_bps', -0.0167, 'overloaded'],
      'api-a': ['nic_bps', 0.5833, 'unknown'], 'api-b': ['nic_bps', -0.0167, 'overloaded'],
    },
    binding: ['fw-b', 'new_sessions_per_sec', -0.7143],
    counts: [4, 1, 0],
    delivery: [['public-api', 'delivered', 0.8197, 1], ['east-west', 'delivered', 0.8197, 2]],
  });
  // 과부하가 결과에 남는다. leaf-b-api-b 가 122% 이므로 그 경로는 1/1.22 만 지나간다.
  assert.equal(scenario.links.find(({ id }) => id === 'leaf-b-api-b').axes.forwarding_bps.status, 'overloaded');
  assert.equal(scenario.demands.every(({ deliveredRatio }) => deliveredRatio < 1), true);
  assert.equal(Math.round(scenario.summary.droppedLoadBps), 2.2e9);
});

test('splits a link that carries traffic both ways', () => {
  const scenario = calculateScenario(cloneTopology());
  const shared = scenario.links.find(({ id }) => id === 'leaf-a-api-a');
  const oneWay = scenario.links.find(({ id }) => id === 'leaf-b-api-b');
  // 두 링크는 합산으로 보면 똑같이 86% 다. api-a 는 east-west 의 출발지, api-b 는 도착지라서
  // 실제로는 전혀 다른 링크다.
  assert.equal(round4(shared.directions.forward.axes.forwarding_bps.utilization), 0.36);
  assert.equal(round4(shared.directions.reverse.axes.forwarding_bps.utilization), 0.5);
  assert.equal(shared.bindingDirection, 'reverse');
  assert.equal(round4(shared.axes.forwarding_bps.utilization), 0.5);
  assert.equal(round4(oneWay.directions.forward.axes.forwarding_bps.utilization), 0.86);
  // 한쪽으로만 지나는 링크의 반대쪽은 0 이 아니라 미확인이다. 요청이 지나간 길에 응답이 하나도
  // 안 돌아오는 일은 없고, 얼마가 돌아오는지는 수요가 returnPath 를 적어야 알 수 있다.
  assert.equal(oneWay.directions.reverse.axes.forwarding_bps.status, 'unknown');
  assert.equal(oneWay.directions.reverse.axes.forwarding_bps.unknownReason, 'return-not-modelled');
  assert.equal(oneWay.bindingDirection, 'forward');
});

test('judges an asymmetric link on the direction that is short', () => {
  const topology = cloneTopology();
  // 상행이 좁은 회선. 합산 모델에서는 드러나지 않는 상태다.
  topology.links.find(({ id }) => id === 'leaf-a-api-a').capacityByDirection = { reverse: { forwarding_bps: 4e9 } };
  const link = calculateScenario(topology).links.find(({ id }) => id === 'leaf-a-api-a');
  assert.equal(link.directions.forward.axes.forwarding_bps.status, 'healthy');
  assert.equal(link.directions.reverse.axes.forwarding_bps.status, 'overloaded');
  assert.equal(round4(link.directions.reverse.axes.forwarding_bps.utilization), 1.25);
  assert.equal(link.primaryStatus, 'overloaded');
  assert.equal(link.bindingDirection, 'reverse');
});

test('reports a discontiguous path as invalid without refusing the file', () => {
  const topology = cloneTopology();
  // 링크 순서를 뒤집어 hop 이 어긋나게 만든다.
  const path = topology.demands[0].paths[0];
  path.links = [path.links[1], path.links[0], ...path.links.slice(2)];
  const demand = calculateScenario(topology).demands.find(({ id }) => id === 'public-api');
  assert.equal(demand.validity, 'invalid');
  assert.deepEqual(demand.invalidPaths.map(({ id, reason }) => [id, reason]), [['public-a', 'hop-endpoint-mismatch']]);
  assert.equal(demand.status, 'delivered', 'the remaining path still carries the demand');
  assert.equal(demand.paths.length, 1);
  assert.throws(() => calculateScenario(topology, { strictPaths: true }), /not contiguous/);
});

test('produces the same result every time', () => {
  const topology = cloneTopology();
  const first = JSON.stringify(calculateScenario(topology, { disabledDevices: ['fw-a'] }));
  for (let run = 0; run < 20; run += 1) {
    assert.equal(JSON.stringify(calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] })), first);
  }
});

test('keeps session axes off links', () => {
  const link = calculateScenario(cloneTopology()).links.find(({ id }) => id === 'edge-a-fw-a');
  // demand 는 세션 축을 나르지만 링크는 세션 테이블을 들지 않는다. 판정도 못 하면서
  // 부하만 쌓아 두면 목록이 더러워진다.
  assert.deepEqual(Object.keys(link.directions.forward.load).sort(), ['forwarding_bps', 'forwarding_pps', 'nic_bps', 'nic_pps']);
  assert.equal(deliveryRoleOf('new_sessions_per_sec'), 'admission');
  assert.equal(deliveryRoleOf('forwarding_bps'), 'throughput');
});

test('drops traffic at the choke point instead of reporting it delivered', () => {
  const scenario = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] });
  const demand = scenario.demands.find(({ id }) => id === 'public-api');
  // leaf-b-api-b 가 forward 방향으로 122%. 1/1.22 = 0.8197.
  assert.equal(round4(demand.deliveredRatio), 0.8197);
  assert.deepEqual(demand.paths[0].choke, { resourceId: 'leaf-b-api-b', direction: 'forward' });
  assert.equal(Math.round(demand.droppedLoad.forwarding_bps), 1298360656);
});

test('refuses new sessions without throttling the flows already up', () => {
  const scenario = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] });
  const demand = scenario.demands.find(({ id }) => id === 'public-api');
  const firewall = scenario.devices.find(({ id }) => id === 'fw-b');
  assert.equal(round4(firewall.axes.new_sessions_per_sec.utilization), 1.7143);
  // 세션 테이블이 71% 넘쳐도 전달률은 처리량 병목만 반영한다. 살아 있는 플로우는 계속 흐른다.
  assert.equal(round4(demand.deliveredRatio), 0.8197);
  assert.equal(Math.round(demand.sessionAdmission.refusedPerSec), 30000);
  assert.equal(demand.sessionAdmission.limitedBy.resourceId, 'fw-b');
  assert.equal(round4(demand.sessionAdmission.ratio), 0.5833);
});

test('marks a delivery ratio as an upper bound while a limit is unknown', () => {
  const healthy = calculateScenario(cloneTopology()).demands.find(({ id }) => id === 'public-api');
  assert.equal(healthy.deliveredRatio, 1);
  // api-a 와 api-b 의 nic_pps 가 null 이다. 모르는 한계를 통과로 치지 않는다.
  assert.equal(healthy.deliveredRatioBound, 'upper');
  assert.deepEqual(healthy.unknownConstraints.map(({ resourceId, axis }) => `${resourceId}/${axis}`).sort(),
    ['api-a/nic_pps', 'api-b/nic_pps']);

  const filled = cloneTopology();
  for (const id of ['api-a', 'api-b']) filled.devices.find((device) => device.id === id).limits.nic_pps = 4e6;
  const exact = calculateScenario(filled).demands.find(({ id }) => id === 'public-api');
  assert.equal(exact.deliveredRatioBound, 'exact');
  assert.equal(exact.unknownConstraints, undefined);
});

test('sheds response bytes at a DSR balancer but keeps its session load', () => {
  const build = (mode) => {
    const topology = createEmptyTopology();
    addDevice(topology, { id: 'client', kind: 'router', limits: { forwarding_bps: 100e9 } });
    addDevice(topology, { id: 'lb', kind: 'lb', behavior: { mode },
      limits: { forwarding_bps: 10e9, new_sessions_per_sec: 100e3, concurrent_sessions: 4e6 } });
    addDevice(topology, { id: 'app', kind: 'server', limits: { nic_bps: 100e9 } });
    addLink(topology, { source: 'client', target: 'lb', capacityBps: 100e9 });
    addLink(topology, { source: 'lb', target: 'app', capacityBps: 100e9 });
    addDemand(topology, { id: 'web', source: 'client', target: 'app',
      load: { forwarding_bps: 9.2e9, new_sessions_per_sec: 41e3, concurrent_sessions: 900e3 } });
    return calculateScenario(topology).devices.find(({ id }) => id === 'lb');
  };
  const inline = build('inline');
  const dsr = build('dsr');

  // 응답이 바이트의 90% 다. inline 은 전부 지나고 DSR 은 요청분만 지난다.
  assert.equal(round4(inline.axes.forwarding_bps.utilization), 0.92);
  assert.equal(round4(dsr.axes.forwarding_bps.utilization), 0.092);
  // 세션은 방향이 없다. 연결 추적 부담은 그대로 남는다.
  assert.equal(dsr.axes.new_sessions_per_sec.load, inline.axes.new_sessions_per_sec.load);
  assert.equal(dsr.axes.concurrent_sessions.load, inline.axes.concurrent_sessions.load);
  // 그래서 제한 축이 처리량에서 신규 세션으로 넘어간다.
  assert.equal(inline.bindingAxis, 'forwarding_bps');
  assert.equal(dsr.bindingAxis, 'new_sessions_per_sec');
});

test('leaves link load alone when a balancer runs DSR', () => {
  const build = (mode) => {
    const topology = createEmptyTopology();
    addDevice(topology, { id: 'client', kind: 'router', limits: { forwarding_bps: 100e9 } });
    addDevice(topology, { id: 'lb', kind: 'lb', behavior: { mode }, limits: { forwarding_bps: 10e9 } });
    addDevice(topology, { id: 'app', kind: 'server', limits: { nic_bps: 100e9 } });
    addLink(topology, { source: 'client', target: 'lb', capacityBps: 100e9 });
    addLink(topology, { source: 'lb', target: 'app', capacityBps: 100e9 });
    addDemand(topology, { id: 'web', source: 'client', target: 'app', load: { forwarding_bps: 9.2e9 } });
    return calculateScenario(topology).links.find(({ id }) => id === 'client-lb').axes.forwarding_bps.load;
  };
  // 동작 모드는 장비에서만 응답분을 뺀다. 링크까지 옮기려면 수요가 returnPath 로 되돌아오는 홉을 적어야 한다.
  assert.equal(build('dsr'), build('inline'));
});

test('refuses a mode the class does not have', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'sw', kind: 'switch', limits: { forwarding_bps: 1e9 } });
  assert.equal(topology.devices[0].behavior, undefined, 'a switch has no placement mode');
  assert.throws(() => addDevice(topology, { id: 'lb', kind: 'lb', behavior: { mode: 'transparent' } }), /does not support mode/);
  addDevice(topology, { id: 'fw', kind: 'firewall', limits: { forwarding_bps: 1e9 } });
  assert.deepEqual(topology.devices[1].behavior, { mode: 'routed', sessionSync: 'unknown' });
});

test('states that a firewall placement mode does not change byte load', () => {
  const build = (mode) => {
    const topology = createEmptyTopology();
    addDevice(topology, { id: 'a', kind: 'router', limits: { forwarding_bps: 100e9 } });
    addDevice(topology, { id: 'fw', kind: 'firewall', behavior: { mode }, limits: { forwarding_bps: 10e9 } });
    addDevice(topology, { id: 'b', kind: 'server', limits: { nic_bps: 100e9 } });
    addLink(topology, { source: 'a', target: 'fw', capacityBps: 100e9 });
    addLink(topology, { source: 'fw', target: 'b', capacityBps: 100e9 });
    addDemand(topology, { id: 'd', source: 'a', target: 'b', load: { forwarding_bps: 5e9 } });
    return calculateScenario(topology).devices.find(({ id }) => id === 'fw').axes.forwarding_bps.load;
  };
  assert.equal(build('routed'), build('transparent'));
});

test('splits failover into a synchronised and a cold branch', () => {
  const fault = { disabledDevices: ['fw-a'] };
  const cps = (options) => calculateScenario(cloneTopology(), { ...fault, ...options })
    .devices.find(({ id }) => id === 'fw-b').axes.new_sessions_per_sec;

  // 선언된 구성은 세션 동기화. 대기 장비가 세션을 이어받으므로 폭증이 없다.
  const synced = cps({});
  assert.equal(Math.round(synced.load), 72000);
  assert.equal(round4(synced.utilization), 1.7143);
  assert.equal(synced.contributions, undefined);

  // 세션이 소실되면 인계받은 40만 세션을 30초에 걸쳐 다시 맺는다.
  const cold = cps({ sessionSync: 'none' });
  assert.equal(Math.round(cold.load), 85333);
  assert.equal(round4(cold.utilization), 2.0317);
  assert.equal(Math.round(cold.contributions.steady), 72000);
  assert.equal(Math.round(cold.contributions.failoverSurge), 13333);

  // 창이 짧을수록 폭증이 크다.
  assert.equal(Math.round(cps({ sessionSync: 'none', reestablishWindowSec: 10 }).load), 112000);
});

test('reports an unknown surge instead of assuming none', () => {
  const topology = cloneTopology();
  delete topology.haGroups.find(({ id }) => id === 'fw-pair').reestablishWindowSec;
  const axis = calculateScenario(topology, { disabledDevices: ['fw-a'], sessionSync: 'none' })
    .devices.find(({ id }) => id === 'fw-b').axes.new_sessions_per_sec;
  // 재수립 창을 모르면 폭증량을 지어내지 않는다. 0 으로 치면 안전하다고 거짓말하게 된다.
  assert.equal(axis.status, 'unknown');
  assert.equal(axis.unknownReason, 'failover-surge-window-missing');
  assert.equal(axis.utilization, null);
});

test('reports an unknown surge when the demand never says how many sessions it holds', () => {
  const topology = cloneTopology();
  // 동시 세션을 적지 않은 demand. 예전에는 폭증량이 조용히 0 이 되어 생존 장비가 정상으로 보였다.
  for (const demand of topology.demands) delete demand.load.concurrent_sessions;
  const result = calculateScenario(topology, { disabledDevices: ['fw-a'], sessionSync: 'none' });
  const axis = result.devices.find(({ id }) => id === 'fw-b').axes.new_sessions_per_sec;
  assert.equal(axis.status, 'unknown');
  assert.equal(axis.unknownReason, 'failover-surge-sessions-missing');
  assert.equal(axis.utilization, null);
  const transfer = result.failover.transfers.find(({ failedId }) => failedId === 'fw-a');
  assert.equal(transfer.status, 'unknown');
  assert.equal(transfer.reason, 'concurrent-sessions-missing');
  assert.equal(transfer.transferred, null);
});

test('treats a declared zero as a known zero and a bypassed device as no transfer', () => {
  const topology = cloneTopology();
  for (const demand of topology.demands) demand.load.concurrent_sessions = 0;
  const zero = calculateScenario(topology, { disabledDevices: ['fw-a'], sessionSync: 'none' });
  // 0 이라고 적었으면 옮겨갈 것이 없다고 사용자가 말한 것이다. 미확인이 아니다.
  assert.equal(zero.devices.find(({ id }) => id === 'fw-b').axes.new_sessions_per_sec.status !== 'unknown', true);
  assert.equal(zero.failover.transfers.length, 0);
});

test('orders the axes a growing workload breaks, without re-running the scenario', () => {
  // 이분 탐색을 지우고 닫힌 계산으로 바꾼 근거다. 부하가 배율에 선형이므로 축이 한계를 넘는
  // 배율은 scale ÷ 사용률이고, 그 값이 예전 탐색과 같은 답을 낸다.
  const overloadedAt = (topology, fault, scale) => calculateScenario(topology, { ...fault, scale }).summary.overloadedCount > 0;
  const bisect = (topology, fault, scale) => {
    if (overloadedAt(topology, fault, scale)) return null;
    let low = scale;
    let high = scale;
    for (let step = 0; step < 6 && !overloadedAt(topology, fault, high); step += 1) high = high === 0 ? 0.25 : high * 2;
    if (!overloadedAt(topology, fault, high)) return null;
    for (let step = 0; step < 24 && high - low > 1e-6; step += 1) {
      const mid = (low + high) / 2;
      if (overloadedAt(topology, fault, mid)) high = mid; else low = mid;
    }
    return high;
  };
  let compared = 0;
  for (const template of templates) {
    const topology = buildTemplate(template.id);
    if (!topology.devices.length) continue;
    // 장애가 없는 설계만 돌리면 사용률이 정확히 1 이 되는 조합이 나오지 않는다.
    const faults = [{}, ...topology.devices.slice(0, 2).map(({ id }) => ({ disabledDevices: [id] })),
      ...topology.links.slice(0, 2).map(({ id }) => ({ disabledLinks: [id] }))];
    for (const fault of faults) for (const scale of [0.7, 1, 1.4]) {
      const result = calculateScenario(topology, { ...fault, scale });
      const ladder = result.summary.growthLadder;
      assert.equal(ladder.model, 'linear-offered-load');
      // 배율 k 를 곱하면 아는 축의 사용률이 정확히 k 배가 된다. 사다리는 그 성질만 쓴다.
      const doubled = calculateScenario(topology, { ...fault, scale: scale * 2 });
      for (const device of result.devices.filter(({ active }) => active)) {
        const after = doubled.devices.find(({ id }) => id === device.id);
        for (const [axis, value] of Object.entries(device.axes)) {
          if (value.utilization == null || value.utilization === 0) continue;
          assert.ok(Math.abs(after.axes[axis].utilization / value.utilization - 2) < 1e-9,
            `${template.id}/${device.id}/${axis} 는 배율에 선형이어야 합니다.`);
        }
      }
      // 한계를 모르는 축은 순서를 지어내지 않는다.
      assert.equal(ladder.rungs.some(({ breachScale }) => !Number.isFinite(breachScale)), false);
      // 화면이 읽는 값은 사다리 첫 칸이다. 초과가 없는 구간에서 그 칸보다 앞서는 칸이 있으면
      // 여유가 0 인 설계를 몇 배 더 견딘다고 말하게 된다.
      const closed = result.summary.overloadedCount > 0 ? null : ladder.rungs[0]?.breachScale ?? null;
      if (closed != null) assert.ok(closed >= scale * (1 - 1e-9), `${template.id} @ ${scale}: 첫 칸 ${closed} 이 현재 배율보다 앞섭니다.`);
      const searched = bisect(topology, fault, scale);
      if (searched == null) assert.equal(closed, null, `${template.id} @ ${scale}`);
      else assert.ok(closed != null && Math.abs(closed - searched) <= 0.011, `${template.id} @ ${scale}: ${closed} vs ${searched}`);
      compared += 1;
    }
  }
  assert.ok(compared >= 200, `템플릿 비교가 ${compared}건뿐입니다.`);
});

test('does not skip a rung that is already sitting on its limit', () => {
  // inline-lb 의 실습 버튼이 만드는 상태다. web-b 의 신규 세션이 정확히 한계에 닿지만
  // 엔진은 EPSILON 여유 때문에 초과로 세지 않는다. 그 칸을 건너뛰면 화면이 여유를 지어낸다.
  const topology = buildTemplate('inline-lb');
  const result = calculateScenario(topology, { disabledDevices: ['web-a'], scale: 1 });
  assert.equal(result.devices.find(({ id }) => id === 'web-b').axes.new_sessions_per_sec.utilization, 1);
  assert.equal(result.summary.overloadedCount, 0);
  assert.equal(result.summary.growthLadder.rungs[0].breachScale, 1);
  assert.equal(result.summary.growthLadder.rungs[0].resourceId, 'web-b');
});

test('says the surge reason the same way whatever order the faults were switched on', () => {
  const topology = cloneTopology();
  delete topology.haGroups.find(({ id }) => id === 'fw-pair').reestablishWindowSec;
  const reasons = (order) => {
    const result = calculateScenario(topology, { disabledDevices: new Set(order), sessionSync: 'none' });
    return JSON.stringify({
      axes: result.devices.map(({ id, axes }) => [id, axes.new_sessions_per_sec?.unknownReason ?? null]),
      transfers: result.failover.transfers.map(({ demandId, failedId, reason }) => [demandId, failedId, reason ?? null]),
    });
  };
  assert.equal(reasons(['spine-a', 'fw-a']), reasons(['fw-a', 'spine-a']),
    '같은 장애 집합은 켠 순서와 무관하게 같은 결과를 내야 합니다.');
});

test('says it cannot extrapolate at a zero workload instead of showing an empty ladder', () => {
  const ladder = calculateScenario(cloneTopology(), { scale: 0 }).summary.growthLadder;
  assert.equal(ladder.indeterminate, true);
  assert.equal(ladder.rungs.length, 0);
  assert.equal(calculateScenario(cloneTopology(), { scale: 1 }).summary.growthLadder.indeterminate, false);
});

test('leaves a healthy scenario untouched whatever the sync policy says', () => {
  const declared = calculateScenario(cloneTopology());
  const cold = calculateScenario(cloneTopology(), { sessionSync: 'none' });
  assert.equal(JSON.stringify(declared.devices), JSON.stringify(cold.devices));
  assert.deepEqual(declared.failover.transfers, []);
});

test('each template puts a different axis at the limit', () => {
  const bindings = Object.fromEntries(templates.filter(({ id }) => id !== 'blank').map((template) => {
    const scenario = calculateScenario(template.build());
    return [template.id, [scenario.summary.bindingResourceId, scenario.summary.bindingAxis]];
  }));
  assert.deepEqual(bindings['inline-lb'], ['lb', 'forwarding_bps']);
  // 같은 토폴로지인데 모드만 다르다. 그래서 제한 축이 다르다.
  assert.deepEqual(bindings['dsr-farm'], ['lb', 'tls_resumed_handshakes_per_sec']);
  assert.deepEqual(bindings['security-chain'], ['waf', 'tls_full_handshakes_per_sec']);
  assert.deepEqual(bindings.iot, ['gw-a', 'forwarding_pps']);
  assert.deepEqual(bindings.vdi, ['gw', 'concurrent_sessions']);
  assert.deepEqual(bindings.backup, ['nas', 'nic_bps']);

  // 축이 한쪽으로 몰리면 템플릿 모음이 가르치는 게 없다.
  const axes = new Set(Object.values(bindings).map(([, axis]) => axis));
  assert.ok(axes.size >= 6, `templates must bottleneck on different axes, got ${[...axes].join(', ')}`);
  assert.ok(Object.keys(bindings).length >= 16, 'the picker needs enough architectures to be worth searching');
});

test('switching the demo balancer to DSR moves its limit off throughput', () => {
  const topology = buildTemplate('inline-lb');
  const inline = calculateScenario(topology).devices.find(({ id }) => id === 'lb');
  topology.devices.find(({ id }) => id === 'lb').behavior.mode = 'dsr';
  const dsr = calculateScenario(topology).devices.find(({ id }) => id === 'lb');

  assert.equal(round4(inline.axes.forwarding_bps.utilization), 0.9412);
  assert.equal(round4(dsr.axes.forwarding_bps.utilization), 0.0941);
  assert.equal(inline.bindingAxis, 'forwarding_bps');
  assert.equal(dsr.bindingAxis, 'tls_resumed_handshakes_per_sec');
  // 연결 추적 부담은 그대로다.
  assert.equal(dsr.axes.concurrent_sessions.load, inline.axes.concurrent_sessions.load);
  assert.equal(dsr.axes.tls_full_handshakes_per_sec.load, inline.axes.tls_full_handshakes_per_sec.load);
});

test('the single-fault sweep separates a severed design from an overloaded one', () => {
  const dual = sweepSingleFaults(cloneTopology());
  const findOne = (sweep, id) => sweep.resources.find((resource) => resource.id === id);
  // 방화벽이 두 대라 하나가 죽어도 끊기지 않는다. 남은 쪽이 못 견딜 뿐이다.
  assert.equal(findOne(dual, 'fw-a').verdict, 'overloads');
  assert.ok(findOne(dual, 'fw-a').worstUtilization > 1);
  const worstAxis = dual.worstAxes.find(({ resourceId, axis }) => resourceId === 'fw-b' && axis === 'new_sessions_per_sec');
  assert.equal(worstAxis.faultId, 'edge-a');
  assert.ok(worstAxis.utilization > 1);
  // 두 demand 가 모두 지나는 리프는 진짜 단일 장애점이다.
  assert.equal(findOne(dual, 'leaf-a').verdict, 'severs');
  assert.equal(dual.grade, 'single-point');

  // 로드밸런서가 한 대뿐인 설계는 그 한 대가 끊는다.
  const single = sweepSingleFaults(buildTemplate('dsr-farm'));
  assert.equal(findOne(single, 'lb').verdict, 'severs');
  assert.equal(findOne(single, 'lb').endpoint, false);
});

test('incremental sweep tasks preserve the completed synchronous results', () => {
  const topology = cloneTopology();
  const singleTask = createSingleFaultSweepTask(topology);
  assert.equal(singleTask.done, false);
  while (!singleTask.done) singleTask.step(1);
  const sweep = singleTask.result;
  assert.deepEqual(sweep, sweepSingleFaults(topology));

  const survivalTask = createSurvivalMultiplierTask(topology, { sweep });
  while (!survivalTask.done) survivalTask.step(1);
  assert.deepEqual(survivalTask.result, calculateSurvivalMultiplier(topology, { sweep }));

  const domainTask = createFailureDomainSweepTask(topology, { sweep });
  while (!domainTask.done) domainTask.step(1);
  assert.deepEqual(domainTask.result, sweepFailureDomains(topology, { sweep }));
});

test('calculates survival by multiplier, keeps severance distinct, and excludes endpoints', () => {
  const topology = cloneTopology();
  const survival = calculateSurvivalMultiplier(topology);
  assert.equal(survival.multiplier, 0);
  assert.deepEqual(survival.worstFault, { id: 'leaf-a', type: 'device', verdict: 'severs' });
  assert.equal(survival.status, 'severed');
  assert.ok(survival.endpointIds.includes('api-a'));
  assert.equal(survival.candidates, sweepSingleFaults(topology).resources.filter(({ type, id }) => !(type === 'device' && survival.endpointIds.includes(id))).length);

  const noService = cloneTopology();
  delete noService.services;
  const endpointOnly = calculateSurvivalMultiplier(noService);
  assert.notEqual(endpointOnly.worstFault?.id, 'api-a');
});

test('uses the failed scenario growth ladder and deterministic id tie-break for survival', () => {
  const topology = buildTemplate('dual-stack');
  const survival = calculateSurvivalMultiplier(topology);
  const scenario = calculateScenario(topology, { disabledDevices: [survival.worstFault.id] });
  const expected = scenario.summary.growthLadder.rungs[0].breachScale;
  assert.equal(survival.multiplier, expected);
  assert.equal(JSON.stringify(calculateSurvivalMultiplier(topology)), JSON.stringify(survival));
});

test('reports declared service acceptance for the worst single fault', () => {
  const topology = cloneTopology();
  const survival = calculateSurvivalMultiplier(topology);
  const service = survival.services.find(({ id }) => id === 'public-api-service');
  assert.equal(service.status, 'fail');
  assert.equal(service.requiredDeliveryRatio, 0.99);
  assert.ok(Math.min(service.deliveredRatio, service.admissionRatio) < service.requiredDeliveryRatio);
  assert.equal(service.id, 'public-api-service');
});

test('sweeps failure domains and removes duplicate or contained N-2 candidates', () => {
  const topology = cloneTopology();
  topology.failureDomains = [
    { id: 'a', name: 'A', kind: 'power', deviceIds: ['fw-a'] },
    { id: 'b', name: 'B', kind: 'space', deviceIds: ['fw-b'] },
    { id: 'ab', name: 'AB', kind: 'firmware', deviceIds: ['fw-a', 'fw-b'] },
  ];
  const sweep = sweepFailureDomains(topology);
  assert.deepEqual(sweep.singles.map(({ id }) => id), ['a', 'ab', 'b']);
  assert.deepEqual(sweep.pairs.map(({ id }) => id), ['a+b']);
  const expected = calculateScenario(topology, { disabledDomains: ['a', 'b'] });
  assert.equal(sweep.pairs[0].verdict, expected.summary.unreachableCount ? 'severs' : expected.summary.overloadedCount ? 'overloads' : 'absorbs');
});

test('marks a shared domain that severs only as a group as redundant in name only', () => {
  const topology = cloneTopology();
  topology.failureDomains = [{ id: 'edge-feed', name: 'EDGE FEED', kind: 'power', deviceIds: ['edge-a', 'edge-b'] }];
  const sweep = sweepFailureDomains(topology);
  assert.deepEqual(sweep.redundancyInvalid.map(({ id, memberIds }) => [id, memberIds]), [['edge-feed', ['edge-a', 'edge-b']]]);
  const individual = sweepSingleFaults(topology);
  for (const id of ['edge-a', 'edge-b']) assert.ok(['absorbs', 'overloads'].includes(individual.resources.find((resource) => resource.id === id).verdict));
});

test('marks a shared domain only when its delivery is at least five percentage points below every member alone', () => {
  const topologyFor = (remainingLimit) => ({
    devices: [
      { id: 'source', external: true, kind: 'router', limits: { forwarding_bps: 1e9, forwarding_pps: 1e9 } },
      { id: 'a', kind: 'switch', limits: { forwarding_bps: 200, forwarding_pps: 1e9 } },
      { id: 'b', kind: 'switch', limits: { forwarding_bps: 200, forwarding_pps: 1e9 } },
      { id: 'c', kind: 'switch', limits: { forwarding_bps: remainingLimit, forwarding_pps: 1e9 } },
      { id: 'target', external: true, kind: 'server', limits: { nic_bps: 1e9, nic_pps: 1e9 } },
    ],
    links: [
      { id: 'sa', source: 'source', target: 'a', capacity: { forwarding_bps: 1e9 } }, { id: 'at', source: 'a', target: 'target', capacity: { forwarding_bps: 1e9 } },
      { id: 'sb', source: 'source', target: 'b', capacity: { forwarding_bps: 1e9 } }, { id: 'bt', source: 'b', target: 'target', capacity: { forwarding_bps: 1e9 } },
      { id: 'sc', source: 'source', target: 'c', capacity: { forwarding_bps: 1e9 } }, { id: 'ct', source: 'c', target: 'target', capacity: { forwarding_bps: 1e9 } },
    ],
    demands: [{ id: 'traffic', source: 'source', target: 'target', load: { forwarding_bps: 100, forwarding_pps: 100 }, paths: [
      { id: 'a-path', devices: ['source', 'a', 'target'], links: ['sa', 'at'] }, { id: 'b-path', devices: ['source', 'b', 'target'], links: ['sb', 'bt'] }, { id: 'c-path', devices: ['source', 'c', 'target'], links: ['sc', 'ct'] },
    ] }],
    failureDomains: [{ id: 'shared-feed', name: 'SHARED FEED', kind: 'power', deviceIds: ['a', 'b'] }],
  });
  const [invalid] = sweepFailureDomains(topologyFor(95)).redundancyInvalid;
  assert.equal(invalid?.id, 'shared-feed');
  assert.equal(invalid?.reason, 'delivery-drop');
  assert.equal(invalid?.individualWorstDeliveredRatio, 1);
  assert.equal(invalid?.minDeliveredRatio, 0.95);
  assert.ok(Math.abs((invalid?.deliveryDrop ?? 0) - 0.05) < 1e-12);
  assert.equal(sweepFailureDomains(topologyFor(96)).redundancyInvalid.length, 0);
});

test('counts an injected failure domain as an active fault', () => {
  const topology = cloneTopology();
  const scenario = calculateScenario(topology, { disabledDomains: ['rack-04'] });
  assert.equal(scenario.summary.activeFaults, 1);
});

test('the sweep ignores injected faults and stays deterministic', () => {
  const topology = cloneTopology();
  const clean = sweepSingleFaults(topology);
  // 이미 주입된 장애 위에 얹으면 이중 장애가 된다. 스윕은 설계의 성질이지 현재 상태가 아니다.
  const withFault = sweepSingleFaults(topology, { disabledDevices: ['fw-a'], disabledLinks: ['leaf-a-api-a'] });
  assert.deepEqual(withFault, clean);
  assert.equal(JSON.stringify(sweepSingleFaults(topology)), JSON.stringify(clean));
});

test('exports the complete single-fault sweep and its single-point list', () => {
  const topology = cloneTopology();
  const scenario = calculateScenario(topology);
  const sweep = sweepSingleFaults(topology);
  const survivalMultiplier = calculateSurvivalMultiplier(topology, { sweep });
  const domainSweep = sweepFailureDomains(topology, { sweep });
  const exported = createExport(topology, scenario, scenario, { sweep, survivalMultiplier, domainSweep });
  assert.deepEqual(exported.failureSweep.singlePointIds, sweep.resources
    .filter(({ verdict, endpoint }) => verdict === 'severs' && !endpoint).map(({ id }) => id));
  assert.deepEqual(exported.failureSweep.summary, {
    severs: sweep.severs, overloads: sweep.overloads, absorbs: sweep.absorbs, bounded: sweep.bounded, endpoints: sweep.endpoints,
  });
  topology.observedLoad = { asOf: '2026-09-09T03:00:00Z', aggregate: 'p95', fingerprint: { deviceIds: [], linkIds: [] }, devices: {}, links: {} };
  assert.deepEqual(createExport(topology, scenario, scenario).observedLoad, topology.observedLoad);
  assert.deepEqual(exported.failureSweep.resources, sweep.resources.map(({ id, type, verdict, bounded, endpoint, minDeliveredRatio, worstResourceId, worstAxis, worstUtilization }) => ({
    id, type, verdict, bounded, endpoint, minDeliveredRatio, worstResourceId, worstAxis, worstUtilization,
  })));
  assert.deepEqual(exported.scenario.survivalMultiplier, survivalMultiplier);
  assert.deepEqual(exported.domainSweep, {
    evaluated: domainSweep.evaluated, domainCount: domainSweep.domainCount,
    singles: domainSweep.singles.map(({ id, name, kind, domainIds, resources, verdict, bounded, evaluationStatus, unreachableCount, minDeliveredRatio, worstResourceId, worstAxis, worstUtilization }) => ({ id, name, kind, domainIds, resources, verdict, bounded, evaluationStatus, unreachableCount, minDeliveredRatio, worstResourceId, worstAxis, worstUtilization })),
    pairs: domainSweep.pairs.map(({ id, name, domainIds, resources, verdict, bounded, evaluationStatus, unreachableCount, minDeliveredRatio, worstResourceId, worstAxis, worstUtilization }) => ({ id, name, domainIds, resources, verdict, bounded, evaluationStatus, unreachableCount, minDeliveredRatio, worstResourceId, worstAxis, worstUtilization })),
    redundancyInvalid: domainSweep.redundancyInvalid.map(({ id, name, kind, memberIds, verdict, bounded, minDeliveredRatio }) => ({ id, name, kind, memberIds, verdict, bounded, minDeliveredRatio })),
  });
});

test('the sweep counts demand endpoints apart and never calls an unknown design safe', () => {
  const topology = cloneTopology();
  // 기본 데모는 이제 서비스 기준을 가져 endpoint 손실도 서비스 실패로 평가한다. 이 테스트는
  // 서비스 기준이 없을 때 endpoint를 SPOF 집계에서 분리하는 기존 계약만 고정한다.
  delete topology.services;
  const sweep = sweepSingleFaults(topology);
  // api-a 는 east-west 의 출발지다. 끄면 끊기지만 그건 이중화 문제가 아니다.
  const endpoint = sweep.resources.find((resource) => resource.id === 'api-a');
  assert.equal(endpoint.endpoint, true);
  assert.equal(endpoint.verdict, 'severs');
  assert.equal(sweep.resources.filter(({ verdict, endpoint: end }) => verdict === 'severs' && !end).length, sweep.severs);

  // 한계를 모르는 축이 남아 있으면 '견딤'은 상한이다.
  const spine = sweep.resources.find((resource) => resource.id === 'spine-a');
  assert.equal(spine.verdict, 'overloads');
  const blank = sweepSingleFaults(buildTemplate('blank'));
  assert.deepEqual([blank.grade, blank.resources.length], ['unknown', 0]);
});

test('the paired templates differ only after one device dies', () => {
  const single = calculateScenario(buildTemplate('single-stack'));
  const dual = calculateScenario(buildTemplate('dual-stack'));
  // 같은 부하를 같은 총용량으로 받으므로 무장애 상태는 구분되지 않는다.
  assert.equal(Math.round(single.summary.minHeadroom * 100), Math.round(dual.summary.minHeadroom * 100));

  const singleSweep = sweepSingleFaults(buildTemplate('single-stack'));
  const dualSweep = sweepSingleFaults(buildTemplate('dual-stack'));
  assert.equal(singleSweep.resources.find(({ id }) => id === 'fw').verdict, 'severs');
  assert.equal(dualSweep.resources.find(({ id }) => id === 'fw-a').verdict, 'overloads');
  assert.deepEqual([singleSweep.grade, dualSweep.grade], ['single-point', 'partial']);

  // 이중화해도 용량이 따라오지 않는다는 것이 이 쌍의 요점이다.
  const survivor = calculateScenario(buildTemplate('dual-stack'), { disabledDevices: ['fw-a'] })
    .devices.find(({ id }) => id === 'fw-b');
  assert.equal(Math.round(survivor.axes.forwarding_bps.utilization * 100), 150);
  // 세션 동기화가 없으므로 재수립 폭증이 신규 세션에 얹힌다.
  assert.ok(survivor.axes.new_sessions_per_sec.utilization > 1.7);
  assert.ok(survivor.axes.new_sessions_per_sec.contributions.failoverSurge > 0);
});

test('a link whose endpoint died is severed, not idle', () => {
  const result = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] });
  const severed = (id) => result.links.find((link) => link.id === id).severed;
  // fw-a 에 붙은 두 링크는 켜져 있지만 트래픽이 흐를 수 없다.
  assert.deepEqual([severed('edge-a-fw-a'), severed('fw-a-spine-a')], [true, true]);
  assert.equal(result.links.find(({ id }) => id === 'edge-a-fw-a').active, true, 'the link itself was never turned off');
  // 같은 팹릭의 다른 링크는 멀쩡하다.
  assert.equal(severed('spine-a-leaf-a'), false);

  const clean = calculateScenario(cloneTopology());
  assert.ok(clean.links.every(({ severed: cut }) => cut === false), 'nothing is severed without a fault');
  const cutLink = calculateScenario(cloneTopology(), { disabledLinks: ['spine-a-leaf-a'] });
  assert.equal(cutLink.links.find(({ id }) => id === 'spine-a-leaf-a').severed, true);
});

test('an unreachable demand keeps the path it would have taken', () => {
  // 단일 경로 설계에서 중간 장비를 끄면 그 demand 는 갈 곳이 없다.
  const single = buildTemplate('single-stack');
  const result = calculateScenario(single, { disabledDevices: ['fw'] });
  const demand = result.demands.find(({ id }) => id === 'web-a-traffic');
  assert.equal(demand.status, 'unreachable');
  assert.equal(demand.paths.length, 0, 'nothing carries it now');
  // LB 가 두 웹 서버로 나눠 보내므로 무장애 경로는 백엔드마다 하나씩 두 개다. 둘 다 fw 를 지난다.
  assert.equal(demand.severedPaths.length, 2, 'but the design has the paths it used to take');
  assert.ok(demand.severedPaths.every(({ devices }) => devices.includes('fw')));
  assert.deepEqual(demand.severedPaths.map(({ devices }) => devices.at(-1)).sort(), ['web-a', 'web-b']);
  assert.ok(demand.severedPaths.every(({ links }) => links.length > 0), 'the canvas needs the links to draw the break');

  // 장애가 없으면 무장애 경로를 다시 풀지 않는다.
  assert.ok(calculateScenario(single).demands.every(({ severedPaths }) => severedPaths === undefined));
  // 끊기지 않은 demand 에는 붙지 않는다.
  assert.equal(calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] })
    .demands.find(({ id }) => id === 'public-api').severedPaths, undefined);
});

test('every catalog profile states axes the engine knows and numbers a datasheet could print', async () => {
  const { catalogFor, deviceCatalog } = await import('../public/devices/catalog.js');
  const { axisCatalog } = await import('../public/data.js');
  assert.ok(deviceCatalog.length >= 26, 'the catalog covers more than one manufacturer and more than one class');
  for (const kind of ['firewall', 'switch', 'router', 'lb', 'waf', 'server', 'nas', 'storage']) {
    assert.ok(catalogFor(kind).length > 0, `${kind} needs at least one catalog entry`);
  }
  const ids = new Set();
  for (const entry of deviceCatalog) {
    assert.equal(ids.has(entry.id), false, `${entry.id} is listed twice`);
    ids.add(entry.id);
    assert.ok(entry.vendor && entry.model && (entry.kind || entry.kinds?.length), `${entry.id} needs a vendor, model and class`);
    // 출처 없는 값은 등록하지 않는다(PRD 8절). 어느 문서의 어느 표인지까지 남긴다.
    for (const field of ['type', 'label', 'url', 'locator', 'retrievedAt', 'note']) {
      assert.ok(entry.source[field], `${entry.id} source is missing ${field}`);
    }
    assert.equal(entry.source.type, 'datasheet');
    // 조건이 하나뿐인 표도 있다. FortiWeb 은 처리량과 지연만 싣는다. 없는 조건을 지어내지 않는다.
    assert.ok(entry.profiles.length >= 1, `${entry.id} needs at least one measurement condition`);
    for (const profile of entry.profiles) {
      assert.ok(profile.label && profile.note, `${entry.id}/${profile.id} needs a label and a condition note`);
      const axes = Object.keys(profile.limits);
      assert.ok(axes.length > 0);
      for (const [axis, value] of Object.entries(profile.limits)) {
        assert.ok(axisCatalog[axis], `${entry.id}/${profile.id} states an axis the engine does not know: ${axis}`);
        assert.ok(value === null || (Number.isFinite(value) && value > 0), `${entry.id}/${profile.id}/${axis} must be a positive number or null`);
      }
    }
  }

  // 같은 하드웨어라도 무엇을 검사하느냐가 한계를 정한다. 이 대비가 카탈로그의 요점이다.
  const cisco = deviceCatalog.find(({ id }) => id === 'cisco-secure-firewall-3140');
  const inspecting = cisco.profiles.find(({ id }) => id === 'ftd-avc').limits.new_sessions_per_sec;
  const stateful = cisco.profiles.find(({ id }) => id === 'asa-stateful').limits.new_sessions_per_sec;
  assert.ok(stateful > inspecting * 3, 'stateful inspection admits far more new connections than full application visibility');
});

test('a switch datasheet mixes two bases, and the profile says so', async () => {
  const { catalogEntry } = await import('../public/devices/catalog.js');
  const entry = catalogEntry('cisco-catalyst-9300-48t');
  const standalone = entry.profiles.find(({ id }) => id === 'standalone');
  // 128 Gbps 단방향을 64바이트 프레임(프리앰블·IFG 포함 672비트)으로 나누면 190.5 Mpps 다.
  // 즉 용량은 양방향 합계이고 레이트는 단방향이다. 그 사실이 note 에 적혀 있어야 한다.
  const oneWayFrames = (standalone.limits.forwarding_bps / 2) / 672;
  assert.ok(Math.abs(oneWayFrames - standalone.limits.forwarding_pps) / standalone.limits.forwarding_pps < 0.01,
    'the forwarding rate matches half the switching capacity at 64 bytes, so the two numbers use different bases');
  assert.match(standalone.note, /양방향 합계|단방향/);
});

test('a router datasheet turns features and packet size together', async () => {
  const { catalogEntry } = await import('../public/devices/catalog.js');
  const entry = catalogEntry('cisco-catalyst-8300-2n2s-4t2x');
  const plain = entry.profiles.find(({ id }) => id === 'ipv4-1400b').limits.forwarding_bps;
  const loaded = entry.profiles.find(({ id }) => id === 'sdwan-iqdf-imix').limits.forwarding_bps;
  assert.ok(plain > loaded * 3, 'encryption, inspection and a smaller packet size together cost more than a third of the throughput');
  // 이 표는 pps 를 적지 않는다. 없는 것을 지어내지 않는다.
  assert.ok(entry.profiles.every(({ limits }) => limits.forwarding_pps === null));
});

test('an adapter derives its packet rate from line rate and says so', async () => {
  const { catalogEntry, catalogFor } = await import('../public/devices/catalog.js');
  // 서버 스펙 시트는 NIC 처리량을 적지 않는다. 한계를 정하는 것은 꽂은 카드다.
  assert.ok(catalogFor('server').length > 0 && catalogFor('vm').length > 0, 'an adapter fits every endpoint class');
  const nic = catalogEntry('intel-e810-cqda2');
  const one = nic.profiles.find(({ id }) => id === 'single').limits;
  assert.equal(one.nic_bps, 100e9);
  // PRD 9절: 10 Gbps 에 64바이트 프레임이면 약 14.88 Mpps. 100 Gbps 는 그 열 배다.
  assert.ok(Math.abs(one.nic_pps - 148_809_524) < 2000, `line rate at 64 bytes, got ${one.nic_pps}`);
  assert.match(nic.profiles[0].note, /라인레이트에서 파생/, 'a derived number must say it is derived');
  assert.match(nic.source.note, /파생/);
});

test('a storage appliance carries its port count, not its IOPS', async () => {
  const { catalogEntry } = await import('../public/devices/catalog.js');
  const nas = catalogEntry('synology-fs6400');
  const onboard = nas.profiles.find(({ id }) => id === 'onboard').limits;
  // 데이터시트의 외부 포트는 10GbE 2개와 1GbE 2개다.
  assert.equal(onboard.nic_bps, 22e9);
  const withCard = nas.profiles.find(({ id }) => id === 'plus-25gbe').limits;
  assert.equal(withCard.nic_bps, 72e9, 'the optional 25GbE card adds 50 Gbps to the onboard 22');
  // IOPS 를 대역폭으로 바꾸려면 블록 크기와 큐 깊이를 지어내야 한다. 그 축은 여기 없다.
  assert.ok(nas.profiles.every(({ limits }) => Object.keys(limits).every((axis) => axis.startsWith('nic_'))));
});

test('a balancer datasheet changes layer, and the profiles keep that straight', async () => {
  const { catalogEntry } = await import('../public/devices/catalog.js');
  const f5 = catalogEntry('f5-big-ip-i10800');
  const l4 = f5.profiles.find(({ id }) => id === 'l4').limits;
  const l7 = f5.profiles.find(({ id }) => id === 'l7').limits;
  assert.equal(l4.forwarding_bps, 160e9);
  assert.equal(l7.forwarding_bps, 80e9, 'proxying at layer 7 halves the published throughput');
  // 연결 수립과 동시 연결은 L4 기준으로만 실린다. L7 쪽으로 옮겨 적지 않는다.
  assert.equal(l4.new_sessions_per_sec, 1.5e6);
  assert.equal(l7.new_sessions_per_sec, null);
  assert.equal(l7.concurrent_sessions, null);

  // 같은 하드웨어가 RSA 보다 ECDSA 핸드셰이크를 적게 감당한다.
  const rsa = f5.profiles.find(({ id }) => id === 'ssl-rsa').limits.tls_full_handshakes_per_sec;
  const ecc = f5.profiles.find(({ id }) => id === 'ssl-ecc').limits.tls_full_handshakes_per_sec;
  assert.ok(rsa > ecc, `RSA ${rsa} should exceed ECDSA ${ecc} on this platform`);
  // 세션 재개 수치는 어느 프로필에도 없다. 발표되지 않은 값이다.
  assert.ok(f5.profiles.every(({ limits }) => limits.tls_resumed_handshakes_per_sec === null));

  const waf = catalogEntry('fortinet-fortiweb-3000f');
  const only = waf.profiles[0].limits;
  assert.equal(only.forwarding_bps, 10e9);
  assert.ok([only.new_sessions_per_sec, only.concurrent_sessions, only.tls_full_handshakes_per_sec].every((v) => v === null),
    'the FortiWeb table prints throughput and latency only');
});

// LB 뒤 백엔드 풀 — demand 가 서버 한 대를 찍고 있어도 나눠 보내는 쪽은 LB 다.
function dualStackWithReplica(links = ['lb-b']) {
  const topology = buildTemplate('dual-stack');
  addDevice(topology, { id: 'web-c', name: 'WEB 02 복제', kind: 'web', zone: 'RACK 02', position: { x: 800, y: 620 },
    limits: { nic_bps: 8e9, nic_pps: 1.6e6, new_sessions_per_sec: 30e3 } });
  for (const lb of links) addLink(topology, { source: lb, target: 'web-c', capacityBps: 10e9 });
  return topology;
}

const nicLoad = (result, id) => result.devices.find((device) => device.id === id).axes.nic_bps.load;

test('a server attached to a load balancer joins the backend pool and relieves its peers', () => {
  const before = calculateScenario(buildTemplate('dual-stack'));
  assert.equal(nicLoad(before, 'web-a'), 6e9);
  assert.equal(nicLoad(before, 'web-b'), 6e9);

  const after = calculateScenario(dualStackWithReplica(['lb-a', 'lb-b']));
  // 총 12G 는 그대로고 세 대가 나눠 받는다. 장비를 그렸다고 부하가 늘지는 않는다.
  for (const id of ['web-a', 'web-b', 'web-c']) assert.equal(Math.round(nicLoad(after, id)), 4e9);
  assert.equal(after.demands.every(({ deliveredRatio }) => deliveredRatio === 1), true);
});

test('a backend wired to only one load balancer receives only what that path can carry', () => {
  const result = calculateScenario(dualStackWithReplica(['lb-b']));
  // LB A 로 들어온 트래픽은 복제로 갈 길이 없다. 세 대 균등(4G)이 아니라 6분의 1이다.
  assert.equal(Math.round(nicLoad(result, 'web-c')), 2e9);
  assert.equal(Math.round(nicLoad(result, 'web-a')), 5e9);
  assert.equal(Math.round(nicLoad(result, 'web-b')), 5e9);
  const shares = result.demands[0].backends.map(({ id, share }) => [id, Number(share.toFixed(4))]);
  assert.deepEqual(shares, [['web-a', 0.4167], ['web-b', 0.4167], ['web-c', 0.1667]]);
});

test('backendPool single turns the pool off and pins the demand to its declared target', () => {
  const topology = dualStackWithReplica(['lb-a', 'lb-b']);
  for (const demand of topology.demands) demand.backendPool = 'single';
  const result = calculateScenario(topology);
  assert.equal(nicLoad(result, 'web-a'), 6e9);
  assert.equal(nicLoad(result, 'web-b'), 6e9);
  assert.equal(nicLoad(result, 'web-c'), 0);
  assert.deepEqual(result.demands[0].backends, [{ id: 'web-a', share: 1 }]);
});

test('an explicit pool member list overrides the derived one and is validated', () => {
  const topology = dualStackWithReplica(['lb-a', 'lb-b']);
  topology.demands[0].backendPool = { memberIds: ['web-c'] };
  const result = calculateScenario(topology);
  // 첫 demand 는 web-a 와 web-c 로만, 둘째는 자동 판정대로 세 대로 나뉜다.
  assert.deepEqual(result.demands[0].backends.map(({ id }) => id), ['web-a', 'web-c']);
  assert.equal(result.demands[1].backends.length, 3);

  const broken = dualStackWithReplica(['lb-b']);
  broken.demands[0].backendPool = { memberIds: ['missing-device'] };
  assert.ok(calculateScenario(broken).validationIssues.some(({ reason }) => reason === 'backend-pool-member-missing'));
});

test('losing one pool member spreads its share over the survivors instead of dropping traffic', () => {
  const topology = dualStackWithReplica(['lb-a', 'lb-b']);
  const result = calculateScenario(topology, { disabledDevices: ['web-c'] });
  assert.equal(nicLoad(result, 'web-a'), 6e9);
  assert.equal(nicLoad(result, 'web-b'), 6e9);
  assert.equal(result.demands.every(({ status }) => status === 'delivered'), true);
});

test('a device no demand path touches is reported instead of quietly reading zero', () => {
  const topology = buildTemplate('dual-stack');
  addDevice(topology, { id: 'spare', name: 'SPARE', kind: 'web', zone: 'RACK 02', position: { x: 800, y: 620 }, limits: { nic_bps: 8e9 } });
  const orphan = calculateScenario(topology);
  assert.equal(orphan.devices.find(({ id }) => id === 'spare').carriesDemand, false);
  assert.equal(orphan.devices.filter(({ carriesDemand }) => carriesDemand === false).length, 1, 'every other device is on a path');

  addLink(topology, { source: 'lb-b', target: 'spare', capacityBps: 10e9 });
  assert.equal(calculateScenario(topology).devices.every(({ carriesDemand }) => carriesDemand), true);
});

test('ECMP shares split per hop branch, not per enumerated path', () => {
  // 복제를 LB B 에만 달면 목적지별 경로 수가 4:4:2 로 어긋난다. 경로 수로 1/N 을 매기면
  // lb-b 가 6/10 을 지는데, 실제로는 방화벽이 두 LB 로 반씩 보내므로 절반이어야 한다.
  const result = calculateScenario(dualStackWithReplica(['lb-b']));
  const lbA = result.devices.find(({ id }) => id === 'lb-a');
  const lbB = result.devices.find(({ id }) => id === 'lb-b');
  assert.equal(Math.round(lbA.axes.forwarding_bps.load), 6e9);
  assert.equal(Math.round(lbB.axes.forwarding_bps.load), 6e9);
  assert.equal(result.demands[0].paths.reduce((sum, { share }) => sum + share, 0).toFixed(9), '1.000000000');
});

// 응답이 어디로 돌아가는지 적는 자리. 적지 않으면 응답 몫까지 요청 홉에 실리는 오늘 모델 그대로다.
const returnPathFixture = (options = {}) => {
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'client', kind: 'router', limits: { forwarding_bps: 100e9 } });
  addDevice(topology, { id: 'edge', kind: 'router', limits: { forwarding_bps: 100e9 } });
  addDevice(topology, { id: 'lb', kind: 'lb', behavior: { mode: 'dsr' }, limits: { forwarding_bps: 100e9 } });
  addDevice(topology, { id: 'app', kind: 'server', limits: { nic_bps: 100e9 } });
  addLink(topology, { source: 'client', target: 'edge', capacityBps: 100e9 });
  addLink(topology, { source: 'edge', target: 'lb', capacityBps: 100e9 });
  addLink(topology, { source: 'lb', target: 'app', capacityBps: 100e9 });
  addLink(topology, { source: 'app', target: 'edge', capacityBps: 100e9 });
  addDemand(topology, {
    id: 'web', source: 'client', target: 'app', load: { forwarding_bps: 10e9, nic_bps: 10e9 },
    pathMode: 'explicit',
    paths: [{ id: 'request', devices: ['client', 'edge', 'lb', 'app'], links: ['client-edge', 'edge-lb', 'lb-app'] }],
    ...(options.declared === false ? {} : { returnPath: [{ id: 'response', devices: ['app', 'edge', 'client'], links: ['app-edge', 'client-edge'] }] }),
    directionality: { responseShare: 0.9, origin: 'explicit' },
  });
  return topology;
};

// 1 - 0.9 는 이진 부동소수에서 정확히 0.1 이 아니다. 값이 아니라 몫을 확인한다.
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} vs ${expected}`);

test('sends the response share down the return path a demand declares', () => {
  const hop = (result, id, direction) => result.links.find((link) => link.id === id).directions[direction].axes.forwarding_bps.load;
  const plain = calculateScenario(returnPathFixture({ declared: false }));
  const split = calculateScenario(returnPathFixture());
  const state = (result, id, direction) => result.links.find((link) => link.id === id).directions[direction].axes.forwarding_bps.status;
  // 적지 않으면 요청 홉에 전부 실린다. 되돌아오는 길은 0 이 아니라 미확인으로 남는다 -
  // 응답이 어디로 가는지 아무도 적지 않았으므로 그 값은 계산된 적이 없다.
  assert.equal(hop(plain, 'client-edge', 'forward'), 10e9);
  assert.equal(state(plain, 'client-edge', 'reverse'), 'unknown');
  // 아무 수요도 지나지 않는 링크는 다르다. 양쪽 다 비어 있는 것이 사실이므로 0 이 맞다 -
  // 모르는 것과 없는 것을 같은 기호로 그리면 둘 다 못 읽는다.
  assert.equal(state(plain, 'app-edge', 'forward'), 'healthy');
  assert.equal(hop(plain, 'app-edge', 'forward'), 0);
  // 적으면 응답 9할이 되돌아오는 홉으로 옮겨간다. LB 로 가는 링크에는 요청 1할만 남는다.
  near(hop(split, 'client-edge', 'forward'), 1e9, '요청 홉');
  near(hop(split, 'client-edge', 'reverse'), 9e9, '돌아오는 홉');
  near(hop(split, 'edge-lb', 'forward'), 1e9, 'LB 로 가는 홉');
  near(hop(split, 'lb-app', 'forward'), 1e9, 'LB 뒤 홉');
  near(hop(split, 'app-edge', 'forward'), 9e9, '직행 홉');
});

test('keeps the whole load on a device that sits on both legs', () => {
  const axis = (result, id, name) => result.devices.find((device) => device.id === id).axes[name].load;
  const split = calculateScenario(returnPathFixture());
  // 요청과 응답을 다 지나는 장비는 나누기 전과 같은 값을 본다. 두 다리로 갈랐다고 총량이 달라지지 않는다.
  near(axis(split, 'edge', 'forwarding_bps'), 10e9, '양쪽에 걸친 장비');
  near(axis(split, 'app', 'nic_bps'), 10e9, '백엔드 NIC');
  // 요청만 지나는 LB 는 응답 몫을 보지 않는다. DSR 이 처음부터 말하던 것이다.
  near(axis(split, 'lb', 'forwarding_bps'), 1e9, '요청만 지나는 LB');
});

test('stops delivering when the declared return path is gone', () => {
  const topology = returnPathFixture();
  const result = calculateScenario(topology, { disabledLinks: ['app-edge'] });
  const demand = result.demands.find(({ id }) => id === 'web');
  // 요청은 여전히 갈 수 있다. 그래도 응답이 돌아오지 못하면 전달된 것이 아니다.
  assert.equal(demand.status, 'unreachable');
  assert.equal(result.summary.unreachableCount, 1);
});

test('counts a session once when the request and the response share a device', () => {
  const topology = returnPathFixture();
  topology.devices.find(({ id }) => id === 'edge').kind = 'firewall';
  topology.devices.find(({ id }) => id === 'edge').limits.new_sessions_per_sec = 100e3;
  topology.devices.find(({ id }) => id === 'edge').behavior = { mode: 'routed', sessionSync: 'none' };
  topology.demands[0].load.new_sessions_per_sec = 20e3;
  const edge = calculateScenario(topology).devices.find(({ id }) => id === 'edge');
  // 세션 수는 요청 다리에만 싣는다. 두 다리에 다 실으면 양쪽에 걸친 장비가 같은 연결을 두 번 센다.
  assert.equal(edge.axes.new_sessions_per_sec.load, 20e3);
});

test('a direction nobody modelled reads unknown, not a quiet zero', () => {
  const result = calculateScenario(cloneTopology());
  const oneWay = result.links.find(({ id }) => id === 'leaf-b-api-b');
  const busy = oneWay.directions.forward.axes.forwarding_bps;
  const idle = oneWay.directions.reverse.axes.forwarding_bps;
  assert.ok(busy.utilization > 0);
  assert.equal(idle.status, 'unknown');
  assert.equal(idle.unknownReason, 'return-not-modelled');
  // 모르는 것이 이 링크의 건강은 아니다. 링크마다 미확인을 물리면 253개 중 178개가 회색이 되어
  // 그림이 아무 말도 못 한다 - 그 공백은 방향별 숫자와 사유가 제자리에서 말한다.
  assert.equal(oneWay.primaryStatus, 'warning', '판정은 실제로 흐르는 방향이 정한다');
  assert.equal(result.summary.growthLadder.unresolved
    .some(({ resourceId, direction }) => resourceId === 'leaf-b-api-b' && direction === 'reverse'), false,
  '모델링하지 않은 반환 방향은 언제 차는지의 미확정이 아니다');
});

test('no design paints a number on a direction it never carried', () => {
  for (const { id } of templates) {
    const topology = buildTemplate(id);
    if (!topology.links.length) continue;
    for (const link of calculateScenario(topology, { scale: 1 }).links) {
      const forward = link.directions.forward.axes.forwarding_bps;
      const reverse = link.directions.reverse.axes.forwarding_bps;
      if (!forward || !reverse) continue;
      // 한쪽만 흐르면 반대쪽은 계산된 적이 없다. 양쪽 다 비어 있으면 그것은 사실이므로 0 이 맞다.
      if ((forward.load ?? 0) > 0) assert.notEqual(reverse.utilization, 0, `${id} ${link.id}: 역방향을 0%로 그렸습니다`);
      if ((reverse.load ?? 0) > 0) assert.notEqual(forward.utilization, 0, `${id} ${link.id}: 정방향을 0%로 그렸습니다`);
    }
  }
});
