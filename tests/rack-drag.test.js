import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { server } from '../scripts/serve.mjs';

test('a full render keeps the rack palette drag and pointer capture alive', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();

    const source = page.locator('.rack-palette-item[data-rack-palette-type="standalone"]').first();
    const rack = page.locator('.rack-elevation').nth(1);
    const sourceBox = await source.boundingBox();
    const rackBox = await rack.boundingBox();
    assert.ok(sourceBox && rackBox);
    const placementsBefore = await page.locator('.rack-device').count();
    await source.evaluate((node) => node.addEventListener('pointerdown', (event) => { window.__rackDragTestPointerId = event.pointerId; }, { once: true }));

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 20, sourceBox.y + sourceBox.height / 2 + 6);
    const pointerId = await page.evaluate(() => window.__rackDragTestPointerId);
    assert.equal(await source.evaluate((node, id) => node.hasPointerCapture(id), pointerId), true);

    await page.locator('#scale-input').evaluate((input) => {
      input.value = '101';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await source.evaluate((node, id) => node.isConnected && node.hasPointerCapture(id), pointerId), true);

    await page.mouse.move(rackBox.x + rackBox.width / 2, Math.min(988, rackBox.y + rackBox.height * .55));
    await page.mouse.up();
    await page.waitForFunction((before) => document.querySelectorAll('.rack-device').length === before + 1, placementsBefore);
    assert.equal(await page.locator('.rack-device').count(), placementsBefore + 1);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});
