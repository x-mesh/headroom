// 미확인으로 남은 장비 축을 채운다. 엔진이 축을 미확인으로 두는 사유마다 길이 다르고,
// 길마다 근거의 등급이 다르다. 그래서 어느 길도 기본으로 열지 않고 하나씩 켜게 한다.
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptEvidence, setWorkloadConditions } from '../public/editor.js';
import { calculateScenario } from '../public/engine.js';
import { normalizeEvidence } from '../public/evidence.js';
import { parseProject, serializeProject } from '../public/project.js';

const USAGE = `사용법: node scripts/fill-axes.mjs <프로젝트.json> [옵션]

  --out <경로>            결과 경로 (기본: 입력 파일을 덮어쓴다)
  --condition <키>=<값>   워크로드 조건을 선언한다. 여러 번 쓸 수 있다.
                         값에 쉼표가 있으면 목록이 되고, [] 는 빈 목록이다.
                         예: --condition packet_size_bytes=1400 --condition features_enabled=[]
  --accept-evidence      측정 조건이 기록되지 않은 데이터시트 축을 수락한다
  --derive-load          선언한 패킷 크기로 수요의 패킷 부하를 유도한다
  --host-forwarding      호스트(server/storage)의 전달 한계를 NIC 한계와 같다고 둔다
  --derive-pps           데이터시트가 잰 패킷 크기가 선언한 크기와 같은 축만 pps 를 유도한다
  --dry-run              파일을 쓰지 않고 결과만 보고한다

근거의 등급이 다르다. --condition 은 데이터시트가 적은 조건과 우리 트래픽을 맞추는 것이고,
--derive-load 와 --derive-pps 는 그렇게 선언한 조건의 산술 결과다. --accept-evidence 와
--host-forwarding 은 "이 숫자가 우리에게 적용된다"는 사람의 단언이라 화면에 그렇게 표시되고
조건이 바뀌면 풀린다.`;

// 저장소·어댑터 카탈로그가 64바이트 프레임을 672비트로 세는 규약과 같다. 프레임에 프리앰블과
// IFG 20바이트를 더해서 나눈다.
const WIRE_OVERHEAD_BYTES = 20;
const frameBitsFor = (packetBytes) => (packetBytes + WIRE_OVERHEAD_BYTES) * 8;

export function unknownAxisCensus(topology) {
  const result = calculateScenario(topology);
  const reasons = new Map();
  let total = 0;
  for (const device of result.devices) {
    for (const [axis, value] of Object.entries(device.axes || {})) {
      if (value.status !== 'unknown') continue;
      total += 1;
      const key = `${axis} : ${value.unknownReason || '?'}`;
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
  }
  return { total, reasons: [...reasons].sort((a, b) => b[1] - a[1]) };
}

/** 측정 조건이 없어 대조할 수 없는 축을 하나씩 수락한다. 수락은 근거와 조건에 함께 묶인다. */
export function acceptUnmatchedEvidence(topology) {
  let accepted = 0;
  for (const device of topology.devices) {
    const result = calculateScenario(topology).devices.find(({ id }) => id === device.id);
    for (const [axis, value] of Object.entries(result?.axes || {})) {
      if (value.status !== 'unknown' || !value.acceptable) continue;
      // 값이 없는 레코드는 수락할 것이 없다.
      try { acceptEvidence(topology, device.id, axis); accepted += 1; } catch { /* 값 없음 */ }
    }
  }
  return accepted;
}

/** 선언한 패킷 크기에서 수요의 패킷 부하를 유도한다. 새 가정이 아니라 그 선언의 산술 결과다. */
export function deriveDemandPacketLoad(topology) {
  const packetBytes = Number(topology.workloadConditions?.packet_size_bytes);
  if (!Number.isFinite(packetBytes)) throw new Error('워크로드 조건에 packet_size_bytes 가 없어 패킷 부하를 유도할 수 없습니다.');
  const frameBits = frameBitsFor(packetBytes);
  let filled = 0;
  for (const demand of topology.demands) {
    const bps = demand.load?.forwarding_bps;
    if (!Number.isFinite(bps) || demand.load.forwarding_pps != null) continue;
    demand.load = { ...demand.load, forwarding_pps: Math.round(bps / frameBits) };
    filled += 1;
  }
  return { filled, frameBits, packetBytes };
}

function attachRecord(device, axis, record, value) {
  const records = device.spec.records || [];
  const index = records.findIndex((item) => item.axis === axis);
  if (index >= 0) records[index] = record; else records.push(record);
  device.spec.records = records;
  device.spec.limits = { ...device.spec.limits, [axis]: value };
  device.limits = { ...device.limits, [axis]: value };
}

/**
 * 호스트의 전달 한계를 NIC 한계와 같다고 둔다. 전달용 ASIC 이 따로 없어 들어오고 나가는
 * 트래픽이 같은 NIC 하나를 지나기 때문이다. 데이터시트가 적은 값이 아니라 그 구조에서 나오는
 * 값이라 theoretical 로 적는다.
 */
export function deriveHostForwarding(topology) {
  const pairs = [['forwarding_bps', 'nic_bps'], ['forwarding_pps', 'nic_pps']];
  let devices = 0; let axes = 0;
  for (const device of topology.devices) {
    if (!['server', 'storage'].includes(device.kind) || !device.spec) continue;
    let touched = false;
    for (const [target, from] of pairs) {
      const value = device.spec.limits?.[from];
      if (!Number.isFinite(value) || Number.isFinite(device.spec.limits?.[target])) continue;
      attachRecord(device, target, normalizeEvidence({
        axis: target, value, evidenceKind: 'theoretical',
        source: { type: 'theoretical', label: `${from} 에서 유도`, note: '호스트는 전달 경로가 NIC 하나뿐이다' },
      }), value);
      axes += 1; touched = true;
    }
    if (touched) devices += 1;
  }
  return { devices, axes };
}

/**
 * 전달 대역에서 패킷 전달 한계를 유도한다. 데이터시트가 그 대역을 잰 패킷 크기가 우리가 선언한
 * 크기와 같을 때만 나눈다. 크기를 모르는 값을 우리 크기로 나누면 모르는 것을 아는 것처럼 만든다.
 */
export function deriveForwardingPackets(topology) {
  const packetBytes = Number(topology.workloadConditions?.packet_size_bytes);
  if (!Number.isFinite(packetBytes)) throw new Error('워크로드 조건에 packet_size_bytes 가 없어 패킷 한계를 유도할 수 없습니다.');
  const frameBits = frameBitsFor(packetBytes);
  const filled = []; const skipped = [];
  for (const device of topology.devices) {
    const records = device.spec?.records;
    if (!records) continue;
    const source = records.find((item) => item.axis === 'forwarding_bps');
    const existing = records.find((item) => item.axis === 'forwarding_pps');
    if (!source || !Number.isFinite(source.value) || Number.isFinite(existing?.value)) continue;
    if (Number(source.conditions?.packet_size_bytes) !== packetBytes) {
      skipped.push({ device: device.name || device.id, at: source.conditions?.packet_size_bytes ?? '조건 없음' });
      continue;
    }
    const value = Math.round(source.value / frameBits);
    attachRecord(device, 'forwarding_pps', normalizeEvidence({
      axis: 'forwarding_pps', value, evidenceKind: 'theoretical',
      conditions: structuredClone(source.conditions),
      scope: structuredClone(source.scope ?? null),
      source: { type: 'theoretical', label: 'forwarding_bps 를 선언한 패킷 크기로 나눔', note: `${source.value / 1e9} Gbps ÷ ${frameBits} bit` },
    }), value);
    filled.push({ device: device.name || device.id, value });
  }
  return { filled, skipped, frameBits };
}

export function parseConditionValue(raw) {
  if (raw === '[]') return [];
  if (raw.includes(',')) return raw.split(',').map((item) => item.trim()).filter(Boolean);
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
}

function parseArgs(argv) {
  const options = { conditions: {}, out: null, accept: false, load: false, host: false, pps: false, dryRun: false };
  let file = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => { const value = argv[index + 1]; if (value == null) throw new Error(`${arg} 에 값이 필요합니다.`); index += 1; return value; };
    if (arg === '--out') options.out = next();
    else if (arg === '--accept-evidence') options.accept = true;
    else if (arg === '--derive-load') options.load = true;
    else if (arg === '--host-forwarding') options.host = true;
    else if (arg === '--derive-pps') options.pps = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--condition') {
      const pair = next(); const split = pair.indexOf('=');
      if (split < 1) throw new Error(`--condition 은 <키>=<값> 형식입니다: ${pair}`);
      options.conditions[pair.slice(0, split)] = parseConditionValue(pair.slice(split + 1));
    } else if (arg.startsWith('-')) throw new Error(`모르는 옵션입니다: ${arg}`);
    else if (file) throw new Error('입력 파일은 하나만 받습니다.');
    else file = arg;
  }
  if (!file) throw new Error(USAGE);
  return { file, options };
}

function report(topology, label) {
  const { total, reasons } = unknownAxisCensus(topology);
  console.log(`${label} — 미확인 축 ${total}`);
  for (const [key, count] of reasons) console.log(`  ${String(count).padStart(3)}  ${key}`);
  return total;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.length < 3) { console.log(USAGE); return; }
  const { file, options } = parseArgs(process.argv.slice(2));
  const { topology } = parseProject(await readFile(file, 'utf8'));
  console.log(`${basename(file)} · 장비 ${topology.devices.length} · 링크 ${topology.links.length} · 수요 ${topology.demands.length}\n`);
  report(topology, '시작');

  if (Object.keys(options.conditions).length) {
    setWorkloadConditions(topology, options.conditions);
    console.log(`\n워크로드 조건 ${JSON.stringify(topology.workloadConditions)}`);
    report(topology, '조건 선언 후');
  }
  if (options.host) {
    const { devices, axes } = deriveHostForwarding(topology);
    console.log(`\n호스트 ${devices}대에 전달 한계 ${axes}축을 NIC 한계에서 유도했습니다.`);
  }
  if (options.pps) {
    const { filled, skipped, frameBits } = deriveForwardingPackets(topology);
    console.log(`\n전달 대역 ÷ ${frameBits} bit 로 패킷 한계 ${filled.length}축을 유도했습니다.`);
    for (const { device, value } of filled) console.log(`  ${device.padEnd(26)} ${value.toLocaleString()} pps`);
    for (const { device, at } of skipped) console.log(`  건너뜀 ${device.padEnd(20)} 데이터시트가 잰 패킷 크기 ${at}`);
  }
  if (options.accept) {
    console.log(`\n측정 조건이 없는 축 ${acceptUnmatchedEvidence(topology)}개를 수락했습니다.`);
  }
  if (options.load) {
    const { filled, frameBits, packetBytes } = deriveDemandPacketLoad(topology);
    console.log(`\n${packetBytes}바이트 = 프레임 ${frameBits} bit · 수요 ${filled}개에 패킷 부하를 넣었습니다.`);
  }
  if (options.host || options.pps || options.accept || options.load) report(topology, '\n마침');

  const result = calculateScenario(topology);
  const worst = result.devices
    .flatMap((device) => Object.entries(device.axes || {})
      .filter(([, axis]) => axis.utilization != null)
      .map(([axis, value]) => ({ id: device.id, axis, utilization: value.utilization })))
    .sort((a, b) => b.utilization - a.utilization).slice(0, 5);
  if (worst.length) {
    console.log('\n가장 빠듯한 장비 축');
    const name = new Map(topology.devices.map((device) => [device.id, device.name]));
    for (const entry of worst) console.log(`  ${String(name.get(entry.id) || entry.id).padEnd(26)} ${entry.axis.padEnd(16)} ${(entry.utilization * 100).toFixed(2)}%`);
  }
  if (options.dryRun) { console.log('\n--dry-run · 파일을 쓰지 않았습니다.'); return; }
  const out = serializeProject(topology, { scale: 1 });
  parseProject(out);
  await writeFile(options.out || file, out);
  console.log(`\n저장 ${options.out || file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
