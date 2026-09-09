import { axisCatalog } from './data.js';
import { calculateScenario } from './engine.js';
import { buildObservedLoadValidationReport, OBSERVED_LOAD_STALE_AFTER_DAYS, observedLoadIsStale } from './measured-import.js';

const STATUS = Object.freeze({ healthy: '정상', warning: '주의', overloaded: '용량 초과', unknown: '미확인', invalid: '입력 오류' });
const EVALUATION = Object.freeze({ pass: '통과', fail: '실패', unknown: '통과 보류', invalid: '입력 오류', 'not-ready': '수요 없음' });
const SOURCE = Object.freeze({ datasheet: '데이터시트', third_party_test: '제3자 시험', user_measured: '실측', estimate: '추정', 'user-correction': '사용자 보정' });
const SERVICE_STATUS = Object.freeze({ pass: '통과', fail: '실패', unknown: '통과 보류', invalid: '입력 오류' });
const SERVICE_RANK = Object.freeze({ pass: 0, unknown: 1, fail: 2, invalid: 3 });
const FAILURE_VERDICT = Object.freeze({ severs: '서비스 단절', overloads: '용량 부족', absorbs: '견딤', unknown: '미확인' });
const SURVIVAL_STATUS = Object.freeze({ survives: '견딤', severed: '단절', 'capacity-insufficient': '현재 부하 미달', unavailable: '계산 불가', calculating: '계산 중' });

function number(value, unit) {
  if (!Number.isFinite(value)) return '미확인';
  if (unit === 'bps') return value >= 1e9 ? (value / 1e9).toFixed(value >= 10e9 ? 0 : 1) + ' Gbps' : (value / 1e6).toFixed(0) + ' Mbps';
  if (unit === 'pps') return value >= 1e6 ? (value / 1e6).toFixed(2) + ' Mpps' : (value / 1e3).toFixed(0) + ' Kpps';
  if (unit === 'cps') return (value / 1e3).toFixed(0) + ' Kcps';
  if (unit === 'sessions') return (value / 1e3).toFixed(0) + ' K';
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value);
}

function percent(value, signed = false) {
  if (!Number.isFinite(value)) return '미확인';
  return (signed && value > 0 ? '+' : '') + Math.round(value * 100) + '%';
}

function sourceFor(resource, axis) {
  const record = (resource.spec?.records || resource.metadata?.records || []).find((item) => item.axis === axis);
  const type = record?.source?.type || resource.source?.type || null;
  return { type, label: SOURCE[type] || type || '미확인', conditions: record?.conditions ?? null };
}

function axes(resources) {
  return resources.flatMap((resource) => Object.entries(resource.axes || {}).map(([axis, result]) => {
    const status = result.status || 'unknown';
    return { resourceId: resource.id, resourceName: resource.name || resource.id, axis, axisLabel: axisCatalog[axis]?.label || axis,
      status, statusLabel: STATUS[status] || status, load: number(result.load, axisCatalog[axis]?.unit), limit: number(result.limit, axisCatalog[axis]?.unit),
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
  if (demands.some((demand) => demand.status === 'unreachable')) return '경로 단절';
  const admission = demands.find((demand) => demand.sessionAdmission?.limitedBy);
  if (admission) return resourceLabel(scenario, admission.sessionAdmission.limitedBy.resourceId, 'new_sessions_per_sec');
  const choke = demands.flatMap((demand) => demand.paths || []).find((path) => path.choke);
  if (choke) return resourceLabel(scenario, choke.choke.resourceId);
  if (scenario.summary.bindingResourceId) return resourceLabel(scenario, scenario.summary.bindingResourceId, scenario.summary.bindingAxis);
  return '병목 없음';
}

function baselineChange(status, baselineStatus) {
  if (!baselineStatus) return '기준선에 없음';
  if (status === baselineStatus) return '기준선 동일';
  return SERVICE_RANK[status] > SERVICE_RANK[baselineStatus] ? '기준선 대비 악화' : '기준선 대비 개선';
}

export function buildServiceVerdicts(topology, scenario, baseline) {
  const baselineById = new Map((baseline.services || []).map((service) => [service.id, service]));
  return (scenario.services || []).map((service) => {
    const baselineService = baselineById.get(service.id);
    return { id: service.id, name: service.name || service.id, status: service.status, statusLabel: SERVICE_STATUS[service.status] || service.status,
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

function reportResilience(analysis = {}) {
  const survival = analysis.survivalMultiplier;
  const domainSweep = analysis.domainSweep;
  return {
    survivalMultiplier: survival ? {
      scope: '단일 자원 N-1', status: survival.status, statusLabel: SURVIVAL_STATUS[survival.status] || survival.status,
      multiplier: survival.multiplier, bounded: Boolean(survival.bounded), worstFault: survival.worstFault ? { ...survival.worstFault } : null,
      evaluated: survival.evaluated, candidates: survival.candidates, endpointCount: survival.endpointIds?.length || 0,
      unresolvedCount: survival.unresolvedCount || 0,
    } : null,
    domainSweep: domainSweep ? {
      domainCount: domainSweep.domainCount, evaluated: domainSweep.evaluated,
      singles: domainSweep.singles.map((item) => ({ id: item.id, name: item.name, kind: item.kind, verdict: item.verdict,
        verdictLabel: FAILURE_VERDICT[item.verdict] || item.verdict, bounded: Boolean(item.bounded), minDeliveredRatio: item.minDeliveredRatio })),
      pairs: domainSweep.pairs.map((item) => ({ id: item.id, name: item.name, verdict: item.verdict,
        verdictLabel: FAILURE_VERDICT[item.verdict] || item.verdict, bounded: Boolean(item.bounded), minDeliveredRatio: item.minDeliveredRatio })),
      redundancyInvalid: domainSweep.redundancyInvalid.map((item) => ({ id: item.id, name: item.name, kind: item.kind,
        reason: item.reason || 'severs', deliveryDrop: item.deliveryDrop ?? null })),
    } : null,
  };
}

export function buildReportModel(topology, scenario, baseline, namedScenarios = [], options = {}, analysis = {}) {
  const summary = scenario.summary;
  const evaluation = EVALUATION[summary.evaluationStatus] || summary.evaluationStatus;
  const constraints = axes([...scenario.devices, ...scenario.links]);
  const unknown = constraints.filter(({ status }) => status === 'unknown');
  const binding = summary.bindingResourceId ? constraints.find(({ resourceId, axis }) => resourceId === summary.bindingResourceId && axis === summary.bindingAxis) : null;
  const firstLine = unknown.length ? '미확인 축 ' + unknown.length + '개가 있어 이 결과는 상한입니다.' : evaluation + '입니다.' + (binding ? ' 현재 병목은 ' + binding.resourceName + '의 ' + binding.axisLabel + '입니다.' : '');
  return { schemaVersion: 1, product: 'Rack Mesh 분석 보고서', evaluation, firstLine,
    scenario: { scale: scenario.scale, activeFaults: summary.activeFaults, evaluationStatus: summary.evaluationStatus, unknownCount: summary.unknownCount,
      observedLoad: topology.observedLoad ? { asOf: topology.observedLoad.asOf, aggregate: topology.observedLoad.aggregate, ...(topology.observedLoad.source ? { source: topology.observedLoad.source } : {}), stale: observedLoadIsStale(topology.observedLoad), staleAfterDays: OBSERVED_LOAD_STALE_AFTER_DAYS } : null },
    comparison: { bindingChanged: baseline.summary.bindingResourceId !== summary.bindingResourceId || baseline.summary.bindingAxis !== summary.bindingAxis,
      minHeadroomDelta: scenario.summary.minHeadroom == null || baseline.summary.minHeadroom == null ? null : Math.round((scenario.summary.minHeadroom - baseline.summary.minHeadroom) * 100) + '%p',
      unreachableDelta: summary.unreachableCount - baseline.summary.unreachableCount, overloadedDelta: summary.overloadedCount - baseline.summary.overloadedCount },
    services: buildServiceVerdicts(topology, scenario, baseline),
    namedScenarios: buildNamedScenarioServiceVerdicts(topology, baseline, namedScenarios),
    observedLoadValidation: buildObservedLoadValidationReport(topology, options), resilience: reportResilience(analysis), binding, constraints };
}

function escape(value) { return String(value).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }

function observedValidationLabel(group) { return ({ matched: '조건 일치', mismatched: '조건 불일치', unrecorded: '조건 미기록' })[group] || '미확인'; }

function observedValidationMarkdown(validation) {
  if (!validation.available) return '';
  const rows = validation.axes.map((axis) => '| ' + (axisCatalog[axis.axis]?.label || axis.axis) + ' | ' + axis.sampleCount + ' | ' + percent(axis.mape) + ' | ' + percent(axis.maxAbsolutePercentageError) + ' | ' + percent(axis.meanSignedPercentageError, true) + ' | 과소 ' + axis.signedError.underModelled + ' · 일치 ' + axis.signedError.exact + ' · 과대 ' + axis.signedError.overModelled + ' |').join('\n');
  const table = rows ? '| 축 | 표본 | MAPE | 최대 오차 | 평균 부호 오차 | 분포 |\n| --- | ---: | ---: | ---: | ---: | --- |\n' + rows + '\n' : '비교할 수 있는 관측 축이 없습니다.\n';
  return '\n## 관측 부하 검증\n\n- 조건 집단: ' + observedValidationLabel(validation.conditionGroup) + '\n- 비교 표본: ' + validation.sampleCount + '개\n\n' + table;
}

function observedValidationHtml(validation) {
  if (!validation.available) return '';
  const rows = validation.axes.map((axis) => '<tr><td>' + escape(axisCatalog[axis.axis]?.label || axis.axis) + '</td><td>' + axis.sampleCount + '</td><td>' + percent(axis.mape) + '</td><td>' + percent(axis.maxAbsolutePercentageError) + '</td><td>' + percent(axis.meanSignedPercentageError, true) + '</td><td>과소 ' + axis.signedError.underModelled + ' · 일치 ' + axis.signedError.exact + ' · 과대 ' + axis.signedError.overModelled + '</td></tr>').join('');
  const table = rows ? '<table><thead><tr><th>축</th><th>표본</th><th>MAPE</th><th>최대 오차</th><th>평균 부호 오차</th><th>분포</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p>비교할 수 있는 관측 축이 없습니다.</p>';
  return '<h2>관측 부하 검증</h2><p>조건 집단: ' + escape(observedValidationLabel(validation.conditionGroup)) + ' · 비교 표본: ' + validation.sampleCount + '개</p>' + table;
}

function resilienceMarkdown(resilience) {
  const survival = resilience.survivalMultiplier;
  const domains = resilience.domainSweep;
  const survivalSection = survival ? '\n## N-1 생존 배수\n\n- 범위: ' + survival.scope + '\n- 결과: ' + survival.statusLabel + (survival.multiplier == null ? '' : ' · ' + survival.multiplier.toFixed(2) + '×' + (survival.bounded ? ' 이하' : '')) + '\n- 최악 장애: ' + (survival.worstFault?.id || '없음') + '\n- 검사: ' + survival.evaluated + '/' + survival.candidates + '개' + (survival.endpointCount ? ' · 끝점 제외 ' + survival.endpointCount + '개' : '') + (survival.unresolvedCount ? ' · 미확인 ' + survival.unresolvedCount + '개' : '') + '\n' : '';
  if (!domains) return survivalSection;
  const rows = (items) => items.length ? items.map((item) => '| ' + item.name + ' | ' + item.verdictLabel + (item.bounded ? ' · 한계 미확인' : '') + ' | ' + percent(item.minDeliveredRatio) + ' |').join('\n') + '\n' : '| 없음 | — | — |\n';
  const invalid = domains.redundancyInvalid.length ? '\n- 이중화 무효: ' + domains.redundancyInvalid.map(({ name, reason, deliveryDrop }) => name + (reason === 'delivery-drop' ? ' (전달률 ' + percent(deliveryDrop) + 'p 저하)' : ' (서비스 단절)')).join(', ') + '\n' : '';
  return survivalSection + '\n## 장애 도메인 스윕\n\n- 도메인: ' + domains.domainCount + '개 · 검사: ' + domains.evaluated + '개' + invalid + '\n### 도메인 N-1\n\n| 도메인 | 판정 | 최소 전달률 |\n| --- | --- | ---: |\n' + rows(domains.singles) + '\n### 도메인 N-2\n\n| 도메인 쌍 | 판정 | 최소 전달률 |\n| --- | --- | ---: |\n' + rows(domains.pairs);
}

function resilienceHtml(resilience) {
  const survival = resilience.survivalMultiplier;
  const domains = resilience.domainSweep;
  const survivalSection = survival ? '<h2>N-1 생존 배수</h2><dl><dt>범위</dt><dd>' + escape(survival.scope) + '</dd><dt>결과</dt><dd>' + escape(survival.statusLabel) + (survival.multiplier == null ? '' : ' · ' + escape(survival.multiplier.toFixed(2)) + '×' + (survival.bounded ? ' 이하' : '')) + '</dd><dt>최악 장애</dt><dd>' + escape(survival.worstFault?.id || '없음') + '</dd><dt>검사</dt><dd>' + survival.evaluated + '/' + survival.candidates + '개' + (survival.endpointCount ? ' · 끝점 제외 ' + survival.endpointCount + '개' : '') + (survival.unresolvedCount ? ' · 미확인 ' + survival.unresolvedCount + '개' : '') + '</dd></dl>' : '';
  if (!domains) return survivalSection;
  const rows = (items) => items.length ? items.map((item) => '<tr><td>' + escape(item.name) + '</td><td>' + escape(item.verdictLabel + (item.bounded ? ' · 한계 미확인' : '')) + '</td><td>' + escape(percent(item.minDeliveredRatio)) + '</td></tr>').join('') : '<tr><td>없음</td><td>—</td><td>—</td></tr>';
  const invalid = domains.redundancyInvalid.length ? '<p>이중화 무효: ' + escape(domains.redundancyInvalid.map(({ name, reason, deliveryDrop }) => name + (reason === 'delivery-drop' ? ' (전달률 ' + percent(deliveryDrop) + 'p 저하)' : ' (서비스 단절)')).join(', ')) + '</p>' : '';
  return survivalSection + '<h2>장애 도메인 스윕</h2><p>도메인: ' + domains.domainCount + '개 · 검사: ' + domains.evaluated + '개</p>' + invalid + '<h3>도메인 N-1</h3><table><thead><tr><th>도메인</th><th>판정</th><th>최소 전달률</th></tr></thead><tbody>' + rows(domains.singles) + '</tbody></table><h3>도메인 N-2</h3><table><thead><tr><th>도메인 쌍</th><th>판정</th><th>최소 전달률</th></tr></thead><tbody>' + rows(domains.pairs) + '</tbody></table>';
}

export function renderReportMarkdown(model) {
  const rows = model.constraints.map((item) => '| ' + item.resourceName + ' | ' + item.axisLabel + ' | ' + item.statusLabel + ' | ' + item.load + ' | ' + item.limit + ' | ' + item.source.label + ' | ' + (item.applicability || '—') + ' |').join('\n');
  const scenarioRows = model.namedScenarios.flatMap((scenario) => scenario.services.map((service) => '| ' + scenario.name + ' | ' + service.name + ' | ' + service.statusLabel + ' | ' + service.cause + ' | ' + service.baselineChange + ' |')).join('\n');
  const observed = model.scenario.observedLoad ? '- 관측 부하: ' + model.scenario.observedLoad.aggregate.toUpperCase() + ' · ' + model.scenario.observedLoad.asOf + (model.scenario.observedLoad.source === 'zabbix' ? ' · Zabbix' : '') + (model.scenario.observedLoad.stale ? ' · 경고: 관측 시점이 ' + model.scenario.observedLoad.staleAfterDays + '일을 넘었습니다.' : '') + '\n' : '';
  const scenarios = scenarioRows ? '\n## 저장 시나리오 서비스 판정\n\n| 시나리오 | 서비스 | 판정 | 원인 | 기준선 비교 |\n| --- | --- | --- | --- | --- |\n' + scenarioRows + '\n' : '';
  return '# Rack Mesh 분석 보고서\n\n' + model.firstLine + '\n\n- 판정: ' + model.evaluation + '\n- 배율: ' + model.scenario.scale.toFixed(2) + '×\n- 활성 장애: ' + model.scenario.activeFaults + '개\n' + observed + resilienceMarkdown(model.resilience) + '\n## 축별 근거와 판정\n\n| 자원 | 축 | 상태 | 부하 | 한계 | 출처 | 적용 판정 |\n| --- | --- | --- | ---: | ---: | --- | --- |\n' + rows + '\n' + observedValidationMarkdown(model.observedLoadValidation) + scenarios;
}

export function renderReportHtml(model) {
  const rows = model.constraints.map((item) => '<tr><td>' + escape(item.resourceName) + '</td><td>' + escape(item.axisLabel) + '</td><td>' + escape(item.statusLabel) + '</td><td>' + escape(item.load) + '</td><td>' + escape(item.limit) + '</td><td>' + escape(item.source.label) + '</td><td>' + escape(item.applicability || '—') + '</td></tr>').join('');
  const scenarioRows = model.namedScenarios.flatMap((scenario) => scenario.services.map((service) => '<tr><td>' + escape(scenario.name) + '</td><td>' + escape(service.name) + '</td><td>' + escape(service.statusLabel) + '</td><td>' + escape(service.cause) + '</td><td>' + escape(service.baselineChange) + '</td></tr>')).join('');
  const scenarios = scenarioRows ? '<h2>저장 시나리오 서비스 판정</h2><table><thead><tr><th>시나리오</th><th>서비스</th><th>판정</th><th>원인</th><th>기준선 비교</th></tr></thead><tbody>' + scenarioRows + '</tbody></table>' : '';
  const observed = model.scenario.observedLoad ? '<p>관측 부하: ' + escape(model.scenario.observedLoad.aggregate.toUpperCase()) + ' · ' + escape(model.scenario.observedLoad.asOf) + (model.scenario.observedLoad.source === 'zabbix' ? ' · Zabbix' : '') + (model.scenario.observedLoad.stale ? ' · 경고: 관측 시점이 ' + escape(model.scenario.observedLoad.staleAfterDays) + '일을 넘었습니다.' : '') + '</p>' : '';
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><title>Rack Mesh 분석 보고서</title><body><h1>Rack Mesh 분석 보고서</h1><p>' + escape(model.firstLine) + '</p><dl><dt>판정</dt><dd>' + escape(model.evaluation) + '</dd><dt>배율</dt><dd>' + escape(model.scenario.scale.toFixed(2)) + '×</dd><dt>활성 장애</dt><dd>' + escape(model.scenario.activeFaults) + '개</dd></dl>' + observed + resilienceHtml(model.resilience) + '<h2>축별 근거와 판정</h2><table><thead><tr><th>자원</th><th>축</th><th>상태</th><th>부하</th><th>한계</th><th>출처</th><th>적용 판정</th></tr></thead><tbody>' + rows + '</tbody></table>' + observedValidationHtml(model.observedLoadValidation) + scenarios + '</body></html>';
}

export function renderReportJson(model) { return JSON.stringify(model, null, 2); }
