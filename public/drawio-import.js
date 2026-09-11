const SOURCE_LIMIT = 4 * 1024 * 1024;
const PAGE_LIMIT = 64;
const PAGE_BYTES_LIMIT = 8 * 1024 * 1024;
const TOTAL_BYTES_LIMIT = 32 * 1024 * 1024;
const CELL_LIMIT = 10000;
const DEPTH_LIMIT = 100;
const TEXT_LIMIT = 10000;

const warning = (code, elementId = null) => ({ code, ...(elementId ? { elementId } : {}) });
const error = (code, message) => Object.assign(new Error(message), { code });
const escapeId = (value, index) => {
  const base = String(value || index).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `drawio-${base || index}`.slice(0, 64);
};
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 1e6 ? parsed : fallback;
};

function attributes(source) {
  const values = {};
  const pattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  for (const match of source.matchAll(pattern)) values[match[1]] = decodeEntities(match[3]);
  return values;
}

function decodeEntities(value) {
  return String(value || '').replace(/&(?:amp|lt|gt|quot|apos);/g, (token) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[token]);
}

export function plainDrawioText(value) {
  const text = decodeEntities(String(value || ''))
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, TEXT_LIMIT);
  return /^\s*(?:javascript|vbscript):/i.test(text) ? '' : text;
}

function rejectUnsafeXml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw error('unsafe-xml', '외부 XML 엔터티는 지원하지 않습니다.');
  if (!/<(?:mxfile|mxGraphModel|diagram)\b/i.test(source)) throw error('invalid-xml', 'drawio XML 형식이 잘못되었습니다.');
}

function diagramTags(source) {
  const pages = [];
  const pattern = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram\s*>|<diagram\b([^>]*)\/>/gi;
  for (const match of source.matchAll(pattern)) {
    const attrs = attributes(match[1] || match[3] || '');
    pages.push({ id: escapeId(attrs.id, `page-${pages.length + 1}`), name: plainDrawioText(attrs.name) || `페이지 ${pages.length + 1}`, encoded: match[2] || '' });
  }
  if (!pages.length && /<mxGraphModel\b/i.test(source)) pages.push({ id: 'page-1', name: '페이지 1', encoded: source });
  if (!pages.length) throw error('missing-page', 'drawio 페이지를 찾을 수 없습니다.');
  if (pages.length > PAGE_LIMIT) throw error('page-limit', `drawio 페이지는 ${PAGE_LIMIT}개 이하여야 합니다.`);
  return pages;
}

function base64Bytes(value) {
  const text = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(text)) throw error('invalid-base64', '압축된 drawio 데이터가 올바르지 않습니다.');
  if (typeof atob === 'function') {
    const decoded = atob(text);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(text, 'base64'));
}

async function defaultInflateRaw(bytes, limit) {
  if (typeof DecompressionStream !== 'function') throw error('inflate-unavailable', '이 환경은 압축된 drawio를 해제할 수 없습니다.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw error('decoded-size-limit', '압축 해제한 drawio 페이지가 너무 큽니다.'); }
    chunks.push(value);
  }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(output);
}

async function decodeDiagram(encoded, options) {
  const trimmed = String(encoded || '').trim();
  if (trimmed.length > PAGE_BYTES_LIMIT) throw error('page-size-limit', 'drawio 페이지가 너무 큽니다.');
  if (/<mxGraphModel\b/i.test(trimmed)) return trimmed;
  if (/&lt;mxGraphModel\b/i.test(trimmed)) return decodeEntities(trimmed);
  const inflate = options.inflateRaw || defaultInflateRaw;
  const inflated = await inflate(base64Bytes(trimmed), PAGE_BYTES_LIMIT);
  if (typeof inflated !== 'string' || inflated.length > PAGE_BYTES_LIMIT) throw error('decoded-size-limit', '압축 해제한 drawio 페이지가 너무 큽니다.');
  try { return decodeURIComponent(inflated); }
  catch { throw error('invalid-percent-encoding', '압축된 drawio 페이지의 URL 인코딩이 잘못되었습니다.'); }
}

function styleMap(style) {
  return Object.fromEntries(String(style || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('='); return index < 0 ? [part, '1'] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function approvedStyle(style, warnings, id) {
  const map = styleMap(style);
  const result = {};
  const colors = { fillColor: 'fill', gradientColor: 'gradientColor', strokeColor: 'stroke', fontColor: 'textColor' };
  for (const [from, to] of Object.entries(colors)) if (/^(?:none|#[0-9a-f]{3}(?:[0-9a-f]{3})?)$/i.test(map[from] || '')) result[to] = map[from].toLowerCase();
  if (map.rounded === '1') result.rounded = true;
  if (map.shadow === '1') result.shadow = true;
  if (map.dashed === '1') result.lineStyle = 'dashed';
  if (map.fontStyle?.includes('1')) result.fontWeight = 'bold';
  if (['left', 'center', 'right'].includes(map.align)) result.textAlign = map.align;
  if ({ top: 'top', middle: 'middle', bottom: 'bottom' }[map.verticalAlign]) result.verticalAlign = { top: 'top', middle: 'middle', bottom: 'bottom' }[map.verticalAlign];
  if (Number.isFinite(Number(map.strokeWidth))) result.strokeWidth = Math.min(20, Math.max(.5, Number(map.strokeWidth)));
  if (Number.isFinite(Number(map.fontSize))) result.fontSize = Math.min(72, Math.max(8, Number(map.fontSize)));
  if (Number.isFinite(Number(map.opacity))) result.opacity = Math.min(1, Math.max(0, Number(map.opacity) / 100));
  if (map.image && /^(?:data:|https?:|javascript:)/i.test(map.image)) warnings.push(warning('inert-image', id));
  const known = new Set(['shape', 'fillColor', 'gradientColor', 'strokeColor', 'fontColor', 'rounded', 'shadow', 'dashed', 'fontStyle', 'align', 'verticalAlign', 'strokeWidth', 'fontSize', 'opacity', 'image', 'imageAspect', 'html', 'whiteSpace', 'group', 'container', 'swimlane', 'startArrow', 'endArrow', 'edgeStyle', 'orthogonalLoop', 'jettySize', 'orthogonal', 'entryX', 'entryY', 'exitX', 'exitY', 'perimeter', 'labelPosition', 'verticalLabelPosition', 'spacing', 'spacingTop', 'spacingBottom', 'spacingLeft', 'spacingRight']);
  if (Object.keys(map).some((key) => !known.has(key) && !key.startsWith('sketch'))) warnings.push(warning('unsupported-style', id));
  return result;
}

function parseCells(model, page) {
  const matches = [...model.matchAll(/<mxCell\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/mxCell\s*>)/gi)];
  if (matches.length > CELL_LIMIT) throw error('cell-limit', `페이지당 요소는 ${CELL_LIMIT}개 이하여야 합니다.`);
  const cells = new Map();
  for (const match of matches) {
    const attrs = attributes(match[1]);
    if (!attrs.id || cells.has(attrs.id)) throw error('invalid-cell-id', 'drawio 요소 ID가 없거나 중복됩니다.');
    const body = match[2] || '';
    const geometryMatch = body.match(/<mxGeometry\b([^>]*)(?:\/\s*>|>[\s\S]*?<\/mxGeometry\s*>)/i);
    const geometry = attributes(geometryMatch?.[1] || '');
    const points = [...body.matchAll(/<mxPoint\b([^>]*)\/?>/gi)].map((point) => attributes(point[1]));
    cells.set(attrs.id, { sourceId: attrs.id, parentId: attrs.parent || null, source: attrs.source || null, target: attrs.target || null, vertex: attrs.vertex === '1', edge: attrs.edge === '1', value: plainDrawioText(attrs.value), style: attrs.style || '', geometry, points });
  }
  return cells;
}

function pageElements(model, page) {
  const warnings = [];
  const cells = parseCells(model, page);
  const absolute = new Map();
  function locate(id, chain = []) {
    if (absolute.has(id)) return absolute.get(id);
    if (chain.includes(id) || chain.length > DEPTH_LIMIT) throw error('parent-depth', '그룹 중첩이 너무 깊거나 순환합니다.');
    const cell = cells.get(id); if (!cell) return { x: 0, y: 0 };
    const parent = cell.parentId && cells.has(cell.parentId) ? locate(cell.parentId, [...chain, id]) : { x: 0, y: 0 };
    const relative = cell.geometry.relative === '1';
    const x = relative ? parent.x + number(cell.geometry.x) * (number(cells.get(cell.parentId)?.geometry.width, 0)) : parent.x + number(cell.geometry.x);
    const y = relative ? parent.y + number(cell.geometry.y) * (number(cells.get(cell.parentId)?.geometry.height, 0)) : parent.y + number(cell.geometry.y);
    const result = { x, y, width: Math.max(1, number(cell.geometry.width, 160)), height: Math.max(1, number(cell.geometry.height, 80)), relative };
    absolute.set(id, result); return result;
  }
  const elements = []; let serial = 0;
  for (const cell of cells.values()) {
    if (!cell.vertex && !cell.edge) continue;
    const id = escapeId(cell.sourceId, ++serial); const style = approvedStyle(cell.style, warnings, id);
    const position = locate(cell.sourceId); const styles = styleMap(cell.style);
    if (cell.vertex) elements.push({ id, sourceId: cell.sourceId, type: (styles.group === '1' ? 'group' : styles.container === '1' || styles.swimlane === '1' ? 'container' : 'shape'), text: cell.value, parentSourceId: cell.parentId, geometry: position, style, rawStyle: cell.style, relative: position.relative });
    else {
      const points = cell.points.map((point) => ({ x: number(point.x), y: number(point.y) }));
      elements.push({ id, sourceId: cell.sourceId, type: 'edge', text: cell.value, sourceSourceId: cell.source, targetSourceId: cell.target, points, style, rawStyle: cell.style });
      if (!cell.source || !cell.target) warnings.push(warning('dangling-edge', id));
    }
  }
  return { id: page.id, name: page.name, index: page.index, elements, warnings, stats: { cells: cells.size, elements: elements.length } };
}

export function classifyDrawioElement(element) {
  const style = String(element.rawStyle || '');
  if (element.type === 'group' || element.type === 'container') return { classification: 'zone', suggestedDeviceKind: null, confidence: 'high', ruleId: 'container-zone', evidence: 'container' };
  const map = styleMap(style);
  const token = [map.shape, map.resIcon, map.prIcon, map.resourceIcon, map.icon].filter(Boolean).join(' ').toLowerCase();
  const namespace = /(?:mxgraph\.aws|aws\d*\.)/i.test(style) ? 'aws'
    : /(?:mxgraph\.cisco|cisco\d*\.)/i.test(style) ? 'cisco'
      : /(?:mxgraph\.azure|azure\d*\.)/i.test(style) ? 'azure'
        : /(?:^|;)(?:shape=)?(?:router|switch|firewall|server|database)(?:;|$)/i.test(style) ? 'generic-network' : null;
  if (!namespace) return { classification: 'annotation', suggestedDeviceKind: null, confidence: 'none', ruleId: 'unclassified', evidence: 'none' };
  if (namespace === 'aws' && /(?:^|[._ ])(?:group|container)(?:[._ ]|$)/.test(token)) return { classification: 'zone', suggestedDeviceKind: null, confidence: 'high', ruleId: 'aws-container', evidence: token };
  const kind = /(?:load[_ ]?balanc|elastic_load_balancing)/.test(token) ? 'lb'
    : /(?:firewall|security)/.test(token) ? 'firewall'
      : /(?:router|nat_gateway|internet_gateway|vpn_gateway|vpn_connection)/.test(token) ? 'router'
        : /(?:switch)/.test(token) ? 'switch'
          : /(?:server|host|instance|ec2|fargate|ecs_service|ecs_task|lambda_function)/.test(token) ? 'server'
            : /(?:database|storage|rds|elasticache|bucket|(?:^|[._ ])s3(?:[._ ]|$))/.test(token) ? 'storage' : null;
  if (namespace) {
    return { classification: kind ? 'device' : 'device-candidate', suggestedDeviceKind: kind, confidence: kind ? 'high' : 'low', ruleId: namespace, evidence: token };
  }
}

export async function parseDrawioDocument(source, options = {}) {
  if (typeof source !== 'string') throw error('invalid-source', 'drawio 파일을 읽을 수 없습니다.');
  if (source.length > SOURCE_LIMIT) throw error('source-size-limit', 'drawio 파일은 4 MB 이하여야 합니다.');
  rejectUnsafeXml(source);
  const rawPages = diagramTags(source); let total = 0; const pages = [];
  for (let index = 0; index < rawPages.length; index += 1) {
    const raw = rawPages[index]; const model = await decodeDiagram(raw.encoded, options);
    total += model.length; if (total > TOTAL_BYTES_LIMIT) throw error('total-size-limit', 'drawio 문서가 너무 큽니다.');
    if (!/<mxGraphModel\b/i.test(model)) throw error('missing-model', 'drawio 페이지의 그래프 모델을 찾을 수 없습니다.');
    pages.push(pageElements(model, { ...raw, index }));
  }
  const warnings = pages.flatMap((page) => page.warnings);
  return { pages, warnings, stats: { pages: pages.length, elements: pages.reduce((sum, page) => sum + page.elements.length, 0), warnings: warnings.length } };
}

export function createDrawioPreview(document, pageId = document.pages[0]?.id, decisions = {}) {
  const page = document.pages.find((item) => item.id === pageId);
  if (!page) throw error('missing-page', '선택한 drawio 페이지가 없습니다.');
  const candidates = page.elements.filter((element) => element.type !== 'edge').map((element) => {
    const suggestion = classifyDrawioElement(element);
    const decision = decisions[element.id] || 'annotation';
    return { ...element, suggestion, decision };
  });
  return { page, candidates, warnings: page.warnings, decisions: structuredClone(decisions) };
}

function uniqueId(used, base) {
  let index = 1; let candidate = base;
  while (used.has(candidate)) candidate = `${base.slice(0, 58)}-${index++}`;
  used.add(candidate); return candidate;
}

function safeKind(value) { return ['firewall', 'router', 'switch', 'server', 'storage', 'cloud', 'lb'].includes(value) ? value : null; }
function connectorStyle(style = {}) {
  return {
    ...(style.stroke ? { stroke: style.stroke } : {}),
    ...(style.strokeWidth ? { strokeWidth: style.strokeWidth } : {}),
    ...(style.lineStyle ? { dashed: style.lineStyle !== 'solid' } : {}),
  };
}

export function applyDrawioImport(topology, preview, decisions = preview.decisions || {}) {
  const next = structuredClone(topology); next.diagram ||= { shapes: [], connectors: [], groups: [] };
  const ids = new Set([...next.devices, ...next.links, ...next.diagram.shapes, ...next.diagram.connectors, ...next.diagram.groups].map((item) => item.id));
  const map = new Map(); const warnings = [...preview.warnings]; const applied = { devices: 0, zones: 0, annotations: 0, links: 0 };
  const candidateBySource = new Map(preview.candidates.map((item) => [item.sourceId, item]));
  for (const candidate of preview.candidates) {
    const decision = decisions[candidate.id] || 'annotation';
    if (decision === 'exclude') continue;
    const geometry = candidate.geometry;
    const kind = safeKind(typeof decision === 'object' ? decision.kind : candidate.suggestion.suggestedDeviceKind);
    if (decision === 'device' || typeof decision === 'object' && decision.type === 'device') {
      if (!kind) { warnings.push(warning('device-kind-required', candidate.id)); continue; }
      const id = uniqueId(ids, `device-${candidate.id}`);
      next.devices.push({ id, name: (candidate.text || id).slice(0, 80), kind, zone: 'UNASSIGNED', position: { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 }, limits: { forwarding_bps: null, forwarding_pps: null }, source: { type: 'drawio', label: 'draw.io import', condition: 'capacity unknown' }, enabled: true });
      map.set(candidate.sourceId, id); applied.devices += 1; continue;
    }
    const id = uniqueId(ids, `shape-${candidate.id}`);
    const shape = { id, kind: /ellipse/i.test(candidate.rawStyle) ? 'ellipse' : /(?:^|;)text(?:;|$)/.test(candidate.rawStyle) ? 'text' : 'rect', text: candidate.text, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, unmapped: true, ...candidate.style };
    next.diagram.shapes.push(shape); map.set(candidate.sourceId, id); applied.annotations += 1;
  }
  for (const candidate of preview.candidates) {
    const decision = decisions[candidate.id] || 'annotation';
    if (decision !== 'zone' && !(typeof decision === 'object' && decision.type === 'zone')) continue;
    const members = preview.candidates.filter((item) => item.parentSourceId === candidate.sourceId).map((item) => map.get(item.sourceId)).filter(Boolean);
    if (members.length) { next.diagram.groups.push({ id: uniqueId(ids, `group-${candidate.id}`), name: (candidate.text || '가져온 영역').slice(0, 80), memberIds: members }); applied.zones += 1; }
  }
  for (const edge of preview.page.elements.filter((item) => item.type === 'edge')) {
    const source = map.get(edge.sourceSourceId); const target = map.get(edge.targetSourceId);
    const sourceCandidate = candidateBySource.get(edge.sourceSourceId); const targetCandidate = candidateBySource.get(edge.targetSourceId);
    const sourceDecision = sourceCandidate && decisions[sourceCandidate.id]; const targetDecision = targetCandidate && decisions[targetCandidate.id];
    if ((sourceDecision === 'device' || sourceDecision?.type === 'device') && (targetDecision === 'device' || targetDecision?.type === 'device') && source && target && source !== target) {
      next.links.push({ id: uniqueId(ids, `link-${edge.id}`), source, target, capacity: { forwarding_bps: null }, enabled: true });
      applied.links += 1; continue;
    }
    const endpoints = [source, target];
    for (let index = 0; index < endpoints.length; index += 1) if (!endpoints[index]) {
      const anchorId = uniqueId(ids, `anchor-${edge.id}-${index + 1}`);
      const point = edge.points[index] || { x: 0, y: 0 };
      next.diagram.shapes.push({ id: anchorId, kind: 'text', text: '', x: point.x, y: point.y, width: 1, height: 1, opacity: 0, unmapped: true }); endpoints[index] = anchorId;
    }
    if (endpoints[0] === endpoints[1]) { warnings.push(warning('self-edge-annotation', edge.id)); continue; }
    next.diagram.connectors.push({ id: uniqueId(ids, `connector-${edge.id}`), source: endpoints[0], target: endpoints[1], kind: 'annotation', label: edge.text, waypoints: edge.points, ...connectorStyle(edge.style) }); applied.annotations += 1;
  }
  next.diagram.drawioImport = { pageId: preview.page.id, warningCodes: warnings.map((item) => item.code), decisions: Object.fromEntries(preview.candidates.map((item) => [item.id, decisions[item.id] || 'annotation'])) };
  return { topology: next, sourceToTargetId: Object.fromEntries(map), applied, warnings };
}
