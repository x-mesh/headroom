// 스위치 성능 프로필. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 스위치 표에는 함정이 하나 있다. 스위칭 용량과 포워딩 레이트의 기준이 서로 다르다.
// C9300-48T 는 256 Gbps 와 190.47 Mpps 를 나란히 적는데, 128 Gbps ÷ 672 bit(64바이트
// 프레임에 프리앰블과 IFG 포함) = 190.5 Mpps 다. 즉 용량은 양방향 합계이고 레이트는
// 단방향이다. 데이터시트는 그 차이를 말하지 않으므로 프로필 note 가 대신 말한다.

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
]);
