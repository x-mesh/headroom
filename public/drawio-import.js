import { DRAWIO_EXACT_PORTS, DRAWIO_STENCILS, ICONS } from './icons.js';
import { mxEdgeStyle, mxPerimeter, mxPoint, mxRectangle } from './vendor/mx-edge-style.js';

const SOURCE_LIMIT = 4 * 1024 * 1024;
const PAGE_LIMIT = 64;
const PAGE_BYTES_LIMIT = 8 * 1024 * 1024;
const TOTAL_BYTES_LIMIT = 32 * 1024 * 1024;
const CELL_LIMIT = 10000;
const DEPTH_LIMIT = 100;
const TEXT_LIMIT = 10000;
const IMAGE_LIMIT = 2 * 1024 * 1024;
const IMAGE_TOTAL_LIMIT = 16 * 1024 * 1024;
const IMAGE_AXIS_LIMIT = 8192;
const IMAGE_PIXEL_LIMIT = 16 * 1024 * 1024;
const SVG_LIMIT = 256 * 1024;
const RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const NETWORK_STENCILS = Object.freeze({
  switch: 'switch', router: 'router', firewall: 'firewall', 'load balancer': 'lb', load_balancer: 'lb',
  server: 'server', storage: 'storage', rack: 'rack', cloud: 'cloud',
  mobile: 'mobile', pc: 'pc', 'server storage': 'server-storage', server_storage: 'server-storage',
  'virtual server': 'vm', virtual_server: 'vm',
  l3_switch: 'switch', l2_switch: 'switch', ips_ids: 'firewall',
});
const CISCO_RECT_TOKENS = Object.freeze({ l2_switch: 'mxgraph.cisco19.l2_switch', l3_switch: 'mxgraph.cisco19.l3_switch', ips_ids: 'mxgraph.cisco19.ips_ids' });

// `token` carries the style name that could not be drawn. Without it a reader
// sees a count and cannot tell which shape to look up or fix in the source.
const warning = (code, elementId = null, token = null) => ({ code, ...(elementId ? { elementId } : {}), ...(token ? { token: String(token).slice(0, 120) } : {}) });
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
  return String(value || '').replace(/&(amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|[0-9]+));/gi, (token, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[entity.toLowerCase()] != null) return named[entity.toLowerCase()];
    const codePoint = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : token;
  });
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

const LABEL_STYLE_KEYS = new Set(['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration', 'text-align']);
function drawioLabelStyle(value, inherited = {}) {
  const next = { ...inherited };
  for (const item of String(value || '').split(';')) {
    const [rawKey, rawValue] = item.split(':'); const key = String(rawKey || '').trim().toLowerCase(); const token = String(rawValue || '').trim();
    if (!LABEL_STYLE_KEYS.has(key)) continue;
    if (key === 'color' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(token)) next.color = token.toLowerCase();
    if (key === 'font-size' && /^\d{1,2}px$/.test(token) && Number(token.slice(0, -2)) >= 8) next.fontSize = Number(token.slice(0, -2));
    if (key === 'font-family' && ['Helvetica', 'Arial', 'Verdana', 'Times New Roman', 'Courier New'].includes(token)) next.fontFamily = token;
    if (key === 'font-weight' && /^(?:bold|[4-9]00)$/i.test(token)) next.fontWeight = '700';
    if (key === 'font-style' && token === 'italic') next.fontStyle = 'italic';
    if (key === 'text-decoration' && token === 'underline') next.textDecoration = 'underline';
    if (key === 'text-align' && ['left', 'center', 'right'].includes(token)) next.textAlign = token;
  }
  return next;
}

export function drawioLabelRuns(value) {
  const lines = [[]]; const stack = [{}];
  const add = (value) => {
    const parts = decodeEntities(value).replace(/[<>]/g, '').split('\n');
    for (const [index, token] of parts.entries()) {
      for (let offset = 0; offset < token.length; offset += 240) lines.at(-1).push({ text: token.slice(offset, offset + 240), ...stack.at(-1) });
      if (index < parts.length - 1) lines.push([]);
    }
  };
  const source = decodeEntities(String(value || ''));
  for (const token of source.match(/<[^>]*>|[^<]+/g) || []) {
    if (!token.startsWith('<')) { add(token); continue; }
    const closing = /^<\//.test(token); const name = /^<\/?\s*([a-z0-9]+)/i.exec(token)?.[1]?.toLowerCase();
    if (!name || !['div', 'p', 'span', 'font', 'b', 'strong', 'i', 'em', 'u', 'br'].includes(name)) continue;
    if (name === 'br') { lines.push([]); continue; }
    if (closing) {
      if (stack.length > 1) stack.pop();
      // draw.io uses a div as a line break, including when the div follows a font
      // element. Do not add a second break when the block itself is empty.
      if (name === 'div' || name === 'p') lines.push([]);
      continue;
    }
    const attrs = attributes(token);
    if ((name === 'div' || name === 'p') && lines.at(-1).length) lines.push([]);
    const style = drawioLabelStyle(attrs.style, stack.at(-1));
    if (name === 'font' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(attrs.color || '')) style.color = attrs.color.toLowerCase();
    if (name === 'font' && /^\d{1,2}$/.test(attrs.size || '')) style.fontSize = Number(attrs.size);
    if (name === 'b' || name === 'strong') style.fontWeight = '700'; if (name === 'i' || name === 'em') style.fontStyle = 'italic'; if (name === 'u') style.textDecoration = 'underline';
    stack.push(style); if (/\/$/.test(token)) stack.pop();
  }
  return lines.filter((line) => line.length).slice(0, 8).map((line) => line.reduce((merged, run) => {
    const prior = merged.at(-1);
    if (prior && prior.text.length + run.text.length <= 240 && ['color', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign'].every((key) => prior[key] === run[key])) prior.text += run.text;
    else merged.push({ ...run });
    return merged;
  }, []));
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
  const source = String(style || ''); const values = {}; let index = 0;
  // draw.io permits the first style field to be a bare shape token, for example
  // `text;html=1` and `image;image=data:...`. Preserve it as shape before
  // parsing the keyed fields below.
  const first = source.match(/^([A-Za-z][\w.-]*)(?=;|$)/);
  if (first && !first[1].includes('=')) { values.shape = first[1]; index = first[0].length + (source[first[0].length] === ';' ? 1 : 0); }
  while (index < source.length) {
    const key = /([A-Za-z][\w-]*)=/.exec(source.slice(index));
    if (!key) break;
    const name = key[1]; const start = index + key.index + key[0].length;
    const dataComma = source.slice(start).startsWith('data:') ? source.indexOf(',', start) : -1;
    const next = name === 'image'
      ? source.indexOf(';', dataComma >= start ? dataComma + 1 : start)
      : source.slice(start).search(/;(?=[A-Za-z][\w-]*=)/);
    const end = next < 0 ? source.length : (name === 'image' ? next : start + next);
    // 마지막 style field 뒤의 종결 세미콜론은 값이 아니다. image data URI 내부 세미콜론은 위에서 보존한다.
    values[name] = source.slice(start, end).replace(/;$/, ''); index = end + 1;
  }
  return values;
}

// draw.io styles sometimes write a stencil name without its underscores, so
// mxgraph.aws4.applicationloadbalancer has to reach application_load_balancer.
const STENCIL_BY_COMPACT = new Map(Object.keys(DRAWIO_STENCILS).map((key) => [key.replaceAll('_', ''), key]));
function stencilKey(value) {
  const token = String(value || '');
  if (!token) return null;
  return DRAWIO_STENCILS[token] ? token : STENCIL_BY_COMPACT.get(token.replaceAll('_', '')) || null;
}

function visualToken(map) {
  const shape = String(map.shape || '').toLowerCase();
  if (shape === 'mxgraph.aws4.resourceicon') return String(map.resIcon || map.prIcon || map.resourceIcon || shape).toLowerCase();
  return String(map.resIcon || map.prIcon || map.resourceIcon || map.icon || shape).toLowerCase();
}

function awsGroupIconToken(value) {
  const source = String(value || '').toLowerCase();
  if (DRAWIO_STENCILS[source]) return source;
  const token = source.replace(/\./g, '_');
  const names = {
    mxgraph_aws4_group_subnet: 'mxgraph.aws4.subnet',
    mxgraph_aws4_group_aws_cloud: 'mxgraph.aws4.cloud',
    mxgraph_aws4_group_elastic_load_balancing: 'mxgraph.aws4.elastic_load_balancing',
    mxgraph_aws4_group_security_group: 'mxgraph.aws4.security_group',
    mxgraph_aws4_group_vpc: 'mxgraph.aws4.vpc',
    mxgraph_aws4_group_vpc2: 'mxgraph.aws4.vpc',
    mxgraph_aws4_group_aws_cloud_alt: 'mxgraph.aws4.group_aws_cloud_alt',
    mxgraph_aws4_group_region: 'mxgraph.aws4.group_region',
    mxgraph_aws4_group_security_group: 'mxgraph.aws4.group_security_group',
    mxgraph_aws4_group_ec2_instance_contents: 'mxgraph.aws4.group_ec2_instance_contents',
    mxgraph_aws4_group_corporate_data_center: 'mxgraph.aws4.group_corporate_data_center',
    mxgraph_aws4_group_on_premise: 'mxgraph.aws4.group_on_premise',
  };
  const mapped = names[token] || null;
  return mapped && DRAWIO_STENCILS[mapped] ? mapped : null;
}

function safeShape(map) {
  const source = String(map.shape || '').trim();
  const normalized = source.toLowerCase();
  const token = visualToken(map);
  if (normalized === 'mxgraph.aws4.container_1') return 'port:mxgraph.aws4.container_1';
  if (normalized === 'mxgraph.aws4.resourceicon') return 'port:mxgraph.aws4.resourceicon';
  if (normalized === 'mxgraph.cisco19.rect' || CISCO_RECT_TOKENS[token]) return 'port:mxgraph.cisco19.rect';
  if (normalized === 'mxgraph.arrows2.stripedarrow') return 'port:mxgraph.arrows2.stripedarrow';
  // prIcon names the glyph, so the wrapper id has to win over the glyph token.
  if (normalized === 'mxgraph.kubernetes.icon') return 'port:mxgraph.kubernetes.icon';
  if (normalized === 'mxgraph.ios.iphone') return 'port:mxgraph.ios.iPhone';
  if (normalized === 'umlactor') return 'port:umlActor';
  if (normalized === 'note' || normalized === 'note2') return 'port:note';
  const stencil = stencilKey(token) || stencilKey(normalized);
  if (stencil) return `stencil:${stencil}`;
  if (DRAWIO_EXACT_PORTS[token] || DRAWIO_EXACT_PORTS[normalized]) return `port:${DRAWIO_EXACT_PORTS[token] ? token : normalized}`;
  if (['rectangle', 'rect', 'ellipse', 'text', 'edgelabel', 'image', 'cube', 'cylinder3', 'hexagon', 'line'].includes(normalized)) return normalized === 'rectangle' ? 'rect' : normalized === 'edgelabel' ? 'text' : normalized === 'line' ? 'rect' : normalized;
  if (normalized === 'swimlane' || normalized === 'group' || normalized === 'container' || normalized === 'table') return 'container';
  const network = NETWORK_STENCILS[normalized.replace(/^mxgraph\.networks\./, '')];
  if (network) return `network:${network}`;
  if (/^mxgraph\.aws4\.(?:group|container)/.test(normalized) || /^aws4\.(?:group|container)/.test(normalized)) return 'aws-frame';
  if (/^(?:mxgraph\.)?(?:aws|cisco|azure)/.test(normalized)) return 'vendor-fallback';
  return source ? 'generic-fallback' : 'rect';
}

function safeOptions(map) {
  const rotation = Number(map.rotation);
  const assetToken = (value) => typeof value === 'string' && /^[a-z0-9._-]{1,120}$/i.test(value) ? value.toLowerCase() : null;
  const normalized = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : null;
  const dimension = (value) => Number.isFinite(Number(value)) ? Math.max(-100000, Math.min(100000, Number(value))) : null;
  const arrow = (value) => ['none', 'classic', 'block', 'blockThin', 'open', 'oval'].includes(value) ? value : null;
  const dashPattern = typeof map.dashPattern === 'string' && /^[0-9 .,-]{1,80}$/.test(map.dashPattern) ? map.dashPattern.trim().replace(/,/g, ' ') : null;
  const fontFamily = ['Helvetica', 'Arial', 'Verdana', 'Times New Roman', 'Courier New'].includes(map.fontFamily) ? map.fontFamily : null;
  const result = {
    ...(map.dashed === '1' ? { dashed: true } : {}),
    ...(arrow(map.startArrow) ? { startArrow: arrow(map.startArrow) } : {}),
    ...(arrow(map.endArrow) ? { endArrow: arrow(map.endArrow) } : map.shape === 'connector' || map.edge === '1' ? { endArrow: 'classic' } : {}),
    ...(map.startFill === '1' ? { startFill: true } : map.startFill === '0' ? { startFill: false } : {}),
    ...(map.endFill === '1' ? { endFill: true } : map.endFill === '0' ? { endFill: false } : {}),
    ...(dimension(map.startSize) != null ? { startSize: Math.max(1, Math.min(100, dimension(map.startSize))) } : {}),
    ...(dimension(map.endSize) != null ? { endSize: Math.max(1, Math.min(100, dimension(map.endSize))) } : {}),
    ...(map.flipH === '1' ? { flipH: true } : {}),
    ...(map.flipV === '1' ? { flipV: true } : {}),
    ...(map.aspect === 'fixed' || map.imageAspect === '1' ? { fixedAspect: true } : {}),
    ...(assetToken(map.resIcon) ? { resIcon: assetToken(map.resIcon) } : {}),
    ...(assetToken(map.prIcon) ? { prIcon: assetToken(map.prIcon) } : {}),
    ...(assetToken(map.grIcon) ? { grIcon: assetToken(map.grIcon) } : {}),
    ...(dimension(map.grIconSize) != null ? { grIconSize: Math.max(1, Math.min(100000, dimension(map.grIconSize))) } : {}),
    // `size` is the corner fold on a note. Keep the raw value; each shape clamps it.
    ...(dimension(map.size) != null ? { size: Math.max(0, Math.min(100000, dimension(map.size))) } : {}),
    ...(map.grStroke === '0' ? { grStroke: false } : map.grStroke === '1' ? { grStroke: true } : {}),
    ...(Number.isFinite(Number(map.dx)) ? { dx: Math.max(0, Math.min(100000, Number(map.dx))) } : {}),
    ...(Number.isFinite(Number(map.dy)) ? { dy: Math.max(0, Math.min(1, Number(map.dy))) } : {}),
    ...(Number.isFinite(Number(map.notch)) ? { notch: Math.max(0, Math.min(100000, Number(map.notch))) } : {}),
    ...(normalized(map.entryX) != null ? { entryX: normalized(map.entryX) } : {}),
    ...(normalized(map.entryY) != null ? { entryY: normalized(map.entryY) } : {}),
    ...(normalized(map.exitX) != null ? { exitX: normalized(map.exitX) } : {}),
    ...(normalized(map.exitY) != null ? { exitY: normalized(map.exitY) } : {}),
    ...(dimension(map.entryDx) != null ? { entryDx: dimension(map.entryDx) } : {}),
    ...(dimension(map.entryDy) != null ? { entryDy: dimension(map.entryDy) } : {}),
    ...(dimension(map.exitDx) != null ? { exitDx: dimension(map.exitDx) } : {}),
    ...(dimension(map.exitDy) != null ? { exitDy: dimension(map.exitDy) } : {}),
    ...(map.entryPerimeter === '0' ? { entryPerimeter: false } : map.entryPerimeter === '1' ? { entryPerimeter: true } : {}),
    ...(map.exitPerimeter === '0' ? { exitPerimeter: false } : map.exitPerimeter === '1' ? { exitPerimeter: true } : {}),
    ...(map.edgeStyle === 'orthogonalEdgeStyle' ? { routeMode: 'orthogonal' } : map.edgeStyle === 'elbowEdgeStyle' ? { routeMode: 'elbow' } : map.curved === '1' ? { routeMode: 'curved' } : {}),
    ...(map.elbow === 'vertical' || map.elbow === 'horizontal' ? { elbow: map.elbow } : {}),
    ...(dimension(map.jettySize) != null ? { jettySize: dimension(map.jettySize) } : {}),
    ...(['arc', 'gap', 'sharp', 'line'].includes(map.jumpStyle) ? { jumpStyle: map.jumpStyle } : {}),
    ...(dimension(map.jumpSize) != null ? { jumpSize: Math.max(1, Math.min(100, dimension(map.jumpSize))) } : {}),
    ...(dimension(map.targetPerimeterSpacing) != null ? { targetPerimeterSpacing: Math.max(0, Math.min(100000, dimension(map.targetPerimeterSpacing))) } : {}),
    ...(dashPattern ? { dashPattern } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(map.textDirection === 'vertical' ? { textDirection: 'vertical' } : {}),
    ...(map.labelBackgroundColor === '#ffffff' || map.labelBackgroundColor === '#fff' ? { labelBackgroundColor: '#ffffff' } : {}),
    ...(map.verticalLabelPosition === 'bottom' ? { verticalLabelPosition: 'bottom' } : {}),
    ...(map.autosize === '1' ? { autosize: true } : {}),
    ...(dimension(map.spacingLeft) != null ? { spacingLeft: dimension(map.spacingLeft) } : {}),
    ...(dimension(map.spacingRight) != null ? { spacingRight: dimension(map.spacingRight) } : {}),
    ...(dimension(map.spacingTop) != null ? { spacingTop: dimension(map.spacingTop) } : {}),
    ...(dimension(map.spacingBottom) != null ? { spacingBottom: dimension(map.spacingBottom) } : {}),
    ...(map.gradientDirection && ['north', 'south', 'east', 'west'].includes(map.gradientDirection) ? { gradientDirection: map.gradientDirection } : {}),
  };
  if (Number.isFinite(rotation)) result.rotation = ((rotation % 360) + 360) % 360;
  return result;
}

function bytesFromBase64(value) {
  const text = String(value || '').replace(/\s+/g, '');
  if (!text || text.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw error('invalid-image-base64', '이미지 base64가 올바르지 않습니다.');
  const bytes = base64Bytes(text);
  const canonical = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode(...bytes));
  if (canonical !== text) throw error('invalid-image-base64', '이미지 base64가 canonical 형식이 아닙니다.');
  return { bytes, base64: canonical };
}

function dimensions(bytes, mime) {
  const at = (offset) => bytes[offset];
  const u16 = (offset) => (at(offset) << 8) | at(offset + 1);
  const u32 = (offset) => ((at(offset) * 0x1000000) + (at(offset + 1) << 16) + (at(offset + 2) << 8) + at(offset + 3));
  if (mime === 'image/png' && bytes.length >= 24) return { width: u32(16), height: u32(20) };
  if (mime === 'image/gif' && bytes.length >= 10) return { width: at(6) | (at(7) << 8), height: at(8) | (at(9) << 8) };
  if (mime === 'image/jpeg') {
    for (let index = 2; index + 9 < bytes.length;) {
      if (at(index) !== 0xff) { index += 1; continue; }
      const marker = at(index + 1); const length = u16(index + 2);
      if (length < 2 || index + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: u16(index + 7), height: u16(index + 5) };
      index += 2 + length;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 30) {
    const type = String.fromCharCode(...bytes.slice(12, 16));
    if (type === 'VP8X') return { width: 1 + at(24) + (at(25) << 8) + (at(26) << 16), height: 1 + at(27) + (at(28) << 8) + (at(29) << 16) };
  }
  throw error('invalid-image-header', '이미지 헤더가 올바르지 않습니다.');
}

function imageMime(bytes) {
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  if (bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/)) return 'image/gif';
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function canonicalDrawioSvgAsset(value) {
  const source = String(value || '').trim();
  if (!source || source.length > SVG_LIMIT || /<!DOCTYPE|<!ENTITY|<\/?(?:script|style|foreignObject)\b|\bon[a-z]+\s*=|(?:https?:|javascript:|data:)\s*(?:href|xlink:href)\s*=|url\s*\(/i.test(source)) return null;
  const root = source.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/i);
  if (!root) return null;
  const allowedTags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
  const allowedAttrs = new Set(['d', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform', 'xmlns', 'preserveAspectRatio']);
  const tokens = source.match(/<[^>]+>/g) || [];
  for (const token of tokens) {
    const tag = /^<\/?\s*([A-Za-z][\w:-]*)/.exec(token)?.[1]?.toLowerCase();
    if (!tag || !allowedTags.has(tag)) return null;
    if (token.startsWith('</')) continue;
    for (const match of token.matchAll(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=/g)) if (!allowedAttrs.has(match[1])) return null;
  }
  const attrs = root[1].match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i)?.[2] || '0 0 100 100';
  if (!/^[-+0-9.eE ]{7,80}$/.test(attrs)) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${attrs.trim().replace(/\s+/g, ' ')}">${root[2]}</svg>`;
}

async function digest(bytes) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function registerImage(value, registry, warnings, id) {
  if (!value) return null;
  if (/^(?:https?:|javascript:|\/|\.\.?\/)/i.test(value)) { warnings.push(warning('inert-image-reference', id)); return null; }
  const svgMatch = /^(?:data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,)?([\s\S]+)$/i.exec(value);
  const svgPayload = svgMatch?.[1] || '';
  if (/^(?:PHN2Zy|%3Csvg|&lt;svg|<svg)/i.test(svgPayload)) {
    try {
      const encoded = svgPayload;
      const source = /^(?:data:image\/svg\+xml)?;base64,/i.test(value) || /^PHN2Zy/i.test(encoded)
        ? new TextDecoder().decode(bytesFromBase64(encoded).bytes)
        : decodeEntities(decodeURIComponent(encoded));
      const svg = canonicalDrawioSvgAsset(source);
      if (!svg) throw error('unsafe-inline-svg', '안전하지 않은 inline SVG입니다.');
      const bytes = new TextEncoder().encode(svg); const hash = await digest(bytes);
      if (!registry.byDigest.has(hash)) {
        const asset = { id: `asset-${hash.slice(0, 24)}`, mime: 'image/svg+xml', width: 100, height: 100, digest: `sha256:${hash}`, base64: typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode(...bytes)) };
        registry.byDigest.set(hash, asset); registry.assets.push(asset); registry.total += bytes.byteLength;
      }
      return registry.byDigest.get(hash).id;
    } catch (cause) { warnings.push(warning(cause.code || 'unsafe-inline-svg', id)); return null; }
  }
  const match = /^data:([^;,]+)(?:;base64)?,([A-Za-z0-9+/=]+)$/i.exec(value);
  const declaredMime = match?.[1]?.toLowerCase() || null;
  const payload = match?.[2] || (/^[A-Za-z0-9+/=]+$/.test(value) ? value : null);
  if (!payload) { warnings.push(warning('inert-image-reference', id)); return null; }
  try {
    const decoded = bytesFromBase64(payload); const { bytes } = decoded;
    if (bytes.byteLength > IMAGE_LIMIT || registry.total + bytes.byteLength > IMAGE_TOTAL_LIMIT) throw error('image-size-limit', '이미지가 허용 크기를 넘습니다.');
    const mime = imageMime(bytes);
    if (!mime || !RASTER_MIME.has(mime)) throw error('unsupported-image-mime', '지원하지 않는 이미지 형식입니다.');
    if (declaredMime && declaredMime !== mime) throw error('image-mime-mismatch', '이미지 MIME이 실제 데이터와 다릅니다.');
    const size = dimensions(bytes, mime);
    if (!size.width || !size.height || size.width > IMAGE_AXIS_LIMIT || size.height > IMAGE_AXIS_LIMIT || size.width * size.height > IMAGE_PIXEL_LIMIT) throw error('image-dimension-limit', '이미지 크기가 허용 범위를 넘습니다.');
    const hash = await digest(bytes);
    if (!registry.byDigest.has(hash)) {
      const asset = { id: `asset-${hash.slice(0, 24)}`, mime, width: size.width, height: size.height, digest: `sha256:${hash}`, base64: decoded.base64 };
      registry.byDigest.set(hash, asset); registry.assets.push(asset); registry.total += bytes.byteLength;
    }
    return registry.byDigest.get(hash).id;
  } catch (cause) { warnings.push(warning(cause.code || 'invalid-image', id)); return null; }
}

async function approvedStyle(style, registry, warnings, id) {
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
  const imageAssetId = await registerImage(map.image, registry, warnings, id);
  const known = new Set(['shape', 'fillColor', 'gradientColor', 'gradientDirection', 'strokeColor', 'fontColor', 'fontFamily', 'fontStyle', 'fontSize', 'textDirection', 'labelBackgroundColor', 'rounded', 'shadow', 'dashed', 'dashPattern', 'strokeWidth', 'opacity', 'image', 'imageAspect', 'html', 'whiteSpace', 'group', 'container', 'swimlane', 'startArrow', 'endArrow', 'startFill', 'endFill', 'startSize', 'endSize', 'edgeStyle', 'elbow', 'curved', 'orthogonalLoop', 'jettySize', 'jumpStyle', 'jumpSize', 'orthogonal', 'entryX', 'entryY', 'entryDx', 'entryDy', 'entryPerimeter', 'exitX', 'exitY', 'exitDx', 'exitDy', 'exitPerimeter', 'targetPerimeterSpacing', 'perimeter', 'labelPosition', 'verticalLabelPosition', 'spacing', 'spacingTop', 'spacingBottom', 'spacingLeft', 'spacingRight', 'rotation', 'flipH', 'flipV', 'aspect', 'dx', 'dy', 'notch', 'resIcon', 'prIcon', 'grIcon', 'grIconSize', 'grStroke', 'points', 'align', 'verticalAlign', 'text', 'collapsible', 'expand', 'recursiveResize', 'boundedLbl', 'backgroundOutline', 'size', 'darkOpacity', 'darkOpacity2', 'fixedSize', 'resizable', 'movable', 'rotatable', 'deletable', 'editable', 'locked', 'connectable', 'outlineConnect', 'labelBorderColor', 'pointerEvents', 'textShadow', 'convertToSvg', 'imageBackground', 'endWidth', 'startWidth', 'width', 'imageBorder', 'fillStyle', 'edgeLabel', 'horizontal', 'fixDash', 'snapToPoint', 'enumerate', 'comic', 'background', 'crop', 'arcSize', 'absoluteArcSize', 'portConstraint', 'spacingLabel', 'labelWidth', 'labelHeight', 'overflow', 'spacingX', 'spacingY', 'fontBackgroundColor', 'fontBorderColor', 'autosize']);
  if (Object.keys(map).some((key) => !known.has(key) && !key.startsWith('sketch'))) warnings.push(warning('unsupported-style', id));
  const token = visualToken(map).replace(/[^a-z0-9._ -]/g, '').slice(0, 120);
  return { paint: result, drawioShape: safeShape(map), drawioOptions: safeOptions(map), ...(token ? { drawioToken: token.slice(0, 120) } : {}), ...(imageAssetId ? { imageAssetId } : {}) };
}

function parseCells(model, page, warnings) {
  const matches = [...model.matchAll(/<mxCell\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/mxCell\s*>)/gi)];
  if (matches.length > CELL_LIMIT) throw error('cell-limit', `페이지당 요소는 ${CELL_LIMIT}개 이하여야 합니다.`);
  const cells = new Map();
  const declaredIds = new Set(matches.map((match) => attributes(match[1]).id).filter(Boolean));
  let missingSerial = 0;
  for (const match of matches) {
    const attrs = attributes(match[1]);
    if (attrs.id && cells.has(attrs.id)) throw error('invalid-cell-id', 'drawio 요소 ID가 중복됩니다.');
    if (!attrs.id) {
      do { attrs.id = `__rack-mesh-missing-${++missingSerial}`; } while (declaredIds.has(attrs.id) || cells.has(attrs.id));
      warnings.push(warning('missing-cell-id', escapeId(attrs.id, missingSerial)));
    }
    const body = match[2] || '';
    const geometryMatch = body.match(/<mxGeometry\b([^>]*)>([\s\S]*?)<\/mxGeometry\s*>|<mxGeometry\b([^>]*)\/\s*>/i);
    const geometry = attributes(geometryMatch?.[1] || geometryMatch?.[3] || '');
    const geometryBody = geometryMatch?.[2] || '';
    const point = (attrs) => ({ x: number(attrs.x), y: number(attrs.y) });
    const direct = [...geometryBody.matchAll(/<mxPoint\b([^>]*)\/?>/gi)].map((match) => attributes(match[1]));
    const arrayMatch = geometryBody.match(/<Array\b[^>]*\bas=(["'])points\1[^>]*>([\s\S]*?)<\/Array\s*>/i);
    const array = arrayMatch?.[2] || ''; const hasWaypointArray = Boolean(arrayMatch);
    const waypoints = [...array.matchAll(/<mxPoint\b([^>]*)\/?>/gi)].map((match) => point(attributes(match[1])));
    const typed = {};
    for (const attrs of direct) {
      const role = attrs.as;
      if (role === 'sourcePoint') typed.sourcePoint = point(attrs);
      else if (role === 'targetPoint') typed.targetPoint = point(attrs);
      else if (role === 'offset') typed.offset = point(attrs);
      else if (role !== 'points' && !hasWaypointArray) waypoints.push(point(attrs));
    }
    cells.set(attrs.id, { sourceId: attrs.id, parentId: attrs.parent || null, source: attrs.source || null, target: attrs.target || null, vertex: attrs.vertex === '1', edge: attrs.edge === '1', value: plainDrawioText(attrs.value), rawValue: attrs.value || '', style: attrs.style || '', geometry, edgeGeometry: { ...typed, waypoints } });
  }
  return cells;
}

async function pageElements(model, page, registry) {
  const warnings = [];
  const cells = parseCells(model, page, warnings);
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
  const elements = []; let serial = 0; let zIndex = 0;
  for (const cell of cells.values()) {
    if (!cell.vertex && !cell.edge) continue;
    const id = escapeId(cell.sourceId, ++serial); const visual = await approvedStyle(cell.style, registry, warnings, id);
    const position = locate(cell.sourceId); const styles = styleMap(cell.style);
    const type = styles.group === '1' ? 'group' : styles.container === '1' || styles.swimlane === '1' ? 'container' : 'shape';
    const drawioShape = type === 'group' || type === 'container' ? (visual.drawioShape === 'aws-frame' ? 'aws-frame' : 'container') : visual.drawioShape;
    if (cell.vertex && (drawioShape === 'vendor-fallback' || drawioShape === 'generic-fallback')) warnings.push(warning('unsupported-vendor-stencil', id, styles.shape));
    if (cell.vertex) {
      const labelRuns = drawioLabelRuns(cell.rawValue);
      elements.push({ id, sourceId: cell.sourceId, type, text: cell.value, parentSourceId: cell.parentId, geometry: position, paint: visual.paint, drawioShape, drawioOptions: visual.drawioOptions, zIndex: zIndex++, ...(labelRuns.some((line) => line.length) ? { labelRuns } : {}), ...(visual.drawioToken ? { drawioToken: visual.drawioToken } : {}), ...(visual.imageAssetId ? { imageAssetId: visual.imageAssetId } : {}), relative: position.relative });
    }
    else {
      const parent = cell.parentId && cells.has(cell.parentId) ? locate(cell.parentId) : { x: 0, y: 0 };
      const offset = ({ x, y }) => ({ x: x + parent.x, y: y + parent.y });
      const geometry = Object.fromEntries(Object.entries(cell.edgeGeometry).map(([key, value]) => [key, Array.isArray(value) ? value.map(offset) : offset(value)]));
      elements.push({ id, sourceId: cell.sourceId, type: 'edge', text: cell.value, sourceSourceId: cell.source, targetSourceId: cell.target, geometry, points: geometry.waypoints, paint: visual.paint, drawioOptions: visual.drawioOptions, drawioStyle: styleMap(cell.style), zIndex: zIndex++ });
      if (!cell.source || !cell.target) warnings.push(warning('dangling-edge', id));
    }
  }
  return { id: page.id, name: page.name, index: page.index, elements, warnings, stats: { cells: cells.size, elements: elements.length } };
}

export function classifyDrawioElement(element) {
  if (element.type === 'group' || element.type === 'container') return { classification: 'zone', suggestedDeviceKind: null, confidence: 'high', ruleId: 'container-zone', evidence: 'container' };
  const legacy = styleMap(element.rawStyle || '');
  const token = String(element.drawioToken || [legacy.shape, legacy.resIcon, legacy.prIcon, legacy.resourceIcon, legacy.icon].filter(Boolean).join(' ') || element.drawioShape || '').toLowerCase();
  const namespace = /(?:mxgraph\.aws|aws\d*\.)/i.test(token) ? 'aws'
    : /(?:mxgraph\.cisco|cisco\d*\.)/i.test(token) ? 'cisco'
      : /(?:mxgraph\.azure|azure\d*\.)/i.test(token) ? 'azure'
        : token.startsWith('network:') || /(?:router|switch|firewall|server|database)/.test(token) ? 'generic-network' : null;
  if (!namespace) return { classification: 'annotation', suggestedDeviceKind: null, confidence: 'none', ruleId: 'unclassified', evidence: 'none' };
  if (namespace === 'aws' && (token === 'aws-frame' || /(?:^|[._ ])(?:group|container)(?:[._ ]|$)/.test(token))) return { classification: 'zone', suggestedDeviceKind: null, confidence: 'high', ruleId: 'aws-container', evidence: token };
  const kind = /(?:lb|load[_ ]?balanc|elastic_load_balancing)/.test(token) ? 'lb'
    : /firewall/.test(token) ? 'firewall'
      : /router/.test(token) ? 'router'
        : /switch/.test(token) ? 'switch'
          : /(?:server|pc|mobile|instance|ec2|fargate|ecs_service|ecs_task|lambda_function)/.test(token) ? 'server'
            : /storage/.test(token) ? 'storage' : null;
  if (namespace) {
    return { classification: kind ? 'device' : 'device-candidate', suggestedDeviceKind: kind, confidence: kind ? 'high' : 'low', ruleId: namespace, evidence: token };
  }
}

export async function parseDrawioDocument(source, options = {}) {
  if (typeof source !== 'string') throw error('invalid-source', 'drawio 파일을 읽을 수 없습니다.');
  if (source.length > SOURCE_LIMIT) throw error('source-size-limit', 'drawio 파일은 4 MB 이하여야 합니다.');
  rejectUnsafeXml(source);
  const rawPages = diagramTags(source); let total = 0; const pages = []; const registry = { assets: [], byDigest: new Map(), total: 0 };
  for (let index = 0; index < rawPages.length; index += 1) {
    const raw = rawPages[index]; const model = await decodeDiagram(raw.encoded, options);
    total += model.length; if (total > TOTAL_BYTES_LIMIT) throw error('total-size-limit', 'drawio 문서가 너무 큽니다.');
    if (!/<mxGraphModel\b/i.test(model)) throw error('missing-model', 'drawio 페이지의 그래프 모델을 찾을 수 없습니다.');
    pages.push(await pageElements(model, { ...raw, index }, registry));
  }
  const warnings = pages.flatMap((page) => page.warnings);
  return { pages, assets: registry.assets, warnings, stats: { pages: pages.length, elements: pages.reduce((sum, page) => sum + page.elements.length, 0), warnings: warnings.length } };
}

export function createDrawioPreview(document, pageId = document.pages[0]?.id, decisions = {}) {
  const page = document.pages.find((item) => item.id === pageId);
  if (!page) throw error('missing-page', '선택한 drawio 페이지가 없습니다.');
  const candidates = page.elements.filter((element) => element.type !== 'edge').map((element) => {
    const suggestion = classifyDrawioElement(element);
    const decision = decisions[element.id] || 'annotation';
    return { ...element, suggestion, decision };
  });
  return { page, assets: document.assets || [], candidates, warnings: page.warnings, decisions: structuredClone(decisions) };
}

const svgText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const svgDataId = (value) => svgText(String(value ?? '').slice(0, 160));
const svgNumber = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
const svgColor = (value, fallback) => /^(?:none|#[0-9a-f]{3}(?:[0-9a-f]{3})?)$/i.test(value || '') ? value.toLowerCase() : fallback;
const elementCenter = (element) => ({ x: element.geometry.x + element.geometry.width / 2, y: element.geometry.y + element.geometry.height / 2 });
const svgAssetUri = (asset) => asset ? `data:${asset.mime};base64,${asset.base64}` : null;

function labelMarkup(element, paint) {
  const { x, y, width, height } = element.geometry;
  const lines = element.labelRuns?.map((line) => line.map((run) => ({ ...run, text: String(run.text || '').slice(0, 120) }))).filter((line) => line.length).slice(0, 8) || String(element.text || '').split('\n').filter(Boolean).slice(0, 8).map((line) => [{ text: line.slice(0, 120) }]);
  if (!lines.length) return '';
  const fontSize = Math.max(8, Math.min(72, Number(paint.fontSize) || 12));
  const runFontSizes = [...new Set(lines.flatMap((line) => line.map((run) => Number(run.fontSize)).filter(Number.isFinite)))];
  // draw.io computes a block line-height from an explicit, uniform inline font.
  // Keep the cell font for mixed runs, where this shortcut would be incorrect.
  const lineFontSize = runFontSizes.length === 1 && lines.every((line) => line.every((run) => Number(run.fontSize) === runFontSizes[0])) ? runFontSizes[0] : fontSize;
  const lineHeight = lineFontSize * 1.2;
  const anchor = paint.textAlign === 'left' ? 'start' : paint.textAlign === 'right' ? 'end' : 'middle';
  const options = element.drawioOptions || {}; const left = Number(options.spacingLeft) || 0; const right = Number(options.spacingRight) || 0; const top = Number(options.spacingTop) || 0; const bottom = Number(options.spacingBottom) || 0;
  const textX = anchor === 'start' ? x + 2 + left : anchor === 'end' ? x + width - 2 - right : x + width / 2 + (left - right) / 2;
  const defaultBelow = options.fixedAspect && (element.drawioShape?.startsWith('stencil:mxgraph.aws4.') || element.drawioShape === 'port:mxgraph.aws4.resourceicon');
  // The SVG text baseline sits about 9px below the top of a 12px draw.io HTML
  // label. Keep the label anchor in the source coordinate system.
  const baselineOffset = 1;
  const base = (options.verticalLabelPosition === 'bottom' || defaultBelow ? y + height + fontSize + 2 + top : paint.verticalAlign === 'top' ? y + fontSize + 2 + top : paint.verticalAlign === 'bottom' ? y + height - lineHeight * (lines.length - 1) - 2 - bottom : y + height / 2 - lineHeight * (lines.length - 1) / 2 + (top - bottom) / 2) + baselineOffset;
  const background = options.labelBackgroundColor ? `<rect x="${svgNumber(textX - Math.max(12, width * .22))}" y="${svgNumber(base - lineHeight)}" width="${svgNumber(Math.max(24, width * .44))}" height="${svgNumber(lineHeight * lines.length)}" fill="${options.labelBackgroundColor}"/>` : '';
  const rotate = options.textDirection === 'vertical' ? ` transform="rotate(-90 ${svgNumber(textX)} ${svgNumber(base)})"` : '';
  const markup = lines.map((line, index) => `<tspan x="${svgNumber(textX)}" dy="${index ? svgNumber(lineHeight) : 0}">${line.map((run) => `<tspan fill="${svgColor(run.color, svgColor(paint.textColor, '#000000'))}"${run.fontFamily ? ` font-family="${run.fontFamily}"` : ''}${run.fontSize ? ` font-size="${run.fontSize}"` : ''}${run.fontWeight ? ` font-weight="${run.fontWeight}"` : ''}${run.fontStyle ? ` font-style="${run.fontStyle}"` : ''}${run.textDecoration ? ` text-decoration="${run.textDecoration}"` : ''}>${svgText(run.text)}</tspan>`).join('')}</tspan>`).join('');
  // draw.io HTML labels use the browser normal font weight unless fontStyle sets bold.
  // A weight of 500 makes every imported label visibly heavier than the source.
  return `${background}<text x="${svgNumber(textX)}" y="${svgNumber(base)}" text-anchor="${anchor}" dominant-baseline="middle" fill="${svgColor(paint.textColor, '#000000')}" font-family="${options.fontFamily || 'Helvetica'}" font-size="${fontSize}" font-weight="${paint.fontWeight === 'bold' ? '700' : 'normal'}"${rotate}>${markup}</text>`;
}

function iconMarkup(kind, geometry, paint) {
  const icon = ICONS[kind]; if (!icon) return '';
  const { x, y, width, height } = geometry;
  const scale = Math.min(width / icon.width, height / icon.height);
  const left = x + (width - icon.width * scale) / 2; const top = y + (height - icon.height * scale) / 2;
  return `<g transform="translate(${svgNumber(left)} ${svgNumber(top)}) scale(${svgNumber(scale)})" style="--icon-fill:${svgColor(paint.fill, '#ffffff')};--icon-line:${svgColor(paint.stroke, '#496b62')};--icon-accent:#ffffff">${icon.body}</g>`;
}

function stencilMarkup(token, x, y, width, height, fill, stroke) {
  const stencil = DRAWIO_STENCILS[token];
  if (!stencil) return '';
  const scale = Math.min(width / stencil.width, height / stencil.height);
  const left = x + (width - stencil.width * scale) / 2; const top = y + (height - stencil.height * scale) / 2;
  return `<g data-drawio-stencil="${svgDataId(token)}" transform="translate(${svgNumber(left)} ${svgNumber(top)}) scale(${svgNumber(scale)})" style="--icon-fill:${fill};--icon-line:${stroke};--icon-accent:#ffffff">${stencil.body}</g>`;
}

function stencilFillMarkup(token, x, y, width, height, fill) {
  const stencil = DRAWIO_STENCILS[token];
  if (!stencil) return '';
  const scale = Math.min(width / stencil.width, height / stencil.height);
  const left = x + (width - stencil.width * scale) / 2; const top = y + (height - stencil.height * scale) / 2;
  return `<g data-drawio-stencil="${svgDataId(token)}" transform="translate(${svgNumber(left)} ${svgNumber(top)}) scale(${svgNumber(scale)})" style="--icon-fill:${fill};--icon-line:none;--icon-accent:${fill}">${stencil.body}</g>`;
}

function renderExactPort(element, fill, stroke, strokeWidth, dash) {
  const { x, y, width, height } = element.geometry; const options = element.drawioOptions || {};
  const port = element.drawioShape.slice(5);
  if (port === 'mxgraph.aws4.container_1') {
    // AWS4 container_1 is a filled server-container glyph. It is not a generic
    // rectangle: the inset shell and seven slots are part of the stencil.
    const sx = width / 43.972; const sy = height / 28.233;
    const px = (value) => svgNumber(x + value * sx); const py = (value) => svgNumber(y + value * sy);
    const shell = `M ${px(42.972)} ${py(0)} L ${px(1)} ${py(0)} C ${px(.447)} ${py(0)} ${px(0)} ${py(.448)} ${px(0)} ${py(1)} L ${px(0)} ${py(27.233)} C ${px(0)} ${py(27.785)} ${px(.447)} ${py(28.233)} ${px(1)} ${py(28.233)} L ${px(42.972)} ${py(28.233)} C ${px(43.525)} ${py(28.233)} ${px(43.972)} ${py(27.785)} ${px(43.972)} ${py(27.233)} L ${px(43.972)} ${py(1)} C ${px(43.972)} ${py(.448)} ${px(43.525)} ${py(0)} ${px(42.972)} ${py(0)} Z`;
    const inner = `M ${px(1.999)} ${py(26.233)} L ${px(1.999)} ${py(2.001)} L ${px(41.972)} ${py(2.001)} L ${px(41.972)} ${py(26.233)} Z`;
    const slots = [5.246, 10.493, 15.739, 20.986, 26.232, 31.479, 36.725].map((left) => `M ${px(left)} ${py(23.736)} L ${px(left + 2)} ${py(23.736)} L ${px(left + 2)} ${py(4.498)} L ${px(left)} ${py(4.498)} Z`).join(' ');
    return `<path d="${shell} ${inner} ${slots}" fill="${fill}" stroke="none"/>`;
  }
  if (port === 'mxgraph.aws4.resourceicon') {
    // mxAWS4.js: background fill, then resIcon stencil at a 10% inset with fill=strokeColor and no stroke.
    const resource = String(options.resIcon || '');
    const glyph = DRAWIO_STENCILS[resource];
    const background = options.resourceBackground === false ? '' : `<path d="M ${svgNumber(x)} ${svgNumber(y)} L ${svgNumber(x + width)} ${svgNumber(y)} L ${svgNumber(x + width)} ${svgNumber(y + height)} L ${svgNumber(x)} ${svgNumber(y + height)} Z" fill="${fill}" stroke="none"/>`;
    return `${background}${glyph ? stencilFillMarkup(resource, x + width * .1, y + height * .1, width * .8, height * .8, stroke) : ''}`;
  }
  if (port === 'mxgraph.arrows2.stripedarrow') {
    // mxArrows.js mxShapeArrows2StripedArrow.paintVertexShape.
    const dy = height * .5 * Math.max(0, Math.min(1, Number.isFinite(options.dy) ? options.dy : .5));
    const dx = Math.max(0, Math.min(width, Number.isFinite(options.dx) ? options.dx : .5));
    const notch = Math.max(0, Math.min(width, Number.isFinite(options.notch) ? options.notch : 0));
    return `<path d="M ${svgNumber(x + notch)} ${svgNumber(y + dy)} L ${svgNumber(x + width - dx)} ${svgNumber(y + dy)} L ${svgNumber(x + width - dx)} ${svgNumber(y)} L ${svgNumber(x + width)} ${svgNumber(y + height / 2)} L ${svgNumber(x + width - dx)} ${svgNumber(y + height)} L ${svgNumber(x + width - dx)} ${svgNumber(y + height - dy)} L ${svgNumber(x + notch)} ${svgNumber(y + height - dy)} Z M ${svgNumber(x)} ${svgNumber(y + height - dy)} L ${svgNumber(x + notch * .16)} ${svgNumber(y + height - dy)} L ${svgNumber(x + notch * .16)} ${svgNumber(y + dy)} L ${svgNumber(x)} ${svgNumber(y + dy)} Z M ${svgNumber(x + notch * .32)} ${svgNumber(y + height - dy)} L ${svgNumber(x + notch * .8)} ${svgNumber(y + height - dy)} L ${svgNumber(x + notch * .8)} ${svgNumber(y + dy)} L ${svgNumber(x + notch * .32)} ${svgNumber(y + dy)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  }
  if (port === 'mxgraph.kubernetes.icon') {
    // mxKubernetes.js: the frame in strokeColor, the same frame inset to 94% in
    // fillColor, then the prIcon glyph at a 20% inset in strokeColor.
    const glyph = `mxgraph.kubernetes.${String(options.prIcon || '').toLowerCase()}`;
    return `${stencilFillMarkup('mxgraph.kubernetes.frame', x, y, width, height, stroke)}${stencilFillMarkup('mxgraph.kubernetes.frame', x + width * .03, y + height * .03, width * .94, height * .94, fill)}${stencilFillMarkup(glyph, x + width * .2, y + height * .2, width * .6, height * .6, stroke)}`;
  }
  if (port === 'mxgraph.ios.iPhone') {
    // mxMockupiOS.js mxShapeMockupiPhone: a black body, a bezel highlight, the
    // screen, then the camera, speaker and home button.
    const round = width < 100 ? 4 : 25;
    const px = (value) => svgNumber(x + value); const py = (value) => svgNumber(y + value);
    const box = (left, top, wide, high, rx, ry, paint) => `<rect x="${px(left)}" y="${py(top)}" width="${svgNumber(wide)}" height="${svgNumber(high)}"${rx ? ` rx="${svgNumber(rx)}" ry="${svgNumber(ry)}"` : ''} ${paint}/>`;
    const oval = (left, top, wide, high, paint) => `<ellipse cx="${px(left + wide / 2)}" cy="${py(top + high / 2)}" rx="${svgNumber(wide / 2)}" ry="${svgNumber(high / 2)}" ${paint}/>`;
    const id = `drawio-iphone-${String(element.id || `${x}-${y}`).replace(/[^a-z0-9_-]/gi, '')}`;
    const ramp = (suffix, from, to) => `<linearGradient id="${id}-${suffix}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
    const screens = { bgWhite: '#ffffff', bgGray: '#dddddd', bgFlat: svgColor(element.paint?.fill, '#1f2923') };
    const screen = screens[options.bgStyle] || '#1f2923';
    return `<defs>${ramp('bezel', '#808080', '#000000')}${ramp('home', '#bbbbbb', '#000000')}</defs>`
      + box(0, 0, width, height, round, round, 'fill="#000000" stroke="#000000"')
      + `<path d="M ${px(width * .325)} ${py(0)} L ${px(width - round)} ${py(0)} A ${svgNumber(round)} ${svgNumber(round)} 0 0 1 ${px(width)} ${py(round)} L ${px(width)} ${py(height * .5)} L ${px(width * .7)} ${py(height * .5)} Z" fill="url(#${id}-bezel)" stroke="none"/>`
      + box(width * .0625, height * .15, width * .875, height * .7, 0, 0, `fill="${screen}" stroke="none"`)
      + box(width * .0625, height * .15, width * .875, height * .7, 0, 0, 'fill="none" stroke="#18211b" stroke-width="1"')
      + box(0, 0, width, height, round, round, 'fill="none" stroke="#dddddd" stroke-width="1.5" opacity=".8"')
      + (width > 50 ? box(5, 5, width - 10, height - 10, width < 100 ? 3 : 22.5, width < 100 ? 3 : 22.5, 'fill="none" stroke="#666666"') : '')
      + oval(width * .4875, height * .04125, width * .025, height * .0125, 'fill="#000099" stroke="#000000" stroke-width="2.5"')
      + box(width * .375, height * .075, width * .25, height * .01875, width * .02, height * .01, 'fill="#444444" stroke="#333333" stroke-width="1.5"')
      + oval(width * .4, height * .875, width * .2, height * .1, `fill="url(#${id}-home)" stroke="none"`)
      + oval(width * .404, height * .876, width * .19, height * .095, 'fill="none" stroke="#333333" stroke-width="1.5" opacity=".5"')
      + `<path d="M ${px(width * .4025)} ${py(height * .925)} A ${svgNumber(width * .0975)} ${svgNumber(height * .04625)} 0 0 1 ${px(width * .5975)} ${py(height * .925)} A ${svgNumber(width * .2)} ${svgNumber(height * .1)} 0 0 1 ${px(width * .4025)} ${py(height * .925)} Z" fill="#000000" stroke="#333333" stroke-width="1.5" opacity=".85"/>`
      + box(width * .4575, height * .905, width * .0875, height * .04375, height * .00625, height * .00625, 'fill="none" stroke="#dddddd" stroke-width="1.5" opacity=".7"');
  }
  if (port === 'umlActor') {
    // Shapes.js UmlActorShape.paintBackground: a filled head, then the body,
    // arms and legs as bare strokes.
    const px = (value) => svgNumber(x + value); const py = (value) => svgNumber(y + value);
    const head = `<ellipse cx="${px(width / 2)}" cy="${py(height / 8)}" rx="${svgNumber(width / 4)}" ry="${svgNumber(height / 8)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
    const limbs = `M ${px(width / 2)} ${py(height / 4)} L ${px(width / 2)} ${py(height * 2 / 3)} M ${px(width / 2)} ${py(height / 3)} L ${px(0)} ${py(height / 3)} M ${px(width / 2)} ${py(height / 3)} L ${px(width)} ${py(height / 3)} M ${px(width / 2)} ${py(height * 2 / 3)} L ${px(0)} ${py(height)} M ${px(width / 2)} ${py(height * 2 / 3)} L ${px(width)} ${py(height)}`;
    return `${head}<path d="${limbs}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  }
  if (port === 'note') {
    // Shapes.js NoteShape.paintVertexShape: the corner fold is `size`, clamped
    // so it can never exceed the shape it is cut from.
    const fold = Math.max(0, Math.min(width, height, Number.isFinite(Number(options.size)) ? Number(options.size) : 30));
    const px = (value) => svgNumber(x + value); const py = (value) => svgNumber(y + value);
    return `<path d="M ${px(0)} ${py(0)} L ${px(width - fold)} ${py(0)} L ${px(width)} ${py(fold)} L ${px(width)} ${py(height)} L ${px(0)} ${py(height)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  }
  if (port === 'mxgraph.cisco19.rect') {
    // mxCisco19.js: observed prIcon values use bg1 followed by the named Cisco19 stencil.
    const prIcon = String(options.prIcon || 'l2_switch').toLowerCase();
    const glyph = CISCO_RECT_TOKENS[prIcon];
    return `${stencilMarkup('mxgraph.cisco19.bg1', x, y, width, height, fill, stroke)}${glyph ? stencilMarkup(glyph, x, y, width, height, stroke, stroke) : ''}`;
  }
  return '';
}

function renderAwsFrame(element, fill, stroke, strokeWidth, dash) {
  const { x: rawX, y: rawY, width, height } = element.geometry; const options = element.drawioOptions || {}; const paint = element.paint || {};
  // mxGraph emits AWS group visuals inside a translate(.5,.5) wrapper. Apply
  // that raster alignment to the frame and group icon only, not its HTML label.
  const x = rawX + .5; const y = rawY + .5;
  const centered = /groupcenter/i.test(element.drawioToken || '');
  const token = awsGroupIconToken(options.grIcon); const icon = token ? DRAWIO_STENCILS[token] : null;
  const size = Math.max(1, Math.min(Math.min(width, height), Number(options.grIconSize) || 25));
  const iconX = centered ? x + (width - size) / 2 : x;
  const glyph = icon ? (options.grStroke === true ? stencilMarkup(token, iconX, y, size, size, stroke, stroke) : stencilFillMarkup(token, iconX, y, size, size, stroke)) : '';
  // AWS4 group paints the container frame first, then overlays grIcon.
  const frameDash = paint.lineStyle === 'dashed' ? ' stroke-dasharray="3 3"' : dash;
  const framePath = `M ${svgNumber(x)} ${svgNumber(y)} L ${svgNumber(x + width)} ${svgNumber(y)} L ${svgNumber(x + width)} ${svgNumber(y + height)} L ${svgNumber(x)} ${svgNumber(y + height)} Z`;
  const border = options.grStroke === false
    ? `<path d="${framePath}" fill="${fill}" stroke="none"/>`
    : `<path d="${framePath}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-miterlimit="10"${frameDash}/>`;
  return `${border}${glyph}`;
}

/** 미리보기, 적용 캔버스와 export에서 공유하는 허용된 draw.io 시각 모델 SVG renderer. */
export function renderDrawioVisualSvg(element, assets = []) {
  const { x, y, width, height } = element.geometry; const paint = element.paint || {}; const options = element.drawioOptions || {};
  const fill = svgColor(paint.fill, element.drawioShape === 'container' || element.drawioShape === 'aws-frame' ? '#f4f8f5' : '#ffffff');
  const stroke = svgColor(paint.stroke, '#000000'); const strokeWidth = Math.max(.5, Math.min(20, Number(paint.strokeWidth) || 1));
  const opacity = Math.max(0, Math.min(1, Number(paint.opacity) || 1)); const dash = options.dashed || paint.lineStyle === 'dashed' ? ' stroke-dasharray="7 5"' : '';
  const transform = [options.rotation ? `rotate(${svgNumber(options.rotation)} ${svgNumber(x + width / 2)} ${svgNumber(y + height / 2)})` : '', options.flipH || options.flipV ? `translate(${options.flipH ? svgNumber(2 * x + width) : 0} ${options.flipV ? svgNumber(2 * y + height) : 0}) scale(${options.flipH ? -1 : 1} ${options.flipV ? -1 : 1})` : ''].filter(Boolean).join(' ');
  const asset = assets.find((item) => item.id === element.imageAssetId);
  let body;
  if (asset) {
    const background = element.drawioShape && element.drawioShape !== 'image'
      ? (element.drawioShape.startsWith('network:') ? iconMarkup(element.drawioShape.slice(8), element.geometry, paint) : `<rect x="${svgNumber(x)}" y="${svgNumber(y)}" width="${svgNumber(width)}" height="${svgNumber(height)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>` )
      : '';
    body = `${background}<image x="${svgNumber(x)}" y="${svgNumber(y)}" width="${svgNumber(width)}" height="${svgNumber(height)}" preserveAspectRatio="${options.fixedAspect ? 'xMidYMid meet' : 'none'}" href="${svgAssetUri(asset)}"/>`;
  }
  else if (element.drawioShape?.startsWith('network:')) body = iconMarkup(element.drawioShape.slice(8), element.geometry, paint);
  else if (element.drawioShape?.startsWith('stencil:')) {
    body = stencilMarkup(element.drawioShape.slice(8), x, y, width, height, fill, stroke);
  }
  else if (element.drawioShape?.startsWith('port:')) body = renderExactPort(element, fill, stroke, strokeWidth, dash);
  else if (element.drawioShape === 'container' && element.drawioToken === 'group' && !element.text) body = '';
  else if (element.drawioShape === 'text') body = '';
  else if (element.drawioToken === 'line') {
    const horizontal = width >= height;
    // mxLine centers the stroke in the cell but uses half the nominal extent.
    // The source uses a 0.5px translation, already supplied by the page origin.
    const x1 = horizontal ? x : x + width / 2; const y1 = horizontal ? y + height / 2 : y;
    const x2 = horizontal ? x + width : x + width / 2; const y2 = horizontal ? y + height / 2 : y + height;
    body = `<path d="M ${svgNumber(x1)} ${svgNumber(y1)} L ${svgNumber(x2)} ${svgNumber(y2)}" fill="none" stroke="${svgColor(paint.stroke, '#000000')}" stroke-width="${strokeWidth}" stroke-miterlimit="10"${dash}/>`;
  }
  else if (element.drawioShape === 'cube') body = `<path d="M ${svgNumber(x + width * .18)} ${svgNumber(y + height * .18)} L ${svgNumber(x + width * .82)} ${svgNumber(y + height * .18)} L ${svgNumber(x + width)} ${svgNumber(y + height * .35)} L ${svgNumber(x + width * .82)} ${svgNumber(y + height * .52)} L ${svgNumber(x + width * .18)} ${svgNumber(y + height * .52)} L ${svgNumber(x)} ${svgNumber(y + height * .35)} Z M ${svgNumber(x + width * .18)} ${svgNumber(y + height * .52)} L ${svgNumber(x + width * .18)} ${svgNumber(y + height * .82)} L ${svgNumber(x + width * .82)} ${svgNumber(y + height * .82)} L ${svgNumber(x + width * .82)} ${svgNumber(y + height * .52)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  else if (element.drawioShape === 'cylinder3') body = `<path d="M ${svgNumber(x)} ${svgNumber(y + height * .18)} C ${svgNumber(x)} ${svgNumber(y - height * .06)} ${svgNumber(x + width)} ${svgNumber(y - height * .06)} ${svgNumber(x + width)} ${svgNumber(y + height * .18)} L ${svgNumber(x + width)} ${svgNumber(y + height * .82)} C ${svgNumber(x + width)} ${svgNumber(y + height * 1.06)} ${svgNumber(x)} ${svgNumber(y + height * 1.06)} ${svgNumber(x)} ${svgNumber(y + height * .82)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/><ellipse cx="${svgNumber(x + width / 2)}" cy="${svgNumber(y + height * .18)}" rx="${svgNumber(width / 2)}" ry="${svgNumber(height * .18)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  else if (element.drawioShape === 'hexagon') body = `<polygon points="${svgNumber(x + width * .2)},${svgNumber(y)} ${svgNumber(x + width * .8)},${svgNumber(y)} ${svgNumber(x + width)},${svgNumber(y + height / 2)} ${svgNumber(x + width * .8)},${svgNumber(y + height)} ${svgNumber(x + width * .2)},${svgNumber(y + height)} ${svgNumber(x)},${svgNumber(y + height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  else if (element.drawioShape === 'ellipse') body = `<ellipse cx="${svgNumber(x + width / 2)}" cy="${svgNumber(y + height / 2)}" rx="${svgNumber(width / 2)}" ry="${svgNumber(height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>`;
  else if (element.drawioShape === 'aws-frame') body = renderAwsFrame(element, fill, stroke, strokeWidth, dash);
  else { const header = element.drawioShape === 'container' || element.drawioShape === 'aws-frame' ? `<path d="M ${svgNumber(x)} ${svgNumber(y + Math.min(26, height * .25))} H ${svgNumber(x + width)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>` : ''; body = `<rect x="${svgNumber(x)}" y="${svgNumber(y)}" width="${svgNumber(width)}" height="${svgNumber(height)}" rx="${paint.rounded ? Math.min(14, width / 5, height / 5) : 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash}/>${header}`; }
  const gradient = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(paint.gradientColor || '') && paint.fill && paint.fill !== 'none' ? (() => {
    const id = `drawio-gradient-${String(element.id || `${x}-${y}-${width}-${height}`).replace(/[^a-z0-9_-]/gi, '')}`; const direction = options.gradientDirection || 'south';
    const vector = { north: 'x1="0" y1="1" x2="0" y2="0"', east: 'x1="0" y1="0" x2="1" y2="0"', west: 'x1="1" y1="0" x2="0" y2="0"', south: 'x1="0" y1="0" x2="0" y2="1"' }[direction];
    return { id, definition: `<defs><linearGradient id="${id}" ${vector}><stop offset="0" stop-color="${paint.gradientColor}"/><stop offset="1" stop-color="${fill}"/></linearGradient></defs>` };
  })() : null;
  if (gradient && !element.imageAssetId && !element.drawioShape?.startsWith('network:') && !element.drawioShape?.startsWith('stencil:')) body = body.replace(`fill="${fill}"`, `fill="url(#${gradient.id})"`);
  return `${gradient?.definition || ''}<g opacity="${opacity}"${transform ? ` transform="${transform}"` : ''}>${body}${labelMarkup(element, paint)}</g>`;
}

// ── mxGraph routing adapter ─────────────────────────────────────────────
// draw.io lays an orthogonal edge out with mxEdgeStyle and then meets the
// perimeter with mxPerimeter. Both are vendored unchanged, so the work here is
// only to present our parsed model the way mxGraphView presents its own.

class MxCellState {
  constructor(x, y, width, height, style) { this.x = x; this.y = y; this.width = width; this.height = height; this.style = style || {}; }
  clone() { return new MxCellState(this.x, this.y, this.width, this.height, this.style); }
  setRect(x, y, width, height) { this.x = x; this.y = y; this.width = width; this.height = height; }
  getCenterX() { return this.x + this.width / 2; }
  getCenterY() { return this.y + this.height / 2; }
}

function terminalState(shape) {
  if (!shape) return null;
  const { x, y, width, height } = shape.geometry; const options = shape.drawioOptions || {};
  return new MxCellState(x, y, width, height, Number.isFinite(options.rotation) ? { rotation: options.rotation } : {});
}

function fixedTerminal(shape, optionX, optionY, offsetX, offsetY) {
  if (!shape || !Number.isFinite(optionX) || !Number.isFinite(optionY)) return null;
  const { x, y, width, height } = shape.geometry;
  return new mxPoint(x + width * optionX + (offsetX || 0), y + height * optionY + (offsetY || 0));
}

// mxGraphView.getFloatingTerminalPoint: aim at the neighbouring route point,
// or at the opposite centre when the route has nothing to aim at yet.
function floatingTerminal(points, shape, opposite, isSource, border) {
  let next = points.length >= 2 ? points[isSource ? Math.min(1, points.length - 1) : Math.max(0, points.length - 2)] : null;
  if (!next && opposite) next = { x: opposite.geometry.x + opposite.geometry.width / 2, y: opposite.geometry.y + opposite.geometry.height / 2 };
  if (!next) return null;
  const { x, y, width, height } = shape.geometry; const grow = border || 0;
  const bounds = new mxRectangle(x - grow, y - grow, width + grow * 2, height + grow * 2);
  return mxPerimeter.RectanglePerimeter(bounds, terminalState(shape), new mxPoint(next.x, next.y), true);
}

function mxOrthogonalRoute(edge, sourceShape, targetShape) {
  const options = edge.drawioOptions || {}; const geometry = edge.geometry || {};
  const waypoints = (geometry.waypoints || edge.points || []).map((point) => new mxPoint(point.x, point.y));
  const source = terminalState(sourceShape); const target = terminalState(targetShape);
  const start = fixedTerminal(sourceShape, options.exitX, options.exitY, options.exitDx, options.exitDy) || (sourceShape ? null : geometry.sourcePoint && new mxPoint(geometry.sourcePoint.x, geometry.sourcePoint.y));
  const end = fixedTerminal(targetShape, options.entryX, options.entryY, options.entryDx, options.entryDy) || (targetShape ? null : geometry.targetPoint && new mxPoint(geometry.targetPoint.x, geometry.targetPoint.y));
  const view = { scale: 1, graph: {}, getRoutingCenterX: (state) => state.getCenterX(), getRoutingCenterY: (state) => state.getCenterY(), transformControlPoint: (_state, point) => new mxPoint(point.x, point.y) };
  const state = { absolutePoints: [start || null, end || null], style: edge.drawioStyle || {}, view };
  const points = [start || null];
  mxEdgeStyle.OrthConnector(state, source, target, waypoints.length ? waypoints : null, points);
  points.push(end || null);
  // mxGraphView fills the target end first, then the source, so the source sees
  // the settled neighbour.
  if (!points.at(-1) && targetShape) points[points.length - 1] = floatingTerminal(points, targetShape, sourceShape, false, Number(options.targetPerimeterSpacing) || 0);
  if (!points[0] && sourceShape) points[0] = floatingTerminal(points, sourceShape, targetShape, true, 0);
  const settled = points.filter(Boolean).map((point) => ({ x: point.x, y: point.y }));
  return settled.length >= 2 ? settled : null;
}

function edgeAnchor(shape, optionX, optionY, toward, explicit, perimeterSpacing = 0) {
  // mxGraphView.getFixedTerminalPoint keeps a stored terminal point only for an
  // end with no cell. A connected end goes on the perimeter, because the stored
  // point goes stale as soon as the shape moves.
  if (!shape) return explicit || null;
  const { x, y, width, height } = shape.geometry;
  if (Number.isFinite(optionX) && Number.isFinite(optionY)) return { x: x + width * optionX, y: y + height * optionY };
  const center = { x: x + width / 2, y: y + height / 2 };
  if (!toward) return center;
  const dx = toward.x - center.x; const dy = toward.y - center.y;
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(width / 2, 1), Math.abs(dy) / Math.max(height / 2, 1), 1);
  const anchor = { x: center.x + dx * scale, y: center.y + dy * scale };
  if (!perimeterSpacing) return anchor;
  const length = Math.hypot(anchor.x - center.x, anchor.y - center.y) || 1;
  return { x: anchor.x + (anchor.x - center.x) / length * perimeterSpacing, y: anchor.y + (anchor.y - center.y) / length * perimeterSpacing };
}

function orthogonalEdgeAnchor(shape, optionX, optionY, toward, explicit, perimeterSpacing = 0) {
  if (!shape || Number.isFinite(optionX) || Number.isFinite(optionY)) return edgeAnchor(shape, optionX, optionY, toward, explicit, perimeterSpacing);
  const { x, y, width, height } = shape.geometry; const center = { x: x + width / 2, y: y + height / 2 };
  if (!toward) return center;
  const dx = toward.x - center.x; const dy = toward.y - center.y;
  // draw.io meets the perimeter where the orthogonal run arrives and only
  // falls back to the face centre when that run passes outside the face.
  const onFace = (value, low, span) => value > low && value < low + span ? value : low + span / 2;
  const anchor = Math.abs(dx) >= Math.abs(dy)
    ? { x: center.x + Math.sign(dx || 1) * width / 2, y: onFace(toward.y, y, height) }
    : { x: onFace(toward.x, x, width), y: center.y + Math.sign(dy || 1) * height / 2 };
  if (!perimeterSpacing) return anchor;
  const length = Math.hypot(anchor.x - center.x, anchor.y - center.y) || 1;
  return { x: anchor.x + (anchor.x - center.x) / length * perimeterSpacing, y: anchor.y + (anchor.y - center.y) / length * perimeterSpacing };
}

function compactRoute(points) {
  return points.filter((point, index) => index === 0 || Math.abs(point.x - points[index - 1].x) > .01 || Math.abs(point.y - points[index - 1].y) > .01);
}

// A point in the middle of a straight run is not a corner. draw.io emits the
// turns only, so drop the rest and keep both paths comparable.
function dropCollinear(points) {
  return points.filter((point, index) => index === 0 || index === points.length - 1
    || Math.abs((point.x - points[index - 1].x) * (points[index + 1].y - points[index - 1].y) - (point.y - points[index - 1].y) * (points[index + 1].x - points[index - 1].x)) > .01);
}

// Which face an anchor sits on, so an orthogonal leg leaves and arrives the
// way draw.io draws it. Normalised so perimeter spacing does not change it.
function anchorAxis(shape, anchor) {
  if (!shape || !anchor) return null;
  const { x, y, width, height } = shape.geometry;
  const dx = Math.abs(anchor.x - (x + width / 2)) / Math.max(width / 2, 1);
  const dy = Math.abs(anchor.y - (y + height / 2)) / Math.max(height / 2, 1);
  return Math.abs(dx - dy) < .01 ? null : dx > dy ? 'horizontal' : 'vertical';
}

// draw.io stores orthogonal waypoints as guides and routes right angles
// through them. Joining them directly draws a diagonal whenever a waypoint
// does not share an axis with its neighbour, so insert the missing bend.
function orthogonalRoute(points, sourceShape, targetShape) {
  if (points.length < 2) return points;
  const entryAxis = anchorAxis(targetShape, points.at(-1));
  let axis = anchorAxis(sourceShape, points[0]);
  const out = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const previous = out.at(-1); const next = points[index];
    const movesX = Math.abs(next.x - previous.x) > .01; const movesY = Math.abs(next.y - previous.y) > .01;
    if (movesX && movesY) {
      const horizontal = index === points.length - 1 && entryAxis ? entryAxis === 'vertical' : axis !== 'vertical';
      out.push(horizontal ? { x: next.x, y: previous.y } : { x: previous.x, y: next.y });
      axis = horizontal ? 'horizontal' : 'vertical';
    } else if (movesX || movesY) axis = movesX ? 'vertical' : 'horizontal';
    out.push(next);
  }
  return compactRoute(out);
}

function edgeRoute(edge, sourceShape, targetShape) {
  const route = plotEdgeRoute(edge, sourceShape, targetShape);
  return { ...route, points: insetRoute(dropCollinear(route.points), edge) };
}

function plotEdgeRoute(edge, sourceShape, targetShape) {
  const options = edge.drawioOptions || {}; const geometry = edge.geometry || {}; const waypoints = geometry.waypoints || edge.points || [];
  const sourceHint = waypoints[0] || geometry.targetPoint || (targetShape ? elementCenter(targetShape) : null);
  const targetHint = waypoints.at(-1) || geometry.sourcePoint || (sourceShape ? elementCenter(sourceShape) : null);
  if (options.routeMode === 'orthogonal' && (sourceShape || geometry.sourcePoint) && (targetShape || geometry.targetPoint)) {
    const routed = mxOrthogonalRoute(edge, sourceShape, targetShape);
    if (routed) return { mode: 'orthogonal', points: compactRoute(routed) };
  }
  const anchoring = options.routeMode === 'orthogonal' || options.routeMode === 'elbow' ? orthogonalEdgeAnchor : edgeAnchor;
  const source = anchoring(sourceShape, options.exitX, options.exitY, sourceHint, geometry.sourcePoint);
  const target = anchoring(targetShape, options.entryX, options.entryY, targetHint, geometry.targetPoint, options.targetPerimeterSpacing);
  if (!source || !target) return { mode: 'line', points: compactRoute([source, ...waypoints, target].filter(Boolean)) };
  const base = compactRoute([source, ...waypoints, target]);
  if (base.length < 2) return { mode: 'line', points: base };
  if (options.routeMode === 'curved') return { mode: 'curved', points: base };
  if (options.routeMode === 'orthogonal' || options.routeMode === 'elbow') {
    if (waypoints.length) return { mode: 'orthogonal', points: orthogonalRoute(base, sourceShape, targetShape) };
    const vertical = options.elbow === 'vertical';
    const middle = vertical ? { x: (source.x + target.x) / 2, y: source.y } : { x: source.x, y: (source.y + target.y) / 2 };
    const middle2 = vertical ? { x: (source.x + target.x) / 2, y: target.y } : { x: target.x, y: (source.y + target.y) / 2 };
    return { mode: 'orthogonal', points: compactRoute([source, middle, middle2, target]) };
  }
  return { mode: 'line', points: base };
}

function segmentCrossing(a, b, c, d) {
  const rx = b.x - a.x; const ry = b.y - a.y; const sx = d.x - c.x; const sy = d.y - c.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-6) return null;
  const qx = c.x - a.x; const qy = c.y - a.y; const t = (qx * sy - qy * sx) / cross; const u = (qx * ry - qy * rx) / cross;
  if (t <= 1e-5 || t >= 1 - 1e-5 || u <= 1e-5 || u >= 1 - 1e-5) return null;
  return { x: a.x + rx * t, y: a.y + ry * t, t };
}

/** Build deterministic source-order crossing data for draw.io line jumps. */
export function createDrawioEdgeRenderContext(entries) {
  const prepared = entries.map((entry, order) => ({ ...entry, order, route: edgeRoute(entry.edge, entry.sourceShape, entry.targetShape), crossings: new Map() }));
  for (let later = 0; later < prepared.length; later += 1) {
    const item = prepared[later];
    if (!item.edge.drawioOptions?.jumpStyle || item.edge.drawioOptions.jumpStyle === 'none' || item.route.mode === 'curved') continue;
    for (let earlier = 0; earlier < later; earlier += 1) {
      const other = prepared[earlier];
      if (other.edge.id === item.edge.id || other.route.mode === 'curved') continue;
      for (let index = 1; index < item.route.points.length; index += 1) for (let otherIndex = 1; otherIndex < other.route.points.length; otherIndex += 1) {
        const crossing = segmentCrossing(item.route.points[index - 1], item.route.points[index], other.route.points[otherIndex - 1], other.route.points[otherIndex]);
        if (!crossing) continue;
        const list = item.crossings.get(index - 1) || []; list.push(crossing); item.crossings.set(index - 1, list);
      }
    }
    for (const list of item.crossings.values()) list.sort((a, b) => a.t - b.t || a.x - b.x || a.y - b.y);
  }
  return new Map(prepared.map((item) => [item.edge.id, { route: item.route, crossings: item.crossings }]));
}

// Graph.js paints a line jump from the run's own direction: half the jump size
// either side of the crossing, then the style's detour across that gap.
function jumpMarkup(style, crossing, unit, flip) {
  const point = (x, y) => `${svgNumber(x)} ${svgNumber(y)}`;
  const before = { x: crossing.x - unit.x, y: crossing.y - unit.y }; const after = { x: crossing.x + unit.x, y: crossing.y + unit.y };
  const head = ` L ${point(before.x, before.y)}`;
  if (style === 'sharp') return `${head} L ${point(before.x - unit.y * flip, before.y + unit.x * flip)} L ${point(after.x - unit.y * flip, after.y + unit.x * flip)} L ${point(after.x, after.y)}`;
  if (style === 'line') return `${head} M ${point(before.x + unit.y * flip, before.y - unit.x * flip)} L ${point(before.x - unit.y * flip, before.y + unit.x * flip)} M ${point(after.x - unit.y * flip, after.y + unit.x * flip)} L ${point(after.x + unit.y * flip, after.y - unit.x * flip)} M ${point(after.x, after.y)}`;
  if (style === 'arc') { const bow = flip * 1.3; return `${head} C ${point(before.x - unit.y * bow, before.y + unit.x * bow)} ${point(after.x - unit.y * bow, after.y + unit.x * bow)} ${point(after.x, after.y)}`; }
  return `${head} M ${point(after.x, after.y)}`;
}

function edgePath(route, crossings = new Map(), jumpStyle = null, jumpSize = 6, strokeWidth = 1) {
  if (route.points.length < 2) return '';
  const [first, ...rest] = route.points;
  const size = (jumpSize - 2) / 2 + strokeWidth;
  const away = (from, to) => (from.x - to.x) ** 2 + (from.y - to.y) ** 2 > size * size;
  if (route.mode !== 'curved') {
    let path = `M ${svgNumber(first.x)} ${svgNumber(first.y)}`;
    for (let index = 0; index < rest.length; index += 1) {
      const start = route.points[index]; const end = rest[index]; const dx = end.x - start.x; const dy = end.y - start.y; const length = Math.hypot(dx, dy);
      const jumps = jumpStyle && jumpStyle !== 'none' && length > 0 && size > 0 ? (crossings.get(index) || []) : [];
      const unit = { x: dx / (length || 1) * size, y: dy / (length || 1) * size };
      const flip = Math.round(unit.x) < 0 || (Math.round(unit.x) === 0 && Math.round(unit.y) <= 0) ? 1 : -1;
      let last = start;
      for (let jump = 0; jump < jumps.length; jump += 1) {
        const crossing = jumps[jump]; const next = jumps[jump + 1] || end;
        // draw.io leaves a crossing flat when either neighbour sits inside the gap.
        if (away(next, crossing) && away(last, crossing)) path += jumpMarkup(jumpStyle, crossing, unit, flip);
        last = crossing;
      }
      path += ` L ${svgNumber(end.x)} ${svgNumber(end.y)}`;
    }
    return path;
  }
  // mxPolyline.paintCurvedLine: every point but the last two becomes a control
  // point, and the curve passes through the midpoint between each pair. A single
  // cubic between the ends would skip the waypoints entirely.
  const points = route.points; const count = points.length;
  let path = `M ${svgNumber(first.x)} ${svgNumber(first.y)}`;
  for (let index = 1; index < count - 2; index += 1) {
    const control = points[index]; const next = points[index + 1];
    path += ` Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber((control.x + next.x) / 2)} ${svgNumber((control.y + next.y) / 2)}`;
  }
  const control = points[count - 2]; const end = points[count - 1];
  return `${path} Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber(end.x)} ${svgNumber(end.y)}`;
}

// The span mxMarker draws for each arrow. classic tapers to three quarters;
// the rest run full length.
function markerLength(type, size, strokeWidth) {
  if (!type || type === 'none') return 0;
  if (type === 'oval') return size;
  if (type === 'open' || type === 'openThin') return size + strokeWidth;
  const taper = type === 'classic' || type === 'classicThin' ? 3 / 4 : 1;
  return (size + strokeWidth) * taper + strokeWidth * 1.118;
}

// How far mxMarker moves the line end back. A filled arrow hides the line, so
// the line stops where the arrow starts. An open arrow is a bare V, so the line
// runs on to its tip and only clears the stroke join.
function markerInset(type, size, strokeWidth) {
  if (!type || type === 'none') return 0;
  if (type === 'oval') return size / 2;
  if (type === 'open' || type === 'openThin') return strokeWidth * 2.236;
  return markerLength(type, size, strokeWidth);
}

function insetTerminal(points, index, neighbour, distance) {
  if (!(distance > 0) || !points[index] || !points[neighbour]) return;
  const from = points[index]; const to = points[neighbour];
  const dx = to.x - from.x; const dy = to.y - from.y; const length = Math.hypot(dx, dy);
  if (!length) return;
  // mxGraph does not stop the pull-back at the neighbouring point, so a fixed
  // entry a hair off the perimeter still gets the whole arrow behind it.
  points[index] = { x: from.x + dx / length * distance, y: from.y + dy / length * distance };
}

// Pull both ends back by the marker each side actually draws, so the arrow
// occupies the same span draw.io gives it.
function insetRoute(points, edge) {
  if (points.length < 2) return points;
  const options = edge.drawioOptions || {};
  const strokeWidth = Math.max(.5, Math.min(20, Number(edge.paint?.strokeWidth) || 1));
  const moved = [...points];
  insetTerminal(moved, 0, 1, markerInset(options.startArrow, options.startSize || 6, strokeWidth));
  insetTerminal(moved, moved.length - 1, moved.length - 2, markerInset(options.endArrow ?? 'classic', options.endSize || 6, strokeWidth));
  return moved;
}

function edgeMarker(id, side, type, filled, size, stroke, strokeWidth = 1) {
  if (!type || type === 'none') return { definition: '', attribute: '' };
  const paths = { classic: 'M 0 0 L 10 5 L 0 10 Z', block: 'M 0 0 L 10 5 L 0 10 L 2 5 Z', blockThin: 'M 1 1 L 9 5 L 1 9 Z', open: 'M 1 1 L 9 5 L 1 9', oval: 'M 1 5 A 4 4 0 1 0 9 5 A 4 4 0 1 0 1 5' };
  const path = paths[type] || paths.classic; const markerId = `${id}-${side}`;
  const fill = type === 'open' || filled === false ? 'none' : stroke;
  // refX sits on the tip so the arrow trails back from the endpoint the way
  // draw.io draws it, and the box spans the length the line was pulled back by.
  const length = markerLength(type, size, strokeWidth) || size;
  return { definition: `<marker id="${markerId}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${svgNumber(length)}" markerHeight="${svgNumber(length)}" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/></marker>`, attribute: ` marker-${side}="url(#${markerId})"` };
}

/** Preview, applied canvas, and export share one safe draw.io edge renderer. */
export function renderDrawioEdgeSvg(edge, sourceShape, targetShape, id = edge.id || 'drawio-edge', context = null) {
  const rendered = context?.get(edge.id); const route = rendered?.route || edgeRoute(edge, sourceShape, targetShape);
  const options = edge.drawioOptions || {}; const paint = edge.paint || {};
  // draw.io uses black for an edge without an explicit strokeColor. The app
  // diagram palette uses muted green, but imported draw.io visuals must retain
  // their source default.
  // mxGraph's default edge is a 1px black mitered stroke. Preserve any
  // explicit imported strokeWidth unchanged.
  const stroke = svgColor(paint.stroke, '#000000'); const width = Math.max(.5, Math.min(20, Number(paint.strokeWidth) || 1));
  const dash = options.dashPattern ? ` stroke-dasharray="${options.dashPattern}"` : options.dashed || paint.lineStyle === 'dashed' ? ' stroke-dasharray="7 5"' : '';
  const start = edgeMarker(`${id}-marker`, 'start', options.startArrow, options.startFill, options.startSize || 6, stroke, width);
  const d = edgePath(route, rendered?.crossings, options.jumpStyle, Number(options.jumpSize) || 6, width);
  if (!d) return '';
  const end = edgeMarker(`${id}-marker`, 'end', options.endArrow ?? 'classic', options.endFill, options.endSize || 6, stroke, width);
  const label = edge.text ? (() => {
    const point = route.points[Math.floor(route.points.length / 2)] || route.points[0]; const font = options.fontFamily || 'Helvetica';
    const rotate = options.textDirection === 'vertical' ? ` transform="rotate(-90 ${svgNumber(point.x)} ${svgNumber(point.y)})"` : '';
    const background = options.labelBackgroundColor ? `<rect x="${svgNumber(point.x - Math.max(10, edge.text.length * 3.5))}" y="${svgNumber(point.y - 8)}" width="${svgNumber(Math.max(20, edge.text.length * 7))}" height="16" fill="${options.labelBackgroundColor}"/>` : '';
    return `${background}<text x="${svgNumber(point.x)}" y="${svgNumber(point.y)}" text-anchor="middle" dominant-baseline="middle" font-family="${font}" font-size="${Math.max(8, Math.min(72, Number(paint.fontSize) || 12))}"${rotate}>${svgText(edge.text)}</text>`;
  })() : '';
  return `<g class="drawio-edge">${start.definition}${end.definition}<path class="drawio-edge-line" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-miterlimit="10"${dash}${start.attribute}${end.attribute} vector-effect="non-scaling-stroke"/>${label}</g>`;
}

/** Parsed page만 사용해 외부 참조와 실행 markup이 없는 눈검사용 SVG를 만든다. */
export function renderDrawioPageSvg(page, assets = [], options = {}) {
  if (!page || !Array.isArray(page.elements)) throw error('invalid-preview-page', 'drawio 미리보기 페이지가 올바르지 않습니다.');
  const shapes = page.elements.filter((element) => element.type !== 'edge');
  const edges = page.elements.filter((element) => element.type === 'edge');
  const bySource = new Map(shapes.map((element) => [element.sourceId, element]));
  const edgeContext = createDrawioEdgeRenderContext(edges.map((edge) => ({ edge, sourceShape: bySource.get(edge.sourceSourceId), targetShape: bySource.get(edge.targetSourceId) })));
  const points = shapes.flatMap((element) => {
    const { geometry, drawioOptions = {}, paint = {}, text = '' } = element;
    const below = drawioOptions.verticalLabelPosition === 'bottom' && text;
    const labelExtent = below ? Math.max(10, (Number(paint.fontSize) || 12) * 1.4) : 0;
    return [{ x: geometry.x, y: geometry.y }, { x: geometry.x + geometry.width, y: geometry.y + geometry.height + labelExtent }];
  });
  for (const edge of edges) {
    const source = bySource.get(edge.sourceSourceId); const target = bySource.get(edge.targetSourceId);
    if (source) points.push(elementCenter(source));
    points.push(...(edge.points || []));
    if (target) points.push(elementCenter(target));
  }
  const xs = points.map(({ x }) => x).filter(Number.isFinite); const ys = points.map(({ y }) => y).filter(Number.isFinite);
  const raw = xs.length ? { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) } : { left: 0, top: 0, right: 960, bottom: 540 };
  const padding = 0;
  // draw.io crops an exported page to the cell bounds. Keep that local origin so a
  // fixed export viewport and the interactive preview use the same coordinates.
  const origin = { x: 1 - Math.ceil(raw.left), y: -Math.ceil(raw.top) };
  const computedView = { x: raw.left + origin.x - padding, y: raw.top + origin.y - padding, width: Math.max(160, raw.right - raw.left + padding * 2), height: Math.max(100, raw.bottom - raw.top + padding * 2) };
  const view = options.viewport && [options.viewport.x, options.viewport.y, options.viewport.width, options.viewport.height].every(Number.isFinite)
    ? options.viewport
    : computedView;
  const edgeMarkup = (edge) => renderDrawioEdgeSvg(edge, bySource.get(edge.sourceSourceId), bySource.get(edge.targetSourceId), `preview-${edge.id}`, edgeContext);
  const markup = page.elements.map((element) => {
    const sourceId = options.includeSourceIds === true ? ` data-cell-id="${svgDataId(element.sourceId)}"` : '';
    if (element.type === 'edge') { const rendered = options.renderEdges === false ? '' : edgeMarkup(element); return rendered ? `<g${sourceId}>${rendered}</g>` : ''; }
    let visual = options.renderLabels === false ? { ...element, text: '', labelRuns: [] } : element;
    if (options.renderResourceBackground === false && visual.drawioShape === 'port:mxgraph.aws4.resourceicon') visual = { ...visual, drawioOptions: { ...visual.drawioOptions, resourceBackground: false } };
    if (options.renderAwsGlyphs === false && (visual.drawioShape === 'aws-frame' || visual.drawioShape.startsWith('port:mxgraph.aws4'))) return { ...visual, drawioOptions: { ...visual.drawioOptions, grIcon: undefined, resIcon: undefined } }.drawioShape === 'aws-frame'
      ? renderAwsFrame({ ...visual, drawioOptions: { ...visual.drawioOptions, grIcon: undefined } }, svgColor(visual.paint?.fill, '#f4f8f5'), svgColor(visual.paint?.stroke, '#496b62'), Number(visual.paint?.strokeWidth) || 1, '')
      : `<rect x="${svgNumber(visual.geometry.x)}" y="${svgNumber(visual.geometry.y)}" width="${svgNumber(visual.geometry.width)}" height="${svgNumber(visual.geometry.height)}" fill="${svgColor(visual.paint?.fill, '#ffffff')}"/>`;
    if (options.renderFrames === false && visual.drawioShape === 'aws-frame') return '';
    return `<g${sourceId}>${renderDrawioVisualSvg(visual, assets)}</g>`;
  }).join('');
  return `<svg class="drawio-page-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${svgNumber(view.x)} ${svgNumber(view.y)} ${svgNumber(view.width)} ${svgNumber(view.height)}" role="img" aria-label="${svgText(page.name || 'drawio 페이지')} 시각 미리보기" preserveAspectRatio="xMidYMid meet"><rect x="${svgNumber(view.x)}" y="${svgNumber(view.y)}" width="${svgNumber(view.width)}" height="${svgNumber(view.height)}" fill="#ffffff"/><g transform="translate(${svgNumber(origin.x)} ${svgNumber(origin.y)})">${markup}</g></svg>`;
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

function visualOutcome(candidate) {
  if (candidate.drawioShape === 'image' && !candidate.imageAssetId) return 'inert-placeholder';
  if (candidate.drawioShape === 'vendor-fallback' || candidate.drawioShape === 'generic-fallback') return 'rendered-fallback';
  return 'rendered-exact';
}

function visualCounter(outcome) {
  return outcome === 'rendered-fallback' ? 'fallback' : outcome === 'rendered-partial' ? 'partial' : outcome === 'inert-placeholder' ? 'placeholder' : 'exact';
}

function deviceVisual(candidate, zIndex = candidate.zIndex) {
  const { width, height } = candidate.geometry;
  return { width, height, drawioShape: candidate.drawioShape, drawioOptions: candidate.drawioOptions, paint: candidate.paint, zIndex, ...(candidate.drawioToken ? { drawioToken: candidate.drawioToken } : {}), ...(candidate.imageAssetId ? { imageAssetId: candidate.imageAssetId } : {}), ...(candidate.labelRuns ? { labelRuns: candidate.labelRuns } : {}), ...(candidate.text ? { text: candidate.text } : {}) };
}

export function applyDrawioImport(topology, preview, decisions = preview.decisions || {}) {
  const next = structuredClone(topology); next.diagram ||= { shapes: [], connectors: [], groups: [] };
  next.diagram.drawioAssets ||= [];
  const assets = preview.assets || [];
  const knownAssetIds = new Set(next.diagram.drawioAssets.map((asset) => asset.id));
  for (const asset of assets) if (!knownAssetIds.has(asset.id)) { next.diagram.drawioAssets.push(structuredClone(asset)); knownAssetIds.add(asset.id); }
  const ids = new Set([...next.devices, ...next.links, ...next.diagram.shapes, ...next.diagram.connectors, ...next.diagram.groups].map((item) => item.id));
  const existingOrder = [
    ...next.devices.map((item) => item.drawioVisual?.zIndex), ...next.links.map((item) => item.drawioVisual?.zIndex),
    ...next.diagram.shapes.map((item) => item.zIndex), ...next.diagram.connectors.map((item) => item.zIndex),
  ].filter(Number.isInteger);
  const zOffset = existingOrder.length ? Math.max(...existingOrder) + 1 : 0;
  const sourceOrder = (value) => zOffset + (Number.isInteger(value) ? value : 0);
  const map = new Map(); const warnings = [...preview.warnings]; const applied = { devices: 0, zones: 0, annotations: 0, links: 0, visual: { exact: 0, fallback: 0, partial: 0, placeholder: 0, excluded: 0 } };
  const outcomes = {};
  const candidateBySource = new Map(preview.candidates.map((item) => [item.sourceId, item]));
  for (const candidate of preview.candidates) {
    const decision = decisions[candidate.id] || 'annotation';
    if (decision === 'exclude') { outcomes[candidate.sourceId] = 'explicit-exclude'; applied.visual.excluded += 1; continue; }
    const geometry = candidate.geometry;
    const kind = safeKind(typeof decision === 'object' ? decision.kind : candidate.suggestion.suggestedDeviceKind);
    if (decision === 'device' || typeof decision === 'object' && decision.type === 'device') {
      if (!kind) { warnings.push(warning('device-kind-required', candidate.id)); continue; }
      const id = uniqueId(ids, `device-${candidate.id}`);
      next.devices.push({ id, name: (candidate.text || id).slice(0, 80), kind, zone: 'UNASSIGNED', position: { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 }, limits: { forwarding_bps: null, forwarding_pps: null }, source: { type: 'drawio', label: 'draw.io import', condition: 'capacity unknown' }, enabled: true, drawioVisual: deviceVisual(candidate, sourceOrder(candidate.zIndex)) });
      map.set(candidate.sourceId, id); outcomes[candidate.sourceId] = visualOutcome(candidate); applied.visual[visualCounter(outcomes[candidate.sourceId])] += 1; applied.devices += 1; continue;
    }
    const id = uniqueId(ids, `shape-${candidate.id}`);
    const shape = { id, kind: candidate.drawioShape === 'ellipse' ? 'ellipse' : candidate.drawioShape === 'text' ? 'text' : 'rect', text: candidate.text, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, unmapped: true, drawioShape: candidate.drawioShape, drawioOptions: candidate.drawioOptions, paint: candidate.paint, zIndex: sourceOrder(candidate.zIndex), ...(candidate.drawioToken ? { drawioToken: candidate.drawioToken } : {}), ...(candidate.imageAssetId ? { imageAssetId: candidate.imageAssetId } : {}), ...(candidate.labelRuns ? { labelRuns: candidate.labelRuns } : {}) };
    next.diagram.shapes.push(shape); map.set(candidate.sourceId, id); applied.annotations += 1;
    outcomes[candidate.sourceId] = candidate.imageAssetId ? 'rendered-exact' : visualOutcome(candidate); applied.visual[visualCounter(outcomes[candidate.sourceId])] += 1;
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
      next.links.push({ id: uniqueId(ids, `link-${edge.id}`), source, target, capacity: { forwarding_bps: null }, enabled: true, drawioVisual: { zIndex: sourceOrder(edge.zIndex), paint: edge.paint, drawioOptions: edge.drawioOptions, geometry: edge.geometry } });
      outcomes[edge.sourceId] = visualOutcome(edge); applied.visual[visualCounter(outcomes[edge.sourceId])] += 1;
      applied.links += 1; continue;
    }
    const endpoints = [source, target];
    for (let index = 0; index < endpoints.length; index += 1) if (!endpoints[index]) {
      const anchorId = uniqueId(ids, `anchor-${edge.id}-${index + 1}`);
      const point = edge.points[index] || { x: 0, y: 0 };
      next.diagram.shapes.push({ id: anchorId, kind: 'text', text: '', x: point.x, y: point.y, width: 1, height: 1, opacity: 0, unmapped: true }); endpoints[index] = anchorId;
    }
    if (endpoints[0] === endpoints[1]) { warnings.push(warning('self-edge-annotation', edge.id)); continue; }
    const connector = { id: uniqueId(ids, `connector-${edge.id}`), source: endpoints[0], target: endpoints[1], kind: 'annotation', label: edge.text, waypoints: edge.geometry?.waypoints || edge.points, zIndex: sourceOrder(edge.zIndex), ...connectorStyle(edge.paint), drawioOptions: edge.drawioOptions, drawioGeometry: edge.geometry };
    next.diagram.connectors.push(connector); applied.annotations += 1; outcomes[edge.sourceId] = visualOutcome(edge); applied.visual[visualCounter(outcomes[edge.sourceId])] += 1;
  }
  for (const edge of preview.page.elements.filter((item) => item.type === 'edge')) if (!outcomes[edge.sourceId]) { outcomes[edge.sourceId] = visualOutcome(edge); applied.visual[visualCounter(outcomes[edge.sourceId])] += 1; }
  if (Object.keys(outcomes).length !== preview.page.elements.length) throw error('visual-accounting-failed', 'drawio 요소 시각 적용 결과가 누락되었습니다.');
  next.diagram.drawioImport = { pageId: preview.page.id, warningCodes: warnings.map((item) => item.code), decisions: Object.fromEntries(preview.candidates.map((item) => [item.id, decisions[item.id] || 'annotation'])), outcomes };
  return { topology: next, sourceToTargetId: Object.fromEntries(map), applied, warnings };
}
