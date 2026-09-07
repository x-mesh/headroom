// 노드 한 개를 무엇으로 그릴지 고르는 곳. 화면(public/app.js)과 내보내기(public/diagram.js)가
// 같은 함수를 부른다. 두 곳이 각자 축을 고르면 위키에 붙인 그림이 화면과 다른 말을 하게 된다.
//
// 여기서는 값만 고른다. 마크업과 색은 부르는 쪽이 정한다.
import { axisCatalog, behaviorCatalog } from './data.js';
import { GLYPHS } from './glyphs.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS } from './icons.js';

export const NODE_AXIS_LIMIT = 4;
export const STATE_TOKEN = { healthy: '.', warning: '!', overloaded: '>', unknown: '?', invalid: 'x', disabled: 'x' };
// 노드가 캔버스에서 차지하는 범위. 그룹 상자가 이 값으로 자식을 감싼다.
export const NODE_REACH = { left: 54, right: 54, top: 18, bottom: 122 };
export const GROUP_PAD = { base: 14, step: 8, label: 17 };

const AXIS_RANK = { overloaded: 0, invalid: 1, warning: 2, healthy: 3, unknown: 4 };
const SI_STEPS = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']];

const KIND_INITIAL = {
  switch: 'SW', router: 'RT', hub: 'HB', modem: 'MD', wireless: 'WL',
  firewall: 'FW', ips: 'IPS', waf: 'WAF', lb: 'LB', vpn: 'VPN', sslvpn: 'SSL',
  server: 'SRV', web: 'WEB', vm: 'VM', db: 'DB', mail: 'ML', mainframe: 'MF',
  storage: 'ST', nas: 'NAS', backup: 'BK', client: 'CL', cloud: 'EXT', rack: 'RK',
};
const KIND_ALIAS = { 'load-balancer': 'lb', loadbalancer: 'lb', balancer: 'lb', host: 'server', compute: 'server', vm: 'server', nas: 'storage', san: 'storage' };

export const kindInitial = (kind) => KIND_INITIAL[String(kind).toLowerCase()] || String(kind).slice(0, 3).toUpperCase();
export const nodeAxisLabel = (key) => axisCatalog[key]?.nodeLabel || key.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
export const zonePath = (zone) => String(zone || '').split('/').map((part) => part.trim()).filter(Boolean);

/** 노드 폭 안에 들어가도록 단위를 떼고 5자 이내로 줄인다. 단위는 축 이름 열이 지시한다. */
export function formatNodeValue(value, reference = value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  // 단위와 소수 자리는 정착값이 정한다. 떨리는 값이 자릿수까지 정하면 10.0G 가 9.85G 와
  // 10.2G 사이를 오가며 열 너비가 춤춘다 - 움직임이 아니라 고장으로 읽힌다.
  const anchor = Number.isFinite(reference) ? reference : value;
  const [factor, suffix] = SI_STEPS.find(([step]) => Math.abs(anchor) >= step) || [1, ''];
  const scaled = value / factor;
  const scaledAnchor = anchor / factor;
  return `${scaledAnchor >= 100 ? Math.round(scaled) : scaled.toFixed(scaledAnchor >= 10 ? 1 : 2)}${suffix}`;
}

export function formatNodePercent(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** kind 는 임의 문자열이라 목록 밖 값이 들어온다. 화이트리스트를 통과한 이름만 돌려준다. */
export function symbolFor(kind) {
  const key = String(kind ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // 목록에 정확히 있는 kind 는 별칭보다 앞선다. 그러지 않으면 vm 이 server 심볼로 그려진다.
  const exact = ICONS[key] ? key : (KIND_ALIAS[key] || key);
  const name = ICONS[exact] ? exact : (ICON_KINDS.find((candidate) => key.includes(candidate)) || ICON_FALLBACK);
  // 스텐실이 클래스를 구별해 주지 못해 손으로 그린 심볼이 있으면 그것이 스텐실보다 앞선다.
  return GLYPHS[name] || ICONS[name];
}

export function behaviorToken(device) {
  const catalog = behaviorCatalog[device.kind];
  if (!catalog) return '';
  return catalog.options[device.behavior?.mode ?? catalog.default]?.token || '';
}

/** 선별은 심각도 순으로, 순서는 limits 삽입 순서로. 문제 축은 반드시 노출하면서 행 순서는 흔들리지 않는다. */
export function nodeAxes(device) {
  const entries = Object.entries(device.axes);
  if (entries.length <= NODE_AXIS_LIMIT) return { rows: entries, hidden: 0 };
  const keep = new Set([...entries]
    .sort((a, b) => (AXIS_RANK[a[1].status] ?? 9) - (AXIS_RANK[b[1].status] ?? 9) || (b[1].utilization ?? -1) - (a[1].utilization ?? -1) || a[0].localeCompare(b[0]))
    .slice(0, NODE_AXIS_LIMIT).map(([key]) => key));
  return { rows: entries.filter(([key]) => keep.has(key)), hidden: entries.length - keep.size };
}

/**
 * 노드 하나가 말해야 하는 것 전부. 화면과 내보내기가 이 결과만 읽는다.
 * spof 는 훑기 결과가 있을 때만 채운다 — 없으면 단일 장애점 여부를 모른다는 뜻이지 아니라는 뜻이 아니다.
 */
export function nodeView(device, { verdict = null, poolNote = '' } = {}) {
  const status = device.active ? device.primaryStatus : 'disabled';
  const { rows, hidden } = nodeAxes(device);
  const spof = Boolean(device.active && verdict?.verdict === 'severs' && !verdict.endpoint);
  const idle = device.active && !poolNote && !device.carriesDemand ? '트래픽 수요 없음' : '';
  return {
    id: device.id,
    name: device.name || device.id,
    model: device.model || '',
    vendor: device.vendor || '',
    kind: device.kind,
    kindToken: kindInitial(device.kind),
    symbol: symbolFor(device.kind),
    status,
    spof,
    hidden,
    // 이미 죽은 장비에 "이게 죽으면 끊긴다"와 숨긴 축 개수를 붙이는 것은 소음이다.
    meta: [String(device.kind).toUpperCase(), behaviorToken(device), zonePath(device.zone).at(-1) || device.zone,
      spof ? 'SPOF' : '', device.active && hidden ? `+${hidden}` : '', poolNote, idle].filter(Boolean).join(' · '),
    // 죽은 장비에 축별 숫자를 남기면 아직 도는 것처럼 읽힌다. 화면과 같이 한 줄로 줄인다.
    axes: !device.active ? [{ key: 'offline', label: 'OFFLINE', token: 'x', status: 'disabled', binding: false, load: '—', percent: 'DOWN', util: null }] : rows.map(([key, axis]) => ({
      key,
      label: nodeAxisLabel(key),
      token: STATE_TOKEN[axis.status] || '?',
      status: axis.status,
      binding: key === device.bindingAxis,
      load: formatNodeValue(axis.load),
      // unknown 은 백분율을 만들지 않는다. 0% 로 적으면 미확인이 안전으로 읽힌다.
      percent: axis.status === 'unknown' ? '—' : axis.status === 'invalid' ? 'ERR' : formatNodePercent(axis.utilization),
      util: axis.utilization == null ? null : Math.min(axis.utilization, 1.5),
    })),
  };
}

/** zone 의 슬래시 계층으로 중첩 상자를 만든다. 얕은 그룹일수록 여백이 커야 자식을 감싼 것으로 읽힌다. */
export function groupBoxes(devices) {
  const byPath = new Map();
  for (const device of devices) {
    const path = zonePath(device.zone);
    for (let depth = 1; depth <= path.length; depth += 1) {
      const key = path.slice(0, depth).join(' / ');
      const entry = byPath.get(key) || { key, label: path[depth - 1], depth, box: null };
      const box = entry.box || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      entry.box = {
        minX: Math.min(box.minX, device.position.x - NODE_REACH.left),
        minY: Math.min(box.minY, device.position.y - NODE_REACH.top),
        maxX: Math.max(box.maxX, device.position.x + NODE_REACH.right),
        maxY: Math.max(box.maxY, device.position.y + NODE_REACH.bottom),
      };
      byPath.set(key, entry);
    }
  }
  const deepest = Math.max(0, ...[...byPath.values()].map(({ depth }) => depth));
  return [...byPath.values()]
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key))
    .map((entry) => {
      const pad = GROUP_PAD.base + (deepest - entry.depth) * GROUP_PAD.step;
      return {
        key: entry.key, label: entry.label, depth: entry.depth,
        x: entry.box.minX - pad, y: entry.box.minY - pad - GROUP_PAD.label,
        width: entry.box.maxX - entry.box.minX + pad * 2,
        height: entry.box.maxY - entry.box.minY + pad * 2 + GROUP_PAD.label,
      };
    });
}

// 라벨이 놓이는 자리를 정한다. 화면과 내보내기가 같은 함수를 부른다 — 한쪽에만 보이는 숫자가
// 있으면 위키에 붙인 그림이 화면과 다른 말을 한다.
//
// 선은 하나도 지우지 않는다. 무엇이 무엇에 붙어 있는지가 그림의 절반이기 때문이다. 그런데
// 글자는 같은 자리에 둘을 놓을 수 없어서, 링크 50개가 넘으면 라벨의 절반이 서로를 덮어 하나도
// 못 읽게 된다. 그래서 심각한 것부터 자리를 잡고, 밀린 것은 선을 따라 조금 비켜 본다.
// 그래도 자리가 없으면 그리지 않는다 — 링크를 누르면 인스펙터가 그 값을 그대로 말한다.
const LABEL_RANK = { overloaded: 0, invalid: 1, disabled: 2, 'severed-path': 3, 'on-severed-path': 3, warning: 4, unknown: 5, healthy: 6 };
// 선 위 어디에 놓아 볼지. 가운데가 먼저이고, 밀리면 양쪽으로 번갈아 비킨다.
const LABEL_SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
const LABEL_CHAR = 5.4;
const LABEL_ROW = 11;

export const LINK_ROUTES = Object.freeze(['straight', 'orthogonal', 'curved']);
// 통로를 옆으로 옮기는 폭과, 몇 칸까지 밀어 볼지. 넓히면 더 잘 피하지만 마디가 멀리 튄다.
const LANE_STEP = 30;
const LANE_TRIES = 5;
// 곡선 모드에서 곧게 갈 수 있는 선도 살짝 부풀린다. 겹쳐 지나는 두 선이 갈려 보인다.
const BOW_RATIO = 0.11;
const BOW_MAX = 30;

/** 노드 카드가 차지하는 상자. 라벨이 피하는 자리와 같은 상자를 선도 피한다. */
export const cardBox = (position) => ({
  left: position.x - NODE_REACH.left, right: position.x + NODE_REACH.right,
  top: position.y - NODE_REACH.top, bottom: position.y + NODE_REACH.bottom,
});

/** 선분이 상자와 겹치는지. Liang-Barsky 로 매개변수 구간을 잘라, 남는 구간이 있으면 겹친 것이다. */
export function segmentHitsBox(a, b, box) {
  let enter = 0; let leave = 1;
  const dx = b.x - a.x; const dy = b.y - a.y;
  for (const [slope, room] of [[-dx, a.x - box.left], [dx, box.right - a.x], [-dy, a.y - box.top], [dy, box.bottom - a.y]]) {
    if (slope === 0) { if (room < 0) return false; continue; }
    const cut = room / slope;
    if (slope < 0) { if (cut > leave) return false; if (cut > enter) enter = cut; }
    else { if (cut < enter) return false; if (cut < leave) leave = cut; }
  }
  return true;
}

const pathClear = (points, obstacles) => points.every((point, index) =>
  index === 0 || !obstacles.some((box) => segmentHitsBox(points[index - 1], point, box)));

/**
 * 두 점을 잇는 마디를 정한다. 직선은 두 점 그대로이고, 나머지는 노드 카드를 비켜 갈 통로를
 * 찾는다. 통로를 못 찾으면 곧게 잇는다 - 못 피한 것을 피한 것처럼 굽히면 그림이 거짓말을 한다.
 *
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {{left:number,right:number,top:number,bottom:number}[]} obstacles 양 끝 노드는 빼고 넣는다.
 * @param {'straight'|'orthogonal'|'curved'} mode
 * @returns {{x:number,y:number}[]} 마디. 화면과 내보내기가 같은 이 배열로 그린다.
 */
export function routeLink(from, to, obstacles = [], mode = 'straight') {
  if (mode !== 'orthogonal' && mode !== 'curved') return [from, to];
  if (pathClear([from, to], obstacles)) {
    if (mode === 'orthogonal') return [from, to];
    // 곧게 갈 수 있어도 곡선은 부풀린다. 길이에 비례하되 상한을 둬 짧은 선이 고리가 되지 않게 한다.
    const dx = to.x - from.x; const dy = to.y - from.y;
    const span = Math.hypot(dx, dy);
    if (span < 1) return [from, to];
    const bow = Math.min(span * BOW_RATIO, BOW_MAX);
    // 부풀린 배가 남의 카드에 닿을 수 있다. 반대쪽으로도 재 보고, 둘 다 걸리면 곧게 둔다 -
    // 피하려고 부풀린 선이 도리어 숫자를 가리면 굽힌 값어치가 없다.
    for (const side of [1, -1]) {
      const arc = [from, { x: (from.x + to.x) / 2 - (dy / span) * bow * side, y: (from.y + to.y) / 2 + (dx / span) * bow * side }, to];
      if (pathClear(arc, obstacles)) return arc;
    }
    return [from, to];
  }
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const vertical = []; const horizontal = [];
  for (let step = 0; step <= LANE_TRIES; step += 1) {
    for (const side of step ? [1, -1] : [1]) {
      const shift = side * step * LANE_STEP;
      vertical.push([from, { x: midX + shift, y: from.y }, { x: midX + shift, y: to.y }, to]);
      horizontal.push([from, { x: from.x, y: midY + shift }, { x: to.x, y: midY + shift }, to]);
    }
  }
  // 가로로 먼 링크는 세로 통로부터 본다. 긴 쪽을 가로질러야 마디가 덜 튀어 나간다.
  const wide = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const ordered = wide ? [...vertical, ...horizontal] : [...horizontal, ...vertical];
  return ordered.find((points) => pathClear(points, obstacles)) ?? [from, to];
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * 마디를 SVG 경로 문자열로 옮긴다. 직각은 마디를 그대로 잇고, 곡선은 꺾인 자리를 둥글게 지난다.
 * 라벨과 패킷 점이 같은 마디를 쓰므로, 그리는 방식만 여기서 갈린다.
 */
export function linkPath(points, mode = 'straight') {
  const at = (point) => `${round(point.x)} ${round(point.y)}`;
  if (mode !== 'curved' || points.length < 3) return `M ${points.map(at).join(' L ')}`;
  const half = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M ${at(points[0])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    // 앞뒤 마디의 가운데로 물러났다가 꼭짓점을 제어점 삼아 지난다. 이어 붙이면 매끈해진다.
    const enter = half(points[index - 1], points[index]);
    const leave = half(points[index], points[index + 1]);
    // L 을 매 마디마다 다시 쓴다. 빼면 뒤따르는 좌표쌍이 앞 Q 의 인자로 읽혀 경로가 깨진다.
    // 꺾인 자리가 이어지면 앞 곡선의 끝과 다음 L 의 도착점이 같아 길이 0 이라 그림은 그대로다.
    d += ` L ${at(enter)} Q ${at(points[index])} ${at(leave)}`;
  }
  return `${d} L ${at(points.at(-1))}`;
}

/**
 * @param {{id:string, text:string, status:string, util:number|null, binding:boolean, from:{x,y}, to:{x,y}}[]} entries
 * @param {{x:number, y:number}[]} nodes 노드 중심. 카드가 라벨을 덮으므로 그 자리는 피한다.
 * @returns {Map<string, {x:number, y:number}>} 자리를 얻은 라벨만 담는다.
 */
export function placeLinkLabels(entries, nodes = []) {
  // 노드 카드는 라벨보다 위에 그려진다. 카드 안에 놓은 라벨은 자리를 얻은 것처럼 보이지만
  // 실제로는 가려서 안 보인다 - 겹침만 세면 그 절반을 놓친다.
  const cards = nodes.map((node) => ({
    x1: node.x - NODE_REACH.left, x2: node.x + NODE_REACH.right,
    y1: node.y - NODE_REACH.top, y2: node.y + NODE_REACH.bottom,
  }));
  const covered = (x, y) => cards.some((card) => x > card.x1 && x < card.x2 && y > card.y1 && y < card.y2);
  const placed = [];
  const spots = new Map();
  // 제목이 부르는 링크는 반드시 남긴다. 화면이 이름을 말하는데 캔버스에 그 숫자가 없으면 안 된다.
  const rank = (entry) => (entry.binding ? -1 : LABEL_RANK[entry.status] ?? 9);
  const ordered = [...entries].sort((a, b) => rank(a) - rank(b) || (b.util ?? -1) - (a.util ?? -1) || a.id.localeCompare(b.id));
  for (const entry of ordered) {
    const width = String(entry.text).length * LABEL_CHAR + 3;
    for (const along of LABEL_SPOTS) {
      const x = entry.from.x + (entry.to.x - entry.from.x) * along;
      const y = entry.from.y + (entry.to.y - entry.from.y) * along - 7;
      if (covered(x, y)) continue;
      if (placed.some((box) => Math.abs(box.x - x) < (box.width + width) / 2 && Math.abs(box.y - y) < LABEL_ROW)) continue;
      placed.push({ x, y, width });
      spots.set(entry.id, { x, y });
      break;
    }
  }
  return spots;
}
