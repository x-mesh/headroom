import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { server } from '../scripts/serve.mjs';

test('the rack view colors power domains and shows what a domain failure stops', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port + '/?lang=ko', { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();

    // 데모의 PDU-3 는 SPINE A·B 를 묶는다. 랙에 넣어야 물리 뷰에서 보인다.
    for (const [rackId, name] of [['rack-04-budget', 'SPINE A'], ['rack-07-budget', 'SPINE B']]) {
      await page.locator('[data-rack-sidebar-tab="racks"]').click();
      await page.locator(`[data-rack-select="${rackId}"]`).click();
      await page.locator('[data-rack-sidebar-tab="devices"]').click();
      await page.locator('.rack-palette-row').filter({ has: page.locator('.rack-palette-item strong', { hasText: new RegExp(`^${name}$`) }) }).locator('.rack-palette-item').click();
    }

    assert.equal(await page.locator('#rack-power-domains').isVisible(), false, '전원 도메인 보기는 기본으로 꺼져 있어야 합니다.');
    await page.locator('[data-rack-domains]').click();
    await page.waitForSelector('.rack-device[data-domain="pdu-3"]');
    const railed = await page.locator('.rack-device[data-domain="pdu-3"]').count();
    assert.equal(railed, 2, '같은 전원 도메인에 물린 장비가 두 랙에서 모두 표시되어야 합니다.');

    // 도메인을 끄면 그 전원에 물린 장비가 랙에서 정지로 보인다.
    await page.locator('[data-power-domain="pdu-3"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.rack-device[data-active="false"]').length === 2);
    const stopped = await page.locator('.rack-device[data-active="false"] strong').allTextContents();
    assert.deepEqual(stopped.sort(), ['SPINE A', 'SPINE B']);

    await page.locator('[data-power-domain="pdu-3"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.rack-device[data-active="false"]').length === 0);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});
