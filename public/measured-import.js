import { axisUnit, normalizeEvidence } from './evidence.js';

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
    const record = normalizeEvidence({ axis: entry.axis, value: entry.value, unit: entry.unit, source: { type: 'user_measured', locator: entry.locator ?? null }, evidenceKind: 'measured', conditions: entry.conditions ?? null });
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
