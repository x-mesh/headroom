// 노드 한 개를 무엇으로 그릴지 고르는 곳. 화면(src/app.js)과 내보내기(src/diagram.js)가
// 같은 함수를 부른다. 두 곳이 각자 축을 고르면 위키에 붙인 그림이 화면과 다른 말을 하게 된다.
//
// 여기서는 값만 고른다. 마크업과 색은 부르는 쪽이 정한다.
import { axisCatalog, behaviorCatalog } from './data.js';
import { GLYPHS } from './glyphs.js';
import { ICONS, ICON_FALLBACK, ICON_KINDS } from './icons.js';

export const NODE_AXIS_LIMIT = 4;
export const STATE_TOKEN = { healthy: '.', warning: '!', overloaded: '>', unknown: '?', invalid: 'x', disabled: 'x' };
// 노드가 캔버스에서 차지하는 범위. 그룹 상자가 이 값으로 자식을 감싼다.
export const NODE_REACH = { left: 54, right: 54, top: 18, bottom: 122 };
export const GROUP_PAD = { base: 14, step: 8, label: 17 };

const AXIS_RANK = { overloaded: 0, invalid: 1, warning: 2, healthy: 3, unknown: 4 };
const SI_STEPS = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']];

const KIND_INITIAL = {
  switch: 'SW', router: 'RT', hub: 'HB', modem: 'MD', wireless: 'WL',
  firewall: 'FW', ips: 'IPS', waf: 'WAF', lb: 'LB', vpn: 'VPN', sslvpn: 'SSL',
  server: 'SRV', web: 'WEB', vm: 'VM', db: 'DB', mail: 'ML', mainframe: 'MF',
  storage: 'ST', nas: 'NAS', backup: 'BK', client: 'CL', cloud: 'EXT', rack: 'RK',
};
const KIND_ALIAS = { 'load-balancer': 'lb', loadbalancer: 'lb', balancer: 'lb', host: 'server', compute: 'server', vm: 'server', nas: 'storage', san: 'storage' };

export const kindInitial = (kind) => KIND_INITIAL[String(kind).toLowerCase()] || String(kind).slice(0, 3).toUpperCase();
export const nodeAxisLabel = (key) => axisCatalog[key]?.nodeLabel || key.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase();
export const zonePath = (zone) => String(zone || '').split('/').map((part) => part.trim()).filter(Boolean);

/** 노드 폭 안에 들어가도록 단위를 떼고 5자 이내로 줄인다. 단위는 축 이름 열이 지시한다. */
export function formatNodeValue(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const [factor, suffix] = SI_STEPS.find(([step]) => Math.abs(value) >= step) || [1, ''];
  const scaled = value / factor;
  return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(scaled >= 10 ? 1 : 2)}${suffix}`;
}

export function formatNodePercent(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** kind 는 임의 문자열이라 목록 밖 값이 들어온다. 화이트리스트를 통과한 이름만 돌려준다. */
export function symbolFor(kind) {
  const key = String(kind ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // 목록에 정확히 있는 kind 는 별칭보다 앞선다. 그러지 않으면 vm 이 server 심볼로 그려진다.
  const exact = ICONS[key] ? key : (KIND_ALIAS[key] || key);
  const name = ICONS[exact] ? exact : (ICON_KINDS.find((candidate) => key.includes(candidate)) || ICON_FALLBACK);
  // 스텐실이 클래스를 구별해 주지 못해 손으로 그린 심볼이 있으면 그것이 스텐실보다 앞선다.
  return GLYPHS[name] || ICONS[name];
}

export function behaviorToken(device) {
  const catalog = behaviorCatalog[device.kind];
  if (!catalog) return '';
  return catalog.options[device.behavior?.mode ?? catalog.default]?.token || '';
}

/** 선별은 심각도 순으로, 순서는 limits 삽입 순서로. 문제 축은 반드시 노출하면서 행 순서는 흔들리지 않는다. */
export function nodeAxes(device) {
  const entries = Object.entries(device.axes);
  if (entries.length <= NODE_AXIS_LIMIT) return { rows: entries, hidden: 0 };
  const keep = new Set([...entries]
    .sort((a, b) => (AXIS_RANK[a[1].status] ?? 9) - (AXIS_RANK[b[1].status] ?? 9) || (b[1].utilization ?? -1) - (a[1].utilization ?? -1) || a[0].localeCompare(b[0]))
    .slice(0, NODE_AXIS_LIMIT).map(([key]) => key));
  return { rows: entries.filter(([key]) => keep.has(key)), hidden: entries.length - keep.size };
}

/**
 * 노드 하나가 말해야 하는 것 전부. 화면과 내보내기가 이 결과만 읽는다.
 * spof 는 훑기 결과가 있을 때만 채운다 — 없으면 단일 장애점 여부를 모른다는 뜻이지 아니라는 뜻이 아니다.
 */
export function nodeView(device, { verdict = null, poolNote = '' } = {}) {
  const status = device.active ? device.primaryStatus : 'disabled';
  const { rows, hidden } = nodeAxes(device);
  const spof = Boolean(device.active && verdict?.verdict === 'severs' && !verdict.endpoint);
  const idle = device.active && !poolNote && !device.carriesDemand ? '지나는 수요 없음' : '';
  return {
    id: device.id,
    name: device.name || device.id,
    model: device.model || '',
    vendor: device.vendor || '',
    kind: device.kind,
    kindToken: kindInitial(device.kind),
    symbol: symbolFor(device.kind),
    status,
    spof,
    hidden,
    // 이미 죽은 장비에 "이게 죽으면 끊긴다"와 숨긴 축 개수를 붙이는 것은 소음이다.
    meta: [String(device.kind).toUpperCase(), behaviorToken(device), zonePath(device.zone).at(-1) || device.zone,
      spof ? 'SPOF' : '', device.active && hidden ? `+${hidden}` : '', poolNote, idle].filter(Boolean).join(' · '),
    // 죽은 장비에 축별 숫자를 남기면 아직 도는 것처럼 읽힌다. 화면과 같이 한 줄로 줄인다.
    axes: !device.active ? [{ key: 'offline', label: 'OFFLINE', token: 'x', status: 'disabled', binding: false, load: '—', percent: 'DOWN', util: null }] : rows.map(([key, axis]) => ({
      key,
      label: nodeAxisLabel(key),
      token: STATE_TOKEN[axis.status] || '?',
      status: axis.status,
      binding: key === device.bindingAxis,
      load: formatNodeValue(axis.load),
      // unknown 은 백분율을 만들지 않는다. 0% 로 적으면 미확인이 안전으로 읽힌다.
      percent: axis.status === 'unknown' ? '—' : axis.status === 'invalid' ? 'ERR' : formatNodePercent(axis.utilization),
      util: axis.utilization == null ? null : Math.min(axis.utilization, 1.5),
    })),
  };
}

/** zone 의 슬래시 계층으로 중첩 상자를 만든다. 얕은 그룹일수록 여백이 커야 자식을 감싼 것으로 읽힌다. */
export function groupBoxes(devices) {
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
  return [...byPath.values()]
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key))
    .map((entry) => {
      const pad = GROUP_PAD.base + (deepest - entry.depth) * GROUP_PAD.step;
      return {
        key: entry.key, label: entry.label, depth: entry.depth,
        x: entry.box.minX - pad, y: entry.box.minY - pad - GROUP_PAD.label,
        width: entry.box.maxX - entry.box.minX + pad * 2,
        height: entry.box.maxY - entry.box.minY + pad * 2 + GROUP_PAD.label,
      };
    });
}
