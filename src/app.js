import { axisCatalog, behaviorCatalog, cloneTopology } from './data.js';
import { calculateScenario, compareScenarios, createExport, sweepSingleFaults } from './engine.js';
import { addDemand, addDevice, addLink, applySpec, moveDevice, normalizeId, removeDemand, removeDevice, removeLink, setLimitOverride, updateDemand, updateDevice, updateLink } from './editor.js';
import { importDeviceDefinition } from './device-import.js';
import { parseProject, serializeProject } from './project.js';
import { GLYPHS, GLYPH_SPRITE } from './glyphs.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS, ICON_SPRITE } from './icons.js';
import { vendorLogoFor } from './logos.js';
import { buildTemplate, templates } from './templates.js';
import { buildSpec, catalogEntry, catalogFor, catalogProfile } from './devices/catalog.js';
import { addConnector, addShape, alignSelection, copySelection, distributeSelection, exportDiagramSvg, groupSelection, importDrawio, moveSelection, pasteSelection, removeDiagramElements, ungroupSelection, updateShape } from './diagram.js';
import { createHistory } from './history.js';
import { evidenceApplicability } from './evidence.js';

let topology = cloneTopology();
const state = { scale: 1, selectedId: 'fw-a', selection: [{ type: 'device', id: 'fw-a' }], disabledDevices: new Set(), disabledLinks: new Set(), disabledDomains: new Set(), namedScenarios: [], editorMode: 'select', connectSource: null, leftPanel: 'palette', zoom: 1, viewMode: 'edit' };
let baselineSnapshot = { topology: structuredClone(topology), scenario: { scale: 1, disabledDevices: [], disabledLinks: [], disabledDomains: [] } };
let baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario);
let current = baseline;
let sweep = sweepSingleFaults(topology);
let documentHistory = createHistory(topology);
let clipboard = null;
let persistenceWarningShown = false;
let toastTimer;
let dragState = null;
let diagramDrag = null;
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
  current = calculateScenario(topology, { scale: state.scale, disabledDevices: state.disabledDevices, disabledLinks: state.disabledLinks, disabledDomains: state.disabledDomains });
  sweep = sweepSingleFaults(topology, { scale: state.scale });
  render();
  updateTelemetry();
  persistWorkingCopy();
}

function resetScenario() {
  state.disabledDevices.clear(); state.disabledLinks.clear(); state.connectSource = null;
  if (!topology.devices.some(({ id }) => id === state.selectedId) && !topology.links.some(({ id }) => id === state.selectedId)) state.selectedId = topology.devices[0]?.id || null;
  recalculate();
}

function commitTopology(message) {
  documentHistory.record(topology, message);
  recalculate();
  showToast(message);
}

function captureBaseline() {
  baselineSnapshot = { topology: structuredClone(topology), scenario: scenarioOptions(true) };
  baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario);
  recalculate();
  showToast('현재 설계와 시나리오를 비교 기준선으로 확정했습니다.');
}

function historyStep(direction) {
  if (direction === 'undo' ? !documentHistory.canUndo : !documentHistory.canRedo) return;
  const entry = direction === 'undo' ? documentHistory.undo() : documentHistory.redo();
  if (!entry) return;
  topology = structuredClone(entry);
  state.selectedId = topology.devices.some(({ id }) => id === state.selectedId) ? state.selectedId : topology.devices[0]?.id || null;
  state.selection = state.selectedId ? [{ type: 'device', id: state.selectedId }] : [];
  recalculate();
  showToast(direction === 'undo' ? '이전 편집으로 돌아갔습니다.' : '편집을 다시 적용했습니다.');
}

function persistWorkingCopy() {
  try {
    localStorage.setItem('rack-mesh-working-copy', serializeProject(topology, { ...state, baseline: baselineSnapshot }));
  } catch {
    if (!persistenceWarningShown) { persistenceWarningShown = true; showToast('자동 저장을 사용할 수 없습니다. 프로젝트 저장으로 작업을 보관하세요.'); }
  }
}

// 받침에 따라 조사를 고른다. 한글이 아니면 받침 없는 쪽으로 읽는다.
// 종성 ㄹ 은 '으로'가 아니라 '로'를 쓴다. '이/가'에는 그 예외가 없다.
const PARTICLES = { subject: ['이', '가'], instrumental: ['으로', '로'] };
function withParticle(word, kind) {
  const [withBatchim, without] = PARTICLES[kind];
  const last = String(word).codePointAt(String(word).length - 1);
  const coda = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
  return `${word}${coda !== 0 && !(coda === 8 && kind === 'instrumental') ? withBatchim : without}`;
}

function resourceName(resource) {
  if (resource.name) return resource.name;
  if (resource.source && resource.target) {
    const endpoint = (id) => current.devices.find((device) => device.id === id)?.name || id.toUpperCase();
    return `${endpoint(resource.source)} → ${endpoint(resource.target)}`;
  }
  return resource.id.toUpperCase();
}

// bps·pps·cps 는 formatCompact 가 단위를 붙여 준다. 나머지는 뒤에 한 번만 붙인다.
const AXIS_UNIT_SUFFIX = { sessions: ' 세션', tps: ' tps', tunnels: ' 터널' };

// 캔버스 아래에 "지금 무엇이 막고 있는가"를 문장으로 적는다. 숫자는 위에 다 있지만
// 어느 것을 봐야 하는지는 적어 주어야 읽힌다.
// 설계 자체의 성질을 한 문장으로 말한다. 지금 주입한 장애와는 별개다.
function redundancySentence() {
  if (!sweep.resources.length) return '';
  if (sweep.severs > 0) {
    const first = sweep.resources.find(({ verdict, endpoint }) => verdict === 'severs' && !endpoint);
    const name = resourceName(resourceById(first.id) || first);
    return `단일 장애점이 ${sweep.severs}개 있습니다. ${name} 하나만 죽어도 트래픽이 끊깁니다.`;
  }
  if (sweep.overloads > 0) {
    const worst = sweep.resources
      .filter(({ verdict }) => verdict === 'overloads')
      .sort((a, b) => a.minDeliveredRatio - b.minDeliveredRatio)[0];
    const name = resourceName(resourceById(worst.id) || worst);
    return worst.minDeliveredRatio < 1
      ? `끊기는 자원은 없습니다. 다만 ${name}를 끄면 ${Math.round(worst.minDeliveredRatio * 100)}%만 전달됩니다.`
      : `끊기는 자원은 없습니다. 다만 ${name}를 끄면 남은 쪽이 한계를 넘습니다.`;
  }
  if (sweep.bounded > 0) return '어느 하나가 죽어도 견디는 것으로 보이나, 한계를 모르는 축이 남아 있습니다.';
  return '어느 자원 하나가 죽어도 남은 쪽이 견딥니다.';
}

function renderBottleneck() {
  const parts = [];
  if (current.summary.evaluationStatus === 'invalid') parts.push('입력 오류가 있어 설계 생존성을 판정할 수 없습니다.');
  else if (current.summary.evaluationStatus === 'not-ready') parts.push('서비스 수요 또는 검증 대상이 없어 생존성 판정을 시작할 수 없습니다.');
  else if (current.summary.evaluationStatus === 'unknown') parts.push(`미확인 제약 ${current.summary.unknownCount || 0}개 때문에 통과 판정은 보류됩니다.`);
  const binding = current.summary.bindingResourceId
    ? [...current.devices, ...current.links].find(({ id }) => id === current.summary.bindingResourceId)
    : null;
  if (!binding) {
    parts.push('한계를 아는 축이 없습니다. 장비를 눌러 한계값을 넣으면 어디가 먼저 차는지 계산합니다.');
  } else {
    const axisKey = current.summary.bindingAxis;
    const axis = binding.axes[axisKey];
    const catalog = axisCatalog[axisKey] || { label: axisKey, unit: '' };
    const direction = binding.bindingDirection ? `${binding.bindingDirection === 'forward' ? '정방향 ' : '역방향 '}` : '';
    const suffix = AXIS_UNIT_SUFFIX[catalog.unit] || '';
    const scale = `${formatCompact(axis.load, catalog.unit)} / ${formatCompact(axis.limit, catalog.unit)}${suffix}`;
    parts.push(`${resourceName(binding)}의 ${withParticle(`${direction}${catalog.label}`, 'subject')} ${axis.status === 'overloaded' ? '한계를 넘었습니다' : '가장 빠듯합니다'}.`);
    parts.push(`${withParticle(scale, 'instrumental')} ${formatPercent(axis.utilization)}입니다.`);
  }
  if (current.summary.droppedLoadBps > 0) parts.push(`병목을 지나지 못한 ${formatCompact(current.summary.droppedLoadBps, 'bps')}가 버려집니다.`);
  if (current.summary.refusedSessionsPerSec > 0) parts.push(`신규 세션 ${formatCompact(current.summary.refusedSessionsPerSec, 'cps')}가 거절됩니다. 이미 맺힌 연결은 계속 흐릅니다.`);
  if (current.summary.unreachableCount > 0) parts.push(`경로가 끊긴 demand가 ${current.summary.unreachableCount}개 있습니다.`);
  if (current.demands.some(({ deliveredRatioBound }) => deliveredRatioBound === 'upper')) {
    parts.push('한계를 모르는 축이 있어 전달률은 상한값입니다.');
  }
  if (current.demands.some(({ deliveredRatioBound }) => deliveredRatioBound === 'indeterminate')) {
    parts.push('동일 비용 경로가 계산 한도를 넘어 일부만 열거했습니다. 이 결과로 생존성을 판정할 수 없습니다.');
  }
  if (!['invalid', 'not-ready'].includes(current.summary.evaluationStatus)) parts.push(redundancySentence());
  element('bottleneck-note').textContent = parts.filter(Boolean).join(' ');
  renderHeadline(binding);
}

// 캔버스 제목은 질문이 아니라 답이어야 한다. 병목 자원과 축, 사용률을 크게 말하고
// 자세한 문장은 캔버스 아래에 그대로 둔다.
function renderHeadline(binding) {
  const heading = element('topology-heading');
  const detail = element('headline-detail');
  if (!binding) {
    heading.textContent = '한계를 아는 축이 없습니다';
    heading.dataset.tone = 'unknown';
    detail.textContent = '장비를 눌러 한계값을 넣으면 어디가 먼저 차는지 계산합니다.';
    return;
  }
  const axisKey = current.summary.bindingAxis;
  const axis = binding.axes[axisKey];
  const catalog = axisCatalog[axisKey] || { label: axisKey, unit: '' };
  const direction = binding.bindingDirection ? `${binding.bindingDirection === 'forward' ? '정방향 ' : '역방향 '}` : '';
  heading.textContent = `${resourceName(binding)} · ${direction}${catalog.label} ${formatPercent(axis.utilization)}`;
  heading.dataset.tone = axis.status === 'overloaded' ? 'danger' : axis.status === 'warning' ? 'amber' : 'signal-deep';
  const suffix = AXIS_UNIT_SUFFIX[catalog.unit] || '';
  const growth = growthLimit();
  detail.textContent = [
    `${formatCompact(axis.load, catalog.unit)} / ${formatCompact(axis.limit, catalog.unit)}${suffix}`,
    growth,
  ].filter(Boolean).join(' · ');
}

// 발견 6 · 이 설계가 몇 배까지 견디는지는 엔진이 이미 계산할 수 있는데 어디에도 없었다.
// 현재 배율에서 위로 훑어 첫 초과가 나는 지점을 찾는다. 스무 번이면 0.05 단위로 좁혀진다.
function growthLimit() {
  const options = { disabledDevices: [...state.disabledDevices], disabledLinks: [...state.disabledLinks] };
  const overloadedAt = (scale) => calculateScenario(topology, { ...options, scale }).summary.overloadedCount > 0;
  if (overloadedAt(state.scale)) return '';
  let low = state.scale;
  let high = state.scale;
  for (let step = 0; step < 6 && !overloadedAt(high); step += 1) high = high === 0 ? 0.25 : high * 2;
  if (!overloadedAt(high)) return '';
  for (let step = 0; step < 12 && high - low > 0.01; step += 1) {
    const mid = (low + high) / 2;
    if (overloadedAt(mid)) high = mid; else low = mid;
  }
  return `${high.toFixed(2)}배에서 첫 초과`;
}

function renderClassControl() {
  element('class-control').innerHTML = `<div class="layout-axis" role="group" aria-label="클래스 배지">
      <span>배지</span>
      ${[['off', '끔'], ['on', '켬']].map(([value, label]) => `<button type="button" data-class-badge="${value}" aria-pressed="${classView.badge === value}">${escapeText(label)}</button>`).join('')}
    </div>`;
}

function renderLearningPanel() {
  const panel = element('learning-panel');
  const lesson = topology.template;
  if (!lesson?.teaches) { panel.hidden = true; panel.innerHTML = ''; return; }
  const experiment = lesson.experiment;
  panel.hidden = false;
  panel.innerHTML = `<strong>이 설계에서 확인할 것</strong>${escapeText(lesson.teaches)}
    ${experiment ? `<div><span>${escapeText(experiment.prompt)}</span><br><button type="button" data-lesson-action="${escapeAttribute(experiment.action.type)}" data-lesson-id="${escapeAttribute(experiment.action.id || '')}" data-lesson-value="${escapeAttribute(experiment.action.value ?? '')}">${escapeText(experiment.action.label)}</button><output>${escapeText(experiment.observe)}</output></div>` : ''}`;
}

function render() {
  renderSummary();
  renderFailures();
  renderTopology();
  renderInspector();
  renderComparison();
  renderBottleneck();
  renderEditorMode();
  renderClassControl();
  renderLearningPanel();
  document.querySelector('[data-editor-action="undo"]').disabled = !documentHistory.canUndo;
  document.querySelector('[data-editor-action="redo"]').disabled = !documentHistory.canRedo;
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
  // 엔진은 0.8 을 넘으면 warning 으로 판정하고 그 수를 summary.warningCount 에 담는데,
  // 상단 상태가 그 값을 보지 않아 주의 자원이 있어도 'BASELINE STABLE' 이라고 말했다.
  const runState = summary.evaluationStatus === 'invalid' ? { text: 'MODEL INVALID', tone: 'danger' }
    : summary.evaluationStatus === 'not-ready' ? { text: 'MODEL NOT READY', tone: 'unknown' }
    : summary.evaluationStatus === 'unknown' ? { text: 'EVIDENCE INCOMPLETE', tone: 'unknown' }
    : summary.unreachableCount ? { text: 'TRAFFIC UNREACHABLE', tone: 'danger' }
    : summary.overloadedCount ? { text: 'CAPACITY EXCEEDED', tone: 'danger' }
    : summary.warningCount ? { text: `CAPACITY WARNING · ${summary.warningCount}`, tone: 'amber' }
    : summary.activeFaults ? { text: 'FAILURE CONTAINED', tone: 'amber' }
    : { text: 'BASELINE STABLE', tone: 'signal' };
  element('run-state').textContent = runState.text;
  element('run-state').parentElement.style.color = `var(--${runState.tone})`;
  // headroom 은 엔진이 쓰는 임계값과 같은 기준으로 칠한다. 13% 가 초록이면 숫자가 거짓말을 한다.
  element('summary-headroom').dataset.tone = summary.minHeadroom == null ? 'unknown'
    : summary.minHeadroom <= 0 ? 'danger' : summary.minHeadroom < 0.2 ? 'amber' : 'signal-deep';
  element('scale-output').textContent = `${state.scale.toFixed(2)}×`;
  const activePathCount = current.demands.reduce((sum, demand) => sum + demand.paths.length, 0);
  element('path-readout').textContent = `${current.demands.length} DEMANDS · ${activePathCount} ACTIVE PATHS`;
}

// 끄기 전에 결과를 말한다. 하나씩 눌러 보고 되돌리는 수고가 이 도구의 요점이 아니다.
function faultForecast(verdict) {
  if (!verdict) return '판정 없음';
  if (verdict.verdict === 'severs') return verdict.endpoint ? '출발지·목적지 · 끄면 끊김' : '끄면 서비스 단절';
  if (verdict.verdict === 'overloads') {
    return verdict.minDeliveredRatio < 1
      ? `끄면 ${Math.round(verdict.minDeliveredRatio * 100)}%만 전달`
      : `끄면 ${formatPercent(verdict.worstUtilization)} 과부하`;
  }
  return verdict.bounded ? '끄면 견딤 · 한계 미확인' : '끄면 남은 쪽이 견딤';
}

const FORECAST_RANK = { severs: 0, overloads: 1, absorbs: 2 };
// 출발지·목적지가 끊는 것은 이중화 문제가 아니므로 뒤로 보낸다. 끊지 않는다면 평범한 항목이다.
const forecastRank = (verdict) => (verdict?.verdict === 'severs' && verdict.endpoint ? 3 : FORECAST_RANK[verdict?.verdict] ?? 4);

function renderFailures() {
  const verdicts = new Map(sweep.resources.map((resource) => [resource.id, resource]));
  // 예전에는 kind 와 링크 id 패턴으로 걸러 데모 이외의 설계에서는 끌 대상이 거의 없었다.
  const order = (items) => [...items].sort((a, b) =>
    forecastRank(verdicts.get(a.id)) - forecastRank(verdicts.get(b.id)) || resourceName(a).localeCompare(resourceName(b)));
  const groups = [
    { title: '장비', items: order(topology.devices), set: state.disabledDevices, type: 'device' },
    { title: '링크', items: order(topology.links), set: state.disabledLinks, type: 'link' },
    { title: '장애 도메인', items: topology.failureDomains || [], set: state.disabledDomains, type: 'domain' },
  ];
  element('failure-count').textContent = `${state.disabledDevices.size + state.disabledLinks.size + state.disabledDomains.size} ACTIVE`;
  element('failure-grade').textContent = sweep.resources.length
    ? `단일 장애점 ${sweep.severs}개 · 용량 부족 ${sweep.overloads}개 · 여유 ${sweep.absorbs}개`
    : '끌 자원이 아직 없습니다.';
  element('failure-grade').dataset.grade = sweep.grade;
  element('failure-list').innerHTML = groups.map((group) => `
    <section class="failure-group">
      <h3>${group.title}</h3>
      ${group.items.length ? group.items.map((item) => {
        const active = group.set.has(item.id);
        const verdict = verdicts.get(item.id);
        const detail = group.type === 'device' ? item.zone : group.type === 'link' ? formatCompact(item.capacity?.forwarding_bps, 'bps') : `장비 ${item.deviceIds?.length || 0} · 링크 ${item.linkIds?.length || 0}`;
        return `<button class="failure-switch ${active ? 'active' : ''}" type="button" data-failure-type="${group.type}" data-failure-id="${escapeAttribute(item.id)}" aria-pressed="${active}">
          <span class="switch-glyph" aria-hidden="true"></span><span><strong>${escapeText(resourceName(item))}</strong><small>${escapeText(detail)}</small><small class="failure-forecast" data-verdict="${escapeAttribute(verdict?.verdict === 'severs' && verdict.endpoint ? 'endpoint' : verdict?.verdict || 'none')}">${escapeText(group.type === 'domain' ? '묶인 자원을 함께 중단' : faultForecast(verdict))}</small></span><span class="switch-state">${active ? 'DOWN' : 'UP'}</span>
        </button>`;
      }).join('') : '<p class="failure-empty">아직 없습니다.</p>'}
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
// 심볼은 스텐실, 클래스는 meta 줄로 확정했다. 배지만 취향이 갈려 토글로 남긴다.
const classView = { badge: 'off' };
try {
  const saved = localStorage.getItem('rack-mesh-class-badge');
  if (saved === 'on' || saved === 'off') classView.badge = saved;
} catch { /* 저장된 선택이 없으면 기본값을 쓴다 */ }

// 이니셜은 앞 세 글자를 자르면 SWI·ROU 가 되어 읽히지 않는다. 손으로 정한다.
const KIND_INITIAL = {
  switch: 'SW', router: 'RT', hub: 'HB', modem: 'MD', wireless: 'WL',
  firewall: 'FW', ips: 'IPS', waf: 'WAF', lb: 'LB', vpn: 'VPN', sslvpn: 'SSL',
  server: 'SRV', web: 'WEB', vm: 'VM', db: 'DB', mail: 'ML', mainframe: 'MF',
  storage: 'ST', nas: 'NAS', backup: 'BK', client: 'CL', cloud: 'EXT', rack: 'RK',
};
const kindInitial = (kind) => KIND_INITIAL[String(kind).toLowerCase()] || String(kind).slice(0, 3).toUpperCase();

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
  // 목록에 정확히 있는 kind 는 별칭보다 앞선다. 그러지 않으면 vm 이 server 심볼로 그려진다.
  const exact = ICONS[key] ? key : (KIND_ALIAS[key] || key);
  const name = ICONS[exact] ? exact : (ICON_KINDS.find((candidate) => key.includes(candidate)) || ICON_FALLBACK);
  // 스텐실이 클래스를 구별해 주지 못해 손으로 그린 심볼이 있으면 그것이 스텐실보다 앞선다.
  return (GLYPHS[name] || ICONS[name]).id;
}

function behaviorToken(device) {
  const catalog = behaviorCatalog[device.kind];
  if (!catalog) return '';
  return catalog.options[device.behavior?.mode ?? catalog.default]?.token || '';
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

// 제조사 표시 순서: 프로젝트가 직접 실은 로고 → 카탈로그 마크 → 약칭 텍스트.
// 마크는 식별용이고 제휴를 뜻하지 않는다(vendor/brand-logos/NOTICE.md).
function vendorBadge(device) {
  if (device.vendorLogo) return `<img class="node-vendor-logo" src="${escapeAttribute(device.vendorLogo)}" alt="">`;
  const mark = vendorLogoFor(device.vendor);
  if (mark) {
    return `<svg class="node-vendor-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="--mark:${mark.hex}"><path d="${escapeAttribute(mark.path)}"></path></svg>`;
  }
  if (device.vendor) return `<span class="node-vendor">${escapeText(device.vendor)}</span>`;
  return '';
}

function nodeAxisRow(device, key, axis) {
  // unknown·invalid 축에는 data-live-util을 붙이지 않는다. 텔레메트리가 미확인 값을 숫자로 덮어쓰면 안 된다.
  const live = axis.utilization == null ? '' : ` data-live-util="${axis.utilization}" data-live-seed="${escapeAttribute(device.id)}:${key}"`;
  const percent = axis.status === 'unknown' ? '\u2014' : axis.status === 'invalid' ? 'ERR' : formatPercent(axis.utilization);
  // 막대 후보가 쓰는 값. unknown 축은 넘기지 않아 막대가 그려지지 않는다.
  const meter = axis.utilization == null ? '' : ` style="--util:${Math.min(axis.utilization, 1.5)}"`;
  return `<span class="node-axis" data-axis-state="${axis.status}"${key === device.bindingAxis ? ' data-binding=""' : ''}${meter}><i>${STATE_TOKEN[axis.status] || '?'}</i><b>${escapeText(nodeAxisLabel(key))}</b><em>${formatNodeValue(axis.load)}</em><s${live}>${percent}</s></span>`;
}

// 축 토큰은 시각 축약이라 읽히면 소음이다. 접근 가능한 이름은 요약만 담고 흔들리는 값을 넣지 않는다.
function nodeAccessibleName(device) {
  const head = [device.name, [device.vendor, device.model].filter(Boolean).join(' '), device.kind, device.zone].filter(Boolean).join(' \u00b7 ');
  if (!device.active) return `${head} \u00b7 비활성`;
  const binding = device.axes[device.bindingAxis];
  const bindingText = binding ? `제한 축 ${axisCatalog[device.bindingAxis]?.label || device.bindingAxis} ${formatPercent(binding.utilization)}` : '한계 미확인';
  const axes = Object.values(device.axes);
  const alerts = axes.filter(({ status }) => status === 'overloaded' || status === 'warning').length;
  return `${head} \u00b7 ${stateLabel(device.primaryStatus)} \u00b7 ${bindingText} \u00b7 축 ${axes.length}개 중 주의 이상 ${alerts}개`;
}

const PALETTE = [
  { kind: 'switch', label: '스위치', group: '네트워크', limits: { forwarding_bps: null, forwarding_pps: null } },
  { kind: 'router', label: '라우터', group: '네트워크', limits: { forwarding_bps: null, forwarding_pps: null } },
  { kind: 'hub', label: '허브', group: '네트워크', limits: { forwarding_bps: null, forwarding_pps: null } },
  { kind: 'wireless', label: '무선 AP', group: '네트워크', limits: { forwarding_bps: null, concurrent_sessions: null } },
  { kind: 'modem', label: '회선 종단', group: '네트워크', limits: { forwarding_bps: null } },
  { kind: 'firewall', label: '방화벽', group: '보안 · 트래픽', limits: { forwarding_bps: null, forwarding_pps: null, new_sessions_per_sec: null, concurrent_sessions: null } },
  { kind: 'ips', label: 'IPS · IDS', group: '보안 · 트래픽', limits: { forwarding_bps: null, forwarding_pps: null, concurrent_sessions: null } },
  { kind: 'waf', label: 'WAF · 프록시', group: '보안 · 트래픽', limits: { forwarding_bps: null, new_sessions_per_sec: null, concurrent_sessions: null, tls_full_handshakes_per_sec: null } },
  { kind: 'lb', label: '로드밸런서', group: '보안 · 트래픽', limits: { forwarding_bps: null, new_sessions_per_sec: null, concurrent_sessions: null, tls_full_handshakes_per_sec: null, tls_resumed_handshakes_per_sec: null } },
  { kind: 'vpn', label: 'IPsec VPN', group: '보안 · 트래픽', limits: { forwarding_bps: null, forwarding_pps: null, vpn_tunnels: null } },
  { kind: 'sslvpn', label: 'SSL VPN', group: '보안 · 트래픽', limits: { forwarding_bps: null, concurrent_sessions: null, vpn_tunnels: null, tls_full_handshakes_per_sec: null } },
  { kind: 'server', label: '서버', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null } },
  { kind: 'web', label: '웹 서버', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null, new_sessions_per_sec: null } },
  { kind: 'vm', label: '가상 서버', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null } },
  { kind: 'db', label: 'DB 서버', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null, concurrent_sessions: null } },
  { kind: 'mail', label: '메일 서버', group: '서버 · 스토리지', limits: { nic_bps: null, new_sessions_per_sec: null } },
  { kind: 'mainframe', label: '메인프레임', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null } },
  { kind: 'storage', label: '스토리지', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null } },
  { kind: 'nas', label: 'NAS', group: '서버 · 스토리지', limits: { nic_bps: null, nic_pps: null } },
  { kind: 'backup', label: '백업 서버', group: '서버 · 스토리지', limits: { nic_bps: null } },
  { kind: 'cloud', label: '외부망', group: '외부 · 단말', limits: { forwarding_bps: null, forwarding_pps: null } },
  { kind: 'client', label: '클라이언트', group: '외부 · 단말', limits: { nic_bps: null } },
];
const PALETTE_DRAG_THRESHOLD = 4;
let paletteDrag = null;
let linkDraft = null;
let contextTarget = null;
let pendingDeviceImport = null;

function renderPalette() {
  const counts = PALETTE.reduce((map, item) => map.set(item.group, (map.get(item.group) || 0) + 1), new Map());
  let group = null;
  let index = 0;
  element('component-palette').innerHTML = PALETTE.map((item) => {
    const heading = item.group === group ? '' : `<h3 class="palette-group">${escapeText(item.group)}</h3>`;
    index = item.group === group ? index + 1 : 0;
    group = item.group;
    // 2열 격자에서 홀수 그룹의 마지막 칸은 빈 자리로 남는다. 그 항목을 한 줄로 늘려 메운다.
    const wide = counts.get(item.group) % 2 === 1 && index === counts.get(item.group) - 1 ? ' data-wide=""' : '';
    return `${heading}<button type="button" class="palette-item"${wide} data-palette-kind="${item.kind}" aria-label="${escapeAttribute(item.label)} 추가">
    <span class="palette-glyph"><svg aria-hidden="true" focusable="false"><use href="#${symbolId(item.kind)}"></use></svg></span><span class="palette-label">${escapeText(item.label)}</span><span class="palette-kind">${item.kind.toUpperCase()}</span>
  </button>`;
  }).join('');
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
const STAGE_PAD = 300;
const ZOOM_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
const ZOOM_RANGE = { min: ZOOM_STEPS[0], max: ZOOM_STEPS.at(-1) };
// 휠 한 눈금(픽셀 기준 약 100)이 배율을 5%쯤 움직이게 한다. 트랙패드는 이벤트가 훨씬
// 촘촘하게 오므로 이 값이 크면 순식간에 한계까지 튄다.
const ZOOM_WHEEL_SENSITIVITY = 0.0005;
const WHEEL_LINE_HEIGHT = 16;
// 노드는 심볼 중심이 기준이고 라벨이 아래로 흐르므로 방향별 여백이 다르다.
const NODE_REACH = { left: 54, right: 54, top: 18, bottom: 122 };
let viewport = { minX: 0, minY: 0, width: CANVAS_MIN.width, height: CANVAS_MIN.height };


// zone 은 슬래시로 계층을 적는다. 'FABRIC / RACK 04' 는 FABRIC 안의 RACK 04 다.
// 계층을 쓰지 않은 설계는 한 층짜리 그룹이 되고, 그리는 방식은 같다.
const GROUP_PAD = { base: 14, step: 8, label: 17 };
const zonePath = (zone) => String(zone || '').split('/').map((part) => part.trim()).filter(Boolean);

function groupBoxes(devices) {
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
  // 얕은 그룹일수록 여백을 크게 줘야 자식 상자를 감싼 것으로 읽힌다.
  return [...byPath.values()]
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key))
    .map((entry) => {
      const pad = GROUP_PAD.base + (deepest - entry.depth) * GROUP_PAD.step;
      return { ...entry, x: entry.box.minX - pad, y: entry.box.minY - pad - GROUP_PAD.label,
        width: entry.box.maxX - entry.box.minX + pad * 2, height: entry.box.maxY - entry.box.minY + pad * 2 + GROUP_PAD.label };
    });
}

function canvasViewport(devices) {
  const shapeBounds = (topology.diagram?.shapes || []).reduce((box, shape) => ({
    minX: Math.min(box.minX, shape.x), minY: Math.min(box.minY, shape.y),
    maxX: Math.max(box.maxX, shape.x + shape.width), maxY: Math.max(box.maxY, shape.y + shape.height),
  }), { minX: 0, minY: 0, maxX: CANVAS_MIN.width, maxY: CANVAS_MIN.height });
  const bounds = groupBoxes(devices).reduce((box, group) => ({
    minX: Math.min(box.minX, group.x), minY: Math.min(box.minY, group.y),
    maxX: Math.max(box.maxX, group.x + group.width), maxY: Math.max(box.maxY, group.y + group.height),
  }), devices.reduce((box, { position }) => ({
    minX: Math.min(box.minX, position.x - NODE_REACH.left), minY: Math.min(box.minY, position.y - NODE_REACH.top),
    maxX: Math.max(box.maxX, position.x + NODE_REACH.right), maxY: Math.max(box.maxY, position.y + NODE_REACH.bottom),
  }), shapeBounds));
  const minX = bounds.minX < 0 ? bounds.minX - CANVAS_PAD : 0;
  const minY = bounds.minY < 0 ? bounds.minY - CANVAS_PAD : 0;
  const maxX = bounds.maxX > CANVAS_MIN.width ? bounds.maxX + CANVAS_PAD : CANVAS_MIN.width;
  const maxY = bounds.maxY > CANVAS_MIN.height ? bounds.maxY + CANVAS_PAD : CANVAS_MIN.height;
  return { minX, minY, width: Math.min(maxX - minX, CANVAS_MAX), height: Math.min(maxY - minY, CANVAS_MAX) };
}

function applyViewport() {
  viewport = canvasViewport(current.devices);
  const stage = element('topology-stage');
  stage.style.setProperty('--canvas-width', `${viewport.width}px`);
  stage.style.setProperty('--canvas-height', `${viewport.height}px`);
  stage.style.setProperty('--viewport-x', `${viewport.minX}px`);
  stage.style.setProperty('--viewport-y', `${viewport.minY}px`);
  // viewBox 가 원점을 담당하므로 링크는 좌표를 변환하지 않고 그대로 쓴다.
  element('link-layer').setAttribute('viewBox', `${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`);
}

// 확대가 없으므로 CSS 픽셀과 캔버스 좌표는 1:1 이고, 원점만 viewport 만큼 밀려 있다.
// 캔버스 밖에 놓아도 좌표를 가두지 않는다. 캔버스가 그 위치까지 자란다.
function canvasPoint(event) {
  const canvas = element('topology-canvas').getBoundingClientRect();
  const drop = document.querySelector('.topology-scroll').getBoundingClientRect();
  return {
    x: (event.clientX - canvas.left) / state.zoom + viewport.minX,
    y: (event.clientY - canvas.top) / state.zoom + viewport.minY,
    inside: event.clientX >= drop.left && event.clientX <= drop.right && event.clientY >= drop.top && event.clientY <= drop.bottom,
  };
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

function applyZoom(anchor) {
  const scroll = document.querySelector('.topology-scroll');
  const previous = Number(element('topology-stage').style.getPropertyValue('--zoom') || 1);
  element('topology-stage').style.setProperty('--zoom', String(state.zoom));
  element('zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
  // 확대해도 기준점이 제자리에 머물도록 스크롤을 같은 비율로 옮긴다.
  const point = anchor || { x: scroll.clientWidth / 2, y: scroll.clientHeight / 2 };
  const ratio = state.zoom / previous;
  scroll.scrollLeft = (scroll.scrollLeft + point.x) * ratio - point.x;
  scroll.scrollTop = (scroll.scrollTop + point.y) * ratio - point.y;
}

function setZoom(value, anchor) {
  const next = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, value));
  if (Math.abs(next - state.zoom) < 1e-6) return;
  state.zoom = next;
  applyZoom(anchor);
}

function stepZoom(direction) {
  const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
  setZoom(steps.find((step) => (direction > 0 ? step > state.zoom + 1e-6 : step < state.zoom - 1e-6)) ?? state.zoom);
}

function centerCanvas() {
  const scroll = document.querySelector('.topology-scroll');
  scroll.scrollLeft = STAGE_PAD - Math.max(0, (scroll.clientWidth - viewport.width * state.zoom) / 2);
  scroll.scrollTop = STAGE_PAD - Math.max(0, (scroll.clientHeight - viewport.height * state.zoom) / 2);
}

function zoomToFit() {
  const scroll = document.querySelector('.topology-scroll');
  const fit = Math.min(scroll.clientWidth / viewport.width, scroll.clientHeight / viewport.height);
  setZoom(Math.min(1, fit));
  centerCanvas();
}

let panState = null;
let selectionBoxState = null;

function endPan() {
  if (!panState) return;
  const scroll = document.querySelector('.topology-scroll');
  scroll.classList.remove('panning');
  panState = null;
}

function endPaletteDrag() {
  if (!paletteDrag) return null;
  const drag = paletteDrag;
  paletteDrag = null;
  drag.ghost?.remove();
  drag.item.classList.remove('dragging');
  document.querySelector('.topology-scroll').classList.remove('drop-target');
  return drag;
}

function renderTopology() {
  applyViewport();
  const devices = new Map(current.devices.map((item) => [item.id, item]));
  // 끊긴 demand 가 무장애였다면 지났을 링크. 살아 있지만 이 트래픽은 지나지 못한다.
  const severedPathLinks = new Set(current.demands.flatMap(({ severedPaths }) => (severedPaths || []).flatMap(({ links }) => links)));
  const groupMarkup = groupBoxes(current.devices).map((group) => `<g class="topology-group" data-depth="${group.depth}">
      <rect class="group-frame" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}"></rect>
      <text class="group-label" x="${group.x + 11}" y="${group.y + 13}">${escapeText(group.label)}</text>
    </g>`).join('');
  const endpointPoint = (id) => devices.get(id)?.position || (() => {
    const shape = topology.diagram?.shapes?.find((item) => item.id === id);
    return shape ? { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 } : null;
  })();
  const diagramConnectors = (topology.diagram?.connectors || []).map((connector) => {
    const source = endpointPoint(connector.source); const target = endpointPoint(connector.target);
    if (!source || !target) return '';
    const points = [source, ...(connector.waypoints || []), target].map(({ x, y }) => `${x},${y}`).join(' ');
    return `<g class="diagram-connector" data-connector-id="${escapeAttribute(connector.id)}"><polyline points="${points}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"></polyline></g>`;
  }).join('');
  element('link-layer').innerHTML = groupMarkup + current.links.map((link) => {
    const source = devices.get(link.source).position;
    const target = devices.get(link.target).position;
    const onSeveredPath = !link.severed && severedPathLinks.has(link.id);
    const status = link.severed ? 'disabled' : onSeveredPath ? 'on-severed-path' : link.primaryStatus;
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2 - 7;
    const utilization = link.axes.forwarding_bps?.utilization;
    const packetCount = !link.severed && !onSeveredPath && utilization > 0 ? Math.min(3, Math.max(1, Math.ceil(utilization * 3))) : 0;
    const packetDuration = Math.max(1.25, 3.4 - Math.min(utilization || 0, 1.5) * 1.25);
    const packetDots = Array.from({ length: packetCount }, (_, index) => `<circle class="packet-dot ${status}" r="3">
      <animate attributeName="cx" values="${source.x};${target.x}" dur="${packetDuration.toFixed(2)}s" begin="-${(packetDuration * index / packetCount).toFixed(2)}s" repeatCount="indefinite"></animate>
      <animate attributeName="cy" values="${source.y};${target.y}" dur="${packetDuration.toFixed(2)}s" begin="-${(packetDuration * index / packetCount).toFixed(2)}s" repeatCount="indefinite"></animate>
    </circle>`).join('');
    return `<g class="link-group" data-link-id="${escapeAttribute(link.id)}">
      <line class="link ${status}" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"></line>
      <line class="link-hit" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}" tabindex="0" role="button" aria-label="${escapeAttribute(`${resourceName(link)} 링크 검사${link.severed ? ' · 끊김' : onSeveredPath ? ' · 경로 단절' : ''}`)}"></line>
      ${packetDots}
      <text class="link-label"${link.severed ? '' : ` data-live-util="${utilization ?? ''}" data-live-seed="${link.id}"`} x="${middleX}" y="${middleY}" text-anchor="middle">${link.severed ? 'DOWN' : formatPercent(utilization)}</text>
    </g>`;
  }).join('') + diagramConnectors;

  const selectionHas = (type, id) => state.selection.some((item) => item.type === type && item.id === id)
    || type === 'shape' && state.selection.some((item) => item.type === 'group'
      && topology.diagram?.groups?.find(({ id: groupId }) => groupId === item.id)?.memberIds.includes(id));
  element('diagram-layer').innerHTML = (topology.diagram?.shapes || []).map((shape) =>
    `<button type="button" class="diagram-shape${selectionHas('shape', shape.id) ? ' selected' : ''}" data-shape-id="${escapeAttribute(shape.id)}" data-kind="${escapeAttribute(shape.kind)}" style="left:${shape.x - viewport.minX}px;top:${shape.y - viewport.minY}px;width:${shape.width}px;height:${shape.height}px">${escapeText(shape.text || '')}</button>`).join('');

  element('node-layer').innerHTML = current.devices.map((device) => {
    const status = device.active ? device.primaryStatus : 'disabled';
    const { rows, hidden } = nodeAxes(device);
    const verdict = sweep.resources.find(({ id }) => id === device.id);
    // 이미 죽은 장비에 "이게 죽으면 끊긴다"와 숨긴 축 개수를 붙이는 것은 소음이다.
    const spof = device.active && verdict?.verdict === 'severs' && !verdict.endpoint;
    const meta = [device.kind.toUpperCase(), behaviorToken(device), zonePath(device.zone).at(-1) || device.zone,
      spof ? 'SPOF' : '', device.active && hidden ? `+${hidden}` : ''].filter(Boolean).join(' \u00b7 ');
    const axes = device.active
      ? rows.map(([key, axis]) => nodeAxisRow(device, key, axis)).join('')
      : '<span class="node-axis" data-axis-state="disabled"><i>x</i><b>OFFLINE</b><em>\u2014</em><s>DOWN</s></span>';
    return `<button type="button" class="mesh-node ${status} ${state.selectedId === device.id ? 'selected' : ''} ${selectionHas('device', device.id) ? 'multi-selected' : ''} ${state.connectSource === device.id ? 'connect-source' : ''}" data-device-id="${escapeAttribute(device.id)}" style="left:${device.position.x - viewport.minX}px;top:${device.position.y - viewport.minY}px" aria-pressed="${state.selectedId === device.id}" aria-label="${escapeAttribute(nodeAccessibleName(device))}">
      <span class="node-symbol">${device.active ? '<span class="node-ports" aria-hidden="true">' + ['top', 'right', 'bottom', 'left'].map((side) => `<i data-port="${side}"></i>`).join('') + '</span>' : ''}${vendorBadge(device)}${classView.badge === 'on' ? `<span class="node-class-badge">${escapeText(kindInitial(device.kind))}</span>` : ''}<svg class="node-glyph" aria-hidden="true" focusable="false"><use href="#${symbolId(device.kind)}"></use></svg></span><span class="node-rail"></span><span class="node-labels"><span class="node-name">${escapeText(device.name)}</span>${device.model ? `<span class="node-model">${escapeText(device.model)}</span>` : ''}<span class="node-axes">${axes}</span><span class="node-meta">${escapeText(meta)}</span></span>
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
    <div class="resource-identity"><strong>${escapeText(resourceName(resource))}</strong><span>${escapeText(isDevice ? [[resource.vendor, resource.model].filter(Boolean).join(' '), resource.kind.toUpperCase(), resource.zone].filter(Boolean).join(' · ') : `링크 · ${formatCompact(resource.capacity?.forwarding_bps, 'bps')} 방향별`)}</span></div>
    <div class="binding-callout"><span>BINDING AXIS</span><strong><span>${axisCatalog[resource.bindingAxis]?.label || resource.bindingAxis || '알려진 축 없음'}</span><span data-live-util="${binding?.utilization ?? ''}" data-live-seed="${resource.id}-binding">${binding ? formatPercent(binding.utilization) : '—'}</span></strong></div>
    <div class="axis-list">${Object.entries(resource.axes).map(([axis, result]) => renderAxis(axis, result, resource.id)).join('')}</div>
    ${isDevice ? renderBehavior(resource) : ''}
    ${isDevice ? renderSpecBlock(resource) : ''}
    ${renderSourceNote(source, isDevice ? resource : null)}
    ${isDevice ? renderDeviceEditor(resource) : renderLinkEditor(resource)}`;
}

const SOURCE_TYPE_LABEL = { datasheet: '데이터시트', third_party_test: '제3자 시험', user_measured: '실측', estimate: '추정' };

// 어느 조건의 값을 쓰고 있는지가 값 자체만큼 중요하다. 같은 장비가 조건에 따라 20배 갈린다.
function renderSpecBlock(resource) {
  const entries = catalogFor(resource.kind);
  if (!entries.length) return '';
  const entry = resource.spec ? catalogEntry(resource.spec.catalogId) : null;
  const profile = entry ? catalogProfile(entry.id, resource.spec.profileId) : null;
  return `<div class="spec-block">
    <span class="spec-code">DATASHEET PROFILE</span>
    <label>장비<select data-spec-field="catalog"><option value="">직접 입력</option>${entries.map((item) =>
      `<option value="${escapeAttribute(item.id)}"${entry?.id === item.id ? ' selected' : ''}>${escapeText(`${item.vendor} ${item.model}`)}</option>`).join('')}</select></label>
    ${entry ? `<label>측정 조건<select data-spec-field="profile">${entry.profiles.map((item) =>
      `<option value="${escapeAttribute(item.id)}"${profile?.id === item.id ? ' selected' : ''}>${escapeText(item.label)}</option>`).join('')}</select></label>` : ''}
    ${profile?.note ? `<p class="spec-note">${escapeText(profile.note)}</p>` : ''}
  </div>`;
}

function renderSourceNote(source, device) {
  if (device?.spec || device?.metadata?.records) {
    const link = source.url ? `<a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer noopener">원문</a>` : '';
    const records = device.spec?.records || device.metadata?.records || [];
    const evidence = records.map((record) => {
      const applicability = (device.spec?.conditionSelection || device.metadata?.conditionSelection) === 'explicit-profile'
        ? 'applicable' : evidenceApplicability(record, topology.workloadConditions || {}, topology.workloadScope || null);
      const label = applicability === 'applicable' ? '조건 일치' : applicability === 'incompatible' ? '조건 불일치' : '적용 조건 미확인';
      return `<span class="evidence-state">${escapeText(axisCatalog[record.axis]?.label || record.axis)} · ${escapeText(record.evidenceKind)} · ${label}</span>`;
    }).join('');
    return `<div class="source-note">
      <strong>${escapeText(SOURCE_TYPE_LABEL[source.type] || source.type || '출처 미상')} · ${escapeText(source.label || '')}</strong> ${link}
      ${source.locator ? `<br>${escapeText(source.locator)}` : ''}
      ${source.retrievedAt ? `<br>수집 ${escapeText(source.retrievedAt)}` : ''}
      ${source.note ? `<br>${escapeText(source.note)}` : ''}
      ${evidence}
      ${(device.spec?.digest || device.metadata?.digest) ? `<br>근거 snapshot ${escapeText(device.spec?.digest || device.metadata?.digest)}` : ''}
      ${device.overrides ? `<br><b>보정한 축이 ${Object.keys(device.overrides).length}개 있습니다. 데이터시트 값은 그대로 보존됩니다.</b>` : ''}
      <br>실제 설계에는 이 환경에서 잰 값으로 다시 확인하세요.</div>`;
  }
  return `<div class="source-note"><strong>${escapeText(source.label)}</strong><br>${escapeText(source.condition || '조건 미지정')}<br>실제 설계에는 동일 조건의 측정값을 사용하세요.</div>`;
}

function scenarioOptions(clone = false) {
  const value = { scale: state.scale, disabledDevices: [...state.disabledDevices], disabledLinks: [...state.disabledLinks], disabledDomains: [...state.disabledDomains] };
  return clone ? structuredClone(value) : value;
}

function behaviorPreview(resource, mode) {
  const probe = structuredClone(topology);
  const device = probe.devices.find(({ id }) => id === resource.id);
  if (!device) return '';
  device.behavior = { ...device.behavior, mode };
  const after = calculateScenario(probe, scenarioOptions()).devices.find(({ id }) => id === resource.id);
  const rows = Object.keys(resource.axes)
    .filter((axis) => resource.axes[axis].utilization != null && after.axes[axis].utilization != null)
    .map((axis) => `<b>${escapeText(axisCatalog[axis]?.label || axis)} ${formatPercent(resource.axes[axis].utilization)} → ${formatPercent(after.axes[axis].utilization)}</b>`)
    .join('');
  if (!rows) return '';
  const moved = resource.bindingAxis !== after.bindingAxis
    ? `<s>제한 축: ${escapeText(axisCatalog[resource.bindingAxis]?.label || resource.bindingAxis)} → ${escapeText(axisCatalog[after.bindingAxis]?.label || after.bindingAxis)}</s>`
    : '<s>제한 축은 그대로입니다.</s>';
  return `<div class="behavior-preview"><span>${escapeText(behaviorCatalog[resource.kind].options[mode].label)}로 바꾸면</span>${rows}${moved}
    <small>링크 부하는 그대로입니다. 장비만 우회합니다.</small></div>`;
}

function renderBehavior(resource) {
  const catalog = behaviorCatalog[resource.kind];
  if (!catalog) return '';
  const current = resource.behavior?.mode ?? catalog.default;
  const other = Object.keys(catalog.options).find((mode) => mode !== current);
  return `<div class="behavior-block">
    <span class="behavior-code">${escapeText(catalog.label)}</span>
    <div class="behavior-choice" role="radiogroup" aria-label="${escapeAttribute(catalog.label)}">
      ${Object.entries(catalog.options).map(([mode, meta]) => `<label><input type="radio" name="behavior-mode" value="${escapeAttribute(mode)}"${mode === current ? ' checked' : ''}><span>${escapeText(meta.token)}</span></label>`).join('')}
    </div>
    <p class="behavior-note">${escapeText(catalog.options[current].note)}</p>
    ${catalog.affectsLoad && other ? behaviorPreview(resource, other)
      : '<p class="behavior-note">이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.</p>'}
  </div>`;
}

// 데이터시트 값이 있으면 그 값을 자리표시자로 두고, 보정한 축은 되돌릴 수 있게 한다.
function renderLimitField(resource, axis) {
  const catalog = axisCatalog[axis] || {};
  const datasheet = resource.spec?.limits?.[axis];
  const corrected = resource.overrides && Object.hasOwn(resource.overrides, axis);
  const hint = resource.spec
    ? (datasheet == null ? '이 조건에서는 미확인' : `데이터시트 ${formatCompact(datasheet, catalog.unit)}`)
    : '';
  return `<label class="limit-field${corrected ? ' corrected' : ''}">
    <span>${escapeText(catalog.label || axis)}${corrected ? ' <b>보정</b>' : ''}</span>
    <input name="${axis}" type="number" min="0" step="any" placeholder="${escapeAttribute(datasheet == null ? '미확인' : String(datasheet))}" value="${resource.limits[axis] ?? ''}">
    ${hint ? `<small>${escapeText(hint)}${corrected ? ` <button type="button" data-reset-axis="${escapeAttribute(axis)}">되돌리기</button>` : ''}</small>` : ''}
  </label>`;
}

function renderDeviceEditor(resource) {
  const fields = Object.keys(resource.limits);
  return `<form class="inspector-editor" data-resource-form="device" data-resource-id="${resource.id}">
    <h3>장비 한계 편집</h3>
    <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(resource.name)}"></label>
    <label>영역<input name="zone" maxlength="80" required value="${escapeAttribute(resource.zone)}" placeholder="FABRIC / RACK 04"></label>
    <label>제조사<input name="vendor" maxlength="24" value="${escapeAttribute(resource.vendor || '')}" placeholder="약칭"></label>
    <label>모델<input name="model" maxlength="40" value="${escapeAttribute(resource.model || '')}"></label>
    ${fields.map((axis) => renderLimitField(resource, axis)).join('')}
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
  document.querySelectorAll('[data-live-util]').forEach((target) => {
    if (target.dataset.liveUtil === '') return;
    const base = Number(target.dataset.liveUtil);
    if (!Number.isFinite(base)) return;
    target.textContent = formatPercent(Math.max(0, base));
  });
  document.querySelectorAll('[data-live-load]').forEach((target) => {
    if (target.dataset.liveLoad === '') return;
    const base = Number(target.dataset.liveLoad);
    if (!Number.isFinite(base)) return;
    const value = Math.max(0, base);
    target.textContent = `${formatCompact(value, target.dataset.liveUnit)} load`;
  });
  const liveHeadroom = current.summary.minHeadroom;
  element('summary-headroom').dataset.liveValue = liveHeadroom == null ? '' : liveHeadroom.toFixed(6);
  const seriesValues = {
    headroom: liveHeadroom ?? 0,
    utilization: 1 - (current.summary.minHeadroom ?? 1),
    delivery: Math.max(0, 1 - current.summary.unreachableCount / Math.max(current.demands.length, 1)),
    traffic: current.scale,
  };
  document.querySelectorAll('.metric-sparkline').forEach((svg) => renderSparkline(svg, pushTelemetry(svg.dataset.series, seriesValues[svg.dataset.series])));
}

function startTelemetry() {
  clearInterval(telemetryTimer);
  updateTelemetry();
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

const GRADE_LABEL = { 'single-point': '단일 장애점', partial: '이중화 · 용량 부족', redundant: '이중화', unknown: '판정 불가' };
let templateGrades = null;
function templateGrade(id) {
  if (!templateGrades) {
    templateGrades = new Map(templates.map((item) => [item.id, sweepSingleFaults(buildTemplate(item.id))]));
  }
  return templateGrades.get(id);
}

function openTemplatePicker() {
  const cards = templates.map((item) => {
    const grade = templateGrade(item.id);
    const gradeLabel = grade.resources.length
      ? `${GRADE_LABEL[grade.grade]}${grade.grade === 'single-point' ? ` ${grade.severs}` : ''}`
      : '';
    const haystack = [item.name, item.summary, item.teaches, gradeLabel, ...(item.tags || [])].join(' ').toLowerCase();
    return `<button type="button" class="template-item" data-template="${escapeAttribute(item.id)}" data-search="${escapeAttribute(haystack)}">
      <strong>${escapeText(item.name)}</strong>${gradeLabel ? `<b class="template-grade" data-grade="${escapeAttribute(grade.grade)}">${escapeText(gradeLabel)}</b>` : ''}<span>${escapeText(item.summary)}</span>${item.teaches ? `<em>${escapeText(item.teaches)}</em>` : ''}
      ${(item.tags || []).length ? `<span class="template-tags">${item.tags.map((tag) => `<i>${escapeText(tag)}</i>`).join('')}</span>` : ''}
    </button>`;
  }).join('');
  openEditorPanel('설계 템플릿', `<p class="editor-hint">템플릿마다 먼저 차는 축이 다릅니다. 불러온 뒤 장비를 눌러 어느 축이 병목인지 확인하세요.</p>
    <label class="template-search"><span class="visually-hidden">템플릿 검색</span>
      <input type="search" id="template-search" placeholder="이름, 태그, 병목으로 검색 (예: TLS, 방화벽, 대역폭)" autocomplete="off"></label>
    <p class="template-count" id="template-count" aria-live="polite">${templates.length}개</p>
    <div class="template-list">${cards}</div>`);
  element('template-search').focus();
}

function filterTemplates(query) {
  const needle = query.trim().toLowerCase();
  let shown = 0;
  for (const item of document.querySelectorAll('.template-item')) {
    const match = !needle || item.dataset.search.includes(needle);
    item.hidden = !match;
    if (match) shown += 1;
  }
  element('template-count').textContent = needle ? `${shown}개 일치` : `${templates.length}개`;
}

function loadTopology(next, message, undo = null) {
  topology = next;
  state.scale = 1; state.selectedId = topology.devices[0]?.id || null;
  state.selection = state.selectedId ? [{ type: 'device', id: state.selectedId }] : [];
  state.disabledDevices.clear(); state.disabledLinks.clear(); state.disabledDomains.clear(); state.namedScenarios = [];
  element('scale-input').value = '100';
  closeEditorPanel();
  documentHistory.reset(topology);
  baselineSnapshot = { topology: structuredClone(topology), scenario: scenarioOptions(true) };
  baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario);
  recalculate(); showToast(message, undo);
  centerCanvas();
}

function applyTemplate(id) {
  const chosen = templates.find((item) => item.id === id);
  if (!chosen) return;
  const previous = structuredClone(topology);
  const previousBaseline = structuredClone(baselineSnapshot);
  const restore = { scale: state.scale, devices: [...state.disabledDevices], links: [...state.disabledLinks], domains: [...state.disabledDomains], namedScenarios: structuredClone(state.namedScenarios), selectedId: state.selectedId };
  loadTopology(buildTemplate(id), `${chosen.name}을 불러왔습니다.`, () => {
    topology = previous;
    state.scale = restore.scale; state.selectedId = restore.selectedId;
    state.disabledDevices = new Set(restore.devices); state.disabledLinks = new Set(restore.links); state.disabledDomains = new Set(restore.domains); state.namedScenarios = restore.namedScenarios;
    baselineSnapshot = previousBaseline; baseline = calculateScenario(previousBaseline.topology, previousBaseline.scenario);
    element('scale-input').value = String(restore.scale * 100);
    documentHistory.reset(topology); recalculate(); showToast('이전 설계로 되돌렸습니다.');
    centerCanvas();
  });
}

function openDeviceForm(template = null) {
  openEditorPanel('장비 추가', `<p class="editor-hint">장비를 만든 뒤 캔버스에서 드래그해 위치를 조정하세요. 비어 있는 한계값은 unknown으로 유지됩니다.</p><form class="editor-form" data-editor-form="device">
    <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(template?.name || '')}"></label>
    <label>클래스<select name="kind">${['switch','router','firewall','lb','server','storage'].map((kind) => `<option ${template?.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>
    <label>영역<input name="zone" maxlength="80" value="${escapeAttribute(template?.zone || 'UNASSIGNED')}"></label>
    <label>처리량 한계 (bps)<input name="forwarding_bps" type="number" min="1" step="any" value="${template?.limits?.forwarding_bps ?? ''}"></label>
    <label>PPS 한계<input name="forwarding_pps" type="number" min="1" step="any" value="${template?.limits?.forwarding_pps ?? ''}"></label>
    <div class="form-actions"><button type="submit">장비 생성</button></div><p class="editor-error"></p></form>`);
  element('editor-panel-content').querySelector('form')._deviceTemplate = template || {};
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

function checkList(name, items, label) {
  if (!items.length) return `<span>${escapeText(label)} 없음</span>`;
  return `<fieldset><legend>${escapeText(label)}</legend>${items.map((item) => `<label><input type="checkbox" name="${name}" value="${escapeAttribute(item.id)}"> ${escapeText(item.name || item.id)}</label>`).join('')}</fieldset>`;
}

function openVerificationPanel() {
  const services = (topology.services || []).map((item) => `<li><b>${escapeText(item.name)}</b> · demand ${item.demandIds.length}개 · ${(item.requiredDeliveryRatio ?? 1) * 100}% <button type="button" data-delete-model="service" data-model-id="${item.id}">삭제</button></li>`).join('') || '<li>정의된 서비스 없음</li>';
  const domains = (topology.failureDomains || []).map((item) => `<li><b>${escapeText(item.name)}</b> · 자원 ${(item.deviceIds?.length || 0) + (item.linkIds?.length || 0)}개 <button type="button" data-delete-model="domain" data-model-id="${item.id}">삭제</button></li>`).join('') || '<li>정의된 장애 도메인 없음</li>';
  const racks = (current.racks || []).map((item) => `<li><b>${escapeText(item.name || item.id)}</b> · 전력 ${item.powerStatus || item.status || '미확인'} · U ${item.spaceStatus || item.status || '미확인'} <button type="button" data-delete-model="rack" data-model-id="${item.id}">삭제</button></li>`).join('') || '<li>정의된 랙 없음</li>';
  const scenarios = state.namedScenarios.map((item) => `<li><button type="button" data-load-scenario="${item.id}">${escapeText(item.name)}</button> <button type="button" data-delete-model="scenario" data-model-id="${item.id}">삭제</button></li>`).join('') || '<li>저장한 시나리오 없음</li>';
  openEditorPanel('서비스 생존성 검증 설정', `
    <p class="editor-hint">서비스 요구조건과 함께 장애 도메인, 랙 전력·U를 검증합니다. 비어 있는 근거는 통과로 처리하지 않습니다.</p>
    <div class="verification-columns">
      <section><h3>서비스</h3><ul>${services}</ul><form class="editor-form" data-editor-form="service"><label>이름<input name="name" required maxlength="80"></label><label>최소 전달률 (%)<input name="ratio" type="number" min="1" max="100" value="100"></label>${checkList('demandIds', topology.demands, '검증할 demand')}<button type="submit">서비스 추가</button><p class="editor-error"></p></form></section>
      <section><h3>장애 도메인</h3><ul>${domains}</ul><form class="editor-form" data-editor-form="failure-domain"><label>이름<input name="name" required maxlength="80"></label>${checkList('deviceIds', topology.devices, '함께 멈출 장비')}${checkList('linkIds', topology.links, '함께 멈출 링크')}<button type="submit">장애 도메인 추가</button><p class="editor-error"></p></form></section>
      <section><h3>랙</h3><ul>${racks}</ul><form class="editor-form" data-editor-form="rack"><label>이름<input name="name" required maxlength="80"></label><label>전력 예산 (W)<input name="power" type="number" min="1" required></label><label>공간 (U)<input name="units" type="number" min="1" required></label><label>전력 기준<select name="basis"><option value="nameplate">nameplate</option><option value="typical">typical</option><option value="measured">measured</option></select></label>${checkList('deviceIds', topology.devices, '랙 장비')}<button type="submit">랙 추가</button><p class="editor-error"></p></form></section>
      <section><h3>시나리오</h3><ul>${scenarios}</ul><form class="editor-form" data-editor-form="scenario"><label>이름<input name="name" required maxlength="80"></label><button type="submit">현재 장애·부하 저장</button><p class="editor-error"></p></form></section>
    </div>`);
}

function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportPng() {
  const svg = exportDiagramSvg(topology);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = Math.min(image.naturalWidth * 2, 12000); canvas.height = Math.min(image.naturalHeight * 2, 12000);
    const context = canvas.getContext('2d'); context.scale(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight); context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 인코딩에 실패했습니다.');
    const pngUrl = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = pngUrl; anchor.download = 'rack-mesh-diagram.png'; anchor.click(); setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
    showToast('설계 화면을 PNG로 내보냈습니다.');
  } finally { URL.revokeObjectURL(url); }
}

function saveProject() {
  downloadText('rack-mesh-project.json', serializeProject(topology, { ...state, baseline: baselineSnapshot }));
  documentHistory.markSaved();
  showToast('versioned 프로젝트 JSON을 저장했습니다.');
}

async function readFile(input) {
  const file = input.files?.[0];
  if (!file) return null;
  if (file.size > 2_000_000) throw new Error('JSON 파일은 2 MB 이하여야 합니다.');
  const text = await file.text(); input.value = ''; return text;
}

function handleEditorAction(action) {
  if (action === 'undo' || action === 'redo') { historyStep(action); return; }
  if (action === 'device') openDeviceForm();
  if (action === 'demand') openDemandManager();
  if (action === 'verification') openVerificationPanel();
  if (action === 'connect') { state.editorMode = state.editorMode === 'connect' ? 'select' : 'connect'; state.connectSource = null; closeEditorPanel(); renderTopology(); renderEditorMode(); }
  if (action === 'save') saveProject();
  if (action === 'open') element('project-file-input').click();
  if (action === 'import-device') element('device-file-input').click();
  if (action === 'import-drawio') element('drawio-file-input').click();
  if (action === 'export-svg') { downloadText('rack-mesh-diagram.svg', exportDiagramSvg(topology), 'image/svg+xml'); showToast('편집 가능한 설계를 SVG로 내보냈습니다.'); }
  if (action === 'export-png') exportPng().catch((error) => showToast(error.message));
  if (action === 'new') openTemplatePicker();
  if (action.startsWith('shape-')) {
    const kind = action.slice(6);
    const label = kind === 'text' ? '설명' : kind === 'ellipse' ? '영역' : '그룹';
    topology = addShape(topology, kind, { text: label, x: viewport.minX + 80, y: viewport.minY + 70, width: kind === 'text' ? 160 : 180, height: kind === 'text' ? 44 : 90 });
    const shape = topology.diagram.shapes.at(-1); state.selection = [{ type: 'shape', id: shape.id }];
    commitTopology(`${label} 도형을 추가했습니다.`);
  }
  if (action === 'group' && state.selection.length > 1) { topology = groupSelection(topology, state.selection, '설계 그룹'); commitTopology('선택한 요소를 그룹으로 묶었습니다.'); }
  if (action === 'ungroup') { topology = ungroupSelection(topology, state.selection); commitTopology('선택한 그룹을 해제했습니다.'); }
  if (action === 'align-left' && state.selection.length > 1) { topology = alignSelection(topology, state.selection, 'left'); commitTopology('선택한 요소를 왼쪽으로 정렬했습니다.'); }
  if (action === 'distribute-x' && state.selection.length > 2) { topology = distributeSelection(topology, state.selection, 'x'); commitTopology('선택한 요소를 가로로 분배했습니다.'); }
  if (action === 'annotation-connect') {
    const endpoints = state.selection.filter(({ type }) => type === 'device' || type === 'shape');
    if (endpoints.length !== 2) { showToast('주석 연결선에는 장비 또는 도형 두 개를 선택하세요.'); return; }
    topology = addConnector(topology, { source: endpoints[0].id, target: endpoints[1].id, kind: 'annotation' }); commitTopology('계산에서 제외되는 주석 연결선을 추가했습니다.');
  }
  if (action === 'map-device') {
    const selected = state.selection.length === 1 && state.selection[0].type === 'shape' ? state.selection[0] : null;
    const shape = selected && topology.diagram?.shapes?.find(({ id }) => id === selected.id);
    if (!shape) { showToast('장비 의미를 붙일 도형 하나를 선택하세요.'); return; }
    let deviceId = `device-${shape.id}`; let suffix = 2;
    while (topology.devices.some(({ id }) => id === deviceId)) deviceId = `device-${shape.id}-${suffix++}`;
    openDeviceForm({ name: shape.text || '가져온 장비', deviceId, zone: 'UNASSIGNED', position: { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }, mapShapeId: shape.id });
  }
}

function toggleFailure(type, id) {
  const set = type === 'device' ? state.disabledDevices : type === 'link' ? state.disabledLinks : state.disabledDomains;
  set.has(id) ? set.delete(id) : set.add(id);
  showToast(`${id.toUpperCase()} ${set.has(id) ? '비활성화' : '복구'} · 경로 재계산 완료`);
  recalculate();
}

let toastUndo = null;

function showToast(message, undo = null) {
  const toast = element('toast');
  toastUndo = undo;
  toast.innerHTML = `<span>${escapeText(message)}</span>${undo ? '<button type="button" data-toast-undo>되돌리기</button>' : ''}`;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('visible'); toastUndo = null; }, undo ? 6000 : 2200);
}

function exportResult() {
  const payload = createExport(topology, current, baseline);
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'rack-mesh-scenario.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast('결과 JSON을 내보냈습니다.');
}

// 연결 드래그 중의 고무줄. 링크 레이어에 임시 선 하나를 둔다.
function drawLinkDraft(from, to) {
  let line = document.querySelector('.link-draft');
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'link-draft');
    element('link-layer').append(line);
  }
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
}

function endLinkDraft() {
  document.querySelector('.link-draft')?.remove();
  document.querySelectorAll('.mesh-node.linking, .mesh-node.link-target').forEach((node) => node.classList.remove('linking', 'link-target'));
  linkDraft = null;
}

// 오른쪽 버튼 메뉴. 항목은 이 도구가 실제로 하는 일만 담는다.
function contextItemsFor(resource, type) {
  const failed = type === 'device' ? state.disabledDevices.has(resource.id) : state.disabledLinks.has(resource.id);
  const items = [{ id: 'delete', label: '삭제', danger: true }];
  if (type === 'device') items.push({ id: 'duplicate', label: '복제' }, { id: 'connect', label: '여기서 링크 시작' });
  items.push({ id: 'fault', label: failed ? '장애 복구' : '장애 주입' });
  return items;
}

function openContextMenu(event, id, type) {
  const resource = type === 'device' ? deviceById(id) : linkById(id);
  if (!resource) return;
  event.preventDefault();
  state.selectedId = id;
  contextTarget = { id, type };
  const menu = element('context-menu');
  menu.innerHTML = `<p class="context-title">${escapeText(resourceName(resource))}</p>${contextItemsFor(resource, type).map((item) =>
    `<button type="button" role="menuitem" data-context-action="${item.id}"${item.danger ? ' data-danger=""' : ''}>${escapeText(item.label)}</button>`).join('')}`;
  menu.hidden = false;
  // 메뉴가 화면 밖으로 나가지 않게 오른쪽·아래 경계에서 접는다.
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - box.width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - box.height - 8)}px`;
  menu.querySelector('[role="menuitem"]')?.focus();
  renderTopology(); renderInspector();
}

function closeContextMenu() {
  const menu = element('context-menu');
  if (menu.hidden) return;
  menu.hidden = true; menu.innerHTML = ''; contextTarget = null;
}

function runContextAction(action) {
  const target = contextTarget;
  closeContextMenu();
  if (!target) return;
  const { id, type } = target;
  const resource = type === 'device' ? deviceById(id) : linkById(id);
  if (!resource) return;
  const previous = structuredClone(topology);
  const undo = (message) => () => { topology = previous; state.selectedId = id; commitTopology(message); };
  try {
    if (action === 'fault') { toggleFailure(type, id); return; }
    if (action === 'connect') { state.editorMode = 'connect'; state.connectSource = id; renderTopology(); renderEditorMode(); showToast('연결할 두 번째 장비를 선택하세요.'); return; }
    if (action === 'delete') {
      const name = resourceName(resource);
      if (type === 'device') removeDevice(topology, id); else removeLink(topology, id);
      state.disabledDevices.delete(id); state.disabledLinks.delete(id);
      state.selectedId = topology.devices[0]?.id || null;
      commitTopology(`${name}을 지웠습니다.`, undo('삭제를 되돌렸습니다.'));
      return;
    }
    if (action === 'duplicate') {
      const copy = addDevice(topology, {
        id: normalizeId(`${resource.name || resource.id} copy`), name: `${resource.name} 복제`, kind: resource.kind, zone: resource.zone,
        position: { x: resource.position.x + 150, y: resource.position.y + 60 },
        limits: { ...resource.limits }, vendor: resource.vendor, model: resource.model,
        ...(resource.behavior ? { behavior: resource.behavior } : {}),
      });
      if (resource.spec) applySpec(topology, copy.id, { ...resource.spec, source: resource.source, vendor: resource.vendor, model: resource.model });
      state.selectedId = copy.id;
      commitTopology(`${copy.name}을 만들었습니다.`, undo('복제를 되돌렸습니다.'));
    }
  } catch (error) { showToast(error.message); }
}

function selectElement(type, id, additive = false) {
  const group = type === 'shape' ? topology.diagram?.groups?.find(({ memberIds }) => memberIds.includes(id)) : null;
  const entry = group && !additive ? { type: 'group', id: group.id } : { type, id };
  if (additive) {
    const exists = state.selection.some((item) => item.type === type && item.id === id);
    state.selection = exists ? state.selection.filter((item) => item.type !== type || item.id !== id) : [...state.selection, entry];
  } else state.selection = [entry];
  if (type === 'device' || type === 'link') state.selectedId = id;
}

function handleNodeSelection(id, additive = false) {
  if (state.editorMode === 'connect') {
    if (!state.connectSource) { state.connectSource = id; renderTopology(); renderEditorMode(); showToast('연결할 두 번째 장비를 선택하세요.'); return; }
    if (state.connectSource === id) { state.connectSource = null; renderTopology(); renderEditorMode(); return; }
    try {
      const link = addLink(topology, { source: state.connectSource, target: id }); state.selectedId = link.id; state.connectSource = null; state.editorMode = 'select'; commitTopology(`링크 ${link.id}를 연결했습니다.`);
    } catch (error) { showToast(error.message); state.connectSource = null; renderTopology(); renderEditorMode(); }
    return;
  }
  selectElement('device', id, additive); renderTopology(); renderInspector();
}

element('scale-input').addEventListener('input', (event) => { state.scale = Number(event.target.value) / 100; recalculate(); });
element('failure-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-failure-id]');
  if (button) toggleFailure(button.dataset.failureType, button.dataset.failureId);
});
element('class-control').addEventListener('click', (event) => {
  const value = event.target.closest('[data-class-badge]')?.dataset.classBadge;
  if (!value) return;
  classView.badge = value;
  try { localStorage.setItem('rack-mesh-class-badge', value); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
  render();
});
document.querySelector('.mobile-fault-tray').addEventListener('click', (event) => {
  const button = event.target.closest('[data-quick-failure]');
  if (button) toggleFailure('device', button.dataset.quickFailure);
});
element('node-layer').addEventListener('click', (event) => {
  const button = event.target.closest('[data-device-id]');
  if (button && !suppressNodeClick) handleNodeSelection(button.dataset.deviceId, event.shiftKey || event.metaKey || event.ctrlKey);
});
element('node-layer').addEventListener('pointerdown', (event) => {
  if (state.editorMode !== 'select') return;
  const button = event.target.closest('[data-device-id]'); if (!button) return;
  // 핸들에서 시작한 드래그는 이동이 아니라 연결이다. drawio 와 같은 손놀림이다.
  if (event.target.closest('[data-port]')) {
    event.preventDefault();
    const device = topology.devices.find(({ id }) => id === button.dataset.deviceId);
    linkDraft = { sourceId: device.id, pointerId: event.pointerId, origin: { ...device.position }, target: null };
    button.classList.add('linking');
    button.setPointerCapture(event.pointerId);
    return;
  }
  const device = topology.devices.find(({ id }) => id === button.dataset.deviceId);
  if (!state.selection.some((item) => item.type === 'device' && item.id === device.id)) selectElement('device', device.id);
  dragState = { id: device.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { ...device.position }, initial: structuredClone(topology), selection: structuredClone(state.selection), button };
  button.setPointerCapture(event.pointerId); button.classList.add('dragging');
});
element('node-layer').addEventListener('pointermove', (event) => {
  if (linkDraft && linkDraft.pointerId === event.pointerId) {
    const point = canvasPoint(event);
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-device-id]');
    const targetId = over && over.dataset.deviceId !== linkDraft.sourceId ? over.dataset.deviceId : null;
    if (targetId !== linkDraft.target) {
      document.querySelectorAll('.mesh-node.link-target').forEach((node) => node.classList.remove('link-target'));
      if (targetId) document.querySelector(`[data-device-id="${CSS.escape(targetId)}"]`)?.classList.add('link-target');
      linkDraft.target = targetId;
    }
    const end = targetId ? topology.devices.find(({ id }) => id === targetId).position : point;
    drawLinkDraft(linkDraft.origin, end);
    return;
  }
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const position = { x: dragState.origin.x + (event.clientX - dragState.startX) / state.zoom, y: dragState.origin.y + (event.clientY - dragState.startY) / state.zoom };
  const moved = moveDevice(topology, dragState.id, position);
  dragState.button.style.left = `${moved.position.x - viewport.minX}px`; dragState.button.style.top = `${moved.position.y - viewport.minY}px`;
  suppressNodeClick = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) > 4;
});
element('node-layer').addEventListener('pointerup', (event) => {
  if (linkDraft && linkDraft.pointerId === event.pointerId) {
    const { sourceId, target } = linkDraft;
    endLinkDraft();
    if (target) {
      const previous = structuredClone(topology);
      try {
        const link = addLink(topology, { source: sourceId, target });
        state.selectedId = link.id;
        commitTopology(`${resourceName(link)} 링크를 연결했습니다.`, () => {
          topology = previous; state.selectedId = sourceId; commitTopology('링크 연결을 되돌렸습니다.');
        });
      } catch (error) { showToast(error.message); }
    }
    return;
  }
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  dragState.button.classList.remove('dragging'); const moved = suppressNodeClick; const finished = dragState; dragState = null;
  if (moved) {
    const device = topology.devices.find(({ id }) => id === finished.id);
    const dx = device.position.x - finished.origin.x; const dy = device.position.y - finished.origin.y;
    topology = moveSelection(finished.initial, finished.selection, dx, dy, { grid: 15 });
    commitTopology('선택한 요소의 위치를 저장했습니다.'); setTimeout(() => { suppressNodeClick = false; }, 0);
  }
});
element('diagram-layer').addEventListener('click', (event) => {
  const shape = event.target.closest('[data-shape-id]');
  if (!shape) return;
  selectElement('shape', shape.dataset.shapeId, event.shiftKey || event.metaKey || event.ctrlKey);
  renderTopology();
});
element('diagram-layer').addEventListener('dblclick', (event) => {
  const target = event.target.closest('[data-shape-id]'); if (!target) return;
  const shape = topology.diagram?.shapes?.find(({ id }) => id === target.dataset.shapeId); if (!shape) return;
  const text = window.prompt('도형 텍스트', shape.text || ''); if (text == null) return;
  topology = updateShape(topology, shape.id, { text }); commitTopology('도형 텍스트를 수정했습니다.');
});
element('diagram-layer').addEventListener('pointerdown', (event) => {
  const target = event.target.closest('[data-shape-id]'); if (!target || event.button !== 0) return;
  if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !state.selection.some((item) => item.type === 'shape' && item.id === target.dataset.shapeId)) selectElement('shape', target.dataset.shapeId);
  diagramDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initial: structuredClone(topology), selection: structuredClone(state.selection), target };
  target.setPointerCapture(event.pointerId); event.preventDefault();
});
element('diagram-layer').addEventListener('pointermove', (event) => {
  if (!diagramDrag || diagramDrag.pointerId !== event.pointerId) return;
  const dx = (event.clientX - diagramDrag.startX) / state.zoom; const dy = (event.clientY - diagramDrag.startY) / state.zoom;
  diagramDrag.target.style.transform = `translate(${dx}px, ${dy}px)`;
});
element('diagram-layer').addEventListener('pointerup', (event) => {
  if (!diagramDrag || diagramDrag.pointerId !== event.pointerId) return;
  const drag = diagramDrag; diagramDrag = null;
  const dx = (event.clientX - drag.startX) / state.zoom; const dy = (event.clientY - drag.startY) / state.zoom;
  if (Math.hypot(dx, dy) < 3) { drag.target.style.transform = ''; return; }
  topology = moveSelection(drag.initial, drag.selection, dx, dy, { grid: 15 });
  commitTopology('선택한 도형을 이동했습니다.');
});
element('link-layer').addEventListener('click', (event) => {
  const group = event.target.closest('[data-link-id]');
  if (group) { selectElement('link', group.dataset.linkId, event.shiftKey || event.metaKey || event.ctrlKey); renderTopology(); renderInspector(); }
});
element('node-layer').addEventListener('contextmenu', (event) => {
  const button = event.target.closest('[data-device-id]');
  if (button) openContextMenu(event, button.dataset.deviceId, 'device');
});
element('link-layer').addEventListener('contextmenu', (event) => {
  const group = event.target.closest('[data-link-id]');
  if (group) openContextMenu(event, group.dataset.linkId, 'link');
});
element('context-menu').addEventListener('click', (event) => {
  const action = event.target.closest('[data-context-action]')?.dataset.contextAction;
  if (action) runContextAction(action);
});
element('context-menu').addEventListener('keydown', (event) => {
  const items = [...element('context-menu').querySelectorAll('[role="menuitem"]')];
  const index = items.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  }
  if (event.key === 'Escape') { closeContextMenu(); document.querySelector(`[data-device-id="${CSS.escape(state.selectedId || '')}"]`)?.focus(); }
});
document.addEventListener('pointerdown', (event) => {
  if (!element('context-menu').hidden && !event.target.closest('#context-menu')) closeContextMenu();
}, true);
document.querySelector('.topology-scroll').addEventListener('scroll', closeContextMenu);
element('link-layer').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
element('capture-baseline-button').addEventListener('click', captureBaseline);
element('reset-button').addEventListener('click', () => { state.disabledDevices.clear(); state.disabledLinks.clear(); state.disabledDomains.clear(); state.scale = 1; element('scale-input').value = '100'; showToast('장애와 배율을 초기화했습니다.'); recalculate(); });
element('export-button').addEventListener('click', exportResult);
document.querySelector('.editor-tools').addEventListener('click', (event) => { const button = event.target.closest('[data-editor-action]'); if (button) handleEditorAction(button.dataset.editorAction); });
element('editor-close').addEventListener('click', closeEditorPanel);
element('editor-panel-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.editorForm === 'device') {
      const template = form._deviceTemplate || {};
      const device = addDevice(topology, { id: template.deviceId, name: data.get('name'), kind: data.get('kind'), zone: data.get('zone'), position: template.position || nextDevicePosition(), limits: { ...(template.limits || {}), forwarding_bps: data.get('forwarding_bps') || template.limits?.forwarding_bps || null, forwarding_pps: data.get('forwarding_pps') || template.limits?.forwarding_pps || null }, source: template.source, metadata: template.metadata, vendor: template.vendor, model: template.model });
      if (template.mapShapeId && topology.diagram) {
        topology.diagram.connectors = topology.diagram.connectors.map((connector) => ({ ...connector,
          source: connector.source === template.mapShapeId ? device.id : connector.source,
          target: connector.target === template.mapShapeId ? device.id : connector.target }));
        topology.diagram.shapes = topology.diagram.shapes.filter(({ id }) => id !== template.mapShapeId);
        topology.diagram.groups = topology.diagram.groups.map((group) => ({ ...group, memberIds: group.memberIds.map((id) => id === template.mapShapeId ? device.id : id) }));
      }
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
    if (form.dataset.editorForm === 'service') {
      const demandIds = data.getAll('demandIds'); if (!demandIds.length) throw new Error('서비스에는 demand가 하나 이상 필요합니다.');
      const id = normalizeId(data.get('name')); if ((topology.services || []).some((item) => item.id === id)) throw new Error('같은 이름의 서비스가 있습니다.');
      topology.services = [...(topology.services || []), { id, name: String(data.get('name')), demandIds, requiredDeliveryRatio: Number(data.get('ratio')) / 100 }];
      commitTopology('서비스 생존성 요구조건을 추가했습니다.'); openVerificationPanel();
    }
    if (form.dataset.editorForm === 'failure-domain') {
      const deviceIds = data.getAll('deviceIds'); const linkIds = data.getAll('linkIds'); if (!deviceIds.length && !linkIds.length) throw new Error('장애 도메인에는 자원이 하나 이상 필요합니다.');
      const id = normalizeId(data.get('name')); if ((topology.failureDomains || []).some((item) => item.id === id)) throw new Error('같은 이름의 장애 도메인이 있습니다.');
      topology.failureDomains = [...(topology.failureDomains || []), { id, name: String(data.get('name')), deviceIds, linkIds }];
      commitTopology('장애 도메인을 추가했습니다.'); openVerificationPanel();
    }
    if (form.dataset.editorForm === 'rack') {
      const deviceIds = data.getAll('deviceIds'); if (!deviceIds.length) throw new Error('랙에는 장비가 하나 이상 필요합니다.');
      const id = normalizeId(data.get('name')); if ((topology.racks || []).some((item) => item.id === id)) throw new Error('같은 이름의 랙이 있습니다.');
      topology.racks = [...(topology.racks || []), { id, name: String(data.get('name')), deviceIds, powerBudgetWatts: Number(data.get('power')), capacityU: Number(data.get('units')), powerBasis: String(data.get('basis')) }];
      commitTopology('랙 전력·U 검증 범위를 추가했습니다.'); openVerificationPanel();
    }
    if (form.dataset.editorForm === 'scenario') {
      const id = normalizeId(data.get('name')); if (state.namedScenarios.some((item) => item.id === id)) throw new Error('같은 이름의 시나리오가 있습니다.');
      state.namedScenarios.push({ id, name: String(data.get('name')), scenario: scenarioOptions(true) });
      recalculate(); showToast('현재 장애·부하 시나리오를 저장했습니다.'); openVerificationPanel();
    }
  } catch (error) { formError(form, error.message); }
});
element('editor-panel-content').addEventListener('input', (event) => {
  if (event.target.id === 'template-search') filterTemplates(event.target.value);
});
element('editor-panel-content').addEventListener('click', (event) => {
  const template = event.target.closest('[data-template]');
  if (template) { applyTemplate(template.dataset.template); return; }
  if (event.target.closest('[data-new-demand]')) { openDemandForm(); return; }
  const modelDelete = event.target.closest('[data-delete-model]');
  if (modelDelete) {
    const key = ({ service: 'services', domain: 'failureDomains', rack: 'racks' })[modelDelete.dataset.deleteModel];
    if (modelDelete.dataset.deleteModel === 'scenario') state.namedScenarios = state.namedScenarios.filter(({ id }) => id !== modelDelete.dataset.modelId);
    else topology[key] = (topology[key] || []).filter(({ id }) => id !== modelDelete.dataset.modelId);
    state.disabledDomains.delete(modelDelete.dataset.modelId); commitTopology('검증 설정을 삭제했습니다.'); openVerificationPanel(); return;
  }
  const loadScenario = event.target.closest('[data-load-scenario]');
  if (loadScenario) {
    const saved = state.namedScenarios.find(({ id }) => id === loadScenario.dataset.loadScenario)?.scenario; if (!saved) return;
    state.scale = saved.scale; state.disabledDevices = new Set(saved.disabledDevices); state.disabledLinks = new Set(saved.disabledLinks); state.disabledDomains = new Set(saved.disabledDomains || []);
    element('scale-input').value = String(state.scale * 100); recalculate(); showToast('저장한 시나리오를 적용했습니다.'); openVerificationPanel(); return;
  }
  const condition = event.target.closest('[data-import-condition]');
  if (condition && pendingDeviceImport) {
    try {
      const template = importDeviceDefinition(pendingDeviceImport, { conditionId: condition.dataset.importCondition });
      pendingDeviceImport = null; openDeviceForm(template); element('editor-panel-content').querySelector('form')._deviceTemplate = template;
    } catch (error) { showToast(error.message); }
    return;
  }
  const button = event.target.closest('[data-delete-demand]'); if (!button) return;
  const demand = topology.demands.find(({ id }) => id === button.dataset.deleteDemand);
  if (!window.confirm(`${demand?.name || button.dataset.deleteDemand} demand와 해당 부하 정의를 삭제합니다. 계속하시겠습니까?`)) return;
  try { removeDemand(topology, button.dataset.deleteDemand); commitTopology('Traffic demand를 삭제했습니다.'); openDemandManager(); } catch (error) { showToast(error.message); }
});
element('inspector-content').addEventListener('change', (event) => {
  const spec = event.target.dataset.specField;
  if (spec) {
    try {
      const id = state.selectedId;
      if (spec === 'catalog' && !event.target.value) {
        applySpec(topology, id, null);
        commitTopology('데이터시트 값을 떼고 직접 입력으로 돌렸습니다.');
        return;
      }
      const device = deviceById(id);
      const entryId = spec === 'catalog' ? event.target.value : device.spec.catalogId;
      const entry = catalogEntry(entryId);
      const profile = catalogProfile(entryId, spec === 'profile' ? event.target.value : device.spec?.profileId);
      applySpec(topology, id, { ...buildSpec(entry, profile), conditionSelection: 'explicit-profile', vendor: entry.vendor, model: entry.model });
      commitTopology(`${entry.vendor} ${entry.model} · ${profile.label} 값을 적용했습니다.`);
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.name !== 'behavior-mode') return;
  try {
    const device = updateDevice(topology, state.selectedId, { behavior: { ...deviceById(state.selectedId)?.behavior, mode: event.target.value } });
    commitTopology(`${device.name}을 ${behaviorCatalog[device.kind].options[event.target.value].label}로 바꿨습니다.`);
  } catch (error) { showToast(error.message); }
});
element('inspector-content').addEventListener('click', (event) => {
  const axis = event.target.closest('[data-reset-axis]')?.dataset.resetAxis;
  if (!axis) return;
  try {
    setLimitOverride(topology, state.selectedId, axis, null);
    commitTopology(`${axisCatalog[axis]?.label || axis}을 데이터시트 값으로 되돌렸습니다.`);
  } catch (error) { showToast(error.message); }
});
element('inspector-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.resourceForm === 'device') {
      const id = form.dataset.resourceId;
      const limits = Object.fromEntries([...data.entries()].filter(([key]) => axisCatalog[key]));
      const device = topology.devices.find((item) => item.id === id);
      updateDevice(topology, id, { name: data.get('name'), zone: data.get('zone'), vendor: data.get('vendor'), model: data.get('model'), ...(device?.spec ? {} : { limits }) });
      // 데이터시트를 붙인 장비에서는 한계값 입력이 보정이다. 원본과 같은 값은 보정으로 남기지 않는다.
      if (device?.spec) {
        for (const [axis, raw] of Object.entries(limits)) {
          const value = raw === '' ? null : Number(raw);
          setLimitOverride(topology, id, axis, value !== null && value === device.spec.limits[axis] ? null : value);
        }
      }
    }
    else updateLink(topology, form.dataset.resourceId, { capacityBps: data.get('capacityBps') });
    commitTopology('한계값을 적용했습니다.');
  } catch (error) { formError(form, error.message); }
});
element('inspector-content').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-resource]'); if (!button) return;
  const resource = resourceById(state.selectedId);
  const dependentLinks = button.dataset.deleteResource === 'device' ? topology.links.filter((link) => link.source === state.selectedId || link.target === state.selectedId).length : 0;
  const message = button.dataset.deleteResource === 'device'
    ? `${resource?.name || state.selectedId} 장비와 연결 링크 ${dependentLinks}개를 삭제합니다. 관련 demand는 남겨 단절 상태로 표시합니다. 계속하시겠습니까?`
    : `${state.selectedId} 링크를 삭제합니다. 관련 demand는 남겨 단절 또는 경로 오류로 표시합니다. 계속하시겠습니까?`;
  if (!window.confirm(message)) return;
  try { if (button.dataset.deleteResource === 'device') removeDevice(topology, state.selectedId); else removeLink(topology, state.selectedId); state.selectedId = topology.devices[0]?.id || null; commitTopology('선택한 자원을 삭제했습니다.'); } catch (error) { showToast(error.message); }
});
element('project-file-input').addEventListener('change', async (event) => {
  try {
    const text = await readFile(event.target); if (!text) return; const project = parseProject(text);
    const incoming = `${project.topology.devices.length}개 장비, ${project.topology.links.length}개 링크, ${project.topology.demands.length}개 demand`;
    const currentImpact = `${topology.devices.length}개 장비, ${topology.links.length}개 링크, ${topology.demands.length}개 demand`;
    if (!window.confirm(`${incoming}를 포함한 프로젝트를 엽니다. 현재 설계의 ${currentImpact}는 교체됩니다. 계속하시겠습니까?`)) return;
    topology = project.topology; state.scale = project.scenario.scale; state.disabledDevices = new Set(project.scenario.disabledDevices); state.disabledLinks = new Set(project.scenario.disabledLinks); state.disabledDomains = new Set(project.scenario.disabledDomains || []); state.namedScenarios = project.scenario.namedScenarios || []; state.selectedId = project.scenario.selectedId;
    state.selection = state.selectedId ? [{ type: topology.links.some(({ id }) => id === state.selectedId) ? 'link' : 'device', id: state.selectedId }] : [];
    baselineSnapshot = project.scenario.baseline || { topology: structuredClone(topology), scenario: scenarioOptions(true) };
    baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario); documentHistory.reset(topology);
    element('scale-input').value = String(state.scale * 100); closeEditorPanel(); recalculate(); showToast(project.notices?.[0]?.message || '프로젝트와 기준선 근거를 검증하고 복원했습니다.');
  } catch (error) { showToast(`열기 실패: ${error.message}`); }
});
element('device-file-input').addEventListener('change', async (event) => {
  let text;
  try { text = await readFile(event.target); if (!text) return; const template = importDeviceDefinition(text); openDeviceForm(template); const form = element('editor-panel-content').querySelector('form'); form._deviceTemplate = template; showToast(`${template.schema} 장비 정의를 읽었습니다.`); }
  catch (error) {
    if (/Ambiguous conditions/.test(error.message)) {
      try {
        pendingDeviceImport = JSON.parse(text);
        const ids = [...new Set((pendingDeviceImport.performance_profile?.limits || []).map(({ condition_id: id }) => id).filter(Boolean))];
        openEditorPanel('측정 조건 선택', `<p class="editor-hint">같은 축에 조건이 다른 값이 있습니다. 계산에 적용할 측정 조건을 선택하세요.</p><div class="form-actions">${ids.map((id) => `<button type="button" data-import-condition="${escapeAttribute(id)}">${escapeText(id)}</button>`).join('')}</div>`);
        return;
      } catch { pendingDeviceImport = null; }
    }
    showToast(`가져오기 실패: ${error.message}`);
  }
});
element('drawio-file-input').addEventListener('change', async (event) => {
  try {
    const text = await readFile(event.target); if (!text) return;
    const imported = importDrawio(text);
    topology = { ...topology, diagram: imported };
    state.selection = imported.shapes.map(({ id }) => ({ type: 'shape', id }));
    commitTopology(`drawio에서 도형 ${imported.shapes.length}개와 연결선 ${imported.connectors.length}개를 가져왔습니다. 계산 의미는 장비에 별도로 지정하세요.`);
  } catch (error) { showToast(`drawio 가져오기 실패: ${error.message}`); }
});
const topologyScroll = document.querySelector('.topology-scroll');
topologyScroll.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch') return;
  const onResource = event.target.closest('.mesh-node, .link-hit, .diagram-shape');
  const middleButton = event.button === 1;
  if (!onResource && event.button === 0 && event.shiftKey && state.editorMode === 'select') {
    const start = canvasPoint(event); selectionBoxState = { pointerId: event.pointerId, start, end: start };
    topologyScroll.setPointerCapture(event.pointerId); element('selection-marquee').hidden = false; event.preventDefault(); return;
  }
  if (!middleButton && (event.button !== 0 || onResource || state.editorMode === 'connect')) return;
  panState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: topologyScroll.scrollLeft, top: topologyScroll.scrollTop };
  topologyScroll.setPointerCapture(event.pointerId);
  topologyScroll.classList.add('panning');
  event.preventDefault();
});
topologyScroll.addEventListener('pointermove', (event) => {
  if (selectionBoxState && event.pointerId === selectionBoxState.pointerId) {
    selectionBoxState.end = canvasPoint(event);
    const left = Math.min(selectionBoxState.start.x, selectionBoxState.end.x) - viewport.minX;
    const top = Math.min(selectionBoxState.start.y, selectionBoxState.end.y) - viewport.minY;
    Object.assign(element('selection-marquee').style, { left: `${left}px`, top: `${top}px`, width: `${Math.abs(selectionBoxState.end.x - selectionBoxState.start.x)}px`, height: `${Math.abs(selectionBoxState.end.y - selectionBoxState.start.y)}px` });
    return;
  }
  if (!panState || event.pointerId !== panState.pointerId) return;
  topologyScroll.scrollLeft = panState.left - (event.clientX - panState.startX);
  topologyScroll.scrollTop = panState.top - (event.clientY - panState.startY);
});
topologyScroll.addEventListener('pointerup', (event) => {
  if (selectionBoxState && event.pointerId === selectionBoxState.pointerId) {
    const box = { left: Math.min(selectionBoxState.start.x, selectionBoxState.end.x), right: Math.max(selectionBoxState.start.x, selectionBoxState.end.x), top: Math.min(selectionBoxState.start.y, selectionBoxState.end.y), bottom: Math.max(selectionBoxState.start.y, selectionBoxState.end.y) };
    state.selection = [
      ...topology.devices.filter(({ position }) => position.x >= box.left && position.x <= box.right && position.y >= box.top && position.y <= box.bottom).map(({ id }) => ({ type: 'device', id })),
      ...(topology.diagram?.shapes || []).filter((shape) => shape.x < box.right && shape.x + shape.width > box.left && shape.y < box.bottom && shape.y + shape.height > box.top).map(({ id }) => ({ type: 'shape', id })),
    ];
    selectionBoxState = null; element('selection-marquee').hidden = true; renderTopology(); return;
  }
  endPan();
});
topologyScroll.addEventListener('pointercancel', () => { selectionBoxState = null; element('selection-marquee').hidden = true; endPan(); });
topologyScroll.addEventListener('lostpointercapture', () => { if (!selectionBoxState) endPan(); });

element('toast').addEventListener('click', (event) => {
  if (!event.target.closest('[data-toast-undo]')) return;
  const undo = toastUndo;
  toastUndo = null;
  element('toast').classList.remove('visible');
  undo?.();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    const node = document.activeElement?.closest?.('[data-device-id]'); const link = document.activeElement?.closest?.('[data-link-id]');
    if (node || link) {
      event.preventDefault(); const box = (node || link).getBoundingClientRect();
      openContextMenu({ preventDefault() {}, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }, node?.dataset.deviceId || link.dataset.linkId, node ? 'device' : 'link');
      return;
    }
  }
  if (event.key === 'Escape' && !element('editor-panel').hidden) closeEditorPanel();
  if (event.target.closest('input, select, textarea')) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); historyStep(event.shiftKey ? 'redo' : 'undo'); }
  if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); historyStep('redo'); }
  if (command && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
  if (command && event.key.toLowerCase() === 'c' && state.selection.length) { event.preventDefault(); clipboard = copySelection(topology, state.selection); showToast(`${state.selection.length}개 요소를 복사했습니다.`); }
  if (command && event.key.toLowerCase() === 'v' && clipboard) {
    event.preventDefault(); const pasted = pasteSelection(topology, clipboard); topology = pasted.topology; state.selection = pasted.selection;
    state.selectedId = pasted.selection.find(({ type }) => type === 'device')?.id || state.selectedId; commitTopology('복사한 요소를 붙여넣었습니다.');
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection.length) {
    event.preventDefault();
    topology = removeDiagramElements(topology, state.selection);
    for (const item of state.selection) {
      if (item.type === 'link' && topology.links.some(({ id }) => id === item.id)) removeLink(topology, item.id);
      if (item.type === 'device' && topology.devices.some(({ id }) => id === item.id)) removeDevice(topology, item.id);
    }
    state.selection = []; state.selectedId = topology.devices[0]?.id || null; commitTopology('선택한 요소를 삭제했습니다.');
  }
});
document.addEventListener('pointerdown', (event) => {
  if (element('editor-panel').hidden) return;
  if (event.target.closest('#editor-panel') || event.target.closest('[data-editor-action]')) return;
  closeEditorPanel();
});

document.querySelector('.zoom-control').addEventListener('click', (event) => {
  const action = event.target.closest('[data-zoom]')?.dataset.zoom;
  if (action === 'in') stepZoom(1);
  if (action === 'out') stepZoom(-1);
  if (action === 'reset') setZoom(1);
  if (action === 'fit') zoomToFit();
});
element('learning-panel').addEventListener('click', (event) => {
  const button = event.target.closest('[data-lesson-action]'); if (!button) return;
  if (button.dataset.lessonAction === 'fault-device') { state.disabledDevices.add(button.dataset.lessonId); setLeftPanel('failure'); recalculate(); }
  if (button.dataset.lessonAction === 'scale') { state.scale = Number(button.dataset.lessonValue); element('scale-input').value = String(state.scale * 100); recalculate(); }
});
// 트랙패드 핀치와 Ctrl+휠은 같은 이벤트로 온다. 포인터 자리를 기준으로 확대한다.
document.querySelector('.topology-scroll').addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = document.querySelector('.topology-scroll').getBoundingClientRect();
  // deltaMode 는 장치마다 다르다. 줄 단위로 오는 휠을 픽셀로 맞춘 뒤 배율에 반영한다.
  const delta = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_HEIGHT : event.deltaY;
  setZoom(state.zoom * Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY), { x: event.clientX - rect.left, y: event.clientY - rect.top });
}, { passive: false });
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
  // 기본 동작을 막지 않으면 브라우저가 심볼을 네이티브 드래그로 집어가고, pointer 시퀀스가
  // 끊기면서 고스트가 화면에 남는다.
  event.preventDefault();
  item.setPointerCapture(event.pointerId);
  paletteDrag = { kind: item.dataset.paletteKind, pointerId: event.pointerId, item, startX: event.clientX, startY: event.clientY, ghost: null };
});
element('component-palette').addEventListener('pointermove', (event) => {
  if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
  if (!paletteDrag.ghost) {
    if (Math.hypot(event.clientX - paletteDrag.startX, event.clientY - paletteDrag.startY) <= PALETTE_DRAG_THRESHOLD) return;
    paletteDrag.ghost = document.createElement('div');
    paletteDrag.ghost.className = 'palette-ghost';
    paletteDrag.ghost.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#${symbolId(paletteDrag.kind)}"></use></svg>`;
    document.body.append(paletteDrag.ghost);
    paletteDrag.item.classList.add('dragging');
  }
  const point = canvasPoint(event);
  paletteDrag.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
  document.querySelector('.topology-scroll').classList.toggle('drop-target', point.inside);
});
element('component-palette').addEventListener('pointerup', (event) => {
  if (!paletteDrag || event.pointerId !== paletteDrag.pointerId) return;
  const point = canvasPoint(event);
  const drag = endPaletteDrag();
  if (!drag.ghost) { createDeviceFromPalette(drag.kind, nextDevicePosition()); return; }
  if (!point.inside) { showToast('토폴로지 영역에 놓아야 장비가 생성됩니다.'); return; }
  createDeviceFromPalette(drag.kind, point);
});
element('component-palette').addEventListener('pointercancel', endPaletteDrag);
element('component-palette').addEventListener('dragstart', (event) => event.preventDefault());
document.addEventListener('pointercancel', endPaletteDrag);
document.addEventListener('lostpointercapture', () => { if (paletteDrag) endPaletteDrag(); });

reducedMotion.addEventListener('change', startTelemetry);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTelemetry(); });

element('icon-sprite').innerHTML = ICON_SPRITE + GLYPH_SPRITE;
element('topology-stage').style.setProperty('--zoom', String(state.zoom));
try {
  const saved = localStorage.getItem('rack-mesh-working-copy');
  if (saved) {
    const project = parseProject(saved);
    topology = project.topology; state.scale = project.scenario.scale;
    state.disabledDevices = new Set(project.scenario.disabledDevices); state.disabledLinks = new Set(project.scenario.disabledLinks); state.disabledDomains = new Set(project.scenario.disabledDomains || []); state.namedScenarios = project.scenario.namedScenarios || [];
    state.selectedId = project.scenario.selectedId; state.viewMode = project.scenario.viewMode || 'edit';
    state.selection = state.selectedId ? [{ type: topology.links.some(({ id }) => id === state.selectedId) ? 'link' : 'device', id: state.selectedId }] : [];
    baselineSnapshot = project.scenario.baseline || { topology: structuredClone(topology), scenario: scenarioOptions(true) };
    baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario); current = calculateScenario(topology, scenarioOptions()); sweep = sweepSingleFaults(topology, { scale: state.scale });
    documentHistory.reset(topology); element('scale-input').value = String(state.scale * 100);
  }
} catch { try { localStorage.removeItem('rack-mesh-working-copy'); } catch { /* 저장소 접근 자체가 막힌 환경 */ } }
renderPalette();
setLeftPanel(state.leftPanel);
render();
centerCanvas();
startTelemetry();
