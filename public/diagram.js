import { axisCatalog } from './data.js';
import { formatNodePercent, groupBoxes, nodeView, placeLinkLabels } from './node-view.js';
const clone = (value) => structuredClone(value);
const coordinate = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new Error('좌표는 ±1,000,000 이내의 유한한 값이어야 합니다.');
  return n;
};
// 좌표는 소수 3자리로 고정한다. 내보낸 파일을 diff 할 수 있어야 한다.
const fmt = (value) => String(Math.round(Number(value) * 1000) / 1000);
const empty = () => ({ shapes: [], connectors: [], groups: [] });
const draft = (topology) => { const next = clone(topology); next.diagram = { ...empty(), ...next.diagram }; return next; };
const allIds = (t) => new Set([...(t.devices || []), ...(t.links || []), ...(t.diagram?.shapes || []), ...(t.diagram?.connectors || []), ...(t.diagram?.groups || [])].map((item) => item.id));
function fresh(ids, prefix) { let n = 1; while (ids.has(`${prefix}-${n}`)) n++; const id = `${prefix}-${n}`; ids.add(id); return id; }
function shape(input) {
  if (!['rect', 'ellipse', 'text', 'note'].includes(input.kind)) throw new Error('지원하지 않는 도형입니다.');
  const result = { ...input, text: String(input.text ?? '').slice(0, 10000), x: coordinate(input.x ?? 100), y: coordinate(input.y ?? 100), width: coordinate(input.width ?? 160), height: coordinate(input.height ?? 80) };
  if (result.width <= 0 || result.height <= 0) throw new Error('도형 크기는 양수여야 합니다.');
  return result;
}
export function addShape(topology, kind, props = {}) {
  const next = draft(topology); const ids = allIds(next);
  if (props.id && (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(props.id) || ids.has(props.id))) throw new Error('도형 ID가 잘못되었거나 중복됩니다.');
  next.diagram.shapes.push(shape({ ...props, kind, id: props.id || fresh(ids, 'shape') })); return next;
}
export function addConnector(topology, input) {
  const next = draft(topology); const ids = allIds(next);
  const endpoints = new Set([...(next.devices || []).map(({ id }) => id), ...next.diagram.shapes.map(({ id }) => id)]);
  if (!endpoints.has(input.source) || !endpoints.has(input.target) || input.source === input.target) throw new Error('연결선에는 서로 다른 두 대상이 필요합니다.');
  const kind = input.kind || 'annotation';
  if (!['annotation', 'dependency'].includes(kind)) throw new Error('지원하지 않는 연결선입니다.');
  if (input.id && (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id) || ids.has(input.id))) throw new Error('연결선 ID가 잘못되었거나 중복됩니다.');
  const id = input.id || fresh(ids, 'connector');
  next.diagram.connectors.push({ id, source: input.source, target: input.target, kind, label: String(input.label || '').slice(0, 1000), waypoints: (input.waypoints || []).map(({ x, y }) => ({ x: coordinate(x), y: coordinate(y) })) });
  return next;
}
export function updateShape(topology, id, patch) {
  const next = draft(topology); const index = next.diagram.shapes.findIndex((s) => s.id === id);
  if (index < 0) throw new Error('도형을 찾을 수 없습니다.');
  next.diagram.shapes[index] = shape({ ...next.diagram.shapes[index], ...patch, id }); return next;
}
function expanded(topology, selection) {
  const selected = new Set(selection.filter((s) => s.type === 'device' || s.type === 'shape').map((s) => s.id));
  for (const s of selection.filter((s) => s.type === 'group')) {
    for (const id of topology.diagram?.groups?.find((g) => g.id === s.id)?.memberIds || []) selected.add(id);
  }
  return selected;
}
function boxes(topology, selection) {
  const ids = expanded(topology, selection);
  return [...(topology.devices || []).filter((d) => ids.has(d.id)).map((d) => ({ item: d, x: d.position.x - 64, y: d.position.y - 40, width: 128, height: 80, device: true })), ...topology.diagram.shapes.filter((s) => ids.has(s.id)).map((s) => ({ item: s, x: s.x, y: s.y, width: s.width, height: s.height }))];
}
function position(box, x, y) {
  const point = { x: coordinate(x), y: coordinate(y) };
  if (box.device) box.item.position = { x: coordinate(point.x + 64), y: coordinate(point.y + 40) };
  else Object.assign(box.item, point);
}
export function moveSelection(topology, selection, dx, dy, { grid = 0 } = {}) {
  const next = draft(topology); coordinate(dx); coordinate(dy);
  if (!Number.isFinite(grid) || grid < 0) throw new Error('격자 크기가 잘못되었습니다.');
  const snap = (n) => grid ? Math.round(n / grid) * grid : n;
  const items = boxes(next, selection);
  // One common offset preserves the relative layout of a multiple selection.
  const reference = items[0];
  const deltaX = reference ? snap((reference.device ? reference.item.position.x : reference.x) + Number(dx)) - (reference.device ? reference.item.position.x : reference.x) : Number(dx);
  const deltaY = reference ? snap((reference.device ? reference.item.position.y : reference.y) + Number(dy)) - (reference.device ? reference.item.position.y : reference.y) : Number(dy);
  for (const b of items) position(b, b.x + deltaX, b.y + deltaY);
  const ids = new Set(items.map((b) => b.item.id));
  for (const edge of [...(next.links || []), ...next.diagram.connectors]) {
    if (ids.has(edge.source) && ids.has(edge.target) && edge.waypoints) edge.waypoints = edge.waypoints.map((p) => ({ x: coordinate(p.x + deltaX), y: coordinate(p.y + deltaY) }));
  }
  return next;
}
export function alignSelection(topology, selection, mode) {
  const next = draft(topology); const items = boxes(next, selection); if (!items.length) return next;
  if (!['left', 'right', 'top', 'bottom', 'center', 'middle'].includes(mode)) throw new Error('정렬 방향이 잘못되었습니다.');
  const left = Math.min(...items.map((b) => b.x)), right = Math.max(...items.map((b) => b.x + b.width));
  const top = Math.min(...items.map((b) => b.y)), bottom = Math.max(...items.map((b) => b.y + b.height));
  for (const b of items) position(b, mode === 'left' ? left : mode === 'right' ? right - b.width : mode === 'center' ? (left + right - b.width) / 2 : b.x, mode === 'top' ? top : mode === 'bottom' ? bottom - b.height : mode === 'middle' ? (top + bottom - b.height) / 2 : b.y);
  return next;
}
export function distributeSelection(topology, selection, axis = 'x') {
  if (!['x', 'y'].includes(axis)) throw new Error('분배 축이 잘못되었습니다.');
  const next = draft(topology); const size = axis === 'x' ? 'width' : 'height';
  const items = boxes(next, selection).sort((a, b) => a[axis] - b[axis]); if (items.length < 3) return next;
  const first = items[0], last = items.at(-1);
  const gap = (last[axis] + last[size] - first[axis] - items.reduce((sum, b) => sum + b[size], 0)) / (items.length - 1);
  let offset = first[axis];
  for (const b of items) { position(b, axis === 'x' ? offset : b.x, axis === 'y' ? offset : b.y); offset += b[size] + gap; }
  return next;
}
export function groupSelection(topology, selection, name = '그룹') {
  const next = draft(topology); const members = boxes(next, selection).map((b) => b.item.id); if (members.length < 2) return next;
  next.diagram.groups = next.diagram.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => !members.includes(id)) })).filter((g) => g.memberIds.length);
  next.diagram.groups.push({ id: fresh(allIds(next), 'group'), name: String(name).slice(0, 200), memberIds: members }); return next;
}
export function ungroupSelection(topology, selection) {
  const next = draft(topology); const ids = new Set(selection.map((s) => s.id));
  next.diagram.groups = next.diagram.groups.filter((g) => !ids.has(g.id) && !g.memberIds.some((id) => ids.has(id))); return next;
}
export function removeDiagramElements(topology, selection) {
  const next = draft(topology); const ids = new Set(selection.filter((s) => s.type === 'shape').map((s) => s.id));
  const connectors = new Set(selection.filter((s) => s.type === 'connector').map((s) => s.id));
  next.diagram.shapes = next.diagram.shapes.filter((s) => !ids.has(s.id));
  next.diagram.connectors = next.diagram.connectors.filter((c) => !connectors.has(c.id) && !ids.has(c.source) && !ids.has(c.target));
  next.diagram.groups = next.diagram.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => !ids.has(id)) })).filter((g) => g.memberIds.length && !selection.some((s) => s.type === 'group' && s.id === g.id));
  return next;
}
/**
 * 복제는 장비만이 아니라 그 장비가 물려 있던 자리까지 옮긴다. 안쪽 링크(양 끝이 다 선택 안)는
 * 통째로 따라오고, 바깥 링크(한 끝만 선택 안)는 edges 로 따로 담아 붙여넣을 때 원본이 물려
 * 있던 상대에 다시 잇는다. 이어 놓지 않으면 지나는 수요가 없어 아무것도 계산되지 않는다.
 * 트래픽 수요는 복제하지 않는다 — 그것은 설계가 아니라 그 설계에 무엇을 흘릴지에 대한
 * 선언이라, 복제하면 사용자가 적지 않은 부하가 생긴다.
 */
export function copySelection(topology, selection) {
  const ids = expanded(topology, selection);
  const inside = (link) => ids.has(link.source) && ids.has(link.target);
  const touching = (link) => ids.has(link.source) !== ids.has(link.target);
  return clone({ devices: (topology.devices || []).filter((d) => ids.has(d.id)), links: (topology.links || []).filter(inside), edges: (topology.links || []).filter(touching), diagram: { shapes: (topology.diagram?.shapes || []).filter((s) => ids.has(s.id)), connectors: (topology.diagram?.connectors || []).filter((c) => ids.has(c.source) && ids.has(c.target)), groups: (topology.diagram?.groups || []).filter((g) => g.memberIds.every((id) => ids.has(id))) } });
}
export function pasteSelection(topology, clipboard, { dx = 24, dy = 24 } = {}) {
  coordinate(dx); coordinate(dy); const next = draft(topology), copy = draft(clipboard), ids = allIds(next), map = new Map(), selection = [];
  const collections = [['device', copy.devices || [], next.devices ||= []], ['shape', copy.diagram.shapes, next.diagram.shapes], ['link', copy.links || [], next.links ||= []], ['connector', copy.diagram.connectors, next.diagram.connectors], ['group', copy.diagram.groups, next.diagram.groups]];
  for (const [type, items] of collections) for (const item of items) map.set(item.id, fresh(ids, type));
  for (const [type, items, target] of collections) for (const item of items) {
    item.id = map.get(item.id);
    if (type === 'device') { item.position.x = coordinate(item.position.x + Number(dx)); item.position.y = coordinate(item.position.y + Number(dy)); }
    if (type === 'shape') { item.x = coordinate(item.x + Number(dx)); item.y = coordinate(item.y + Number(dy)); }
    // 링크와 커넥터의 source/target 만 끝점이다. 장비의 source 는 그 값을 어디서 얻었는지를
    // 적은 출처 객체라, 여기서 함께 다시 가리키면 출처가 통째로 사라지고 인스펙터가 멈춘다.
    if (type === 'link' || type === 'connector') {
      if (item.source) item.source = map.get(item.source) ?? item.source;
      if (item.target) item.target = map.get(item.target) ?? item.target;
    }
    if (item.groupId) item.groupId = map.get(item.groupId);
    if (item.memberIds) item.memberIds = item.memberIds.map((id) => map.get(id));
    if (item.waypoints) item.waypoints = item.waypoints.map((p) => ({ x: coordinate(p.x + Number(dx)), y: coordinate(p.y + Number(dy)) }));
    target.push(item); if (type === 'device' || type === 'shape') selection.push({ type, id: item.id });
  }
  // 바깥 링크는 선택 밖의 상대를 가리킨다. 그 상대는 새로 만들지 않고 원래 있던 장비에 그대로
  // 잇는다. 그 사이에 지워졌으면 만들지 않는다 — 없는 장비를 가리키는 링크는 계산 전체를 멈춘다.
  const devices = new Set((next.devices || []).map(({ id }) => id));
  for (const edge of copy.edges || []) {
    const source = map.get(edge.source) ?? edge.source;
    const target = map.get(edge.target) ?? edge.target;
    if (source === target || !devices.has(source) || !devices.has(target)) continue;
    next.links.push({ ...edge, id: fresh(ids, 'link'), source, target });
  }
  return { topology: next, selection };
}
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// 내보낸 그림은 남의 문서 안에서 혼자 서 있어야 한다. 스타일시트도 스프라이트도 따라가지
// 않으므로 색을 리터럴로 적고 심볼을 인라인으로 넣는다. styles.css 의 라이트 테마 토큰과
// 같은 값이다 — 한쪽을 바꾸면 다른 쪽도 바꾼다.
const INK = {
  canvas: '#eaf2ed', surface: '#f7faf7', raised: '#ffffff', line: '#9eb9ad', lineSoft: '#c9d9d1',
  text: '#13241f', muted: '#526e64', cyan: '#0f6d68', amber: '#9a5a00', danger: '#b83c34', unknown: '#5c7a70', signal: '#587d00',
};
const STATE_INK = { healthy: INK.cyan, warning: INK.amber, overloaded: INK.danger, unknown: INK.unknown, invalid: INK.danger, disabled: INK.danger };
const LINK_INK = { healthy: INK.cyan, warning: INK.amber, overloaded: INK.danger, unknown: INK.unknown, invalid: INK.danger, disabled: INK.danger, 'severed-path': INK.danger };
const LINK_DASH = { unknown: '5 4', invalid: '2 3', disabled: '7 7', 'severed-path': '2 6' };
// 굵기가 심각도를 말한다. styles.css 의 .link 사다리와 같은 값이다 — 한쪽을 바꾸면 다른 쪽도 바꾼다.
const LINK_WIDTH = { healthy: 1, unknown: 1.5, warning: 2.5, overloaded: 4, invalid: 2.5, disabled: 2, 'severed-path': 2 };

// 화면의 노드 규격과 같다(styles.css .mesh-node). 캔버스와 그림이 어긋나면 둘 중 하나가 거짓말이다.
const NODE = { width: 104, symbolH: 42, glyphW: 88, glyphH: 40, railW: 92, rowH: 13, headH: 12, modelH: 11, metaH: 11 };

const text = (x, y, value, { size = 9, fill = INK.text, weight = 400, anchor = 'start', halo = false, family = 'ui-monospace, SFMono-Regular, Menlo, monospace' } = {}) =>
  `<text x="${fmt(x)}" y="${fmt(y)}" fill="${fill}" font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"`
  + (halo ? ` stroke="${INK.canvas}" stroke-width="3" paint-order="stroke"` : '')
  + `>${xml(value)}</text>`;

// 심볼은 스텐실이 정한 viewBox 를 그대로 쓰고, 노드 칸 안에 비율을 지켜 앉힌다.
function symbolMarkup(symbol, cx, top) {
  const [minX, minY, vw, vh] = symbol.viewBox.split(' ').map(Number);
  const scale = Math.min(NODE.glyphW / vw, NODE.glyphH / vh);
  const width = vw * scale;
  const height = vh * scale;
  const x = cx - width / 2;
  const y = top + (NODE.glyphH - height) / 2;
  const body = symbol.body
    .replace(/var\(--icon-fill,\s*none\)/g, INK.canvas)
    .replace(/var\(--icon-line,\s*currentColor\)/g, INK.text)
    .replace(/var\(--icon-accent,\s*#ffffff\)/g, INK.raised);
  return `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)}) translate(${fmt(-minX)} ${fmt(-minY)})">${body}</g>`;
}

function nodeMarkup(view, device) {
  const cx = coordinate(device.position.x);
  const top = coordinate(device.position.y) - NODE.symbolH / 2;
  const left = cx - NODE.width / 2;
  const parts = [symbolMarkup(view.symbol, cx, top)];
  // 죽은 장비에는 심볼 위로 가위표를 긋는다. 색만으로는 죽은 것과 위험한 것이 같아 보인다.
  if (view.status === 'disabled') {
    const mid = top + NODE.glyphH / 2 + 1;
    const arm = 20;
    parts.push(`<line x1="${fmt(cx - arm)}" y1="${fmt(mid - arm)}" x2="${fmt(cx + arm)}" y2="${fmt(mid + arm)}" stroke="${INK.danger}" stroke-width="2"/>`);
    parts.push(`<line x1="${fmt(cx - arm)}" y1="${fmt(mid + arm)}" x2="${fmt(cx + arm)}" y2="${fmt(mid - arm)}" stroke="${INK.danger}" stroke-width="2"/>`);
  }
  let y = top + NODE.symbolH;
  // 상태 레일. 색과 함께 파선으로도 구분한다 — 색만으로 구분하지 않는다(DESIGN.md).
  const railDash = ['unknown', 'disabled'].includes(view.status) ? ' stroke-dasharray="4 4"' : '';
  parts.push(`<line x1="${fmt(cx - NODE.railW / 2)}" y1="${fmt(y + 1)}" x2="${fmt(cx + NODE.railW / 2)}" y2="${fmt(y + 1)}" stroke="${STATE_INK[view.status] || INK.cyan}" stroke-width="2"${railDash}/>`);
  y += NODE.headH;
  parts.push(text(cx, y, view.name, { size: 10, weight: 600, anchor: 'middle' }));
  if (view.model) { y += NODE.modelH; parts.push(text(cx, y, view.model, { size: 8, fill: INK.muted, anchor: 'middle' })); }
  for (const axis of view.axes) {
    y += NODE.rowH;
    const ink = STATE_INK[axis.status] || INK.muted;
    parts.push(text(left + 2, y, axis.token, { size: 8, weight: 700, fill: ink }));
    parts.push(text(left + 12, y, axis.label, { size: 8, weight: axis.binding ? 700 : 500, fill: axis.binding ? INK.text : INK.muted }));
    parts.push(text(left + 62, y, axis.load, { size: 8, anchor: 'end' }));
    parts.push(text(left + NODE.width - 2, y, axis.percent, { size: 8, weight: 600, fill: ink, anchor: 'end' }));
    // 사용률 막대. 한계를 모르는 축은 트랙만 그리고 채우지 않는다.
    parts.push(`<line x1="${fmt(left + 2)}" y1="${fmt(y + 3)}" x2="${fmt(left + NODE.width - 2)}" y2="${fmt(y + 3)}" stroke="${INK.lineSoft}" stroke-width="2"/>`);
    if (axis.util != null) {
      const span = (NODE.width - 4) * Math.min(axis.util, 1);
      parts.push(`<line x1="${fmt(left + 2)}" y1="${fmt(y + 3)}" x2="${fmt(left + 2 + span)}" y2="${fmt(y + 3)}" stroke="${ink}" stroke-width="2"/>`);
    }
  }
  y += NODE.metaH + 2;
  parts.push(text(cx, y, view.meta, { size: 8, fill: INK.muted, anchor: 'middle' }));
  return `<g>${parts.join('')}</g>`;
}

/**
 * 계산 결과를 함께 찍은 정지 프레임을 낸다(PRD v0.6 P1-16).
 * result 없이 부르면 도면만 나온다 — 숫자를 지어내지 않고 그 사실을 적는다.
 */
export function exportDiagramSvg(topology, result = null, options = {}) {
  const next = draft(topology);
  const views = new Map();
  if (result) {
    const verdicts = new Map((options.sweep?.resources || []).map((item) => [item.id, item]));
    for (const device of result.devices) views.set(device.id, nodeView(device, { verdict: verdicts.get(device.id) }));
  }
  const linkStatus = new Map((result?.links || []).map((link) => [link.id, link]));
  const severed = new Set((result?.demands || []).flatMap(({ severedPaths }) => (severedPaths || []).flatMap(({ links }) => links)));

  // 결과가 있으면 노드는 화면과 같은 규격을 차지한다. 없으면 예전처럼 이름표 상자다.
  const nodes = [...(next.devices || []).map((d) => (views.has(d.id)
    ? { id: d.id, kind: 'node', device: d, view: views.get(d.id), x: d.position.x - NODE.width / 2, y: d.position.y - NODE.symbolH / 2, width: NODE.width, height: NODE.symbolH + NODE.headH + NODE.modelH + views.get(d.id).axes.length * NODE.rowH + NODE.metaH + 6 }
    : { id: d.id, kind: 'rect', text: d.name || d.id, x: d.position.x - 64, y: d.position.y - 40, width: 128, height: 80 })), ...next.diagram.shapes];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const anchorPoint = (node, anchor) => (node.kind === 'node'
    ? { x: coordinate(node.x + node.width / 2), y: coordinate(node.y + NODE.symbolH / 2) }
    : { x: coordinate(node.x + node.width * (anchor?.x ?? .5)), y: coordinate(node.y + node.height * (anchor?.y ?? .5)) });
  const routes = [...(next.links || []), ...next.diagram.connectors].flatMap((edge) => { const a = byId.get(edge.source), b = byId.get(edge.target); return a && b ? [{ edge, points: [anchorPoint(a, edge.sourceAnchor), ...(edge.waypoints || []).map((p) => ({ x: coordinate(p.x), y: coordinate(p.y) })), anchorPoint(b, edge.targetAnchor)] }] : []; });

  const groups = result ? groupBoxes(result.devices.filter(({ position }) => position)) : [];
  const extent = [...nodes.flatMap((n) => [{ x: coordinate(n.x), y: coordinate(n.y) }, { x: coordinate(n.x + n.width), y: coordinate(n.y + n.height) }]),
    ...groups.flatMap((g) => [{ x: g.x, y: g.y }, { x: g.x + g.width, y: g.y + g.height }]), ...routes.flatMap((r) => r.points)];
  const headroom = result ? 74 : 24;
  const left = Math.min(...extent.map((p) => p.x)) - 24;
  const top = Math.min(...extent.map((p) => p.y)) - headroom;
  const width = Math.max(...extent.map((p) => p.x)) - left + 24;
  const height = Math.max(...extent.map((p) => p.y)) - top + 20;

  const groupMarkup = groups.map((group) => `<rect x="${fmt(group.x)}" y="${fmt(group.y)}" width="${fmt(group.width)}" height="${fmt(group.height)}" fill="none" stroke="${INK.line}" stroke-width="1" stroke-dasharray="4 4"/>`).join('');
  // 이름표는 링크 위에 그린다. 아래에 두면 선이 RACK 03 같은 이름을 갈라 어느 랙인지 읽을 수
  // 없다. 상자 너비는 9px 고정폭 글꼴의 자간(0.6em)으로 어림한다 — 화면은 실제로 재지만
  // 내보내기에는 잴 DOM 이 없다. 값이 어긋나면 글자가 상자 밖으로 나가므로 여유를 둔다.
  const groupLabels = groups.map((group) => `<rect x="${fmt(group.x + 6)}" y="${fmt(group.y + 3)}" width="${fmt(group.label.length * 5.4 + 10)}" height="13" fill="${INK.raised}" stroke="${INK.lineSoft}" stroke-width="1"/>`
    + text(group.x + 11, group.y + 13, group.label, { size: 9, weight: 700, fill: INK.muted })).join('');

  // 라벨 자리는 화면과 같은 함수가 정한다. 한쪽에만 보이는 숫자가 있으면 위키에 붙인 그림이
  // 화면과 다른 말을 한다. 굽은 링크는 가운데 마디 위에서 자리를 찾는다.
  const edgeLabel = (link, edge) => (!link ? (edge.label || '') : link.severed ? 'DOWN' : formatNodePercent(link.axes?.forwarding_bps?.utilization ?? null));
  const midSegment = (points) => { const half = Math.max(1, Math.floor(points.length / 2)); return [points[half - 1], points[half]]; };
  const labelSpots = placeLinkLabels(routes.filter(({ edge }) => edgeLabel(linkStatus.get(edge.id), edge)).map(({ edge, points }) => {
    const link = linkStatus.get(edge.id);
    const [from, to] = midSegment(points);
    return {
      id: edge.id, text: edgeLabel(link, edge), from, to,
      status: !link ? 'healthy' : link.severed ? 'disabled' : severed.has(edge.id) ? 'severed-path' : link.primaryStatus,
      util: link?.axes?.forwarding_bps?.utilization ?? null,
      binding: edge.id === result?.summary?.bindingResourceId,
    };
  }), nodes.filter(({ kind }) => kind === 'node').map(({ device }) => device.position));

  const edges = routes.map(({ edge, points }) => {
    const link = linkStatus.get(edge.id);
    // 화면과 같은 판정을 쓴다(public/app.js renderTopology). 끊긴 링크는 DOWN 이고, 살아 있지만
    // 이 트래픽이 지날 수 없는 링크는 따로 표시한다. 죽은 링크에 0% 를 적으면 한가한 것으로 읽힌다.
    const onSeveredPath = link && !link.severed && severed.has(edge.id);
    const status = !link ? null : link.severed ? 'disabled' : onSeveredPath ? 'severed-path' : link.primaryStatus;
    const stroke = status ? (LINK_INK[status] || INK.cyan) : INK.line;
    const dash = LINK_DASH[status] ? ` stroke-dasharray="${LINK_DASH[status]}"` : '';
    const spot = labelSpots.get(edge.id);
    const label = edgeLabel(link, edge);
    return `<polyline points="${points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${LINK_WIDTH[status] ?? 1}"${dash}/>`
      + (label && spot ? text(spot.x, spot.y, label, { size: 9, fill: status && status !== 'healthy' ? stroke : INK.muted, anchor: 'middle', halo: true }) : '');
  }).join('');

  const elements = nodes.map((n) => {
    if (n.kind === 'node') return nodeMarkup(n.view, n.device);
    const bounds = n.kind === 'ellipse'
      ? `<ellipse cx="${fmt(n.x + n.width / 2)}" cy="${fmt(n.y + n.height / 2)}" rx="${fmt(n.width / 2)}" ry="${fmt(n.height / 2)}"`
      : `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.width)}" height="${fmt(n.height)}"`;
    return `${n.kind === 'text' ? '' : `${bounds} fill="${n.kind === 'note' ? '#fff7cc' : INK.surface}" stroke="${INK.line}"/>`}`
      + `<text x="${fmt(n.x + n.width / 2)}" y="${fmt(n.y + n.height / 2)}" text-anchor="middle" fill="${INK.text}" font-size="14" font-family="sans-serif">${String(n.text || '').split('\n').map((line, i) => `<tspan x="${fmt(n.x + n.width / 2)}" dy="${i ? 18 : 0}">${xml(line)}</tspan>`).join('')}</text>`;
  }).join('');

  const stamp = result ? stampMarkup(topology, result, options, left, top, width, height) : text(left + 12, top + 16, '계산 결과 없음 · 도면만 내보냈습니다', { size: 10, fill: INK.muted });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(left)} ${fmt(top)} ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}">`
    + `<rect x="${fmt(left)}" y="${fmt(top)}" width="${fmt(width)}" height="${fmt(height)}" fill="${INK.canvas}"/>`
    + groupMarkup + edges + groupLabels + elements + stamp + '</svg>';
}

// 이 그림이 어느 배율·장애·엔진에서 나왔고 무엇이 미확인인지. 이것이 없으면 그림은 근거가 아니다.
function stampMarkup(topology, result, options, left, top, width, height) {
  const { summary } = result;
  const binding = [...result.devices, ...result.links].find(({ id }) => id === summary.bindingResourceId);
  const headline = summary.bindingResourceId
    ? `${binding?.name || summary.bindingResourceId} · ${axisCatalog[summary.bindingAxis]?.label || summary.bindingAxis} ${formatNodePercent(summary.minHeadroom == null ? null : 1 - summary.minHeadroom)}`
    : '한계를 아는 축이 없습니다';
  const faults = [...(result.faults?.devices || []), ...(result.faults?.links || [])];
  // 평가 상태를 빼면 미확인이 있는 결과가 통과한 것처럼 읽힌다.
  const verdict = { pass: '통과', fail: '실패', unknown: '통과 보류', invalid: '입력 오류', 'not-ready': '수요 없음' }[summary.evaluationStatus] || summary.evaluationStatus;
  const bounded = result.demands.some(({ deliveredRatioBound }) => deliveredRatioBound && deliveredRatioBound !== 'exact');
  // 카탈로그 판을 하나로 부를 수 없으면 지어내지 않는다. 장비별 revision 을 모아 적는다.
  const revisions = [...new Set(topology.devices.map((d) => d.spec?.revision).filter(Boolean))].sort();
  const line = [
    `배율 ${Number(result.scale ?? 1).toFixed(2)}배`,
    faults.length ? `장애 ${faults.join(', ')}` : '무장애',
    `엔진 ${result.engineVersion}`,
    topology.synthetic ? '합성 데모' : '사용자 설계',
    `${verdict}${summary.unknownCount ? ` · 미확인 제약 ${summary.unknownCount}개` : ''}`,
    bounded ? '전달률 상한' : '',
    revisions.length ? `카탈로그 ${revisions.join(' / ')}` : '카탈로그 —',
    options.exportedAt ? `내보냄 ${options.exportedAt}` : '',
  ].filter(Boolean).join(' · ');
  return text(left + 12, top + 22, headline, { size: 15, weight: 700, fill: INK.text, family: 'system-ui, sans-serif' })
    + text(left + 12, top + 40, line, { size: 9, fill: INK.muted })
    + text(left + 12, top + 54, '축과 한계값의 출처는 프로젝트 JSON에 있습니다. 실제 설계에는 이 환경에서 잰 값으로 다시 확인하세요.', { size: 8, fill: INK.muted });
}

/** Uncompressed mxGraph import only; imported figures are deliberately unmapped. */
export function importDrawio(source, parser = globalThis.DOMParser ? new globalThis.DOMParser() : null) {
  if (typeof source !== 'string' || source.length > 2 * 1024 * 1024) throw new Error('drawio 파일은 2 MB 이하이어야 합니다.');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('외부 XML 엔터티는 지원하지 않습니다.');
  if (!parser) throw new Error('이 환경에는 XML DOMParser가 없습니다. 브라우저에서 가져오세요.');
  const doc = parser.parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('drawio XML 형식이 잘못되었습니다.');
  const pages = [...doc.querySelectorAll('diagram')];
  if (pages.length > 1) throw new Error('한 페이지만 가져올 수 있습니다. 해당 페이지를 압축하지 않은 XML로 내보내세요.');
  const model = doc.querySelector('mxGraphModel');
  if (!model) throw new Error('압축된 drawio는 지원하지 않습니다. XML 내보내기에서 압축을 해제하세요.');
  const cells = [...model.querySelectorAll('mxCell')]; if (cells.length > 10000) throw new Error('요소가 너무 많습니다.');
  const result = empty(), ids = new Set(), map = new Map(), cellMap = new Map(cells.map((c) => [c.getAttribute('id'), c]));
  if (cellMap.size !== cells.length || cells.some((c) => !c.getAttribute('id'))) throw new Error('drawio 요소 ID가 없거나 중복됩니다.');
  for (const cell of cells) if (cell.getAttribute('vertex') === '1') map.set(cell.getAttribute('id'), fresh(ids, 'shape'));
  function geometry(cell, seen = new Set()) {
    const id = cell.getAttribute('id'); if (seen.has(id) || seen.size > 100) throw new Error('순환 그룹 참조이거나 그룹 중첩이 너무 깊습니다.'); seen.add(id);
    const g = cell.querySelector('mxGeometry');
    if (g?.getAttribute('relative') === '1') throw new Error('상대 좌표 도형은 지원하지 않습니다. 절대 좌표 도형으로 변환하세요.');
    const parent = cellMap.get(cell.getAttribute('parent'));
    const offset = parent?.getAttribute('vertex') === '1' ? geometry(parent, seen) : { x: 0, y: 0 };
    return { x: coordinate(Number(g?.getAttribute('x') || 0) + offset.x), y: coordinate(Number(g?.getAttribute('y') || 0) + offset.y), width: coordinate(g?.getAttribute('width') || 160), height: coordinate(g?.getAttribute('height') || 80) };
  }
  function within(cell, parentId, seen = new Set()) {
    const parent = cell.getAttribute('parent');
    if (parent === parentId) return true;
    if (!parent || !cellMap.has(parent)) return false;
    if (seen.has(parent) || seen.size > 100) throw new Error('순환 그룹 참조이거나 그룹 중첩이 너무 깊습니다.');
    seen.add(parent); return within(cellMap.get(parent), parentId, seen);
  }
  function plain(value) { return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').slice(0, 10000); }
  for (const cell of cells) {
    const id = map.get(cell.getAttribute('id')), style = cell.getAttribute('style') || '';
    if (id) {
      result.shapes.push(shape({ id, kind: /ellipse/.test(style) ? 'ellipse' : /(?:^|;)text(?:;|$)/.test(style) ? 'text' : /note/.test(style) ? 'note' : 'rect', text: plain(cell.getAttribute('value')), ...geometry(cell), unmapped: true }));
      if (/(?:^|;)group(?:;|$)/.test(style)) result.groups.push({ id: fresh(ids, 'group'), name: plain(cell.getAttribute('value')) || '가져온 그룹', memberIds: [id, ...cells.filter((c) => within(c, cell.getAttribute('id'))).map((c) => map.get(c.getAttribute('id'))).filter(Boolean)] });
    }
    if (cell.getAttribute('edge') === '1') {
      const from = map.get(cell.getAttribute('source')), to = map.get(cell.getAttribute('target'));
      if (!from || !to) throw new Error('연결 대상이 없는 연결선은 지원하지 않습니다. 도형에 연결한 뒤 다시 내보내세요.');
      const parent = cellMap.get(cell.getAttribute('parent'));
      const offset = parent?.getAttribute('vertex') === '1' ? geometry(parent) : { x: 0, y: 0 };
      const waypoints = [...cell.querySelectorAll('Array[as="points"] mxPoint')].map((p) => ({ x: coordinate(Number(p.getAttribute('x') || 0) + offset.x), y: coordinate(Number(p.getAttribute('y') || 0) + offset.y) }));
      result.connectors.push({ id: fresh(ids, 'connector'), source: from, target: to, kind: 'annotation', label: plain(cell.getAttribute('value')), waypoints });
    }
  }
  return result;
}
