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
