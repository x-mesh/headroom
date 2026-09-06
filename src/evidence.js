// 브라우저와 엔진이 함께 쓰는 근거 snapshot. digest는 무결성 비교용이며 암호학적 서명이 아니다.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function evidenceDigest(value) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(canonical(value))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

export function axisUnit(axis) {
  if (axis.endsWith('_bps')) return 'bps';
  if (axis.endsWith('_pps')) return 'pps';
  if (axis === 'new_sessions_per_sec') return 'sessions/s';
  if (axis === 'concurrent_sessions') return 'sessions';
  if (axis === 'vpn_tunnels') return 'tunnels';
  if (['tls_full_handshakes_per_sec', 'tls_resumed_handshakes_per_sec'].includes(axis)) return 'handshakes/s';
  throw new Error(`Unknown performance axis: ${axis}`);
}

export function normalizeEvidence(record, defaults = {}) {
  const axis = record.axis;
  const baseUnit = axisUnit(axis);
  const originalValue = record.originalValue ?? record.value;
  const originalUnit = record.originalUnit ?? record.unit ?? baseUnit;
  const units = { bps: { bps: 1, Kbps: 1e3, kbps: 1e3, Mbps: 1e6, Gbps: 1e9, Tbps: 1e12 }, pps: { pps: 1, Kpps: 1e3, kpps: 1e3, Mpps: 1e6, Gpps: 1e9 }, 'sessions/s': { 'sessions/s': 1, cps: 1, CPS: 1, Kcps: 1e3, Mcps: 1e6 }, sessions: { sessions: 1, count: 1, K: 1e3, M: 1e6 }, tunnels: { tunnels: 1, count: 1, K: 1e3, M: 1e6 }, 'handshakes/s': { 'handshakes/s': 1, TPS: 1, tps: 1, 'Khandshakes/s': 1e3, 'Mhandshakes/s': 1e6 } };
  const factor = units[baseUnit][originalUnit];
  if (!factor) throw new Error(`Unknown or incompatible unit ${originalUnit} for ${axis}`);
  const value = originalValue === null ? null : Number(originalValue) * factor;
  if (value !== null && (!Number.isFinite(value) || value <= 0)) throw new Error('Performance limits require a positive value');
  const evidenceKind = record.evidenceKind ?? defaults.evidenceKind ?? record.source?.type ?? 'unverified';
  if (!['datasheet', 'theoretical', 'estimate', 'measured', 'synthetic', 'unverified'].includes(evidenceKind)) throw new Error(`Unknown evidence kind ${evidenceKind}`);
  const result = { axis, value, unit: baseUnit, originalValue, originalUnit, evidenceKind,
    conditions: structuredClone(record.conditions ?? defaults.conditions ?? null),
    scope: structuredClone(record.scope ?? defaults.scope ?? null),
    source: structuredClone(record.source ?? defaults.source ?? null), revision: record.revision ?? defaults.revision ?? null };
  if (result.conditions !== null && (typeof result.conditions !== 'object' || Array.isArray(result.conditions))) throw new Error('Evidence conditions must be a structured object');
  return { ...result, digest: evidenceDigest(result) };
}

export function evidenceApplicability(record, workloadConditions = {}, workloadScope = null) {
  if (record.value === null || record.evidenceKind === 'unverified' || record.conditions == null) return 'unknown';
  let unknown = false;
  for (const [key, expected] of Object.entries(record.conditions)) {
    if (!(key in workloadConditions)) unknown = true;
    else if (canonical(workloadConditions[key]) !== canonical(expected)) return 'incompatible';
  }
  if (record.scope != null) {
    if (workloadScope == null) unknown = true;
    else if (canonical(record.scope) !== canonical(workloadScope)) return 'incompatible';
  }
  return unknown ? 'unknown' : 'applicable';
}

export function validateEvidenceRecords(records) {
  if (!Array.isArray(records)) throw new Error('Evidence records must be an array');
  const axes = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object') throw new Error('Evidence record must be an object');
    if (axes.has(record.axis)) throw new Error(`Ambiguous evidence axis ${record.axis}`);
    axes.add(record.axis);
    const normalized = normalizeEvidence(record);
    if (record.value !== normalized.value || record.unit !== normalized.unit || record.digest !== normalized.digest) throw new Error(`Evidence snapshot is inconsistent for ${record.axis}`);
  }
}

export function buildSpec(entry, profile) {
  const revision = entry.revision ?? entry.source?.retrievedAt ?? null;
  const records = profile.records ?? Object.entries(profile.limits).map(([axis, value]) => normalizeEvidence({ axis, value }, {
    revision, source: entry.source, conditions: profile.conditions ?? null, scope: profile.scope ?? null,
    evidenceKind: entry.kinds && axis.endsWith('_pps') ? 'theoretical' : entry.source?.type ?? 'unverified',
  }));
  const spec = { catalogId: entry.id, profileId: profile.id, profileLabel: profile.label ?? profile.id, note: profile.note ?? '', limits: structuredClone(profile.limits), source: structuredClone(entry.source), records: structuredClone(records), revision };
  return { ...spec, digest: evidenceDigest(spec) };
}
