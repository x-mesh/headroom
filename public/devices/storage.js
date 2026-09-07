// 스토리지 어플라이언스. 공개 데이터시트에서 항목 단위로 옮긴 값이며 엔진은 이 파일을 모른다.
//
// 어플라이언스는 서버와 달리 포트 구성을 데이터시트에 못박는다. 그래서 프로필은
// "무엇을 꽂았는가"다. 온보드만 쓸 때와 옵션 카드를 더했을 때가 갈린다.
//
// 데이터시트가 싣는 성능 수치는 iSCSI 4K 랜덤 쓰기 IOPS 이고, 이 도구의 축(NIC 처리량)이
// 아니다. IOPS 를 대역폭으로 환산하지 않는다 — 블록 크기와 큐 깊이를 지어내야 하고
// 그것이 PRD 5.3 이 금지하는 보간이다.
//
// 초당 패킷은 64바이트 프레임 라인레이트에서 파생한다(672비트). 어느 표에도 pps 는 없다.

const FRAME_BITS_64B = 672;
const lineRatePps = (bps) => Math.round(bps / FRAME_BITS_64B);
const derived = (bps) => `초당 패킷 ${(lineRatePps(bps) / 1e6).toFixed(2)} Mpps 는 64바이트 프레임 라인레이트에서 파생했습니다.`;

const synologySource = (model, file, series) => ({
  type: 'datasheet',
  label: `Synology ${model} Data Sheet`,
  url: `https://global.download.synology.com/download/Document/Hardware/DataSheet/${series}/20-year/${file}/enu/Synology_${file}_Data_Sheet_enu.pdf`,
  locator: 'External Ports / PCIe / Optional Add-on Network Interface Cards',
  retrievedAt: '2026-09-06',
  note: 'Performance figures may vary depending on environment, usage, and configuration.',
});

// onboard 는 데이터시트가 적은 포트 구성의 합이고, 카드 프로필은 거기에 옵션 카드 한 장을 더한다.
function appliance({ id, model, file, series, onboardNote, onboardBps, cards }) {
  return {
    id, vendor: 'Synology', model, kinds: ['nas', 'storage', 'backup'],
    source: synologySource(model, file, series),
    profiles: [
      { id: 'onboard', label: '온보드만',
        note: `${onboardNote} 합 ${onboardBps / 1e9} Gbps. ${derived(onboardBps)}`,
        limits: { nic_bps: onboardBps, nic_pps: lineRatePps(onboardBps) } },
      ...cards.map(({ id: cardId, label, card, addBps }) => {
        const total = onboardBps + addBps;
        return {
          id: cardId, label,
          note: `데이터시트가 옵션으로 적은 ${card} 를 PCIe 슬롯에 한 장 더한 구성입니다. ${onboardBps / 1e9} + ${addBps / 1e9} = ${total / 1e9} Gbps. ${derived(total)}`,
          limits: { nic_bps: total, nic_pps: lineRatePps(total) },
        };
      }),
    ],
  };
}

const tenAndTwentyFive = [
  { id: 'plus-10gbe', label: '온보드 + 10GbE 카드', card: 'E10G30-F2(10GbE 2포트)', addBps: 20e9 },
  { id: 'plus-25gbe', label: '온보드 + 25GbE 카드', card: 'E25G30-F2(25GbE 2포트)', addBps: 50e9 },
];

export const storageCatalog = Object.freeze([
  appliance({
    id: 'synology-fs6400', model: 'FlashStation FS6400', file: 'FS6400', series: 'FlashStation',
    onboardNote: '데이터시트의 외부 포트는 RJ-45 10GbE 2개와 1GbE 2개입니다.',
    onboardBps: 22e9, cards: tenAndTwentyFive,
  }),
  appliance({
    id: 'synology-fs3600', model: 'FlashStation FS3600', file: 'FS3600', series: 'FlashStation',
    onboardNote: '데이터시트의 외부 포트는 RJ-45 10GbE 2개와 1GbE 4개입니다.',
    onboardBps: 24e9, cards: tenAndTwentyFive,
  }),
  appliance({
    id: 'synology-sa3600', model: 'SA3600', file: 'SA3600', series: 'SA',
    onboardNote: '데이터시트는 10GbE RJ-45 2개와 기가비트 RJ-45 4개를 싣습니다.',
    onboardBps: 24e9, cards: tenAndTwentyFive,
  }),
  appliance({
    id: 'synology-sa3400', model: 'SA3400', file: 'SA3400', series: 'SA',
    onboardNote: '데이터시트는 10GbE RJ-45 2개와 기가비트 RJ-45 4개를 싣습니다.',
    onboardBps: 24e9, cards: tenAndTwentyFive,
  }),
]);
