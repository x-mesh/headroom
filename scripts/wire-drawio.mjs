// drawio 구성도를 장비와 링크가 이어진 프로젝트 파일로 바꾼다. 앱의 가져오기 미리보기가
// 사람 손으로 하는 일 - 의미 수락, 끝점 지정, 용량 기입 - 을 한 번에 돌린다.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpec, catalogFor } from '../public/devices/catalog.js';
import { retargetConnector } from '../public/diagram.js';
import { applyDrawioImport, createDrawioPreview, parseDrawioDocument } from '../public/drawio-import.js';
import { addDemand, applySpecToKind, promoteConnector } from '../public/editor.js';
import { calculateScenario } from '../public/engine.js';
import { serializeProject } from '../public/project.js';

const USAGE = `사용법: node scripts/wire-drawio.mjs <파일.drawio> [옵션]

  --out <경로>          결과 JSON 경로 (기본: <입력 이름>.json)
  --page <번호>         페이지 번호, 0부터 (기본: 0)
  --snap <px>           떠 있는 끝점을 장비에 붙일 최대 거리 (기본: 60, 0 이면 붙이지 않음)
  --accept <무엇>=<종류>  분류기가 정하지 못한 도형을 장비로 수락한다. 여러 번 쓸 수 있다.
                        <무엇> 은 도형 이름(cube, stencil:mxgraph.aws3.s3) 또는 라벨(text:Validators)
  --capacity <bps>      링크마다 넣을 용량. 없으면 미확인으로 남는다. (예: 10G)
  --demand <bps>        링크마다 넣을 수요. 없으면 수요를 만들지 않는다. (예: 1G)
  --spec                장비 종류마다 카탈로그 첫 항목의 한계를 적용한다
  --dry-run             파일을 쓰지 않고 결과만 보고한다

용량과 수요는 기본값이 없다. 모르는 값을 적어 두면 나중에 측정값과 구별할 수 없기 때문이다.`;

const CLEAN = (value) => String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const SCALES = { k: 1e3, m: 1e6, g: 1e9, t: 1e12 };

export function parseRate(value, label) {
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt])?(?:bps)?$/i.exec(String(value).trim());
  if (!match) throw new Error(`${label} 값을 읽을 수 없습니다: ${value}`);
  return Number(match[1]) * (match[2] ? SCALES[match[2].toLowerCase()] : 1);
}

// 분류기가 종류를 정한 도형은 그대로 수락한다. 앱의 "높은 신뢰도 수락"과 같은 판단이다.
// 나머지는 --accept 로 사람이 정한 것만 장비가 된다. cube 나 이미지처럼 그림마다 뜻이
// 달라지는 도형은 분류기가 건드리지 않으므로 여기서만 이름을 얻는다.
export function decideCandidates(candidates, accepts = []) {
  const decisions = {}; const report = { classifier: 0, byHand: 0, undecided: [] };
  for (const candidate of candidates) {
    const kind = candidate.suggestion.suggestedDeviceKind;
    if (kind) { decisions[candidate.id] = { type: 'device', kind }; report.classifier += 1; continue; }
    const match = accepts.find(({ what, isText }) => (isText ? CLEAN(candidate.text) === what : candidate.drawioShape === what));
    if (match) { decisions[candidate.id] = { type: 'device', kind: match.kind }; report.byHand += 1; continue; }
    if (candidate.suggestion.classification === 'device-candidate') report.undecided.push({ shape: candidate.drawioShape, text: CLEAN(candidate.text) });
  }
  // 같은 도형이 여러 번 나와도 --accept 줄은 한 번만 쓰면 된다.
  report.undecided = [...new Map(report.undecided.map((entry) => [`${entry.shape}\t${entry.text}`, entry])).values()];
  return { decisions, report };
}

const rectOf = (device) => {
  const width = device.drawioVisual?.width ?? 50; const height = device.drawioVisual?.height ?? 50;
  return { x: device.position.x - width / 2, y: device.position.y - height / 2, width, height };
};
const gapToRect = (point, rect) => Math.hypot(
  Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width)),
  Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height)));

// 끝점을 장비로 바꾼다. mxGraph 의미론을 따른다: 셀이 붙어 있으면 그 셀이 이기고, draw.io 가
// 남겨 둔 sourcePoint 는 무시한다. 붙지 않은 끝점만 좌표로 가장 가까운 장비를 찾는다.
// 거리는 중심점이 아니라 사각형 경계로 잰다. 중심점으로 재면 큰 컨테이너가 다 삼킨다.
export function snapConnectors(topology, { snap = 60 } = {}) {
  let current = topology; const rows = [];
  for (const connector of [...current.diagram.connectors]) {
    const devices = new Map(current.devices.map((device) => [device.id, device]));
    const shapes = new Map(current.diagram.shapes.map((shape) => [shape.id, shape]));
    const nearest = (point) => {
      let best = null; let bestGap = Infinity;
      for (const device of current.devices) {
        const gap = gapToRect(point, rectOf(device));
        if (gap < bestGap) { bestGap = gap; best = device; }
      }
      return { device: best, gap: bestGap };
    };
    const plan = ['source', 'target'].map((side) => {
      const id = connector[side];
      if (devices.has(id)) return { side, device: devices.get(id), how: '셀' };
      const shape = shapes.get(id);
      // 컨테이너에 붙은 끝점은 안에 든 장비 중 컨테이너 중심에 가장 가까운 것을 대표로 쓴다.
      if (shape && shape.width > 120 && shape.height > 120) {
        const hit = nearest({ x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });
        return { side, device: hit.device, how: `컨테이너 "${CLEAN(shape.text)}" 대표` };
      }
      const stored = side === 'source' ? connector.drawioGeometry?.sourcePoint : connector.drawioGeometry?.targetPoint;
      const point = stored || (shape ? { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 } : null);
      if (!point || !snap) return { side, device: null, how: point ? '스냅 끔' : '좌표 없음' };
      const hit = nearest(point);
      return { side, device: hit.gap <= snap ? hit.device : null, how: `좌표 ${Math.round(hit.gap)}px` };
    });
    const how = plan.map((entry) => entry.how).join(' / ');
    if (plan.some((entry) => !entry.device)) { rows.push({ id: connector.id, state: 'unresolved', how }); continue; }
    if (plan[0].device.id === plan[1].device.id) { rows.push({ id: connector.id, state: 'self', how }); continue; }
    for (const { side, device } of plan) if (connector[side] !== device.id) current = retargetConnector(current, connector.id, side, device.id);
    rows.push({ id: connector.id, state: 'snapped', how, source: plan[0].device.id, target: plan[1].device.id });
  }
  return { topology: current, rows };
}

// 가져온 장비의 name 은 id 와 같아 목록에서 읽히지 않는다. 그림의 라벨로 바꾼다.
export function nameImportedDevices(topology) {
  const used = new Map(); let unlabelled = 0;
  for (const device of topology.devices) {
    const token = device.drawioVisual?.drawioToken || device.drawioVisual?.drawioShape || '';
    const base = CLEAN(device.drawioVisual?.text)
      || String(token).split(/[.:]/).pop()?.replace(/_/g, ' ')
      || `${device.kind} ${++unlabelled}`;
    const seen = (used.get(base) || 0) + 1;
    used.set(base, seen);
    device.name = seen === 1 ? base : `${base} ${seen}`;
  }
  return topology;
}

export async function wireDrawio(source, options = {}) {
  const { page = 0, snap = 60, accepts = [], capacity = null, demand = null, spec = false } = options;
  const document = await parseDrawioDocument(source);
  const chosen = document.pages[page];
  if (!chosen) throw new Error(`페이지 ${page}가 없습니다. 이 파일에는 ${document.pages.length}개가 있습니다.`);
  const { decisions, report } = decideCandidates(createDrawioPreview(document, chosen.id, {}).candidates, accepts);
  const preview = createDrawioPreview(document, chosen.id, decisions);
  let topology = applyDrawioImport({ devices: [], links: [], demands: [] }, preview, decisions).topology;
  topology.demands = []; topology.failureDomains ||= [];
  const importedLinks = topology.links.length;

  const snapped = snapConnectors(topology, { snap });
  topology = nameImportedDevices(snapped.topology);
  for (const connector of [...topology.diagram.connectors]) {
    const ids = new Set(topology.devices.map(({ id }) => id));
    if (ids.has(connector.source) && ids.has(connector.target) && connector.source !== connector.target) promoteConnector(topology, connector.id);
  }
  if (spec) {
    for (const kind of [...new Set(topology.devices.map(({ kind: value }) => value))]) {
      const entry = catalogFor(kind)[0];
      if (entry) applySpecToKind(topology, kind, { ...buildSpec(entry, entry.profiles[0]), vendor: entry.vendor, model: entry.model });
    }
  }
  if (capacity != null) for (const link of topology.links) link.capacity = { forwarding_bps: capacity };
  let flows = 0;
  if (demand != null) {
    for (const link of topology.links) {
      // 같은 두 장비를 잇는 선이 여럿이면 수요 이름이 겹친다. 그 선은 건너뛴다.
      try { addDemand(topology, { name: `flow-${flows + 1}`, source: link.source, target: link.target, load: { forwarding_bps: demand } }); flows += 1; } catch { /* 중복 수요 */ }
    }
  }
  return { topology, page: chosen, report: { ...report, importedLinks, rows: snapped.rows, flows } };
}

function parseArgs(argv) {
  const options = { accepts: [], snap: 60, page: 0, capacity: null, demand: null, spec: false, dryRun: false, out: null };
  let file = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { const value = argv[index + 1]; if (value == null) throw new Error(`${arg} 에 값이 필요합니다.`); index += 1; return value; };
    if (arg === '--out') options.out = next();
    else if (arg === '--page') options.page = Number(next());
    else if (arg === '--snap') options.snap = Number(next());
    else if (arg === '--capacity') options.capacity = parseRate(next(), '--capacity');
    else if (arg === '--demand') options.demand = parseRate(next(), '--demand');
    else if (arg === '--spec') options.spec = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--accept') {
      const pair = next(); const split = pair.lastIndexOf('=');
      if (split < 1) throw new Error(`--accept 는 <무엇>=<종류> 형식입니다: ${pair}`);
      const what = pair.slice(0, split);
      options.accepts.push({ what: what.startsWith('text:') ? what.slice(5) : what, isText: what.startsWith('text:'), kind: pair.slice(split + 1) });
    } else if (arg.startsWith('-')) throw new Error(`모르는 옵션입니다: ${arg}`);
    else if (file) throw new Error('입력 파일은 하나만 받습니다.');
    else file = arg;
  }
  if (!file) throw new Error(USAGE);
  return { file, options };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.length < 3) { console.log(USAGE); return; }
  const { file, options } = parseArgs(process.argv.slice(2));
  const { topology, page, report } = await wireDrawio(await readFile(file, 'utf8'), options);
  const name = new Map(topology.devices.map((device) => [device.id, device.name]));

  console.log(`${basename(file)} · 페이지 "${page.name}"`);
  console.log(`수락: 분류기 ${report.classifier} + 사람 ${report.byHand} → 장비 ${topology.devices.length}`);
  for (const row of report.rows) {
    const label = row.state === 'snapped' ? `${name.get(row.source)} → ${name.get(row.target)}`
      : row.state === 'self' ? '같은 장비라 건너뜀' : '끝점을 정하지 못함';
    console.log(`  ${row.id.padEnd(44)} ${label}  [${row.how}]`);
  }
  const unresolved = report.rows.filter(({ state }) => state !== 'snapped').length;
  console.log(`링크 ${topology.links.length} (가져오기 직후 ${report.importedLinks}) · 수요 ${report.flows} · 남은 주석 연결선 ${topology.diagram.connectors.length}`);
  if (unresolved) console.log(`끝점을 정하지 못한 선 ${unresolved}개는 주석으로 남습니다. --snap 을 늘리거나 앱에서 끝점을 지정하세요.`);
  if (report.undecided.length) {
    console.log(`종류가 정해지지 않은 후보 ${report.undecided.length}개:`);
    for (const { shape, text } of report.undecided) console.log(`  --accept ${shape}=<종류>   "${text}"`);
  }
  const result = calculateScenario(topology);
  const status = {};
  for (const link of result.links) { const value = link.axes?.forwarding_bps?.status || 'none'; status[value] = (status[value] || 0) + 1; }
  console.log(`링크 상태 ${JSON.stringify(status)}`);

  if (options.dryRun) { console.log('--dry-run · 파일을 쓰지 않았습니다.'); return; }
  const out = options.out || resolve(process.cwd(), `${basename(file).replace(/\.[^.]+$/, '')}.json`);
  await writeFile(out, serializeProject(topology, { scale: 1 }));
  console.log(`저장 ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
