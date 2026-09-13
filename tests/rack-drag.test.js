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

test('the 3D rack view accepts a palette drop on the U the pointer is over', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();
    await page.locator('[data-rack-view="3d"]').click();
    await page.waitForFunction(() => window.__rackMeshRack3D?.debug().dropZones > 0);

    // 랙이 개방형 프레임이므로 배선은 전면에서도 보여야 한다.
    assert.ok(await page.evaluate(() => window.__rackMeshRack3D.debug().cables) > 0, '전면 뷰에 케이블이 없습니다.');
    await page.locator('[data-rack-cables]').click();
    await page.waitForFunction(() => window.__rackMeshRack3D.debug().cables === 0);
    await page.locator('[data-rack-cables]').click();
    await page.waitForFunction(() => window.__rackMeshRack3D.debug().cables > 0);

    // 카메라 각도에 의존하지 않도록, 씬에 직접 물어 빈 U 위의 화면 좌표를 찾는다.
    const hit = await page.evaluate(() => {
      const stage = document.getElementById('rack-3d-stage').getBoundingClientRect();
      for (let ty = .2; ty < .95; ty += .04) for (let tx = .15; tx < .9; tx += .04) {
        const x = stage.left + stage.width * tx; const y = stage.top + stage.height * ty;
        const target = window.__rackMeshRack3D.dropTarget(x, y);
        if (target && target.hoveredU >= 10) return { x, y, ...target };
      }
      return null;
    });
    assert.ok(hit, '3D 스테이지에서 랙 위의 드롭 지점을 찾지 못했습니다.');

    const source = page.locator('.rack-palette-item[data-rack-palette-type="standalone"][data-rack-height="1"]').first();
    const sourceBox = await source.boundingBox();
    const meshesBefore = await page.evaluate(() => window.__rackMeshRack3D.debug().meshes);
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit.x - 40, hit.y - 20, { steps: 6 });
    await page.mouse.move(hit.x, hit.y, { steps: 6 });
    assert.equal(await page.evaluate(() => window.__rackMeshRack3D.debug().dropPreview), true, '드래그 중 3D 드롭 미리보기가 보이지 않습니다.');
    await page.mouse.up();

    await page.waitForFunction((before) => window.__rackMeshRack3D.debug().meshes > before, meshesBefore);
    const placed = await page.evaluate(() => {
      const rack = window.__rackMeshRack3D.debug();
      return { meshes: rack.meshes, toast: document.getElementById('toast').textContent.trim() };
    });
    assert.match(placed.toast, new RegExp(`${hit.hoveredU}U에 배치했습니다`), `드롭한 U와 다른 곳에 배치됐습니다: ${placed.toast}`);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('the 2D rack stage moves a placed device and catches drops away from the rack', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();

    const device = page.locator('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device').first();
    const startU = () => device.evaluate((node) => Number(node.style.getPropertyValue('--rack-start')));
    const before = await startU();
    await device.scrollIntoViewIfNeeded();
    const from = await device.boundingBox();
    const rack = await page.locator('.rack-elevation[data-rack-id="rack-04-budget"]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 - 8);
    await page.mouse.move(rack.x + rack.width / 2, rack.y + rack.height * .3, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction((was) => {
      const node = document.querySelector('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device');
      return node && Number(node.style.getPropertyValue('--rack-start')) !== was;
    }, before);
    const moved = await page.locator('#toast').textContent();
    assert.match(moved, /RACK 04 (\d+)U로 옮겼습니다/);
    assert.equal(await startU(), Number(/RACK 04 (\d+)U로 옮겼습니다/.exec(moved)[1]), '토스트가 말한 U와 실제 위치가 다릅니다.');

    // 랙에서 멀리 떨어진 스테이지 여백도 랙 무대다. 여기서 버리면 사용자는 이유 없는 실패만 본다.
    const placementsBefore = await page.locator('.rack-device').count();
    const stage = await page.locator('#rack-2d-scroll').boundingBox();
    const source = page.locator('.rack-palette-item[data-rack-palette-type="standalone"]').first();
    const sourceBox = await source.boundingBox();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width - 30, stage.y + stage.height - 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction((count) => document.querySelectorAll('.rack-device').length === count + 1, placementsBefore);

    // 팔레트에서 고른 U 와 전력이 그대로 배치에 실려야 한다.
    const serverRow = page.locator('.rack-palette-row').filter({ has: page.locator('[data-rack-palette-type="standalone"][data-rack-kind="server"]') });
    await serverRow.locator('[data-rack-height-pick="4"]').click();
    await serverRow.locator('.rack-palette-watts input').fill('450');
    const tallSource = await serverRow.locator('.rack-palette-item').boundingBox();
    await page.mouse.move(tallSource.x + tallSource.width / 2, tallSource.y + tallSource.height / 2);
    await page.mouse.down();
    await page.mouse.move(rack.x + rack.width / 2, rack.y + rack.height * .6, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => [...document.querySelectorAll('.rack-device')].some((node) => node.style.getPropertyValue('--rack-height') === '4'));
    // 전력을 입력했으므로 랙 합계가 미확인으로 떨어지지 않아야 한다.
    assert.match(await page.locator('#toast').textContent(), /전력 \d+%/);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('the 3D rack view drags a placed device to another U without orbiting', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();
    await page.locator('[data-rack-view="3d"]').click();
    await page.waitForFunction(() => window.__rackMeshRack3D?.debug().dropZones > 0);

    const scan = await page.evaluate(() => {
      const stage = document.getElementById('rack-3d-stage').getBoundingClientRect();
      let device = null; let empty = null;
      for (let ty = .2; ty < .98; ty += .01) for (let tx = .15; tx < .95; tx += .01) {
        const x = stage.left + stage.width * tx; const y = stage.top + stage.height * ty;
        if (!device) { const hit = window.__rackMeshRack3D.placementAt(x, y); if (hit) device = { x, y, ...hit }; }
        if (!empty) { const target = window.__rackMeshRack3D.dropTarget(x, y); if (target && target.hoveredU >= 20 && target.hoveredU <= 30) empty = { x, y, ...target }; }
      }
      return { device, empty };
    });
    assert.ok(scan.device && scan.empty, '3D 스테이지에서 장비와 빈 U 지점을 찾지 못했습니다.');

    await page.mouse.move(scan.device.x, scan.device.y);
    await page.mouse.down();
    await page.mouse.move(scan.device.x + 8, scan.device.y - 8);
    await page.mouse.move(scan.empty.x, scan.empty.y, { steps: 10 });
    assert.equal(await page.evaluate(() => window.__rackMeshRack3D.debug().dropPreview), true, '재배치 드래그 중 미리보기가 없습니다.');
    await page.mouse.up();
    await page.waitForFunction(() => /U로 옮겼습니다/.test(document.getElementById('toast').textContent));

    const toast = await page.locator('#toast').textContent();
    const target = Number(/ (\d+)U로 옮겼습니다/.exec(toast)[1]);
    await page.locator('[data-rack-view="2d"]').click();
    const placed = await page.evaluate((placementId) => {
      const node = document.querySelector(`[data-rack-placement="${placementId}"]`);
      return node ? Number(node.style.getPropertyValue('--rack-start')) : null;
    }, scan.device.placementId);
    assert.equal(placed, target, '3D에서 끌어 놓은 U와 실제 배치가 다릅니다.');
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});
