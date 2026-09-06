import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { addDemand, addDevice, addLink, createEmptyTopology, moveDevice, removeDevice, updateDevice } from '../src/editor.js';
import { calculateScenario, findShortestPaths } from '../src/engine.js';

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
  const { applySpec, setLimitOverride } = await import('../src/editor.js');
  const { catalogEntry, catalogProfile } = await import('../src/devices/catalog.js');
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
