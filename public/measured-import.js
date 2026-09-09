import { axisUnit, normalizeEvidence } from './evidence.js';
import { calculateScenario } from './engine.js';

export const OBSERVED_LOAD_STALE_AFTER_DAYS = 7;
export const OBSERVED_LOAD_AGGREGATES = Object.freeze(['p95', 'p99', 'max', 'mean']);
export const ZABBIX_MAPPING_TEMPLATES = Object.freeze({
  'fortigate-snmp': Object.freeze({
    label: 'Zabbix FortiGate by SNMP',
    source: 'https://github.com/zabbix/zabbix/blob/master/templates/net/fortinet/fortigate_snmp/template_net_fortigate_snmp.yaml',
  }),
  'linux-snmp': Object.freeze({
    label: 'Zabbix Linux by SNMP',
    source: 'https://github.com/zabbix/zabbix/blob/master/templates/os/linux_snmp/template_os_linux_snmp.yaml',
  }),
});
const OBSERVED_LOAD_STALE_AFTER_MS = OBSERVED_LOAD_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

function parse(value, label) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new Error(`${label} file is not valid JSON`); }
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function targetId(entry, index) {
  const id = entry.target?.id;
  if (entry.target?.kind !== 'device' || !id) throw new Error(`entries[${index}].target must name a device id`);
  return String(id);
}

function timestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO date-time`);
  return value;
}

function fingerprint(value) {
  if (!object(value) || !Array.isArray(value.device_ids) || !Array.isArray(value.link_ids)
    || value.device_ids.some((id) => typeof id !== 'string') || value.link_ids.some((id) => typeof id !== 'string')) {
    throw new Error('topology_fingerprint requires device_ids and link_ids');
  }
  return { deviceIds: [...new Set(value.device_ids)].sort(), linkIds: [...new Set(value.link_ids)].sort() };
}

function optionalStructuredObject(value, label) {
  if (value == null) return null;
  if (!object(value)) throw new Error(`${label} must be an object`);
  return structuredClone(value);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function observedConditionGroup(observed, topology) {
  if (observed.conditions == null && observed.scope == null) return 'unrecorded';
  if (observed.conditions != null && canonical(observed.conditions) !== canonical(topology.workloadConditions || {})) return 'mismatched';
  if (observed.scope != null && canonical(observed.scope) !== canonical(topology.workloadScope ?? null)) return 'mismatched';
  return 'matched';
}

export function topologyFingerprint(topology) {
  return { deviceIds: topology.devices.map(({ id }) => id).sort(), linkIds: topology.links.map(({ id }) => id).sort() };
}

export function compareTopologyFingerprint(expected, topology) {
  const actual = topologyFingerprint(topology);
  const difference = (left, right) => left.filter((id) => !right.includes(id));
  return {
    missingDevices: difference(expected.deviceIds, actual.deviceIds), addedDevices: difference(actual.deviceIds, expected.deviceIds),
    missingLinks: difference(expected.linkIds, actual.linkIds), addedLinks: difference(actual.linkIds, expected.linkIds),
  };
}

export function fingerprintMatches(comparison) { return Object.values(comparison).every((items) => items.length === 0); }

export function observedLoadAge(observed, now = Date.now()) {
  const asOf = Date.parse(observed?.asOf);
  return Number.isFinite(asOf) ? Math.max(0, now - asOf) : null;
}

export function observedLoadIsStale(observed, now = Date.now()) {
  const age = observedLoadAge(observed, now);
  return age != null && age > OBSERVED_LOAD_STALE_AFTER_MS;
}

// 관측 최대는 한계가 아니다. saturated 와 재현 가능한 포화 증거가 모두 있을 때만
// 엔진 입력으로 승격하고, 그 밖의 값은 observedFloor 로만 남긴다.
export function importMeasuredLimits(value) {
  const input = parse(value, 'Measured limits');
  if (!object(input) || input.schema !== 'rack-mesh-measured-limits' || !Array.isArray(input.entries)) {
    throw new Error('Measured limits require schema rack-mesh-measured-limits and entries');
  }
  return input.entries.map((entry, index) => {
    const deviceId = targetId(entry, index);
    axisUnit(entry.axis);
    if (!object(entry.conditions)) throw new Error(`entries[${index}].conditions must be an object for a measured limit`);
    const record = normalizeEvidence({ axis: entry.axis, value: entry.value, unit: entry.unit, source: { type: 'user_measured', locator: entry.locator ?? null }, evidenceKind: 'measured', conditions: entry.conditions });
    const saturated = entry.saturated === true;
    const saturationEvidence = typeof entry.saturation_evidence === 'string' ? entry.saturation_evidence.trim() : '';
    return { deviceId, axis: record.axis, value: record.value, unit: record.unit, asOf: input.as_of ?? null, saturated, saturationEvidence, record };
  });
}

export function applyMeasuredLimits(topology, entries) {
  const next = structuredClone(topology);
  const applied = []; const floors = []; const unmatched = [];
  for (const entry of entries) {
    const device = next.devices.find(({ id }) => id === entry.deviceId);
    if (!device) { unmatched.push(entry.deviceId); continue; }
    device.metadata = { ...(device.metadata || {}) };
    device.metadata.observedFloor = { ...(device.metadata.observedFloor || {}), [entry.axis]: { value: entry.value, unit: entry.unit, asOf: entry.asOf } };
    if (!entry.saturated || !entry.saturationEvidence) { floors.push(entry); continue; }
    device.limits = { ...(device.limits || {}), [entry.axis]: entry.value };
    device.source = { type: 'user_measured', label: '사용자 실측 한계', condition: entry.saturationEvidence };
    device.metadata.records = [...(device.metadata.records || []).filter(({ axis }) => axis !== entry.axis), entry.record];
    applied.push(entry);
  }
  return { topology: next, applied, floors, unmatched };
}

// 부하 관측은 한계가 아니라 특정 시점의 자원 부하다. 한계 근거와 source 는 바꾸지 않고
// 정상 상태 계산의 파생 부하를 대체할 스냅샷만 보관한다.
export function importObservedLoad(value) {
  const input = parse(value, 'Observed load');
  if (!object(input) || input.schema !== 'rack-mesh-observed-load' || !Array.isArray(input.entries)) throw new Error('Observed load requires schema rack-mesh-observed-load and entries');
  const asOf = timestamp(input.as_of, 'as_of');
  if (!OBSERVED_LOAD_AGGREGATES.includes(input.aggregate)) throw new Error('aggregate must be p95, p99, max, or mean');
  const snapshotFingerprint = fingerprint(input.topology_fingerprint);
  const entries = input.entries.map((entry, index) => {
    if (!object(entry) || !object(entry.target)) throw new Error(`entries[${index}] requires a target`);
    const target = entry.target;
    let normalizedTarget;
    if (target.kind === 'device' && typeof target.id === 'string' && target.id) normalizedTarget = { kind: 'device', id: target.id };
    else if (target.kind === 'link' && typeof target.from === 'string' && typeof target.to === 'string' && target.from && target.to) {
      if (!['forward', 'reverse'].includes(entry.direction)) throw new Error(`entries[${index}].direction must be forward or reverse`);
      normalizedTarget = { kind: 'link', from: target.from, to: target.to };
    } else throw new Error(`entries[${index}].target must name a device or directed link`);
    const record = normalizeEvidence({ axis: entry.axis, value: entry.value, unit: entry.unit, evidenceKind: 'measured' });
    if (normalizedTarget.kind === 'link' && !['forwarding_bps', 'forwarding_pps'].includes(record.axis)) throw new Error(`entries[${index}].axis is not supported for a link`);
    return { target: normalizedTarget, axis: record.axis, value: record.value, unit: record.unit, ...(normalizedTarget.kind === 'link' ? { direction: entry.direction } : {}) };
  });
  return { asOf, aggregate: input.aggregate, fingerprint: snapshotFingerprint, entries,
    conditions: optionalStructuredObject(input.conditions, 'conditions'), scope: optionalStructuredObject(input.scope, 'scope') };
}

function zabbixIdentity(entry, label) {
  if (!object(entry) || typeof entry.host !== 'string' || !entry.host.trim() || typeof entry.item_key !== 'string' || !entry.item_key.trim()) {
    throw new Error(`${label} requires host and item_key`);
  }
  return `${entry.host.trim()}\u0000${entry.item_key.trim()}`;
}

function zabbixDestination(entry, index) {
  if (!object(entry.target)) throw new Error(`mappings[${index}].target is required`);
  const target = entry.target;
  if (target.kind === 'device' && typeof target.id === 'string' && target.id) return `device:${target.id}:${entry.axis}`;
  if (target.kind === 'link' && typeof target.from === 'string' && typeof target.to === 'string' && ['forward', 'reverse'].includes(entry.direction)) {
    return `link:${target.from}:${target.to}:${entry.direction}:${entry.axis}`;
  }
  throw new Error(`mappings[${index}].target is not a supported Rack Mesh target`);
}

// 기본 템플릿도 장비나 링크의 의미를 알지 못한다. 여기서는 공식 템플릿이 보장한
// item key에서 축과 단위만 읽고, Rack Mesh 대상과 링크 방향은 매핑 파일에 명시하게 둔다.
function zabbixTemplateMetric(template, itemKey) {
  if (!Object.hasOwn(ZABBIX_MAPPING_TEMPLATES, template)) throw new Error(`Unknown Zabbix mapping template ${template}`);
  if (template === 'fortigate-snmp' && itemKey === 'net.ipv4.sessions[fgSysSesCount.0]') {
    return { axis: 'concurrent_sessions', unit: 'sessions' };
  }
  if (['fortigate-snmp', 'linux-snmp'].includes(template) && /^net\.if\.(in|out)\[ifHC(?:In|Out)Octets\.[^\]]+\]$/.test(itemKey)) {
    return { axis: 'forwarding_bps', unit: 'bps' };
  }
  throw new Error(`Zabbix template ${template} does not define item_key ${itemKey}`);
}

function resolveZabbixMapping(mapping, index) {
  const template = mapping.template == null ? null : String(mapping.template);
  const itemKey = String(mapping.item_key).trim();
  const metric = template ? zabbixTemplateMetric(template, itemKey) : null;
  if (metric && ((mapping.axis != null && mapping.axis !== metric.axis) || (mapping.unit != null && mapping.unit !== metric.unit))) {
    throw new Error(`mappings[${index}] conflicts with Zabbix template ${template}`);
  }
  if (!metric && (typeof mapping.axis !== 'string' || typeof mapping.unit !== 'string')) {
    throw new Error(`mappings[${index}] requires axis and unit without a Zabbix template`);
  }
  return { ...mapping, ...(metric || {}), ...(template ? { template } : {}) };
}

// Zabbix의 item key는 템플릿과 벤더마다 다르다. 이름을 보고 축을 추측하면 다른
// 카운터를 처리량이나 세션으로 바꿀 수 있으므로, 매핑 파일의 정확한 host·key만 받는다.
// 공식 템플릿을 명시한 경우에도 대상과 방향은 자동으로 정하지 않는다.
export function importZabbixObservedLoad(value) {
  const input = parse(value, 'Zabbix observed load');
  if (!object(input) || input.schema !== 'rack-mesh-zabbix-observed-load' || !Array.isArray(input.mappings) || !Array.isArray(input.entries)) {
    throw new Error('Zabbix observed load requires schema rack-mesh-zabbix-observed-load, mappings, and entries');
  }
  const mappings = new Map();
  const destinations = new Set();
  for (const [index, mapping] of input.mappings.entries()) {
    const resolved = resolveZabbixMapping(mapping, index);
    const identity = zabbixIdentity(resolved, `mappings[${index}]`);
    if (mappings.has(identity)) throw new Error(`mappings[${index}] duplicates a Zabbix host and item_key`);
    const destination = zabbixDestination(resolved, index);
    axisUnit(resolved.axis);
    normalizeEvidence({ axis: resolved.axis, value: 1, unit: resolved.unit, evidenceKind: 'measured' });
    if (resolved.target.kind === 'link' && !['forwarding_bps', 'forwarding_pps'].includes(resolved.axis)) throw new Error(`mappings[${index}].axis is not supported for a link`);
    if (destinations.has(destination)) throw new Error(`mappings[${index}] duplicates a Rack Mesh target axis`);
    destinations.add(destination);
    mappings.set(identity, resolved);
  }
  const seen = new Set();
  const entries = [];
  const unmapped = [];
  for (const [index, entry] of input.entries.entries()) {
    const identity = zabbixIdentity(entry, `entries[${index}]`);
    if (seen.has(identity)) throw new Error(`entries[${index}] duplicates a Zabbix host and item_key`);
    seen.add(identity);
    const mapping = mappings.get(identity);
    if (!mapping) { unmapped.push({ host: entry.host.trim(), itemKey: entry.item_key.trim() }); continue; }
    entries.push({ target: mapping.target, axis: mapping.axis, value: entry.value, unit: mapping.unit, ...(mapping.target.kind === 'link' ? { direction: mapping.direction } : {}) });
  }
  const observed = importObservedLoad({ schema: 'rack-mesh-observed-load', as_of: input.as_of, aggregate: input.aggregate, topology_fingerprint: input.topology_fingerprint, entries, conditions: input.conditions, scope: input.scope });
  return { ...observed, unmapped, source: 'zabbix' };
}

export function applyObservedLoad(topology, observed) {
  const next = structuredClone(topology);
  const devices = {}; const links = {}; const applied = []; const unmatched = [];
  for (const entry of observed.entries) {
    if (entry.target.kind === 'device') {
      if (!next.devices.some(({ id }) => id === entry.target.id)) { unmatched.push(entry); continue; }
      devices[entry.target.id] = { ...(devices[entry.target.id] || {}), [entry.axis]: entry.value };
      applied.push(entry);
      continue;
    }
    const matches = next.links.filter(({ source, target }) => source === entry.target.from && target === entry.target.to);
    if (matches.length !== 1) { unmatched.push(entry); continue; }
    const linkId = matches[0].id;
    links[linkId] = { ...(links[linkId] || {}), [entry.direction]: { ...(links[linkId]?.[entry.direction] || {}), [entry.axis]: entry.value } };
    applied.push({ ...entry, linkId });
  }
  const comparison = compareTopologyFingerprint(observed.fingerprint, next);
  next.observedLoad = { asOf: observed.asOf, aggregate: observed.aggregate, fingerprint: observed.fingerprint, devices, links,
    conditions: observed.conditions, scope: observed.scope, unmapped: structuredClone(observed.unmapped || []), source: observed.source || null };
  return { topology: next, applied, unmatched, comparison };
}

function summary(points) {
  const errors = points.map(({ observed, modelled }) => (modelled - observed) / observed);
  const total = errors.reduce((sum, value) => sum + value, 0);
  return {
    sampleCount: points.length,
    mape: errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length,
    maxAbsolutePercentageError: Math.max(...errors.map((value) => Math.abs(value))),
    meanSignedPercentageError: total / errors.length,
    signedError: { underModelled: errors.filter((value) => value < 0).length, exact: errors.filter((value) => value === 0).length, overModelled: errors.filter((value) => value > 0).length },
  };
}

// 관측 스냅샷을 적용한 결과를 비교하면 항상 오차가 0이 된다. 스냅샷만 제거한 같은
// 토폴로지와 시나리오를 다시 계산해 모델 예측을 만든다.
export function buildObservedLoadValidationReport(topology, options = {}) {
  const observed = topology.observedLoad;
  if (!observed) return { available: false, axes: [], groups: {} };
  const modelTopology = structuredClone(topology);
  delete modelTopology.observedLoad;
  const model = calculateScenario(modelTopology, options);
  const points = [];
  for (const [deviceId, axes] of Object.entries(observed.devices || {})) {
    const device = model.devices.find(({ id }) => id === deviceId);
    for (const [axis, value] of Object.entries(axes)) {
      const modelled = device?.axes?.[axis]?.load;
      if (Number.isFinite(value) && Number.isFinite(modelled) && value > 0) points.push({ axis, unit: axisUnit(axis), target: { kind: 'device', id: deviceId }, observed: value, modelled });
    }
  }
  for (const [linkId, directions] of Object.entries(observed.links || {})) {
    const link = model.links.find(({ id }) => id === linkId);
    for (const [direction, axes] of Object.entries(directions || {})) for (const [axis, value] of Object.entries(axes || {})) {
      const modelled = link?.directions?.[direction]?.axes?.[axis]?.load;
      if (Number.isFinite(value) && Number.isFinite(modelled) && value > 0) points.push({ axis, unit: axisUnit(axis), target: { kind: 'link', id: linkId, direction }, observed: value, modelled });
    }
  }
  const group = observedConditionGroup(observed, topology);
  const byAxis = new Map();
  for (const point of points) byAxis.set(point.axis, [...(byAxis.get(point.axis) || []), point]);
  return { available: true, conditionGroup: group, sampleCount: points.length,
    axes: [...byAxis].sort(([left], [right]) => left.localeCompare(right)).map(([axis, axisPoints]) => ({ axis, unit: axisUnit(axis), ...summary(axisPoints) })),
    groups: { [group]: { sampleCount: points.length, axes: [...byAxis].sort(([left], [right]) => left.localeCompare(right)).map(([axis, axisPoints]) => ({ axis, ...summary(axisPoints) })) } },
  };
}
