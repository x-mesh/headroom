// 서버·스토리지의 네트워크 한계를 정하는 어댑터. 엔진은 이 파일을 모른다.
//
// 서버 스펙 시트는 NIC 처리량을 적지 않는다. Dell PowerEdge R760 시트는 "2 x 1 GbE LOM
// card (optional)"과 "1 x OCP card 3.0 (optional)"까지만 말하고, 실제 속도는 꽂는 카드가
// 정한다. 그래서 서버 모델이 아니라 어댑터를 담는다. 노드 이름은 사용자가 붙이고
// (API 01), 그 노드의 한계는 여기서 고른 카드가 정한다.
//
// bps 는 포트 속도의 합이다. pps 는 64바이트 프레임 라인레이트에서 파생한다 — 프레임
// 84바이트에 프리앰블과 IFG 를 더한 672비트로 나눈 값이며, PRD 9절이 검증 기준으로 삼는
// 산식이다. 어느 NIC 데이터시트도 pps 를 싣지 않으므로 이 파생을 note 에 밝힌다.

const FRAME_BITS_64B = 672;
const lineRatePps = (bps) => Math.round(bps / FRAME_BITS_64B);

// 어댑터는 어느 엔드포인트에나 꽂힌다. 클래스 하나에 묶지 않는다.
const ENDPOINT_KINDS = ['server', 'web', 'vm', 'db', 'mail', 'mainframe', 'storage', 'nas', 'backup', 'client'];

function adapter({ id, vendor, model, url, locator, ports }) {
  return {
    id, vendor, model, kinds: ENDPOINT_KINDS,
    source: {
      type: 'datasheet', label: `${vendor} ${model} 제품 사양`, url, locator,
      retrievedAt: '2026-09-06',
      note: '포트 구성은 제품 사양이고, 초당 패킷은 64바이트 라인레이트에서 파생한 값입니다.',
    },
    profiles: ports.map(({ id: profileId, label, count, speed }) => {
      const bps = count * speed;
      return {
        id: profileId, label,
        note: `${count} × ${speed / 1e9}GbE = ${bps / 1e9} Gbps. 초당 패킷 ${(lineRatePps(bps) / 1e6).toFixed(2)} Mpps 는 64바이트 프레임 라인레이트에서 파생했습니다(프리앰블과 IFG 포함 672비트). 큰 패킷이 흐르면 실제 패킷 수는 이보다 훨씬 적습니다.`,
        limits: { nic_bps: bps, nic_pps: lineRatePps(bps) },
      };
    }),
  };
}

export const adapterCatalog = Object.freeze([
  adapter({
    id: 'intel-e810-cqda2', vendor: 'Intel', model: 'E810-CQDA2',
    url: 'https://www.intel.com/content/www/us/en/products/sku/192558/intel-ethernet-network-adapter-e810cqda2/specifications.html',
    locator: '제품 사양 · 포트 구성',
    ports: [
      { id: 'single', label: '1포트 사용', count: 1, speed: 100e9 },
      { id: 'dual', label: '2포트 사용', count: 2, speed: 100e9 },
    ],
  }),
  adapter({
    id: 'intel-e810-xxvda4', vendor: 'Intel', model: 'E810-XXVDA4',
    url: 'https://www.intel.com/content/www/us/en/products/sku/192561/intel-ethernet-network-adapter-e810xxvda4/specifications.html',
    locator: '제품 사양 · 포트 구성',
    ports: [
      { id: 'dual', label: '2포트 사용', count: 2, speed: 25e9 },
      { id: 'quad', label: '4포트 사용', count: 4, speed: 25e9 },
    ],
  }),
  adapter({
    id: 'broadcom-bcm57414', vendor: 'Broadcom', model: 'BCM57414',
    url: 'https://www.broadcom.com/products/ethernet-connectivity/network-adapters/25gb-nic-ocp/n1100g',
    locator: '제품 사양 · 포트 구성',
    ports: [
      { id: 'single', label: '1포트 사용', count: 1, speed: 25e9 },
      { id: 'dual', label: '2포트 사용', count: 2, speed: 25e9 },
    ],
  }),
  adapter({
    id: 'nvidia-connectx-6-dx', vendor: 'NVIDIA', model: 'ConnectX-6 Dx',
    url: 'https://www.nvidia.com/en-us/networking/ethernet/connectx-6-dx/',
    locator: '제품 사양 · 포트 구성',
    ports: [
      { id: 'single-100', label: '1포트 · 100GbE', count: 1, speed: 100e9 },
      { id: 'dual-100', label: '2포트 · 100GbE', count: 2, speed: 100e9 },
      { id: 'single-25', label: '1포트 · 25GbE', count: 1, speed: 25e9 },
    ],
  }),
]);
