import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ICONS, ICON_EXTERNAL, ICON_FALLBACK, ICON_KINDS, ICON_SOURCE, ICON_SPRITE } from '../src/icons.js';

const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('covers every device kind offered by the editor with a fallback', () => {
  // 편집기가 내놓는 클래스 목록은 팔레트 하나뿐이다. 장비 추가 폼도 여기서 읽어 쓴다.
  const offered = [...appSource.match(/const PALETTE = \[[\s\S]*?\n\];/)[0].matchAll(/kind: '([a-z]+)'/g)].map(([, kind]) => kind);
  assert.ok(offered.length >= 20, `팔레트 클래스가 ${offered.length}개뿐입니다.`);
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

test('vendor marks resolve from a manufacturer string and stay optional', async () => {
  const { VENDOR_LOGOS, VENDOR_LOGO_SOURCE, vendorLogoFor } = await import('../src/logos.js');
  assert.ok(Object.keys(VENDOR_LOGOS).length >= 12, 'the catalog covers the manufacturers this tool draws');
  for (const [slug, mark] of Object.entries(VENDOR_LOGOS)) {
    assert.match(slug, /^[a-z0-9]+$/, `${slug} must be a normalized key`);
    assert.match(mark.hex, /^#[0-9a-f]{6}$/);
    assert.match(mark.path, /^[Mm]/, `${slug} must carry one path`);
  }
  // 사용자가 어떻게 적든 같은 마크를 찾아야 한다.
  for (const written of ['Cisco', 'CISCO', 'cisco', ' cisco ']) assert.equal(vendorLogoFor(written)?.title, 'Cisco');
  assert.equal(vendorLogoFor('Juniper Networks')?.title, 'Juniper Networks');
  // 카탈로그에 없는 제조사는 마크가 없고, 화면은 약칭 배지로 떨어진다.
  assert.equal(vendorLogoFor('Arista'), null);
  assert.equal(vendorLogoFor(''), null);
  assert.equal(vendorLogoFor(undefined), null);
  assert.equal(VENDOR_LOGO_SOURCE.license, 'CC0-1.0');
  assert.match(VENDOR_LOGO_SOURCE.note, /trademarks of their owners/);
});


test('hand-drawn symbols meet the generated symbols on every rule', async () => {
  const { GLYPHS, GLYPH_KINDS, GLYPH_SPRITE } = await import('../src/glyphs.js');
  assert.ok(GLYPH_KINDS.length >= 1);
  for (const kind of GLYPH_KINDS) {
    const glyph = GLYPHS[kind];
    // 손으로 그린 심볼은 스텐실이 구별해 주지 못하는 클래스만 덮는다. 그 클래스는 스텐실에도 있어야
    // 대체 경로(kind 부분 일치)가 같은 이름으로 떨어진다.
    assert.ok(ICONS[kind], `${kind}: 스텐실에 없는 클래스입니다.`);
    assert.notEqual(glyph.id, ICONS[kind].id, `${kind}: 심볼 id가 생성물과 겹칩니다.`);
    const [minX, minY, width, height] = glyph.viewBox.split(' ').map(Number);
    assert.ok(minX < 0 && minY < 0, `${kind}: 스트로크 패딩이 없습니다.`);
    assert.ok(width >= glyph.width && height >= glyph.height, `${kind}: viewBox가 선언 박스보다 작습니다.`);
    for (const pattern of [/<script/i, /href=/i, /xlink:/i, /url\(/i, /on[a-z]+=/i]) {
      assert.doesNotMatch(glyph.body, pattern, `${kind}: ${pattern}가 들어 있습니다.`);
    }
    assert.equal((glyph.body.match(/<g[\s>]/g) || []).length, (glyph.body.match(/<\/g>/g) || []).length, `${kind}: <g> 짝이 맞지 않습니다.`);
    // 리터럴 색은 var() 폴백 자리에만 허용한다. 그래야 상태 색과 비활성 처리가 스텐실과 같이 반응한다.
    assert.doesNotMatch(glyph.body.replace(/var\(--icon-[a-z]+,[^)]*\)/g, ''), /#[0-9a-f]{3,8}\b/i, `${kind}: 토큰 밖 색상이 있습니다.`);
    assert.match(glyph.body, /stroke:var\(--icon-line,currentColor\)/, `${kind}: 선 색이 토큰이 아닙니다.`);
  }
  assert.equal((GLYPH_SPRITE.match(/<symbol /g) || []).length, GLYPH_KINDS.length);
  assert.match(GLYPH_SPRITE, /preserveAspectRatio="xMidYMid meet"/);
});
