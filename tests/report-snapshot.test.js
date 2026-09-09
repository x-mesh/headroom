import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario, calculateSurvivalMultiplier, sweepFailureDomains, sweepSingleFaults } from '../public/engine.js';
import { applyObservedLoad, importObservedLoad, topologyFingerprint } from '../public/measured-import.js';
import { buildReportModel, renderReportHtml, renderReportJson, renderReportMarkdown } from '../public/report.js';

function goldenReportModel() {
  const topology = cloneTopology();
  const baseline = calculateScenario(topology);
  const fingerprint = topologyFingerprint(topology);
  const observedLoad = importObservedLoad({
    schema: 'rack-mesh-observed-load',
    as_of: '2026-08-01T03:00:00Z',
    aggregate: 'p95',
    topology_fingerprint: { device_ids: fingerprint.deviceIds, link_ids: fingerprint.linkIds },
    conditions: {},
    entries: [{ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 72000, unit: 'sessions/s' }],
  });
  const observedTopology = applyObservedLoad(topology, observedLoad).topology;
  const fault = { scale: 1, disabledDevices: ['fw-a'], disabledLinks: [], disabledDomains: [] };
  const scenario = calculateScenario(observedTopology, fault);
  const sweep = sweepSingleFaults(observedTopology);
  return buildReportModel(observedTopology, scenario, baseline, [{ id: 'fw-a-outage', name: 'FW A 장애', scenario: fault }], {}, {
    survivalMultiplier: calculateSurvivalMultiplier(observedTopology, { sweep }), domainSweep: sweepFailureDomains(observedTopology, { sweep }),
  });
}

test('keeps the golden fault verdict aligned across Markdown, HTML, and JSON reports', () => {
  const model = goldenReportModel();
  const markdown = renderReportMarkdown(model);
  const html = renderReportHtml(model);
  const json = JSON.parse(renderReportJson(model));
  const contract = {
    firstLine: '미확인 축 2개가 있어 이 결과는 상한입니다.',
    evaluation: '실패',
    scale: 1,
    activeFaults: 1,
    observedLoad: { aggregate: 'p95', asOf: '2026-08-01T03:00:00Z', stale: true, staleAfterDays: 7 },
    observedValidation: { conditionGroup: 'matched', sampleCount: 1, axis: 'new_sessions_per_sec', mape: 0.5 },
    namedService: { scenario: 'FW A 장애', service: 'Public API', status: '실패', cause: 'FW B · 신규 세션', baselineChange: '기준선 대비 악화' },
  };

  assert.equal(model.firstLine, contract.firstLine);
  assert.equal(json.firstLine, contract.firstLine);
  assert.equal(json.evaluation, contract.evaluation);
  assert.equal(json.scenario.scale, contract.scale);
  assert.equal(json.scenario.activeFaults, contract.activeFaults);
  assert.deepEqual(json.scenario.observedLoad, contract.observedLoad);
  assert.equal(json.observedLoadValidation.conditionGroup, contract.observedValidation.conditionGroup);
  assert.equal(json.observedLoadValidation.sampleCount, contract.observedValidation.sampleCount);
  assert.deepEqual(json.observedLoadValidation.axes.map(({ axis, mape }) => ({ axis, mape })), [{ axis: contract.observedValidation.axis, mape: contract.observedValidation.mape }]);
  assert.deepEqual(json.namedScenarios[0].services[0], {
    id: 'public-api-service', name: contract.namedService.service, status: 'fail', statusLabel: contract.namedService.status,
    cause: contract.namedService.cause, baselineStatus: 'unknown', baselineChange: contract.namedService.baselineChange,
  });
  assert.equal(json.resilience.survivalMultiplier.scope, '단일 자원 N-1');
  assert.ok(json.resilience.domainSweep.pairs.length > 0);

  for (const output of [markdown, html]) {
    for (const value of [
      contract.firstLine, contract.evaluation, '1.00×',
      'P95', contract.observedLoad.asOf, '관측 시점이 7일을 넘었습니다',
      '조건 일치', 'MAPE', contract.namedService.scenario, contract.namedService.service,
      contract.namedService.status, contract.namedService.cause, contract.namedService.baselineChange,
      'N-1 생존 배수', '장애 도메인 스윕', '도메인 N-1', '도메인 N-2',
    ]) assert.ok(output.includes(value), `${value}가 보고서에 없습니다.`);
  }
  assert.match(markdown, /- 활성 장애: 1개/);
  assert.match(html, /<dt>활성 장애<\/dt><dd>1개<\/dd>/);
});
