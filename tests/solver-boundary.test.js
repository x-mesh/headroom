import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScenario, createExport, findShortestPaths, sweepSingleFaults } from '../src/engine.js';
import { addDevice, addLink, removeDevice, removeLink, updateDemand, createEmptyTopology } from '../src/editor.js';
import { normalizeEvidence } from '../src/evidence.js';

function network() {
  return {
    name: 'boundary', devices: [
      { id: 'a', kind: 'router', external: true, limits: { forwarding_bps: 10e9, forwarding_pps: 1e8 } },
      { id: 'b', kind: 'server', limits: { nic_bps: 1e9, nic_pps: 1e8 } },
    ], links: [{ id: 'ab', source: 'a', target: 'b', capacity: { forwarding_bps: 10e9 } }],
    demands: [{ id: 'traffic', source: 'a', target: 'b', load: { forwarding_bps: 4e9, forwarding_pps: 1e6 } }],
  };
}

test('a forwarding workload reaches a NIC constraint without duplicated input', () => {
  const result = calculateScenario(network());
  assert.equal(result.devices[1].axes.nic_bps.load, 4e9);
  assert.equal(result.demands[0].deliveredRatio, 0.25);
  assert.equal(result.summary.evaluationStatus, 'fail');
});

test('missing workload differs from explicit zero and conflicting aliases are invalid', () => {
  const topology = network();
  topology.demands[0].load = { forwarding_bps: 0 };
  let result = calculateScenario(topology);
  assert.equal(result.devices[1].axes.nic_bps.status, 'healthy');
  assert.equal(result.devices[1].axes.nic_pps.status, 'unknown');
  assert.equal(result.summary.evaluationStatus, 'unknown');
  topology.demands[0].load.forwarding_pps = 0;
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'pass');
  topology.demands[0].load.nic_bps = 3;
  result = calculateScenario(topology);
  assert.equal(result.summary.validationStatus, 'invalid');
  assert.equal(result.summary.evaluationStatus, 'invalid');
});

test('no demands, missing limits and invalid limits never imply redundancy', () => {
  const topology = network();
  topology.devices[1].limits = {};
  assert.notEqual(sweepSingleFaults(topology).grade, 'redundant');
  topology.devices[1].limits.nic_bps = -1;
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'invalid');
  assert.notEqual(sweepSingleFaults(topology).grade, 'redundant');
  topology.demands = [];
  topology.devices[1].limits = { nic_bps: 1e9, nic_pps: 1e8 };
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'not-ready');
  assert.equal(sweepSingleFaults(topology).grade, 'unknown');
});

test('deleted paths and endpoints stay editable while retaining demand', () => {
  const topology = network();
  topology.demands[0].paths = [{ id: 'explicit', devices: ['a', 'b'], links: ['ab'] }];
  topology.demands[0].pathMode = 'explicit';
  updateDemand(topology, 'traffic', { source: 'a', target: 'b', load: { forwarding_bps: 3e8 } });
  assert.equal(topology.demands[0].paths[0].id, 'explicit');
  removeLink(topology, 'ab');
  assert.equal(topology.demands.length, 1);
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'invalid');
  removeDevice(topology, 'b');
  updateDemand(topology, 'traffic', { source: 'a', target: 'b', name: 'still editable' });
  assert.equal(topology.demands[0].name, 'still editable');
  assert.equal(calculateScenario(topology).demands[0].status, 'unreachable');
});

test('editing one alias clears the stale twin but preserves explicit conflicting pairs', () => {
  const topology = network();
  topology.demands[0].load.nic_bps = 4e9;
  updateDemand(topology, 'traffic', { load: { forwarding_bps: 2e8 } });
  assert.equal(topology.demands[0].load.nic_bps, undefined);
  assert.equal(calculateScenario(topology).devices[1].axes.nic_bps.load, 2e8);
  updateDemand(topology, 'traffic', { load: { forwarding_bps: 2e8, nic_bps: 3e8 } });
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'invalid');
});

test('parallel physical links require unique IDs and do not reuse a port', () => {
  const topology = createEmptyTopology();
  for (const id of ['a', 'b']) addDevice(topology, { id, ports: [{ id: 'p1', speedBps: 1e9 }, { id: 'p2', speedBps: 1e9 }] });
  addLink(topology, { id: 'first', source: 'a', target: 'b', sourcePort: 'p1', targetPort: 'p1', capacityBps: 1e9 });
  addLink(topology, { id: 'second', source: 'a', target: 'b', sourcePort: 'p2', targetPort: 'p2', capacityBps: 1e9 });
  assert.equal(findShortestPaths(topology, 'a', 'b').length, 2);
  assert.throws(() => addLink(topology, { id: 'third', source: 'a', target: 'b', sourcePort: 'p1' }), /already connected/);
  topology.links[0].capacity.forwarding_bps = 10e9;
  assert.ok(calculateScenario(topology).validationIssues.some(({ reason }) => reason === 'link-exceeds-port-speed'));
});

test('service demand thresholds and endpoint groups are evaluated under domain faults', () => {
  const topology = network();
  topology.demands[0].load.forwarding_bps = 1e8;
  topology.services = [{ id: 'api', demandIds: ['traffic'], endpointGroups: [{ members: ['b'], minAvailable: 1 }], requiredDeliveryRatio: 1 }];
  topology.failureDomains = [{ id: 'rack-b', deviceIds: ['b'], linkIds: [] }];
  assert.equal(calculateScenario(topology).services[0].status, 'pass');
  const failed = calculateScenario(topology, { disabledDomains: ['rack-b'] });
  assert.equal(failed.services[0].status, 'fail');
  assert.deepEqual(failed.faults.devices, ['b']);
  assert.deepEqual(failed.faults.domains, ['rack-b']);
  assert.equal(sweepSingleFaults(topology).resources.find(({ id }) => id === 'b').endpoint, false);
});

test('service survival includes new-session admission, not only byte delivery', () => {
  const topology = network();
  topology.devices[0].limits.new_sessions_per_sec = 50;
  topology.demands[0].load = { forwarding_bps: 1e8, forwarding_pps: 1e4, new_sessions_per_sec: 100 };
  topology.services = [{ id: 'api', name: 'API', demandIds: ['traffic'], requiredDeliveryRatio: 1 }];
  const result = calculateScenario(topology);
  assert.equal(result.demands[0].deliveredRatio, 1);
  assert.equal(result.demands[0].admissionRatio, 0.5);
  assert.equal(result.services[0].status, 'fail');
  assert.equal(result.summary.evaluationStatus, 'fail');
});

test('racks report physical totals and never combine different power bases', () => {
  const topology = network();
  topology.devices[1].metadata = { maximumDrawWatts: 700, uHeight: 2 };
  topology.racks = [{ id: 'rack', deviceIds: ['b'], powerBudgetWatts: 600, capacityU: 4, powerBasis: 'nameplate' }];
  let rack = calculateScenario(topology).racks[0];
  assert.equal(rack.powerWatts, 700);
  assert.equal(rack.powerHeadroomWatts, -100);
  assert.equal(rack.status, 'fail');
  topology.devices[1].metadata.powerBasis = 'measured';
  rack = calculateScenario(topology).racks[0];
  assert.equal(rack.powerWatts, null);
  assert.equal(rack.status, 'unknown');
});

test('an export snapshots topology, baseline and source evidence without sharing references', () => {
  const topology = network();
  topology.devices[1].spec = { revision: 'v1', digest: 'abc', limits: { nic_bps: 1e9 } };
  const baseline = calculateScenario(topology);
  const exported = createExport(topology, baseline, baseline);
  assert.equal(exported.topology.devices[1].spec.digest, 'abc');
  assert.deepEqual(exported.baseline.summary, baseline.summary);
  topology.devices[1].spec.digest = 'changed';
  assert.equal(exported.evidence[1].spec.digest, 'abc');
});

test('path enumeration supports more than sixteen paths and reports its explicit budget', () => {
  const topology = network();
  topology.links = Array.from({ length: 24 }, (_, i) => ({ ...topology.links[0], id: `link-${i}` }));
  assert.equal(findShortestPaths(topology, 'a', 'b').length, 24);
  const result = calculateScenario(topology, { maxPaths: 16 });
  assert.equal(result.demands[0].paths.length, 16);
  assert.ok(result.demands[0].unknownConstraints.some(({ reason }) => reason === 'path-enumeration-limit'));
  assert.equal(result.demands[0].deliveredRatioBound, 'indeterminate');
  assert.equal(result.demands[0].pathEnumeration.complete, false);
});

test('evidence conditions and scope participate in evaluation without becoming input errors', () => {
  const topology = network();
  topology.demands[0].load.forwarding_bps = 1e8;
  const record = normalizeEvidence({ axis: 'nic_bps', value: 1e9, evidenceKind: 'measured', conditions: { packetBytes: 512 }, scope: { mode: 'inline' }, source: { type: 'measured', label: 'lab' } });
  topology.devices[1].spec = { records: [record] };
  let result = calculateScenario(topology);
  assert.equal(result.summary.validationStatus, 'valid');
  assert.equal(result.summary.evaluationStatus, 'unknown');
  assert.equal(result.devices[1].axes.nic_bps.unknownReason, 'evidence-applicability-unknown');
  topology.workloadConditions = { packetBytes: 1500 };
  topology.workloadScope = { mode: 'inline' };
  result = calculateScenario(topology);
  assert.equal(result.summary.validationStatus, 'valid');
  assert.equal(result.summary.evaluationStatus, 'unknown');
  assert.equal(result.devices[1].axes.nic_bps.unknownReason, 'evidence-incompatible');
  assert.ok(result.validationIssues.some(({ category, reason }) => category === 'applicability' && reason === 'evidence-incompatible'));
  topology.workloadConditions.packetBytes = 512;
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'pass');
  topology.workloadScope = { mode: 'dsr' };
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'unknown');
});

test('metadata evidence is evaluated and explicit corrections preserve their provenance', () => {
  const topology = network();
  topology.demands[0].load.forwarding_bps = 1e8;
  topology.devices[1].metadata = { records: [normalizeEvidence({ axis: 'nic_bps', value: 1e9, evidenceKind: 'datasheet', conditions: { packetBytes: 64 } })] };
  assert.equal(calculateScenario(topology).summary.evaluationStatus, 'unknown');
  topology.devices[1].overrides = { nic_bps: 1e9 };
  const result = calculateScenario(topology);
  assert.equal(result.summary.evaluationStatus, 'pass');
  assert.equal(result.devices[1].axes.nic_bps.evidenceApplicability, 'user-correction');
  assert.equal(result.devices[1].axes.nic_bps.source.type, 'user-correction');
});
