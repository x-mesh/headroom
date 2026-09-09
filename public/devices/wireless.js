// 무선 액세스 포인트 카탈로그. 제품 식별 정보는 등록하지만, 서로 다른 무선 조건의
// PHY 속도와 실제 처리량을 섞지 않는다. 조건을 검증하기 전까지 성능 축은 미확인으로 둔다.

const wirelessSource = (vendor, model, url, locator) => ({
  type: 'datasheet',
  label: `${vendor} ${model} 제품 사양`,
  url,
  locator,
  retrievedAt: '2026-09-09',
  note: '무선 대역, 채널 폭, 공간 스트림과 시험 조건이 서로 달라 데이터시트의 PHY 속도를 실제 처리량으로 환산하지 않았습니다.',
});

const accessPoint = ({ id, vendor, model, url, locator }) => ({
  id, vendor, model, kind: 'wireless',
  revision: 'catalog-2026-09-09',
  source: wirelessSource(vendor, model, url, locator),
  profiles: [{
    id: 'default',
    label: '성능 조건 미지정',
    note: '무선 조건별 실제 처리량과 동시 클라이언트 한계를 확인하기 전까지 미확인으로 둡니다.',
    limits: { forwarding_bps: null, forwarding_pps: null, concurrent_sessions: null },
  }],
});

export const wirelessCatalog = Object.freeze([
  accessPoint({
    id: 'cisco-catalyst-9130axi',
    vendor: 'Cisco',
    model: 'Catalyst 9130AXI',
    url: 'https://www.cisco.com/site/us/en/products/networking/wireless/catalyst-9100-series-access-points/index.html',
    locator: 'Catalyst 9100 Series Access Points · Catalyst 9130AXI',
  }),
  accessPoint({
    id: 'aruba-ap-635',
    vendor: 'Aruba',
    model: 'AP-635',
    url: 'https://www.arubanetworks.com/products/wireless/access-points/indoor-access-points/630-series/',
    locator: '630 Series Campus Access Points · AP-635',
  }),
  accessPoint({
    id: 'ruckus-r760',
    vendor: 'Ruckus',
    model: 'R760',
    url: 'https://www.commscope.com/product-type/enterprise-networking/wireless-access-points/indoor-access-points/r760/',
    locator: 'R760 Wi-Fi 6E indoor access point',
  }),
]);
