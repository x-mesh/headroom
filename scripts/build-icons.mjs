// vendor/drawio-stencils/networks.subset.xml → public/icons.js
// 네트워크를 쓰지 않는다. 서브셋을 가져오는 것은 scripts/vendor-stencils.mjs 의 일이다.
//
// mxGraph 스텐실은 명령형 캔버스다. 도형 명령(rect/roundrect/ellipse/path)이 대기 노드를
// 하나 채우고, 뒤따르는 도색 명령(fill/stroke/fillstroke)이 그 하나를 방출한 뒤 비운다.
// 도형은 누적되지 않는다 — 대기 노드가 찬 상태에서 도형 명령이 또 오면 앞의 것이 버려지므로,
// 그런 입력은 우리 모델이 틀렸다는 신호로 보고 실패시킨다.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const subsetFile = resolve(root, 'vendor/drawio-stencils/networks.subset.xml');
const referenceSubsetFile = resolve(root, 'vendor/drawio-stencils/references.subset.xml');
const provenanceFile = resolve(root, 'vendor/drawio-stencils/PROVENANCE.json');
const outputFile = resolve(root, 'public/icons.js');

// 프로젝트의 kind 문자열 → drawio 도형명. rack/cloud 는 kind 가 아니라 폴백용이다.
// 이 스텐실 계열은 서버 변종을 "같은 스택 + 작은 표식"으로 그린다. 우리 심볼 칸에서는 그
// 표식이 10px 아래로 줄어 구별되지 않으므로, 외곽선 자체가 다른 도형이 있으면 그쪽을 고른다.
// db 는 원기둥(Storage)이 데이터베이스 관습이고, 그 자리를 내준 storage 는 External Storage 다.
const STENCILS = {
  switch: 'Switch', router: 'Router', hub: 'Hub', wireless: 'Wireless Hub', modem: 'Modem',
  firewall: 'Firewall', lb: 'Load Balancer', waf: 'Proxy Server',
  vpn: 'Comm Link', sslvpn: 'Secured', ips: 'Security Camera',
  server: 'Server', web: 'Web Server', vm: 'Virtual Server', mainframe: 'Mainframe',
  mail: 'Mail Server', db: 'Storage',
  storage: 'External Storage', nas: 'NAS Filer', backup: 'Tape Storage',
  client: 'Users', rack: 'Rack', cloud: 'Cloud', mobile: 'Mobile', pc: 'PC', 'server-storage': 'Server Storage',
};
// 스트로크는 경로 위에 중앙 정렬되므로 선언 박스를 넘는다. 8개 도형의 실측 필요값은 1.0 이다.
const PAD = 2;
// 리터럴 색을 화이트리스트로 막는다. 업스트림이 브랜드 색을 넣으면 생성물에 박히지 않고 빌드가 깨진다.
const COLOR_TOKENS = { '#ffffff': '--icon-accent' };
const INHERIT = { kind: 'inherit' };
const NONE = { kind: 'none' };
const BASE_STROKE_WIDTH = 2;

const PATH_COMMANDS = {
  move: { code: 'M', args: ['x', 'y'] },
  line: { code: 'L', args: ['x', 'y'] },
  arc: { code: 'A', args: ['rx', 'ry', 'x-axis-rotation', 'large-arc-flag', 'sweep-flag', 'x', 'y'] },
  quad: { code: 'Q', args: ['x1', 'y1', 'x2', 'y2'] },
  curve: { code: 'C', args: ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'] },
  close: { code: 'Z', args: [] },
};

const fail = (message) => { throw new Error(message); };

// 좌표는 소수 3자리로 고정한다. 생성물을 커밋하고 diff 하므로 결정성이 목적이다.
function fmt(value) {
  if (!Number.isFinite(value)) fail(`유한하지 않은 좌표: ${value}`);
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function num(node, name, fallback) {
  const raw = node.attrs[name];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    fail(`<${node.tag}>에 ${name} 속성이 없습니다.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) fail(`<${node.tag}> ${name}="${raw}"는 숫자가 아닙니다.`);
  return value;
}

// drawio 스텐실 서브셋 전용 최소 리더. 이 파일에는 주석·CDATA·엔티티·작은따옴표 속성·
// 텍스트 노드가 하나도 없다(확인함). 그 밖의 구문을 만나면 조용히 넘기지 않고 실패한다.
export function parseXml(source) {
  const tag = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  const stack = [{ tag: '#root', attrs: {}, children: [] }];
  let cursor = 0;
  let match;
  while ((match = tag.exec(source))) {
    const between = source.slice(cursor, match.index);
    if (between.trim()) fail(`텍스트 노드는 지원하지 않습니다: ${between.trim().slice(0, 40)}`);
    if (/<[!?]/.test(between) || /<[!?]/.test(source.slice(match.index, match.index + 2))) fail('주석·CDATA·처리 명령은 지원하지 않습니다.');
    cursor = tag.lastIndex;
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (!open || open.tag !== name) fail(`닫는 태그가 맞지 않습니다: </${name}>`);
      continue;
    }
    const attrs = {};
    for (const [, key, value] of rawAttrs.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(value)) fail(`엔티티는 지원하지 않습니다: ${key}="${value}"`);
      attrs[key] = value;
    }
    const node = { tag: name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const rest = source.slice(cursor);
  if (rest.trim()) fail(`텍스트 노드는 지원하지 않습니다: ${rest.trim().slice(0, 40)}`);
  if (stack.length !== 1) fail(`닫히지 않은 태그: <${stack[stack.length - 1].tag}>`);
  return stack[0];
}

export function buildPathData(children) {
  const parts = [];
  let started = false;
  for (const child of children) {
    const command = PATH_COMMANDS[child.tag] || fail(`<path> 안에서 알 수 없는 명령: <${child.tag}>`);
    if (child.children.length) fail(`<${child.tag}>는 자식을 가질 수 없습니다.`);
    for (const key of Object.keys(child.attrs)) {
      if (!command.args.includes(key)) fail(`<${child.tag}>에 알 수 없는 속성: ${key}`);
    }
    if (child.tag === 'move') started = true;
    else if (!started) fail(`<${child.tag}>가 시작점 없이 등장했습니다.`);
    parts.push([command.code, ...command.args.map((arg) => fmt(num(child, arg)))].join(' '));
  }
  if (!parts.length) fail('빈 <path>입니다.');
  return parts.join(' ');
}

const samePaint = (a, b) => a.kind === b.kind && a.value === b.value;
const sameState = (a, b) => samePaint(a.fill, b.fill) && samePaint(a.stroke, b.stroke) && a.strokeWidth === b.strokeWidth && a.dash === b.dash && a.opacity === b.opacity;

export function interpretShape(shape, { literalColors = false } = {}) {
  const name = shape.attrs.name || fail('이름 없는 <shape>입니다.');
  if (!['variable', 'fixed'].includes(shape.attrs.aspect)) fail(`${name}: aspect="${shape.attrs.aspect}"는 지원하지 않습니다.`);
  if (![String(BASE_STROKE_WIDTH), 'inherit'].includes(shape.attrs.strokewidth)) fail(`${name}: strokewidth="${shape.attrs.strokewidth}"는 지원하지 않습니다.`);
  const width = num(shape, 'w');
  const height = num(shape, 'h');
  const foreground = shape.children.find((child) => child.tag === 'foreground') || fail(`${name}: <foreground>가 없습니다.`);
  for (const child of shape.children) {
    if (!['connections', 'background', 'foreground'].includes(child.tag)) fail(`${name}: <shape> 아래에 알 수 없는 요소 <${child.tag}>`);
  }

  const state = { fill: INHERIT, stroke: INHERIT, strokeWidth: BASE_STROKE_WIDTH, dash: null, opacity: 1 };
  // save/restore 는 도색 상태만 쌓았다 되돌린다. 경로는 대기 노드가 따로 들고 있다.
  const stateStack = [];
  const elements = [];
  let pending = null;
  let paints = 0;
  let skipped = 0;

  const setPending = (tag, attrs) => {
    if (pending) fail(`${name}: 도색되지 않은 도형 위에 <${tag}>가 왔습니다. 앞의 도형이 버려집니다.`);
    pending = { tag, attrs };
  };
  const emit = (fill, stroke) => {
    if (!pending) fail(`${name}: 그릴 도형 없이 도색 명령이 왔습니다.`);
    // 속성 없는 rect 는 크기 0 이다. mxGraph 가 save/restore 뒤 대기 노드를 비울 때 쓰는
    // 관용구이며 화면에 아무것도 남기지 않으므로 생성물에서 뺀다.
    if (pending.tag === 'rect' && (!pending.attrs.width || !pending.attrs.height)) skipped += 1;
    else elements.push({ ...pending, fill, stroke, strokeWidth: state.strokeWidth, dash: state.dash, opacity: state.opacity });
    pending = null;
    paints += 1;
  };

  for (const layer of shape.children.filter((child) => child.tag === 'background' || child.tag === 'foreground')) for (const node of layer.children) {
    switch (node.tag) {
      case 'linejoin': break;
      case 'rect': setPending('rect', { x: num(node, 'x', 0), y: num(node, 'y', 0), width: num(node, 'w', 0), height: num(node, 'h', 0) }); break;
      case 'roundrect': {
        const w = num(node, 'w');
        const h = num(node, 'h');
        const arcsize = node.attrs.arcsize === undefined ? 15 : num(node, 'arcsize');
        const radius = Math.min(w, h) * (arcsize / 100);
        setPending('rect', { x: num(node, 'x'), y: num(node, 'y'), width: w, height: h, rx: radius, ry: radius });
        break;
      }
      case 'ellipse': {
        const w = num(node, 'w');
        const h = num(node, 'h');
        setPending('ellipse', { cx: num(node, 'x') + w / 2, cy: num(node, 'y') + h / 2, rx: w / 2, ry: h / 2 });
        break;
      }
      case 'path':
        if (Object.keys(node.attrs).length) fail(`${name}: <path>에 알 수 없는 속성: ${Object.keys(node.attrs).join(', ')}`);
        setPending('path', { d: buildPathData(node.children) });
        break;
      case 'fill': emit(state.fill, NONE); break;
      case 'stroke': emit(NONE, state.stroke); break;
      case 'fillstroke': emit(state.fill, state.stroke); break;
      case 'fillcolor': case 'strokecolor': {
        const color = (node.attrs.color || '').toLowerCase();
        const key = node.tag === 'fillcolor' ? 'fill' : 'stroke';
        if (color === 'none') { state[key] = NONE; break; }
        const token = COLOR_TOKENS[color];
        if (!token && (!literalColors || !/^#[0-9a-f]{6}$/i.test(color))) fail(`${name}: 허용되지 않은 색 ${node.attrs.color}`);
        state[key] = { kind: 'literal', value: color, ...(token ? { token } : {}) };
        break;
      }
      case 'alpha': {
        const value = num(node, 'alpha');
        if (value < 0 || value > 1) fail(`${name}: alpha 범위가 아닙니다.`);
        state.opacity = value;
        break;
      }
      case 'dashpattern': state.dash = String(node.attrs.pattern || '').trim() || null; break;
      case 'dashed': if (node.attrs.dashed !== '1') state.dash = null; break;
      case 'strokewidth': {
        if (node.attrs.fixed === '1') fail(`${name}: strokewidth fixed="1"은 지원하지 않습니다.`);
        const value = num(node, 'width');
        if (value <= 0 || value > 20) fail(`${name}: strokewidth="${value}"는 지원하지 않습니다.`);
        state.strokeWidth = value;
        break;
      }
      case 'save': stateStack.push({ ...state }); break;
      case 'restore': {
        const saved = stateStack.pop() || fail(`${name}: restore 에 짝이 되는 save 가 없습니다.`);
        Object.assign(state, saved);
        break;
      }
      default: fail(`${name}: 알 수 없는 명령 <${node.tag}>`);
    }
  }

  if (pending) fail(`${name}: 도색되지 않은 도형이 남았습니다.`);
  if (stateStack.length) fail(`${name}: 닫히지 않은 save 가 ${stateStack.length}개 남았습니다.`);
  if (elements.length + skipped !== paints) fail(`${name}: 방출 수(${elements.length}+${skipped})와 도색 명령 수(${paints})가 다릅니다.`);
  assertInsideBox(name, elements, width, height);
  return { name, width, height, elements };
}

// 좌표가 선언 박스를 벗어나면 viewBox 패딩 가정이 깨졌다는 신호다.
function assertInsideBox(name, elements, width, height) {
  const check = (x, y) => {
    if (x < -1e-6 || x > width + 1e-6 || y < -1e-6 || y > height + 1e-6) fail(`${name}: 좌표 (${x}, ${y})가 선언 박스 ${width}x${height}를 벗어납니다.`);
  };
  for (const { tag, attrs } of elements) {
    if (tag === 'rect') { check(attrs.x, attrs.y); check(attrs.x + attrs.width, attrs.y + attrs.height); }
    else if (tag === 'ellipse') { check(attrs.cx - attrs.rx, attrs.cy - attrs.ry); check(attrs.cx + attrs.rx, attrs.cy + attrs.ry); }
    else for (const segment of attrs.d.split(/(?=[MLAQCZ])/)) {
      if (segment[0] === 'Z') continue;
      const values = segment.slice(1).trim().split(/\s+/).map(Number);
      check(values[values.length - 2], values[values.length - 1]);
    }
  }
}

const ATTR_ORDER = { rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], ellipse: ['cx', 'cy', 'rx', 'ry'], path: ['d'] };

function geometryMarkup(element, stateAttrs) {
  const attrs = ATTR_ORDER[element.tag]
    .filter((key) => element.attrs[key] !== undefined)
    .map((key) => `${key}="${key === 'd' ? element.attrs[key] : fmt(element.attrs[key])}"`);
  return `<${element.tag} ${[...attrs, ...stateAttrs].join(' ')}/>`;
}

// 루트 <g>가 상속 상태를 담고, 그와 다른 상태가 연속으로 이어지면 래퍼 <g>로 묶는다.
function stateMarkup(state, base) {
  const attrs = [];
  const styles = [];
  for (const key of ['fill', 'stroke']) {
    if (samePaint(state[key], base[key])) continue;
    if (state[key].kind === 'none') attrs.push(`${key}="none"`);
    else if (state[key].kind === 'literal') {
      if (state[key].token) styles.push(`${key}:var(${state[key].token},${state[key].value})`);
      else attrs.push(`${key}="${state[key].value}"`);
    }
    else fail(`상속 상태를 되돌릴 수 없습니다: ${key}`);
  }
  if (state.strokeWidth !== base.strokeWidth) attrs.push(`stroke-width="${fmt(state.strokeWidth)}"`);
  if (state.opacity !== base.opacity) attrs.push(`opacity="${fmt(state.opacity)}"`);
  if (state.dash !== base.dash) attrs.push(`stroke-dasharray="${state.dash ?? 'none'}"`);
  if (styles.length) attrs.push(`style="${styles.join(';')}"`);
  return attrs;
}

export function serializeBody(elements) {
  const base = { fill: INHERIT, stroke: INHERIT, strokeWidth: BASE_STROKE_WIDTH, dash: null, opacity: 1 };
  const runs = [];
  for (const element of elements) {
    const last = runs[runs.length - 1];
    if (last && sameState(last.state, element)) last.items.push(element);
    else runs.push({ state: { fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth, dash: element.dash, opacity: element.opacity }, items: [element] });
  }
  const body = runs.map((run) => {
    const attrs = stateMarkup(run.state, base);
    if (!attrs.length) return run.items.map((item) => geometryMarkup(item, [])).join('');
    if (run.items.length === 1) return geometryMarkup(run.items[0], attrs);
    return `<g ${attrs.join(' ')}>${run.items.map((item) => geometryMarkup(item, [])).join('')}</g>`;
  }).join('');
  const rootStyle = `fill:var(--icon-fill,none);stroke:var(--icon-line,currentColor);stroke-width:${BASE_STROKE_WIDTH}`;
  return `<g style="${rootStyle}">${body}</g>`;
}

function renderModule(icons, drawioStencils, provenance) {
  const entries = icons.map(({ kind, id, stencil, width, height, viewBox, body }) =>
    `  ${JSON.stringify(kind)}: Object.freeze({ id: '${id}', stencil: '${stencil}', width: ${width}, height: ${height}, viewBox: '${viewBox}', body: ${JSON.stringify(body)} }),`).join('\n');
  const stencilEntries = drawioStencils.map(({ drawioId, path, stencil, width, height, viewBox, body }) =>
    `  ${JSON.stringify(drawioId)}: Object.freeze({ path: '${path}', stencil: '${stencil}', width: ${width}, height: ${height}, viewBox: '${viewBox}', body: ${JSON.stringify(body)} }),`).join('\n');
  const portEntries = (provenance.subsets?.exactPorts || []).map(({ drawioId, path, renderer }) =>
    `  ${JSON.stringify(drawioId)}: Object.freeze({ path: '${path}', renderer: '${renderer}' }),`).join('\n');
  return `// GENERATED by scripts/build-icons.mjs — do not edit.
// Source: drawio stencil subsets @ ${provenance.commit} (Apache-2.0)
// See vendor/drawio-stencils/NOTICE.md for the stencil license restriction.

export const ICON_SOURCE = Object.freeze({
  upstream: '${provenance.upstream}',
  path: '${provenance.subsets.networks.path}',
  commit: '${provenance.commit}',
  license: 'Apache-2.0',
  notice: 'vendor/drawio-stencils/NOTICE.md',
});

/** viewBox 패딩(스텐실 단위). 스트로크가 중앙 정렬이라 선언 박스를 넘는 만큼을 준다. */
export const ICON_PAD = ${PAD};

export const ICONS = Object.freeze({
${entries}
});

export const ICON_KINDS = Object.freeze(Object.keys(ICONS));

/** draw.io token → byte-exact upstream stencil SVG. 제품 장비 아이콘 목록에는 포함하지 않는다. */
export const DRAWIO_STENCILS = Object.freeze({
${stencilEntries}
});

/** upstream JS source를 좁은 SVG renderer로 포트한 exact token registry. */
export const DRAWIO_EXACT_PORTS = Object.freeze({
${portEntries}
});

/** 알 수 없는 kind 폴백. 외부·인터넷 경계는 cloud 를 쓴다. */
export const ICON_FALLBACK = 'rack';
export const ICON_EXTERNAL = 'cloud';

export const ICON_SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">'
  + Object.values(ICONS).map((icon) => \`<symbol id="\${icon.id}" viewBox="\${icon.viewBox}" preserveAspectRatio="xMidYMid meet">\${icon.body}</symbol>\`).join('')
  + '</svg>';
`;
}

async function generate() {
  const [xml, referencesXml, provenanceRaw] = await Promise.all([readFile(subsetFile, 'utf8'), readFile(referenceSubsetFile, 'utf8'), readFile(provenanceFile, 'utf8')]);
  const provenance = JSON.parse(provenanceRaw);
  const shapes = parseXml(xml).children[0].children.filter((child) => child.tag === 'shape');
  const byName = new Map();
  for (const shape of shapes) {
    if (byName.has(shape.attrs.name)) fail(`도형 이름이 중복입니다: ${shape.attrs.name}`);
    byName.set(shape.attrs.name, shape);
  }
  const icons = Object.entries(STENCILS).map(([kind, stencil]) => {
    const shape = byName.get(stencil) || fail(`서브셋에 없는 도형: ${stencil}`);
    const { width, height, elements } = interpretShape(shape);
    return {
      kind, stencil, id: `icon-${kind}`, width, height,
      viewBox: `${-PAD} ${-PAD} ${fmt(width + PAD * 2)} ${fmt(height + PAD * 2)}`,
      body: serializeBody(elements),
    };
  });
  const referenceShapes = parseXml(referencesXml).children[0].children.filter((child) => child.tag === 'shape');
  const references = provenance.subsets?.references?.stencils || fail('reference stencil provenance가 없습니다.');
  if (referenceShapes.length !== references.length) fail('reference stencil 개수가 provenance와 다릅니다.');
  const drawioStencils = referenceShapes.map((shape, index) => {
    const reference = references[index];
    if (shape.attrs.name !== reference.name) fail(`reference stencil 순서가 다릅니다: ${reference.drawioId}`);
    const { width, height, elements } = interpretShape(shape, { literalColors: true });
    return { drawioId: reference.drawioId, path: reference.path, stencil: reference.name, width, height, viewBox: `${-PAD} ${-PAD} ${fmt(width + PAD * 2)} ${fmt(height + PAD * 2)}`, body: serializeBody(elements) };
  });
  return { source: renderModule(icons, drawioStencils, provenance), icons, drawioStencils };
}

async function main() {
  const { source, icons, drawioStencils } = await generate();
  if (process.argv.includes('--check')) {
    const current = await readFile(outputFile, 'utf8').catch(() => null);
    if (current !== source) fail('public/icons.js가 최신이 아닙니다. `make icons`를 실행하세요.');
    console.log(`icons ok · ${icons.length} symbols · ${drawioStencils.length} draw.io stencils`);
    return;
  }
  await writeFile(outputFile, source);
  for (const icon of icons) console.log(`${icon.id.padEnd(14)} ${String(icon.width).padStart(5)}x${String(icon.height).padEnd(6)} ${String(icon.body.length).padStart(5)} bytes`);
  console.log(`public/icons.js  ${Buffer.byteLength(source, 'utf8')} bytes`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
