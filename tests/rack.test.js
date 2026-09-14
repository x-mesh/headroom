import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyTopology, addDevice, setDevicePower } from '../public/editor.js';
import { addMappedPlacement, addStandalonePlacement, createRack, firstFreeStartU, moveRack, nearestFreeStartU, nextRackName, placementRangeLabel, rackSummary, removePlacement, suggestedRackPowerBudget, updatePlacement } from '../public/rack.js';
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

test('0.5U placements accept half-unit adjacency and reject half-unit overlap', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 05', capacityU: 6, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  addStandalonePlacement(topology, rack.id, { name: 'PATCH 05', kind: 'other', startU: 1, uHeight: 1, powerWatts: 0 });
  addStandalonePlacement(topology, rack.id, { name: 'BLANK 05', kind: 'blank-panel', startU: 2, uHeight: .5, powerWatts: 0 });
  addStandalonePlacement(topology, rack.id, { name: 'BLANK 06', kind: 'blank-panel', startU: 2.5, uHeight: .5, powerWatts: 0 });

  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'X', kind: 'blank-panel', startU: 1.5, uHeight: .5, powerWatts: 0 }), /겹칩니다/);
  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'Y', kind: 'other', startU: 2.5, uHeight: 1, powerWatts: 0 }), /겹칩니다/);
  assert.equal(rackSummary(topology, rack).usedU, 2);
});

test('0.5U placements reject non-half-unit values without rounding them', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 06', capacityU: 6, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'A', kind: 'other', startU: 1.3, uHeight: 1, powerWatts: 0 }), /0\.5U/);
  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'B', kind: 'other', startU: 1, uHeight: .3, powerWatts: 0 }), /0\.5U/);
  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'C', kind: 'other', startU: 1, uHeight: 0, powerWatts: 0 }), /0\.5U/);
  assert.throws(() => addStandalonePlacement(topology, rack.id, { name: 'D', kind: 'other', startU: .5, uHeight: 1, powerWatts: 0 }), /0\.5U/);

  const half = addStandalonePlacement(topology, rack.id, { name: 'BLANK', kind: 'blank-panel', startU: 6.5, uHeight: .5, powerWatts: 0 });
  const full = addMappedPlacement(topology, rack.id, { deviceId: topology.devices[0].id, startU: 1, uHeight: 1 });
  assert.throws(() => updatePlacement(topology, rack.id, full.id, { startU: 6.5, uHeight: 1 }), /범위를 벗어납니다/);
  assert.equal(half.startU, 6.5);
});

test('free-slot search lets whole-U devices sit flush against a 0.5U panel', () => {
  const topology = fixture();
  const rack = createRack(topology, { name: 'RACK 07', capacityU: 6, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  addStandalonePlacement(topology, rack.id, { name: 'BLANK', kind: 'blank-panel', startU: 1, uHeight: .5, powerWatts: 0 });
  assert.equal(firstFreeStartU(topology, rack, 1), 1.5);
  assert.equal(nearestFreeStartU(topology, rack, 1, 1.5), 1.5);
  assert.equal(nearestFreeStartU(topology, rack, 1, 2), 2);
  assert.equal(firstFreeStartU(topology, rack, .5), 1.5);

  // 사용자가 겪은 배치: 2U 서버를 U13.5 패널 바로 아래로 올리면 11.5에 붙어야 한다.
  const serverRack = createRack(topology, { name: 'RACK 09', capacityU: 42, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  const server = addMappedPlacement(topology, serverRack.id, { deviceId: topology.devices[0].id, startU: 11, uHeight: 2 });
  addStandalonePlacement(topology, serverRack.id, { name: 'BLANK 13.5', kind: 'blank-panel', startU: 13.5, uHeight: .5, powerWatts: 0 });
  assert.equal(nearestFreeStartU(topology, serverRack, 2, 11.5, server.id), 11.5);
  assert.throws(() => updatePlacement(topology, serverRack.id, server.id, { startU: 12, uHeight: 2 }), /겹칩니다/);
  assert.equal(updatePlacement(topology, serverRack.id, server.id, { startU: 11.5, uHeight: 2 }).startU, 11.5);

  const topology2 = fixture();
  const rack2 = createRack(topology2, { name: 'RACK 08', capacityU: 2, powerBudgetWatts: 2000, powerBasis: 'nameplate' });
  addStandalonePlacement(topology2, rack2.id, { name: 'BLANK A', kind: 'blank-panel', startU: 1, uHeight: .5, powerWatts: 0 });
  addStandalonePlacement(topology2, rack2.id, { name: 'BLANK B', kind: 'blank-panel', startU: 2.5, uHeight: .5, powerWatts: 0 });
  assert.equal(firstFreeStartU(topology2, rack2, 1), 1.5);
  assert.equal(nearestFreeStartU(topology2, rack2, 1, 1), 1.5);
  assert.equal(firstFreeStartU(topology2, rack2, 2), null);
});

test('the new-rack name continues after the highest RACK number and skips IDs still in use', () => {
  const topology = fixture();
  const rackInput = { capacityU: 42, powerBudgetWatts: 1000, powerBasis: 'nameplate' };
  assert.equal(nextRackName(topology), 'RACK 01');
  createRack(topology, { ...rackInput, name: 'RACK 01' });
  assert.equal(nextRackName(topology), 'RACK 02');

  // 번호 사이가 비어 있어도 새 랙은 가장 뒤 번호를 받는다. 번호 형식이 아닌 이름은 세지 않는다.
  createRack(topology, { ...rackInput, name: 'SECURITY' });
  createRack(topology, { ...rackInput, name: 'RACK 07' });
  assert.equal(nextRackName(topology), 'RACK 08');

  // 이름을 바꾼 랙은 처음 이름의 ID를 유지한다. 제안 이름으로 바로 만들 수 있어야 한다.
  createRack(topology, { ...rackInput, name: 'RACK 08' }).name = 'CORE';
  assert.equal(nextRackName(topology), 'RACK 09');
  assert.equal(createRack(topology, { ...rackInput, name: nextRackName(topology) }).name, 'RACK 09');
});

test('a new rack starts from the latest rack power budget, or 5 kW when there is none', () => {
  const topology = fixture();
  assert.equal(suggestedRackPowerBudget(topology), 5000);
  createRack(topology, { name: 'RACK 01', capacityU: 42, powerBudgetWatts: 1400, powerBasis: 'nameplate' });
  assert.equal(suggestedRackPowerBudget(topology), 1400);
  createRack(topology, { name: 'RACK 02', capacityU: 42, powerBudgetWatts: 8600, powerBasis: 'nameplate' });
  assert.equal(suggestedRackPowerBudget(topology), 8600);
});

test('moveRack reorders racks, keeps the order in the project file, and rejects unknown racks or slots', () => {
  const topology = fixture();
  const rackInput = { capacityU: 42, powerBudgetWatts: 1000, powerBasis: 'nameplate' };
  const first = createRack(topology, { ...rackInput, name: 'RACK 01' });
  createRack(topology, { ...rackInput, name: 'RACK 02' });
  const third = createRack(topology, { ...rackInput, name: 'RACK 03' });

  moveRack(topology, third.id, 0);
  assert.deepEqual(topology.racks.map(({ name }) => name), ['RACK 03', 'RACK 01', 'RACK 02']);
  moveRack(topology, third.id, 1);
  assert.deepEqual(topology.racks.map(({ name }) => name), ['RACK 01', 'RACK 03', 'RACK 02']);
  // 좌표 필드가 없으므로 순서가 저장 파일에 그대로 남아야 다시 열어도 같은 자리에 선다.
  assert.deepEqual(parseProject(serializeProject(topology, {})).topology.racks.map(({ name }) => name), ['RACK 01', 'RACK 03', 'RACK 02']);

  assert.throws(() => moveRack(topology, 'missing-rack', 0), /찾을 수 없습니다/);
  assert.throws(() => moveRack(topology, first.id, 3), /자리가 올바르지 않습니다/);
  assert.throws(() => moveRack(topology, first.id, -1), /자리가 올바르지 않습니다/);
  assert.deepEqual(topology.racks.map(({ name }) => name), ['RACK 01', 'RACK 03', 'RACK 02']);
});

test('placementRangeLabel keeps whole-U strings and never shows an end below the start', () => {
  assert.equal(placementRangeLabel(5, 1), 'U5–5');
  assert.equal(placementRangeLabel(1, 2), 'U1–2');
  assert.equal(placementRangeLabel(1.5, .5), 'U1.5');
  assert.equal(placementRangeLabel(1.5, 1), 'U1.5–2');
  assert.equal(placementRangeLabel(2, .5), 'U2');
  assert.equal(placementRangeLabel(2, 1.5), 'U2–3');

  for (let startU = 1; startU <= 3; startU += .5) {
    for (let uHeight = .5; uHeight <= 3; uHeight += .5) {
      const label = placementRangeLabel(startU, uHeight);
      const [, end] = label.replace('U', '').split('–');
      const endValue = end === undefined ? startU : Number(end);
      assert.ok(endValue >= startU, `${label} end should not be below start ${startU}`);
    }
  }
});
