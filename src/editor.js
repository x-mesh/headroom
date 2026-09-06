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
    ...(input.ports ? { ports: structuredClone(input.ports) } : {}),
    ...(input.external != null ? { external: Boolean(input.external) } : {}),
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
  if (patch.metadata) device.metadata = structuredClone(patch.metadata);
  if (patch.ports) device.ports = structuredClone(patch.ports);
  if (patch.external != null) device.external = Boolean(patch.external);
  return device;
}

export function moveDevice(topology, id, position) {
  return updateDevice(topology, id, { position });
}

// 데이터시트 값과 사용자 보정을 둘 다 남긴다(PRD P1-13). spec.limits 가 원본,
// overrides 가 보정, limits 가 계산에 쓰이는 실효값이다. 원본을 잃으면 되돌릴 수 없다.
function applyEffectiveLimits(device) {
  const base = device.spec?.limits || {};
  const overrides = device.overrides || {};
  const axes = new Set([...Object.keys(base), ...Object.keys(device.limits || {})]);
  const limits = {};
  for (const axis of axes) {
    limits[axis] = Object.hasOwn(overrides, axis) ? overrides[axis] : (base[axis] ?? null);
  }
  device.limits = limits;
  return device;
}

/** 카탈로그 프로필을 장비에 붙인다. 보정은 유지되며, 프로필에 없는 축의 보정은 버려진다. */
export function applySpec(topology, id, spec) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) throw new Error(`Device ${id} does not exist`);
  if (!spec) { delete device.spec; delete device.overrides; return device; }
  const limits = normalizeLimits(spec.limits || {});
  device.spec = {
    ...structuredClone(spec),
    catalogId: String(spec.catalogId), profileId: String(spec.profileId),
    profileLabel: String(spec.profileLabel || spec.profileId), limits,
    ...(spec.note ? { note: String(spec.note).slice(0, 400) } : {}),
  };
  if (spec.vendor) device.vendor = String(spec.vendor).trim().slice(0, 24);
  if (spec.model) device.model = String(spec.model).trim().slice(0, 40);
  if (spec.source) device.source = structuredClone(spec.source);
  if (device.overrides) {
    for (const axis of Object.keys(device.overrides)) {
      if (!Object.hasOwn(limits, axis)) delete device.overrides[axis];
    }
    if (!Object.keys(device.overrides).length) delete device.overrides;
  }
  return applyEffectiveLimits(device);
}

/** 축 하나를 보정한다. null 이나 빈 값이면 데이터시트 값으로 되돌린다. */
export function setLimitOverride(topology, id, axis, value) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) throw new Error(`Device ${id} does not exist`);
  if (!device.spec) throw new Error(`Device ${id} has no datasheet value to override`);
  if (!Object.hasOwn(device.spec.limits, axis)) throw new Error(`${axis} is not part of this profile`);
  if (value === null || value === '') {
    if (device.overrides) { delete device.overrides[axis]; if (!Object.keys(device.overrides).length) delete device.overrides; }
  } else {
    device.overrides = { ...device.overrides, [axis]: finite(value, axis, { min: Number.EPSILON }) };
  }
  return applyEffectiveLimits(device);
}

export function removeDevice(topology, id) {
  if (!deviceIds(topology).has(id)) throw new Error(`Device ${id} does not exist`);
  const removedLinks = new Set(topology.links.filter((link) => link.source === id || link.target === id).map(({ id: linkId }) => linkId));
  topology.devices = topology.devices.filter((device) => device.id !== id);
  topology.links = topology.links.filter((link) => !removedLinks.has(link.id));
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
  const id = requireId(input.id || `${source}-${target}`, 'Link');
  if (linkIds(topology).has(id)) throw new Error(`Link ${id} already exists`);
  const link = { id, source, target, capacity: { forwarding_bps: finite(input.capacityBps ?? 10e9, 'Link capacity', { min: Number.EPSILON }) }, enabled: true };
  for (const side of ['source', 'target']) {
    if (!input[`${side}Port`]) continue;
    const portId = String(input[`${side}Port`]);
    const owner = topology.devices.find(({ id: deviceId }) => deviceId === link[side]);
    if (!owner.ports?.some(({ id: port }) => port === portId)) throw new Error(`Port ${portId} does not exist`);
    if (topology.links.some((item) => ['source', 'target'].some((end) => item[end] === owner.id && item[`${end}Port`] === portId))) throw new Error(`Port ${portId} is already connected`);
    link[`${side}Port`] = portId;
  }
  topology.links.push(link);
  return link;
}

export function updateLink(topology, id, patch) {
  const link = topology.links.find((item) => item.id === id);
  if (!link) throw new Error(`Link ${id} does not exist`);
  const next = structuredClone(link);
  if (patch.capacityBps != null) next.capacity.forwarding_bps = finite(patch.capacityBps, 'Link capacity', { min: Number.EPSILON });
  for (const side of ['source', 'target']) {
    if (!Object.hasOwn(patch, `${side}Port`)) continue;
    const portId = patch[`${side}Port`];
    if (!portId) { delete next[`${side}Port`]; continue; }
    const owner = topology.devices.find((device) => device.id === next[side]);
    if (!owner?.ports?.some(({ id: port }) => port === portId)) throw new Error(`Port ${portId} does not exist`);
    if (topology.links.some((item) => item.id !== id && ['source', 'target'].some((end) => item[end] === owner.id && item[`${end}Port`] === portId))) throw new Error(`Port ${portId} is already connected`);
    next[`${side}Port`] = portId;
  }
  for (const side of ['source', 'target']) delete link[`${side}Port`];
  Object.assign(link, next);
  return link;
}

export function removeLink(topology, id) {
  if (!linkIds(topology).has(id)) throw new Error(`Link ${id} does not exist`);
  topology.links = topology.links.filter((link) => link.id !== id);
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

// 백엔드 풀은 기본이 자동이다. 'single' 은 이 장비 한 대만 쓰겠다는 뜻이고, 목록을 주면 그 목록이 풀이다.
function normalizeBackendPool(pool, devices) {
  if (pool == null || pool === 'auto') return null;
  if (pool === 'single') return 'single';
  if (!Array.isArray(pool?.memberIds)) throw new Error('Backend pool must be auto, single, or a member list');
  const memberIds = [...new Set(pool.memberIds.map((member) => requireId(member, 'Backend pool member')))].sort();
  for (const memberId of memberIds) if (!devices.has(memberId)) throw new Error(`Backend pool member ${memberId} must exist`);
  return memberIds.length ? { memberIds } : null;
}

export function updateDemand(topology, id, patch) {
  const demand = topology.demands.find((item) => item.id === id);
  if (!demand) throw new Error(`Demand ${id} does not exist`);
  const devices = deviceIds(topology);
  const endpointsChanged = ['source', 'target'].some((key) => patch[key] != null && normalizeId(patch[key]) !== demand[key]);
  for (const endpoint of ['source', 'target']) if (patch[endpoint] != null) {
    const value = requireId(patch[endpoint], `Demand ${endpoint}`);
    if (!devices.has(value) && value !== demand[endpoint]) throw new Error(`Demand ${endpoint} must exist`);
    demand[endpoint] = value;
  }
  if (demand.source === demand.target) throw new Error('Demand source and target must differ');
  // 끝점이 바뀌면 손으로 고른 백엔드 목록은 다른 설계의 것이 된다. 자동 판정으로 되돌린다.
  if (endpointsChanged) { delete demand.paths; demand.pathMode = 'shortest'; if (Array.isArray(demand.backendPool?.memberIds)) delete demand.backendPool; }
  if (patch.backendPool !== undefined) demand.backendPool = normalizeBackendPool(patch.backendPool, devices);
  if (demand.backendPool == null) delete demand.backendPool;
  if (patch.name != null) demand.name = String(patch.name).trim().slice(0, 80) || demand.name;
  if (patch.load) for (const [axis, value] of Object.entries(patch.load)) demand.load[axis] = finite(value, axis);
  for (const [forwarding, nic] of [['forwarding_bps', 'nic_bps'], ['forwarding_pps', 'nic_pps']]) {
    if (patch.load && Object.hasOwn(patch.load, forwarding) && !Object.hasOwn(patch.load, nic)) delete demand.load[nic];
    if (patch.load && Object.hasOwn(patch.load, nic) && !Object.hasOwn(patch.load, forwarding)) delete demand.load[forwarding];
  }
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
