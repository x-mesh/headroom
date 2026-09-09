import { calculateScenario } from './engine.js';
import { validateEvidenceRecords } from './evidence.js';
import { OBSERVED_LOAD_AGGREGATES } from './measured-import.js';
import { failureDomainKinds } from './data.js';

export const PROJECT_SCHEMA_VERSION = 3;
const SUPPORTED_SCHEMAS = new Set([1, 2, 3]);

// v1 은 링크 용량을 양방향 합산으로 읽히던 파일이다. 숫자는 그대로 두고 의미만 바로잡는다.
// 인스펙터가 처음부터 그 입력을 방향별 용량이라고 라벨링해 왔으므로 값이 틀린 게 아니다.
function migrationNotices(schemaVersion) {
  if (schemaVersion === 3) return [];
  return [...(schemaVersion === 1 ? [{
    code: 'link-capacity-reinterpreted',
    message: '링크 용량을 방향별 값으로 해석합니다. 양방향 트래픽이 흐르는 링크의 사용률이 이전보다 낮게 표시됩니다.',
  }] : []), { code: 'evidence-unverified', message: '기존 수치는 보존했습니다. 구조화된 측정 근거가 없는 값의 적용 조건은 미확인입니다.' }];
}

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
function validId(value, label) { if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${label} has an invalid ID`); }
function boundedText(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new Error(`${label} must be 1 to 80 characters`); if (/[<>]/.test(value)) throw new Error(`${label} cannot contain HTML markup`); }
function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`);
  return [...new Set(value)];
}
function validatePhysicalSpec(value) {
  if (!plainObject(value)) throw new Error('Device physical spec must be an object');
  const allowed = new Set(['powerBasis', 'maximumDrawWatts', 'typicalDrawWatts', 'measuredDrawWatts', 'uHeight', 'source']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Device physical spec has unknown fields');
  if (value.powerBasis != null && !['nameplate', 'typical', 'measured'].includes(value.powerBasis)) throw new Error('Device physical spec has an invalid power basis');
  for (const key of ['maximumDrawWatts', 'typicalDrawWatts', 'measuredDrawWatts', 'uHeight']) {
    if (value[key] != null && (!Number.isFinite(value[key]) || value[key] < 0)) throw new Error(`Device physical spec requires a non-negative ${key}`);
  }
  if (value.source != null) {
    if (!plainObject(value.source) || Object.keys(value.source).some((key) => !['label', 'locator'].includes(key))) throw new Error('Device physical spec source is invalid');
    for (const [key, item] of Object.entries(value.source)) boundedText(item, `Device physical spec source ${key}`);
  }
}

// 새 문서 영역은 임의 HTML, 이벤트 속성, 실행 코드를 저장하지 않는다.
function safeContent(value, label = 'Document', depth = 0) {
  if (depth > 30) throw new Error(`${label} is too deeply nested`);
  if (typeof value === 'string' && (/[<>]/.test(value) || /^\s*(javascript|vbscript):/i.test(value))) throw new Error(`${label} cannot contain executable markup`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} requires finite numbers`);
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor', 'html', 'innerHTML', 'script'].includes(key) || /^on[a-z]+$/i.test(key)) throw new Error(`${label} contains unsafe content: ${key}`);
    safeContent(item, label, depth + 1);
  }
}
function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) { validId(item.id, label); if (ids.has(item.id)) throw new Error(`${label} contains duplicate ID ${item.id}`); ids.add(item.id); }
  return ids;
}
function validateDiagram(diagram, deviceIds) {
  if (!plainObject(diagram)) throw new Error('Diagram must be an object');
  if (Object.keys(diagram).some((key) => !['shapes', 'connectors', 'groups'].includes(key))) throw new Error('Unknown diagram content');
  for (const key of ['shapes', 'connectors', 'groups']) if (!Array.isArray(diagram[key])) throw new Error(`Diagram requires ${key}`);
  safeContent(diagram, 'Diagram');
  const ids = uniqueIds([...diagram.shapes, ...diagram.connectors, ...diagram.groups], 'Diagram');
  for (const id of deviceIds) if (ids.has(id)) throw new Error('Diagram and device IDs must be distinct');
  const endpoints = new Set([...deviceIds, ...diagram.shapes.map(({ id }) => id)]);
  for (const shape of diagram.shapes) {
    if (Object.keys(shape).some((key) => !['id', 'kind', 'type', 'text', 'x', 'y', 'width', 'height', 'fill', 'gradientColor', 'stroke', 'lineStyle', 'textColor', 'strokeWidth', 'opacity', 'fontSize', 'textAlign', 'verticalAlign', 'fontWeight', 'gradient', 'rounded', 'sketch', 'glass', 'shadow', 'groupId', 'unmapped', 'locked'].includes(key))) throw new Error('Unknown diagram shape content');
    if (!['rectangle', 'ellipse', 'text', 'note', 'rect'].includes(shape.kind ?? shape.type)) throw new Error('Unknown diagram shape type');
    for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(shape[key]) || (['width', 'height'].includes(key) && shape[key] <= 0)) throw new Error(`Diagram shape requires valid ${key}`);
    if (shape.text != null && (typeof shape.text !== 'string' || shape.text.length > 10000)) throw new Error('Diagram text must be under 10000 characters');
    if (shape.locked != null && typeof shape.locked !== 'boolean') throw new Error('Diagram shape lock must be boolean');
  }
  for (const connector of diagram.connectors) {
    if (Object.keys(connector).some((key) => !['id', 'source', 'target', 'kind', 'label', 'text', 'points', 'waypoints', 'stroke', 'strokeWidth', 'dashed', 'startArrow', 'endArrow', 'locked'].includes(key))) throw new Error('Unknown diagram connector content');
    if (connector.kind != null && !['annotation', 'dependency'].includes(connector.kind)) throw new Error('Unknown diagram connector kind');
    if (!endpoints.has(connector.source) || !endpoints.has(connector.target)) throw new Error('Diagram connector references an unknown endpoint');
    const points = connector.waypoints ?? connector.points;
    if (points != null && (!Array.isArray(points) || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error('Diagram connector points must be coordinates');
    if (connector.locked != null && typeof connector.locked !== 'boolean') throw new Error('Diagram connector lock must be boolean');
  }
  const groupIds = new Set(diagram.groups.map(({ id }) => id));
  for (const group of diagram.groups) {
    if (Object.keys(group).some((key) => !['id', 'name', 'memberIds', 'locked'].includes(key))) throw new Error('Unknown diagram group content');
    boundedText(group.name, 'Group name');
    if (!Array.isArray(group.memberIds) || group.memberIds.some((id) => !endpoints.has(id))) throw new Error('Diagram group references an unknown member');
    if (group.locked != null && typeof group.locked !== 'boolean') throw new Error('Diagram group lock must be boolean');
  }
  for (const shape of diagram.shapes) if (shape.groupId != null && !groupIds.has(shape.groupId)) throw new Error('Diagram shape references an unknown group');
}

export function createProject(topology, scenario = {}) {
  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION, product: 'Rack Mesh',
    topology: structuredClone(topology),
    scenario: {
      scale: scenario.scale ?? 1,
      disabledDevices: [...(scenario.disabledDevices || [])],
      disabledLinks: [...(scenario.disabledLinks || [])],
      selectedId: scenario.selectedId || null,
      disabledDomains: [...(scenario.disabledDomains || [])],
      viewMode: scenario.viewMode ?? 'edit',
      ...(scenario.baseline ? { baseline: structuredClone(scenario.baseline) } : {}),
      ...(scenario.namedScenarios ? { namedScenarios: structuredClone(scenario.namedScenarios) } : {}),
    },
  };
  return validateProject(project);
}

export function validateProject(input) {
  if (!plainObject(input)) throw new Error('Project must be an object');
  if (!SUPPORTED_SCHEMAS.has(input.schemaVersion)) {
    if (Number(input.schemaVersion) > PROJECT_SCHEMA_VERSION) throw new Error(`Project schema ${input.schemaVersion} is newer than supported schema ${PROJECT_SCHEMA_VERSION}`);
    throw new Error(`Unsupported project schema ${input.schemaVersion}`);
  }
  if (input.product !== 'Rack Mesh') throw new Error('Project product must be Rack Mesh');
  if (!plainObject(input.topology)) throw new Error('Project topology is required');
  const topology = structuredClone(input.topology);
  if (!Array.isArray(topology.devices) || !Array.isArray(topology.links) || !Array.isArray(topology.demands)) throw new Error('Topology requires devices, links, and demands');
  const deviceIds = uniqueIds(topology.devices, 'Device');
  const linkIds = uniqueIds(topology.links, 'Link');
  uniqueIds(topology.demands, 'Demand');
  if (topology.diagram != null) validateDiagram(topology.diagram, deviceIds);
  for (const key of ['services', 'racks', 'failureDomains']) if (topology[key] != null) {
    if (!Array.isArray(topology[key])) throw new Error(`${key} must be an array`);
    uniqueIds(topology[key], key); safeContent(topology[key], key);
  }
  for (const domain of topology.failureDomains || []) {
    domain.kind ??= 'other';
    if (!failureDomainKinds.includes(domain.kind)) throw new Error('Failure domain kind is unknown');
  }
  for (const key of ['template', 'evidence']) if (topology[key] != null) safeContent(topology[key], key);
  if (topology.measuredImport != null) {
    if (!plainObject(topology.measuredImport)) throw new Error('measuredImport must be an object');
    for (const key of ['applied', 'floors', 'unmatched']) if (!Array.isArray(topology.measuredImport[key])) throw new Error(`measuredImport requires ${key}`);
    safeContent(topology.measuredImport, 'measuredImport');
  }
  if (topology.observedLoad != null) {
    if (!plainObject(topology.observedLoad) || !plainObject(topology.observedLoad.devices) || !plainObject(topology.observedLoad.links)
      || !plainObject(topology.observedLoad.fingerprint) || typeof topology.observedLoad.asOf !== 'string'
      || !OBSERVED_LOAD_AGGREGATES.includes(topology.observedLoad.aggregate)) throw new Error('observedLoad is malformed');
    safeContent(topology.observedLoad, 'observedLoad');
  }
  // 워크로드 조건은 한계값의 적용 가능성을 정하므로 계산 입력이다. 파일에서 그대로 들어온다.
  for (const key of ['workloadConditions', 'workloadScope']) if (topology[key] != null) {
    if (key === 'workloadConditions' && !plainObject(topology[key])) throw new Error('workloadConditions must be an object');
    safeContent(topology[key], key);
  }
  for (const device of topology.devices) {
    validId(device.id, 'Device'); boundedText(device.name, 'Device name'); boundedText(device.kind, 'Device kind'); boundedText(device.zone, 'Device zone');
    if (device.vendor != null) boundedText(device.vendor, 'Device vendor');
    if (device.model != null) boundedText(device.model, 'Device model');
    // 로고는 프로젝트 파일과 함께 들어오므로 크기를 여기서도 막는다.
    if (device.vendorLogo != null && (typeof device.vendorLogo !== 'string' || device.vendorLogo.length > 24 * 1024 || !device.vendorLogo.startsWith('data:image/'))) {
      throw new Error('Device vendor logo must be an image data URI under 24KB');
    }
    if (device.spec != null) {
      boundedText(device.spec.catalogId, 'Device spec catalog'); boundedText(device.spec.profileId, 'Device spec profile');
      if (!plainObject(device.spec.limits)) throw new Error('Device spec requires the datasheet limits it came from');
      if (device.spec.records != null) {
        validateEvidenceRecords(device.spec.records); safeContent(device.spec.records, 'Evidence');
        for (const record of device.spec.records) if (record.value !== device.spec.limits[record.axis]) throw new Error('Evidence does not match the original spec limits');
      }
      if (device.spec.physical != null) validatePhysicalSpec(device.spec.physical);
    }
    // 수락은 근거 digest 문자열이다. 근거가 없으면 무엇을 수락한 것인지 말할 수 없다.
    if (device.accepted != null) {
      if (!plainObject(device.accepted)) throw new Error('Device evidence acceptances must be an object');
      if (!device.spec?.records && !device.metadata?.records) throw new Error('Evidence acceptances need the records they accept');
      for (const [axis, digest] of Object.entries(device.accepted)) {
        boundedText(axis, 'Accepted axis');
        if (typeof digest !== 'string' || !/^fnv1a32:[0-9a-f]{8}$/.test(digest)) throw new Error(`Acceptance for ${axis} must carry an evidence digest`);
      }
    }
    // 보정은 원본과 나란히 실려 온다. 원본이 없으면 무엇을 보정한 것인지 말할 수 없다.
    if (device.overrides != null) {
      if (!plainObject(device.overrides)) throw new Error('Device overrides must be an object');
      if (!device.spec) throw new Error('Device overrides need the datasheet values they correct');
    }
  }
  for (const link of topology.links) { validId(link.id, 'Link'); validId(link.source, 'Link source'); validId(link.target, 'Link target'); }
  for (const demand of topology.demands) { validId(demand.id, 'Demand'); boundedText(demand.name, 'Demand name'); if (demand.source) validId(demand.source, 'Demand source'); if (demand.target) validId(demand.target, 'Demand target'); }
  const scenario = plainObject(input.scenario) ? input.scenario : {};
  const scale = Number(scenario.scale ?? 1);
  if (!Number.isFinite(scale) || scale < 0) throw new Error('Project scale must be a non-negative number');
  const disabledDevices = stringArray(scenario.disabledDevices || [], 'disabledDevices');
  const disabledLinks = stringArray(scenario.disabledLinks || [], 'disabledLinks');
  const disabledDomains = stringArray(scenario.disabledDomains || [], 'disabledDomains');
  const domainIds = new Set((topology.failureDomains || []).map(({ id }) => id));
  if (disabledDomains.some((id) => !domainIds.has(id))) throw new Error('disabledDomains contains an unknown domain');
  const viewMode = scenario.viewMode ?? 'edit';
  if (!['edit', 'verify'].includes(viewMode)) throw new Error('Unknown view mode');
  let baseline;
  if (scenario.baseline != null) {
    if (!plainObject(scenario.baseline) || !plainObject(scenario.baseline.topology)) throw new Error('Baseline requires a topology snapshot');
    if (scenario.baseline.scenario?.baseline || scenario.baseline.scenario?.namedScenarios) throw new Error('Baseline cannot contain nested snapshots');
    const validated = createProject(scenario.baseline.topology, scenario.baseline.scenario || {});
    baseline = { ...structuredClone(scenario.baseline), topology: validated.topology, scenario: validated.scenario };
  }
  let namedScenarios;
  if (scenario.namedScenarios != null) {
    if (!Array.isArray(scenario.namedScenarios)) throw new Error('namedScenarios must be an array');
    uniqueIds(scenario.namedScenarios, 'Scenario');
    namedScenarios = scenario.namedScenarios.map((entry) => {
      boundedText(entry.name, 'Scenario name');
      const state = entry.scenario ?? entry;
      if (state.baseline || state.namedScenarios) throw new Error('Named scenarios cannot contain nested snapshots');
      const validated = createProject(topology, state).scenario;
      return entry.scenario ? { ...structuredClone(entry), scenario: validated } : { ...structuredClone(entry), ...validated };
    });
  }
  if (disabledDevices.some((id) => !deviceIds.has(id))) throw new Error('disabledDevices contains an unknown device');
  if (disabledLinks.some((id) => !linkIds.has(id))) throw new Error('disabledLinks contains an unknown link');
  calculateScenario(topology, { scale, disabledDevices, disabledLinks, disabledDomains });
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, product: 'Rack Mesh',
    ...(input.schemaVersion === PROJECT_SCHEMA_VERSION ? {} : { migratedFrom: input.schemaVersion }),
    topology,
    scenario: { scale, disabledDevices, disabledLinks, disabledDomains, viewMode, selectedId: scenario.selectedId == null ? null : String(scenario.selectedId), ...(baseline ? { baseline } : {}), ...(namedScenarios ? { namedScenarios } : {}) },
  };
}

export function parseProject(value) {
  let input = value;
  if (typeof value === 'string') {
    try { input = JSON.parse(value); } catch { throw new Error('Project file is not valid JSON'); }
  }
  const project = validateProject(input);
  const notices = migrationNotices(input.schemaVersion);
  return notices.length ? { ...project, notices } : project;
}

export function serializeProject(topology, scenario) {
  return JSON.stringify(createProject(topology, scenario), null, 2);
}
