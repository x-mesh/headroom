import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../public/data.js';
import { calculateScenario, calculateSurvivalMultiplier, sweepFailureDomains, sweepSingleFaults } from '../public/engine.js';
import { applyObservedLoad, importObservedLoad, topologyFingerprint } from '../public/measured-import.js';
import { buildNamedScenarioServiceVerdicts, buildReportModel, renderReportHtml, renderReportJson, renderReportMarkdown } from '../public/report.js';

test('renders three report formats from one model without inventing unknown numbers', () => {
  const topology = cloneTopology();
  const scenario = calculateScenario(topology);
  const model = buildReportModel(topology, scenario, scenario);
  assert.match(model.firstLine, /미확인 축/);
  assert.match(renderReportMarkdown(model), /축별 근거와 판정/);
  assert.match(renderReportHtml(model), /<table>/);
  assert.equal(JSON.parse(renderReportJson(model)).firstLine, model.firstLine);
  assert.ok(model.constraints.some(({ load, limit }) => load === '미확인' || limit === '미확인'));
});

test('keeps observed load facts in the report model', () => {
  const topology = cloneTopology();
  topology.observedLoad = { asOf: '2026-08-01T03:00:00Z', aggregate: 'p95', fingerprint: { deviceIds: [], linkIds: [] }, devices: {}, links: {} };
  const scenario = calculateScenario(topology);
  const model = buildReportModel(topology, scenario, scenario);
  assert.deepEqual(model.scenario.observedLoad, { asOf: '2026-08-01T03:00:00Z', aggregate: 'p95', stale: true, staleAfterDays: 7 });
  assert.equal(renderReportMarkdown(model).includes('관측 부하: P95'), true);
  assert.match(renderReportMarkdown(model), /관측 시점이 7일을 넘었습니다/);
  assert.match(renderReportHtml(model), /관측 시점이 7일을 넘었습니다/);
});

test('exports observed-load validation in Markdown, HTML, and JSON', () => {
  const topology = cloneTopology();
  const baseline = calculateScenario(topology);
  const fingerprint = topologyFingerprint(topology);
  const observed = importObservedLoad({ schema: 'rack-mesh-observed-load', as_of: '2026-09-09T03:00:00Z', aggregate: 'p95', topology_fingerprint: { device_ids: fingerprint.deviceIds, link_ids: fingerprint.linkIds }, conditions: {}, entries: [{ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 72000, unit: 'sessions/s' }] });
  const applied = applyObservedLoad(topology, observed).topology;
  const scenario = calculateScenario(applied);
  const model = buildReportModel(applied, scenario, baseline);
  assert.equal(model.observedLoadValidation.conditionGroup, 'matched');
  assert.equal(model.observedLoadValidation.axes[0].sampleCount, 1);
  assert.match(renderReportMarkdown(model), /관측 부하 검증/);
  assert.match(renderReportMarkdown(model), /MAPE/);
  assert.match(renderReportHtml(model), /관측 부하 검증/);
  assert.equal(JSON.parse(renderReportJson(model)).observedLoadValidation.axes[0].axis, 'new_sessions_per_sec');
});

test('reports every saved scenario service verdict with a cause and baseline change', () => {
  const topology = cloneTopology();
  topology.services = [{ id: 'api', name: 'Public API', demandIds: ['public-api'], requiredDeliveryRatio: 1 }];
  const baseline = calculateScenario(topology);
  const namedScenarios = [{ id: 'fw-outage', name: 'FW-A 장애', scenario: { scale: 1, disabledDevices: ['fw-a'], disabledLinks: [], disabledDomains: [] } }];
  const verdicts = buildNamedScenarioServiceVerdicts(topology, baseline, namedScenarios);
  assert.equal(verdicts[0].services[0].status, 'fail');
  assert.match(verdicts[0].services[0].cause, /FW B|경로 단절/);
  assert.equal(verdicts[0].services[0].baselineChange, '기준선 대비 악화');

  const model = buildReportModel(topology, baseline, baseline, namedScenarios);
  assert.equal(model.namedScenarios[0].services[0].name, 'Public API');
  assert.match(renderReportMarkdown(model), /저장 시나리오 서비스 판정/);
  assert.match(renderReportHtml(model), /FW-A 장애/);
  assert.equal(JSON.parse(renderReportJson(model)).namedScenarios[0].services[0].status, 'fail');
});

test('keeps resource N-1 survival and domain N-1 and N-2 results separate in every report format', () => {
  const topology = cloneTopology();
  const scenario = calculateScenario(topology);
  const sweep = sweepSingleFaults(topology);
  const survivalMultiplier = calculateSurvivalMultiplier(topology, { sweep });
  const domainSweep = sweepFailureDomains(topology, { sweep });
  const model = buildReportModel(topology, scenario, scenario, [], {}, { survivalMultiplier, domainSweep });
  const json = JSON.parse(renderReportJson(model));

  assert.equal(json.resilience.survivalMultiplier.scope, '단일 자원 N-1');
  assert.equal(json.resilience.survivalMultiplier.multiplier, survivalMultiplier.multiplier);
  assert.equal(json.resilience.domainSweep.singles.length, domainSweep.singles.length);
  assert.equal(json.resilience.domainSweep.pairs.length, domainSweep.pairs.length);
  assert.equal('multiplier' in json.resilience.domainSweep, false, '도메인 결과를 생존 배수로 합치지 않는다');

  for (const output of [renderReportMarkdown(model), renderReportHtml(model)]) {
    assert.match(output, /N-1 생존 배수/);
    assert.match(output, /단일 자원 N-1/);
    assert.match(output, /장애 도메인 스윕/);
    assert.match(output, /도메인 N-1/);
    assert.match(output, /도메인 N-2/);
  }
});

test('keeps synthetic nameplate rack values and display names in the report', () => {
  const topology = cloneTopology();
  const scenario = calculateScenario(topology);
  const report = buildReportModel(topology, scenario, scenario, [], {}, {
    survivalMultiplier: calculateSurvivalMultiplier(topology), domainSweep: sweepFailureDomains(topology),
  });
  assert.deepEqual(scenario.racks.find(({ id }) => id === 'rack-04-budget') && [scenario.racks.find(({ id }) => id === 'rack-04-budget').powerWatts, scenario.racks.find(({ id }) => id === 'rack-04-budget').usedU], [900, 3]);
  assert.match(renderReportMarkdown(report), /PDU-3 SPINE 공용 전원/);
  assert.doesNotMatch(renderReportMarkdown(report), /pdu-3/);
});

test('reports rack power and space, and says which device leaves a rack unknown', () => {
  const topology = cloneTopology();
  const baseline = calculateScenario(topology);
  const model = buildReportModel(topology, baseline, baseline);
  const security = model.racks.find(({ id }) => id === 'security-budget');
  assert.equal(security.statusLabel, '통과');
  assert.equal(security.power, '360 / 400 W · 90%');
  assert.equal(security.space, '2 / 3U · 67%');
  assert.equal(security.basisLabel, '일반 부하');
  // 경고선을 넘었는데 판정은 통과다. 그 사실을 비고로 남겨야 읽는 사람이 놓치지 않는다.
  assert.equal(security.note, '경고선 80% 초과');

  // 사양 없는 장비 한 대가 랙 합계를 미확인으로 만든다. 보고서는 그 이름을 밝힌다.
  // 사양을 여기서 직접 지운다. 어느 장비가 마침 사양이 없더라는 사실에 기대면, 그 장비에
  // 사양이 생기는 날 이 테스트는 조용히 다른 것을 재게 된다.
  delete topology.devices.find(({ id }) => id === 'spine-a').metadata;
  topology.racks.find(({ id }) => id === 'rack-04-budget').deviceIds.push('spine-a');
  const unknownModel = buildReportModel(topology, calculateScenario(topology), baseline);
  const rack04 = unknownModel.racks.find(({ id }) => id === 'rack-04-budget');
  assert.equal(rack04.statusLabel, '미확인');
  assert.equal(rack04.power, '미확인');
  assert.match(rack04.note, /전력 미확인: SPINE A/);

  const markdown = renderReportMarkdown(unknownModel);
  const html = renderReportHtml(unknownModel);
  const json = JSON.parse(renderReportJson(unknownModel));
  for (const output of [markdown, html]) {
    for (const value of ['랙 수용량', 'SECURITY', '경고선 80% 초과', '전력 미확인: SPINE A']) {
      assert.ok(output.includes(value), `${value}가 보고서에 없습니다.`);
    }
  }
  assert.equal(json.racks.find(({ id }) => id === 'rack-04-budget').status, 'unknown');
});
