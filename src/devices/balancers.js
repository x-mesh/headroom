// 로드밸런서와 WAF. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 이 계층의 데이터시트는 축마다 계층을 바꾼다. F5 는 처리량을 "160 Gbps/80 Gbps L4/L7"
// 로 적고, 연결 수립과 동시 연결은 L4 기준으로만 싣는다. L7 로 프록시할 때의 연결 수립
// 능력은 어느 표에도 없다. 그래서 L7 프로필은 처리량만 말하고 나머지는 미확인이다.
//
// SSL 프로필의 처리량은 벌크 암호화 값이고, TPS 는 하드웨어 오프로드가 감당하는 신규
// 핸드셰이크다. 세션 재개(resumption) 수치는 F5 가 싣지 않으므로 그 축은 비운다.

const f5Source = {
  type: 'datasheet',
  label: 'F5 BIG-IP Platforms Data Sheet',
  url: 'https://www.f5.com/content/dam/f5/corp/global/pdf/products/big-ip-platforms-datasheet.pdf',
  locator: 'Specifications · Intelligent Traffic Processing / Hardware Offload SSL/TLS',
  retrievedAt: '2026-09-06',
  note: '*Maximum throughput. †ECDHE-ECDSA-AES128-SHA256 cipher string tested.',
};

// 이 표에서 조건이 구체적으로 적힌 것은 TLS 핸드셰이크의 키와 암호 스위트뿐이다. 처리량과
// 연결 수립은 어느 계층에서 쟀는지만 밝히고 패킷 크기를 말하지 않으므로 그 축은 미확인으로
// 남는다. 미확인의 이유를 적어 두는 것과 아무것도 적지 않는 것은 다르다 - 인스펙터가
// "측정 조건 없음" 대신 무엇이 비어 있는지를 보인다.
const BIGIP_CONDITIONS = Object.freeze({
  l4: {
    forwarding_bps: { test_method: 'l4', packet_size_bytes: 'unknown' },
    new_sessions_per_sec: { test_method: 'l4', packet_size_bytes: 'not_applicable' },
    concurrent_sessions: { test_method: 'l4', packet_size_bytes: 'not_applicable' },
  },
  l7: { forwarding_bps: { test_method: 'l7', packet_size_bytes: 'unknown' } },
  'ssl-rsa': {
    forwarding_bps: { test_method: 'bulk-crypto', packet_size_bytes: 'unknown', cipher: 'unknown' },
    tls_full_handshakes_per_sec: { cipher: 'rsa-2048', packet_size_bytes: 'not_applicable' },
  },
  'ssl-ecc': {
    // 벌크 처리량은 RSA 프로필과 같은 값이다. 어느 스위트로 쟀는지는 표가 말하지 않는다.
    forwarding_bps: { test_method: 'bulk-crypto', packet_size_bytes: 'unknown', cipher: 'unknown' },
    tls_full_handshakes_per_sec: { cipher: 'ECDHE-ECDSA-AES128-SHA256', packet_size_bytes: 'not_applicable' },
  },
});

function bigip({ id, model, l4Bps, l7Bps, cps, sessions, bulkBps, rsaTps, eccTps }) {
  return {
    id, vendor: 'F5', model, kind: 'lb',
    // 측정 조건을 구조로 옮기면 근거 digest 가 바뀐다. retrievedAt 은 데이터시트를 읽은 날이라
    // 고칠 수 없으므로, 카탈로그의 판을 따로 적어 저장된 프로젝트가 어느 판에서 왔는지 남긴다.
    revision: 'catalog-2026-09-07', source: f5Source,
    profiles: [
      { id: 'l4', axisConditions: BIGIP_CONDITIONS['l4'], label: 'L4 부하분산',
        note: '연결 수립과 동시 연결은 데이터시트가 L4 기준으로만 싣습니다. 이 프로필이 그 값입니다.',
        limits: { forwarding_bps: l4Bps, new_sessions_per_sec: cps, concurrent_sessions: sessions,
          tls_full_handshakes_per_sec: null, tls_resumed_handshakes_per_sec: null } },
      { id: 'l7', axisConditions: BIGIP_CONDITIONS['l7'], label: 'L7 프록시',
        note: 'L7 처리량만 표에 있습니다. L7 로 프록시할 때의 초당 연결 수립은 데이터시트가 말하지 않으므로 미확인으로 둡니다.',
        limits: { forwarding_bps: l7Bps, new_sessions_per_sec: null, concurrent_sessions: null,
          tls_full_handshakes_per_sec: null, tls_resumed_handshakes_per_sec: null } },
      { id: 'ssl-rsa', axisConditions: BIGIP_CONDITIONS['ssl-rsa'], label: 'SSL 오프로드 · RSA 2K',
        note: '처리량은 벌크 암호화 값이고, TPS 는 RSA 2048비트 키의 신규 핸드셰이크입니다. 재개 핸드셰이크 수치는 데이터시트에 없습니다.',
        limits: { forwarding_bps: bulkBps, new_sessions_per_sec: null, concurrent_sessions: null,
          tls_full_handshakes_per_sec: rsaTps, tls_resumed_handshakes_per_sec: null } },
      { id: 'ssl-ecc', axisConditions: BIGIP_CONDITIONS['ssl-ecc'], label: 'SSL 오프로드 · ECDSA P-256',
        note: 'ECDHE-ECDSA-AES128-SHA256 로 시험한 값입니다. 같은 장비가 RSA 보다 적은 핸드셰이크를 감당합니다.',
        limits: { forwarding_bps: bulkBps, new_sessions_per_sec: null, concurrent_sessions: null,
          tls_full_handshakes_per_sec: eccTps, tls_resumed_handshakes_per_sec: null } },
    ],
  };
}

const fortiwebSource = {
  type: 'datasheet',
  label: 'FortiWeb Data Sheet',
  url: 'https://www.fortinet.com/content/dam/fortinet/assets/data-sheets/FortiWeb.pdf',
  locator: 'System Performance',
  retrievedAt: '2026-09-06',
  note: 'All performance values are "up to" and vary depending on the system configuration.',
};

// FortiWeb 표는 처리량과 지연만 싣는다. 연결 수립·동시 세션·핸드셰이크는 어느 열에도 없다.
const fortiweb = (id, model, bps) => ({
  id, vendor: 'Fortinet', model, kind: 'waf', source: fortiwebSource,
  profiles: [
    { id: 'throughput', label: '데이터시트 처리량',
      note: '데이터시트의 System Performance 는 처리량과 지연(<5ms)만 싣습니다. 초당 연결, 동시 세션, TLS 핸드셰이크는 표에 없어 미확인으로 둡니다.',
      limits: { forwarding_bps: bps, new_sessions_per_sec: null, concurrent_sessions: null, tls_full_handshakes_per_sec: null } },
  ],
});

export const balancerCatalog = Object.freeze([
  bigip({ id: 'f5-big-ip-i5800', model: 'BIG-IP i5800', l4Bps: 60e9, l7Bps: 35e9, cps: 800e3, sessions: 40e6, bulkBps: 20e9, rsaTps: 35e3, eccTps: 20e3 }),
  bigip({ id: 'f5-big-ip-i7800', model: 'BIG-IP i7800', l4Bps: 80e9, l7Bps: 40e9, cps: 1.1e6, sessions: 80e6, bulkBps: 20e9, rsaTps: 40e3, eccTps: 25e3 }),
  bigip({ id: 'f5-big-ip-i10800', model: 'BIG-IP i10800', l4Bps: 160e9, l7Bps: 80e9, cps: 1.5e6, sessions: 100e6, bulkBps: 40e9, rsaTps: 80e3, eccTps: 48e3 }),
  fortiweb('fortinet-fortiweb-600f', 'FortiWeb 600F', 1e9),
  fortiweb('fortinet-fortiweb-1000f', 'FortiWeb 1000F', 2.5e9),
  fortiweb('fortinet-fortiweb-3000f', 'FortiWeb 3000F', 10e9),
  fortiweb('fortinet-fortiweb-4000f', 'FortiWeb 4000F', 70e9),
]);
