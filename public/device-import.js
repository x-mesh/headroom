import { normalizeEvidence, evidenceDigest } from './evidence.js';

const INTERFACE_SPEEDS = new Map([
  ['1000base-t', 1e9], ['1000base-x-gbic', 1e9], ['1000base-x-sfp', 1e9],
  ['2.5gbase-t', 2.5e9], ['5gbase-t', 5e9], ['10gbase-t', 10e9], ['10gbase-x-sfpp', 10e9],
  ['25gbase-x-sfp28', 25e9], ['40gbase-x-qsfpp', 40e9], ['50gbase-x-sfp56', 50e9],
  ['100gbase-x-qsfp28', 100e9], ['200gbase-x-qsfp56', 200e9], ['400gbase-x-qsfpdd', 400e9],
]);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function manufacturerName(value) { return typeof value === 'string' ? value : value?.name || value?.slug || 'Unknown manufacturer'; }

function performanceTemplate(profile, options) {
  const ref = profile.device_ref || {};
  const limits = {};
  const rawLimits = (profile.limits || []).filter((limit) => !options.conditionId || limit.condition_id === options.conditionId);
  const records = [];
  for (const limit of rawLimits) {
    if (!limit.axis || !Number.isFinite(Number(limit.value)) || Number(limit.value) <= 0) throw new Error('Performance limits require a positive value and axis');
    if (Object.hasOwn(limits, limit.axis)) throw new Error(`Ambiguous conditions for ${limit.axis}; select conditionId or import one profile per measurement condition`);
    const record = normalizeEvidence(limit, { revision: profile.revision, scope: profile.scope, conditions: profile.conditions });
    limits[limit.axis] = record.value;
    records.push(record);
  }
  if (!Object.keys(limits).length) throw new Error('Performance profile requires at least one limit');
  return {
    schema: 'rack-mesh-performance', id: String(profile.profile_id || ref.model || 'imported-device').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: [ref.manufacturer, ref.model].filter(Boolean).join(' ') || 'Imported device', vendor: ref.manufacturer || '', model: ref.model || '', kind: profile.class || 'switch', zone: 'UNASSIGNED', limits,
    source: { type: profile.limits[0]?.source?.type || 'estimate', label: 'Headroom performance profile', condition: 'Imported conditions are preserved in metadata' },
    metadata: { deviceRef: ref, revision: profile.revision || null, limits: structuredClone(profile.limits), records, digest: evidenceDigest(records), ...(options.conditionId ? { conditionSelection: 'explicit-profile' } : {}) },
  };
}

function netboxTemplate(input) {
  const interfaces = Array.isArray(input.interfaces) ? input.interfaces : [];
  const portSpeeds = interfaces.map(({ type }) => INTERFACE_SPEEDS.get(type)).filter(Number.isFinite);
  const powerPorts = input['power-ports'] || input.power_ports || [];
  const maximumDraw = powerPorts.map((port) => Number(port.maximum_draw)).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const manufacturer = manufacturerName(input.manufacturer);
  const model = String(input.model || '').trim();
  if (!model) throw new Error('NetBox device type requires model');
  const id = String(input.slug || `${manufacturer}-${model}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    schema: 'netbox-device-type', id, name: `${manufacturer} ${model}`, vendor: manufacturer, model, kind: input.device_role || 'switch', zone: 'UNASSIGNED',
    limits: { forwarding_bps: null, forwarding_pps: null },
    source: { type: 'estimate', label: 'NetBox physical definition', condition: 'Performance capacity is unknown' },
    metadata: { manufacturer, model, partNumber: input.part_number || null, uHeight: input.u_height ?? null, maximumDrawWatts: maximumDraw || null, portCount: interfaces.length, portSpeedsBps: [...new Set(portSpeeds)].sort((a, b) => a - b) },
  };
}

export function importDeviceDefinition(value, options = {}) {
  let input = value;
  if (typeof value === 'string') {
    try { input = JSON.parse(value); } catch { throw new Error('Device file is not valid JSON'); }
  }
  if (!object(input)) throw new Error('Device definition must be an object');
  if (object(input.performance_profile)) return performanceTemplate(input.performance_profile, options);
  if (input.model && input.manufacturer) return netboxTemplate(input);
  if (input.schema === 'rack-mesh-device' && input.name && object(input.limits)) {
    return { ...structuredClone(input), id: String(input.id || input.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') };
  }
  throw new Error('Unsupported device definition. Use Headroom performance, Headroom device, or NetBox device type JSON');
}
