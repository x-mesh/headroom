import { rackExtraWatts, rackUsage } from './engine.js';

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

// 0.5U 배치를 허용하되 0.3처럼 반 칸에 걸치는 값은 받지 않는다.
function isHalfUnit(value) { return Number.isFinite(value) && Number.isInteger(value * 2); }
function overlapsRange(aStart, aHeight, bStart, bHeight) { return aStart < bStart + bHeight && bStart < aStart + aHeight; }

export function placementHeight(topology, placement) {
  const device = placement.deviceId ? topology.devices.find(({ id }) => id === placement.deviceId) : null;
  const value = Number(placement.uHeight ?? physical(device)?.uHeight ?? 1);
  return isHalfUnit(value) && value >= .5 ? value : 1;
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
    vendor: device?.vendor || placement.vendor || '',
    // 전면에 실제로 달린 포트. 토폴로지의 device.ports 와는 다른 것이다 - 저쪽은 링크가 어느
    // 포트로 몇 bps 나가는지를 말하고, 이쪽은 앞면에 무엇이 몇 개 보이는지만 말한다.
    frontPorts: physical(device)?.frontPorts ?? null,
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
  if (!isHalfUnit(startU) || startU < 1) throw new Error('시작 U는 1 이상, 0.5U 단위여야 합니다.');
  if (!isHalfUnit(uHeight) || uHeight < .5) throw new Error('장비 높이는 0.5U 이상, 0.5U 단위여야 합니다.');
  if (startU + uHeight - 1 > rack.capacityU) throw new Error(`${rack.capacityU}U 랙 범위를 벗어납니다.`);
  const collision = rackPlacements(topology, rack).find((current) => current.id !== ignoreId
    && overlapsRange(startU, uHeight, current.startU, current.uHeight));
  if (collision) throw new Error(`${placementView(topology, collision).name}과 U 위치가 겹칩니다.`);
}

// 서버 같은 정수 높이 장비도 0.5U 패널에 딱 붙어야 하므로 높이와 관계없이 반 칸 간격으로 찾는다.
function freeStartCandidates(topology, rack, uHeight, ignoreId) {
  const height = isHalfUnit(Number(uHeight)) && Number(uHeight) >= .5 ? Number(uHeight) : 1;
  const occupied = rackPlacements(topology, rack).filter(({ id }) => id !== ignoreId);
  const free = [];
  for (let startU = 1; startU + height - 1 <= rack.capacityU; startU += .5) {
    if (!occupied.some((placement) => overlapsRange(startU, height, placement.startU, placement.uHeight))) free.push(startU);
  }
  return free;
}

export function firstFreeStartU(topology, rack, uHeight = 1, ignoreId = null) {
  return freeStartCandidates(topology, rack, uHeight, ignoreId)[0] ?? null;
}

export function nearestFreeStartU(topology, rack, uHeight = 1, preferredStartU = 1, ignoreId = null) {
  const height = isHalfUnit(Number(uHeight)) && Number(uHeight) >= .5 ? Number(uHeight) : 1;
  const rounded = Math.round((Number(preferredStartU) || 1) * 2) / 2;
  const preferred = Math.min(Math.max(1, rounded), Math.max(1, rack.capacityU - height + 1));
  const free = freeStartCandidates(topology, rack, uHeight, ignoreId);
  return free.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)[0] ?? null;
}

// 새 랙 폼에 채울 이름. 가장 큰 RACK 번호 다음을 쓰되, 이름을 바꾼 랙이 처음 이름의 ID를 쥐고 있으면 그 번호는 건너뛴다.
export function nextRackName(topology) {
  const racks = topology.racks || [];
  const numbers = racks.map(({ name }) => Number(/^RACK\s+(\d+)$/i.exec(String(name ?? '').trim())?.[1])).filter(Number.isInteger);
  for (let number = Math.max(0, ...numbers) + 1; ; number += 1) {
    const name = `RACK ${String(number).padStart(2, '0')}`;
    if (!racks.some(({ id }) => id === placementId(name))) return name;
  }
}

// 같은 계약의 랙을 이어 만드는 경우가 많아 가장 최근 랙의 예산을 쓴다. 랙이 없으면 30A 단상 회로 하나의
// 사용 가능 용량(약 5kW)으로 둔다. 기본값이 실제보다 크면 입력하지 않은 랙이 여유 있어 보인다.
export function suggestedRackPowerBudget(topology) {
  const latest = Number(topology.racks?.at(-1)?.powerBudgetWatts);
  return Number.isFinite(latest) && latest > 0 ? latest : 5000;
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

// 프로젝트 파일 검증과 같은 규칙이다. 여기서 받아 두면 저장할 때 파일 전체가 거부된다.
function displayName(value, label) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error(`${label} 이름을 입력하세요.`);
  if (name.length > 80) throw new Error(`${label} 이름은 80자 이하여야 합니다.`);
  if (/[<>]/.test(name)) throw new Error(`${label} 이름에는 < 또는 >를 쓸 수 없습니다.`);
  return name;
}

export function renameRack(topology, rackId, value) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  if (!rack) throw new Error('랙을 찾을 수 없습니다.');
  rack.name = displayName(value, '랙');
  return rack;
}

// 토폴로지에 연결된 배치는 이름을 따로 갖지 않는다. 같은 장비이므로 토폴로지 장비 이름을 바꾼다.
export function renamePlacement(topology, rackId, placementId, value) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  const placement = rack && rackPlacements(topology, rack).find(({ id }) => id === placementId);
  if (!placement) throw new Error('랙 장비를 찾을 수 없습니다.');
  const name = displayName(value, '장비');
  const target = placement.deviceId ? topology.devices.find(({ id }) => id === placement.deviceId) : rack.placements.find(({ id }) => id === placementId);
  target.name = name;
  return target;
}

// 랙에는 좌표가 없고 배열 순서가 곧 2D·3D에서 놓이는 자리다. toIndex는 옮긴 뒤의 최종 순서다.
export function moveRack(topology, rackId, toIndex) {
  const racks = topology.racks || [];
  const from = racks.findIndex(({ id }) => id === rackId);
  if (from < 0) throw new Error('옮길 랙을 찾을 수 없습니다.');
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= racks.length) throw new Error('랙을 옮길 자리가 올바르지 않습니다.');
  const [rack] = racks.splice(from, 1);
  racks.splice(toIndex, 0, rack);
  return rack;
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
  if (!isHalfUnit(placement.uHeight) || placement.uHeight < .5) throw new Error('장비 높이는 0.5U 이상, 0.5U 단위여야 합니다.');
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

// 랙 클립보드는 배치를 랙 전용 장비의 모양으로 옮겨 적는다. 토폴로지 장비를 복제하면 붙여넣기 한 번에
// 경로와 여유율 계산이 조용히 바뀌므로, 연결 장비도 이름·모델·높이·랙 기준 전력만 가져간다.
function clipboardItem(topology, rack, placement) {
  const view = placementView(topology, placement);
  const power = placement.deviceId ? rackExtraWatts(topology, rack, { deviceId: placement.deviceId }) : null;
  return {
    name: view.name, kind: view.kind, model: view.model, startU: view.startU, uHeight: view.uHeight,
    powerWatts: power ? (power.known ? power.watts : null) : placement.powerWatts ?? null,
    fromDevice: Boolean(placement.deviceId),
  };
}

export function copyRackPlacement(topology, rackId, placementId) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  const placement = rack && rackPlacements(topology, rack).find(({ id }) => id === placementId);
  if (!placement) throw new Error('복사할 랙 장비를 찾을 수 없습니다.');
  return { type: 'placement', item: clipboardItem(topology, rack, placement) };
}

export function copyRack(topology, rackId) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  if (!rack) throw new Error('복사할 랙을 찾을 수 없습니다.');
  return {
    type: 'rack',
    rack: { capacityU: rack.capacityU, powerBudgetWatts: rack.powerBudgetWatts, powerBasis: rack.powerBasis },
    items: rackPlacements(topology, rack).map((placement) => clipboardItem(topology, rack, placement)),
  };
}

// 붙여넣은 장비는 원래 장비 옆에 나란히 보이므로 이름으로 구분되게 한다. 80자는 프로젝트 파일의 이름 한도다.
function copyName(topology, name) {
  const base = String(name || '').replace(/\s*복제(\s*\d+)?$/, '').trim() || '랙 장비';
  const taken = new Set([
    ...topology.devices.map((device) => device.name),
    ...(topology.racks || []).flatMap((rack) => rackPlacements(topology, rack).map((placement) => placementView(topology, placement).name)),
  ]);
  for (let n = 1; n <= 99; n += 1) {
    const suffix = n === 1 ? ' 복제' : ` 복제 ${n}`;
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 77)} 복제`;
}

// 원래 시작 U가 비어 있으면 그 자리에, 아니면 가장 가까운 빈자리에 놓는다.
export function pasteRackPlacement(topology, rackId, clip) {
  const rack = (topology.racks || []).find(({ id }) => id === rackId);
  if (!rack) throw new Error('붙여넣을 랙을 찾을 수 없습니다.');
  const { item } = clip;
  const startU = nearestFreeStartU(topology, rack, item.uHeight, item.startU);
  if (startU == null) throw new Error(`${rack.name}에 ${item.uHeight}U 연속 공간이 없습니다.`);
  return addStandalonePlacement(topology, rack.id, { name: copyName(topology, item.name), kind: item.kind, model: item.model, startU, uHeight: item.uHeight, powerWatts: item.powerWatts });
}

// 새 랙은 복사한 랙 바로 오른쪽에 둔다. 안의 장비는 같은 U에 두고 이름도 그대로 쓴다. 랙 이름이 이미 둘을 구분한다.
export function pasteRack(topology, clip, afterRackId = null) {
  const rack = createRack(topology, { ...clip.rack, name: nextRackName(topology) });
  for (const item of clip.items) addStandalonePlacement(topology, rack.id, { name: item.name, kind: item.kind, model: item.model, startU: item.startU, uHeight: item.uHeight, powerWatts: item.powerWatts });
  const index = topology.racks.findIndex(({ id }) => id === afterRackId);
  if (index >= 0 && index + 1 < topology.racks.length - 1) moveRack(topology, rack.id, index + 1);
  return rack;
}

// 정수 배치는 기존 'U5–5' 형식 그대로, 반 칸 배치는 끝값이 시작값보다 작아지지 않게 맞춘다.
export function placementRangeLabel(startU, uHeight) {
  const s = Number(startU);
  const h = Number(uHeight);
  if (Number.isInteger(s) && Number.isInteger(h)) return `U${s}–${s + h - 1}`;
  const last = s + h - .5;
  return last === s ? `U${s}` : `U${s}–${last}`;
}

export function rackSummary(topology, rack) {
  const placements = rackPlacements(topology, rack).map((placement) => placementView(topology, placement));
  const usedU = placements.reduce((sum, placement) => sum + placement.uHeight, 0);
  const usage = rackUsage(topology, rack);
  return { placements, usedU, remainingU: rack.capacityU - usedU, powerWatts: usage.powerWatts, powerHeadroomWatts: usage.powerHeadroomWatts, usage };
}
