import { axisCatalog, behaviorCatalog, DEFAULT_RESPONSE_SHARE } from './data.js';

export const SESSION_SYNC_DEFAULT = 'stateful';
export const ENGINE_VERSION = '2.0.0';

const EPSILON = 1e-9;

// 초과분이 곧 드롭인 축과, 신규 연결만 거절되는 축을 나눈다. 세션 테이블이 넘쳤다고
// 살아 있는 플로우의 대역이 줄지는 않는다.
export const deliveryRoleOf = (axis) => axisCatalog[axis]?.deliveryRole ?? null;
// 링크는 세션 테이블을 들지 않는다. admission 축을 쌓아 두면 판정도 못 하면서 목록만 더럽힌다.
const linkCarriesAxis = (axis) => deliveryRoleOf(axis) !== 'admission';

function addLoad(target, source, factor, accept, carried = 1) {
  for (const [axis, value] of Object.entries(source)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid load for ${axis}`);
    if (accept && !accept(axis)) continue;
    const share = deliveryRoleOf(axis) === 'throughput' ? carried : 1;
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
  const deviceIds = new Set(topology.devices.map(({ id }) => id));
  const linkIds = new Set(topology.links.map(({ id }) => id));
  if (deviceIds.size !== topology.devices.length || linkIds.size !== topology.links.length) throw new Error('Topology IDs must be unique');
  for (const link of topology.links) {
    if (!deviceIds.has(link.source) || !deviceIds.has(link.target)) throw new Error(`Link ${link.id} has a missing endpoint`);
  }
  for (const group of topology.haGroups || []) {
    if (!Array.isArray(group.members) || !group.members.length) throw new Error(`HA group ${group.id} requires members`);
    for (const member of group.members) if (!deviceIds.has(member)) throw new Error(`HA group ${group.id} has a missing member`);
  }
  for (const demand of topology.demands) {
    if (!demand.paths?.length && !(demand.source && demand.target)) throw new Error(`Demand ${demand.id} requires paths or endpoints`);
    if ((demand.source && !deviceIds.has(demand.source)) || (demand.target && !deviceIds.has(demand.target))) throw new Error(`Demand ${demand.id} has a missing endpoint`);
    for (const path of demand.paths || []) {
      if (path.devices.some((id) => !deviceIds.has(id))) throw new Error(`Path ${path.id} has a missing device`);
      if (path.links.some((id) => !linkIds.has(id))) throw new Error(`Path ${path.id} has a missing link`);
    }
  }
}

export function findShortestPaths(topology, source, target, options = {}) {
  const disabledDevices = new Set(options.disabledDevices || []);
  const disabledLinks = new Set(options.disabledLinks || []);
  if (disabledDevices.has(source) || disabledDevices.has(target)) return [];
  const adjacency = new Map(topology.devices.filter(({ id }) => !disabledDevices.has(id)).map(({ id }) => [id, []]));
  for (const link of topology.links) {
    if (disabledLinks.has(link.id) || disabledDevices.has(link.source) || disabledDevices.has(link.target)) continue;
    adjacency.get(link.source)?.push({ device: link.target, link: link.id });
    adjacency.get(link.target)?.push({ device: link.source, link: link.id });
  }
  for (const edges of adjacency.values()) edges.sort((a, b) => a.device.localeCompare(b.device) || a.link.localeCompare(b.link));
  if (!adjacency.has(source) || !adjacency.has(target)) return [];
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
  if (!distance.has(target)) return [];
  const paths = [];
  const visit = (node, devices, links) => {
    if (paths.length >= 16) return;
    if (node === source) {
      const orderedDevices = [source, ...devices.slice().reverse()];
      const orderedLinks = links.slice().reverse();
      paths.push({ id: `${source}-${target}-${paths.length + 1}`, devices: orderedDevices, links: orderedLinks });
      return;
    }
    for (const parent of (parents.get(node) || []).slice().sort((a, b) => a.node.localeCompare(b.node))) visit(parent.node, [...devices, node], [...links, parent.link]);
  };
  visit(target, [], []);
  return paths;
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
    const from = devices[index];
    const to = devices[index + 1];
    const direction = link.source === from && link.target === to ? 'forward'
      : link.source === to && link.target === from ? 'reverse' : null;
    if (!direction) return { valid: false, reason: 'hop-endpoint-mismatch', hopIndex: index };
    hops.push({ linkId: link.id, direction });
  }
  return { valid: true, hops };
}

export function resolveDemandPaths(topology, disabledDevices = new Set(), disabledLinks = new Set(), options = {}) {
  const linkIndex = new Map(topology.links.map((link) => [link.id, link]));
  const resolved = new Map();
  for (const demand of topology.demands) {
    const candidatePaths = demand.paths?.length
      ? demand.paths
      : findShortestPaths(topology, demand.source, demand.target, { disabledDevices, disabledLinks });
    const activePaths = [];
    const invalidPaths = [];
    for (const path of candidatePaths) {
      if (path.devices.some((id) => disabledDevices.has(id)) || path.links.some((id) => disabledLinks.has(id))) continue;
      const walk = resolveHops(path, linkIndex);
      if (!walk.valid) {
        if (options.strictPaths) throw new Error(`Path ${path.id} is not contiguous: ${walk.reason}`);
        invalidPaths.push({ id: path.id, reason: walk.reason, ...(walk.hopIndex == null ? {} : { hopIndex: walk.hopIndex }) });
        continue;
      }
      activePaths.push({ ...path, hops: walk.hops });
    }
    resolved.set(demand.id, { candidatePaths, activePaths, invalidPaths });
  }
  return resolved;
}

function axisResult(load, limit, warningThreshold) {
  if (limit == null) return { load, limit: null, utilization: null, headroom: null, status: 'unknown' };
  if (!Number.isFinite(limit) || limit <= 0) return { load, limit, utilization: null, headroom: null, status: 'invalid' };
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
  validateTopology(topology);
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale < 0) throw new Error('Scale must be a non-negative finite number');
  const disabledDevices = new Set(options.disabledDevices || []);
  const disabledLinks = new Set(options.disabledLinks || []);
  const warningThreshold = topology.warningThreshold ?? 0.8;
  const deviceIndex = new Map(topology.devices.map((device) => [device.id, device]));
  const deviceLoads = Object.fromEntries(topology.devices.map(({ id }) => [id, {}]));
  const linkLoads = Object.fromEntries(topology.links.map(({ id }) => [id, { forward: {}, reverse: {} }]));
  const demandResults = [];
  const resolvedPaths = resolveDemandPaths(topology, disabledDevices, disabledLinks, options);
  // 장애가 있을 때만 푼다. 끊긴 demand 가 무장애였다면 어디를 지났는지는 결과에 남지 않으므로
  // 캔버스가 무엇이 끊겼는지 그릴 수 없다. 폭증 계산도 같은 경로를 쓴다.
  const noFaultPaths = disabledDevices.size || disabledLinks.size
    ? resolveDemandPaths(topology, new Set(), new Set(), options)
    : null;

  for (const demand of topology.demands) {
    const { activePaths, invalidPaths } = resolvedPaths.get(demand.id);
    const validity = invalidPaths.length ? 'invalid' : 'valid';
    if (!activePaths.length) {
      demandResults.push({ id: demand.id, name: demand.name, status: 'unreachable', validity, invalidPaths, deliveredRatio: 0, paths: [],
        severedPaths: (noFaultPaths?.get(demand.id)?.activePaths || []).map(({ id, devices, links }) => ({ id, devices, links })),
        load: scaledLoad(demand.load, scale) });
      continue;
    }
    const share = 1 / activePaths.length;
    for (const path of activePaths) {
      for (const deviceId of new Set(path.devices)) {
        addLoad(deviceLoads[deviceId], demand.load, scale * share, null, carriedFraction(deviceIndex.get(deviceId), demand));
      }
      for (const hop of path.hops) addLoad(linkLoads[hop.linkId][hop.direction], demand.load, scale * share, linkCarriesAxis);
    }
    demandResults.push({
      id: demand.id, name: demand.name, status: 'delivered', validity, invalidPaths, load: scaledLoad(demand.load, scale),
      paths: activePaths.map(({ id }) => ({ id, share })),
    });
  }

  const failover = failoverSurge(topology, options, disabledDevices, disabledLinks, scale, resolvedPaths, noFaultPaths);
  for (const [deviceId, cps] of Object.entries(failover.surge)) {
    deviceLoads[deviceId].new_sessions_per_sec = (deviceLoads[deviceId].new_sessions_per_sec || 0) + cps;
  }

  const devices = topology.devices.map((device) => {
    const axes = Object.fromEntries(Object.entries(device.limits).map(([axis, limit]) => [axis, axisResult(deviceLoads[device.id][axis] || 0, limit, warningThreshold)]));
    const surge = failover.surge[device.id];
    if (surge && axes.new_sessions_per_sec) {
      axes.new_sessions_per_sec.contributions = { steady: axes.new_sessions_per_sec.load - surge, failoverSurge: surge };
    }
    // 폭증량을 모르면 0 으로 치지 않는다. 모르는 것을 안전으로 바꾸면 안 된다.
    if (failover.unknownSurge.has(device.id) && axes.new_sessions_per_sec) {
      axes.new_sessions_per_sec = { ...axes.new_sessions_per_sec, utilization: null, headroom: null, status: 'unknown', unknownReason: 'failover-surge-window-missing' };
    }
    return { ...device, active: !disabledDevices.has(device.id), load: deviceLoads[device.id], axes, ...summarizeAxes(axes) };
  });
  const links = topology.links.map((link) => {
    const directions = Object.fromEntries(LINK_DIRECTIONS.map((direction) => {
      const capacity = { ...link.capacity, ...(link.capacityByDirection?.[direction] || {}) };
      const load = linkLoads[link.id][direction];
      const axes = Object.fromEntries(Object.entries(capacity).map(([axis, limit]) => [axis, axisResult(load[axis] || 0, limit, warningThreshold)]));
      return [direction, { load, axes }];
    }));
    // 평면 axes 는 사용률이 큰 방향을 고른다. 동률이면 forward. UI 는 이 형태를 그대로 읽는다.
    const axes = {};
    const load = {};
    for (const axis of Object.keys(link.capacity)) {
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

  for (const result of demandResults) {
    if (result.status === 'unreachable') { result.deliveredRatio = 0; result.deliveredRatioBound = 'exact'; result.droppedLoad = result.load; continue; }
    const { activePaths } = resolvedPaths.get(result.id);
    const share = 1 / activePaths.length;
    const unknownConstraints = [];
    let delivered = 0;
    let admitted = 0;
    let admissionLimit = null;
    result.paths = activePaths.map((path) => {
      let pass = 1;
      let admit = 1;
      let choke = null;
      for (let index = 0; index < path.devices.length; index += 1) {
        const stops = [{ key: `device:${path.devices[index]}`, resourceId: path.devices[index], direction: null }];
        const hop = path.hops[index];
        if (hop) stops.push({ key: `link:${hop.linkId}:${hop.direction}`, resourceId: hop.linkId, direction: hop.direction });
        for (const stop of stops) {
          const entry = passTable.get(stop.key);
          for (const axis of entry.unknownAxes) unknownConstraints.push({ resourceId: stop.resourceId, direction: stop.direction, axis });
          if (entry.invalidAxes.length) result.validity = 'invalid';
          if (entry.throughputPass < pass) { pass = entry.throughputPass; choke = { ...stop, axis: null }; }
          if (entry.admissionPass < admit) { admit = entry.admissionPass; admissionLimit = stop; }
        }
      }
      delivered += share * pass;
      admitted += share * admit;
      return { id: path.id, share, deliveredRatio: pass, admissionRatio: admit, choke: choke && { resourceId: choke.resourceId, direction: choke.direction } };
    });
    result.deliveredRatio = delivered;
    // 모르는 한계는 스로틀에 관여시키지 않되 결과를 오염시킨다. 82% 가 아니라 82% 이하다.
    result.deliveredRatioBound = unknownConstraints.length ? 'upper' : 'exact';
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

  return {
    schemaVersion: 2, engineVersion: ENGINE_VERSION, scale, devices, links, demands: demandResults,
    faults: { devices: [...disabledDevices].sort(), links: [...disabledLinks].sort() },
    summary: {
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
    const group = groups.find(({ members }) => members.includes(failedId));
    const sessionSync = override || group?.sessionSync || SESSION_SYNC_DEFAULT;
    if (sessionSync !== 'none') continue;
    const windowSec = options.reestablishWindowSec ?? group?.reestablishWindowSec ?? null;
    for (const demand of topology.demands) {
      const before = baselinePaths.get(demand.id).activePaths;
      const after = currentPaths.get(demand.id).activePaths;
      if (!before.length || !after.length) continue;
      const lost = before.filter((path) => path.devices.includes(failedId)).length / before.length;
      const transferred = (demand.load.concurrent_sessions || 0) * scale * lost;
      if (!transferred) continue;
      if (!Number.isFinite(windowSec) || windowSec <= 0) {
        for (const path of after) for (const deviceId of new Set(path.devices)) unknownSurge.add(deviceId);
        report.transfers.push({ demandId: demand.id, failedId, transferred, surge: null, status: 'unknown', reason: 'reestablish-window-missing' });
        continue;
      }
      const share = 1 / after.length;
      for (const path of after) for (const deviceId of new Set(path.devices)) surge[deviceId] = (surge[deviceId] || 0) + (transferred / windowSec) * share;
      report.transfers.push({ demandId: demand.id, failedId, transferred, surge: transferred / windowSec, windowSec, status: 'known', derivation: 'transferred_sessions / reestablish_window_sec' });
    }
  }
  return { surge, unknownSurge, report };
}

function scaledLoad(load, scale) {
  return Object.fromEntries(Object.entries(load).map(([axis, value]) => [axis, value * scale]));
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

  for (const [type, items, key] of [['device', topology.devices, 'disabledDevices'], ['link', topology.links, 'disabledLinks']]) {
    for (const item of items) {
      const result = calculateScenario(topology, { ...base, [key]: [item.id] });
      const partial = result.demands.some(({ deliveredRatio }) => deliveredRatio != null && deliveredRatio < 1);
      const verdict = result.summary.unreachableCount > 0 ? 'severs'
        : result.summary.overloadedCount > 0 || partial ? 'overloads'
        : 'absorbs';
      const worstId = result.summary.bindingResourceId;
      const worst = worstId ? [...result.devices, ...result.links].find(({ id }) => id === worstId) : null;
      resources.push({
        id: item.id, type, verdict,
        // 한계를 모르는 축이 있으면 판정은 상한이다. 모름을 안전으로 바꾸지 않는다.
        bounded: result.demands.some(({ deliveredRatioBound }) => deliveredRatioBound === 'upper'),
        endpoint: type === 'device' && endpoints.has(item.id),
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
  const grade = !counted.length ? 'unknown'
    : severs > 0 ? 'single-point'
    : overloads > 0 ? 'partial'
    : bounded > 0 ? 'unknown'
    : 'redundant';
  return { resources, severs, overloads, absorbs, bounded, endpoints: resources.length - counted.length, grade };
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
    schemaVersion: 2, engineVersion: ENGINE_VERSION, product: 'Rack Mesh',
    exportedAt: new Date().toISOString(), synthetic: Boolean(topology.synthetic),
    topology: { name: topology.name, deviceCount: topology.devices.length, linkCount: topology.links.length, demandCount: topology.demands.length },
    assumptions: {
      warningThreshold: topology.warningThreshold ?? 0.8,
      linkCapacitySemantics: 'per-direction',
      deliveryModel: 'single-pass-offered-load',
      responseShareDefault: DEFAULT_RESPONSE_SHARE,
      haGroups: topology.haGroups ?? [],
    },
    scenario: { scale: scenario.scale, faults: scenario.faults, summary: scenario.summary, demands: scenario.demands, failover: scenario.failover },
    resources: [...scenario.devices, ...scenario.links].map(compact),
    comparison: compareScenarios(baseline, scenario),
  };
}
