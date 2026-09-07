// 방화벽 성능 프로필. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 데이터시트 한 장이 같은 축에 조건이 다른 값을 여러 개 준다. FortiGate 100F 는 방화벽만
// 켜면 20 Gbps 이고 위협 방어를 전부 켜면 1 Gbps 다. 20 배 차이가 전부 조건에서 온다.
// 그래서 값 하나를 고르지 않고 조건째로 담는다.
//
// 프로필이 적지 않은 축은 null 이다. 데이터시트가 말하지 않은 것을 보간하지 않는다(PRD 5.3).
// 예를 들어 IPS 를 켠 상태의 신규 세션 수는 어느 데이터시트에도 없다.

/** @typedef {{ id: string, label: string, note: string, limits: Record<string, number|null>, axisConditions?: Record<string, object> }} Profile */

// 축마다 측정 조건이 다르다. 데이터시트 한 표 안에서도 처리량은 프레임 크기로, 신규 세션은
// 트랜잭션 종류로 잰다. 그래서 조건을 프로필이 아니라 축에 붙인다(PRD v0.6 P1-27).
//
// 값은 세 가지뿐이다(v0.5 7.2). 구체값, 'unknown'(데이터시트가 밝히지 않음),
// 'not_applicable'(이 축에 그 조건이 성립하지 않음). 여기 적힌 것은 전부 각 프로필의 note 와
// source.note 가 이미 말하는 내용이며, 데이터시트가 말하지 않은 것은 'unknown' 으로 남긴다.
const UNKNOWN = 'unknown';
const NA = 'not_applicable';

// 처리량은 프레임 크기와 전송 계층으로, 세션 축은 트랜잭션으로 잰다. 세션 수에 프레임 크기는 없다.
const throughputAt = (bytes, transport, features) => ({ packet_size_bytes: bytes, transport, features_enabled: features });
const sessionAxis = (features, test = UNKNOWN) => ({ packet_size_bytes: NA, test_method: test, features_enabled: features });

const fortinetFootnotes = {
  upTo: 'All performance values are "up to" and vary depending on system configuration.',
  enterpriseMix: 'IPS (Enterprise Mix), Application Control, NGFW and Threat Protection are measured with Logging enabled.',
  ngfw: 'NGFW performance is measured with Firewall, IPS and Application Control enabled.',
  threat: 'Threat Protection performance is measured with Firewall, IPS, Application Control and Malware Protection enabled.',
};

// 데이터시트가 프로필별로 밝히지 않는 축은 그 프로필에서 미확인이다.
const inspectionProfile = (id, label, bps, note, features = [], test = UNKNOWN) => ({
  id, label, note,
  limits: { forwarding_bps: bps, forwarding_pps: null, new_sessions_per_sec: null, concurrent_sessions: null },
  axisConditions: { forwarding_bps: { packet_size_bytes: UNKNOWN, test_method: test, features_enabled: features } },
});

// 포티넷 "방화벽만" 프로필. 처리량만 프레임 크기가 붙고 나머지 셋은 데이터시트가 조건을 밝히지 않는다.
const fortinetFirewallOnly = (bytes) => ({
  forwarding_bps: throughputAt(bytes, 'udp', []),
  forwarding_pps: { packet_size_bytes: UNKNOWN, transport: UNKNOWN, features_enabled: [] },
  new_sessions_per_sec: sessionAxis([]),
  concurrent_sessions: sessionAxis([]),
});

const FORTINET_IPS = ['ips', 'logging'];
const FORTINET_NGFW = ['ips', 'application-control', 'logging'];
const FORTINET_THREAT = ['ips', 'application-control', 'malware-protection', 'logging'];
const ENTERPRISE_MIX = 'enterprise-traffic-mix';

// 팔로알토 표는 축마다 다른 트랜잭션으로 잰다. note 가 그 사실을 이미 적고 있다.
const PALO_ALTO_THREAT = ['app-id', 'ips', 'antivirus', 'anti-spyware', 'wildfire', 'file-blocking', 'logging'];
const paloAltoAppMix = {
  forwarding_bps: { packet_size_bytes: UNKNOWN, test_method: 'appmix', features_enabled: ['app-id', 'logging'] },
  forwarding_pps: { packet_size_bytes: UNKNOWN, test_method: UNKNOWN, features_enabled: UNKNOWN },
  new_sessions_per_sec: sessionAxis([], 'application-override-1byte-http'),
  concurrent_sessions: sessionAxis(UNKNOWN, 'http-transactions'),
};

// 시스코는 같은 하드웨어에 운영 소프트웨어가 성능을 바꾼다. 그것이 조건이다.
const CISCO_FTD_AVC = ['ftd', 'avc'];
const CISCO_ASA = ['asa', 'stateful-inspection'];
const ciscoAxes = (bytes, features) => ({
  forwarding_bps: { packet_size_bytes: bytes, transport: UNKNOWN, features_enabled: features },
  forwarding_pps: { packet_size_bytes: UNKNOWN, transport: UNKNOWN, features_enabled: features },
  new_sessions_per_sec: sessionAxis(features),
  concurrent_sessions: sessionAxis(features),
});

export const firewallCatalog = Object.freeze([
  {
    id: 'fortinet-fortigate-100f',
    vendor: 'Fortinet',
    model: 'FortiGate 100F',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'FortiGate 100F 시리즈 데이터시트',
      url: 'https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/ko_kr/ds-fortigate-100f-series_ko.pdf',
      locator: '시스템 성능 및 용량 / 시스템 성능 — 엔터프라이즈 트래픽 믹스',
      retrievedAt: '2026-09-06',
      note: fortinetFootnotes.upTo,
    },
    profiles: [
      { id: 'fw-1518', label: '방화벽만 · 1518B',
        note: 'IPv4 방화벽 처리량 20/18/10 Gbps (1518/512/64바이트, UDP) 중 1518바이트 값입니다.',
        limits: { forwarding_bps: 20e9, forwarding_pps: 15e6, new_sessions_per_sec: 56e3, concurrent_sessions: 1.5e6 },
        axisConditions: fortinetFirewallOnly(1518) },
      { id: 'fw-64', label: '방화벽만 · 64B',
        note: '같은 표의 64바이트 값입니다. 작은 패킷이 많은 트래픽은 이쪽에 가깝습니다.',
        limits: { forwarding_bps: 10e9, forwarding_pps: 15e6, new_sessions_per_sec: 56e3, concurrent_sessions: 1.5e6 },
        axisConditions: fortinetFirewallOnly(64) },
      inspectionProfile('ips', 'IPS 켬', 2.6e9, fortinetFootnotes.enterpriseMix, FORTINET_IPS, ENTERPRISE_MIX),
      inspectionProfile('ngfw', 'NGFW', 1.6e9, fortinetFootnotes.ngfw, FORTINET_NGFW, ENTERPRISE_MIX),
      inspectionProfile('threat', '위협 방어 전체', 1e9, fortinetFootnotes.threat, FORTINET_THREAT, ENTERPRISE_MIX),
    ],
  },
  {
    id: 'fortinet-fortigate-1000f',
    vendor: 'Fortinet',
    model: 'FortiGate 1000F',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'FortiGate 1000F Series Data Sheet',
      url: 'https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/pdf/fortigate-1000f-series.pdf',
      locator: 'System Performance and Capacity / System Performance — Enterprise Traffic Mix',
      retrievedAt: '2026-09-06',
      note: fortinetFootnotes.upTo,
    },
    profiles: [
      { id: 'fw-1518', label: '방화벽만 · 1518B',
        note: 'IPv4 Firewall Throughput 198 / 196 / 134 Gbps (1518 / 512 / 64 byte, UDP) 중 1518바이트 값입니다.',
        limits: { forwarding_bps: 198e9, forwarding_pps: 201e6, new_sessions_per_sec: 650e3, concurrent_sessions: 7.5e6 },
        axisConditions: fortinetFirewallOnly(1518) },
      { id: 'fw-64', label: '방화벽만 · 64B',
        note: '같은 표의 64바이트 값입니다.',
        limits: { forwarding_bps: 134e9, forwarding_pps: 201e6, new_sessions_per_sec: 650e3, concurrent_sessions: 7.5e6 },
        axisConditions: fortinetFirewallOnly(64) },
      inspectionProfile('ips', 'IPS 켬', 19e9, fortinetFootnotes.enterpriseMix, FORTINET_IPS, ENTERPRISE_MIX),
      inspectionProfile('ngfw', 'NGFW', 15e9, fortinetFootnotes.ngfw, FORTINET_NGFW, ENTERPRISE_MIX),
      inspectionProfile('threat', '위협 방어 전체', 13e9, fortinetFootnotes.threat, FORTINET_THREAT, ENTERPRISE_MIX),
    ],
  },
  {
    id: 'fortinet-fortigate-1800f',
    vendor: 'Fortinet',
    model: 'FortiGate 1800F',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'FortiGate 1800F Series Data Sheet',
      url: 'https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/fortigate-1800f-series.pdf',
      locator: 'System Performance and Capacity / System Performance — Enterprise Traffic Mix',
      retrievedAt: '2026-09-06',
      note: fortinetFootnotes.upTo,
    },
    profiles: [
      { id: 'fw-1518', label: '방화벽만 · 1518B',
        note: 'IPv4 Firewall Throughput 198 / 197 / 140 Gbps (1518 / 512 / 64 byte, UDP) 중 1518바이트 값입니다.',
        limits: { forwarding_bps: 198e9, forwarding_pps: 210e6, new_sessions_per_sec: 750e3, concurrent_sessions: 12e6 },
        axisConditions: fortinetFirewallOnly(1518) },
      { id: 'fw-64', label: '방화벽만 · 64B',
        note: '같은 표의 64바이트 값입니다.',
        limits: { forwarding_bps: 140e9, forwarding_pps: 210e6, new_sessions_per_sec: 750e3, concurrent_sessions: 12e6 },
        axisConditions: fortinetFirewallOnly(64) },
      { id: 'fw-hyperscale', label: '방화벽만 · Hyperscale 라이선스',
        note: '데이터시트가 별표로 적은 값입니다. Hyperscale Firewall License 가 있어야 합니다.',
        limits: { forwarding_bps: 198e9, forwarding_pps: 210e6, new_sessions_per_sec: 2e6, concurrent_sessions: 40e6 },
        axisConditions: fortinetFirewallOnly(1518) },
      inspectionProfile('ips', 'IPS 켬', 22e9, fortinetFootnotes.enterpriseMix, FORTINET_IPS, ENTERPRISE_MIX),
      inspectionProfile('ngfw', 'NGFW', 17e9, fortinetFootnotes.ngfw, FORTINET_NGFW, ENTERPRISE_MIX),
      inspectionProfile('threat', '위협 방어 전체', 15e9, fortinetFootnotes.threat, FORTINET_THREAT, ENTERPRISE_MIX),
    ],
  },
  {
    id: 'paloalto-pa-3410',
    vendor: 'Palo Alto Networks',
    model: 'PA-3410',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'PA-3400 Series Datasheet',
      url: 'https://www.paloaltonetworks.com/content/dam/pan/en_US/assets/pdf/datasheets/pa-3400/pa-3400-series.pdf',
      locator: 'Table 1. PA-3400 Series Performance and Capacities',
      retrievedAt: '2026-09-06',
      note: 'Results were measured on PAN-OS 12.1.',
    },
    profiles: [
      { id: 'firewall-appmix', label: '방화벽 · App-ID 켬',
        note: '처리량은 App-ID 와 로깅을 켠 appmix 트랜잭션 기준입니다. 이 표의 축은 조건이 서로 다릅니다 — 신규 세션은 application override 상태의 1바이트 HTTP, 동시 세션은 HTTP 트랜잭션으로 잽니다. 포티넷의 "방화벽만" 값과 나란히 두면 안 됩니다.',
        limits: { forwarding_bps: 14e9, forwarding_pps: null, new_sessions_per_sec: 145e3, concurrent_sessions: 1.4e6 },
        axisConditions: paloAltoAppMix },
      inspectionProfile('threat-prevention', '위협 방지 켬', 7.5e9,
        'App-ID, IPS, 안티바이러스, 안티스파이웨어, WildFire, 파일 차단, 로깅을 모두 켠 appmix 기준입니다.', PALO_ALTO_THREAT, 'appmix'),
    ],
  },
  {
    id: 'paloalto-pa-3440',
    vendor: 'Palo Alto Networks',
    model: 'PA-3440',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'PA-3400 Series Datasheet',
      url: 'https://www.paloaltonetworks.com/content/dam/pan/en_US/assets/pdf/datasheets/pa-3400/pa-3400-series.pdf',
      locator: 'Table 1. PA-3400 Series Performance and Capacities',
      retrievedAt: '2026-09-06',
      note: 'Results were measured on PAN-OS 12.1.',
    },
    profiles: [
      { id: 'firewall-appmix', label: '방화벽 · App-ID 켬',
        note: '처리량은 App-ID 와 로깅을 켠 appmix 트랜잭션 기준입니다. 신규 세션은 application override 상태의 1바이트 HTTP 로 잰 값이라 조건이 다릅니다.',
        limits: { forwarding_bps: 35e9, forwarding_pps: null, new_sessions_per_sec: 268e3, concurrent_sessions: 3e6 },
        axisConditions: paloAltoAppMix },
      inspectionProfile('threat-prevention', '위협 방지 켬', 20e9,
        'App-ID, IPS, 안티바이러스, 안티스파이웨어, WildFire, 파일 차단, 로깅을 모두 켠 appmix 기준입니다.', PALO_ALTO_THREAT, 'appmix'),
    ],
  },
  {
    id: 'cisco-secure-firewall-3105',
    vendor: 'Cisco',
    model: 'Secure Firewall 3105',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'Cisco Secure Firewall 3100 Series Data Sheet',
      url: 'https://www.cisco.com/c/en/us/products/collateral/security/firewalls/secure-firewall-3100-series-ds.html',
      locator: 'Threat Defense (FTD) 및 ASA 성능 표',
      retrievedAt: '2026-09-06',
      note: 'Performance will vary depending on features activated, and network traffic protocol mix, and packet size characteristics.',
    },
    profiles: [
      { id: 'ftd-avc', label: 'FTD · AVC 켬',
        note: '1024바이트 기준입니다. 같은 하드웨어라도 운영 소프트웨어가 성능을 바꿉니다 — 아래 ASA 프로필과 견주어 보세요.',
        limits: { forwarding_bps: 10e9, forwarding_pps: null, new_sessions_per_sec: 90e3, concurrent_sessions: 1.5e6 },
        axisConditions: ciscoAxes(1024, CISCO_FTD_AVC) },
      { id: 'asa-stateful', label: 'ASA · 상태 검사만',
        note: 'ASA 소프트웨어의 상태 검사 기준입니다. 신규 연결이 FTD·AVC 의 90,000 에서 150,000 으로 올라갑니다. 검사를 덜 하기 때문입니다.',
        limits: { forwarding_bps: 10e9, forwarding_pps: null, new_sessions_per_sec: 150e3, concurrent_sessions: 1.5e6 },
        axisConditions: ciscoAxes(UNKNOWN, CISCO_ASA) },
      inspectionProfile('ftd-avc-ips', 'FTD · AVC + IPS', 10e9, '1024바이트 기준. 이 표에서는 AVC 단독과 같은 처리량으로 적혀 있습니다.', [...CISCO_FTD_AVC, 'ips']),
    ],
  },
  {
    id: 'cisco-secure-firewall-3140',
    vendor: 'Cisco',
    model: 'Secure Firewall 3140',
    kind: 'firewall',
    source: {
      type: 'datasheet',
      label: 'Cisco Secure Firewall 3100 Series Data Sheet',
      url: 'https://www.cisco.com/c/en/us/products/collateral/security/firewalls/secure-firewall-3100-series-ds.html',
      locator: 'Threat Defense (FTD) 및 ASA 성능 표',
      retrievedAt: '2026-09-06',
      note: 'Performance will vary depending on features activated, and network traffic protocol mix, and packet size characteristics.',
    },
    profiles: [
      { id: 'ftd-avc', label: 'FTD · AVC 켬',
        note: '1024바이트 기준입니다. 아래 ASA 프로필과 신규 연결이 3.7배 차이 납니다.',
        limits: { forwarding_bps: 45e9, forwarding_pps: null, new_sessions_per_sec: 300e3, concurrent_sessions: 10e6 },
        axisConditions: ciscoAxes(1024, CISCO_FTD_AVC) },
      { id: 'asa-stateful', label: 'ASA · 상태 검사만',
        note: 'ASA 상태 검사 기준. 신규 연결 1,100,000 은 같은 장비의 FTD·AVC 값 300,000 의 3.7배입니다. 하드웨어가 아니라 무엇을 검사하느냐가 정합니다.',
        limits: { forwarding_bps: 49e9, forwarding_pps: null, new_sessions_per_sec: 1.1e6, concurrent_sessions: 10e6 },
        axisConditions: ciscoAxes(UNKNOWN, CISCO_ASA) },
      inspectionProfile('asa-multiprotocol', 'ASA · 멀티프로토콜', 43e9, '단일 프로토콜이 아닌 혼합 트래픽 기준입니다.', CISCO_ASA, 'multiprotocol-mix'),
    ],
  },
]);
