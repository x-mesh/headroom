import { calculateScenario } from './engine.js';

export const PROJECT_SCHEMA_VERSION = 2;
const SUPPORTED_SCHEMAS = new Set([1, 2]);

// v1 은 링크 용량을 양방향 합산으로 읽히던 파일이다. 숫자는 그대로 두고 의미만 바로잡는다.
// 인스펙터가 처음부터 그 입력을 방향별 용량이라고 라벨링해 왔으므로 값이 틀린 게 아니다.
function migrationNotices(schemaVersion) {
  if (schemaVersion !== 1) return [];
  return [{
    code: 'link-capacity-reinterpreted',
    message: '링크 용량을 방향별 값으로 해석합니다. 양방향 트래픽이 흐르는 링크의 사용률이 이전보다 낮게 표시됩니다.',
  }];
}

function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
function validId(value, label) { if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`${label} has an invalid ID`); }
function boundedText(value, label) { if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new Error(`${label} must be 1 to 80 characters`); if (/[<>]/.test(value)) throw new Error(`${label} cannot contain HTML markup`); }
function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`);
  return [...new Set(value)];
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
  for (const device of topology.devices) {
    validId(device.id, 'Device'); boundedText(device.name, 'Device name'); boundedText(device.kind, 'Device kind'); boundedText(device.zone, 'Device zone');
    if (device.vendor != null) boundedText(device.vendor, 'Device vendor');
    if (device.model != null) boundedText(device.model, 'Device model');
    // 로고는 프로젝트 파일과 함께 들어오므로 크기를 여기서도 막는다.
    if (device.vendorLogo != null && (typeof device.vendorLogo !== 'string' || device.vendorLogo.length > 24 * 1024 || !device.vendorLogo.startsWith('data:image/'))) {
      throw new Error('Device vendor logo must be an image data URI under 24KB');
    }
  }
  for (const link of topology.links) { validId(link.id, 'Link'); validId(link.source, 'Link source'); validId(link.target, 'Link target'); }
  for (const demand of topology.demands) { validId(demand.id, 'Demand'); boundedText(demand.name, 'Demand name'); if (demand.source) validId(demand.source, 'Demand source'); if (demand.target) validId(demand.target, 'Demand target'); }
  const scenario = plainObject(input.scenario) ? input.scenario : {};
  const scale = Number(scenario.scale ?? 1);
  if (!Number.isFinite(scale) || scale < 0) throw new Error('Project scale must be a non-negative number');
  const disabledDevices = stringArray(scenario.disabledDevices || [], 'disabledDevices');
  const disabledLinks = stringArray(scenario.disabledLinks || [], 'disabledLinks');
  const deviceIds = new Set((topology.devices || []).map(({ id }) => id));
  const linkIds = new Set((topology.links || []).map(({ id }) => id));
  if (disabledDevices.some((id) => !deviceIds.has(id))) throw new Error('disabledDevices contains an unknown device');
  if (disabledLinks.some((id) => !linkIds.has(id))) throw new Error('disabledLinks contains an unknown link');
  calculateScenario(topology, { scale, disabledDevices, disabledLinks });
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION, product: 'Rack Mesh',
    ...(input.schemaVersion === PROJECT_SCHEMA_VERSION ? {} : { migratedFrom: input.schemaVersion }),
    topology,
    scenario: { scale, disabledDevices, disabledLinks, selectedId: scenario.selectedId == null ? null : String(scenario.selectedId) },
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
