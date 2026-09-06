import { axisCatalog, behaviorCatalog, DEFAULT_RESPONSE_SHARE, STATEFUL_KINDS } from './data.js';
import { evidenceApplicability } from './evidence.js';

export const SESSION_SYNC_DEFAULT = 'stateful';
export const ENGINE_VERSION = '3.0.0';

const EPSILON = 1e-9;

// NIC와 forwarding은 동일한 물리 트래픽의 장비별 이름이다.
export function normalizeTraffic(load = {}) {
  const normalized = { ...load };
  for (const [a, b] of [['forwarding_bps', 'nic_bps'], ['forwarding_pps', 'nic_pps']]) {
    if (Object.hasOwn(normalized, a) && !Object.hasOwn(normalized, b)) normalized[b] = normalized[a];
    if (Object.hasOwn(normalized, b) && !Object.hasOwn(normalized, a)) normalized[a] = normalized[b];
  }
  return normalized;
}

export function requiredAxes(device) {
  if (device.external === true) return Object.keys(device.limits || {});
  const nic = ['server', 'web', 'vm', 'db', 'mail', 'mainframe', 'storage', 'nas', 'backup', 'client'].includes(device.kind);
  return [...new Set([...(nic ? ['nic_bps', 'nic_pps'] : ['forwarding_bps', 'forwarding_pps']),
    ...(STATEFUL_KINDS.has(device.kind) ? ['new_sessions_per_sec', 'concurrent_sessions'] : []), ...Object.keys(device.limits || {})])];
}

// 초과분이 곧 드롭인 축과, 신규 연결만 거절되는 축을 나눈다. 세션 테이블이 넘쳤다고
// 살아 있는 플로우의 대역이 줄지는 않는다.
export const deliveryRoleOf = (axis) => axisCatalog[axis]?.deliveryRole ?? null;
// 링크는 세션 테이블을 들지 않는다. admission 축을 쌓아 두면 판정도 못 하면서 목록만 더럽힌다.
const linkCarriesAxis = (axis) => deliveryRoleOf(axis) !== 'admission';

function addLoad(target, entries, factor, carried = 1) {
  for (const [axis, value, throughput] of entries) {
    const share = throughput ? carried : 1;
    target[axis] = (target[axis] || 0) + value * factor * share;
  }
}

// 장비가 실제로 지나보내는 몫. DSR 로드밸런서는 응답 바이트를 지나보내지 않지만
// 연결은 그대로 추적하므로 세션 축은 줄지 않는다.
export function carriedFraction(device, demand) {
  const catalog = behaviorCatalog[device.kind];
  if (!catalog || !catalog.affectsLoad) return 1;
  const mode = catalog.options[device.behavior?.mode ?? catalog.default];
  if (!mode) return 1;
  const responseShare = demand.directionality?.responseShare ?? DEFAULT_RESPONSE_SHARE;
  return (mode.carries.request ? 1 - responseShare : 0) + (mode.carries.response ? responseShare : 0);
}

function validateTopology(topology) {
  if (!topology || !Array.isArray(topology.devices) || !Array.isArray(topology.links) || !Array.isArray(topology.demands)) {
    throw new Error('Topology requires devices, links, and demands');
  }
  const issues = [];
  const issue = (resourceId, reason) => issues.push({ resourceId, reason });
  const deviceIds = new Set(topology.devices.map(({ id }) => id));
  const linkIds = new Set(topology.links.map(({ id }) => id));
  if (deviceIds.size !== topology.devices.length || linkIds.size !== topology.links.length) throw new Error('Topology IDs must be unique');
  const demandIds = new Set(topology.demands.map(({ id }) => id));
  if (demandIds.size !== topology.demands.length) throw new Error('Demand IDs must be unique');
  const usedPorts = new Set();
  for (const link of topology.links) {
    if (!deviceIds.has(link.source) || !deviceIds.has(link.target)) issue(link.id, 'missing-endpoint');
    for (const side of ['source', 'target']) {
      const portId = link[`${side}Port`];
      if (!portId) continue;
      const port = topology.devices.find(({ id }) => id === link[side])?.ports?.find(({ id }) => id === portId);
      const key = `${link[side]}:${portId}`;
      if (!port) issue(link.id, 'missing-port');
      if (usedPorts.has(key)) issue(link.id, 'port-already-connected');
      usedPorts.add(key);
      if (port && Number.isFinite(port.speedBps) && link.capacity?.forwarding_bps > port.speedBps) issue(link.id, 'link-exceeds-port-speed');
    }
  }
  for (const group of topology.haGroups || []) {
    if (!Array.isArray(group.members) || !group.members.length) issue(group.id, 'ha-members-missing');
    for (const member of group.members || []) if (!deviceIds.has(member)) issue(group.id, 'ha-member-missing');
  }
  for (const demand of topology.demands) {
    if (!demand.paths?.length && !(demand.source && demand.target)) issue(demand.id, 'paths-or-endpoints-missing');
    if ((demand.source && !deviceIds.has(demand.source)) || (demand.target && !deviceIds.has(demand.target))) issue(demand.id, 'missing-endpoint');
    for (const [axis, value] of Object.entries(demand.load || {})) if (!Number.isFinite(value) || value < 0) issue(demand.id, `invalid-load:${axis}`);
    for (const [a, b] of [['forwarding_bps', 'nic_bps'], ['forwarding_pps', 'nic_pps']]) {
      if (Object.hasOwn(demand.load || {}, a) && Object.hasOwn(demand.load || {}, b) && demand.load[a] !== demand.load[b]) issue(demand.id, `conflicting-load:${a}:${b}`);
    }
    const pool = demand.backendPool;
    if (pool != null && pool !== 'single' && !Array.isArray(pool?.memberIds)) issue(demand.id, 'invalid-backend-pool');
    if (Array.isArray(pool?.memberIds) && pool.memberIds.some((id) => !deviceIds.has(id))) issue(demand.id, 'backend-pool-member-missing');
    for (const path of demand.pathMode === 'shortest' ? [] : demand.paths || []) {
      if (!Array.isArray(path.devices) || path.devices.some((id) => !deviceIds.has(id))) issue(demand.id, 'path-missing-device');
      if (!Array.isArray(path.links) || path.links.some((id) => !linkIds.has(id))) issue(demand.id, 'path-missing-link');
    }
  }
  for (const service of topology.services || []) {
    if (!service.demandIds?.length || service.demandIds.some((id) => !demandIds.has(id))) issue(service.id, 'service-demand-missing');
    if (!Number.isFinite(service.requiredDeliveryRatio ?? 1) || (service.requiredDeliveryRatio ?? 1) < 0 || (service.requiredDeliveryRatio ?? 1) > 1) issue(service.id, 'invalid-delivery-ratio');
    for (const group of service.endpointGroups || []) {
      if (!group.members?.length || group.members.some((id) => !deviceIds.has(id))) issue(service.id, 'service-endpoint-missing');
      if (!Number.isInteger(group.minAvailable ?? 1) || (group.minAvailable ?? 1) < 1 || (group.minAvailable ?? 1) > (group.members?.length || 0)) issue(service.id, 'invalid-min-available');
    }
  }
  for (const domain of topology.failureDomains || []) {
    if ((domain.deviceIds || []).some((id) => !deviceIds.has(id)) || (domain.linkIds || []).some((id) => !linkIds.has(id))) issue(domain.id, 'domain-member-missing');
  }
  for (const rack of topology.racks || []) if ((rack.deviceIds || []).some((id) => !deviceIds.has(id))) issue(rack.id, 'rack-member-missing');
  return issues;
}

export function findShortestPaths(topology, source, target, options = {}) {
  const disabledDevices = new Set(options.disabledDevices || []);
  const disabledLinks = new Set(options.disabledLinks || []);
  return enumerateShortestPaths(adjacencyFor(topology, disabledDevices, disabledLinks), source, [target], options);
}

function adjacencyFor(topology, disabledDevices, disabledLinks) {
  const adjacency = new Map(topology.devices.filter(({ id }) => !disabledDevices.has(id)).map(({ id }) => [id, []]));
  for (const link of topology.links) {
    if (disabledLinks.has(link.id) || disabledDevices.has(link.source) || disabledDevices.has(link.target)) continue;
    adjacency.get(link.source)?.push({ device: link.target, link: link.id });
    adjacency.get(link.target)?.push({ device: link.source, link: link.id });
  }
  for (const edges of adjacency.values()) edges.sort((a, b) => a.device.localeCompare(b.device) || a.link.localeCompare(b.link));
  return adjacency;
}

function shortestTree(adjacency, source) {
  const distance = new Map([[source, 0]]);
  const parents = new Map();
  const queue = [source];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    for (const edge of adjacency.get(node)) {
      const nextDistance = distance.get(node) + 1;
      if (!distance.has(edge.device)) { distance.set(edge.device, nextDistance); parents.set(edge.device, [{ node, link: edge.link }]); queue.push(edge.device); }
      else if (distance.get(edge.device) === nextDistance) parents.get(edge.device).push({ node, link: edge.link });
    }
  }
  return { distance, parents };
}

// ECMP 는 홉마다 갈라진다. 경로 수로 1/N 을 매기면 갈래가 적은 쪽에도 같은 몫이 실려,
// 실제로는 길이 없는 곳으로 트래픽을 보낸 셈이 된다. 각 홉의 갈래 수를 곱해 몫을 정한다.
// 목적지는 트래픽이 멎는 곳이므로 다른 목적지를 경유하는 경로는 세지 않는다.
function enumerateShortestPaths(adjacency, source, targets, options = {}) {
  if (options.maxPaths != null && (!Number.isInteger(options.maxPaths) || options.maxPaths < 1)) throw new Error('maxPaths must be a positive integer');
  if (!adjacency.has(source)) return [];
  const sinks = new Set([...new Set(targets)].filter((id) => id !== source && adjacency.has(id)));
  if (!sinks.size) return [];
  const { distance, parents } = shortestTree(adjacency, source);
  const reachable = [...sinks].filter((id) => distance.has(id)).sort();
  if (!reachable.length) return [];
  const useful = new Set(reachable);
  const branches = new Map();
  const stack = [...reachable];
  while (stack.length) {
    const node = stack.pop();
    for (const parent of parents.get(node) || []) {
      if (sinks.has(parent.node)) continue;
      if (!branches.has(parent.node)) branches.set(parent.node, new Set());
      branches.get(parent.node).add(node);
      if (useful.has(parent.node)) continue;
      useful.add(parent.node);
      stack.push(parent.node);
    }
  }
  if (!useful.has(source)) return [];
  const paths = [];
  const visit = (node, target, devices, links, weight) => {
    if (paths.length >= (options.maxPaths ?? 64)) { paths.truncated = true; return; }
    if (node === source) {
      paths.push({ id: `${source}-${target}-${paths.length + 1}`, devices: [source, ...devices.slice().reverse()], links: links.slice().reverse(), weight });
      return;
    }
    for (const parent of (parents.get(node) || []).slice().sort((a, b) => a.node.localeCompare(b.node))) {
      if (sinks.has(parent.node) || !useful.has(parent.node)) continue;
      visit(parent.node, target, [...devices, node], [...links, parent.link], weight / branches.get(parent.node).size);
    }
  };
  for (const target of reachable) visit(target, target, [], [], 1);
  return paths;
}

// 로드밸런서 뒤에 같은 클래스 서버가 여럿 붙어 있으면 그건 한 풀이다. demand 가 한 대를
// 찍고 있어도 실제로 나눠 보내는 쪽은 LB 다. 그래서 자동으로 묶는다. 풀은 설계의 성질이라
// 장애가 주입된 그래프가 아니라 무장애 그래프에서 판정한다 — 백엔드 한 대가 죽었다고
// 나머지가 풀에서 빠지지는 않는다.
const BACKEND_FRONT_KINDS = new Set(['lb']);
export function backendPoolFor(demand, adjacency, deviceIndex, treeFor) {
  const declared = demand.backendPool;
  if (declared === 'single') return [demand.target];
  if (Array.isArray(declared?.memberIds)) {
    return [...new Set([demand.target, ...declared.memberIds])].filter((id) => deviceIndex.has(id)).sort();
  }
  const target = deviceIndex.get(demand.target);
  if (!target || !demand.source || demand.source === demand.target) return [demand.target];
  if (!adjacency.has(demand.source) || !adjacency.has(demand.target)) return [demand.target];
  const { distance, parents } = treeFor(demand.source);
  const fronts = parents.get(demand.target) || [];
  if (!fronts.length || !fronts.every(({ node }) => BACKEND_FRONT_KINDS.has(deviceIndex.get(node)?.kind))) return [demand.target];
  const depth = distance.get(demand.target);
  const members = new Set([demand.target]);
  for (const { node } of fronts) {
    for (const edge of adjacency.get(node) || []) {
      if (distance.get(edge.device) !== depth) continue;
      if (deviceIndex.get(edge.device)?.kind !== target.kind) continue;
      members.add(edge.device);
    }
  }
  return [...members].sort();
}

export const LINK_DIRECTIONS = ['forward', 'reverse'];

// 경로가 각 링크를 어느 쪽으로 지나는지 정한다. links[i] 는 devices[i] 와 devices[i+1] 을
// 이어야 한다. 어긋난 경로는 던지지 않고 invalid 로 보고한다. 손으로 편집한 오래된 파일을
// 열지 못하게 만들 이유가 없고, PRD 는 입력 오류를 valid|invalid 갈래로 다루라고 한다.
function resolveHops(path, linkIndex) {
  const devices = path.devices || [];
  const linkIds = path.links || [];
  if (devices.length < 2) return { valid: false, reason: 'path-too-short' };
  if (linkIds.length !== devices.length - 1) return { valid: false, reason: 'hop-count-mismatch' };
  const hops = [];
  for (let index = 0; index < linkIds.length; index += 1) {
    const link = linkIndex.get(linkIds[index]);
    if (!link) return { valid: false, reason: 'missing-link', hopIndex: index };
    const from = devices[index];
    const to = devices[index + 1];
    const direction = link.source === from && link.target === to ? 'forward'
      : link.source === to && link.target === from ? 'reverse' : null;
    if (!direction) return { valid: false, reason: 'hop-endpoint-mismatch', hopIndex: index };
    hops.push({ linkId: link.id, direction });
  }
  return { valid: true, hops };
}

// LB 가 실제로 각 백엔드에 얼마씩 보내는지. 풀을 화면에 보여 주려면 이 값이 필요하다.
function backendShares(paths) {
  const shares = new Map();
  for (const path of paths) {
    const id = path.devices.at(-1);
    shares.set(id, (shares.get(id) || 0) + path.weight);
  }
  return [...shares].sort((a, b) => a[0].localeCompare(b[0])).map(([id, share]) => ({ id, share }));
}

export function resolveDemandPaths(topology, disabledDevices = new Set(), disabledLinks = new Set(), options = {}) {
  const linkIndex = new Map(topology.links.map((link) => [link.id, link]));
  const deviceIndex = new Map(topology.devices.map((device) => [device.id, device]));
  const deviceIds = new Set(deviceIndex.keys());
  const shortestCache = new Map();
  let adjacency;
  let poolAdjacency;
  const poolTrees = new Map();
  const treeFor = (source) => {
    if (!poolTrees.has(source)) poolTrees.set(source, shortestTree(poolAdjacency, source));
    return poolTrees.get(source);
  };
  const resolved = new Map();
  for (const demand of topology.demands) {
    const explicit = demand.pathMode === 'explicit' || (demand.pathMode !== 'shortest' && demand.paths?.length);
    let targets = [demand.target];
    if (!explicit) {
      poolAdjacency ??= adjacencyFor(topology, new Set(), new Set());
      targets = backendPoolFor(demand, poolAdjacency, deviceIndex, treeFor);
    }
    const cacheKey = JSON.stringify([demand.source, targets]);
    if (!explicit && shortestCache.has(cacheKey)) { resolved.set(demand.id, shortestCache.get(cacheKey)); continue; }
    const candidatePaths = explicit
      ? demand.paths || []
      : enumerateShortestPaths(adjacency ??= adjacencyFor(topology, disabledDevices, disabledLinks), demand.source, targets, options);
    const activePaths = [];
    const invalidPaths = [];
    for (const path of candidatePaths) {
      if (!Array.isArray(path.devices) || !Array.isArray(path.links) || path.devices.some((id) => !deviceIds.has(id))) { invalidPaths.push({ id: path.id, reason: 'missing-device' }); continue; }
      if (path.devices.some((id) => disabledDevices.has(id)) || path.links.some((id) => disabledLinks.has(id))) continue;
      const walk = resolveHops(path, linkIndex);
      if (!walk.valid) {
        if (options.strictPaths) throw new Error(`Path ${path.id} is not contiguous: ${walk.reason}`);
        invalidPaths.push({ id: path.id, reason: walk.reason, ...(walk.hopIndex == null ? {} : { hopIndex: walk.hopIndex }) });
        continue;
      }
      activePaths.push({ ...path, hops: walk.hops, weight: Number.isFinite(path.weight) ? path.weight : 1 });
    }
    // 몫은 살아남은 경로에서만 다시 정규화한다. 한 갈래가 끊기면 남은 길이 그만큼 더 받는다.
    const totalWeight = activePaths.reduce((sum, path) => sum + path.weight, 0);
    for (const path of activePaths) path.weight = totalWeight > 0 ? path.weight / totalWeight : 1 / activePaths.length;
    resolved.set(demand.id, { candidatePaths, activePaths, invalidPaths, backends: backendShares(activePaths) });
    if (!explicit) shortestCache.set(cacheKey, resolved.get(demand.id));
  }
  return resolved;
}

function axisResult(load, limit, warningThreshold) {
  if (limit == null) return { load: load ?? null, limit: null, utilization: null, headroom: null, status: 'unknown', unknownReason: 'limit-missing' };
  if (!Number.isFinite(limit) || limit <= 0) return { load, limit, utilization: null, headroom: null, status: 'invalid' };
  if (load == null) return { load: null, limit, utilization: null, headroom: null, status: 'unknown', unknownReason: 'workload-missing' };
  const utilization = load / limit;
  const headroom = 1 - utilization;
  const status = utilization > 1 + EPSILON ? 'overloaded' : utilization >= warningThreshold ? 'warning' : 'healthy';
  return { load, limit, utilization, headroom, status };
}

function summarizeAxes(axes) {
  const known = Object.entries(axes).filter(([, axis]) => axis.utilization != null);
  const binding = known.sort((a, b) => b[1].utilization - a[1].utilization)[0] || null;
  const statuses = [...new Set(Object.values(axes).map(({ status }) => status))];
  const primaryStatus = !statuses.length ? 'unknown'
    : statuses.includes('overloaded') ? 'overloaded'
      : statuses.includes('warning') ? 'warning'
        : statuses.includes('invalid') ? 'invalid'
          : statuses.includes('unknown') ? 'unknown' : 'healthy';
  return { bindingAxis: binding?.[0] || null, minHeadroom: binding ? binding[1].headroom : null, statuses, primaryStatus };
}

export function calculateScenario(topology, options = {}) {
  const validationIssues = validateTopology(topology);
  topology = { ...topology, demands: topology.demands.map((demand) => ({ ...demand, load: normalizeTraffic(demand.load) })) };
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale < 0) throw new Error('Scale must be a non-negative finite number');
  const disabledDevices = new Set(options.disabledDevices || []);
  const disabledLinks = new Set(options.disabledLinks || []);
  for (const id of options.disabledDomains || []) {
    const domain = topology.failureDomains?.find((item) => item.id === id);
    if (!domain) { validationIssues.push({ resourceId: id, reason: 'failure-domain-missing' }); continue; }
    for (const deviceId of domain.deviceIds || []) disabledDevices.add(deviceId);
    for (const linkId of domain.linkIds || []) disabledLinks.add(linkId);
  }
  const warningThreshold = topology.warningThreshold ?? 0.8;
  const deviceIndex = new Map(topology.devices.map((device) => [device.id, device]));
  const deviceAxes = new Map(topology.devices.map((device) => [device.id, requiredAxes(device)]));
  const linkAxes = new Map(topology.links.map((link) => [link.id, Object.keys({ forwarding_bps: null, ...link.capacity, ...link.capacityByDirection?.forward, ...link.capacityByDirection?.reverse })]));
  const deviceLoads = Object.fromEntries(topology.devices.map(({ id }) => [id, {}]));
  const linkLoads = Object.fromEntries(topology.links.map(({ id }) => [id, { forward: {}, reverse: {} }]));
  const demandResults = [];
  const missingDeviceLoads = Object.fromEntries(topology.devices.map(({ id }) => [id, new Set()]));
  const missingLinkLoads = Object.fromEntries(topology.links.map(({ id }) => [id, { forward: new Set(), reverse: new Set() }]));
  const resolvedPaths = resolveDemandPaths(topology, disabledDevices, disabledLinks, options);
  // 장애가 있을 때만 푼다. 끊긴 demand 가 무장애였다면 어디를 지났는지는 결과에 남지 않으므로
  // 캔버스가 무엇이 끊겼는지 그릴 수 없다. 폭증 계산도 같은 경로를 쓴다.
  const noFaultPaths = disabledDevices.size || disabledLinks.size
    ? resolveDemandPaths(topology, new Set(), new Set(), options)
    : null;
  // 같은 ECMP 경로가 여러 수요에서 재사용된다. 각 자원이 받는 몫을 한 번 합쳐 두면
  // 부하는 경로마다 다시 훑을 것 없이 고유 자원 수만큼만 누적하면 된다.
  // 어떤 수요도 지나지 않는 장비는 조용히 0 으로만 보인다. 그 0 이 "부하가 없다"인지
  // "연결만 해 두고 아무도 안 쓴다"인지 구분해 줘야 새로 그린 장비를 보고 헷갈리지 않는다.
  const demandTouched = new Set();
  const footprintCache = new WeakMap();
  const footprintFor = (paths) => {
    if (footprintCache.has(paths)) return footprintCache.get(paths);
    const devices = new Map();
    const hops = new Map();
    for (const path of paths) {
      for (const id of new Set(path.devices)) devices.set(id, (devices.get(id) || 0) + path.weight);
      for (const hop of path.hops) {
        const key = `${hop.linkId}:${hop.direction}`;
        if (!hops.has(key)) hops.set(key, { ...hop, weight: 0 });
        hops.get(key).weight += path.weight;
      }
    }
    const footprint = { devices, hops: [...hops.values()] };
    footprintCache.set(paths, footprint);
    return footprint;
  };

  for (const demand of topology.demands) {
    const { activePaths, invalidPaths } = resolvedPaths.get(demand.id);
    const validity = invalidPaths.length || validationIssues.some(({ resourceId }) => resourceId === demand.id) ? 'invalid' : 'valid';
    if (!activePaths.length) {
      demandResults.push({ id: demand.id, name: demand.name, status: 'unreachable', validity, invalidPaths, deliveredRatio: 0, paths: [], backends: [],
        severedPaths: (noFaultPaths?.get(demand.id)?.activePaths || []).map(({ id, devices, links }) => ({ id, devices, links })),
        load: scaledLoad(demand.load, scale) });
      for (const path of noFaultPaths?.get(demand.id)?.activePaths || []) for (const id of path.devices) demandTouched.add(id);
      continue;
    }
    const entries = Object.entries(demand.load).filter(([, value]) => Number.isFinite(value) && value >= 0)
      .map(([axis, value]) => [axis, value, deliveryRoleOf(axis) === 'throughput']);
    const linkEntries = entries.filter(([axis]) => linkCarriesAxis(axis));
    const footprint = footprintFor(activePaths);
    for (const [deviceId, weight] of footprint.devices) {
        demandTouched.add(deviceId);
        addLoad(deviceLoads[deviceId], entries, scale * weight, carriedFraction(deviceIndex.get(deviceId), demand));
        for (const axis of deviceAxes.get(deviceId)) if (!Number.isFinite(demand.load[axis])) missingDeviceLoads[deviceId].add(axis);
    }
    for (const hop of footprint.hops) {
        addLoad(linkLoads[hop.linkId][hop.direction], linkEntries, scale * hop.weight);
        for (const axis of linkAxes.get(hop.linkId)) if (!Number.isFinite(demand.load[axis])) missingLinkLoads[hop.linkId][hop.direction].add(axis);
    }
    demandResults.push({
      id: demand.id, name: demand.name, status: 'delivered', validity, invalidPaths, load: scaledLoad(demand.load, scale),
      paths: activePaths.map(({ id, weight }) => ({ id, share: weight })),
      backends: resolvedPaths.get(demand.id).backends,
    });
  }

  const failover = failoverSurge(topology, options, disabledDevices, disabledLinks, scale, resolvedPaths, noFaultPaths);
  for (const [deviceId, cps] of Object.entries(failover.surge)) {
    deviceLoads[deviceId].new_sessions_per_sec = (deviceLoads[deviceId].new_sessions_per_sec || 0) + cps;
  }

  const devices = topology.devices.map((device) => {
    const axes = Object.fromEntries(requiredAxes(device).map((axis) => [axis, axisResult(missingDeviceLoads[device.id].has(axis) ? null : deviceLoads[device.id][axis] ?? 0, device.limits?.[axis], warningThreshold)]));
    const records = device.spec?.records ?? device.metadata?.records ?? [];
    for (const [axis, result] of Object.entries(axes)) {
      const record = records.find((item) => item.axis === axis);
      if (Object.hasOwn(device.overrides || {}, axis)) {
        result.evidenceApplicability = 'user-correction';
        result.source = { type: 'user-correction', original: structuredClone(record?.source ?? null) };
        continue;
      }
      if (!record) continue;
      const applicability = (device.spec?.conditionSelection || device.metadata?.conditionSelection) === 'explicit-profile'
        ? 'applicable'
        : evidenceApplicability(record, topology.workloadConditions ?? {}, topology.workloadScope ?? null);
      result.evidenceApplicability = applicability;
      result.source = structuredClone(record.source ?? null);
      if (applicability === 'applicable') continue;
      if (applicability === 'incompatible') validationIssues.push({ resourceId: device.id, axis, category: 'applicability', reason: 'evidence-incompatible' });
      // 잘못된 숫자 자체는 조건 미확인으로 가리지 않는다.
      if (result.status === 'invalid') continue;
      axes[axis] = { ...result, utilization: null, headroom: null, status: 'unknown',
        unknownReason: applicability === 'incompatible' ? 'evidence-incompatible' : 'evidence-applicability-unknown' };
    }
    const surge = failover.surge[device.id];
    if (surge && axes.new_sessions_per_sec) {
      axes.new_sessions_per_sec.contributions = { steady: axes.new_sessions_per_sec.load - surge, failoverSurge: surge };
    }
    // 폭증량을 모르면 0 으로 치지 않는다. 모르는 것을 안전으로 바꾸면 안 된다.
    if (failover.unknownSurge.has(device.id) && axes.new_sessions_per_sec) {
      axes.new_sessions_per_sec = { ...axes.new_sessions_per_sec, utilization: null, headroom: null, status: 'unknown', unknownReason: 'failover-surge-window-missing' };
    }
    return { ...device, active: !disabledDevices.has(device.id), carriesDemand: demandTouched.has(device.id), load: deviceLoads[device.id], axes, ...summarizeAxes(axes) };
  });
  const links = topology.links.map((link) => {
    const directions = Object.fromEntries(LINK_DIRECTIONS.map((direction) => {
      const capacity = { forwarding_bps: null, ...link.capacity, ...(link.capacityByDirection?.[direction] || {}) };
      const load = linkLoads[link.id][direction];
      const axes = Object.fromEntries(Object.entries(capacity).map(([axis, limit]) => [axis, axisResult(missingLinkLoads[link.id][direction].has(axis) ? null : load[axis] ?? 0, limit, warningThreshold)]));
      return [direction, { load, axes }];
    }));
    // 평면 axes 는 사용률이 큰 방향을 고른다. 동률이면 forward. UI 는 이 형태를 그대로 읽는다.
    const axes = {};
    const load = {};
    for (const axis of new Set([...Object.keys(directions.forward.axes), ...Object.keys(directions.reverse.axes)])) {
      const forward = directions.forward.axes[axis];
      const reverse = directions.reverse.axes[axis];
      const pick = (reverse?.utilization ?? -1) > (forward?.utilization ?? -1) ? 'reverse' : 'forward';
      axes[axis] = { ...directions[pick].axes[axis], direction: pick };
      load[axis] = directions[pick].load[axis] || 0;
    }
    // 상태 요약은 양방향 전부를 본다. 한쪽만 unknown 이어도 안전하다고 말하지 않는다.
    const spread = {};
    for (const direction of LINK_DIRECTIONS) {
      for (const [axis, result] of Object.entries(directions[direction].axes)) spread[`${direction}:${axis}`] = result;
    }
    const summary = summarizeAxes(spread);
    const [bindingDirection, bindingAxis] = summary.bindingAxis ? summary.bindingAxis.split(':') : [null, null];
    const active = !disabledLinks.has(link.id);
    // 링크가 켜져 있어도 양 끝 중 하나가 죽으면 트래픽은 흐를 수 없다. 경로 탐색은 이미
    // 그 조건을 보는데(findShortestPaths) 링크 결과에는 담기지 않아 유휴 링크와 구별되지 않았다.
    const severed = !active || disabledDevices.has(link.source) || disabledDevices.has(link.target);
    return { ...link, active, severed, load, axes, directions, ...summary, bindingAxis, bindingDirection };
  });
  const passTable = new Map();
  const passFor = (axes) => {
    let throughputPass = 1;
    let admissionPass = 1;
    const unknownAxes = [];
    const invalidAxes = [];
    for (const [axis, result] of Object.entries(axes)) {
      const role = deliveryRoleOf(axis);
      if (result.status === 'unknown') { if (role) unknownAxes.push(axis); continue; }
      if (result.status === 'invalid') { invalidAxes.push(axis); continue; }
      if (result.utilization <= 1 + EPSILON) continue;
      const pass = result.limit / result.load;
      if (role === 'throughput') throughputPass = Math.min(throughputPass, pass);
      else if (role === 'admission') admissionPass = Math.min(admissionPass, pass);
    }
    return { throughputPass, admissionPass, unknownAxes, invalidAxes };
  };
  for (const device of devices) passTable.set(`device:${device.id}`, passFor(device.axes));
  for (const link of links) {
    for (const direction of LINK_DIRECTIONS) passTable.set(`link:${link.id}:${direction}`, passFor(link.directions[direction].axes));
  }
  const pathPassCache = new WeakMap();
  const pathPassFor = (path) => {
    if (pathPassCache.has(path)) return pathPassCache.get(path);
    const outcome = { pass: 1, admit: 1, choke: null, admissionLimit: null, unknownConstraints: [], invalid: false };
    for (let index = 0; index < path.devices.length; index += 1) {
      const stops = [{ key: `device:${path.devices[index]}`, resourceId: path.devices[index], direction: null }];
      const hop = path.hops[index];
      if (hop) stops.push({ key: `link:${hop.linkId}:${hop.direction}`, resourceId: hop.linkId, direction: hop.direction });
      for (const stop of stops) {
        const entry = passTable.get(stop.key);
        for (const axis of entry.unknownAxes) outcome.unknownConstraints.push({ resourceId: stop.resourceId, direction: stop.direction, axis });
        if (entry.invalidAxes.length) outcome.invalid = true;
        if (entry.throughputPass < outcome.pass) { outcome.pass = entry.throughputPass; outcome.choke = stop; }
        if (entry.admissionPass < outcome.admit) { outcome.admit = entry.admissionPass; outcome.admissionLimit = stop; }
      }
    }
    pathPassCache.set(path, outcome);
    return outcome;
  };

  for (const result of demandResults) {
    if (result.status === 'unreachable') { result.deliveredRatio = 0; result.deliveredRatioBound = 'exact'; result.droppedLoad = result.load; continue; }
    const { activePaths } = resolvedPaths.get(result.id);
    const unknownConstraints = [];
    let delivered = 0;
    let admitted = 0;
    let admissionLimit = null;
    result.paths = activePaths.map((path) => {
      const outcome = pathPassFor(path);
      const { pass, admit, choke } = outcome;
      unknownConstraints.push(...outcome.unknownConstraints);
      if (outcome.invalid) result.validity = 'invalid';
      if (outcome.admissionLimit) admissionLimit = outcome.admissionLimit;
      delivered += path.weight * pass;
      admitted += path.weight * admit;
      return { id: path.id, share: path.weight, deliveredRatio: pass, admissionRatio: admit, choke: choke && { resourceId: choke.resourceId, direction: choke.direction } };
    });
    result.deliveredRatio = delivered;
    result.admissionRatio = admitted;
    result.admissionRatio = admitted;
    // 모르는 한계는 스로틀에 관여시키지 않되 결과를 오염시킨다. 82% 가 아니라 82% 이하다.
    const truncated = resolvedPaths.get(result.id).candidatePaths.truncated;
    if (truncated) unknownConstraints.push({ resourceId: result.id, axis: 'paths', reason: 'path-enumeration-limit' });
    result.deliveredRatioBound = truncated ? 'indeterminate' : unknownConstraints.length ? 'upper' : 'exact';
    result.pathEnumeration = { complete: !truncated, evaluatedPaths: activePaths.length, limit: options.maxPaths ?? 64 };
    if (unknownConstraints.length) result.unknownConstraints = unknownConstraints;
    result.deliveredLoad = scaledLoad(result.load, delivered);
    result.droppedLoad = scaledLoad(result.load, 1 - delivered);
    const offeredSessions = result.load.new_sessions_per_sec || 0;
    if (offeredSessions && admitted < 1 - EPSILON) {
      // 세션 테이블이 넘쳐도 살아 있는 플로우의 대역은 줄지 않는다. 신규 연결만 거절된다.
      result.sessionAdmission = {
        axis: 'new_sessions_per_sec', offered: offeredSessions, ratio: admitted,
        admitted: offeredSessions * admitted, refusedPerSec: offeredSessions * (1 - admitted),
        limitedBy: admissionLimit && { resourceId: admissionLimit.resourceId, direction: admissionLimit.direction },
      };
    }
  }

  const activeResources = [...devices.filter(({ active }) => active), ...links.filter(({ active }) => active)];
  const binding = activeResources
    .filter(({ minHeadroom }) => minHeadroom != null)
    .sort((a, b) => a.minHeadroom - b.minHeadroom)[0] || null;
  const unreachable = demandResults.filter(({ status }) => status === 'unreachable');
  const invalidAxes = activeResources.flatMap((resource) => Object.entries(resource.axes).filter(([, axis]) => axis.status === 'invalid').map(([axis]) => ({ resourceId: resource.id, reason: `invalid-limit:${axis}` })));
  validationIssues.push(...invalidAxes);
  let unknownCount = activeResources.reduce((sum, resource) => sum + Object.values(resource.axes).filter(({ status }) => status === 'unknown').length, 0)
    + demandResults.filter(({ deliveredRatioBound }) => deliveredRatioBound !== 'exact').length;
  const services = evaluateServices(topology, demandResults, disabledDevices);
  const racks = evaluateRacks(topology);
  unknownCount += racks.filter(({ status }) => status === 'unknown').length;
  const invalid = validationIssues.some(({ category }) => category !== 'applicability') || demandResults.some(({ validity }) => validity === 'invalid');
  const evidenceUnknown = devices.filter(({ active }) => active).some(({ axes }) => Object.values(axes).some(({ evidenceApplicability: status }) => status === 'unknown' || status === 'incompatible'));
  const failed = unreachable.length > 0 || demandResults.some((demand) => demand.deliveredRatio < 1 - EPSILON || demand.admissionRatio < 1 - EPSILON);
  const evaluationStatus = invalid ? 'invalid' : !topology.demands.length ? 'not-ready'
    : evidenceUnknown ? 'unknown'
    : demandResults.some(({ deliveredRatioBound }) => deliveredRatioBound === 'indeterminate') ? 'unknown'
    : racks.some(({ status }) => status === 'fail') ? 'fail'
    : racks.some(({ status }) => status === 'unknown') ? 'unknown'
    : services.length ? services.some(({ status }) => status === 'fail') ? 'fail' : services.some(({ status }) => status !== 'pass') ? 'unknown' : 'pass'
      : failed ? 'fail' : unknownCount ? 'unknown' : 'pass';

  return {
    schemaVersion: 3, engineVersion: ENGINE_VERSION, scale, devices, links, demands: demandResults, services, racks, validationIssues,
    faults: { devices: [...disabledDevices].sort(), links: [...disabledLinks].sort(), domains: [...(options.disabledDomains || [])].sort() },
    summary: {
      validationStatus: invalid ? 'invalid' : 'valid', unknownCount, evaluationStatus,
      bindingResourceId: binding?.id || null, bindingAxis: binding?.bindingAxis || null,
      minHeadroom: binding?.minHeadroom ?? null, unreachableCount: unreachable.length,
      unreachableLoadBps: unreachable.reduce((sum, item) => sum + (item.load.forwarding_bps || 0), 0),
      droppedLoadBps: demandResults.filter(({ status }) => status === 'delivered')
        .reduce((sum, item) => sum + (item.droppedLoad?.forwarding_bps || 0), 0),
      refusedSessionsPerSec: demandResults.reduce((sum, item) => sum + (item.sessionAdmission?.refusedPerSec || 0), 0),
      overloadedCount: activeResources.filter(({ primaryStatus }) => primaryStatus === 'overloaded').length,
      warningCount: activeResources.filter(({ primaryStatus }) => primaryStatus === 'warning').length,
      activeFaults: disabledDevices.size + disabledLinks.size,
    },
    failover: failover.report,
  };
}

export function evaluateServices(topology, demands, disabledDevices = new Set()) {
  return (topology.services || []).map((service) => {
    const selected = (service.demandIds || []).map((id) => demands.find((demand) => demand.id === id));
    const endpointGroups = (service.endpointGroups || []).map((group) => ({ ...group,
      available: (group.members || []).filter((id) => !disabledDevices.has(id) && topology.devices.some((device) => device.id === id)).length }));
    const required = service.requiredDeliveryRatio ?? 1;
    const invalid = selected.some((demand) => !demand || demand.validity === 'invalid');
    const failed = endpointGroups.some((group) => group.available < (group.minAvailable ?? 1))
      || selected.some((demand) => demand && demand.deliveredRatioBound !== 'indeterminate' && (demand.deliveredRatio < required - EPSILON || (demand.admissionRatio ?? 1) < required - EPSILON));
    const unknown = !selected.length || selected.some((demand) => demand?.deliveredRatioBound !== 'exact');
    return { ...service, endpointGroups, status: invalid ? 'invalid' : failed ? 'fail' : unknown ? 'unknown' : 'pass' };
  });
}

export function evaluateRacks(topology) {
  const powerFields = { nameplate: 'maximumDrawWatts', typical: 'typicalDrawWatts', measured: 'measuredDrawWatts' };
  return (topology.racks || []).map((rack) => {
    const devices = (rack.deviceIds || []).map((id) => topology.devices.find((device) => device.id === id));
    const values = (field) => devices.map((device) => device?.metadata?.[field]);
    const power = values(powerFields[rack.powerBasis]);
    const units = values('uHeight');
    const known = (numbers) => numbers.length > 0 && numbers.every((value) => Number.isFinite(value) && value >= 0);
    const powerKnown = Boolean(powerFields[rack.powerBasis]) && known(power) && devices.every((device) => !device?.metadata?.powerBasis || device.metadata.powerBasis === rack.powerBasis);
    const powerWatts = powerKnown ? power.reduce((sum, value) => sum + value, 0) : null;
    const usedU = known(units) ? units.reduce((sum, value) => sum + value, 0) : null;
    const powerBudgetKnown = Number.isFinite(rack.powerBudgetWatts) && rack.powerBudgetWatts > 0;
    const capacityKnown = Number.isFinite(rack.capacityU) && rack.capacityU > 0;
    const overloaded = (powerKnown && powerBudgetKnown && powerWatts > rack.powerBudgetWatts) || (usedU != null && capacityKnown && usedU > rack.capacityU);
    return { ...rack, powerWatts, usedU, powerHeadroomWatts: powerKnown && powerBudgetKnown ? rack.powerBudgetWatts - powerWatts : null,
      remainingU: usedU != null && capacityKnown ? rack.capacityU - usedU : null,
      status: overloaded ? 'fail' : !powerKnown || usedU == null || !powerBudgetKnown || !capacityKnown ? 'unknown' : 'pass' };
  });
}

function failoverSurge(topology, options, disabledDevices, disabledLinks, scale, currentPaths, baselinePaths) {
  const groups = topology.haGroups || [];
  const override = options.sessionSync && options.sessionSync !== 'declared' ? options.sessionSync : null;
  const report = {
    assumptionSource: override ? 'scenario-override' : groups.length ? 'declared' : 'default',
    sessionSync: override || null, groups: groups.map(({ id, members, sessionSync, reestablishWindowSec }) => ({ id, members, sessionSync, reestablishWindowSec: reestablishWindowSec ?? null })),
    transfers: [],
  };
  const surge = {};
  const unknownSurge = new Set();
  if (!disabledDevices.size) return { surge, unknownSurge, report };

  for (const failedId of disabledDevices) {
    const group = groups.find(({ members }) => members?.includes(failedId));
    const sessionSync = override || group?.sessionSync || SESSION_SYNC_DEFAULT;
    if (sessionSync !== 'none') continue;
    const windowSec = options.reestablishWindowSec ?? group?.reestablishWindowSec ?? null;
    for (const demand of topology.demands) {
      const before = baselinePaths.get(demand.id).activePaths;
      const after = currentPaths.get(demand.id).activePaths;
      if (!before.length || !after.length) continue;
      const lost = before.filter((path) => path.devices.includes(failedId)).reduce((sum, path) => sum + path.weight, 0);
      const transferred = (demand.load.concurrent_sessions || 0) * scale * lost;
      if (!transferred) continue;
      if (!Number.isFinite(windowSec) || windowSec <= 0) {
        for (const path of after) for (const deviceId of new Set(path.devices)) unknownSurge.add(deviceId);
        report.transfers.push({ demandId: demand.id, failedId, transferred, surge: null, status: 'unknown', reason: 'reestablish-window-missing' });
        continue;
      }
      for (const path of after) for (const deviceId of new Set(path.devices)) surge[deviceId] = (surge[deviceId] || 0) + (transferred / windowSec) * path.weight;
      report.transfers.push({ demandId: demand.id, failedId, transferred, surge: transferred / windowSec, windowSec, status: 'known', derivation: 'transferred_sessions / reestablish_window_sec' });
    }
  }
  return { surge, unknownSurge, report };
}

function scaledLoad(load, scale) {
  return Object.fromEntries(Object.entries(load || {}).filter(([, value]) => Number.isFinite(value) && value >= 0).map(([axis, value]) => [axis, value * scale]));
}

export function compareScenarios(baseline, current) {
  return {
    minHeadroomDelta: current.summary.minHeadroom == null || baseline.summary.minHeadroom == null
      ? null : current.summary.minHeadroom - baseline.summary.minHeadroom,
    unreachableDelta: current.summary.unreachableCount - baseline.summary.unreachableCount,
    overloadedDelta: current.summary.overloadedCount - baseline.summary.overloadedCount,
    bindingChanged: baseline.summary.bindingResourceId !== current.summary.bindingResourceId || baseline.summary.bindingAxis !== current.summary.bindingAxis,
    droppedLoadBpsDelta: (current.summary.droppedLoadBps || 0) - (baseline.summary.droppedLoadBps || 0),
    refusedSessionsDelta: (current.summary.refusedSessionsPerSec || 0) - (baseline.summary.refusedSessionsPerSec || 0),
    failoverAssumptionChanged: (baseline.failover?.sessionSync || null) !== (current.failover?.sessionSync || null),
  };
}

// 자원 하나가 죽으면 이 설계가 어떻게 되는지 미리 계산한다. 항상 무장애에서 시작하므로
// 지금 주입된 장애에 영향받지 않는다. 현재 상태가 아니라 설계의 성질이다.
//
// demand 의 출발지나 목적지인 장비는 끄면 당연히 끊긴다. 그건 이중화 문제가 아니므로
// endpoint 로 표시하고 단일 장애점 집계에서 뺀다.
export function sweepSingleFaults(topology, options = {}) {
  const base = { scale: options.scale ?? 1, ...(options.strictPaths ? { strictPaths: true } : {}) };
  // demand 는 endpoint 로 적히기도 하고 경로를 직접 나열하기도 한다. 후자는 각 경로의 양 끝이 출발지·목적지다.
  const endpoints = new Set(topology.demands.flatMap((demand) => [demand.source, demand.target,
    ...(demand.paths || []).flatMap(({ devices }) => [devices?.[0], devices?.at(-1)])]).filter(Boolean));
  const resources = [];
  const baseline = calculateScenario(topology, base);

  for (const [type, items, key] of [['device', topology.devices, 'disabledDevices'], ['link', topology.links, 'disabledLinks']]) {
    for (const item of items) {
      const result = calculateScenario(topology, { ...base, [key]: [item.id] });
      const partial = result.demands.some(({ deliveredRatio, admissionRatio }) => deliveredRatio != null && deliveredRatio < 1 || admissionRatio < 1);
      const verdict = result.summary.evaluationStatus === 'invalid' || result.summary.evaluationStatus === 'not-ready' ? 'unknown'
        : result.summary.unreachableCount > 0 ? 'severs'
        : result.summary.overloadedCount > 0 || partial ? 'overloads'
        : 'absorbs';
      const worstId = result.summary.bindingResourceId;
      const worst = worstId ? [...result.devices, ...result.links].find(({ id }) => id === worstId) : null;
      resources.push({
        id: item.id, type, verdict,
        // 한계를 모르는 축이 있으면 판정은 상한이다. 모름을 안전으로 바꾸지 않는다.
        bounded: result.summary.evaluationStatus === 'unknown' || result.demands.some(({ deliveredRatioBound }) => deliveredRatioBound !== 'exact'),
        endpoint: type === 'device' && (item.external === true || (!topology.services?.length && endpoints.has(item.id) && item.external !== false)),
        evaluationStatus: result.summary.evaluationStatus,
        unreachableCount: result.summary.unreachableCount,
        minDeliveredRatio: result.demands.reduce((min, { deliveredRatio }) => deliveredRatio == null ? min : Math.min(min, deliveredRatio), 1),
        worstResourceId: worstId,
        worstAxis: result.summary.bindingAxis,
        worstUtilization: worst?.axes?.[result.summary.bindingAxis]?.utilization ?? null,
      });
    }
  }

  const counted = resources.filter(({ endpoint }) => !endpoint);
  const severs = counted.filter(({ verdict }) => verdict === 'severs').length;
  const overloads = counted.filter(({ verdict }) => verdict === 'overloads').length;
  const absorbs = counted.filter(({ verdict }) => verdict === 'absorbs').length;
  const bounded = counted.filter(({ verdict, bounded: b }) => verdict === 'absorbs' && b).length;
  const grade = !counted.length || ['invalid', 'not-ready'].includes(baseline.summary.evaluationStatus) || counted.some(({ verdict }) => verdict === 'unknown') ? 'unknown'
    : severs > 0 ? 'single-point'
    : overloads > 0 ? 'partial'
    : bounded > 0 || baseline.summary.evaluationStatus === 'unknown' ? 'unknown'
    : 'redundant';
  return { resources, severs, overloads, absorbs, bounded, endpoints: resources.length - counted.length, grade,
    evaluationBoundary: topology.services?.length ? 'declared-services; explicitly external devices excluded' : 'legacy-demand-endpoints-excluded; service survival not asserted' };
}

export function createExport(topology, scenario, baseline) {
  const compact = (resource) => ({
    id: resource.id, kind: resource.kind ?? 'link', active: resource.active,
    primaryStatus: resource.primaryStatus, bindingAxis: resource.bindingAxis,
    ...(resource.bindingDirection ? { bindingDirection: resource.bindingDirection } : {}),
    ...(resource.behavior ? { behavior: resource.behavior } : {}),
    axes: resource.axes,
    ...(resource.directions ? { directions: resource.directions } : {}),
  });
  return {
    schemaVersion: 3, engineVersion: ENGINE_VERSION, product: 'Rack Mesh',
    exportedAt: new Date().toISOString(), synthetic: Boolean(topology.synthetic),
    topology: { ...structuredClone(topology), deviceCount: topology.devices.length, linkCount: topology.links.length, demandCount: topology.demands.length },
    baseline: structuredClone(baseline),
    evidence: [...topology.devices, ...topology.links].map(({ id, source, spec, overrides, metadata }) => ({ id, source: structuredClone(source ?? null), spec: structuredClone(spec ?? null), overrides: structuredClone(overrides ?? null), metadata: structuredClone(metadata ?? null) })),
    assumptions: {
      warningThreshold: topology.warningThreshold ?? 0.8,
      linkCapacitySemantics: 'per-direction',
      deliveryModel: 'single-pass-offered-load',
      responseShareDefault: DEFAULT_RESPONSE_SHARE,
      haGroups: topology.haGroups ?? [],
    },
    scenario: { scale: scenario.scale, faults: scenario.faults, summary: scenario.summary, demands: scenario.demands, services: scenario.services, racks: scenario.racks, validationIssues: scenario.validationIssues, failover: scenario.failover },
    resources: [...scenario.devices, ...scenario.links].map(compact),
    comparison: compareScenarios(baseline, scenario),
  };
}
