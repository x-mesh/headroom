import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario } from '../public/engine.js';
import { applyMeasuredLimits, importMeasuredLimits } from '../public/measured-import.js';

const entry = (extra = {}) => ({ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 58, unit: 'Kcps', ...extra });

test('keeps an unsaturated observed maximum out of engine limits', () => {
  const topology = cloneTopology();
  const before = calculateScenario(topology).devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.limit;
  const result = applyMeasuredLimits(topology, importMeasuredLimits({ schema: 'rack-mesh-measured-limits', entries: [entry({ saturated: false })] }));
  const after = calculateScenario(result.topology).devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.limit;
  assert.equal(after, before);
  assert.equal(result.floors.length, 1);
  assert.equal(result.topology.devices.find(({ id }) => id === 'fw-a').metadata.observedFloor.new_sessions_per_sec.value, 58000);
});

test('promotes only a saturated measurement with evidence and leaves unmatched entries visible', () => {
  const parsed = importMeasuredLimits({ schema: 'rack-mesh-measured-limits', entries: [entry({ saturated: true, saturation_evidence: 'queue plateau' }), entry({ target: { kind: 'device', id: 'missing' }, saturated: true, saturation_evidence: 'queue plateau' })] });
  const result = applyMeasuredLimits(cloneTopology(), parsed);
  const device = result.topology.devices.find(({ id }) => id === 'fw-a');
  assert.equal(device.limits.new_sessions_per_sec, 58000);
  assert.equal(device.source.type, 'user_measured');
  assert.deepEqual(result.unmatched, ['missing']);
});

test('marks a measured floor above its limit as evidence conflict, not overload', () => {
  const topology = cloneTopology();
  topology.devices.find(({ id }) => id === 'fw-a').limits.new_sessions_per_sec = 42000;
  const result = applyMeasuredLimits(topology, importMeasuredLimits({ schema: 'rack-mesh-measured-limits', entries: [entry({ value: 58, saturated: false })] }));
  const axis = calculateScenario(result.topology).devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec;
  assert.deepEqual([axis.status, axis.unknownReason, axis.utilization], ['unknown', 'evidence-conflict', null]);
});

test('rejects a measured limit without a device target or a known axis', () => {
  assert.throws(() => importMeasuredLimits({ schema: 'rack-mesh-measured-limits', entries: [{ target: { kind: 'link', id: 'x' }, axis: 'forwarding_bps', value: 1 }] }), /device id/);
  assert.throws(() => importMeasuredLimits({ schema: 'rack-mesh-measured-limits', entries: [entry({ axis: 'made_up_axis' })] }), /Unknown performance axis/);
});
