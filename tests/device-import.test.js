import test from 'node:test';
import assert from 'node:assert/strict';
import { importDeviceDefinition } from '../src/device-import.js';

test('imports Rack Mesh performance limits with metadata', () => {
  const template = importDeviceDefinition({ performance_profile: { schema_version: 1, profile_id: 'fw-100', revision: 'r1', device_ref: { manufacturer: 'Acme', model: 'FW 100' }, class: 'firewall', limits: [{ axis: 'new_sessions_per_sec', value: 42000, source: { type: 'datasheet' }, conditions: { packet_size_bytes: 1518 } }] } });
  assert.equal(template.limits.new_sessions_per_sec, 42000);
  assert.equal(template.kind, 'firewall');
  assert.equal(template.metadata.revision, 'r1');
});

test('imports NetBox physical data while leaving performance unknown', () => {
  const template = importDeviceDefinition({ manufacturer: { name: 'Acme' }, model: 'Leaf 48', slug: 'acme-leaf-48', u_height: 1, part_number: 'L48', interfaces: [{ name: 'eth1', type: '25gbase-x-sfp28' }, { name: 'eth2', type: '25gbase-x-sfp28' }], 'power-ports': [{ name: 'PSU1', maximum_draw: 600 }] });
  assert.equal(template.limits.forwarding_bps, null);
  assert.deepEqual(template.metadata.portSpeedsBps, [25e9]);
  assert.equal(template.metadata.maximumDrawWatts, 600);
});

test('rejects unsupported and malformed device files', () => {
  assert.throws(() => importDeviceDefinition({ hello: 'world' }), /Unsupported/);
  assert.throws(() => importDeviceDefinition('{bad'), /valid JSON/);
});

test('requires explicit condition selection instead of overwriting duplicate axes', () => {
  const input = { performance_profile: { profile_id: 'lab', limits: [
    { axis: 'forwarding_bps', value: 1, unit: 'Gbps', condition_id: 'inspection', conditions: { inspection: true } },
    { axis: 'forwarding_bps', value: 20, unit: 'Gbps', condition_id: 'plain', conditions: { inspection: false } },
  ] } };
  assert.throws(() => importDeviceDefinition(input), /Ambiguous conditions/);
  const selected = importDeviceDefinition(input, { conditionId: 'inspection' });
  assert.equal(selected.limits.forwarding_bps, 1e9);
  assert.equal(selected.metadata.records[0].originalValue, 1);
  assert.equal(selected.metadata.records[0].conditions.inspection, true);
  assert.throws(() => importDeviceDefinition(input, { conditionId: 'missing' }), /at least one limit/);
});
