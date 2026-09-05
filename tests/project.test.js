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
  assert.throws(() => parseProject({ ...project, schemaVersion: 3 }), /newer/);
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
  assert.equal(project.schemaVersion, 2);
  assert.equal(project.migratedFrom, 1);
  // 값을 바꾸지 않는다. 라벨이 맞고 엔진이 틀렸던 것이므로 숫자는 그대로다.
  assert.equal(project.topology.links[0].capacity.forwarding_bps, legacy.topology.links[0].capacity.forwarding_bps);
  assert.deepEqual(project.notices.map(({ code }) => code), ['link-capacity-reinterpreted']);
  assert.equal(parseProject(createProject(cloneTopology())).notices, undefined);
});
