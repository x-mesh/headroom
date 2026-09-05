import { calculateScenario } from './engine.js';

export const PROJECT_SCHEMA_VERSION = 1;

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
  if (input.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    if (Number(input.schemaVersion) > PROJECT_SCHEMA_VERSION) throw new Error(`Project schema ${input.schemaVersion} is newer than supported schema ${PROJECT_SCHEMA_VERSION}`);
    throw new Error(`Unsupported project schema ${input.schemaVersion}`);
  }
  if (input.product !== 'Rack Mesh') throw new Error('Project product must be Rack Mesh');
  if (!plainObject(input.topology)) throw new Error('Project topology is required');
  const topology = structuredClone(input.topology);
  if (!Array.isArray(topology.devices) || !Array.isArray(topology.links) || !Array.isArray(topology.demands)) throw new Error('Topology requires devices, links, and demands');
  for (const device of topology.devices) { validId(device.id, 'Device'); boundedText(device.name, 'Device name'); boundedText(device.kind, 'Device kind'); boundedText(device.zone, 'Device zone'); }
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
    schemaVersion: PROJECT_SCHEMA_VERSION, product: 'Rack Mesh', topology,
    scenario: { scale, disabledDevices, disabledLinks, selectedId: scenario.selectedId == null ? null : String(scenario.selectedId) },
  };
}

export function parseProject(value) {
  let input = value;
  if (typeof value === 'string') {
    try { input = JSON.parse(value); } catch { throw new Error('Project file is not valid JSON'); }
  }
  return validateProject(input);
}

export function serializeProject(topology, scenario) {
  return JSON.stringify(createProject(topology, scenario), null, 2);
}
