import { axisCatalog, behaviorCatalog, cloneTopology } from './data.js';
import { calculateScenario, compareScenarios, createExport, sweepSingleFaults } from './engine.js';
import { addDemand, addDevice, addLink, moveDevice, normalizeId, removeDemand, removeDevice, removeLink, updateDemand, updateDevice, updateLink } from './editor.js';
import { importDeviceDefinition } from './device-import.js';
import { parseProject, serializeProject } from './project.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS, ICON_SPRITE } from './icons.js';
import { vendorLogoFor } from './logos.js';
import { buildTemplate, templates } from './templates.js';

let topology = cloneTopology();
const state = { scale: 1, selectedId: 'fw-a', disabledDevices: new Set(), disabledLinks: new Set(), editorMode: 'select', connectSource: null, leftPanel: 'palette', zoom: 1 };
let baseline = calculateScenario(topology);
let current = baseline;
let sweep = sweepSingleFaults(topology);
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
  sweep = sweepSingleFaults(topology, { scale: state.scale });
  render();
  updateTelemetry();
}

function resetScenario({ refreshBaseline = false } = {}) {
  state.disabledDevices.clear(); state.disabledLinks.clear(); state.connectSource = null;
  if (!topology.devices.some(({ id }) => id === state.selectedId) && !topology.links.some(({ id }) => id === state.selectedId)) state.selectedId = topology.devices[0]?.id || null;
  if (refreshBaseline) baseline = calculateScenario(topology);
  recalculate();
}

function commitTopology(message, undo = null) {
  resetScenario({ refreshBaseline: true });
  showToast(message, undo);
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
  parts.push(redundancySentence());
  element('bottleneck-note').textContent = parts.filter(Boolean).join(' ');
}

function render() {
  renderSummary();
  renderFailures();
  renderTopology();
  renderInspector();
  renderComparison();
  renderBottleneck();
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
  ];
  element('failure-count').textContent = `${state.disabledDevices.size + state.disabledLinks.size} ACTIVE`;
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
        const detail = group.type === 'device' ? item.zone : formatCompact(item.capacity?.forwarding_bps, 'bps');
        return `<button class="failure-switch ${active ? 'active' : ''}" type="button" data-failure-type="${group.type}" data-failure-id="${escapeAttribute(item.id)}" aria-pressed="${active}">
          <span class="switch-glyph" aria-hidden="true"></span><span><strong>${escapeText(resourceName(item))}</strong><small>${escapeText(detail)}</small><small class="failure-forecast" data-verdict="${escapeAttribute(verdict?.verdict === 'severs' && verdict.endpoint ? 'endpoint' : verdict?.verdict || 'none')}">${escapeText(faultForecast(verdict))}</small></span><span class="switch-state">${active ? 'DOWN' : 'UP'}</span>
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
    <span class="palette-glyph"><svg aria-hidden="true" focusable="false"><use href="#${ICONS[item.kind].id}"></use></svg></span><span class="palette-label">${escapeText(item.label)}</span><span class="palette-kind">${item.kind.toUpperCase()}</span>
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
  const bounds = groupBoxes(devices).reduce((box, group) => ({
    minX: Math.min(box.minX, group.x), minY: Math.min(box.minY, group.y),
    maxX: Math.max(box.maxX, group.x + group.width), maxY: Math.max(box.maxY, group.y + group.height),
  }), devices.reduce((box, { position }) => ({
    minX: Math.min(box.minX, position.x - NODE_REACH.left), minY: Math.min(box.minY, position.y - NODE_REACH.top),
    maxX: Math.max(box.maxX, position.x + NODE_REACH.right), maxY: Math.max(box.maxY, position.y + NODE_REACH.bottom),
  }), { minX: 0, minY: 0, maxX: CANVAS_MIN.width, maxY: CANVAS_MIN.height }));
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
  }).join('');

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
    return `<button type="button" class="mesh-node ${status} ${state.selectedId === device.id ? 'selected' : ''} ${state.connectSource === device.id ? 'connect-source' : ''}" data-device-id="${escapeAttribute(device.id)}" style="left:${device.position.x - viewport.minX}px;top:${device.position.y - viewport.minY}px" aria-pressed="${state.selectedId === device.id}" aria-label="${escapeAttribute(nodeAccessibleName(device))}">
      <span class="node-symbol">${vendorBadge(device)}<svg class="node-glyph" aria-hidden="true" focusable="false"><use href="#${symbolId(device.kind)}"></use></svg></span><span class="node-rail"></span><span class="node-labels"><span class="node-name">${escapeText(device.name)}</span>${device.model ? `<span class="node-model">${escapeText(device.model)}</span>` : ''}<span class="node-axes">${axes}</span><span class="node-meta">${escapeText(meta)}</span></span>
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
    <div class="resource-identity"><strong>${escapeText(resource.name || resource.id.toUpperCase())}</strong><span>${escapeText(isDevice ? [[resource.vendor, resource.model].filter(Boolean).join(' '), resource.kind.toUpperCase(), resource.zone].filter(Boolean).join(' · ') : `${resource.source} → ${resource.target}`)}</span></div>
    <div class="binding-callout"><span>BINDING AXIS</span><strong><span>${axisCatalog[resource.bindingAxis]?.label || resource.bindingAxis || '알려진 축 없음'}</span><span data-live-util="${binding?.utilization ?? ''}" data-live-seed="${resource.id}-binding">${binding ? formatPercent(binding.utilization) : '—'}</span></strong></div>
    <div class="axis-list">${Object.entries(resource.axes).map(([axis, result]) => renderAxis(axis, result, resource.id)).join('')}</div>
    ${isDevice ? renderBehavior(resource) : ''}
    <div class="source-note"><strong>${escapeText(source.label)}</strong><br>${escapeText(source.condition)}<br>실제 설계에는 동일 조건의 측정값을 사용하세요.</div>
    ${isDevice ? renderDeviceEditor(resource) : renderLinkEditor(resource)}`;
}

function scenarioOptions() {
  return { scale: state.scale, disabledDevices: [...state.disabledDevices], disabledLinks: [...state.disabledLinks] };
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

function renderDeviceEditor(resource) {
  const fields = Object.keys(resource.limits);
  return `<form class="inspector-editor" data-resource-form="device" data-resource-id="${resource.id}">
    <h3>장비 한계 편집</h3>
    <label>이름<input name="name" maxlength="80" required value="${escapeAttribute(resource.name)}"></label>
    <label>영역<input name="zone" maxlength="80" required value="${escapeAttribute(resource.zone)}" placeholder="FABRIC / RACK 04"></label>
    <label>제조사<input name="vendor" maxlength="24" value="${escapeAttribute(resource.vendor || '')}" placeholder="약칭"></label>
    <label>모델<input name="model" maxlength="40" value="${escapeAttribute(resource.model || '')}"></label>
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
  state.disabledDevices.clear(); state.disabledLinks.clear();
  element('scale-input').value = '100';
  closeEditorPanel();
  commitTopology(message, undo);
  centerCanvas();
}

function applyTemplate(id) {
  const chosen = templates.find((item) => item.id === id);
  if (!chosen) return;
  const previous = structuredClone(topology);
  const restore = { scale: state.scale, devices: [...state.disabledDevices], links: [...state.disabledLinks], selectedId: state.selectedId };
  loadTopology(buildTemplate(id), `${chosen.name}을 불러왔습니다.`, () => {
    topology = previous;
    state.scale = restore.scale; state.selectedId = restore.selectedId;
    state.disabledDevices = new Set(restore.devices); state.disabledLinks = new Set(restore.links);
    element('scale-input').value = String(restore.scale * 100);
    commitTopology('이전 설계로 되돌렸습니다.');
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
  if (action === 'new') openTemplatePicker();
}

function toggleFailure(type, id) {
  const set = type === 'device' ? state.disabledDevices : state.disabledLinks;
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
  const position = { x: dragState.origin.x + (event.clientX - dragState.startX) / state.zoom, y: dragState.origin.y + (event.clientY - dragState.startY) / state.zoom };
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
element('editor-panel-content').addEventListener('input', (event) => {
  if (event.target.id === 'template-search') filterTemplates(event.target.value);
});
element('editor-panel-content').addEventListener('click', (event) => {
  const template = event.target.closest('[data-template]');
  if (template) { applyTemplate(template.dataset.template); return; }
  if (event.target.closest('[data-new-demand]')) { openDemandForm(); return; }
  const button = event.target.closest('[data-delete-demand]'); if (!button) return;
  const demand = topology.demands.find(({ id }) => id === button.dataset.deleteDemand);
  if (!window.confirm(`${demand?.name || button.dataset.deleteDemand} demand와 해당 부하 정의를 삭제합니다. 계속하시겠습니까?`)) return;
  try { removeDemand(topology, button.dataset.deleteDemand); commitTopology('Traffic demand를 삭제했습니다.'); openDemandManager(); } catch (error) { showToast(error.message); }
});
element('inspector-content').addEventListener('change', (event) => {
  if (event.target.name !== 'behavior-mode') return;
  try {
    const device = updateDevice(topology, state.selectedId, { behavior: { ...deviceById(state.selectedId)?.behavior, mode: event.target.value } });
    commitTopology(`${device.name}을 ${behaviorCatalog[device.kind].options[event.target.value].label}로 바꿨습니다.`);
  } catch (error) { showToast(error.message); }
});
element('inspector-content').addEventListener('submit', (event) => {
  event.preventDefault(); const form = event.target; const data = new FormData(form);
  try {
    if (form.dataset.resourceForm === 'device') { const limits = Object.fromEntries([...data.entries()].filter(([key]) => axisCatalog[key])); updateDevice(topology, form.dataset.resourceId, { name: data.get('name'), zone: data.get('zone'), vendor: data.get('vendor'), model: data.get('model'), limits }); }
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
    topology = project.topology; state.scale = project.scenario.scale; state.disabledDevices = new Set(project.scenario.disabledDevices); state.disabledLinks = new Set(project.scenario.disabledLinks); state.selectedId = project.scenario.selectedId; element('scale-input').value = String(state.scale * 100); baseline = calculateScenario(topology); closeEditorPanel(); recalculate(); showToast(project.notices?.[0]?.message || '프로젝트를 검증하고 복원했습니다.');
  } catch (error) { showToast(`열기 실패: ${error.message}`); }
});
element('device-file-input').addEventListener('change', async (event) => {
  try { const text = await readFile(event.target); if (!text) return; const template = importDeviceDefinition(text); openDeviceForm(template); const form = element('editor-panel-content').querySelector('form'); form._deviceTemplate = template; showToast(`${template.schema} 장비 정의를 읽었습니다.`); } catch (error) { showToast(`가져오기 실패: ${error.message}`); }
});
const topologyScroll = document.querySelector('.topology-scroll');
topologyScroll.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch') return;
  const onResource = event.target.closest('.mesh-node, .link-hit');
  const middleButton = event.button === 1;
  if (!middleButton && (event.button !== 0 || onResource || state.editorMode === 'connect')) return;
  panState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: topologyScroll.scrollLeft, top: topologyScroll.scrollTop };
  topologyScroll.setPointerCapture(event.pointerId);
  topologyScroll.classList.add('panning');
  event.preventDefault();
});
topologyScroll.addEventListener('pointermove', (event) => {
  if (!panState || event.pointerId !== panState.pointerId) return;
  topologyScroll.scrollLeft = panState.left - (event.clientX - panState.startX);
  topologyScroll.scrollTop = panState.top - (event.clientY - panState.startY);
});
topologyScroll.addEventListener('pointerup', endPan);
topologyScroll.addEventListener('pointercancel', endPan);
topologyScroll.addEventListener('lostpointercapture', endPan);

element('toast').addEventListener('click', (event) => {
  if (!event.target.closest('[data-toast-undo]')) return;
  const undo = toastUndo;
  toastUndo = null;
  element('toast').classList.remove('visible');
  undo?.();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !element('editor-panel').hidden) closeEditorPanel();
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
    paletteDrag.ghost.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#${ICONS[paletteDrag.kind].id}"></use></svg>`;
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

element('icon-sprite').innerHTML = ICON_SPRITE;
element('topology-stage').style.setProperty('--zoom', String(state.zoom));
renderPalette();
setLeftPanel(state.leftPanel);
render();
centerCanvas();
startTelemetry();
