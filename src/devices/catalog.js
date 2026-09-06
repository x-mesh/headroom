// 장비 카탈로그의 단일 진입점. 클래스별 파일을 합치기만 하고 값은 갖지 않는다.
// 엔진은 이 폴더 전체를 모른다(PRD 8절: 엔진 코드에 벤더 데이터를 두지 않는다).
import { firewallCatalog } from './firewalls.js';
import { routerCatalog } from './routers.js';
import { switchCatalog } from './switches.js';

export const deviceCatalog = Object.freeze([...firewallCatalog, ...switchCatalog, ...routerCatalog]);

export function catalogEntry(id) {
  return deviceCatalog.find((entry) => entry.id === id) || null;
}

export function catalogProfile(entryId, profileId) {
  const entry = catalogEntry(entryId);
  if (!entry) return null;
  return entry.profiles.find((profile) => profile.id === profileId) || entry.profiles[0];
}

/** 이 클래스에 고를 수 있는 장비가 있는지. 없으면 화면은 직접 입력만 보여준다. */
export function catalogFor(kind) {
  return deviceCatalog.filter((entry) => entry.kind === kind);
}
