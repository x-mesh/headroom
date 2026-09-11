import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario } from '../public/engine.js';
import { createProject, parseProject, serializeProject } from '../public/project.js';

test('round trips topology and scenario without changing calculation', () => {
  const topology = cloneTopology();
  const scenario = { scale: 1.25, disabledDevices: new Set(['fw-a']), disabledLinks: new Set(), selectedId: 'fw-b' };
  const restored = parseProject(serializeProject(topology, scenario));
  assert.deepEqual(restored, createProject(topology, scenario));
  assert.deepEqual(calculateScenario(restored.topology, restored.scenario), calculateScenario(topology, scenario));
});

test('rejects future schema and unknown disabled resources', () => {
  const project = createProject(cloneTopology());
  assert.throws(() => parseProject({ ...project, schemaVersion: 4 }), /newer/);
  project.scenario.disabledDevices.push('ghost');
  assert.throws(() => parseProject(project), /unknown device/);
  assert.throws(() => parseProject('{broken'), /valid JSON/);
});

test('rejects executable markup in imported project text fields', () => {
  const project = createProject(cloneTopology());
  project.topology.devices[0].name = '<img src=x onerror=alert(1)>';
  assert.throws(() => parseProject(project), /1 to 80 characters|Device name/);
});

test('rejects forged executable SVG assets in project files', () => {
  const project = createProject(cloneTopology());
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  project.topology.diagram = { shapes: [], connectors: [], groups: [], drawioAssets: [{ id: 'asset-unsafe-svg', mime: 'image/svg+xml', width: 10, height: 10, digest: `sha256:${'0'.repeat(64)}`, base64: Buffer.from(svg).toString('base64') }] };
  assert.throws(() => parseProject(project), /SVG asset is unsafe/);
});

test('accepts a version 1 file and says what changed meaning', () => {
  const legacy = { ...createProject(cloneTopology()), schemaVersion: 1 };
  const project = parseProject(legacy);
  assert.equal(project.schemaVersion, 3);
  assert.equal(project.migratedFrom, 1);
  // 값을 바꾸지 않는다. 라벨이 맞고 엔진이 틀렸던 것이므로 숫자는 그대로다.
  assert.equal(project.topology.links[0].capacity.forwarding_bps, legacy.topology.links[0].capacity.forwarding_bps);
  assert.deepEqual(project.notices.map(({ code }) => code), ['link-capacity-reinterpreted', 'evidence-unverified']);
  assert.equal(parseProject(createProject(cloneTopology())).notices, undefined);
});

test('v3 preserves diagram, baseline, scenarios and failure domains across save and reopen', () => {
  const topology = cloneTopology();
  topology.diagram = { shapes: [{ id: 'note-1', kind: 'note', text: '설계 전제', x: -20, y: 3, width: 160, height: 80, groupId: 'group-1' }], connectors: [{ id: 'annotation-1', source: 'note-1', target: topology.devices[0].id, kind: 'annotation', waypoints: [{ x: 10, y: 20 }] }], groups: [{ id: 'group-1', name: '설명', memberIds: ['note-1'] }] };
  topology.failureDomains = [{ id: 'rack-a', kind: 'power', deviceIds: [topology.devices[0].id], linkIds: [] }];
  topology.template = { id: 'capacity-lab', learning: ['장애 후 여유 확인'] };
  const scenario = { disabledDomains: ['rack-a'], viewMode: 'verify', baseline: { topology: structuredClone(topology), scenario: { scale: 0.5 } }, namedScenarios: [{ id: 'peak', name: '최대 부하', scenario: { scale: 2 } }] };
  const restored = parseProject(serializeProject(topology, scenario));
  assert.deepEqual(restored, createProject(topology, scenario));
  assert.deepEqual(restored.topology.diagram, topology.diagram);
  assert.equal(restored.scenario.baseline.scenario.scale, 0.5);
  assert.equal(restored.scenario.namedScenarios[0].scenario.scale, 2);
  assert.equal(parseProject({ ...createProject(cloneTopology()), schemaVersion: 2 }).notices[0].code, 'evidence-unverified');
});

test('preserves a Zabbix observed-load source and unmapped keys across save and reopen', () => {
  const topology = cloneTopology();
  topology.observedLoad = { asOf: '2026-09-09T03:00:00Z', aggregate: 'p95', fingerprint: { deviceIds: [], linkIds: [] }, devices: {}, links: {}, source: 'zabbix', unmapped: [{ host: 'fw-a.prod', itemKey: 'fortigate.cpu' }] };
  const restored = parseProject(serializeProject(topology));
  assert.deepEqual(restored.topology.observedLoad, topology.observedLoad);
});

test('preserves valid catalog physical data and rejects unsafe physical values', () => {
  const topology = cloneTopology();
  topology.devices[0].spec = { catalogId: 'fixture', profileId: 'default', limits: {}, physical: { powerBasis: 'typical', typicalDrawWatts: 123, uHeight: 1, source: { label: 'Fixture sheet', locator: 'Power table' } } };
  assert.deepEqual(createProject(topology).topology.devices[0].spec.physical, topology.devices[0].spec.physical);
  for (const physical of [{ typicalDrawWatts: -1 }, { powerBasis: 'estimated' }, { uHeight: Infinity }, { source: { label: '<script>', locator: 'Power table' } }]) {
    const copy = structuredClone(topology); copy.devices[0].spec.physical = physical;
    assert.throws(() => createProject(copy), /physical spec/);
  }
});

test('preserves a failure domain kind without making it a calculation input', () => {
  const topology = cloneTopology();
  const baseline = calculateScenario(topology);
  topology.failureDomains[0].kind = 'firmware';
  assert.deepEqual(calculateScenario(topology), baseline);
  assert.equal(createProject(topology).topology.failureDomains[0].kind, 'firmware');
  const legacy = cloneTopology();
  delete legacy.failureDomains[0].kind;
  assert.equal(createProject(legacy).topology.failureDomains[0].kind, 'other');
  topology.failureDomains[0].kind = 'dns';
  assert.throws(() => createProject(topology), /Failure domain kind/);
});

test('rejects unsafe or dangling diagram elements and malformed bounds', () => {
  const topology = cloneTopology();
  topology.diagram = { shapes: [{ id: 'note-1', kind: 'note', text: 'Hello', x: 1, y: 2, width: 30, height: 40 }], connectors: [], groups: [] };
  for (const patch of [{ width: -1 }, { text: '<script>bad()</script>' }, { html: 'bad' }, { id: topology.devices[0].id }]) {
    const copy = structuredClone(topology); Object.assign(copy.diagram.shapes[0], patch);
    assert.throws(() => createProject(copy), /Diagram|diagram/);
  }
  topology.diagram.connectors.push({ id: 'annotation-1', source: 'note-1', target: 'ghost' });
  assert.throws(() => createProject(topology), /unknown endpoint/);
});

test('keeps label runs at their stated limits and rejects the first value past each', () => {
  const withRuns = (labelRuns) => {
    const topology = cloneTopology();
    topology.diagram = { shapes: [{ id: 'note-1', kind: 'note', text: '라벨', x: 0, y: 0, width: 40, height: 20, labelRuns }], connectors: [], groups: [] };
    return topology;
  };
  const block = (lines, runs) => Array.from({ length: lines }, () => Array.from({ length: runs }, () => ({ text: 'a' })));
  assert.doesNotThrow(() => createProject(withRuns(block(8, 32))));
  assert.throws(() => createProject(withRuns(block(9, 1))), /label runs are invalid/);
  assert.throws(() => createProject(withRuns(block(1, 33))), /label runs are invalid/);
  assert.doesNotThrow(() => createProject(withRuns([[{ text: 'a'.repeat(240) }]])));
  assert.throws(() => createProject(withRuns([[{ text: 'a'.repeat(241) }]])), /label run is invalid/);
  for (const fontSize of [8, 72]) assert.doesNotThrow(() => createProject(withRuns([[{ text: 'a', fontSize }]])));
  for (const fontSize of [7, 73]) assert.throws(() => createProject(withRuns([[{ text: 'a', fontSize }]])), /label size is invalid/);
});

test('keeps diagram order values at both ends of their range and rejects a step beyond', () => {
  const withZIndex = (zIndex, target) => {
    const topology = cloneTopology();
    const shape = { id: 'note-1', kind: 'note', text: '라벨', x: 0, y: 0, width: 40, height: 20 };
    const connector = { id: 'annotation-1', source: 'note-1', target: topology.devices[0].id, kind: 'annotation' };
    (target === 'connector' ? connector : shape).zIndex = zIndex;
    topology.diagram = { shapes: [shape], connectors: [connector], groups: [] };
    return topology;
  };
  for (const zIndex of [0, 100000]) {
    assert.doesNotThrow(() => createProject(withZIndex(zIndex, 'shape')));
    assert.doesNotThrow(() => createProject(withZIndex(zIndex, 'connector')));
  }
  for (const zIndex of [-1, 100001]) {
    assert.throws(() => createProject(withZIndex(zIndex, 'shape')), /shape order is invalid/);
    assert.throws(() => createProject(withZIndex(zIndex, 'connector')), /connector order is invalid/);
  }
});

test('accepts a drawio asset at its pixel limits and rejects the first size past them', () => {
  const withAsset = (width, height) => {
    const topology = cloneTopology();
    topology.diagram = { shapes: [], connectors: [], groups: [], drawioAssets: [{ id: 'asset-1', mime: 'image/png', width, height, digest: `sha256:${'0'.repeat(64)}`, base64: 'AAAA' }] };
    return topology;
  };
  assert.doesNotThrow(() => createProject(withAsset(1, 1)));
  // 8192 * 2048 is exactly the 16 Mpx ceiling, so each edge and the product are checked apart.
  assert.doesNotThrow(() => createProject(withAsset(8192, 2048)));
  assert.throws(() => createProject(withAsset(0, 1)), /asset is invalid/);
  assert.throws(() => createProject(withAsset(8193, 1)), /asset is invalid/);
  assert.throws(() => createProject(withAsset(8192, 2049)), /asset is invalid/);
});

test('keeps drawio port options inside their ranges and rejects the first value outside', () => {
  const withOptions = (drawioOptions) => {
    const topology = cloneTopology();
    topology.diagram = { shapes: [{ id: 'note-1', kind: 'note', text: '라벨', x: 0, y: 0, width: 40, height: 20, drawioOptions }], connectors: [], groups: [] };
    return topology;
  };
  for (const entryX of [0, 1]) assert.doesNotThrow(() => createProject(withOptions({ entryX })));
  for (const entryX of [-0.1, 1.1]) assert.throws(() => createProject(withOptions({ entryX })), /port option is invalid/);
  for (const startSize of [1, 100]) assert.doesNotThrow(() => createProject(withOptions({ startSize })));
  for (const startSize of [0, 101]) assert.throws(() => createProject(withOptions({ startSize })), /port option is invalid/);
  assert.doesNotThrow(() => createProject(withOptions({ grIcon: 'a'.repeat(120) })));
  assert.throws(() => createProject(withOptions({ grIcon: 'a'.repeat(121) })), /group icon is invalid/);
});

test('takes a device visual label at its length limit and rejects one character more', () => {
  const withText = (text) => {
    const topology = cloneTopology();
    topology.devices[0].drawioVisual = { width: 100, height: 50, drawioShape: 'rect', text };
    return topology;
  };
  assert.doesNotThrow(() => createProject(withText('a'.repeat(10000))));
  assert.throws(() => createProject(withText('a'.repeat(10001))), /visual text is invalid/);
});

test('takes the one value each label run style allows and refuses any other', () => {
  const withRun = (run) => {
    const topology = cloneTopology();
    topology.diagram = { shapes: [{ id: 'note-1', kind: 'note', text: '라벨', x: 0, y: 0, width: 40, height: 20, labelRuns: [[{ text: 'a', ...run }]] }], connectors: [], groups: [] };
    return topology;
  };
  for (const [key, allowed, rejected, message] of [
    ['fontWeight', '700', '400', /label weight is invalid/],
    ['fontStyle', 'italic', 'oblique', /label style is invalid/],
    ['textDecoration', 'underline', 'line-through', /label decoration is invalid/],
  ]) {
    assert.doesNotThrow(() => createProject(withRun({ [key]: allowed })));
    assert.throws(() => createProject(withRun({ [key]: rejected })), message);
  }
});
