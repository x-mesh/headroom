import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptUnmatchedEvidence, deriveDemandPacketLoad, deriveForwardingPackets, deriveHostForwarding, parseConditionValue, unknownAxisCensus } from '../scripts/fill-axes.mjs';
import { buildSpec, catalogFor } from '../public/devices/catalog.js';
import { setWorkloadConditions } from '../public/editor.js';
import { normalizeEvidence } from '../public/evidence.js';

function host(id, kind = 'server') {
  const entry = catalogFor(kind)[0];
  const spec = buildSpec(entry, entry.profiles[0]);
  return { id, name: id, kind, zone: 'A', position: { x: 0, y: 0 }, enabled: true,
    limits: { ...spec.limits, forwarding_bps: null, forwarding_pps: null }, spec: structuredClone(spec) };
}
function topologyOf(devices) {
  return { devices,
    links: [{ id: 'l1', source: devices[0].id, target: devices[1].id, capacity: { forwarding_bps: 10e9 }, enabled: true }],
    demands: [{ id: 'd1', name: 'd1', source: devices[0].id, target: devices[1].id, load: { forwarding_bps: 1e9 }, pathMode: 'shortest' }] };
}

test('a condition value reads a number, a list, and an empty list apart', () => {
  assert.equal(parseConditionValue('1400'), 1400);
  assert.equal(parseConditionValue('l4'), 'l4');
  assert.deepEqual(parseConditionValue('[]'), []);
  assert.deepEqual(parseConditionValue('ipsec,qos'), ['ipsec', 'qos']);
});

test('the census says how many axes are unknown and why', () => {
  const { total, reasons } = unknownAxisCensus(topologyOf([host('a'), host('b')]));
  assert.ok(total > 0);
  // NIC 카탈로그는 전달 축을 담지 않는다. 조건이 없는 NIC 축은 대조할 수 없다.
  assert.ok(reasons.some(([key]) => key === 'forwarding_bps : limit-missing'));
  assert.ok(reasons.some(([key]) => key === 'nic_bps : evidence-applicability-unknown'));
});

test('a host forwards through its one NIC, and the derived limit says it is theoretical', () => {
  const topology = topologyOf([host('a'), host('b', 'storage')]);
  const { devices, axes } = deriveHostForwarding(topology);
  assert.equal(devices, 2);
  assert.equal(axes, 4);
  for (const device of topology.devices) {
    assert.equal(device.limits.forwarding_bps, device.limits.nic_bps);
    assert.equal(device.limits.forwarding_pps, device.limits.nic_pps);
    const record = device.spec.records.find((item) => item.axis === 'forwarding_bps');
    assert.equal(record.evidenceKind, 'theoretical');
  }
  // 두 번 돌려도 이미 채운 축은 건드리지 않는다.
  assert.deepEqual(deriveHostForwarding(topology), { devices: 0, axes: 0 });
});

test('a router that does not forward is left alone', () => {
  const topology = topologyOf([{ ...host('a'), kind: 'router' }, host('b')]);
  const { devices } = deriveHostForwarding(topology);
  assert.equal(devices, 1);
  assert.equal(topology.devices[0].limits.forwarding_bps, null);
});

test('packet load is the arithmetic of the packet size that was declared', () => {
  const topology = topologyOf([host('a'), host('b')]);
  assert.throws(() => deriveDemandPacketLoad(topology), /packet_size_bytes/);
  setWorkloadConditions(topology, { packet_size_bytes: 1400 });
  const { filled, frameBits } = deriveDemandPacketLoad(topology);
  assert.equal(frameBits, (1400 + 20) * 8);
  assert.equal(filled, 1);
  assert.equal(topology.demands[0].load.forwarding_pps, Math.round(1e9 / 11360));
  // 이미 실린 패킷 부하는 덮지 않는다.
  assert.equal(deriveDemandPacketLoad(topology).filled, 0);
});

test('a bandwidth figure is divided only when it was measured at the declared packet size', () => {
  const measured = (packetSize) => normalizeEvidence({ axis: 'forwarding_bps', value: 19.7e9, evidenceKind: 'datasheet',
    conditions: { packet_size_bytes: packetSize, features_enabled: [] } });
  const matching = { ...host('a'), kind: 'router' };
  matching.spec = { limits: { forwarding_bps: 19.7e9 }, records: [measured(1400)] };
  const vague = { ...host('b'), kind: 'router' };
  vague.spec = { limits: { forwarding_bps: 19.7e9 }, records: [measured('unknown')] };
  const topology = topologyOf([matching, vague]);
  setWorkloadConditions(topology, { packet_size_bytes: 1400, features_enabled: [] });

  const { filled, skipped } = deriveForwardingPackets(topology);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].value, Math.round(19.7e9 / 11360));
  // 크기를 모르는 값을 우리 크기로 나누면 모르는 것을 아는 것처럼 만든다.
  assert.deepEqual(skipped, [{ device: 'b', at: 'unknown' }]);
  assert.equal(vague.limits.forwarding_pps, null);
  // 데이터시트 조건을 그대로 물려받아 수락 없이도 맞는다.
  const derived = matching.spec.records.find((item) => item.axis === 'forwarding_pps');
  assert.deepEqual(derived.conditions, { packet_size_bytes: 1400, features_enabled: [] });
});

test('accepting evidence is a per-axis assertion, and an empty record has nothing to accept', () => {
  const topology = topologyOf([host('a'), host('b')]);
  const empty = normalizeEvidence({ axis: 'forwarding_bps', value: null, evidenceKind: 'datasheet' });
  topology.devices[0].spec.records.push(empty);
  topology.devices[0].spec.limits = { ...topology.devices[0].spec.limits, forwarding_bps: null };

  const before = unknownAxisCensus(topology).total;
  const accepted = acceptUnmatchedEvidence(topology);
  assert.ok(accepted > 0);
  assert.ok(unknownAxisCensus(topology).total < before);
  // 값이 없는 레코드는 수락되지 않는다.
  assert.equal(topology.devices[0].accepted?.forwarding_bps, undefined);
  assert.ok(topology.devices[0].accepted.nic_bps);
});

test('changing the workload releases the acceptances that were tied to it', () => {
  const topology = topologyOf([host('a'), host('b')]);
  acceptUnmatchedEvidence(topology);
  assert.ok(topology.devices[0].accepted.nic_bps);
  setWorkloadConditions(topology, { packet_size_bytes: 64 });
  assert.equal(topology.devices[0].accepted, undefined);
});
