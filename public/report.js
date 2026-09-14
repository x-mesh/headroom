import { axisCatalog } from './data.js';
import { calculateScenario } from './engine.js';
import { buildObservedLoadValidationReport, OBSERVED_LOAD_STALE_AFTER_DAYS, observedLoadIsStale } from './measured-import.js';
import { formatCount, formatNumber, formatPercent, getLocale, t } from './i18n.js';

const STATUS = Object.freeze({ healthy: 'healthy', warning: 'warning', overloaded: 'overloaded', unknown: 'unknown', invalid: 'invalid' });
const EVALUATION = Object.freeze({ pass: 'pass', fail: 'fail', unknown: 'passPending', invalid: 'invalid', 'not-ready': 'notReady' });
const SOURCE = Object.freeze({ datasheet: 'datasheet', third_party_test: 'thirdPartyTest', user_measured: 'measured', estimate: 'estimate', 'user-correction': 'userCorrection' });
const SERVICE_STATUS = Object.freeze({ pass: 'pass', fail: 'fail', unknown: 'unknown', invalid: 'invalid' });
const SERVICE_RANK = Object.freeze({ pass: 0, unknown: 1, fail: 2, invalid: 3 });
const FAILURE_VERDICT = Object.freeze({ severs: 'severs', overloads: 'overloads', absorbs: 'absorbs', unknown: 'unknown' });
const SURVIVAL_STATUS = Object.freeze({ survives: 'survives', severed: 'severed', 'capacity-insufficient': 'capacity-insufficient', unavailable: 'unavailable', calculating: 'calculating' });
const RACK_STATUS = Object.freeze({ pass: 'pass', fail: 'fail', unknown: 'unknown' });
const RACK_BASIS = Object.freeze({ nameplate: 'nameplate', typical: 'typical', measured: 'measured' });

function number(value, unit) {
  if (!Number.isFinite(value)) return t('common.unknown');
  if (unit === 'bps') return value >= 1e9 ? (value / 1e9).toFixed(value >= 10e9 ? 0 : 1) + ' Gbps' : (value / 1e6).toFixed(0) + ' Mbps';
  if (unit === 'pps') return value >= 1e6 ? (value / 1e6).toFixed(2) + ' Mpps' : (value / 1e3).toFixed(0) + ' Kpps';
  if (unit === 'cps') return (value / 1e3).toFixed(0) + ' Kcps';
  if (unit === 'sessions') return (value / 1e3).toFixed(0) + ' K';
  return formatNumber(value, { maximumFractionDigits: 1 });
}

function percent(value, signed = false) {
  if (!Number.isFinite(value)) return t('common.unknown');
  return (signed && value > 0 ? '+' : '') + formatPercent(value, { maximumFractionDigits: 0 });
}

function itemCount(value) { return t('common.items', { count: formatCount(value) }); }

function sourceFor(resource, axis) {
  const record = (resource.spec?.records || resource.metadata?.records || []).find((item) => item.axis === axis);
  const type = record?.source?.type || resource.source?.type || null;
  return { type, label: t('report.' + (SOURCE[type] || 'unknown')) || type || t('common.unknown'), conditions: record?.conditions ?? null };
}

function axes(resources) {
  return resources.flatMap((resource) => Object.entries(resource.axes || {}).map(([axis, result]) => {
    const status = result.status || 'unknown';
    return { resourceId: resource.id, resourceName: resource.name || resource.id, axis, axisLabel: axisCatalog[axis]?.label || axis,
      status, statusLabel: t('status.' + STATUS[status]) || status, load: number(result.load, axisCatalog[axis]?.unit), limit: number(result.limit, axisCatalog[axis]?.unit),
      source: sourceFor(resource, axis), applicability: result.evidenceApplicability || null, reason: result.unknownReason || null,
      utilization: result.utilization == null ? null : Math.round(result.utilization * 100) + '%' };
  }));
}

function resourceLabel(scenario, id, axis = null) {
  const resource = [...scenario.devices, ...scenario.links].find((item) => item.id === id);
  const name = resource?.name || id;
  return axis ? name + ' · ' + (axisCatalog[axis]?.label || axis) : name;
}

function serviceCause(scenario, service) {
  const demands = (service.demandIds || []).map((id) => scenario.demands.find((demand) => demand.id === id)).filter(Boolean);
  if (demands.some((demand) => demand.status === 'unreachable')) return t('report.pathSevered');
  const admission = demands.find((demand) => demand.sessionAdmission?.limitedBy);
  if (admission) return resourceLabel(scenario, admission.sessionAdmission.limitedBy.resourceId, 'new_sessions_per_sec');
  const choke = demands.flatMap((demand) => demand.paths || []).find((path) => path.choke);
  if (choke) return resourceLabel(scenario, choke.choke.resourceId);
  if (scenario.summary.bindingResourceId) return resourceLabel(scenario, scenario.summary.bindingResourceId, scenario.summary.bindingAxis);
  return t('report.noBottleneck');
}

function baselineChange(status, baselineStatus) {
  if (!baselineStatus) return t('report.notInBaseline');
  if (status === baselineStatus) return t('report.same');
  return SERVICE_RANK[status] > SERVICE_RANK[baselineStatus] ? t('report.worsened') : t('report.improved');
}

export function buildServiceVerdicts(topology, scenario, baseline) {
  const baselineById = new Map((baseline.services || []).map((service) => [service.id, service]));
  return (scenario.services || []).map((service) => {
    const baselineService = baselineById.get(service.id);
    return { id: service.id, name: service.name || service.id, status: service.status, statusLabel: t('report.' + SERVICE_STATUS[service.status]) || service.status,
      cause: serviceCause(scenario, service), baselineStatus: baselineService?.status || null,
      baselineChange: baselineChange(service.status, baselineService?.status) };
  });
}

export function buildNamedScenarioServiceVerdicts(topology, baseline, namedScenarios = []) {
  return namedScenarios.map((entry) => {
    const scenario = calculateScenario(topology, entry.scenario || entry);
    return { id: entry.id, name: entry.name || entry.id, options: entry.scenario || entry,
      evaluationStatus: scenario.summary.evaluationStatus, services: buildServiceVerdicts(topology, scenario, baseline) };
  });
}

function reportResilience(topology, analysis = {}) {
  const survival = analysis.survivalMultiplier;
  const domainSweep = analysis.domainSweep;
  const resourceName = (id) => {
    const resource = [...(topology.devices || []), ...(topology.links || [])].find((item) => item.id === id);
    if (resource?.name) return resource.name;
    if (resource?.source && resource?.target) {
      const endpoint = (endpointId) => topology.devices?.find(({ id: deviceId }) => deviceId === endpointId)?.name || endpointId;
      return `${endpoint(resource.source)} → ${endpoint(resource.target)}`;
    }
    return id;
  };
  return {
    survivalMultiplier: survival ? {
      scope: t('report.singleResource'), status: survival.status, statusLabel: t('status.' + SURVIVAL_STATUS[survival.status]) || survival.status,
      multiplier: survival.multiplier, bounded: Boolean(survival.bounded), worstFault: survival.worstFault ? { ...survival.worstFault, name: resourceName(survival.worstFault.id) } : null,
      evaluated: survival.evaluated, candidates: survival.candidates, endpointCount: survival.endpointIds?.length || 0,
      unresolvedCount: survival.unresolvedCount || 0,
    } : null,
    domainSweep: domainSweep ? {
      domainCount: domainSweep.domainCount, evaluated: domainSweep.evaluated,
      singles: domainSweep.singles.map((item) => ({ id: item.id, name: item.name, kind: item.kind, verdict: item.verdict,
        verdictLabel: t('status.' + FAILURE_VERDICT[item.verdict]) || item.verdict, bounded: Boolean(item.bounded), minDeliveredRatio: item.minDeliveredRatio })),
      pairs: domainSweep.pairs.map((item) => ({ id: item.id, name: item.name, verdict: item.verdict,
        verdictLabel: t('status.' + FAILURE_VERDICT[item.verdict]) || item.verdict, bounded: Boolean(item.bounded), minDeliveredRatio: item.minDeliveredRatio })),
      redundancyInvalid: domainSweep.redundancyInvalid.map((item) => ({ id: item.id, name: item.name, kind: item.kind,
        reason: item.reason || 'severs', deliveryDrop: item.deliveryDrop ?? null })),
    } : null,
  };
}

function reportRacks(topology, scenario) {
  const threshold = topology.warningThreshold ?? .8;
  return (scenario.racks || []).map((rack) => {
    const powerKnown = rack.powerWatts != null && rack.powerRatio != null;
    const spaceKnown = rack.usedU != null && rack.spaceRatio != null;
    return {
      id: rack.id, name: rack.name || rack.id, status: rack.status, statusLabel: t('report.' + RACK_STATUS[rack.status]) || rack.status,
      basisLabel: t('report.' + RACK_BASIS[rack.powerBasis]) || rack.powerBasis,
      power: powerKnown ? formatNumber(Math.round(rack.powerWatts)) + ' / ' + formatNumber(rack.powerBudgetWatts) + ' W · ' + percent(rack.powerRatio) : t('common.unknown'),
      space: spaceKnown ? formatNumber(rack.usedU) + ' / ' + formatNumber(rack.capacityU) + 'U · ' + percent(rack.spaceRatio) : t('common.unknown'),
      // 미확인은 여유가 아니다. 무엇이 비어서 합계를 못 내는지 이름으로 남긴다.
      note: rack.unknownPower?.length ? t('report.powerUnknown', { names: rack.unknownPower.join(', ') })
        : powerKnown && rack.powerRatio >= threshold && rack.status !== 'fail' ? t('reportExtra.warningThreshold', { percent: percent(threshold) }) : '',
    };
  });
}

export function buildReportModel(topology, scenario, baseline, namedScenarios = [], options = {}, analysis = {}) {
  const summary = scenario.summary;
  const evaluation = t('report.' + (EVALUATION[summary.evaluationStatus] || summary.evaluationStatus));
  const constraints = axes([...scenario.devices, ...scenario.links]);
  const unknown = constraints.filter(({ status }) => status === 'unknown');
  const binding = summary.bindingResourceId ? constraints.find(({ resourceId, axis }) => resourceId === summary.bindingResourceId && axis === summary.bindingAxis) : null;
  const firstLine = unknown.length ? t('report.unknownAxis', { count: unknown.length }) : evaluation + (getLocale() === 'ko' ? '입니다.' : '.') + (binding ? ' ' + (getLocale() === 'ko' ? '현재 병목은 ' : 'Current bottleneck: ') + binding.resourceName + ' · ' + binding.axisLabel : '');
  return { schemaVersion: 1, product: t('report.reportProduct'), evaluation, firstLine,
    scenario: { scale: scenario.scale, activeFaults: summary.activeFaults, evaluationStatus: summary.evaluationStatus, unknownCount: summary.unknownCount,
      observedLoad: topology.observedLoad ? { asOf: topology.observedLoad.asOf, aggregate: topology.observedLoad.aggregate, ...(topology.observedLoad.source ? { source: topology.observedLoad.source } : {}), stale: observedLoadIsStale(topology.observedLoad), staleAfterDays: OBSERVED_LOAD_STALE_AFTER_DAYS } : null },
    comparison: { bindingChanged: baseline.summary.bindingResourceId !== summary.bindingResourceId || baseline.summary.bindingAxis !== summary.bindingAxis,
      minHeadroomDelta: scenario.summary.minHeadroom == null || baseline.summary.minHeadroom == null ? null : Math.round((scenario.summary.minHeadroom - baseline.summary.minHeadroom) * 100) + '%p',
      unreachableDelta: summary.unreachableCount - baseline.summary.unreachableCount, overloadedDelta: summary.overloadedCount - baseline.summary.overloadedCount },
    services: buildServiceVerdicts(topology, scenario, baseline),
    namedScenarios: buildNamedScenarioServiceVerdicts(topology, baseline, namedScenarios),
    observedLoadValidation: buildObservedLoadValidationReport(topology, options), resilience: reportResilience(topology, analysis), racks: reportRacks(topology, scenario), binding, constraints };
}

function escape(value) { return String(value).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }

function observedValidationLabel(group) {
  return ({ matched: t('reportExtra.conditionMatched'), mismatched: t('reportExtra.conditionMismatched'), unrecorded: t('reportExtra.conditionUnrecorded') })[group] || t('common.unknown');
}

function observedValidationMarkdown(validation) {
  if (!validation.available) return '';
  const rows = validation.axes.map((axis) => '| ' + (axisCatalog[axis.axis]?.label || axis.axis) + ' | ' + axis.sampleCount + ' | ' + percent(axis.mape) + ' | ' + percent(axis.maxAbsolutePercentageError) + ' | ' + percent(axis.meanSignedPercentageError, true) + ' | ' + t('reportExtra.underExactOver', { under: axis.signedError.underModelled, exact: axis.signedError.exact, over: axis.signedError.overModelled }) + ' |').join('\n');
  const table = rows ? '| ' + [t('report.axis'), t('report.sampleCount'), 'MAPE', t('reportExtra.maxError'), t('reportExtra.meanSignedError'), t('reportExtra.distribution')].join(' | ') + ' |\n| --- | ---: | ---: | ---: | ---: | --- |\n' + rows + '\n' : t('report.noComparableAxes') + '\n';
  return '\n## ' + t('report.observedValidation') + '\n\n- ' + t('report.conditionGroup') + ': ' + observedValidationLabel(validation.conditionGroup) + '\n- ' + t('report.sampleCount') + ': ' + validation.sampleCount + '\n\n' + table;
}

function observedValidationHtml(validation) {
  if (!validation.available) return '';
  const rows = validation.axes.map((axis) => '<tr><td>' + escape(axisCatalog[axis.axis]?.label || axis.axis) + '</td><td>' + axis.sampleCount + '</td><td>' + percent(axis.mape) + '</td><td>' + percent(axis.maxAbsolutePercentageError) + '</td><td>' + percent(axis.meanSignedPercentageError, true) + '</td><td>' + escape(t('reportExtra.underExactOver', { under: axis.signedError.underModelled, exact: axis.signedError.exact, over: axis.signedError.overModelled })) + '</td></tr>').join('');
  const table = rows ? '<table><thead><tr>' + [t('report.axis'), t('report.sampleCount'), 'MAPE', t('reportExtra.maxError'), t('reportExtra.meanSignedError'), t('reportExtra.distribution')].map((value) => '<th>' + escape(value) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' : '<p>' + t('report.noComparableAxes') + '</p>';
  return '<h2>' + t('report.observedValidation') + '</h2><p>' + t('report.conditionGroup') + ': ' + escape(observedValidationLabel(validation.conditionGroup)) + ' · ' + t('report.sampleCount') + ': ' + validation.sampleCount + '</p>' + table;
}

function resilienceMarkdown(resilience) {
  const survival = resilience.survivalMultiplier;
  const domains = resilience.domainSweep;
  const survivalSection = survival ? '\n## ' + t('reportExtra.survival') + '\n\n- ' + t('reportExtra.range') + ': ' + survival.scope + '\n- ' + t('reportExtra.result') + ': ' + survival.statusLabel + (survival.multiplier == null ? '' : survival.multiplier === 0 ? ' · ' + t('reportExtra.noService') : ' · ' + formatNumber(survival.multiplier, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×' + (survival.bounded ? ' · ' + t('reportExtra.bounded') : '')) + '\n- ' + t('reportExtra.worstFault') + ': ' + (survival.worstFault?.name || survival.worstFault?.id || t('reportExtra.noWorstFault')) + '\n- ' + t('reportExtra.checks') + ': ' + formatCount(survival.evaluated) + '/' + formatCount(survival.candidates) + (survival.unresolvedCount ? ' · ' + t('reportExtra.unknown', { count: formatCount(survival.unresolvedCount) }) : '') + '\n' : '';
  if (!domains) return survivalSection;
  const rows = (items) => items.length ? items.map((item) => '| ' + item.name + ' | ' + item.verdictLabel + (item.bounded ? ' · ' + t('reportExtra.bounded') : '') + ' | ' + percent(item.minDeliveredRatio) + ' |').join('\n') + '\n' : '| ' + t('reportExtra.noItems') + ' | — | — |\n';
  const invalid = domains.redundancyInvalid.length ? '\n- ' + t('reportExtra.redundancyInvalid') + ': ' + domains.redundancyInvalid.map(({ name, reason, deliveryDrop }) => name + (reason === 'delivery-drop' ? ' (' + t('reportExtra.deliveryDrop') + ' ' + percent(deliveryDrop) + 'p)' : ' (' + t('reportExtra.serviceSevered') + ')')).join(', ') + '\n' : '';
  return survivalSection + '\n## ' + t('reportExtra.domainSweep') + '\n\n- ' + t('reportExtra.domains') + ': ' + formatCount(domains.domainCount) + ' · ' + t('reportExtra.evaluated') + ': ' + formatCount(domains.evaluated) + invalid + '\n### ' + t('reportExtra.domainN1') + '\n\n| ' + t('reportExtra.domain') + ' | ' + t('reportExtra.verdict') + ' | ' + t('reportExtra.minimumDelivered') + ' |\n| --- | --- | ---: |\n' + rows(domains.singles) + '\n### ' + t('reportExtra.domainN2') + '\n\n| ' + t('reportExtra.domainPair') + ' | ' + t('reportExtra.verdict') + ' | ' + t('reportExtra.minimumDelivered') + ' |\n| --- | --- | ---: |\n' + rows(domains.pairs);
}

function resilienceHtml(resilience) {
  const survival = resilience.survivalMultiplier;
  const domains = resilience.domainSweep;
  const survivalSection = survival ? '<h2>' + t('reportExtra.survival') + '</h2><dl><dt>' + t('reportExtra.range') + '</dt><dd>' + escape(survival.scope) + '</dd><dt>' + t('reportExtra.result') + '</dt><dd>' + escape(survival.statusLabel) + (survival.multiplier == null ? '' : survival.multiplier === 0 ? ' · ' + t('reportExtra.noService') : ' · ' + escape(formatNumber(survival.multiplier, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '×' + (survival.bounded ? ' · ' + t('reportExtra.bounded') : '')) + '</dd><dt>' + t('reportExtra.worstFault') + '</dt><dd>' + escape(survival.worstFault?.name || survival.worstFault?.id || t('reportExtra.noWorstFault')) + '</dd><dt>' + t('reportExtra.checks') + '</dt><dd>' + formatCount(survival.evaluated) + '/' + formatCount(survival.candidates) + (survival.unresolvedCount ? ' · ' + escape(t('reportExtra.unknown', { count: formatCount(survival.unresolvedCount) })) : '') + '</dd></dl>' : '';
  if (!domains) return survivalSection;
  const rows = (items) => items.length ? items.map((item) => '<tr><td>' + escape(item.name) + '</td><td>' + escape(item.verdictLabel + (item.bounded ? ' · ' + t('reportExtra.bounded') : '')) + '</td><td>' + escape(percent(item.minDeliveredRatio)) + '</td></tr>').join('') : '<tr><td>' + t('reportExtra.noItems') + '</td><td>—</td><td>—</td></tr>';
  const invalid = domains.redundancyInvalid.length ? '<p>' + t('reportExtra.redundancyInvalid') + ': ' + escape(domains.redundancyInvalid.map(({ name, reason, deliveryDrop }) => name + (reason === 'delivery-drop' ? ' (' + t('reportExtra.deliveryDrop') + ' ' + percent(deliveryDrop) + 'p)' : ' (' + t('reportExtra.serviceSevered') + ')')).join(', ')) + '</p>' : '';
  return survivalSection + '<h2>' + t('reportExtra.domainSweep') + '</h2><p>' + t('reportExtra.domains') + ': ' + formatCount(domains.domainCount) + ' · ' + t('reportExtra.evaluated') + ': ' + formatCount(domains.evaluated) + '</p>' + invalid + '<h3>' + t('reportExtra.domainN1') + '</h3><table><thead><tr><th>' + t('reportExtra.domain') + '</th><th>' + t('reportExtra.verdict') + '</th><th>' + t('reportExtra.minimumDelivered') + '</th></tr></thead><tbody>' + rows(domains.singles) + '</tbody></table><h3>' + t('reportExtra.domainN2') + '</h3><table><thead><tr><th>' + t('reportExtra.domainPair') + '</th><th>' + t('reportExtra.verdict') + '</th><th>' + t('reportExtra.minimumDelivered') + '</th></tr></thead><tbody>' + rows(domains.pairs) + '</tbody></table>';
}

export function renderReportMarkdown(model) {
  const rows = model.constraints.map((item) => '| ' + item.resourceName + ' | ' + item.axisLabel + ' | ' + item.statusLabel + ' | ' + item.load + ' | ' + item.limit + ' | ' + item.source.label + ' | ' + (item.applicability || '—') + ' |').join('\n');
  const scenarioRows = model.namedScenarios.flatMap((scenario) => scenario.services.map((service) => '| ' + scenario.name + ' | ' + service.name + ' | ' + service.statusLabel + ' | ' + service.cause + ' | ' + service.baselineChange + ' |')).join('\n');
  const observed = model.scenario.observedLoad ? '- ' + t('reportExtra.observedHeading') + ': ' + model.scenario.observedLoad.aggregate.toUpperCase() + ' · ' + model.scenario.observedLoad.asOf + (model.scenario.observedLoad.source === 'zabbix' ? ' · Zabbix' : '') + (model.scenario.observedLoad.stale ? ' · ' + t('reportExtra.stale', { days: model.scenario.observedLoad.staleAfterDays }) : '') + '\n' : '';
  const scenarios = scenarioRows ? '\n## ' + t('reportExtra.scenarioHeading') + '\n\n| ' + [t('reportExtra.scenario'), t('reportExtra.service'), t('reportExtra.verdict'), t('reportExtra.cause'), t('reportExtra.baselineChange')].join(' | ') + ' |\n| --- | --- | --- | --- | --- |\n' + scenarioRows + '\n' : '';
  const rackRows = model.racks.map((rack) => '| ' + rack.name + ' | ' + rack.statusLabel + ' | ' + rack.power + ' | ' + rack.space + ' | ' + rack.basisLabel + ' | ' + (rack.note || '—') + ' |').join('\n');
  const racks = rackRows ? '\n## ' + t('reportExtra.rackHeading') + '\n\n| ' + [t('reportExtra.rack'), t('reportExtra.verdict'), t('reportExtra.power'), t('reportExtra.space'), t('reportExtra.basis'), t('reportExtra.note')].join(' | ') + ' |\n| --- | --- | ---: | ---: | --- | --- |\n' + rackRows + '\n' : '';
  return '# ' + t('report.title') + '\n\n' + model.firstLine + '\n\n- ' + t('report.evaluation') + ': ' + model.evaluation + '\n- ' + t('report.scale') + ': ' + formatNumber(model.scenario.scale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×\n- ' + t('report.activeFaults') + ': ' + itemCount(model.scenario.activeFaults) + '\n' + observed + resilienceMarkdown(model.resilience) + '\n## ' + t('reportExtra.constraintsHeading') + '\n\n| ' + [t('reportExtra.resource'), t('reportExtra.axis'), t('reportExtra.status'), t('reportExtra.load'), t('reportExtra.limit'), t('reportExtra.source'), t('reportExtra.applicability')].join(' | ') + ' |\n| --- | --- | --- | ---: | ---: | --- | --- |\n' + rows + '\n' + observedValidationMarkdown(model.observedLoadValidation) + racks + scenarios;
}

export function renderReportHtml(model) {
  const rows = model.constraints.map((item) => '<tr><td>' + escape(item.resourceName) + '</td><td>' + escape(item.axisLabel) + '</td><td>' + escape(item.statusLabel) + '</td><td>' + escape(item.load) + '</td><td>' + escape(item.limit) + '</td><td>' + escape(item.source.label) + '</td><td>' + escape(item.applicability || '—') + '</td></tr>').join('');
  const scenarioRows = model.namedScenarios.flatMap((scenario) => scenario.services.map((service) => '<tr><td>' + escape(scenario.name) + '</td><td>' + escape(service.name) + '</td><td>' + escape(service.statusLabel) + '</td><td>' + escape(service.cause) + '</td><td>' + escape(service.baselineChange) + '</td></tr>')).join('');
  const scenarios = scenarioRows ? '<h2>' + t('reportExtra.scenarioHeading') + '</h2><table><thead><tr>' + [t('reportExtra.scenario'), t('reportExtra.service'), t('reportExtra.verdict'), t('reportExtra.cause'), t('reportExtra.baselineChange')].map((value) => '<th>' + escape(value) + '</th>').join('') + '</tr></thead><tbody>' + scenarioRows + '</tbody></table>' : '';
  const rackRows = model.racks.map((rack) => '<tr><td>' + escape(rack.name) + '</td><td>' + escape(rack.statusLabel) + '</td><td>' + escape(rack.power) + '</td><td>' + escape(rack.space) + '</td><td>' + escape(rack.basisLabel) + '</td><td>' + escape(rack.note || '—') + '</td></tr>').join('');
  const racks = rackRows ? '<h2>' + t('reportExtra.rackHeading') + '</h2><table><thead><tr>' + [t('reportExtra.rack'), t('reportExtra.verdict'), t('reportExtra.power'), t('reportExtra.space'), t('reportExtra.basis'), t('reportExtra.note')].map((value) => '<th>' + escape(value) + '</th>').join('') + '</tr></thead><tbody>' + rackRows + '</tbody></table>' : '';
  const observed = model.scenario.observedLoad ? '<p>' + t('reportExtra.observedHeading') + ': ' + escape(model.scenario.observedLoad.aggregate.toUpperCase()) + ' · ' + escape(model.scenario.observedLoad.asOf) + (model.scenario.observedLoad.source === 'zabbix' ? ' · Zabbix' : '') + (model.scenario.observedLoad.stale ? ' · ' + escape(t('reportExtra.stale', { days: model.scenario.observedLoad.staleAfterDays })) : '') + '</p>' : '';
  return '<!doctype html><html lang="' + getLocale() + '"><meta charset="utf-8"><title>' + escape(t('report.title')) + '</title><body><h1>' + escape(t('report.title')) + '</h1><p>' + escape(model.firstLine) + '</p><dl><dt>' + t('report.evaluation') + '</dt><dd>' + escape(model.evaluation) + '</dd><dt>' + t('report.scale') + '</dt><dd>' + escape(formatNumber(model.scenario.scale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '×</dd><dt>' + t('report.activeFaults') + '</dt><dd>' + escape(itemCount(model.scenario.activeFaults)) + '</dd></dl>' + observed + resilienceHtml(model.resilience) + '<h2>' + t('reportExtra.constraintsHeading') + '</h2><table><thead><tr>' + [t('reportExtra.resource'), t('reportExtra.axis'), t('reportExtra.status'), t('reportExtra.load'), t('reportExtra.limit'), t('reportExtra.source'), t('reportExtra.applicability')].map((value) => '<th>' + escape(value) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' + observedValidationHtml(model.observedLoadValidation) + racks + scenarios + '</body></html>';
}

export function renderReportJson(model) { return JSON.stringify(model, null, 2); }
