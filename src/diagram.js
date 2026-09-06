const clone = (value) => structuredClone(value);
const coordinate = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new Error('좌표는 ±1,000,000 이내의 유한한 값이어야 합니다.');
  return n;
};
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
/** Clipboard duplicates model objects and internal edges, never service traffic demands. */
export function copySelection(topology, selection) {
  const ids = expanded(topology, selection);
  return clone({ devices: (topology.devices || []).filter((d) => ids.has(d.id)), links: (topology.links || []).filter((l) => ids.has(l.source) && ids.has(l.target)), diagram: { shapes: (topology.diagram?.shapes || []).filter((s) => ids.has(s.id)), connectors: (topology.diagram?.connectors || []).filter((c) => ids.has(c.source) && ids.has(c.target)), groups: (topology.diagram?.groups || []).filter((g) => g.memberIds.every((id) => ids.has(id))) } });
}
export function pasteSelection(topology, clipboard, { dx = 24, dy = 24 } = {}) {
  coordinate(dx); coordinate(dy); const next = draft(topology), copy = draft(clipboard), ids = allIds(next), map = new Map(), selection = [];
  const collections = [['device', copy.devices || [], next.devices ||= []], ['shape', copy.diagram.shapes, next.diagram.shapes], ['link', copy.links || [], next.links ||= []], ['connector', copy.diagram.connectors, next.diagram.connectors], ['group', copy.diagram.groups, next.diagram.groups]];
  for (const [type, items] of collections) for (const item of items) map.set(item.id, fresh(ids, type));
  for (const [type, items, target] of collections) for (const item of items) {
    item.id = map.get(item.id);
    if (type === 'device') { item.position.x = coordinate(item.position.x + Number(dx)); item.position.y = coordinate(item.position.y + Number(dy)); }
    if (type === 'shape') { item.x = coordinate(item.x + Number(dx)); item.y = coordinate(item.y + Number(dy)); }
    if (item.source) item.source = map.get(item.source);
    if (item.target) item.target = map.get(item.target);
    if (item.groupId) item.groupId = map.get(item.groupId);
    if (item.memberIds) item.memberIds = item.memberIds.map((id) => map.get(id));
    if (item.waypoints) item.waypoints = item.waypoints.map((p) => ({ x: coordinate(p.x + Number(dx)), y: coordinate(p.y + Number(dy)) }));
    target.push(item); if (type === 'device' || type === 'shape') selection.push({ type, id: item.id });
  }
  return { topology: next, selection };
}
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function exportDiagramSvg(topology) {
  const next = draft(topology); const nodes = [...(next.devices || []).map((d) => ({ id: d.id, kind: 'rect', text: d.name || d.id, x: d.position.x - 64, y: d.position.y - 40, width: 128, height: 80 })), ...next.diagram.shapes];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const point = (node, anchor) => ({ x: coordinate(node.x + node.width * (anchor?.x ?? .5)), y: coordinate(node.y + node.height * (anchor?.y ?? .5)) });
  const routes = [...(next.links || []), ...next.diagram.connectors].flatMap((edge) => { const a = byId.get(edge.source), b = byId.get(edge.target); return a && b ? [{ edge, points: [point(a, edge.sourceAnchor), ...(edge.waypoints || []).map((p) => ({ x: coordinate(p.x), y: coordinate(p.y) })), point(b, edge.targetAnchor)] }] : []; });
  const extent = [...nodes.flatMap((n) => [{ x: coordinate(n.x), y: coordinate(n.y) }, { x: coordinate(n.x + n.width), y: coordinate(n.y + n.height) }]), ...routes.flatMap((r) => r.points)];
  const left = Math.min(0, ...extent.map((p) => p.x)) - 24, top = Math.min(0, ...extent.map((p) => p.y)) - 24;
  const width = Math.max(100, ...extent.map((p) => p.x)) - left + 24, height = Math.max(100, ...extent.map((p) => p.y)) - top + 24;
  const edges = routes.map(({ edge, points }) => `<polyline points="${points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#64748b" stroke-width="2"/><text x="${points[Math.floor(points.length / 2)].x}" y="${points[Math.floor(points.length / 2)].y - 8}" fill="#334155" font-size="12">${xml(edge.label || '')}</text>`).join('');
  const elements = nodes.map((n) => { const bounds = n.kind === 'ellipse' ? `<ellipse cx="${n.x + n.width / 2}" cy="${n.y + n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}"` : `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}"`; return `${n.kind === 'text' ? '' : `${bounds} fill="${n.kind === 'note' ? '#fff7cc' : '#f8fafc'}" stroke="#475569"/>`}<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2}" text-anchor="middle" fill="#0f172a" font-size="14">${String(n.text || '').split('\n').map((line, i) => `<tspan x="${n.x + n.width / 2}" dy="${i ? 18 : 0}">${xml(line)}</tspan>`).join('')}</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif"><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="white"/>${edges}${elements}</svg>`;
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
