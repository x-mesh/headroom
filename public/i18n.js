import en from './locales/en.js';
import ko from './locales/ko.js';
import ja from './locales/ja.js';

export const SUPPORTED_LOCALES = Object.freeze(['en', 'ko', 'ja']);
export const LOCALE_STORAGE_KEY = 'rack-mesh-locale';
const DICTIONARIES = Object.freeze({ en, ko, ja });
const warned = new Set();
let activeLocale = globalThis.document ? resolveInitialLocale() : 'ko';
const ERROR_CODES = Object.freeze({
  '랙 이름을 입력하세요.': 'rackNameRequired', 'A rack name is required.': 'rackNameRequired',
  '같은 이름의 랙이 있습니다.': 'rackNameDuplicate', 'A rack with this name already exists.': 'rackNameDuplicate',
  '랙 공간은 1U에서 100U 사이여야 합니다.': 'rackCapacityInvalid', 'Rack capacity must be between 1U and 100U.': 'rackCapacityInvalid',
  '전력 예산은 0보다 커야 합니다.': 'rackPowerInvalid', 'Power budget must be positive.': 'rackPowerInvalid',
  '전력 기준이 올바르지 않습니다.': 'rackPowerBasisInvalid', 'Power basis is invalid.': 'rackPowerBasisInvalid',
  '랙 배치가 겹칩니다.': 'rackPlacementOverlap', 'Rack placements overlap.': 'rackPlacementOverlap',
});

function localeBase(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const base = normalized.split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

function readStorage() {
  try { return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) || null; }
  catch { return null; }
}

export function resolveLocale(value) { return localeBase(value) || 'en'; }
export function getLocale() { return activeLocale; }
export function setLocale(locale) { activeLocale = resolveLocale(locale); return activeLocale; }
export function localeFromNavigator(languages = globalThis.navigator?.languages || []) {
  return languages.map(localeBase).find(Boolean) || 'en';
}
export function resolveInitialLocale({ search = globalThis.location?.search || '', storage = readStorage(), languages = globalThis.navigator?.languages || [] } = {}) {
  const query = new URLSearchParams(search).get('lang');
  return localeBase(query) || localeBase(storage) || localeFromNavigator(languages);
}

function getPath(dictionary, path) {
  return String(path).split('.').reduce((value, key) => value && typeof value === 'object' ? value[key] : undefined, dictionary);
}
function hasMessage(key, locale = activeLocale) { return typeof getPath(DICTIONARIES[resolveLocale(locale)], key) === 'string'; }

function placeholders(value) { return [...String(value).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(([, name]) => name).sort(); }
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn('[i18n] ' + message);
}

export function t(key, values = {}, locale = activeLocale) {
  const selected = resolveLocale(locale);
  const value = getPath(DICTIONARIES[selected], key);
  const fallback = getPath(DICTIONARIES.en, key);
  const source = typeof value === 'string' ? value : typeof fallback === 'string' ? fallback : key;
  if (typeof value !== 'string') warnOnce('missing key ' + key + ' for ' + selected);
  const expected = placeholders(source);
  const supplied = Object.keys(values).sort();
  if (expected.some((name) => !(name in values))) warnOnce('missing value for ' + key + ': ' + expected.filter((name) => !(name in values)).join(', '));
  const rendered = source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => name in values ? String(values[name]) : match);
  if (supplied.some((name) => !expected.includes(name))) warnOnce('extra value for ' + key + ': ' + supplied.filter((name) => !expected.includes(name)).join(', '));
  return rendered || key;
}

// Bundled labels use stable IDs. Keep imported and user-authored text outside this path.
export function localizedAxis(axis, field = 'label', fallback = axis) {
  const key = `content.axis.${axis}.${field}`;
  return hasMessage(key) ? t(key) : fallback;
}

export function localizedBehavior(kind, mode, field = 'label', fallback = mode) {
  const key = `content.behavior.${kind}.${mode}.${field}`;
  return hasMessage(key) ? t(key) : fallback;
}

export function localizedTemplate(id, field, fallback = id) {
  const key = `content.template.${id}.${field}`;
  const selected = getPath(DICTIONARIES[resolveLocale(activeLocale)], key);
  const english = getPath(DICTIONARIES.en, key);
  if (typeof selected === 'string' && !(getLocale() === 'ko' && selected === english)) return selected.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) => name === 'id' ? id : match);
  if (getLocale() === 'ko') return fallback;
  const fallbackKey = field.startsWith('tag.') ? 'content.template.tagFallback' : `content.template.fallback${field[0].toUpperCase()}${field.slice(1)}`;
  return hasMessage(fallbackKey) ? t(fallbackKey, field === 'name' ? { id } : {}) : fallback;
}

export function localizedBundledLabel(id, fallback, bundled = false) {
  const key = `content.bundled.${id}`;
  return bundled && id === 'pdu-3' && fallback === 'PDU-3 SPINE 공용 전원' && hasMessage(key) ? t(key) : fallback;
}

export function localizedCatalog(entryId, profileId, field, fallback = profileId) {
  const key = `content.catalog.${entryId}.${profileId}.${field}`;
  const selected = getPath(DICTIONARIES[resolveLocale(activeLocale)], key);
  const english = getPath(DICTIONARIES.en, key);
  if (typeof selected === 'string' && !(getLocale() === 'ko' && selected === english)) return selected;
  if (getLocale() === 'ko') return fallback;
  return field === 'note' ? t('content.catalog.noteFallback') : t('content.catalog.profileFallback');
}


export function localizedSourceLabel(type, fallback = '') {
  if (getLocale() === 'ko') return fallback;
  return type === 'datasheet' ? t('report.datasheet') : type === 'estimate' ? t('report.estimate') : type === 'user_measured' ? t('report.measured') : fallback;
}

export function localizeError(error) {
  const message = error?.message ?? String(error ?? '');
  const code = error?.code || ERROR_CODES[message] || message;
  const key = `error.editor.${code}`;
  if (hasMessage(key)) return t(key);
  return message;
}

export function formatNumber(value, options = {}, locale = activeLocale) { return new Intl.NumberFormat(resolveLocale(locale), options).format(value); }
export function formatDate(value, options = {}, locale = activeLocale) { return new Intl.DateTimeFormat(resolveLocale(locale), options).format(new Date(value)); }
export function formatPercent(value, options = {}, locale = activeLocale) { return formatNumber(value, { style: 'percent', maximumFractionDigits: 0, ...options }, locale); }
export function formatCount(value, locale = activeLocale) { return formatNumber(value, { maximumFractionDigits: 0 }, locale); }

export function validateDictionaries() {
  const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => value && typeof value === 'object' ? flatten(value, prefix ? prefix + '.' + key : key) : [[prefix ? prefix + '.' + key : key, value]]);
  const baseline = new Map(flatten(en));
  const errors = [];
  for (const locale of SUPPORTED_LOCALES.slice(1)) {
    const current = new Map(flatten(DICTIONARIES[locale]));
    for (const key of baseline.keys()) if (!current.has(key)) errors.push(locale + ' missing ' + key);
    for (const key of current.keys()) if (!baseline.has(key)) errors.push(locale + ' extra ' + key);
    for (const [key, value] of baseline) if (current.has(key) && JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(current.get(key)))) errors.push(locale + ' placeholder mismatch ' + key);
  }
  return errors;
}

export function localizeDocument(locale = activeLocale, documentRef = globalThis.document) {
  const selected = setLocale(locale);
  if (!documentRef) return selected;
  documentRef.documentElement.lang = selected;
  documentRef.title = t('meta.title');
  documentRef.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  documentRef.querySelector('meta[property="og:title"]')?.setAttribute('content', t('meta.ogTitle'));
  documentRef.querySelector('meta[property="og:description"]')?.setAttribute('content', t('meta.ogDescription'));
  documentRef.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  documentRef.querySelectorAll('[data-i18n-aria-label]').forEach((node) => node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)));
  documentRef.querySelectorAll('[data-i18n-title]').forEach((node) => node.setAttribute('title', t(node.dataset.i18nTitle)));
  documentRef.querySelectorAll('[data-i18n-placeholder]').forEach((node) => node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder)));
  documentRef.documentElement.style.setProperty('--font-ui-locale', selected === 'ko' ? 'var(--font-ui-ko)' : selected === 'ja' ? 'var(--font-ui-ja)' : 'var(--font-ui-en)');
  const selector = documentRef.querySelector('[data-language-select]');
  if (selector) { selector.value = selected; selector.setAttribute('aria-label', t('navigation.language')); }
  localizeLegacyText(documentRef);
  return selected;
}

export function localizeLegacyText(documentRef = globalThis.document) {
  if (!documentRef) return;
  const dictionary = getPath(DICTIONARIES[getLocale()], 'legacy') || {};
  const walker = documentRef.createTreeWalker(documentRef.body, globalThis.NodeFilter?.SHOW_TEXT || 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest('script,style,textarea,input,[data-i18n-ignore],[data-content-owned],.mesh-node,.rack-device,.diagram-layer,.drawio-import-layer,.rack-elevation')) continue;
    const source = node.nodeValue.trim();
    if (!source || !Object.hasOwn(dictionary, source)) continue;
    const translated = node.nodeValue.replace(source, dictionary[source]);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  for (const node of documentRef.querySelectorAll('[aria-label], [placeholder], [title]')) {
    if (node.matches('input,textarea') || node.closest('[data-content-owned],.mesh-node,.diagram-layer,.drawio-import-layer,.rack-elevation,.rack-placement')) continue;
    for (const attribute of ['aria-label', 'placeholder', 'title']) {
      const value = node.getAttribute(attribute);
      if (value && Object.hasOwn(dictionary, value) && dictionary[value] !== value) node.setAttribute(attribute, dictionary[value]);
    }
  }
  if (getLocale() === 'ko') return;
  const focused = getLocale() === 'ja'
    ? [['정방향', '正方向'], ['역방향', '逆方向'], ['Throughput', 'スループット'], ['Packets', 'パケット'], ['Sessions', 'セッション'], ['New sessions', '新規セッション'], ['New TLS', '新規TLS'], ['Resumed TLS', '再開TLS'], ['미확인', '不明'], ['일반 부하', '通常負荷'], ['명판값', '銘板値'], ['토폴로지 연결', 'トポロジー接続'], ['기능 비활성', '機能無効'], ['합성 데모 값', '合成デモ値'], ['장비와 측정 프로필', '機器と測定プロファイル'], ['검색해서 장비 고르기', '検索して機器を選択'], ['실제 설계에는 동일 조건의 측정값을 사용하세요.', '実際の設計には同じ条件の測定値を使ってください。'], ['공용 전원', '共有電源'], ['이중화 무효', '冗長性無効'], ['단절', '切断'], ['견딤', '吸収'], ['부하', '負荷'], ['용량', '容量'], ['여유', '余裕'], ['가장 빠듯한 곳', '最も逼迫した箇所'], ['편집', '編集'], ['실행 취소', '元に戻す'], ['다시 실행', 'やり直す'], ['이중화 무효 도메인 실험', '冗長性無効ドメイン実験'], ['장애 실험', '障害実験'], ['정상 상태', '正常状態'], ['정상', '正常'], ['라우터', 'ルーター'], ['스위치', 'スイッチ'], ['랙', 'ラック'], ['공간', '空間'], ['검사', '検査'], ['부족', '不足'], ['지금', '現在'], ['배', '倍'], ['어떻게 될까요?', 'どうなるでしょうか？'], ['도메인 실험', 'ドメイン実験'], ['장애', '障害'], ['이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.', 'このモードは通過バイトを変えません。セッション所有者と障害ドメインだけを変えます。'], ['토폴로지', 'トポロジー'], ['연결', '接続']]
    : [['정방향', 'Forward'], ['역방향', 'Reverse'], ['미확인', 'Unknown'], ['일반 부하', 'Typical load'], ['명판값', 'Nameplate'], ['토폴로지 연결', 'Topology link'], ['기능 비활성', 'feature disabled'], ['합성 데모 값', 'Synthetic demo value'], ['장비와 측정 프로필', 'Device and measurement profile'], ['검색해서 장비 고르기', 'Search and select a device'], ['실제 설계에는 동일 조건의 측정값을 사용하세요.', 'Use measurements with the same conditions for a real design.'], ['공용 전원', 'shared power'], ['이중화 무효', 'redundancy invalid'], ['단절', 'severed'], ['견딤', 'absorbed'], ['부하', 'Load'], ['용량', 'Capacity'], ['여유', 'Headroom'], ['가장 빠듯한 곳', 'Tightest point'], ['편집', 'Edit'], ['실행 취소', 'Undo'], ['다시 실행', 'Redo'], ['이중화 무효 도메인 실험', 'Invalid redundancy domain experiment'], ['장애 실험', 'fault experiment'], ['정상 상태', 'normal state'], ['정상', 'Healthy'], ['라우터', 'router'], ['스위치', 'switch'], ['랙', 'rack'], ['공간', 'Space'], ['검사', 'Checks'], ['부족', 'shortfall'], ['지금', 'Current'], ['현재', 'Current'], ['배', '×'], ['어떻게 될까요?', 'What happens?'], ['도메인 실험', 'domain experiment'], ['장애', 'fault'], ['이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.', 'This mode does not change bytes in transit. It changes session ownership and fault domains.'], ['router', 'router'], ['switch', 'switch'], ['공용 전원', 'shared power'], ['토폴로지', 'topology'], ['연결', 'link']];
  const replaceFragments = (value) => {
    let result = String(value).replace(/(\d+)개/g, (_, count) => t('common.items', { count }));
    result = result.replace(/(\d+)대/g, (_, count) => `${count} ${getLocale() === 'ja' ? '台' : 'devices'}`);
    if (getLocale() === 'en') {
      result = result.replace(/지금 부하의 ([\d.]+)배까지 버팁니다/g, 'Survives up to $1× under the current load');
      result = result.replace(/이중화 무효 도메인 실험: (.+?)를 끄면 어떻게 될까요\?/g, 'Invalid redundancy domain experiment: What happens if you disable $1?');
      result = result.replace('이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.', 'This mode does not change bytes in transit. It changes session ownership and fault domains.');
    } else if (getLocale() === 'ja') {
      result = result.replace(/지금 부하의 ([\d.]+)배까지 버팁니다/g, '現在の負荷の$1倍まで耐えます');
      result = result.replace(/이중화 무효 도메인 실험: (.+?)를 끄면 어떻게 될까요\?/g, '冗長性無効ドメイン実験: $1を停止するとどうなるでしょうか？');
      result = result.replace('이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.', 'このモードは通過バイトを変えません。セッション所有者と障害ドメインだけを変えます。');
    }
    for (const [source, translated] of focused) result = result.split(source).join(translated);
    result = result.replace(/ · 토폴로지 연결$/g, ` · ${getLocale() === 'ja' ? 'トポロジー接続' : 'Topology link'}`);
    if (getLocale() === 'en') {
      result = result.replace(/([^:]+): ([^?]+)를 끄면 어떻게 될까요\?/g, '$1: What happens if you disable $2?');
      result = result.replace(/([^:]+): ([^?]+) 장애 실험/g, '$1: $2 fault experiment');
      result = result.replace(/검사 (\d+ items?) · ([^·]+) (\d+ items?) · Capacity 부족/g, 'Checks $1 · $2 $3 · Capacity shortfall');
    } else if (getLocale() === 'ja') {
      result = result.replace(/([^:]+): ([^?]+)를 끄면 어떻게 될까요\?/g, '$1: $2を停止するとどうなるでしょうか？');
      result = result.replace(/([^:]+): ([^?]+) 장애 실험/g, '$1: $2障害実験');
    }
    return result;
  };
  const fragmentWalker = documentRef.createTreeWalker(documentRef.body, globalThis.NodeFilter?.SHOW_TEXT || 4);
  const fragmentNodes = [];
  while (fragmentWalker.nextNode()) fragmentNodes.push(fragmentWalker.currentNode);
  for (const node of fragmentNodes) {
    if (node.parentElement?.closest('script,style,textarea,input,[data-i18n-ignore],[data-content-owned],.mesh-node,.rack-device,.diagram-layer,.drawio-import-layer,.rack-elevation')) continue;
    const translated = replaceFragments(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  for (const node of documentRef.querySelectorAll('[aria-label], [placeholder], [title]')) {
    if (node.matches('input,textarea') || node.closest('[data-content-owned],.mesh-node,.diagram-layer,.drawio-import-layer,.rack-elevation')) continue;
    for (const attribute of ['aria-label', 'placeholder', 'title']) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, replaceFragments(value));
    }
  }
}

export function localizeRenderedDocument(documentRef = globalThis.document) {
  localizeLegacyText(documentRef);
  const selected = getLocale();
  if (selected !== 'ko') {
    const replaceSystem = (value) => {
      let result = String(value);
      if (selected === 'en') {
        result = result.replace(/지금 부하의 ([\d.]+)배까지 버팁니다/g, 'Survives up to $1× under the current load');
        result = result.replace(/이중화 무효 도메인 실험: (.+?)를 끄면 어떻게 될까요\?/g, 'Invalid redundancy domain experiment: What happens if you disable $1?');
        result = result.replace('이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.', 'This mode does not change bytes in transit. It changes session ownership and fault domains.');
      } else {
        result = result.replace(/지금 부하의 ([\d.]+)배까지 버팁니다/g, '現在の負荷の$1倍まで耐えます');
        result = result.replace(/이중화 무효 도메인 실험: (.+?)를 끄면 어떻게 될까요\?/g, '冗長性無効ドメイン実験: $1を停止するとどうなるでしょうか？');
        result = result.replace('이 모드는 지나는 바이트를 바꾸지 않습니다. 세션 소유와 장애 도메인만 달라집니다.', 'このモードは通過バイトを変えません。セッション所有者と障害ドメインだけを変えます。');
      }
      result = result.replace(/ · 토폴로지 연결$/g, ` · ${selected === 'ja' ? 'トポロジー接続' : 'Topology link'}`);
      return result;
    };
    const walker = documentRef.createTreeWalker(documentRef.body, globalThis.NodeFilter?.SHOW_TEXT || 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest('script,style,textarea,input,[data-i18n-ignore],[data-content-owned],.mesh-node,.diagram-layer,.drawio-import-layer,.rack-elevation')) continue;
      const replaced = replaceSystem(node.nodeValue);
      if (replaced !== node.nodeValue) node.nodeValue = replaced;
    }
  }
  return documentRef;
}


export function selectLocale(locale, { locationRef = globalThis.location, historyRef = globalThis.history, storageRef = globalThis.localStorage, reload = true } = {}) {
  const selected = resolveLocale(locale);
  try { storageRef?.setItem(LOCALE_STORAGE_KEY, selected); }
  catch { warnOnce('language preference could not be saved'); }
  if (!locationRef) return selected;
  const url = new URL(locationRef.href || String(locationRef), 'http://localhost');
  url.searchParams.set('lang', selected);
  const next = url.pathname + url.search + url.hash;
  if (historyRef?.replaceState && locationRef.href) historyRef.replaceState({}, '', next);
  if (reload && locationRef?.reload) locationRef.reload();
  return selected;
}

export function initializeI18n() {
  setLocale(resolveInitialLocale());
  localizeDocument();
  return getLocale();
}

export { DICTIONARIES };
export default { SUPPORTED_LOCALES, getLocale, resolveLocale, resolveInitialLocale, setLocale, selectLocale, t, formatNumber, formatDate, formatPercent, formatCount, localizeDocument, initializeI18n, validateDictionaries };
