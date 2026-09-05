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
  topology.haGroups = [{ id: 'lb-pair', name: 'Load balancers', members: ['lb'], sessionSync: 'stateful', reestablishWindowSec: 30 }];
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
  topology.haGroups = [{ id: 'fw-pair', name: 'Perimeter firewalls', members: ['fw'], sessionSync: 'none', reestablishWindowSec: 30 }];
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
    ['db', 'DB', 'storage', 'DATA TIER', 870, 290, { nic_bps: 8e9, nic_pps: null }],
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

export const templates = [
  {
    id: 'dual-fabric', name: '이중 팹릭 API 클러스터',
    summary: 'ECMP 2경로에 방화벽과 리프 스위치를 둔 구성입니다.',
    teaches: '대역폭은 넉넉한데 방화벽의 신규 세션이 먼저 찹니다. 방화벽 하나를 끄면 남은 쪽이 두 배를 받습니다.',
    build: () => cloneTopology(),
  },
  {
    id: 'inline-lb', name: '인라인 로드밸런싱',
    summary: '요청과 응답이 모두 로드밸런서를 지나는 풀 프록시 구성입니다.',
    teaches: '로드밸런서가 양방향 바이트를 전부 부담해 처리량이 94%로 먼저 찹니다. 아래 DSR 구성과 같은 토폴로지이니 나란히 열어 비교하세요.',
    build: () => balancedFarm('inline'),
  },
  {
    id: 'dsr-farm', name: 'DSR 로드밸런싱',
    summary: '응답이 로드밸런서를 거치지 않고 서버에서 클라이언트로 직행합니다.',
    teaches: '같은 부하인데 로드밸런서 처리량이 9%로 떨어집니다. 연결 추적 부담은 그대로라 제한 축이 TLS 재개 핸드셰이크로 옮겨갑니다.',
    build: () => balancedFarm('dsr'),
  },
  {
    id: 'three-tier', name: '3-tier 웹 서비스',
    summary: '웹·앱·데이터 계층을 직렬로 지나는 구성입니다.',
    teaches: '계층마다 보는 축이 다릅니다. 웹은 세션, 앱은 NIC 패킷, 데이터는 NIC 대역폭으로 판정됩니다.',
    build: threeTier,
  },
  {
    id: 'spine-leaf', name: '스파인-리프 팹릭',
    summary: '스파인 2대와 리프 3대를 모두 연결한 클로스 구성입니다.',
    teaches: 'East-West 트래픽이 두 스파인으로 갈립니다. 스파인 하나를 끄면 남은 쪽이 전부 받는 것을 볼 수 있습니다.',
    build: spineLeaf,
  },
  {
    id: 'security-chain', name: '인라인 보안 체인',
    summary: '방화벽과 WAF를 직렬로 지나는 구성입니다.',
    teaches: '대역폭이 아니라 WAF의 TLS 신규 핸드셰이크가 먼저 찹니다. 방화벽은 세션 동기화가 없어 장애 시 재수립 폭증이 계산됩니다.',
    build: securityChain,
  },
  {
    id: 'blank', name: '빈 설계',
    summary: '컴포넌트 탭에서 장비를 끌어다 직접 그립니다.',
    teaches: '',
    build: () => createEmptyTopology('Untitled topology'),
  },
];

export const buildTemplate = (id) => (templates.find((template) => template.id === id) || templates[0]).build();
