import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario } from '../public/engine.js';
import { applyMeasuredLimits, applyObservedLoad, buildObservedLoadValidationReport, compareTopologyFingerprint, fingerprintMatches, importMeasuredLimits, importObservedLoad, importZabbixObservedLoad, OBSERVED_LOAD_AGGREGATES, OBSERVED_LOAD_STALE_AFTER_DAYS, observedLoadIsStale, topologyFingerprint } from '../public/measured-import.js';

const entry = (extra = {}) => ({ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 58, unit: 'Kcps', conditions: {}, ...extra });

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
  assert.throws(() => importMeasuredLimits({ schema: 'rack-mesh-measured-limits', entries: [entry({ conditions: null })] }), /conditions must be an object/);
});

const observed = (entries, topology = cloneTopology()) => ({ schema: 'rack-mesh-observed-load', as_of: '2026-09-09T03:00:00Z', aggregate: 'p95', topology_fingerprint: { device_ids: topology.devices.map(({ id }) => id), link_ids: topology.links.map(({ id }) => id) }, entries });

test('uses observed resource load for a normal snapshot without changing limits', () => {
  const topology = cloneTopology();
  const baseline = calculateScenario(topology);
  const value = 123_000_000;
  const parsed = importObservedLoad(observed([{ target: { kind: 'link', from: 'edge-a', to: 'fw-a' }, direction: 'forward', axis: 'forwarding_bps', value, unit: 'bps' }]));
  const applied = applyObservedLoad(topology, parsed);
  const result = calculateScenario(applied.topology);
  const link = result.links.find(({ source, target }) => source === 'edge-a' && target === 'fw-a');
  assert.equal(link.directions.forward.axes.forwarding_bps.load, value);
  assert.notEqual(link.directions.forward.axes.forwarding_bps.status, 'unknown');
  assert.equal(result.devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.limit, baseline.devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.limit);
});

test('keeps observed resource load out of failure calculations and identifies changed topology', () => {
  const topology = cloneTopology();
  const parsed = importObservedLoad(observed([{ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 1, unit: 'cps' }]));
  const applied = applyObservedLoad(topology, parsed);
  const normal = calculateScenario(applied.topology);
  const failed = calculateScenario(applied.topology, { disabledDevices: ['fw-b'] });
  assert.equal(normal.devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.load, 1);
  assert.notEqual(failed.devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.load, 1);
  applied.topology.devices.pop();
  const comparison = compareTopologyFingerprint(parsed.fingerprint, applied.topology);
  assert.equal(fingerprintMatches(comparison), false);
  assert.equal(comparison.missingDevices.length, 1);
});

test('rejects an ambiguous or invalid observed load snapshot before mutation', () => {
  assert.throws(() => importObservedLoad({ schema: 'rack-mesh-observed-load', as_of: 'bad', aggregate: 'p95', topology_fingerprint: {}, entries: [] }), /as_of/);
  assert.throws(() => importObservedLoad(observed([{ target: { kind: 'link', from: 'edge-a', to: 'fw-a' }, direction: 'sideways', axis: 'forwarding_bps', value: 1, unit: 'bps' }])), /direction/);
  assert.deepEqual(topologyFingerprint(cloneTopology()), importObservedLoad(observed([])).fingerprint);
});

test('keeps the declared observed-load aggregate without a hidden default', () => {
  for (const aggregate of OBSERVED_LOAD_AGGREGATES) {
    const parsed = importObservedLoad({ ...observed([]), aggregate });
    assert.equal(parsed.aggregate, aggregate);
  }
  assert.throws(() => importObservedLoad({ ...observed([]), aggregate: 'average' }), /aggregate/);
});

test('marks observed load older than seven days as stale without rejecting it', () => {
  const parsed = importObservedLoad(observed([]));
  const now = Date.parse(parsed.asOf) + (OBSERVED_LOAD_STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000;
  assert.equal(observedLoadIsStale(parsed, now), true);
  assert.equal(observedLoadIsStale(parsed, now - 2 * 24 * 60 * 60 * 1000), false);
});

test('compares observed load with the model before the observed snapshot applies', () => {
  const topology = cloneTopology();
  const expected = calculateScenario(topology).devices.find(({ id }) => id === 'fw-a').axes.new_sessions_per_sec.load;
  const parsed = importObservedLoad({ ...observed([{ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: expected * 2, unit: 'sessions/s' }]),
    conditions: {}, scope: null });
  const applied = applyObservedLoad(topology, parsed);
  const report = buildObservedLoadValidationReport(applied.topology);
  assert.equal(report.available, true);
  assert.equal(report.conditionGroup, 'matched');
  assert.deepEqual(report.axes[0], { axis: 'new_sessions_per_sec', unit: 'sessions/s', sampleCount: 1, mape: 0.5, maxAbsolutePercentageError: 0.5, meanSignedPercentageError: -0.5, signedError: { underModelled: 1, exact: 0, overModelled: 0 } });
});

test('separates observed snapshots with absent or mismatched workload conditions', () => {
  const topology = cloneTopology();
  topology.workloadConditions = { transport: 'tcp' };
  const entry = [{ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 10, unit: 'cps' }];
  const absent = buildObservedLoadValidationReport(applyObservedLoad(topology, importObservedLoad(observed(entry, topology))).topology);
  const mismatched = buildObservedLoadValidationReport(applyObservedLoad(topology, importObservedLoad({ ...observed(entry, topology), conditions: { transport: 'udp' } })).topology);
  assert.equal(absent.conditionGroup, 'unrecorded');
  assert.equal(mismatched.conditionGroup, 'mismatched');
});

test('imports only explicit Zabbix host and item key mappings', () => {
  const topology = cloneTopology();
  const zabbix = { schema: 'rack-mesh-zabbix-observed-load', as_of: '2026-09-09T03:00:00Z', aggregate: 'p95', topology_fingerprint: { device_ids: topology.devices.map(({ id }) => id), link_ids: topology.links.map(({ id }) => id) },
    mappings: [{ host: 'fw-a.prod', item_key: 'fortigate.sessions', target: { kind: 'device', id: 'fw-a' }, axis: 'concurrent_sessions', unit: 'sessions' }],
    entries: [{ host: 'fw-a.prod', item_key: 'fortigate.sessions', value: 240000 }, { host: 'fw-a.prod', item_key: 'fortigate.cpu', value: 88 }] };
  const parsed = importZabbixObservedLoad(zabbix);
  const applied = applyObservedLoad(topology, parsed);
  assert.deepEqual(parsed.unmapped, [{ host: 'fw-a.prod', itemKey: 'fortigate.cpu' }]);
  assert.equal(applied.topology.observedLoad.source, 'zabbix');
  assert.equal(applied.topology.observedLoad.devices['fw-a'].concurrent_sessions, 240000);
  assert.deepEqual(applied.topology.observedLoad.unmapped, parsed.unmapped);
});

test('resolves only documented Zabbix template keys while the target and direction stay explicit', () => {
  const topology = cloneTopology();
  const shared = { schema: 'rack-mesh-zabbix-observed-load', as_of: '2026-09-09T03:00:00Z', aggregate: 'p95', topology_fingerprint: { device_ids: topology.devices.map(({ id }) => id), link_ids: topology.links.map(({ id }) => id) } };
  const fortiGate = importZabbixObservedLoad({ ...shared,
    mappings: [{ template: 'fortigate-snmp', host: 'fw-a.prod', item_key: 'net.ipv4.sessions[fgSysSesCount.0]', target: { kind: 'device', id: 'fw-a' } }],
    entries: [{ host: 'fw-a.prod', item_key: 'net.ipv4.sessions[fgSysSesCount.0]', value: 240000 }] });
  assert.deepEqual(fortiGate.entries, [{ target: { kind: 'device', id: 'fw-a' }, axis: 'concurrent_sessions', value: 240000, unit: 'sessions' }]);

  const linux = importZabbixObservedLoad({ ...shared,
    mappings: [{ template: 'linux-snmp', host: 'api-a.prod', item_key: 'net.if.in[ifHCInOctets.4]', target: { kind: 'link', from: 'leaf-a', to: 'api-a' }, direction: 'forward' }],
    entries: [{ host: 'api-a.prod', item_key: 'net.if.in[ifHCInOctets.4]', value: 1_250_000_000 }] });
  assert.deepEqual(linux.entries, [{ target: { kind: 'link', from: 'leaf-a', to: 'api-a' }, axis: 'forwarding_bps', value: 1_250_000_000, unit: 'bps', direction: 'forward' }]);
});

test('rejects unknown and conflicting Zabbix template mappings', () => {
  const topology = cloneTopology();
  const common = { schema: 'rack-mesh-zabbix-observed-load', as_of: '2026-09-09T03:00:00Z', aggregate: 'p95', topology_fingerprint: { device_ids: topology.devices.map(({ id }) => id), link_ids: topology.links.map(({ id }) => id) }, entries: [] };
  const mapping = { template: 'fortigate-snmp', host: 'fw-a.prod', item_key: 'net.ipv4.sessions[fgSysSesCount.0]', target: { kind: 'device', id: 'fw-a' } };
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [{ ...mapping, axis: 'forwarding_bps', unit: 'bps' }] }), /conflicts with Zabbix template/);
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [{ ...mapping, item_key: 'fortigate.cpu' }] }), /does not define item_key/);
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [{ ...mapping, template: 'unknown-template' }] }), /Unknown Zabbix mapping template/);
});

test('rejects Zabbix mappings that leave the source or Rack Mesh destination ambiguous', () => {
  const topology = cloneTopology();
  const common = { schema: 'rack-mesh-zabbix-observed-load', as_of: '2026-09-09T03:00:00Z', aggregate: 'p95', topology_fingerprint: { device_ids: topology.devices.map(({ id }) => id), link_ids: topology.links.map(({ id }) => id) }, entries: [] };
  const mapping = { host: 'fw-a.prod', item_key: 'fortigate.sessions', target: { kind: 'device', id: 'fw-a' }, axis: 'concurrent_sessions', unit: 'sessions' };
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [mapping, mapping] }), /duplicates a Zabbix host and item_key/);
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [mapping, { ...mapping, item_key: 'fortigate.sessions.active' }] }), /duplicates a Rack Mesh target axis/);
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [{ ...mapping, axis: 'made_up_axis' }] }), /Unknown performance axis/);
  assert.throws(() => importZabbixObservedLoad({ ...common, mappings: [mapping], entries: [{ host: 'fw-a.prod', item_key: 'fortigate.sessions', value: 1 }, { host: 'fw-a.prod', item_key: 'fortigate.sessions', value: 2 }] }), /duplicates a Zabbix host and item_key/);
});
