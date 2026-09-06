// 아키텍처 템플릿. 각 템플릿은 서로 다른 축이 먼저 차는 구성을 보여준다.
// PRD 5.3 은 프리셋 자체를 이 도구의 교육 콘텐츠로 규정한다.
import { cloneTopology } from './data.js';
import { addDemand, addDevice, addLink, createEmptyTopology } from './editor.js';

function place(topology, entries) {
  for (const [id, name, kind, zone, x, y, limits, behavior] of entries) {
    addDevice(topology, { id, name, kind, zone, position: { x, y }, limits, ...(behavior ? { behavior } : {}) });
  }
}

function connect(topology, pairs) {
  for (const [source, target, capacityBps] of pairs) addLink(topology, { source, target, capacityBps });
}

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
  for (const [id, target] of [['web-a-traffic', 'web-a'], ['web-b-traffic', 'web-b']]) {
    addDemand(topology, { id, name: `${target.toUpperCase()} 트래픽`, source: 'internet', target,
      load: { forwarding_bps: 4e9, new_sessions_per_sec: 20e3, concurrent_sessions: 400e3, tls_full_handshakes_per_sec: 2e3, tls_resumed_handshakes_per_sec: 18e3, nic_bps: 4e9 } });
    topology.demands.at(-1).directionality = { responseShare: 0.9, origin: 'estimate' };
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
  topology.haGroups = [
    { id: 'fw-pair', name: 'Perimeter firewalls', members: ['fw-a', 'fw-b'], sessionSync: 'none', reestablishWindowSec: 30 },
    { id: 'lb-pair', name: 'Load balancers', members: ['lb-a', 'lb-b'], sessionSync: 'stateful', reestablishWindowSec: 30 },
  ];
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
  return stackDemands(topology);
}

export const templates = [
  {
    id: 'dual-fabric', name: '이중 팹릭 API 클러스터',
    summary: 'ECMP 2경로에 방화벽과 리프 스위치를 둔 구성입니다.',
    teaches: '대역폭은 넉넉한데 방화벽의 신규 세션이 먼저 찹니다. 방화벽 하나를 끄면 남은 쪽이 두 배를 받습니다.',
    tags: ['ECMP', '방화벽', '세션', '이중화'],
    build: () => cloneTopology(),
  },
  {
    id: 'single-stack', name: '단일 경로 웹 서비스',
    summary: '방화벽과 로드밸런서를 각각 한 대로 세운 구성입니다.',
    teaches: '무장애일 때는 모든 축이 75%로 아래 이중화 구성과 똑같습니다. 방화벽 한 대가 죽는 순간 트래픽 전부가 끊깁니다. 둘을 나란히 열어 비교하세요. 웹 서버는 로드밸런서가 한 풀로 묶어 나눠 보내므로 한 대가 죽어도 끊기지는 않지만, 남은 쪽이 150%가 되어 전달률이 67%로 내려갑니다.',
    tags: ['단일 장애점', '이중화', '비교', '방화벽', '백엔드 풀'],
    experiment: { prompt: '방화벽 한 대가 멈추면 서비스가 얼마나 전달될까요?', action: { type: 'fault-device', id: 'fw', label: 'FW 장애 실험' }, observe: '경로가 사라져 두 demand가 모두 단절됩니다.' },
    build: singleStack,
  },
  {
    id: 'dual-stack', name: '이중화 웹 서비스',
    summary: '같은 부하를 같은 총용량으로 받되 절반짜리 장비 두 대로 나눈 구성입니다.',
    teaches: '방화벽 한 대가 죽어도 끊기지 않습니다. 대신 남은 쪽 대역폭이 150%가 되고, 세션 동기화가 없어 재수립 폭증까지 겹친 신규 세션은 178%가 됩니다. 이중화했다고 용량이 따라오는 것은 아닙니다. 웹 서버 쪽도 마찬가지로 한 대가 죽으면 풀이 흡수하지만 남은 쪽이 150%가 됩니다.',
    tags: ['이중화', '단일 장애점', '비교', 'ECMP', '백엔드 풀'],
    experiment: { prompt: 'FW A가 멈추면 연결은 유지되지만 남은 장비 용량도 충분할까요?', action: { type: 'fault-device', id: 'fw-a', label: 'FW A 장애 실험' }, observe: '트래픽은 FW B로 모이고 처리량과 신규 세션 한계를 넘습니다.' },
    build: dualStack,
  },
  {
    id: 'inline-lb', name: '인라인 로드밸런싱',
    summary: '요청과 응답이 모두 로드밸런서를 지나는 풀 프록시 구성입니다.',
    teaches: '로드밸런서가 양방향 바이트를 전부 부담해 처리량이 94%로 먼저 찹니다. 아래 DSR 구성과 같은 토폴로지이니 나란히 열어 비교하세요. 웹 서버 두 대는 로드밸런서가 묶은 한 백엔드 풀이라, 서버를 더 붙이면 demand를 손으로 나누지 않아도 부하가 나뉩니다.',
    tags: ['로드밸런서', '프록시', '처리량', 'DSR', '백엔드 풀'],
    experiment: { prompt: '웹 서버 한 대가 멈추면 남은 한 대가 다 받아낼 수 있을까요?', action: { type: 'fault-device', id: 'web-a', label: 'WEB 01 장애 실험' }, observe: '로드밸런서가 남은 한 대로 몰아 전달률은 100%입니다. 대역폭은 32%로 한가한데 신규 세션이 정확히 한계에 닿습니다.' },
    build: () => balancedFarm('inline'),
  },
  {
    id: 'dsr-farm', name: 'DSR 로드밸런싱',
    summary: '응답이 로드밸런서를 거치지 않고 서버에서 클라이언트로 직행합니다.',
    teaches: '같은 부하인데 로드밸런서 처리량이 9%로 떨어집니다. 연결 추적 부담은 그대로라 제한 축이 TLS 재개 핸드셰이크로 옮겨갑니다. 백엔드 풀은 인라인 구성과 똑같이 동작합니다 — 응답이 로드밸런서를 건너뛴다고 분배가 달라지지는 않습니다.',
    tags: ['로드밸런서', 'DSR', 'TLS', '세션', '백엔드 풀'],
    build: () => balancedFarm('dsr'),
  },
  {
    id: 'three-tier', name: '3-tier 웹 서비스',
    summary: '웹·앱·데이터 계층을 직렬로 지나는 구성입니다.',
    teaches: '계층마다 보는 축이 다릅니다. 웹은 세션, 앱은 NIC 패킷, 데이터는 NIC 대역폭으로 판정됩니다.',
    tags: ['웹', '계층', '데이터베이스'],
    build: threeTier,
  },
  {
    id: 'spine-leaf', name: '스파인-리프 팹릭',
    summary: '스파인 2대와 리프 3대를 모두 연결한 클로스 구성입니다.',
    teaches: 'East-West 트래픽이 두 스파인으로 갈립니다. 스파인 하나를 끄면 남은 쪽이 전부 받는 것을 볼 수 있습니다.',
    tags: ['ECMP', '팹릭', '스위치', 'East-West'],
    build: spineLeaf,
  },
  {
    id: 'security-chain', name: '인라인 보안 체인',
    summary: '방화벽과 WAF를 직렬로 지나는 구성입니다.',
    teaches: '대역폭이 아니라 WAF의 TLS 신규 핸드셰이크가 먼저 찹니다. 방화벽은 세션 동기화가 없어 장애 시 재수립 폭증이 계산됩니다.',
    tags: ['방화벽', 'WAF', 'TLS', '보안'],
    build: securityChain,
  },
  {
    id: 'remote-access', name: '원격 접속 VPN',
    summary: '원격 근무자가 SSL VPN 게이트웨이를 지나 내부 자원에 닿는 구성입니다.',
    teaches: '대역폭과 세션은 절반도 안 찼는데 동시 VPN 터널이 먼저 한계에 닿습니다. VPN 장비는 바이트보다 터널 수로 규격이 정해집니다.',
    tags: ['VPN', 'SSL', '원격 근무', '터널'],
    build: remoteAccess,
  },
  {
    id: 'branch-vpn', name: '지사 IPsec 연결',
    summary: '지사를 WAN 회선과 IPsec 게이트웨이로 본사에 잇는 구성입니다.',
    teaches: '암호화 처리량이 회선보다 먼저 찹니다. 회선을 늘려도 게이트웨이를 바꾸지 않으면 그대로입니다.',
    tags: ['VPN', 'IPsec', '지사', '암호화'],
    build: branchVpn,
  },
  {
    id: 'dmz', name: 'DMZ 이중 방화벽',
    summary: '외부 방화벽과 내부 방화벽 사이에 DMZ를 둔 구성입니다.',
    teaches: '같은 트래픽이 방화벽 두 대를 지납니다. 용량이 작은 내부 방화벽이 먼저 찹니다.',
    tags: ['방화벽', 'DMZ', 'WAF', '보안'],
    build: dmzTiers,
  },
  {
    id: 'hybrid-cloud', name: '하이브리드 클라우드 연결',
    summary: '온프레미스와 클라우드를 WAN 회선으로 잇는 구성입니다.',
    teaches: '사이트 안은 넉넉한데 WAN 회선 하나가 전체를 결정합니다. 좁은 구간을 찾는 연습입니다.',
    tags: ['WAN', '클라우드', '회선', '하이브리드'],
    build: hybridCloud,
  },
  {
    id: 'cdn-origin', name: 'CDN 오리진',
    summary: '엣지 캐시가 앞에 있고 미스만 오리진으로 가는 구성입니다.',
    teaches: '오리진으로 가는 양은 적은데 오리진의 신규 세션이 먼저 찹니다. 캐시 적중률이 왜 용량 문제인지 보여줍니다.',
    tags: ['CDN', '캐시', '오리진', '세션'],
    build: cdnOrigin,
  },
  {
    id: 'microservices', name: 'East-West 마이크로서비스',
    summary: '서비스끼리 서로 호출하는 다대다 구성입니다.',
    teaches: '작은 패킷이 아주 많습니다. 대역폭은 남는데 스위치의 패킷 처리량이 먼저 찹니다.',
    tags: ['마이크로서비스', 'East-West', 'PPS', '스위치'],
    experiment: { prompt: '대역폭을 많이 쓰지 않아도 스위치가 포화될 수 있을까요?', action: { type: 'scale', value: 1.25, label: '부하를 1.25배로' }, observe: '작은 패킷 수가 늘면서 forwarding_pps가 먼저 한계에 닿습니다.' },
    build: microservices,
  },
  {
    id: 'backup', name: '백업 네트워크',
    summary: '야간 백업과 아카이브가 스토리지로 몰리는 구성입니다.',
    teaches: '세션은 몇 개 없는데 NIC 대역폭이 먼저 찹니다. 소수 대용량 플로우의 모습입니다.',
    tags: ['백업', '스토리지', 'NAS', '대역폭'],
    build: backupNetwork,
  },
  {
    id: 'vdi', name: 'VDI 데스크톱 풀',
    summary: '가상 데스크톱을 브로커 뒤에 둔 구성입니다.',
    teaches: '데스크톱 세션은 오래 붙어 있습니다. 신규 세션보다 동시 세션이 먼저 찹니다.',
    tags: ['VDI', '가상화', '동시 세션', '브로커'],
    build: vdiPool,
  },
  {
    id: 'payment', name: '결제 처리',
    summary: 'WAF 뒤에 결제 애플리케이션과 원장을 둔 구성입니다.',
    teaches: '연결 재사용이 낮아 대역폭은 한가한데 TLS 신규 핸드셰이크가 먼저 찹니다.',
    tags: ['결제', 'TLS', 'WAF', '보안'],
    build: paymentGateway,
  },
  {
    id: 'streaming', name: '스트리밍 배포',
    summary: '오리진에서 엣지를 거쳐 시청자로 내보내는 구성입니다.',
    teaches: '세션은 적고 바이트는 많습니다. 순수 대역폭이 병목인 드문 경우입니다.',
    tags: ['스트리밍', '대역폭', '엣지', 'CDN'],
    build: streaming,
  },
  {
    id: 'iot', name: 'IoT 게이트웨이',
    summary: '현장 센서를 게이트웨이로 모아 수집 플랫폼에 넣는 구성입니다.',
    teaches: '작은 패킷이 대량입니다. 대역폭은 9%인데 게이트웨이의 패킷 처리량이 먼저 찹니다.',
    tags: ['IoT', 'PPS', '게이트웨이', '센서'],
    build: iotGateway,
  },
  {
    id: 'disaster-recovery', name: '재해복구 이중 사이트',
    summary: '주 사이트와 보조 사이트를 좁은 회선으로 잇고 복제하는 구성입니다.',
    teaches: '사이트 안은 넉넉한데 사이트 간 회선이 복제로 가득 찹니다.',
    tags: ['DR', '복제', '회선', '이중 사이트'],
    build: disasterRecovery,
  },
  {
    id: 'blank', name: '빈 설계',
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
  topology.template = {
    id: definition.id, name: definition.name, teaches: definition.teaches || '',
    ...(definition.experiment ? { experiment: structuredClone(definition.experiment) } : {}),
  };
  return topology;
};
