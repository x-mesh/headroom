// 장비 카탈로그의 단일 진입점. 클래스별 파일을 합치기만 하고 값은 갖지 않는다.
// 엔진은 이 폴더 전체를 모른다(PRD 8절: 엔진 코드에 벤더 데이터를 두지 않는다).
import { adapterCatalog } from './adapters.js';
import { balancerCatalog } from './balancers.js';
import { firewallCatalog } from './firewalls.js';
import { routerCatalog } from './routers.js';
import { storageCatalog } from './storage.js';
import { switchCatalog } from './switches.js';
import { wirelessCatalog } from './wireless.js';
import { buildSpec } from '../evidence.js';
import { localizedCatalog, localizedSourceLabel } from '../i18n.js';
export { buildSpec } from '../evidence.js';

function localizeProfile(entry, profile) {
  const source = { ...profile, records: buildSpec(entry, profile).records };
  return { ...source, get label() { return localizedCatalog(entry.id, profile.id, 'label', profile.label ?? profile.id); }, get note() { return localizedCatalog(entry.id, profile.id, 'note', profile.note ?? ''); } };
}

export const deviceCatalog = Object.freeze([
  ...firewallCatalog, ...switchCatalog, ...routerCatalog, ...balancerCatalog, ...storageCatalog, ...wirelessCatalog, ...adapterCatalog,
].map((entry) => ({ ...entry, get source() { return entry.source ? { ...entry.source, label: localizedSourceLabel(entry.source.type, entry.source.label) } : entry.source; }, profiles: entry.profiles.map((profile) => localizeProfile(entry, profile)) })));

export function catalogEntry(id) {
  return deviceCatalog.find((entry) => entry.id === id) || null;
}

export function catalogProfile(entryId, profileId) {
  const entry = catalogEntry(entryId);
  if (!entry) return null;
  return entry.profiles.find((profile) => profile.id === profileId) || entry.profiles[0];
}

// 어댑터처럼 여러 클래스에 꽂히는 항목은 kinds 로 적는다. 한 클래스에만 해당하면 kind 다.
export function catalogFor(kind) {
  return deviceCatalog.filter((entry) => (entry.kinds ? entry.kinds.includes(kind) : entry.kind === kind));
}
