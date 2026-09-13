import { rackUsage } from './engine.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function physical(device) { return device?.spec?.physical ?? device?.metadata ?? null; }
function placementId(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
  return normalized && ID_PATTERN.test(normalized) ? normalized : 'rack-device';
}
function uniquePlacementId(topology, base) {
  const used = new Set((topology.racks || []).flatMap((rack) => (rack.placements || []).map(({ id }) => id)));
  const stem = placementId(base);
  if (!used.has(stem)) return stem;
  for (let index = 2; index < 1000; index += 1) if (!used.has(`${stem}-${index}`)) return `${stem}-${index}`;
  throw new Error('랙 장비 ID를 만들 수 없습니다.');
}

export function placementHeight(topology, placement) {
  const device = placement.deviceId ? topology.devices.find(({ id }) => id === placement.deviceId) : null;
  const value = placement.uHeight ?? physical(device)?.uHeight ?? 1;
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 1;
}

export function rackPlacements(topology, rack) {
  if (Array.isArray(rack.placements)) return rack.placements.map((placement) => ({ ...placement, uHeight: placementHeight(topology, placement) }));
  let startU = 1;
  return (rack.deviceIds || []).flatMap((deviceId) => {
    const device = topology.devices.find(({ id }) => id === deviceId);
    if (!device) return [];
    const uHeight = placementHeight(topology, { deviceId });
    const placement = { id: `mapped-${deviceId}`, deviceId, startU, uHeight };
    startU += uHeight;
    return [placement];
  });
}

export function placementView(topology, placement) {
  const device = placement.deviceId ? topology.devices.find(({ id }) => id === placement.deviceId) : null;
  return {
    ...placement,
    uHeight: placementHeight(topology, placement),
    name: device?.name || placement.name || placement.id,
    model: device?.model || placement.model || '',
    kind: device?.kind || placement.kind || 'other',
    mapped: Boolean(device),
    active: device ? device.active !== false : true,
  };
}

export function materializeRack(topology, rack) {
  if (!Array.isArray(rack.placements)) rack.placements = rackPlacements(topology, rack).map(({ uHeight, ...placement }) => ({ ...placement, uHeight }));
  rack.deviceIds = [...new Set(rack.placements.map(({ deviceId }) => deviceId).filter(Boolean))];
  return rack;
}

function assertPlacement(topology, rack, placement, ignoreId = null) {
  const startU = Number(placement.startU);
  const uHeight = Number(placement.uHeight);
  if (!Number.isInteger(startU) || startU < 1) throw new Error('시작 U는 1 이상의 정수여야 합니다.');
  if (!Number.isInteger(uHeight) || uHeight < 1) throw new Error('장비 높이는 1U 이상의 정수여야 합니다.');
  if (startU + uHeight - 1 > rack.capacityU) throw new Error(`${rack.capacityU}U 랙 범위를 벗어납니다.`);
  const collision = rackPlacements(topology, rack).find((current) => current.id !== ignoreId
    && startU <= current.startU + current.uHeight - 1 && current.startU <= startU + uHeight - 1);
  if (collision) throw new Error(`${placementView(topology, collision).name}과 U 위치가 겹칩니다.`);
}

export function firstFreeStartU(topology, rack, uHeight = 1, ignoreId = null) {
  const height = Math.max(1, Number(uHeight) || 1);
  const occupied = rackPlacements(topology, rack).filter(({ id }) => id !== ignoreId);
  for (let startU = 1; startU + height - 1 <= rack.capacityU; startU += 1) {
    if (!occupied.some((placement) => startU <= placement.startU + placement.uHeight - 1 && placement.startU <= startU + height - 1)) return startU;
  }
  return null;
}

export function nearestFreeStartU(topology, rack, uHeight = 1, preferredStartU = 1, ignoreId = null) {
  const height = Math.max(1, Number(uHeight) || 1);
  const preferred = Math.min(Math.max(1, Math.round(Number(preferredStartU) || 1)), Math.max(1, rack.capacityU - height + 1));
  const occupied = rackPlacements(topology, rack).filter(({ id }) => id !== ignoreId);
  const free = [];
  for (let startU = 1; startU + height - 1 <= rack.capacityU; startU += 1) {
    if (!occupied.some((placement) => startU <= placement.startU + placement.uHeight - 1 && placement.startU <= startU + height - 1)) free.push(startU);
  }
  return free.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)[0] ?? null;
}

export function createRack(topology, input) {
  topology.racks ??= [];
  const name = String(input.name || '').trim();
  if (!name) throw new Error('랙 이름을 입력하세요.');
  const id = placementId(input.id || input.name);
  if (!id || topology.racks.some((rack) => rack.id === id)) throw new Error('같은 이름의 랙이 있습니다.');
  const capacityU = Number(input.capacityU);
  const powerBudgetWatts = Number(input.powerBudgetWatts);
  if (!Number.isInteger(capacityU) || capacityU < 1 || capacityU > 100) throw new Error('랙 공간은 1U에서 100U 사이여야 합니다.');
  if (!Number.isFinite(powerBudgetWatts) || powerBudgetWatts <= 0) throw new Error('전력 예산은 0보다 커야 합니다.');
  if (!['nameplate', 'typical', 'measured'].includes(input.powerBasis || 'nameplate')) throw new Error('전력 기준이 올바르지 않습니다.');
  const rack = { id, name, capacityU, powerBudgetWatts, powerBasis: input.powerBasis || 'nameplate', deviceIds: [], placements: [] };
  topology.racks.push(rack);
  return rack;
}

export function removeRack(topology, rackId) {
  const before = topology.racks?.length || 0;
  topology.racks = (topology.racks || []).filter(({ id }) => id !== rackId);
  if (topology.racks.length === before) throw new Error('삭제할 랙을 찾을 수 없습니다.');
}

export function addMappedPlacement(topology, rackId, input) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  const device = topology.devices.find(({ id }) => id === input.deviceId);
  if (!rack || !device) throw new Error('랙 또는 토폴로지 장비를 찾을 수 없습니다.');
  if ((topology.racks || []).some((item) => rackPlacements(topology, item).some(({ deviceId }) => deviceId === device.id))) throw new Error('이 장비는 이미 랙에 배치되어 있습니다.');
  materializeRack(topology, rack);
  const placement = { id: uniquePlacementId(topology, `mapped-${device.id}`), deviceId: device.id, startU: Number(input.startU), uHeight: Number(input.uHeight) || placementHeight(topology, { deviceId: device.id }) };
  assertPlacement(topology, rack, placement);
  rack.placements.push(placement); rack.deviceIds.push(device.id);
  return placement;
}

export function addStandalonePlacement(topology, rackId, input) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  if (!rack) throw new Error('랙을 찾을 수 없습니다.');
  materializeRack(topology, rack);
  const placement = { id: uniquePlacementId(topology, input.name), name: String(input.name).trim(), kind: String(input.kind || 'other'), model: String(input.model || '').trim(), startU: Number(input.startU), uHeight: Number(input.uHeight), powerWatts: input.powerWatts === '' || input.powerWatts == null ? null : Number(input.powerWatts) };
  if (!placement.name) throw new Error('랙 장비 이름을 입력하세요.');
  if (!Number.isInteger(placement.uHeight) || placement.uHeight < 1) throw new Error('장비 높이는 1U 이상이어야 합니다.');
  if (placement.powerWatts != null && (!Number.isFinite(placement.powerWatts) || placement.powerWatts < 0)) throw new Error('장비 전력은 0 이상이어야 합니다.');
  assertPlacement(topology, rack, placement);
  rack.placements.push(placement);
  return placement;
}

export function updatePlacement(topology, rackId, placementId, input) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  if (!rack) throw new Error('랙을 찾을 수 없습니다.');
  materializeRack(topology, rack);
  const index = rack.placements.findIndex(({ id }) => id === placementId);
  if (index < 0) throw new Error('랙 장비를 찾을 수 없습니다.');
  const current = rack.placements[index];
  const next = { ...current, startU: Number(input.startU), uHeight: Number(input.uHeight) };
  if (!current.deviceId) {
    next.name = String(input.name || current.name).trim(); next.model = String(input.model ?? current.model ?? '').trim(); next.kind = String(input.kind || current.kind).trim(); next.powerWatts = input.powerWatts === '' || input.powerWatts == null ? null : Number(input.powerWatts);
    if (!next.name || !next.kind) throw new Error('랙 장비 이름과 종류를 입력하세요.');
    if (next.powerWatts != null && (!Number.isFinite(next.powerWatts) || next.powerWatts < 0)) throw new Error('장비 전력은 0 이상이어야 합니다.');
  }
  assertPlacement(topology, rack, next, placementId);
  rack.placements[index] = next;
  return next;
}

export function removePlacement(topology, rackId, placementId) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  if (!rack) throw new Error('랙을 찾을 수 없습니다.');
  materializeRack(topology, rack);
  const before = rack.placements.length;
  rack.placements = rack.placements.filter(({ id }) => id !== placementId);
  if (rack.placements.length === before) throw new Error('랙 장비를 찾을 수 없습니다.');
  rack.deviceIds = rack.placements.map(({ deviceId }) => deviceId).filter(Boolean);
}

export function removeMissingRackMappings(topology) {
  const deviceIds = new Set(topology.devices.map(({ id }) => id));
  for (const rack of topology.racks || []) {
    if (Array.isArray(rack.placements)) rack.placements = rack.placements.filter(({ deviceId }) => !deviceId || deviceIds.has(deviceId));
    rack.deviceIds = (rack.deviceIds || []).filter((id) => deviceIds.has(id));
  }
}

export function rackSummary(topology, rack) {
  const placements = rackPlacements(topology, rack).map((placement) => placementView(topology, placement));
  const usedU = placements.reduce((sum, placement) => sum + placement.uHeight, 0);
  const usage = rackUsage(topology, rack);
  return { placements, usedU, remainingU: rack.capacityU - usedU, powerWatts: usage.powerWatts, powerHeadroomWatts: usage.powerHeadroomWatts, usage };
}
