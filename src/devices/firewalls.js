// 방화벽 성능 프로필. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 데이터시트 한 장이 같은 축에 조건이 다른 값을 여러 개 준다. FortiGate 100F 는 방화벽만
// 켜면 20 Gbps 이고 위협 방어를 전부 켜면 1 Gbps 다. 20 배 차이가 전부 조건에서 온다.
// 그래서 값 하나를 고르지 않고 조건째로 담는다.
//
// 프로필이 적지 않은 축은 null 이다. 데이터시트가 말하지 않은 것을 보간하지 않는다(PRD 5.3).
// 예를 들어 IPS 를 켠 상태의 신규 세션 수는 어느 데이터시트에도 없다.

/** @typedef {{ id: string, label: string, note: string, limits: Record<string, number|null> }} Profile */

const fortinetFootnotes = {
  upTo: 'All performance values are "up to" and vary depending on system configuration.',
  enterpriseMix: 'IPS (Enterprise Mix), Application Control, NGFW and Threat Protection are measured with Logging enabled.',
  ngfw: 'NGFW performance is measured with Firewall, IPS and Application Control enabled.',
  threat: 'Threat Protection performance is measured with Firewall, IPS, Application Control and Malware Protection enabled.',
};

// 데이터시트가 프로필별로 밝히지 않는 축은 그 프로필에서 미확인이다.
const inspectionProfile = (id, label, bps, note) => ({
  id, label, note,
  limits: { forwarding_bps: bps, forwarding_pps: null, new_sessions_per_sec: null, concurrent_sessions: null },
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
        limits: { forwarding_bps: 20e9, forwarding_pps: 15e6, new_sessions_per_sec: 56e3, concurrent_sessions: 1.5e6 } },
      { id: 'fw-64', label: '방화벽만 · 64B',
        note: '같은 표의 64바이트 값입니다. 작은 패킷이 많은 트래픽은 이쪽에 가깝습니다.',
        limits: { forwarding_bps: 10e9, forwarding_pps: 15e6, new_sessions_per_sec: 56e3, concurrent_sessions: 1.5e6 } },
      inspectionProfile('ips', 'IPS 켬', 2.6e9, fortinetFootnotes.enterpriseMix),
      inspectionProfile('ngfw', 'NGFW', 1.6e9, fortinetFootnotes.ngfw),
      inspectionProfile('threat', '위협 방어 전체', 1e9, fortinetFootnotes.threat),
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
        limits: { forwarding_bps: 198e9, forwarding_pps: 201e6, new_sessions_per_sec: 650e3, concurrent_sessions: 7.5e6 } },
      { id: 'fw-64', label: '방화벽만 · 64B',
        note: '같은 표의 64바이트 값입니다.',
        limits: { forwarding_bps: 134e9, forwarding_pps: 201e6, new_sessions_per_sec: 650e3, concurrent_sessions: 7.5e6 } },
      inspectionProfile('ips', 'IPS 켬', 19e9, fortinetFootnotes.enterpriseMix),
      inspectionProfile('ngfw', 'NGFW', 15e9, fortinetFootnotes.ngfw),
      inspectionProfile('threat', '위협 방어 전체', 13e9, fortinetFootnotes.threat),
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
        limits: { forwarding_bps: 198e9, forwarding_pps: 210e6, new_sessions_per_sec: 750e3, concurrent_sessions: 12e6 } },
      { id: 'fw-64', label: '방화벽만 · 64B',
        note: '같은 표의 64바이트 값입니다.',
        limits: { forwarding_bps: 140e9, forwarding_pps: 210e6, new_sessions_per_sec: 750e3, concurrent_sessions: 12e6 } },
      { id: 'fw-hyperscale', label: '방화벽만 · Hyperscale 라이선스',
        note: '데이터시트가 별표로 적은 값입니다. Hyperscale Firewall License 가 있어야 합니다.',
        limits: { forwarding_bps: 198e9, forwarding_pps: 210e6, new_sessions_per_sec: 2e6, concurrent_sessions: 40e6 } },
      inspectionProfile('ips', 'IPS 켬', 22e9, fortinetFootnotes.enterpriseMix),
      inspectionProfile('ngfw', 'NGFW', 17e9, fortinetFootnotes.ngfw),
      inspectionProfile('threat', '위협 방어 전체', 15e9, fortinetFootnotes.threat),
    ],
  },
]);

export const deviceCatalog = firewallCatalog;

export function catalogEntry(id) {
  return deviceCatalog.find((entry) => entry.id === id) || null;
}

export function catalogProfile(entryId, profileId) {
  const entry = catalogEntry(entryId);
  if (!entry) return null;
  return entry.profiles.find((profile) => profile.id === profileId) || entry.profiles[0];
}
