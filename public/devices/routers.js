// 라우터 성능 프로필. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 라우터 표는 패킷 크기와 켜 둔 기능을 함께 바꾼다. C8300-2N2S-4T2X 는 1400바이트 순수
// IPv4 포워딩이 19.7 Gbps 이고, IPsec 에 QoS·DPI·FNF 까지 켠 IMIX(평균 352바이트)에서는
// 5.6 Gbps 다. 3.5 배 차이가 장비가 아니라 조건에서 온다.
//
// 데이터시트가 pps 를 적지 않으므로 패킷 축은 어느 프로필에서도 미확인이다.

const catalyst8300Source = {
  type: 'datasheet',
  label: 'Cisco Catalyst 8300 Series Edge Platforms Data Sheet',
  url: 'https://www.cisco.com/c/en/us/products/collateral/routers/catalyst-8300-series-edge-platforms/datasheet-c78-744088.html',
  locator: 'Table 3. SD-WAN IPsec throughput / Table 5. Autonomous mode performance',
  retrievedAt: '2026-09-06',
  note: 'IMIX is average packet size of 352 Bytes packet size.',
};

// 프로필 id 가 곧 측정 조건이다. 이 표는 패킷 크기와 켜 둔 기능을 함께 바꾸므로 그 둘을 구조로
// 옮긴다. IMIX 의 352바이트는 데이터시트 각주가 밝힌 평균값이다. pps 는 표에 없어 레코드도 없다.
const ROUTER_CONDITIONS = Object.freeze({
  'ipv4-1400b': { packet_size_bytes: 1400, features_enabled: [] },
  'ipsec-1400b': { packet_size_bytes: 1400, features_enabled: ['ipsec'] },
  'ipsec-imix': { packet_size_bytes: 352, test_method: 'imix', features_enabled: ['ipsec'] },
  'sdwan-iqdf-imix': { packet_size_bytes: 352, test_method: 'imix', features_enabled: ['dpi', 'fnf', 'ipsec', 'qos'] },
});

const routerProfile = (id, label, bps, note) => ({
  id, label, note, limits: { forwarding_bps: bps, forwarding_pps: null },
  axisConditions: { forwarding_bps: ROUTER_CONDITIONS[id] },
});

export const routerCatalog = Object.freeze([
  {
    id: 'cisco-catalyst-8300-2n2s-4t2x',
    vendor: 'Cisco',
    model: 'Catalyst 8300-2N2S-4T2X',
    kind: 'router',
    // 측정 조건을 구조로 옮기면 근거 digest 가 바뀐다. retrievedAt 은 데이터시트를 읽은 날이라
    // 고칠 수 없으므로, 카탈로그의 판을 따로 적어 저장된 프로젝트가 어느 판에서 왔는지 남긴다.
    revision: 'catalog-2026-09-07',
    source: catalyst8300Source,
    profiles: [
      routerProfile('ipv4-1400b', 'IPv4 포워딩 · 1400B', 19.7e9, '자율 모드의 순수 IPv4 포워딩입니다. 암호화도 검사도 없습니다.'),
      routerProfile('ipsec-1400b', 'IPsec · 1400B', 18.9e9, '자율 모드에서 IPsec 을 켠 큰 패킷 기준입니다.'),
      routerProfile('ipsec-imix', 'IPsec · IMIX', 9.3e9, '같은 IPsec 이지만 평균 352바이트 혼합 트래픽입니다. 패킷이 작아지는 것만으로 절반이 됩니다.'),
      routerProfile('sdwan-iqdf-imix', 'SD-WAN · IPsec+QoS+DPI+FNF · IMIX', 5.6e9,
        'SD-WAN 모드에서 IPsec, QoS, DPI, FNF 를 모두 켠 IMIX 값입니다. 맨 위 프로필의 3.5분의 1입니다.'),
    ],
  },
  {
    id: 'cisco-catalyst-8300-1n1s-4t2x',
    vendor: 'Cisco',
    model: 'Catalyst 8300-1N1S-4T2X',
    kind: 'router',
    // 측정 조건을 구조로 옮기면 근거 digest 가 바뀐다. retrievedAt 은 데이터시트를 읽은 날이라
    // 고칠 수 없으므로, 카탈로그의 판을 따로 적어 저장된 프로젝트가 어느 판에서 왔는지 남긴다.
    revision: 'catalog-2026-09-07',
    source: catalyst8300Source,
    profiles: [
      routerProfile('ipv4-1400b', 'IPv4 포워딩 · 1400B', 19.7e9, '자율 모드의 순수 IPv4 포워딩입니다.'),
      routerProfile('ipsec-1400b', 'IPsec · 1400B', 16.9e9, '자율 모드에서 IPsec 을 켠 큰 패킷 기준입니다.'),
      routerProfile('ipsec-imix', 'IPsec · IMIX', 6.6e9, '같은 IPsec 을 평균 352바이트 혼합 트래픽으로 잰 값입니다.'),
      routerProfile('sdwan-iqdf-imix', 'SD-WAN · IPsec+QoS+DPI+FNF · IMIX', 5.5e9,
        'SD-WAN 모드에서 IPsec, QoS, DPI, FNF 를 모두 켠 IMIX 값입니다.'),
    ],
  },
]);
