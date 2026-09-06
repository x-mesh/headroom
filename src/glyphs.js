// 손으로 그린 장비 심볼. 생성 파일이 아니므로 사람이 관리한다.
//
// draw.io networks.xml 스텐실은 큰 캔버스에 텍스트 라벨과 함께 놓는 전제로 그려졌다.
// 라벨이 클래스를 말하니 그림은 계열만 보이면 됐고, 그래서 스위치·라우터·허브·회선종단·
// 로드밸런서가 모두 "1U 박스에 포트 줄"이고 우상단 12px 글리프만 다르다. 92x30 으로
// 줄인 노드에서 그 차이는 사라진다. DESIGN.md 는 "Shape carries the class" 라고 적는데
// 구현이 그 규칙을 못 지키고 있었다.
//
// 여기 심볼은 외곽선 자체를 클래스마다 다르게 그린다. 규격은 생성 심볼과 같다:
// 선언 박스 100x29 에 스트로크 패딩 2, 색은 커스텀 프로퍼티 셋만 쓴다. 리터럴 색을
// 넣으면 비활성·선택 상태에서 기존 심볼과 다르게 반응한다.

const VIEW_BOX = '-2 -2 104 33';
const OUTLINE = 'fill:var(--icon-fill,none);stroke:var(--icon-line,currentColor);stroke-width:2';
const THIN = 'fill:none;stroke:var(--icon-line,currentColor);stroke-width:1';

const glyph = (kind, body) => [kind, Object.freeze({ id: `glyph-${kind}`, viewBox: VIEW_BOX, body })];

export const GLYPHS = Object.freeze(Object.fromEntries([
  // 누운 원기둥. 박스 계열과 외곽이 확실히 갈린다. 안의 사방 화살표는 경로 선택을 뜻한다.
  glyph('router', `<g style="${OUTLINE}">`
    + '<path d="M 14 0 L 86 0 A 14 14.5 0 0 1 86 29 L 14 29 A 14 14.5 0 0 1 14 0 Z"/>'
    + '<path d="M 14 0 A 14 14.5 0 0 0 14 29" />'
    + `</g><g style="${THIN}">`
    + '<path d="M 50 4 L 50 25 M 36 14.5 L 64 14.5"/>'
    + '<path d="M 46 8 L 50 4 L 54 8 M 46 21 L 50 25 L 54 21 M 40 10.5 L 36 14.5 L 40 18.5 M 60 10.5 L 64 14.5 L 60 18.5"/>'
    + '</g>'),

  // 중앙에서 방사되는 분기. 형태가 곧 뜻이다.
  glyph('hub', `<g style="${OUTLINE}">`
    + '<ellipse cx="50" cy="14.5" rx="11" ry="11"/>'
    + '<path d="M 50 3.5 L 50 0 M 50 25.5 L 50 29 M 39 14.5 L 20 14.5 M 61 14.5 L 80 14.5"'
    + ' /><path d="M 42 7 L 30 1 M 58 7 L 70 1 M 42 22 L 30 28 M 58 22 L 70 28"/>'
    + `</g><g stroke="none" style="fill:var(--icon-line,currentColor)">`
    + '<circle cx="20" cy="14.5" r="2.5"/><circle cx="80" cy="14.5" r="2.5"/>'
    + '<circle cx="30" cy="1" r="2.5"/><circle cx="70" cy="1" r="2.5"/>'
    + '<circle cx="30" cy="28" r="2.5"/><circle cx="70" cy="28" r="2.5"/>'
    + '</g>'),

  // 낮은 상자 위로 나가는 파형. 회선이 물리는 자리다.
  glyph('modem', `<g style="${OUTLINE}">`
    + '<path d="M 6 13 L 94 13 L 94 29 L 6 29 Z"/>'
    + '<path d="M 22 6 C 30 0 38 12 46 6 C 54 0 62 12 70 6 C 74 3 76 4 78 6"/>'
    + `</g><g stroke="none" style="fill:var(--icon-accent,#ffffff)">`
    + '<circle cx="16" cy="21" r="2"/><circle cx="26" cy="21" r="2"/><circle cx="36" cy="21" r="2"/>'
    + '</g>'),

  // 하나 들어와 셋으로 갈라진다.
  glyph('lb', `<g style="${OUTLINE}">`
    + '<path d="M 2 14.5 L 30 14.5"/>'
    + '<path d="M 30 4 L 46 14.5 L 30 25 L 14 14.5 Z"/>'
    + '<path d="M 46 14.5 L 62 14.5 L 62 2 L 84 2 M 62 14.5 L 84 14.5 M 62 14.5 L 62 27 L 84 27"/>'
    + `</g><g style="${THIN}">`
    + '<path d="M 80 -1.5 L 84 2 L 80 5.5 M 80 11 L 84 14.5 L 80 18 M 80 23.5 L 84 27 L 80 30.5"/>'
    + '</g>'),

  // 방패를 지나는 트래픽. 검사 장비라는 뜻을 형태에 담는다.
  glyph('ips', `<g style="${OUTLINE}">`
    + '<path d="M 50 0 L 84 5 L 84 16 C 84 24 69 28 50 29 C 31 28 16 24 16 16 L 16 5 Z"/>'
    + `</g><g style="${THIN}">`
    + '<path d="M 24 15 L 36 15 L 40 7 L 46 23 L 52 10 L 56 15 L 76 15"/>'
    + '</g>'),

  // 두 사이트를 잇는 터널과 자물쇠.
  glyph('vpn', `<g style="${OUTLINE}">`
    + '<path d="M 2 4 L 14 4 L 14 25 L 2 25 M 98 4 L 86 4 L 86 25 L 98 25"/>'
    + '<path d="M 14 14.5 L 34 14.5 M 66 14.5 L 86 14.5" stroke-dasharray="5 4"/>'
    + '<path d="M 40 12 L 60 12 L 60 27 L 40 27 Z"/>'
    + '<path d="M 44 12 L 44 7 A 6 6 0 0 1 56 7 L 56 12"/>'
    + '</g>'),

  // 방패 안의 브라우저 창. 웹 앞에 선 장비다.
  glyph('waf', `<g style="${OUTLINE}">`
    + '<path d="M 50 0 L 84 5 L 84 16 C 84 24 69 28 50 29 C 31 28 16 24 16 16 L 16 5 Z"/>'
    + '<path d="M 27 8 L 73 8 L 73 22 L 27 22 Z"/>'
    + '<path d="M 27 13 L 73 13"/>'
    + `</g><g stroke="none" style="fill:var(--icon-line,currentColor)">`
    + '<circle cx="32" cy="10.5" r="1.3"/><circle cx="37" cy="10.5" r="1.3"/>'
    + '</g>'),
]));

export const GLYPH_KINDS = Object.freeze(Object.keys(GLYPHS));

export const GLYPH_SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">'
  + Object.values(GLYPHS).map((glyph) => `<symbol id="${glyph.id}" viewBox="${glyph.viewBox}" preserveAspectRatio="xMidYMid meet">${glyph.body}</symbol>`).join('')
  + '</svg>';
