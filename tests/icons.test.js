import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ICONS, ICON_EXTERNAL, ICON_FALLBACK, ICON_KINDS, ICON_SOURCE, ICON_SPRITE } from '../src/icons.js';

const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('covers every device kind offered by the editor with a fallback', () => {
  const offered = appSource.match(/\['switch',[^\]]*\]/)[0].match(/'([a-z]+)'/g).map((value) => value.slice(1, -1));
  assert.ok(offered.length >= 6);
  for (const kind of offered) assert.ok(ICONS[kind], `${kind} 심볼이 없습니다.`);
  assert.ok(ICONS[ICON_FALLBACK] && ICONS[ICON_EXTERNAL]);
  assert.equal(new Set(ICON_KINDS.map((kind) => ICONS[kind].id)).size, ICON_KINDS.length);
});

test('declares a padded viewBox that covers the stencil box', () => {
  for (const kind of ICON_KINDS) {
    const icon = ICONS[kind];
    const [minX, minY, width, height] = icon.viewBox.split(' ').map(Number);
    assert.ok([minX, minY, width, height].every(Number.isFinite), `${kind} viewBox 파싱 실패`);
    assert.ok(minX < 0 && minY < 0, `${kind}: 스트로크 패딩이 없습니다.`);
    assert.ok(width >= icon.width && height >= icon.height, `${kind}: viewBox가 선언 박스보다 작습니다.`);
  }
});

test('keeps symbol bodies free of scripts and external references', () => {
  for (const kind of ICON_KINDS) {
    const { body } = ICONS[kind];
    for (const pattern of [/<script/i, /href=/i, /xlink:/i, /url\(/i, /on[a-z]+=/i]) {
      assert.doesNotMatch(body, pattern, `${kind}: ${pattern}가 들어 있습니다.`);
    }
    assert.equal((body.match(/<g[\s>]/g) || []).length, (body.match(/<\/g>/g) || []).length, `${kind}: <g> 짝이 맞지 않습니다.`);
  }
});

test('paints only through icon tokens', () => {
  for (const kind of ICON_KINDS) {
    // 리터럴 색은 var() 폴백 자리에만 허용한다. 그 밖의 하드코딩 색은 토큰 오버라이드를 무시한다.
    const stray = ICONS[kind].body.replace(/var\(--icon-[a-z]+,[^)]*\)/g, '');
    assert.doesNotMatch(stray, /#[0-9a-f]{3,8}\b/i, `${kind}: 토큰 밖 색상이 있습니다.`);
  }
});

test('sprite carries every symbol once', () => {
  assert.equal((ICON_SPRITE.match(/<symbol /g) || []).length, ICON_KINDS.length);
  for (const kind of ICON_KINDS) assert.ok(ICON_SPRITE.includes(`id="${ICONS[kind].id}"`), `${kind} 심볼이 스프라이트에 없습니다.`);
  assert.match(ICON_SPRITE, /preserveAspectRatio="xMidYMid meet"/);
});

test('records upstream provenance', () => {
  assert.match(ICON_SOURCE.commit, /^[0-9a-f]{40}$/);
  assert.equal(ICON_SOURCE.license, 'Apache-2.0');
  assert.ok(ICON_SOURCE.notice.endsWith('NOTICE.md'));
});
