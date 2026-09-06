import { behaviorCatalog } from './data.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
// 장비가 스스로 선언하는 세션 동기화. topology.haGroups 의 sessionSync('stateful' | 'none')는
// HA 쌍의 정책이라 어휘가 다르고, 폭증 계산에 쓰이는 쪽은 그룹이다.
const SESSION_SYNC = new Set(['synced', 'none', 'unknown']);

// 카탈로그를 통과한 조합만 남긴다. 모드를 갖지 않는 클래스에는 behavior 를 붙이지 않는다.
function normalizeBehavior(kind, behavior) {
  const catalog = behaviorCatalog[kind];
  if (!catalog) return null;
  const mode = behavior?.mode ?? catalog.default;
  if (!catalog.options[mode]) throw new Error(`${kind} does not support mode ${mode}`);
  const sessionSync = behavior?.sessionSync ?? 'unknown';
  if (!SESSION_SYNC.has(sessionSync)) throw new Error(`Unknown session sync ${sessionSync}`);
  return { mode, sessionSync };
}

// 제조사와 모델은 제품 식별용 사실이다(PRD 8절). 로고는 저장소에 두지 않고
// 프로젝트 파일 안의 data URI 로만 받는다. 외부 URL 은 앱의 무의존 원칙을 깬다.
const LOGO_LIMIT = 24 * 1024;
function normalizeVendorLogo(value) {
  if (value == null || value === '') return null;
  const logo = String(value).trim();
  if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(logo)) {
    throw new Error('Vendor logo must be a base64 data URI for an image');
  }
  if (logo.length > LOGO_LIMIT) throw new Error(`Vendor logo must stay under ${LOGO_LIMIT / 1024}KB`);
  return logo;
}

function normalizeDirectionality(directionality) {
  if (!directionality) return null;
  const responseShare = finite(directionality.responseShare, 'Response share', { min: 0 });
  if (responseShare > 1) throw new Error('Response share must be between 0 and 1');
  return { responseShare, origin: directionality.origin === 'explicit' ? 'explicit' : 'estimate' };
}

export function normalizeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

function requireId(value, label) {
  const id = normalizeId(value);
  if (!ID_PATTERN.test(id)) throw new Error(`${label} ID must use lowercase letters, numbers, and hyphens`);
  return id;
}

function finite(value, label, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) throw new Error(`${label} must be at least ${min}`);
  return number;
}

const ANY_COORDINATE = { min: -Number.MAX_VALUE };

function deviceIds(topology) { return new Set(topology.devices.map(({ id }) => id)); }
function linkIds(topology) { return new Set(topology.links.map(({ id }) => id)); }
function normalizeLimits(limits) {
  return Object.fromEntries(Object.entries(limits || {}).map(([axis, value]) => [axis, value === null || value === '' ? null : finite(value, axis, { min: Number.EPSILON })]));
}

export function addDevice(topology, input) {
  const id = requireId(input.id || input.name, 'Device');
  if (deviceIds(topology).has(id)) throw new Error(`Device ${id} already exists`);
  const device = {
    id, name: String(input.name || id).trim().slice(0, 80) || id,
    kind: String(input.kind || 'switch'), zone: String(input.zone || 'UNASSIGNED').trim().slice(0, 80) || 'UNASSIGNED',
    position: { x: finite(input.position?.x ?? 470, 'Device x', ANY_COORDINATE), y: finite(input.position?.y ?? 290, 'Device y', ANY_COORDINATE) },
    limits: normalizeLimits(input.limits || { forwarding_bps: null, forwarding_pps: null }),
    source: input.source || { type: 'estimate', label: '사용자 정의', condition: '조건 미지정' }, enabled: true,
    ...(input.vendor ? { vendor: String(input.vendor).trim().slice(0, 24) } : {}),
    ...(input.model ? { model: String(input.model).trim().slice(0, 40) } : {}),
    ...(normalizeVendorLogo(input.vendorLogo) ? { vendorLogo: normalizeVendorLogo(input.vendorLogo) } : {}),
    ...(normalizeBehavior(String(input.kind || 'switch'), input.behavior) ? { behavior: normalizeBehavior(String(input.kind || 'switch'), input.behavior) } : {}),
    ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}),
  };
  topology.devices.push(device);
  return device;
}

export function updateDevice(topology, id, patch) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) throw new Error(`Device ${id} does not exist`);
  if (patch.name != null) device.name = String(patch.name).trim().slice(0, 80) || device.name;
  if (patch.kind != null) device.kind = String(patch.kind);
  if (patch.zone != null) device.zone = String(patch.zone).trim().slice(0, 80) || 'UNASSIGNED';
  for (const [field, limit] of [['vendor', 24], ['model', 40]]) {
    if (patch[field] == null) continue;
    const value = String(patch[field]).trim().slice(0, limit);
    if (value) device[field] = value; else delete device[field];
  }
  if (patch.vendorLogo != null) {
    const logo = normalizeVendorLogo(patch.vendorLogo);
    if (logo) device.vendorLogo = logo; else delete device.vendorLogo;
  }
  if (patch.position) device.position = { x: finite(patch.position.x, 'Device x', ANY_COORDINATE), y: finite(patch.position.y, 'Device y', ANY_COORDINATE) };
  if (patch.limits) {
    for (const [axis, value] of Object.entries(patch.limits)) {
      device.limits[axis] = value === null || value === '' ? null : finite(value, axis, { min: Number.EPSILON });
    }
  }
  if (patch.behavior || patch.kind != null) {
    const behavior = normalizeBehavior(device.kind, patch.behavior ?? device.behavior);
    if (behavior) device.behavior = behavior;
    else delete device.behavior;
  }
  return device;
}

export function moveDevice(topology, id, position) {
  return updateDevice(topology, id, { position });
}

export function removeDevice(topology, id) {
  if (!deviceIds(topology).has(id)) throw new Error(`Device ${id} does not exist`);
  const removedLinks = new Set(topology.links.filter((link) => link.source === id || link.target === id).map(({ id: linkId }) => linkId));
  topology.devices = topology.devices.filter((device) => device.id !== id);
  topology.links = topology.links.filter((link) => !removedLinks.has(link.id));
  topology.demands = topology.demands.filter((demand) => {
    if (demand.source === id || demand.target === id) return false;
    if (demand.paths) demand.paths = demand.paths.filter((path) => !path.devices.includes(id) && path.links.every((linkId) => !removedLinks.has(linkId)));
    return !demand.paths || demand.paths.length > 0;
  });
  // HA 그룹에 남은 멤버 id 는 검증에서 걸려 이후 계산 전체를 멈춘다.
  if (Array.isArray(topology.haGroups)) {
    topology.haGroups = topology.haGroups
      .map((group) => (group.members?.includes(id) ? { ...group, members: group.members.filter((member) => member !== id) } : group))
      .filter((group) => group.members?.length);
  }
  return { removedDeviceId: id, removedLinkIds: [...removedLinks] };
}

export function addLink(topology, input) {
  const devices = deviceIds(topology);
  const source = requireId(input.source, 'Source');
  const target = requireId(input.target, 'Target');
  if (source === target) throw new Error('A link requires two different devices');
  if (!devices.has(source) || !devices.has(target)) throw new Error('Link endpoints must exist');
  if (topology.links.some((link) => (link.source === source && link.target === target) || (link.source === target && link.target === source))) {
    throw new Error(`A link between ${source} and ${target} already exists`);
  }
  const id = requireId(input.id || `${source}-${target}`, 'Link');
  if (linkIds(topology).has(id)) throw new Error(`Link ${id} already exists`);
  const link = { id, source, target, capacity: { forwarding_bps: finite(input.capacityBps ?? 10e9, 'Link capacity', { min: Number.EPSILON }) }, enabled: true };
  topology.links.push(link);
  return link;
}

export function updateLink(topology, id, patch) {
  const link = topology.links.find((item) => item.id === id);
  if (!link) throw new Error(`Link ${id} does not exist`);
  if (patch.capacityBps != null) link.capacity.forwarding_bps = finite(patch.capacityBps, 'Link capacity', { min: Number.EPSILON });
  return link;
}

export function removeLink(topology, id) {
  if (!linkIds(topology).has(id)) throw new Error(`Link ${id} does not exist`);
  topology.links = topology.links.filter((link) => link.id !== id);
  topology.demands = topology.demands.filter((demand) => {
    if (demand.paths) demand.paths = demand.paths.filter((path) => !path.links.includes(id));
    return !demand.paths || demand.paths.length > 0;
  });
}

export function addDemand(topology, input) {
  const id = requireId(input.id || input.name, 'Demand');
  if (topology.demands.some((demand) => demand.id === id)) throw new Error(`Demand ${id} already exists`);
  const devices = deviceIds(topology);
  const source = requireId(input.source, 'Demand source');
  const target = requireId(input.target, 'Demand target');
  if (source === target) throw new Error('Demand source and target must differ');
  if (!devices.has(source) || !devices.has(target)) throw new Error('Demand endpoints must exist');
  const load = {};
  for (const [axis, value] of Object.entries(input.load || {})) load[axis] = finite(value, axis);
  if (!Object.keys(load).length) throw new Error('Demand requires at least one load axis');
  const demand = { id, name: String(input.name || id).trim().slice(0, 80) || id, source, target, load, pathMode: 'shortest' };
  topology.demands.push(demand);
  return demand;
}

export function updateDemand(topology, id, patch) {
  const demand = topology.demands.find((item) => item.id === id);
  if (!demand) throw new Error(`Demand ${id} does not exist`);
  const devices = deviceIds(topology);
  for (const endpoint of ['source', 'target']) if (patch[endpoint] != null) {
    const value = requireId(patch[endpoint], `Demand ${endpoint}`);
    if (!devices.has(value)) throw new Error(`Demand ${endpoint} must exist`);
    demand[endpoint] = value;
  }
  if (demand.source === demand.target) throw new Error('Demand source and target must differ');
  if (patch.source != null || patch.target != null) { delete demand.paths; demand.pathMode = 'shortest'; }
  if (patch.name != null) demand.name = String(patch.name).trim().slice(0, 80) || demand.name;
  if (patch.load) for (const [axis, value] of Object.entries(patch.load)) demand.load[axis] = finite(value, axis);
  if (patch.directionality) demand.directionality = normalizeDirectionality(patch.directionality);
  return demand;
}

export function removeDemand(topology, id) {
  if (!topology.demands.some((demand) => demand.id === id)) throw new Error(`Demand ${id} does not exist`);
  topology.demands = topology.demands.filter((demand) => demand.id !== id);
}

export function createEmptyTopology(name = 'Untitled topology') {
  return { schemaVersion: 1, name, synthetic: false, warningThreshold: 0.8, devices: [], links: [], demands: [] };
}
