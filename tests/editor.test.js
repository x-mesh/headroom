import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { addDemand, addDevice, addLink, createEmptyTopology, moveDevice, removeDevice } from '../src/editor.js';
import { calculateScenario, findShortestPaths } from '../src/engine.js';

test('creates, moves, and links devices with validated IDs', () => {
  const topology = createEmptyTopology();
  addDevice(topology, { name: 'Leaf A', position: { x: 100, y: 100 }, limits: { forwarding_bps: 10e9 } });
  addDevice(topology, { name: 'API A', kind: 'server', position: { x: 300, y: 100 }, limits: { nic_bps: 10e9 } });
  addLink(topology, { source: 'leaf-a', target: 'api-a', capacityBps: 10e9 });
  moveDevice(topology, 'leaf-a', { x: -4, y: 900 });
  assert.deepEqual(topology.devices[0].position, { x: -4, y: 900 }, 'the canvas grows to the device, so a move is not clamped');
  assert.throws(() => moveDevice(topology, 'leaf-a', { x: Number.NaN, y: 0 }), /Device x/);
  assert.throws(() => addLink(topology, { source: 'api-a', target: 'leaf-a' }), /already exists/);
});

test('removes dependent links and demands with a device', () => {
  const topology = createEmptyTopology();
  for (const id of ['a', 'b']) addDevice(topology, { id, limits: { forwarding_bps: 1e9 } });
  addLink(topology, { source: 'a', target: 'b' });
  addDemand(topology, { id: 'a-b', source: 'a', target: 'b', load: { forwarding_bps: 1e8 } });
  removeDevice(topology, 'a');
  assert.equal(topology.links.length, 0);
  assert.equal(topology.demands.length, 0);
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
