import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { calculateScenario, compareScenarios, deliveryRoleOf, sweepSingleFaults } from '../src/engine.js';
import { addDemand, addDevice, addLink, createEmptyTopology } from '../src/editor.js';
import { buildTemplate, templates } from '../src/templates.js';

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
  // v1 은 장비에서만 응답분을 뺀다. 인접 링크 보정은 arm 모델과 함께 다룬다.
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
  // 두 demand 가 모두 지나는 리프는 진짜 단일 장애점이다.
  assert.equal(findOne(dual, 'leaf-a').verdict, 'severs');
  assert.equal(dual.grade, 'single-point');

  // 로드밸런서가 한 대뿐인 설계는 그 한 대가 끊는다.
  const single = sweepSingleFaults(buildTemplate('dsr-farm'));
  assert.equal(findOne(single, 'lb').verdict, 'severs');
  assert.equal(findOne(single, 'lb').endpoint, false);
});

test('the sweep ignores injected faults and stays deterministic', () => {
  const topology = cloneTopology();
  const clean = sweepSingleFaults(topology);
  // 이미 주입된 장애 위에 얹으면 이중 장애가 된다. 스윕은 설계의 성질이지 현재 상태가 아니다.
  const withFault = sweepSingleFaults(topology, { disabledDevices: ['fw-a'], disabledLinks: ['leaf-a-api-a'] });
  assert.deepEqual(withFault, clean);
  assert.equal(JSON.stringify(sweepSingleFaults(topology)), JSON.stringify(clean));
});

test('the sweep counts demand endpoints apart and never calls an unknown design safe', () => {
  const topology = cloneTopology();
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
  assert.equal(demand.severedPaths.length, 1, 'but the design has one path it used to take');
  assert.ok(demand.severedPaths[0].devices.includes('fw'));
  assert.ok(demand.severedPaths[0].links.length > 0, 'the canvas needs the links to draw the break');

  // 장애가 없으면 무장애 경로를 다시 풀지 않는다.
  assert.ok(calculateScenario(single).demands.every(({ severedPaths }) => severedPaths === undefined));
  // 끊기지 않은 demand 에는 붙지 않는다.
  assert.equal(calculateScenario(cloneTopology(), { disabledDevices: ['fw-a'] })
    .demands.find(({ id }) => id === 'public-api').severedPaths, undefined);
});
