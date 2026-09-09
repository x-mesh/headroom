import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvidence, evidenceApplicability, evidenceDigest, buildSpec, validateEvidenceRecords } from '../public/evidence.js';
import { deviceCatalog } from '../public/devices/catalog.js';

test('SI normalization preserves the measurement and rejects mismatched units', () => {
  const record = normalizeEvidence({ axis: 'forwarding_bps', value: 2.5, unit: 'Gbps', conditions: { packet_size_bytes: 64 }, source: { type: 'datasheet' } });
  assert.equal(record.value, 2.5e9);
  assert.equal(record.originalValue, 2.5);
  assert.equal(record.originalUnit, 'Gbps');
  assert.equal(evidenceApplicability(record), 'unknown');
  assert.equal(evidenceApplicability(record, { packet_size_bytes: 64 }), 'applicable');
  assert.equal(evidenceApplicability(record, { packet_size_bytes: 1500 }), 'incompatible');
  assert.throws(() => normalizeEvidence({ axis: 'forwarding_bps', value: 2, unit: 'Mpps' }), /unit/);
  assert.equal(evidenceDigest({ a: 1, b: 2 }), evidenceDigest({ b: 2, a: 1 }));
  validateEvidenceRecords([record]);
  assert.throws(() => validateEvidenceRecords([{ ...record, value: 8 }]), /inconsistent/);
  const scoped = normalizeEvidence({ axis: 'nic_bps', value: 1, unit: 'Gbps', conditions: {}, scope: 'single-port', evidenceKind: 'datasheet' });
  assert.equal(evidenceApplicability(scoped, {}), 'unknown');
  assert.equal(evidenceApplicability(scoped, {}, 'single-port'), 'applicable');
  assert.equal(evidenceApplicability(scoped, {}, 'device-total'), 'incompatible');
});

test('catalog snapshots identify theoretical adapter packet rates and preserve limits', () => {
  const entry = deviceCatalog.find((item) => item.id === 'intel-e810-cqda2');
  const snapshot = buildSpec(entry, entry.profiles[0]);
  assert.equal(snapshot.records.find(({ axis }) => axis === 'nic_pps').evidenceKind, 'theoretical');
  assert.equal(snapshot.records.find(({ axis }) => axis === 'nic_bps').evidenceKind, 'datasheet');
  assert.equal(snapshot.digest, buildSpec(entry, entry.profiles[0]).digest);
  snapshot.limits.nic_bps = 1;
  assert.notEqual(snapshot.limits.nic_bps, entry.profiles[0].limits.nic_bps);
  assert.equal(evidenceApplicability(snapshot.records[0]), 'unknown');
});

test('Arista switch replacements preserve documented rack power and U', () => {
  const expected = new Map([
    ['arista-7050dx4-32s', [353, 880, 1]],
    ['arista-7050sdx4-48d8', [165, 520, 1]],
    ['arista-7050x4-48y-4df', [120, 223, 1]],
  ]);
  for (const [id, [typicalDrawWatts, maximumDrawWatts, uHeight]] of expected) {
    const physical = deviceCatalog.find((item) => item.id === id)?.physical;
    assert.deepEqual([physical?.typicalDrawWatts, physical?.maximumDrawWatts, physical?.uHeight], [typicalDrawWatts, maximumDrawWatts, uHeight], id);
    assert.match(physical?.source?.note || '', /25C.*50%.*excludes transceivers/, id);
  }
});
