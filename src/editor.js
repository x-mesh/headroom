const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  if (patch.position) device.position = { x: finite(patch.position.x, 'Device x', ANY_COORDINATE), y: finite(patch.position.y, 'Device y', ANY_COORDINATE) };
  if (patch.limits) {
    for (const [axis, value] of Object.entries(patch.limits)) {
      device.limits[axis] = value === null || value === '' ? null : finite(value, axis, { min: Number.EPSILON });
    }
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
  return demand;
}

export function removeDemand(topology, id) {
  if (!topology.demands.some((demand) => demand.id === id)) throw new Error(`Demand ${id} does not exist`);
  topology.demands = topology.demands.filter((demand) => demand.id !== id);
}

export function createEmptyTopology(name = 'Untitled topology') {
  return { schemaVersion: 1, name, synthetic: false, warningThreshold: 0.8, devices: [], links: [], demands: [] };
}
