// 아키텍처 템플릿. 각 템플릿은 서로 다른 축이 먼저 차는 구성을 보여준다.
// PRD 5.3 은 프리셋 자체를 이 도구의 교육 콘텐츠로 규정한다.
import { cloneTopology } from './data.js';
import { acceptEvidence, addDemand, addDevice, addLink, applySpec, createEmptyTopology, setWorkloadConditions } from './editor.js';
import { buildSpec, catalogEntry, catalogProfile } from './devices/catalog.js';
import { localizedTemplate } from './i18n.js';

// 8-튜플은 짧아서 설계 하나가 한눈에 읽힌다. 그 성질을 버리지 않는다. 튜플에 담기지 않는 것
// (랙 metadata, 외부망 표시, 데이터시트 근거, 포트)을 적어야 하는 장비만 객체로 쓰고, 한 함수가
// 둘 다 받으므로 한 설계 안에서 어휘가 갈리지 않는다.
function deviceInput(entry) {
  if (!Array.isArray(entry)) return entry;
  const [id, name, kind, zone, x, y, limits, behavior] = entry;
  return { id, name, kind, zone, position: { x, y }, limits, ...(behavior ? { behavior } : {}) };
}

function place(topology, entries) {
  for (const entry of entries) {
    const { spec, accept, ...input } = deviceInput(entry);
    addDevice(topology, input);
    if (spec) equip(topology, input.id, spec, accept);
  }
}

/**
 * 데이터시트 값은 카탈로그에서만 온다(PRD 8절: 엔진 코드에 벤더 데이터를 두지 않는다).
 * 템플릿에 숫자를 다시 적으면 두 곳이 갈라지고, records 의 digest 가 맞지 않아 프로젝트
 * 저장이 막힌다(public/project.js validateProject).
 */
function equip(topology, id, [catalogId, profileId], accept = []) {
  const entry = catalogEntry(catalogId);
  const profile = catalogProfile(catalogId, profileId);
  // catalogProfile 은 모르는 id 에 profiles[0] 을 돌려준다. 오타가 조용히 다른 값으로 바뀌는 것을 막는다.
  if (!entry || profile?.id !== profileId) throw new Error(`Unknown catalog profile ${catalogId}/${profileId}`);
  applySpec(topology, id, { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model });
  // 데이터시트가 조건을 밝히지 않은 축은 어떤 워크로드를 적어도 applicable 이 되지 않는다.
  // 그 축의 숫자를 이 설계에서 쓰겠다면, 사용자가 누를 그 버튼을 미리 눌러 둔 것으로 남긴다.
  for (const axis of accept) acceptEvidence(topology, id, axis);
}

function connect(topology, entries) {
  for (const entry of entries) {
    if (!Array.isArray(entry)) { addLink(topology, entry); continue; }
    const [source, target, capacityBps] = entry;
    addLink(topology, { source, target, capacityBps });
  }
}

/**
 * 랙·서비스·장애 도메인·HA 쌍은 장비와 수요를 id 로 가리킨다. 가리키는 것이 없으면 엔진이
 * 설계 전체를 invalid 로 판정하므로, 반드시 place/connect/수요 다음에 부르고 여기서 확인한다.
 * 엔진에는 전부 선택 사항이라 비어 있는 것은 아예 만들지 않는다.
 */
function declare(topology, collections) {
  const devices = new Set(topology.devices.map(({ id }) => id));
  const links = new Set(topology.links.map(({ id }) => id));
  const demands = new Set(topology.demands.map(({ id }) => id));
  const check = (ids, known, label) => {
    for (const id of ids || []) if (!known.has(id)) throw new Error(`${label} ${id} does not exist`);
  };
  for (const [key, items] of Object.entries(collections)) {
    if (!items?.length) continue;
    for (const item of items) {
      check(item.members ?? item.deviceIds, devices, 'Device');
      check(item.linkIds, links, 'Link');
      check(item.demandIds, demands, 'Demand');
      for (const group of item.endpointGroups || []) check(group.members, devices, 'Device');
    }
    topology[key] = structuredClone(items);
  }
  return topology;
}

// 같은 것을 여러 벌 놓을 때. id 는 사라지지 않고 부르는 자리에 그대로 적힌다 —
// 생성기가 id 를 만들어 버리면 experiment.action.id 가 무엇을 가리키는지 읽을 수 없다.
const repeat = (count, make) => Array.from({ length: count }, (unused, index) => make(index + 1, index));
// 두 층을 전부 잇는다. connect(topology, mesh(spines, leaves, 100e9)) 로 쓴다.
const mesh = (sources, targets, capacityBps) => sources.flatMap((source) => targets.map((target) => [source, target, capacityBps]));

function balancedFarm(mode) {
  const topology = createEmptyTopology(mode === 'dsr' ? 'DSR 로드밸런싱' : '인라인 로드밸런싱');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['edge', 'EDGE', 'router', 'EDGE', 300, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['lb', 'LB', 'lb', 'SERVICE', 500, 290,
      { forwarding_bps: 8.5e9, new_sessions_per_sec: 60e3, concurrent_sessions: 1.2e6, tls_full_handshakes_per_sec: 5e3, tls_resumed_handshakes_per_sec: 40e3 },
      { mode, sessionSync: 'unknown' }],
    ['web-a', 'WEB 01', 'web', 'RACK 01', 740, 180, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 40e3 }],
    ['web-b', 'WEB 02', 'web', 'RACK 02', 740, 400, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 40e3 }],
  ]);
  connect(topology, [['internet', 'edge', 40e9], ['edge', 'lb', 20e9], ['lb', 'web-a', 25e9], ['lb', 'web-b', 25e9]]);
  // DSR 은 서버가 클라이언트에게 직접 답한다. 그 길이 실제로 있어야 응답 바이트를 어디에 실을지 적을 수 있다.
  const direct = mode === 'dsr';
  const backends = ['web-a', 'web-b'];
  if (direct) connect(topology, backends.map((backend) => [backend, 'edge', 25e9]));
  for (const [id, target] of [['web-a-traffic', 'web-a'], ['web-b-traffic', 'web-b']]) {
    addDemand(topology, { id, name: `${target.toUpperCase()} 트래픽`, source: 'internet', target,
      load: { forwarding_bps: 4e9, new_sessions_per_sec: 20e3, concurrent_sessions: 400e3, tls_full_handshakes_per_sec: 2e3, tls_resumed_handshakes_per_sec: 18e3, nic_bps: 4e9 },
      // 반환 링크가 더 짧아 최단 경로가 LB 를 건너뛴다. DSR 은 정책 라우팅이므로 요청 경로를 못 박는다.
      // 두 백엔드를 다 적는 것은 자동 풀 추론이 하던 일 그대로다 — 응답이 LB 를 건너뛴다고 분배가 달라지지는 않는다.
      ...(direct ? {
        pathMode: 'explicit',
        paths: backends.map((backend) => ({ id: `${id}-request-${backend}`, devices: ['internet', 'edge', 'lb', backend], links: ['internet-edge', 'edge-lb', `lb-${backend}`] })),
        returnPath: backends.map((backend) => ({ id: `${id}-return-${backend}`, devices: [backend, 'edge', 'internet'], links: [`${backend}-edge`, 'internet-edge'] })),
      } : {}),
      directionality: { responseShare: 0.9, origin: 'estimate' } });
  }
  return topology;
}

function securityChain() {
  const topology = createEmptyTopology('인라인 보안 체인');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 105, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['edge', 'EDGE', 'router', 'EDGE', 265, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['fw', 'FW', 'firewall', 'SECURITY', 425, 290,
      { forwarding_bps: 20e9, forwarding_pps: 3e6, new_sessions_per_sec: 50e3, concurrent_sessions: 1.5e6 },
      { mode: 'routed', sessionSync: 'none' }],
    ['waf', 'WAF', 'waf', 'SECURITY', 585, 290,
      { forwarding_bps: 12e9, new_sessions_per_sec: 45e3, concurrent_sessions: 900e3, tls_full_handshakes_per_sec: 3.5e3 }],
    ['web-a', 'WEB 01', 'web', 'RACK 01', 780, 180, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 40e3 }],
    ['web-b', 'WEB 02', 'web', 'RACK 02', 780, 400, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 40e3 }],
  ]);
  connect(topology, [['internet', 'edge', 40e9], ['edge', 'fw', 20e9], ['fw', 'waf', 20e9], ['waf', 'web-a', 25e9], ['waf', 'web-b', 25e9]]);
  for (const [id, target] of [['shop-a', 'web-a'], ['shop-b', 'web-b']]) {
    addDemand(topology, { id, name: `${target.toUpperCase()} 쇼핑 트래픽`, source: 'internet', target,
      load: { forwarding_bps: 3.5e9, forwarding_pps: 700e3, new_sessions_per_sec: 18e3, concurrent_sessions: 350e3, tls_full_handshakes_per_sec: 1.6e3, nic_bps: 3.5e9 } });
  }
  return topology;
}

function threeTier() {
  const topology = createEmptyTopology('3-tier 웹 서비스');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['lb', 'LB', 'lb', 'WEB TIER', 300, 290,
      { forwarding_bps: 20e9, new_sessions_per_sec: 80e3, concurrent_sessions: 1.6e6, tls_full_handshakes_per_sec: 6e3, tls_resumed_handshakes_per_sec: 60e3 },
      { mode: 'inline', sessionSync: 'unknown' }],
    ['web-a', 'WEB 01', 'web', 'WEB TIER', 500, 170, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 45e3 }],
    ['web-b', 'WEB 02', 'web', 'WEB TIER', 500, 410, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 45e3 }],
    ['app', 'APP', 'vm', 'APP TIER', 700, 290, { nic_bps: 12e9, nic_pps: 2e6 }],
    ['db', 'DB', 'db', 'DATA TIER', 870, 290, { nic_bps: 8e9, nic_pps: null }],
  ]);
  connect(topology, [['internet', 'lb', 40e9], ['lb', 'web-a', 25e9], ['lb', 'web-b', 25e9],
    ['web-a', 'app', 25e9], ['web-b', 'app', 25e9], ['app', 'db', 12e9]]);
  addDemand(topology, { id: 'browse', name: '조회 트래픽', source: 'internet', target: 'db',
    load: { forwarding_bps: 6e9, new_sessions_per_sec: 30e3, concurrent_sessions: 600e3, tls_full_handshakes_per_sec: 2.5e3, tls_resumed_handshakes_per_sec: 27e3, nic_bps: 6e9, nic_pps: 1.2e6 } });
  return topology;
}

function spineLeaf() {
  const topology = createEmptyTopology('스파인-리프 팹릭');
  place(topology, [
    ['spine-a', 'SPINE A', 'switch', 'FABRIC', 330, 150, { forwarding_bps: 40e9, forwarding_pps: 6e6 }],
    ['spine-b', 'SPINE B', 'switch', 'FABRIC', 620, 150, { forwarding_bps: 40e9, forwarding_pps: 6e6 }],
    ['leaf-a', 'LEAF A', 'switch', 'RACK 01', 190, 380, { forwarding_bps: 25e9, forwarding_pps: 4e6 }],
    ['leaf-b', 'LEAF B', 'switch', 'RACK 02', 475, 380, { forwarding_bps: 25e9, forwarding_pps: 4e6 }],
    ['leaf-c', 'LEAF C', 'switch', 'RACK 03', 760, 380, { forwarding_bps: 25e9, forwarding_pps: 4e6 }],
    ['node-a', 'NODE 01', 'server', 'RACK 01', 190, 560, { nic_bps: 25e9, nic_pps: null }],
    ['node-b', 'NODE 02', 'server', 'RACK 02', 475, 560, { nic_bps: 25e9, nic_pps: null }],
    ['node-c', 'NODE 03', 'server', 'RACK 03', 760, 560, { nic_bps: 25e9, nic_pps: null }],
  ]);
  connect(topology, [
    ['spine-a', 'leaf-a', 40e9], ['spine-a', 'leaf-b', 40e9], ['spine-a', 'leaf-c', 40e9],
    ['spine-b', 'leaf-a', 40e9], ['spine-b', 'leaf-b', 40e9], ['spine-b', 'leaf-c', 40e9],
    ['leaf-a', 'node-a', 25e9], ['leaf-b', 'node-b', 25e9], ['leaf-c', 'node-c', 25e9],
  ]);
  for (const [id, source, target] of [['east-a', 'node-a', 'node-b'], ['east-b', 'node-a', 'node-c'], ['east-c', 'node-b', 'node-c']]) {
    addDemand(topology, { id, name: `${source.toUpperCase()} → ${target.toUpperCase()}`, source, target,
      load: { forwarding_bps: 7e9, forwarding_pps: 1.2e6, nic_bps: 7e9 } });
  }
  return topology;
}

function dmzTiers() {
  const topology = createEmptyTopology('DMZ 이중 방화벽');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['fw-out', 'FW OUT', 'firewall', 'DMZ', 290, 290, { forwarding_bps: 20e9, forwarding_pps: 3e6, new_sessions_per_sec: 60e3, concurrent_sessions: 1.2e6 }],
    ['waf', 'WAF', 'waf', 'DMZ', 470, 290, { forwarding_bps: 15e9, new_sessions_per_sec: 50e3, concurrent_sessions: 1e6, tls_full_handshakes_per_sec: 5e3 }],
    ['fw-in', 'FW IN', 'firewall', 'INTERNAL', 650, 290, { forwarding_bps: 15e9, forwarding_pps: 2.5e6, new_sessions_per_sec: 30e3, concurrent_sessions: 700e3 }],
    ['app', 'APP', 'vm', 'INTERNAL', 840, 290, { nic_bps: 20e9, nic_pps: 3e6 }],
  ]);
  connect(topology, [['internet', 'fw-out', 40e9], ['fw-out', 'waf', 20e9], ['waf', 'fw-in', 15e9], ['fw-in', 'app', 20e9]]);
  addDemand(topology, { id: 'public', name: '공개 서비스', source: 'internet', target: 'app',
    load: { forwarding_bps: 6e9, forwarding_pps: 1.2e6, new_sessions_per_sec: 26e3, concurrent_sessions: 520e3, tls_full_handshakes_per_sec: 2.4e3, nic_bps: 6e9, nic_pps: 1.2e6 } });
  return topology;
}

function hybridCloud() {
  const topology = createEmptyTopology('하이브리드 클라우드 연결');
  place(topology, [
    ['core', 'CORE SW', 'switch', 'ON-PREM', 150, 290, { forwarding_bps: 40e9, forwarding_pps: 6e6 }],
    ['app', 'APP', 'vm', 'ON-PREM', 150, 500, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['edge', 'WAN EDGE', 'router', 'ON-PREM', 380, 290, { forwarding_bps: 10e9, forwarding_pps: 1.5e6 }],
    ['cloud-gw', 'CLOUD GW', 'router', 'CLOUD', 640, 290, { forwarding_bps: 10e9, forwarding_pps: 1.5e6 }],
    ['cloud-svc', 'CLOUD SVC', 'cloud', 'CLOUD', 860, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
  ]);
  // WAN 구간만 좁다. 사이트 안은 넉넉해도 여기서 막힌다.
  connect(topology, [['app', 'core', 25e9], ['core', 'edge', 40e9], ['edge', 'cloud-gw', 2e9], ['cloud-gw', 'cloud-svc', 10e9]]);
  addDemand(topology, { id: 'sync', name: '클라우드 동기화', source: 'app', target: 'cloud-svc',
    load: { forwarding_bps: 1.7e9, forwarding_pps: 300e3, nic_bps: 1.7e9, nic_pps: 300e3 } });
  return topology;
}

function cdnOrigin() {
  const topology = createEmptyTopology('CDN 오리진');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 120, 290, { forwarding_bps: 100e9, forwarding_pps: 20e6 }],
    ['cache-a', 'CACHE 01', 'web', 'EDGE POP', 350, 170, { nic_bps: 40e9, nic_pps: null, new_sessions_per_sec: 120e3 }],
    ['cache-b', 'CACHE 02', 'web', 'EDGE POP', 350, 410, { nic_bps: 40e9, nic_pps: null, new_sessions_per_sec: 120e3 }],
    ['core', 'CORE SW', 'switch', 'ORIGIN', 590, 290, { forwarding_bps: 40e9, forwarding_pps: 6e6 }],
    ['origin', 'ORIGIN', 'web', 'ORIGIN', 830, 290, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 20e3 }],
  ]);
  connect(topology, [['internet', 'cache-a', 100e9], ['internet', 'cache-b', 100e9],
    ['cache-a', 'core', 40e9], ['cache-b', 'core', 40e9], ['core', 'origin', 25e9]]);
  for (const [id, source] of [['miss-a', 'cache-a'], ['miss-b', 'cache-b']]) {
    // 캐시 미스만 오리진까지 간다. 적은 양인데 오리진의 세션이 먼저 찬다.
    addDemand(topology, { id, name: `${source.toUpperCase()} 캐시 미스`, source, target: 'origin',
      load: { forwarding_bps: 3e9, new_sessions_per_sec: 9e3, nic_bps: 3e9 } });
  }
  return topology;
}

function microservices() {
  const topology = createEmptyTopology('East-West 마이크로서비스');
  place(topology, [
    ['leaf-a', 'LEAF A', 'switch', 'RACK 01', 240, 200, { forwarding_bps: 40e9, forwarding_pps: 3e6 }],
    ['leaf-b', 'LEAF B', 'switch', 'RACK 02', 700, 200, { forwarding_bps: 40e9, forwarding_pps: 3e6 }],
    ['svc-a', 'API', 'vm', 'RACK 01', 150, 430, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['svc-b', 'AUTH', 'vm', 'RACK 01', 350, 430, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['svc-c', 'ORDER', 'vm', 'RACK 02', 610, 430, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['svc-d', 'LEDGER', 'vm', 'RACK 02', 810, 430, { nic_bps: 25e9, nic_pps: 4e6 }],
  ]);
  connect(topology, [['leaf-a', 'leaf-b', 40e9], ['svc-a', 'leaf-a', 25e9], ['svc-b', 'leaf-a', 25e9],
    ['svc-c', 'leaf-b', 25e9], ['svc-d', 'leaf-b', 25e9]]);
  // 서비스 간 호출은 작은 패킷이 많다. 대역폭보다 패킷 처리량이 먼저 찬다.
  for (const [id, source, target] of [['call-1', 'svc-a', 'svc-b'], ['call-2', 'svc-a', 'svc-c'], ['call-3', 'svc-c', 'svc-d'], ['call-4', 'svc-b', 'svc-d']]) {
    addDemand(topology, { id, name: `${source.toUpperCase()} → ${target.toUpperCase()}`, source, target,
      load: { forwarding_bps: 2e9, forwarding_pps: 900e3, nic_bps: 2e9, nic_pps: 900e3 } });
  }
  return topology;
}

function backupNetwork() {
  const topology = createEmptyTopology('백업 네트워크');
  place(topology, [
    ['app-a', 'APP 01', 'server', 'RACK 01', 160, 180, { nic_bps: 25e9, nic_pps: null }],
    ['app-b', 'APP 02', 'server', 'RACK 01', 160, 400, { nic_bps: 25e9, nic_pps: null }],
    ['core', 'CORE SW', 'switch', 'FABRIC', 430, 290, { forwarding_bps: 40e9, forwarding_pps: 5e6 }],
    ['nas', 'NAS', 'nas', 'STORAGE', 680, 200, { nic_bps: 10e9, nic_pps: null }],
    ['vault', 'TAPE VAULT', 'backup', 'STORAGE', 680, 420, { nic_bps: 8e9, nic_pps: null }],
  ]);
  connect(topology, [['app-a', 'core', 25e9], ['app-b', 'core', 25e9], ['core', 'nas', 10e9], ['core', 'vault', 8e9]]);
  addDemand(topology, { id: 'nightly', name: '야간 백업', source: 'app-a', target: 'nas',
    load: { forwarding_bps: 8e9, nic_bps: 8e9 } });
  addDemand(topology, { id: 'archive', name: '아카이브 전송', source: 'app-b', target: 'vault',
    load: { forwarding_bps: 6e9, nic_bps: 6e9 } });
  return topology;
}

function vdiPool() {
  const topology = createEmptyTopology('VDI 데스크톱 풀');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 120, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['gw', 'VDI GW', 'lb', 'BROKER', 340, 290,
      { forwarding_bps: 20e9, new_sessions_per_sec: 6e3, concurrent_sessions: 12e3, tls_full_handshakes_per_sec: 3e3, tls_resumed_handshakes_per_sec: 8e3 },
      { mode: 'inline', sessionSync: 'unknown' }],
    ['host-a', 'HOST 01', 'vm', 'POOL', 600, 180, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['host-b', 'HOST 02', 'vm', 'POOL', 600, 400, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['profile', 'PROFILE NAS', 'nas', 'STORAGE', 840, 290, { nic_bps: 10e9, nic_pps: null }],
  ]);
  connect(topology, [['internet', 'gw', 40e9], ['gw', 'host-a', 25e9], ['gw', 'host-b', 25e9],
    ['host-a', 'profile', 10e9], ['host-b', 'profile', 10e9]]);
  // 데스크톱 세션은 오래 붙어 있다. 신규보다 동시 세션이 먼저 찬다.
  for (const [id, target] of [['desk-a', 'host-a'], ['desk-b', 'host-b']]) {
    addDemand(topology, { id, name: `${target.toUpperCase()} 데스크톱`, source: 'internet', target,
      load: { forwarding_bps: 3e9, new_sessions_per_sec: 1.2e3, concurrent_sessions: 5.5e3, tls_full_handshakes_per_sec: 900, tls_resumed_handshakes_per_sec: 300, nic_bps: 3e9, nic_pps: 500e3 } });
  }
  return topology;
}

function paymentGateway() {
  const topology = createEmptyTopology('결제 처리');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 120, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['waf', 'WAF', 'waf', 'DMZ', 340, 290, { forwarding_bps: 15e9, new_sessions_per_sec: 60e3, concurrent_sessions: 900e3, tls_full_handshakes_per_sec: 12e3 }],
    ['app-a', 'PAY 01', 'web', 'SECURE', 590, 180, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 40e3 }],
    ['app-b', 'PAY 02', 'web', 'SECURE', 590, 400, { nic_bps: 25e9, nic_pps: null, new_sessions_per_sec: 40e3 }],
    ['ledger', 'LEDGER', 'db', 'SECURE', 840, 290, { nic_bps: 12e9, nic_pps: null }],
  ]);
  connect(topology, [['internet', 'waf', 40e9], ['waf', 'app-a', 25e9], ['waf', 'app-b', 25e9],
    ['app-a', 'ledger', 12e9], ['app-b', 'ledger', 12e9]]);
  // 결제는 연결 재사용이 낮다. 대역폭은 한가한데 TLS 신규 핸드셰이크가 먼저 찬다.
  for (const [id, target] of [['card-a', 'app-a'], ['card-b', 'app-b']]) {
    addDemand(topology, { id, name: `${target.toUpperCase()} 카드 승인`, source: 'internet', target,
      load: { forwarding_bps: 1.2e9, new_sessions_per_sec: 11e3, concurrent_sessions: 120e3, tls_full_handshakes_per_sec: 5.4e3, nic_bps: 1.2e9 } });
  }
  return topology;
}

function streaming() {
  const topology = createEmptyTopology('스트리밍 배포');
  place(topology, [
    ['origin', 'ORIGIN', 'web', 'ORIGIN', 140, 290, { nic_bps: 40e9, nic_pps: null, new_sessions_per_sec: 5e3 }],
    ['core', 'CORE SW', 'switch', 'FABRIC', 380, 290, { forwarding_bps: 40e9, forwarding_pps: 5e6 }],
    ['edge-a', 'EDGE 01', 'router', 'POP', 640, 180, { forwarding_bps: 15e9, forwarding_pps: 2e6 }],
    ['edge-b', 'EDGE 02', 'router', 'POP', 640, 400, { forwarding_bps: 15e9, forwarding_pps: 2e6 }],
    ['viewers', 'VIEWERS', 'cloud', 'INTERNET', 870, 290, { forwarding_bps: 100e9, forwarding_pps: 20e6 }],
  ]);
  connect(topology, [['origin', 'core', 40e9], ['core', 'edge-a', 15e9], ['core', 'edge-b', 15e9],
    ['edge-a', 'viewers', 40e9], ['edge-b', 'viewers', 40e9]]);
  // 세션은 적고 바이트는 많다. 순수 대역폭 문제다.
  addDemand(topology, { id: 'live', name: '라이브 배포', source: 'origin', target: 'viewers',
    load: { forwarding_bps: 26e9, forwarding_pps: 2.4e6, new_sessions_per_sec: 800, concurrent_sessions: 90e3, nic_bps: 26e9 } });
  return topology;
}

function iotGateway() {
  const topology = createEmptyTopology('IoT 게이트웨이');
  place(topology, [
    ['field', 'FIELD', 'cloud', 'SITE', 120, 290, { forwarding_bps: 10e9, forwarding_pps: 20e6 }],
    ['gw-a', 'GW 01', 'router', 'SITE', 340, 180, { forwarding_bps: 10e9, forwarding_pps: 1.4e6 }],
    ['gw-b', 'GW 02', 'router', 'SITE', 340, 400, { forwarding_bps: 10e9, forwarding_pps: 1.4e6 }],
    ['core', 'CORE SW', 'switch', 'FABRIC', 590, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['ingest', 'INGEST', 'vm', 'PLATFORM', 840, 290, { nic_bps: 10e9, nic_pps: 6e6 }],
  ]);
  connect(topology, [['field', 'gw-a', 10e9], ['field', 'gw-b', 10e9], ['gw-a', 'core', 10e9], ['gw-b', 'core', 10e9], ['core', 'ingest', 10e9]]);
  // 센서 텔레메트리는 작은 패킷이 아주 많다. 대역폭은 남는데 패킷 처리량이 먼저 찬다.
  for (const [id, gw] of [['sensors-a', 'gw-a'], ['sensors-b', 'gw-b']]) {
    addDemand(topology, { id, name: `${gw.toUpperCase()} 센서 수집`, source: 'field', target: 'ingest',
      load: { forwarding_bps: 900e6, forwarding_pps: 1.3e6, nic_bps: 900e6, nic_pps: 1.3e6 } });
  }
  return topology;
}

function disasterRecovery() {
  const topology = createEmptyTopology('재해복구 이중 사이트');
  place(topology, [
    ['app-p', 'APP PRI', 'vm', 'SITE A', 160, 200, { nic_bps: 25e9, nic_pps: 4e6 }],
    ['sw-p', 'SW A', 'switch', 'SITE A', 380, 200, { forwarding_bps: 40e9, forwarding_pps: 5e6 }],
    ['db-p', 'DB PRI', 'db', 'SITE A', 160, 430, { nic_bps: 20e9, nic_pps: null }],
    ['sw-s', 'SW B', 'switch', 'SITE B', 660, 200, { forwarding_bps: 40e9, forwarding_pps: 5e6 }],
    ['db-s', 'DB SEC', 'db', 'SITE B', 880, 200, { nic_bps: 20e9, nic_pps: null }],
    ['app-s', 'APP SEC', 'vm', 'SITE B', 880, 430, { nic_bps: 25e9, nic_pps: 4e6 }],
  ]);
  // 사이트 간 회선만 좁다. 복제가 그 구간을 다 쓴다.
  connect(topology, [['app-p', 'sw-p', 25e9], ['db-p', 'sw-p', 20e9], ['sw-p', 'sw-s', 4e9],
    ['sw-s', 'db-s', 20e9], ['sw-s', 'app-s', 25e9]]);
  addDemand(topology, { id: 'replica', name: 'DB 복제', source: 'db-p', target: 'db-s',
    load: { forwarding_bps: 3.4e9, forwarding_pps: 500e3, nic_bps: 3.4e9 } });
  addDemand(topology, { id: 'app-sync', name: '앱 상태 동기화', source: 'app-p', target: 'app-s',
    load: { forwarding_bps: 400e6, forwarding_pps: 90e3, nic_bps: 400e6, nic_pps: 90e3 } });
  return topology;
}

function remoteAccess() {
  const topology = createEmptyTopology('원격 접속 VPN');
  place(topology, [
    ['remote', 'REMOTE', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 10e9, forwarding_pps: 2e6 }],
    ['fw', 'FW', 'firewall', 'EDGE', 300, 290, { forwarding_bps: 10e9, forwarding_pps: 2e6, new_sessions_per_sec: 40e3, concurrent_sessions: 800e3 }],
    ['sslvpn', 'SSL VPN', 'sslvpn', 'SECURITY', 490, 290,
      { forwarding_bps: 5e9, concurrent_sessions: 200e3, vpn_tunnels: 10e3, tls_full_handshakes_per_sec: 4e3 }],
    ['ips', 'IPS', 'ips', 'SECURITY', 680, 290, { forwarding_bps: 8e9, forwarding_pps: 1.6e6, concurrent_sessions: 500e3 }],
    ['sw', 'SW', 'switch', 'CORE', 870, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['app', 'APP 01', 'server', 'RACK 01', 1050, 180, { nic_bps: 10e9, nic_pps: 2e6 }],
    ['file', 'FILE', 'nas', 'RACK 01', 1050, 400, { nic_bps: 10e9, nic_pps: 2e6 }],
  ]);
  connect(topology, [['remote', 'fw', 10e9], ['fw', 'sslvpn', 10e9], ['sslvpn', 'ips', 10e9],
    ['ips', 'sw', 10e9], ['sw', 'app', 10e9], ['sw', 'file', 10e9]]);
  addDemand(topology, { id: 'workers', name: '원격 근무자', source: 'remote', target: 'app',
    load: { forwarding_bps: 1.4e9, forwarding_pps: 320e3, new_sessions_per_sec: 9e3, concurrent_sessions: 110e3, vpn_tunnels: 9.2e3, tls_full_handshakes_per_sec: 2.4e3, nic_bps: 1.4e9, nic_pps: 320e3 } });
  addDemand(topology, { id: 'files', name: '파일 접근', source: 'remote', target: 'file',
    load: { forwarding_bps: 900e6, forwarding_pps: 180e3, new_sessions_per_sec: 2e3, concurrent_sessions: 24e3, nic_bps: 900e6, nic_pps: 180e3 } });
  return topology;
}

function branchVpn() {
  const topology = createEmptyTopology('지사 IPsec 연결');
  place(topology, [
    ['branch', 'BRANCH', 'cloud', 'REMOTE SITE', 110, 290, { forwarding_bps: 4e9, forwarding_pps: 900e3 }],
    ['wan', 'WAN', 'modem', 'REMOTE SITE', 290, 290, { forwarding_bps: 4e9 }],
    ['vpn', 'IPSEC GW', 'vpn', 'EDGE', 470, 290, { forwarding_bps: 2e9, forwarding_pps: 700e3, vpn_tunnels: 2e3 }],
    ['fw', 'FW', 'firewall', 'EDGE', 660, 290, { forwarding_bps: 10e9, forwarding_pps: 2e6, new_sessions_per_sec: 30e3, concurrent_sessions: 600e3 }],
    ['sw', 'SW', 'switch', 'CORE', 850, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['erp', 'ERP', 'server', 'RACK 02', 1030, 290, { nic_bps: 10e9, nic_pps: 2e6 }],
  ]);
  connect(topology, [['branch', 'wan', 4e9], ['wan', 'vpn', 4e9], ['vpn', 'fw', 10e9], ['fw', 'sw', 10e9], ['sw', 'erp', 10e9]]);
  addDemand(topology, { id: 'branch-traffic', name: '지사 업무 트래픽', source: 'branch', target: 'erp',
    load: { forwarding_bps: 1.85e9, forwarding_pps: 420e3, new_sessions_per_sec: 6e3, concurrent_sessions: 140e3, vpn_tunnels: 1.2e3, nic_bps: 1.85e9, nic_pps: 420e3 } });
  return topology;
}

// 같은 부하를 같은 총용량으로 받되, 큰 장비 한 대와 작은 장비 두 대로 나눠 짓는다.
// 무장애 사용률은 둘 다 75%로 같다. 갈라지는 것은 한 대가 죽은 뒤다.
const STACK_LOAD = { forwarding_bps: 6e9, forwarding_pps: 900e3, new_sessions_per_sec: 20e3, concurrent_sessions: 400e3,
  tls_full_handshakes_per_sec: 1.5e3, tls_resumed_handshakes_per_sec: 12e3, nic_bps: 6e9, nic_pps: 900e3 };

function stackDemands(topology) {
  for (const target of ['web-a', 'web-b']) {
    addDemand(topology, { id: `${target}-traffic`, name: `${target.toUpperCase()} 트래픽`, source: 'internet', target, load: STACK_LOAD });
  }
  return topology;
}

function singleStack() {
  const topology = createEmptyTopology('단일 경로 웹 서비스');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['fw', 'FW', 'firewall', 'SECURITY', 340, 290, { forwarding_bps: 16e9, forwarding_pps: 2.4e6, new_sessions_per_sec: 60e3, concurrent_sessions: 1.2e6 }],
    ['lb', 'LB', 'lb', 'SERVICE', 570, 290,
      { forwarding_bps: 16e9, new_sessions_per_sec: 60e3, concurrent_sessions: 1.2e6, tls_full_handshakes_per_sec: 6e3, tls_resumed_handshakes_per_sec: 48e3 }],
    ['web-a', 'WEB 01', 'web', 'RACK 01', 800, 180, { nic_bps: 8e9, nic_pps: 1.6e6, new_sessions_per_sec: 30e3 }],
    ['web-b', 'WEB 02', 'web', 'RACK 02', 800, 400, { nic_bps: 8e9, nic_pps: 1.6e6, new_sessions_per_sec: 30e3 }],
  ]);
  connect(topology, [['internet', 'fw', 20e9], ['fw', 'lb', 20e9], ['lb', 'web-a', 10e9], ['lb', 'web-b', 10e9]]);
  return stackDemands(topology);
}

function dualStack() {
  const topology = createEmptyTopology('이중화 웹 서비스');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['fw-a', 'FW A', 'firewall', 'SECURITY', 340, 180, { forwarding_bps: 8e9, forwarding_pps: 1.2e6, new_sessions_per_sec: 30e3, concurrent_sessions: 600e3 }],
    ['fw-b', 'FW B', 'firewall', 'SECURITY', 340, 400, { forwarding_bps: 8e9, forwarding_pps: 1.2e6, new_sessions_per_sec: 30e3, concurrent_sessions: 600e3 }],
    ['lb-a', 'LB A', 'lb', 'SERVICE', 570, 180,
      { forwarding_bps: 8e9, new_sessions_per_sec: 30e3, concurrent_sessions: 600e3, tls_full_handshakes_per_sec: 3e3, tls_resumed_handshakes_per_sec: 24e3 }],
    ['lb-b', 'LB B', 'lb', 'SERVICE', 570, 400,
      { forwarding_bps: 8e9, new_sessions_per_sec: 30e3, concurrent_sessions: 600e3, tls_full_handshakes_per_sec: 3e3, tls_resumed_handshakes_per_sec: 24e3 }],
    ['web-a', 'WEB 01', 'web', 'RACK 01', 800, 180, { nic_bps: 8e9, nic_pps: 1.6e6, new_sessions_per_sec: 30e3 }],
    ['web-b', 'WEB 02', 'web', 'RACK 02', 800, 400, { nic_bps: 8e9, nic_pps: 1.6e6, new_sessions_per_sec: 30e3 }],
  ]);
  connect(topology, [
    ['internet', 'fw-a', 10e9], ['internet', 'fw-b', 10e9],
    ['fw-a', 'lb-a', 10e9], ['fw-a', 'lb-b', 10e9], ['fw-b', 'lb-a', 10e9], ['fw-b', 'lb-b', 10e9],
    ['lb-a', 'web-a', 10e9], ['lb-a', 'web-b', 10e9], ['lb-b', 'web-a', 10e9], ['lb-b', 'web-b', 10e9],
  ]);
  return declare(stackDemands(topology), {
    haGroups: [
      { id: 'fw-pair', name: 'Perimeter firewalls', members: ['fw-a', 'fw-b'], sessionSync: 'none', reestablishWindowSec: 30 },
      { id: 'lb-pair', name: 'Load balancers', members: ['lb-a', 'lb-b'], sessionSync: 'stateful', reestablishWindowSec: 30 },
    ],
  });
}

function dualWanSharedEntry() {
  const topology = createEmptyTopology('이중 WAN 공용 인입 경로');
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 80, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['isp-a', 'ISP A', 'cloud', 'WAN', 245, 180, { forwarding_bps: 12e9, forwarding_pps: 2e6 }],
    ['isp-b', 'ISP B', 'cloud', 'WAN', 245, 400, { forwarding_bps: 12e9, forwarding_pps: 2e6 }],
    ['edge-a', 'EDGE A', 'router', 'EDGE', 425, 180, { forwarding_bps: 12e9, forwarding_pps: 2e6 }],
    ['edge-b', 'EDGE B', 'router', 'EDGE', 425, 400, { forwarding_bps: 12e9, forwarding_pps: 2e6 }],
    ['fw-a', 'FW A', 'firewall', 'SECURITY', 610, 180, { forwarding_bps: 12e9, forwarding_pps: 2e6, new_sessions_per_sec: 20e3, concurrent_sessions: 200e3 }],
    ['fw-b', 'FW B', 'firewall', 'SECURITY', 610, 400, { forwarding_bps: 12e9, forwarding_pps: 2e6, new_sessions_per_sec: 20e3, concurrent_sessions: 200e3 }],
    ['api-a', 'API A', 'server', 'RACK 01', 825, 180, { nic_bps: 6e9, nic_pps: 1e6 }],
    ['api-b', 'API B', 'server', 'RACK 02', 825, 400, { nic_bps: 6e9, nic_pps: 1e6 }],
  ]);
  connect(topology, [
    { id: 'entry-isp-a', source: 'internet', target: 'isp-a', capacity: { forwarding_bps: 12e9 } },
    { id: 'entry-isp-b', source: 'internet', target: 'isp-b', capacity: { forwarding_bps: 12e9 } },
    ['isp-a', 'edge-a', 12e9], ['isp-b', 'edge-b', 12e9],
    ['edge-a', 'fw-a', 12e9], ['edge-a', 'fw-b', 12e9], ['edge-b', 'fw-a', 12e9], ['edge-b', 'fw-b', 12e9],
    ['fw-a', 'api-a', 12e9], ['fw-a', 'api-b', 12e9], ['fw-b', 'api-a', 12e9], ['fw-b', 'api-b', 12e9],
  ]);
  const wanPaths = (target) => ['a', 'b'].flatMap((isp) => ['a', 'b'].map((firewall) => ({
    id: `${target}-via-${isp}${firewall}`, devices: ['internet', `isp-${isp}`, `edge-${isp}`, `fw-${firewall}`, target],
    links: [`entry-isp-${isp}`, `isp-${isp}-edge-${isp}`, `edge-${isp}-fw-${firewall}`, `fw-${firewall}-${target}`],
  })));
  for (const target of ['api-a', 'api-b']) {
    const paths = wanPaths(target);
    addDemand(topology, { id: `${target}-traffic`, name: `${target.toUpperCase()} 요청`, source: 'internet', target, load: { forwarding_bps: 4e9, forwarding_pps: 400e3, new_sessions_per_sec: 4e3, concurrent_sessions: 40e3, nic_bps: 4e9, nic_pps: 400e3 }, pathMode: 'explicit', paths,
      returnPath: paths.map(({ id, devices, links }) => ({ id: `${id}-return`, devices: [...devices].reverse(), links: [...links].reverse() })), directionality: { responseShare: 0.1, origin: 'estimate' } });
  }
  return declare(topology, {
    services: [{ id: 'public-api', name: 'Public API', demandIds: ['api-a-traffic', 'api-b-traffic'], requiredDeliveryRatio: 0.99 }],
    failureDomains: [{ id: 'shared-entry', name: '공용 건물 인입', kind: 'path', deviceIds: [], linkIds: ['entry-isp-a', 'entry-isp-b'] }],
  });
}

function asymWan() {
  const topology = createEmptyTopology('비대칭 가입자 회선');
  place(topology, [
    ['branch-lan', 'BRANCH LAN', 'switch', 'BRANCH', 150, 290, { forwarding_bps: 40e9, forwarding_pps: 6e6 }],
    ['cpe', 'CPE', 'router', 'BRANCH', 380, 290, { forwarding_bps: 2e9, forwarding_pps: 400e3 }],
    // 통신사 망은 우리가 재지 않는다. external 로 선언하면 적어 준 축만 판정하고, 모르는
    // 패킷 처리량을 0 으로 지어내지 않는다.
    { id: 'carrier', name: 'CARRIER', kind: 'cloud', zone: 'WAN', position: { x: 620, y: 290 }, limits: { forwarding_bps: 100e9 }, external: true },
    ['hq', 'HQ', 'vm', 'HQ', 860, 290, { nic_bps: 25e9, nic_pps: 4e6 }],
  ]);
  connect(topology, [
    ['branch-lan', 'cpe', 10e9],
    // source 가 cpe 이므로 정방향이 올려보내기다. 가입자 회선은 이 방향이 훨씬 좁다.
    { id: 'cpe-carrier', source: 'cpe', target: 'carrier', capacity: { forwarding_bps: 1e9, forwarding_pps: 1e6 },
      capacityByDirection: { forward: { forwarding_bps: 200e6 }, reverse: { forwarding_bps: 1e9 } } },
    ['carrier', 'hq', 10e9],
  ]);
  addDemand(topology, { id: 'download', name: '내려받기', source: 'hq', target: 'branch-lan',
    load: { forwarding_bps: 700e6, forwarding_pps: 120e3 } });
  addDemand(topology, { id: 'upload', name: '야간 백업', source: 'branch-lan', target: 'hq',
    load: { forwarding_bps: 170e6, forwarding_pps: 30e3 } });
  return topology;
}

function serviceSla() {
  const topology = createEmptyTopology('서비스 수용 기준');
  const gateway = { forwarding_bps: 20e9, forwarding_pps: 3e6, new_sessions_per_sec: 120e3, concurrent_sessions: 2e6 };
  place(topology, [
    { id: 'internet', name: 'INTERNET', kind: 'cloud', zone: 'EDGE', position: { x: 110, y: 290 }, limits: { forwarding_bps: 100e9 }, external: true },
    ['fw-a', 'FW A', 'firewall', 'SECURITY', 330, 170, gateway],
    ['fw-b', 'FW B', 'firewall', 'SECURITY', 330, 410, gateway],
    ['lb-a', 'LB A', 'lb', 'SERVICE', 560, 170, gateway],
    ['lb-b', 'LB B', 'lb', 'SERVICE', 560, 410, gateway],
    ...repeat(3, (n, index) => [`web-${n}`, `WEB 0${n}`, 'web', `RACK 0${n}`, 800, 140 + index * 150,
      { nic_bps: 25e9, nic_pps: 4e6, new_sessions_per_sec: 44.6e3 }]),
  ]);
  connect(topology, [
    ...mesh(['internet'], ['fw-a', 'fw-b'], 40e9),
    ...mesh(['fw-a', 'fw-b'], ['lb-a', 'lb-b'], 20e9),
    ...mesh(['lb-a', 'lb-b'], ['web-1', 'web-2', 'web-3'], 25e9),
  ]);
  addDemand(topology, { id: 'banking', name: '인터넷뱅킹', source: 'internet', target: 'web-1',
    load: { forwarding_bps: 9e9, forwarding_pps: 1.4e6, new_sessions_per_sec: 90e3, concurrent_sessions: 1.4e6 } });
  // 경고선을 낮추면 아직 넘지 않은 축도 일찍 노랗게 뜬다. 이 설계는 그 선을 스스로 정한다.
  topology.warningThreshold = 0.65;
  return declare(topology, {
    services: [{
      id: 'svc-banking', name: '인터넷뱅킹', demandIds: ['banking'], requiredDeliveryRatio: 0.99,
      endpointGroups: [{ id: 'web-pool', name: '웹 풀', members: ['web-1', 'web-2', 'web-3'], minAvailable: 2 }],
    }],
  });
}

/**
 * Raft 합의 클러스터. 리더 한 대가 나머지 셋에 로그를 복제하고 각자 수락 응답을 돌려준다.
 * 노드를 고리로 놓고 전부 이었다 - 합의는 스위치 한 대를 지나는 상하 관계가 아니라 서로가
 * 서로에게 말하는 구조이고, 리더가 바뀌면 지금 비어 있는 선이 쓰인다.
 *
 * 이 그림은 임기 하나다. 엔진은 정상 상태 하나를 계산하므로 재선출을 그리지 못한다. 리더를
 * 끄면 여기 그려진 흐름이 멈추는데, 그것은 클러스터의 죽음이 아니라 새 리더가 같은 숫자를
 * 이어받기까지의 공백이다. 넷의 사양을 같게 둔 이유가 그것이다.
 *
 * 보내는 것과 돌려받는 것을 수요 둘로 나눠 적었다. returnPath 로 한 수요에 묶지 않은 것은
 * responseShare 가 throughput 축 전체에 같은 몫을 매기기 때문이다 - Raft 의 수락 응답은
 * 바이트로는 로그의 몇 십분의 일인데 패킷으로는 하나에 하나씩이라, 한 숫자로는 둘 다 틀린다.
 */
function raftCluster() {
  const topology = createEmptyTopology('Raft 합의 클러스터');
  // 리더가 돌아가며 바뀌므로 네 대의 사양이 같다. 이 설계에서 가장 중요한 한 줄이다.
  const node = { nic_bps: 10e9, nic_pps: 2e6 };
  const peer = { forwarding_bps: 10e9, forwarding_pps: 2e6 };
  const nodes = ['node-1', 'node-2', 'node-3', 'node-4'];
  const followers = nodes.slice(1);
  place(topology, [
    { id: 'app', name: 'APP', kind: 'cloud', zone: 'EDGE', position: { x: 240, y: 330 }, limits: { forwarding_bps: 40e9 }, external: true },
    // 고리로 둘러 세운다. 리더를 고리의 왼쪽에 두어야 APP 에서 들어오는 선이 다른 노드를 넘지 않는다.
    ['node-1', 'RAFT 01', 'server', 'CONSENSUS', 520, 330, node],
    ['node-2', 'RAFT 02', 'server', 'CONSENSUS', 700, 200, node],
    ['node-3', 'RAFT 03', 'server', 'CONSENSUS', 880, 330, node],
    ['node-4', 'RAFT 04', 'server', 'CONSENSUS', 700, 460, node],
  ]);
  // 넷을 전부 잇는다. 지금 쓰이는 것은 리더에서 뻗는 셋뿐이고, 나머지 셋은 다음 임기의 길이다.
  connect(topology, [
    { source: 'app', target: 'node-1', capacity: peer },
    ...nodes.flatMap((from, index) => nodes.slice(index + 1).map((to) => ({ source: from, target: to, capacity: peer }))),
  ]);
  // 쓰기는 리더 한 대로만 들어간다. Raft 는 부하 분산이 아니다.
  addDemand(topology, { id: 'writes', name: '트랜잭션 쓰기', source: 'app', target: 'node-1',
    load: { forwarding_bps: 900e6, forwarding_pps: 600e3 } });
  for (const [index, follower] of followers.entries()) {
    const term = index + 2;
    // 리더는 같은 로그를 팔로워마다 따로 보낸다. 한 번 쓴 것이 셋으로 늘어나는 자리다.
    addDemand(topology, { id: `append-${term}`, name: `RAFT 0${term} 로그 복제`, source: 'node-1', target: follower,
      load: { forwarding_bps: 800e6, forwarding_pps: 150e3 } });
    // 수락 응답은 로그의 40분의 1이지만 패킷 수는 보낸 것과 같다. 합의의 부담은 바이트가 아니다.
    addDemand(topology, { id: `ack-${term}`, name: `RAFT 0${term} 수락 응답`, source: follower, target: 'node-1',
      load: { forwarding_bps: 20e6, forwarding_pps: 150e3 } });
  }
  return declare(topology, {
    services: [{
      // 수용 기준의 이름이 범위를 말한다. 리더를 끄면 이 임기가 끝나는 것이지 클러스터가 죽는
      // 것이 아니다. 정족수는 그때도 셋으로 서 있고, 그 사실을 endpointGroups 가 따로 말한다.
      id: 'svc-term', name: '이번 임기의 원장 쓰기', requiredDeliveryRatio: 0.99, demandIds: ['writes'],
      // 넷의 정족수는 셋이다. 한 대는 잃어도 서고, 두 대를 잃으면 무너진다 - 셋과 같은 내구성이다.
      endpointGroups: [{ id: 'quorum', name: '정족수', members: nodes, minAvailable: 3 }],
    }],
  });
}

function datasheetPerimeter() {
  const topology = createEmptyTopology('데이터시트로 짠 경계');
  place(topology, [
    { id: 'internet', name: 'INTERNET', kind: 'cloud', zone: 'EDGE', position: { x: 110, y: 290 }, limits: { forwarding_bps: 40e9 }, external: true },
    // 한계값을 손으로 적지 않는다. 카탈로그가 데이터시트에서 옮긴 값과 그것을 잰 조건을 함께 준다.
    { id: 'fg', name: 'FG 100F', kind: 'firewall', zone: 'EDGE', position: { x: 320, y: 290 }, spec: ['fortinet-fortigate-100f', 'fw-1518'] },
    { id: 'pa', name: 'PA-3410', kind: 'firewall', zone: 'DMZ', position: { x: 530, y: 290 }, spec: ['paloalto-pa-3410', 'firewall-appmix'] },
    ['core', 'CORE SW', 'switch', 'CORE', 740, 290, { forwarding_bps: 80e9, forwarding_pps: 12e6 }],
    ['app-1', 'APP 01', 'web', 'RACK 01', 950, 180, { nic_bps: 25e9, nic_pps: 4e6, new_sessions_per_sec: 60e3 }],
    ['app-2', 'APP 02', 'web', 'RACK 02', 950, 400, { nic_bps: 25e9, nic_pps: 4e6, new_sessions_per_sec: 60e3 }],
  ]);
  connect(topology, [
    ['internet', 'fg', 20e9], ['fg', 'pa', 20e9], ['pa', 'core', 20e9],
    ['core', 'app-1', 25e9], ['core', 'app-2', 25e9],
  ]);
  for (const n of [1, 2]) {
    addDemand(topology, { id: `svc-${n}`, name: `서비스 0${n}`, source: 'internet', target: `app-${n}`,
      load: { forwarding_bps: 7e9, forwarding_pps: 1.1e6, new_sessions_per_sec: 22e3, concurrent_sessions: 400e3 } });
  }
  // 데이터시트 값은 조건과 함께여야 숫자다. 우리 트래픽의 조건을 적어 두어야 대조가 시작된다.
  setWorkloadConditions(topology, { packet_size_bytes: 1518, transport: 'udp', features_enabled: [] });
  return topology;
}

function dcPod() {
  const topology = createEmptyTopology('데이터센터 POD');
  const rack = (n) => `POD 1 / RACK 0${n}`;
  const spines = repeat(4, (n) => `spine-${n}`);
  const leaves = repeat(8, (n) => `leaf-${n}`);
  place(topology, [
    { id: 'internet', name: 'INTERNET', kind: 'cloud', zone: 'EDGE', position: { x: 140, y: 110 }, limits: { forwarding_bps: 400e9 }, external: true },
    ['border-a', 'BORDER A', 'router', 'EDGE', 560, 110, { forwarding_bps: 200e9, forwarding_pps: 30e6 }],
    ['border-b', 'BORDER B', 'router', 'EDGE', 860, 110, { forwarding_bps: 200e9, forwarding_pps: 30e6 }],
    ['fw-a', 'FW A', 'firewall', 'EDGE', 560, 270, { forwarding_bps: 100e9, forwarding_pps: 15e6, new_sessions_per_sec: 600e3, concurrent_sessions: 10e6 }],
    ['fw-b', 'FW B', 'firewall', 'EDGE', 860, 270, { forwarding_bps: 100e9, forwarding_pps: 15e6, new_sessions_per_sec: 600e3, concurrent_sessions: 10e6 }],
    ...repeat(4, (n) => [`spine-${n}`, `SPINE 0${n}`, 'switch', 'POD 1 / SPINE', 320 + (n - 1) * 200, 430, { forwarding_bps: 100e9, forwarding_pps: 15e6 }]),
    ...repeat(8, (n) => [`leaf-${n}`, `LEAF 0${n}`, 'switch', rack(n), 140 + (n - 1) * 120, 590, { forwarding_bps: 60e9, forwarding_pps: 9e6 }]),
    // 마지막 랙만 스토리지다. 백업이 그 한 대로 모이고, 이 설계에서 가장 꽉 차는 곳이 된다.
    ...repeat(8, (n) => [`node-${n}`, n === 8 ? 'STORAGE' : `NODE 0${n}`, n === 8 ? 'nas' : 'server', rack(n),
      140 + (n - 1) * 120, 750, { nic_bps: 25e9, nic_pps: 4e6 }]),
  ]);
  connect(topology, [
    ...mesh(['internet'], ['border-a', 'border-b'], 200e9),
    ...mesh(['border-a', 'border-b'], ['fw-a', 'fw-b'], 100e9),
    ...mesh(['fw-a', 'fw-b'], spines, 100e9),
    ...mesh(spines, leaves, 50e9),
    ...repeat(8, (n) => [`leaf-${n}`, `node-${n}`, 25e9]),
  ]);
  addDemand(topology, { id: 'north', name: '북남 API', source: 'internet', target: 'node-1',
    load: { forwarding_bps: 4e9, forwarding_pps: 700e3, new_sessions_per_sec: 200e3, concurrent_sessions: 3e6 } });
  for (const n of repeat(6, (index) => index)) {
    addDemand(topology, { id: `ew-0${n}`, name: `동서 0${n}`, source: `node-${n}`, target: `node-${n + 1}`,
      load: { forwarding_bps: 9e9, forwarding_pps: 1.5e6 } });
  }
  for (const n of [1, 3, 5, 7]) {
    addDemand(topology, { id: `backup-0${n}`, name: `백업 0${n}`, source: `node-${n}`, target: 'node-8',
      load: { forwarding_bps: 5.5e9, forwarding_pps: 800e3 } });
  }
  return declare(topology, {
    // 랙은 장비 한 대씩 죽지 않는다. 리프와 그 랙의 서버가 한 묶음이고, 전원 계통은
    // 논리적 이중화를 가로지른다 - 경계 라우터와 방화벽이 같은 계통에 물려 있다.
    failureDomains: [
      ...repeat(8, (n) => ({ id: `rack-0${n}`, name: `RACK 0${n}`, deviceIds: [`leaf-${n}`, `node-${n}`], linkIds: [] })),
      { id: 'power-a', name: '전원 계통 A', deviceIds: ['border-a', 'fw-a'], linkIds: [] },
      { id: 'power-b', name: '전원 계통 B', deviceIds: ['border-b', 'fw-b'], linkIds: [] },
    ],
    haGroups: [{ id: 'fw-pair', name: '경계 방화벽', members: ['fw-a', 'fw-b'], sessionSync: 'none', reestablishWindowSec: 30 }],
  });
}

function poolAndPath() {
  const topology = createEmptyTopology('풀 추론과 강제 경로');
  place(topology, [
    { id: 'internet', name: 'INTERNET', kind: 'cloud', zone: 'EDGE', position: { x: 110, y: 200 }, limits: { forwarding_bps: 40e9 }, external: true },
    ['waf', 'WAF', 'waf', 'DMZ', 350, 200, { forwarding_bps: 20e9, forwarding_pps: 3e6, new_sessions_per_sec: 150e3, concurrent_sessions: 2e6 }],
    { id: 'admin', name: 'ADMIN', kind: 'client', zone: 'OPS', position: { x: 110, y: 470 }, limits: { nic_bps: 10e9, nic_pps: 2e6 }, external: true },
    ['sw', 'OPS SW', 'switch', 'OPS', 350, 470, { forwarding_bps: 40e9, forwarding_pps: 6e6 }],
    ...repeat(3, (n, index) => [`web-${n}`, `WEB 0${n}`, 'web', `RACK 0${n}`, 640, 120 + index * 200,
      { nic_bps: 25e9, nic_pps: 4e6, new_sessions_per_sec: 40e3 }]),
  ]);
  connect(topology, [
    ['internet', 'waf', 20e9], ['admin', 'sw', 10e9], ['sw', 'waf', 20e9],
    ...mesh(['waf'], repeat(3, (n) => `web-${n}`), 25e9),
    ...mesh(['sw'], repeat(3, (n) => `web-${n}`), 25e9),
  ]);
  // 앞단이 WAF 라 자동 추론은 풀을 못 만든다(BFS 선행자가 전부 lb 여야 한다). 손으로 적는다.
  addDemand(topology, { id: 'shop', name: '쇼핑 트래픽', source: 'internet', target: 'web-1',
    backendPool: { memberIds: ['web-1', 'web-2', 'web-3'] },
    load: { forwarding_bps: 9e9, forwarding_pps: 1.4e6, new_sessions_per_sec: 90e3, concurrent_sessions: 1.4e6 } });
  // 최단 경로는 OPS SW 에서 곧장 가지만, 정책이 WAF 를 지나게 한다. 그 경로를 그대로 적는다.
  addDemand(topology, { id: 'patch', name: '패치 배포', source: 'admin', target: 'web-1', backendPool: 'single',
    paths: [{ id: 'via-waf', devices: ['admin', 'sw', 'waf', 'web-1'], links: ['admin-sw', 'sw-waf', 'waf-web-1'] }],
    load: { forwarding_bps: 6e9, forwarding_pps: 500e3, new_sessions_per_sec: 400, concurrent_sessions: 8e3 } });
  return topology;
}

function closPaths() {
  const topology = createEmptyTopology('경로가 너무 많은 팹릭');
  const fabric = { forwarding_bps: 400e9, forwarding_pps: 300e6 };
  const tier = (stage, count, x, top, gap) => repeat(count, (n, index) =>
    [`t${stage}-${n}`, `T${stage}-0${n}`, 'switch', `TIER ${stage}`, x, top + index * gap, fabric]);
  place(topology, [
    ['leaf-a', 'LEAF A', 'switch', 'RACK 01', 120, 350, fabric],
    ...tier(1, 4, 330, 140, 140), ...tier(2, 4, 530, 140, 140), ...tier(3, 5, 730, 110, 130),
    ['leaf-b', 'LEAF B', 'switch', 'RACK 02', 940, 350, fabric],
  ]);
  const stage = (n, count) => repeat(count, (index) => `t${n}-${index}`);
  connect(topology, [
    ...mesh(['leaf-a'], stage(1, 4), 100e9),
    ...mesh(stage(1, 4), stage(2, 4), 100e9),
    ...mesh(stage(2, 4), stage(3, 5), 100e9),
    ...mesh(stage(3, 5), ['leaf-b'], 100e9),
  ]);
  addDemand(topology, { id: 'east-west', name: '동서 트래픽', source: 'leaf-a', target: 'leaf-b',
    load: { forwarding_bps: 40e9, forwarding_pps: 30e6 } });
  return topology;
}

function rackPower() {
  const topology = createEmptyTopology('랙 전력과 공간');
  const gpu = { uHeight: 4, typicalDrawWatts: 2400, maximumDrawWatts: 3200 };
  place(topology, [
    { id: 'client', name: 'OPS', kind: 'client', zone: 'OFFICE', position: { x: 900, y: 150 }, limits: { nic_bps: 10e9 }, external: true },
    { id: 'fw', name: 'FW', kind: 'firewall', zone: 'ROW A / RACK 01', position: { x: 250, y: 310 },
      limits: { forwarding_bps: 20e9, forwarding_pps: 3e6, new_sessions_per_sec: 120e3, concurrent_sessions: 2e6 },
      metadata: { uHeight: 2, typicalDrawWatts: 320, maximumDrawWatts: 600 } },
    { id: 'core', name: 'CORE SW', kind: 'switch', zone: 'ROW A / RACK 01', position: { x: 250, y: 150 },
      limits: { forwarding_bps: 80e9, forwarding_pps: 12e6 },
      metadata: { uHeight: 1, typicalDrawWatts: 430, maximumDrawWatts: 750 } },
    { id: 'gpu-01', name: 'GPU 01', kind: 'server', zone: 'ROW A / RACK 01', position: { x: 130, y: 490 }, limits: { nic_bps: 25e9, nic_pps: 4e6 }, metadata: gpu },
    { id: 'gpu-02', name: 'GPU 02', kind: 'server', zone: 'ROW A / RACK 01', position: { x: 370, y: 490 }, limits: { nic_bps: 25e9, nic_pps: 4e6 }, metadata: gpu },
    { id: 'gpu-03', name: 'GPU 03', kind: 'server', zone: 'ROW A / RACK 02', position: { x: 660, y: 490 }, limits: { nic_bps: 25e9, nic_pps: 4e6 }, metadata: gpu },
    { id: 'nas', name: 'NAS', kind: 'nas', zone: 'ROW A / RACK 02', position: { x: 660, y: 310 }, limits: { nic_bps: 25e9, nic_pps: 4e6 },
      metadata: { uHeight: 2, typicalDrawWatts: 620, maximumDrawWatts: 900 } },
  ]);
  connect(topology, [['client', 'fw', 10e9], ['fw', 'core', 20e9],
    ...mesh(['core'], ['gpu-01', 'gpu-02', 'gpu-03', 'nas'], 25e9)]);
  addDemand(topology, { id: 'train', name: '학습 데이터 읽기', source: 'gpu-01', target: 'nas', load: { forwarding_bps: 18e9, forwarding_pps: 2.4e6 } });
  addDemand(topology, { id: 'train-2', name: '학습 데이터 읽기 2', source: 'gpu-02', target: 'nas', load: { forwarding_bps: 4e9, forwarding_pps: 800e3 } });
  addDemand(topology, { id: 'ops', name: '운영 접속', source: 'client', target: 'nas',
    load: { forwarding_bps: 500e6, forwarding_pps: 100e3, new_sessions_per_sec: 2e3, concurrent_sessions: 40e3 } });
  return declare(topology, {
    // 전력 기준은 랙이 정한다. 장비가 다른 기준을 선언하면 합계를 내지 않고 미확인으로 남긴다 —
    // nameplate 과 typical 은 더할 수 없는 값이다.
    racks: [
      { id: 'rack-01', name: 'RACK 01', deviceIds: ['core', 'fw', 'gpu-01', 'gpu-02'], powerBasis: 'typical', powerBudgetWatts: 5000, capacityU: 42, placements: [
        { id: 'rack-01-pdu-a', name: 'PDU A', kind: 'pdu', startU: 1, uHeight: 1, powerWatts: 0 },
        { id: 'rack-01-gpu-01', deviceId: 'gpu-01', startU: 3, uHeight: 4 },
        { id: 'rack-01-gpu-02', deviceId: 'gpu-02', startU: 8, uHeight: 4 },
        { id: 'rack-01-cable-manager', name: 'CABLE MANAGER', kind: 'cable-management', startU: 36, uHeight: 1, powerWatts: 0 },
        { id: 'rack-01-fw', deviceId: 'fw', startU: 37, uHeight: 2 },
        { id: 'rack-01-patch-panel', name: 'PATCH PANEL 01', kind: 'patch-panel', startU: 39, uHeight: 1, powerWatts: 0 },
        { id: 'rack-01-core', deviceId: 'core', startU: 41, uHeight: 1 },
      ] },
      { id: 'rack-02', name: 'RACK 02', deviceIds: ['gpu-03', 'nas'], powerBasis: 'typical', powerBudgetWatts: 5000, capacityU: 42, placements: [
        { id: 'rack-02-pdu-a', name: 'PDU A', kind: 'pdu', startU: 1, uHeight: 1, powerWatts: 0 },
        { id: 'rack-02-gpu-03', deviceId: 'gpu-03', startU: 3, uHeight: 4 },
        { id: 'rack-02-nas', deviceId: 'nas', startU: 8, uHeight: 2 },
        { id: 'rack-02-cable-manager', name: 'CABLE MANAGER', kind: 'cable-management', startU: 39, uHeight: 1, powerWatts: 0 },
        { id: 'rack-02-patch-panel', name: 'PATCH PANEL 02', kind: 'patch-panel', startU: 41, uHeight: 1, powerWatts: 0 },
      ] },
    ],
  });
}

function aiInferencePod() {
  const topology = createEmptyTopology('AI 추론 Pod');
  const gpu = { powerBasis: 'typical', uHeight: 4, typicalDrawWatts: 1400, maximumDrawWatts: 1800 };
  place(topology, [
    { id: 'client', name: 'CLIENT', kind: 'client', zone: 'EDGE', position: { x: 70, y: 290 }, limits: { nic_bps: 200e9 }, external: true },
    { id: 'gateway', name: 'INFERENCE GW', kind: 'lb', zone: 'EDGE', position: { x: 230, y: 290 }, limits: { forwarding_bps: 200e9, forwarding_pps: 80e6, new_sessions_per_sec: 120e3, concurrent_sessions: 1.2e6 }, metadata: { powerBasis: 'typical', uHeight: 1, typicalDrawWatts: 260 } },
    { id: 'leaf-a', name: 'LEAF A', kind: 'switch', zone: 'FABRIC A', position: { x: 430, y: 160 }, limits: { forwarding_bps: 400e9, forwarding_pps: 80e6 }, metadata: { powerBasis: 'typical', uHeight: 1, typicalDrawWatts: 420 } },
    { id: 'leaf-b', name: 'LEAF B', kind: 'switch', zone: 'FABRIC B', position: { x: 430, y: 420 }, limits: { forwarding_bps: 400e9, forwarding_pps: 80e6 }, metadata: { powerBasis: 'typical', uHeight: 1, typicalDrawWatts: 420 } },
    { id: 'spine-a', name: 'SPINE A', kind: 'switch', zone: 'FABRIC A', position: { x: 610, y: 100 }, limits: { forwarding_bps: 400e9, forwarding_pps: 80e6 }, metadata: { powerBasis: 'typical', uHeight: 1, typicalDrawWatts: 480 } },
    { id: 'spine-b', name: 'SPINE B', kind: 'switch', zone: 'FABRIC B', position: { x: 610, y: 480 }, limits: { forwarding_bps: 400e9, forwarding_pps: 80e6 }, metadata: { powerBasis: 'typical', uHeight: 1, typicalDrawWatts: 480 } },
    ...repeat(8, (number, index) => ({ id: `gpu-${number}`, name: `GPU ${String(number).padStart(2, '0')}`, kind: 'server', zone: `RACK ${index < 4 ? '21' : '22'}`, position: { x: 850 + (index % 4) * 55, y: index < 4 ? 150 : 430 }, limits: { nic_bps: 100e9, nic_pps: 15e6 }, metadata: gpu })),
  ]);
  connect(topology, [
    ['client', 'gateway', 200e9], ['gateway', 'leaf-a', 200e9], ['gateway', 'leaf-b', 200e9],
    ['leaf-a', 'spine-a', 400e9], ['leaf-b', 'spine-b', 400e9],
    ...repeat(8, (number) => [['spine-a', `gpu-${number}`, 100e9], ['spine-b', `gpu-${number}`, 100e9]]).flat(),
  ]);
  for (const number of Array.from({ length: 8 }, (unused, index) => index + 1)) {
    const target = `gpu-${number}`;
    const paths = ['a', 'b'].map((plane) => ({ id: `${target}-via-${plane}`, devices: ['client', 'gateway', `leaf-${plane}`, `spine-${plane}`, target], links: ['client-gateway', `gateway-leaf-${plane}`, `leaf-${plane}-spine-${plane}`, `spine-${plane}-${target}`] }));
    addDemand(topology, { id: `inference-${number}`, name: `GPU ${String(number).padStart(2, '0')} 추론`, source: 'client', target, load: { forwarding_bps: 18e9, forwarding_pps: 2.2e6, new_sessions_per_sec: 12e3, concurrent_sessions: 90e3, nic_bps: 18e9, nic_pps: 2.2e6 }, pathMode: 'explicit', paths, returnPath: paths.map(({ id, devices, links }) => ({ id: `${id}-return`, devices: [...devices].reverse(), links: [...links].reverse() })), directionality: { responseShare: 0.1, origin: 'estimate' } });
  }
  return declare(topology, {
    services: [{ id: 'inference-api', name: 'Inference API', demandIds: Array.from({ length: 8 }, (unused, index) => `inference-${index + 1}`), requiredDeliveryRatio: 0.99 }],
    // 실제 이중 PSU 결선이나 냉각은 모델에 없다. 여기서는 GPU가 랙별 단일 공급 PDU 그룹을 공유하는지만 계산한다.
    failureDomains: [
      { id: 'gpu-rail-a', name: 'GPU RACK 21 PDU', kind: 'power', deviceIds: ['gpu-1', 'gpu-2', 'gpu-3', 'gpu-4'] },
      { id: 'gpu-rail-b', name: 'GPU RACK 22 PDU', kind: 'power', deviceIds: ['gpu-5', 'gpu-6', 'gpu-7', 'gpu-8'] },
    ],
    racks: [
      { id: 'gpu-rack-21', name: 'GPU RACK 21', deviceIds: ['leaf-a', 'spine-a', 'gpu-1', 'gpu-2', 'gpu-3', 'gpu-4'], powerBasis: 'typical', powerBudgetWatts: 6800, capacityU: 42, placements: [
        { id: 'gpu-rack-21-pdu-a', name: 'PDU A', kind: 'pdu', startU: 1, uHeight: 1, powerWatts: 0 }, { id: 'gpu-rack-21-pdu-b', name: 'PDU B', kind: 'pdu', startU: 2, uHeight: 1, powerWatts: 0 },
        { id: 'gpu-rack-21-gpu-1', deviceId: 'gpu-1', startU: 4, uHeight: 4 }, { id: 'gpu-rack-21-gpu-2', deviceId: 'gpu-2', startU: 9, uHeight: 4 }, { id: 'gpu-rack-21-gpu-3', deviceId: 'gpu-3', startU: 14, uHeight: 4 }, { id: 'gpu-rack-21-gpu-4', deviceId: 'gpu-4', startU: 19, uHeight: 4 },
        { id: 'gpu-rack-21-leaf-a', deviceId: 'leaf-a', startU: 38, uHeight: 1 }, { id: 'gpu-rack-21-spine-a', deviceId: 'spine-a', startU: 40, uHeight: 1 },
      ] },
      { id: 'gpu-rack-22', name: 'GPU RACK 22', deviceIds: ['leaf-b', 'spine-b', 'gpu-5', 'gpu-6', 'gpu-7', 'gpu-8'], powerBasis: 'typical', powerBudgetWatts: 6800, capacityU: 42, placements: [
        { id: 'gpu-rack-22-pdu-a', name: 'PDU A', kind: 'pdu', startU: 1, uHeight: 1, powerWatts: 0 }, { id: 'gpu-rack-22-pdu-b', name: 'PDU B', kind: 'pdu', startU: 2, uHeight: 1, powerWatts: 0 },
        { id: 'gpu-rack-22-gpu-5', deviceId: 'gpu-5', startU: 4, uHeight: 4 }, { id: 'gpu-rack-22-gpu-6', deviceId: 'gpu-6', startU: 9, uHeight: 4 }, { id: 'gpu-rack-22-gpu-7', deviceId: 'gpu-7', startU: 14, uHeight: 4 }, { id: 'gpu-rack-22-gpu-8', deviceId: 'gpu-8', startU: 19, uHeight: 4 },
        { id: 'gpu-rack-22-leaf-b', deviceId: 'leaf-b', startU: 38, uHeight: 1 }, { id: 'gpu-rack-22-spine-b', deviceId: 'spine-b', startU: 40, uHeight: 1 },
      ] },
    ],
  });
}

// A/B 두 레일로 급전하는 한 줄. 잘 나뉜 쌍과 한쪽 레일에만 물린 장비를 한 설계 안에 같이 둔다 —
// 어느 쪽이 어느 레일인지는 논리 그림에서 보이지 않고 랙의 전원 도메인 색으로만 드러난다.
function pduRails() {
  const topology = createEmptyTopology('A/B 전원 레일');
  const switchLimits = { forwarding_bps: 40e9, forwarding_pps: 6e6 };
  const appLimits = { nic_bps: 10e9, nic_pps: 1.5e6 };
  place(topology, [
    { id: 'ops', name: 'OPS', kind: 'client', zone: 'OFFICE', position: { x: 900, y: 140 }, limits: { nic_bps: 10e9 }, external: true },
    { id: 'edge', name: 'EDGE', kind: 'router', zone: 'ROW B / RACK 11', position: { x: 620, y: 140 },
      limits: { forwarding_bps: 20e9, forwarding_pps: 3e6, new_sessions_per_sec: 120e3, concurrent_sessions: 2e6 },
      metadata: { powerBasis: 'typical', typicalDrawWatts: 210, uHeight: 1 } },
    { id: 'core-a', name: 'CORE A', kind: 'switch', zone: 'ROW B / RACK 11', position: { x: 440, y: 300 }, limits: switchLimits,
      metadata: { powerBasis: 'typical', typicalDrawWatts: 430, uHeight: 1 } },
    { id: 'core-b', name: 'CORE B', kind: 'switch', zone: 'ROW B / RACK 11', position: { x: 800, y: 300 }, limits: switchLimits,
      metadata: { powerBasis: 'typical', typicalDrawWatts: 430, uHeight: 1 } },
    { id: 'app-01', name: 'APP 01', kind: 'server', zone: 'ROW B / RACK 11', position: { x: 440, y: 470 }, limits: appLimits,
      metadata: { powerBasis: 'typical', typicalDrawWatts: 520, uHeight: 2 } },
    { id: 'app-02', name: 'APP 02', kind: 'server', zone: 'ROW B / RACK 12', position: { x: 800, y: 470 }, limits: appLimits,
      metadata: { powerBasis: 'typical', typicalDrawWatts: 520, uHeight: 2 } },
    { id: 'nas', name: 'NAS', kind: 'nas', zone: 'ROW B / RACK 12', position: { x: 620, y: 620 }, limits: { nic_bps: 25e9, nic_pps: 3e6 },
      metadata: { powerBasis: 'typical', typicalDrawWatts: 760, uHeight: 4 } },
  ]);
  connect(topology, [['ops', 'edge', 10e9], ['edge', 'core-a', 40e9], ['edge', 'core-b', 40e9],
    ...mesh(['core-a', 'core-b'], ['app-01', 'app-02'], 10e9), ...mesh(['core-a', 'core-b'], ['nas'], 25e9)]);
  addDemand(topology, { id: 'api', name: '공개 API A', source: 'ops', target: 'app-01',
    load: { forwarding_bps: 2.5e9, forwarding_pps: 320e3, new_sessions_per_sec: 18e3, concurrent_sessions: 300e3 } });
  addDemand(topology, { id: 'api-2', name: '공개 API B', source: 'ops', target: 'app-02',
    load: { forwarding_bps: 2.5e9, forwarding_pps: 320e3, new_sessions_per_sec: 18e3, concurrent_sessions: 300e3 } });
  addDemand(topology, { id: 'backup', name: '야간 백업', source: 'app-01', target: 'nas',
    load: { forwarding_bps: 6e9, forwarding_pps: 700e3 } });
  return declare(topology, {
    services: [{ id: 'public-api', name: '공개 API', demandIds: ['api', 'api-2'], requiredDeliveryRatio: 0.99 }],
    // 레일은 랙이 아니다. 한 랙 안에서도 장비마다 어느 레일에 꽂혔는지가 다르고, 그 차이가 장애
    // 범위를 정한다. 도메인에 없는 EDGE 는 두 레일에 모두 물린 장비다.
    failureDomains: [
      { id: 'rail-a', name: 'A 레일 (PDU A)', kind: 'power', deviceIds: ['core-a', 'app-01', 'nas'] },
      { id: 'rail-b', name: 'B 레일 (PDU B)', kind: 'power', deviceIds: ['core-b', 'app-02'] },
    ],
    racks: [
      { id: 'rack-11', name: 'RACK 11', deviceIds: ['edge', 'core-a', 'core-b', 'app-01'], powerBasis: 'typical', powerBudgetWatts: 1800, capacityU: 42, placements: [
        { id: 'rack-11-pdu-a', name: 'PDU A', kind: 'pdu', startU: 1, uHeight: 1, powerWatts: 0 },
        { id: 'rack-11-pdu-b', name: 'PDU B', kind: 'pdu', startU: 2, uHeight: 1, powerWatts: 0 },
        { id: 'rack-11-app-01', deviceId: 'app-01', startU: 4, uHeight: 2 },
        { id: 'rack-11-cable-manager', name: 'CABLE MANAGER', kind: 'cable-management', startU: 38, uHeight: 1, powerWatts: 0 },
        { id: 'rack-11-patch-panel', name: 'PATCH PANEL 11', kind: 'patch-panel', startU: 39, uHeight: 1, powerWatts: 0 },
        { id: 'rack-11-core-a', deviceId: 'core-a', startU: 40, uHeight: 1 },
        { id: 'rack-11-core-b', deviceId: 'core-b', startU: 41, uHeight: 1 },
        { id: 'rack-11-edge', deviceId: 'edge', startU: 42, uHeight: 1 },
      ] },
      { id: 'rack-12', name: 'RACK 12', deviceIds: ['app-02', 'nas'], powerBasis: 'typical', powerBudgetWatts: 1800, capacityU: 42, placements: [
        { id: 'rack-12-pdu-a', name: 'PDU A', kind: 'pdu', startU: 1, uHeight: 1, powerWatts: 0 },
        { id: 'rack-12-pdu-b', name: 'PDU B', kind: 'pdu', startU: 2, uHeight: 1, powerWatts: 0 },
        { id: 'rack-12-nas', deviceId: 'nas', startU: 4, uHeight: 4 },
        { id: 'rack-12-app-02', deviceId: 'app-02', startU: 9, uHeight: 2 },
        { id: 'rack-12-patch-panel', name: 'PATCH PANEL 12', kind: 'patch-panel', startU: 41, uHeight: 1, powerWatts: 0 },
      ] },
    ],
  });
}

// 설계가 스물을 넘으면 한 줄로 깔린 목록에서는 고를 수가 없다. 등급 배지도 기준이 되지 못한다 —
// 스물넷 중 스물이 단일 장애점이다. 그래서 무엇을 가르치는지로 묶는다. 순서가 곧 섹션 순서다.
export const templateGroups = Object.freeze([
  { id: 'basics', label: '기본 구성' },
  { id: 'resilience', label: '공유 장애와 복원력' },
  { id: 'balance', label: '부하 분산과 백엔드 풀' },
  { id: 'security', label: '보안 경로' },
  { id: 'capacity', label: '용량은 다른 곳에서 찬다' },
  { id: 'evidence', label: '근거와 판정 기준' },
  { id: 'scale', label: '규모와 장애 범위' },
  { id: 'blank', label: '빈 캔버스' },
]);

export const templates = [
  {
    id: 'dual-fabric', name: '이중 팹릭 API 클러스터',
    group: 'resilience',
    // 등급은 이 파일 안의 리터럴에서 나오는 설계의 성질이지, 열 때마다 알아내야 하는 값이 아니다.
    // experiment.observe 의 퍼센트와 같은 규율로 tests/templates.test.js 가 계산과 대조한다.
    grade: { verdict: 'single-point', severs: 6 },
    summary: 'SPINE A/B가 PDU-3 공용 전원을 공유하는 ECMP API 구성입니다.',
    teaches: 'SPINE은 두 대여도 PDU-3 하나가 멈추면 함께 꺼집니다. 이중화 무효가 된 공용 전원 장애를 바로 주입해 확인하세요.',
    tags: ['ECMP', '공유 전원', 'PDU-3', '장애 도메인', '이중화 무효'],
    experiment: {
      prompt: 'PDU-3 공용 전원이 멈추면 SPINE A/B 이중화가 유지될까요?',
      action: { type: 'fault-domain', id: 'pdu-3', label: 'PDU-3 공용 전원 장애 실험' },
      observe: 'SPINE A와 SPINE B가 함께 꺼져 Public API가 단절됩니다. 장비 두 대가 있어도 공용 전원 하나가 이중화를 무효로 만듭니다.',
    },
    build: () => {
      const topology = cloneTopology();
      topology.services = [{ id: 'public-api-service', name: 'Public API', demandIds: ['public-api'], requiredDeliveryRatio: 0.99 }];
      topology.failureDomains = [
        { id: 'rack-04', name: 'RACK 04', kind: 'space', deviceIds: ['leaf-a', 'api-a'] },
        { id: 'rack-07', name: 'RACK 07', kind: 'space', deviceIds: ['leaf-b', 'api-b'] },
        { id: 'pdu-3', name: 'PDU-3 SPINE 공용 전원', kind: 'power', deviceIds: ['spine-a', 'spine-b'] },
      ];
      topology.racks = [
        { id: 'rack-04-budget', name: 'RACK 04', deviceIds: ['leaf-a', 'api-a'], powerBasis: 'nameplate', powerBudgetWatts: 1400, capacityU: 42 },
        { id: 'rack-07-budget', name: 'RACK 07', deviceIds: ['leaf-b', 'api-b'], powerBasis: 'typical', powerBudgetWatts: 1400, capacityU: 42 },
      ];
      return topology;
    },
  },
  {
    id: 'single-stack', name: '단일 경로 웹 서비스',
    group: 'basics',
    grade: { verdict: 'single-point', severs: 4 },
    summary: '방화벽과 로드밸런서를 각각 한 대로 세운 구성입니다.',
    teaches: '무장애일 때는 모든 축이 75%로 아래 이중화 구성과 똑같습니다. 방화벽 한 대가 죽는 순간 트래픽 전부가 끊깁니다. 둘을 나란히 열어 비교하세요. 웹 서버는 로드밸런서가 한 풀로 묶어 나눠 보내므로 한 대가 죽어도 끊기지는 않지만, 남은 쪽이 150%가 되어 전달률이 67%로 내려갑니다.',
    tags: ['단일 장애점', '이중화', '비교', '방화벽', '백엔드 풀'],
    experiment: { prompt: '방화벽 한 대가 멈추면 서비스가 얼마나 전달될까요?', action: { type: 'fault-device', id: 'fw', label: 'FW 장애 실험' }, observe: '경로가 사라져 두 demand가 모두 단절됩니다.' },
    build: singleStack,
  },
  {
    id: 'dual-stack', name: '이중화 웹 서비스',
    group: 'basics',
    grade: { verdict: 'partial' },
    summary: '같은 부하를 같은 총용량으로 받되 절반짜리 장비 두 대로 나눈 구성입니다.',
    teaches: '방화벽 한 대가 죽어도 끊기지 않습니다. 대신 남은 쪽 대역폭이 150%가 되고, 세션 동기화가 없어 재수립 폭증까지 겹친 신규 세션은 178%가 됩니다. 이중화했다고 용량이 따라오는 것은 아닙니다. 웹 서버 쪽도 마찬가지로 한 대가 죽으면 풀이 흡수하지만 남은 쪽이 150%가 됩니다.',
    tags: ['이중화', '단일 장애점', '비교', 'ECMP', '백엔드 풀'],
    experiment: { prompt: 'FW A가 멈추면 연결은 유지되지만 남은 장비 용량도 충분할까요?', action: { type: 'fault-device', id: 'fw-a', label: 'FW A 장애 실험' }, observe: '트래픽은 FW B로 모이고 처리량과 신규 세션 한계를 넘습니다.' },
    build: dualStack,
  },
  {
    id: 'dual-wan-shared-entry', name: '이중 WAN 공용 인입 경로',
    group: 'resilience',
    grade: { verdict: 'single-point', severs: 3 },
    summary: 'ISP와 edge router는 이중화됐지만 두 회선이 같은 건물 인입을 공유합니다.',
    teaches: 'ISP A 또는 ISP B 하나만 멈추면 남은 회선이 API 요청을 전달합니다. 하지만 두 회선이 같은 건물 인입을 지나면, 인입 하나의 장애가 두 ISP 경로를 함께 끊습니다. 링크가 두 개라는 사실보다 서로 무엇을 공유하는지가 복원력을 결정합니다.',
    tags: ['이중 WAN', 'ISP', '공용 인입', '경로 장애 도메인', '이중화 무효'],
    experiment: {
      prompt: '두 ISP가 같은 건물 인입을 공유하면 인입 하나의 장애 뒤에도 API가 전달될까요?',
      action: { type: 'fault-domain', id: 'shared-entry', label: '공용 건물 인입 장애 실험' },
      observe: '두 ISP 진입 링크가 함께 끊겨 API 요청 두 개가 모두 단절됩니다. 이 도구는 BGP 수렴 시간이나 회선 복구 시간을 계산하지 않고, 모델에 적은 공용 경로의 장애 영향만 계산합니다.',
    },
    build: dualWanSharedEntry,
  },
  {
    id: 'inline-lb', name: '인라인 로드밸런싱',
    group: 'balance',
    grade: { verdict: 'single-point', severs: 4 },
    summary: '요청과 응답이 모두 로드밸런서를 지나는 풀 프록시 구성입니다.',
    teaches: '로드밸런서가 양방향 바이트를 전부 부담해 처리량이 94%로 먼저 찹니다. 아래 DSR 구성과 같은 토폴로지이니 나란히 열어 비교하세요. 웹 서버 두 대는 로드밸런서가 묶은 한 백엔드 풀이라, 서버를 더 붙이면 demand를 손으로 나누지 않아도 부하가 나뉩니다.',
    tags: ['로드밸런서', '프록시', '처리량', 'DSR', '백엔드 풀'],
    experiment: { prompt: '웹 서버 한 대가 멈추면 남은 한 대가 다 받아낼 수 있을까요?', action: { type: 'fault-device', id: 'web-a', label: 'WEB 01 장애 실험' }, observe: '로드밸런서가 남은 한 대로 몰아 전달률은 100%입니다. 대역폭은 32%로 한가한데 신규 세션이 정확히 한계에 닿습니다.' },
    build: () => balancedFarm('inline'),
  },
  {
    id: 'dsr-farm', name: 'DSR 로드밸런싱',
    group: 'balance',
    grade: { verdict: 'single-point', severs: 4 },
    summary: '응답이 로드밸런서를 거치지 않고 서버에서 클라이언트로 직행합니다.',
    teaches: '같은 부하인데 로드밸런서 처리량이 9%로 떨어집니다. 응답 9할이 서버에서 EDGE로 직행해, 로드밸런서를 지나는 링크는 2%인데 되돌아오는 링크는 14%입니다. 연결 추적 부담은 그대로라 제한 축이 TLS 재개 핸드셰이크로 옮겨갑니다. 백엔드 분배는 인라인 구성과 같습니다.',
    tags: ['로드밸런서', 'DSR', 'TLS', '세션', '백엔드 풀'],
    experiment: {
      prompt: '부하가 20% 늘면 DSR 구성은 어디서 먼저 넘을까요?',
      action: { type: 'scale', value: 1.2, label: '배율 1.20배' },
      observe: '처리량은 여전히 한가한데 LB의 TLS 재개 핸드셰이크가 108%가 됩니다. 응답을 우회해도 연결 추적은 남습니다.',
    },
    build: () => balancedFarm('dsr'),
  },
  {
    id: 'raft-cluster', name: 'Raft 합의 클러스터',
    group: 'scale',
    grade: { verdict: 'single-point', severs: 5 },
    summary: '리더 한 대가 나머지 셋에 로그를 복제하고 수락 응답을 받는 4대 합의 클러스터입니다.',
    teaches: '리더의 패킷 처리량이 75%인데 팔로워는 15%입니다. 대역폭은 34%로 한가하니 합의는 바이트가 아니라 패킷 문제입니다. 링크를 보면 로그는 한쪽으로만 흐르는데 패킷 수는 양쪽이 같습니다. 어느 한 대를 잃어도 정족수 셋이 남아 클러스터는 이어집니다 — 리더를 잃으면 남은 셋 중 하나가 RAFT 01 자리의 숫자를 그대로 이어받고, 지금 비어 있는 팔로워 사이의 선이 그때 쓰입니다. 그래서 네 대의 사양이 같아야 합니다.',
    tags: ['Raft', '합의', '정족수', '블록체인', '복제', '패킷'],
    experiment: {
      prompt: '노드 한 대를 잃으면 원장은 멈출까요?',
      action: { type: 'fault-device', id: 'node-3', label: 'RAFT 03 장애 실험' },
      observe: '멈추지 않습니다. 넷의 정족수는 셋이라 한 대는 잃어도 섭니다. 리더는 복제할 곳이 하나 줄어 패킷 처리량이 60%로 내려갑니다. 두 대를 잃으면 그때 정족수가 무너집니다.',
    },
    build: raftCluster,
  },
  {
    id: 'three-tier', name: '3-tier 웹 서비스',
    group: 'basics',
    grade: { verdict: 'single-point', severs: 4 },
    summary: '웹·앱·데이터 계층을 직렬로 지나는 구성입니다.',
    teaches: '계층마다 보는 축이 다릅니다. 웹은 세션, 앱은 NIC 패킷, 데이터는 NIC 대역폭으로 판정됩니다.',
    tags: ['웹', '계층', '데이터베이스'],
    experiment: {
      prompt: '부하가 40% 늘면 세 계층 중 어디가 먼저 찰까요?',
      action: { type: 'scale', value: 1.4, label: '배율 1.40배' },
      observe: '웹의 세션도 앱의 패킷도 아닌 DB의 NIC 대역폭이 105%로 먼저 넘습니다.',
    },
    build: threeTier,
  },
  {
    id: 'spine-leaf', name: '스파인-리프 팹릭',
    group: 'basics',
    grade: { verdict: 'single-point', severs: 6 },
    summary: '스파인 2대와 리프 3대를 모두 연결한 클로스 구성입니다.',
    teaches: 'East-West 트래픽이 두 스파인으로 갈립니다. 스파인 하나를 끄면 남은 쪽이 전부 받는 것을 볼 수 있습니다.',
    tags: ['ECMP', '팹릭', '스위치', 'East-West'],
    experiment: {
      prompt: '스파인 한 대가 멈추면 남은 쪽이 얼마를 받을까요?',
      action: { type: 'fault-device', id: 'spine-a', label: 'SPINE A 장애 실험' },
      observe: '끊기는 것은 없습니다. 남은 스파인이 East-West 전부를 받아 패킷 처리량이 60%가 됩니다.',
    },
    build: spineLeaf,
  },
  {
    id: 'security-chain', name: '인라인 보안 체인',
    group: 'security',
    grade: { verdict: 'single-point', severs: 8 },
    summary: '방화벽과 WAF를 직렬로 지나는 구성입니다.',
    teaches: '대역폭이 아니라 WAF의 TLS 신규 핸드셰이크가 먼저 찹니다. 방화벽은 세션 동기화가 없어 장애 시 재수립 폭증이 계산됩니다.',
    tags: ['방화벽', 'WAF', 'TLS', '보안'],
    experiment: {
      prompt: '부하가 15% 늘면 체인의 어느 장비가 먼저 넘을까요?',
      action: { type: 'scale', value: 1.15, label: '배율 1.15배' },
      observe: '대역폭은 아직 한가한데 WAF의 TLS 신규 핸드셰이크가 105%가 됩니다.',
    },
    build: securityChain,
  },
  {
    id: 'remote-access', name: '원격 접속 VPN',
    group: 'security',
    grade: { verdict: 'single-point', severs: 10 },
    summary: '원격 근무자가 SSL VPN 게이트웨이를 지나 내부 자원에 닿는 구성입니다.',
    teaches: '대역폭과 세션은 절반도 안 찼는데 동시 VPN 터널이 먼저 한계에 닿습니다. VPN 장비는 바이트보다 터널 수로 규격이 정해집니다.',
    tags: ['VPN', 'SSL', '원격 근무', '터널'],
    experiment: {
      prompt: '접속자가 55% 늘면 무엇이 먼저 한계에 닿을까요?',
      action: { type: 'scale', value: 1.55, label: '배율 1.55배' },
      observe: '대역폭이 아니라 SSL VPN의 동시 세션이 104%가 됩니다. VPN 장비는 바이트보다 터널 수로 규격이 정해집니다.',
    },
    build: remoteAccess,
  },
  {
    id: 'branch-vpn', name: '지사 IPsec 연결',
    group: 'security',
    grade: { verdict: 'single-point', severs: 9 },
    summary: '지사를 WAN 회선과 IPsec 게이트웨이로 본사에 잇는 구성입니다.',
    teaches: '암호화 처리량이 회선보다 먼저 찹니다. 회선을 늘려도 게이트웨이를 바꾸지 않으면 그대로입니다.',
    tags: ['VPN', 'IPsec', '지사', '암호화'],
    experiment: {
      prompt: '지사 트래픽이 15% 늘면 회선과 게이트웨이 중 어디가 먼저 찰까요?',
      action: { type: 'scale', value: 1.15, label: '배율 1.15배' },
      observe: '회선이 아니라 IPsec 게이트웨이의 암호화 처리량이 106%가 됩니다. 회선을 늘려도 이 값은 그대로입니다.',
    },
    build: branchVpn,
  },
  {
    id: 'dmz', name: 'DMZ 이중 방화벽',
    group: 'security',
    grade: { verdict: 'single-point', severs: 7 },
    summary: '외부 방화벽과 내부 방화벽 사이에 DMZ를 둔 구성입니다.',
    teaches: '같은 트래픽이 방화벽 두 대를 지납니다. 용량이 작은 내부 방화벽이 먼저 찹니다.',
    tags: ['방화벽', 'DMZ', 'WAF', '보안'],
    experiment: {
      prompt: '부하가 25% 늘면 두 방화벽 중 어느 쪽이 먼저 넘을까요?',
      action: { type: 'scale', value: 1.25, label: '배율 1.25배' },
      observe: '같은 트래픽을 받지만 용량이 작은 내부 방화벽의 신규 세션이 108%가 됩니다.',
    },
    build: dmzTiers,
  },
  {
    id: 'hybrid-cloud', name: '하이브리드 클라우드 연결',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 7 },
    summary: '온프레미스와 클라우드를 WAN 회선으로 잇는 구성입니다.',
    teaches: '사이트 안은 넉넉한데 WAN 회선 하나가 전체를 결정합니다. 좁은 구간을 찾는 연습입니다.',
    tags: ['WAN', '클라우드', '회선', '하이브리드'],
    experiment: {
      prompt: '부하가 25% 늘면 사이트 안과 WAN 중 어디가 먼저 찰까요?',
      action: { type: 'scale', value: 1.25, label: '배율 1.25배' },
      observe: '사이트 안은 여유가 남는데 클라우드로 가는 회선이 106%가 됩니다. 좁은 구간 하나가 전체를 정합니다.',
    },
    build: hybridCloud,
  },
  {
    id: 'cdn-origin', name: 'CDN 오리진',
    group: 'balance',
    grade: { verdict: 'single-point', severs: 2 },
    summary: '엣지 캐시가 앞에 있고 미스만 오리진으로 가는 구성입니다.',
    teaches: '오리진으로 가는 양은 적은데 오리진의 신규 세션이 먼저 찹니다. 캐시 적중률이 왜 용량 문제인지 보여줍니다.',
    tags: ['CDN', '캐시', '오리진', '세션'],
    experiment: {
      prompt: '부하가 20% 늘면 엣지와 오리진 중 어디가 먼저 찰까요?',
      action: { type: 'scale', value: 1.2, label: '배율 1.20배' },
      observe: '오리진으로 가는 양은 적은데 오리진의 신규 세션이 108%가 됩니다. 캐시 적중률이 용량 문제인 이유입니다.',
    },
    build: cdnOrigin,
  },
  {
    id: 'microservices', name: 'East-West 마이크로서비스',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 7 },
    summary: '서비스끼리 서로 호출하는 다대다 구성입니다.',
    teaches: '작은 패킷이 아주 많습니다. 대역폭은 남는데 스위치의 패킷 처리량이 먼저 찹니다.',
    tags: ['마이크로서비스', 'East-West', 'PPS', '스위치'],
    experiment: { prompt: '대역폭을 많이 쓰지 않아도 스위치가 포화될 수 있을까요?', action: { type: 'scale', value: 1.25, label: '부하를 1.25배로' }, observe: '작은 패킷 수가 늘면서 forwarding_pps가 먼저 한계에 닿습니다.' },
    build: microservices,
  },
  {
    id: 'backup', name: '백업 네트워크',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 5 },
    summary: '야간 백업과 아카이브가 스토리지로 몰리는 구성입니다.',
    teaches: '세션은 몇 개 없는데 NIC 대역폭이 먼저 찹니다. 소수 대용량 플로우의 모습입니다.',
    tags: ['백업', '스토리지', 'NAS', '대역폭'],
    experiment: {
      prompt: '백업 양이 30% 늘면 무엇이 먼저 찰까요?',
      action: { type: 'scale', value: 1.3, label: '배율 1.30배' },
      observe: '세션은 몇 개 없는데 NAS의 NIC 대역폭이 104%가 됩니다. 소수 대용량 플로우의 모습입니다.',
    },
    build: backupNetwork,
  },
  {
    id: 'vdi', name: 'VDI 데스크톱 풀',
    group: 'balance',
    grade: { verdict: 'single-point', severs: 2 },
    summary: '가상 데스크톱을 브로커 뒤에 둔 구성입니다.',
    teaches: '데스크톱 세션은 오래 붙어 있습니다. 신규 세션보다 동시 세션이 먼저 찹니다.',
    tags: ['VDI', '가상화', '동시 세션', '브로커'],
    experiment: {
      prompt: '데스크톱이 15% 늘면 무엇이 먼저 한계에 닿을까요?',
      action: { type: 'scale', value: 1.15, label: '배율 1.15배' },
      observe: '신규 세션이 아니라 게이트웨이의 동시 세션이 105%가 됩니다. 데스크톱 세션은 오래 붙어 있습니다.',
    },
    build: vdiPool,
  },
  {
    id: 'payment', name: '결제 처리',
    group: 'security',
    grade: { verdict: 'single-point', severs: 2 },
    summary: 'WAF 뒤에 결제 애플리케이션과 원장을 둔 구성입니다.',
    teaches: '연결 재사용이 낮아 대역폭은 한가한데 TLS 신규 핸드셰이크가 먼저 찹니다.',
    tags: ['결제', 'TLS', 'WAF', '보안'],
    experiment: {
      prompt: '결제가 20% 늘면 어디가 먼저 넘을까요?',
      action: { type: 'scale', value: 1.2, label: '배율 1.20배' },
      observe: '대역폭은 한가한데 WAF의 TLS 신규 핸드셰이크가 108%가 됩니다. 연결 재사용이 낮기 때문입니다.',
    },
    build: paymentGateway,
  },
  {
    id: 'streaming', name: '스트리밍 배포',
    group: 'balance',
    grade: { verdict: 'single-point', severs: 2 },
    summary: '오리진에서 엣지를 거쳐 시청자로 내보내는 구성입니다.',
    teaches: '세션은 적고 바이트는 많습니다. 순수 대역폭이 병목인 드문 경우입니다.',
    tags: ['스트리밍', '대역폭', '엣지', 'CDN'],
    experiment: {
      prompt: '시청자가 25% 늘면 무엇이 먼저 찰까요?',
      action: { type: 'scale', value: 1.25, label: '배율 1.25배' },
      observe: '엣지의 순수 대역폭이 108%가 됩니다. 세션은 적고 바이트가 많은, 대역폭이 병목인 드문 경우입니다.',
    },
    build: streaming,
  },
  {
    id: 'iot', name: 'IoT 게이트웨이',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 2 },
    summary: '현장 센서를 게이트웨이로 모아 수집 플랫폼에 넣는 구성입니다.',
    teaches: '작은 패킷이 대량입니다. 대역폭은 9%인데 게이트웨이의 패킷 처리량이 먼저 찹니다.',
    tags: ['IoT', 'PPS', '게이트웨이', '센서'],
    experiment: {
      prompt: '장치가 15% 늘면 대역폭과 패킷 중 어디가 먼저 찰까요?',
      action: { type: 'scale', value: 1.15, label: '배율 1.15배' },
      observe: '대역폭은 여전히 10% 언저리인데 게이트웨이의 패킷 처리량이 107%가 됩니다. 작은 패킷이 대량입니다.',
    },
    build: iotGateway,
  },
  {
    id: 'disaster-recovery', name: '재해복구 이중 사이트',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 7 },
    summary: '주 사이트와 보조 사이트를 좁은 회선으로 잇고 복제하는 구성입니다.',
    teaches: '사이트 안은 넉넉한데 사이트 간 회선이 복제로 가득 찹니다.',
    tags: ['DR', '복제', '회선', '이중 사이트'],
    experiment: {
      prompt: '복제가 15% 늘면 사이트 안과 사이트 간 중 어디가 먼저 찰까요?',
      action: { type: 'scale', value: 1.15, label: '배율 1.15배' },
      observe: '사이트 안은 넉넉한데 사이트 간 회선이 109%가 됩니다.',
    },
    build: disasterRecovery,
  },
  {
    id: 'asym-wan', name: '비대칭 가입자 회선',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 4 },
    summary: '내려받기와 올려보내기의 용량이 다른 지사 회선입니다.',
    teaches: '같은 링크인데 방향마다 한계가 다릅니다. 이 회선은 내려받기 1 Gbps, 올려보내기 200 Mbps입니다. 부하가 네 배 작은 올려보내기 쪽이 먼저 85%에 닿습니다 — 야간 백업이 지사 회선을 죽이는 이유입니다. CARRIER는 외부망으로 선언했으므로 우리가 적어 준 대역폭 하나만 판정하고, 모르는 패킷 처리량은 0이 아니라 미확인으로 둡니다.',
    tags: ['회선', '방향', '업로드', 'WAN', '지사'],
    experiment: {
      prompt: '부하가 20% 늘면 이 회선의 어느 방향이 먼저 넘을까요?',
      action: { type: 'scale', value: 1.2, label: '배율 1.20배' },
      observe: '내려받기는 84%로 아직 여유가 있는데 같은 회선의 올려보내기가 102%로 넘칩니다. 회선 용량은 숫자 하나가 아닙니다.',
    },
    build: asymWan,
  },
  {
    id: 'service-sla', name: '서비스 수용 기준',
    group: 'evidence',
    grade: { verdict: 'partial' },
    summary: '장비 사용률이 아니라 선언한 서비스 기준으로 판정하는 구성입니다.',
    teaches: '이 설계는 경고선을 80%가 아니라 65%로 잡았고, 인터넷뱅킹을 수용 기준 99%, 웹 3대 중 2대 이상 살아 있을 것으로 선언했습니다. 그래서 판정을 장비가 아니라 서비스가 합니다. 장비가 101%로 빨개도 서비스는 통과일 수 있고, 배율을 1.6배까지 올려야 수용 기준이 무너집니다. 100%를 넘으면 곧 장애라는 말은 수용 기준을 정하지 않았을 때만 참입니다.',
    tags: ['서비스', '수용 기준', 'SLA', '경고선', '금융'],
    experiment: {
      prompt: 'WEB 01이 멈추면 이 서비스는 기준을 지킬까요?',
      action: { type: 'fault-device', id: 'web-1', label: 'WEB 01 장애 실험' },
      observe: '남은 WEB 두 대가 101%로 빨갛게 뜨는데 서비스 판정은 통과입니다. 초당 800건이 거절되지만 선언한 수용 기준 안이기 때문입니다.',
    },
    build: serviceSla,
  },
  {
    id: 'datasheet-perimeter', name: '데이터시트로 짠 경계',
    group: 'evidence',
    grade: { verdict: 'single-point', severs: 8 },
    summary: '카탈로그 데이터시트 값을 그대로 붙이고 우리 트래픽 조건과 대조하는 구성입니다.',
    teaches: '카탈로그에서 방화벽 두 대를 붙였습니다. 근거 레코드 8개 중 계산에 들어간 것은 1개입니다. 포티넷의 20 Gbps는 1518바이트 UDP에 기능을 켜지 않고 잰 값이고, 이 설계의 워크로드 조건이 그것과 같아서 씁니다. 팔로알토의 값은 App-ID와 로깅을 켠 조건에서 잰 것이라 조건이 맞지 않고, 두 장비의 세션 축은 데이터시트가 어떻게 쟀는지 밝히지 않아 미확인입니다. 왼쪽 워크로드 조건에서 프레임 크기를 64로 바꿔 보세요 — 지금 쓰는 20 Gbps가 조건 불일치로 바뀝니다.',
    tags: ['데이터시트', '근거', '측정 조건', '방화벽', '미확인'],
    experiment: {
      prompt: '부하가 40% 늘면 이 두 방화벽 중 무엇을 말할 수 있을까요?',
      action: { type: 'scale', value: 1.4, label: '배율 1.40배' },
      observe: '포티넷의 처리량이 98%까지 오르는 것이 보입니다. 같은 화면의 팔로알토는 배율을 아무리 올려도 사용률이 나오지 않습니다 — 그 값은 다른 조건에서 잰 것이라 이 설계에 쓸 수 있는지 아직 말할 수 없습니다.',
    },
    build: datasheetPerimeter,
  },
  {
    id: 'dc-pod', name: '데이터센터 POD',
    group: 'scale',
    grade: { verdict: 'single-point', severs: 16 },
    summary: '경계 2쌍과 4스파인·8리프 팹릭을 한 POD로 묶은 구성입니다.',
    teaches: '자원이 79개입니다. 어디가 병목인지 그림으로는 보이지 않습니다 — 팹릭은 20% 언저리인데 정작 꽉 찬 곳은 스토리지 랙 한 대의 NIC입니다. 장애 주입 탭에서 RACK 08 도메인 하나를 내려 보세요. 리프와 서버가 함께 죽어 백업 수요 네 개가 한꺼번에 끊깁니다 — 랙은 장비 한 대씩 죽지 않습니다. 단일 장애점이 16개나 잡히는 것도 서버가 리프 한 대에만 물려 있기 때문입니다.',
    tags: ['POD', 'Clos', '장애 도메인', '규모', '단일 홈'],
    experiment: {
      prompt: '스파인 한 대가 멈추면 이 POD에서 무엇이 달라질까요?',
      action: { type: 'fault-device', id: 'spine-1', label: 'SPINE 01 장애 실험' },
      observe: '끊기는 수요는 하나도 없습니다. 남은 스파인 셋이 27%로 오를 뿐이고, 이 설계에서 가장 꽉 찬 곳은 여전히 88%인 스토리지 NIC입니다. 굵은 곳이 병목이 아닙니다.',
    },
    build: dcPod,
  },
  {
    id: 'pool-and-path', name: '풀 추론과 강제 경로',
    group: 'balance',
    grade: { verdict: 'single-point', severs: 6 },
    summary: '도구가 대신 정해 주는 것과 내가 적어 줘야 하는 것을 한 화면에 둔 구성입니다.',
    teaches: '이 도구는 로드밸런서 뒤의 서버를 한 풀로 묶어 줍니다. 그런데 앞이 WAF면 묶지 않습니다 — 자동 추론은 앞단이 전부 로드밸런서일 때만 도는 규칙이라, 풀을 적지 않으면 WEB 01 한 대가 60%를 지고 나머지 둘은 0%로 남습니다. 그래서 이 설계는 풀을 손으로 적었습니다. 아래쪽 패치 배포는 반대로 한 대만 보게 묶었고, 최단 경로를 두고도 WAF를 반드시 지나도록 경로를 직접 적었습니다. 그래서 링크 OPS SW–WEB 01은 0%입니다. 도구가 정해 주는 것과 내가 정해야 하는 것의 경계가 여기입니다.',
    tags: ['백엔드 풀', '정책 경로', '추론', 'WAF', '패치 배포'],
    experiment: {
      prompt: 'WEB 02가 빠지면 풀은 어떻게 될까요?',
      action: { type: 'fault-device', id: 'web-2', label: 'WEB 02 장애 실험' },
      observe: '풀이 두 대로 줄어 남은 서버의 신규 세션이 114%가 됩니다. 풀을 손으로 적어 두지 않았다면 WEB 01 한 대만 부하를 지고 나머지 둘은 처음부터 놀고 있었을 것입니다.',
    },
    build: poolAndPath,
  },
  {
    id: 'clos-paths', name: '경로가 너무 많은 팹릭',
    group: 'scale',
    grade: { verdict: 'partial' },
    summary: '3단 Clos로 동서 경로가 열거 한계를 넘는 구성입니다.',
    teaches: '이 팹릭의 동서 경로는 80개입니다. 도구는 한 수요당 64개까지만 열거하고 거기서 멈추므로, 전달률을 판정 불가로 둡니다 — 다 세지 못한 것을 다 셌다고 말하지 않습니다. 그 증거가 T3-05입니다. 아무 장애도 없는데 0%로 보이는 것은 그 스위치가 노는 것이 아니라 계산이 거기까지 닿지 못한 것입니다. 미확인은 망이 아픈 것이 아니라 도구의 예산이 모자란 것입니다.',
    tags: ['Clos', '경로 열거', '판정 불가', 'ECMP', '팹릭'],
    experiment: {
      prompt: '스위치를 한 대 끄면 판정이 어떻게 달라질까요?',
      action: { type: 'fault-device', id: 't3-5', label: 'T3-05 장애 실험' },
      observe: '장비를 한 대 껐는데 판정이 판정 불가에서 정상으로 바뀝니다. 사용률은 어느 자원도 달라지지 않았습니다 — 경로가 80개에서 64개로 줄어 열거가 끝났을 뿐입니다.',
    },
    build: closPaths,
  },
  {
    id: 'rack-power', name: '랙 전력과 공간',
    group: 'capacity',
    grade: { verdict: 'single-point', severs: 7 },
    summary: '대역폭이 아니라 랙의 전력 예산이 먼저 차는 구성입니다.',
    teaches: '랙에 자리는 31U가 남았는데 전력 예산이 먼저 넘었습니다. 5,000W 예산에 typical 합계가 5,550W입니다. 네트워크 축은 전부 통과인데 전체 판정이 fail인 이유가 이것이고, 배율을 아무리 낮춰도 이 값은 바뀌지 않습니다 — 전력은 트래픽의 함수가 아닙니다. 그리고 nameplate과 typical은 더할 수 없습니다. 장비 하나가 랙과 다른 전력 기준을 선언하면 이 랙의 전력은 합계가 아니라 미확인이 됩니다.',
    tags: ['랙', '전력', 'U', '코로케이션', 'GPU', '2D 랙', '3D 랙', 'U 배치'],
    experiment: {
      prompt: '배율을 올리면 이 설계의 판정이 달라질까요?',
      action: { type: 'scale', value: 1.1, label: '배율 1.10배' },
      observe: 'NAS 대역폭이 99%까지 올라도 아직 넘지 않았는데 판정은 여전히 fail입니다. 넘은 것은 대역폭이 아니라 RACK 01의 전력 예산이고, 그 값은 배율을 따라가지 않습니다.',
    },
    build: rackPower,
  },
  {
    id: 'pdu-rails', name: 'A/B 전원 레일',
    group: 'resilience',
    grade: { verdict: 'single-point', severs: 5 },
    summary: 'A/B 두 레일로 급전하는데 스토리지만 한쪽 레일에 물린 구성입니다.',
    teaches: '논리 그림에서는 CORE A/B도 APP 01/02도 잘 나뉜 쌍입니다. 전원까지 나뉘었는지는 랙에서만 보입니다. 랙 툴바의 전원 도메인을 켜면 RACK 12 안에서 NAS만 A 레일 색이고 APP 02는 B 레일 색입니다. 그래서 A 레일이 죽으면 API A에 더해 야간 백업까지 함께 끊기고, B 레일이 죽으면 API B 하나만 끊깁니다. 같은 전원 한 대인데 피해가 두 배입니다. 전력도 같이 보세요. RACK 11은 자리가 33U 남았는데 전력은 210W만 남았습니다.',
    tags: ['전원 레일', 'A/B 급전', '전원 도메인', '랙', 'U 배치', '단일 급전'],
    experiment: {
      prompt: 'A 레일 하나가 멈추면 이중화한 이 설계에서 무엇이 끊길까요?',
      action: { type: 'fault-domain', id: 'rail-a', label: 'A 레일 장애 실험' },
      observe: 'API A와 야간 백업이 함께 끊깁니다. NAS가 A 레일에만 물려 있어 서비스 하나가 아니라 둘이 사라집니다. B 레일에 물린 API B는 그대로 전달되고 남은 경로는 25%로 한가합니다 — 끊은 것은 용량이 아니라 전원입니다.',
    },
    build: pduRails,
  },
  {
    id: 'ai-inference-pod', name: 'AI 추론 Pod',
    group: 'resilience',
    grade: { verdict: 'single-point', severs: 10 },
    summary: 'GPU 8대가 두 랙, 두 팹릭 plane, 랙별 PDU 하나에 배치된 추론 구성입니다.',
    teaches: '랙 배치에서 GPU 8대의 U 위치와 전력 예산을 확인하세요. 3D로 바꾼 뒤 장비 팔레트의 랙 전용 서버를 빈 U에 놓으면 U 공간과 전력 예산 변화를 볼 수 있습니다. 전원 도메인을 켜면 랙별 PDU가 담당하는 GPU 네 대가 보입니다. 랙 PDU 하나가 멈추면 GPU 네 대가 멈추지만 팹릭 plane 둘은 유지됩니다.',
    tags: ['AI 추론', 'GPU', '3D 랙', '이중 팹릭', 'PDU', 'U 배치'],
    experiment: {
      prompt: 'GPU RACK 21 PDU가 멈추면 두 랙과 두 팹릭 plane은 추론 요청을 얼마나 지킬까요?',
      action: { type: 'fault-domain', id: 'gpu-rail-a', label: 'GPU RACK 21 PDU 장애 실험' },
      observe: 'GPU 01부터 GPU 04까지 함께 멈춰 추론 요청 네 개가 단절됩니다. 이 모델은 NIC·팹릭·U·전력·선언한 전원 도메인만 계산합니다. GPU 연산 성능, 이중 PSU, 냉각은 계산하지 않습니다.',
    },
    build: aiInferencePod,
  },
  {
    id: 'blank', name: '빈 설계',
    group: 'blank',
    summary: '컴포넌트 탭에서 장비를 끌어다 직접 그립니다.',
    teaches: '',
    tags: ['빈 캔버스'],
    build: () => createEmptyTopology('Untitled topology'),
  },
];

export const buildTemplate = (id) => {
  const definition = templates.find((template) => template.id === id) || templates[0];
  const topology = definition.build();
  topology.synthetic = definition.id !== 'blank';
  const copy = (field, fallback) => localizedTemplate(definition.id, field, fallback);
  const experiment = definition.experiment ? { ...structuredClone(definition.experiment), prompt: copy('prompt', definition.experiment.prompt), observe: copy('observe', definition.experiment.observe), action: { ...definition.experiment.action, label: copy('action', definition.experiment.action.label) } } : null;
  topology.template = {
    id: definition.id, name: copy('name', definition.name), teaches: definition.teaches ? copy('teaches', definition.teaches) : '',
    ...(experiment ? { experiment } : {}),
  };
  return topology;
};
