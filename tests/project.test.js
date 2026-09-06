import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { calculateScenario } from '../src/engine.js';
import { createProject, parseProject, serializeProject } from '../src/project.js';

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
  topology.failureDomains = [{ id: 'rack-a', deviceIds: [topology.devices[0].id], linkIds: [] }];
  topology.template = { id: 'capacity-lab', learning: ['장애 후 여유 확인'] };
  const scenario = { disabledDomains: ['rack-a'], viewMode: 'verify', baseline: { topology: structuredClone(topology), scenario: { scale: 0.5 } }, namedScenarios: [{ id: 'peak', name: '최대 부하', scenario: { scale: 2 } }] };
  const restored = parseProject(serializeProject(topology, scenario));
  assert.deepEqual(restored, createProject(topology, scenario));
  assert.deepEqual(restored.topology.diagram, topology.diagram);
  assert.equal(restored.scenario.baseline.scenario.scale, 0.5);
  assert.equal(restored.scenario.namedScenarios[0].scenario.scale, 2);
  assert.equal(parseProject({ ...createProject(cloneTopology()), schemaVersion: 2 }).notices[0].code, 'evidence-unverified');
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
