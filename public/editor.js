import { axisCatalog, behaviorCatalog } from './data.js';
import { acceptanceDigest, evidenceApplicability } from './evidence.js';

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

// 링크는 bps 하나가 아니다. 축마다 용량이 따로 있고, 비대칭 회선은 방향마다 다르다.
// 축 이름을 카탈로그로 막는 이유는, 오타 난 축이 아무 장비도 갖지 않아 조용히 무시되기 때문이다.
function normalizeCapacity(capacity, label) {
  const entries = Object.entries(capacity || {});
  if (!entries.length) throw new Error(`${label} requires at least one axis`);
  return Object.fromEntries(entries.map(([axis, value]) => {
    if (!axisCatalog[axis]) throw new Error(`Unknown link capacity axis ${axis}`);
    return [axis, finite(value, axis, { min: Number.EPSILON })];
  }));
}

/**
 * 명시 경로. 홉이 실제로 이어지는지는 여기서 보지 않는다 — 엔진이 그것을 invalidPaths 로
 * 보고하는 쪽이, 손으로 고친 오래된 파일도 열려서 고칠 수 있게 한다. 여기서는 없는 id 만 막는다.
 */
function normalizePaths(topology, paths) {
  if (paths == null) return null;
  if (!Array.isArray(paths)) throw new Error('Demand paths must be a list');
  const devices = deviceIds(topology);
  const links = linkIds(topology);
  const seen = new Set();
  return paths.map((path, index) => {
    const id = requireId(path.id || `path-${index + 1}`, 'Demand path');
    if (seen.has(id)) throw new Error(`Demand path ${id} already exists`);
    seen.add(id);
    for (const [key, known] of [['devices', devices], ['links', links]]) {
      if (!Array.isArray(path[key])) throw new Error(`Demand path ${id} requires ${key}`);
      for (const member of path[key]) if (!known.has(member)) throw new Error(`Demand path ${id} names a missing ${key.slice(0, -1)} ${member}`);
    }
    return { id, devices: [...path.devices], links: [...path.links], ...(path.weight == null ? {} : { weight: finite(path.weight, 'Demand path weight', { min: Number.EPSILON }) }) };
  });
}

/**
 * 반환 경로. 응답 몫이 탈 홉을 따로 적는 자리다 — DSR 은 여기서 LB 를 빼고, 그러면 응답
 * 바이트가 LB 를 지나지 않는 것이 링크 숫자에 그대로 나타난다. 적지 않으면 오늘 그대로,
 * 응답 몫까지 요청 홉에 실린다. 되돌아오는 길이므로 끝은 수요의 출발지여야 한다.
 */
function normalizeReturnPath(topology, returnPath, source) {
  const paths = normalizePaths(topology, returnPath);
  if (!paths?.length) return null;
  for (const path of paths) {
    if (path.devices.at(-1) !== source) throw new Error(`Return path ${path.id} must end at the demand source ${source}`);
  }
  return paths;
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
  if (!spec) { delete device.spec; delete device.overrides; delete device.accepted; return device; }
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
  releaseStaleAcceptances(topology, device);
  return applyEffectiveLimits(device);
}

const DEVICE_POWER_FIELDS = Object.freeze({ nameplate: 'maximumDrawWatts', typical: 'typicalDrawWatts', measured: 'measuredDrawWatts' });

/**
 * 장비가 선언한 전력 기준과 그 기준의 값을 직접 입력한다. 값을 비우면 그 필드를 지워 미확인으로
 * 되돌린다. 손으로 고친 순간 이 물리 사양은 더 이상 데이터시트가 아니므로 출처도 같이 바꾼다.
 */
export function setDevicePower(topology, id, { basis, watts }) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) throw new Error(`Device ${id} does not exist`);
  const field = DEVICE_POWER_FIELDS[basis];
  if (!field) throw new Error('전력 기준이 올바르지 않습니다.');
  const raw = typeof watts === 'string' ? watts.trim() : watts;
  const value = raw === '' || raw == null ? null : Number(raw);
  if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error('전력은 0 이상이어야 합니다.');
  if (device.spec) device.spec.physical = { ...device.spec.physical };
  else device.metadata = { ...device.metadata };
  const target = device.spec ? device.spec.physical : device.metadata;
  target.powerBasis = basis;
  if (value == null) delete target[field]; else target[field] = value;
  if (value != null) target.source = { label: '직접 입력', locator: '랙 인스펙터' };
  return device;
}

/** 축 하나를 보정한다. null 이나 빈 값이면 데이터시트 값으로 되돌린다. */
// 가져온 장비는 용량이 비어 있어 계산에 들어가지 못한다. 한 대씩 고르는 대신 같은
// 종류에 한 번에 붙인다. 이미 spec 이 있는 장비는 건드리지 않는다 — 손으로 고른 모델을
// 덮으면 사용자가 한 판단이 조용히 사라진다.
export function applySpecToKind(topology, kind, spec, { overwrite = false } = {}) {
  if (!spec) throw new Error('A catalog spec is required');
  const targets = topology.devices.filter((device) => device.kind === kind && (overwrite || !device.spec));
  for (const device of targets) applySpec(topology, device.id, spec);
  return targets.map(({ id }) => id);
}

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

// 워크로드 조건. v0.5 7.2 어휘를 쓴다(PRD v0.6 결정). 값을 비우면 그 키를 지운다 —
// 빈 문자열을 남기면 데이터시트의 어떤 조건과도 일치하지 않아 전부 불일치로 떨어진다.
const WORKLOAD_CONDITION_KEYS = new Set(['packet_size_bytes', 'packet_size_scope', 'traffic_rate_scope',
  'transport', 'cipher', 'features_enabled', 'queue_depth', 'firmware_version', 'test_method']);
const CONDITION_TEXT_LIMIT = 120;

function conditionValue(key, value) {
  if (Array.isArray(value)) {
    if (value.length > 16) throw new Error(`${key} takes at most 16 entries`);
    return value.map((item) => conditionValue(key, item)).sort();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
    return value;
  }
  const text = String(value).trim();
  if (!text) throw new Error(`${key} cannot be blank`);
  if (text.length > CONDITION_TEXT_LIMIT) throw new Error(`${key} is too long`);
  if (/[<>]/.test(text)) throw new Error(`${key} cannot contain markup`);
  return text;
}

/** 워크로드 조건을 통째로 세운다. 빈 값은 키를 지우고, 남은 키가 없으면 필드를 없앤다. */
export function setWorkloadConditions(topology, patch) {
  const next = { ...(topology.workloadConditions || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!WORKLOAD_CONDITION_KEYS.has(key)) throw new Error(`Unknown workload condition ${key}`);
    // 빈 배열은 없앨 값이 아니라 "아무것도 켜지 않았다"는 값이다. 방화벽만 켠 프로필의 조건이
    // 정확히 그것이므로, 지워 버리면 맞출 수 있는 근거를 영영 못 맞춘다. null 만 키를 지운다.
    if (value == null || value === '') delete next[key];
    else next[key] = conditionValue(key, value);
  }
  if (Object.keys(next).length) topology.workloadConditions = next;
  else delete topology.workloadConditions;
  // 조건이 바뀌면 그 조건 아래에서 한 수락은 대상이 달라진다. 다시 묻는다.
  for (const device of topology.devices) releaseStaleAcceptances(topology, device);
  return topology.workloadConditions ?? null;
}

function recordFor(device, axis) {
  return (device.spec?.records || device.metadata?.records || []).find((item) => item.axis === axis) || null;
}

// 수락은 근거 레코드와 그때의 워크로드 조건에 함께 묶인다. 어느 쪽이 바뀌든 풀린다.
function releaseStaleAcceptances(topology, device) {
  if (!device.accepted) return;
  for (const axis of Object.keys(device.accepted)) {
    const record = recordFor(device, axis);
    if (!record || device.accepted[axis] !== acceptanceDigest(record, topology.workloadConditions ?? {}, topology.workloadScope ?? null)) {
      delete device.accepted[axis];
    }
  }
  if (!Object.keys(device.accepted).length) delete device.accepted;
}

/** 조건이 맞지 않는 축 하나를 사용자가 수락한다. 프로필을 통째로 수락하는 길은 두지 않는다. */
export function acceptEvidence(topology, id, axis) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) throw new Error(`Device ${id} does not exist`);
  const record = recordFor(device, axis);
  if (!record) throw new Error(`${axis} has no evidence record to accept`);
  if (record.value === null) throw new Error(`${axis} has no value to accept`);
  const applicability = evidenceApplicability(record, topology.workloadConditions ?? {}, topology.workloadScope ?? null);
  if (applicability === 'applicable') throw new Error(`${axis} already matches the workload conditions`);
  device.accepted = { ...device.accepted, [axis]: acceptanceDigest(record, topology.workloadConditions ?? {}, topology.workloadScope ?? null) };
  return device;
}

export function clearEvidenceAcceptance(topology, id, axis) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) throw new Error(`Device ${id} does not exist`);
  if (device.accepted) { delete device.accepted[axis]; if (!Object.keys(device.accepted).length) delete device.accepted; }
  return device;
}

/**
 * 지운 자원을 가리키는 참조를 걷어낸다. 남겨 두면 검증이 걸려 계산 전체가 invalid 가 되고,
 * 그러면 판정 하나가 아니라 설계의 모든 숫자가 사라진다. HA 그룹만 청소하던 것을 랙·서비스·
 * 장애 도메인까지 넓힌다 — 검증 패널이 이미 그 셋을 사용자에게 만들게 해 주기 때문이다.
 * 멤버가 하나도 안 남은 항목은 HA 그룹과 같이 통째로 버린다. 빈 멤버 목록 자체가 검증에 걸린다.
 */
function releaseReferences(topology, { deviceId = null, linkId = null, demandId = null }) {
  const drop = (list, value) => list.filter((item) => item !== value);
  if (deviceId) {
    if (Array.isArray(topology.haGroups)) {
      topology.haGroups = topology.haGroups
        .map((group) => (group.members?.includes(deviceId) ? { ...group, members: drop(group.members, deviceId) } : group))
        .filter((group) => group.members?.length);
    }
    if (Array.isArray(topology.racks)) {
      topology.racks = topology.racks
        .map((rack) => ({ ...rack, deviceIds: drop(rack.deviceIds || [], deviceId), placements: Array.isArray(rack.placements) ? rack.placements.filter((placement) => placement.deviceId !== deviceId) : rack.placements }))
        .filter((rack) => rack.deviceIds.length || rack.placements?.some((placement) => !placement.deviceId));
    }
  }
  if (Array.isArray(topology.failureDomains) && (deviceId || linkId)) {
    topology.failureDomains = topology.failureDomains
      .map((domain) => ({ ...domain, deviceIds: drop(domain.deviceIds || [], deviceId), linkIds: drop(domain.linkIds || [], linkId) }))
      .filter((domain) => domain.deviceIds.length || domain.linkIds.length);
  }
  if (Array.isArray(topology.services) && (deviceId || demandId)) {
    topology.services = topology.services
      .map((service) => ({
        ...service,
        demandIds: drop(service.demandIds || [], demandId),
        endpointGroups: (service.endpointGroups || [])
          .map((group) => {
            const members = drop(group.members || [], deviceId);
            // 최소 가용 대수가 남은 멤버 수보다 크면 그것도 검증에 걸린다. 줄어든 만큼 낮춘다.
            return { ...group, members, minAvailable: Math.min(group.minAvailable ?? 1, members.length) };
          })
          .filter((group) => group.members.length),
      }))
      .filter((service) => service.demandIds.length);
  }
}

export function removeDevice(topology, id) {
  if (!deviceIds(topology).has(id)) throw new Error(`Device ${id} does not exist`);
  const removedLinks = new Set(topology.links.filter((link) => link.source === id || link.target === id).map(({ id: linkId }) => linkId));
  topology.devices = topology.devices.filter((device) => device.id !== id);
  topology.links = topology.links.filter((link) => !removedLinks.has(link.id));
  // 끝점이 사라진 수요는 남긴다. 사용자가 적어 넣은 부하를 지우는 대신 다시 이어 붙일 수 있게
  // 두는 것이 이 편집기의 계약이다(tests/solver-boundary.test.js "stay editable while retaining demand").
  // 반면 랙·서비스·장애 도메인의 멤버 목록은 화면에서 되돌릴 길이 마땅치 않아 여기서 걷어낸다.
  releaseReferences(topology, { deviceId: id });
  for (const linkId of removedLinks) releaseReferences(topology, { linkId });
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
  const capacity = normalizeCapacity(input.capacity ?? { forwarding_bps: input.capacityBps ?? 10e9 }, 'Link capacity');
  const link = { id, source, target, capacity, enabled: true };
  if (input.capacityByDirection) {
    // 엔진은 capacity 를 양방향 공통으로 깔고 방향별 값을 축 단위로 덮어쓴다(engine.js resolve).
    const byDirection = Object.fromEntries(['forward', 'reverse']
      .filter((direction) => input.capacityByDirection[direction])
      .map((direction) => [direction, normalizeCapacity(input.capacityByDirection[direction], `Link ${direction} capacity`)]));
    if (Object.keys(byDirection).length) link.capacityByDirection = byDirection;
  }
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

// 가져온 연결선은 그림일 뿐이라 계산에 들어가지 않는다. 양 끝이 장비가 되면 트래픽을 나르는
// 링크로 바꿀 수 있다. 용량은 그림에 없으므로 비워 둔다 — 임포트가 만드는 링크와 같은 상태이고,
// 여기서 기본값을 지어내면 재지 않은 숫자가 계산에 섞인다.
export function promoteConnector(topology, connectorId) {
  const connectors = topology.diagram?.connectors || [];
  const connector = connectors.find(({ id }) => id === connectorId);
  if (!connector) throw new Error(`Connector ${connectorId} does not exist`);
  const devices = deviceIds(topology);
  if (!devices.has(connector.source) || !devices.has(connector.target)) throw new Error('A link requires a device at both ends');
  if (connector.source === connector.target) throw new Error('A link requires two different devices');
  const id = requireId(`link-${String(connectorId).replace(/^connector-/, '')}`, 'Link');
  if (linkIds(topology).has(id)) throw new Error(`Link ${id} already exists`);
  const link = { id, source: connector.source, target: connector.target, capacity: { forwarding_bps: null }, enabled: true };
  // draw.io 에서 온 연결선만 그 외형을 들고 간다. 손으로 그린 연결선은 앱의 링크 모양을 쓴다.
  if (Number.isInteger(connector.zIndex)) {
    link.drawioVisual = { zIndex: connector.zIndex,
      paint: { ...(connector.stroke ? { stroke: connector.stroke } : {}), ...(connector.strokeWidth ? { strokeWidth: connector.strokeWidth } : {}), ...(connector.dashed ? { lineStyle: 'dashed' } : {}) },
      ...(connector.drawioOptions ? { drawioOptions: connector.drawioOptions } : {}),
      ...(connector.drawioGeometry ? { geometry: connector.drawioGeometry } : {}),
      ...(connector.waypoints?.length ? { waypoints: connector.waypoints } : {}) };
  }
  topology.links.push(link);
  topology.diagram.connectors = connectors.filter(({ id: item }) => item !== connectorId);
  return link;
}

export function updateLink(topology, id, patch) {
  const link = topology.links.find((item) => item.id === id);
  if (!link) throw new Error(`Link ${id} does not exist`);
  const next = structuredClone(link);
  if (patch.capacityBps != null) next.capacity.forwarding_bps = finite(patch.capacityBps, 'Link capacity', { min: Number.EPSILON });
  // 방향별 값을 남겨 둔 채 공통 용량만 고치면, 사용자가 방금 적은 숫자를 덮어쓰기가 조용히 이긴다.
  // 그래서 폼이 방향을 함께 보내고, 비워 둔 방향은 공통 용량으로 되돌린다.
  if (patch.capacityByDirection !== undefined) {
    const byDirection = Object.fromEntries(['forward', 'reverse']
      .filter((direction) => patch.capacityByDirection?.[direction])
      .map((direction) => [direction, normalizeCapacity(patch.capacityByDirection[direction], `Link ${direction} capacity`)]));
    if (Object.keys(byDirection).length) next.capacityByDirection = byDirection; else delete next.capacityByDirection;
  }
  for (const side of ['source', 'target']) {
    if (!Object.hasOwn(patch, `${side}Port`)) continue;
    const portId = patch[`${side}Port`];
    if (!portId) { delete next[`${side}Port`]; continue; }
    const owner = topology.devices.find((device) => device.id === next[side]);
    if (!owner?.ports?.some(({ id: port }) => port === portId)) throw new Error(`Port ${portId} does not exist`);
    if (topology.links.some((item) => item.id !== id && ['source', 'target'].some((end) => item[end] === owner.id && item[`${end}Port`] === portId))) throw new Error(`Port ${portId} is already connected`);
    next[`${side}Port`] = portId;
  }
  // 손으로 굽힌 자리. 비우면 자동 경로로 되돌아간다.
  if (patch.waypoints !== undefined) {
    const points = normalizeWaypoints(patch.waypoints);
    if (points.length) next.waypoints = points; else delete next.waypoints;
  }
  for (const side of ['source', 'target']) delete link[`${side}Port`];
  delete link.capacityByDirection;
  delete link.waypoints;
  Object.assign(link, next);
  return link;
}

// 선을 손으로 굽힌 자리. 여덟이면 어떤 화면에서도 넉넉하고, 그 이상은 저장 파일만 키운다.
const WAYPOINT_LIMIT = 8;
function normalizeWaypoints(points) {
  if (points == null) return [];
  if (!Array.isArray(points)) throw new Error('Link waypoints must be a list');
  if (points.length > WAYPOINT_LIMIT) throw new Error(`A link takes at most ${WAYPOINT_LIMIT} waypoints`);
  return points.map((point) => ({ x: finite(point?.x, 'Waypoint x', ANY_COORDINATE), y: finite(point?.y, 'Waypoint y', ANY_COORDINATE) }));
}

export function removeLink(topology, id) {
  if (!linkIds(topology).has(id)) throw new Error(`Link ${id} does not exist`);
  topology.links = topology.links.filter((link) => link.id !== id);
  releaseReferences(topology, { linkId: id });
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
  const paths = normalizePaths(topology, input.paths);
  const demand = { id, name: String(input.name || id).trim().slice(0, 80) || id, source, target, load,
    pathMode: input.pathMode === 'explicit' || (input.pathMode == null && paths?.length) ? 'explicit' : 'shortest' };
  // 아래 넷은 없는 것이 기본값이라, 값이 있을 때만 붙인다. 빈 필드를 만들면 저장 파일마다 실린다.
  if (paths) demand.paths = paths;
  const returnPath = normalizeReturnPath(topology, input.returnPath, source);
  if (returnPath) demand.returnPath = returnPath;
  const backendPool = normalizeBackendPool(input.backendPool, devices);
  if (backendPool) demand.backendPool = backendPool;
  const directionality = normalizeDirectionality(input.directionality);
  if (directionality) demand.directionality = directionality;
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
  if (endpointsChanged) { delete demand.paths; delete demand.returnPath; demand.pathMode = 'shortest'; if (Array.isArray(demand.backendPool?.memberIds)) delete demand.backendPool; }
  if (patch.returnPath !== undefined) {
    const returnPath = normalizeReturnPath(topology, patch.returnPath, demand.source);
    if (returnPath) demand.returnPath = returnPath; else delete demand.returnPath;
  }
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
  releaseReferences(topology, { demandId: id });
}

export function createEmptyTopology(name = 'Untitled topology') {
  return { schemaVersion: 1, name, synthetic: false, warningThreshold: 0.8, devices: [], links: [], demands: [] };
}
