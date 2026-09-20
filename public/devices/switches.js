// 스위치 성능 프로필. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 스위치 표에는 함정이 하나 있다. 스위칭 용량과 포워딩 레이트의 기준이 서로 다르다.
// C9300-48T 는 256 Gbps 와 190.47 Mpps 를 나란히 적는데, 128 Gbps ÷ 672 bit(64바이트
// 프레임에 프리앰블과 IFG 포함) = 190.5 Mpps 다. 즉 용량은 양방향 합계이고 레이트는
// 단방향이다. 데이터시트는 그 차이를 말하지 않으므로 프로필 note 가 대신 말한다.
//
// 더 나쁜 것은 그 기준이 제조사마다 다르다는 점이다. 같은 "Tbps" 라는 글자가 아래 셋에서
// 서로 다른 것을 가리킨다.
//
//   Cisco Catalyst 9300-48T   256 Gbps   양방향 합계 (48x1G + 업링크의 두 배)
//   Cisco Nexus 93180YC-FX    3.6 Tbps   양방향 합계 (48x25G + 6x100G = 1.8 Tbps 편도)
//   Arista 7050DX4-32S        12.8 Tbps  편도 (32x400G), 괄호의 25.6 이 양방향 합계
//
// 이 도구는 장비를 지나는 편도 총량을 잰다. 그래서 Arista 의 표제 숫자는 그대로 쓸 수 있고
// Cisco 의 것은 기준이 어긋나 불일치로 뜬다 - 그것이 맞다. 축 하나씩 수락해서 쓸 수 있다.
// 조건을 지어내지 않는다: Arista 는 평균 패킷 289 B 라고 각주가 밝히므로 구조로 옮기고,
// Nexus 는 데이터시트가 말하지 않으므로 패킷 크기를 적지 않는다.

const cisco9300Source = {
  type: 'datasheet',
  label: 'Cisco Catalyst 9300 Series Data Sheet',
  url: 'https://www.cisco.com/c/en/us/products/collateral/switches/catalyst-9300-series-switches/nb-06-cat9300-ser-data-sheet-cte-en.html',
  locator: 'Table 9. Bandwidth specifications',
  retrievedAt: '2026-09-06',
  note: 'All models are at wire-speed nonblocking performance for both IPv4 and IPv6. The forwarding rates in the table above are measured with 64-byte IPv4 packet sizes.',
};

// 데이터시트가 밝힌 것만 구조로 옮긴다. 포워딩 레이트는 64바이트 IPv4 단방향이라고 원문이
// 적고 있고, 스위칭 용량은 패킷 크기로 재는 값이 아니라 양방향 합계다. 그래서 이 도구가 재는
// 단방향 통과량과 기준이 어긋나 불일치로 뜬다 - 그것이 맞다. 축 하나씩 수락해서 쓸 수 있다.
const switchConditions = Object.freeze({
  forwarding_bps: { packet_size_bytes: 'not_applicable', traffic_rate_scope: 'bidirectional-sum' },
  forwarding_pps: { packet_size_bytes: 64, traffic_rate_scope: 'unidirectional' },
});

const mixedBasisNote = '스위칭 용량은 양방향 합계이고 포워딩 레이트는 64바이트 단방향입니다. 이 도구는 장비를 지나는 총량을 재므로 패킷 축이 보수적으로 읽힙니다. 실측이 있으면 보정하세요.';

// Arista 는 재는 조건을 표 각주에 적는다. 이 프로젝트가 카탈로그에 바라는 그 모습이다.
const arista7050x4Source = {
  type: 'datasheet',
  label: 'Arista 7050X4 Series 100/200/400G Data Center Switches Data Sheet',
  url: 'https://www.arista.com/assets/data/pdf/Datasheets/7050X4-Datasheet.pdf',
  locator: 'Technical Specifications, Model Comparison table',
  retrievedAt: '2026-09-08',
  note: 'Throughput (FDX) is printed as "12.8 (25.6) Tbps"; footnote 3 reads "Performance figures based on average packet size of 289 B".',
};

const arista7050x4PhysicalSource = {
  label: 'Arista 7050X4 Series 100/200/400G Data Center Switches Data Sheet',
  locator: 'Technical Specifications, Model Comparison table, Typical/Max Power and Rack Units',
  note: 'Typical power is measured at 25C ambient with 50% load on all ports and excludes transceivers.',
};

// 표제 숫자가 편도라는 것은 포트 수로 확인된다: 32x400G = 12.8 Tbps, 48x25G + 4x400G = 2.8 Tbps.
// 괄호 안의 값이 양방향 합계다. 289 B 는 각주가 밝힌 성능 수치의 기준 패킷 크기이며, 5.3 Bpps x
// (289+20) B x 8 = 13.1 Tbps 로 표제 처리량과 맞아떨어져 두 축이 같은 기준에서 나온 것을 보여 준다.
const aristaConditions = Object.freeze({
  forwarding_bps: { packet_size_bytes: 289, traffic_rate_scope: 'unidirectional' },
  forwarding_pps: { packet_size_bytes: 289, traffic_rate_scope: 'unidirectional' },
});

const aristaNote = '데이터시트의 처리량은 편도 기준이고 괄호 안이 양방향 합계입니다. 성능 수치는 평균 패킷 289 B 에서 잰 값이라, 더 작은 패킷을 흘리면 패킷 축이 먼저 찹니다.';

// Nexus 는 모델 설명 문단에 용량과 레이트를 적을 뿐, 어떤 패킷 크기로 쟀는지 밝히지 않는다.
// 밝히지 않은 것을 구조로 옮기지 않는다 - 조건을 지어내면 근거가 아니라 장식이 된다.
const ciscoNexus9300fxSource = {
  type: 'datasheet',
  label: 'Cisco Nexus 9300-FX Series Switches Data Sheet',
  url: 'https://www.cisco.com/c/en/us/products/collateral/switches/nexus-9000-series-switches/datasheet-c78-742284.html',
  locator: 'Product overview, per-model description',
  retrievedAt: '2026-09-08',
  note: 'The datasheet states switching capacity and forwarding rate per model but does not state the packet size or duplex basis used to measure them.',
};

// 용량이 양방향 합계라는 것은 포트 수로 확인된다: 48x25G + 6x100G = 1.8 Tbps 편도, 표기는 3.6 Tbps.
// 패킷 축은 기준을 알 수 없으므로 조건을 붙이지 않는다.
const nexusConditions = Object.freeze({
  forwarding_bps: { packet_size_bytes: 'not_applicable', traffic_rate_scope: 'bidirectional-sum' },
});

const nexusNote = '스위칭 용량은 양방향 합계입니다(포트 수로 확인). 포워딩 레이트를 어떤 패킷 크기로 쟀는지는 데이터시트가 밝히지 않아 미확인으로 둡니다.';

export const switchCatalog = Object.freeze([
  {
    id: 'cisco-catalyst-9300-48t',
    vendor: 'Cisco',
    model: 'Catalyst 9300-48T',
    kind: 'switch',
    // 측정 조건을 구조로 옮기면 근거 digest 가 바뀐다. retrievedAt 은 데이터시트를 읽은 날이라
    // 고칠 수 없으므로, 카탈로그의 판을 따로 적어 저장된 프로젝트가 어느 판에서 왔는지 남긴다.
    revision: 'catalog-2026-09-07',
    source: cisco9300Source,
    profiles: [
      { id: 'standalone', label: '단독', note: mixedBasisNote, axisConditions: switchConditions,
        limits: { forwarding_bps: 256e9, forwarding_pps: 190.47e6 } },
      { id: 'stacked', label: '스택 구성', note: `스택으로 묶었을 때의 값입니다. ${mixedBasisNote}`, axisConditions: switchConditions,
        limits: { forwarding_bps: 736e9, forwarding_pps: 547.62e6 } },
    ],
  },
  {
    id: 'cisco-catalyst-9300x-48tx',
    vendor: 'Cisco',
    model: 'Catalyst 9300X-48TX',
    kind: 'switch',
    // 측정 조건을 구조로 옮기면 근거 digest 가 바뀐다. retrievedAt 은 데이터시트를 읽은 날이라
    // 고칠 수 없으므로, 카탈로그의 판을 따로 적어 저장된 프로젝트가 어느 판에서 왔는지 남긴다.
    revision: 'catalog-2026-09-07',
    source: cisco9300Source,
    profiles: [
      { id: 'standalone', label: '단독', note: mixedBasisNote, axisConditions: switchConditions,
        limits: { forwarding_bps: 1760e9, forwarding_pps: 1309e6 } },
      { id: 'stacked', label: '스택 구성', note: `스택으로 묶었을 때의 값입니다. ${mixedBasisNote}`, axisConditions: switchConditions,
        limits: { forwarding_bps: 2760e9, forwarding_pps: 2232e6 } },
    ],
  },
  // ── 스파인·리프급 ──────────────────────────────────────────────────────────
  // 설계는 스위치를 스파인과 리프로 쓰는데(dc-pod 12대, clos-paths 15대) 고를 수 있는 것은
  // 48포트 액세스 스위치뿐이었다. 역할에 맞는 물건을 고르지 못하면 카탈로그가 있으나 마나다.
  {
    id: 'arista-7050dx4-32s',
    vendor: 'Arista',
    model: '7050DX4-32S',
    kind: 'switch',
    revision: 'catalog-2026-09-08',
    source: arista7050x4Source,
    physical: { powerBasis: 'typical', typicalDrawWatts: 353, maximumDrawWatts: 880, uHeight: 1, source: arista7050x4PhysicalSource,
      frontPorts: { groups: [{ count: 32, speedBps: 400e9, form: 'qsfpdd' }] } },
    profiles: [
      { id: 'spine-400g', label: '스파인 · 32x400G', note: `1RU 에 400G 32 포트. ${aristaNote}`, axisConditions: aristaConditions,
        limits: { forwarding_bps: 12.8e12, forwarding_pps: 5.3e9 } },
      // 브레이크아웃으로 100G 128 포트가 되지만 총량은 같다. 포트 수가 늘어도 실리는 양은 그대로다.
      { id: 'spine-100g-breakout', label: '스파인 · 100G 128 포트 브레이크아웃', note: `400G 포트를 100G 넷으로 쪼갠 구성입니다. 포트 수는 늘지만 처리 총량은 같습니다. ${aristaNote}`, axisConditions: aristaConditions,
        limits: { forwarding_bps: 12.8e12, forwarding_pps: 5.3e9 } },
    ],
  },
  {
    id: 'arista-7050sdx4-48d8',
    vendor: 'Arista',
    model: '7050SDX4-48D8',
    kind: 'switch',
    revision: 'catalog-2026-09-08',
    source: arista7050x4Source,
    physical: { powerBasis: 'typical', typicalDrawWatts: 165, maximumDrawWatts: 520, uHeight: 1, source: arista7050x4PhysicalSource,
      frontPorts: { groups: [{ count: 48, speedBps: 100e9, form: 'qsfp28' }, { count: 8, speedBps: 400e9, form: 'qsfpdd' }] } },
    profiles: [
      { id: 'leaf-100g', label: '리프 · 48x100G + 8x400G', note: `100G 서버를 받는 ToR 입니다. ${aristaNote}`, axisConditions: aristaConditions,
        limits: { forwarding_bps: 8e12, forwarding_pps: 2.7e9 } },
    ],
  },
  {
    id: 'arista-7050x4-48y-4df',
    vendor: 'Arista',
    model: '7050X4-48Y-4DF',
    kind: 'switch',
    revision: 'catalog-2026-09-08',
    source: arista7050x4Source,
    physical: { powerBasis: 'typical', typicalDrawWatts: 120, maximumDrawWatts: 223, uHeight: 1, source: arista7050x4PhysicalSource,
      frontPorts: { groups: [{ count: 48, speedBps: 25e9, form: 'sfp28' }, { count: 4, speedBps: 400e9, form: 'qsfpdd' }] } },
    profiles: [
      { id: 'leaf-25g', label: '리프 · 48x25G + 4x400G', note: `25G 서버를 받고 400G 로 스파인에 올리는 ToR 입니다. ${aristaNote}`, axisConditions: aristaConditions,
        limits: { forwarding_bps: 2.8e12, forwarding_pps: 2.7e9 } },
    ],
  },
  {
    id: 'cisco-nexus-93180yc-fx',
    vendor: 'Cisco',
    model: 'Nexus 93180YC-FX',
    kind: 'switch',
    revision: 'catalog-2026-09-08',
    source: ciscoNexus9300fxSource,
    physical: { uHeight: 1, frontPorts: { groups: [{ count: 48, speedBps: 25e9, form: 'sfp28' }, { count: 6, speedBps: 100e9, form: 'qsfp28' }] } },
    profiles: [
      { id: 'leaf-25g', label: '리프 · 48x25G + 6x100G', note: nexusNote, axisConditions: nexusConditions,
        limits: { forwarding_bps: 3.6e12, forwarding_pps: 1.2e9 } },
    ],
  },
  {
    id: 'cisco-nexus-93108tc-fx',
    vendor: 'Cisco',
    model: 'Nexus 93108TC-FX',
    kind: 'switch',
    revision: 'catalog-2026-09-08',
    source: ciscoNexus9300fxSource,
    physical: { uHeight: 1, frontPorts: { groups: [{ count: 48, speedBps: 10e9, form: 'rj45' }, { count: 6, speedBps: 100e9, form: 'qsfp28' }] } },
    // 데이터시트가 "over 1.25bpps" 라고 적는다. 하한이므로 그 값을 그대로 쓰고 note 가 하한임을 말한다.
    profiles: [
      { id: 'leaf-10gt', label: '리프 · 48x10GBASE-T + 6x100G', note: `포워딩 레이트는 데이터시트가 "over 1.25 bpps" 라고 적은 하한입니다. ${nexusNote}`, axisConditions: nexusConditions,
        limits: { forwarding_bps: 2.16e12, forwarding_pps: 1.25e9 } },
    ],
  },
]);
