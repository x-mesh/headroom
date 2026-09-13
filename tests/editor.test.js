import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { addDemand, addDevice, addLink, createEmptyTopology, moveDevice, promoteConnector, removeDemand, removeDevice, removeLink, updateDemand, updateDevice } from '../public/editor.js';
import { calculateScenario, findShortestPaths } from '../public/engine.js';

test('creates, moves, and links devices with validated IDs', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { name: 'Leaf A', position: { x: 100, y: 100 }, limits: { forwarding_bps: 10e9 } });
  addDevice(topology, { name: 'API A', kind: 'server', position: { x: 300, y: 100 }, limits: { nic_bps: 10e9 } });
  addLink(topology, { source: 'leaf-a', target: 'api-a', capacityBps: 10e9 });
  moveDevice(topology, 'leaf-a', { x: -4, y: 900 });
  assert.deepEqual(topology.devices[0].position, { x: -4, y: 900 }, 'the canvas grows to the device, so a move is not clamped');
  assert.throws(() => moveDevice(topology, 'leaf-a', { x: Number.NaN, y: 0 }), /Device x/);
  addLink(topology, { id: 'parallel', source: 'api-a', target: 'leaf-a' });
  assert.equal(topology.links.length, 2);
  assert.throws(() => addLink(topology, { id: 'parallel', source: 'api-a', target: 'leaf-a' }), /already exists/);
});

test('removes dependent links but retains service demand when deleting a device', () => {
  const topology = createEmptyTopology();
  for (const id of ['a', 'b']) addDevice(topology, { id, limits: { forwarding_bps: 1e9 } });
  addLink(topology, { source: 'a', target: 'b' });
  addDemand(topology, { id: 'a-b', source: 'a', target: 'b', load: { forwarding_bps: 1e8 } });
  removeDevice(topology, 'a');
  assert.equal(topology.links.length, 0);
  assert.equal(topology.demands.length, 1);
  assert.equal(calculateScenario(topology).demands[0].validity, 'invalid');
});

test('a removed device leaves no dangling HA group member', () => {
  const topology = cloneTopology();
  removeDevice(topology, 'fw-a');
  assert.deepEqual(topology.haGroups.find(({ id }) => id === 'fw-pair').members, ['fw-b']);
  assert.doesNotThrow(() => calculateScenario(topology), 'a design must stay calculable after a device is deleted');
  removeDevice(topology, 'fw-b');
  assert.equal(topology.haGroups.some(({ id }) => id === 'fw-pair'), false, 'a group with no members left is not a group');
  assert.doesNotThrow(() => calculateScenario(topology));
});

test('enumerates deterministic equal-cost shortest paths for endpoint demand', () => {
  const topology = createEmptyTopology();
  for (const [id, x] of [['a', 0], ['b', 1], ['c', 2], ['d', 3]]) addDevice(topology, { id, position: { x, y: 0 }, limits: { forwarding_bps: 10e9 } });
  for (const [source, target] of [['a','b'], ['b','d'], ['a','c'], ['c','d']]) addLink(topology, { source, target });
  const paths = findShortestPaths(topology, 'a', 'd');
  assert.deepEqual(paths.map(({ devices }) => devices), [['a','b','d'], ['a','c','d']]);
  addDemand(topology, { id: 'traffic', source: 'a', target: 'd', load: { forwarding_bps: 4e9 } });
  const result = calculateScenario(topology);
  assert.equal(result.demands[0].paths.length, 2);
  assert.equal(result.links.find(({ id }) => id === 'a-b').load.forwarding_bps, 2e9);
});

test('a device carries its manufacturer and model, and rejects a logo that is not an image', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'fw', vendor: '  Fortinet  ', model: 'FG-1800F', limits: { forwarding_bps: 1e9 } });
  const device = topology.devices[0];
  assert.deepEqual([device.vendor, device.model], ['Fortinet', 'FG-1800F']);
  // 빈 값은 필드를 지운다. 잘못 적은 제조사가 화면에 남으면 안 된다.
  updateDevice(topology, 'fw', { vendor: '', model: 'FG-2600F' });
  assert.deepEqual([device.vendor, device.model], [undefined, 'FG-2600F']);

  const logo = `data:image/png;base64,${'A'.repeat(64)}`;
  updateDevice(topology, 'fw', { vendorLogo: logo });
  assert.equal(device.vendorLogo, logo);
  updateDevice(topology, 'fw', { vendorLogo: '' });
  assert.equal(device.vendorLogo, undefined);
  // 외부 URL 은 앱의 무의존 원칙을 깨고, 큰 파일은 프로젝트를 부풀린다.
  assert.throws(() => updateDevice(topology, 'fw', { vendorLogo: 'https://example.com/logo.png' }), /data URI/);
  assert.throws(() => updateDevice(topology, 'fw', { vendorLogo: `data:image/png;base64,${'A'.repeat(30000)}` }), /24KB/);
});

test('a datasheet profile and a user correction both survive on the device', async () => {
  const { applySpec, setLimitOverride } = await import('../public/editor.js');
  const { catalogEntry, catalogProfile } = await import('../public/devices/catalog.js');
  const entry = catalogEntry('fortinet-fortigate-100f');
  const profile = catalogProfile(entry.id, 'fw-1518');
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'fw', kind: 'firewall', limits: { forwarding_bps: null } });
  applySpec(topology, 'fw', { catalogId: entry.id, profileId: profile.id, profileLabel: profile.label,
    limits: profile.limits, vendor: entry.vendor, model: entry.model, source: entry.source });
  const device = topology.devices[0];
  assert.deepEqual([device.vendor, device.model], ['Fortinet', 'FortiGate 100F']);
  assert.equal(device.limits.new_sessions_per_sec, 56e3);
  assert.equal(device.source.type, 'datasheet');

  // 실측이 데이터시트보다 낮게 나오는 것이 흔하다. 그 보정이 계산에 들어가되 원본은 남는다.
  setLimitOverride(topology, 'fw', 'new_sessions_per_sec', 40e3);
  assert.equal(device.limits.new_sessions_per_sec, 40e3);
  assert.equal(device.spec.limits.new_sessions_per_sec, 56e3, 'the datasheet value is never lost');
  assert.equal(device.overrides.new_sessions_per_sec, 40e3);

  // 프로필을 바꿔도 보정은 유지된다.
  const threat = catalogProfile(entry.id, 'threat');
  applySpec(topology, 'fw', { catalogId: entry.id, profileId: threat.id, profileLabel: threat.label, limits: threat.limits });
  assert.equal(device.limits.forwarding_bps, 1e9, 'threat protection collapses 20 Gbps to 1 Gbps');
  assert.equal(device.limits.new_sessions_per_sec, 40e3, 'the correction still applies');
  assert.equal(device.spec.limits.new_sessions_per_sec, null, 'but the datasheet says nothing here');

  setLimitOverride(topology, 'fw', 'new_sessions_per_sec', null);
  assert.equal(device.limits.new_sessions_per_sec, null, 'clearing a correction returns to unknown, not to zero');
  assert.equal(device.overrides, undefined);
  assert.throws(() => setLimitOverride(topology, 'fw', 'nic_bps', 1e9), /not part of this profile/);
});

// HA 그룹만 청소하던 자리에서 랙·서비스·장애 도메인이 빠져 있었다. 그 셋을 선언한 설계에서
// 멤버 하나를 지우면 검증이 걸려 계산 전체가 invalid 가 되고, 판정 하나가 아니라 설계의
// 모든 숫자가 사라졌다. 검증 패널이 이미 사용자에게 그 셋을 만들게 해 주므로 실제로 닿는 길이다.
test('a removed device leaves no dangling rack, service, or failure domain member', () => {
  const topology = createEmptyTopology();
  for (const id of ['core', 'srv-1', 'srv-2']) addDevice(topology, { id, kind: id === 'core' ? 'switch' : 'server', limits: { forwarding_bps: 1e10, forwarding_pps: 1e7, nic_bps: 1e10, nic_pps: 1e7 } });
  for (const n of [1, 2]) {
    addLink(topology, { source: 'core', target: `srv-${n}` });
    addDemand(topology, { id: `d${n}`, source: 'core', target: `srv-${n}`, load: { nic_bps: 1e9, nic_pps: 1e6 } });
  }
  topology.racks = [{ id: 'rack-01', deviceIds: ['srv-1', 'srv-2'], powerBasis: 'typical', powerBudgetWatts: 3000, capacityU: 42 }];
  topology.failureDomains = [{ id: 'row-a', deviceIds: ['srv-1', 'srv-2'], linkIds: ['core-srv-1'] }];
  topology.services = [{ id: 'svc', demandIds: ['d1', 'd2'], requiredDeliveryRatio: 1,
    endpointGroups: [{ id: 'pool', members: ['srv-1', 'srv-2'], minAvailable: 2 }] }];
  assert.equal(calculateScenario(topology).summary.evaluationStatus !== 'invalid', true);

  removeDevice(topology, 'srv-2');
  assert.deepEqual(topology.racks[0].deviceIds, ['srv-1']);
  assert.deepEqual(topology.failureDomains[0].deviceIds, ['srv-1']);
  assert.deepEqual(topology.services[0].endpointGroups[0].members, ['srv-1']);
  // 최소 가용 대수도 남은 멤버 수를 넘으면 검증에 걸린다. 함께 낮아져야 한다.
  assert.equal(topology.services[0].endpointGroups[0].minAvailable, 1);
  // 지운 장비에 물린 링크의 id 도 장애 도메인에서 빠진다.
  assert.deepEqual(topology.failureDomains[0].linkIds, ['core-srv-1']);

  removeDemand(topology, 'd1');
  assert.deepEqual(topology.services[0].demandIds, ['d2']);
  removeLink(topology, 'core-srv-1');
  assert.deepEqual(topology.failureDomains[0].linkIds, []);

  // 남은 수요 d2 는 끝점이 사라져 invalid 지만, 그것은 사용자가 다시 이어 붙일 수 있는 상태다.
  // 여기서 확인하는 것은 되돌릴 길이 없는 컬렉션 참조가 하나도 안 남았다는 것이다.
  const issues = calculateScenario(topology).validationIssues.map(({ reason }) => reason);
  for (const reason of ['rack-member-missing', 'service-endpoint-missing', 'service-demand-missing', 'domain-member-missing', 'invalid-min-available']) {
    assert.ok(!issues.includes(reason), `${reason} 가 남았습니다: ${JSON.stringify(issues)}`);
  }
});

test('a collection left with no members goes away instead of failing validation', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'only', limits: { forwarding_bps: 1e9 } });
  topology.racks = [{ id: 'rack-01', deviceIds: ['only'], powerBasis: 'typical', powerBudgetWatts: 1000, capacityU: 42 }];
  topology.failureDomains = [{ id: 'row-a', deviceIds: ['only'], linkIds: [] }];
  removeDevice(topology, 'only');
  // 빈 멤버 목록 자체가 검증에 걸린다. HA 그룹이 이미 쓰던 방식대로 항목을 통째로 버린다.
  assert.deepEqual(topology.racks, []);
  assert.deepEqual(topology.failureDomains, []);
});

// 엔진은 방향별 용량과 명시 경로와 백엔드 풀을 이미 읽는데, 그것을 만들 길이 편집기에 없었다.
// 그래서 템플릿이 링크와 수요를 만든 뒤 객체를 직접 주무르고 있었고, 그 길은 검증을 지나지 않았다.
test('a link can carry a different capacity in each direction', () => {
  const topology = createEmptyTopology();
  for (const id of ['cpe', 'carrier']) addDevice(topology, { id, kind: 'router', limits: { forwarding_bps: 1e10, forwarding_pps: 1e7 } });
  addLink(topology, { id: 'wan', source: 'cpe', target: 'carrier',
    capacity: { forwarding_bps: 1e9, forwarding_pps: 1e6 },
    capacityByDirection: { forward: { forwarding_bps: 200e6 }, reverse: { forwarding_bps: 1e9 } } });
  const link = topology.links[0];
  // capacity 는 양방향 공통으로 깔리고 방향별 값이 축 단위로 덮는다. pps 는 양쪽 모두 공통값이다.
  assert.equal(link.capacity.forwarding_pps, 1e6);
  assert.equal(link.capacityByDirection.forward.forwarding_bps, 200e6);
  assert.equal(link.capacityByDirection.reverse.forwarding_bps, 1e9);
  addDemand(topology, { id: 'upload', source: 'cpe', target: 'carrier', load: { forwarding_bps: 170e6, forwarding_pps: 30e3 } });
  const result = calculateScenario(topology).links[0];
  assert.equal(result.directions.forward.axes.forwarding_bps.limit, 200e6);
  assert.equal(result.directions.reverse.axes.forwarding_bps.limit, 1e9);
  // 축 이름을 막지 않으면 오타 난 축이 아무 장비도 갖지 않아 조용히 무시된다.
  assert.throws(() => addLink(topology, { id: 'typo', source: 'carrier', target: 'cpe', capacity: { forwarding_bits: 1e9 } }), /Unknown link capacity axis/);
});

test('a demand can name its own route, pool, and direction split when it is created', () => {
  const topology = createEmptyTopology();
  for (const [id, kind] of [['a', 'switch'], ['b', 'router'], ['c', 'web']]) addDevice(topology, { id, kind, limits: { forwarding_bps: 1e10, forwarding_pps: 1e7, nic_bps: 1e10, nic_pps: 1e7 } });
  addLink(topology, { id: 'ab', source: 'a', target: 'b' });
  addLink(topology, { id: 'bc', source: 'b', target: 'c' });
  const demand = addDemand(topology, { id: 'traffic', source: 'a', target: 'c', load: { forwarding_bps: 1e8, forwarding_pps: 1e5 },
    paths: [{ id: 'via-b', devices: ['a', 'b', 'c'], links: ['ab', 'bc'] }],
    backendPool: 'single', directionality: { responseShare: 0.2, origin: 'explicit' } });
  // 경로를 주면 pathMode 가 따라온다. 그러지 않으면 엔진이 그 경로를 읽지 않는다.
  assert.equal(demand.pathMode, 'explicit');
  assert.equal(demand.paths[0].id, 'via-b');
  assert.equal(demand.backendPool, 'single');
  assert.deepEqual(demand.directionality, { responseShare: 0.2, origin: 'explicit' });
  assert.equal(calculateScenario(topology).demands[0].status, 'delivered');

  // 없는 것은 없는 채로 둔다. 빈 필드를 만들면 저장 파일마다 실린다.
  const plain = addDemand(topology, { id: 'plain', source: 'a', target: 'c', load: { forwarding_bps: 1e8 } });
  assert.equal(plain.pathMode, 'shortest');
  for (const key of ['paths', 'backendPool', 'directionality']) assert.equal(Object.hasOwn(plain, key), false);

  assert.throws(() => addDemand(topology, { id: 'bad-path', source: 'a', target: 'c', load: { forwarding_bps: 1 },
    paths: [{ id: 'p', devices: ['a', 'missing'], links: ['ab'] }] }), /missing device/);
  assert.throws(() => addDemand(topology, { id: 'bad-share', source: 'a', target: 'c', load: { forwarding_bps: 1 },
    directionality: { responseShare: 1.4 } }), /between 0 and 1/);
});


test('takes a return path only when it ends where the demand starts', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { id: 'client', kind: 'router', limits: { forwarding_bps: 10e9 } });
  addDevice(topology, { id: 'edge', kind: 'router', limits: { forwarding_bps: 10e9 } });
  addDevice(topology, { id: 'app', kind: 'server', limits: { nic_bps: 10e9 } });
  addLink(topology, { source: 'client', target: 'edge', capacityBps: 10e9 });
  addLink(topology, { source: 'edge', target: 'app', capacityBps: 10e9 });
  const response = { id: 'response', devices: ['app', 'edge', 'client'], links: ['edge-app', 'client-edge'] };
  // 되돌아오는 길이므로 끝은 출발지여야 한다. 뒤집어 적으면 응답이 반대로 흐르는 그림이 조용히 남는다.
  assert.throws(() => addDemand(topology, { id: 'bad', source: 'client', target: 'app', load: { forwarding_bps: 1e9 },
    returnPath: [{ ...response, devices: ['client', 'edge', 'app'] }] }), /must end at the demand source/);
  assert.throws(() => addDemand(topology, { id: 'missing', source: 'client', target: 'app', load: { forwarding_bps: 1e9 },
    returnPath: [{ ...response, links: ['edge-app', 'nowhere'] }] }), /missing link/);
  const demand = addDemand(topology, { id: 'web', source: 'client', target: 'app', load: { forwarding_bps: 1e9 }, returnPath: [response] });
  assert.equal(demand.returnPath.length, 1);
  // 끝점이 바뀌면 반환 경로는 다른 설계의 것이 된다. 명시 경로와 같이 걷어낸다.
  updateDemand(topology, 'web', { target: 'edge' });
  assert.equal(demand.returnPath, undefined);
});

test('an imported connector becomes a traffic link once both ends are devices', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { name: 'Leaf A', position: { x: 0, y: 0 }, limits: { forwarding_bps: 10e9 } });
  addDevice(topology, { name: 'API A', kind: 'server', position: { x: 200, y: 0 }, limits: { nic_bps: 10e9 } });
  topology.diagram = { shapes: [{ id: 'note-1', kind: 'note', text: '영역', x: 0, y: 100, width: 80, height: 40 }], groups: [], connectors: [
    { id: 'connector-drawio-e1', source: 'leaf-a', target: 'api-a', kind: 'annotation', zIndex: 5, stroke: '#ff0000', strokeWidth: 2, drawioOptions: { routeMode: 'orthogonal' }, drawioGeometry: { waypoints: [{ x: 100, y: 40 }] } },
    { id: 'connector-to-shape', source: 'leaf-a', target: 'note-1', kind: 'annotation' },
  ] };
  const link = promoteConnector(topology, 'connector-drawio-e1');
  assert.equal(link.id, 'link-drawio-e1');
  assert.deepEqual([link.source, link.target], ['leaf-a', 'api-a']);
  // The drawing carries no capacity, so the link states that it is unknown
  // rather than inventing a rating the calculation would then trust.
  assert.equal(link.capacity.forwarding_bps, null);
  // The line keeps the appearance it was imported with.
  assert.equal(link.drawioVisual.zIndex, 5);
  assert.deepEqual(link.drawioVisual.paint, { stroke: '#ff0000', strokeWidth: 2 });
  assert.deepEqual(link.drawioVisual.geometry.waypoints, [{ x: 100, y: 40 }]);
  // One line, not two: the connector is gone once the link exists.
  assert.deepEqual(topology.diagram.connectors.map(({ id }) => id), ['connector-to-shape']);
  assert.equal(topology.links.length, 1);
  // A connector that still ends on a shape cannot become a link.
  assert.throws(() => promoteConnector(topology, 'connector-to-shape'), /device at both ends/);
  assert.throws(() => promoteConnector(topology, 'connector-missing'), /does not exist/);
  // The promoted link carries demand like any other link.
  addDemand(topology, { name: 'Web', source: 'leaf-a', target: 'api-a', load: { forwarding_bps: 1e9 } });
  assert.equal(calculateScenario(topology).links.find(({ id }) => id === link.id)?.load.forwarding_bps, 1e9);
});

test('a hand drawn connector keeps the app link look when it is promoted', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { name: 'Leaf A', position: { x: 0, y: 0 }, limits: { forwarding_bps: 10e9 } });
  addDevice(topology, { name: 'Leaf B', position: { x: 200, y: 0 }, limits: { forwarding_bps: 10e9 } });
  topology.diagram = { shapes: [], groups: [], connectors: [{ id: 'annotation-1', source: 'leaf-a', target: 'leaf-b', kind: 'annotation' }] };
  assert.equal(promoteConnector(topology, 'annotation-1').drawioVisual, undefined);
});
