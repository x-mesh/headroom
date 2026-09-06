// 스토리지 어플라이언스. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 어플라이언스는 서버와 달리 포트 구성을 데이터시트에 못박는다. FS6400 은 온보드로
// 2×10GbE 와 2×1GbE 를 싣고 PCIe 슬롯 두 개에 10/25/40GbE 카드를 더할 수 있다.
// 그래서 프로필은 "무엇을 꽂았는가"다.
//
// 데이터시트가 싣는 성능 수치는 iSCSI 4K 랜덤 쓰기 IOPS 이고, 이 도구의 축(NIC 처리량)이
// 아니다. IOPS 를 대역폭으로 환산하지 않는다 — 블록 크기와 큐 깊이를 지어내야 하고
// 그것이 PRD 5.3 이 금지하는 보간이다.

const FRAME_BITS_64B = 672;
const lineRatePps = (bps) => Math.round(bps / FRAME_BITS_64B);

const derivedPpsNote = (bps) => `초당 패킷 ${(lineRatePps(bps) / 1e6).toFixed(2)} Mpps 는 64바이트 프레임 라인레이트에서 파생했습니다.`;

export const storageCatalog = Object.freeze([
  {
    id: 'synology-fs6400',
    vendor: 'Synology',
    model: 'FlashStation FS6400',
    kinds: ['nas', 'storage', 'backup'],
    source: {
      type: 'datasheet',
      label: 'Synology FS6400 Data Sheet',
      url: 'https://global.download.synology.com/download/Document/Hardware/DataSheet/FlashStation/20-year/FS6400/enu/Synology_FS6400_Data_Sheet_enu.pdf',
      locator: 'External Ports / PCIe / Optional Add-on Network Interface Cards',
      retrievedAt: '2026-09-06',
      note: 'Performance figures may vary depending on environment, usage, and configuration.',
    },
    profiles: [
      { id: 'onboard', label: '온보드만',
        note: `데이터시트의 외부 포트는 RJ-45 10GbE 2개와 1GbE 2개입니다. 합 22 Gbps. ${derivedPpsNote(22e9)}`,
        limits: { nic_bps: 22e9, nic_pps: lineRatePps(22e9) } },
      { id: 'plus-25gbe', label: '온보드 + 25GbE 카드',
        note: `데이터시트가 옵션으로 적은 E25G30-F2(25GbE 2포트)를 더한 구성입니다. 22 + 50 = 72 Gbps. ${derivedPpsNote(72e9)}`,
        limits: { nic_bps: 72e9, nic_pps: lineRatePps(72e9) } },
      { id: 'plus-10gbe', label: '온보드 + 10GbE 카드',
        note: `옵션 E10G30-F2(10GbE 2포트)를 더한 구성입니다. 22 + 20 = 42 Gbps. ${derivedPpsNote(42e9)}`,
        limits: { nic_bps: 42e9, nic_pps: lineRatePps(42e9) } },
    ],
  },
]);
