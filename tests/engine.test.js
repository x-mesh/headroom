import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { calculateScenario, compareScenarios } from '../src/engine.js';
import { addDevice, createEmptyTopology } from '../src/editor.js';

test('splits demand evenly across active ECMP paths', () => {
  const result = calculateScenario(cloneTopology());
  const publicDemand = result.demands.find(({ id }) => id === 'public-api');
  assert.equal(publicDemand.paths.length, 2);
  assert.equal(publicDemand.paths[0].share, 0.5);
  const linkA = result.links.find(({ id }) => id === 'edge-a-fw-a');
  const linkB = result.links.find(({ id }) => id === 'edge-b-fw-b');
  assert.equal(linkA.load.forwarding_bps + linkB.load.forwarding_bps, 7.2e9);
});

test('reroutes traffic and exposes the overloaded firewall after a peer failure', () => {
  const result = calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] });
  const firewallB = result.devices.find(({ id }) => id === 'fw-b');
  assert.equal(result.demands.find(({ id }) => id === 'public-api').paths.length, 1);
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
  assert.deepEqual(device.axes, {});
  assert.equal(device.bindingAxis, null);
  assert.equal(device.primaryStatus, 'unknown', 'knowing no limit is not the same as passing every limit');
});

test('rejects a dangling path reference', () => {
  const topology = cloneTopology();
  topology.demands[0].paths[0].links.push('missing-link');
  assert.throws(() => calculateScenario(topology), /missing link/);
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
  delivery: scenario.demands.map(({ id, status, deliveredRatio, paths }) => [id, status, deliveredRatio, paths.length]),
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
    delivery: [['public-api', 'delivered', 1, 1], ['east-west', 'delivered', 1, 2]],
  });
  // 오늘의 거짓말을 명시적으로 고정한다. leaf-b-api-b 가 122% 인데 전부 전달됐다고 보고한다.
  assert.equal(scenario.links.find(({ id }) => id === 'leaf-b-api-b').axes.forwarding_bps.status, 'overloaded');
  assert.equal(scenario.demands.every(({ deliveredRatio }) => deliveredRatio === 1), true);
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
  assert.equal(round4(oneWay.directions.reverse.axes.forwarding_bps.utilization), 0);
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
