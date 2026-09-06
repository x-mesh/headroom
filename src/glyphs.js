// 손으로 그린 심볼. src/icons.js 와 달리 생성 파일이 아니므로 사람이 고친다.
//
// 두 가지 이유로 스텐실을 쓰지 못하는 클래스만 여기서 그린다.
//
// 하나는 겹침이다. drawio networks.xml 은 mail 과 waf 를 둘 다 "서버 스택 + 지름 24 단위의
// 원"으로 그리고, 원 안에만 봉투와 창을 넣는다. 노드 심볼 칸(88x40)에서 그 표식은 10px
// 아래로 줄어 두 클래스가 같은 그림이 된다.
//
// 다른 하나는 뜻이 어긋나는 것이다. ips 자리의 Security Camera 는 네트워크 다이어그램에서
// CCTV 장비로 읽히고, vpn 자리의 Comm Link 는 번개 하나뿐이라 장비로도 터널로도 보이지 않는다.
//
// 스텐실 집합에는 이 넷을 대신할 도형이 없다. 그래서 심볼 전체 크기로 다시 그린다.
// 규격은 생성물과 같게 맞춘다.
//   viewBox   선언 박스 + 사방 2 단위(ICON_PAD). 스트로크가 경로 위에 중앙 정렬이라 넘친다.
//   루트 <g>  fill:var(--icon-fill,none) · stroke:var(--icon-line,currentColor) · stroke-width:2
//   강조      var(--icon-accent,#ffffff). 리터럴 색은 var() 폴백 자리에만 둔다.
// 이 세 토큰만 쓰면 비활성·선택·상태 색이 스텐실 심볼과 똑같이 반응한다.

const ROOT = 'fill:var(--icon-fill,none);stroke:var(--icon-line,currentColor);stroke-width:2';
const ACCENT = 'fill:var(--icon-accent,#ffffff)';

export const GLYPHS = Object.freeze({
  // 봉투. 몸통은 캔버스 색으로 채워 링크가 가장자리에서 멈추고, 덮개와 접힘선만 그린다.
  mail: Object.freeze({
    id: 'glyph-mail', drawn: 'envelope', width: 100, height: 72, viewBox: '-2 -2 104 76',
    body: `<g style="${ROOT}">`
      + '<rect x="1" y="1" width="98" height="70"/>'
      + '<path fill="none" d="M 1 1 L 50 41 L 99 1"/>'
      + '<path fill="none" d="M 1 71 L 37 40"/>'
      + '<path fill="none" d="M 99 71 L 63 40"/>'
      + '</g>',
  }),
  // 방패 안의 창. 방패는 보안 계열과 같은 뜻이고, 창이 "웹 애플리케이션"을 말한다.
  // sslvpn 의 자물쇠와 firewall 의 벽돌담과는 외곽선이 갈린다.
  waf: Object.freeze({
    id: 'glyph-waf', drawn: 'shield-window', width: 84, height: 100, viewBox: '-2 -2 88 104',
    body: `<g style="${ROOT}">`
      + '<path d="M 42 1 L 83 15 L 83 48 C 83 76 66 92 42 99 C 18 92 1 76 1 48 L 1 15 Z"/>'
      + `<rect x="19" y="32" width="46" height="36" style="${ACCENT}"/>`
      + '<path fill="none" d="M 19 43 L 65 43"/>'
      + '</g>',
  }),
  // 돋보기 안을 지나는 트래픽 파형. IDS·IPS 가 하는 일이 지나는 트래픽을 들여다보는 것이다.
  // 파형은 40px 에서도 살아남는다 — 같은 자리에 넣어 본 작은 사각형들은 한 덩어리로 뭉갠다.
  ips: Object.freeze({
    id: 'glyph-ips', drawn: 'lens-traffic', width: 100, height: 84, viewBox: '-2 -2 104 88',
    body: `<g style="${ROOT}">`
      + '<path fill="none" d="M 40 58 L 14 82"/>'
      + '<ellipse cx="63" cy="33" rx="31" ry="31"/>'
      + '<path fill="none" d="M 40 33 L 52 33 L 58 19 L 68 47 L 74 33 L 86 33"/>'
      + '</g>',
  }),
  // 두 거점과 그 사이의 터널. 파선이 터널 안을 지나는 암호화된 트래픽이다.
  // sslvpn 의 자물쇠는 원격 사용자 접속을 말하고, 이쪽은 거점 간 IPsec 을 말한다.
  vpn: Object.freeze({
    id: 'glyph-vpn', drawn: 'site-to-site-tunnel', width: 100, height: 44, viewBox: '-2 -2 104 48',
    body: `<g style="${ROOT}">`
      + '<rect x="1" y="1" width="30" height="42"/>'
      + '<rect x="69" y="1" width="30" height="42"/>'
      + '<path fill="none" d="M 6 34 L 26 34"/>'
      + '<path fill="none" d="M 74 34 L 94 34"/>'
      + '<path fill="none" d="M 31 12 L 69 12"/>'
      + '<path fill="none" d="M 31 32 L 69 32"/>'
      + '<path fill="none" stroke-dasharray="7 6" d="M 34 22 L 66 22"/>'
      + '</g>',
  }),
});

export const GLYPH_KINDS = Object.freeze(Object.keys(GLYPHS));

export const GLYPH_SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">'
  + Object.values(GLYPHS).map((glyph) => `<symbol id="${glyph.id}" viewBox="${glyph.viewBox}" preserveAspectRatio="xMidYMid meet">${glyph.body}</symbol>`).join('')
  + '</svg>';
