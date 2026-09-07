import { axisCatalog, behaviorCatalog, cloneTopology } from './data.js';
import { calculateScenario, compareScenarios, createExport, ENGINE_VERSION, sweepSingleFaults } from './engine.js';
import { acceptEvidence, addDemand, addDevice, addLink, applySpec, clearEvidenceAcceptance, moveDevice, normalizeId, removeDemand, removeDevice, removeLink, setLimitOverride, setWorkloadConditions, updateDemand, updateDevice, updateLink } from './editor.js';
import { importDeviceDefinition } from './device-import.js';
import { parseProject, serializeProject } from './project.js';
import { GLYPHS, GLYPH_SPRITE } from './glyphs.js';
import { behaviorToken, formatNodeValue, groupBoxes, GROUP_PAD, kindInitial, nodeAxes, nodeAxisLabel, NODE_REACH, nodeView, STATE_TOKEN, symbolFor, zonePath } from './node-view.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS, ICON_SPRITE } from './icons.js';
import { vendorLogoFor } from './logos.js';
import { buildTemplate, templateGroups, templates } from './templates.js';
import { buildSpec, catalogEntry, catalogFor, catalogProfile } from './devices/catalog.js';
import { addConnector, addShape, alignSelection, copySelection, distributeSelection, exportDiagramSvg, groupSelection, importDrawio, moveSelection, pasteSelection, removeDiagramElements, ungroupSelection, updateShape } from './diagram.js';
import { createHistory } from './history.js';
import { acceptanceDigest, evidenceApplicability } from './evidence.js';

let topology = cloneTopology();
const state = { scale: 1, selectedId: 'fw-a', selection: [{ type: 'device', id: 'fw-a' }], disabledDevices: new Set(), disabledLinks: new Set(), disabledDomains: new Set(), namedScenarios: [], editorMode: 'select', connectSource: null, leftPanel: 'palette', zoom: 1, viewMode: 'edit' };
let baselineSnapshot = { topology: structuredClone(topology), scenario: { scale: 1, disabledDevices: [], disabledLinks: [], disabledDomains: [] } };
let baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario);
let current = baseline;
let sweep = sweepSingleFaults(topology);
// 훑기가 어느 배율에서 나온 값인지. 슬라이더를 끄는 동안 예보가 뒤처지면 화면이 그렇게 말한다.
let sweepScale = 1;
// 훑기가 지금 배율에서 나온 값인지. 슬라이더를 끄는 동안은 뒤처지므로, 그 값을 읽는
// 화면은 판정을 지금 판정처럼 말하지 않는다.
const sweepStale = () => Math.abs(sweepScale - state.scale) > 1e-9;
let documentHistory = createHistory(topology);
let clipboard = null;
let persistenceWarningShown = false;
let toastTimer;
let dragState = null;
let diagramDrag = null;
let suppressNodeClick = false;
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

// light 는 배율 슬라이더를 끄는 동안만 쓴다. 자원 하나씩 끄는 훑기와 자동 저장을 건너뛰므로
// 장애 예보가 한 배율 뒤처진다. 그 사실을 화면에 표시하고, 슬라이더에서 손을 떼면 전체 경로가 돈다.
function recalculate({ light = false } = {}) {
  current = calculateScenario(topology, { scale: state.scale, disabledDevices: state.disabledDevices, disabledLinks: state.disabledLinks, disabledDomains: state.disabledDomains });
  if (!light) { sweep = sweepSingleFaults(topology, { scale: state.scale }); sweepScale = state.scale; }
  render();
  updateTelemetry();
  if (!light) persistWorkingCopy();
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
const PARTICLES = { subject: ['이', '가'], object: ['을', '를'], instrumental: ['으로', '로'] };
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
  // 뒤처진 훑기로 "단일 장애점이 없습니다"를 말하지 않는다. 배율이 바뀌면 뒤집히는 판정이다.
  if (sweepStale() || !sweep.resources.length) return '';
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
  detail.textContent = [
    `${formatCompact(axis.load, catalog.unit)} / ${formatCompact(axis.limit, catalog.unit)}${suffix}`,
    growthNote(),
  ].filter(Boolean).join(' · ');
}

// 이 설계가 몇 배까지 견디는지. 엔진이 축마다 한계를 넘는 배율을 이미 계산해 두었으므로
// 여기서는 사다리 첫 칸을 읽기만 한다. 예전에는 이 자리에서 시나리오를 최대 스무 번 다시
// 계산했다. 이미 초과한 설계에는 아무 말도 하지 않는다 — 다음 초과는 답이 아니다.
//
// 첫 칸을 "현재 배율보다 큰 것"으로 찾으면 안 된다. 사용률이 정확히 1 인 축은 엔진이
// 초과로 세지 않아(EPSILON 여유) 이 함수가 억제되지 않는데, 그 칸을 건너뛰면 여유가 0 인
// 설계를 몇 배 더 견딘다고 말하게 된다. 초과가 없는 구간에서는 첫 칸이 곧 답이다.
function growthNote() {
  if (current.summary.overloadedCount > 0) return '';
  const ladder = current.summary.growthLadder;
  if (ladder?.indeterminate) return '배율 0에서는 성장 한계를 계산할 수 없습니다';
  const next = ladder?.rungs[0];
  if (!next) return '';
  const unresolved = ladder.unresolved.length ? ` · 순서 미확정 ${ladder.unresolved.length}개` : '';
  if (next.breachScale <= current.scale * (1 + 1e-9)) return `지금 배율이 한계입니다${unresolved}`;
  // 같은 배율에서 함께 차는 자원이 있으면 하나만 지목하지 않는다.
  const tied = ladder.rungs.filter(({ breachScale }) => breachScale <= next.breachScale * (1 + 1e-9));
  const at = `${next.breachScale.toFixed(2)}배에서`;
  const named = new Set(tied.map(({ resourceId }) => resourceId));
  if (named.size > 1) return `${at} ${named.size}개 자원 동시 초과${unresolved}`;
  // 제목이 이미 그 자원을 말하고 있으면 이름을 되풀이하지 않는다.
  if (next.resourceId === current.summary.bindingResourceId) return `${at} 초과${unresolved}`;
  const axis = axisCatalog[next.axis]?.label || next.axis;
  const where = resourceName(resourceById(next.resourceId)) || next.resourceId;
  return `${at} ${where} ${axis} 초과${unresolved}`;
}

function renderClassControl() {
  const group = (label, attribute, current, choices) => `<div class="layout-axis" role="group" aria-label="${escapeAttribute(label)}">
      <span>${escapeText(label)}</span>
      ${choices.map(([value, text]) => `<button type="button" data-${attribute}="${value}" aria-pressed="${current === value}">${escapeText(text)}</button>`).join('')}
    </div>`;
  element('class-control').innerHTML = group('배지', 'class-badge', classView.badge, [['off', '끔'], ['on', '켬']])
    + group('흔들림', 'number-motion', motionView.drift, [['off', '끔'], ['on', '켬']]);
}

// 데이터시트를 붙였는데 대조할 워크로드 조건이 없으면 모든 축이 미확인이 된다. 그 상태는
// 도구가 고장 난 것처럼 읽히므로, 앱이 자기 상태를 설명하고 빠져나갈 길을 그 자리에 낸다.
function evidenceCliff() {
  const judgement = current.summary.evidenceJudgement;
  if (!judgement || !judgement.withRecords) return null;
  if (judgement.judged === judgement.withRecords) return null;
  const missing = judgement.withRecords - judgement.judged;
  const conditions = Object.keys(topology.workloadConditions || {}).length;
  return {
    text: conditions
      ? `데이터시트 값 ${missing}개가 아직 이 워크로드와 대조되지 않았습니다. 조건을 더 적거나, 축 하나씩 수락하면 계산에 들어갑니다.`
      : `데이터시트 값을 붙였지만 대조할 워크로드 조건이 없어 ${missing}개 축이 미확인입니다. 데이터시트 숫자는 특정 조건에서 잰 값이라, 우리 트래픽이 그 조건인지 말하기 전에는 이 설계에 쓸 수 있는지 알 수 없습니다.`,
    label: conditions ? '워크로드 조건 고치기' : '워크로드 조건 적기',
  };
}

// 질문 옆에 답을 함께 띄우면 실험할 이유가 없어진다. 눌러서 결과를 본 뒤에 편다.
let lessonRevealed = false;

function renderLearningPanel() {
  const panel = element('learning-panel');
  const cliff = evidenceCliff();
  if (cliff) {
    panel.hidden = false;
    panel.innerHTML = `<strong>다음에 할 일</strong>${escapeText(cliff.text)}
      <div><button type="button" data-lesson-action="workload">${escapeText(cliff.label)}</button></div>`;
    return;
  }
  const lesson = topology.template;
  if (!lesson?.teaches) { panel.hidden = true; panel.innerHTML = ''; return; }
  const experiment = lesson.experiment;
  panel.hidden = false;
  panel.innerHTML = `<strong>이 설계에서 확인할 것</strong>${escapeText(lesson.teaches)}
    ${experiment ? `<div><span>${escapeText(experiment.prompt)}</span><br><button type="button" data-lesson-action="${escapeAttribute(experiment.action.type)}" data-lesson-id="${escapeAttribute(experiment.action.id || '')}" data-lesson-value="${escapeAttribute(experiment.action.value ?? '')}">${escapeText(experiment.action.label)}</button><output${lessonRevealed ? '' : ' hidden'}>${escapeText(experiment.observe)}</output></div>` : ''}`;
}

// 헤더는 지금 열려 있는 설계를 말해야 한다. 시작 복원과 undo/redo 는 loadTopology 를 거치지
// 않으므로 불러오기가 아니라 렌더에서 갱신한다.
function renderScenarioCopy() {
  element('scenario-title').textContent = topology.template?.name || topology.name || '이름 없는 설계';
  element('scenario-subtitle').textContent = [
    topology.synthetic ? '합성 데모' : '사용자 설계',
    `장비 ${topology.devices.length} · 링크 ${topology.links.length}`,
    '정상 상태 계산',
  ].join(' · ');
  // 경로 몫은 경로 수로 1/N 이 아니라 홉마다의 갈래 수로 나눈다. 범례가 엔진과 같은 말을 해야 한다.
  element('calculation-note').textContent = `DETERMINISTIC · HOP-BRANCH WEIGHTED · ENGINE ${ENGINE_VERSION}`;
}

function render() {
  renderScenarioCopy();
  renderSummary();
  renderFailures();
  renderTopology();
  renderInspector();
  renderComparison();
  renderBottleneck();
  renderEditorMode();
  renderClassControl();
  renderLearningPanel();
  syncLiveNumbers();
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
  const stale = sweepStale() && sweep.resources.length > 0;
  element('failure-grade').textContent = sweep.resources.length
    ? `단일 장애점 ${sweep.severs}개 · 용량 부족 ${sweep.overloads}개 · 여유 ${sweep.absorbs}개${stale ? ` · ${sweepScale.toFixed(2)}배 기준` : ''}`
    : '끌 자원이 아직 없습니다.';
  element('failure-grade').dataset.grade = sweep.grade;
  element('failure-grade').toggleAttribute('data-stale', stale);
  // 등급 한 줄만 표시하면 자원별 예보는 옛 배율 값을 지금 값처럼 말한다. 목록 전체에 건다.
  element('failure-list').toggleAttribute('data-stale', stale);
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

// 심볼은 스텐실, 클래스는 meta 줄로 확정했다. 배지만 취향이 갈려 토글로 남긴다.
const classView = { badge: 'off' };
try {
  const saved = localStorage.getItem('rack-mesh-class-badge');
  if (saved === 'on' || saved === 'off') classView.badge = saved;
} catch { /* 저장된 선택이 없으면 기본값을 쓴다 */ }

// 숫자는 두 가지로 움직인다. 값이 실제로 바뀌었을 때 이전 값에서 새 값으로 잇는 것은 항상
// 한다 - 원인이 있는 움직임이라 계산을 배신하지 않고, 오히려 무엇 때문에 바뀌었는지 보인다.
// 미세한 흔들림은 지어낸 값이므로 기본이 꺼짐이고, 켜면 화면이 그렇다고 말한다.
const motionView = { drift: 'off' };
try {
  const saved = localStorage.getItem('rack-mesh-number-motion');
  if (saved === 'on' || saved === 'off') motionView.drift = saved;
} catch { /* 저장된 선택이 없으면 기본값을 쓴다 */ }

// 이니셜은 앞 세 글자를 자르면 SWI·ROU 가 되어 읽히지 않는다. 손으로 정한다.

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
// LB 뒤 백엔드는 엔진이 자동으로 한 풀로 묶는다. 화면에 보이지 않으면 사용자는 왜 부하가
// 나뉘었는지 알 길이 없으므로 멤버마다 몇 대 중 몇 %인지 노드에 적는다.
function backendPoolIndex(demands) {
  const index = new Map();
  for (const demand of demands) {
    const backends = demand.backends || [];
    for (const { id, share } of backends) {
      if (!index.has(id)) index.set(id, { size: 0, shares: [] });
      const entry = index.get(id);
      entry.size = Math.max(entry.size, backends.length);
      entry.shares.push(share);
    }
  }
  // 풀이 아닌 장비에까지 "풀 1대 · 100%" 를 붙이면 소음이다. 다만 풀에 든 장비라면 풀을 끈
  // demand 의 몫까지 세야 한다 — 그걸 빼면 42% 라고 적고 실제로는 71% 를 받는 일이 생긴다.
  for (const [id, entry] of index) if (entry.size < 2) index.delete(id);
  return index;
}

function poolNote(entry) {
  if (!entry) return '';
  const low = Math.round(Math.min(...entry.shares) * 100);
  const high = Math.round(Math.max(...entry.shares) * 100);
  return `풀 ${entry.size}대 · ${low === high ? `${high}%` : `${low}~${high}%`}`;
}

function nodeAccessibleName(device) {
  const head = [device.name, [device.vendor, device.model].filter(Boolean).join(' '), device.kind, device.zone,
    poolNote(backendPoolIndex(current.demands).get(device.id)), device.carriesDemand === false ? '트래픽 수요 없음' : ''].filter(Boolean).join(' \u00b7 ');
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
    <span class="palette-glyph"><svg aria-hidden="true" focusable="false"><use href="#${symbolFor(item.kind).id}"></use></svg></span><span class="palette-label">${escapeText(item.label)}</span><span class="palette-kind">${item.kind.toUpperCase()}</span>
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
let viewport = { minX: 0, minY: 0, width: CANVAS_MIN.width, height: CANVAS_MIN.height };


// zone 은 슬래시로 계층을 적는다. 'FABRIC / RACK 04' 는 FABRIC 안의 RACK 04 다.
// 계층을 쓰지 않은 설계는 한 층짜리 그룹이 되고, 그리는 방식은 같다.

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

/**
 * 캔버스가 화면보다 크면 centerCanvas 는 가운데가 아니라 왼쪽 위 모서리를 연다 - 남는 여백이
 * 음수라 0 으로 잘리기 때문이다. 그렇다고 전체를 맞추면 배율이 0.6 아래로 내려가 노드 글자가
 * 읽히지 않는다. 큰 설계는 다 보여 주는 것이 아니라 그 설계가 말하는 곳을 보여 줘야 한다.
 * 나머지는 사용자가 밀어서 본다. 화면에 들어가는 설계는 지금처럼 통째로 가운데에 온다.
 */
function focusCanvas(resourceId) {
  const scroll = document.querySelector('.topology-scroll');
  const device = resourceId && current.devices.find(({ id }) => id === resourceId);
  const fits = viewport.width * state.zoom <= scroll.clientWidth && viewport.height * state.zoom <= scroll.clientHeight;
  if (!device || fits) { centerCanvas(); return; }
  scroll.scrollLeft = STAGE_PAD + (device.position.x - viewport.minX) * state.zoom - scroll.clientWidth / 2;
  scroll.scrollTop = STAGE_PAD + (device.position.y - viewport.minY) * state.zoom - scroll.clientHeight / 2;
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
  // 상자는 링크 아래, 이름표는 링크 위. 셋을 한 덩어리로 그리면 선이 RACK 03 같은 이름을 갈라
  // 놓아 어느 랙인지 읽을 수 없다. 상자를 위로 올리면 이번엔 상자 안의 링크가 가려진다.
  const boxes = groupBoxes(current.devices);
  const groupMarkup = boxes.map((group) => `<g class="topology-group" data-depth="${group.depth}">
      <rect class="group-frame" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}"></rect>
    </g>`).join('');
  const groupLabels = boxes.map((group) => `<text class="group-label" x="${group.x + 11}" y="${group.y + 13}">${escapeText(group.label)}</text>`).join('');
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
  }).join('') + diagramConnectors + groupLabels;

  const selectionHas = (type, id) => state.selection.some((item) => item.type === type && item.id === id)
    || type === 'shape' && state.selection.some((item) => item.type === 'group'
      && topology.diagram?.groups?.find(({ id: groupId }) => groupId === item.id)?.memberIds.includes(id));
  element('diagram-layer').innerHTML = (topology.diagram?.shapes || []).map((shape) =>
    `<button type="button" class="diagram-shape${selectionHas('shape', shape.id) ? ' selected' : ''}" data-shape-id="${escapeAttribute(shape.id)}" data-kind="${escapeAttribute(shape.kind)}" style="left:${shape.x - viewport.minX}px;top:${shape.y - viewport.minY}px;width:${shape.width}px;height:${shape.height}px">${escapeText(shape.text || '')}</button>`).join('');

  const pools = backendPoolIndex(current.demands);
  element('node-layer').innerHTML = current.devices.map((device) => {
    const status = device.active ? device.primaryStatus : 'disabled';
    const pool = device.active ? poolNote(pools.get(device.id)) : '';
    const idle = device.active && !pool && !device.carriesDemand ? '트래픽 수요 없음' : '';
    const { rows, hidden } = nodeAxes(device);
    const verdict = sweep.resources.find(({ id }) => id === device.id);
    // 이미 죽은 장비에 "이게 죽으면 끊긴다"와 숨긴 축 개수를 붙이는 것은 소음이다.
    const spof = device.active && !sweepStale() && verdict?.verdict === 'severs' && !verdict.endpoint;
    const meta = [device.kind.toUpperCase(), behaviorToken(device), zonePath(device.zone).at(-1) || device.zone,
      spof ? 'SPOF' : '', device.active && hidden ? `+${hidden}` : ''].filter(Boolean).join(' \u00b7 ');
    const axes = device.active
      ? rows.map(([key, axis]) => nodeAxisRow(device, key, axis)).join('')
      : '<span class="node-axis" data-axis-state="disabled"><i>x</i><b>OFFLINE</b><em>\u2014</em><s>DOWN</s></span>';
    return `<button type="button" class="mesh-node ${status} ${state.selectedId === device.id ? 'selected' : ''} ${selectionHas('device', device.id) ? 'multi-selected' : ''} ${state.connectSource === device.id ? 'connect-source' : ''}" data-device-id="${escapeAttribute(device.id)}" style="left:${device.position.x - viewport.minX}px;top:${device.position.y - viewport.minY}px" aria-pressed="${state.selectedId === device.id}" aria-label="${escapeAttribute(nodeAccessibleName(device))}">
      <span class="node-symbol">${device.active ? '<span class="node-ports" aria-hidden="true">' + ['top', 'right', 'bottom', 'left'].map((side) => `<i data-port="${side}"></i>`).join('') + '</span>' : ''}${vendorBadge(device)}${classView.badge === 'on' ? `<span class="node-class-badge">${escapeText(kindInitial(device.kind))}</span>` : ''}<svg class="node-glyph" aria-hidden="true" focusable="false"><use href="#${symbolFor(device.kind).id}"></use></svg></span><span class="node-rail"></span><span class="node-labels"><span class="node-name">${escapeText(device.name)}</span>${device.model ? `<span class="node-model">${escapeText(device.model)}</span>` : ''}${pool || idle ? `<span class="node-pool"${idle ? ' data-warn=""' : ''}>${escapeText(pool || idle)}</span>` : ''}<span class="node-axes">${axes}</span><span class="node-meta">${escapeText(meta)}</span></span>
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
    ${isDevice ? renderIdleNote(resource) : ''}
    <div class="axis-list">${Object.entries(resource.axes).map(([axis, result]) => renderAxis(axis, result, resource.id, resource)).join('')}</div>
    ${isDevice ? '' : renderLinkDirections(resource)}
    ${isDevice ? renderBehavior(resource) : ''}
    ${isDevice ? renderSpecBlock(resource) : ''}
    ${renderSourceNote(source, isDevice ? resource : null)}
    ${isDevice ? renderDeviceEditor(resource) : renderLinkEditor(resource)}`;
}

// 축이 전부 0인 장비를 앞에 두고 "왜 0인가"를 스스로 알아내게 두지 않는다. 한계값이 비어서
// 0인 것과, 지나는 수요가 없어서 0인 것은 화면에서 똑같이 0 으로 보이기 때문이다. 계산이 이미
// 아는 것(carriesDemand)을 그대로 말하고, 그 자리에서 고칠 길을 함께 낸다.
function renderIdleNote(resource) {
  if (resource.carriesDemand !== false || !resource.active) return '';
  return `<div class="idle-note">
    <p>이 장비를 지나는 트래픽 수요가 없습니다. 어느 수요의 경로에도 들어 있지 않아 실린 부하가 0입니다.</p>
    <button type="button" data-demand-target="${escapeAttribute(resource.id)}">이 장비로 수요 추가</button>
  </div>`;
}

// 링크의 평면 축은 바쁜 쪽 방향 하나만 말한다. 방향마다 용량이 다른 회선에서는 그것으로 부족하다
// — 넘친 방향만 보이고 반대쪽이 왜 멀쩡한지 알 길이 없다. 그래서 한계가 갈리는 링크만 두 방향을
// 나란히 편다. 양쪽이 같은 링크에 같은 숫자를 두 번 적는 것은 소음이다.
function renderLinkDirections(resource) {
  const axes = [...new Set(['forward', 'reverse'].flatMap((direction) => Object.keys(resource.directions?.[direction]?.axes || {})))];
  const split = axes.filter((axis) => resource.directions?.forward?.axes[axis]?.limit !== resource.directions?.reverse?.axes[axis]?.limit);
  if (!split.length) return '';
  const rows = [['forward', '정방향', resource.source], ['reverse', '역방향', resource.target]].map(([direction, label, from]) => {
    const cells = split.map((axis) => {
      const result = resource.directions?.[direction]?.axes[axis];
      return `<span data-status="${escapeAttribute(result?.status || 'unknown')}"><b>${escapeText(axisCatalog[axis]?.nodeLabel || axis)}</b>
        ${escapeText(formatCompact(result?.limit, axisCatalog[axis]?.unit))} · ${escapeText(result?.utilization == null ? '—' : formatPercent(result.utilization))}</span>`;
    }).join('');
    return `<div class="link-direction"><strong>${label}<small>${escapeText(from)} 에서</small></strong>${cells}</div>`;
  }).join('');
  return `<div class="direction-list"><span class="spec-code">방향별 한계</span>${rows}</div>`;
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
      const asserted = (device.spec?.conditionSelection || device.metadata?.conditionSelection) === 'explicit-profile';
      const judged = evidenceApplicability(record, topology.workloadConditions || {}, topology.workloadScope || null);
      const accepted = asserted || (judged !== 'applicable' && device.accepted?.[record.axis] === acceptanceDigest(record, topology.workloadConditions || {}, topology.workloadScope || null));
      const applicability = judged === 'applicable' ? 'applicable' : accepted ? 'user-asserted' : judged;
      const label = { applicable: '조건 일치', incompatible: '조건 불일치', unknown: '적용 조건 미확인', 'user-asserted': '사용자 수락' }[applicability];
      const conditions = record.conditions
        ? Object.entries(record.conditions).map(([key, value]) => `${key}=${Array.isArray(value) ? (value.join('+') || '없음') : value}`).join(' · ')
        : '측정 조건 없음';
      // 프로필을 통째로 수락하는 길은 두지 않는다(PRD v0.6 P1-39). 축 하나씩만 받는다.
      const action = record.value === null || applicability === 'applicable' ? ''
        : accepted
          ? `<button type="button" data-evidence-release="${escapeAttribute(record.axis)}">수락 취소</button>`
          : `<button type="button" data-evidence-accept="${escapeAttribute(record.axis)}">이 축만 수락</button>`;
      return `<span class="evidence-state" data-applicability="${escapeAttribute(applicability)}"><span class="evidence-head"><b>${escapeText(axisCatalog[record.axis]?.label || record.axis)}</b> · ${escapeText(record.evidenceKind)} · ${escapeText(label)}</span><small>${escapeText(conditions)}</small>${action}</span>`;
    }).join('');
    return `<div class="source-note">
      <strong>${escapeText(SOURCE_TYPE_LABEL[source.type] || source.type || '출처 미상')} · ${escapeText(source.label || '')}</strong> ${link}
      ${source.locator ? `<br>${escapeText(source.locator)}` : ''}
      ${source.retrievedAt ? `<br>수집 ${escapeText(source.retrievedAt)}` : ''}
      ${source.note ? `<br>${escapeText(source.note)}` : ''}
      ${evidence}
      ${(device.spec?.digest || device.metadata?.digest) ? `<br>근거 snapshot ${escapeText(device.spec?.digest || device.metadata?.digest)}` : ''}
      ${device.overrides ? `<p class="source-correction">보정한 축이 ${Object.keys(device.overrides).length}개 있습니다. 데이터시트 값은 그대로 보존됩니다.</p>` : ''}
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
    ${resource.capacityByDirection ? ['forward', 'reverse'].map((direction) => `<label>${direction === 'forward' ? '정방향' : '역방향'}만 다르게 (bps)<input name="${direction}Bps" type="number" min="1" step="any"
      value="${resource.capacityByDirection[direction]?.forwarding_bps ?? ''}" placeholder="비우면 위 값을 씁니다"></label>`).join('') : ''}
    <div class="inspector-editor-actions"><button type="submit">적용</button><button type="button" data-delete-resource="link">링크 삭제</button></div><p class="editor-error"></p>
  </form>`;
}

function escapeAttribute(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;'); }
function escapeText(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

// 한계값은 사람이 장비 사양에서 읽는 모양으로 떨어져야 한다. 1-2-5 사다리에 붙인다.
// 미세 조정(Shift)일 때는 유효숫자 세 자리로만 다듬는다.
const SNAP_LADDER = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function snapLimit(value, fine = false) {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const base = 10 ** Math.floor(Math.log10(value));
  if (fine) return Math.round(value / (base / 100)) * (base / 100);
  const scaled = value / base;
  return SNAP_LADDER.reduce((best, step) => (Math.abs(step - scaled) < Math.abs(best - scaled) ? step : best), SNAP_LADDER[0]) * base;
}

// 막대를 끌어 한계값을 정할 수 있는 조건. 부하를 알아야 "몇 %에 두겠다"가 한계값이 된다.
// 부하가 0 이거나 미확인이면 나눌 것이 없으므로 숫자 입력만 남긴다.
function axisDraggable(resource, axis, result) {
  return Boolean(resource.kind && topology.devices.some(({ id }) => id === resource.id)
    && Number.isFinite(result.load) && result.load > 0 && Object.hasOwn(resource.limits || {}, axis));
}

function renderAxis(axis, result, resourceId, resource = null) {
  const catalog = axisCatalog[axis] || { label: axis, shortLabel: axis, unit: '' };
  const width = result.utilization == null ? 0 : Math.max(2, result.utilization * 100);
  const drag = resource && axisDraggable(resource, axis, result);
  // 끌어서 정하는 것은 목표 사용률이고, 저장되는 것은 거기서 나온 한계값이다.
  const meter = drag
    ? `<div class="axis-meter" data-axis-drag="${escapeAttribute(axis)}" data-axis-resource="${escapeAttribute(resourceId)}" data-axis-load="${result.load}"
        role="slider" tabindex="0" aria-valuemin="2" aria-valuemax="100" aria-valuenow="${Math.round((result.utilization ?? 0) * 100)}"
        aria-label="${escapeAttribute(`${catalog.label} 한계값. 좌우로 끌면 이 축의 목표 사용률을 정하고 그 값이 한계값이 됩니다.`)}" style="--axis-width:${width}%"><span style="--axis-width:${width}%"></span><i class="axis-grip"></i></div>`
    : `<div class="axis-meter" aria-label="${catalog.label} ${formatPercent(result.utilization)}"><span style="--axis-width:${width}%"></span></div>`;
  return `<div class="axis-row ${result.status}"${drag ? ' data-axis-editable=""' : ''}>
    <div class="axis-title"><span>${catalog.label}</span><span>${stateLabel(result.status)} · <b data-live-util="${result.utilization ?? ''}" data-live-seed="${resourceId}:${axis}">${formatPercent(result.utilization)}</b></span></div>
    ${meter}
    <div class="axis-values"><span data-live-load="${result.load}" data-live-unit="${catalog.unit}" data-live-seed="${resourceId}:${axis}-load">${formatCompact(result.load, catalog.unit)} load</span><span data-axis-limit="${escapeAttribute(axis)}">${formatCompact(result.limit, catalog.unit)} limit</span></div>
  </div>`;
}

function telemetryWave(seed, phase, amplitude = 0.015) {
  const hash = [...seed].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) % 997, 17);
  return Math.sin(phase * 0.72 + hash * 0.13) * amplitude + Math.sin(phase * 0.23 + hash) * amplitude * 0.35;
}

// 트윈은 260ms, 흔들림은 300ms 마다 한 걸음 나아간다. 진폭은 사용률 1.5퍼센트포인트라 70% 가
// 68.5~71.5% 사이에서만 흔들린다. 그보다 크면 읽는 사람이 어느 값을 적어야 할지 헷갈린다.
// 백분율에는 곱이 아니라 더하기로 넣는다 - 곱하면 20% 같은 낮은 값은 반올림에 묻혀 얼어붙는다.
const MOTION = { tween: 260, driftCadence: 300, amplitude: 0.015 };
// seed 는 자원과 축을 함께 가리킨다. 화면이 통째로 다시 그려져도 같은 숫자를 이어서 따라간다.
const liveShown = new Map();
const liveTweens = new Map();
let motionFrame = null;

const liveNodes = () => document.querySelectorAll('[data-live-util], [data-live-load]');
function liveTarget(node) {
  const raw = node.dataset.liveUtil ?? node.dataset.liveLoad;
  const value = raw === '' || raw == null ? Number.NaN : Number(raw);
  return { seed: node.dataset.liveSeed, value, load: node.dataset.liveUnit != null };
}
function paintLive(node, value, load) {
  const text = load ? `${formatCompact(value, node.dataset.liveUnit)} load` : formatPercent(value);
  if (node.textContent !== text) node.textContent = text;
  // 백분율은 1%포인트 단위로만 바뀌어서, 그것만으로는 움직임으로 읽히지 않는다. 막대는 그
  // 사이를 이어 준다 - 눈이 실제로 잡는 것은 자릿수가 아니라 길이다. 인스펙터 미터는 끌어서
  // 한계값을 정하는 손잡이라 건드리지 않는다.
  const row = load ? null : node.closest('.node-axis');
  if (row) row.style.setProperty('--util', String(Math.min(Math.max(value, 0), 1.5)));
}

/** 다시 그린 뒤 부른다. 값이 실제로 바뀐 숫자만 이전 값에서 새 값으로 잇는다. */
function syncLiveNumbers() {
  const seen = new Set();
  for (const node of liveNodes()) {
    const { seed, value } = liveTarget(node);
    if (!seed || !Number.isFinite(value)) continue;
    seen.add(seed);
    const shown = liveShown.get(seed);
    // 처음 그려지는 숫자는 올 곳이 없다. 움직임을 줄인 환경에서도 잇지 않는다.
    if (shown != null && Math.abs(shown - value) > 1e-9 && !reducedMotion.matches) {
      liveTweens.set(seed, { from: shown, to: value, start: performance.now() });
    } else liveTweens.delete(seed);
    liveShown.set(seed, value);
  }
  for (const seed of [...liveShown.keys()]) if (!seen.has(seed)) { liveShown.delete(seed); liveTweens.delete(seed); }
  if (!motionFrame) motionFrame = requestAnimationFrame(stepMotion);
}

function stepMotion(now) {
  motionFrame = null;
  const drifting = motionView.drift === 'on' && !reducedMotion.matches;
  if (!liveTweens.size && !drifting) return;
  // 300ms 는 흔들림이 한 걸음 나아가는 속도이지 다시 그리는 간격이 아니다. 계단으로 뛰면
  // 1%포인트 점프만 남아 움직임으로 읽히지 않으므로, 같은 속도로 매 프레임 이어서 그린다.
  const phase = now / MOTION.driftCadence;
  let running = false;
  for (const node of liveNodes()) {
    const { seed, value, load } = liveTarget(node);
    if (!seed || !Number.isFinite(value)) continue;
    const tween = liveTweens.get(seed);
    if (tween) {
      const progress = Math.min(1, (now - tween.start) / MOTION.tween);
      paintLive(node, tween.from + (tween.to - tween.from) * (1 - (1 - progress) ** 3), load);
      if (progress >= 1) liveTweens.delete(seed); else running = true;
      continue;
    }
    // 흔들림은 헤드라인 숫자에 걸지 않는다(DESIGN.md). 고정된 비교 패널과 다른 말을 하면
    // 읽는 사람은 어느 쪽을 적어야 할지 알 수 없다.
    if (!drifting || node.closest('.binding-callout')) { paintLive(node, value, load); continue; }
    const wave = telemetryWave(seed, phase, MOTION.amplitude);
    paintLive(node, Math.max(0, load ? value * (1 + wave) : value + wave), load);
  }
  if (running || drifting) motionFrame = requestAnimationFrame(stepMotion);
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

// 스파크라인 표본을 밀어 넣는다. 숫자 자체를 칠하는 일은 stepMotion 이 맡는다.
function updateTelemetry() {
  const liveHeadroom = current.summary.minHeadroom;
  element('summary-headroom').dataset.liveValue = liveHeadroom == null ? '' : liveHeadroom.toFixed(6);
  // 최소 headroom 을 모르면 표본을 만들지 않는다. 0 은 위험으로, 0% 는 안전으로 읽혀
  // 두 계열이 반대 방향으로 없는 값을 지어낸다. 모르는 것은 선을 잇지 않고 그렇게 표시한다.
  const seriesValues = {
    headroom: liveHeadroom,
    utilization: liveHeadroom == null ? null : 1 - liveHeadroom,
    delivery: Math.max(0, 1 - current.summary.unreachableCount / Math.max(current.demands.length, 1)),
    traffic: current.scale,
  };
  document.querySelectorAll('.metric-sparkline').forEach((svg) => {
    const value = seriesValues[svg.dataset.series];
    svg.toggleAttribute('data-unknown', value == null);
    if (value != null) {
      const history = pushTelemetry(svg.dataset.series, value);
      // 표본이 하나뿐이면 선을 그릴 수 없다. 빈 칸에 이유가 없으면 미확인과 구별되지 않는다.
      svg.toggleAttribute('data-unknown', history.length < 2);
      renderSparkline(svg, history);
      return;
    }
    // 그려 둔 선을 지우고 이력도 버린다. 남겨 두면 미확인 구간을 건너뛴 선이 이어져,
    // 없던 추세를 그린 그림이 된다.
    telemetryHistory.delete(svg.dataset.series);
    svg.querySelector('path').removeAttribute('d');
    svg.querySelector('circle').removeAttribute('cx');
    svg.querySelector('circle').removeAttribute('cy');
  });
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

// 데이터시트 값은 특정 조건에서 잰 숫자다. 그 조건과 대조할 우리 워크로드를 적지 않으면
// 어떤 한계값도 적용 가능한지 판정할 수 없고, 카탈로그 장비 전체가 계산에서 빠진다.
const WORKLOAD_FIELDS = [
  { key: 'packet_size_bytes', label: '프레임 크기', hint: '바이트. 데이터시트가 20 Gbps @ 1518B 로 적었다면 1518', type: 'number' },
  { key: 'transport', label: '전송 계층', hint: 'tcp · udp · mixed', type: 'text' },
  { key: 'cipher', label: '암호 스위트', hint: 'rsa2048 · ecdsa_p256 · none', type: 'text' },
  { key: 'test_method', label: '시험 방법', hint: 'enterprise-traffic-mix · appmix 처럼 데이터시트가 이름 붙인 것', type: 'text' },
];

function openWorkloadForm() {
  const conditions = topology.workloadConditions || {};
  const features = conditions.features_enabled;
  const judgement = current.summary.evidenceJudgement;
  const ratio = judgement.ratio == null ? '카탈로그 근거가 붙은 축이 없습니다.'
    : `근거가 붙은 축 ${judgement.withRecords}개 중 ${judgement.judged}개를 판정했습니다 · ${formatPercent(judgement.ratio)}`;
  openEditorPanel('워크로드 조건', `<form data-editor-form="workload" class="editor-form">
    <p class="form-hint">이 설계에 실제로 흐르는 트래픽의 조건입니다. 데이터시트가 어떤 조건에서 잰 숫자인지와 대조해, 그 한계값을 이 설계에 쓸 수 있는지 판정합니다. 비워 두면 판정할 수 없어 미확인으로 남습니다.</p>
    ${WORKLOAD_FIELDS.map(({ key, label, hint, type }) => `<label>${escapeText(label)}
      <input name="${key}" type="${type}" value="${escapeAttribute(conditions[key] ?? '')}" placeholder="${escapeAttribute(hint)}">
    </label>`).join('')}
    <fieldset class="workload-features">
      <legend>켜 둔 기능</legend>
      <label class="inline"><input type="radio" name="features_mode" value="unset"${features == null ? ' checked' : ''}> 적지 않음</label>
      <label class="inline"><input type="radio" name="features_mode" value="none"${Array.isArray(features) && !features.length ? ' checked' : ''}> 없음 (방화벽만)</label>
      <label class="inline"><input type="radio" name="features_mode" value="list"${Array.isArray(features) && features.length ? ' checked' : ''}> 목록</label>
      <input name="features_enabled" type="text" value="${escapeAttribute(Array.isArray(features) ? features.join(', ') : '')}" placeholder="ips, application-control, logging">
    </fieldset>
    <p class="form-hint"><b>${escapeText(ratio)}</b> 이 도구가 못 하면 안 되는 일은 맞다고 말하는 것이 아니라 맞는지 아닌지 말하는 것입니다.</p>
    <div class="form-actions"><button type="submit">적용</button><button type="button" data-workload-action="clear">모두 지우기</button></div>
  </form>`);
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
const templateGrades = new Map();
// 설계 고르기를 열 때마다 목록 전체를 훑던 자리다. 훑기 비용은 자원 수를 따라 가파르게 붙어
// 큰 설계 하나가 패널 첫 열기를 눈에 띄게 멈춰 세운다. 등급은 저장소 안 리터럴에서 나오는
// 설계의 성질이라 정의에 적혀 있고, 적히지 않은 것만 그 자리에서 훑는다.
function templateGrade(id) {
  const declared = templates.find((item) => item.id === id)?.grade;
  if (declared) return declared;
  if (!templateGrades.has(id)) {
    const sweep = sweepSingleFaults(buildTemplate(id));
    templateGrades.set(id, sweep.resources.length ? { verdict: sweep.grade, severs: sweep.severs } : null);
  }
  return templateGrades.get(id);
}

// 안내는 읽는 문서가 아니라 따라가는 흐름이다. 각 단계는 설명만 하지 않고 실제로 그 조작을
// 해서 화면이 바뀌는 것을 보인다. 강조는 좌표가 아니라 이름 있는 영역에 건다 — 좌표에 못 박으면
// 레이아웃이 바뀔 때마다 안내가 엉뚱한 곳을 가리킨다.
// 안내가 못 박은 숫자를 말하면, 사용자가 만든 설계에서 열었을 때 틀린 말을 하게 된다.
// 그래서 숫자가 나오는 단계는 지금 화면의 계산에서 대상과 값을 고른다.
function tourTargets() {
  const actives = current.devices.filter(({ active }) => active);
  const known = (device) => Object.entries(device.axes).filter(([, axis]) => axis.utilization != null);
  // 축이 서로 가장 크게 갈리는 장비. "한 장비가 한계를 여럿 갖는다"를 가장 잘 보이는 자리다.
  const spread = actives
    .map((device) => {
      const values = known(device);
      if (values.length < 2) return null;
      const sorted = [...values].sort((a, b) => b[1].utilization - a[1].utilization);
      return { device, high: sorted[0], low: sorted.at(-1), gap: sorted[0][1].utilization - sorted.at(-1)[1].utilization };
    })
    .filter(Boolean)
    .sort((a, b) => b.gap - a.gap)[0] || null;
  const rank = { overloads: 0, severs: 1, absorbs: 2 };
  const fault = sweep.resources
    .filter((item) => !item.endpoint && item.verdict !== 'unknown' && current.devices.some(({ id }) => id === item.id))
    .sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9))[0] || null;
  const rung = current.summary.overloadedCount > 0 ? null : current.summary.growthLadder?.rungs?.[0] || null;
  return { spread, fault, rung };
}

// 각 단계는 화면의 실제 조작 대상을 가리킨다. 선택자는 id 나 data 속성처럼 이름으로 고른다 —
// 좌표를 저장하면 레이아웃이 바뀔 때마다 엉뚱한 곳을 가리킨다. 상자 자리는 매번 다시 잰다.
const TOUR_STEPS = [
  {
    title: '설계 템플릿',
    target: '[data-editor-action="new"]',
    text: () => '여기서 시작합니다. 21개 설계가 들어 있고 각각 먼저 차는 축이 다릅니다. 3-tier 웹, DMZ 이중 방화벽, IoT 게이트웨이처럼 실제 구성을 골라 열 수 있습니다.',
  },
  {
    title: '워크로드 배율',
    target: '.scale-control',
    text: ({ rung }) => (rung
      ? `부하를 통째로 올리고 내립니다. 지금 설계는 ${rung.breachScale.toFixed(2)}배에서 ${resourceName(resourceById(rung.resourceId)) || rung.resourceId} 의 ${withParticle(axisCatalog[rung.axis]?.label || rung.axis, 'subject')} 먼저 넘습니다. 그 지점 너머로 올려 두었습니다.`
      : '부하를 통째로 올리고 내립니다. 끄는 동안은 가벼운 계산만 돌고, 손을 떼면 전체가 다시 돕니다.'),
    run: ({ rung }) => {
      if (!rung) return;
      state.scale = Math.min(1.8, Math.round((rung.breachScale + 0.05) * 20) / 20);
      element('scale-input').value = String(Math.round(state.scale * 100));
    },
  },
  {
    title: '무엇이 먼저 차는가',
    target: '#topology-heading',
    text: () => '캔버스 제목은 질문이 아니라 답입니다. 병목 자원과 그 축, 사용률을 말합니다. 바로 아래 줄이 몇 배에서 넘고 그다음은 어디인지 알려 줍니다.',
  },
  {
    title: '상태 범례',
    target: '.scenario-legend',
    text: () => '노드의 축 앞에 붙는 토큰입니다. 정상은 마침표, 주의는 느낌표, 초과는 부등호, 미확인은 물음표, 오류와 꺼짐은 x 입니다. 한계를 모르는 축은 막대를 채우지 않고 백분율도 적지 않습니다 — 미확인은 0%가 아닙니다.',
  },
  {
    title: '축 미터로 용량을 정합니다',
    target: '[data-axis-drag]',
    text: ({ spread }) => (spread
      ? `${withParticle(resourceName(spread.device), 'object')} 골랐습니다. ${axisCatalog[spread.low[0]]?.label || spread.low[0]} ${formatPercent(spread.low[1].utilization)} 인데 ${axisCatalog[spread.high[0]]?.label || spread.high[0]} ${formatPercent(spread.high[1].utilization)} 입니다. 같은 장비인데 축마다 다릅니다. 이 막대는 읽기만 하는 그림이 아니라 좌우로 끌면 그 축의 목표 사용률이 정해지고 거기서 나온 한계값이 저장됩니다. 방향키로도 됩니다.`
      : '검사기의 축 막대는 좌우로 끌 수 있습니다. 그 축을 몇 %에 두겠다는 목표가 정해지고 거기서 나온 한계값이 저장됩니다.'),
    run: ({ spread }) => {
      if (!spread) return;
      state.selectedId = spread.device.id;
      state.selection = [{ type: 'device', id: spread.device.id }];
    },
  },
  {
    title: '장애 주입',
    target: '[data-panel-tab="failure"]',
    text: ({ fault }) => {
      const tail = '이 목록은 자원을 하나씩 끈 결과를 미리 계산해 둔 것입니다. 끊는 것, 남은 쪽이 넘치는 것, 견디는 것으로 나뉩니다.';
      if (!fault) return `${tail} 지금 설계에는 끌 자원이 아직 없습니다.`;
      const name = resourceName(resourceById(fault.id)) || fault.id;
      const verdict = fault.verdict === 'severs' ? '트래픽이 끊깁니다'
        : fault.verdict === 'overloads' ? '남은 쪽이 한계를 넘습니다' : '남은 쪽이 받아냅니다';
      return `${tail} ${withParticle(name, 'object')} 껐습니다 — ${verdict}.`;
    },
    run: ({ fault }) => { setLeftPanel('failure'); if (fault) state.disabledDevices.add(fault.id); },
  },
  {
    title: '장비 바꾸기',
    target: '.mesh-node',
    text: () => '노드를 오른쪽 클릭하면 데이터시트 장비를 고를 수 있습니다. 목록은 장비가 아니라 측정 조건 단위입니다 — 같은 방화벽도 1518바이트에서 20 Gbps 이고 위협 방어를 켜면 1 Gbps 입니다. 삭제, 복제, 링크 시작도 같은 메뉴에 있습니다.',
  },
  {
    title: '워크로드 조건',
    target: '[data-editor-action="workload"]',
    text: () => '데이터시트 숫자는 특정 조건에서 잰 값입니다. 우리 트래픽의 프레임 크기와 전송 계층을 여기 적어야 그 값을 이 설계에 쓸 수 있는지 판정합니다. 적지 않으면 그 축은 미확인으로 남습니다 — 모르는 것을 안전으로 바꾸지 않습니다.',
  },
  {
    title: '결과 내보내기',
    target: '[data-editor-action="export-svg"]',
    text: () => '내보낸 그림에는 배율, 주입한 장애, 엔진 버전, 판정, 미확인 축 수가 함께 찍힙니다. 그래야 위키에 붙인 그림이 어느 조건에서 나온 것인지 남습니다. 프로젝트 저장은 근거와 보정까지 담은 JSON 을 냅니다.',
  },
  {
    title: '다 됐습니다',
    target: null,
    text: () => '설계는 안내를 시작하기 전으로 되돌렸습니다. 캔버스 아래 줄이 지금 무엇이 막고 있는지 계속 말해 줍니다. 이 안내는 헤더의 사용 안내로 언제든 다시 열 수 있습니다.',
  },
];

let tour = null;

function startTour() {
  closeEditorPanel();
  // 안내가 바꾸는 것은 시나리오 상태뿐이라 그대로 되돌릴 수 있다. 설계 자체는 건드리지 않는다.
  tour = {
    index: 0,
    restore: { scale: state.scale, devices: [...state.disabledDevices], links: [...state.disabledLinks],
      selectedId: state.selectedId, leftPanel: state.leftPanel },
  };
  runTourStep(0);
}

function endTour() {
  if (!tour) return;
  const { restore } = tour;
  tour = null;
  state.scale = restore.scale; element('scale-input').value = String(restore.scale * 100);
  state.disabledDevices = new Set(restore.devices); state.disabledLinks = new Set(restore.links);
  state.selectedId = restore.selectedId;
  state.selection = restore.selectedId ? [{ type: 'device', id: restore.selectedId }] : [];
  setLeftPanel(restore.leftPanel);
  element('tour-spot').hidden = true;
  element('tour').hidden = true; element('tour').innerHTML = '';
  recalculate();
}

function runTourStep(index) {
  if (!tour) return;
  if (index < 0 || index >= TOUR_STEPS.length) { endTour(); return; }
  tour.index = index;
  const step = TOUR_STEPS[index];
  // 단계마다 시나리오 상태를 시작 시점으로 되돌린 뒤 그 단계가 할 일만 한다. 그래야 '이전'으로
  // 오갔을 때 앞 단계가 남긴 장애나 배율이 쌓이지 않는다. 마지막 단계는 되돌린 화면 그대로다.
  state.scale = tour.restore.scale; element('scale-input').value = String(Math.round(tour.restore.scale * 100));
  state.disabledDevices = new Set(tour.restore.devices);
  state.disabledLinks = new Set(tour.restore.links);
  current = calculateScenario(topology, scenarioOptions());
  sweep = sweepSingleFaults(topology, { scale: state.scale }); sweepScale = state.scale;
  const targets = tourTargets();
  step.run?.(targets);
  recalculate();
  const box = element('tour');
  box.hidden = false;
  box.innerHTML = `<p class="tour-count">${index + 1} / ${TOUR_STEPS.length}</p>
    <h2 id="tour-title">${escapeText(step.title)}</h2>
    <p class="tour-text">${escapeText(step.text(targets))}</p>
    <div class="tour-actions">
      <button type="button" data-tour="skip">건너뛰기</button>
      <button type="button" data-tour="prev"${index === 0 ? ' disabled' : ''}>이전</button>
      <button type="button" data-tour="next">${index === TOUR_STEPS.length - 1 ? '닫기' : '다음'}</button>
    </div>`;
  box.querySelector('[data-tour="next"]').focus();
  const target = step.target ? document.querySelector(step.target) : null;
  // 가운데로 올려야 화면 안에 든다. nearest 는 밖에 둔 채로 끝난다.
  if (target) target.scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  placeTourSpot();
}

// 실선 박스를 대상 위에 씌운다. 자리는 저장하지 않고 그릴 때마다 다시 잰다 — 스크롤과 창 크기가
// 바뀌면 좌표는 바로 낡는다. 대상이 없거나 접혀 사라졌으면 아무것도 그리지 않는다.
function placeTourSpot() {
  const spot = element('tour-spot');
  const box = element('tour');
  const step = tour ? TOUR_STEPS[tour.index] : null;
  const target = step?.target ? document.querySelector(step.target) : null;
  const rect = target?.getBoundingClientRect();
  // 화면 밖이라고 숨기지 않는다 — 부드러운 스크롤이 끝나면 제자리로 온다. 숨기면 그 사이에
  // 박스가 깜박이고, 스크롤이 끝난 뒤에도 다시 나타나지 않는 순간이 생긴다.
  if (!tour || !rect || rect.width < 4 || rect.height < 4) {
    spot.hidden = true;
    box.dataset.side = 'right';
    return;
  }
  const pad = 6;
  spot.hidden = false;
  spot.style.left = `${Math.max(2, rect.left - pad)}px`;
  spot.style.top = `${Math.max(2, rect.top - pad)}px`;
  spot.style.width = `${Math.min(rect.width + pad * 2, window.innerWidth - 4)}px`;
  spot.style.height = `${rect.height + pad * 2}px`;
  // 가리키는 곳을 설명 상자가 덮으면 안내가 아니라 방해다. 대상 반대편으로 비킨다.
  box.dataset.side = rect.left + rect.width / 2 > window.innerWidth / 2 ? 'left' : 'right';
  box.dataset.vertical = rect.top > window.innerHeight / 2 ? 'top' : 'bottom';
}

// 안내는 처음 한 번 뜨고 마는 것이 아니어야 한다. 작업 사본을 복원하면 첫 화면 설명이
// 함께 오지 않고, 사용자가 만든 설계에는 애초에 가르칠 것이 없다. 그래서 언제든 여는 문을 둔다.
// 안내는 처음 한 번 뜨고 마는 것이 아니어야 한다. 작업 사본을 복원하면 첫 화면 설명이
// 함께 오지 않고, 사용자가 만든 설계에는 애초에 가르칠 것이 없다. 그래서 언제든 여는 문을 둔다.
function templateCard(item, groupLabel) {
  const grade = templateGrade(item.id);
  const gradeLabel = grade ? `${GRADE_LABEL[grade.verdict]}${grade.verdict === 'single-point' ? ` ${grade.severs}` : ''}` : '';
  // 섹션 이름도 검색어가 된다. "보안"으로 찾으면 그 섹션이 통째로 나와야 자연스럽다.
  const haystack = [item.name, item.summary, item.teaches, gradeLabel, groupLabel, ...(item.tags || [])].join(' ').toLowerCase();
  // 카드는 판정 → 이름 → 설명 → 배우는 점 순서로 읽힌다. 판정을 먼저 둔 건 카드를 훑을 때 그게 고르는 기준이기 때문이다.
  return `<button type="button" class="template-item" data-template="${escapeAttribute(item.id)}" data-search="${escapeAttribute(haystack)}">
      ${gradeLabel ? `<b class="template-grade" data-grade="${escapeAttribute(grade.verdict)}">${escapeText(gradeLabel)}</b>` : ''}
      <strong>${escapeText(item.name)}</strong><span>${escapeText(item.summary)}</span>${item.teaches ? `<em>${escapeText(item.teaches)}</em>` : ''}
      ${(item.tags || []).length ? `<span class="template-tags">${item.tags.map((tag) => `<i>${escapeText(tag)}</i>`).join('')}</span>` : ''}
  </button>`;
}

function openTemplatePicker() {
  // 카드 자체는 그대로 두고 제목만 사이에 끼운다. 검색은 여전히 .template-item 전부를 훑는다.
  const sections = templateGroups.map(({ id, label }) => {
    const members = templates.filter((item) => item.group === id);
    if (!members.length) return '';
    return `<section class="template-section" data-group="${escapeAttribute(id)}"><h3>${escapeText(label)}</h3>
      <div class="template-list">${members.map((item) => templateCard(item, label)).join('')}</div></section>`;
  }).join('');
  openEditorPanel('설계 템플릿', `<p class="editor-hint">템플릿마다 먼저 차는 축이 다릅니다. 불러온 뒤 장비를 눌러 어느 축이 병목인지 확인하세요.</p>
    <div class="template-head">
      <label class="template-search"><span class="visually-hidden">템플릿 검색</span>
        <input type="search" id="template-search" placeholder="이름, 태그, 병목으로 검색 (예: TLS, 방화벽, 대역폭)" autocomplete="off"></label>
      <p class="template-count" id="template-count" aria-live="polite">${templates.length}개</p>
    </div>
    ${sections}`);
  element('template-search').focus();
}

// 카탈로그의 장비를 자리에서 바꾼다. 프로필까지 한 장의 카드로 펼치는 이유는, 고르는 단위가
// 장비가 아니라 "어느 조건에서 잰 값이냐"이기 때문이다. 같은 장비도 조건이 다르면 다른 숫자다.
function openDeviceSwapPicker(id) {
  const device = deviceById(id);
  if (!device) return;
  const entries = catalogFor(device.kind);
  const cards = entries.flatMap((entry) => entry.profiles.map((profile) => {
    const current = device.spec?.catalogId === entry.id && device.spec?.profileId === profile.id;
    const limits = Object.entries(profile.limits)
      .map(([axis, value]) => `${axisCatalog[axis]?.nodeLabel || axis} ${value == null ? '미확인' : formatCompact(value, axisCatalog[axis]?.unit)}`)
      .join(' · ');
    const haystack = [entry.vendor, entry.model, profile.label, profile.note, limits].join(' ').toLowerCase();
    return `<button type="button" class="template-item" data-swap-catalog="${escapeAttribute(entry.id)}" data-swap-profile="${escapeAttribute(profile.id)}"
      data-search="${escapeAttribute(haystack)}"${current ? ' data-current="" aria-current="true"' : ''}>
      ${current ? '<b class="template-grade" data-grade="current">지금 이 값</b>' : ''}
      <strong>${escapeText(`${entry.vendor} ${entry.model}`)}</strong>
      <span>${escapeText(profile.label)}</span>
      <em>${escapeText(limits)}</em>
      ${profile.note ? `<span class="swap-note">${escapeText(profile.note)}</span>` : ''}
    </button>`;
  })).join('');
  openEditorPanel(`${resourceName(device)} · 장비 선택`, `<p class="editor-hint">같은 장비라도 측정 조건이 다르면 다른 숫자입니다. 조건째로 고르세요. 고른 값은 워크로드 조건과 대조해 적용 가능한지 판정합니다.</p>
    <div class="template-head">
      <label class="template-search"><span class="visually-hidden">장비 검색</span>
        <input type="search" id="swap-search" placeholder="제조사, 모델, 조건으로 검색 (예: 1518, IPS, ASA)" autocomplete="off"></label>
      <p class="template-count" id="swap-count" aria-live="polite">${entries.reduce((n, entry) => n + entry.profiles.length, 0)}개</p>
      ${device.spec ? '<button type="button" class="swap-detach" data-swap-detach>데이터시트를 떼고 직접 입력으로</button>' : ''}
    </div>
    <div class="template-list">${cards}</div>`);
  element('swap-search').focus();
}

function filterSwapChoices(query) {
  const needle = query.trim().toLowerCase();
  let shown = 0;
  const items = [...document.querySelectorAll('[data-swap-catalog]')];
  for (const item of items) {
    const match = !needle || item.dataset.search.includes(needle);
    item.hidden = !match;
    if (match) shown += 1;
  }
  element('swap-count').textContent = needle ? `${shown}개 일치` : `${items.length}개`;
}

function filterTemplates(query) {
  const needle = query.trim().toLowerCase();
  let shown = 0;
  for (const item of document.querySelectorAll('.template-item')) {
    const match = !needle || item.dataset.search.includes(needle);
    item.hidden = !match;
    if (match) shown += 1;
  }
  // 자식이 전부 숨은 섹션은 제목만 남아 빈 칸을 만든다. 함께 숨긴다.
  for (const section of document.querySelectorAll('.template-section')) {
    section.hidden = ![...section.querySelectorAll('.template-item')].some((item) => !item.hidden);
  }
  element('template-count').textContent = needle ? `${shown}개 일치` : `${templates.length}개`;
}

function loadTopology(next, message, undo = null) {
  topology = next;
  state.scale = 1; state.selectedId = topology.devices[0]?.id || null;
  state.selection = state.selectedId ? [{ type: 'device', id: state.selectedId }] : [];
  state.disabledDevices.clear(); state.disabledLinks.clear(); state.disabledDomains.clear(); state.namedScenarios = [];
  lessonRevealed = false;
  element('scale-input').value = '100';
  closeEditorPanel();
  documentHistory.reset(topology);
  baselineSnapshot = { topology: structuredClone(topology), scenario: scenarioOptions(true) };
  baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario);
  recalculate(); showToast(message, undo);
  focusCanvas(current.summary.bindingResourceId);
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
    focusCanvas(current.summary.bindingResourceId);
  });
}

// 클래스마다 재는 축이 다르다. 서버에 처리량(bps)만 물어보면 NIC 한계가 비어 unknown 으로
// 남고, 화면에는 0 이 아니라 물음표가 뜬다. 팔레트가 이미 클래스별 축을 알고 있으니 그걸 쓴다.
const deviceLimitAxes = (kind) => Object.keys(PALETTE.find((item) => item.kind === kind)?.limits || { forwarding_bps: null, forwarding_pps: null });

function deviceLimitFields(kind, limits = {}) {
  return deviceLimitAxes(kind).map((axis) => {
    const catalog = axisCatalog[axis] || { label: axis, unit: '' };
    return `<label>${escapeText(`${catalog.label}${catalog.unit ? ` (${catalog.unit})` : ''}`)}<input name="${escapeAttribute(axis)}" type="number" min="1" step="any" value="${limits[axis] ?? ''}"></label>`;
  }).join('');
}

function openDeviceForm(template = null) {
  const kind = template?.kind || PALETTE[0].kind;
  openEditorPanel('장비 추가', `<p class="editor-hint">장비를 만든 뒤 캔버스에서 드래그해 위치를 조정하세요. 비어 있는 한계값은 unknown으로 유지됩니다.</p><form class="editor-form" data-editor-form="device">
    <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(template?.name || '')}"></label>
    <label>클래스<select name="kind">${PALETTE.map((item) => `<option value="${escapeAttribute(item.kind)}" ${item.kind === kind ? 'selected' : ''}>${escapeText(`${item.label} · ${item.kind}`)}</option>`).join('')}</select></label>
    <label>영역<input name="zone" maxlength="80" value="${escapeAttribute(template?.zone || 'UNASSIGNED')}"></label>
    <span class="device-limit-fields">${deviceLimitFields(kind, template?.limits || {})}</span>
    <div class="form-actions"><button type="submit">장비 생성</button></div><p class="editor-error"></p></form>`);
  element('editor-panel-content').querySelector('form')._deviceTemplate = template || {};
}

// 클래스를 바꾸면 물어볼 축도 바뀐다. 이미 적은 값은 같은 축에 한해 살린다.
function renderDeviceLimitFields(form) {
  const fields = form.querySelector('.device-limit-fields');
  if (!fields) return;
  const kept = Object.fromEntries([...fields.querySelectorAll('input')].filter(({ value }) => value !== '').map(({ name, value }) => [name, value]));
  fields.innerHTML = deviceLimitFields(form.querySelector('select[name="kind"]').value, { ...(form._deviceTemplate?.limits || {}), ...kept });
}

function openDemandForm(targetId = null) {
  if (topology.devices.length < 2) { showToast('수요를 만들려면 장비가 두 대 이상 있어야 합니다.'); return; }
  // 노드에서 열면 그 장비가 목적지다. 출발지는 목적지와 달라야 하므로 겹치지 않는 첫 장비를 고른다.
  const target = topology.devices.some(({ id }) => id === targetId) ? targetId : topology.devices[1]?.id;
  const from = topology.devices.find(({ id }) => id !== target)?.id;
  openEditorPanel('트래픽 수요 추가', `<p class="editor-hint">출발지와 목적지 사이의 최단 ECMP 경로를 모두 찾아 계산합니다. 목적지가 로드밸런서 뒤에 있으면 같은 종류의 서버를 한 풀로 묶어 나눠 보냅니다.</p><form class="editor-form" data-editor-form="demand">
    <label>이름<input name="name" maxlength="80" required></label><label>출발지<select name="source">${deviceOptions(from)}</select></label><label>목적지<select name="target">${deviceOptions(target)}</select></label>
    <label>처리량 (bps)<input name="forwarding_bps" type="number" min="0" step="any" value="1000000000" required></label><label>패킷 처리량 (pps)<input name="forwarding_pps" type="number" min="0" step="any" value="100000"></label>
    <label>신규 세션 (CPS)<input name="new_sessions_per_sec" type="number" min="0" step="any" value="0"></label><label>동시 세션<input name="concurrent_sessions" type="number" min="0" step="any" value="0"></label>
    <div class="form-actions"><button type="submit">추가</button></div><p class="editor-error"></p></form>`);
}

function demandEndpoint(demand, side) {
  if (demand[side]) return demand[side];
  const devices = demand.paths?.[0]?.devices || [];
  return side === 'source' ? devices[0] : devices.at(-1);
}

// 자동으로 묶인 풀을 여기서 읽고 끌 수 있어야 한다. 보이지 않는 자동은 자동이 아니라 사고다.
function backendPoolLine(demand) {
  if (demand.backendPool === 'single') return '백엔드 풀 꺼짐 · target 한 대만 씁니다.';
  const backends = current.demands.find(({ id }) => id === demand.id)?.backends || [];
  if (backends.length < 2) return '백엔드 풀 없음 · LB 뒤에 같은 클래스 장비가 한 대뿐입니다.';
  const members = backends.map(({ id, share }) => `${deviceName(id)} ${Math.round(share * 100)}%`).join(' · ');
  return `백엔드 풀 ${backends.length}대 · ${members}`;
}

const deviceName = (id) => topology.devices.find((device) => device.id === id)?.name || id;

function openDemandManager() {
  const rows = topology.demands.length ? topology.demands.map((demand) => {
    const source = demandEndpoint(demand, 'source') || topology.devices[0]?.id || '';
    const target = demandEndpoint(demand, 'target') || topology.devices[1]?.id || '';
    return `<form class="demand-editor-row" data-editor-form="demand-edit" data-demand-id="${escapeAttribute(demand.id)}">
      <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(demand.name)}"></label>
      <label>출발지<select name="source">${deviceOptions(source)}</select></label><label>목적지<select name="target">${deviceOptions(target)}</select></label>
      <label>처리량 (bps)<input name="forwarding_bps" type="number" min="0" step="any" required value="${demand.load.forwarding_bps ?? 0}"></label>
      <label>패킷 처리량 (pps)<input name="forwarding_pps" type="number" min="0" step="any" value="${demand.load.forwarding_pps ?? 0}"></label>
      <label>CPS<input name="new_sessions_per_sec" type="number" min="0" step="any" value="${demand.load.new_sessions_per_sec ?? 0}"></label>
      <label>동시 세션<input name="concurrent_sessions" type="number" min="0" step="any" value="${demand.load.concurrent_sessions ?? 0}"></label>
      <div class="demand-row-actions"><button type="submit">수정</button><button type="button" data-delete-demand="${escapeAttribute(demand.id)}">삭제</button></div>
      <p class="demand-pool"><label><input type="checkbox" name="single" ${demand.backendPool === 'single' ? 'checked' : ''}> 이 서버만</label><span>${escapeText(backendPoolLine(demand))}</span></p><p class="editor-error"></p>
    </form>`;
  }).join('') : '<div class="editor-empty"><strong>아직 수요가 없습니다.</strong><span>수요를 추가하면 두 끝점 사이의 최단 ECMP 경로를 계산합니다.</span></div>';
  openEditorPanel('트래픽 수요 관리', `<div class="demand-manager-head"><p class="editor-hint">끝점이나 부하를 고치면 직접 적은 경로가 최단 ECMP 경로로 바뀝니다. 로드밸런서 뒤에 같은 종류의 장비가 여럿이면 한 풀로 묶어 나눠 보냅니다.</p><button type="button" data-new-demand>수요 추가</button></div><div class="demand-editor-list">${rows}</div>`);
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
      <section><h3>서비스</h3><ul>${services}</ul><form class="editor-form" data-editor-form="service"><label>이름<input name="name" required maxlength="80"></label><label>최소 전달률 (%)<input name="ratio" type="number" min="1" max="100" value="100"></label>${checkList('demandIds', topology.demands, '검증할 수요')}<button type="submit">서비스 추가</button><p class="editor-error"></p></form></section>
      <section><h3>장애 도메인</h3><ul>${domains}</ul><form class="editor-form" data-editor-form="failure-domain"><label>이름<input name="name" required maxlength="80"></label>${checkList('deviceIds', topology.devices, '함께 멈출 장비')}${checkList('linkIds', topology.links, '함께 멈출 링크')}<button type="submit">장애 도메인 추가</button><p class="editor-error"></p></form></section>
      <section><h3>랙</h3><ul>${racks}</ul><form class="editor-form" data-editor-form="rack"><label>이름<input name="name" required maxlength="80"></label><label>전력 예산 (W)<input name="power" type="number" min="1" required></label><label>공간 (U)<input name="units" type="number" min="1" required></label><label>전력 기준<select name="basis"><option value="nameplate">nameplate</option><option value="typical">typical</option><option value="measured">measured</option></select></label>${checkList('deviceIds', topology.devices, '랙 장비')}<button type="submit">랙 추가</button><p class="editor-error"></p></form></section>
      <section><h3>시나리오</h3><ul>${scenarios}</ul><form class="editor-form" data-editor-form="scenario"><label>이름<input name="name" required maxlength="80"></label><button type="submit">현재 장애·부하 저장</button><p class="editor-error"></p></form></section>
    </div>`);
}

function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

// 내보낸 그림은 화면과 같은 축을 골라 같은 값을 말해야 한다. 그래서 결과와 훑기를 함께 넘긴다.
function diagramSvg() {
  return exportDiagramSvg(topology, current, { sweep: sweepStale() ? null : sweep, exportedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') });
}

async function exportPng() {
  const svg = diagramSvg();
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
  if (action === 'workload') openWorkloadForm();
  if (action === 'connect') { state.editorMode = state.editorMode === 'connect' ? 'select' : 'connect'; state.connectSource = null; closeEditorPanel(); renderTopology(); renderEditorMode(); }
  if (action === 'save') saveProject();
  if (action === 'open') element('project-file-input').click();
  if (action === 'import-device') element('device-file-input').click();
  if (action === 'import-drawio') element('drawio-file-input').click();
  if (action === 'export-svg') { downloadText('rack-mesh-diagram.svg', diagramSvg(), 'image/svg+xml'); showToast('계산 결과와 판정을 찍은 SVG로 내보냈습니다.'); }
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

/**
 * 복제한 장비의 이름. 같은 이름이 둘이면 캔버스에서 구분이 안 되고, 인스펙터 제목도 어느
 * 쪽인지 말하지 못한다. 이미 복제가 있으면 번호를 올리고, 접미사는 한 번만 붙인다 —
 * 세 번 복제해서 "복제 복제 복제"가 되지 않게 한다.
 */
function duplicateName(name, selfId) {
  const base = String(name || '').replace(/\s*복제(\s*\d+)?$/, '').trim() || '장비';
  const taken = new Set(topology.devices.filter(({ id }) => id !== selfId).map((device) => device.name));
  if (!taken.has(`${base} 복제`)) return `${base} 복제`;
  for (let n = 2; n <= 99; n += 1) if (!taken.has(`${base} 복제 ${n}`)) return `${base} 복제 ${n}`;
  return `${base} 복제`;
}

/** 붙여넣은 장비에 이름을 준다. 클립보드와 오른쪽 버튼 메뉴가 같은 규칙을 쓰게 하는 자리다. */
function nameDuplicates(selection) {
  for (const { type, id } of selection) {
    if (type !== 'device') continue;
    const device = topology.devices.find((item) => item.id === id);
    if (device) device.name = duplicateName(device.name, id);
  }
}

// 오른쪽 버튼 메뉴. 항목은 이 도구가 실제로 하는 일만 담는다.
function contextItemsFor(resource, type) {
  const failed = type === 'device' ? state.disabledDevices.has(resource.id) : state.disabledLinks.has(resource.id);
  const items = [{ id: 'delete', label: '삭제', danger: true }];
  if (type === 'device') {
    // 장비를 바꾸는 것은 인스펙터까지 가지 않고 자리에서 하는 일이다. 그 클래스에 카탈로그가
    // 있을 때만 내놓는다 — 고를 것이 없는 항목을 띄우지 않는다.
    if (catalogFor(resource.kind).length) items.push({ id: 'swap', label: resource.spec ? '장비 바꾸기' : '장비 고르기' });
    items.push({ id: 'duplicate', label: '복제' }, { id: 'connect', label: '여기서 링크 시작' });
  }
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
    if (action === 'swap') { openDeviceSwapPicker(id); return; }
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
      // 클립보드와 같은 길을 쓴다. 손으로 필드를 옮기면 metadata·ports 처럼 빠뜨린 것이 생기고,
      // 두 번 복제할 때 id 가 겹쳐 실패했다. 물려 있던 자리도 여기서 함께 따라온다.
      const pasted = pasteSelection(topology, copySelection(topology, [{ type: 'device', id }]), { dx: 150, dy: 60 });
      topology = pasted.topology;
      nameDuplicates(pasted.selection);
      const copy = topology.devices.find((device) => device.id === pasted.selection[0]?.id);
      state.selectedId = copy?.id || id;
      state.selection = copy ? [{ type: 'device', id: copy.id }] : state.selection;
      commitTopology(`${copy?.name || '복제'}을 만들었습니다.`, undo('복제를 되돌렸습니다.'));
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

element('scale-input').addEventListener('input', (event) => { state.scale = Number(event.target.value) / 100; recalculate({ light: true }); });
element('scale-input').addEventListener('change', (event) => { state.scale = Number(event.target.value) / 100; recalculate(); });
element('failure-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-failure-id]');
  if (button) toggleFailure(button.dataset.failureType, button.dataset.failureId);
});
element('class-control').addEventListener('click', (event) => {
  const badge = event.target.closest('[data-class-badge]')?.dataset.classBadge;
  if (badge) {
    classView.badge = badge;
    try { localStorage.setItem('rack-mesh-class-badge', badge); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
    render();
    return;
  }
  const motion = event.target.closest('[data-number-motion]')?.dataset.numberMotion;
  if (!motion) return;
  motionView.drift = motion;
  try { localStorage.setItem('rack-mesh-number-motion', motion); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
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
element('guide-button').addEventListener('click', startTour);
element('tour').addEventListener('click', (event) => {
  const action = event.target.closest('[data-tour]')?.dataset.tour;
  if (!action || !tour) return;
  if (action === 'skip') { endTour(); return; }
  runTourStep(tour.index + (action === 'next' ? 1 : -1));
});
window.addEventListener('resize', () => { if (tour) placeTourSpot(); });
window.addEventListener('scroll', () => { if (tour) placeTourSpot(); }, true);
document.addEventListener('keydown', (event) => {
  if (!tour) return;
  if (event.key === 'Escape') { event.preventDefault(); endTour(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); runTourStep(tour.index + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); runTourStep(tour.index - 1); }
});
element('reset-button').addEventListener('click', () => { state.disabledDevices.clear(); state.disabledLinks.clear(); state.disabledDomains.clear(); state.scale = 1; element('scale-input').value = '100'; showToast('장애와 배율을 초기화했습니다.'); recalculate(); });
element('export-button').addEventListener('click', exportResult);
document.querySelector('.editor-tools').addEventListener('click', (event) => { const button = event.target.closest('[data-editor-action]'); if (button) handleEditorAction(button.dataset.editorAction); });
element('editor-close').addEventListener('click', closeEditorPanel);
element('editor-panel-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.editorForm === 'workload') {
      const mode = data.get('features_mode');
      const listed = String(data.get('features_enabled') || '').split(',').map((item) => item.trim()).filter(Boolean);
      const patch = Object.fromEntries(WORKLOAD_FIELDS.map(({ key, type }) => {
        const raw = String(data.get(key) || '').trim();
        return [key, raw === '' ? null : type === 'number' ? Number(raw) : raw];
      }));
      // '없음'과 '적지 않음'은 다른 뜻이다. 빈 목록은 방화벽만 켠 프로필과 맞출 수 있는 값이고,
      // 적지 않음은 대조할 수 없다는 뜻이다.
      patch.features_enabled = mode === 'none' ? [] : mode === 'list' ? listed : null;
      setWorkloadConditions(topology, patch);
      closeEditorPanel();
      commitTopology('워크로드 조건을 적용했습니다. 한계값의 적용 가능성을 다시 판정합니다.');
      return;
    }
    if (form.dataset.editorForm === 'device') {
      const template = form._deviceTemplate || {};
      const kind = data.get('kind');
      const limits = { ...(template.limits || {}) };
      for (const axis of deviceLimitAxes(kind)) limits[axis] = data.get(axis) || template.limits?.[axis] || null;
      const device = addDevice(topology, { id: template.deviceId, name: data.get('name'), kind, zone: data.get('zone'), position: template.position || nextDevicePosition(), limits, source: template.source, metadata: template.metadata, vendor: template.vendor, model: template.model });
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
      const demand = updateDemand(topology, form.dataset.demandId, { name: data.get('name'), source: data.get('source'), target: data.get('target'), backendPool: data.get('single') ? 'single' : 'auto', load: { forwarding_bps: data.get('forwarding_bps'), forwarding_pps: data.get('forwarding_pps') || 0, new_sessions_per_sec: data.get('new_sessions_per_sec') || 0, concurrent_sessions: data.get('concurrent_sessions') || 0 } });
      commitTopology(`Demand ${demand.name}을 수정했습니다.`); openDemandManager();
    }
    if (form.dataset.editorForm === 'service') {
      const demandIds = data.getAll('demandIds'); if (!demandIds.length) throw new Error('서비스에는 수요가 하나 이상 필요합니다.');
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
  if (event.target.id === 'swap-search') filterSwapChoices(event.target.value);
});
element('editor-panel-content').addEventListener('change', (event) => {
  const form = event.target.closest('form[data-editor-form="device"]');
  if (form && event.target.name === 'kind') renderDeviceLimitFields(form);
});
// 막대를 끌어 한계값을 정한다. 끄는 동안은 이 행만 고쳐 그린다 — 전체 재계산은 인스펙터를
// 다시 만들어 끌던 요소를 없애 버린다. 부하는 이 장비의 한계값에 좌우되지 않으므로(단일 통과
// offered load 모델) 끄는 동안의 미리보기는 실제 재계산과 같은 값을 낸다.
let axisDrag = null;

function axisLimitFrom(meter, clientX, fine) {
  const box = meter.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0.02, (clientX - box.left) / Math.max(box.width, 1)));
  return snapLimit(Number(meter.dataset.axisLoad) / ratio, fine);
}

function previewAxisLimit(meter, limit) {
  const row = meter.closest('.axis-row');
  const axis = meter.dataset.axisDrag;
  const load = Number(meter.dataset.axisLoad);
  const utilization = load / limit;
  const status = utilization > 1 + 1e-9 ? 'overloaded' : utilization >= (topology.warningThreshold ?? 0.8) ? 'warning' : 'healthy';
  row.className = `axis-row ${status}`;
  const percent = `${Math.max(2, utilization * 100)}%`;
  meter.style.setProperty('--axis-width', percent);
  meter.querySelector('span').style.setProperty('--axis-width', percent);
  meter.setAttribute('aria-valuenow', String(Math.round(utilization * 100)));
  // 상태 이름도 함께 바꾼다. 색만 주의로 바뀌고 글자가 정상으로 남으면 둘이 다른 말을 한다.
  const value = row.querySelector('[data-live-util]');
  value.textContent = formatPercent(utilization);
  value.dataset.liveUtil = String(utilization);
  value.previousSibling.textContent = `${stateLabel(status)} · `;
  row.querySelector(`[data-axis-limit="${axis}"]`).textContent = `${formatCompact(limit, axisCatalog[axis]?.unit)} limit`;
  const field = document.querySelector(`[data-resource-form="device"] input[name="${axis}"]`);
  if (field) field.value = String(limit);
}

// 데이터시트가 붙은 장비에서는 한계값 입력이 보정이다. 원본과 같은 값은 보정으로 남기지 않는다.
function applyAxisLimit(id, axis, limit) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) return;
  if (device.spec) setLimitOverride(topology, id, axis, limit === device.spec.limits[axis] ? null : limit);
  else updateDevice(topology, id, { limits: { ...device.limits, [axis]: limit } });
}

element('inspector-content').addEventListener('pointerdown', (event) => {
  const meter = event.target.closest('[data-axis-drag]');
  if (!meter || event.button !== 0) return;
  event.preventDefault();
  meter.setPointerCapture(event.pointerId);
  const limit = axisLimitFrom(meter, event.clientX, event.shiftKey);
  axisDrag = { meter, id: meter.dataset.axisResource, axis: meter.dataset.axisDrag, limit };
  meter.classList.add('dragging');
  if (limit) previewAxisLimit(meter, limit);
});

element('inspector-content').addEventListener('pointermove', (event) => {
  if (!axisDrag) return;
  const limit = axisLimitFrom(axisDrag.meter, event.clientX, event.shiftKey);
  if (!limit || limit === axisDrag.limit) return;
  axisDrag.limit = limit;
  previewAxisLimit(axisDrag.meter, limit);
});

for (const type of ['pointerup', 'pointercancel']) {
  element('inspector-content').addEventListener(type, () => {
    if (!axisDrag) return;
    const { id, axis, limit } = axisDrag;
    axisDrag.meter.classList.remove('dragging');
    axisDrag = null;
    if (!limit) { renderInspector(); return; }
    applyAxisLimit(id, axis, limit);
    commitTopology(`${resourceName(resourceById(id)) || id}의 ${axisCatalog[axis]?.label || axis} 한계를 ${withParticle(formatCompact(limit, axisCatalog[axis]?.unit), 'instrumental')} 정했습니다.`);
  });
}

// 키보드로도 같은 일을 할 수 있어야 한다. 한 칸은 1-2-5 사다리의 한 단계다.
element('inspector-content').addEventListener('keydown', (event) => {
  const meter = event.target.closest('[data-axis-drag]');
  if (!meter || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const id = meter.dataset.axisResource;
  const axis = meter.dataset.axisDrag;
  const device = topology.devices.find((item) => item.id === id);
  const current = device?.limits?.[axis];
  if (!(current > 0)) return;
  // 오른쪽은 사용률이 오르는 쪽이다. 화면에서 막대가 자라는 방향과 같다.
  const step = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 0.8 : 1.25;
  const next = snapLimit(current * step, event.shiftKey);
  if (!next || next === current) return;
  applyAxisLimit(id, axis, next);
  commitTopology(`${resourceName(resourceById(id)) || id}의 ${axisCatalog[axis]?.label || axis} 한계를 ${withParticle(formatCompact(next, axisCatalog[axis]?.unit), 'instrumental')} 정했습니다.`);
  document.querySelector(`[data-axis-drag="${axis}"][data-axis-resource="${id}"]`)?.focus();
});

element('inspector-content').addEventListener('click', (event) => {
  const demandTarget = event.target.closest('[data-demand-target]')?.dataset.demandTarget;
  if (demandTarget) { openDemandForm(demandTarget); return; }
  const accept = event.target.closest('[data-evidence-accept]');
  const release = event.target.closest('[data-evidence-release]');
  if (!accept && !release) return;
  const axis = (accept || release).dataset.evidenceAccept || (accept || release).dataset.evidenceRelease;
  const name = resourceName(resourceById(state.selectedId)) || state.selectedId;
  try {
    if (accept) { acceptEvidence(topology, state.selectedId, axis); commitTopology(`${name}의 ${axisCatalog[axis]?.label || axis} 한계값을 이 조건에서 쓰기로 했습니다.`); }
    else { clearEvidenceAcceptance(topology, state.selectedId, axis); commitTopology(`${name}의 ${axisCatalog[axis]?.label || axis} 수락을 취소했습니다.`); }
  } catch (error) { showToast(error.message); }
});

element('editor-panel-content').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-swap-catalog]');
  const detach = event.target.closest('[data-swap-detach]');
  if (choice || detach) {
    const id = state.selectedId;
    const name = resourceName(resourceById(id)) || id;
    try {
      if (detach) { applySpec(topology, id, null); closeEditorPanel(); commitTopology(`${name}의 데이터시트 값을 떼고 직접 입력으로 돌렸습니다.`); return; }
      const entry = catalogEntry(choice.dataset.swapCatalog);
      const profile = catalogProfile(entry.id, choice.dataset.swapProfile);
      applySpec(topology, id, { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model });
      closeEditorPanel();
      commitTopology(`${withParticle(name, 'object')} ${withParticle(`${entry.vendor} ${entry.model} · ${profile.label}`, 'instrumental')} 바꿨습니다.`);
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-workload-action="clear"]')) {
    setWorkloadConditions(topology, Object.fromEntries([...WORKLOAD_FIELDS.map(({ key }) => [key, null]), ['features_enabled', null]]));
    closeEditorPanel();
    commitTopology('워크로드 조건을 지웠습니다. 조건을 가진 한계값은 다시 미확인이 됩니다.');
    return;
  }
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
  try { removeDemand(topology, button.dataset.deleteDemand); commitTopology('트래픽 수요를 삭제했습니다.'); openDemandManager(); } catch (error) { showToast(error.message); }
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
      // 예전에는 여기서 conditionSelection: 'explicit-profile' 을 걸어 적용 판정을 통째로 건너뛰었다.
      // 프로필을 고른 것이 조건을 확인한 것과 같다고 친 셈이다. 이제 조건이 축마다 붙고 축 단위
      // 수락이 있으므로(P1-26·P1-27·P1-39) 그 대역은 필요 없다. 판정을 실제로 돌린다.
      applySpec(topology, id, { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model });
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
    else updateLink(topology, form.dataset.resourceId, { capacityBps: data.get('capacityBps'),
      // 방향 칸은 비대칭 회선에만 뜬다. 뜨지 않았으면 방향 덮어쓰기를 건드리지 않는다.
      ...(data.has('forwardBps') ? { capacityByDirection: Object.fromEntries(['forward', 'reverse']
        .map((direction) => [direction, data.get(`${direction}Bps`) ? { forwarding_bps: data.get(`${direction}Bps`) } : null])) } : {}) });
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
    nameDuplicates(pasted.selection);
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
  if (['fault-device', 'fault-link', 'scale'].includes(button.dataset.lessonAction)) lessonRevealed = true;
  if (button.dataset.lessonAction === 'fault-device') { state.disabledDevices.add(button.dataset.lessonId); setLeftPanel('failure'); recalculate(); }
  if (button.dataset.lessonAction === 'scale') { state.scale = Number(button.dataset.lessonValue); element('scale-input').value = String(state.scale * 100); recalculate(); }
  if (button.dataset.lessonAction === 'workload') openWorkloadForm();
  if (button.dataset.lessonAction === 'select-device') { state.selectedId = button.dataset.lessonId; renderTopology(); renderInspector(); }
  if (button.dataset.lessonAction === 'fault-link') { state.disabledLinks.add(button.dataset.lessonId); setLeftPanel('failure'); recalculate(); }
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
    paletteDrag.ghost.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#${symbolFor(paletteDrag.kind).id}"></use></svg>`;
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
    baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario); current = calculateScenario(topology, scenarioOptions()); sweep = sweepSingleFaults(topology, { scale: state.scale }); sweepScale = state.scale;
    documentHistory.reset(topology); element('scale-input').value = String(state.scale * 100);
  }
} catch { try { localStorage.removeItem('rack-mesh-working-copy'); } catch { /* 저장소 접근 자체가 막힌 환경 */ } }
renderPalette();
setLeftPanel(state.leftPanel);
render();
centerCanvas();
startTelemetry();
