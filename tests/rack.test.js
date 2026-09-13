import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyTopology, addDevice, setDevicePower } from '../public/editor.js';
import { addMappedPlacement, addStandalonePlacement, createRack, firstFreeStartU, nearestFreeStartU, rackSummary, removePlacement, updatePlacement } from '../public/rack.js';
import { parseProject, serializeProject } from '../public/project.js';
import { rackUsage } from '../public/engine.js';

function fixture() {
  const topology = createEmptyTopology();
  const device = addDevice(topology, { name: 'API 01', kind: 'server', zone: 'APP', limits: {}, position: { x: 10, y: 10 } });
  device.metadata = { uHeight: 2, maximumDrawWatts: 400, powerBasis: 'nameplate' };
  return topology;
}

test('rack placements support mapped and standalone devices independently', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 01', capacityU: 12, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  addMappedPlacement(topology, rack.id, { deviceId: topology.devices[0].id, startU: 1, uHeight: 2 });
  addStandalonePlacement(topology, rack.id, { name: 'PATCH 01', kind: 'patch-panel', startU: 10, uHeight: 1, powerWatts: 0 });

  assert.deepEqual(rack.deviceIds, [topology.devices[0].id]);
  const summary = rackSummary(topology, rack);
  assert.equal(summary.usedU, 3);
  assert.equal(summary.powerWatts, 400);
  assert.equal(summary.placements.filter(({ mapped }) => mapped).length, 1);
});

test('rack placements reject overlap and out-of-range moves', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 01', capacityU: 6, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  const mapped = addMappedPlacement(topology, rack.id, { deviceId: topology.devices[0].id, startU: 1, uHeight: 2 });
  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'PATCH', kind: 'other', startU: 2, uHeight: 1, powerWatts: 0 }), /겹칩니다/);
  assert.equal(firstFreeStartU(topology, rack, 2), 3);
  assert.equal(nearestFreeStartU(topology, rack, 2, 2), 3);
  assert.equal(nearestFreeStartU(topology, rack, 2, 6), 5);
  assert.throws(() => updatePlacement(topology, rack.id, mapped.id, { startU: 6, uHeight: 2 }), /범위를 벗어납니다/);
});

test('rack placements survive a project round trip and detach without deleting topology devices', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 01', capacityU: 12, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  const placement = addMappedPlacement(topology, rack.id, { deviceId: topology.devices[0].id, startU: 4, uHeight: 2 });
  const parsed = parseProject(serializeProject(topology, {}));
  assert.equal(parsed.topology.racks[0].placements[0].startU, 4);
  removePlacement(topology, rack.id, placement.id);
  assert.equal(topology.devices.length, 1);
  assert.equal(rack.placements.length, 0);
});

test('a rack answers what the next device does to its limits before it is placed', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 01', capacityU: 12, powerBudgetWatts: 1000, powerBasis: 'nameplate' });
  addMappedPlacement(topology, rack.id, { deviceId: topology.devices[0].id, startU: 1, uHeight: 2 });

  const now = rackUsage(topology, rack);
  assert.equal(now.powerWatts, 400);
  assert.equal(now.powerRatio, .4);
  assert.equal(now.usedU, 2);
  assert.equal(now.status, 'pass');

  // 가정 배치는 실제 배치와 같은 규칙으로 더해져야 미리보기와 결과가 어긋나지 않는다.
  const after = rackUsage(topology, rack, { powerWatts: 500, uHeight: 4, name: 'SERVER' });
  assert.equal(after.powerWatts, 900);
  assert.equal(after.usedU, 6);
  assert.equal(Math.round(after.powerRatio * 100), 90);

  // 전력을 모르는 장비 한 대가 랙 합계를 미확인으로 떨어뜨린다. 빈 값은 여유가 아니다.
  const unknown = rackUsage(topology, rack, { powerWatts: null, uHeight: 1, name: 'PATCH 01' });
  assert.equal(unknown.powerKnown, false);
  assert.equal(unknown.powerWatts, null);
  assert.equal(unknown.status, 'unknown');
  assert.deepEqual(unknown.unknownPower, ['PATCH 01']);

  // 랙 기준과 다른 기준을 밝힌 장비는 합계에 넣지 않는다.
  topology.devices[0].metadata.powerBasis = 'measured';
  assert.equal(rackUsage(topology, rack).powerKnown, false);
});

test('a hand-entered device power counts in the rack and clears back to unknown', () => {
  const topology = fixture();
  const device = addDevice(topology, { name: 'EDGE 01', kind: 'router', zone: 'EDGE', limits: {}, position: { x: 20, y: 20 } });
  const rack = createRack(topology, { name: 'RACK 01', capacityU: 12, powerBudgetWatts: 1000, powerBasis: 'typical' });
  addMappedPlacement(topology, rack.id, { deviceId: device.id, startU: 1, uHeight: 1 });

  // 사양이 없는 장비는 합계를 미확인으로 만든다.
  assert.equal(rackUsage(topology, rack).powerKnown, false);
  assert.deepEqual(rackUsage(topology, rack).unknownPower, ['EDGE 01']);

  setDevicePower(topology, device.id, { basis: 'typical', watts: '220' });
  const known = rackUsage(topology, rack);
  assert.equal(known.powerKnown, true);
  assert.equal(known.powerWatts, 220);
  // 손으로 넣은 값은 데이터시트가 아니다. 출처가 그렇게 남아야 한다.
  assert.equal(device.metadata.source.label, '직접 입력');

  // 랙 기준과 다른 기준을 고르면 합계에서 빠진다. 조용히 섞지 않는다.
  setDevicePower(topology, device.id, { basis: 'nameplate', watts: '400' });
  assert.equal(rackUsage(topology, rack).powerKnown, false);

  setDevicePower(topology, device.id, { basis: 'typical', watts: '' });
  assert.equal(rackUsage(topology, rack).powerKnown, false);
  assert.equal(device.metadata.typicalDrawWatts, undefined);
  assert.throws(() => setDevicePower(topology, device.id, { basis: 'typical', watts: '-5' }), /0 이상/);
});
