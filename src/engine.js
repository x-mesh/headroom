const EPSILON = 1e-9;

function addLoad(target, source, factor) {
  for (const [axis, value] of Object.entries(source)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid load for ${axis}`);
    target[axis] = (target[axis] || 0) + value * factor;
  }
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

export function resolveDemandPaths(topology, disabledDevices = new Set(), disabledLinks = new Set()) {
  const resolved = new Map();
  for (const demand of topology.demands) {
    const candidatePaths = demand.paths?.length
      ? demand.paths
      : findShortestPaths(topology, demand.source, demand.target, { disabledDevices, disabledLinks });
    const activePaths = candidatePaths.filter((path) =>
      path.devices.every((id) => !disabledDevices.has(id)) && path.links.every((id) => !disabledLinks.has(id)),
    );
    resolved.set(demand.id, { candidatePaths, activePaths });
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
  const deviceLoads = Object.fromEntries(topology.devices.map(({ id }) => [id, {}]));
  const linkLoads = Object.fromEntries(topology.links.map(({ id }) => [id, {}]));
  const demandResults = [];
  const resolvedPaths = resolveDemandPaths(topology, disabledDevices, disabledLinks);

  for (const demand of topology.demands) {
    const { activePaths } = resolvedPaths.get(demand.id);
    if (!activePaths.length) {
      demandResults.push({ id: demand.id, name: demand.name, status: 'unreachable', deliveredRatio: 0, paths: [], load: scaledLoad(demand.load, scale) });
      continue;
    }
    const share = 1 / activePaths.length;
    for (const path of activePaths) {
      for (const deviceId of new Set(path.devices)) addLoad(deviceLoads[deviceId], demand.load, scale * share);
      for (const linkId of new Set(path.links)) addLoad(linkLoads[linkId], demand.load, scale * share);
    }
    demandResults.push({
      id: demand.id, name: demand.name, status: 'delivered', deliveredRatio: 1, load: scaledLoad(demand.load, scale),
      paths: activePaths.map(({ id }) => ({ id, share })),
    });
  }

  const devices = topology.devices.map((device) => {
    const axes = Object.fromEntries(Object.entries(device.limits).map(([axis, limit]) => [axis, axisResult(deviceLoads[device.id][axis] || 0, limit, warningThreshold)]));
    return { ...device, active: !disabledDevices.has(device.id), load: deviceLoads[device.id], axes, ...summarizeAxes(axes) };
  });
  const links = topology.links.map((link) => {
    const axes = Object.fromEntries(Object.entries(link.capacity).map(([axis, limit]) => [axis, axisResult(linkLoads[link.id][axis] || 0, limit, warningThreshold)]));
    return { ...link, active: !disabledLinks.has(link.id), load: linkLoads[link.id], axes, ...summarizeAxes(axes) };
  });
  const activeResources = [...devices.filter(({ active }) => active), ...links.filter(({ active }) => active)];
  const binding = activeResources
    .filter(({ minHeadroom }) => minHeadroom != null)
    .sort((a, b) => a.minHeadroom - b.minHeadroom)[0] || null;
  const unreachable = demandResults.filter(({ status }) => status === 'unreachable');

  return {
    schemaVersion: 1, scale, devices, links, demands: demandResults,
    summary: {
      bindingResourceId: binding?.id || null, bindingAxis: binding?.bindingAxis || null,
      minHeadroom: binding?.minHeadroom ?? null, unreachableCount: unreachable.length,
      unreachableLoadBps: unreachable.reduce((sum, item) => sum + (item.load.forwarding_bps || 0), 0),
      overloadedCount: activeResources.filter(({ primaryStatus }) => primaryStatus === 'overloaded').length,
      warningCount: activeResources.filter(({ primaryStatus }) => primaryStatus === 'warning').length,
      activeFaults: disabledDevices.size + disabledLinks.size,
    },
  };
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
  };
}

export function createExport(topology, scenario, baseline) {
  return {
    schemaVersion: 1, product: 'Rack Mesh', exportedAt: new Date().toISOString(), synthetic: Boolean(topology.synthetic),
    topology: { name: topology.name, deviceCount: topology.devices.length, linkCount: topology.links.length, demandCount: topology.demands.length },
    scenario: { scale: scenario.scale, summary: scenario.summary, demands: scenario.demands },
    comparison: compareScenarios(baseline, scenario),
  };
}
