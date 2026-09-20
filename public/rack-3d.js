import * as THREE from './vendor/three.module.js';

// 1U = 44.45mm, 1 world unit = 1/6 m. 랙 높이를 U 수에서 계산해야 3U 인클로저와 42U 랙이 한 축척으로 선다.
const U = .2667;
const RACK = Object.freeze({
  plinth: .3, crown: .34, faceWidth: 2.9, bodyWidth: 2.62,
  postWidth: .3, postDepth: .12, frontPostZ: 2.55, rearPostZ: -1.8,
});
const FRONT_Z = RACK.frontPostZ + RACK.postDepth / 2;
const FRAME_WIDTH = RACK.faceWidth + .24;
const FRAME_DEPTH = RACK.frontPostZ - RACK.rearPostZ + .36;
const FRAME_Z = (RACK.frontPostZ + RACK.rearPostZ) / 2;
const REAR_PLANE = RACK.rearPostZ - .4;
const CABINET = Object.freeze({ width: FRAME_WIDTH, depth: FRAME_DEPTH });

const COLORS = Object.freeze({
  frame: 0x24382f, crown: 0x2d4a41, plinth: 0x0f1a17, tray: 0x3c5850,
  selected: 0xb8e737, ok: 0x4f7100, warn: 0xd28a22, over: 0xb83c34, unknown: 0x8b9a94, blocked: 0x3a4a45,
  cable: [0x25a98f, 0x8dbd32, 0x5b7f75], warningCable: 0xd28a22, downCable: 0xb83c34,
});
// 불빛 색은 게이지와 같은 기준을 쓴다. 랙 화면에서 노란 불과 노란 막대가 다른 뜻이면 안 된다.
const LED = Object.freeze({ link: 0x4ad39c, disk: 0xa8e26a, power: 0x2fbf6a, warn: 0xf0a63c, over: 0xff5b4c });

// 한 번 켜질 때 켜져 있는 몫. 부하를 따라 이 값까지 같이 올리면 최대 부하에서 상시등처럼 보여
// "더 깜빡일수록 더 바쁘다"가 끝에서 뒤집힌다. 그래서 고정하고 빈도만 올린다.
const LED_DUTY = .22;

/**
 * 불빛 하나의 지금 밝기. 켜졌다/꺼졌다가 아니라 얼마나 지나가는지를 말한다 — 부하가 높을수록
 * 자주 깜빡이고, 그 관계는 0%에서 100%까지 한 방향으로만 간다. 한계를 모르는 축이면 상시등만
 * 희미하게 두고, 부하가 0 이면 어둡게 둔다. 놀고 있는 서버가 바쁜 서버처럼 보이는 순간 이
 * 화면은 처음으로 거짓말을 하게 된다.
 *
 * 넘긴 장비만 규칙이 다르다. 더 빨리 깜빡여 봐야 99% 와 구별되지 않으므로, 느리고 크게 숨쉬는
 * 경고등으로 바꾼다. 랙 여러 개를 한눈에 훑을 때 제일 먼저 걸려야 하는 것이 이미 넘은 곳이다.
 */
function ledLevel(time, spot, reduce) {
  if (!spot.active) return 0;
  if (spot.role === 'power') return 1;
  if (spot.load == null) return .2;
  if (spot.load <= .001) return .05;
  if (spot.load > 1) {
    if (reduce) return 1;
    return .3 + .7 * (.5 + .5 * Math.sin((time * 1.5 + spot.seed) * Math.PI * 2));
  }
  if (reduce) return Math.min(1, .35 + spot.load * .65);
  const wave = (time * (.8 + spot.load * 9) + spot.seed) % 1;
  return wave < LED_DUTY ? 1 : .08;
}

function ledColor(role, load, warningThreshold) {
  if (role === 'power') return LED.power;
  if (load == null) return COLORS.unknown;
  if (load > 1) return LED.over;
  if (load >= warningThreshold) return LED.warn;
  return role === 'disk' ? LED.disk : LED.link;
}

const PORT_KINDS = new Set(['switch', 'hub', 'router', 'modem', 'wireless', 'firewall', 'ips', 'waf', 'vpn', 'sslvpn', 'lb']);
const BAY_KINDS = new Set(['server', 'web', 'vm', 'db', 'mail', 'mainframe', 'storage', 'nas', 'backup']);

function rackMetrics(rack) {
  const capacityU = Math.max(1, Math.round(Number(rack.capacityU) || 1));
  const inner = capacityU * U;
  return { capacityU, inner, baseY: RACK.plinth, height: RACK.plinth + inner + RACK.crown };
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = Math.max(2, Math.round(width)); canvas.height = Math.max(2, Math.round(height));
  return [canvas, canvas.getContext('2d')];
}

function textureOf(canvas) {
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; return texture;
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath(); context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r); context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r); context.arcTo(x, y, x + width, y, r); context.closePath();
}

const LABEL_RULE = Object.freeze({ ok: '#077165', warn: '#8b5100', over: '#b83c34', unknown: '#697286' });

function labelSprite(name, detail, status = 'ok') {
  const [canvas, context] = canvasOf(512, 128);
  context.fillStyle = 'rgba(247,250,247,.96)'; context.fillRect(0, 0, 512, 128);
  context.fillStyle = LABEL_RULE[status] || LABEL_RULE.ok; context.fillRect(0, 0, 512, 6);
  context.textAlign = 'center';
  context.fillStyle = '#13241f'; context.font = '700 40px Pretendard, -apple-system, sans-serif'; context.fillText(name, 256, 64);
  context.fillStyle = status === 'ok' ? '#4a635a' : LABEL_RULE[status] || '#4a635a';
  context.font = '500 24px ui-monospace, Menlo, monospace'; context.fillText(detail, 256, 104);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureOf(canvas), transparent: true, depthTest: false }));
  sprite.scale.set(2.7, .68, 1); return sprite;
}

// 마운팅 포스트: U마다 사각 홀 세 개와 5U 간격 번호. 실제 랙의 눈금이 곧 높이 감각을 만든다.
function postTexture(capacityU) {
  const step = 30; const [canvas, context] = canvasOf(64, capacityU * step); const height = canvas.height;
  const flange = context.createLinearGradient(0, 0, 64, 0);
  flange.addColorStop(0, '#22382f'); flange.addColorStop(.42, '#3d5e55'); flange.addColorStop(1, '#1d302a');
  context.fillStyle = flange; context.fillRect(0, 0, 64, height);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  for (let unit = 1; unit <= capacityU; unit += 1) {
    const bottom = height - (unit - 1) * step;
    for (const offset of [.22, .5, .78]) {
      const y = bottom - step * offset;
      context.fillStyle = '#0a120f'; context.fillRect(19, y - 5.5, 12, 11);
      context.fillStyle = 'rgba(255,255,255,.14)'; context.fillRect(19, y + 5.5, 12, 1.4);
    }
    context.fillStyle = 'rgba(255,255,255,.09)'; context.fillRect(0, bottom - step, 64, 1);
    if (unit === 1 || unit % 5 === 0) {
      context.fillStyle = 'rgba(234,244,238,.6)'; context.font = '600 12px ui-monospace, Menlo, monospace';
      context.fillText(String(unit), 47, bottom - step * .5);
    }
  }
  return textureOf(canvas);
}

function crownTexture() {
  const [canvas, context] = canvasOf(256, 335);
  context.fillStyle = '#27423b'; context.fillRect(0, 0, 256, 335);
  context.fillStyle = 'rgba(0,0,0,.24)'; context.fillRect(0, 0, 256, 7); context.fillRect(0, 328, 256, 7);
  context.fillStyle = 'rgba(255,255,255,.07)'; context.fillRect(10, 11, 236, 2);
  for (let y = 26; y < 310; y += 7) { context.fillStyle = 'rgba(255,255,255,.022)'; context.fillRect(14, y, 228, 2); }
  context.fillStyle = '#0d1815'; roundRect(context, 66, 132, 124, 48, 6); context.fill();
  context.fillStyle = 'rgba(255,255,255,.09)'; context.fillRect(70, 136, 116, 3);
  for (const x of [26, 230]) for (const y of [24, 311]) { context.fillStyle = 'rgba(0,0,0,.4)'; context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fill(); }
  return textureOf(canvas);
}

function freeTexture(units, width, height) {
  const [canvas, context] = canvasOf(640, 640 * height / width);
  context.setLineDash([16, 11]); context.lineWidth = 4; context.strokeStyle = 'rgba(19,36,31,.42)';
  context.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
  context.setLineDash([]);
  context.fillStyle = 'rgba(19,36,31,.6)'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = `600 ${Math.round(Math.min(50, canvas.height * .3))}px ui-monospace, Menlo, monospace`;
  context.fillText(`빈 공간 ${units}U`, canvas.width / 2, canvas.height / 2);
  return textureOf(canvas);
}

function accentOf(view) { return !view.active ? '#6f7d79' : view.domainColor || (view.mapped ? '#0e9a86' : '#8aa39b'); }

// 섀시는 종류마다 깊이가 다르다. 패치 패널을 서버와 같은 깊이로 두면 옆에서 본 순간 정체가 드러난다.
const CHASSIS = Object.freeze({
  'patch-panel': { depth: .7, face: 'patch', dark: false },
  pdu: { depth: .95, face: 'outlets', dark: true },
  'cable-management': { depth: .6, face: 'rings', dark: true },
  // 0.5U 패널은 스페이서일 뿐이라 패치 패널보다도 얕고 무늬 없는 민무늬 면으로 둔다.
  'blank-panel': { depth: .35, face: 'plain', dark: true },
});

function chassisProfile(view) {
  const preset = CHASSIS[view.kind];
  if (preset) return preset;
  if (PORT_KINDS.has(view.kind)) return view.uHeight >= 4 ? { depth: 3.1, face: 'slots', dark: true } : { depth: 2.5, face: 'ports', dark: true };
  if (BAY_KINDS.has(view.kind)) return { depth: 3.6, face: 'bays', dark: false };
  return { depth: 2.9, face: 'vents', dark: false };
}

function faceGeometry(view) {
  const width = 1024;
  // 1U 의 픽셀 높이. 글자·LED·포트는 장비가 높아져도 커지면 안 되므로 전부 이 값을 기준으로 잡는다.
  const rowUnit = width * U / RACK.faceWidth;
  return { width, rowUnit, height: Math.max(52, Math.round(rowUnit * view.uHeight)) };
}

/**
 * 켜질 수 있는 자리 하나. 면 텍스처 위의 픽셀 좌표 그대로 담아 두면 cabinet 이 랙 좌표로 옮겨
 * 실제 불을 세운다. 불을 텍스처에 칠하지 않는 이유는 그것이 매 프레임 장비마다 1024px 캔버스를
 * 다시 칠하는 일이 되기 때문이다.
 */
function lamp(leds, lens, role) {
  leds?.push({ x: lens.x + lens.w / 2, y: lens.y + lens.h / 2, w: lens.w, h: lens.h, role });
}

// 같은 배치는 다시 그려도 같은 박자로 뛴다. 매번 난수를 뽑으면 장비 하나를 고르는 것만으로
// 랙 전체 불빛이 한꺼번에 튄다.
function stableSeed(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return (Math.abs(hash) % 1000) / 1000;
}

function drawPorts(context, area, view, accent) {
  const { left, right, top, bottom, rowUnit } = area;
  const rows = view.uHeight > 1 ? 2 : 1;
  const portWidth = Math.round(rowUnit * .26); const portHeight = Math.round(rowUnit * .3);
  const gap = Math.max(3, Math.round(portWidth * .34));
  const cageWidth = Math.round(portWidth * 1.5);
  const cages = right - left > cageWidth * 3 ? 2 : 0;
  const limit = right - cages * (cageWidth + gap) - (cages ? gap * 2 : 0);
  const count = Math.max(0, Math.floor((limit - left) / (portWidth + gap)));
  const middle = (top + bottom) / 2;
  for (let row = 0; row < rows; row += 1) for (let index = 0; index < count; index += 1) {
    const x = left + index * (portWidth + gap);
    const y = (rows > 1 ? middle + (row ? .3 : -.3) * portHeight * 2.1 : middle) - portHeight / 2;
    context.fillStyle = '#0a1512'; roundRect(context, x, y, portWidth, portHeight, 2); context.fill();
    context.fillStyle = 'rgba(255,255,255,.12)'; context.fillRect(x + 2, y + 2, portWidth - 4, 1.5);
    // 불은 텍스처가 아니라 앞에 세운 메시가 켠다. 여기서는 꺼진 렌즈만 그린다 — 텍스처를 매
    // 프레임 다시 그리면 장비 한 대마다 1024px 캔버스를 새로 칠하게 된다.
    const lens = { x: x + portWidth * .22, y: y + portHeight - 4, w: portWidth * .56, h: 2.4 };
    context.fillStyle = 'rgba(0,0,0,.55)'; context.fillRect(lens.x, lens.y, lens.w, lens.h);
    if ((index + row) % 3 === 0) lamp(area.leds, lens, 'link');
  }
  for (let index = 0; index < cages; index += 1) {
    const x = limit + gap * 2 + index * (cageWidth + gap); const y = middle - portHeight * .6;
    context.fillStyle = '#101e1a'; roundRect(context, x, y, cageWidth, portHeight * 1.2, 3); context.fill();
    context.fillStyle = 'rgba(255,255,255,.16)'; context.fillRect(x + 3, y + 3, cageWidth - 6, 2);
    const lens = { x: x + cageWidth - 9, y: y + portHeight * .85, w: 5, h: 4 };
    context.fillStyle = 'rgba(0,0,0,.5)'; context.fillRect(lens.x, lens.y, lens.w, lens.h);
    lamp(area.leds, lens, 'link');
  }
}

// 4U 이상 스위치는 고정 포트가 아니라 라인카드 슬롯으로 읽혀야 샤시로 보인다.
function drawSlots(context, area, view, accent) {
  const { left, right, top, bottom, rowUnit } = area;
  const slots = Math.max(3, Math.min(8, view.uHeight));
  const slotHeight = (bottom - top) / slots;
  for (let index = 0; index < slots; index += 1) {
    const y = top + index * slotHeight + 3;
    const height = slotHeight - 6;
    context.fillStyle = '#17261f'; roundRect(context, left, y, right - left, height, 3); context.fill();
    context.fillStyle = 'rgba(255,255,255,.1)'; context.fillRect(left + 4, y + 3, right - left - 8, 1.5);
    context.fillStyle = 'rgba(255,255,255,.22)'; roundRect(context, left + 6, y + height * .25, rowUnit * .1, height * .5, 2); context.fill();
    const ports = Math.max(4, Math.floor((right - left) / (rowUnit * .3)) - 3);
    for (let port = 0; port < ports; port += 1) {
      const px = left + rowUnit * .3 + port * rowUnit * .28;
      if (px + rowUnit * .22 > right - 8) break;
      context.fillStyle = '#08120f'; roundRect(context, px, y + height * .3, rowUnit * .22, height * .4, 2); context.fill();
      const lens = { x: px + 2, y: y + height * .74, w: rowUnit * .18, h: 2 };
      context.fillStyle = 'rgba(0,0,0,.5)'; context.fillRect(lens.x, lens.y, lens.w, lens.h);
      if (port % 3 === 0) lamp(area.leds, lens, 'link');
    }
    const radius = Math.max(2, rowUnit * .04);
    context.fillStyle = 'rgba(0,0,0,.4)';
    context.beginPath(); context.arc(right - 10, y + height / 2, radius, 0, Math.PI * 2); context.fill();
    lamp(area.leds, { x: right - 10 - radius, y: y + height / 2 - radius, w: radius * 2, h: radius * 2 }, 'status');
  }
}

// 1U 는 SFF 한 줄, 4U 는 LFF 격자. 같은 베이를 세로로 늘리면 4U 가 2U 를 잡아 늘인 것처럼 보인다.
function drawBays(context, area, view, dark) {
  const { left, right, top, bottom, rowUnit } = area;
  const tall = view.uHeight >= 4;
  const rows = tall ? 3 : Math.max(1, Math.min(3, view.uHeight));
  const columns = tall ? 5 : view.uHeight === 1 ? 8 : 12;
  const bayWidth = (right - left) / columns; const bayHeight = (bottom - top) / rows;
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = left + column * bayWidth; const y = top + row * bayHeight;
    context.fillStyle = dark ? '#16241f' : '#c1cfc9'; roundRect(context, x + 2, y + 2, bayWidth - 4, bayHeight - 4, 3); context.fill();
    context.fillStyle = dark ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.75)';
    context.fillRect(x + 7, y + bayHeight * .4, (bayWidth - 4) * .24, Math.max(2, Math.min(rowUnit * .1, bayHeight * .16)));
    // 드라이브마다 자기 불을 갖는다. 읽고 쓰는 동안만 켜지므로 바쁜 베이와 노는 베이가 갈린다.
    const radius = Math.max(2, rowUnit * .035);
    const cx = x + bayWidth - 11; const cy = y + bayHeight * .5;
    context.fillStyle = 'rgba(0,0,0,.36)';
    context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.fill();
    lamp(area.leds, { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 }, 'disk');
  }
}

function drawPatch(context, area, view) {
  const { left, right, top, bottom, rowUnit } = area;
  const rows = Math.max(1, view.uHeight);
  const columns = 24; const rowHeight = (bottom - top) / rows;
  const portWidth = Math.min(rowUnit * .3, (right - left) / columns - 3);
  for (let row = 0; row < rows; row += 1) for (let index = 0; index < columns; index += 1) {
    const x = left + index * ((right - left) / columns); const y = top + row * rowHeight + rowHeight * .3;
    if (x + portWidth > right) break;
    context.fillStyle = '#26332e'; roundRect(context, x, y, portWidth, rowHeight * .42, 2); context.fill();
    context.fillStyle = 'rgba(255,255,255,.5)'; context.fillRect(x + 2, y + 2, portWidth - 4, 1.5);
    if (index % 6 === 0) {
      context.fillStyle = 'rgba(22,36,31,.6)'; context.font = `600 ${Math.round(rowUnit * .14)}px ui-monospace, Menlo, monospace`;
      context.textAlign = 'left'; context.fillText(String(row * columns + index + 1), x, y - rowUnit * .1);
    }
  }
}

function drawOutlets(context, area, view, accent) {
  const { left, right, top, bottom, rowUnit } = area;
  const middle = (top + bottom) / 2;
  const breaker = rowUnit * .34;
  context.fillStyle = '#1d2b26'; roundRect(context, left, middle - breaker / 2, breaker * .7, breaker, 3); context.fill();
  context.fillStyle = view.active ? accent : '#56635f'; context.fillRect(left + 4, middle - breaker * .2, breaker * .7 - 8, breaker * .18);
  const start = left + breaker + rowUnit * .2;
  const outlet = rowUnit * .3; const gap = outlet * .35;
  const count = Math.max(0, Math.floor((right - start) / (outlet + gap)));
  for (let index = 0; index < count; index += 1) {
    const x = start + index * (outlet + gap);
    context.fillStyle = '#0e1a17'; roundRect(context, x, middle - outlet * .55, outlet, outlet * 1.1, 3); context.fill();
    context.fillStyle = 'rgba(255,255,255,.2)';
    for (const [dx, dy] of [[.28, .3], [.72, .3], [.5, .72]]) { context.beginPath(); context.arc(x + outlet * dx, middle - outlet * .55 + outlet * 1.1 * dy, outlet * .09, 0, Math.PI * 2); context.fill(); }
  }
}

function drawRings(context, area) {
  const { left, right, top, bottom, rowUnit } = area;
  const middle = (top + bottom) / 2; const radius = Math.min(rowUnit * .3, (bottom - top) * .4);
  const count = Math.max(2, Math.floor((right - left) / (radius * 3)));
  context.strokeStyle = 'rgba(255,255,255,.34)'; context.lineWidth = Math.max(3, rowUnit * .05);
  for (let index = 0; index < count; index += 1) {
    const x = left + radius * 1.5 + index * ((right - left - radius * 3) / Math.max(1, count - 1));
    context.beginPath(); context.arc(x, middle, radius, Math.PI * .15, Math.PI * 1.85); context.stroke();
  }
}

function drawVents(context, area, dark) {
  const { left, right, top, bottom, rowUnit } = area;
  context.fillStyle = dark ? 'rgba(0,0,0,.32)' : 'rgba(0,0,0,.15)';
  for (let x = left; x < right; x += Math.max(6, rowUnit * .1)) context.fillRect(x, top, Math.max(2, rowUnit * .045), bottom - top);
}

// 전면 베젤은 캔버스 한 장으로 그린다. 러그·상태 LED·포트/베이·모델 실크스크린이 1U를 1U로 읽히게 한다.
function faceTexture(view, accent, selected, profile) {
  const { width, height, rowUnit } = faceGeometry(view);
  const half = view.uHeight < 1; // 반 칸 장비는 모델 줄과 면 장식 없이 이름만 작게 보여준다.
  const leds = [];
  const [canvas, context] = canvasOf(width, height);
  const dark = profile.dark;
  const shell = context.createLinearGradient(0, 0, 0, height);
  if (dark) { shell.addColorStop(0, '#3b4c46'); shell.addColorStop(.52, '#2a3a34'); shell.addColorStop(1, '#1c2a25'); }
  else { shell.addColorStop(0, '#fbfdfc'); shell.addColorStop(.55, '#e8efeb'); shell.addColorStop(1, '#ccd9d3'); }
  context.fillStyle = shell; context.fillRect(0, 0, width, height);
  context.fillStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.95)'; context.fillRect(0, 0, width, 2);
  context.fillStyle = 'rgba(0,0,0,.34)'; context.fillRect(0, height - 3, width, 3);
  const ink = dark ? '#e9f2ed' : '#16241f'; const dim = dark ? 'rgba(233,242,237,.55)' : 'rgba(22,36,31,.52)';

  const ear = Math.round(width * .044);
  for (const side of [0, 1]) {
    const x = side ? width - ear : 0;
    context.fillStyle = dark ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.09)'; context.fillRect(x, 0, ear, height);
    context.fillStyle = accent; context.fillRect(side ? width - 11 : 5, 5, 6, height - 10);
    context.fillStyle = dark ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.3)';
    const screws = view.uHeight >= 3 ? [.12, .5, .88] : [.28, .72];
    for (const ratio of screws) { context.beginPath(); context.arc(x + ear * .58, height * ratio, Math.max(2.5, rowUnit * .055), 0, Math.PI * 2); context.fill(); }
  }
  // 3U 이상은 손잡이가 있어야 들어 올리는 장비로 읽힌다.
  let inset = ear + rowUnit * .12;
  if (view.uHeight >= 3) {
    const handle = rowUnit * .16;
    for (const side of [0, 1]) {
      const x = side ? width - ear - handle - rowUnit * .12 : ear + rowUnit * .12;
      context.fillStyle = dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.22)';
      roundRect(context, x, height * .2, handle, height * .6, handle / 2); context.fill();
    }
    inset += rowUnit * .16 + rowUnit * .16;
  }

  context.textBaseline = 'middle'; context.textAlign = 'left';
  const middle = height / 2;
  let cursor = inset + rowUnit * .18;
  if (profile.face !== 'patch' && profile.face !== 'rings' && profile.face !== 'plain') {
    // 전원·소속·상태 세 등. 전원은 켜져 있으면 그냥 켜져 있고, 상태등만 지나가는 양을 따라 뛴다.
    // 가운데는 이 배치가 토폴로지의 장비를 가리키는지를 말하는 표시라 깜빡일 이유가 없다.
    const radius = Math.max(2.5, rowUnit * .07);
    const socket = (color) => { context.fillStyle = color; context.beginPath(); context.arc(cursor, middle, radius, 0, Math.PI * 2); context.fill(); };
    const lens = () => ({ x: cursor - radius, y: middle - radius, w: radius * 2, h: radius * 2 });
    socket('rgba(0,0,0,.42)'); lamp(leds, lens(), 'power'); cursor += radius * 2.7;
    socket(view.mapped ? accent : (dark ? '#7c8d87' : '#a3b1ac')); cursor += radius * 2.7;
    socket('rgba(0,0,0,.42)'); lamp(leds, lens(), 'status'); cursor += radius * 2.7;
    cursor += rowUnit * .2;
  }

  const name = view.name.length > 20 ? `${view.name.slice(0, 19)}…` : view.name;
  const model = half ? '' : (view.model || view.kind || '').slice(0, 24);
  context.font = `700 ${Math.round(rowUnit * (half ? .24 : .3))}px Pretendard, -apple-system, sans-serif`;
  const nameWidth = context.measureText(name).width;
  context.fillStyle = ink; context.fillText(name, cursor, model ? middle - rowUnit * .15 : middle);
  context.font = `500 ${Math.round(rowUnit * .2)}px ui-monospace, Menlo, monospace`;
  const modelWidth = model ? context.measureText(model).width : 0;
  if (model) { context.fillStyle = dim; context.fillText(model, cursor, middle + rowUnit * .19); }
  cursor += Math.max(nameWidth, modelWidth) + rowUnit * .34;

  const area = { left: cursor, right: width - inset, top: rowUnit * .16, bottom: height - rowUnit * .16, rowUnit, leds };
  if (area.right > area.left && !half && profile.face !== 'plain') {
    if (profile.face === 'ports') drawPorts(context, area, view, accent);
    else if (profile.face === 'slots') drawSlots(context, area, view, accent);
    else if (profile.face === 'bays') drawBays(context, area, view, dark);
    else if (profile.face === 'patch') drawPatch(context, area, view);
    else if (profile.face === 'outlets') drawOutlets(context, area, view, accent);
    else if (profile.face === 'rings') drawRings(context, area);
    else drawVents(context, area, dark);
  }

  if (!view.active) { context.fillStyle = 'rgba(108,122,118,.52)'; context.fillRect(0, 0, width, height); }
  if (selected) {
    context.lineWidth = Math.max(4, rowUnit * .1); context.strokeStyle = '#b8e737';
    context.strokeRect(context.lineWidth / 2, context.lineWidth / 2, width - context.lineWidth, height - context.lineWidth);
  }
  return { texture: textureOf(canvas), leds, faceWidth: width, faceHeight: height };
}

// 반 칸 배치가 있어도 빈 구간을 놓치지 않도록 U가 아니라 반 칸 인덱스로 점유를 센다.
function freeRun(capacityU, views) {
  const slots = capacityU * 2;
  const occupied = new Array(slots).fill(false);
  for (const view of views) {
    const from = Math.round((view.startU - 1) * 2);
    const to = Math.round((view.startU - 1 + view.uHeight) * 2);
    for (let slot = from; slot < to; slot += 1) occupied[slot] = true;
  }
  let best = null; let run = null;
  for (let slot = 0; slot < slots; slot += 1) {
    if (occupied[slot]) { run = null; continue; }
    run = run ? { start: run.start, end: slot } : { start: slot, end: slot };
    if (!best || run.end - run.start > best.end - best.start) best = run;
  }
  const length = best ? best.end - best.start + 1 : 0;
  return length >= 4 ? { start: best.start / 2 + 1, units: length / 2 } : null;
}

function cabinet(rack, views, selectedId, note, warningThreshold = .8) {
  const group = new THREE.Group();
  const lamps = [];
  const { capacityU, inner, baseY, height } = rackMetrics(rack);
  const frame = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: .44, metalness: .56 });
  const addBox = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const plinthSide = new THREE.MeshStandardMaterial({ color: COLORS.plinth, roughness: .82, metalness: .18 });
  const plinthTop = new THREE.MeshStandardMaterial({ color: 0x0a1210, roughness: .96, metalness: .1 });
  addBox(FRAME_WIDTH, RACK.plinth, FRAME_DEPTH, 0, RACK.plinth / 2, FRAME_Z, [plinthSide, plinthSide, plinthTop, plinthSide, plinthSide, plinthSide]);
  const crownSide = new THREE.MeshStandardMaterial({ color: COLORS.crown, roughness: .58, metalness: .38 });
  // 상판이 매끈하면 키 라이트가 통째로 반사돼 은색 판으로 날아간다.
  const crownTop = new THREE.MeshStandardMaterial({ map: crownTexture(), roughness: .66, metalness: .26 });
  addBox(FRAME_WIDTH, .13, FRAME_DEPTH, 0, height - .065, FRAME_Z, [crownSide, crownSide, crownTop, crownSide, crownSide, crownSide]);
  const postMaterial = new THREE.MeshStandardMaterial({ map: postTexture(capacityU), roughness: .5, metalness: .52 });
  const postX = (RACK.faceWidth - RACK.postWidth) / 2;
  for (const side of [-1, 1]) {
    for (const z of [RACK.frontPostZ, RACK.rearPostZ]) addBox(RACK.postWidth, inner, RACK.postDepth, side * postX, baseY + inner / 2, z, postMaterial);
    for (const y of [baseY + .05, baseY + inner - .05]) addBox(.14, .09, RACK.frontPostZ - RACK.rearPostZ, side * postX, y, (RACK.frontPostZ + RACK.rearPostZ) / 2, frame);
  }

  for (const view of views) {
    const itemHeight = Math.max(.08, view.uHeight * U - .018);
    const y = baseY + (view.startU - 1) * U + itemHeight / 2 + .009;
    const selected = view.id === selectedId;
    const profile = chassisProfile(view);
    const color = !view.active ? 0x434d4a : profile.dark ? 0x1f2b27 : 0x3f4946;
    const chassisMaterial = new THREE.MeshStandardMaterial({ color, roughness: .46, metalness: .52, emissive: selected ? COLORS.selected : 0x000000, emissiveIntensity: selected ? .035 : 0 });
    const chassis = addBox(RACK.bodyWidth, itemHeight, profile.depth, 0, y, FRONT_Z - profile.depth / 2, chassisMaterial);
    chassis.userData = { rackId: rack.id, placementId: view.id, pickable: true };
    const face = faceTexture(view, accentOf(view), selected, profile);
    // 텍스처의 픽셀 자리를 랙 좌표로 옮긴다. 두 좌표계를 따로 두면 장비 높이가 바뀔 때마다 불이
    // 렌즈에서 어긋난다. 면판 앞면보다 조금 더 앞에 세워야 면에 가려지지 않는다.
    for (const led of face.leds) {
      lamps.push({
        x: (led.x / face.faceWidth - .5) * RACK.faceWidth,
        y: y + (.5 - led.y / face.faceHeight) * itemHeight,
        z: FRONT_Z + .075,
        w: (led.w / face.faceWidth) * RACK.faceWidth,
        h: (led.h / face.faceHeight) * itemHeight,
        role: led.role,
        active: Boolean(view.active),
        load: led.role === 'status' ? view.load ?? null : view.trafficLoad ?? null,
        color: ledColor(led.role, led.role === 'status' ? view.load ?? null : view.trafficLoad ?? null, warningThreshold),
        seed: stableSeed(`${view.id}:${led.role}:${Math.round(led.x)}:${Math.round(led.y)}`),
      });
    }
    const faceMaterial = new THREE.MeshStandardMaterial({ map: face.texture, roughness: .46, metalness: .26 });
    const plate = addBox(RACK.faceWidth, itemHeight, .06, 0, y, FRONT_Z + .03, [chassisMaterial, chassisMaterial, chassisMaterial, chassisMaterial, faceMaterial, chassisMaterial]);
    plate.userData = chassis.userData;
    // 전원 도메인은 러그 색만으로는 멀리서 안 읽힌다. 장비 옆에 같은 색 띠를 세워 한 전원에 물린
    // 장비가 어디까지인지 랙 밖에서도 보이게 한다.
    if (view.domainColor) {
      const tint = new THREE.Color(view.domainColor);
      const stripe = addBox(.1, itemHeight, .2, -(RACK.faceWidth / 2 + .06), y, FRONT_Z + .02,
        new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: view.active ? .3 : .05, roughness: .5, metalness: .2 }));
      stripe.userData = chassis.userData;
    }
  }

  const run = freeRun(capacityU, views);
  if (run) {
    const { start, units } = run; const width = RACK.faceWidth - .26; const decalHeight = units * U - .07;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(width, decalHeight), new THREE.MeshBasicMaterial({ map: freeTexture(units, width, decalHeight), transparent: true, depthWrite: false }));
    decal.position.set(0, baseY + (start - 1) * U + units * U / 2, FRONT_Z + .02); group.add(decal);
  }

  // 랙 하나의 모든 불빛이 인스턴스 하나로 선다. 장비마다 메시를 세우면 42U 랙 몇 개에서
  // 드로우 콜이 수백 개가 되고, 매 프레임 색을 바꾸는 것이 그만큼 비싸진다.
  if (lamps.length) {
    const glow = new THREE.InstancedMesh(
      new THREE.CircleGeometry(.5, 10),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      lamps.length,
    );
    const matrix = new THREE.Matrix4(); const off = new THREE.Color(0x000000);
    lamps.forEach((spot, index) => {
      matrix.makeScale(Math.max(spot.w, .012), Math.max(spot.h, .012), 1);
      matrix.setPosition(spot.x, spot.y, spot.z);
      glow.setMatrixAt(index, matrix); glow.setColorAt(index, off);
    });
    glow.instanceMatrix.needsUpdate = true;
    // 불빛이 광선을 먼저 맞으면 그 뒤의 장비를 고를 수 없다.
    glow.raycast = () => {};
    glow.frustumCulled = false;
    group.add(glow);
    group.userData.lamps = { mesh: glow, spots: lamps };
  }

  const usedU = views.reduce((sum, view) => sum + view.uHeight, 0);
  const label = labelSprite(rack.name, note?.text || `${usedU}/${capacityU}U`, note?.status || 'ok');
  label.position.set(0, height + .62, 0); group.add(label);
  return group;
}

function cableTray(span, y) {
  const group = new THREE.Group(); group.userData = { tray: true };
  const material = new THREE.MeshStandardMaterial({ color: COLORS.tray, roughness: .55, metalness: .62 });
  for (const z of [REAR_PLANE - .3, REAR_PLANE + .3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, .07, .08), material); rail.position.set(0, y - .14, z); rail.castShadow = true; group.add(rail);
  }
  const rungs = Math.max(2, Math.round(span / .55));
  for (let index = 0; index <= rungs; index += 1) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(.05, .04, .6), material); rung.position.set(-span / 2 + index * (span / rungs), y - .14, REAR_PLANE); group.add(rung);
  }
  return group;
}

function cableColor(status, colorIndex = 0) {
  return status === 'disabled' || status === 'invalid' ? COLORS.downCable : status === 'warning' || status === 'overloaded' ? COLORS.warningCable : COLORS.cable[colorIndex % COLORS.cable.length];
}

function cableMaterial(status, colorIndex = 0) {
  const color = cableColor(status, colorIndex);
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: status === 'disabled' ? .08 : .28, roughness: .46, metalness: .05, transparent: status === 'disabled', opacity: status === 'disabled' ? .5 : 1 });
}

function cableTube(points, status, count = 1, colorIndex = 0) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', .35);
  const radius = Math.min(.058, .02 + Math.max(0, count - 1) * .006);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, radius, 6, false), cableMaterial(status, colorIndex));
  mesh.userData = { cable: true, cableCount: count, status }; return mesh;
}

function patchCord(points, status, colorIndex = 0) {
  const group = new THREE.Group(); group.userData = { cable: true, cableCount: 1, cableKind: 'patch' };
  group.add(cableTube(points, status, 1, colorIndex));
  const color = cableColor(status, colorIndex);
  for (const point of [points[0], points.at(-1)]) {
    const socket = new THREE.Mesh(new THREE.BoxGeometry(.1, .07, .06), new THREE.MeshStandardMaterial({ color: 0x10231f, roughness: .48, metalness: .35 }));
    socket.position.copy(point); socket.position.z += .02; group.add(socket);
    const plug = new THREE.Mesh(new THREE.BoxGeometry(.07, .045, .07), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .2, roughness: .42 }));
    plug.position.copy(point); plug.position.z -= .02; group.add(plug);
  }
  return group;
}

function stableSlot(deviceId, linkId) {
  let hash = 0; const value = `${deviceId}:${linkId}`;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash) % 7;
}

function cableRoutes(racks, links, positions, trayY) {
  const endpoints = new Map();
  for (const { rack, placements } of racks) {
    const spot = positions.get(rack.id); if (!spot) continue;
    for (const placement of placements.filter(({ deviceId }) => deviceId)) {
      endpoints.set(placement.deviceId, { rackId: rack.id, x: spot.x, y: spot.baseY + (placement.startU - 1 + placement.uHeight / 2) * U, z: FRONT_Z - chassisProfile(placement).depth - .07 });
    }
  }
  const eligible = (links || []).flatMap((link, index) => {
    const from = endpoints.get(link.source); const to = endpoints.get(link.target);
    if (!from || !to) return [];
    const port = (endpoint, deviceId) => ({ ...endpoint, portX: endpoint.x - 1.02 + stableSlot(deviceId, link.id) * .34 });
    return [{ link, index, from: port(from, link.source), to: port(to, link.target) }];
  });
  // 많은 랙 간 링크는 같은 트레이 경로를 공유한다. 여섯 개를 넘으면 중앙 높이의 번들 하나로 합친다.
  const groups = new Map();
  for (const edge of eligible) { const key = edge.from.rackId === edge.to.rackId ? edge.link.id : [edge.from.rackId, edge.to.rackId].sort().join(':'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(edge); }
  return [...groups.values()].map((edges, groupIndex) => {
    const bundled = edges.length > 6; const edge = edges[0];
    const from = bundled ? { ...edge.from, y: edges.reduce((sum, item) => sum + item.from.y, 0) / edges.length } : edge.from;
    const to = bundled ? { ...edge.to, y: edges.reduce((sum, item) => sum + item.to.y, 0) / edges.length } : edge.to;
    const disabled = edges.every(({ link }) => link.severed);
    const warning = edges.some(({ link }) => ['warning', 'overloaded', 'invalid'].includes(link.primaryStatus));
    const status = disabled ? 'disabled' : warning ? 'warning' : 'healthy';
    const start = new THREE.Vector3(from.portX, from.y, from.z);
    const end = new THREE.Vector3(to.portX, to.y, to.z);
    const side = (groupIndex % 2 ? 1 : -1) * (FRAME_WIDTH / 2 - .12);
    const lane = REAR_PLANE + .07 * (groupIndex % 3);
    if (from.rackId === to.rackId) {
      // 실제 배선처럼 뒤로 뺀 뒤 옆 레일을 타고 목표 U 로 간다. 밑으로 늘어뜨리면 랙 밖으로
      // 빠져나가 배선이 아니라 끊어진 줄로 보인다.
      const points = [start,
        new THREE.Vector3(start.x, start.y, lane),
        new THREE.Vector3(from.x + side, from.y, lane),
        new THREE.Vector3(from.x + side, to.y, lane),
        new THREE.Vector3(end.x, end.y, lane), end];
      return patchCord(points, status, groupIndex);
    }
    const direction = Math.sign(to.x - from.x) || 1; const exit = FRAME_WIDTH / 2 + .1;
    const points = [start,
      new THREE.Vector3(start.x, start.y, lane),
      new THREE.Vector3(from.x + direction * exit, from.y, lane),
      new THREE.Vector3(from.x + direction * exit, trayY, lane),
      new THREE.Vector3(to.x - direction * exit, trayY, lane),
      new THREE.Vector3(to.x - direction * exit, to.y, lane),
      new THREE.Vector3(end.x, end.y, lane), end];
    const tray = cableTube(points, status, edges.length, groupIndex); tray.userData.cableKind = 'tray'; return tray;
  });
}

export function createRackScene({ host, canvas, onSelect, onPlacementDrag = null, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdceae2); scene.fog = new THREE.Fog(0xdceae2, 52, 132);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 220); const world = new THREE.Group(); scene.add(world);
  scene.add(new THREE.HemisphereLight(0xe8f4ee, 0x16332d, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-16, 26, 22); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24; key.shadow.camera.right = 24; key.shadow.camera.top = 24; key.shadow.camera.bottom = -24; key.shadow.camera.near = .5; key.shadow.camera.far = 90; key.shadow.bias = -.0009; scene.add(key);
  const fill = new THREE.DirectionalLight(0xdff0e6, .62); fill.position.set(14, 9, 20); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xb8e737, .3); rim.position.set(18, 12, -16); scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: 0xbfd0c7, roughness: .92 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  const grid = new THREE.GridHelper(144, 40, 0x93ab9f, 0xaec3b7); grid.position.y = .012; grid.material.transparent = true; grid.material.opacity = .42; world.add(grid);
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const view = { yaw: -.48, pitch: .3, distance: 24, focus: 6 };
  // 랙마다 전면 U 구간을 선분으로 두고 광선과의 최단점을 찾는다. 평면 교차와 달리 옆에서 본
  // 각도에서도 답이 나오고, 선분 밖은 자동으로 양 끝 U로 잘린다.
  const dropSpan = [new THREE.Vector3(), new THREE.Vector3()]; const dropPoint = new THREE.Vector3();
  let dropZones = []; let preview = null; let candidates = []; let lampGroups = [];
  let dragging = null; let active = false; let frame = 0; let reduce = reducedMotion; let pickables = []; let face = 'front';
  let rackCount = 0; let cableCount = 0; let patchCableCount = 0; let trayBundleCount = 0; let framedFor = '';
  function placeCamera() {
    const cosine = Math.cos(view.pitch);
    camera.position.set(Math.sin(view.yaw) * cosine * view.distance, view.focus + Math.sin(view.pitch) * view.distance, Math.cos(view.yaw) * cosine * view.distance);
    camera.lookAt(0, view.focus, 0);
  }
  function resize() { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  const lampTint = new THREE.Color();
  function driveLamps(seconds) {
    for (const { mesh, spots } of lampGroups) {
      for (let index = 0; index < spots.length; index += 1) {
        const spot = spots[index];
        lampTint.setHex(spot.color).multiplyScalar(ledLevel(seconds, spot, reduce));
        mesh.setColorAt(index, lampTint);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  function renderFrame(now) { if (!active) return; driveLamps((now || 0) / 1000); placeCamera(); renderer.render(scene, camera); frame = requestAnimationFrame(renderFrame); }
  function disposeObject(object) { object.traverse((child) => { child.geometry?.dispose(); const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : []; for (const material of materials) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); } }); }
  function clear() { for (const child of [...world.children].slice(2)) { world.remove(child); disposeObject(child); } pickables = []; dropZones = []; preview = null; candidates = []; lampGroups = []; }
  function update({ racks, links = [], selectedPlacementId, showCables = false, warningThreshold = .8 }) {
    clear(); const spacing = FRAME_WIDTH + .5; const center = (racks.length - 1) * spacing / 2; const positions = new Map(); let tallest = 0;
    racks.forEach(({ rack, placements, note }, index) => {
      const x = index * spacing - center; const metrics = rackMetrics(rack); positions.set(rack.id, { x, ...metrics }); tallest = Math.max(tallest, metrics.height);
      dropZones.push({ rackId: rack.id, x, baseY: metrics.baseY, inner: metrics.inner, capacityU: metrics.capacityU });
      const group = cabinet(rack, placements, selectedPlacementId, note, warningThreshold); group.position.x = x; group.userData.rackId = rack.id; world.add(group);
      if (group.userData.lamps) lampGroups.push(group.userData.lamps);
      group.traverse((child) => { if (child.userData.pickable) pickables.push(child); });
    });
    rackCount = racks.length;
    const trayY = tallest + .45;
    const cables = showCables ? cableRoutes(racks, links, positions, trayY) : [];
    cables.forEach((cable) => world.add(cable));
    cableCount = cables.reduce((sum, cable) => sum + cable.userData.cableCount, 0);
    patchCableCount = cables.filter(({ userData }) => userData.cableKind === 'patch').length;
    trayBundleCount = cables.filter(({ userData }) => userData.cableKind === 'tray').length;
    if (trayBundleCount) world.add(cableTray((racks.length - 1) * spacing + FRAME_WIDTH + .7, trayY));
    // 화면 맞춤은 랙 구성이나 트레이 유무가 바뀔 때만 한다. 배치할 때마다 다시 맞추면 확대해 둔
    // 시점이 매번 풀린다.
    const top = trayBundleCount ? trayY + .4 : tallest;
    const framing = `${racks.map(({ rack }) => rack.id).join(',')}:${top.toFixed(2)}`;
    if (framing !== framedFor) {
      framedFor = framing;
      view.focus = top * .48;
      view.distance = Math.min(84, Math.max(13, top * 1.9, racks.length * spacing * 1.2));
    }
    // 광선 판정은 matrixWorld를 쓰는데 새로 만든 물체의 행렬은 다음 렌더 때에야 갱신된다. 선택으로 다시 그린
    // 직후의 더블클릭·우클릭이 옛 행렬로 아무것도 맞히지 못하므로 여기서 갱신한다.
    world.updateMatrixWorld(true);
  }
  function canvasPointer(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return false;
    pointer.x = ((clientX - box.left) / box.width) * 2 - 1; pointer.y = -((clientY - box.top) / box.height) * 2 + 1;
    return true;
  }
  // 캔버스 전체가 랙 무대다. 랙에서 떨어진 곳에 놓아도 가장 가까운 랙의 U로 받는다.
  function dropTarget(clientX, clientY) {
    if (!dropZones.length || !canvasPointer(clientX, clientY)) return null;
    raycaster.setFromCamera(pointer, camera);
    let best = null;
    for (const zone of dropZones) {
      dropSpan[0].set(zone.x, zone.baseY, FRONT_Z); dropSpan[1].set(zone.x, zone.baseY + zone.inner, FRONT_Z);
      const distance = raycaster.ray.distanceSqToSegment(dropSpan[0], dropSpan[1], null, dropPoint);
      if (!best || distance < best.distance) best = { distance, zone, y: dropPoint.y };
    }
    const positionU = Math.min(best.zone.capacityU - .001, Math.max(0, (best.y - best.zone.baseY) / U));
    const hoveredU = Math.floor(positionU) + 1;
    return { rackId: best.zone.rackId, hoveredU, positionU };
  }
  function setDropCandidates(list) {
    for (const pad of candidates) pad.visible = false;
    if (!list) return;
    list.forEach((item, index) => {
      const zone = dropZones.find(({ rackId }) => rackId === item.rackId);
      if (!zone) return;
      let pad = candidates[index];
      if (!pad) {
        pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: COLORS.ok, transparent: true, opacity: .2, depthWrite: false }));
        pad.rotation.x = -Math.PI / 2; world.add(pad); candidates[index] = pad;
      }
      pad.material.color.setHex(COLORS[item.status] ?? COLORS.ok);
      pad.material.opacity = item.status === 'blocked' ? .12 : .24;
      pad.scale.set(FRAME_WIDTH + .4, FRAME_DEPTH + .4, 1);
      pad.position.set(zone.x, .03, FRAME_Z);
      pad.visible = true;
    });
  }
  function setDropPreview(target) {
    const zone = target ? dropZones.find(({ rackId }) => rackId === target.rackId) : null;
    if (!zone) { if (preview) preview.visible = false; return; }
    if (!preview) {
      preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: .34, depthWrite: false }));
      world.add(preview);
    }
    // 자리만 비었다고 들어가는 것이 아니다. 전력 판정을 미리보기 색으로 같이 말한다.
    preview.material.color.setHex(COLORS[target.status] ?? COLORS.selected);
    preview.material.opacity = target.status === 'unknown' ? .26 : .34;
    const height = Math.max(.08, target.uHeight * U - .02);
    preview.scale.set(RACK.faceWidth, height, .1);
    preview.position.set(zone.x, zone.baseY + (target.startU - 1) * U + height / 2, FRONT_Z + .12);
    preview.visible = true;
  }
  function hitPlacement(clientX, clientY) {
    if (!canvasPointer(clientX, clientY)) return null;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickables, false).find(({ object }) => object.userData.placementId)?.object.userData ?? null;
  }
  // 장비가 아닌 틀·기둥·라벨을 눌러도 랙 메뉴를 열 수 있게, 맞은 물체에서 부모를 따라 올라가 랙 ID를 찾는다.
  function hitRack(clientX, clientY) {
    if (!canvasPointer(clientX, clientY)) return null;
    raycaster.setFromCamera(pointer, camera);
    for (const { object } of raycaster.intersectObjects(world.children.slice(2), true)) {
      for (let node = object; node; node = node.parent) if (node.userData.rackId) return { rackId: node.userData.rackId };
    }
    return null;
  }
  function reportPlacementDrag(phase, placement, event) { onPlacementDrag({ phase, rackId: placement.rackId, placementId: placement.placementId, clientX: event.clientX, clientY: event.clientY }); }
  canvas.addEventListener('pointerdown', (event) => {
    // 오른쪽 버튼은 랙 메뉴에 쓴다. 회전까지 받으면 메뉴를 열려고 누른 순간 시점이 흔들린다.
    if (event.button !== 0) return;
    // 장비를 집었으면 카메라를 돌리지 않고 재배치 드래그로 넘긴다.
    const placement = onPlacementDrag ? hitPlacement(event.clientX, event.clientY) : null;
    dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, placement };
    canvas.setPointerCapture(event.pointerId);
    if (placement) reportPlacementDrag('start', placement, event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    if (dragging.placement) { reportPlacementDrag('move', dragging.placement, event); return; }
    const dx = event.clientX - dragging.x; const dy = event.clientY - dragging.y; dragging.moved ||= Math.hypot(dx, dy) > 3;
    view.yaw -= dx * .007; view.pitch = THREE.MathUtils.clamp(view.pitch - dy * .006, .05, 1.2); dragging.x = event.clientX; dragging.y = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const held = dragging; dragging = null;
    if (held.placement) { reportPlacementDrag('end', held.placement, event); return; }
    if (!held.moved) { const hit = hitPlacement(event.clientX, event.clientY); if (hit) onSelect(hit); }
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const held = dragging; dragging = null;
    if (held.placement) reportPlacementDrag('cancel', held.placement, event);
  });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); view.distance = THREE.MathUtils.clamp(view.distance * Math.exp(event.deltaY * .001), 9, 90); }, { passive: false });
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return {
    update, dropTarget, setDropPreview, setDropCandidates, placementAt: (clientX, clientY) => hitPlacement(clientX, clientY), rackAt: (clientX, clientY) => hitRack(clientX, clientY),
    setFace(next) { if (!['front', 'rear'].includes(next) || face === next) return; face = next; view.yaw = face === 'rear' ? Math.PI - .48 : -.48; },
    start() { if (active) return; active = true; resize(); frame = requestAnimationFrame(renderFrame); },
    stop() { active = false; cancelAnimationFrame(frame); },
    reset() { view.yaw = face === 'rear' ? Math.PI - .48 : -.48; view.pitch = .3; },
    orbit(dx, dy) { view.yaw += dx; view.pitch = THREE.MathUtils.clamp(view.pitch + dy, .05, 1.2); },
    setReducedMotion(value) { reduce = Boolean(value); },
    dispose() { observer.disconnect(); clear(); renderer.dispose(); },
    debug() { return { renderer: 'WebGLRenderer', racks: rackCount, dropZones: dropZones.length, dropPreview: Boolean(preview?.visible), meshes: pickables.length, cables: cableCount, patchCables: patchCableCount, trayBundles: trayBundleCount, lamps: lampGroups.reduce((sum, { spots }) => sum + spots.length, 0), face, reducedMotion: reduce, unit: U, cabinet: CABINET }; },
  };
}
