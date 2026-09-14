import assert from 'node:assert/strict';
import test from 'node:test';
import { DICTIONARIES, SUPPORTED_LOCALES, formatCount, formatNumber, localizeError, localizedBundledLabel, localizedTemplate, setLocale, t, resolveInitialLocale, resolveLocale, validateDictionaries } from '../public/i18n.js';
import { buildTemplate } from '../public/templates.js';
import { catalogFor } from '../public/devices/catalog.js';

test('locale dictionaries have identical keys and placeholders', () => {
  assert.deepEqual(validateDictionaries(), []);
  assert.deepEqual(Object.keys(DICTIONARIES), SUPPORTED_LOCALES);
});

test('locale resolution follows query, storage, navigator, then English', () => {
  assert.equal(resolveInitialLocale({ search: '?lang=ja', storage: 'ko', languages: ['en-US'] }), 'ja');
  assert.equal(resolveInitialLocale({ search: '?lang=invalid', storage: 'ko-KR', languages: ['en-US'] }), 'ko');
  assert.equal(resolveInitialLocale({ search: '?lang=invalid', storage: 'invalid', languages: ['ja-JP'] }), 'ja');
  assert.equal(resolveInitialLocale({ search: '?lang=invalid', storage: 'invalid', languages: ['fr-FR'] }), 'en');
  assert.equal(resolveLocale('ko-KR'), 'ko');
  assert.equal(resolveLocale('ja_JP'), 'ja');
  assert.equal(resolveLocale('fr-FR'), 'en');
});

test('formatters use the selected locale while messages interpolate', () => {
  assert.equal(formatNumber(1234567.5, { style: 'currency', currency: 'USD' }, 'en'), '$1,234,567.50');
  assert.match(formatNumber(1234567.5, { style: 'currency', currency: 'JPY' }, 'ja'), /￥|￥|1,234,568/);
  assert.equal(t('guide.count', { current: 2, total: 9 }, 'ja'), '2 / 9');
  assert.equal(t('missing.example', {}, 'ko'), 'missing.example');
});

test('bundled templates, catalog profiles, and editor errors use English and Japanese display text', () => {
  setLocale('en');
  const englishTemplate = buildTemplate('dual-fabric');
  const englishProfile = catalogFor('firewall')[0].profiles[0];
  assert.match(englishTemplate.template.name, /Dual-fabric|Template/);
  assert.match(englishProfile.label, /Firewall|Profile|Catalog/);
  assert.equal(localizeError({ message: '랙 이름을 입력하세요.' }), 'Enter a rack name.');

  setLocale('ja');
  const japaneseTemplate = buildTemplate('dual-fabric');
  const japaneseProfile = catalogFor('firewall')[0].profiles[0];
  assert.match(japaneseTemplate.template.name, /デュアル|テンプレート/);
  assert.match(japaneseProfile.label, /ファイアウォール|プロファイル|カタログ/);
  assert.equal(localizeError({ message: '랙 이름을 입력하세요.' }), 'ラック名を入力してください。');
  assert.equal(localizeError({ message: 'Imported label is invalid.' }), 'Imported label is invalid.');
  assert.notEqual(localizedTemplate('dual-fabric', 'summary', 'fallback'), 'SPINE A/B가 PDU-3 공용 전원을 공유하는 ECMP API 구성입니다.');
  setLocale('ko');
});

test('localizes bundled failure-domain and pool labels without changing user content', () => {
  assert.equal(t('dynamic.poolShareExact', { size: 2, percent: 50 }, 'en'), 'Pool 2 devices · 50%');
  assert.equal(t('dynamic.poolShareRange', { size: 2, low: 50, high: 100 }, 'ja'), 'プール2台 · 50～100%');
  assert.equal(localizedBundledLabel('pdu-3', 'PDU-3 SPINE 공용 전원', true), 'PDU-3 SPINE 공용 전원');
  setLocale('en');
  assert.equal(localizedBundledLabel('pdu-3', 'PDU-3 SPINE 공용 전원', true), 'PDU-3 shared spine power');
  setLocale('ja');
  assert.equal(localizedBundledLabel('pdu-3', 'PDU-3 SPINE 공용 전원', true), 'PDU-3 SPINE共有電源');
  assert.equal(localizedBundledLabel('pdu-3', 'PDU-3 SPINE 공용 전원', false), 'PDU-3 SPINE 공용 전원');
  assert.equal(localizedBundledLabel('custom-domain', 'PDU-3 SPINE 공용 전원', true), 'PDU-3 SPINE 공용 전원');
  setLocale('ko');
});
