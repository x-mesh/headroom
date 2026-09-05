export const axisCatalog = {
  forwarding_bps: { label: '처리량', shortLabel: 'BPS', unit: 'bps', nodeLabel: 'BPS', deliveryRole: 'throughput' },
  forwarding_pps: { label: '패킷 처리량', shortLabel: 'PPS', unit: 'pps', nodeLabel: 'PPS', deliveryRole: 'throughput' },
  new_sessions_per_sec: { label: '신규 세션', shortLabel: 'CPS', unit: 'cps', nodeLabel: 'CPS', deliveryRole: 'admission' },
  concurrent_sessions: { label: '동시 세션', shortLabel: 'SESS', unit: 'sessions', nodeLabel: 'SESS', deliveryRole: 'admission' },
  vpn_tunnels: { label: '동시 VPN 터널', shortLabel: 'VPN', unit: 'tunnels', nodeLabel: 'VPN', deliveryRole: 'admission' },
  nic_bps: { label: 'NIC 처리량', shortLabel: 'NIC', unit: 'bps', nodeLabel: 'NIC', deliveryRole: 'throughput' },
  nic_pps: { label: 'NIC 패킷', shortLabel: 'NIC PPS', unit: 'pps', nodeLabel: 'NPPS', deliveryRole: 'throughput' },
  tls_full_handshakes_per_sec: { label: 'TLS 신규 핸드셰이크', shortLabel: 'TLS FULL', unit: 'tps', nodeLabel: 'TLSF', deliveryRole: 'admission' },
  tls_resumed_handshakes_per_sec: { label: 'TLS 재개 핸드셰이크', shortLabel: 'TLS RSMD', unit: 'tps', nodeLabel: 'TLSR', deliveryRole: 'admission' },
};

// 응답이 볼류메트릭 부하에서 차지하는 몫. 웹 워크로드는 응답이 대부분이다.
export const DEFAULT_RESPONSE_SHARE = 0.9;

// kind 는 검증 없는 자유 문자열이므로 화이트리스트가 필요하다. 이 표를 통과한 조합만
// 엔진과 DOM 에 들어간다. affectsLoad 가 false 인 모드는 바이트를 바꾸지 않는다고 스스로
// 선언한다. 없는 숫자 차이를 지어내지 않기 위한 것이다.
export const behaviorCatalog = {
  lb: {
    label: '동작 모드', affectsLoad: true, default: 'inline',
    options: {
      inline: {
        label: 'inline (풀 프록시)', token: 'INLINE', carries: { request: true, response: true },
        note: '요청과 응답이 모두 로드밸런서를 지납니다. 양방향 바이트를 전부 부담합니다.',
      },
      dsr: {
        label: 'DSR (직접 반환)', token: 'DSR', carries: { request: true, response: false },
        note: '응답은 서버에서 클라이언트로 직행합니다. 처리량 부담은 사라지고 연결 추적 부담은 그대로 남습니다.',
      },
    },
  },
  firewall: {
    label: '배치 모드', affectsLoad: false, default: 'routed',
    options: {
      routed: {
        label: 'routed (L3)', token: 'L3', carries: { request: true, response: true },
        note: 'L3 홉으로 동작합니다. 지나는 바이트는 transparent 와 같습니다.',
      },
      transparent: {
        label: 'transparent (L2)', token: 'L2', carries: { request: true, response: true },
        note: 'bump-in-the-wire 로 동작합니다. 세션 소유와 장애 도메인만 달라집니다.',
      },
    },
  },
};

// 세션 축을 갖는 클래스. 페일오버 두 갈래 계산의 대상이다.
export const STATEFUL_KINDS = new Set(['firewall', 'lb', 'vpn', 'sslvpn', 'ips', 'waf']);

const source = {
  type: 'estimate',
  label: '합성 데모 값',
  condition: 'Rack Mesh MVP fixture · 기능 비활성 · 정상 상태',
};

const device = (id, name, kind, zone, x, y, limits) => ({
  id, name, kind, zone, position: { x, y }, limits, source, enabled: true,
});

const link = (id, sourceId, targetId, capacityBps = 10e9) => ({
  id, source: sourceId, target: targetId, capacity: { forwarding_bps: capacityBps }, enabled: true,
});

export const demoTopology = {
  schemaVersion: 1,
  name: 'Dual fabric API cluster',
  synthetic: true,
  warningThreshold: 0.8,
  haGroups: [
    { id: 'fw-pair', name: 'Perimeter firewalls', members: ['fw-a', 'fw-b'], sessionSync: 'stateful', reestablishWindowSec: 30 },
    { id: 'edge-pair', name: 'Edge routers', members: ['edge-a', 'edge-b'], sessionSync: 'stateful' },
  ],
  devices: [
    device('edge-a', 'EDGE A', 'router', 'EDGE', 110, 115, { forwarding_bps: 10e9, forwarding_pps: 2.4e6 }),
    device('edge-b', 'EDGE B', 'router', 'EDGE', 110, 430, { forwarding_bps: 10e9, forwarding_pps: 2.4e6 }),
    device('fw-a', 'FW A', 'firewall', 'SECURITY', 300, 115, { forwarding_bps: 10e9, forwarding_pps: 1.5e6, new_sessions_per_sec: 42e3, concurrent_sessions: 700e3 }),
    device('fw-b', 'FW B', 'firewall', 'SECURITY', 300, 430, { forwarding_bps: 10e9, forwarding_pps: 1.5e6, new_sessions_per_sec: 42e3, concurrent_sessions: 700e3 }),
    device('spine-a', 'SPINE A', 'switch', 'FABRIC', 490, 175, { forwarding_bps: 20e9, forwarding_pps: 3.2e6 }),
    device('spine-b', 'SPINE B', 'switch', 'FABRIC', 490, 405, { forwarding_bps: 20e9, forwarding_pps: 3.2e6 }),
    device('leaf-a', 'LEAF A', 'switch', 'RACK 04', 675, 175, { forwarding_bps: 12e9, forwarding_pps: 2.4e6 }),
    device('leaf-b', 'LEAF B', 'switch', 'RACK 07', 675, 405, { forwarding_bps: 12e9, forwarding_pps: 2.4e6 }),
    device('api-a', 'API 01', 'server', 'RACK 04', 840, 175, { nic_bps: 12e9, nic_pps: null }),
    device('api-b', 'API 02', 'server', 'RACK 07', 840, 405, { nic_bps: 12e9, nic_pps: null }),
  ],
  links: [
    link('edge-a-fw-a', 'edge-a', 'fw-a'),
    link('edge-b-fw-b', 'edge-b', 'fw-b'),
    link('fw-a-spine-a', 'fw-a', 'spine-a'),
    link('fw-b-spine-b', 'fw-b', 'spine-b'),
    link('spine-a-leaf-a', 'spine-a', 'leaf-a'),
    link('spine-b-leaf-a', 'spine-b', 'leaf-a'),
    link('spine-a-leaf-b', 'spine-a', 'leaf-b'),
    link('spine-b-leaf-b', 'spine-b', 'leaf-b'),
    link('leaf-a-api-a', 'leaf-a', 'api-a'),
    link('leaf-b-api-b', 'leaf-b', 'api-b'),
  ],
  demands: [
    {
      id: 'public-api',
      name: 'Public API',
      load: { forwarding_bps: 7.2e9, forwarding_pps: 1.1e6, new_sessions_per_sec: 72e3, concurrent_sessions: 800e3, nic_bps: 7.2e9, nic_pps: 1.1e6 },
      paths: [
        { id: 'public-a', devices: ['edge-a', 'fw-a', 'spine-a', 'leaf-a', 'api-a'], links: ['edge-a-fw-a', 'fw-a-spine-a', 'spine-a-leaf-a', 'leaf-a-api-a'] },
        { id: 'public-b', devices: ['edge-b', 'fw-b', 'spine-b', 'leaf-b', 'api-b'], links: ['edge-b-fw-b', 'fw-b-spine-b', 'spine-b-leaf-b', 'leaf-b-api-b'] },
      ],
    },
    {
      id: 'east-west',
      name: 'East–West sync',
      load: { forwarding_bps: 5e9, forwarding_pps: 620e3, new_sessions_per_sec: 4e3, concurrent_sessions: 90e3, nic_bps: 5e9, nic_pps: 620e3 },
      paths: [
        { id: 'sync-a', devices: ['api-a', 'leaf-a', 'spine-a', 'leaf-b', 'api-b'], links: ['leaf-a-api-a', 'spine-a-leaf-a', 'spine-a-leaf-b', 'leaf-b-api-b'] },
        { id: 'sync-b', devices: ['api-a', 'leaf-a', 'spine-b', 'leaf-b', 'api-b'], links: ['leaf-a-api-a', 'spine-b-leaf-a', 'spine-b-leaf-b', 'leaf-b-api-b'] },
      ],
    },
  ],
};

export function cloneTopology(topology = demoTopology) {
  return structuredClone(topology);
}
