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

function dsrFarm() {
  const topology = createEmptyTopology('DSR 로드밸런싱');
  topology.haGroups = [{ id: 'lb-pair', name: 'Load balancers', members: ['lb'], sessionSync: 'stateful', reestablishWindowSec: 30 }];
  place(topology, [
    ['internet', 'INTERNET', 'cloud', 'EDGE', 110, 290, { forwarding_bps: 40e9, forwarding_pps: 8e6 }],
    ['edge', 'EDGE', 'router', 'EDGE', 300, 290, { forwarding_bps: 20e9, forwarding_pps: 4e6 }],
    ['lb', 'LB', 'lb', 'SERVICE', 500, 290,
      { forwarding_bps: 8.5e9, new_sessions_per_sec: 60e3, concurrent_sessions: 1.2e6, tls_full_handshakes_per_sec: 5e3, tls_resumed_handshakes_per_sec: 40e3 },
      { mode: 'inline', sessionSync: 'unknown' }],
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

export const templates = [
  {
    id: 'dual-fabric', name: '이중 팹릭 API 클러스터',
    summary: 'ECMP 2경로에 방화벽과 리프 스위치를 둔 구성입니다.',
    teaches: '대역폭은 넉넉한데 방화벽의 신규 세션이 먼저 찹니다. 방화벽 하나를 끄면 남은 쪽이 두 배를 받습니다.',
    build: () => cloneTopology(),
  },
  {
    id: 'dsr-farm', name: 'DSR 로드밸런싱',
    summary: '로드밸런서 뒤에 웹 서버를 둔 구성입니다. 동작 모드를 바꿔 볼 수 있습니다.',
    teaches: 'DSR로 바꾸면 응답이 로드밸런서를 우회해 처리량 부담이 사라지지만 연결 추적 부담은 남습니다. 제한 축이 처리량에서 TLS와 세션으로 넘어갑니다.',
    build: dsrFarm,
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
