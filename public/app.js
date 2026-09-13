import { axisCatalog, behaviorCatalog, cloneTopology, failureDomainKinds } from './data.js';
import { calculateScenario, calculateSurvivalMultiplier, compareScenarios, createExport, createFailureDomainSweepTask, createSingleFaultSweepTask, createSurvivalMultiplierTask, ENGINE_VERSION, sweepFailureDomains, sweepSingleFaults } from './engine.js';
import { acceptEvidence, addDemand, addDevice, addLink, applySpec, applySpecToKind, clearEvidenceAcceptance, moveDevice, normalizeId, promoteConnector, removeDemand, removeDevice, removeLink, setLimitOverride, setWorkloadConditions, updateDemand, updateDevice, updateLink } from './editor.js';
import { importDeviceDefinition } from './device-import.js';
import { applyMeasuredLimits, applyObservedLoad, buildObservedLoadValidationReport, compareTopologyFingerprint, fingerprintMatches, importMeasuredLimits, importObservedLoad, importZabbixObservedLoad, OBSERVED_LOAD_STALE_AFTER_DAYS, observedLoadIsStale } from './measured-import.js';
import { parseProject, serializeProject } from './project.js';
import { buildNamedScenarioServiceVerdicts, buildReportModel, renderReportHtml, renderReportJson, renderReportMarkdown } from './report.js';
import { GLYPHS, GLYPH_SPRITE } from './glyphs.js';
import { behaviorToken, cardBox, formatNodeValue, groupBoxes, GROUP_PAD, kindInitial, LINK_ROUTES, linkPath, nodeAxes, nodeAxisLabel, NODE_REACH, nodeView, packetMotion, placeLinkLabels, routeLink, segmentHitsBox, sourceDriftFactor, STATE_TOKEN, symbolFor, zonePath } from './node-view.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS, ICON_SPRITE } from './icons.js';
import { vendorLogoFor } from './logos.js';
import { buildTemplate, templateGroups, templates } from './templates.js';
import { buildSpec, catalogEntry, catalogFor, catalogProfile } from './devices/catalog.js';
import { addConnector, addShape, alignSelection, copySelection, distributeSelection, exportDiagramSvg, groupSelection, importDrawio, moveSelection, pasteSelection, removeDiagramElements, retargetConnector, ungroupSelection, updateConnector, updateGroup, updateShape } from './diagram.js';
import { applyDrawioImport, createDrawioEdgeRenderContext, createDrawioPreview, parseDrawioDocument, renderDrawioEdgeSvg, renderDrawioPageSvg, renderDrawioVisualSvg } from './drawio-import.js';
import { createHistory } from './history.js';
import { acceptanceDigest, evidenceApplicability } from './evidence.js';
import { addMappedPlacement, addStandalonePlacement, createRack, firstFreeStartU, materializeRack, nearestFreeStartU, placementHeight, placementView, rackPlacements, rackSummary, removePlacement, removeRack, updatePlacement } from './rack.js';

let topology = cloneTopology();
const state = { scale: 1, selectedId: 'fw-a', selection: [{ type: 'device', id: 'fw-a' }], disabledDevices: new Set(), disabledLinks: new Set(), disabledDomains: new Set(), namedScenarios: [], editorMode: 'select', connectSource: null, leftPanel: 'palette', zoom: 1, viewMode: 'edit', workspace: 'topology', leftPanelCollapsed: false, rightPanelCollapsed: false };
const FAILURE_DOMAIN_KIND_LABEL = Object.freeze({ power: '전원', space: '공간', path: '경로', firmware: '펌웨어', site: '사이트', other: '기타' });
let panelSelectionExplicit = false;
let comparisonDemandId = null;
let baselineSnapshot = { topology: structuredClone(topology), scenario: { scale: 1, disabledDevices: [], disabledLinks: [], disabledDomains: [] } };
let baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario);
let current = baseline;
// 첫 화면에는 현재 시나리오만 필요하다. 전수 장애 분석은 화면을 그린 뒤 시작한다.
let sweep = { resources: [], worstAxes: [], severs: 0, overloads: 0, absorbs: 0, bounded: 0, endpoints: 0, grade: 'unknown' };
let survival = { status: 'calculating', multiplier: null, worstFault: null, bounded: false, unresolvedCount: 0, endpointIds: [], evaluated: 0, candidates: 0, services: [] };
let domainSweep = { singles: [], pairs: [], redundancyInvalid: [], evaluated: 0, domainCount: 0 };
let swapPreview = null;
let swapTarget = null;
let swapComparison = [];
let absorbsExpanded = false;
let drawioPreview = null;
let drawioDragDepth = 0;
let resourceAbsorbsExpanded = false;
let worstAxesExpanded = false;
const failureFilter = { query: '', verdict: 'all' };
// 단일 장애 스윕은 수백 개 후보를 만들 수 있다. 실제 행 높이를 고정해 창 밖의 버튼을 DOM 에
// 두지 않고도 스크롤 높이와 키보드 순서를 보존한다.
const FAILURE_VIRTUAL_ROW_HEIGHT = 52;
const FAILURE_VIRTUAL_THRESHOLD = 24;
const FAILURE_VIRTUAL_OVERSCAN = 8;
const failureVirtual = { groups: new Map(), frame: null };
const PROGRESSIVE_SWEEP_THRESHOLD = 20;
// 큰 설계에서 후보 하나가 수 ms 걸릴 수 있다. 네 개씩 양보하면 한 작업이 한 프레임을 오래 막지 않는다.
const PROGRESSIVE_SWEEP_BATCH_SIZE = 4;
let analysisProgress = null;
let analysisRun = 0;
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
let annotationSource = null;
let suppressNodeClick = false;
const SHAPE_MIN_SIZE = 24;
const SHAPE_COORD_LIMIT = 1e6;
const SHAPE_DRAW_DEFAULTS = {
  rect: { width: 180, height: 90, text: '그룹', fill: '#ffffff', stroke: '#13241f', textColor: '#13241f' },
  ellipse: { width: 180, height: 90, text: '영역', fill: '#ffffff', stroke: '#13241f', textColor: '#13241f' },
  text: { width: 160, height: 44, text: '설명', fill: 'none', stroke: 'none', textColor: '#13241f' },
};
const SHAPE_COLOR_PALETTE = ['#ffffff', '#f5f5f5', '#d9d9d9', '#808080', '#000000', '#f8cecc', '#fff2cc', '#d5e8d4', '#dae8fc', '#e1d5e7', '#f5f5dc', '#b8e737', '#087d70', '#587d00', '#9a5a00', '#b83c34', '#16332d', '#526e64'];
let shapeInspectorTab = 'style';
let shapeStyleClipboard = null;
let telemetryTimer;
const telemetryHistory = new Map();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobileLayout = window.matchMedia('(max-width: 760px)');
let previousBindingKey = null;
const teaserTimers = new Set();
let teaserActive = false;
let restoredWorkingCopy = false;
let spatialScene = null;
let rackScene = null;
let spatialScenePromise = null;
let rackScenePromise = null;
const rackView = { mode: '2d', face: 'front', cables: true, sidebarTab: 'devices', selectedRackId: null, selectedPlacementId: null };
const RACK_EQUIPMENT = [
  { kind: 'server', name: 'SERVER', label: '서버', uHeight: 2, powerWatts: null },
  { kind: 'switch', name: 'NETWORK SWITCH', label: '네트워크 스위치', uHeight: 1, powerWatts: null },
  { kind: 'patch-panel', name: 'PATCH PANEL', label: '패치 패널', uHeight: 1, powerWatts: 0 },
  { kind: 'pdu', name: 'PDU', label: 'PDU', uHeight: 1, powerWatts: 0 },
  { kind: 'cable-management', name: 'CABLE MANAGER', label: '케이블 관리대', uHeight: 1, powerWatts: 0 },
];
let rackPaletteDrag = null;
let rackDragPreviewFrame = null;
let rackDropPreviewKey = '';

const element = (id) => document.getElementById(id);
if (mobileLayout.matches) document.querySelector('.view-settings')?.removeAttribute('open');
const formatPercent = (value, signed = false) => value == null ? '미확인' : `${signed && value > 0 ? '+' : ''}${Math.round(value * 100)}%`;
// reference 는 자릿수와 단위를 정하는 기준이다. 떨리는 값이 그것까지 정하면 1 Gbps 언저리에서
// Mbps 와 Gbps 를 오가며 글자 수가 바뀐다. 값만 흔들리고 모양은 고정돼야 읽힌다.
const formatCompact = (value, unit, reference = value) => {
  if (value == null) return '미확인';
  const anchor = reference ?? value;
  if (unit === 'bps') return anchor >= 1e9 ? `${(value / 1e9).toFixed(anchor >= 10e9 ? 0 : 1)} Gbps` : `${(value / 1e6).toFixed(0)} Mbps`;
  if (unit === 'pps') return anchor >= 1e6 ? `${(value / 1e6).toFixed(2)} Mpps` : `${(value / 1e3).toFixed(0)} Kpps`;
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
  if (!light) startAnalysis();
  render();
  updateTelemetry();
  if (!light) persistWorkingCopy();
}

function startAnalysis() {
  analysisRun += 1;
  const run = analysisRun;
  const options = { scale: state.scale };
  const candidates = topology.devices.length + topology.links.length;
  if (candidates <= PROGRESSIVE_SWEEP_THRESHOLD) {
    analysisProgress = null;
    sweep = sweepSingleFaults(topology, options);
    survival = calculateSurvivalMultiplier(topology, { ...options, sweep });
    domainSweep = sweepFailureDomains(topology, { ...options, sweep });
    sweepScale = state.scale;
    return;
  }
  sweep = { resources: [], severs: 0, overloads: 0, absorbs: 0, bounded: 0, endpoints: 0, grade: 'unknown' };
  survival = { status: 'calculating', multiplier: null, worstFault: null, bounded: false, unresolvedCount: 0, endpointIds: [], evaluated: 0, candidates: 0, services: [] };
  domainSweep = { singles: [], pairs: [], redundancyInvalid: [], evaluated: 0, domainCount: (topology.failureDomains || []).length };
  const singleTask = createSingleFaultSweepTask(topology, options);
  analysisProgress = { label: '단일 장애 스윕', completed: 0, total: singleTask.total };
  const advance = () => {
    if (run !== analysisRun) return;
    singleTask.step(PROGRESSIVE_SWEEP_BATCH_SIZE);
    analysisProgress = { label: '단일 장애 스윕', completed: singleTask.completed, total: singleTask.total };
    if (!singleTask.done) { renderAnalysisProgress(); scheduleAnalysis(advance); return; }
    sweep = singleTask.result;
    const survivalTask = createSurvivalMultiplierTask(topology, { ...options, sweep });
    const advanceSurvival = () => {
      if (run !== analysisRun) return;
      survivalTask.step(PROGRESSIVE_SWEEP_BATCH_SIZE);
      analysisProgress = { label: '생존 배수', completed: survivalTask.completed, total: survivalTask.total };
      if (!survivalTask.done) { renderAnalysisProgress(); scheduleAnalysis(advanceSurvival); return; }
      survival = survivalTask.result;
      const domainTask = createFailureDomainSweepTask(topology, { ...options, sweep });
      const advanceDomains = () => {
        if (run !== analysisRun) return;
        domainTask.step(PROGRESSIVE_SWEEP_BATCH_SIZE);
        analysisProgress = { label: '장애 도메인 스윕', completed: domainTask.completed, total: domainTask.total };
        if (!domainTask.done) { renderAnalysisProgress(); scheduleAnalysis(advanceDomains); return; }
        domainSweep = domainTask.result;
        sweepScale = state.scale;
        analysisProgress = null;
        render();
        updateTelemetry();
        persistWorkingCopy();
      };
      scheduleAnalysis(advanceDomains);
    };
    scheduleAnalysis(advanceSurvival);
  };
  scheduleAnalysis(advance);
}

function scheduleAnalysis(callback) {
  // requestIdleCallback 은 애니메이션이 있는 화면에서 매 단계가 timeout 까지 밀릴 수 있다.
  // 한 묶음 뒤 이벤트 루프로 넘기면 입력과 그리기는 살리면서 다음 계산은 바로 시작한다.
  setTimeout(callback, 0);
}

function renderAnalysisProgress() {
  // 전수 분석의 중간값은 요약과 장애 패널에만 영향을 준다. 캔버스 전체를 다시 만들지 않는다.
  renderSummary();
  renderFailures();
}

function resetScenario() {
  cancelTeaser();
  state.disabledDevices.clear(); state.disabledLinks.clear(); state.disabledDomains.clear(); state.scale = 1; state.connectSource = null;
  element('scale-input').value = '100';
  if (!topology.devices.some(({ id }) => id === state.selectedId) && !topology.links.some(({ id }) => id === state.selectedId)) state.selectedId = topology.devices[0]?.id || null;
  recalculate();
}

function commitTopology(message) {
  documentHistory.record(topology, message);
  recalculate();
  showToast(message);
}

function commitRack(message) {
  documentHistory.record(topology, message);
  current = calculateScenario(topology, scenarioOptions());
  renderRackWorkspace();
  persistWorkingCopy();
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
  const prior = state.selection[0];
  const shapeExists = prior?.type === 'shape' && topology.diagram?.shapes?.some(({ id }) => id === prior.id);
  const connectorExists = prior?.type === 'connector' && topology.diagram?.connectors?.some(({ id }) => id === prior.id);
  const groupExists = prior?.type === 'group' && topology.diagram?.groups?.some(({ id }) => id === prior.id);
  if (shapeExists || connectorExists || groupExists) state.selection = [prior];
  else {
    state.selectedId = topology.devices.some(({ id }) => id === state.selectedId) ? state.selectedId : topology.devices[0]?.id || null;
    state.selection = state.selectedId ? [{ type: 'device', id: state.selectedId }] : [];
  }
  if (state.workspace === 'rack') { current = calculateScenario(topology, scenarioOptions()); renderRackWorkspace(); persistWorkingCopy(); }
  else recalculate();
  showToast(direction === 'undo' ? '이전 편집으로 돌아갔습니다.' : '편집을 다시 적용했습니다.');
}

function persistWorkingCopy() {
  try {
    localStorage.setItem('rack-mesh-working-copy', serializeProject(topology, { ...state, baseline: baselineSnapshot }));
  } catch {
    if (!persistenceWarningShown) { persistenceWarningShown = true; showToast('자동 저장을 사용할 수 없습니다. 프로젝트 저장으로 작업을 보관하세요.'); }
  }
}

// 한글은 종성으로, 숫자와 영문은 한국어 독음으로 조사를 고른다. 발음이 불명확한 입력은
// 조사를 생략하는 문장에서 쓴다. 종성 ㄹ 은 '으로'가 아니라 '로'를 쓴다.
const PARTICLES = { subject: ['이', '가'], object: ['을', '를'], topic: ['은', '는'], comitative: ['과', '와'], instrumental: ['으로', '로'] };
const DIGIT_HAS_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']);
const LATIN_HAS_BATCHIM = new Set(['L', 'M', 'N', 'R']);
function withParticle(word, kind) {
  const [withBatchim, without] = PARTICLES[kind];
  const value = String(word);
  const lastChar = value.at(-1) || '';
  const last = lastChar.codePointAt(0);
  const coda = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : null;
  const hasBatchim = coda == null ? (DIGIT_HAS_BATCHIM.has(lastChar) || LATIN_HAS_BATCHIM.has(lastChar.toUpperCase())) : coda !== 0;
  return `${value}${hasBatchim && !(coda === 8 && kind === 'instrumental') ? withBatchim : without}`;
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
  if (current.summary.droppedLoadBps > 0) parts.push(`용량 병목에서 ${formatCompact(current.summary.droppedLoadBps, 'bps')}가 드롭됩니다.`);
  if (current.summary.refusedSessionsPerSec > 0) parts.push(`신규 세션 ${formatCompact(current.summary.refusedSessionsPerSec, 'cps')}가 거절됩니다. 이미 맺힌 연결은 계속 흐릅니다.`);
  if (current.summary.unreachableCount > 0) parts.push(`경로 단절로 ${formatCompact(current.summary.unreachableLoadBps, 'bps')}가 미전달되고 demand ${current.summary.unreachableCount}개가 끊겼습니다.`);
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

// 캔버스 제목은 질문이 아니라 답이어야 한다. 이 설계가 몇 배까지 버티는지를 문장으로 말하고,
// 어디가 먼저 막히는지는 바로 아래 한 줄에 붙인다. 예전에는 같은 사실이 상단 판정 바, 요약
// 스트립, 이 카드, 캔버스 아래 서술까지 네 곳에 적혀 상단이 글씨로 꽉 찼다. 답을 말하는
// 자리는 캔버스를 보는 눈이 이미 가 있는 여기 하나면 된다.
function renderHeadline(binding) {
  const { summary } = current;
  const heading = element('topology-heading');
  const detail = element('headline-detail');
  // 판정을 시작할 수 없는 상황은 병목이 없다. 자원 이름과 사용률 줄 대신 문장 하나만 넣는다.
  const say = (text, tone, note) => { heading.textContent = text; heading.dataset.tone = tone; detail.replaceChildren(note); };

  if (summary.evaluationStatus === 'invalid') {
    say('입력 오류가 있어 판정할 수 없습니다', 'danger', '값을 고치면 다시 계산합니다.');
    return;
  }
  if (summary.evaluationStatus === 'not-ready') {
    say('아직 판정을 시작할 수 없습니다', 'unknown', '서비스 수요 또는 검증 대상이 없습니다.');
    return;
  }
  if (!binding) {
    say('한계를 아는 축이 없습니다', 'unknown', '장비를 눌러 한계값을 넣으면 어디가 먼저 차는지 계산합니다.');
    return;
  }

  const axisKey = summary.bindingAxis;
  const axis = binding.axes[axisKey];
  const catalog = axisCatalog[axisKey] || { label: axisKey, unit: '' };
  const direction = binding.bindingDirection ? `${binding.bindingDirection === 'forward' ? '정방향 ' : '역방향 '}` : '';
  const rung = summary.growthLadder?.rungs?.[0];

  const lead = summary.overloadedCount > 0 ? '지금 부하에서 이미 용량을 넘었습니다'
    : summary.growthLadder?.indeterminate ? '몇 배까지 버티는지 계산할 수 없습니다'
      : rung ? `지금 부하의 ${rung.breachScale.toFixed(2)}배까지 버팁니다`
        : '한계를 아는 축에서는 더 막히는 지점이 없습니다';
  heading.textContent = lead;
  heading.dataset.tone = axis.status === 'overloaded' ? 'danger' : axis.status === 'warning' ? 'amber' : 'signal-deep';

  // 아래 줄은 캔버스에서 강조된 그 자원을 가리킨다. 다음에 넘는 자원이 따로면 이름을 덧붙인다.
  const suffix = AXIS_UNIT_SUFFIX[catalog.unit] || '';
  const scale = `${formatCompact(axis.load, catalog.unit)} / ${formatCompact(axis.limit, catalog.unit)}${suffix}`;
  const rungName = rung && rung.resourceId !== binding.id
    ? `다음 병목 ${resourceName(resourceById(rung.resourceId) || { id: rung.resourceId })} · ${axisCatalog[rung.axis]?.shortLabel || rung.axis}`
    : '';
  // 두 줄을 엘리먼트로 나눠 둔다. 줄바꿈 문자 하나로 붙여 white-space: pre-line 에
  // 맡기면 두 사실을 다른 크기로 보여줄 방법이 없다. 병목 자원은 한 번 보면 되는
  // 이름이고, 사용률은 눈이 몇 번이든 다시 돌아오는 숫자다.
  const where = document.createElement('span');
  where.className = 'headline-binding';
  const caption = document.createElement('em');
  caption.textContent = summary.overloadedCount > 0 ? '넘긴 곳' : '가장 빠듯한 곳';
  where.append(caption, `${resourceName(binding)} · ${direction}${catalog.label}`);

  const measure = document.createElement('span');
  measure.className = 'headline-measure';
  const utilization = document.createElement('b');
  utilization.textContent = formatPercent(axis.utilization);
  measure.append(`${scale} · `, utilization);
  if (rungName) measure.append(` · ${rungName}`);

  detail.replaceChildren(where, measure);
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
    + group('미확정 표시', 'number-motion', motionView.drift, [['off', '끔'], ['on', '켬']])
    + group('표시 정보', 'node-detail', detailView.level, [['off', '구성도'], ['brief', '요약'], ['full', '전체']])
    + group('선', 'link-route', routeView.mode, [['straight', '직선'], ['orthogonal', '직각'], ['curved', '곡선']]);
  element('export-view-state').textContent = `이미지는 현재 캔버스 보기(${({ off: '구성도', brief: '요약', full: '전체' })[detailView.level]})를 따릅니다.`;
}

function applyTopologyView() {
  const panel = document.querySelector('.topology-panel');
  const stage = element('topology-stage');
  panel.dataset.topologyViewMode = topologyView.mode;
  document.querySelector('.topology-scroll').setAttribute('aria-label', topologyView.mode === 'spatial' ? '3D 토폴로지. 빈 곳을 드래그하여 회전합니다.' : '토폴로지 도면');
  stage.style.setProperty('--spatial-pitch', `${topologyView.pitch}deg`);
  stage.style.setProperty('--spatial-yaw', `${topologyView.yaw}deg`);
  element('spatial-view-tools').hidden = topologyView.mode !== 'spatial';
  element('spatial-webgl').hidden = topologyView.mode !== 'spatial';
  for (const button of document.querySelectorAll('[data-topology-view]')) {
    const active = button.dataset.topologyView === topologyView.mode;
    button.setAttribute('aria-pressed', String(active));
  }
}

function setTopologyView(mode) {
  if (!TOPOLOGY_VIEW_MODES.has(mode) || topologyView.mode === mode) return;
  topologyView.mode = mode;
  try { localStorage.setItem('rack-mesh-topology-view', mode); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
  applyTopologyView();
  renderTopology();
  const stage = element('topology-stage');
  stage.classList.remove('view-enter');
  if (!reducedMotion.matches) { void stage.offsetWidth; stage.classList.add('view-enter'); }
  syncSpatialScene();
  if (mode === 'spatial') showToast('3D 공간 · 빈 곳을 드래그해 시점을 회전합니다.');
}

async function ensureSpatialScene() {
  if (spatialScene) return spatialScene;
  spatialScenePromise ??= import('./spatial-3d.js').then(({ createSpatialScene }) => {
    spatialScene = createSpatialScene({
      host: element('spatial-webgl'), canvas: element('spatial-webgl-canvas'), labels: element('spatial-webgl-labels'),
      onSelect: (id) => { handleNodeSelection(id); syncSpatialScene(); },
      initialView: { pitch: topologyView.pitch, yaw: topologyView.yaw, distance: topologyView.distance }, reducedMotion: reducedMotion.matches,
      onViewChange: ({ pitch, yaw, distance }) => {
        topologyView.pitch = pitch; topologyView.yaw = yaw; topologyView.distance = distance;
        try { localStorage.setItem('rack-mesh-spatial-pitch', String(pitch)); localStorage.setItem('rack-mesh-spatial-yaw', String(yaw)); localStorage.setItem('rack-mesh-spatial-distance', String(distance)); } catch { /* 저장이 막혀도 현재 시점은 유지한다 */ }
      },
    });
    window.__rackMeshSpatial3D = spatialScene; return spatialScene;
  }).catch((error) => { spatialScenePromise = null; showToast(`3D 보기를 불러오지 못했습니다: ${error.message}`); throw error; });
  return spatialScenePromise;
}

function syncSpatialScene() {
  if (state.workspace === 'rack' || topologyView.mode !== 'spatial') { spatialScene?.stop(); return; }
  ensureSpatialScene().then((scene) => { if (state.workspace !== 'rack' && topologyView.mode === 'spatial') { scene.update({ devices: current.devices, links: current.links, selectedId: state.selectedId }); scene.start(); } }).catch(() => {});
}

function setSpatialView(pitch, yaw, { persist = true } = {}) {
  const previous = { pitch: topologyView.pitch, yaw: topologyView.yaw };
  const next = { pitch: Math.min(70, Math.max(28, pitch)), yaw };
  topologyView.pitch = next.pitch;
  topologyView.yaw = next.yaw;
  applyTopologyView();
  spatialScene?.orbit((next.yaw - previous.yaw) * Math.PI / 180, (next.pitch - previous.pitch) * Math.PI / 180);
  if (!persist) return;
  try {
    localStorage.setItem('rack-mesh-spatial-pitch', String(topologyView.pitch));
    localStorage.setItem('rack-mesh-spatial-yaw', String(topologyView.yaw));
  } catch { /* 저장이 막혀도 이번 세션 시점은 유지한다 */ }
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
  const target = quickFailureTarget();
  const forecast = target && (target.type === 'domain'
    ? domainSweep.singles.find(({ id }) => id === target.id)
    : sweep.resources.find(({ id }) => id === target.id));
  const experiment = target ? {
    prompt: target.reason + ': ' + target.label + '를 끄면 어떻게 될까요?',
    action: { type: 'fault-' + target.type, id: target.id, label: target.label + ' 장애 실험' },
    observe: forecast ? faultForecast(forecast, { includeBoundary: true }) : '장애 결과를 계산합니다.',
  } : lesson.experiment;
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
  applyTopologyView();
  renderLearningPanel();
  syncLiveNumbers();
  syncSpatialScene();
  if (state.workspace === 'rack') renderRackWorkspace();
  const bindingKey = current.summary.bindingResourceId && `${current.summary.bindingResourceId}:${current.summary.bindingAxis}`;
  if (previousBindingKey && bindingKey && previousBindingKey !== bindingKey && !reducedMotion.matches) {
    const node = document.querySelector(`[data-device-id="${CSS.escape(current.summary.bindingResourceId)}"]`);
    if (node) { node.classList.remove('binding-pulse'); void node.offsetWidth; node.classList.add('binding-pulse'); }
  }
  previousBindingKey = bindingKey;
  document.querySelector('[data-editor-action="undo"]').disabled = !documentHistory.canUndo;
  document.querySelector('[data-editor-action="redo"]').disabled = !documentHistory.canRedo;
}

function currentRack() { return (topology.racks || []).find(({ id }) => id === rackView.selectedRackId) || null; }
function selectedRackPlacement() {
  const rack = currentRack();
  return rack ? rackPlacements(topology, rack).find(({ id }) => id === rackView.selectedPlacementId) || null : null;
}
function topologyDevicePlaced(id) { return (topology.racks || []).some((rack) => rackPlacements(topology, rack).some(({ deviceId }) => deviceId === id)); }

function renderRackEquipmentPalette() {
  // 이 노드가 pointer capture를 소유한다. 드래그 중 교체하면 브라우저가 배치를 취소한다.
  if (rackPaletteDrag) return;
  const available = topology.devices.filter(({ id }) => !topologyDevicePlaced(id));
  const mapped = available.length ? available.map((device) => {
    const height = placementHeight(topology, { deviceId: device.id });
    return `<button type="button" class="rack-palette-item" data-rack-palette-type="mapped" data-rack-device-id="${escapeAttribute(device.id)}" data-rack-height="${height}"><span class="rack-palette-symbol"><svg aria-hidden="true"><use href="#${symbolFor(device.kind).id}"></use></svg></span><span><strong>${escapeText(device.name)}</strong><small>${escapeText(device.kind)} · ${height}U · 토폴로지</small></span></button>`;
  }).join('') : '<p class="rack-palette-empty">배치하지 않은 토폴로지 장비가 없습니다.</p>';
  const standalone = RACK_EQUIPMENT.map((item) => `<button type="button" class="rack-palette-item" data-rack-palette-type="standalone" data-rack-kind="${escapeAttribute(item.kind)}" data-rack-name="${escapeAttribute(item.name)}" data-rack-height="${item.uHeight}" data-rack-power="${item.powerWatts ?? ''}"><span class="rack-palette-symbol"><svg aria-hidden="true"><use href="#${symbolFor(item.kind).id}"></use></svg></span><span><strong>${escapeText(item.label)}</strong><small>${item.uHeight}U · 랙 전용</small></span></button>`).join('');
  element('rack-equipment-palette').innerHTML = `<section><h3>토폴로지 장비 <span>${available.length}</span></h3>${mapped}</section><section><h3>랙 전용 장비</h3>${standalone}</section>`;
}

function renderRackList() {
  const racks = topology.racks || [];
  if (!racks.some(({ id }) => id === rackView.selectedRackId)) rackView.selectedRackId = racks[0]?.id || null;
  element('rack-list').innerHTML = racks.length ? racks.map((rack) => {
    const summary = rackSummary(topology, rack);
    const power = summary.powerWatts == null ? '전력 미확인' : `${Math.round(summary.powerWatts)} / ${rack.powerBudgetWatts} W`;
    return `<button type="button" data-rack-select="${escapeAttribute(rack.id)}" aria-pressed="${rack.id === rackView.selectedRackId}"><strong>${escapeText(rack.name)}</strong><span>${summary.placements.length}대</span><small>${summary.usedU} / ${rack.capacityU}U · ${escapeText(power)}</small></button>`;
  }).join('') : '<p class="panel-note">등록된 랙이 없습니다.</p>';
}

function renderRackElevations() {
  element('rack-2d-canvas').innerHTML = (topology.racks || []).map((rack) => {
    const summary = rackSummary(topology, rack);
    const power = summary.powerWatts == null ? '전력 미확인' : `${Math.round(summary.powerWatts)} / ${rack.powerBudgetWatts} W`;
    const marks = Array.from({ length: rack.capacityU }, (_, index) => index + 1).filter((unit) => unit === 1 || unit === rack.capacityU || unit % 5 === 0).map((unit) => `<span style="bottom:calc((${unit} - .5) * var(--rack-u))">${unit}U</span>`).join('');
    const devices = summary.placements.map((view) => `<button type="button" class="rack-device" data-rack-id="${escapeAttribute(rack.id)}" data-rack-placement="${escapeAttribute(view.id)}" data-mapped="${view.mapped}" data-active="${view.active}" aria-pressed="${rack.id === rackView.selectedRackId && view.id === rackView.selectedPlacementId}" style="--rack-start:${view.startU};--rack-height:${view.uHeight}"><strong>${escapeText(view.name)}</strong><span>U${view.startU}–${view.startU + view.uHeight - 1}</span>${view.uHeight > 1 ? `<small>${escapeText(view.model || view.kind)}${view.mapped ? ' · 토폴로지 연결' : ''}</small>` : ''}</button>`).join('');
    return `<section class="rack-elevation-wrap"><header class="rack-elevation-head"><strong>${escapeText(rack.name)}</strong><span>${summary.usedU}/${rack.capacityU}U</span><small>${escapeText(power)} · 여유 ${summary.remainingU}U</small></header><div class="rack-elevation" data-rack-id="${escapeAttribute(rack.id)}" style="--rack-capacity:${rack.capacityU}"><div class="rack-u-labels">${marks}</div>${devices}</div><span class="rack-rail-label">FRONT ELEVATION</span></section>`;
  }).join('');
}

async function ensureRackScene() {
  if (rackScene) return rackScene;
  rackScenePromise ??= import('./rack-3d.js').then(({ createRackScene }) => { rackScene = createRackScene({ host: element('rack-3d-stage'), canvas: element('rack-3d-canvas'), reducedMotion: reducedMotion.matches, onSelect: ({ rackId, placementId }) => { rackView.selectedRackId = rackId; rackView.selectedPlacementId = placementId; renderRackWorkspace(); } }); window.__rackMeshRack3D = rackScene; return rackScene; })
    .catch((error) => { rackScenePromise = null; showToast(`랙 3D 보기를 불러오지 못했습니다: ${error.message}`); throw error; });
  return rackScenePromise;
}
function syncRackScene() {
  if (state.workspace !== 'rack' || rackView.mode !== '3d' || !(topology.racks || []).length) { rackScene?.stop(); return; }
  ensureRackScene().then((scene) => { if (state.workspace === 'rack' && rackView.mode === '3d') { scene.update({ racks: topology.racks.map((rack) => ({ rack, placements: rackPlacements(topology, rack).map((placement) => placementView(topology, placement)) })), links: current.links, selectedPlacementId: rackView.selectedPlacementId, showCables: rackView.face === 'rear' && rackView.cables }); scene.setFace(rackView.face); scene.start(); } }).catch(() => {});
}

function renderRackInspector() {
  const rack = currentRack(); const placement = selectedRackPlacement(); const target = element('rack-inspector-content');
  if (!rack) { target.innerHTML = '<p class="panel-note">랙을 추가해 시작하세요.</p>'; return; }
  const summary = rackSummary(topology, rack);
  if (!placement) {
    target.innerHTML = `<div class="rack-inspector-summary"><span>장비</span><strong>${summary.placements.length}대</strong><span>공간</span><strong>${summary.usedU} / ${rack.capacityU}U</strong><span>전력</span><strong>${summary.powerWatts == null ? '미확인' : `${Math.round(summary.powerWatts)} / ${rack.powerBudgetWatts} W`}</strong></div><form data-rack-form="rack-edit"><label>랙 이름<input name="name" maxlength="80" required value="${escapeAttribute(rack.name)}"></label><label>공간 (U)<input name="capacityU" type="number" min="1" max="100" required value="${rack.capacityU}"></label><label>전력 예산 (W)<input name="power" type="number" min="1" required value="${rack.powerBudgetWatts}"></label><label>전력 기준<select name="basis"><option value="nameplate"${rack.powerBasis === 'nameplate' ? ' selected' : ''}>명판값</option><option value="typical"${rack.powerBasis === 'typical' ? ' selected' : ''}>일반 부하</option><option value="measured"${rack.powerBasis === 'measured' ? ' selected' : ''}>실측</option></select></label><div class="rack-inspector-actions"><button type="submit">랙 저장</button><button type="button" data-rack-action="delete-rack" data-danger>랙 삭제</button></div><p class="rack-form-error"></p></form>`;
    return;
  }
  const view = placementView(topology, placement); const editableHeight = placement.uHeight || placementHeight(topology, placement);
  target.innerHTML = `<div class="rack-inspector-summary"><span>장비</span><strong>${escapeText(view.name)}</strong><span>연결</span><strong>${view.mapped ? '토폴로지 장비' : '랙 전용'}</strong><span>위치</span><strong>U${view.startU}–${view.startU + view.uHeight - 1}</strong></div><form data-rack-form="placement-edit" data-placement-id="${escapeAttribute(view.id)}">${view.mapped ? `<label>이름<input value="${escapeAttribute(view.name)}" disabled></label>` : `<label>이름<input name="name" maxlength="80" required value="${escapeAttribute(view.name)}"></label><label>모델<input name="model" maxlength="80" value="${escapeAttribute(view.model)}"></label><label>종류<input name="kind" maxlength="80" required value="${escapeAttribute(view.kind)}"></label><label>전력 (W)<input name="powerWatts" type="number" min="0" value="${view.powerWatts ?? ''}"></label>`}<label>시작 U<input name="startU" type="number" min="1" max="${rack.capacityU}" required value="${view.startU}"></label><label>높이 (U)<input name="uHeight" type="number" min="1" max="${rack.capacityU}" required value="${editableHeight}"></label><div class="rack-inspector-actions"><button type="submit">배치 저장</button><button type="button" data-rack-action="delete-placement" data-danger>랙에서 제거</button></div><p class="rack-form-error"></p></form>`;
}

function renderRackWorkspace() {
  renderRackList(); renderRackEquipmentPalette(); const racks = topology.racks || []; const rack = currentRack();
  for (const tab of document.querySelectorAll('[data-rack-sidebar-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.rackSidebarTab === rackView.sidebarTab));
  for (const panel of document.querySelectorAll('[data-rack-sidebar-panel]')) panel.hidden = panel.dataset.rackSidebarPanel !== rackView.sidebarTab;
  element('rack-empty').hidden = racks.length > 0; element('rack-2d-scroll').hidden = !racks.length || rackView.mode !== '2d'; element('rack-3d-stage').hidden = !racks.length || rackView.mode !== '3d';
  for (const button of document.querySelectorAll('[data-rack-view]')) button.setAttribute('aria-pressed', String(button.dataset.rackView === rackView.mode));
  element('rack-3d-controls').hidden = rackView.mode !== '3d';
  for (const button of document.querySelectorAll('[data-rack-face]')) button.setAttribute('aria-pressed', String(button.dataset.rackFace === rackView.face));
  const cableToggle = document.querySelector('[data-rack-cables]'); cableToggle.setAttribute('aria-pressed', String(rackView.cables)); cableToggle.textContent = `케이블 ${rackView.cables ? '켬' : '끔'}`;
  element('rack-cable-note').textContent = rackView.face === 'rear' && rackView.cables ? '토폴로지 논리 링크 · 실제 배선 아님' : '후면에서 논리 케이블 표시';
  const total = racks.reduce((sum, item) => sum + rackPlacements(topology, item).length, 0);
  element('rack-workspace-summary').textContent = racks.length ? `랙 ${racks.length}개 · 배치 장비 ${total}대 · 토폴로지와 독립 저장` : '랙을 추가해 시작하세요.';
  if (rackView.mode === '2d') renderRackElevations(); renderRackInspector(); syncRackScene();
}

function setWorkspace(workspace) {
  if (!['topology', 'rack'].includes(workspace)) return; state.workspace = workspace; document.querySelector('.app-shell').dataset.workspace = workspace; element('rack-workspace').hidden = workspace !== 'rack';
  for (const button of document.querySelectorAll('[data-workspace]')) button.setAttribute('aria-selected', String(button.dataset.workspace === workspace));
  if (workspace === 'rack') { rackView.selectedRackId ||= topology.racks?.[0]?.id || null; renderRackWorkspace(); spatialScene?.stop(); } else { rackScene?.stop(); syncSpatialScene(); }
}

function rackDropTarget(clientX, clientY, uHeight) {
  const SNAP_DISTANCE = 44;
  const distance = (value, start, end) => value < start ? start - value : value > end ? value - end : 0;
  const candidates = [...document.querySelectorAll('.rack-elevation')].flatMap((node) => {
    const rack = (topology.racks || []).find(({ id }) => id === node.dataset.rackId);
    if (!rack) return [];
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    // 장비의 bottom 좌표는 테두리를 뺀 rack 내부를 기준으로 한다. 프레임까지 높이에 넣으면
    // 위쪽 U일수록 포인터와 계산한 U가 두 칸가량 어긋난다.
    const inner = {
      left: box.left + parseFloat(style.borderLeftWidth),
      right: box.right - parseFloat(style.borderRightWidth),
      top: box.top + parseFloat(style.borderTopWidth),
      bottom: box.bottom - parseFloat(style.borderBottomWidth),
    };
    const dx = distance(clientX, inner.left, inner.right);
    const dy = distance(clientY, inner.top, inner.bottom);
    if (dx > SNAP_DISTANCE || dy > SNAP_DISTANCE) return [];
    return [{ rack, node, inner, score: Math.hypot(dx, dy) }];
  });
  const target = candidates.sort((a, b) => a.score - b.score)[0];
  if (!target) return null;
  const innerHeight = Math.max(1, target.inner.bottom - target.inner.top);
  const unitHeight = innerHeight / target.rack.capacityU;
  const fromBottom = Math.min(innerHeight - .001, Math.max(0, target.inner.bottom - clientY));
  const hoveredU = Math.floor(fromBottom / unitHeight) + 1;
  // 포인터가 장비의 중앙을 잡고 있다고 보고 원하는 U를 정한다. 빈 구간이 아니면 가장 가까운
  // 연속 공간으로 이동하되, 미리보기와 pointerup은 이 함수를 같이 써 같은 위치를 선택한다.
  const preferred = Math.round(hoveredU - (uHeight - 1) / 2);
  const startU = nearestFreeStartU(topology, target.rack, uHeight, preferred);
  return { rack: target.rack, node: target.node, startU, uHeight };
}

function clearRackDropPreview() {
  rackDropPreviewKey = '';
  document.querySelectorAll('.rack-elevation.drop-target, .rack-elevation.drop-blocked').forEach((node) => node.classList.remove('drop-target', 'drop-blocked'));
  document.querySelectorAll('.rack-drop-preview').forEach((node) => node.remove());
}

function showRackDropPreview(target) {
  const key = target ? `${target.rack.id}:${target.startU ?? 'blocked'}:${target.uHeight}` : '';
  if (key === rackDropPreviewKey) return;
  clearRackDropPreview();
  if (!target) return;
  rackDropPreviewKey = key;
  target.node.classList.add(target.startU == null ? 'drop-blocked' : 'drop-target');
  if (target.startU == null) return;
  target.node.insertAdjacentHTML('beforeend', `<span class="rack-drop-preview" style="--rack-start:${target.startU};--rack-height:${target.uHeight}">U${target.startU}–${target.startU + target.uHeight - 1}</span>`);
}

function queueRackDropPreview(clientX, clientY) {
  if (!rackPaletteDrag) return;
  rackPaletteDrag.clientX = clientX; rackPaletteDrag.clientY = clientY;
  if (rackDragPreviewFrame) return;
  rackDragPreviewFrame = requestAnimationFrame(() => {
    rackDragPreviewFrame = null;
    const drag = rackPaletteDrag;
    if (drag) showRackDropPreview(rackDropTarget(drag.clientX, drag.clientY, drag.uHeight));
  });
}

function cancelRackPaletteDrag() {
  const drag = rackPaletteDrag; rackPaletteDrag = null;
  if (rackDragPreviewFrame) cancelAnimationFrame(rackDragPreviewFrame);
  rackDragPreviewFrame = null;
  drag?.ghost?.remove(); drag?.item?.classList.remove('dragging');
  if (drag?.item?.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
  clearRackDropPreview();
  return drag;
}

function placeRackPaletteItem(drag, target) {
  if (!target || target.startU == null) { showToast(target ? `${target.rack.name}에 ${drag.uHeight}U 연속 공간이 없습니다.` : '장비를 랙 안의 원하는 U 근처에 놓으세요.'); return; }
  try {
    const placement = drag.type === 'mapped'
      ? addMappedPlacement(topology, target.rack.id, { deviceId: drag.deviceId, startU: target.startU, uHeight: drag.uHeight })
      : addStandalonePlacement(topology, target.rack.id, { name: drag.name, kind: drag.kind, startU: target.startU, uHeight: drag.uHeight, powerWatts: drag.powerWatts });
    rackView.selectedRackId = target.rack.id; rackView.selectedPlacementId = placement.id; commitRack(`${placementView(topology, placement).name}을 ${target.rack.name} ${target.startU}U에 배치했습니다.`);
  } catch (error) { showToast(error.message); }
}

function cancelTeaser() {
  for (const timer of teaserTimers) clearTimeout(timer);
  teaserTimers.clear();
  if (teaserActive) { teaserActive = false; state.scale = 1; element('scale-input').value = '100'; recalculate(); }
}

function startTeaser() {
  const eligible = !restoredWorkingCopy && topology.template?.id === 'demo' && state.scale === 1 && !state.disabledDevices.size && !state.disabledLinks.size
    && !state.disabledDomains.size && !reducedMotion.matches && !document.hidden;
  if (!eligible) return;
  try { if (sessionStorage.getItem('rack-mesh-demo-teaser')) return; sessionStorage.setItem('rack-mesh-demo-teaser', '1'); } catch { return; }
  teaserActive = true;
  const schedule = (callback, delay) => { const timer = setTimeout(() => { teaserTimers.delete(timer); callback(); }, delay); teaserTimers.add(timer); };
  schedule(() => { state.scale = 1.2; element('scale-input').value = '120'; recalculate({ light: true }); }, 700);
  schedule(() => { if (teaserActive) { state.scale = 1; element('scale-input').value = '100'; recalculate(); teaserActive = false; } }, 3000);
}

function renderSummary() {
  const { summary } = current;
  const binding = resourceById(summary.bindingResourceId);
  const comparison = compareScenarios(baseline, current);
  element('summary-headroom').dataset.baseValue = String(summary.minHeadroom ?? '');
  element('summary-headroom').textContent = formatPercent(summary.minHeadroom);
  element('summary-overloaded').textContent = String(summary.overloadedCount);
  element('summary-warning').textContent = `${summary.warningCount}개 자원 주의`;
  element('summary-unreachable').textContent = String(summary.unreachableCount);
  element('summary-unreachable-load').textContent = `${formatCompact(summary.unreachableLoadBps, 'bps')} 미전달`;
  element('summary-dropped-load').textContent = formatCompact(summary.droppedLoadBps, 'bps');
  const growthRung = summary.growthLadder?.rungs?.[0];
  const growth = summary.overloadedCount > 0 ? '초과'
    : summary.growthLadder?.indeterminate ? '미확정'
      : growthRung ? `${growthRung.breachScale.toFixed(2)}×` : '—';
  const growthBinding = summary.overloadedCount > 0 ? '현재 용량 초과'
    : summary.growthLadder?.indeterminate ? '성장 한계 미확정'
      : growthRung ? `다음 병목 ${resourceName(resourceById(growthRung.resourceId)) || growthRung.resourceId} · ${axisCatalog[growthRung.axis]?.shortLabel || growthRung.axis}` : '다음 한계 없음';
  element('summary-growth').textContent = growth;
  element('summary-growth-binding').textContent = growthBinding;
  const survivalText = analysisProgress ? `계산 중 ${analysisProgress.completed}/${analysisProgress.total}` : survival.multiplier == null ? '미확정' : survival.multiplier === 0 ? '불가' : `${survival.multiplier < 0.005 ? survival.multiplier.toPrecision(2) : survival.multiplier.toFixed(2)}×${survival.bounded ? ' 이하' : ''}`;
  const failedService = survival.services?.find(({ status }) => status === 'fail');
  const unknownService = !failedService && survival.services?.find(({ status }) => status !== 'pass');
  const failedServiceRatio = failedService && Math.min(failedService.deliveredRatio ?? 1, failedService.admissionRatio ?? 1);
  const serviceLabel = failedService
    ? `${failedService.name} 불통과 · 최악 장애에서 ${formatPercent(failedServiceRatio)} 수용`
    : unknownService ? `${unknownService.name} 통과 보류 · 한계 미확인` : '';
  const survivalLabel = analysisProgress ? `${analysisProgress.label} · 전수 계산 중` : survival.worstFault
    ? `${survival.status === 'severed' ? '단절' : survival.status === 'capacity-insufficient' ? '현재 부하 미달' : '견딤'} · 생존 ${survivalText} · 최악 ${resourceName(resourceById(survival.worstFault.id)) || survival.worstFault.id}`
    : '생존 배수 · 장애 후보 없음';
  // 다음 병목은 상단 판정 문장이 이미 말하므로 여기서 또 반복하지 않는다. 그쪽이 비면만 대신 적는다.
  element('summary-growth-binding').textContent = [serviceLabel, survivalLabel].filter(Boolean).join(' · ') || growthBinding;
  const singlePoints = sweep.resources.filter(({ verdict, endpoint }) => verdict === 'severs' && !endpoint);
  const severedDomains = domainSweep.singles.filter(({ verdict }) => verdict === 'severs');
  const invalidDomains = domainSweep.redundancyInvalid || [];
  const representativeDomain = [...severedDomains].sort((left, right) => {
    const leftInvalid = invalidDomains.some(({ id }) => id === left.id);
    const rightInvalid = invalidDomains.some(({ id }) => id === right.id);
    return Number(rightInvalid) - Number(leftInvalid) || left.minDeliveredRatio - right.minDeliveredRatio || left.id.localeCompare(right.id);
  })[0];
  const survivalTile = element('summary-survival');
  if (summary.activeFaults) {
    element('summary-fault-label').textContent = '활성 장애';
    element('summary-faults').textContent = String(summary.activeFaults);
    element('summary-delta').textContent = `${severedDomains.length ? `도메인 단절 ${severedDomains.length}개 · ` : ''}headroom ${formatPercent(comparison.minHeadroomDelta, true)}`;
    survivalTile.setAttribute('aria-label', `활성 장애 ${summary.activeFaults}개${severedDomains.length ? `. 도메인 단절 ${severedDomains.length}개` : ''}. 장애 목록 열기`);
  } else if (analysisProgress) {
    element('summary-fault-label').textContent = '생존성';
    element('summary-faults').textContent = '…';
    element('summary-delta').textContent = `${analysisProgress.label} 계산 중`;
    survivalTile.setAttribute('aria-label', `${analysisProgress.label} 계산 중. 장애 목록 열기`);
  } else {
    element('summary-fault-label').textContent = '단일 장애점';
    element('summary-faults').textContent = singlePoints.length && severedDomains.length ? `${singlePoints.length} + 도메인 ${severedDomains.length}` : singlePoints.length ? String(singlePoints.length) : `도메인 ${severedDomains.length}`;
    element('summary-delta').textContent = representativeDomain
      ? `${resourceName(representativeDomain)}${invalidDomains.some(({ id }) => id === representativeDomain.id) ? ' · 이중화 무효' : ''}`
      : singlePoints.length ? `${resourceName(resourceById(singlePoints[0].id)) || singlePoints[0].id}` : '단일 장애점 없음';
    survivalTile.setAttribute('aria-label', `단일 장애점 ${singlePoints.length}개${severedDomains.length ? `. 도메인 단절 ${severedDomains.length}개` : ''}. 장애 목록 열기`);
  }
  // 엔진은 0.8 을 넘으면 warning 으로 판정하고 그 수를 summary.warningCount 에 담는데,
  // 상단 상태가 그 값을 보지 않아 주의 자원이 있어도 'BASELINE STABLE' 이라고 말했다.
  const runState = summary.evaluationStatus === 'invalid' ? { text: '모델 입력 오류', tone: 'danger' }
    : summary.evaluationStatus === 'not-ready' ? { text: '판정 준비 안 됨', tone: 'unknown' }
    : summary.unreachableCount ? { text: '경로 단절', tone: 'danger' }
    : summary.overloadedCount ? { text: '용량 초과', tone: 'danger' }
    : summary.warningCount ? { text: `자원 주의 ${summary.warningCount}개`, tone: 'amber' }
    : summary.activeFaults ? { text: '장애 견딜', tone: 'amber' }
    : { text: '기준 상태 안정', tone: 'signal' };
  const evidence = summary.evaluationStatus === 'unknown' ? { text: `한계 미확인 ${summary.unknownCount || 0}개`, tone: 'unknown' } : { text: '한계 확인됨', tone: 'signal' };
  const capacity = { text: runState.text, tone: runState.tone === 'amber' ? 'warning' : runState.tone };
  for (const [id, value] of [['evidence-state', evidence], ['capacity-state', capacity]]) {
    const chip = element(id); chip.querySelector('span').textContent = value.text; chip.dataset.tone = value.tone;
  }
  element('baseline-reset').hidden = !(summary.activeFaults || state.scale !== 1);
  // headroom 은 엔진이 쓰는 임계값과 같은 기준으로 칠한다. 13% 가 초록이면 숫자가 거짓말을 한다.
  element('summary-headroom').dataset.tone = summary.minHeadroom == null ? 'unknown'
    : summary.minHeadroom <= 0 ? 'danger' : summary.minHeadroom < 0.2 ? 'amber' : 'signal-deep';
  element('scale-output').textContent = `${state.scale.toFixed(2)}×`;
  // 슬라이더는 50~180 을 가진다. 그 숫자만 읽으면 몇 배인지 알 수 없다.
  element('scale-input').setAttribute('aria-valuetext', `${state.scale.toFixed(2)}배`);
  const activePathCount = current.demands.reduce((sum, demand) => sum + demand.paths.length, 0);
  element('path-readout').textContent = `${current.demands.length} DEMANDS · ${activePathCount} ACTIVE PATHS`;
}

// 끄기 전에 결과를 말한다. 하나씩 눌러 보고 되돌리는 수고가 이 도구의 요점이 아니다.
// 장애 목록은 이미 나쁘 순서로 정렬되지만, 정렬만으로는 어디에서 단절이 끝나고 용량
// 부족이 시작되는지 보이지 않아 수십 줄을 위에서부터 읽어야 했다. 그 경계를 제목으로 집는다.
const FAILURE_TIER_LABEL = {
  severs: '단절 · 서비스가 끊깁니다',
  overloads: '용량 부족 · 일부만 전달됩니다',
  absorbs: '견딤 · 남은 경로가 흡수합니다',
  endpoint: '출발지·목적지 · 자기 트래픽만 끊깁니다',
  unknown: '한계 미확인 · 결과를 단정할 수 없습니다',
  none: '판정 없음',
};

// 같은 판정이 이어지는 구간만 모은다. 다시 정렬하지 않는다.
export function groupByVerdictRun(items, verdictOf) {
  const runs = [];
  for (const item of items) {
    const verdict = verdictOf(item);
    const tier = verdict?.verdict === 'severs' && verdict.endpoint ? 'endpoint' : verdict?.verdict || 'none';
    const last = runs[runs.length - 1];
    if (last && last.tier === tier) last.items.push(item);
    else runs.push({ tier, items: [item] });
  }
  return runs;
}

function faultForecast(verdict, { includeBoundary = false } = {}) {
  if (!verdict) return '판정 없음';
  let forecast;
  if (verdict.verdict === 'severs') forecast = verdict.endpoint ? '출발지·목적지 · 끄면 끊김' : '끄면 서비스 단절';
  if (verdict.verdict === 'overloads') {
    forecast = verdict.minDeliveredRatio < 1
      ? `끄면 ${Math.round(verdict.minDeliveredRatio * 100)}%만 전달`
      : `끄면 ${formatPercent(verdict.worstUtilization)} 과부하`;
  }
  if (!forecast) forecast = verdict.bounded ? '끄면 견딤 · 한계 미확인' : '끄면 남은 쪽이 견딤';
  // 도메인 결과는 단절·과부하도 모르는 축의 영향 아래 있다. 이 경계를 숨기면 확정 판정처럼 읽힌다.
  return includeBoundary && verdict.bounded && !forecast.includes('한계 미확인') ? `${forecast} · 한계 미확인` : forecast;
}

const FORECAST_RANK = { severs: 0, overloads: 1, absorbs: 2 };
// 출발지·목적지가 끊는 것은 이중화 문제가 아니므로 뒤로 보낸다. 끊지 않는다면 평범한 항목이다.
const forecastRank = (verdict) => (verdict?.verdict === 'severs' && verdict.endpoint ? 3 : FORECAST_RANK[verdict?.verdict] ?? 4);
const forecastDelivery = (verdict) => Number.isFinite(verdict?.minDeliveredRatio) ? verdict.minDeliveredRatio : 1;

function renderVirtualFailureRows() {
  const panel = document.querySelector('.failure-panel');
  for (const container of document.querySelectorAll('[data-failure-virtual]')) {
    const entry = failureVirtual.groups.get(container.dataset.failureVirtual);
    if (!entry) continue;
    const count = entry.items.length;
    const listBox = container.getBoundingClientRect();
    const panelBox = panel?.getBoundingClientRect();
    const panelScrolls = panel && panel.scrollHeight > panel.clientHeight;
    const top = panelScrolls ? panelBox.top : 0;
    const bottom = panelScrolls ? panelBox.bottom : window.innerHeight;
    let start = Math.max(0, Math.floor((top - listBox.top) / FAILURE_VIRTUAL_ROW_HEIGHT) - FAILURE_VIRTUAL_OVERSCAN);
    let end = Math.min(count, Math.ceil((bottom - listBox.top) / FAILURE_VIRTUAL_ROW_HEIGHT) + FAILURE_VIRTUAL_OVERSCAN);
    if (end <= start) {
      start = Math.min(Math.max(0, count - 1), start);
      end = Math.min(count, start + FAILURE_VIRTUAL_OVERSCAN * 2 + 1);
    }
    const range = `${start}:${end}`;
    if (container.dataset.failureVirtualRange === range) continue;
    container.dataset.failureVirtualRange = range;
    container.innerHTML = `<ul class="failure-virtual-window" style="transform:translateY(${start * FAILURE_VIRTUAL_ROW_HEIGHT}px)">${entry.items.slice(start, end).map((item, offset) => entry.render(item, start + offset)).join('')}</ul>`;
  }
}

function queueVirtualFailureRows() {
  if (failureVirtual.frame) return;
  failureVirtual.frame = requestAnimationFrame(() => { failureVirtual.frame = null; renderVirtualFailureRows(); });
}

function focusVirtualFailureRow(key, index) {
  const container = document.querySelector(`[data-failure-virtual="${CSS.escape(key)}"]`);
  if (!container) return;
  const panel = document.querySelector('.failure-panel');
  const targetTop = container.getBoundingClientRect().top + index * FAILURE_VIRTUAL_ROW_HEIGHT;
  if (panel && panel.scrollHeight > panel.clientHeight) {
    panel.scrollTop += targetTop - panel.getBoundingClientRect().top - panel.clientHeight / 2 + FAILURE_VIRTUAL_ROW_HEIGHT / 2;
  } else {
    window.scrollBy(0, targetTop - window.innerHeight / 2 + FAILURE_VIRTUAL_ROW_HEIGHT / 2);
  }
  requestAnimationFrame(() => {
    renderVirtualFailureRows();
    document.querySelector(`[data-failure-virtual="${CSS.escape(key)}"] [data-failure-index="${index}"] button`)?.focus();
  });
}

function renderFailures() {
  const verdicts = new Map([...sweep.resources, ...domainSweep.singles].map((resource) => [resource.id, resource]));
  const invalidDomains = domainSweep.redundancyInvalid || [];
  // 예전에는 kind 와 링크 id 패턴으로 걸러 데모 이외의 설계에서는 끌 대상이 거의 없었다.
  const order = (items) => [...items].sort((a, b) => {
    const verdictOrder = forecastRank(verdicts.get(a.id)) - forecastRank(verdicts.get(b.id));
    if (verdictOrder) return verdictOrder;
    const deliveryOrder = forecastDelivery(verdicts.get(a.id)) - forecastDelivery(verdicts.get(b.id));
    return deliveryOrder || a.id.localeCompare(b.id);
  });
  const groups = [
    { title: '자원 N-1 · 장비', items: order(topology.devices), set: state.disabledDevices, type: 'device' },
    { title: '자원 N-1 · 링크', items: order(topology.links), set: state.disabledLinks, type: 'link' },
    { title: '도메인 N-1', items: order(topology.failureDomains || []), set: state.disabledDomains, type: 'domain' },
  ];
  element('failure-count').textContent = `주입한 장애 ${state.disabledDevices.size + state.disabledLinks.size + state.disabledDomains.size}`;
  if (analysisProgress) {
    element('failure-grade').textContent = `${analysisProgress.label} 계산 중 ${analysisProgress.completed}/${analysisProgress.total} · 완료 전에는 판정을 표시하지 않습니다.`;
    element('failure-grade').dataset.grade = 'unknown';
    element('failure-grade').toggleAttribute('data-stale', false);
    element('failure-list').toggleAttribute('data-stale', false);
    element('failure-list').innerHTML = `<p class="failure-empty">${escapeText(analysisProgress.label)} 전수 계산 중 ${analysisProgress.completed}/${analysisProgress.total}</p>`;
    renderQuickFailure();
    return;
  }
  const stale = sweepStale() && sweep.resources.length > 0;
  const invalidDomainSummary = invalidDomains.map(({ name, reason, deliveryDrop }) => reason === 'delivery-drop'
    ? name + ' (전달률 ' + formatPercent(deliveryDrop) + 'p 저하)' : name).join(', ');
  element('failure-grade').textContent = sweep.resources.length
    ? `단일 장애점 ${sweep.severs}개 · 용량 부족 ${sweep.overloads}개 · 여유 ${sweep.absorbs}개${invalidDomains.length ? ` · 이중화 무효 ${invalidDomainSummary}` : ''}${stale ? ` · ${sweepScale.toFixed(2)}배 기준` : ''}`
    : '끌 자원이 아직 없습니다.';
  element('failure-grade').dataset.grade = sweep.grade;
  element('failure-grade').toggleAttribute('data-stale', stale);
  // 등급 한 줄만 표시하면 자원별 예보는 옛 배율 값을 지금 값처럼 말한다. 목록 전체에 건다.
  element('failure-list').toggleAttribute('data-stale', stale);
  const pairs = domainSweep.pairs;
  const matchesFailureFilter = (item, verdict) => {
    const name = resourceName(item).toLowerCase();
    const query = failureFilter.query.trim().toLowerCase();
    const matchesName = !query || name.includes(query);
    const matchesVerdict = failureFilter.verdict === 'all'
      || failureFilter.verdict === verdict?.verdict
      || failureFilter.verdict === 'unknown' && (verdict?.verdict === 'unknown' || verdict?.bounded);
    return matchesName && matchesVerdict;
  };
  const allRows = [
    ...topology.devices.map((item) => ({ item, verdict: verdicts.get(item.id) })),
    ...topology.links.map((item) => ({ item, verdict: verdicts.get(item.id) })),
    ...(topology.failureDomains || []).map((item) => ({ item, verdict: verdicts.get(item.id) })),
    ...pairs.map((item) => ({ item, verdict: item })),
  ];
  const filteredRows = allRows.filter(({ item, verdict }) => matchesFailureFilter(item, verdict));
  const filterActive = Boolean(failureFilter.query.trim()) || failureFilter.verdict !== 'all';
  const filterControls = `<form class="failure-filter" data-failure-filter>
    <input type="search" value="${escapeAttribute(failureFilter.query)}" placeholder="이름 검색" aria-label="장애 대상 이름 검색">
    <div role="group" aria-label="장애 판정 필터">${[['all', '전체'], ['severs', '단절'], ['overloads', '용량 부족'], ['absorbs', '견딤'], ['unknown', '한계 미확인']].map(([value, label]) => `<button type="button" data-failure-filter-verdict="${value}" aria-pressed="${failureFilter.verdict === value}">${label}</button>`).join('')}</div>
    <p data-failure-filter-count>${filterActive ? '필터 적용 중 · ' : ''}전체 ${allRows.length}개 중 ${filteredRows.length}개 표시</p>
  </form>`;
  failureVirtual.groups.clear();
  const renderFailure = (group, item, { index = null, key = '', total = 0 } = {}) => {
        const active = group.set.has(item.id);
        const verdict = verdicts.get(item.id);
        const detail = group.type === 'device' ? item.zone : group.type === 'link' ? formatCompact(item.capacity?.forwarding_bps, 'bps') : `${FAILURE_DOMAIN_KIND_LABEL[item.kind] || FAILURE_DOMAIN_KIND_LABEL.other} · 장비 ${item.deviceIds?.length || 0} · 링크 ${item.linkIds?.length || 0}`;
        const forecast = faultForecast(verdict, { includeBoundary: group.type === 'domain' });
        const virtualAttributes = index == null ? '' : ` data-failure-index="${index}" data-failure-group="${escapeAttribute(key)}" aria-posinset="${index + 1}" aria-setsize="${total}"`;
        const label = `${resourceName(item)}, ${forecast}, ${detail}, 현재 ${active ? 'DOWN' : 'UP'}`;
        return `<li class="failure-row"${virtualAttributes}><button class="failure-switch ${active ? 'active' : ''}" type="button" data-failure-type="${group.type}" data-failure-id="${escapeAttribute(item.id)}" aria-pressed="${active}" aria-label="${escapeAttribute(label)}">
          <span class="switch-glyph" aria-hidden="true"></span><span><strong>${escapeText(resourceName(item))}</strong><small class="failure-forecast" data-verdict="${escapeAttribute(verdict?.verdict === 'severs' && verdict.endpoint ? 'endpoint' : verdict?.verdict || 'none')}">${escapeText(forecast)}</small><small>${escapeText(detail)}</small></span><span class="switch-state">${active ? 'DOWN' : 'UP'}</span>
        </button></li>`;
  };
  const renderFailureRows = (group, items, kind, tierLabel = '') => {
    if (items.length < FAILURE_VIRTUAL_THRESHOLD) return `<ul class="failure-rows">${items.map((item) => renderFailure(group, item)).join('')}</ul>`;
    const key = `${group.type}-${kind}`;
    failureVirtual.groups.set(key, {
      items,
      render: (item, index) => renderFailure(group, item, { index, key, total: items.length }),
    });
    return `<div class="failure-virtual-list" data-failure-virtual="${key}" style="height:${items.length * FAILURE_VIRTUAL_ROW_HEIGHT}px" role="list" aria-label="${escapeAttribute(group.title)} ${escapeAttribute(tierLabel || (kind === 'absorbs' ? '견딤' : '우선'))} 결과 ${items.length}개"></div>`;
  };
  const renderGroup = (group) => {
    const matching = group.items.filter((item) => matchesFailureFilter(item, verdicts.get(item.id)));
    const candidates = group.type === 'domain' ? matching : matching.filter((item) => verdicts.get(item.id)?.verdict !== 'absorbs');
    const absorbs = group.type === 'domain' ? [] : matching.filter((item) => verdicts.get(item.id)?.verdict === 'absorbs');
    const tiers = groupByVerdictRun(candidates, (item) => verdicts.get(item.id));
    const tierRows = tiers.map(({ tier, items }, index) => {
      const label = FAILURE_TIER_LABEL[tier] || tier;
      return `<h4 class="failure-tier" data-tier="${escapeAttribute(tier)}">${escapeText(label)}<span>${items.length}</span></h4>${renderFailureRows(group, items, `tier-${tier}-${index}`, label)}`;
    }).join('');
    return `<section class="failure-group">
      <h3>${group.title}</h3>
      ${candidates.length ? tierRows : '<p class="failure-empty">조건에 맞는 항목이 없습니다.</p>'}
      ${absorbs.length ? `<button type="button" class="failure-collapse" data-failure-resource-absorbs-toggle aria-expanded="${resourceAbsorbsExpanded}">견딤 ${absorbs.length}개 ${resourceAbsorbsExpanded ? '접기' : '펼치기'}</button><div${resourceAbsorbsExpanded ? '' : ' hidden'}>${renderFailureRows(group, absorbs, 'absorbs')}</div>` : ''}
    </section>`;
  };
  const worstAxes = (sweep.worstAxes || []).filter(({ utilization, unknown }) => utilization != null || unknown).sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1) || a.resourceId.localeCompare(b.resourceId)).slice(0, 12);
  const worstAxisRows = worstAxes.length ? worstAxes.map((item) => {
    const target = resourceById(item.resourceId);
    const label = `${resourceName(target) || item.resourceId} · ${item.direction === 'forward' ? '정방향 · ' : item.direction === 'reverse' ? '역방향 · ' : ''}${axisCatalog[item.axis]?.shortLabel || item.axis}`;
    const value = item.utilization == null ? '미확인' : formatPercent(item.utilization);
    const detail = item.faultId ? `${resourceName(resourceById(item.faultId)) || item.faultId} 장애 후 최악` : '최악 장애 미확인';
    // 사용률이 이 패널의 답이다. 같은 크기의 텍스트 12줄에서는 171과 73이 구분되지 않아, 막대로 길이를 먼저 읽게 한다.
    const tier = item.utilization == null ? 'unknown' : item.utilization >= 1 ? 'over' : item.utilization >= 0.8 ? 'warn' : 'ok';
    const bar = item.utilization == null ? '' : ` style="--worst-bar:${(Math.min(item.utilization, 1) * 100).toFixed(1)}%"`;
    return `<li data-tier="${tier}"${bar}><b>${escapeText(label)}</b><span>${escapeText(value)}${item.bounded ? `<i>이하</i>` : ''}</span><small>${escapeText(detail)}${item.unknown ? ' · 일부 미확인' : ''}</small></li>`;
  }).join('') : '<li>완료된 단일 장애 스윕이 아직 없습니다.</li>';
  // 여덟 줄을 한 번에 펼치면 읽을 사람이 없다. 최악 네 개만 남기고 나머지는 접어 둔다.
  const WORST_AXES_VISIBLE = 4;
  const worstAxisTail = Math.max(0, worstAxes.length - WORST_AXES_VISIBLE);
  const worstAxisToggle = worstAxisTail
    ? `<button type="button" class="failure-collapse" data-failure-worst-toggle aria-expanded="${worstAxesExpanded}">${worstAxesExpanded ? '접기' : `나머지 ${worstAxisTail}개 펼치기`}</button>`
    : '';
  const worstAxisPanel = `<section class="failure-group failure-worst-axes"><h3>단일 장애 최악 사용률</h3><p class="failure-empty">각 자원·축에서 가장 나쁜 단일 장애와 사용률입니다.</p><ul${worstAxesExpanded || !worstAxisTail ? '' : ' data-worst-folded'}>${worstAxisRows}</ul>${worstAxisToggle}</section>`;
  const scopeGuide = `<section class="failure-scope-guide" aria-label="장애 분석 범위"><p><b>자원 N-1</b><span>장비 또는 링크 하나의 장애입니다.</span></p><p><b>도메인 N-1</b><span>전원·공간·경로처럼 함께 실패할 수 있는 묶음 하나의 장애입니다.</span></p><p><b>도메인 N-2</b><span>서로 다른 장애 도메인 둘이 동시에 실패하는 경우입니다.</span></p></section>`;
  element('failure-list').innerHTML = `${scopeGuide}${filterControls}${groups.map(renderGroup).join('')}${worstAxisPanel}<section class="failure-group failure-domain-pairs"><h3>도메인 N-2 · 동시 두 도메인</h3>${domainSweep.domainCount ? (() => {
      const matchingPairs = pairs.filter((item) => matchesFailureFilter(item, item));
      const critical = matchingPairs.filter(({ verdict }) => verdict !== 'absorbs');
      const absorbs = matchingPairs.filter(({ verdict }) => verdict === 'absorbs');
      const pair = (item) => `<div class="failure-pair"><strong>${escapeText(item.name)}</strong><small>${escapeText(faultForecast(item, { includeBoundary: true }))}</small></div>`;
      return `<p class="failure-empty">검사 ${pairs.length}개 · 단절 ${pairs.filter(({ verdict }) => verdict === 'severs').length}개 · 용량 부족 ${pairs.filter(({ verdict }) => verdict === 'overloads').length}개 · 견딤 ${pairs.filter(({ verdict }) => verdict === 'absorbs').length}개</p>${critical.map(pair).join('')}${absorbs.length ? `<button type="button" class="failure-collapse" data-failure-absorbs-toggle aria-expanded="${absorbsExpanded}">견딤 ${absorbs.length}개 ${absorbsExpanded ? '접기' : '펼치기'}</button><div${absorbsExpanded ? '' : ' hidden'}>${absorbs.map(pair).join('')}</div>` : ''}${!matchingPairs.length ? '<p class="failure-empty">조건에 맞는 도메인 쌍이 없습니다.</p>' : ''}`;
    })() : '<p class="failure-empty">장애 도메인이 없어 이중 장애를 계산할 수 없습니다.</p>'}</section>`;
  renderVirtualFailureRows();
  renderQuickFailure();
}

function quickFailureTarget() {
  const invalidDomain = domainSweep.redundancyInvalid?.[0];
  if (invalidDomain) return { type: 'domain', id: invalidDomain.id, label: resourceName(invalidDomain), reason: '이중화 무효 도메인 실험' };
  const singlePoint = sweep.resources.find(({ verdict, endpoint }) => verdict === 'severs' && !endpoint);
  if (singlePoint) return { type: singlePoint.type, id: singlePoint.id, label: resourceName(topology[singlePoint.type === 'device' ? 'devices' : 'links'].find(({ id }) => id === singlePoint.id)), reason: '단일 장애점 실험' };
  const binding = current.summary.bindingResourceId && current.summary.bindingAxis !== 'forwarding_bps'
    ? [...topology.devices, ...topology.links].find(({ id }) => id === current.summary.bindingResourceId) : null;
  return binding ? { type: topology.devices.includes(binding) ? 'device' : 'link', id: binding.id, label: resourceName(binding), reason: '현재 병목 실험' } : null;
}

function renderQuickFailure() {
  const tray = document.querySelector('.mobile-fault-tray');
  const button = tray.querySelector('[data-quick-failure]');
  const target = quickFailureTarget();
  if (!target) { button.hidden = true; return; }
  const active = (target.type === 'device' ? state.disabledDevices : target.type === 'link' ? state.disabledLinks : state.disabledDomains).has(target.id);
  button.hidden = false;
  button.dataset.quickFailure = target.id;
  button.dataset.quickFailureType = target.type;
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', `${target.reason}: ${target.label}`);
  button.innerHTML = `${escapeText(target.label)} <span>${active ? 'DOWN' : 'UP'}</span>`;
  tray.querySelector('strong').textContent = target.reason;
}

// 심볼은 스텐실, 클래스는 meta 줄로 확정했다. 배지만 취향이 갈려 토글로 남긴다.
const classView = { badge: 'on' };
try {
  const saved = localStorage.getItem('rack-mesh-class-badge');
  if (saved === 'on' || saved === 'off') classView.badge = saved;
} catch { /* 저장된 선택이 없으면 기본값을 쓴다 */ }

const TOPOLOGY_VIEW_MODES = new Set(['classic', 'voxel', 'spatial']);
const topologyView = { mode: 'voxel', pitch: 38, yaw: -28, distance: 31 };
try {
  const mode = localStorage.getItem('rack-mesh-topology-view');
  const storedPitch = localStorage.getItem('rack-mesh-spatial-pitch');
  const storedYaw = localStorage.getItem('rack-mesh-spatial-yaw');
  const storedDistance = localStorage.getItem('rack-mesh-spatial-distance');
  const pitch = storedPitch == null ? NaN : Number(storedPitch);
  const yaw = storedYaw == null ? NaN : Number(storedYaw);
  const distance = storedDistance == null ? NaN : Number(storedDistance);
  if (TOPOLOGY_VIEW_MODES.has(mode)) topologyView.mode = mode;
  if (Number.isFinite(pitch)) topologyView.pitch = Math.min(70, Math.max(28, pitch));
  if (Number.isFinite(yaw)) topologyView.yaw = yaw;
  if (Number.isFinite(distance)) topologyView.distance = Math.min(90, Math.max(18, distance));
} catch { /* 저장이 막히면 현재 세션 기본값을 쓴다 */ }

// 숫자는 두 가지로 움직인다. 값이 실제로 바뀌었을 때 이전 값에서 새 값으로 잇는 것은 항상
// 한다 - 원인이 있는 움직임이라 계산을 배신하지 않고, 오히려 무엇 때문에 바뀌었는지 보인다.
// 떨림은 지어낸 값이다. 그래서 끄는 스위치를 늘 화면에 두고, 무엇이 떨리고 있는지 이름으로
// 밝힌다 - 값을 적어야 하는 사람은 그것을 끄고 적는다.
// 카드가 담는 축 정보의 양. 축 행 하나가 네 조각(토큰·이름·부하·백분율)을 담고, 그중 절반
// 넘게가 병목이 아닌 축이다 - 병목은 노드마다 하나뿐이다. 줄이는 것은 보이는 것뿐이고 계산은
// 그대로다. 어느 단에서도 미확인은 숨기지 않는다 - 지우면 안전으로 읽힌다.
const DETAIL_LEVELS = new Set(['off', 'brief', 'full']);
const detailView = { level: 'full' };
try {
  const saved = localStorage.getItem('rack-mesh-node-detail');
  if (DETAIL_LEVELS.has(saved)) detailView.level = saved;
} catch { /* 저장된 선택이 없으면 기본값을 쓴다 */ }

const motionView = { drift: 'on' };
try {
  const saved = localStorage.getItem('rack-mesh-number-motion');
  if (saved === 'on' || saved === 'off') motionView.drift = saved;
} catch { /* 저장된 선택이 없으면 기본값을 쓴다 */ }

// 선을 어떻게 그을지. 직선이 기본이다 - 굽히는 것은 보기의 문제이고, 어느 쪽을 골라도 어느
// 자원이 무엇에 이어졌는지는 같다. 직각과 곡선은 노드 카드를 비켜 가므로 선이 숫자를 덜 가린다.
let bendDrag = null;
let lastBendPress = { key: '', at: 0 };
const routeView = { mode: 'straight' };
try {
  const saved = localStorage.getItem('rack-mesh-link-route');
  if (LINK_ROUTES.includes(saved)) routeView.mode = saved;
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

const VOXEL_PROFILES = Object.freeze({
  switch: 'switch', hub: 'switch', router: 'router', modem: 'router', wireless: 'wireless',
  firewall: 'firewall', ips: 'security', waf: 'security', vpn: 'security', sslvpn: 'security', lb: 'balancer',
  server: 'server', web: 'server', vm: 'server', mail: 'server', mainframe: 'mainframe',
  db: 'storage', storage: 'storage', nas: 'storage', backup: 'storage', cloud: 'cloud', client: 'client',
});

// 대표 장비는 상태가 바뀌어도 같은 외형을 유지한다. 포트와 베이 배열만 종류를 구별한다.
function deviceSymbol(device) {
  const kind = String(device.kind || '').toLowerCase();
  const glyph = `<svg class="node-glyph" aria-hidden="true" focusable="false"><use href="#${symbolFor(device.kind).id}"></use></svg>`;
  if (topologyView.mode === 'classic') return glyph;
  const profile = VOXEL_PROFILES[kind] || 'generic';
  const repeat = (className, count) => Array.from({ length: count }, (_, index) => `<i class="${className}" style="--voxel-index:${index}"></i>`).join('');
  const detail = profile === 'server'
    ? `<span class="voxel-bays">${repeat('voxel-bay', 4)}</span><span class="voxel-fans">${repeat('voxel-fan', 2)}</span>`
    : profile === 'switch'
      ? `<span class="voxel-ports">${repeat('voxel-port', 12)}</span>`
      : profile === 'router'
        ? `<span class="voxel-ports">${repeat('voxel-port', 6)}</span><span class="voxel-route" aria-hidden="true"></span>`
        : profile === 'wireless'
          ? `<span class="voxel-ports">${repeat('voxel-port', 4)}</span><span class="voxel-antennas"><i></i><i></i></span>`
          : profile === 'firewall' || profile === 'security'
            ? `<span class="voxel-ports">${repeat('voxel-port', 5)}</span><span class="voxel-shield" aria-hidden="true"></span>`
            : profile === 'balancer'
              ? `<span class="voxel-ports">${repeat('voxel-port', 8)}</span><span class="voxel-balance" aria-hidden="true"><i></i><i></i></span>`
              : profile === 'storage' || profile === 'mainframe'
                ? `<span class="voxel-bays voxel-bays-wide">${repeat('voxel-bay', profile === 'mainframe' ? 8 : 6)}</span>`
                : profile === 'cloud'
                  ? `<span class="voxel-cloud-mark" aria-hidden="true"><i></i><i></i><i></i></span>`
                  : profile === 'client'
                    ? `<span class="voxel-screen" aria-hidden="true"></span><span class="voxel-ports">${repeat('voxel-port', 2)}</span>`
                    : `<span class="voxel-ports">${repeat('voxel-port', 4)}</span>`;
  if (topologyView.mode === 'spatial') {
    const vents = repeat('spatial-vent', profile === 'storage' || profile === 'mainframe' ? 6 : 4);
    return `<span class="spatial-rig spatial-${profile}" data-spatial-kind="${escapeAttribute(kind)}" data-spatial-profile="${profile}" aria-hidden="true">
      <span class="spatial-pylon"></span><span class="spatial-shadow"></span>
      <span class="spatial-cuboid">
        <span class="spatial-face spatial-face-top">${detail}<span class="voxel-leds">${repeat('voxel-led', 3)}</span>${glyph}</span>
        <span class="spatial-face spatial-face-bottom"></span>
        <span class="spatial-face spatial-face-front"><span class="spatial-rack-line"></span>${vents}</span>
        <span class="spatial-face spatial-face-back">${vents}</span>
        <span class="spatial-face spatial-face-left">${repeat('spatial-side-port', 3)}</span>
        <span class="spatial-face spatial-face-right">${repeat('spatial-side-port', 3)}</span>
      </span>
    </span>`;
  }
  return `<span class="voxel-chassis voxel-${profile}" data-voxel-kind="${escapeAttribute(kind)}" data-voxel-profile="${profile}" aria-hidden="true">
    <span class="voxel-floor"></span><span class="voxel-face voxel-top"></span><span class="voxel-face voxel-side"></span>
    <span class="voxel-face voxel-front">${detail}<span class="voxel-leds">${repeat('voxel-led', 3)}</span>${glyph}</span>
  </span>`;
}

function nodeAxisRow(device, key, axis, brief = false) {
  // unknown·invalid 축에는 data-live-util을 붙이지 않는다. 텔레메트리가 미확인 값을 숫자로 덮어쓰면 안 된다.
  const sourceType = axis.source?.type || device.source?.type || 'estimate';
  const live = axis.utilization == null ? '' : ` data-live-util="${axis.utilization}" data-live-seed="${escapeAttribute(device.id)}:${key}:percent" data-live-drift="${escapeAttribute(device.id)}:${key}" data-live-source-type="${escapeAttribute(sourceType)}"`;
  // 사용률만 떨고 부하는 그대로면 한쪽만 살아 있는 것처럼 보인다. 한계를 몰라 사용률이
  // 미확인인 축에도 부하는 알 수 있으므로, 부하는 부하대로 따라간다.
  const liveLoad = Number.isFinite(axis.load) ? ` data-live-load="${axis.load}" data-live-seed="${escapeAttribute(device.id)}:${key}:load" data-live-drift="${escapeAttribute(device.id)}:${key}" data-live-source-type="${escapeAttribute(sourceType)}"` : '';
  const percent = axis.status === 'unknown' ? '\u2014' : axis.status === 'invalid' ? 'ERR' : formatPercent(axis.utilization);
  // 막대 후보가 쓰는 값. unknown 축은 넘기지 않아 막대가 그려지지 않는다.
  const meter = axis.utilization == null ? '' : ` style="--util:${Math.min(axis.utilization, 1.5)}"`;
  // 요약에서는 부하 값을 뗀다. 한계가 카드에 없어 그 숫자만으로는 여유를 알 수 없고, 옆의
  // 백분율이 이미 답을 말한다. 막대는 남긴다 - 숫자를 지워도 길이는 상태를 말한다.
  const load = brief ? '' : `<em${liveLoad}>${formatNodeValue(axis.load)}</em>`;
  return `<span class="node-axis" data-axis-state="${axis.status}"${brief ? ' data-brief=""' : ''}${key === device.bindingAxis ? ' data-binding=""' : ''}${meter}><i>${STATE_TOKEN[axis.status] || '?'}</i><b>${escapeText(nodeAxisLabel(key))}</b>${load}<s${live}>${percent}</s></span>`;
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
  { kind: 'lb', label: '로드밸런서', group: '네트워크', limits: { forwarding_bps: null, new_sessions_per_sec: null, concurrent_sessions: null, tls_full_handshakes_per_sec: null, tls_resumed_handshakes_per_sec: null } },
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
let expandedPaletteKind = null;
const expandedPaletteGroups = new Set(['네트워크']);
let linkDraft = null;
let contextTarget = null;
let pendingDeviceImport = null;

function paletteCatalog(kind, label) {
  const entries = catalogFor(kind);
  if (!entries.length) return '';
  const choices = entries.flatMap((entry) => entry.profiles.map((profile) => {
    const limits = Object.entries(profile.limits)
      .map(([axis, value]) => `${axisCatalog[axis]?.nodeLabel || axis} ${value == null ? '미확인' : formatCompact(value, axisCatalog[axis]?.unit)}`)
      .join(' · ');
    const haystack = [entry.vendor, entry.model, profile.label, profile.note, limits].join(' ').toLowerCase();
    const mark = vendorLogoFor(entry.vendor);
    const vendorBadge = mark
      ? `<svg class="palette-vendor-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="--mark:${mark.hex}"><path d="${escapeAttribute(mark.path)}"></path></svg>`
      : `<span class="palette-vendor-fallback" aria-hidden="true">${escapeText(String(entry.vendor || '').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase())}</span>`;
    return `<button type="button" class="palette-model" data-palette-kind="${escapeAttribute(kind)}" data-palette-catalog="${escapeAttribute(entry.id)}" data-palette-profile="${escapeAttribute(profile.id)}" data-palette-search="${escapeAttribute(haystack)}" aria-label="${escapeAttribute(`${entry.vendor} ${entry.model} · ${profile.label} 추가`)}">
      <span class="palette-model-glyph">${vendorBadge}<svg aria-hidden="true" focusable="false"><use href="#${symbolFor(kind).id}"></use></svg></span>
      <span class="palette-model-copy"><strong>${escapeText(`${entry.vendor} ${entry.model}`)}</strong><span>${escapeText(profile.label)}</span><small>${escapeText(limits)}</small></span>
    </button>`;
  })).join('');
  const count = entries.reduce((total, entry) => total + entry.profiles.length, 0);
  return `<section class="palette-catalog" id="palette-catalog-${escapeAttribute(kind)}" data-palette-catalog-panel="${escapeAttribute(kind)}"${expandedPaletteKind === kind ? '' : ' hidden'}>
    <label class="palette-search"><span class="visually-hidden">${escapeText(label)} 검색</span><input type="search" data-palette-search-input="${escapeAttribute(kind)}" placeholder="제조사, 모델, 역할, 조건 검색" autocomplete="off"></label>
    <div class="palette-catalog-meta"><span>${escapeText(label)} · 특정 모델과 측정 프로필</span><output data-palette-result-count>${count}개</output></div>
    <div class="palette-models">${choices}</div>
    <p class="palette-empty" hidden>일치하는 ${escapeText(label)} 모델이 없습니다.</p>
  </section>`;
}

function renderPalette() {
  const counts = PALETTE.reduce((map, item) => map.set(item.group, (map.get(item.group) || 0) + 1), new Map());
  const groups = PALETTE.reduce((result, item) => {
    if (!result.has(item.group)) result.set(item.group, []);
    result.get(item.group).push(item);
    return result;
  }, new Map());
  const groupsHtml = [...groups].map(([groupName, items], groupIndex) => {
    const open = expandedPaletteGroups.has(groupName);
    const itemsHtml = items.map((item, itemIndex) => {
      // 2열 격자에서 홀수 그룹의 마지막 칸은 빈 자리로 남는다. 그 항목을 한 줄로 늘려 메운다.
      const wide = counts.get(item.group) % 2 === 1 && itemIndex === items.length - 1 ? ' data-wide=""' : '';
      const button = `<button type="button" class="palette-item"${wide} data-palette-kind="${item.kind}" aria-label="${escapeAttribute(`${item.label} 추가`)}">
        <span class="palette-glyph"><svg aria-hidden="true" focusable="false"><use href="#${symbolFor(item.kind).id}"></use></svg></span><span class="palette-label">${escapeText(item.label)}</span><span class="palette-kind">${item.kind.toUpperCase()}</span>
      </button>`;
      const hasCatalog = catalogFor(item.kind).length > 0;
      const detailControl = hasCatalog
        ? `<button type="button" class="palette-expand" data-palette-expand="${escapeAttribute(item.kind)}" aria-expanded="${expandedPaletteKind === item.kind}" aria-controls="palette-catalog-${escapeAttribute(item.kind)}" aria-label="${escapeAttribute(`${item.label} 모델 ${expandedPaletteKind === item.kind ? '접기' : '펼치기'}`)}"><span aria-hidden="true"></span></button>`
        : '<span class="palette-expand-placeholder" aria-hidden="true"></span>';
      return `<div class="palette-family" data-wide>
        <div class="palette-family-head">${button}${detailControl}</div>
        ${hasCatalog ? paletteCatalog(item.kind, item.label) : ''}
      </div>`;
    }).join('');
    return `<section class="palette-group" data-palette-group="${escapeAttribute(groupName)}">
      <button type="button" class="palette-group-toggle" data-palette-group-toggle="${escapeAttribute(groupName)}" aria-expanded="${open}" aria-controls="palette-group-${groupIndex}"><span>${escapeText(groupName)}</span><i aria-hidden="true"></i></button>
      <div class="palette-group-items" id="palette-group-${groupIndex}"${open ? '' : ' hidden'}>${itemsHtml}</div>
    </section>`;
  }).join('');
  const toolsHtml = `<section class="palette-group palette-modeling">
    <p class="palette-static-title">연결 · 도형 · 모델링</p>
    <div class="palette-tools">
      <button type="button" data-editor-action="device"><strong>직접 입력 장비</strong><small>종류와 한계값을 직접 작성</small></button>
      <button type="button" data-editor-action="connect"><strong>장비 링크</strong><small>두 장비를 차례로 선택</small></button>
      <button type="button" data-editor-action="annotation-connect"><strong>주석 연결</strong><small>설명선을 연결</small></button>
      <button type="button" data-editor-action="shape-rect"><strong>사각형</strong><small>보이는 캔버스 가운데에 추가</small></button>
      <button type="button" data-editor-action="shape-ellipse"><strong>타원</strong><small>보이는 캔버스 가운데에 추가</small></button>
      <button type="button" data-editor-action="shape-text"><strong>텍스트</strong><small>보이는 캔버스 가운데에 추가</small></button>
      <button type="button" data-editor-action="demand"><strong>트래픽 수요</strong><small>수요를 정의</small></button>
    </div>
  </section>`;
  element('component-palette').innerHTML = `${groupsHtml}${toolsHtml}`;
}

function setLeftPanel(name, { explicit = false } = {}) {
  if (explicit) panelSelectionExplicit = true;
  state.leftPanel = name;
  document.querySelectorAll('[data-panel-tab]').forEach((tab) => {
    const selected = tab.dataset.panelTab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element(`panel-${tab.dataset.panelTab}`).hidden = !selected;
  });
  element('failure-count').hidden = name !== 'failure';
}

function setWorkspacePanelCollapsed(side, collapsed) {
  const isLeft = side === 'left';
  state[isLeft ? 'leftPanelCollapsed' : 'rightPanelCollapsed'] = collapsed;
  const grid = document.querySelector('.main-grid');
  const panel = element(isLeft ? 'design-board' : 'inspector-panel');
  const button = element(isLeft ? 'toggle-left-panel' : 'toggle-right-panel');
  grid.classList.toggle(isLeft ? 'left-panel-collapsed' : 'right-panel-collapsed', collapsed);
  for (const child of panel.children) if (child.tagName !== 'HEADER') child.toggleAttribute('inert', collapsed);
  button.setAttribute('aria-pressed', String(collapsed));
  button.setAttribute('aria-label', collapsed ? (isLeft ? '설계 도구 펼치기' : '장비 검사 펼치기') : (isLeft ? '설계 도구 접기' : '장비 검사 접기'));
  requestAnimationFrame(queueVirtualFailureRows);
}

const CANVAS_MIN = { width: 940, height: 580 };
const CANVAS_PAD = 40;
const CANVAS_MAX = 12000;
const STAGE_PAD = 300;
// 맞춤이 설계를 화면 끝에 딱 붙이지 않도록 남기는 여백.
const FIT_MARGIN = 24;
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

// 캔버스와 콘텐츠는 다른 상자다. 캔버스는 최소 크기(CANVAS_MIN)를 깐 그리기 판이고,
// 콘텐츠는 장비·그룹·도형이 실제로 차지한 범위다. 맞춤은 콘텐츠를 봐야 한다.
function canvasViewport(devices) {
  const EMPTY = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const shapeBounds = (topology.diagram?.shapes || []).reduce((box, shape) => ({
    minX: Math.min(box.minX, shape.x), minY: Math.min(box.minY, shape.y),
    maxX: Math.max(box.maxX, shape.x + shape.width), maxY: Math.max(box.maxY, shape.y + shape.height),
  }), EMPTY);
  const deviceBounds = devices.reduce((box, { position, drawioVisual }) => ({
    minX: Math.min(box.minX, position.x - (drawioVisual?.width ?? (NODE_REACH.left + NODE_REACH.right)) / 2),
    minY: Math.min(box.minY, position.y - (drawioVisual?.height ?? (NODE_REACH.top + NODE_REACH.bottom)) / 2),
    maxX: Math.max(box.maxX, position.x + (drawioVisual?.width ?? (NODE_REACH.left + NODE_REACH.right)) / 2),
    maxY: Math.max(box.maxY, position.y + (drawioVisual?.height ?? (NODE_REACH.top + NODE_REACH.bottom)) / 2),
  }), shapeBounds);
  const contentBounds = groupBoxes(devices).reduce((box, group) => ({
    minX: Math.min(box.minX, group.x), minY: Math.min(box.minY, group.y),
    maxX: Math.max(box.maxX, group.x + group.width), maxY: Math.max(box.maxY, group.y + group.height),
  }), deviceBounds);
  // 빈 설계는 맞출 콘텐츠가 없다. 최소 캔버스를 콘텐츠로 본다.
  const content = Number.isFinite(contentBounds.minX)
    ? {
      x: contentBounds.minX,
      y: contentBounds.minY,
      width: Math.max(contentBounds.maxX - contentBounds.minX, 1),
      height: Math.max(contentBounds.maxY - contentBounds.minY, 1),
    }
    : { x: 0, y: 0, width: CANVAS_MIN.width, height: CANVAS_MIN.height };
  const bounds = {
    minX: Math.min(content.x, 0), minY: Math.min(content.y, 0),
    maxX: Math.max(content.x + content.width, CANVAS_MIN.width),
    maxY: Math.max(content.y + content.height, CANVAS_MIN.height),
  };
  const minX = bounds.minX < 0 ? bounds.minX - CANVAS_PAD : 0;
  const minY = bounds.minY < 0 ? bounds.minY - CANVAS_PAD : 0;
  const maxX = bounds.maxX > CANVAS_MIN.width ? bounds.maxX + CANVAS_PAD : CANVAS_MIN.width;
  const maxY = bounds.maxY > CANVAS_MIN.height ? bounds.maxY + CANVAS_PAD : CANVAS_MIN.height;
  return { minX, minY, width: Math.min(maxX - minX, CANVAS_MAX), height: Math.min(maxY - minY, CANVAS_MAX), content };
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
  element('drawio-import-layer').setAttribute('viewBox', `${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`);
  element('diagram-group-layer').setAttribute('viewBox', `${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`);
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

function createShapeAtVisibleCanvasCenter(kind) {
  const defaults = SHAPE_DRAW_DEFAULTS[kind];
  if (!defaults) return;
  const scroll = document.querySelector('.topology-scroll');
  const canvas = element('topology-canvas');
  const canvasBox = canvas.getBoundingClientRect();
  const scrollBox = scroll.getBoundingClientRect();
  const left = Math.max(canvasBox.left, scrollBox.left);
  const right = Math.min(canvasBox.right, scrollBox.right);
  const top = Math.max(canvasBox.top, scrollBox.top);
  const bottom = Math.min(canvasBox.bottom, scrollBox.bottom);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const x = Math.round(((centerX - canvasBox.left) / state.zoom + viewport.minX - defaults.width / 2) / 15) * 15;
  const y = Math.round(((centerY - canvasBox.top) / state.zoom + viewport.minY - defaults.height / 2) / 15) * 15;
  try {
    topology = addShape(topology, kind, { ...defaults, x, y });
    const shape = topology.diagram.shapes.at(-1);
    state.selection = [{ type: 'shape', id: shape.id }];
    shapeInspectorTab = 'style';
    closeEditorPanel();
    commitTopology(`${defaults.text} 도형을 추가했습니다.`);
    openMobileInspector();
  } catch (error) { showToast(error.message); }
}

function nextDeviceName(kind) {
  const used = new Set(topology.devices.map(({ id }) => id));
  for (let index = 1; index <= 999; index += 1) {
    const name = `${kind.toUpperCase()} ${index}`;
    if (!used.has(normalizeId(name))) return name;
  }
  return `${kind.toUpperCase()} ${Date.now()}`;
}

function createDeviceFromPalette(kind, position, catalogId = null, profileId = null) {
  const preset = PALETTE.find((item) => item.kind === kind);
  if (!preset) return;
  try {
    const entry = catalogId ? catalogEntry(catalogId) : null;
    const profile = entry ? catalogProfile(catalogId, profileId) : null;
    if (catalogId && (!entry || !profile || (entry.kind !== kind && !entry.kinds?.includes(kind)))) throw new Error('선택한 장비 프로필을 찾을 수 없습니다.');
    const device = addDevice(topology, {
      name: nextDeviceName(kind), kind, limits: preset.limits, position,
    });
    let detail = '장비 검사에서 한계값을 입력하세요.';
    if (entry && profile) {
      applySpec(topology, device.id, { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model });
      detail = `${entry.vendor} ${entry.model} · ${profile.label} 프로필을 적용했습니다.`;
    }
    state.selectedId = device.id;
    closeEditorPanel();
    commitTopology(`${device.name} 장비를 추가했습니다. ${detail}`);
    openMobileInspector();
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

/**
 * 큰 설계는 다 보여 주는 것이 아니라 그 설계가 말하는 곳을 보여 줘야 한다. 전체를 맞추면
 * 배율이 0.6 아래로 내려가 노드 글자가 읽히지 않기 때문이다. 나머지는 사용자가 밀어서 본다.
 * 화면에 들어가는 설계는 통째로 가운데에 온다. 들어가는지는 캔버스가 아니라 콘텐츠로 따진다.
 */
function focusCanvas(resourceId) {
  const scroll = document.querySelector('.topology-scroll');
  const device = resourceId && current.devices.find(({ id }) => id === resourceId);
  const box = viewport.content;
  const fits = box.width * state.zoom <= scroll.clientWidth && box.height * state.zoom <= scroll.clientHeight;
  if (!device || fits) { centerOnContent(); return; }
  scroll.scrollLeft = STAGE_PAD + (device.position.x - viewport.minX) * state.zoom - scroll.clientWidth / 2;
  scroll.scrollTop = STAGE_PAD + (device.position.y - viewport.minY) * state.zoom - scroll.clientHeight / 2;
}

// 콘텐츠 상자를 화면 가운데로 옮긴다. 캔버스 상자가 아니라 콘텐츠 상자여야, 도형 하나가
// 멀리 떨어져 캔버스를 늘려 놓아도 설계가 화면 밖으로 밀리지 않는다.
function centerOnContent() {
  const scroll = document.querySelector('.topology-scroll');
  const box = viewport.content;
  const centerX = STAGE_PAD + (box.x - viewport.minX + box.width / 2) * state.zoom;
  const centerY = STAGE_PAD + (box.y - viewport.minY + box.height / 2) * state.zoom;
  scroll.scrollLeft = Math.max(0, centerX - scroll.clientWidth / 2);
  scroll.scrollTop = Math.max(0, centerY - scroll.clientHeight / 2);
}

/**
 * 맞춤은 화면 크기에 설계를 맞추는 것이다. 줄이기만 하는 것이 아니라 늘리기도 한다.
 * 예전에는 Math.min(1, fit) 로 상한을 100% 에 걸어, 설계가 화면보다 작으면 버튼을 눌러도
 * 아무 일도 일어나지 않았다. 화면이 텅 비어 맞춤이 가장 필요한 상황에서 무반응이었다.
 * 기준도 캔버스가 아니라 콘텐츠다. 최소 캔버스(940x580)를 맞추면 필요보다 더 줄어든다.
 */
function zoomToFit() {
  const scroll = document.querySelector('.topology-scroll');
  const box = viewport.content;
  const fit = Math.min((scroll.clientWidth - FIT_MARGIN * 2) / box.width, (scroll.clientHeight - FIT_MARGIN * 2) / box.height);
  setZoom(Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, fit)));
  centerOnContent();
}

let panState = null;
let selectionBoxState = null;
let spatialOrbitState = null;

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

/** 이름표 상자를 글자 크기에 맞춘다. 화면에 붙기 전에는 잴 수 없어 그린 뒤에 한 번 돈다. */
function fitGroupTags() {
  for (const tag of element('link-layer').querySelectorAll('.group-tag')) {
    const label = tag.querySelector('.group-label');
    const frame = tag.querySelector('.group-tag-frame');
    // 캔버스가 접혀 있으면 잴 것이 없다. 그때는 상자를 두지 않는다 — 0 크기 상자는 점으로 남는다.
    let box; try { box = label.getBBox(); } catch { box = null; }
    if (!box || !box.width) { frame.removeAttribute('width'); continue; }
    frame.setAttribute('x', String(box.x - 5));
    frame.setAttribute('y', String(box.y - 3));
    frame.setAttribute('width', String(box.width + 10));
    frame.setAttribute('height', String(box.height + 6));
  }
}

let packetRuler = null;
function pathLength(geometry) {
  if (!packetRuler?.isConnected) {
    packetRuler = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    packetRuler.setAttribute('visibility', 'hidden');
    packetRuler.setAttribute('fill', 'none');
    element('link-layer').append(packetRuler);
  }
  packetRuler.setAttribute('d', geometry);
  try { return packetRuler.getTotalLength(); } catch { return 0; }
}

function renderTopology() {
  const hasDrawioImport = Boolean(topology.diagram?.drawioImport);
  applyViewport();
  if (topologyView.mode === 'spatial') syncSpatialScene();
  const devices = new Map(current.devices.map((item) => [item.id, item]));
  // 끊긴 demand 가 무장애였다면 지났을 링크. 살아 있지만 이 트래픽은 지나지 못한다.
  const severedPathLinks = new Set(current.demands.flatMap(({ severedPaths }) => (severedPaths || []).flatMap(({ links }) => links)));
  // 상자는 링크 아래, 이름표는 링크 위. 셋을 한 덩어리로 그리면 선이 RACK 03 같은 이름을 갈라
  // 놓아 어느 랙인지 읽을 수 없다. 상자를 위로 올리면 이번엔 상자 안의 링크가 가려진다.
  const boxes = groupBoxes(current.devices);
  const groupMarkup = boxes.map((group) => `<g class="topology-group" data-depth="${group.depth}">
      <rect class="group-frame" x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}"></rect>
    </g>`).join('');
  // 이름표가 선 위에 있어도 배경이 없으면 선이 글자 사이를 지난다. 상자를 깔아 탭처럼 앉힌다.
  // 상자 크기는 렌더 뒤에 글자를 실제로 재서 정한다 — 글꼴이 대체돼도 어긋나지 않는다.
  const groupLabels = boxes.map((group) => `<g class="group-tag" data-depth="${group.depth}">
      <rect class="group-tag-frame"></rect>
      <text class="group-label" x="${group.x + 11}" y="${group.y + 13}">${escapeText(group.label)}</text>
    </g>`).join('');
  // 계산의 rack/zone 프레임과 사용자가 만든 설계 그룹은 다른 의미다. 후자는 별도 오버레이로
  // 그려 장비·도형을 함께 묶어도 계산 경계처럼 읽히지 않게 한다.
  const diagramGroupMarkup = (topology.diagram?.groups || []).map((group) => {
    const members = group.memberIds.flatMap((id) => {
      const device = devices.get(id);
      if (device?.position) return [{ x: device.position.x - 64, y: device.position.y - 40, width: 128, height: 80 }];
      const shape = topology.diagram?.shapes?.find((item) => item.id === id);
      return shape ? [{ x: shape.x, y: shape.y, width: shape.width, height: shape.height }] : [];
    });
    if (!members.length) return '';
    const pad = 14; const left = Math.min(...members.map((item) => item.x)) - pad; const top = Math.min(...members.map((item) => item.y)) - pad;
    const right = Math.max(...members.map((item) => item.x + item.width)) + pad; const bottom = Math.max(...members.map((item) => item.y + item.height)) + pad;
    const locked = group.locked ? ' locked' : '';
    const selected = state.selection.length === 1 && state.selection[0].type === 'group' && state.selection[0].id === group.id ? ' selected' : '';
    return '<g class="diagram-group' + locked + selected + '" data-diagram-group-id="' + escapeAttribute(group.id) + '"><rect x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '" tabindex="0" role="button" aria-label="' + escapeAttribute(group.name + ' 그룹 검사' + (group.locked ? ' · 잠김' : '')) + '"></rect><text x="' + (left + 7) + '" y="' + (top + 12) + '">' + (group.locked ? '🔒 ' : '') + escapeText(group.name) + '</text></g>';
  }).join('');
  const endpointPoint = (id) => devices.get(id)?.position || (() => {
    const shape = topology.diagram?.shapes?.find((item) => item.id === id);
    return shape ? { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 } : null;
  })();
  const endpointShape = (id) => {
    const device = devices.get(id);
    if (device?.drawioVisual) {
      const visual = device.drawioVisual;
      return { geometry: { x: device.position.x - visual.width / 2, y: device.position.y - visual.height / 2, width: visual.width, height: visual.height } };
    }
    if (device?.position) return { geometry: { x: device.position.x - 64, y: device.position.y - 40, width: 128, height: 80 } };
    const shape = topology.diagram?.shapes?.find((item) => item.id === id);
    return shape ? { geometry: shape } : null;
  };
  const importedEdge = (connector) => ({ ...connector, geometry: connector.drawioGeometry || connector.geometry || { waypoints: connector.waypoints || [] }, paint: { stroke: connector.stroke, strokeWidth: connector.strokeWidth, ...(connector.paint || {}) } });
  const importedEdges = [
    ...(topology.diagram?.connectors || []).filter((connector) => Number.isInteger(connector.zIndex)),
    ...topology.links.filter((link) => Number.isInteger(link.drawioVisual?.zIndex)).map((link) => ({ ...link, ...link.drawioVisual, waypoints: link.drawioVisual.waypoints || [] })),
  ].map(importedEdge);
  const importedEdgeContext = createDrawioEdgeRenderContext(importedEdges.map((edge) => ({ edge, sourceShape: endpointShape(edge.source), targetShape: endpointShape(edge.target) })));
  const importedConnectorMarkup = (connector) => {
    const edge = importedEdge(connector);
    return renderDrawioEdgeSvg(edge, endpointShape(edge.source), endpointShape(edge.target), `applied-${edge.id}`, importedEdgeContext);
  };
  const diagramConnectors = (topology.diagram?.connectors || []).filter((connector) => !(hasDrawioImport && Number.isInteger(connector.zIndex))).map((connector) => {
    const source = endpointPoint(connector.source); const target = endpointPoint(connector.target);
    if (!source || !target) return '';
    const points = [source, ...(connector.waypoints || []), target].map(({ x, y }) => `${x},${y}`).join(' ');
    const selected = state.selection.some((item) => item.type === 'connector' && item.id === connector.id);
    const stroke = connector.stroke || 'var(--muted)';
    const width = connector.strokeWidth || 1.5;
    const dash = connector.dashed === false ? '' : ' stroke-dasharray="5 4"';
    const labelPoint = points.split(' ').map((point) => point.split(',').map(Number)).reduce((sum, point) => ({ x: sum.x + point[0], y: sum.y + point[1] }), { x: 0, y: 0 });
    const count = points.split(' ').length;
    const label = connector.label ? `<text class="diagram-connector-label" x="${labelPoint.x / count}" y="${labelPoint.y / count}" text-anchor="middle">${escapeText(connector.label)}</text>` : '';
    const selectedStroke = selected ? 'var(--signal-deep)' : stroke;
    const hitWidth = Math.max(width + 12, 16);
    const marker = (side) => {
      const arrow = connector[`${side}Arrow`] || 'none';
      if (arrow === 'none') return { attribute: '', definition: '' };
      const id = `diagram-marker-${connector.id}-${side}`;
      const path = arrow === 'open' ? 'M 1 1 L 9 5 L 1 9' : arrow === 'block' ? 'M 0 0 L 10 5 L 0 10 L 2 5 Z' : 'M 0 0 L 10 5 L 0 10 Z';
      const fill = arrow === 'open' ? 'none' : selectedStroke;
      return {
        attribute: ` marker-${side === 'start' ? 'start' : 'end'}="url(#${id})"`,
        definition: `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="${path}" fill="${escapeAttribute(fill)}" stroke="${escapeAttribute(selectedStroke)}" stroke-width="1.2"></path></marker></defs>`,
      };
    };
    const startMarker = marker('start'); const endMarker = marker('end');
    const locked = connector.locked ? ' locked' : '';
    return `<g class="diagram-connector${selected ? ' selected' : ''}${locked}" data-connector-id="${escapeAttribute(connector.id)}">${startMarker.definition}${endMarker.definition}<polyline class="diagram-connector-hit" points="${points}" fill="none" stroke="transparent" stroke-width="${hitWidth}" tabindex="0" role="button" aria-label="${escapeAttribute(`${connector.label || connector.id} 연결선 검사${connector.locked ? ' · 잠김' : ''}`)}"></polyline><polyline class="diagram-connector-line" points="${points}" fill="none" stroke="${escapeAttribute(selectedStroke)}" stroke-width="${selected ? Math.max(width + 2, 2.5) : width}"${dash}${startMarker.attribute}${endMarker.attribute}></polyline>${connector.locked ? `<text class="diagram-lock-mark" x="${labelPoint.x / count}" y="${labelPoint.y / count - 8}" text-anchor="middle">🔒</text>` : ''}${label}</g>`;
  }).join('');
  // 가져온 연결선의 보이는 선은 pointer-events 가 꺼진 그림 레이어에만 있다. 같은 경로 위에
  // 투명한 잡이줄을 놓지 않으면 선택할 수 없고, 선택할 수 없으면 링크로 승격할 수도 없다.
  const importedConnectorHits = (topology.diagram?.connectors || [])
    .filter((connector) => hasDrawioImport && Number.isInteger(connector.zIndex))
    .map((connector) => {
      const route = importedEdgeContext.get(connector.id)?.route?.points;
      if (!route || route.length < 2) return '';
      const geometry = escapeAttribute(route.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' '));
      const selected = state.selection.some((item) => item.type === 'connector' && item.id === connector.id);
      return `<g class="diagram-connector${selected ? ' selected' : ''}${connector.locked ? ' locked' : ''}" data-connector-id="${escapeAttribute(connector.id)}">
        ${selected ? `<path class="link-selection" d="${geometry}"></path>` : ''}
        <path class="diagram-connector-hit" d="${geometry}" fill="none" stroke="transparent" stroke-width="16" tabindex="0" role="button" aria-label="${escapeAttribute(`${connector.label || connector.id} 연결선 검사${connector.locked ? ' · 잠김' : ''}`)}"></path>
      </g>`;
    }).join('');

  // 라벨이 어디에 앉을지 먼저 정한다. 한 링크만 보고는 옆 라벨과 겹치는지 알 수 없다.
  const selectionHas = (type, id) => state.selection.some((item) => item.type === type && item.id === id)
    || type === 'shape' && state.selection.some((item) => item.type === 'group'
      && topology.diagram?.groups?.find(({ id: groupId }) => groupId === item.id)?.memberIds.includes(id));
  const linkStatus = (link) => (link.severed ? 'disabled' : severedPathLinks.has(link.id) ? 'on-severed-path' : link.primaryStatus);
  // 마디를 한 번만 정하고 선·판정 영역·패킷 점·라벨이 모두 그것을 쓴다. 따로 계산하면
  // 곡선 위의 라벨이 직선 자리에 남는다. 양 끝 노드는 장애물에서 뺀다 - 자기 카드는 지나야 한다.
  const cards = new Map(current.devices.filter(({ position }) => position).map((device) => [device.id, cardBox(device.position)]));
  const bendsOf = (id) => (bendDrag?.id === id ? bendDrag.points : topology.links.find((link) => link.id === id)?.waypoints || []);
  const routes = new Map(current.links.map((link) => [link.id, routeLink(
    devices.get(link.source).position, devices.get(link.target).position,
    [...cards].filter(([id]) => id !== link.source && id !== link.target).map(([, box]) => box), routeView.mode, bendsOf(link.id))]));
  // 라벨은 가운데 마디 위에서 자리를 찾는다(diagram.js 와 같은 규칙).
  const midSegment = (points) => { const half = Math.max(1, Math.floor(points.length / 2)); return [points[half - 1], points[half]]; };
  const labelSpots = placeLinkLabels(current.links.map((link) => {
    const [from, to] = midSegment(routes.get(link.id));
    return {
      id: link.id,
      text: link.severed ? 'DOWN' : detailView.level === 'off' ? '' : formatPercent(link.axes.forwarding_bps?.utilization),
      status: linkStatus(link),
      util: link.axes.forwarding_bps?.utilization ?? null,
      binding: link.id === current.summary.bindingResourceId,
      from, to,
    };
  }).filter(({ text }) => text), current.devices.map(({ position }) => position));
  // 손잡이는 자동으로 생긴 마디가 아니라 사용자가 찍은 자리와 그 사이의 가운데에 둔다. 모드를
  // 바꿔도 같은 자리에 있어야 무엇을 옮기는 것인지 예측할 수 있다. 가운데를 끌면 마디가 생기고,
  // 찍힌 자리를 끌면 그 마디가 움직인다.
  const bendHandles = (link) => {
    const anchors = [devices.get(link.source).position, ...bendsOf(link.id), devices.get(link.target).position];
    const pinned = bendsOf(link.id).length;
    const handles = bendsOf(link.id).map((point, index) =>
      `<rect class="link-handle" data-bend-link="${escapeAttribute(link.id)}" data-bend-index="${index}" data-bend-kind="move" x="${point.x - 4}" y="${point.y - 4}" width="8" height="8"></rect>`);
    if (pinned >= 8) return handles.join('');
    // 한가운데는 대개 노드 카드 밑이다 - 카드가 선 위에 그려지므로 그 자리의 손잡이는 눌리지
    // 않는다. 가운데에서 시작해 양쪽으로 물러나며 카드에 안 걸리는 첫 자리를 쓴다.
    const boxes = [...cards.values()];
    const open = (point) => !boxes.some((box) => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom);
    for (let index = 1; index < anchors.length; index += 1) {
      const from = anchors[index - 1]; const to = anchors[index];
      const along = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]
        .map((share) => ({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }));
      const spot = along.find(open) ?? along[0];
      handles.push(`<circle class="link-handle new" data-bend-link="${escapeAttribute(link.id)}" data-bend-index="${index - 1}" data-bend-kind="insert" cx="${spot.x}" cy="${spot.y}" r="4"></circle>`);
    }
    return handles.join('');
  };

  element('link-layer').innerHTML = groupMarkup + (topology.synthetic ? '<text class="synthetic-marker" x="18" y="30">SYNTHETIC TOPOLOGY</text>' : '') + current.links.map((link) => {
    // 가져온 링크는 draw.io 선 자체가 그려지므로 기본 선은 다시 긋지 않는다. 부하 표시와 패킷
    // 점은 그 선 위에 얹어야 하므로, 앱이 계산한 경로가 아니라 draw.io 가 낸 경로를 쓴다.
    // 두 레이어는 viewBox 가 같아 좌표를 변환할 필요가 없다.
    const importedPoints = hasDrawioImport && link.drawioVisual ? importedEdgeContext.get(link.id)?.route?.points : null;
    const imported = importedPoints?.length >= 2 ? importedPoints : null;
    const onSeveredPath = !link.severed && severedPathLinks.has(link.id);
    const status = detailView.level === 'off' && !onSeveredPath && !link.severed ? 'healthy' : linkStatus(link);
    const spot = imported ? imported[Math.floor(imported.length / 2)] : labelSpots.get(link.id);
    const geometryRaw = imported ? imported.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ') : linkPath(routes.get(link.id), routeView.mode);
    const geometry = escapeAttribute(geometryRaw);
    const linkLength = pathLength(geometryRaw);
    const utilization = link.axes.forwarding_bps?.utilization;
    // 점은 방향마다 따로 흐른다. 하나로 합치면 요청과 응답이 같은 줄로 보여, returnPath 를 적어
    // 응답을 옮겨 놓고도 그림은 예전과 같아진다. 되돌아오는 점은 속을 비워 한눈에 갈리게 한다.
    // 미확인 방향에는 아무것도 그리지 않는다 - 모르는 양을 움직이는 점으로 그리면 사실이 된다.
    const packetStream = (direction) => {
      if (detailView.level === 'off') return '';
      const axis = link.directions?.[direction]?.axes?.forwarding_bps;
      const share = axis && axis.status !== 'unknown' ? axis.utilization : null;
      if (link.severed || onSeveredPath || !(share > 0)) return '';
      const count = Math.min(4, Math.max(1, Math.ceil(share * 3)));
      const motion = packetMotion(share, linkLength, direction);
      if (!motion) return '';
      const back = direction === 'reverse';
      const along = ` keyPoints="${motion.keyPoints}" keyTimes="${motion.keyTimes}" calcMode="${motion.calcMode}"`;
      return Array.from({ length: count }, (_, index) => `<circle class="packet-dot ${status}${back ? ' response' : ''}${motion.reach < 1 ? ' dropped' : ''}" style="--packet-dur:${motion.duration.toFixed(2)}s;--packet-delay:-${(motion.duration * index / count).toFixed(2)}s" r="${back ? 2.6 : 3}">
        <animateMotion path="${geometry}"${along} dur="${motion.duration.toFixed(2)}s" begin="-${(motion.duration * index / count).toFixed(2)}s" repeatCount="indefinite"></animateMotion>
      </circle>`).join('');
    };
    const packetDots = packetStream('forward') + packetStream('reverse');
    return `<g class="link-group" data-link-id="${escapeAttribute(link.id)}">
      ${selectionHas('link', link.id) ? `<path class="link-selection" d="${geometry}"></path>` : ''}
      ${imported ? '' : `<path class="link ${status}" d="${geometry}"></path>`}
      <path class="link-hit" d="${geometry}" tabindex="0" role="button" aria-label="${escapeAttribute(`${resourceName(link)} 링크 검사${link.severed ? ' · 끊김' : onSeveredPath ? ' · 경로 단절' : ''}`)}"></path>
      ${packetDots}
      ${spot ? `<text class="link-label"${link.severed ? '' : ` data-live-util="${utilization ?? ''}" data-live-seed="${link.id}" data-live-source-type="${escapeAttribute(link.sourceInfo?.type || 'datasheet')}"`} x="${spot.x}" y="${spot.y}" text-anchor="middle">${link.severed ? 'DOWN' : formatPercent(utilization)}</text>` : ''}
      ${!imported && selectionHas('link', link.id) ? bendHandles(link) : ''}
    </g>`;
  }).join('') + diagramConnectors + importedConnectorHits + (hasDrawioImport ? '' : groupLabels);
  fitGroupTags();
  element('diagram-group-layer').innerHTML = hasDrawioImport ? '' : diagramGroupMarkup;
  for (const frame of element('diagram-group-layer').querySelectorAll('[data-diagram-group-id] :is(rect, text)')) {
    frame.addEventListener('click', (event) => {
      event.stopPropagation();
      selectDiagramGroup(frame.closest('[data-diagram-group-id]')?.dataset.diagramGroupId, event);
    });
  }

  element('diagram-layer').innerHTML = (topology.diagram?.shapes || []).map((shape) => {
    const selected = selectionHas('shape', shape.id);
    const resizeSelected = state.selection.length === 1 && state.selection[0].type === 'shape' && state.selection[0].id === shape.id;
    const handles = resizeSelected && !shape.locked ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
      .map((direction) => `<span class="diagram-resize-handle ${direction}" data-shape-resize="${direction}" aria-hidden="true"></span>`).join('') : '';
    const fill = shape.fill && shape.fill !== 'none' ? shape.fill : 'transparent';
    const stroke = shape.stroke && shape.stroke !== 'none' ? shape.stroke : 'transparent';
    const background = shape.gradient && fill !== 'transparent' ? `linear-gradient(180deg, ${shape.gradientColor || '#ffffff'}, ${fill})` : fill;
    const effects = [shape.rounded ? ' rounded' : '', shape.sketch ? ' sketch' : '', shape.glass ? ' glass' : '', shape.shadow ? ' shadow' : '', shape.lineStyle === 'dashed' ? ' dashed' : '', shape.lineStyle === 'dotted' ? ' dotted' : ''].join('');
    const style = `left:${shape.x - viewport.minX}px;top:${shape.y - viewport.minY}px;width:${shape.width}px;height:${shape.height}px;z-index:${shape.zIndex ?? 0};background:${background};border-color:${stroke};border-width:${shape.strokeWidth ?? 1}px;border-radius:${shape.rounded && shape.kind !== 'ellipse' ? '10px' : ''};opacity:${shape.opacity ?? 1};color:${shape.textColor || 'var(--text)'};font-size:${shape.fontSize || 11}px;font-weight:${shape.fontWeight || 500};text-align:${shape.textAlign || 'center'};align-items:${shape.verticalAlign === 'top' ? 'start' : shape.verticalAlign === 'bottom' ? 'end' : 'center'};justify-items:${shape.textAlign === 'left' ? 'start' : shape.textAlign === 'right' ? 'end' : 'center'};`;
    const annotationState = state.editorMode === 'annotation' ? (annotationSource === shape.id ? ' annotation-source' : annotationSource ? ' annotation-target' : '') : '';
    const visual = shape.drawioShape ? `<svg class="diagram-drawio-visual" viewBox="${shape.x} ${shape.y} ${shape.width} ${shape.height}" aria-hidden="true">${renderDrawioVisualSvg({ geometry: shape, text: shape.text, labelRuns: shape.labelRuns, paint: shape.paint, drawioShape: shape.drawioShape, drawioOptions: shape.drawioOptions, imageAssetId: shape.imageAssetId }, topology.diagram.drawioAssets || [])}</svg>` : `<span class="diagram-shape-label">${escapeText(shape.text || '')}</span>`;
    const sourceHit = hasDrawioImport && Number.isInteger(shape.zIndex);
    return `<button type="button" class="diagram-shape${shape.drawioShape ? ' drawio-visual' : ''}${sourceHit ? ' drawio-source-hit' : ''}${selected ? ' selected' : ''}${shape.locked ? ' locked' : ''}${annotationState}${effects}" data-shape-id="${escapeAttribute(shape.id)}" data-kind="${escapeAttribute(shape.kind)}" aria-label="${escapeAttribute(`${shape.text || shape.id}${shape.locked ? ' · 잠김' : ''}`)}" style="${escapeAttribute(style)}">${sourceHit ? '' : visual}${shape.locked ? '<span class="diagram-lock-mark" aria-hidden="true">🔒</span>' : ''}${handles}</button>`;
  }).join('');

  const pools = backendPoolIndex(current.demands);
  element('node-layer').innerHTML = current.devices.map((device) => {
    const status = device.active ? detailView.level === 'off' ? 'healthy' : device.primaryStatus : 'disabled';
    const pool = device.active && detailView.level !== 'off' ? poolNote(pools.get(device.id)) : '';
    const idle = device.active && detailView.level !== 'off' && !pool && !device.carriesDemand ? '트래픽 수요 없음' : '';
    const { rows: allRows, hidden: allHidden } = nodeAxes(device);
    // 요약은 병목 축만 남긴다. 화면 제목이 부르는 것이 그 축이다. 다만 미확인 축은 함께
    // 남긴다 - 접어 두면 86% 옆에서 아는 값만 보이고 모르는 축이 있다는 사실이 사라져, 읽는
    // 사람이 이 장비를 다 안다고 여긴다. 미확인은 대개 없거나 하나라 줄이 크게 늘지 않는다.
    // 병목을 못 고르면 첫 줄을 남긴다 - 아무것도 안 보이면 노드가 빈 상자가 된다.
    const brief = detailView.level === 'brief';
    const keep = allRows.filter(([key, axis]) => key === device.bindingAxis || axis.status === 'unknown');
    const rows = !brief ? allRows : (keep.length ? keep : allRows.slice(0, 1));
    const hidden = detailView.level === 'full' ? allHidden : allHidden + (allRows.length - rows.length);
    const verdict = sweep.resources.find(({ id }) => id === device.id);
    const domainSpof = detailView.level === 'off' ? null : (domainSweep.redundancyInvalid || []).find(({ memberIds }) => memberIds.includes(device.id));
    // 이미 죽은 장비에 "이게 죽으면 끊긴다"와 숨긴 축 개수를 붙이는 것은 소음이다.
    const spof = detailView.level !== 'off' && device.active && !sweepStale() && verdict?.verdict === 'severs' && !verdict.endpoint;
    const spofLabel = spof ? 'SPOF' : domainSpof ? `SPOF · ${domainSpof.name}` : '';
    const meta = [device.kind.toUpperCase(), behaviorToken(device), zonePath(device.zone).at(-1) || device.zone,
      spofLabel,
      // 없앰에서는 숨긴 개수를 말하지 않는다. 축 블록이 통째로 없어 +2 가 무엇의 2인지 알 수 없다.
      device.active && hidden && detailView.level !== 'off' ? `+${hidden}` : ''].filter(Boolean).join(' \u00b7 ');
    const axes = detailView.level === 'off' ? ''
      : device.active
        ? rows.map(([key, axis]) => nodeAxisRow(device, key, axis, brief)).join('')
        : `<span class="node-axis" data-axis-state="disabled"><i>${STATE_TOKEN.disabled}</i><b>OFFLINE</b><em>\u2014</em><s>DOWN</s></span>`;
    const annotationState = state.editorMode === 'annotation' ? (annotationSource === device.id ? ' annotation-source' : annotationSource ? ' annotation-target' : '') : '';
    const sourceHit = hasDrawioImport && device.drawioVisual;
    const importedVisual = device.drawioVisual ? `<svg class="node-drawio-visual" viewBox="0 0 ${device.drawioVisual.width} ${device.drawioVisual.height}" aria-hidden="true">${renderDrawioVisualSvg({ geometry: { x: 0, y: 0, width: device.drawioVisual.width, height: device.drawioVisual.height }, text: device.drawioVisual.text || '', labelRuns: device.drawioVisual.labelRuns, paint: device.drawioVisual.paint, drawioShape: device.drawioVisual.drawioShape, drawioOptions: device.drawioVisual.drawioOptions, imageAssetId: device.drawioVisual.imageAssetId }, topology.diagram?.drawioAssets || [])}</svg>` : deviceSymbol(device);
    const sourceStyle = sourceHit ? `width:${device.drawioVisual.width}px;--symbol-h:${device.drawioVisual.height}px;` : '';
    return `<button type="button" class="mesh-node ${device.drawioVisual ? 'drawio-device ' : ''}${sourceHit ? 'drawio-source-hit ' : ''}${status} ${state.selectedId === device.id ? 'selected' : ''} ${selectionHas('device', device.id) ? 'multi-selected' : ''} ${state.connectSource === device.id ? 'connect-source' : ''}${annotationState}" data-device-id="${escapeAttribute(device.id)}" style="left:${device.position.x - viewport.minX}px;top:${device.position.y - viewport.minY}px;z-index:${device.drawioVisual?.zIndex ?? 0};${sourceStyle}" aria-pressed="${state.selectedId === device.id}" aria-label="${escapeAttribute(nodeAccessibleName(device))}">
      <span class="node-symbol">${sourceHit ? '' : `${device.active ? '<span class="node-ports" aria-hidden="true">' + ['top', 'right', 'bottom', 'left'].map((side) => `<i data-port="${side}"></i>`).join('') + '</span>' : ''}${vendorBadge(device)}${topology.synthetic ? '<span class="synthetic-badge" aria-label="합성값">SYN</span>' : ''}${classView.badge === 'on' ? `<span class="node-class-badge">${escapeText(kindInitial(device.kind))}</span>` : ''}${importedVisual}`}</span><span class="node-rail"></span><span class="node-labels"><span class="node-name">${escapeText(device.name)}</span>${device.model ? `<span class="node-model">${escapeText(device.model)}</span>` : ''}${pool || idle ? `<span class="node-pool"${idle ? ' data-warn=""' : ''}>${escapeText(pool || idle)}</span>` : ''}<span class="node-axes">${axes}</span><span class="node-meta" title="${escapeAttribute(meta)}">${escapeText(meta)}</span></span>
    </button>`;
  }).join('');
  const importedElements = [
    ...(topology.diagram?.shapes || []).filter((shape) => Number.isInteger(shape.zIndex) && shape.drawioShape).map((shape) => ({ zIndex: shape.zIndex, role: 'shape', markup: renderDrawioVisualSvg({ geometry: shape, text: shape.text, labelRuns: shape.labelRuns, paint: shape.paint, drawioShape: shape.drawioShape, drawioOptions: shape.drawioOptions, imageAssetId: shape.imageAssetId }, topology.diagram?.drawioAssets || []) })),
    ...topology.devices.filter((device) => Number.isInteger(device.drawioVisual?.zIndex)).map((device) => { const visual = device.drawioVisual; return { zIndex: visual.zIndex, role: 'device', markup: renderDrawioVisualSvg({ geometry: { x: device.position.x - visual.width / 2, y: device.position.y - visual.height / 2, width: visual.width, height: visual.height }, text: visual.text || '', labelRuns: visual.labelRuns, paint: visual.paint, drawioShape: visual.drawioShape, drawioOptions: visual.drawioOptions, imageAssetId: visual.imageAssetId }, topology.diagram.drawioAssets || []) }; }),
    ...(topology.diagram?.connectors || []).filter((connector) => Number.isInteger(connector.zIndex)).map((connector) => ({ zIndex: connector.zIndex, role: 'connector', markup: importedConnectorMarkup(connector) })),
    ...topology.links.filter((link) => Number.isInteger(link.drawioVisual?.zIndex)).map((link) => ({ zIndex: link.drawioVisual.zIndex, role: 'link', markup: importedConnectorMarkup({ ...link, ...link.drawioVisual, waypoints: link.drawioVisual.waypoints || [] }) })),
  ].sort((a, b) => a.zIndex - b.zIndex).map(({ zIndex, role, markup }) => `<g data-drawio-z-index="${zIndex}" data-drawio-role="${role}">${markup}</g>`).join('');
  element('drawio-import-layer').innerHTML = hasDrawioImport ? importedElements : '';
}

function renderInspector() {
  const selectedGroupId = state.selection.length === 1 && state.selection[0].type === 'group' ? state.selection[0].id : null;
  const selectedGroup = selectedGroupId ? topology.diagram?.groups?.find(({ id }) => id === selectedGroupId) : null;
  const selectedConnectorId = state.selection.length === 1 && state.selection[0].type === 'connector' ? state.selection[0].id : null;
  const selectedConnector = selectedConnectorId ? topology.diagram?.connectors?.find(({ id }) => id === selectedConnectorId) : null;
  if (selectedGroup) {
    setInspectorHeading('DIAGRAM INSPECTOR', '그룹 검사');
    element('resource-state').textContent = '그룹 편집';
    element('resource-state').style.color = 'var(--signal-deep)';
    element('inspector-content').innerHTML = renderGroupEditor(selectedGroup);
    return;
  }
  if (selectedConnector) {
    setInspectorHeading('DIAGRAM INSPECTOR', '연결선 검사');
    element('resource-state').textContent = '연결선 편집';
    element('resource-state').style.color = 'var(--signal-deep)';
    element('inspector-content').innerHTML = renderConnectorEditor(selectedConnector);
    return;
  }
  const selectedShapeId = state.selection.length === 1 && state.selection[0].type === 'shape' ? state.selection[0].id : null;
  const selectedShape = selectedShapeId ? topology.diagram?.shapes?.find(({ id }) => id === selectedShapeId) : null;
  if (selectedShape) {
    setInspectorHeading('DRAW.IO INSPECTOR', shapeInspectorTitle(selectedShape));
    element('resource-state').textContent = '도형 편집';
    element('resource-state').style.color = 'var(--signal-deep)';
    element('inspector-content').innerHTML = renderShapeEditor(selectedShape);
    return;
  }
  const resource = resourceById(state.selectedId) || current.devices[0];
  if (!resource) {
    setInspectorHeading('AXIS INSPECTOR', '장비 검사');
    element('resource-state').textContent = '빈 설계';
    element('inspector-content').innerHTML = '<div class="empty-inspector"><strong>장비가 없습니다.</strong><span>상단의 장비 추가 또는 장비 JSON 가져오기로 시작하세요.</span></div>';
    return;
  }
  const isDevice = 'kind' in resource;
  setInspectorHeading('AXIS INSPECTOR', isDevice ? '장비 검사' : '링크 검사');
  const source = isDevice ? resource.source || { type: 'estimate', label: '추정값', condition: '조건 미지정' } : { label: '링크 정격', condition: '방향별 full-duplex capacity' };
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

function setInspectorHeading(code, title) {
  element('inspector-code').textContent = code;
  element('inspector-heading').textContent = title;
  element('mobile-inspector-open').textContent = `${title} 열기`;
  element('inspector-close-mobile').setAttribute('aria-label', `${title} 닫기`);
}

function shapeInspectorTitle(shape) {
  const label = { rect: '사각형', ellipse: '타원', text: '텍스트', note: '메모' }[shape.kind] || shape.kind;
  return `${shape.text || shape.id} · ${label}`;
}

function shapeColorValue(shape, property) {
  if (shape[property]) return shape[property];
  if (property === 'fill') return shape.kind === 'text' ? 'none' : '#ffffff';
  if (property === 'stroke') return shape.kind === 'text' ? 'none' : '#13241f';
  return '#13241f';
}

function colorPickerIcon() {
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"></circle><path d="M10 3a7 7 0 0 1 0 14c1.7-2 1.7-4 0-6s-1.7-4 0-8Z"></path></svg>';
}

function eyedropperIcon() {
  return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M 12 3 L 17 8 L 15 10 L 14 9 L 7 16 L 4 16 L 4 13 L 11 6 L 10 5 Z"></path><path d="M 5 13 L 7 15"></path></svg>';
}

function renderShapeColorControl(shape, property, label, { allowNone = true } = {}) {
  const value = shapeColorValue(shape, property);
  const visible = value === 'none' ? '#ffffff' : value;
  const options = SHAPE_COLOR_PALETTE.map((color) => `<button type="button" class="shape-color-chip" data-shape-color-value="${escapeAttribute(property)}" data-color="${color}" style="--chip:${color}" aria-label="${escapeAttribute(`${label} ${color}`)}" aria-pressed="${value === color}"></button>`).join('');
  const transparent = allowNone ? `<button type="button" class="shape-color-chip transparent" data-shape-color-value="${escapeAttribute(property)}" data-color="none" aria-label="${escapeAttribute(`${label} 없음`)}" aria-pressed="${value === 'none'}"></button>` : '';
  return `<section class="shape-style-section" data-shape-color-control="${escapeAttribute(property)}">
    <div class="shape-style-heading"><h3>${escapeText(label)}</h3><span>${value === 'none' ? '없음' : '선택됨'}</span></div>
    <div class="shape-color-toolbar">
      <button type="button" class="shape-current-color${value === 'none' ? ' transparent' : ''}" data-shape-color-toggle="${escapeAttribute(property)}" aria-expanded="false" aria-controls="shape-color-${escapeAttribute(property)}" style="--current:${visible}" aria-label="${escapeAttribute(`${label} 기본 색상 열기`)}"></button>
      <button type="button" class="shape-color-auto" data-shape-color-value="${escapeAttribute(property)}" data-color="${property === 'fill' ? '#ffffff' : '#13241f'}">Auto</button>
      <button type="button" class="shape-eyedropper" data-shape-eyedropper="${escapeAttribute(property)}" aria-label="${escapeAttribute(`${label} 스포이드`)}">${eyedropperIcon()}</button>
      <label class="shape-native-color" aria-label="${escapeAttribute(`${label} 사용자 색상`)}">${colorPickerIcon()}<input type="color" data-shape-native-color="${escapeAttribute(property)}" value="${escapeAttribute(visible)}"></label>
      <input type="hidden" name="${escapeAttribute(property)}" value="${escapeAttribute(value)}">
    </div>
    <div class="shape-color-palette" id="shape-color-${escapeAttribute(property)}" hidden>${transparent}${options}</div>
  </section>`;
}

function renderShapeEditor(shape) {
  const kinds = [['rect', '사각형'], ['ellipse', '타원'], ['text', '텍스트'], ['note', '메모']];
  const tab = (id, label) => `<button type="button" role="tab" id="shape-tab-${id}" aria-selected="${shapeInspectorTab === id}" aria-controls="shape-panel-${id}" tabindex="${shapeInspectorTab === id ? 0 : -1}" data-shape-inspector-tab="${id}">${label}</button>`;
  const panel = (id, content) => `<section id="shape-panel-${id}" class="shape-inspector-panel" role="tabpanel" aria-labelledby="shape-tab-${id}"${shapeInspectorTab === id ? '' : ' hidden'}>${content}</section>`;
  const selection = state.selection.filter(({ type }) => type === 'device' || type === 'shape');
  const arrangeActions = `<div class="shape-arrange-actions"><button type="button" data-editor-action="align-left"${selection.length >= 2 ? '' : ' disabled'}>왼쪽 정렬</button><button type="button" data-editor-action="distribute-x"${selection.length >= 3 ? '' : ' disabled'}>가로 분배</button><button type="button" data-editor-action="group"${selection.length >= 2 ? '' : ' disabled'}>그룹</button></div>`;
  return `<form class="shape-editor${shape.locked ? ' locked' : ''}" novalidate data-resource-form="shape" data-resource-id="${escapeAttribute(shape.id)}">
    <div class="resource-identity"><strong>${escapeText(shape.text || shape.id)}</strong><span>도형 · ${escapeText(shape.kind)}${shape.locked ? ' · 잠김' : ''}</span></div>
    <label class="shape-lock"><input name="locked" type="checkbox" data-diagram-lock${shape.locked ? ' checked' : ''}><span>도형 잠금</span></label>
    <div class="shape-inspector-tabs" role="tablist" aria-label="도형 검사 탭">${tab('style', 'Style')}${tab('text', 'Text')}${tab('arrange', 'Arrange')}</div>
    ${panel('style', `${renderShapeColorControl(shape, 'fill', '채우기')}
      <label class="shape-option-row"><input type="checkbox" name="gradient" data-shape-effect${shape.gradient ? ' checked' : ''}><span>그라데이션</span><small>채우기 색상</small></label>
      ${shape.gradient ? renderShapeColorControl(shape, 'gradientColor', '그라데이션 색상', { allowNone: false }) : ''}
      ${renderShapeColorControl(shape, 'stroke', '둘레')}
      <div class="shape-style-section"><div class="shape-style-heading"><h3>선</h3></div><div class="shape-line-controls">
        <label><span>스타일</span><select name="lineStyle" data-shape-style-field><option value="solid"${!shape.lineStyle || shape.lineStyle === 'solid' ? ' selected' : ''}>실선</option><option value="dashed"${shape.lineStyle === 'dashed' ? ' selected' : ''}>파선</option><option value="dotted"${shape.lineStyle === 'dotted' ? ' selected' : ''}>점선</option></select></label>
        <label><span>굵기</span><select name="strokeWidth" data-shape-style-field><option value="0"${(shape.strokeWidth ?? 1) === 0 ? ' selected' : ''}>없음</option>${[1, 2, 3, 4, 6].map((width) => `<option value="${width}"${(shape.strokeWidth ?? 1) === width ? ' selected' : ''}>${width} pt</option>`).join('')}</select></label>
      </div></div>
      <div class="shape-style-section"><div class="shape-style-heading"><h3>불투명도</h3><output data-shape-opacity-output>${Math.round((shape.opacity ?? 1) * 100)}%</output></div><input class="shape-opacity-range" name="opacity" type="range" min="0" max="1" step="0.05" value="${shape.opacity ?? 1}" data-shape-style-field></div>
      <details class="shape-effects"><summary>효과</summary><div><label><input type="checkbox" name="rounded" data-shape-effect${shape.rounded ? ' checked' : ''}>둥근 모서리</label><label><input type="checkbox" name="sketch" data-shape-effect${shape.sketch ? ' checked' : ''}>스케치</label><label><input type="checkbox" name="glass" data-shape-effect${shape.glass ? ' checked' : ''}>유리 효과</label><label><input type="checkbox" name="shadow" data-shape-effect${shape.shadow ? ' checked' : ''}>그림자</label></div></details>
      <div class="shape-style-edit"><span>편집</span><button type="button" data-shape-style-copy>스타일 복사</button><button type="button" data-shape-style-paste${shapeStyleClipboard ? '' : ' disabled'}>스타일 붙여넣기</button></div>`)}
    ${panel('text', `<div class="shape-editor-grid">
      <label class="shape-editor-wide"><span>텍스트</span><input name="text" value="${escapeAttribute(shape.text || '')}" maxlength="10000"></label>
      ${renderShapeColorControl(shape, 'textColor', '글자 색상', { allowNone: false })}
      <label><span>글자 크기</span><input name="fontSize" type="number" min="8" max="72" value="${shape.fontSize || 11}"></label>
      <label><span>가로 정렬</span><select name="textAlign"><option value="left"${shape.textAlign === 'left' ? ' selected' : ''}>왼쪽</option><option value="center"${!shape.textAlign || shape.textAlign === 'center' ? ' selected' : ''}>가운데</option><option value="right"${shape.textAlign === 'right' ? ' selected' : ''}>오른쪽</option></select></label>
      <label><span>세로 정렬</span><select name="verticalAlign"><option value="top"${shape.verticalAlign === 'top' ? ' selected' : ''}>위</option><option value="middle"${!shape.verticalAlign || shape.verticalAlign === 'middle' ? ' selected' : ''}>가운데</option><option value="bottom"${shape.verticalAlign === 'bottom' ? ' selected' : ''}>아래</option></select></label>
      <label><span>글자 굵기</span><select name="fontWeight"><option value="normal"${shape.fontWeight === 'normal' ? ' selected' : ''}>보통</option><option value="bold"${!shape.fontWeight || shape.fontWeight === 'bold' ? ' selected' : ''}>굵게</option></select></label>
    </div>`)}
    ${panel('arrange', `<h3 class="shape-inspector-section">Properties</h3><div class="shape-editor-grid">
      <label><span>종류</span><select name="kind">${kinds.map(([value, label]) => `<option value="${value}"${shape.kind === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="shape-lock"><input id="shape-lock-ratio" type="checkbox"><span>비율 고정</span></label>
      <label><span>X</span><input name="x" type="number" step="1" min="-${SHAPE_COORD_LIMIT}" max="${SHAPE_COORD_LIMIT}" value="${shape.x}"></label>
      <label><span>Y</span><input name="y" type="number" step="1" min="-${SHAPE_COORD_LIMIT}" max="${SHAPE_COORD_LIMIT}" value="${shape.y}"></label>
      <label><span>가로</span><input name="width" type="number" step="1" min="1" max="${SHAPE_COORD_LIMIT}" value="${shape.width}"></label>
      <label><span>세로</span><input name="height" type="number" step="1" min="1" max="${SHAPE_COORD_LIMIT}" value="${shape.height}"></label>
    </div><h3 class="shape-inspector-section">정렬</h3>${arrangeActions}<p class="shape-editor-help">모서리 손잡이를 끌어 크기를 조절할 수 있습니다.</p>`)}
    <p class="shape-editor-error editor-error" role="alert"></p>
    <div class="form-actions"${shapeInspectorTab === 'style' ? ' hidden' : ''}><button type="submit">도형 저장</button></div>
  </form>`;
}

function renderGroupEditor(group) {
  const members = group.memberIds.map((id) => {
    const device = topology.devices.find((item) => item.id === id);
    const shape = topology.diagram?.shapes?.find((item) => item.id === id);
    if (device) return `<button type="button" class="group-member" data-group-member-type="device" data-group-member-id="${escapeAttribute(id)}">${escapeText(device.name || id)}<small>장비</small></button>`;
    if (shape) return `<button type="button" class="group-member" data-group-member-type="shape" data-group-member-id="${escapeAttribute(id)}">${escapeText(shape.text || id)}<small>${escapeText(shape.kind)}</small></button>`;
    return '';
  }).join('');
  return `<form class="shape-editor${group.locked ? ' locked' : ''}" data-resource-form="group" data-resource-id="${escapeAttribute(group.id)}">
    <div class="resource-identity"><strong>${escapeText(group.name)}</strong><span>그룹 · ${group.memberIds.length}개 요소${group.locked ? ' · 잠김' : ''}</span></div>
    <label class="shape-lock"><input name="locked" type="checkbox" data-diagram-lock${group.locked ? ' checked' : ''}><span>그룹 잠금</span></label>
    <div class="shape-editor-grid"><label class="shape-editor-wide"><span>그룹 이름</span><input name="name" value="${escapeAttribute(group.name)}" maxlength="80"></label></div>
    <div class="group-member-list"><strong>멤버</strong>${members}</div>
    <p class="shape-editor-help">멤버를 선택하면 종류와 크기를 개별 편집할 수 있습니다.</p>
    <p class="shape-editor-error editor-error" role="alert"></p><div class="form-actions"><button type="submit">그룹 저장</button></div>
  </form>`;
}

// 연결선은 계산에 들어가지 않는다. 양 끝이 장비면 링크로 바꿀 수 있고, 아니면 무엇이 막고
// 있는지 그 자리에서 말해 준다 — 도형을 장비로 매핑하면 이 버튼이 열린다.
// 가져온 선은 장비가 아니라 상자나 허공에 붙어 있곤 한다. 끝을 다시 지정할 수 있어야
// 그 선이 계산에 들어간다. 장비를 먼저 보여 준다 — 링크가 되려면 양 끝이 장비여야 한다.
function connectorEndpointOptions(selected) {
  const option = (id, text) => `<option value="${escapeAttribute(id)}"${id === selected ? ' selected' : ''}>${escapeText(text)}</option>`;
  const devices = topology.devices.map((device) => option(device.id, device.name || device.id)).join('');
  const shapes = (topology.diagram?.shapes || []).map((shape) => option(shape.id, shape.text || shape.id)).join('');
  const missing = [...topology.devices, ...(topology.diagram?.shapes || [])].some((item) => item.id === selected)
    ? '' : option(selected, `${selected} (없는 끝)`);
  return `${missing}<optgroup label="장비">${devices}</optgroup><optgroup label="도형">${shapes}</optgroup>`;
}

function connectorPromotionMarkup(connector) {
  const isDevice = (id) => topology.devices.some((device) => device.id === id);
  if (isDevice(connector.source) && isDevice(connector.target) && connector.source !== connector.target) {
    return `<div class="form-actions"><button type="button" data-promote-connector="${escapeAttribute(connector.id)}">트래픽 링크로 바꾸기</button></div>
      <p class="editor-hint">용량은 그림에 없으므로 비워 둡니다. 링크를 선택해 채우세요.</p>`;
  }
  const ends = ['source', 'target'].filter((side) => !isDevice(connector[side]));
  return `<p class="editor-hint">${ends.length === 2 ? '양 끝' : ends[0] === 'source' ? '출발 쪽' : '도착 쪽'}이 아직 장비가 아닙니다. 가져온 도형을 선택해 장비로 매핑하면 이 연결선을 링크로 바꿀 수 있습니다.</p>`;
}

function renderConnectorEditor(connector) {
  const arrowOptions = [['none', '없음'], ['classic', '삼각형'], ['open', '열림'], ['block', '블록']];
  return `<form class="shape-editor${connector.locked ? ' locked' : ''}" data-resource-form="connector" data-resource-id="${escapeAttribute(connector.id)}">
    <div class="resource-identity"><strong>${escapeText(connector.label || connector.id)}</strong><span>연결선 · ${escapeText(connector.kind || 'annotation')}${connector.locked ? ' · 잠김' : ''}</span></div>
    <label class="shape-lock"><input name="locked" type="checkbox" data-diagram-lock${connector.locked ? ' checked' : ''}><span>연결선 잠금</span></label>
    <div class="shape-editor-grid">
      <label><span>출발</span><select name="source">${connectorEndpointOptions(connector.source)}</select></label>
      <label><span>도착</span><select name="target">${connectorEndpointOptions(connector.target)}</select></label>
      <label class="shape-editor-wide"><span>라벨</span><input name="label" value="${escapeAttribute(connector.label || '')}" maxlength="1000"></label>
      <label><span>종류</span><select name="kind"><option value="annotation"${connector.kind !== 'dependency' ? ' selected' : ''}>주석</option><option value="dependency"${connector.kind === 'dependency' ? ' selected' : ''}>의존성</option></select></label>
      <label><span>선 색상</span><input name="stroke" value="${escapeAttribute(connector.stroke || '#526e64')}"></label>
      <label><span>선 굵기</span><input name="strokeWidth" type="number" min="0.5" max="20" step="0.5" value="${connector.strokeWidth || 1.5}"></label>
      <label><span>시작 화살표</span><select name="startArrow">${arrowOptions.map(([value, label]) => `<option value="${value}"${(connector.startArrow || 'none') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <label><span>끝 화살표</span><select name="endArrow">${arrowOptions.map(([value, label]) => `<option value="${value}"${(connector.endArrow || 'none') === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
    </div><label class="shape-lock"><input name="dashed" type="checkbox"${connector.dashed === false ? '' : ' checked'}><span>점선</span></label>
    <p class="shape-editor-error editor-error" role="alert"></p>
    ${connectorPromotionMarkup(connector)}
    <div class="form-actions"><button type="submit">연결선 저장</button></div>
  </form>`;
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

// 링크의 평면 축은 바쁜 쪽 방향 하나만 말한다. 방향마다 용량이 다르거나 한쪽만 미확인인
// 회선에서는 그것으로 부족하다 — 넘친 방향만 보이고 반대쪽이 왜 멀쩡한지, 혹은 왜 값이 없는지
// 알 길이 없다. 그래서 한계나 판정이 갈리는 링크만 두 방향을 나란히 편다. 양쪽이 똑같은 링크에
// 같은 숫자를 두 번 적는 것은 소음이다.
function renderLinkDirections(resource) {
  const axes = [...new Set(['forward', 'reverse'].flatMap((direction) => Object.keys(resource.directions?.[direction]?.axes || {})))];
  const split = axes.filter((axis) => {
    const forward = resource.directions?.forward?.axes[axis];
    const reverse = resource.directions?.reverse?.axes[axis];
    return forward?.limit !== reverse?.limit || forward?.status !== reverse?.status;
  });
  if (!split.length) return '';
  // 왜 비었는지를 그 자리에서 말한다. 사유 없이 — 만 그리면 도구가 고장 난 것으로 읽힌다.
  const unmodelled = split.some((axis) => ['forward', 'reverse']
    .some((direction) => resource.directions?.[direction]?.axes[axis]?.unknownReason === 'return-not-modelled'));
  const rows = [['forward', '정방향', resource.source], ['reverse', '역방향', resource.target]].map(([direction, label, from]) => {
    const cells = split.map((axis) => {
      const result = resource.directions?.[direction]?.axes[axis];
      return `<span data-status="${escapeAttribute(result?.status || 'unknown')}"><b>${escapeText(axisCatalog[axis]?.nodeLabel || axis)}</b>
        ${escapeText(formatCompact(result?.limit, axisCatalog[axis]?.unit))} · ${escapeText(result?.utilization == null ? '—' : formatPercent(result.utilization))}</span>`;
    }).join('');
    return `<div class="link-direction"><strong>${label}<small>${escapeText(from)} 에서</small></strong>${cells}</div>`;
  }).join('');
  const note = unmodelled
    ? '<p class="direction-note">응답이 어느 길로 돌아오는지 이 설계의 수요가 적지 않았습니다. 되돌아오는 방향은 0%가 아니라 미확인입니다.</p>'
    : '';
  return `<div class="direction-list"><span class="spec-code">방향별 한계</span>${rows}${note}</div>`;
}
const SOURCE_TYPE_LABEL = { datasheet: '데이터시트', third_party_test: '제3자 시험', user_measured: '실측', estimate: '추정' };

// 어느 조건의 값을 쓰고 있는지가 값 자체만큼 중요하다. 같은 장비가 조건에 따라 20배 갈린다.
function renderSpecBlock(resource) {
  const entries = catalogFor(resource.kind);
  if (!entries.length) return '';
  const entry = resource.spec ? catalogEntry(resource.spec.catalogId) : null;
  const profile = entry ? catalogProfile(entry.id, resource.spec.profileId) : null;
  return `<div class="spec-block">
    <span class="spec-code">장비와 측정 프로필</span><button type="button" class="spec-search" data-open-swap>검색해서 장비 고르기</button>
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
  const units = limitUnits(axis);
  const selectedUnit = units[0];
  const displayed = resource.limits[axis] == null ? '' : resource.limits[axis] / selectedUnit.factor;
  const suggestions = limitSuggestions(axis);
  return `<label class="limit-field${corrected ? ' corrected' : ''}">
    <span>${escapeText(catalog.label || axis)}${corrected ? ' <b>보정</b>' : ''}</span>
    <span class="unit-input"><input name="${axis}" type="number" min="0" step="any" placeholder="미확인" value="${displayed}"><select name="${axis}__unit" aria-label="${escapeAttribute(catalog.label || axis)} 단위">${units.map(({ label, factor }) => `<option value="${factor}">${label}</option>`).join('')}</select></span>
    ${suggestions.length ? `<span class="limit-presets">${suggestions.map((value) => `<button type="button" data-limit-axis="${escapeAttribute(axis)}" data-limit-value="${value}">${escapeText(formatCompact(value, catalog.unit))}</button>`).join('')}</span>` : ''}
    ${hint ? `<small>${escapeText(hint)}${corrected ? ` <button type="button" data-reset-axis="${escapeAttribute(axis)}">되돌리기</button>` : ''}</small>` : ''}
  </label>`;
}

function limitUnits(axis) {
  const unit = axisCatalog[axis]?.unit;
  if (unit === 'bps') return [{ label: 'Gbps', factor: 1e9 }, { label: 'Mbps', factor: 1e6 }, { label: 'bps', factor: 1 }];
  if (unit === 'pps') return [{ label: 'Mpps', factor: 1e6 }, { label: 'Kpps', factor: 1e3 }, { label: 'pps', factor: 1 }];
  if (unit === 'cps') return [{ label: 'cps', factor: 1 }, { label: 'Kcps', factor: 1e3 }];
  if (unit === 'sessions') return [{ label: 'K sessions', factor: 1e3 }, { label: 'sessions', factor: 1 }];
  return [{ label: unit || '값', factor: 1 }];
}

function limitSuggestions(axis) {
  return ({ forwarding_bps: [1e9, 10e9, 25e9, 100e9], nic_bps: [1e9, 10e9, 25e9, 100e9], forwarding_pps: [1e6, 10e6, 100e6], new_sessions_per_sec: [1e4, 5e4, 1e5], concurrent_sessions: [1e5, 1e6, 1e7] })[axis] || [];
}

function setLimitInput(form, axis, baseValue) {
  const input = form?.querySelector(`input[name="${CSS.escape(axis)}"]`);
  const unit = form?.querySelector(`select[name="${CSS.escape(axis)}__unit"]`);
  if (!input || !unit) return;
  input.value = String(baseValue / Number(unit.value || 1));
}

function renderDeviceEditor(resource) {
  const fields = Object.keys(resource.limits);
  return `<form class="inspector-editor" data-resource-form="device" data-resource-id="${resource.id}">
    <h3>장비 한계 편집</h3><p class="inspector-editor-hint">카탈로그 값을 사용하고 필요한 축만 보정하세요. 직접 입력한 값은 선택한 단위로 저장됩니다.</p>
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
    <h3>링크 편집</h3><label>방향별 용량 (bps)<input name="capacityBps" type="number" min="1" step="any" required value="${resource.capacity.forwarding_bps ?? ''}" placeholder="가져온 링크는 비어 있습니다"></label>
    ${resource.capacityByDirection ? ['forward', 'reverse'].map((direction) => `<label>${direction === 'forward' ? '정방향' : '역방향'}만 다르게 (bps)<input name="${direction}Bps" type="number" min="1" step="any"
      value="${resource.capacityByDirection[direction]?.forwarding_bps ?? ''}" placeholder="비우면 위 값을 씁니다"></label>`).join('') : ''}
    <div class="inspector-editor-actions"><button type="submit">적용</button><button type="button" data-demand-link="${escapeAttribute(resource.id)}">이 링크로 수요 추가</button><button type="button" data-delete-resource="link">링크 삭제</button></div><p class="editor-error"></p>
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
  const observed = resource?.metadata?.observedFloor?.[axis];
  const observedNote = observed
    ? `<small class="observed-floor">관측 하한 ${escapeText(formatCompact(observed.value, catalog.unit))}${observed.asOf ? ` · ${escapeText(observed.asOf)}` : ''}</small>` : '';
  const width = result.utilization == null ? 0 : Math.max(2, result.utilization * 100);
  const drag = resource && axisDraggable(resource, axis, result);
  // 끌어서 정하는 것은 목표 사용률이고, 저장되는 것은 거기서 나온 한계값이다.
  const meter = drag
    ? `<div class="axis-meter" data-axis-drag="${escapeAttribute(axis)}" data-axis-resource="${escapeAttribute(resourceId)}" data-axis-load="${result.load}"
        role="slider" tabindex="0" aria-valuemin="2" aria-valuemax="100" aria-valuenow="${Math.round((result.utilization ?? 0) * 100)}"
        aria-label="${escapeAttribute(`${catalog.label} 한계값. 좌우로 끌면 이 축의 목표 사용률을 정하고 그 값이 한계값이 됩니다.`)}" style="--axis-width:${width}%"><span style="--axis-width:${width}%"></span><i class="axis-grip"></i></div>`
    : `<div class="axis-meter" aria-label="${catalog.label} ${formatPercent(result.utilization)}"><span style="--axis-width:${width}%"></span></div>`;
  return `<div class="axis-row ${result.status}"${drag ? ' data-axis-editable=""' : ''}>
    <div class="axis-title"><span>${catalog.label}</span><span>${stateLabel(result.status)} · <b data-live-util="${result.utilization ?? ''}" data-live-seed="${resourceId}:${axis}:percent" data-live-drift="${resourceId}:${axis}" data-live-source-type="${escapeAttribute(result.source?.type || resource?.source?.type || 'estimate')}">${formatPercent(result.utilization)}</b></span></div>
    ${meter}
    <div class="axis-values"><span data-live-load="${result.load}" data-live-unit="${catalog.unit}" data-live-seed="${resourceId}:${axis}:load" data-live-drift="${resourceId}:${axis}" data-live-source-type="${escapeAttribute(result.source?.type || resource?.source?.type || 'estimate')}">${formatCompact(result.load, catalog.unit)} load</span><span data-axis-limit="${escapeAttribute(axis)}">${formatCompact(result.limit, catalog.unit)} limit</span></div>${observedNote}
  </div>`;
}

// 트윈은 260ms, 떨림은 300ms 마다 한 걸음 나아간다. 진폭은 사용률 1.5퍼센트포인트라 70% 가
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
  // 같은 숫자를 세 가지 모양으로 쓴다. 백분율, 인스펙터의 단위 붙은 부하, 노드 칸의 짧은 부하.
  const kind = node.dataset.liveUtil != null ? 'percent' : node.dataset.liveUnit != null ? 'unit' : 'compact';
  return { seed: node.dataset.liveSeed, driftSeed: node.dataset.liveDrift || node.dataset.liveSeed, value, kind, sourceType: node.dataset.liveSourceType, load: kind !== 'percent' };
}
function paintLive(node, value, kind) {
  const settled = Number(node.dataset.liveUtil ?? node.dataset.liveLoad);
  const text = kind === 'percent' ? formatPercent(value)
    : kind === 'unit' ? `${formatCompact(value, node.dataset.liveUnit, settled)} load`
    : formatNodeValue(value, settled);
  if (node.textContent !== text) node.textContent = text;
  node.dataset.livePainted = String(value);
  // 백분율은 1%포인트 단위로만 바뀌어서, 그것만으로는 움직임으로 읽히지 않는다. 막대는 그
  // 사이를 이어 준다 - 눈이 실제로 잡는 것은 자릿수가 아니라 길이다. 인스펙터 미터는 끌어서
  // 한계값을 정하는 손잡이라 건드리지 않는다.
  const row = kind === 'percent' ? node.closest('.node-axis') : null;
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
  // 300ms 는 떨림이 한 걸음 나아가는 속도이지 다시 그리는 간격이 아니다. 계단으로 뛰면
  // 1%포인트 점프만 남아 움직임으로 읽히지 않으므로, 같은 속도로 매 프레임 이어서 그린다.
  const phase = now / MOTION.driftCadence;
  let running = false;
  for (const node of liveNodes()) {
    const { seed, driftSeed, value, kind, sourceType } = liveTarget(node);
    if (!seed || !Number.isFinite(value)) continue;
    const tween = liveTweens.get(seed);
    if (tween) {
      const progress = Math.min(1, (now - tween.start) / MOTION.tween);
      paintLive(node, tween.from + (tween.to - tween.from) * (1 - (1 - progress) ** 3), kind);
      if (progress >= 1) liveTweens.delete(seed); else running = true;
      continue;
    }
    // 떨림은 헤드라인 숫자에 걸지 않는다(DESIGN.md). 고정된 비교 패널과 다른 말을 하면
    // 읽는 사람은 어느 쪽을 적어야 할지 알 수 없다.
    if (!drifting || node.closest('.binding-callout')) { paintLive(node, value, kind); continue; }
    // 같은 축의 부하와 percent가 하나의 비율 factor를 공유한다. 상태와 binding은 원값을 쓴다.
    paintLive(node, Math.max(0, value * sourceDriftFactor(driftSeed, phase, sourceType)), kind);
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
  // 칸마다 자기 숫자를 그린다. 예전에는 활성 장애 칸이 배율을, 과부하 칸이 헤드룸의 역수를
  // 그렸다. 선이 그 칸의 숫자와 다른 것을 말하면, 읽는 사람은 선을 믿고 잘못 읽는다.
  const seriesValues = {
    headroom: liveHeadroom,
    overloaded: current.summary.overloadedCount,
    unreachable: current.summary.unreachableCount,
    faults: current.summary.activeFaults,
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
  const designChanged = JSON.stringify(baselineSnapshot.topology) !== JSON.stringify(topology);
  if (designChanged) {
    element('comparison-grid').innerHTML = '<section class="comparison-detail"><header role="group"><b>설계 변화</b><small>수치 비교 보류</small></header><ul><li><b>기준선 이후 설계가 바뀌었습니다.</b><span>현재 수치와 기준선 수치를 직접 비교하지 않습니다.</span><small>기준선을 다시 확정하세요.</small></li></ul></section>';
    return;
  }
  const items = [
    ['최소 headroom', formatPercent(comparison.minHeadroomDelta, true), `${formatPercent(baseline.summary.minHeadroom)} → ${formatPercent(current.summary.minHeadroom)}`, comparison.minHeadroomDelta < 0 ? 'negative' : 'positive'],
    ['Binding axis', comparison.bindingChanged ? 'CHANGED' : 'SAME', `${baseline.summary.bindingResourceId} → ${current.summary.bindingResourceId}`, comparison.bindingChanged ? 'negative' : ''],
    ['과부하', `${comparison.overloadedDelta > 0 ? '+' : ''}${comparison.overloadedDelta}`, `${baseline.summary.overloadedCount} → ${current.summary.overloadedCount} resources`, comparison.overloadedDelta > 0 ? 'negative' : 'positive'],
    ['전달 실패', `${comparison.unreachableDelta > 0 ? '+' : ''}${comparison.unreachableDelta}`, `${baseline.summary.unreachableCount} → ${current.summary.unreachableCount} demands`, comparison.unreachableDelta > 0 ? 'negative' : 'positive'],
  ];
  const resourceLabel = (result, id) => [...result.devices, ...result.links].find((item) => item.id === id)?.name || id;
  const percent = (result) => result?.utilization == null ? '미확인' : formatPercent(result.utilization);
  const changes = [];
  const compareAxes = (beforeResource, afterResource, resourceId, direction = null) => {
    const beforeAxes = direction ? beforeResource?.directions?.[direction]?.axes : beforeResource?.axes;
    const afterAxes = direction ? afterResource?.directions?.[direction]?.axes : afterResource?.axes;
    for (const axis of new Set([...Object.keys(beforeAxes || {}), ...Object.keys(afterAxes || {})])) {
      const before = beforeAxes?.[axis]; const after = afterAxes?.[axis];
      if (!before || !after || before.status !== after.status || before.utilization !== after.utilization || before.load !== after.load) changes.push({ resourceId, direction, axis, before, after });
    }
  };
  const beforeResources = new Map([...baseline.devices, ...baseline.links].map((item) => [item.id, item]));
  const afterResources = new Map([...current.devices, ...current.links].map((item) => [item.id, item]));
  for (const id of new Set([...beforeResources.keys(), ...afterResources.keys()])) {
    const before = beforeResources.get(id); const after = afterResources.get(id);
    compareAxes(before, after, id);
    for (const direction of ['forward', 'reverse']) if (before?.directions || after?.directions) compareAxes(before, after, id, direction);
  }
  const changeRows = changes.length ? changes.map(({ resourceId, direction, axis, before, after }) => {
    const name = resourceLabel(current, resourceId) + ' · ' + (direction ? (direction === 'forward' ? '정방향 · ' : '역방향 · ') : '') + (axisCatalog[axis]?.shortLabel || axis);
    const tone = after?.status === 'overloaded' || after?.status === 'invalid' ? ' negative' : '';
    return `<li class="${tone.trim()}"><b>${escapeText(name)}</b><span>${escapeText(percent(before))} → ${escapeText(percent(after))}</span><small>${escapeText((before?.status ? stateLabel(before.status) : '없음') + ' → ' + (after?.status ? stateLabel(after.status) : '없음'))}</small></li>`;
  }).join('') : '<li>기준선과 달라진 자원 축이 없습니다.</li>';
  const demandIds = new Set([...baseline.demands, ...current.demands].map(({ id }) => id));
  if (!comparisonDemandId || !demandIds.has(comparisonDemandId)) comparisonDemandId = [...demandIds][0] || null;
  const currentDemand = current.demands.find(({ id }) => id === comparisonDemandId);
  const beforeDemand = baseline.demands.find(({ id }) => id === comparisonDemandId);
  const pathText = (path) => (path.devices || []).map((id) => resourceLabel(current, id)).join(' → ');
  const truncated = currentDemand?.pathEnumeration?.complete === false;
  const currentPaths = truncated ? '<li>경로 열거 한도에 닿아 홉 라벨을 표시하지 않습니다.</li>' : (currentDemand?.paths || []).map((path) => {
    const choke = path.choke ? ' · 조임점 ' + resourceLabel(current, path.choke.resourceId) + ' ' + (path.choke.direction === 'reverse' ? '역방향' : path.choke.direction === 'forward' ? '정방향' : '') : '';
    return `<li><b>현재 ${Math.round(path.share * 100)}%</b><span>${escapeText(pathText(path))}</span><small>${escapeText(((path.hops || []).map(({ direction }) => direction === 'forward' ? '정방향' : '역방향').join(' · ') || '방향 미확인') + choke)}</small></li>`;
  }).join('') || '<li>현재 활성 경로가 없습니다.</li>';
  const priorPaths = currentDemand?.severedPaths?.length ? currentDemand.severedPaths : beforeDemand?.paths || [];
  const previous = priorPaths.map((path) => `<li><b>장애 전 ${Math.round((path.share ?? 1) * 100)}%</b><span>${escapeText(pathText(path))}</span></li>`).join('') || '<li>비교할 장애 전 경로가 없습니다.</li>';
  const options = [...demandIds].map((id) => { const demand = current.demands.find((item) => item.id === id) || baseline.demands.find((item) => item.id === id); return `<option value="${escapeAttribute(id)}"${id === comparisonDemandId ? ' selected' : ''}>${escapeText(demand?.name || id)}</option>`; }).join('');
  const detail = `<section class="comparison-detail"><header role="group"><b>자원·축·방향 변화</b><small>${changes.length}개</small></header><ul>${changeRows}</ul></section>`;
  const paths = comparisonDemandId ? `<section class="comparison-detail comparison-path"><header role="group"><label>수요 경로 <select data-comparison-demand>${options}</select></label><small>${escapeText(currentDemand?.status === 'unreachable' ? '현재 경로 없음' : '현재 경로와 방향별 분기 몫입니다.')}</small></header><div><ul>${currentPaths}</ul><ul>${previous}</ul></div></section>` : '';
  element('comparison-grid').innerHTML = items.map(([label, value, detail, tone]) => `<div class="comparison-item ${tone}"><span>${label}</span><strong>${value}</strong><small>${detail}</small></div>`).join('') + detail + paths;
}

function renderEditorMode() {
  // 여러 개를 고르는 두 손놀림이 화면 어디에도 적혀 있지 않아, 있는 줄 모르고 쓰지 못했다.
  // 빈 곳을 그냥 끌면 화면이 밀리고 Shift 를 누른 채 끌어야 선택 상자가 나온다.
  const labels = { select: 'SELECT · DRAG TO BOX · RIGHT-DRAG TO PAN · SHIFT+CLICK TO ADD', connect: state.connectSource ? `CONNECT · ${state.connectSource.toUpperCase()} → SELECT TARGET` : 'CONNECT · SELECT SOURCE', annotation: annotationSource ? `ANNOTATION · ${annotationSource.toUpperCase()} → SELECT TARGET` : 'ANNOTATION · SELECT SOURCE' };
  element('editor-mode').lastChild.textContent = labels[state.editorMode] || state.editorMode.toUpperCase();
  document.querySelector('[data-editor-action="connect"]')?.setAttribute('aria-pressed', String(state.editorMode === 'connect'));
  document.querySelector('[data-editor-action="annotation-connect"]')?.setAttribute('aria-pressed', String(state.editorMode === 'annotation'));
  for (const kind of Object.keys(SHAPE_DRAW_DEFAULTS)) document.querySelector(`[data-editor-action="shape-${kind}"]`)?.setAttribute('aria-pressed', 'false');
  const editableSelection = state.selection.filter(({ type }) => type === 'device' || type === 'shape');
  const count = editableSelection.length;
  const selectedShape = count === 1 && state.selection[0].type === 'shape';
  const selectedGroup = state.selection.length === 1 && state.selection[0].type === 'group';
  const rules = {
    group: [count >= 2, '장비 또는 도형을 2개 이상 선택하세요.'],
    ungroup: [selectedGroup, '그룹 하나를 선택하세요.'],
    'align-left': [count >= 2, '장비 또는 도형을 2개 이상 선택하세요.'],
    'distribute-x': [count >= 3, '장비 또는 도형을 3개 이상 선택하세요.'],
    'map-device': [selectedShape, '가져온 도형 하나를 선택하세요.'],
  };
  for (const [action, [enabled, hint]] of Object.entries(rules)) {
    const button = document.querySelector(`[data-editor-action="${action}"]`);
    if (!button) continue;
    button.disabled = !enabled;
    if (enabled) { button.removeAttribute('title'); button.removeAttribute('aria-describedby'); }
    else { button.title = hint; button.setAttribute('aria-describedby', 'editor-selection-hint'); }
  }
  const selectedLabel = count ? `${count}개 선택됨` : '선택 없음';
  element('editor-selection-hint').textContent = `${selectedLabel}. 그룹과 정렬은 여러 요소를 선택해야 합니다.`;
}

// 데이터시트 값은 특정 조건에서 잰 숫자다. 그 조건과 대조할 우리 워크로드를 적지 않으면
// 어떤 한계값도 적용 가능한지 판정할 수 없고, 카탈로그 장비 전체가 계산에서 빠진다.
const WORKLOAD_FIELDS = [
  { key: 'packet_size_bytes', label: '프레임 크기', hint: '바이트. 데이터시트가 20 Gbps @ 1518B 로 적었다면 1518', type: 'number' },
  { key: 'transport', label: '전송 계층', hint: 'tcp · udp · mixed', type: 'text' },
  { key: 'cipher', label: '암호 스위트', hint: 'rsa2048 · ecdsa_p256 · none', type: 'text' },
  { key: 'test_method', label: '시험 방법', hint: 'enterprise-traffic-mix · appmix 처럼 데이터시트가 이름 붙인 것', type: 'text' },
];
const WORKLOAD_PRESETS = Object.freeze({
  web: { packet_size_bytes: 1518, transport: 'tcp', cipher: 'none', test_method: 'enterprise-traffic-mix', features_enabled: [] },
  tls: { packet_size_bytes: 1518, transport: 'tcp', cipher: 'ECDHE-ECDSA-AES128-SHA256', test_method: 'tls', features_enabled: ['tls'] },
  security: { packet_size_bytes: 1518, transport: 'mixed', cipher: 'none', test_method: 'enterprise-traffic-mix', features_enabled: ['ips', 'application-control', 'logging'] },
});
const WORKLOAD_FEATURES = ['ips', 'application-control', 'logging', 'tls', 'ipsec'];
const checked = (value, expected) => value === expected ? ' checked' : '';

function openWorkloadForm() {
  const conditions = topology.workloadConditions || {};
  const features = conditions.features_enabled;
  const judgement = current.summary.evidenceJudgement;
  const ratio = judgement.ratio == null ? '카탈로그 근거가 붙은 축이 없습니다.'
    : `근거가 붙은 축 ${judgement.withRecords}개 중 ${judgement.judged}개를 판정했습니다 · ${formatPercent(judgement.ratio)}`;
  const selectedFeatures = Array.isArray(features) ? features : [];
  const customFeatures = selectedFeatures.filter((item) => !WORKLOAD_FEATURES.includes(item));
  openEditorPanel('데이터시트 비교 조건', `<form data-editor-form="workload" class="workload-form">
    <div class="workload-main"><p class="form-hint">실제 트래픽 조건을 데이터시트의 측정 조건과 대조합니다. 가까운 프리셋을 고르고 필요한 값만 바꾸세요.</p>
      <fieldset class="choice-block workload-presets"><legend>조건 프리셋</legend>
        <button type="button" data-workload-preset="web">일반 웹/API<small>1518B · TCP</small></button><button type="button" data-workload-preset="tls">TLS 처리<small>ECDSA · TLS</small></button><button type="button" data-workload-preset="security">보안 검사<small>IPS · App control</small></button><button type="button" data-workload-preset="custom">직접 설정<small>현재 값 유지</small></button>
      </fieldset>
      <div class="workload-grid">
        <label>프레임 크기 <span>bytes</span><input name="packet_size_bytes" type="number" min="1" list="packet-size-options" value="${escapeAttribute(conditions.packet_size_bytes ?? '')}" placeholder="64, 512, 1518, 9000"><datalist id="packet-size-options"><option value="64"><option value="128"><option value="256"><option value="512"><option value="1518"><option value="9000"></datalist></label>
        <fieldset class="choice-block segmented transport-choice"><legend>전송 계층</legend>${['tcp', 'udp', 'mixed'].map((value) => `<label><input type="radio" name="transport" value="${value}"${checked(conditions.transport, value)}><span>${value === 'mixed' ? '혼합' : value.toUpperCase()}</span></label>`).join('')}</fieldset>
        <label>암호 스위트<input name="cipher" list="cipher-options" value="${escapeAttribute(conditions.cipher ?? '')}" placeholder="없음 또는 검색"><datalist id="cipher-options"><option value="none"><option value="rsa2048"><option value="ecdsa_p256"><option value="ECDHE-ECDSA-AES128-SHA256"></datalist></label>
        <label>시험 방법<input name="test_method" list="method-options" value="${escapeAttribute(conditions.test_method ?? '')}" placeholder="데이터시트의 시험 이름"><datalist id="method-options"><option value="enterprise-traffic-mix"><option value="appmix"><option value="l4"><option value="tls"></datalist></label>
      </div>
      <fieldset class="choice-block workload-features"><legend>켜 둔 기능</legend>
        <div class="segmented feature-mode"><label><input type="radio" name="features_mode" value="unset"${features == null ? ' checked' : ''}><span>적지 않음</span></label><label><input type="radio" name="features_mode" value="none"${Array.isArray(features) && !features.length ? ' checked' : ''}><span>없음</span></label><label><input type="radio" name="features_mode" value="list"${Array.isArray(features) && features.length ? ' checked' : ''}><span>기능 선택</span></label></div>
        <div class="feature-chips">${WORKLOAD_FEATURES.map((feature) => `<label><input type="checkbox" name="features_chip" value="${feature}"${selectedFeatures.includes(feature) ? ' checked' : ''}><span>${feature}</span></label>`).join('')}</div>
        <label class="custom-feature">그 밖의 기능<input name="features_enabled" type="text" value="${escapeAttribute(customFeatures.join(', '))}" placeholder="쉼표로 구분"></label>
      </fieldset>
    </div>
    <aside class="workload-result"><span>판정 가능 범위</span><strong>${escapeText(ratio)}</strong><p>불일치하거나 비어 있는 축은 안전으로 처리하지 않고 미확인으로 남깁니다.</p></aside>
    <div class="form-actions"><button type="submit">조건 적용</button><button type="button" data-workload-action="clear">모두 지우기</button></div><p class="editor-error"></p>
  </form>`);
}

function openEditorPanel(title, html) {
  element('editor-panel-heading').textContent = title;
  element('editor-panel-content').innerHTML = html;
  element('editor-panel').hidden = false;
  element('editor-panel').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'nearest' });
}

function drawioDecisionOptions(candidate) {
  const current = drawioPreview.decisions[candidate.id] || 'annotation';
  const deviceKind = typeof current === 'object' ? current.kind || '' : candidate.suggestion.suggestedDeviceKind || '';
  const type = typeof current === 'object' ? current.type : current;
  const device = `<option value="device" ${type === 'device' ? 'selected' : ''}>장비</option>`;
  const kindOptions = ['firewall', 'router', 'switch', 'server', 'storage', 'cloud', 'lb'].map((kind) => `<option value="${kind}" ${kind === deviceKind ? 'selected' : ''}>${escapeText(kind === 'lb' ? 'load balancer' : kind)}</option>`).join('');
  return `<label>의미 <select data-drawio-decision="${escapeAttribute(candidate.id)}"><option value="annotation" ${type === 'annotation' ? 'selected' : ''}>주석</option>${device}<option value="zone" ${type === 'zone' ? 'selected' : ''}>영역</option><option value="exclude" ${type === 'exclude' ? 'selected' : ''}>제외</option></select></label>${type === 'device' ? `<label>종류 <select data-drawio-kind="${escapeAttribute(candidate.id)}"><option value="">선택</option>${kindOptions}</select></label>` : ''}`;
}

function renderDrawioPreview() {
  if (!drawioPreview) return;
  const preview = createDrawioPreview(drawioPreview.document, drawioPreview.pageId, drawioPreview.decisions);
  const pages = drawioPreview.document.pages.map((page) => `<option value="${escapeAttribute(page.id)}" ${page.id === preview.page.id ? 'selected' : ''}>${escapeText(page.name)} · ${page.elements.length}개</option>`).join('');
  const candidates = preview.candidates.map((candidate) => `<li><div><strong>${escapeText(candidate.text || '이름 없음')}</strong><small>${escapeText(candidate.suggestion.ruleId)} · ${escapeText(candidate.suggestion.confidence)}</small></div>${drawioDecisionOptions(candidate)}</li>`).join('');
  const warningCounts = Object.entries(preview.warnings.reduce((counts, item) => ({ ...counts, [item.code]: (counts[item.code] || 0) + 1 }), {}));
  const warningSummary = warningCounts.length ? warningCounts.map(([code, count]) => `${code} ${count}`).join(' · ') : '없음';
  // 상자로 대체한 도형은 이름을 보여 준다. 개수만 세면 원본의 어느 도형을 봐야 하는지 알 수 없다.
  const unresolved = [...new Set(preview.warnings.filter((item) => item.code === 'unsupported-vendor-stencil' && item.token).map((item) => item.token))];
  const unresolvedNote = unresolved.length
    ? `<p class="drawio-warning">상자로 대체한 도형 ${unresolved.length}종: ${escapeText(unresolved.slice(0, 6).join(', '))}${unresolved.length > 6 ? ` 외 ${unresolved.length - 6}종` : ''}</p>`
    : '';
  const fileLabel = drawioPreview.fileName ? escapeText(drawioPreview.fileName) : 'drawio 파일';
  openEditorPanel('drawio 가져오기 미리보기', `<p class="editor-hint">${fileLabel}을 안전한 구성도로 먼저 보여줍니다. 적용 전에는 현재 설계와 계산 결과를 바꾸지 않습니다.</p><div class="drawio-preview-actions"><label class="drawio-page-choice">페이지 <select data-drawio-page>${pages}</select></label><p class="drawio-warning">경고 ${preview.warnings.length}개 · ${escapeText(warningSummary)}</p>${unresolvedNote}<div class="form-actions"><button type="button" data-drawio-accept-high>높은 신뢰도 수락</button><button type="button" data-drawio-cancel>취소</button><button type="button" data-drawio-append>현재 설계에 추가</button><button type="button" data-drawio-apply>새 구성도로 적용</button></div></div><div class="drawio-preview-layout"><section class="drawio-visual-preview" aria-label="drawio 원본 구성도 미리보기"><header><strong>원본 구성도</strong><span>위치 · 색 · 텍스트 · 연결 관계</span></header><div class="drawio-preview-canvas">${renderDrawioPageSvg(preview.page, preview.assets)}</div></section><section class="drawio-semantic-preview" aria-label="drawio 의미 후보"><header><strong>분석 의미 지정</strong><span>선택하지 않으면 주석으로 적용</span></header><ul class="drawio-preview-list">${candidates}</ul></section></div>`);
}

function openDrawioPreview(document, { fileName = '' } = {}) {
  drawioPreview = { document, pageId: document.pages[0].id, decisions: {}, fileName };
  if (state.workspace !== 'topology') setWorkspace('topology');
  renderDrawioPreview();
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
    target: '#project-menu-button',
    // 개수를 못 박으면 설계를 더할 때마다 안내가 틀린 말을 한다. 목록에서 센다.
    text: () => `프로젝트 메뉴에서 시작합니다. ${templates.length}개 설계가 들어 있고 각각 먼저 차는 축이 다릅니다. 3-tier 웹, DMZ 이중 방화벽, IoT 게이트웨이처럼 실제 구성을 골라 열 수 있습니다.`,
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
    title: '축 미터로 용량을 정합니다',
    target: '[data-axis-drag]',
    text: ({ spread }) => (spread
      ? `${withParticle(resourceName(spread.device), 'object')} 골랐습니다. ${axisCatalog[spread.low[0]]?.label || spread.low[0]} ${formatPercent(spread.low[1].utilization)} 인데 ${axisCatalog[spread.high[0]]?.label || spread.high[0]} ${formatPercent(spread.high[1].utilization)} 입니다. 같은 장비인데 축마다 다릅니다. 이 막대는 읽기만 하는 그림이 아니라 좌우로 끌면 그 축의 목표 사용률이 정해지고 거기서 나온 한계값이 저장됩니다. 한계를 모르는 축은 막대를 채우지 않고 백분율도 적지 않습니다. 방향키로도 됩니다.`
      : '검사기의 축 막대는 좌우로 끌 수 있습니다. 그 축을 몇 %에 두겠다는 목표가 정해지고 거기서 나온 한계값이 저장됩니다. 한계를 모르는 축은 막대를 채우지 않고 백분율도 적지 않습니다.'),
    run: ({ spread }) => {
      if (!spread) return;
      state.selectedId = spread.device.id;
      state.selection = [{ type: 'device', id: spread.device.id }];
      openMobileInspector();
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
    target: '#analysis-menu-button',
    text: () => '데이터시트 숫자는 특정 조건에서 잰 값입니다. 우리 트래픽의 프레임 크기와 전송 계층을 여기 적어야 그 값을 이 설계에 쓸 수 있는지 판정합니다. 적지 않으면 그 축은 미확인으로 남습니다 — 모르는 것을 안전으로 바꾸지 않습니다.',
  },
  {
    title: '결과 내보내기',
    target: '#export-menu-button',
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
  closeTopMenus();
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
  closeMobileInspector();
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
    delete box.dataset.anchored;
    box.style.removeProperty('left'); box.style.removeProperty('top');
    box.dataset.side = 'right';
    delete box.dataset.vertical;
    return;
  }
  const pad = 6;
  spot.hidden = false;
  spot.style.left = `${Math.max(2, rect.left - pad)}px`;
  spot.style.top = `${Math.max(2, rect.top - pad)}px`;
  spot.style.width = `${Math.min(rect.width + pad * 2, window.innerWidth - 4)}px`;
  spot.style.height = `${rect.height + pad * 2}px`;
  anchorTourBox(box, rect);
}

// 설명은 설명하는 것 옆에 있어야 한다. 화면 구석에 붙여 두면 눈이 버튼과 글 사이를 계속
// 오가야 하고, 화면이 넓을수록 그 거리가 멀어져 무엇을 가리키는지 흐려진다. 좁은 화면은
// 다르다 - 상자가 화면 폭을 거의 다 쓰므로 아래에 그대로 두는 편이 낫다(styles.css 의 760px).
const TOUR_NARROW = 760;
const TOUR_GAP = 16;
function anchorTourBox(box, rect) {
  if (window.innerWidth <= TOUR_NARROW) {
    delete box.dataset.anchored;
    box.style.removeProperty('left'); box.style.removeProperty('top');
    box.dataset.side = 'right';
    box.dataset.vertical = 'bottom';
    return;
  }
  box.dataset.anchored = '';
  delete box.dataset.side;
  delete box.dataset.vertical;
  const size = box.getBoundingClientRect();
  const edge = 10;
  const clampX = (x) => Math.min(Math.max(edge, x), window.innerWidth - size.width - edge);
  const clampY = (y) => Math.min(Math.max(edge, y), window.innerHeight - size.height - edge);
  const put = (x, y) => { box.style.left = `${Math.round(x)}px`; box.style.top = `${Math.round(y)}px`; };
  // 대상 아래를 먼저 본다. 읽는 순서가 위에서 아래라 버튼 다음에 설명이 오는 것이 자연스럽다.
  const below = rect.bottom + TOUR_GAP;
  if (below + size.height <= window.innerHeight - edge) { put(clampX(rect.left), below); return; }
  const above = rect.top - TOUR_GAP - size.height;
  if (above >= edge) { put(clampX(rect.left), above); return; }
  // 위아래 어디에도 자리가 없으면 옆으로 비킨다. 세로로 밀어 넣으면 가리키는 곳을 덮는다 —
  // 그러면 안내가 아니라 방해다.
  const right = rect.right + TOUR_GAP;
  const left = rect.left - TOUR_GAP - size.width;
  put(right + size.width <= window.innerWidth - edge ? right : Math.max(edge, left), clampY(rect.top));
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
function openDeviceSwapPicker(id, target = null) {
  const device = deviceById(id);
  if (!device) return;
  const slot = swapSlot(device);
  if (!target) swapComparison = [];
  swapTarget = target || { id, slotIds: slot.map(({ id: memberId }) => memberId), mode: 'slot' };
  const entries = catalogFor(device.kind);
  const bindingAxis = current.summary.bindingAxis;
  const cards = entries.flatMap((entry) => entry.profiles.map((profile) => {
    const current = device.spec?.catalogId === entry.id && device.spec?.profileId === profile.id;
    const compared = swapComparison.some((item) => item.entryId === entry.id && item.profileId === profile.id);
    // 후보를 추리거나 우열을 매기지 않는다. 현재 병목 축을 계산할 근거가 있는지만 먼저 보인다.
    const hasBindingAxisData = bindingAxis && profile.records.some((record) => record.axis === bindingAxis && record.value != null);
    const limits = Object.entries(profile.limits)
      .map(([axis, value]) => `${axisCatalog[axis]?.nodeLabel || axis} ${value == null ? '미확인' : formatCompact(value, axisCatalog[axis]?.unit)}`)
      .join(' · ');
    const haystack = [entry.vendor, entry.model, profile.label, profile.note, limits].join(' ').toLowerCase();
    return `<article class="template-item"${current ? ' data-current=""' : ''}><button type="button" class="swap-pick" data-swap-catalog="${escapeAttribute(entry.id)}" data-swap-profile="${escapeAttribute(profile.id)}"
      data-search="${escapeAttribute(haystack)}"${current ? ' aria-current="true"' : ''}>
      ${current ? '<b class="template-grade" data-grade="current">지금 이 값</b>' : ''}
      ${hasBindingAxisData ? `<b class="template-grade" data-swap-binding-axis="${escapeAttribute(bindingAxis)}">병목 축 데이터 있음</b>` : ''}
      <strong>${escapeText(`${entry.vendor} ${entry.model}`)}</strong>
      <span>${escapeText(profile.label)}</span>
      <em>${escapeText(limits)}</em>
      ${profile.note ? `<span class="swap-note">${escapeText(profile.note)}</span>` : ''}
    </button><button type="button" class="swap-compare-toggle" data-swap-compare="${escapeAttribute(entry.id)}" data-swap-profile="${escapeAttribute(profile.id)}" aria-pressed="${compared}">${compared ? '비교에서 제외' : '비교에 추가'}</button></article>`;
  })).join('');
  const scopeChoice = slot.length > 1 ? `<fieldset class="swap-scope"><legend>치환 범위</legend><div class="segmented" role="group" aria-label="치환 범위"><button type="button" data-swap-scope="slot" aria-pressed="${swapTarget.mode === 'slot'}">같은 자리 전체 ${slot.length}대</button><button type="button" data-swap-scope="single" aria-pressed="${swapTarget.mode === 'single'}">${escapeText(resourceName(device))}만</button></div></fieldset>` : '';
  openEditorPanel(`${resourceName(device)} · 장비 선택`, `<p class="editor-hint">같은 장비라도 측정 조건이 다르면 다른 숫자라, 조건째로 고릅니다. 고른 값은 워크로드 조건과 대조해 쓸 수 있는지 판정합니다.</p>
    ${scopeChoice}
    <div class="template-head">
      <label class="template-search"><span class="visually-hidden">장비 검색</span>
        <input type="search" id="swap-search" placeholder="제조사, 모델, 조건으로 검색 (예: 1518, IPS, ASA)" autocomplete="off"></label>
      <p class="template-count" id="swap-count" aria-live="polite">${entries.reduce((n, entry) => n + entry.profiles.length, 0)}개</p>
      <button type="button" class="swap-compare-open" data-swap-open-comparison ${swapComparison.length ? '' : 'disabled'}>후보 비교 ${swapComparison.length}/4</button>
      ${device.spec ? '<button type="button" class="swap-detach" data-swap-detach>데이터시트를 떼고 직접 입력으로</button>' : ''}
    </div>
    <div class="template-list">${cards}</div>`);
  element('swap-search').focus();
}

function swapSlot(device) {
  // 같은 모델은 독립 장비에도 흔하다. 명시한 HA 그룹이 있으면 그 그룹이 사용자가 의도한
  // 치환 자리다. 그룹 밖 같은 모델까지 같이 바꾸지 않는다.
  const declared = (topology.haGroups || []).find(({ members }) => members?.includes(device.id));
  if (declared) {
    const members = declared.members
      .map((id) => topology.devices.find((item) => item.id === id))
      .filter((item) => item?.kind === device.kind);
    if (members.length) return members;
  }
  const catalogId = device.spec?.catalogId;
  const matches = topology.devices.filter((item) => item.kind === device.kind && (catalogId
    ? item.spec?.catalogId === catalogId
    : item.manufacturer === device.manufacturer && item.model === device.model));
  if (matches.length !== 2) return [device];
  const peer = matches.find(({ id }) => id !== device.id);
  return peer && hasSymmetricLinks(device, peer) ? matches : [device];
}

function hasSymmetricLinks(left, right) {
  const signature = (deviceId, ignoredId) => topology.links
    .filter(({ source, target }) => source === deviceId || target === deviceId)
    .map((link) => {
      const neighborId = link.source === deviceId ? link.target : link.source;
      const neighbor = topology.devices.find(({ id }) => id === neighborId);
      if (!neighbor || neighbor.id === ignoredId) return null;
      const capacity = Object.entries(link.capacity || {}).sort(([a], [b]) => a.localeCompare(b));
      const directions = link.directions ? Object.entries(link.directions).sort(([a], [b]) => a.localeCompare(b)) : [];
      return JSON.stringify({ kind: neighbor.kind, capacity, directions });
    })
    .filter(Boolean)
    .sort();
  const leftLinks = signature(left.id, right.id);
  const rightLinks = signature(right.id, left.id);
  return leftLinks.length > 0 && JSON.stringify(leftLinks) === JSON.stringify(rightLinks);
}

function swapBindingLabel(result) {
  const id = result.summary.bindingResourceId;
  const resource = id ? [...result.devices, ...result.links].find((item) => item.id === id) : null;
  if (!resource || !result.summary.bindingAxis) return '알려진 병목 없음';
  const axis = resource.axes[result.summary.bindingAxis];
  return `${resourceName(resource)} · ${axisCatalog[result.summary.bindingAxis]?.shortLabel || result.summary.bindingAxis} ${formatPercent(axis?.utilization)}`;
}

function swapConditionAxes(preview) {
  return preview.candidate.records
    .filter((record) => record.value !== null)
    .map((record) => {
      const applicability = evidenceApplicability(record, topology.workloadConditions ?? {}, topology.workloadScope ?? null);
      const accepted = preview.memberIds.every((id) => {
        const device = preview.topology.devices.find((item) => item.id === id);
        return device?.accepted?.[record.axis] === acceptanceDigest(record, topology.workloadConditions ?? {}, topology.workloadScope ?? null);
      });
      return { record, applicability: accepted ? 'user-asserted' : applicability };
    });
}

function swapConditionIssues(preview) {
  return swapConditionAxes(preview).filter(({ applicability }) => applicability !== 'applicable' && applicability !== 'user-asserted');
}

function swapComparisonPreview(entry, profile) {
  const device = topology.devices.find((item) => item.id === swapTarget?.id);
  if (!device || !swapTarget) return null;
  const slot = swapSlot(device);
  const slotIds = swapTarget.slotIds || slot.map(({ id }) => id);
  const memberIds = swapTarget.mode === 'single' ? [device.id] : slotIds;
  const candidate = { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model };
  const candidateTopology = structuredClone(topology);
  for (const memberId of memberIds) applySpec(candidateTopology, memberId, candidate);
  return { id: device.id, entry, profile, candidate, memberIds, slotIds, topology: candidateTopology };
}

function swapNormalMultiplier(result) { return result.summary.growthLadder?.rungs?.[0]?.breachScale ?? null; }
function formatSwapMultiplier(value) { return value == null ? '미확정' : `${value.toFixed(2)}×`; }

function openSwapComparison() {
  if (!swapTarget || !swapComparison.length) return;
  const original = calculateScenario(topology, scenarioOptions());
  const originalSurvival = calculateSurvivalMultiplier(topology, { scale: state.scale });
  const rows = swapComparison.map(({ entryId, profileId }) => {
    const entry = catalogEntry(entryId);
    const profile = catalogProfile(entryId, profileId);
    const preview = entry && profile ? swapComparisonPreview(entry, profile) : null;
    if (!preview) return '';
    const issues = swapConditionIssues(preview);
    if (issues.length) return `<article class="swap-comparison-row" data-swap-comparison-row><header><strong>${escapeText(`${entry.vendor} ${entry.model}`)}</strong><span>${escapeText(profile.label)}</span></header><p class="swap-comparison-blocked">조건 확인 필요 · ${issues.length}축</p><small>현재 워크로드와 맞는지 확인되지 않은 후보 근거가 있어 수치 비교를 보류합니다.</small></article>`;
    const candidate = calculateScenario(preview.topology, scenarioOptions());
    const candidateSurvival = calculateSurvivalMultiplier(preview.topology, { scale: state.scale });
    const sameBinding = original.summary.bindingResourceId === candidate.summary.bindingResourceId && original.summary.bindingAxis === candidate.summary.bindingAxis;
    return `<article class="swap-comparison-row" data-swap-comparison-row><header><strong>${escapeText(`${entry.vendor} ${entry.model}`)}</strong><span>${escapeText(profile.label)}</span></header><dl><div><dt>병목</dt><dd>${escapeText(sameBinding ? `그대로 · ${swapBindingLabel(candidate)}` : `${swapBindingLabel(original)} → ${swapBindingLabel(candidate)}`)}</dd></div><div><dt>생존 배수</dt><dd>${escapeText(formatSwapMultiplier(originalSurvival.multiplier))} → ${escapeText(formatSwapMultiplier(candidateSurvival.multiplier))}</dd></div><div><dt>정상시 배수</dt><dd>${escapeText(formatSwapMultiplier(swapNormalMultiplier(original)))} → ${escapeText(formatSwapMultiplier(swapNormalMultiplier(candidate)))}</dd></div><div><dt>과부하 자원</dt><dd>${original.summary.overloadedCount}개 → ${candidate.summary.overloadedCount}개</dd></div><div><dt>랙</dt><dd>${escapeText(swapRackChange(original, candidate))}</dd></div></dl><button type="button" data-swap-comparison-apply="${escapeAttribute(entry.id)}" data-swap-profile="${escapeAttribute(profile.id)}">이 항목으로 치환</button></article>`;
  }).join('');
  const device = topology.devices.find((item) => item.id === swapTarget.id);
  openEditorPanel(`${resourceName(device)} · 후보 비교`, `<p class="swap-comparison-disclosure">이 값은 현재 설계와 워크로드 조건에서만 유효합니다. 장비 성능 비교나 추천 순위가 아닙니다.</p><div class="swap-comparison-list">${rows}</div><button type="button" class="swap-comparison-back" data-swap-back-picker>후보 선택으로 돌아가기</button>`);
}

function toggleSwapComparison(entryId, profileId) {
  const index = swapComparison.findIndex((item) => item.entryId === entryId && item.profileId === profileId);
  if (index >= 0) swapComparison.splice(index, 1);
  else {
    if (swapComparison.length >= 4) { showToast('후보 비교는 최대 4개까지 가능합니다.'); return; }
    swapComparison.push({ entryId, profileId });
  }
  openDeviceSwapPicker(swapTarget.id, swapTarget);
}

function swapRackChange(original, preview) {
  const before = new Map(original.racks.map((rack) => [rack.id, rack]));
  const changed = preview.racks.flatMap((rack) => {
    const previous = before.get(rack.id);
    if (!previous) return [];
    const powerChanged = previous.powerWatts !== rack.powerWatts;
    const unitsChanged = previous.usedU !== rack.usedU;
    if (!powerChanged && !unitsChanged) return [];
    const power = powerChanged ? `${formatCompact(previous.powerWatts, 'watts')} → ${formatCompact(rack.powerWatts, 'watts')}` : '변화 없음';
    const units = unitsChanged ? `${previous.usedU ?? '미확인'}U → ${rack.usedU ?? '미확인'}U` : '변화 없음';
    const state = rack.status === 'fail' ? '랙 예산 초과' : rack.status === 'unknown' ? '랙 예산 미확인' : '';
    return { label: `${rack.name} 전력 ${power} · U ${units}`, state };
  });
  if (!changed.length) return '전력·랙 U 변화 없음';
  return `전력·랙 U · ${changed.map(({ label, state }) => `${label}${state ? ` · ${state}` : ''}`).join(' / ')}`;
}

function renderSwapPreview() {
  if (!swapPreview) return;
  const device = topology.devices.find((item) => item.id === swapPreview.id);
  if (!device) return;
  const currentDevice = swapPreview.currentTopology.devices.find((item) => item.id === swapPreview.id);
  const currentModel = currentDevice?.model || currentDevice?.name || '현재 장비';
  const candidateModel = swapPreview.entry.model || '치환 장비';
  const conditions = swapConditionAxes(swapPreview);
  const issues = swapConditionIssues(swapPreview);
  const blocked = issues.length > 0;
  const original = calculateScenario(swapPreview.currentTopology, scenarioOptions());
  const preview = calculateScenario(swapPreview.topology, scenarioOptions());
  const originalSurvival = blocked ? null : calculateSurvivalMultiplier(swapPreview.currentTopology, { scale: state.scale });
  const previewSurvival = blocked ? null : calculateSurvivalMultiplier(swapPreview.topology, { scale: state.scale });
  const sourceCounts = new Map();
  for (const { source, value } of swapPreview.candidate.records) if (value !== null) {
    const type = source?.type || 'estimate';
    sourceCounts.set(type, (sourceCounts.get(type) || 0) + 1);
  }
  const sourceSummary = [...sourceCounts].map(([type, count]) => `${SOURCE_TYPE_LABEL[type] || type} ${count}축`).join(' · ');
  const normalMultiplier = (result) => result.summary.growthLadder?.rungs?.[0]?.breachScale ?? null;
  const formatMultiplier = (value) => value == null ? '미확정' : `${value.toFixed(2)}×`;
  const conditionRows = conditions.map(({ record, applicability }) => {
    const measuredConditions = record.conditions ? Object.entries(record.conditions).map(([key, value]) => `${key}=${Array.isArray(value) ? (value.join('+') || '없음') : value}`).join(' · ') : '측정 조건 없음';
    const label = applicability === 'incompatible' ? '조건 불일치'
      : applicability === 'unknown' ? '적용 조건 미확인'
        : applicability === 'user-asserted' ? '사용자가 현재 워크로드 조건에서 수락' : '현재 워크로드에 적용 가능';
    const accept = ['incompatible', 'unknown'].includes(applicability)
      ? `<button type="button" data-swap-evidence-accept="${escapeAttribute(record.axis)}">현재 워크로드 조건에서 이 축 수락</button>` : '';
    return `<span class="evidence-state" data-applicability="${escapeAttribute(applicability)}"><span class="evidence-head"><b>${escapeText(axisCatalog[record.axis]?.label || record.axis)}</b> · ${escapeText(label)}</span><small>${escapeText(measuredConditions)}</small>${accept}</span>`;
  }).join('');
  const sameBinding = original.summary.bindingResourceId === preview.summary.bindingResourceId
    && original.summary.bindingAxis === preview.summary.bindingAxis;
  const result = blocked
    ? `<span>후보 근거 ${issues.length}개가 현재 워크로드 조건과 맞는지 확인되지 않았습니다. 수치 비교는 보류합니다.</span>`
    : `<span><b>${sameBinding ? '병목 그대로' : '병목 이동'}</b> · ${escapeText(sameBinding ? swapBindingLabel(preview) : `${swapBindingLabel(original)} → ${swapBindingLabel(preview)}`)}</span><span>생존 배수 ${escapeText(originalSurvival?.multiplier == null ? '미확정' : `${originalSurvival.multiplier.toFixed(2)}×${originalSurvival.bounded ? ' 이하' : ''}`)} → ${escapeText(previewSurvival?.multiplier == null ? '미확정' : `${previewSurvival.multiplier.toFixed(2)}×${previewSurvival.bounded ? ' 이하' : ''}`)}</span><span>정상시 배수 ${escapeText(formatMultiplier(normalMultiplier(original)))} → ${escapeText(formatMultiplier(normalMultiplier(preview)))}</span><span>과부하 자원 ${original.summary.overloadedCount}개 → ${preview.summary.overloadedCount}개</span><span>${escapeText(swapRackChange(original, preview))}</span>`;
  const evidenceDetail = `<details class="swap-adjustments"${swapPreview.conditionsExpanded ? ' open' : ''}><summary data-swap-conditions-toggle>측정 조건 미세 조정 <span>${issues.length}</span></summary><p>${issues.length ? '현재 워크로드와 다른 측정 조건을 확인한 뒤, 필요한 축만 수락하세요.' : '후보의 축별 측정 조건과 수락 상태입니다.'}</p><p class="swap-acceptance-scope">수락은 이 후보 장비와 현재 워크로드 조건에만 저장됩니다.</p><div class="swap-condition-list">${conditionRows}</div></details>`;
  const asymmetryWarning = swapPreview.memberIds.length < swapPreview.slotIds.length
    ? `<p class="swap-asymmetry">한 대만 치환합니다. 같은 자리의 용량이 비대칭이 되며, 결과는 이 단계적 교체 상태를 계산합니다.</p>` : '';
  openEditorPanel(`${resourceName(device)} · 장비 치환`, `<p class="editor-hint">후보를 고르면 즉시 치환 장비 상태가 됩니다. 현재 장비를 눌러 이 치환만 되돌릴 수 있습니다.</p>
    <div class="swap-variants" role="group" aria-label="치환할 장비 선택"><button type="button" data-swap-variant="current" aria-pressed="${swapPreview.active === 'current'}" aria-label="현재 장비: ${escapeAttribute(currentModel)}" title="현재 장비">${escapeText(currentModel)}</button><span aria-hidden="true">→</span><button type="button" data-swap-variant="candidate" aria-pressed="${swapPreview.active === 'candidate'}" aria-label="치환 장비: ${escapeAttribute(candidateModel)}" title="치환 장비">${escapeText(candidateModel)}</button></div>
    <div class="swap-preview">${asymmetryWarning}${result}${evidenceDetail}<small>${escapeText(`${swapPreview.entry.vendor} ${swapPreview.entry.model} · ${swapPreview.profile.label}`)} · ${swapPreview.memberIds.length > 1 ? `${swapPreview.memberIds.length}개 같은 자리 함께 치환` : '선택한 한 자리 치환'} · ${escapeText(sourceSummary)}</small></div>`);
}

function selectSwapVariant(variant, message) {
  if (!swapPreview || !['current', 'candidate'].includes(variant)) return;
  if (swapPreview.active === variant) { renderSwapPreview(); return; }
  swapPreview.active = variant;
  topology = variant === 'candidate' ? swapPreview.topology : swapPreview.currentTopology;
  commitTopology(message);
  renderSwapPreview();
}

function previewDeviceSwap(id, entry, profile) {
  const device = topology.devices.find((item) => item.id === id);
  if (!device) return;
  const slot = swapSlot(device);
  const slotIds = swapTarget?.slotIds || slot.map(({ id: memberId }) => memberId);
  const memberIds = swapTarget?.mode === 'single' ? [id] : slotIds;
  const candidate = { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model };
  const currentTopology = structuredClone(topology);
  const previewTopology = structuredClone(currentTopology);
  for (const memberId of memberIds) applySpec(previewTopology, memberId, candidate);
  swapPreview = { id, entry, profile, entryId: entry.id, profileId: profile.id, slotIds, memberIds, candidate, currentTopology, topology: previewTopology, active: 'current', conditionsExpanded: false };
  selectSwapVariant('candidate', `${entry.vendor} ${entry.model} 치환을 활성화했습니다.`);
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
  if (id === 'rack-power') {
    rackView.mode = '2d'; rackView.selectedRackId = topology.racks?.[0]?.id || null; rackView.selectedPlacementId = null;
    setWorkspace('rack');
  }
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
  openEditorPanel('장비 추가', `<p class="editor-hint">장비를 만든 뒤 캔버스에서 끌어 자리를 옮기세요. 비어 있는 한계값은 미확인으로 남습니다.</p><form class="editor-form" data-editor-form="device">
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

// 가져온 장비는 용량이 비어 있어 계산에 들어가지 못한다. 한 대씩 모델을 고르는 대신
// 종류별로 데이터시트 값을 한 번에 붙인다. 고른 모델은 spec 으로 남아 근거를 그대로 끌고
// 간다 — 숫자만 채워 넣으면 어디서 온 값인지 따질 수 없다.
function openCapacityFill() {
  const pending = topology.devices.filter((device) => !device.spec && catalogFor(device.kind).length);
  if (!pending.length) {
    showToast(topology.devices.length ? '용량을 채울 장비가 없습니다. 모두 모델이 정해져 있습니다.' : '먼저 구성도를 가져오거나 장비를 추가하세요.');
    return;
  }
  const counts = new Map();
  for (const device of pending) counts.set(device.kind, (counts.get(device.kind) || 0) + 1);
  const label = (kind) => PALETTE.find((item) => item.kind === kind)?.label || kind;
  const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([kind, count]) => {
    const options = catalogFor(kind).flatMap((entry) => entry.profiles.map((profile) =>
      `<option value="${escapeAttribute(`${entry.id}::${profile.id}`)}">${escapeText(`${entry.vendor} ${entry.model} · ${profile.label ?? profile.id}`)}</option>`)).join('');
    return `<label><span>${escapeText(label(kind))} ${count}대</span><select name="kind:${escapeAttribute(kind)}"><option value="">그대로 두기</option>${options}</select></label>`;
  }).join('');
  openEditorPanel('가져온 장비 용량 채우기', `<p class="editor-hint">모델을 고르면 그 데이터시트의 한계값이 같은 종류의 장비에 함께 붙습니다. 이미 모델을 고른 장비는 건드리지 않습니다.</p>
    <form class="editor-form" data-editor-form="capacity-fill">${rows}
    <div class="form-actions"><button type="submit">적용</button></div><p class="editor-error"></p></form>`);
}

function openDemandForm(targetId = null, sourceId = null) {
  if (topology.devices.length < 2) { showToast('수요를 만들려면 장비가 두 대 이상 있어야 합니다.'); return; }
  // 노드에서 열면 그 장비가 목적지다. 출발지는 목적지와 달라야 하므로 겹치지 않는 첫 장비를 고른다.
  // 링크에서 열면 그 링크의 두 끝이 그대로 출발지와 목적지가 된다.
  const target = topology.devices.some(({ id }) => id === targetId) ? targetId : topology.devices[1]?.id;
  const from = topology.devices.some(({ id }) => id === sourceId) && sourceId !== target ? sourceId : topology.devices.find(({ id }) => id !== target)?.id;
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

// zone 과 rack 은 도메인의 근거가 될 수 있지만 도메인 그 자체는 아니다. 제안은 화면에만
// 존재하고, 사용자가 수락하기 전에는 계산 후보나 장애 판정을 전혀 바꾸지 않는다.
function domainSuggestions() {
  const memberIds = new Set((topology.failureDomains || []).flatMap((domain) => domain.deviceIds || []));
  const byZone = new Map();
  for (const device of topology.devices) {
    const zone = zonePath(device.zone).at(-1);
    if (!zone) continue;
    const members = byZone.get(zone) || []; members.push(device); byZone.set(zone, members);
  }
  return [...byZone.entries()].filter(([, devices]) => devices.length > 1 && devices.every(({ id }) => !memberIds.has(id)))
    .map(([name, devices]) => ({ id: normalizeId(`suggested-${name}`), name, kind: 'space', deviceIds: devices.map(({ id }) => id).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function openVerificationPanel() {
  const services = (topology.services || []).map((item) => `<li><b>${escapeText(item.name)}</b> · demand ${item.demandIds.length}개 · ${(item.requiredDeliveryRatio ?? 1) * 100}% <button type="button" data-delete-model="service" data-model-id="${item.id}">삭제</button></li>`).join('') || '<li>정의된 서비스 없음</li>';
  const domains = (topology.failureDomains || []).map((item) => `<li><b>${escapeText(item.name)}</b> · ${escapeText(FAILURE_DOMAIN_KIND_LABEL[item.kind] || FAILURE_DOMAIN_KIND_LABEL.other)} · 자원 ${(item.deviceIds?.length || 0) + (item.linkIds?.length || 0)}개 <button type="button" data-delete-model="domain" data-model-id="${item.id}" aria-label="${escapeAttribute(`${item.name} 삭제`)}">삭제</button></li>`).join('') || '<li>정의된 장애 도메인 없음</li>';
  const suggestions = domainSuggestions();
  const suggestionList = suggestions.length
    ? `<aside class="domain-suggestions"><strong>도메인 제안</strong><p>같은 영역의 자원이 아직 도메인에 없습니다. 수락 전에는 계산에 반영하지 않습니다.</p>${suggestions.map((item) => `<button type="button" data-domain-suggestion="${escapeAttribute(item.id)}">${escapeText(item.name)} · ${escapeText(FAILURE_DOMAIN_KIND_LABEL[item.kind])} · 장비 ${item.deviceIds.length}개를 도메인으로 추가</button>`).join('')}</aside>`
    : '';
  const racks = (current.racks || []).map((item) => `<li><b>${escapeText(item.name || item.id)}</b> · 전력 ${item.powerStatus || item.status || '미확인'} · U ${item.spaceStatus || item.status || '미확인'} <button type="button" data-delete-model="rack" data-model-id="${item.id}">삭제</button></li>`).join('') || '<li>정의된 랙 없음</li>';
  const scenarioVerdicts = buildNamedScenarioServiceVerdicts(topology, baseline, state.namedScenarios);
  const scenarios = scenarioVerdicts.map((item) => {
    const services = item.services.length
      ? `<div class="scenario-service-table" role="region" aria-label="${escapeAttribute(item.name)} 서비스 판정"><table><thead><tr><th>서비스</th><th>판정</th><th>원인</th><th>기준선</th></tr></thead><tbody>${item.services.map((service) => `<tr data-status="${escapeAttribute(service.status)}"><td>${escapeText(service.name)}</td><td>${escapeText(service.statusLabel)}</td><td>${escapeText(service.cause)}</td><td>${escapeText(service.baselineChange)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="scenario-service-empty">서비스 수용 기준이 없습니다.</p>';
    return `<article class="saved-scenario"><header><button type="button" data-load-scenario="${escapeAttribute(item.id)}">${escapeText(item.name)}</button><span>${escapeText({ pass: '통과', fail: '실패', unknown: '통과 보류', invalid: '입력 오류' }[item.evaluationStatus] || item.evaluationStatus)}</span><button type="button" data-delete-model="scenario" data-model-id="${escapeAttribute(item.id)}">삭제</button></header>${services}</article>`;
  }).join('') || '<p class="scenario-service-empty">저장한 시나리오 없음</p>';
  const counts = { service: (topology.services || []).length, domain: (topology.failureDomains || []).length, rack: (topology.racks || []).length, scenario: state.namedScenarios.length };
  const tab = state.verificationTab || 'service';
  openEditorPanel('검증 설정', `
    <p class="editor-hint">서비스 수용 기준과 함께 장애 도메인, 랙 전력·U를 검증합니다. 비어 있는 근거는 통과로 치지 않습니다.</p>
    <div class="verification-tabs" role="tablist" aria-label="검증 설정 종류">${[['service', '서비스'], ['domain', '장애 도메인'], ['rack', '랙'], ['scenario', '시나리오']].map(([id, label]) => `<button type="button" role="tab" data-verification-tab="${id}" aria-selected="${tab === id}">${label}<span>${counts[id]}</span></button>`).join('')}</div>
    <div class="verification-columns">
      <section data-verification-panel="service"${tab === 'service' ? '' : ' hidden'}><h3>서비스 생존성</h3><p>어떤 트래픽을 어느 비율까지 전달해야 하는지 정합니다.</p><ul>${services}</ul><form class="editor-form" data-editor-form="service"><label>이름<input name="name" required maxlength="80"></label><label>최소 전달률 (%)<input name="ratio" type="number" min="1" max="100" value="100"></label>${checkList('demandIds', topology.demands, '검증할 수요')}<button type="submit">서비스 추가</button><p class="editor-error"></p></form></section>
      <section data-verification-panel="domain"${tab === 'domain' ? '' : ' hidden'}><h3>공통 장애 도메인</h3><p>전원이나 회선처럼 함께 멈추는 자원을 묶습니다. 종류는 설명 라벨이며 계산에는 영향을 주지 않습니다.</p>${suggestionList}<ul>${domains}</ul><form class="editor-form" data-editor-form="failure-domain"><label>이름<input name="name" required maxlength="80"></label><label>종류<select name="kind">${failureDomainKinds.map((kind) => `<option value="${kind}">${escapeText(FAILURE_DOMAIN_KIND_LABEL[kind])}</option>`).join('')}</select></label>${checkList('deviceIds', topology.devices, '함께 멈출 장비')}${checkList('linkIds', topology.links, '함께 멈출 링크')}<button type="submit">장애 도메인 추가</button><p class="editor-error"></p></form></section>
      <section data-verification-panel="rack"${tab === 'rack' ? '' : ' hidden'}><h3>랙 수용량</h3><p>장비의 전력과 공간이 랙 예산 안에 드는지 확인합니다.</p><ul>${racks}</ul><form class="editor-form" data-editor-form="rack"><label>이름<input name="name" required maxlength="80"></label><label>전력 예산 (W)<input name="power" type="number" min="1" required></label><label>공간 (U)<input name="units" type="number" min="1" required></label><label>전력 기준<select name="basis"><option value="nameplate">명판값</option><option value="typical">일반 부하</option><option value="measured">실측</option></select></label>${checkList('deviceIds', topology.devices, '랙 장비')}<button type="submit">랙 추가</button><p class="editor-error"></p></form></section>
      <section data-verification-panel="scenario"${tab === 'scenario' ? '' : ' hidden'}><h3>비교 시나리오</h3><p>저장한 장애와 부하를 다시 계산해 서비스별 수용 판정과 기준선 차이를 표시합니다.</p><div class="saved-scenarios">${scenarios}</div><form class="editor-form" data-editor-form="scenario"><label>이름<input name="name" required maxlength="80"></label><button type="submit">현재 장애·부하 저장</button><p class="editor-error"></p></form></section>
    </div>`);
}

function openMeasuredImportPanel() {
  const imported = topology.measuredImport;
  const observed = topology.observedLoad;
  if (!imported && !observed) {
    openEditorPanel('실측 임포트 결과', '<p class="editor-hint">아직 가져온 실측 자료가 없습니다. 프로젝트 메뉴에서 실측 한계 또는 관측 부하 JSON을 가져오세요.</p>');
    return;
  }
  const row = (entry, state) => {
    const axis = axisCatalog[entry.axis];
    const device = topology.devices.find(({ id }) => id === entry.deviceId);
    const target = device ? resourceName(device) : entry.deviceId;
    return `<li><b>${escapeText(target)}</b> · ${escapeText(axis?.label || entry.axis)} ${escapeText(formatCompact(entry.value, axis?.unit || entry.unit))}<small>${escapeText(state)}${entry.asOf ? ` · ${escapeText(entry.asOf)}` : ''}${entry.saturationEvidence ? ` · 포화 증거: ${escapeText(entry.saturationEvidence)}` : ''}</small></li>`;
  };
  const applied = imported?.applied.length ? imported.applied.map((entry) => row(entry, '한계 적용')).join('') : '<li>적용한 한계 없음</li>';
  const floors = imported?.floors.length ? imported.floors.map((entry) => row(entry, '관측 하한 보관 · 한계 미승격')).join('') : '<li>관측 하한 없음</li>';
  const unmatched = imported?.unmatched.length ? imported.unmatched.map((entry) => row(entry, '대상 장비 없음 · 미매칭')).join('') : '<li>미매칭 없음</li>';
  const observedComparison = observed ? compareTopologyFingerprint(observed.fingerprint, topology) : null;
  const observedCount = observed ? Object.values(observed.devices).reduce((count, axes) => count + Object.keys(axes).length, 0) + Object.values(observed.links).reduce((count, directions) => count + Object.values(directions).reduce((sum, axes) => sum + Object.keys(axes || {}).length, 0), 0) : 0;
  const fingerprintNotice = observed && !fingerprintMatches(observedComparison) ? `<small>토폴로지 변경 감지 · 추가 장비 ${observedComparison.addedDevices.join(', ') || '없음'} · 삭제 장비 ${observedComparison.missingDevices.join(', ') || '없음'} · 추가 링크 ${observedComparison.addedLinks.join(', ') || '없음'} · 삭제 링크 ${observedComparison.missingLinks.join(', ') || '없음'}</small>` : '';
  const limitSections = imported ? `<p class="editor-hint">${escapeText(imported.importedAt)}에 가져온 한계 결과입니다. 관측 최대는 포화 증거가 없으면 한계값으로 쓰지 않습니다.</p><section><h3>한계 적용 <span>${imported.applied.length}</span></h3><ul>${applied}</ul></section><section><h3>관측 하한 <span>${imported.floors.length}</span></h3><ul>${floors}</ul></section><section><h3>미매칭 <span>${imported.unmatched.length}</span></h3><ul>${unmatched}</ul></section>` : '';
  const freshnessNotice = observed && observedLoadIsStale(observed) ? `<small class="measured-import-warning">관측 시점이 ${OBSERVED_LOAD_STALE_AFTER_DAYS}일을 넘었습니다. 현재 부하와 다를 수 있습니다.</small>` : '';
  const zabbixUnmapped = observed?.unmapped || [];
  const zabbixNotice = zabbixUnmapped.length ? `<small class="measured-import-warning">Zabbix 미매핑 ${zabbixUnmapped.length}개 · ${escapeText(zabbixUnmapped.map(({ host, itemKey }) => `${host}: ${itemKey}`).join(', '))}</small>` : '';
  const observedSection = observed ? `<section><h3>관측 부하 <span>${observedCount}</span></h3><ul><li><b>${escapeText(observed.aggregate.toUpperCase())}</b> · ${escapeText(observed.asOf)}${observed.source === 'zabbix' ? ' · Zabbix' : ''}<small>정상 상태의 자원 부하만 대체합니다. 장애 분석에는 수요 모델을 사용합니다.</small>${freshnessNotice}${fingerprintNotice}${zabbixNotice}</li></ul></section>` : '';
  const validation = buildObservedLoadValidationReport(topology, scenarioOptions());
  const groupLabel = { matched: '조건 일치', mismatched: '조건 불일치', unrecorded: '조건 미기록' };
  const validationRows = validation.axes.map((axis) => `<tr><th>${escapeText(axisCatalog[axis.axis]?.label || axis.axis)}</th><td>${axis.sampleCount}</td><td>${formatPercent(axis.mape)}</td><td>${formatPercent(axis.maxAbsolutePercentageError)}</td><td>${formatPercent(axis.meanSignedPercentageError, true)}</td><td>과소 ${axis.signedError.underModelled} · 일치 ${axis.signedError.exact} · 과대 ${axis.signedError.overModelled}</td></tr>`).join('');
  const validationSection = observed ? `<section><h3>검증 리포트 <span>${validation.sampleCount}</span></h3>${validation.axes.length ? `<p class="editor-hint">${groupLabel[validation.conditionGroup]} 표본입니다. 모델 예측은 관측 부하를 빼고 같은 정상 시나리오를 다시 계산했습니다.</p><table><thead><tr><th>축</th><th>표본</th><th>MAPE</th><th>최대 오차</th><th>평균 부호 오차</th><th>분포</th></tr></thead><tbody>${validationRows}</tbody></table>` : '<p class="editor-hint">비교할 수 있는 관측 축이 없습니다. 장비 또는 링크 축이 현재 토폴로지와 일치하는지 확인하세요.</p>'}</section>` : '';
  openEditorPanel('실측 임포트 결과', `<div class="measured-import-results">${limitSections}${observedSection}${validationSection}</div>`);
}

function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

// 내보낸 그림은 화면과 같은 축을 골라 같은 값을 말해야 한다. 그래서 결과와 훑기를 함께 넘긴다.
function diagramSvg(anonymize = false) {
  return exportDiagramSvg(topology, current, { anonymize, detailLevel: detailView.level, sweep: sweepStale() ? null : sweep, survivalMultiplier: survival, domainSweep, linkRoute: routeView.mode, exportedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') });
}

async function exportPng(anonymize = false) {
  const svg = diagramSvg(anonymize);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = Math.min(image.naturalWidth * 2, 12000); canvas.height = Math.min(image.naturalHeight * 2, 12000);
    const context = canvas.getContext('2d'); context.scale(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight); context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 인코딩에 실패했습니다.');
    const pngUrl = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = pngUrl; anchor.download = anonymize ? 'rack-mesh-diagram-anonymized.png' : 'rack-mesh-diagram.png'; anchor.click(); setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
    showToast(anonymize ? '장비명을 익명화한 PNG로 내보냈습니다.' : '설계 화면을 PNG로 내보냈습니다.');
  } finally { URL.revokeObjectURL(url); }
}

function saveProject() {
  downloadText('rack-mesh-project.json', serializeProject(topology, { ...state, baseline: baselineSnapshot }));
  documentHistory.markSaved();
  showToast('프로젝트 JSON을 저장했습니다.');
}

async function readFile(input, { limit = 2_000_000, label = 'JSON' } = {}) {
  const file = input.files?.[0];
  if (!file) return null;
  if (file.size > limit) throw new Error(`${label} 파일은 ${Math.round(limit / 1024 / 1024)} MB 이하여야 합니다.`);
  const text = await file.text(); input.value = ''; return text;
}

const DRAWIO_MIME_TYPES = new Set(['application/xml', 'text/xml', 'text/plain', 'application/vnd.jgraph.mxfile']);
function isDrawioFile(file) { return /\.(?:drawio|xml)$/i.test(file?.name || '') || DRAWIO_MIME_TYPES.has(file?.type || ''); }
async function importDrawioFile(file) {
  if (!file || !isDrawioFile(file)) throw new Error('drawio 또는 XML 파일 하나를 놓아 주세요.');
  if (file.size > 4 * 1024 * 1024) throw new Error('drawio 파일은 4 MB 이하여야 합니다.');
  openDrawioPreview(await parseDrawioDocument(await file.text()), { fileName: file.name || '' });
}

function handleEditorAction(action) {
  closeTopMenus();
  const editorMenu = document.querySelector('.editor-menu');
  if (editorMenu) editorMenu.open = false;
  if (action === 'undo' || action === 'redo') { historyStep(action); return; }
  if (action === 'device') openDeviceForm();
  if (action === 'demand') openDemandManager();
  if (action === 'verification') openVerificationPanel();
  if (action === 'measured-import') openMeasuredImportPanel();
  if (action === 'workload') openWorkloadForm();
  if (action === 'connect') { state.editorMode = state.editorMode === 'connect' ? 'select' : 'connect'; state.connectSource = null; annotationSource = null; closeEditorPanel(); renderTopology(); renderEditorMode(); }
  if (action === 'save') saveProject();
  if (action === 'open') element('project-file-input').click();
  if (action === 'import-device') element('device-file-input').click();
  if (action === 'import-measured-limits') element('measured-limits-file-input').click();
  if (action === 'import-observed-load') element('observed-load-file-input').click();
  if (action === 'import-zabbix-observed-load') element('zabbix-observed-load-file-input').click();
  if (action === 'import-drawio') element('drawio-file-input').click();
  if (action === 'fill-capacity') { openCapacityFill(); return; }
  if (action === 'export-svg') {
    if (analysisProgress && detailView.level !== 'off') showToast(`${analysisProgress.label} 계산 중 ${analysisProgress.completed}/${analysisProgress.total} · 완료 후 내보낼 수 있습니다.`);
    else { downloadText('rack-mesh-diagram.svg', diagramSvg(), 'image/svg+xml'); showToast(`현재 ${detailView.level === 'off' ? '구성도' : detailView.level === 'brief' ? '요약' : '전체'} 보기로 SVG를 내보냈습니다.`); }
  }
  if (action === 'export-svg-anonymized') {
    if (analysisProgress && detailView.level !== 'off') showToast(`${analysisProgress.label} 계산 중 ${analysisProgress.completed}/${analysisProgress.total} · 완료 후 내보낼 수 있습니다.`);
    else { downloadText('rack-mesh-diagram-anonymized.svg', diagramSvg(true), 'image/svg+xml'); showToast('현재 보기에서 장비명을 익명화한 SVG를 내보냈습니다.'); }
  }
  if (action === 'export-png') {
    if (analysisProgress && detailView.level !== 'off') showToast(`${analysisProgress.label} 계산 중 ${analysisProgress.completed}/${analysisProgress.total} · 완료 후 내보낼 수 있습니다.`);
    else exportPng().catch((error) => showToast(error.message));
  }
  if (action === 'export-png-anonymized') {
    if (analysisProgress && detailView.level !== 'off') showToast(`${analysisProgress.label} 계산 중 ${analysisProgress.completed}/${analysisProgress.total} · 완료 후 내보낼 수 있습니다.`);
    else exportPng(true).catch((error) => showToast(error.message));
  }
  if (action === 'new') openTemplatePicker();
  if (action === 'new-blank') applyTemplate('blank');
  if (action.startsWith('shape-')) createShapeAtVisibleCanvasCenter(action.slice(6));
  if (action === 'group' && state.selection.length > 1) {
    topology = groupSelection(topology, state.selection, '설계 그룹');
    const group = topology.diagram.groups.at(-1);
    // 방금 만든 그룹을 선택해야 해제와 다음 편집을 바로 할 수 있다. 장비로만 만든 그룹은
    // 캔버스에서 그룹을 다시 집을 표식이 없으므로, 이 전환이 없으면 해제할 수 없었다.
    state.selection = group ? [{ type: 'group', id: group.id }] : state.selection;
    commitTopology('선택한 요소를 그룹으로 묶었습니다.');
  }
  if (action === 'ungroup') {
    const groups = state.selection.filter(({ type }) => type === 'group')
      .map(({ id }) => topology.diagram.groups.find((group) => group.id === id)).filter(Boolean);
    topology = ungroupSelection(topology, state.selection);
    state.selection = groups.flatMap((group) => group.memberIds.map((id) => (
      topology.devices.some((device) => device.id === id) ? { type: 'device', id } : { type: 'shape', id }
    )));
    commitTopology('선택한 그룹을 해제했습니다.');
  }
  if (action === 'align-left' && state.selection.length > 1) { topology = alignSelection(topology, state.selection, 'left'); commitTopology('선택한 요소를 왼쪽으로 정렬했습니다.'); }
  if (action === 'distribute-x' && state.selection.length > 2) { topology = distributeSelection(topology, state.selection, 'x'); commitTopology('선택한 요소를 가로로 분배했습니다.'); }
  if (action === 'annotation-connect') { state.editorMode = state.editorMode === 'annotation' ? 'select' : 'annotation'; annotationSource = null; closeEditorPanel(); renderTopology(); renderEditorMode(); showToast(state.editorMode === 'annotation' ? '주석선을 시작할 장비 또는 도형을 선택하세요.' : '주석선 연결을 취소했습니다.'); }
  if (action === 'map-device') {
    const selected = state.selection.length === 1 && state.selection[0].type === 'shape' ? state.selection[0] : null;
    const shape = selected && topology.diagram?.shapes?.find(({ id }) => id === selected.id);
    if (!shape) { showToast('장비로 지정할 도형을 하나 선택하세요.'); return; }
    let deviceId = `device-${shape.id}`; let suffix = 2;
    while (topology.devices.some(({ id }) => id === deviceId)) deviceId = `device-${shape.id}-${suffix++}`;
    openDeviceForm({ name: shape.text || '가져온 장비', deviceId, zone: 'UNASSIGNED', position: { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }, mapShapeId: shape.id });
  }
}

function toggleFailure(type, id) {
  cancelTeaser();
  const set = type === 'device' ? state.disabledDevices : type === 'link' ? state.disabledLinks : state.disabledDomains;
  const before = current.summary.minHeadroom;
  const active = !set.has(id);
  active ? set.add(id) : set.delete(id);
  showToast(`${id.toUpperCase()} ${active ? '비활성화' : '복구'} · 경로 재계산 완료`);
  recalculate();
  const after = current.summary.minHeadroom;
  const target = type === 'domain' ? topology.failureDomains?.find((domain) => domain.id === id) : topology[type === 'device' ? 'devices' : 'links'].find((resource) => resource.id === id);
  const name = resourceName(target) || id;
  const beforeText = formatPercent(before);
  const afterText = formatPercent(after);
  const delta = before == null || after == null ? '' : ` ${formatPercent(after - before, true)} 변화`;
  element('failure-change-live').textContent = `${name} ${active ? '장애를 주입했습니다' : '장애를 복구했습니다'}. 최소 headroom ${beforeText}에서 ${afterText}.${delta}`;
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
  if (analysisProgress) { showToast(`${analysisProgress.label} 계산 중 ${analysisProgress.completed}/${analysisProgress.total} · 완료 후 내보낼 수 있습니다.`); return; }
  const payload = createExport(topology, current, baseline, { survivalMultiplier: survival, sweep, domainSweep });
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'rack-mesh-scenario.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast('결과 JSON을 내보냈습니다.');
}

function exportReport(format) {
  if (analysisProgress) { showToast(analysisProgress.label + ' 계산 중 ' + analysisProgress.completed + '/' + analysisProgress.total + ' · 완료 후 내보낼 수 있습니다.'); return; }
  const model = buildReportModel(topology, current, baseline, state.namedScenarios, scenarioOptions(), { survivalMultiplier: survival, domainSweep });
  const renderers = { markdown: [renderReportMarkdown, 'rack-mesh-report.md', 'text/markdown'], html: [renderReportHtml, 'rack-mesh-report.html', 'text/html'], json: [renderReportJson, 'rack-mesh-report.json', 'application/json'] };
  const [render, filename, type] = renderers[format];
  downloadText(filename, render(model), type);
  showToast('분석 보고서 ' + format.toUpperCase() + '을 내보냈습니다.');
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
  // 손으로 굽힌 선만 되돌릴 것이 있다. 굽히지 않은 선에 이 항목을 띄우면 누를 것이 없는 줄이 된다.
  if (type === 'link' && resource.waypoints?.length) items.push({ id: 'straighten', label: '선 모양 초기화' });
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
    if (action === 'straighten') { updateLink(topology, id, { waypoints: [] }); commitTopology('선을 자동 경로로 되돌렸습니다.'); return; }
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
  const entry = { type, id };
  if (additive) {
    const exists = state.selection.some((item) => item.type === type && item.id === id);
    state.selection = exists ? state.selection.filter((item) => item.type !== type || item.id !== id) : [...state.selection, entry];
  } else state.selection = [entry];
  if (type === 'device' || type === 'link') state.selectedId = id;
  renderEditorMode();
}

function selectDiagramGroup(id, event = {}) {
  const target = topology.diagram?.groups?.find((item) => item.id === id);
  if (!target) return;
  if (target.locked && !event.altKey) { showToast('잠긴 그룹입니다. Alt/Option+클릭 후 인스펙터에서 잠금을 해제하세요.'); return; }
  selectElement('group', id);
  renderTopology(); renderInspector(); openMobileInspector();
}

function selectDiagramConnector(id, event = {}) {
  const target = topology.diagram?.connectors?.find((item) => item.id === id);
  if (!target) return;
  if (target.locked && !event.altKey) { showToast('잠긴 연결선입니다. Alt/Option+클릭 후 인스펙터에서 잠금을 해제하세요.'); return; }
  selectElement('connector', id, event.shiftKey || event.metaKey || event.ctrlKey);
  renderTopology(); renderInspector(); openMobileInspector();
}

// 배경 도형은 설계를 설명하지만 장비나 계산 링크를 덮어 조작을 가로채면 안 된다. 도형을 잠시
// hit-test에서 빼고 실제 아래 자원을 찾아, 인프라 조작을 우선한다.
function infrastructureBelowShape(event, shape) {
  const previous = shape.style.pointerEvents;
  shape.style.pointerEvents = 'none';
  const below = document.elementFromPoint(event.clientX, event.clientY);
  shape.style.pointerEvents = previous;
  return below?.closest?.('.mesh-node, .link-hit');
}

function handleNodeSelection(id, additive = false) {
  if (state.editorMode === 'annotation') {
    if (!annotationSource) { annotationSource = id; renderTopology(); renderEditorMode(); showToast('주석선을 끝낼 장비 또는 도형을 선택하세요.'); return; }
    if (annotationSource === id) { annotationSource = null; renderTopology(); renderEditorMode(); return; }
    try {
      topology = addConnector(topology, { source: annotationSource, target: id, kind: 'annotation' });
      state.selection = [{ type: 'connector', id: topology.diagram.connectors.at(-1).id }]; annotationSource = null; state.editorMode = 'select'; commitTopology('계산에서 제외되는 주석 연결선을 추가했습니다.');
    } catch (error) { showToast(error.message); annotationSource = null; state.editorMode = 'select'; renderTopology(); renderEditorMode(); }
    return;
  }
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

function openMobileInspector() { if (mobileLayout.matches) element('inspector-panel').classList.add('mobile-open'); }
function closeMobileInspector() { element('inspector-panel').classList.remove('mobile-open'); }
element('inspector-close-mobile').addEventListener('click', closeMobileInspector);
element('mobile-inspector-open').addEventListener('click', openMobileInspector);
element('toggle-left-panel').addEventListener('click', () => setWorkspacePanelCollapsed('left', !state.leftPanelCollapsed));
element('toggle-right-panel').addEventListener('click', () => setWorkspacePanelCollapsed('right', !state.rightPanelCollapsed));

element('scale-input').addEventListener('input', (event) => { const value = Number(event.target.value) / 100; cancelTeaser(); state.scale = value; event.target.value = String(value * 100); recalculate({ light: true }); });
element('scale-input').addEventListener('change', (event) => { const value = Number(event.target.value) / 100; cancelTeaser(); state.scale = value; event.target.value = String(value * 100); recalculate(); });
element('failure-list').addEventListener('click', (event) => {
  if (event.target.closest('[data-failure-absorbs-toggle]')) { absorbsExpanded = !absorbsExpanded; renderFailures(); return; }
  if (event.target.closest('[data-failure-resource-absorbs-toggle]')) { resourceAbsorbsExpanded = !resourceAbsorbsExpanded; renderFailures(); return; }
  if (event.target.closest('[data-failure-worst-toggle]')) { worstAxesExpanded = !worstAxesExpanded; renderFailures(); return; }
  const filter = event.target.closest('[data-failure-filter-verdict]');
  if (filter) { failureFilter.verdict = filter.dataset.failureFilterVerdict; renderFailures(); return; }
  const button = event.target.closest('[data-failure-id]');
  if (button) toggleFailure(button.dataset.failureType, button.dataset.failureId);
});
element('failure-list').addEventListener('input', (event) => {
  const input = event.target.closest('[data-failure-filter] input');
  if (input) { failureFilter.query = input.value; renderFailures(); }
});
element('failure-list').addEventListener('keydown', (event) => {
  const row = event.target.closest('[data-failure-group][data-failure-index]');
  if (!row || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const total = Number(row.getAttribute('aria-setsize'));
  const index = Number(row.dataset.failureIndex);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 : Math.max(0, Math.min(total - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
  if (next === index) return;
  event.preventDefault();
  focusVirtualFailureRow(row.dataset.failureGroup, next);
});
document.querySelector('.failure-panel').addEventListener('scroll', queueVirtualFailureRows, { passive: true });
window.addEventListener('scroll', queueVirtualFailureRows, { passive: true });
window.addEventListener('resize', queueVirtualFailureRows);
element('class-control').addEventListener('click', (event) => {
  const badge = event.target.closest('[data-class-badge]')?.dataset.classBadge;
  if (badge) {
    classView.badge = badge;
    try { localStorage.setItem('rack-mesh-class-badge', badge); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
    render();
    return;
  }
  const motion = event.target.closest('[data-number-motion]')?.dataset.numberMotion;
  if (motion) {
    motionView.drift = motion;
    try { localStorage.setItem('rack-mesh-number-motion', motion); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
    render();
    return;
  }
  const route = event.target.closest('[data-link-route]')?.dataset.linkRoute;
  if (route && LINK_ROUTES.includes(route)) {
    routeView.mode = route;
    try { localStorage.setItem('rack-mesh-link-route', route); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
    render();
    return;
  }
  const detail = event.target.closest('[data-node-detail]')?.dataset.nodeDetail;
  if (!detail || !DETAIL_LEVELS.has(detail)) return;
  detailView.level = detail;
  try { localStorage.setItem('rack-mesh-node-detail', detail); } catch { /* 저장이 막혀도 이번 세션은 바뀐다 */ }
  render();
});
document.querySelector('.workspace-switch').addEventListener('click', (event) => {
  const button = event.target.closest('[data-workspace]');
  if (button) setWorkspace(button.dataset.workspace);
});
element('rack-workspace').addEventListener('click', (event) => {
  const sidebarTab = event.target.closest('[data-rack-sidebar-tab]');
  if (sidebarTab) { rackView.sidebarTab = sidebarTab.dataset.rackSidebarTab; renderRackWorkspace(); return; }
  const rackSelect = event.target.closest('[data-rack-select]');
  if (rackSelect) { rackView.selectedRackId = rackSelect.dataset.rackSelect; rackView.selectedPlacementId = null; renderRackWorkspace(); return; }
  const placement = event.target.closest('[data-rack-placement]');
  if (placement) { rackView.selectedRackId = placement.dataset.rackId; rackView.selectedPlacementId = placement.dataset.rackPlacement; renderRackWorkspace(); return; }
  const view = event.target.closest('[data-rack-view]');
  if (view) { rackView.mode = view.dataset.rackView; renderRackWorkspace(); return; }
  const face = event.target.closest('[data-rack-face]');
  if (face) { rackView.face = face.dataset.rackFace; renderRackWorkspace(); return; }
  if (event.target.closest('[data-rack-cables]')) { rackView.cables = !rackView.cables; renderRackWorkspace(); return; }
  const action = event.target.closest('[data-rack-action]')?.dataset.rackAction;
  if (!action) return;
  const rack = currentRack();
  if (action === 'new-rack') {
    element('rack-inspector-content').innerHTML = `<form data-rack-form="rack-new"><label>랙 이름<input name="name" maxlength="80" required placeholder="RACK 01"></label><label>공간 (U)<input name="capacityU" type="number" min="1" max="100" required value="42"></label><label>전력 예산 (W)<input name="power" type="number" min="1" required value="10000"></label><label>전력 기준<select name="basis"><option value="nameplate">명판값</option><option value="typical">일반 부하</option><option value="measured">실측</option></select></label><button type="submit">랙 생성</button><p class="rack-form-error"></p></form>`;
    element('rack-inspector-content').querySelector('input[name="name"]').focus(); return;
  }
  if (action === 'add-mapped' && rack) {
    const choices = topology.devices.filter(({ id }) => !topologyDevicePlaced(id));
    if (!choices.length) { showToast('배치할 수 있는 토폴로지 장비가 없습니다.'); return; }
    const first = choices[0]; const height = placementHeight(topology, { deviceId: first.id }); const start = firstFreeStartU(topology, rack, height);
    element('rack-inspector-content').innerHTML = `<form data-rack-form="mapped-new"><label>토폴로지 장비<select name="deviceId">${choices.map((device) => `<option value="${escapeAttribute(device.id)}">${escapeText(device.name)} · ${escapeText(device.kind)}</option>`).join('')}</select></label><label>시작 U<input name="startU" type="number" min="1" max="${rack.capacityU}" required value="${start ?? 1}"></label><label>높이 (U)<input name="uHeight" type="number" min="1" max="${rack.capacityU}" required value="${height}"></label><button type="submit">장비 연결</button><p class="rack-form-error"></p></form>`; return;
  }
  if (action === 'add-standalone' && rack) {
    const start = firstFreeStartU(topology, rack, 1);
    element('rack-inspector-content').innerHTML = `<form data-rack-form="standalone-new"><label>이름<input name="name" maxlength="80" required placeholder="PATCH PANEL 01"></label><label>모델<input name="model" maxlength="80"></label><label>종류<input name="kind" maxlength="80" required value="other"></label><label>시작 U<input name="startU" type="number" min="1" max="${rack.capacityU}" required value="${start ?? 1}"></label><label>높이 (U)<input name="uHeight" type="number" min="1" max="${rack.capacityU}" required value="1"></label><label>전력 (W)<input name="powerWatts" type="number" min="0"></label><button type="submit">랙 장비 추가</button><p class="rack-form-error"></p></form>`; return;
  }
  if (action === 'delete-rack' && rack) { if (confirm(`${rack.name}과 랙 배치를 삭제할까요? 토폴로지 장비는 삭제되지 않습니다.`)) { removeRack(topology, rack.id); rackView.selectedRackId = topology.racks?.[0]?.id || null; rackView.selectedPlacementId = null; commitRack('랙을 삭제했습니다.'); } return; }
  if (action === 'delete-placement' && rack && rackView.selectedPlacementId) { removePlacement(topology, rack.id, rackView.selectedPlacementId); rackView.selectedPlacementId = null; commitRack('랙 배치를 제거했습니다. 장비 원본은 유지됩니다.'); }
});
element('rack-equipment-palette').addEventListener('pointerdown', (event) => {
  const item = event.target.closest('[data-rack-palette-type]');
  if (!item || event.button !== 0) return;
  event.preventDefault(); item.setPointerCapture(event.pointerId);
  rackPaletteDrag = { type: item.dataset.rackPaletteType, deviceId: item.dataset.rackDeviceId || null, name: item.dataset.rackName || item.querySelector('strong')?.textContent || 'RACK DEVICE', kind: item.dataset.rackKind || '', uHeight: Number(item.dataset.rackHeight) || 1, powerWatts: item.dataset.rackPower === '' ? null : Number(item.dataset.rackPower), pointerId: event.pointerId, item, startX: event.clientX, startY: event.clientY, ghost: null };
});
element('rack-equipment-palette').addEventListener('pointermove', (event) => {
  if (!rackPaletteDrag || event.pointerId !== rackPaletteDrag.pointerId) return;
  if (!rackPaletteDrag.ghost && Math.hypot(event.clientX - rackPaletteDrag.startX, event.clientY - rackPaletteDrag.startY) > PALETTE_DRAG_THRESHOLD) {
    rackPaletteDrag.ghost = document.createElement('div'); rackPaletteDrag.ghost.className = 'rack-palette-ghost'; rackPaletteDrag.ghost.innerHTML = `<strong>${escapeText(rackPaletteDrag.name)}</strong><span>${rackPaletteDrag.uHeight}U</span>`; document.body.append(rackPaletteDrag.ghost); rackPaletteDrag.item.classList.add('dragging');
  }
  if (!rackPaletteDrag.ghost) return;
  rackPaletteDrag.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px) translate(-50%, -50%)`;
  queueRackDropPreview(event.clientX, event.clientY);
});
element('rack-equipment-palette').addEventListener('pointerup', (event) => {
  if (!rackPaletteDrag || event.pointerId !== rackPaletteDrag.pointerId) return;
  const target = rackDropTarget(event.clientX, event.clientY, rackPaletteDrag.uHeight);
  const drag = cancelRackPaletteDrag();
  if (drag.ghost) { placeRackPaletteItem(drag, target); return; }
  const rack = currentRack(); if (!rack) { showToast('먼저 랙을 추가하세요.'); return; }
  const startU = firstFreeStartU(topology, rack, drag.uHeight); placeRackPaletteItem(drag, { rack, startU, uHeight: drag.uHeight });
});
element('rack-equipment-palette').addEventListener('pointercancel', cancelRackPaletteDrag);
element('rack-equipment-palette').addEventListener('lostpointercapture', () => { if (rackPaletteDrag) cancelRackPaletteDrag(); });
element('rack-equipment-palette').addEventListener('dragstart', (event) => event.preventDefault());
element('rack-equipment-palette').addEventListener('click', (event) => {
  if (event.detail !== 0) return;
  const item = event.target.closest('[data-rack-palette-type]'); const rack = currentRack();
  if (!item || !rack) { if (!rack) showToast('먼저 랙을 추가하세요.'); return; }
  const drag = { type: item.dataset.rackPaletteType, deviceId: item.dataset.rackDeviceId || null, name: item.dataset.rackName || item.querySelector('strong')?.textContent || 'RACK DEVICE', kind: item.dataset.rackKind || '', uHeight: Number(item.dataset.rackHeight) || 1, powerWatts: item.dataset.rackPower === '' ? null : Number(item.dataset.rackPower) };
  placeRackPaletteItem(drag, { rack, startU: firstFreeStartU(topology, rack, drag.uHeight), uHeight: drag.uHeight });
});
element('rack-workspace').addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-rack-form]'); if (!form) return; event.preventDefault();
  const data = new FormData(form); const rack = currentRack();
  try {
    if (form.dataset.rackForm === 'rack-new') { const created = createRack(topology, { name: data.get('name'), capacityU: Number(data.get('capacityU')), powerBudgetWatts: Number(data.get('power')), powerBasis: data.get('basis') }); rackView.selectedRackId = created.id; commitRack(`${created.name} 랙을 추가했습니다.`); return; }
    if (form.dataset.rackForm === 'rack-edit') {
      materializeRack(topology, rack); const capacityU = Number(data.get('capacityU'));
      const name = String(data.get('name')).trim(); const powerBudgetWatts = Number(data.get('power'));
      if (!name) throw new Error('랙 이름을 입력하세요.');
      if (!Number.isFinite(powerBudgetWatts) || powerBudgetWatts <= 0) throw new Error('전력 예산은 0보다 커야 합니다.');
      if (!Number.isInteger(capacityU) || capacityU < 1 || rack.placements.some((placement) => placement.startU + placement.uHeight - 1 > capacityU)) throw new Error('배치 장비가 새 랙 범위를 벗어납니다.');
      rack.name = name; rack.capacityU = capacityU; rack.powerBudgetWatts = powerBudgetWatts; rack.powerBasis = String(data.get('basis')); commitRack('랙 설정을 저장했습니다.'); return;
    }
    if (form.dataset.rackForm === 'mapped-new') { const placement = addMappedPlacement(topology, rack.id, { deviceId: data.get('deviceId'), startU: Number(data.get('startU')), uHeight: Number(data.get('uHeight')) }); rackView.selectedPlacementId = placement.id; commitRack('토폴로지 장비를 랙에 연결했습니다.'); return; }
    if (form.dataset.rackForm === 'standalone-new') { const placement = addStandalonePlacement(topology, rack.id, { name: data.get('name'), model: data.get('model'), kind: data.get('kind'), startU: Number(data.get('startU')), uHeight: Number(data.get('uHeight')), powerWatts: data.get('powerWatts') }); rackView.selectedPlacementId = placement.id; commitRack('랙 전용 장비를 추가했습니다.'); return; }
    if (form.dataset.rackForm === 'placement-edit') { updatePlacement(topology, rack.id, form.dataset.placementId, { name: data.get('name'), model: data.get('model'), kind: data.get('kind'), startU: Number(data.get('startU')), uHeight: Number(data.get('uHeight')), powerWatts: data.get('powerWatts') }); commitRack('랙 배치를 저장했습니다.'); }
  } catch (error) { form.querySelector('.rack-form-error').textContent = error.message; }
});
document.querySelector('.mobile-fault-tray').addEventListener('click', (event) => {
  const button = event.target.closest('[data-quick-failure]');
  if (button && button.dataset.quickFailure) toggleFailure(button.dataset.quickFailureType, button.dataset.quickFailure);
});
element('node-layer').addEventListener('click', (event) => {
  const button = event.target.closest('[data-device-id]');
  if (button && !suppressNodeClick) handleNodeSelection(button.dataset.deviceId, event.shiftKey || event.metaKey || event.ctrlKey);
});
element('node-layer').addEventListener('pointerdown', (event) => {
  if (topologyView.mode === 'spatial') return;
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
  // 보조키를 누른 것은 고르겠다는 뜻이지 끌겠다는 뜻이 아니다. 여기서 선택을 먼저 바꾸면
  // 이어지는 click 의 토글이 방금 넣은 것을 도로 빼서 아무것도 안 남았다 — shift 클릭으로
  // 두 번째 장비를 고르면 선택이 0이 되던 원인이다. 선택은 click 에 맡기고 드래그도 걸지 않는다.
  if (event.shiftKey || event.metaKey || event.ctrlKey) return;
  if (!state.selection.some((item) => item.type === 'device' && item.id === device.id)) selectElement('device', device.id);
  // 여럿을 고른 채 하나를 끌면 나머지도 같이 따라와야 한다. 놓는 순간에는 moveSelection 이
  // 전부 옮기지만, 끄는 동안 잡은 것만 움직이면 나머지는 안 딸려온다고 읽히고 놓을 때 튄다.
  // 그래서 함께 끌 노드의 시작 자리를 여기서 적어 두고, 미리보기는 그 자리에 델타만 더한다.
  const dragging = new Map(state.selection
    .filter((item) => item.type === 'device')
    .map((item) => [item.id, topology.devices.find(({ id }) => id === item.id)?.position])
    .filter(([, at]) => at)
    .map(([id, at]) => [id, { ...at }]));
  if (!dragging.has(device.id)) dragging.set(device.id, { ...device.position });
  dragState = { id: device.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { ...device.position }, initial: structuredClone(topology), selection: structuredClone(state.selection), dragging, button };
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
  const dx = (event.clientX - dragState.startX) / state.zoom;
  const dy = (event.clientY - dragState.startY) / state.zoom;
  // 잡은 것만 토폴로지에 반영한다. 놓을 때 moveSelection 이 그 델타로 나머지를 옮기므로,
  // 여기서 전부 옮기면 같은 이동이 두 번 얹힌다. 나머지는 화면에서만 따라 움직인다.
  const moved = moveDevice(topology, dragState.id, { x: dragState.origin.x + dx, y: dragState.origin.y + dy });
  dragState.button.style.left = `${moved.position.x - viewport.minX}px`; dragState.button.style.top = `${moved.position.y - viewport.minY}px`;
  for (const [id, origin] of dragState.dragging) {
    if (id === dragState.id) continue;
    const node = document.querySelector(`[data-device-id="${CSS.escape(id)}"]`);
    if (!node) continue;
    node.style.left = `${origin.x + dx - viewport.minX}px`;
    node.style.top = `${origin.y + dy - viewport.minY}px`;
  }
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
  const infrastructure = infrastructureBelowShape(event, shape);
  if (infrastructure?.classList.contains('mesh-node')) { handleNodeSelection(infrastructure.dataset.deviceId, event.shiftKey || event.metaKey || event.ctrlKey); return; }
  if (infrastructure?.classList.contains('link-hit')) { selectElement('link', infrastructure.closest('[data-link-id]')?.dataset.linkId, event.shiftKey || event.metaKey || event.ctrlKey); renderTopology(); renderInspector(); return; }
  const target = topology.diagram?.shapes?.find((item) => item.id === shape.dataset.shapeId);
  if (state.editorMode === 'annotation') {
    if (!annotationSource) { annotationSource = target.id; renderTopology(); renderEditorMode(); showToast('주석선을 끝낼 장비 또는 도형을 선택하세요.'); return; }
    if (annotationSource === target.id) { annotationSource = null; renderTopology(); renderEditorMode(); return; }
    try { topology = addConnector(topology, { source: annotationSource, target: target.id, kind: 'annotation' }); state.selection = [{ type: 'connector', id: topology.diagram.connectors.at(-1).id }]; annotationSource = null; state.editorMode = 'select'; commitTopology('계산에서 제외되는 주석 연결선을 추가했습니다.'); } catch (error) { showToast(error.message); }
    return;
  }
  if (target?.locked && !event.altKey) { showToast('잠긴 도형입니다. Alt/Option+클릭 후 인스펙터에서 잠금을 해제하세요.'); return; }
  selectElement('shape', shape.dataset.shapeId, event.shiftKey || event.metaKey || event.ctrlKey);
  renderTopology(); renderInspector(); openMobileInspector();
});
element('diagram-group-layer').addEventListener('click', (event) => {
  const group = event.target.closest('[data-diagram-group-id]');
  if (group) {
    selectDiagramGroup(group.dataset.diagramGroupId, event);
    return;
  }
});
element('link-layer').addEventListener('click', (event) => {
  const connector = event.target.closest('[data-connector-id]');
  if (connector) selectDiagramConnector(connector.dataset.connectorId, event);
});
element('diagram-group-layer').addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const group = event.target.closest('[data-diagram-group-id]');
  if (!group) return;
  event.preventDefault();
  selectDiagramGroup(group.dataset.diagramGroupId, event);
});
element('link-layer').addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const connector = event.target.closest('[data-connector-id]');
  if (!connector) return;
  event.preventDefault();
  selectDiagramConnector(connector.dataset.connectorId, event);
});
element('diagram-layer').addEventListener('dblclick', (event) => {
  const target = event.target.closest('[data-shape-id]'); if (!target) return;
  const shape = topology.diagram?.shapes?.find(({ id }) => id === target.dataset.shapeId); if (!shape) return;
  if (shape.locked) { showToast('잠긴 도형은 텍스트를 수정할 수 없습니다.'); return; }
  const text = window.prompt('도형 텍스트', shape.text || ''); if (text == null) return;
  topology = updateShape(topology, shape.id, { text }); commitTopology('도형 텍스트를 수정했습니다.');
});
element('diagram-layer').addEventListener('pointerdown', (event) => {
  const target = event.target.closest('[data-shape-id]'); if (!target || event.button !== 0) return;
  if (infrastructureBelowShape(event, target)) return;
  if (topology.diagram?.shapes?.find((item) => item.id === target.dataset.shapeId)?.locked) { showToast('잠긴 도형은 이동하거나 크기를 바꿀 수 없습니다.'); return; }
  const resize = event.target.closest('[data-shape-resize]');
  if (resize) {
    const shape = topology.diagram?.shapes?.find(({ id }) => id === target.dataset.shapeId);
    if (!shape) return;
    diagramDrag = { mode: 'resize', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initial: structuredClone(topology), shapeId: shape.id, direction: resize.dataset.shapeResize, target, lockRatio: Boolean(element('shape-lock-ratio')?.checked) };
    target.setPointerCapture(event.pointerId); event.preventDefault(); event.stopPropagation();
    return;
  }
  if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !state.selection.some((item) => item.type === 'shape' && item.id === target.dataset.shapeId)) selectElement('shape', target.dataset.shapeId);
  diagramDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initial: structuredClone(topology), selection: structuredClone(state.selection), target };
  target.setPointerCapture(event.pointerId); event.preventDefault();
});
element('diagram-layer').addEventListener('pointermove', (event) => {
  if (!diagramDrag || diagramDrag.pointerId !== event.pointerId) return;
  if (diagramDrag.mode === 'resize') {
    const original = diagramDrag.initial.diagram.shapes.find(({ id }) => id === diagramDrag.shapeId);
    if (!original) return;
    const dx = (event.clientX - diagramDrag.startX) / state.zoom; const dy = (event.clientY - diagramDrag.startY) / state.zoom;
    const direction = diagramDrag.direction;
    let x = original.x; let y = original.y; let width = original.width; let height = original.height;
    if (direction.includes('e')) width += dx;
    if (direction.includes('s')) height += dy;
    if (direction.includes('w')) { x += dx; width -= dx; }
    if (direction.includes('n')) { y += dy; height -= dy; }
    const ratio = original.width / original.height;
    if (diagramDrag.lockRatio) {
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      if (horizontal) height = width / ratio; else width = height * ratio;
      if (direction.includes('n')) y = original.y + original.height - height;
      if (direction.includes('w')) x = original.x + original.width - width;
    }
    const min = SHAPE_MIN_SIZE;
    width = Math.min(SHAPE_COORD_LIMIT, Math.max(min, width)); height = Math.min(SHAPE_COORD_LIMIT, Math.max(min, height));
    x = Math.max(-SHAPE_COORD_LIMIT, Math.min(SHAPE_COORD_LIMIT - width, x));
    y = Math.max(-SHAPE_COORD_LIMIT, Math.min(SHAPE_COORD_LIMIT - height, y));
    diagramDrag.preview = { x, y, width, height };
    diagramDrag.target.style.left = `${x - viewport.minX}px`; diagramDrag.target.style.top = `${y - viewport.minY}px`;
    diagramDrag.target.style.width = `${width}px`; diagramDrag.target.style.height = `${height}px`;
    return;
  }
  const dx = (event.clientX - diagramDrag.startX) / state.zoom; const dy = (event.clientY - diagramDrag.startY) / state.zoom;
  diagramDrag.target.style.transform = `translate(${dx}px, ${dy}px)`;
});
element('diagram-layer').addEventListener('pointerup', (event) => {
  if (!diagramDrag || diagramDrag.pointerId !== event.pointerId) return;
  const drag = diagramDrag; diagramDrag = null;
  if (drag.mode === 'resize') {
    if (!drag.preview) { renderTopology(); return; }
    try { topology = updateShape(drag.initial, drag.shapeId, drag.preview); commitTopology('선택한 도형의 크기를 저장했습니다.'); }
    catch (error) { showToast(error.message); renderTopology(); }
    return;
  }
  const dx = (event.clientX - drag.startX) / state.zoom; const dy = (event.clientY - drag.startY) / state.zoom;
  if (Math.hypot(dx, dy) < 3) { drag.target.style.transform = ''; return; }
  topology = moveSelection(drag.initial, drag.selection, dx, dy, { grid: 15 });
  commitTopology('선택한 도형을 이동했습니다.');
});
element('diagram-layer').addEventListener('pointercancel', () => { if (diagramDrag) { diagramDrag = null; renderTopology(); } });
// 선의 굴곡을 손으로 옮긴다. 가운데 손잡이를 끌면 마디가 새로 생기고, 네모 손잡이를 끌면
// 이미 찍힌 마디가 움직인다. 두 번 누르면 그 마디를 지워 자동 경로로 돌려준다.
element('link-layer').addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.link-handle');
  if (!handle || event.button !== 0) return;
  const { bendLink, bendIndex, bendKind } = handle.dataset;
  const link = topology.links.find(({ id }) => id === bendLink);
  if (!link) return;
  const start = canvasPoint(event);
  const index = Number(bendIndex);
  // 두 번 누르면 그 마디를 지운다. dblclick 을 쓰지 않는 것은 아래 preventDefault 가 호환
  // 마우스 이벤트를 막아 그 이벤트가 영영 오지 않기 때문이다 - 눌린 간격을 직접 잰다.
  const press = `${bendLink}:${bendIndex}:${bendKind}`;
  if (bendKind === 'move' && press === lastBendPress.key && event.timeStamp - lastBendPress.at < 400) {
    lastBendPress = { key: '', at: 0 };
    const left = (link.waypoints || []).filter((_, at) => at !== index);
    updateLink(topology, link.id, { waypoints: left });
    commitTopology(left.length ? '굴곡 하나를 지웠습니다.' : '선을 자동 경로로 되돌렸습니다.');
    return;
  }
  lastBendPress = { key: press, at: event.timeStamp };
  const points = (link.waypoints || []).map((point) => ({ ...point }));
  if (bendKind === 'insert') points.splice(index, 0, { ...start });
  bendDrag = { id: bendLink, index, points, start, moved: false, pointerId: event.pointerId };
  element('link-layer').setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
});
element('link-layer').addEventListener('pointermove', (event) => {
  if (!bendDrag || event.pointerId !== bendDrag.pointerId) return;
  const at = canvasPoint(event);
  if (Math.hypot(at.x - bendDrag.start.x, at.y - bendDrag.start.y) >= 3) bendDrag.moved = true;
  // 장비를 옮길 때와 같은 격자에 맞춘다. 눈금이 다르면 선과 장비가 미묘하게 어긋난다.
  bendDrag.points[bendDrag.index] = { x: Math.round(at.x / 15) * 15, y: Math.round(at.y / 15) * 15 };
  // 끄는 동안 선이 따라와야 어디에 놓을지 정할 수 있다. 잡은 포인터는 link-layer 가 쥐고 있어
  // 안쪽을 다시 그려도 끊기지 않는다 - 손잡이만 옮기면 선이 제자리에 남아 결과를 못 본다.
  renderTopology();
});
element('link-layer').addEventListener('pointerup', (event) => {
  if (!bendDrag || event.pointerId !== bendDrag.pointerId) return;
  const drag = bendDrag; bendDrag = null;
  // 움직이지 않았으면 바뀐 것이 없다. 여기서 다시 그리면 손잡이가 새 요소로 갈려 두 번째
  // 누름이 같은 자리로 이어지지 않는다.
  if (!drag.moved) return;
  try { updateLink(topology, drag.id, { waypoints: drag.points }); commitTopology('선의 굴곡을 옮겼습니다.'); }
  catch (error) { showToast(error.message); renderTopology(); }
});
element('link-layer').addEventListener('pointercancel', () => { bendDrag = null; renderTopology(); });
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
element('reset-button').addEventListener('click', () => { resetScenario(); showToast('장애와 배율을 초기화했습니다.'); });
element('baseline-reset').addEventListener('click', () => { resetScenario(); showToast('기준 상태로 돌아왔습니다.'); });
document.addEventListener('pointerdown', () => { if (teaserActive) cancelTeaser(); }, { passive: true });
document.addEventListener('keydown', () => { if (teaserActive) cancelTeaser(); }, { passive: true });
function closeTopMenus({ restoreFocus = false } = {}) {
  document.querySelectorAll('.top-menu-trigger[aria-expanded="true"]').forEach((trigger) => {
    trigger.setAttribute('aria-expanded', 'false');
    element(trigger.getAttribute('aria-controls')).hidden = true;
    if (restoreFocus) trigger.focus();
  });
}

function setTopMenu(trigger, open) {
  closeTopMenus();
  if (!open) return;
  const menu = element(trigger.getAttribute('aria-controls'));
  trigger.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  menu.querySelector('[role="menuitem"]')?.focus();
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('.top-menu-trigger');
  if (trigger) { setTopMenu(trigger, trigger.getAttribute('aria-expanded') !== 'true'); return; }
  const button = event.target.closest('[data-editor-action]');
  if (button) { closeTopMenus(); handleEditorAction(button.dataset.editorAction); return; }
  if (event.target.closest('[data-export-action="result"]')) { closeTopMenus(); exportResult(); return; }
  const reportAction = event.target.closest('[data-export-action^="report-"]')?.dataset.exportAction;
  if (reportAction) { closeTopMenus(); exportReport(reportAction.slice('report-'.length)); return; }
  if (!event.target.closest('.top-menu-wrap')) closeTopMenus();
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-comparison-demand]')) return;
  comparisonDemandId = event.target.value;
  renderComparison();
});

document.addEventListener('keydown', (event) => {
  const menu = event.target.closest('.top-menu');
  if (event.key === 'Escape') { closeTopMenus({ restoreFocus: true }); return; }
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const current = items.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length;
  event.preventDefault(); items[next]?.focus();
});
element('editor-close').addEventListener('click', closeEditorPanel);
element('editor-panel-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.editorForm === 'workload') {
      const mode = data.get('features_mode');
      const listed = [...data.getAll('features_chip'), ...String(data.get('features_enabled') || '').split(',')].map((item) => String(item).trim()).filter(Boolean);
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
    if (form.dataset.editorForm === 'capacity-fill') {
      const filled = [];
      for (const [field, value] of data.entries()) {
        if (!field.startsWith('kind:') || !value) continue;
        const [catalogId, profileId] = String(value).split('::');
        const entry = catalogEntry(catalogId); const profile = entry && catalogProfile(catalogId, profileId);
        if (!entry || !profile) continue;
        const applied = applySpecToKind(topology, field.slice(5), { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model });
        if (applied.length) filled.push(`${entry.vendor} ${entry.model} ${applied.length}대`);
      }
      closeEditorPanel();
      if (filled.length) commitTopology(`데이터시트 용량을 채웠습니다. ${filled.join(' · ')}`);
      else showToast('고른 모델이 없습니다.');
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
      topology.failureDomains = [...(topology.failureDomains || []), { id, name: String(data.get('name')), kind: String(data.get('kind')), deviceIds, linkIds }];
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
  if (event.target.name === 'features_chip' || event.target.name === 'features_enabled') event.target.form?.querySelector('[name="features_mode"][value="list"]')?.click();
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
  if (field) setLimitInput(field.form, axis, limit);
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
  const demandLink = event.target.closest('[data-demand-link]')?.dataset.demandLink;
  if (demandLink) { const link = topology.links.find(({ id }) => id === demandLink); if (link) openDemandForm(link.target, link.source); return; }
  const promote = event.target.closest('[data-promote-connector]')?.dataset.promoteConnector;
  if (promote) {
    try {
      const link = promoteConnector(topology, promote);
      state.selection = [{ type: 'link', id: link.id }]; state.selectedId = link.id;
      commitTopology('연결선을 트래픽 링크로 바꿨습니다. 용량을 채우세요.');
    } catch (error) { showToast(error.message); }
    return;
  }
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
  if (event.target.closest('[data-drawio-cancel]')) { drawioPreview = null; closeEditorPanel(); showToast('drawio 가져오기를 취소했습니다.'); return; }
  if (event.target.closest('[data-drawio-accept-high]') && drawioPreview) {
    const preview = createDrawioPreview(drawioPreview.document, drawioPreview.pageId, drawioPreview.decisions);
    for (const candidate of preview.candidates) {
      if (candidate.suggestion.confidence !== 'high') continue;
      if (candidate.suggestion.classification === 'zone') drawioPreview.decisions[candidate.id] = 'zone';
      else if (candidate.suggestion.classification === 'device' && candidate.suggestion.suggestedDeviceKind) drawioPreview.decisions[candidate.id] = { type: 'device', kind: candidate.suggestion.suggestedDeviceKind };
    }
    renderDrawioPreview(); return;
  }
  const drawioApply = event.target.closest('[data-drawio-apply], [data-drawio-append]');
  if (drawioApply && drawioPreview) {
    try {
      const preview = createDrawioPreview(drawioPreview.document, drawioPreview.pageId, drawioPreview.decisions);
      const append = drawioApply.hasAttribute('data-drawio-append');
      const imported = applyDrawioImport(append ? topology : buildTemplate('blank'), preview, drawioPreview.decisions);
      const message = `drawio 페이지를 ${append ? '현재 설계에 추가' : '새 구성도로 적용'}했습니다. 장비 ${imported.applied.devices}개 · 계산 링크 ${imported.applied.links}개 · 경고 ${imported.warnings.length}개`;
      drawioPreview = null; closeEditorPanel();
      if (append) {
        topology = imported.topology; state.selection = topology.devices.slice(-imported.applied.devices).map(({ id }) => ({ type: 'device', id })); commitTopology(message);
      } else {
        const previous = structuredClone(topology); const previousBaseline = structuredClone(baselineSnapshot);
        const restore = { scale: state.scale, devices: [...state.disabledDevices], links: [...state.disabledLinks], domains: [...state.disabledDomains], namedScenarios: structuredClone(state.namedScenarios), selectedId: state.selectedId };
        loadTopology(imported.topology, message, () => {
          topology = previous; state.scale = restore.scale; state.selectedId = restore.selectedId; state.disabledDevices = new Set(restore.devices); state.disabledLinks = new Set(restore.links); state.disabledDomains = new Set(restore.domains); state.namedScenarios = restore.namedScenarios;
          baselineSnapshot = previousBaseline; baseline = calculateScenario(previousBaseline.topology, previousBaseline.scenario); element('scale-input').value = String(restore.scale * 100); documentHistory.reset(topology); recalculate(); showToast('이전 설계로 되돌렸습니다.'); focusCanvas(current.summary.bindingResourceId);
        });
      }
    } catch (error) { showToast(`drawio 적용 실패: ${error.message}`); }
    return;
  }
  const verificationTab = event.target.closest('[data-verification-tab]')?.dataset.verificationTab;
  if (verificationTab) { state.verificationTab = verificationTab; openVerificationPanel(); element('editor-panel-content').querySelector(`[data-verification-tab="${verificationTab}"]`)?.focus(); return; }
  const suggestion = event.target.closest('[data-domain-suggestion]');
  if (suggestion) {
    const proposal = domainSuggestions().find(({ id }) => id === suggestion.dataset.domainSuggestion);
    if (!proposal) return;
    const id = normalizeId(proposal.name);
    if ((topology.failureDomains || []).some((domain) => domain.id === id)) { showToast('같은 이름의 장애 도메인이 이미 있습니다.'); return; }
    topology.failureDomains = [...(topology.failureDomains || []), { id, name: proposal.name, kind: proposal.kind, deviceIds: proposal.deviceIds, linkIds: [] }];
    commitTopology(`${proposal.name}의 장비 ${proposal.deviceIds.length}개를 장애 도메인으로 추가했습니다.`); openVerificationPanel(); return;
  }
  const workloadPreset = event.target.closest('[data-workload-preset]')?.dataset.workloadPreset;
  if (workloadPreset && workloadPreset !== 'custom') {
    const form = event.target.closest('form'); const preset = WORKLOAD_PRESETS[workloadPreset];
    for (const key of ['packet_size_bytes', 'cipher', 'test_method']) form.elements[key].value = preset[key] ?? '';
    form.querySelector(`[name="transport"][value="${preset.transport}"]`)?.click();
    form.querySelector('[name="features_mode"][value="list"]')?.click();
    for (const chip of form.querySelectorAll('[name="features_chip"]')) chip.checked = preset.features_enabled.includes(chip.value);
    form.elements.features_enabled.value = '';
    return;
  }
  const scope = event.target.closest('[data-swap-scope]')?.dataset.swapScope;
  if (scope && swapTarget) {
    openDeviceSwapPicker(swapTarget.id, { ...swapTarget, mode: scope });
    return;
  }
  const compare = event.target.closest('[data-swap-compare]');
  if (compare) { toggleSwapComparison(compare.dataset.swapCompare, compare.dataset.swapProfile); return; }
  if (event.target.closest('[data-swap-open-comparison]')) { openSwapComparison(); return; }
  if (event.target.closest('[data-swap-back-picker]') && swapTarget) { openDeviceSwapPicker(swapTarget.id, swapTarget); return; }
  const comparisonApply = event.target.closest('[data-swap-comparison-apply]');
  if (comparisonApply && swapTarget) {
    const entry = catalogEntry(comparisonApply.dataset.swapComparisonApply);
    const profile = entry && catalogProfile(entry.id, comparisonApply.dataset.swapProfile);
    if (entry && profile) previewDeviceSwap(swapTarget.id, entry, profile);
    return;
  }
  const choice = event.target.closest('[data-swap-catalog]');
  const detach = event.target.closest('[data-swap-detach]');
  if (choice || detach) {
    const id = state.selectedId;
    const name = resourceName(resourceById(id)) || id;
    try {
      if (detach) { applySpec(topology, id, null); closeEditorPanel(); commitTopology(`${name}의 데이터시트 값을 떼고 직접 입력으로 돌렸습니다.`); return; }
      const entry = catalogEntry(choice.dataset.swapCatalog);
      const profile = catalogProfile(entry.id, choice.dataset.swapProfile);
      previewDeviceSwap(id, entry, profile);
    } catch (error) { showToast(error.message); }
    return;
  }
  const conditionToggle = event.target.closest('[data-swap-conditions-toggle]');
  if (conditionToggle && swapPreview) {
    swapPreview.conditionsExpanded = !conditionToggle.closest('details')?.open;
    return;
  }
  const swapAcceptance = event.target.closest('[data-swap-evidence-accept]');
  if (swapAcceptance) {
    if (!swapPreview) return;
    const axis = swapAcceptance.dataset.swapEvidenceAccept;
    try {
      for (const id of swapPreview.memberIds) acceptEvidence(swapPreview.topology, id, axis);
      // 치환 장비가 이미 활성 상태일 때도 수락한 축이 현재 계산에 반영돼야 한다.
      if (swapPreview.active === 'candidate') {
        commitTopology(`${axisCatalog[axis]?.label || axis} 근거를 수락했습니다.`);
        renderSwapPreview();
      } else selectSwapVariant('candidate', `${axisCatalog[axis]?.label || axis} 근거를 수락하고 치환 장비를 활성화했습니다.`);
    } catch (error) { showToast(error.message); }
    return;
  }
  const swapVariant = event.target.closest('[data-swap-variant]')?.dataset.swapVariant;
  if (swapVariant) { selectSwapVariant(swapVariant, swapVariant === 'candidate' ? '치환 장비를 활성화했습니다.' : '현재 장비를 복원했습니다.'); return; }
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
element('editor-panel-content').addEventListener('change', (event) => {
  if (!drawioPreview) return;
  const page = event.target.closest('[data-drawio-page]');
  if (page) { drawioPreview.pageId = page.value; drawioPreview.decisions = {}; renderDrawioPreview(); return; }
  const decision = event.target.closest('[data-drawio-decision]');
  if (decision) {
    const candidate = createDrawioPreview(drawioPreview.document, drawioPreview.pageId, drawioPreview.decisions).candidates.find((item) => item.id === decision.dataset.drawioDecision);
    drawioPreview.decisions[decision.dataset.drawioDecision] = decision.value === 'device' ? { type: 'device', kind: candidate?.suggestion.suggestedDeviceKind || '' } : decision.value;
    renderDrawioPreview(); return;
  }
  const kind = event.target.closest('[data-drawio-kind]');
  if (kind) { drawioPreview.decisions[kind.dataset.drawioKind] = { type: 'device', kind: kind.value }; renderDrawioPreview(); }
});
element('inspector-content').addEventListener('change', (event) => {
  const lock = event.target.closest('[data-diagram-lock]');
  if (lock) {
    const form = lock.closest('[data-resource-form]');
    const id = form.dataset.resourceId;
    try {
      if (form.dataset.resourceForm === 'shape') topology = updateShape(topology, id, { locked: lock.checked });
      else if (form.dataset.resourceForm === 'connector') topology = updateConnector(topology, id, { locked: lock.checked });
      else topology = updateGroup(topology, id, { locked: lock.checked });
      const label = form.dataset.resourceForm === 'shape' ? '도형' : form.dataset.resourceForm === 'connector' ? '연결선' : '그룹';
      commitTopology(lock.checked ? `잠긴 ${label}입니다. Alt/Option+클릭 후 인스펙터에서 잠금을 해제하세요.` : `${label}의 잠금을 해제했습니다.`);
    } catch (error) { formError(form, error.message); }
    return;
  }
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
  if (event.target.closest('[data-open-swap]')) { openDeviceSwapPicker(state.selectedId); return; }
  const preset = event.target.closest('[data-limit-value]');
  if (preset) { setLimitInput(preset.closest('form'), preset.dataset.limitAxis, Number(preset.dataset.limitValue)); return; }
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
    if (form.dataset.resourceForm === 'shape') {
      const id = form.dataset.resourceId;
      const shape = topology.diagram?.shapes?.find(({ id: shapeId }) => shapeId === id);
      if (!shape) throw new Error('도형을 찾을 수 없습니다.');
      const value = (name, fallback = '') => data.has(name) ? data.get(name) : fallback;
      const values = {
        kind: value('kind', shape.kind), text: value('text', shape.text),
        x: Number(value('x', shape.x)), y: Number(value('y', shape.y)),
        width: Number(value('width', shape.width)), height: Number(value('height', shape.height)),
        fill: value('fill', shape.fill) || undefined, stroke: value('stroke', shape.stroke) || undefined,
        gradientColor: value('gradientColor', shape.gradientColor) || shape.gradientColor, lineStyle: value('lineStyle', shape.lineStyle || 'solid'),
        strokeWidth: Number(value('strokeWidth', shape.strokeWidth ?? 1)), opacity: Number(value('opacity', shape.opacity ?? 1)),
        textColor: value('textColor', shape.textColor) || undefined, fontSize: Number(value('fontSize', shape.fontSize ?? 11)),
        textAlign: value('textAlign', shape.textAlign || 'center'), verticalAlign: value('verticalAlign', shape.verticalAlign || 'middle'), fontWeight: value('fontWeight', shape.fontWeight || 'bold'),
        gradient: data.has('gradient') ? data.has('gradient') : shape.gradient,
        rounded: data.has('rounded') ? data.has('rounded') : shape.rounded,
        sketch: data.has('sketch') ? data.has('sketch') : shape.sketch,
        glass: data.has('glass') ? data.has('glass') : shape.glass,
        shadow: data.has('shadow') ? data.has('shadow') : shape.shadow,
      };
      if (![values.x, values.y, values.width, values.height, values.strokeWidth, values.opacity, values.fontSize].every(Number.isFinite)) throw new Error('도형 위치와 스타일 값은 숫자여야 합니다.');
      topology = updateShape(topology, id, values);
      commitTopology('도형 설정을 저장했습니다.');
      return;
    }
    if (form.dataset.resourceForm === 'group') {
      topology = updateGroup(topology, form.dataset.resourceId, { name: data.get('name') });
      commitTopology('그룹 설정을 저장했습니다.');
      return;
    }
    if (form.dataset.resourceForm === 'connector') {
      const connectorId = form.dataset.resourceId;
      const before = topology.diagram.connectors.find((item) => item.id === connectorId);
      for (const side of ['source', 'target']) {
        const picked = data.get(side);
        if (picked && picked !== before?.[side]) topology = retargetConnector(topology, connectorId, side, picked);
      }
      topology = updateConnector(topology, form.dataset.resourceId, {
        label: data.get('label'), kind: data.get('kind'), stroke: data.get('stroke'),
        strokeWidth: Number(data.get('strokeWidth')), dashed: data.has('dashed'),
        startArrow: data.get('startArrow'), endArrow: data.get('endArrow'),
      });
      commitTopology('연결선 설정을 저장했습니다.');
      return;
    }
    if (form.dataset.resourceForm === 'device') {
      const id = form.dataset.resourceId;
      const limits = Object.fromEntries([...data.entries()].filter(([key]) => axisCatalog[key]).map(([axis, raw]) => [axis, raw === '' ? '' : Number(raw) * Number(data.get(`${axis}__unit`) || 1)]));
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
function updateSelectedShape(form, patch, message) {
  try {
    topology = updateShape(topology, form.dataset.resourceId, patch);
    commitTopology(message);
  } catch (error) { formError(form, error.message); }
}

element('inspector-content').addEventListener('input', (event) => {
  if (!event.target.matches('input[name="opacity"]')) return;
  const output = event.target.closest('.shape-style-section')?.querySelector('[data-shape-opacity-output]');
  if (output) output.textContent = `${Math.round(Number(event.target.value) * 100)}%`;
});
element('inspector-content').addEventListener('change', (event) => {
  const nativeColor = event.target.closest('[data-shape-native-color]');
  if (nativeColor) {
    const form = nativeColor.closest('[data-resource-form="shape"]');
    updateSelectedShape(form, { [nativeColor.dataset.shapeNativeColor]: nativeColor.value }, '도형 색상을 변경했습니다.');
    return;
  }
  const styleField = event.target.closest('[data-shape-style-field]');
  if (styleField) {
    const form = styleField.closest('[data-resource-form="shape"]');
    updateSelectedShape(form, { [styleField.name]: styleField.name === 'strokeWidth' || styleField.name === 'opacity' ? Number(styleField.value) : styleField.value }, '도형 스타일을 변경했습니다.');
    return;
  }
  const effect = event.target.closest('[data-shape-effect]');
  if (effect) {
    const form = effect.closest('[data-resource-form="shape"]');
    updateSelectedShape(form, { [effect.name]: effect.checked }, '도형 효과를 변경했습니다.');
    return;
  }
  const select = event.target.closest('[data-resource-form="shape"] select[name="kind"]');
  const form = select?.closest('[data-resource-form="shape"]');
  if (!form) return;
  try {
    topology = updateShape(topology, form.dataset.resourceId, { kind: select.value });
    commitTopology('도형 종류를 변경했습니다.');
  } catch (error) { formError(form, error.message); }
});
element('inspector-content').addEventListener('click', (event) => {
  const colorToggle = event.target.closest('[data-shape-color-toggle]');
  if (colorToggle) {
    const palette = element(colorToggle.getAttribute('aria-controls'));
    const open = palette.hidden;
    palette.hidden = !open;
    colorToggle.setAttribute('aria-expanded', String(open));
    return;
  }
  const color = event.target.closest('[data-shape-color-value]');
  if (color) {
    const form = color.closest('[data-resource-form="shape"]');
    updateSelectedShape(form, { [color.dataset.shapeColorValue]: color.dataset.color }, '도형 색상을 변경했습니다.');
    return;
  }
  const eyedropper = event.target.closest('[data-shape-eyedropper]');
  if (eyedropper) {
    const native = eyedropper.parentElement.querySelector('[data-shape-native-color]');
    if (!window.EyeDropper) { native.click(); return; }
    new window.EyeDropper().open().then(({ sRGBHex }) => {
      const form = eyedropper.closest('[data-resource-form="shape"]');
      updateSelectedShape(form, { [eyedropper.dataset.shapeEyedropper]: sRGBHex }, '스포이드 색상을 적용했습니다.');
    }).catch(() => {});
    return;
  }
  const copyStyle = event.target.closest('[data-shape-style-copy]');
  if (copyStyle) {
    const id = copyStyle.closest('[data-resource-form="shape"]').dataset.resourceId;
    const shape = topology.diagram?.shapes?.find((item) => item.id === id);
    if (!shape) return;
    shapeStyleClipboard = Object.fromEntries(['fill', 'stroke', 'strokeWidth', 'opacity', 'textColor', 'fontSize', 'fontWeight', 'textAlign', 'verticalAlign', 'gradient', 'rounded', 'sketch', 'glass', 'shadow']
      .filter((key) => shape[key] != null).map((key) => [key, shape[key]]));
    renderInspector();
    showToast('도형 스타일을 복사했습니다.');
    return;
  }
  const pasteStyle = event.target.closest('[data-shape-style-paste]');
  if (pasteStyle && shapeStyleClipboard) {
    updateSelectedShape(pasteStyle.closest('[data-resource-form="shape"]'), shapeStyleClipboard, '복사한 도형 스타일을 적용했습니다.');
    return;
  }
  const tab = event.target.closest('[data-shape-inspector-tab]');
  if (tab) {
    shapeInspectorTab = tab.dataset.shapeInspectorTab;
    renderInspector();
    return;
  }
  const member = event.target.closest('[data-group-member-id]');
  if (member) {
    selectElement(member.dataset.groupMemberType, member.dataset.groupMemberId);
    renderTopology(); renderInspector();
    return;
  }
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
element('measured-limits-file-input').addEventListener('change', async (event) => {
  try {
    const text = await readFile(event.target); if (!text) return;
    const entries = importMeasuredLimits(text);
    const imported = applyMeasuredLimits(topology, entries);
    topology = imported.topology;
    const summarize = (entry) => ({ deviceId: entry.deviceId, axis: entry.axis, value: entry.value, unit: entry.unit, asOf: entry.asOf, saturationEvidence: entry.saturationEvidence });
    topology.measuredImport = { importedAt: new Date().toISOString(), applied: imported.applied.map(summarize), floors: imported.floors.map(summarize), unmatched: entries.filter((entry) => imported.unmatched.includes(entry.deviceId)).map(summarize) };
    commitTopology(`실측 한계 ${imported.applied.length}개 적용 · 관측 하한 ${imported.floors.length}개 보관${imported.unmatched.length ? ` · 미매칭 ${imported.unmatched.length}개` : ''}`);
  } catch (error) { showToast(`실측 한계 임포트 실패: ${error.message}`); }
});
element('observed-load-file-input').addEventListener('change', async (event) => {
  try {
    const text = await readFile(event.target); if (!text) return;
    const observed = importObservedLoad(text);
    const imported = applyObservedLoad(topology, observed);
    topology = imported.topology;
    const changed = Object.values(imported.comparison).reduce((count, values) => count + values.length, 0);
    commitTopology(`관측 부하 ${imported.applied.length}개 적용${imported.unmatched.length ? ` · 미매칭 ${imported.unmatched.length}개` : ''}${changed ? ' · 토폴로지 변경 감지' : ''}`);
  } catch (error) { showToast(`관측 부하 임포트 실패: ${error.message}`); }
});
element('zabbix-observed-load-file-input').addEventListener('change', async (event) => {
  try {
    const text = await readFile(event.target); if (!text) return;
    const observed = importZabbixObservedLoad(text);
    const imported = applyObservedLoad(topology, observed);
    topology = imported.topology;
    const changed = Object.values(imported.comparison).reduce((count, values) => count + values.length, 0);
    commitTopology(`Zabbix 관측 부하 ${imported.applied.length}개 적용${observed.unmapped.length ? ` · 미매핑 ${observed.unmapped.length}개` : ''}${imported.unmatched.length ? ` · 토폴로지 미매칭 ${imported.unmatched.length}개` : ''}${changed ? ' · 토폴로지 변경 감지' : ''}`);
  } catch (error) { showToast(`Zabbix 관측 부하 임포트 실패: ${error.message}`); }
});
element('drawio-file-input').addEventListener('change', async (event) => {
  try {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    await importDrawioFile(file);
  } catch (error) { showToast(`drawio 가져오기 실패: ${error.message}`); }
});
const drawioDropOverlay = element('drawio-drop-overlay');
const hasFileTransfer = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
function hideDrawioDropOverlay() { drawioDragDepth = 0; drawioDropOverlay.hidden = true; document.body.classList.remove('drawio-drag-active'); }
document.addEventListener('dragenter', (event) => {
  if (!hasFileTransfer(event)) return;
  event.preventDefault(); drawioDragDepth += 1; drawioDropOverlay.hidden = false; document.body.classList.add('drawio-drag-active');
});
document.addEventListener('dragover', (event) => { if (hasFileTransfer(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', (event) => { if (hasFileTransfer(event) && --drawioDragDepth <= 0) hideDrawioDropOverlay(); });
document.addEventListener('drop', async (event) => {
  if (!hasFileTransfer(event)) return;
  event.preventDefault(); const files = [...(event.dataTransfer?.files || [])]; hideDrawioDropOverlay();
  if (files.length !== 1) { showToast('drawio 파일을 한 번에 하나만 놓아 주세요.'); return; }
  try { await importDrawioFile(files[0]); } catch (error) { showToast(`drawio 가져오기 실패: ${error.message}`); }
});
const topologyScroll = document.querySelector('.topology-scroll');
// drawio 와 같은 손놀림으로 맞춘다. 빈 곳을 왼쪽으로 끌면 고르고, 오른쪽이나 가운데로 끌면
// 화면을 민다. 예전에는 왼쪽 드래그가 화면을 밀고 선택 상자는 Shift 뒤에 숨어 있어, 상자가
// 있다는 것을 알 방법이 없었다. Shift 를 함께 누르면 이미 고른 것에 더한다.
topologyScroll.addEventListener('pointerdown', (event) => {
  if (topologyView.mode === 'spatial') {
    if (event.button !== 0 || event.target.closest('.mesh-node, .link-hit, .link-handle, .diagram-shape, .diagram-group, .spatial-view-tools, .spatial-webgl')) return;
    spatialOrbitState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pitch: topologyView.pitch, yaw: topologyView.yaw };
    topologyScroll.setPointerCapture(event.pointerId);
    topologyScroll.classList.add('orbiting');
    event.preventDefault();
    return;
  }
  if (event.pointerType === 'touch') return;
  // 연결선도 자원이다. 빠져 있으면 선 위에서 누른 것이 마키 선택으로 잡히고, preventDefault 가
  // 뒤따르는 click 을 지워서 선을 영영 고를 수 없다.
  const onResource = event.target.closest('.mesh-node, .link-hit, .link-handle, .diagram-shape, .diagram-group, .diagram-connector-hit');
  const panButton = event.button === 1 || event.button === 2;
  if (!onResource && event.button === 0 && state.editorMode === 'select') {
    const start = canvasPoint(event);
    selectionBoxState = { pointerId: event.pointerId, start, end: start, additive: event.shiftKey || event.metaKey || event.ctrlKey };
    topologyScroll.setPointerCapture(event.pointerId); element('selection-marquee').hidden = false; event.preventDefault(); return;
  }
  // 자원 위에서 시작한 것은 팬이 아니다. 노드의 오른쪽 클릭 메뉴가 열려야 하고, 링크와 도형도
  // 저마다 할 일이 있다. 빈 곳에서 가운데나 오른쪽으로 시작한 것만 화면을 민다.
  if (onResource || state.editorMode === 'connect' || !panButton) return;
  panState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: topologyScroll.scrollLeft, top: topologyScroll.scrollTop };
  topologyScroll.setPointerCapture(event.pointerId);
  topologyScroll.classList.add('panning');
  event.preventDefault();
});
topologyScroll.addEventListener('pointermove', (event) => {
  if (spatialOrbitState && event.pointerId === spatialOrbitState.pointerId) {
    const yaw = spatialOrbitState.yaw + (event.clientX - spatialOrbitState.x) * 0.32;
    const pitch = spatialOrbitState.pitch - (event.clientY - spatialOrbitState.y) * 0.24;
    setSpatialView(pitch, yaw, { persist: false });
    return;
  }
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
  if (spatialOrbitState && event.pointerId === spatialOrbitState.pointerId) {
    spatialOrbitState = null;
    topologyScroll.classList.remove('orbiting');
    setSpatialView(topologyView.pitch, topologyView.yaw);
    return;
  }
  if (selectionBoxState && event.pointerId === selectionBoxState.pointerId) {
    const box = { left: Math.min(selectionBoxState.start.x, selectionBoxState.end.x), right: Math.max(selectionBoxState.start.x, selectionBoxState.end.x), top: Math.min(selectionBoxState.start.y, selectionBoxState.end.y), bottom: Math.max(selectionBoxState.start.y, selectionBoxState.end.y) };
    const boxed = [
      ...topology.devices.filter(({ position }) => position.x >= box.left && position.x <= box.right && position.y >= box.top && position.y <= box.bottom).map(({ id }) => ({ type: 'device', id })),
      ...(topology.diagram?.shapes || []).filter((shape) => shape.x < box.right && shape.x + shape.width > box.left && shape.y < box.bottom && shape.y + shape.height > box.top).map(({ id }) => ({ type: 'shape', id })),

      ...(() => {
        const at = new Map(topology.devices.map((device) => [device.id, device.position]));
        return topology.links.filter((link) => {
          const from = at.get(link.source); const to = at.get(link.target);
          return from && to && segmentHitsBox(from, to, box);
        }).map(({ id }) => ({ type: 'link', id }));
      })(),
    ];
    // Shift 를 함께 누르고 끌면 이미 고른 것에 더한다. 그러지 않으면 상자 안의 것으로 갈아 끼운다.
    const keyOf = (item) => `${item.type}:${item.id}`;
    if (selectionBoxState.additive) {
      const seen = new Set(state.selection.map(keyOf));
      state.selection = [...state.selection, ...boxed.filter((item) => !seen.has(keyOf(item)))];
    } else state.selection = boxed;
    // 상자로 하나만 고르면 인스펙터도 그것을 보여야 한다. 여럿이면 선택을 바꾸지 않는다 —
    // 어느 하나를 골라 띄우면 나머지를 고르지 않은 것처럼 읽힌다.
    const only = state.selection.length === 1 ? state.selection[0] : null;
    if (only && (only.type === 'device' || only.type === 'link')) state.selectedId = only.id;
    selectionBoxState = null; element('selection-marquee').hidden = true; renderTopology(); renderInspector(); renderEditorMode(); return;
  }
  endPan();
});
// 빈 곳의 오른쪽 버튼은 화면을 미는 손잡이다. macOS 는 누르는 순간 브라우저 메뉴를 여는데,
// 그러면 포인터 잡기가 풀리며 pointercancel 이 와서 밀기가 시작하자마자 죽는다. 그래서 움직인
// 뒤에 막는 것으로는 늦다 - 빈 곳에서는 누르는 순간부터 막는다. 자원 위 메뉴는 각자 열린다.
topologyScroll.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.mesh-node, .link-hit, .link-handle, .diagram-shape, .diagram-group')) return;
  event.preventDefault();
}, true);
topologyScroll.addEventListener('pointercancel', () => { spatialOrbitState = null; topologyScroll.classList.remove('orbiting'); selectionBoxState = null; element('selection-marquee').hidden = true; endPan(); });
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
  if (event.key === 'Escape' && state.editorMode === 'annotation') {
    event.preventDefault();
    annotationSource = null; state.editorMode = 'select'; renderTopology(); renderEditorMode(); showToast('주석선 연결을 취소했습니다.');
    return;
  }
  if (event.key === 'Escape' && !element('editor-panel').hidden) closeEditorPanel();
  if (event.target.closest('input, select, textarea')) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); historyStep(event.shiftKey ? 'redo' : 'undo'); }
  if (command && event.key.toLowerCase() === 'y') { event.preventDefault(); historyStep('redo'); }
  if (command && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
  if (command && event.key.toLowerCase() === 'c' && state.selection.length) {
    event.preventDefault();
    try { clipboard = copySelection(topology, state.selection); showToast(`${state.selection.length}개 요소를 복사했습니다.`); } catch (error) { showToast(error.message); }
  }
  if (command && event.key.toLowerCase() === 'v' && clipboard) {
    event.preventDefault();
    try {
      const pasted = pasteSelection(topology, clipboard); topology = pasted.topology; state.selection = pasted.selection;
      nameDuplicates(pasted.selection);
      state.selectedId = pasted.selection.find(({ type }) => type === 'device')?.id || state.selectedId; commitTopology('복사한 요소를 붙여넣었습니다.');
    } catch (error) { showToast(error.message); }
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection.length) {
    event.preventDefault();
    try {
      topology = removeDiagramElements(topology, state.selection);
      for (const item of state.selection) {
        if (item.type === 'link' && topology.links.some(({ id }) => id === item.id)) removeLink(topology, item.id);
        if (item.type === 'device' && topology.devices.some(({ id }) => id === item.id)) removeDevice(topology, item.id);
      }
      state.selection = []; state.selectedId = topology.devices[0]?.id || null; commitTopology('선택한 요소를 삭제했습니다.');
    } catch (error) { showToast(error.message); }
  }
});
document.addEventListener('pointerdown', (event) => {
  if (element('editor-panel').hidden) return;
  if (event.target.closest('#editor-panel') || event.target.closest('[data-editor-action]')) return;
  closeEditorPanel();
});

document.querySelector('.zoom-control').addEventListener('click', (event) => {
  const action = event.target.closest('[data-zoom]')?.dataset.zoom;
  if (topologyView.mode === 'spatial') {
    const scene = ensureSpatialScene();
    if (action === 'in') scene.zoom(.86);
    if (action === 'out') scene.zoom(1.16);
    if (action === 'reset' || action === 'fit') scene.reset();
    return;
  }
  if (action === 'in') stepZoom(1);
  if (action === 'out') stepZoom(-1);
  if (action === 'reset') setZoom(1);
  if (action === 'fit') zoomToFit();
});
element('topology-view-control').addEventListener('click', (event) => {
  const mode = event.target.closest('[data-topology-view]')?.dataset.topologyView;
  if (mode) setTopologyView(mode);
});
element('spatial-view-tools').addEventListener('click', (event) => {
  const action = event.target.closest('[data-spatial-orbit]')?.dataset.spatialOrbit;
  if (!action) return;
  ensureSpatialScene().then((scene) => {
    if (action === 'reset') scene.reset();
    if (action === 'left') scene.orbit(-18, 0);
    if (action === 'right') scene.orbit(18, 0);
    if (action === 'up') scene.orbit(0, 12);
    if (action === 'down') scene.orbit(0, -12);
  }).catch(() => {});
});
element('learning-panel').addEventListener('click', (event) => {
  const button = event.target.closest('[data-lesson-action]'); if (!button) return;
  if (['fault-device', 'fault-link', 'fault-domain', 'scale'].includes(button.dataset.lessonAction)) lessonRevealed = true;
  if (button.dataset.lessonAction === 'fault-device') { state.disabledDevices.add(button.dataset.lessonId); setLeftPanel('failure'); recalculate(); }
  if (button.dataset.lessonAction === 'scale') { state.scale = Number(button.dataset.lessonValue); element('scale-input').value = String(state.scale * 100); recalculate(); }
  if (button.dataset.lessonAction === 'workload') openWorkloadForm();
  if (button.dataset.lessonAction === 'select-device') { state.selectedId = button.dataset.lessonId; renderTopology(); renderInspector(); }
  if (button.dataset.lessonAction === 'fault-link') { state.disabledLinks.add(button.dataset.lessonId); setLeftPanel('failure'); recalculate(); }
  if (button.dataset.lessonAction === 'fault-domain') { state.disabledDomains.add(button.dataset.lessonId); setLeftPanel('failure'); recalculate(); }
});
// 트랙패드 핀치와 Ctrl+휠은 같은 이벤트로 온다. 포인터 자리를 기준으로 확대한다.
document.querySelector('.topology-panel').addEventListener('wheel', (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const rect = document.querySelector('.topology-scroll').getBoundingClientRect();
  // deltaMode 는 장치마다 다르다. 줄 단위로 오는 휠을 픽셀로 맞춘 뒤 배율에 반영한다.
  const delta = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_HEIGHT : event.deltaY;
  setZoom(state.zoom * Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY), { x: event.clientX - rect.left, y: event.clientY - rect.top });
}, { passive: false });
document.querySelector('a[href="#failure-heading"]').addEventListener('click', () => setLeftPanel('failure'));
element('summary-survival').addEventListener('click', () => {
  setLeftPanel('failure', { explicit: true });
  requestAnimationFrame(() => element('failure-list').scrollIntoView({ block: 'nearest' }));
});
document.querySelector('.failure-panel > .panel-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-panel-tab]');
  if (tab) setLeftPanel(tab.dataset.panelTab, { explicit: true });
});
document.querySelector('.failure-panel > .panel-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-panel-tab]')];
  const current = tabs.findIndex((tab) => tab.dataset.panelTab === state.leftPanel);
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? tabs.length - 1 : null;
  const next = step === null ? tabs[event.key === 'Home' ? 0 : tabs.length - 1] : tabs[(current + step) % tabs.length];
  event.preventDefault();
  setLeftPanel(next.dataset.panelTab, { explicit: true });
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
  paletteDrag = { kind: item.dataset.paletteKind, catalogId: item.dataset.paletteCatalog || null, profileId: item.dataset.paletteProfile || null, pointerId: event.pointerId, item, startX: event.clientX, startY: event.clientY, ghost: null };
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
  if (!drag.ghost) { createDeviceFromPalette(drag.kind, nextDevicePosition(), drag.catalogId, drag.profileId); return; }
  if (!point.inside) { showToast('캔버스 안에 놓아야 장비가 만들어집니다.'); return; }
  createDeviceFromPalette(drag.kind, point, drag.catalogId, drag.profileId);
});
element('component-palette').addEventListener('pointercancel', endPaletteDrag);
element('component-palette').addEventListener('dragstart', (event) => event.preventDefault());
element('component-palette').addEventListener('click', (event) => {
  const groupToggle = event.target.closest('[data-palette-group-toggle]');
  if (groupToggle) {
    const group = groupToggle.dataset.paletteGroupToggle;
    expandedPaletteGroups.has(group) ? expandedPaletteGroups.delete(group) : expandedPaletteGroups.add(group);
    const panel = element(groupToggle.getAttribute('aria-controls'));
    const open = expandedPaletteGroups.has(group);
    panel.hidden = !open;
    groupToggle.setAttribute('aria-expanded', String(open));
    return;
  }
  const expand = event.target.closest('[data-palette-expand]');
  if (expand) {
    const kind = expand.dataset.paletteExpand;
    expandedPaletteKind = expandedPaletteKind === kind ? null : kind;
    for (const trigger of document.querySelectorAll('[data-palette-expand]')) {
      const selected = trigger.dataset.paletteExpand === expandedPaletteKind;
      const panel = element(`palette-catalog-${trigger.dataset.paletteExpand}`);
      panel.hidden = !selected;
      trigger.setAttribute('aria-expanded', String(selected));
      const item = PALETTE.find(({ kind: paletteKind }) => paletteKind === trigger.dataset.paletteExpand);
      trigger.setAttribute('aria-label', `${item.label} 모델 ${selected ? '접기' : '펼치기'}`);
    }
    const panel = element(`palette-catalog-${kind}`);
    if (!panel.hidden) panel.querySelector('input')?.focus();
    return;
  }
  const action = event.target.closest('[data-editor-action]')?.dataset.editorAction;
  if (action) { event.stopPropagation(); handleEditorAction(action); return; }
  // 키보드로 누르면 pointer 시퀀스가 없으므로 클릭에서 같은 배치 동작을 제공한다.
  if (event.detail === 0) {
    const item = event.target.closest('[data-palette-kind]');
    if (item) createDeviceFromPalette(item.dataset.paletteKind, nextDevicePosition(), item.dataset.paletteCatalog || null, item.dataset.paletteProfile || null);
  }
});
element('component-palette').addEventListener('input', (event) => {
  const input = event.target.closest('[data-palette-search-input]');
  if (!input) return;
  const panel = input.closest('[data-palette-catalog-panel]');
  const needle = input.value.trim().toLowerCase();
  let shown = 0;
  for (const item of panel.querySelectorAll('[data-palette-search]')) {
    const match = !needle || item.dataset.paletteSearch.includes(needle);
    item.hidden = !match;
    if (match) shown += 1;
  }
  panel.querySelector('[data-palette-result-count]').textContent = needle ? `${shown}개 일치` : `${panel.querySelectorAll('[data-palette-search]').length}개`;
  panel.querySelector('.palette-empty').hidden = shown !== 0;
});
document.addEventListener('pointercancel', endPaletteDrag);
document.addEventListener('lostpointercapture', () => { if (paletteDrag) endPaletteDrag(); });
window.addEventListener('blur', () => { if (rackPaletteDrag) cancelRackPaletteDrag(); });

reducedMotion.addEventListener('change', () => { startTelemetry(); spatialScene?.setReducedMotion(reducedMotion.matches); rackScene?.setReducedMotion(reducedMotion.matches); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTelemetry(); });

element('icon-sprite').innerHTML = ICON_SPRITE + GLYPH_SPRITE;
element('topology-stage').style.setProperty('--zoom', String(state.zoom));
try {
  const saved = localStorage.getItem('rack-mesh-working-copy');
  if (saved) {
    const project = parseProject(saved);
    restoredWorkingCopy = true; topology = project.topology; state.scale = project.scenario.scale;
    state.disabledDevices = new Set(project.scenario.disabledDevices); state.disabledLinks = new Set(project.scenario.disabledLinks); state.disabledDomains = new Set(project.scenario.disabledDomains || []); state.namedScenarios = project.scenario.namedScenarios || [];
    state.selectedId = project.scenario.selectedId; state.viewMode = project.scenario.viewMode || 'edit';
    state.selection = state.selectedId ? [{ type: topology.links.some(({ id }) => id === state.selectedId) ? 'link' : 'device', id: state.selectedId }] : [];
    baselineSnapshot = project.scenario.baseline || { topology: structuredClone(topology), scenario: scenarioOptions(true) };
    baseline = calculateScenario(baselineSnapshot.topology, baselineSnapshot.scenario); current = calculateScenario(topology, scenarioOptions());
    documentHistory.reset(topology); element('scale-input').value = String(state.scale * 100);
  }
} catch { try { localStorage.removeItem('rack-mesh-working-copy'); } catch { /* 저장소 접근 자체가 막힌 환경 */ } }
renderPalette();
if (!panelSelectionExplicit) state.leftPanel = topology.devices.length || topology.links.length ? 'failure' : 'palette';
setLeftPanel(state.leftPanel);
render();
document.querySelector('.app-shell').dataset.workspace = state.workspace;
renderRackWorkspace();
centerOnContent();
startTelemetry();
startTeaser();
// 작업 사본이 커도 현재 시나리오를 먼저 보여 준다. 전수 분석은 첫 화면 뒤에 시작한다.
const initialAnalysisRun = analysisRun;
scheduleAnalysis(() => { if (analysisRun !== initialAnalysisRun) return; startAnalysis(); render(); });
