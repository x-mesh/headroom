import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { server } from '../scripts/serve.mjs';

await mkdir('.impeccable/review', { recursive: true });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const browser = await chromium.launch();
const failures = [];

async function verify(viewport, screenshot, interact = false) {
  const page = await browser.newPage({ viewport });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#summary-faults').textContent(), '00');
  assert.equal(await page.locator('#run-state').textContent(), 'BASELINE STABLE');
  assert.ok(await page.locator('.packet-dot').count() > 0, 'active links must render packet dots');
  const packet = page.locator('.packet-dot').first();
  const packetBefore = await packet.boundingBox();
  await page.waitForTimeout(240);
  const packetAfter = await packet.boundingBox();
  assert.ok(packetBefore && packetAfter && (Math.abs(packetBefore.x - packetAfter.x) > 1 || Math.abs(packetBefore.y - packetAfter.y) > 1), 'packet dot must move along an active link');
  const liveBefore = await page.locator('#summary-headroom').getAttribute('data-live-value');
  await page.waitForTimeout(900);
  const liveAfter = await page.locator('#summary-headroom').getAttribute('data-live-value');
  assert.notEqual(liveBefore, liveAfter, 'synthetic telemetry must update the displayed value');
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(bodyOverflow <= 1, `body overflows horizontally by ${bodyOverflow}px`);
  if (viewport.width <= 760) {
    assert.equal(await page.locator('.mobile-fault-tray').isVisible(), true);
    assert.match(await page.locator('.mobile-pan-cue').textContent(), /좌우로 탐색/);
    await page.locator('[data-quick-failure="fw-a"]').click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '01');
    assert.equal(await page.locator('[data-quick-failure="fw-a"]').getAttribute('aria-pressed'), 'true');
  }
  if (interact) {
    const failure = page.locator('[data-failure-type="device"][data-failure-id="fw-a"]');
    await failure.click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '01');
    assert.equal(await failure.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#run-state').textContent(), 'CAPACITY EXCEEDED');
    assert.match(await page.locator('#comparison-grid').textContent(), /CHANGED/);
    await page.locator('[data-device-id="fw-b"]').click();
    assert.match(await page.locator('#inspector-content').textContent(), /신규 세션/);
    assert.match(await page.locator('#inspector-content').textContent(), /용량 초과/);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-editor-action="new"]').click();
    assert.equal(await page.locator('.mesh-node').count(), 0);
    assert.match(await page.locator('#inspector-content').textContent(), /장비가 없습니다/);
    for (const [name, kind] of [['Source A', 'switch'], ['Target A', 'server']]) {
      await page.locator('[data-editor-action="device"]').click();
      const form = page.locator('[data-editor-form="device"]');
      await form.locator('[name="name"]').fill(name);
      await form.locator('[name="kind"]').selectOption(kind);
      await form.locator('[name="forwarding_bps"]').fill('10000000000');
      await form.locator('button[type="submit"]').click();
    }
    assert.equal(await page.locator('.mesh-node').count(), 2);
    const sourceNode = page.locator('[data-device-id="source-a"]');
    const beforeDrag = await sourceNode.boundingBox();
    await sourceNode.dragTo(page.locator('#topology-canvas'), { targetPosition: { x: 220, y: 180 } });
    const afterDrag = await sourceNode.boundingBox();
    assert.ok(beforeDrag && afterDrag && Math.abs(beforeDrag.x - afterDrag.x) > 10);
    await page.locator('[data-editor-action="connect"]').click();
    await page.locator('[data-device-id="source-a"]').click();
    await page.locator('[data-device-id="target-a"]').click();
    assert.equal(await page.locator('.link-group').count(), 1);
    await page.locator('[data-editor-action="demand"]').click();
    await page.locator('[data-new-demand]').click();
    const demandForm = page.locator('[data-editor-form="demand"]');
    await demandForm.locator('[name="name"]').fill('Source to target');
    await demandForm.locator('button[type="submit"]').click();
    assert.match(await page.locator('#path-readout').textContent(), /1 DEMANDS · 1 ACTIVE PATHS/);
    await page.locator('[data-editor-action="demand"]').click();
    const demandEditor = page.locator('[data-editor-form="demand-edit"]');
    await demandEditor.locator('[name="forwarding_bps"]').fill('2000000000');
    await demandEditor.locator('button[type="submit"]').click();
    assert.equal(await page.locator('[data-editor-form="demand-edit"] [name="forwarding_bps"]').inputValue(), '2000000000');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-editor-action="save"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const project = JSON.parse(await readFile(downloadPath, 'utf8'));
    assert.equal(project.schemaVersion, 1);
    assert.equal(project.topology.devices.length, 2);
    assert.equal(project.topology.links.length, 1);
    assert.equal(project.topology.demands.length, 1);
    await page.locator('#device-file-input').setInputFiles({ name: 'device.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ manufacturer: { name: 'Acme' }, model: 'Leaf 48', slug: 'acme-leaf-48', interfaces: [{ name: 'eth1', type: '25gbase-x-sfp28' }] })) });
    const importedForm = page.locator('[data-editor-form="device"]');
    assert.equal(await importedForm.locator('[name="name"]').inputValue(), 'Acme Leaf 48');
    await importedForm.locator('[name="name"]').fill('<img src=x onerror=window.__rackMeshXss=1>');
    await importedForm.locator('button[type="submit"]').click();
    assert.equal(await page.locator('.mesh-node').count(), 3);
    assert.equal(await page.evaluate(() => window.__rackMeshXss), undefined);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#project-file-input').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 2);
    assert.equal(await page.locator('.link-group').count(), 1);
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
}

try {
  await verify({ width: 1440, height: 1000 }, '.impeccable/review/desktop.png', true);
  await verify({ width: 390, height: 844 }, '.impeccable/review/mobile.png');
  const reducedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reducedPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  assert.equal(await reducedPage.locator('.packet-dot').first().evaluate((node) => getComputedStyle(node).display), 'none');
  await reducedPage.close();
  assert.deepEqual(failures, []);
  console.log('Browser smoke passed: interaction, overflow, console, desktop and mobile captures');
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
