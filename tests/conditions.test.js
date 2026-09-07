import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTopology } from '../src/data.js';
import { acceptanceDigest, buildSpec, evidenceApplicability, normalizeEvidence } from '../src/evidence.js';
import { acceptEvidence, applySpec, clearEvidenceAcceptance, setWorkloadConditions } from '../src/editor.js';
import { calculateScenario } from '../src/engine.js';
import { catalogEntry, deviceCatalog } from '../src/devices/catalog.js';
import { serializeProject, validateProject } from '../src/project.js';

const FORTIGATE = 'fortinet-fortigate-100f';
const firewallOnly = { packet_size_bytes: 1518, transport: 'udp', features_enabled: [] };

function withCatalog(catalogId = FORTIGATE, profileId = 'fw-1518') {
  const topology = cloneTopology();
  const entry = catalogEntry(catalogId);
  const profile = entry.profiles.find(({ id }) => id === profileId);
  applySpec(topology, 'fw-a', { ...buildSpec(entry, profile), vendor: entry.vendor, model: entry.model });
  return topology;
}

const axisOf = (topology, axis) => calculateScenario(topology).devices.find(({ id }) => id === 'fw-a').axes[axis];

// ── P1-27 측정 조건은 프로필이 아니라 축에 붙는다 ──────────────────────────

test('carries a different measurement condition on each axis of one profile', () => {
  const entry = catalogEntry('paloalto-pa-3410');
  const records = buildSpec(entry, entry.profiles[0]).records;
  const byAxis = new Map(records.map((record) => [record.axis, record.conditions]));
  // 팔로알토 표는 처리량을 appmix 로, 신규 세션을 1바이트 HTTP 로 잰다. 프로필 하나에 조건
  // 하나를 씌우면 둘 중 하나는 반드시 틀린다.
  assert.deepEqual(byAxis.get('forwarding_bps').features_enabled, ['app-id', 'logging']);
  assert.equal(byAxis.get('new_sessions_per_sec').test_method, 'application-override-1byte-http');
  assert.equal(byAxis.get('new_sessions_per_sec').packet_size_bytes, 'not_applicable');
  assert.notDeepEqual(byAxis.get('forwarding_bps'), byAxis.get('new_sessions_per_sec'));
});

test('keeps per-axis conditions through a project round trip', () => {
  const topology = withCatalog();
  setWorkloadConditions(topology, firewallOnly);
  const reopened = validateProject(JSON.parse(serializeProject(topology, { scale: 1, disabledDevices: [], disabledLinks: [] })));
  const before = topology.devices.find(({ id }) => id === 'fw-a').spec.records;
  const after = reopened.topology.devices.find(({ id }) => id === 'fw-a').spec.records;
  assert.deepEqual(after.map(({ axis, conditions }) => [axis, conditions]), before.map(({ axis, conditions }) => [axis, conditions]));
  assert.deepEqual(reopened.topology.workloadConditions, firewallOnly);
  // 축마다 다른 값이 유지된다. 하나로 뭉개지면 이 단언이 깨진다.
  assert.equal(new Set(after.map(({ conditions }) => JSON.stringify(conditions))).size > 1, true);
});

test('reads the three condition values the schema allows', () => {
  const record = (conditions) => normalizeEvidence({ axis: 'forwarding_bps', value: 1e9, conditions, evidenceKind: 'datasheet' });
  // 구체값은 대조한다.
  assert.equal(evidenceApplicability(record({ packet_size_bytes: 64 }), { packet_size_bytes: 64 }), 'applicable');
  assert.equal(evidenceApplicability(record({ packet_size_bytes: 64 }), { packet_size_bytes: 1518 }), 'incompatible');
  // 'unknown' 은 데이터시트가 밝히지 않은 것이라 대조할 수 없다. 불일치가 아니라 미확인이다.
  assert.equal(evidenceApplicability(record({ packet_size_bytes: 'unknown' }), { packet_size_bytes: 64 }), 'unknown');
  // 'not_applicable' 은 그 축에 성립하지 않는 조건이라 대조하지 않는다.
  assert.equal(evidenceApplicability(record({ packet_size_bytes: 'not_applicable' }), { packet_size_bytes: 64 }), 'applicable');
  // 빈 목록은 값이다. '아무 기능도 켜지 않았다'와 '적지 않았다'는 다르다.
  assert.equal(evidenceApplicability(record({ features_enabled: [] }), { features_enabled: [] }), 'applicable');
  assert.equal(evidenceApplicability(record({ features_enabled: [] }), {}), 'unknown');
});

test('gives the catalog enough structured conditions to judge against', () => {
  let withConditions = 0;
  let judgeable = 0;
  for (const entry of deviceCatalog) for (const profile of entry.profiles) {
    for (const record of buildSpec(entry, profile).records) {
      if (!record.conditions) continue;
      withConditions += 1;
      // 조건에 'unknown' 이 하나라도 섞이면 어떤 워크로드를 적어도 applicable 이 되지 않는다.
      // 조건을 적어 둔 것과 그 값을 실제로 쓸 수 있는 것은 다르다. 둘 다 센다.
      if (record.value != null && record.evidenceKind !== 'unverified'
        && !Object.values(record.conditions).some((value) => value === 'unknown')) judgeable += 1;
    }
  }
  assert.ok(withConditions >= 100, `조건을 가진 축 레코드가 ${withConditions}개뿐입니다.`);
  assert.ok(judgeable >= 30, `워크로드로 판정할 수 있는 축 레코드가 ${judgeable}개뿐입니다.`);
});

test('lets a switch, a router, and a load balancer be judged, not just a firewall', () => {
  // 방화벽만 조건을 갖고 있으면 카탈로그의 나머지는 값을 알면서도 계산에 쓰지 못한다.
  // 클래스마다 최소 하나는 워크로드와 대조되어야 카탈로그가 계산 도구로 쓰인다.
  const cases = [
    ['cisco-catalyst-9300-48t', 'standalone', 'forwarding_pps', { packet_size_bytes: 64, traffic_rate_scope: 'unidirectional' }],
    ['cisco-catalyst-8300-2n2s-4t2x', 'ipsec-1400b', 'forwarding_bps', { packet_size_bytes: 1400, features_enabled: ['ipsec'] }],
    ['f5-big-ip-i5800', 'ssl-ecc', 'tls_full_handshakes_per_sec', { cipher: 'ECDHE-ECDSA-AES128-SHA256' }],
    ['f5-big-ip-i5800', 'l4', 'concurrent_sessions', { test_method: 'l4' }],
  ];
  for (const [catalogId, profileId, axis, conditions] of cases) {
    const entry = catalogEntry(catalogId);
    const profile = entry.profiles.find(({ id }) => id === profileId);
    const record = buildSpec(entry, profile).records.find((item) => item.axis === axis);
    assert.equal(evidenceApplicability(record, conditions), 'applicable', `${catalogId}/${profileId}/${axis}`);
  }
});

// ── P1-26 워크로드 조건 입력 ──────────────────────────────────────────────

test('turns a catalog device from uncomputable into computed once the workload says its conditions', () => {
  const topology = withCatalog();
  // 조건을 대조할 워크로드가 없으면 20 Gbps 를 알면서도 사용률을 내지 않는다.
  assert.equal(axisOf(topology, 'forwarding_bps').status, 'unknown');
  assert.equal(axisOf(topology, 'forwarding_bps').evidenceApplicability, 'unknown');
  setWorkloadConditions(topology, firewallOnly);
  assert.equal(axisOf(topology, 'forwarding_bps').evidenceApplicability, 'applicable');
  assert.ok(axisOf(topology, 'forwarding_bps').utilization > 0);
  // 데이터시트가 조건을 밝히지 않은 축은 그대로 미확인이다. 워크로드를 적었다고 알게 되지 않는다.
  assert.equal(axisOf(topology, 'concurrent_sessions').status, 'unknown');
});

test('counts whether an axis could be judged at all, not whether it matched', () => {
  const topology = withCatalog();
  const judgement = (t) => calculateScenario(t).summary.evidenceJudgement;
  assert.deepEqual(judgement(topology), { withRecords: 4, judged: 0, ratio: 0 });
  setWorkloadConditions(topology, { packet_size_bytes: 64, transport: 'udp', features_enabled: [] });
  // 64B 워크로드에 1518B 데이터시트다. 불일치는 판정에 성공한 것이지 실패한 것이 아니다.
  assert.equal(axisOf(topology, 'forwarding_bps').evidenceApplicability, 'incompatible');
  assert.equal(judgement(topology).judged, 1);
});

test('refuses a workload condition it does not know, and keeps an empty list as a value', () => {
  const topology = withCatalog();
  assert.throws(() => setWorkloadConditions(topology, { made_up_key: 1 }), /Unknown workload condition/);
  assert.throws(() => setWorkloadConditions(topology, { transport: '<script>' }), /markup/);
  setWorkloadConditions(topology, { features_enabled: [] });
  assert.deepEqual(topology.workloadConditions, { features_enabled: [] });
  setWorkloadConditions(topology, { features_enabled: null });
  assert.equal(topology.workloadConditions, undefined);
});

// ── P1-39 축 단위 명시 수락 ───────────────────────────────────────────────

test('lets one axis be accepted against a mismatched workload and records who said so', () => {
  const topology = withCatalog();
  setWorkloadConditions(topology, { packet_size_bytes: 64, transport: 'udp', features_enabled: [] });
  assert.equal(axisOf(topology, 'forwarding_bps').status, 'unknown');
  acceptEvidence(topology, 'fw-a', 'forwarding_bps');
  const axis = axisOf(topology, 'forwarding_bps');
  assert.equal(axis.evidenceApplicability, 'user-asserted');
  assert.ok(axis.utilization > 0, '수락한 축은 계산에 쓰인다');
  // 수락하지 않은 축은 그대로다. 프로필을 통째로 통과시키지 않는다.
  assert.equal(axisOf(topology, 'concurrent_sessions').status, 'unknown');
  clearEvidenceAcceptance(topology, 'fw-a', 'forwarding_bps');
  assert.equal(axisOf(topology, 'forwarding_bps').status, 'unknown');
});

test('releases an acceptance when the workload it was made under changes', () => {
  const topology = withCatalog();
  setWorkloadConditions(topology, { packet_size_bytes: 64 });
  acceptEvidence(topology, 'fw-a', 'forwarding_bps');
  assert.equal(axisOf(topology, 'forwarding_bps').evidenceApplicability, 'user-asserted');
  // 512B 로 바꾸면 아까 수락한 것과 다른 불일치다. 다시 물어야 한다.
  setWorkloadConditions(topology, { packet_size_bytes: 512 });
  assert.equal(topology.devices.find(({ id }) => id === 'fw-a').accepted, undefined);
  assert.equal(axisOf(topology, 'forwarding_bps').evidenceApplicability, 'incompatible');
});

test('releases an acceptance when the profile it was made against changes', () => {
  const topology = withCatalog();
  setWorkloadConditions(topology, { packet_size_bytes: 64 });
  acceptEvidence(topology, 'fw-a', 'forwarding_bps');
  const entry = catalogEntry(FORTIGATE);
  applySpec(topology, 'fw-a', buildSpec(entry, entry.profiles.find(({ id }) => id === 'fw-64')));
  assert.equal(topology.devices.find(({ id }) => id === 'fw-a').accepted, undefined);
});

test('will not accept an axis that already matches, and needs a record to accept', () => {
  const topology = withCatalog();
  setWorkloadConditions(topology, firewallOnly);
  assert.throws(() => acceptEvidence(topology, 'fw-a', 'forwarding_bps'), /already matches/);
  // 데이터시트가 값을 적지 않은 축은 수락할 대상이 없다.
  assert.throws(() => acceptEvidence(topology, 'fw-b', 'forwarding_bps'), /no evidence record/);
});

test('carries an acceptance through a project round trip and rejects a forged one', () => {
  const topology = withCatalog();
  setWorkloadConditions(topology, { packet_size_bytes: 64 });
  acceptEvidence(topology, 'fw-a', 'forwarding_bps');
  const scenario = { scale: 1, disabledDevices: [], disabledLinks: [] };
  const reopened = validateProject(JSON.parse(serializeProject(topology, scenario)));
  assert.equal(axisOf(reopened.topology, 'forwarding_bps').evidenceApplicability, 'user-asserted');

  // digest 가 아닌 값을 적어 넣으면 거절한다.
  const forged = JSON.parse(serializeProject(topology, scenario));
  forged.topology.devices.find(({ id }) => id === 'fw-a').accepted.forwarding_bps = 'yes';
  assert.throws(() => validateProject(forged), /evidence digest/);

  // digest 형식은 맞지만 다른 조건에서 만든 것이면 계산이 인정하지 않는다.
  const stale = JSON.parse(serializeProject(topology, scenario));
  const device = stale.topology.devices.find(({ id }) => id === 'fw-a');
  device.accepted.forwarding_bps = acceptanceDigest(device.spec.records[0], { packet_size_bytes: 9000 }, null);
  assert.equal(axisOf(validateProject(stale).topology, 'forwarding_bps').evidenceApplicability, 'incompatible');
});
