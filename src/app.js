import { axisCatalog, cloneTopology } from './data.js';
import { calculateScenario, compareScenarios, createExport } from './engine.js';
import { addDemand, addDevice, addLink, createEmptyTopology, moveDevice, normalizeId, removeDemand, removeDevice, removeLink, updateDemand, updateDevice, updateLink } from './editor.js';
import { importDeviceDefinition } from './device-import.js';
import { parseProject, serializeProject } from './project.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS, ICON_SPRITE } from './icons.js';

let topology = cloneTopology();
const state = { scale: 1, selectedId: 'fw-a', disabledDevices: new Set(), disabledLinks: new Set(), editorMode: 'select', connectSource: null, leftPanel: 'palette' };
let baseline = calculateScenario(topology);
let current = baseline;
let toastTimer;
let dragState = null;
let suppressNodeClick = false;
let telemetryTick = 0;
let telemetryTimer;
const telemetryHistory = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const element = (id) => document.getElementById(id);
const formatPercent = (value, signed = false) => value == null ? '미확인' : `${signed && value > 0 ? '+' : ''}${Math.round(value * 100)}%`;
const formatCompact = (value, unit) => {
  if (value == null) return '미확인';
  if (unit === 'bps') return value >= 1e9 ? `${(value / 1e9).toFixed(value >= 10e9 ? 0 : 1)} Gbps` : `${(value / 1e6).toFixed(0)} Mbps`;
  if (unit === 'pps') return value >= 1e6 ? `${(value / 1e6).toFixed(2)} Mpps` : `${(value / 1e3).toFixed(0)} Kpps`;
  if (unit === 'cps') return `${(value / 1e3).toFixed(0)} Kcps`;
  if (unit === 'sessions') return `${(value / 1e3).toFixed(0)} K`;
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value);
};

function deviceById(id) { return current.devices.find((item) => item.id === id); }
function linkById(id) { return current.links.find((item) => item.id === id); }
function resourceById(id) { return deviceById(id) || linkById(id); }
function stateLabel(status) { return ({ healthy: '정상', warning: '주의', overloaded: '용량 초과', unknown: '한계 미확인', invalid: '입력 오류' })[status] || status; }

function recalculate() {
  current = calculateScenario(topology, { scale: state.scale, disabledDevices: state.disabledDevices, disabledLinks: state.disabledLinks });
  render();
  updateTelemetry();
}

function resetScenario({ refreshBaseline = false } = {}) {
  state.disabledDevices.clear(); state.disabledLinks.clear(); state.connectSource = null;
  if (!topology.devices.some(({ id }) => id === state.selectedId) && !topology.links.some(({ id }) => id === state.selectedId)) state.selectedId = topology.devices[0]?.id || null;
  if (refreshBaseline) baseline = calculateScenario(topology);
  recalculate();
}

function commitTopology(message) {
  resetScenario({ refreshBaseline: true });
  showToast(message);
}

function render() {
  renderSummary();
  renderFailures();
  renderTopology();
  renderInspector();
  renderComparison();
  renderEditorMode();
}

function renderSummary() {
  const { summary } = current;
  const binding = resourceById(summary.bindingResourceId);
  const comparison = compareScenarios(baseline, current);
  element('summary-headroom').dataset.baseValue = String(summary.minHeadroom ?? '');
  element('summary-headroom').textContent = formatPercent(summary.minHeadroom);
  element('summary-binding').textContent = binding ? `${binding.name || binding.id} · ${axisCatalog[summary.bindingAxis]?.shortLabel || summary.bindingAxis}` : '알려진 축 없음';
  element('summary-overloaded').textContent = String(summary.overloadedCount).padStart(2, '0');
  element('summary-warning').textContent = `${summary.warningCount}개 자원 주의`;
  element('summary-unreachable').textContent = String(summary.unreachableCount).padStart(2, '0');
  element('summary-unreachable-load').textContent = `${formatCompact(summary.unreachableLoadBps, 'bps')} 미전달`;
  element('summary-faults').textContent = String(summary.activeFaults).padStart(2, '0');
  element('summary-delta').textContent = `headroom ${formatPercent(comparison.minHeadroomDelta, true)}`;
  const hasIssue = summary.overloadedCount > 0 || summary.unreachableCount > 0;
  element('run-state').textContent = summary.unreachableCount ? 'TRAFFIC UNREACHABLE' : summary.overloadedCount ? 'CAPACITY EXCEEDED' : summary.activeFaults ? 'FAILURE CONTAINED' : 'BASELINE STABLE';
  element('run-state').parentElement.style.color = hasIssue ? 'var(--danger)' : summary.activeFaults ? 'var(--amber)' : 'var(--signal)';
  element('scale-output').textContent = `${state.scale.toFixed(2)}×`;
  const activePathCount = current.demands.reduce((sum, demand) => sum + demand.paths.length, 0);
  element('path-readout').textContent = `${current.demands.length} DEMANDS · ${activePathCount} ACTIVE PATHS`;
}

function renderFailures() {
  const groups = [
    { title: '장비', items: topology.devices.filter(({ kind }) => ['firewall', 'switch'].includes(kind)), set: state.disabledDevices, type: 'device' },
    { title: '링크', items: topology.links.filter(({ id }) => id.includes('spine-') && id.includes('-leaf-')), set: state.disabledLinks, type: 'link' },
  ];
  element('failure-count').textContent = `${state.disabledDevices.size + state.disabledLinks.size} ACTIVE`;
  element('failure-list').innerHTML = groups.map((group) => `
    <section class="failure-group">
      <h3>${group.title}</h3>
      ${group.items.map((item) => {
        const active = group.set.has(item.id);
        const label = item.name || item.id.replaceAll('-', ' → ').toUpperCase();
        return `<button class="failure-switch ${active ? 'active' : ''}" type="button" data-failure-type="${group.type}" data-failure-id="${escapeAttribute(item.id)}" aria-pressed="${active}">
          <span class="switch-glyph" aria-hidden="true"></span><span><strong>${escapeText(label)}</strong><small>${escapeText(group.type === 'device' ? item.zone : 'ECMP MEMBER')}</small></span><span class="switch-state">${active ? 'DOWN' : 'UP'}</span>
        </button>`;
      }).join('')}
    </section>`).join('');
  document.querySelectorAll('[data-quick-failure]').forEach((button) => {
    const active = state.disabledDevices.has(button.dataset.quickFailure);
    button.setAttribute('aria-pressed', String(active));
    button.querySelector('span').textContent = active ? 'DOWN' : 'UP';
  });
}

const STATE_TOKEN = { healthy: '.', warning: '!', overloaded: '>', unknown: '?', invalid: 'x', disabled: 'x' };
const NODE_AXIS_LIMIT = 4;
const AXIS_RANK = { overloaded: 0, invalid: 1, warning: 2, healthy: 3, unknown: 4 };
const SI_STEPS = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']];
const KIND_ALIAS = { 'load-balancer': 'lb', loadbalancer: 'lb', balancer: 'lb', host: 'server', compute: 'server', vm: 'server', nas: 'storage', san: 'storage' };

// 노드 폭 안에 들어가도록 단위를 떼고 5자 이내로 줄인다. 단위는 축 이름 열이 지시한다.
function formatNodeValue(value) {
  if (value == null || !Number.isFinite(value)) return '\u2014';
  if (value === 0) return '0';
  const [factor, suffix] = SI_STEPS.find(([step]) => Math.abs(value) >= step) || [1, ''];
  const scaled = value / factor;
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(scaled >= 10 ? 1 : 2)}${suffix}`;
}

// kind는 임의 문자열이라 목록 밖 값이 들어온다. 화이트리스트를 통과한 값만 href에 넣는다.
function symbolId(kind) {
  const key = String(kind ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const exact = KIND_ALIAS[key] || key;
  if (ICONS[exact]) return ICONS[exact].id;
  return ICONS[ICON_KINDS.find((name) => key.includes(name)) || ICON_FALLBACK].id;
}

const nodeAxisLabel = (key) => axisCatalog[key]?.nodeLabel || key.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();

// 선별은 심각도 순으로, 렌더는 limits 삽입 순서로. 문제 축은 반드시 노출하면서 행 순서는 흔들리지 않는다.
function nodeAxes(device) {
  const entries = Object.entries(device.axes);
  if (entries.length <= NODE_AXIS_LIMIT) return { rows: entries, hidden: 0 };
  const keep = new Set([...entries]
    .sort((a, b) => (AXIS_RANK[a[1].status] ?? 9) - (AXIS_RANK[b[1].status] ?? 9) || (b[1].utilization ?? -1) - (a[1].utilization ?? -1) || a[0].localeCompare(b[0]))
    .slice(0, NODE_AXIS_LIMIT).map(([key]) => key));
  return { rows: entries.filter(([key]) => keep.has(key)), hidden: entries.length - keep.size };
}

function nodeAxisRow(device, key, axis) {
  // unknown·invalid 축에는 data-live-util을 붙이지 않는다. 텔레메트리가 미확인 값을 숫자로 덮어쓰면 안 된다.
  const live = axis.utilization == null ? '' : ` data-live-util="${axis.utilization}" data-live-seed="${escapeAttribute(device.id)}:${key}"`;
  const percent = axis.status === 'unknown' ? '\u2014' : axis.status === 'invalid' ? 'ERR' : formatPercent(axis.utilization);
  return `<span class="node-axis" data-axis-state="${axis.status}"${key === device.bindingAxis ? ' data-binding=""' : ''}><i>${STATE_TOKEN[axis.status] || '?'}</i><b>${escapeText(nodeAxisLabel(key))}</b><em>${formatNodeValue(axis.load)}</em><s${live}>${percent}</s></span>`;
}

// 축 토큰은 시각 축약이라 읽히면 소음이다. 접근 가능한 이름은 요약만 담고 흔들리는 값을 넣지 않는다.
function nodeAccessibleName(device) {
  const head = `${device.name} \u00b7 ${device.kind} \u00b7 ${device.zone}`;
  if (!device.active) return `${head} \u00b7 비활성`;
  const binding = device.axes[device.bindingAxis];
  const bindingText = binding ? `제한 축 ${axisCatalog[device.bindingAxis]?.label || device.bindingAxis} ${formatPercent(binding.utilization)}` : '한계 미확인';
  const axes = Object.values(device.axes);
  const alerts = axes.filter(({ status }) => status === 'overloaded' || status === 'warning').length;
  return `${head} \u00b7 ${stateLabel(device.primaryStatus)} \u00b7 ${bindingText} \u00b7 축 ${axes.length}개 중 주의 이상 ${alerts}개`;
}

const PALETTE = [
  { kind: 'switch', label: '스위치', limits: { forwarding_bps: null, forwarding_pps: null } },
  { kind: 'router', label: '라우터', limits: { forwarding_bps: null, forwarding_pps: null } },
  { kind: 'firewall', label: '방화벽', limits: { forwarding_bps: null, forwarding_pps: null, new_sessions_per_sec: null, concurrent_sessions: null } },
  { kind: 'lb', label: '로드밸런서', limits: { forwarding_bps: null, new_sessions_per_sec: null, concurrent_sessions: null } },
  { kind: 'server', label: '서버', limits: { nic_bps: null, nic_pps: null } },
  { kind: 'storage', label: '스토리지', limits: { nic_bps: null, nic_pps: null } },
];
const PALETTE_DRAG_THRESHOLD = 4;
let paletteDrag = null;

function renderPalette() {
  element('component-palette').innerHTML = PALETTE.map(({ kind, label }) => `<button type="button" class="palette-item" data-palette-kind="${kind}" aria-label="${escapeAttribute(label)} 추가">
    <span class="palette-glyph"><svg aria-hidden="true" focusable="false"><use href="#${ICONS[kind].id}"></use></svg></span><span class="palette-label">${escapeText(label)}</span><span class="palette-kind">${kind.toUpperCase()}</span>
  </button>`).join('');
}

function setLeftPanel(name) {
  state.leftPanel = name;
  document.querySelectorAll('[data-panel-tab]').forEach((tab) => {
    const selected = tab.dataset.panelTab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element(`panel-${tab.dataset.panelTab}`).hidden = !selected;
  });
  element('failure-count').hidden = name !== 'failure';
}

const CANVAS_MIN = { width: 940, height: 580 };
const CANVAS_PAD = 40;
const CANVAS_MAX = 12000;
// 노드는 심볼 중심이 기준이고 라벨이 아래로 흐르므로 방향별 여백이 다르다.
const NODE_REACH = { left: 70, right: 70, top: 30, bottom: 150 };
let viewport = { minX: 0, minY: 0, width: CANVAS_MIN.width, height: CANVAS_MIN.height };

function canvasViewport(devices) {
  const bounds = devices.reduce((box, { position }) => ({
    minX: Math.min(box.minX, position.x - NODE_REACH.left), minY: Math.min(box.minY, position.y - NODE_REACH.top),
    maxX: Math.max(box.maxX, position.x + NODE_REACH.right), maxY: Math.max(box.maxY, position.y + NODE_REACH.bottom),
  }), { minX: 0, minY: 0, maxX: CANVAS_MIN.width, maxY: CANVAS_MIN.height });
  const minX = bounds.minX < 0 ? bounds.minX - CANVAS_PAD : 0;
  const minY = bounds.minY < 0 ? bounds.minY - CANVAS_PAD : 0;
  const maxX = bounds.maxX > CANVAS_MIN.width ? bounds.maxX + CANVAS_PAD : CANVAS_MIN.width;
  const maxY = bounds.maxY > CANVAS_MIN.height ? bounds.maxY + CANVAS_PAD : CANVAS_MIN.height;
  return { minX, minY, width: Math.min(maxX - minX, CANVAS_MAX), height: Math.min(maxY - minY, CANVAS_MAX) };
}

function applyViewport() {
  viewport = canvasViewport(current.devices);
  const canvas = element('topology-canvas');
  canvas.style.setProperty('--canvas-width', `${viewport.width}px`);
  canvas.style.setProperty('--canvas-height', `${viewport.height}px`);
  canvas.style.setProperty('--viewport-x', `${viewport.minX}px`);
  canvas.style.setProperty('--viewport-y', `${viewport.minY}px`);
  // viewBox 가 원점을 담당하므로 링크는 좌표를 변환하지 않고 그대로 쓴다.
  element('link-layer').setAttribute('viewBox', `${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`);
}

// 확대가 없으므로 CSS 픽셀과 캔버스 좌표는 1:1 이고, 원점만 viewport 만큼 밀려 있다.
function canvasPoint(event) {
  const rect = element('topology-canvas').getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  return { x: offsetX + viewport.minX, y: offsetY + viewport.minY,
    inside: offsetX >= 0 && offsetY >= 0 && offsetX <= rect.width && offsetY <= rect.height };
}

function nextDeviceName(kind) {
  const used = new Set(topology.devices.map(({ id }) => id));
  for (let index = 1; index <= 999; index += 1) {
    const name = `${kind.toUpperCase()} ${index}`;
    if (!used.has(normalizeId(name))) return name;
  }
  return `${kind.toUpperCase()} ${Date.now()}`;
}

function createDeviceFromPalette(kind, position) {
  const preset = PALETTE.find((item) => item.kind === kind);
  if (!preset) return;
  try {
    const device = addDevice(topology, {
      name: nextDeviceName(kind), kind, limits: preset.limits, position,
    });
    state.selectedId = device.id;
    closeEditorPanel();
    commitTopology(`${device.name} 장비를 추가했습니다. 인스펙터에서 한계값을 입력하세요.`);
  } catch (error) { showToast(error.message); }
}

function endPaletteDrag() {
  if (!paletteDrag) return null;
  const drag = paletteDrag;
  paletteDrag = null;
  drag.ghost?.remove();
  drag.item.classList.remove('dragging');
  element('topology-canvas').classList.remove('drop-target');
  return drag;
}

function renderTopology() {
  applyViewport();
  const devices = new Map(current.devices.map((item) => [item.id, item]));
  element('link-layer').innerHTML = current.links.map((link) => {
    const source = devices.get(link.source).position;
    const target = devices.get(link.target).position;
    const status = link.active ? link.primaryStatus : 'disabled';
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2 - 7;
    const utilization = link.axes.forwarding_bps?.utilization;
    const packetCount = link.active && utilization > 0 ? Math.min(3, Math.max(1, Math.ceil(utilization * 3))) : 0;
    const packetDuration = Math.max(1.25, 3.4 - Math.min(utilization || 0, 1.5) * 1.25);
    const packetDots = Array.from({ length: packetCount }, (_, index) => `<circle class="packet-dot ${status}" r="3">
      <animate attributeName="cx" values="${source.x};${target.x}" dur="${packetDuration.toFixed(2)}s" begin="-${(packetDuration * index / packetCount).toFixed(2)}s" repeatCount="indefinite"></animate>
      <animate attributeName="cy" values="${source.y};${target.y}" dur="${packetDuration.toFixed(2)}s" begin="-${(packetDuration * index / packetCount).toFixed(2)}s" repeatCount="indefinite"></animate>
    </circle>`).join('');
    return `<g class="link-group" data-link-id="${escapeAttribute(link.id)}">
      <line class="link ${status}" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"></line>
      <line class="link-hit" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" tabindex="0" role="button" aria-label="${escapeAttribute(link.id)} 링크 검사"></line>
      ${packetDots}
      <text class="link-label" data-live-util="${utilization ?? ''}" data-live-seed="${link.id}" x="${middleX}" y="${middleY}" text-anchor="middle">${link.active ? formatPercent(utilization) : 'DOWN'}</text>
    </g>`;
  }).join('');

  element('node-layer').innerHTML = current.devices.map((device) => {
    const status = device.active ? device.primaryStatus : 'disabled';
    const { rows, hidden } = nodeAxes(device);
    const meta = [device.kind.toUpperCase(), device.zone, hidden ? `+${hidden}` : ''].filter(Boolean).join(' \u00b7 ');
    const axes = device.active
      ? rows.map(([key, axis]) => nodeAxisRow(device, key, axis)).join('')
      : '<span class="node-axis" data-axis-state="disabled"><i>x</i><b>OFFLINE</b><em>\u2014</em><s>DOWN</s></span>';
    return `<button type="button" class="mesh-node ${status} ${state.selectedId === device.id ? 'selected' : ''} ${state.connectSource === device.id ? 'connect-source' : ''}" data-device-id="${escapeAttribute(device.id)}" style="left:${device.position.x - viewport.minX}px;top:${device.position.y - viewport.minY}px" aria-pressed="${state.selectedId === device.id}" aria-label="${escapeAttribute(nodeAccessibleName(device))}">
      <span class="node-symbol"><svg class="node-glyph" aria-hidden="true" focusable="false"><use href="#${symbolId(device.kind)}"></use></svg></span><span class="node-rail"></span><span class="node-labels"><span class="node-name">${escapeText(device.name)}</span><span class="node-axes">${axes}</span><span class="node-meta">${escapeText(meta)}</span></span>
    </button>`;
  }).join('');
}

function renderInspector() {
  const resource = resourceById(state.selectedId) || current.devices[0];
  if (!resource) {
    element('resource-state').textContent = '빈 설계';
    element('inspector-content').innerHTML = '<div class="empty-inspector"><strong>장비가 없습니다.</strong><span>상단의 장비 추가 또는 장비 JSON 가져오기로 시작하세요.</span></div>';
    return;
  }
  const isDevice = 'kind' in resource;
  const source = isDevice ? resource.source : { label: '링크 정격', condition: '방향별 full-duplex capacity' };
  element('resource-state').textContent = resource.active ? stateLabel(resource.primaryStatus) : '비활성';
  element('resource-state').style.color = `var(--${resource.active ? ({ overloaded: 'danger', warning: 'amber', invalid: 'danger', unknown: 'unknown', healthy: 'cyan' })[resource.primaryStatus] || 'unknown' : 'danger'})`;
  const binding = resource.axes[resource.bindingAxis];
  element('inspector-content').innerHTML = `
    <div class="resource-identity"><strong>${escapeText(resource.name || resource.id.toUpperCase())}</strong><span>${escapeText(isDevice ? `${resource.kind.toUpperCase()} · ${resource.zone}` : `${resource.source} → ${resource.target}`)}</span></div>
    <div class="binding-callout"><span>BINDING AXIS</span><strong><span>${axisCatalog[resource.bindingAxis]?.label || resource.bindingAxis || '알려진 축 없음'}</span><span data-live-util="${binding?.utilization ?? ''}" data-live-seed="${resource.id}-binding">${binding ? formatPercent(binding.utilization) : '—'}</span></strong></div>
    <div class="axis-list">${Object.entries(resource.axes).map(([axis, result]) => renderAxis(axis, result, resource.id)).join('')}</div>
    <div class="source-note"><strong>${escapeText(source.label)}</strong><br>${escapeText(source.condition)}<br>실제 설계에는 동일 조건의 측정값을 사용하세요.</div>
    ${isDevice ? renderDeviceEditor(resource) : renderLinkEditor(resource)}`;
}

function renderDeviceEditor(resource) {
  const fields = ['forwarding_bps', 'forwarding_pps', 'new_sessions_per_sec', 'concurrent_sessions', 'nic_bps', 'nic_pps'];
  return `<form class="inspector-editor" data-resource-form="device" data-resource-id="${resource.id}">
    <h3>장비 한계 편집</h3>
    <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(resource.name)}"></label>
    <label>영역<input name="zone" maxlength="80" required value="${escapeAttribute(resource.zone)}"></label>
    ${fields.map((axis) => `<label>${axisCatalog[axis]?.label || axis}<input name="${axis}" type="number" min="0" step="any" placeholder="미확인" value="${resource.limits[axis] ?? ''}"></label>`).join('')}
    <div class="inspector-editor-actions"><button type="submit">적용</button><button type="button" data-delete-resource="device">장비 삭제</button></div><p class="editor-error"></p>
  </form>`;
}

function renderLinkEditor(resource) {
  return `<form class="inspector-editor" data-resource-form="link" data-resource-id="${resource.id}">
    <h3>링크 편집</h3><label>방향별 용량 (bps)<input name="capacityBps" type="number" min="1" step="any" required value="${resource.capacity.forwarding_bps}"></label>
    <div class="inspector-editor-actions"><button type="submit">적용</button><button type="button" data-delete-resource="link">링크 삭제</button></div><p class="editor-error"></p>
  </form>`;
}

function escapeAttribute(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;'); }
function escapeText(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

function renderAxis(axis, result, resourceId) {
  const catalog = axisCatalog[axis] || { label: axis, shortLabel: axis, unit: '' };
  const width = result.utilization == null ? 0 : Math.max(2, result.utilization * 100);
  return `<div class="axis-row ${result.status}">
    <div class="axis-title"><span>${catalog.label}</span><span>${stateLabel(result.status)} · <b data-live-util="${result.utilization ?? ''}" data-live-seed="${resourceId}:${axis}">${formatPercent(result.utilization)}</b></span></div>
    <div class="axis-meter" aria-label="${catalog.label} ${formatPercent(result.utilization)}"><span style="--axis-width:${width}%"></span></div>
    <div class="axis-values"><span data-live-load="${result.load}" data-live-unit="${catalog.unit}" data-live-seed="${resourceId}:${axis}-load">${formatCompact(result.load, catalog.unit)} load</span><span>${formatCompact(result.limit, catalog.unit)} limit</span></div>
  </div>`;
}

function telemetryWave(seed, amplitude = 0.015) {
  const hash = [...seed].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) % 997, 17);
  return Math.sin(telemetryTick * 0.72 + hash * 0.13) * amplitude + Math.sin(telemetryTick * 0.23 + hash) * amplitude * 0.35;
}

function pushTelemetry(name, value) {
  const history = telemetryHistory.get(name) || [];
  history.push(value);
  if (history.length > 28) history.shift();
  telemetryHistory.set(name, history);
  return history;
}

function renderSparkline(svg, values) {
  if (values.length < 2) return;
  const width = 120;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.01);
  const points = values.map((value, index) => {
    const x = index * width / Math.max(values.length - 1, 1);
    const y = height - 3 - ((value - min) / spread) * (height - 7);
    return [x, y];
  });
  svg.querySelector('path').setAttribute('d', points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' '));
  const [x, y] = points.at(-1);
  const marker = svg.querySelector('circle');
  marker.setAttribute('cx', x.toFixed(1));
  marker.setAttribute('cy', y.toFixed(1));
}

function updateTelemetry() {
  telemetryTick += 1;
  const motionScale = reducedMotion.matches ? 0 : 1;
  document.querySelectorAll('[data-live-util]').forEach((target) => {
    if (target.dataset.liveUtil === '') return;
    const base = Number(target.dataset.liveUtil);
    if (!Number.isFinite(base)) return;
    target.textContent = formatPercent(Math.max(0, base * (1 + telemetryWave(target.dataset.liveSeed || 'util') * motionScale)));
  });
  document.querySelectorAll('[data-live-load]').forEach((target) => {
    if (target.dataset.liveLoad === '') return;
    const base = Number(target.dataset.liveLoad);
    if (!Number.isFinite(base)) return;
    const value = Math.max(0, base * (1 + telemetryWave(target.dataset.liveSeed || 'load', 0.012) * motionScale));
    target.textContent = `${formatCompact(value, target.dataset.liveUnit)} load`;
  });
  const jitter = telemetryWave('summary', 0.012) * motionScale;
  const liveHeadroom = current.summary.minHeadroom == null ? null : current.summary.minHeadroom - (1 - current.summary.minHeadroom) * jitter;
  element('summary-headroom').dataset.liveValue = liveHeadroom == null ? '' : liveHeadroom.toFixed(6);
  element('summary-headroom').textContent = formatPercent(liveHeadroom);
  const seriesValues = {
    headroom: liveHeadroom ?? 0,
    utilization: (1 - (current.summary.minHeadroom ?? 1)) * (1 + jitter),
    delivery: Math.max(0, 1 - current.summary.unreachableCount / Math.max(current.demands.length, 1) + jitter * 0.15),
    traffic: current.scale * (1 + telemetryWave('traffic', 0.018) * motionScale),
  };
  document.querySelectorAll('.metric-sparkline').forEach((svg) => renderSparkline(svg, pushTelemetry(svg.dataset.series, seriesValues[svg.dataset.series])));
}

function startTelemetry() {
  clearInterval(telemetryTimer);
  updateTelemetry();
  telemetryTimer = setInterval(() => { if (!document.hidden) updateTelemetry(); }, reducedMotion.matches ? 2400 : 820);
}

function renderComparison() {
  const comparison = compareScenarios(baseline, current);
  const items = [
    ['최소 headroom', formatPercent(comparison.minHeadroomDelta, true), `${formatPercent(baseline.summary.minHeadroom)} → ${formatPercent(current.summary.minHeadroom)}`, comparison.minHeadroomDelta < 0 ? 'negative' : 'positive'],
    ['Binding axis', comparison.bindingChanged ? 'CHANGED' : 'SAME', `${baseline.summary.bindingResourceId} → ${current.summary.bindingResourceId}`, comparison.bindingChanged ? 'negative' : ''],
    ['과부하', `${comparison.overloadedDelta > 0 ? '+' : ''}${comparison.overloadedDelta}`, `${baseline.summary.overloadedCount} → ${current.summary.overloadedCount} resources`, comparison.overloadedDelta > 0 ? 'negative' : 'positive'],
    ['전달 실패', `${comparison.unreachableDelta > 0 ? '+' : ''}${comparison.unreachableDelta}`, `${baseline.summary.unreachableCount} → ${current.summary.unreachableCount} demands`, comparison.unreachableDelta > 0 ? 'negative' : 'positive'],
  ];
  element('comparison-grid').innerHTML = items.map(([label, value, detail, tone]) => `<div class="comparison-item ${tone}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('');
}

function renderEditorMode() {
  const labels = { select: 'SELECT · DRAG TO MOVE', connect: state.connectSource ? `CONNECT · ${state.connectSource.toUpperCase()} → SELECT TARGET` : 'CONNECT · SELECT SOURCE' };
  element('editor-mode').lastChild.textContent = labels[state.editorMode] || state.editorMode.toUpperCase();
  document.querySelector('[data-editor-action="connect"]').setAttribute('aria-pressed', String(state.editorMode === 'connect'));
}

function openEditorPanel(title, html) {
  element('editor-panel-heading').textContent = title;
  element('editor-panel-content').innerHTML = html;
  element('editor-panel').hidden = false;
  element('editor-panel').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
}

function closeEditorPanel() { element('editor-panel').hidden = true; element('editor-panel-content').innerHTML = ''; }
function formError(form, message) { const target = form.querySelector('.editor-error'); if (target) target.textContent = message; }
function deviceOptions(selected = '') { return topology.devices.map(({ id, name }) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${escapeAttribute(name)} · ${id}</option>`).join(''); }
// 팔레트 클릭은 놓을 자리를 사용자가 고르지 않으므로 비어 있는 슬롯을 찾아 준다.
const deviceSlot = (index) => ({ x: 130 + (index % 4) * 220, y: 110 + (Math.floor(index / 4) % 3) * 165 });
function nextDevicePosition() {
  const taken = topology.devices.map(({ position }) => position);
  const free = (spot) => !taken.some((position) => Math.abs(position.x - spot.x) < 140 && Math.abs(position.y - spot.y) < 150);
  for (let index = 0; index < 12; index += 1) {
    const spot = deviceSlot(index);
    if (free(spot)) return spot;
  }
  return deviceSlot(topology.devices.length);
}

function openDeviceForm(template = null) {
  openEditorPanel('장비 추가', `<p class="editor-hint">장비를 만든 뒤 캔버스에서 드래그해 위치를 조정하세요. 비어 있는 한계값은 unknown으로 유지됩니다.</p><form class="editor-form" data-editor-form="device">
    <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(template?.name || '')}"></label>
    <label>클래스<select name="kind">${['switch','router','firewall','lb','server','storage'].map((kind) => `<option ${template?.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>
    <label>영역<input name="zone" maxlength="80" value="${escapeAttribute(template?.zone || 'UNASSIGNED')}"></label>
    <label>처리량 한계 (bps)<input name="forwarding_bps" type="number" min="1" step="any" value="${template?.limits?.forwarding_bps ?? ''}"></label>
    <label>PPS 한계<input name="forwarding_pps" type="number" min="1" step="any" value="${template?.limits?.forwarding_pps ?? ''}"></label>
    <div class="form-actions"><button type="submit">장비 생성</button></div><p class="editor-error"></p></form>`);
}

function openDemandForm() {
  if (topology.devices.length < 2) { showToast('Traffic demand에는 장비가 두 개 이상 필요합니다.'); return; }
  openEditorPanel('Traffic demand 추가', `<p class="editor-hint">source와 target 사이의 모든 최단 ECMP 경로를 자동 계산합니다.</p><form class="editor-form" data-editor-form="demand">
    <label>이름<input name="name" maxlength="80" required></label><label>Source<select name="source">${deviceOptions()}</select></label><label>Target<select name="target">${deviceOptions(topology.devices[1]?.id)}</select></label>
    <label>Traffic (bps)<input name="forwarding_bps" type="number" min="0" step="any" value="1000000000" required></label><label>Packets (pps)<input name="forwarding_pps" type="number" min="0" step="any" value="100000"></label>
    <label>신규 세션 (CPS)<input name="new_sessions_per_sec" type="number" min="0" step="any" value="0"></label><label>동시 세션<input name="concurrent_sessions" type="number" min="0" step="any" value="0"></label>
    <div class="form-actions"><button type="submit">Demand 생성</button></div><p class="editor-error"></p></form>`);
}

function demandEndpoint(demand, side) {
  if (demand[side]) return demand[side];
  const devices = demand.paths?.[0]?.devices || [];
  return side === 'source' ? devices[0] : devices.at(-1);
}

function openDemandManager() {
  const rows = topology.demands.length ? topology.demands.map((demand) => {
    const source = demandEndpoint(demand, 'source') || topology.devices[0]?.id || '';
    const target = demandEndpoint(demand, 'target') || topology.devices[1]?.id || '';
    return `<form class="demand-editor-row" data-editor-form="demand-edit" data-demand-id="${escapeAttribute(demand.id)}">
      <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(demand.name)}"></label>
      <label>Source<select name="source">${deviceOptions(source)}</select></label><label>Target<select name="target">${deviceOptions(target)}</select></label>
      <label>Traffic (bps)<input name="forwarding_bps" type="number" min="0" step="any" required value="${demand.load.forwarding_bps ?? 0}"></label>
      <label>Packets (pps)<input name="forwarding_pps" type="number" min="0" step="any" value="${demand.load.forwarding_pps ?? 0}"></label>
      <label>CPS<input name="new_sessions_per_sec" type="number" min="0" step="any" value="${demand.load.new_sessions_per_sec ?? 0}"></label>
      <label>동시 세션<input name="concurrent_sessions" type="number" min="0" step="any" value="${demand.load.concurrent_sessions ?? 0}"></label>
      <div class="demand-row-actions"><button type="submit">수정</button><button type="button" data-delete-demand="${escapeAttribute(demand.id)}">삭제</button></div><p class="editor-error"></p>
    </form>`;
  }).join('') : '<div class="editor-empty"><strong>Traffic demand가 없습니다.</strong><span>새 demand를 추가하면 endpoint 사이의 최단 ECMP 경로를 계산합니다.</span></div>';
  openEditorPanel('Traffic demand 관리', `<div class="demand-manager-head"><p class="editor-hint">endpoint나 부하를 수정하면 explicit path가 최단 ECMP 경로로 전환됩니다.</p><button type="button" data-new-demand>새 demand</button></div><div class="demand-editor-list">${rows}</div>`);
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function saveProject() {
  downloadText('rack-mesh-project.json', serializeProject(topology, state));
  showToast('versioned 프로젝트 JSON을 저장했습니다.');
}

async function readFile(input) {
  const file = input.files?.[0];
  if (!file) return null;
  if (file.size > 2_000_000) throw new Error('JSON 파일은 2 MB 이하여야 합니다.');
  const text = await file.text(); input.value = ''; return text;
}

function handleEditorAction(action) {
  if (action === 'device') openDeviceForm();
  if (action === 'demand') openDemandManager();
  if (action === 'connect') { state.editorMode = state.editorMode === 'connect' ? 'select' : 'connect'; state.connectSource = null; closeEditorPanel(); renderTopology(); renderEditorMode(); }
  if (action === 'save') saveProject();
  if (action === 'open') element('project-file-input').click();
  if (action === 'import-device') element('device-file-input').click();
  if (action === 'new') {
    const impact = `${topology.devices.length}개 장비, ${topology.links.length}개 링크, ${topology.demands.length}개 demand`;
    if (!window.confirm(`현재 설계의 ${impact}를 비우고 새 설계를 만듭니다. 저장하지 않은 변경은 복구할 수 없습니다. 계속하시겠습니까?`)) return;
    topology = createEmptyTopology('Untitled topology'); state.scale = 1; state.selectedId = null; element('scale-input').value = '100'; closeEditorPanel(); commitTopology('빈 설계를 만들었습니다.');
  }
}

function toggleFailure(type, id) {
  const set = type === 'device' ? state.disabledDevices : state.disabledLinks;
  set.has(id) ? set.delete(id) : set.add(id);
  showToast(`${id.toUpperCase()} ${set.has(id) ? '비활성화' : '복구'} · 경로 재계산 완료`);
  recalculate();
}

function showToast(message) {
  element('toast').textContent = message;
  element('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element('toast').classList.remove('visible'), 2200);
}

function exportResult() {
  const payload = createExport(topology, current, baseline);
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'rack-mesh-scenario.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast('결과 JSON을 내보냈습니다.');
}

function handleNodeSelection(id) {
  if (state.editorMode === 'connect') {
    if (!state.connectSource) { state.connectSource = id; renderTopology(); renderEditorMode(); showToast('연결할 두 번째 장비를 선택하세요.'); return; }
    if (state.connectSource === id) { state.connectSource = null; renderTopology(); renderEditorMode(); return; }
    try {
      const link = addLink(topology, { source: state.connectSource, target: id }); state.selectedId = link.id; state.connectSource = null; state.editorMode = 'select'; commitTopology(`링크 ${link.id}를 연결했습니다.`);
    } catch (error) { showToast(error.message); state.connectSource = null; renderTopology(); renderEditorMode(); }
    return;
  }
  state.selectedId = id; renderTopology(); renderInspector();
}

element('scale-input').addEventListener('input', (event) => { state.scale = Number(event.target.value) / 100; recalculate(); });
element('failure-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-failure-id]');
  if (button) toggleFailure(button.dataset.failureType, button.dataset.failureId);
});
document.querySelector('.mobile-fault-tray').addEventListener('click', (event) => {
  const button = event.target.closest('[data-quick-failure]');
  if (button) toggleFailure('device', button.dataset.quickFailure);
});
element('node-layer').addEventListener('click', (event) => {
  const button = event.target.closest('[data-device-id]');
  if (button && !suppressNodeClick) handleNodeSelection(button.dataset.deviceId);
});
element('node-layer').addEventListener('pointerdown', (event) => {
  if (state.editorMode !== 'select') return;
  const button = event.target.closest('[data-device-id]'); if (!button) return;
  const device = topology.devices.find(({ id }) => id === button.dataset.deviceId);
  dragState = { id: device.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { ...device.position }, button };
  button.setPointerCapture(event.pointerId); button.classList.add('dragging');
});
element('node-layer').addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const position = { x: dragState.origin.x + event.clientX - dragState.startX, y: dragState.origin.y + event.clientY - dragState.startY };
  const moved = moveDevice(topology, dragState.id, position);
  dragState.button.style.left = `${moved.position.x - viewport.minX}px`; dragState.button.style.top = `${moved.position.y - viewport.minY}px`;
  suppressNodeClick = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 4;
});
element('node-layer').addEventListener('pointerup', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  dragState.button.classList.remove('dragging'); const moved = suppressNodeClick; dragState = null;
  if (moved) { commitTopology('장비 위치를 저장했습니다.'); setTimeout(() => { suppressNodeClick = false; }, 0); }
});
element('link-layer').addEventListener('click', (event) => {
  const group = event.target.closest('[data-link-id]');
  if (group) { state.selectedId = group.dataset.linkId; renderInspector(); }
});
element('link-layer').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
element('reset-button').addEventListener('click', () => { state.disabledDevices.clear(); state.disabledLinks.clear(); state.scale = 1; element('scale-input').value = '100'; showToast('기준선으로 복구했습니다.'); recalculate(); });
element('export-button').addEventListener('click', exportResult);
document.querySelector('.editor-tools').addEventListener('click', (event) => { const button = event.target.closest('[data-editor-action]'); if (button) handleEditorAction(button.dataset.editorAction); });
element('editor-close').addEventListener('click', closeEditorPanel);
element('editor-panel-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.editorForm === 'device') {
      const template = form._deviceTemplate || {};
      const device = addDevice(topology, { name: data.get('name'), kind: data.get('kind'), zone: data.get('zone'), position: nextDevicePosition(), limits: { ...(template.limits || {}), forwarding_bps: data.get('forwarding_bps') || template.limits?.forwarding_bps || null, forwarding_pps: data.get('forwarding_pps') || template.limits?.forwarding_pps || null }, source: template.source, metadata: template.metadata });
      state.selectedId = device.id; closeEditorPanel(); commitTopology(`장비 ${device.name}을 추가했습니다.`);
    }
    if (form.dataset.editorForm === 'demand') {
      const demand = addDemand(topology, { name: data.get('name'), source: data.get('source'), target: data.get('target'), load: { forwarding_bps: data.get('forwarding_bps'), forwarding_pps: data.get('forwarding_pps') || 0, new_sessions_per_sec: data.get('new_sessions_per_sec') || 0, concurrent_sessions: data.get('concurrent_sessions') || 0 } });
      closeEditorPanel(); commitTopology(`Demand ${demand.name}을 추가했습니다.`);
    }
    if (form.dataset.editorForm === 'demand-edit') {
      const demand = updateDemand(topology, form.dataset.demandId, { name: data.get('name'), source: data.get('source'), target: data.get('target'), load: { forwarding_bps: data.get('forwarding_bps'), forwarding_pps: data.get('forwarding_pps') || 0, new_sessions_per_sec: data.get('new_sessions_per_sec') || 0, concurrent_sessions: data.get('concurrent_sessions') || 0 } });
      commitTopology(`Demand ${demand.name}을 수정했습니다.`); openDemandManager();
    }
  } catch (error) { formError(form, error.message); }
});
element('editor-panel-content').addEventListener('click', (event) => {
  if (event.target.closest('[data-new-demand]')) { openDemandForm(); return; }
  const button = event.target.closest('[data-delete-demand]'); if (!button) return;
  const demand = topology.demands.find(({ id }) => id === button.dataset.deleteDemand);
  if (!window.confirm(`${demand?.name || button.dataset.deleteDemand} demand와 해당 부하 정의를 삭제합니다. 계속하시겠습니까?`)) return;
  try { removeDemand(topology, button.dataset.deleteDemand); commitTopology('Traffic demand를 삭제했습니다.'); openDemandManager(); } catch (error) { showToast(error.message); }
});
element('inspector-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.resourceForm === 'device') { const limits = Object.fromEntries([...data.entries()].filter(([key]) => axisCatalog[key])); updateDevice(topology, form.dataset.resourceId, { name: data.get('name'), zone: data.get('zone'), limits }); }
    else updateLink(topology, form.dataset.resourceId, { capacityBps: data.get('capacityBps') });
    commitTopology('한계값을 적용했습니다.');
  } catch (error) { formError(form, error.message); }
});
element('inspector-content').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-resource]'); if (!button) return;
  const resource = resourceById(state.selectedId);
  const dependentLinks = button.dataset.deleteResource === 'device' ? topology.links.filter((link) => link.source === state.selectedId || link.target === state.selectedId).length : 0;
  const message = button.dataset.deleteResource === 'device'
    ? `${resource?.name || state.selectedId} 장비와 연결 링크 ${dependentLinks}개, 관련 demand를 삭제합니다. 계속하시겠습니까?`
    : `${state.selectedId} 링크와 이 링크만 사용하는 explicit demand 경로를 삭제합니다. 계속하시겠습니까?`;
  if (!window.confirm(message)) return;
  try { if (button.dataset.deleteResource === 'device') removeDevice(topology, state.selectedId); else removeLink(topology, state.selectedId); state.selectedId = topology.devices[0]?.id || null; commitTopology('선택한 자원을 삭제했습니다.'); } catch (error) { showToast(error.message); }
});
element('project-file-input').addEventListener('change', async (event) => {
  try {
    const text = await readFile(event.target); if (!text) return; const project = parseProject(text);
    const incoming = `${project.topology.devices.length}개 장비, ${project.topology.links.length}개 링크, ${project.topology.demands.length}개 demand`;
    const currentImpact = `${topology.devices.length}개 장비, ${topology.links.length}개 링크, ${topology.demands.length}개 demand`;
    if (!window.confirm(`${incoming}를 포함한 프로젝트를 엽니다. 현재 설계의 ${currentImpact}는 교체됩니다. 계속하시겠습니까?`)) return;
    topology = project.topology; state.scale = project.scenario.scale; state.disabledDevices = new Set(project.scenario.disabledDevices); state.disabledLinks = new Set(project.scenario.disabledLinks); state.selectedId = project.scenario.selectedId; element('scale-input').value = String(state.scale * 100); baseline = calculateScenario(topology); closeEditorPanel(); recalculate(); showToast('프로젝트를 검증하고 복원했습니다.');
  } catch (error) { showToast(`열기 실패: ${error.message}`); }
});
element('device-file-input').addEventListener('change', async (event) => {
  try { const text = await readFile(event.target); if (!text) return; const template = importDeviceDefinition(text); openDeviceForm(template); const form = element('editor-panel-content').querySelector('form'); form._deviceTemplate = template; showToast(`${template.schema} 장비 정의를 읽었습니다.`); } catch (error) { showToast(`가져오기 실패: ${error.message}`); }
});
document.querySelector('a[href="#failure-heading"]').addEventListener('click', () => setLeftPanel('failure'));
document.querySelector('[role="tablist"]').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-panel-tab]');
  if (tab) setLeftPanel(tab.dataset.panelTab);
});
document.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-panel-tab]')];
  const current = tabs.findIndex((tab) => tab.dataset.panelTab === state.leftPanel);
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? tabs.length - 1 : null;
  const next = step === null ? tabs[event.key === 'Home' ? 0 : tabs.length - 1] : tabs[(current + step) % tabs.length];
  event.preventDefault();
  setLeftPanel(next.dataset.panelTab);
  next.focus();
});

// 팔레트에서 캔버스로 끌어다 놓는다. 노드 드래그와 같은 pointer 방식이라 터치에서도 동작하고,
// 임계값을 넘지 않은 입력은 클릭으로 보아 자동 배치 자리에 놓는다.
element('component-palette').addEventListener('pointerdown', (event) => {
  const item = event.target.closest('[data-palette-kind]');
  if (!item || event.button !== 0) return;
  item.setPointerCapture(event.pointerId);
  paletteDrag = { kind: item.dataset.paletteKind, pointerId: event.pointerId, item, startX: event.clientX, startY: event.clientY, ghost: null };
});
element('component-palette').addEventListener('pointermove', (event) => {
  if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
  if (!paletteDrag.ghost) {
    if (Math.hypot(event.clientX - paletteDrag.startX, event.clientY - paletteDrag.startY) <= PALETTE_DRAG_THRESHOLD) return;
    paletteDrag.ghost = document.createElement('div');
    paletteDrag.ghost.className = 'palette-ghost';
    paletteDrag.ghost.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#${ICONS[paletteDrag.kind].id}"></use></svg>`;
    document.body.append(paletteDrag.ghost);
    paletteDrag.item.classList.add('dragging');
  }
  const point = canvasPoint(event);
  paletteDrag.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
  element('topology-canvas').classList.toggle('drop-target', point.inside);
});
element('component-palette').addEventListener('pointerup', (event) => {
  if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
  const point = canvasPoint(event);
  const drag = endPaletteDrag();
  if (!drag.ghost) { createDeviceFromPalette(drag.kind, nextDevicePosition()); return; }
  if (!point.inside) { showToast('캔버스 안에 놓아야 장비가 생성됩니다.'); return; }
  createDeviceFromPalette(drag.kind, point);
});
element('component-palette').addEventListener('pointercancel', endPaletteDrag);

reducedMotion.addEventListener('change', startTelemetry);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTelemetry(); });

element('icon-sprite').innerHTML = ICON_SPRITE;
renderPalette();
setLeftPanel(state.leftPanel);
render();
startTelemetry();
