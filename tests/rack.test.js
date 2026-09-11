import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyTopology, addDevice } from '../public/editor.js';
import { addMappedPlacement, addStandalonePlacement, createRack, firstFreeStartU, nearestFreeStartU, rackSummary, removePlacement, updatePlacement } from '../public/rack.js';
import { parseProject, serializeProject } from '../public/project.js';

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
