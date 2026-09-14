import { mkdir, rename, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { server } from './serve.mjs';

const outputDir = new URL('../.impeccable/guide-recording/', import.meta.url);
const outputPath = fileURLToPath(outputDir);
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const browser = await chromium.launch();
const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const setupPage = await setup.newPage();
await setupPage.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
await setupPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
await setupPage.locator('.workspace-switch [data-workspace="rack"]').click();
for (const name of ['EDGE RACK 08', 'COMPUTE RACK 09', 'STORAGE RACK 10']) {
  await setupPage.locator('.rack-sidebar [data-rack-action="new-rack"]').click();
  const form = setupPage.locator('form[data-rack-form="rack-new"]');
  await form.locator('input[name="name"]').fill(name);
  await form.locator('button[type="submit"]').click();
}
await setupPage.waitForTimeout(300);
const storageState = await setup.storageState();
await setup.close();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  storageState,
  recordVideo: { dir: outputPath, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => document.querySelector('#failure-grade')?.textContent.includes('단일 장애점'));
await page.waitForTimeout(900);

await page.locator('#scale-input').evaluate((input) => {
  input.value = '122';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(1900);

const experiment = page.locator('[data-lesson-action="fault-domain"]');
if (await experiment.count()) await experiment.click();
await page.waitForTimeout(1900);

await page.locator('[data-topology-view="spatial"]').click();
await page.waitForFunction(() => window.__rackMeshSpatial3D?.debug());
await page.waitForTimeout(900);
await page.locator('[data-spatial-orbit="right"]').click();
await page.locator('[data-spatial-orbit="up"]').click();
await page.waitForTimeout(1900);

await page.locator('.workspace-switch [data-workspace="rack"]').click();
await page.waitForTimeout(900);
await page.locator('[data-rack-view="3d"]').click();
await page.waitForFunction(() => window.__rackMeshRack3D?.debug());
await page.waitForTimeout(900);
const serverItem = page.locator('[data-rack-palette-type][data-rack-kind="server"]').first();
const rackTarget = page.locator('#rack-3d-stage canvas');
const beforePlacements = await page.locator('[data-rack-placement]').count();
const sourceBox = await serverItem.boundingBox();
const targetBox = await rackTarget.boundingBox();
if (sourceBox && targetBox) {
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width * .48, targetBox.y + targetBox.height * .58, { steps: 30 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(350);
  if (await page.locator('[data-rack-placement]').count() === beforePlacements) {
    await serverItem.focus();
    await page.keyboard.press('Enter');
  }
}
await page.waitForTimeout(1400);
await page.locator('[data-rack-domains]').click();
await page.waitForTimeout(2600);

const video = page.video();
await context.close();
const recordedPath = await video.path();
await rename(recordedPath, new URL('guide-preview-raw.webm', outputDir));
await browser.close();
server.close();
console.log(new URL('guide-preview-raw.webm', outputDir).pathname);
