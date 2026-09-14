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
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port + '/?lang=ko', { waitUntil: 'networkidle' });
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
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port + '/?lang=ko', { waitUntil: 'networkidle' });
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
    // 0.5U 격자라 시작 U가 포인터 아래 U와 같지 않을 수 있다. 놓인 1U 장비가 포인터 위치를 덮어야 한다.
    const placedStart = Number(/ ([\d.]+)U에 배치했습니다/.exec(placed.toast)?.[1]);
    const pointerU = hit.positionU + 1;
    assert.ok(placedStart <= pointerU && pointerU < placedStart + 1, `드롭한 U와 다른 곳에 배치됐습니다: ${placed.toast} (포인터 U${pointerU.toFixed(2)})`);
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
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port + '/?lang=ko', { waitUntil: 'networkidle' });
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
    assert.match(moved, /RACK 04 ([\d.]+)U로 옮겼습니다/);
    assert.equal(await startU(), Number(/RACK 04 ([\d.]+)U로 옮겼습니다/.exec(moved)[1]), '토스트가 말한 U와 실제 위치가 다릅니다.');

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

    // 끄는 동안 어느 랙이 이 장비를 받을 수 있는지 랙마다 답해야 한다.
    const candidates = await page.evaluate(() => [...document.querySelectorAll('.rack-elevation-wrap')].map((node) => node.dataset.candidate));
    assert.ok(candidates.includes('blocked'), '3U 랙은 4U 장비를 받을 수 없다고 표시해야 합니다.');
    assert.ok(candidates.some((value) => value && value !== 'blocked'), '받을 수 있는 랙이 표시되어야 합니다.');

    await page.mouse.up();
    await page.waitForFunction(() => [...document.querySelectorAll('.rack-device')].some((node) => node.style.getPropertyValue('--rack-height') === '4'));
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.rack-elevation-wrap')].map((node) => node.dataset.candidate ?? null)), [null, null, null], '놓은 뒤에는 후보 표시가 남지 않아야 합니다.');
    // 전력을 입력했으므로 랙 합계가 미확인으로 떨어지지 않아야 한다.
    assert.match(await page.locator('#toast').textContent(), /전력 \d+%/);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('a 0.5U blank panel stacks in half-U steps without covering its neighbor', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();

    await page.locator('[data-rack-sidebar-tab="racks"]').click();
    await page.locator('[data-rack-select="rack-04-budget"]').click();
    await page.locator('[data-rack-sidebar-tab="devices"]').click();
    const blankPanel = page.locator('.rack-palette-item[data-rack-kind="blank-panel"]');
    await blankPanel.click();
    await page.waitForFunction(() => document.querySelectorAll('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device[data-half-u]').length === 1);
    await blankPanel.click();
    await page.waitForFunction(() => document.querySelectorAll('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device[data-half-u]').length === 2);

    const layout = await page.evaluate(() => [...document.querySelectorAll('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device')].map((node) => {
      const box = node.getBoundingClientRect();
      return { half: node.hasAttribute('data-half-u'), start: Number(node.style.getPropertyValue('--rack-start')), top: box.top, bottom: box.bottom, height: box.height, label: node.querySelector('span').textContent };
    }));

    // (i) 반 칸 블록 두 개가 0.5 간격으로 쌓인다.
    const halves = layout.filter((device) => device.half).sort((a, b) => a.start - b.start);
    assert.equal(halves.length, 2, '반 칸 블록이 두 개 있어야 합니다.');
    assert.equal(halves[1].start - halves[0].start, .5, '반 칸 블록의 시작 위치 차이는 0.5여야 합니다.');

    // (ii) 반 칸 블록은 1U 기준 블록(leaf-a)의 절반 높이를 넘지 않는다.
    const leafHeight = layout.find((device) => !device.half && device.start === 1)?.height;
    assert.ok(leafHeight, '1U 기준 블록(leaf-a)을 찾지 못했습니다.');
    for (const half of halves) assert.ok(half.height <= leafHeight / 2 + 1, `반 칸 블록 높이가 너무 큽니다: ${half.height}`);

    // (iii) rack-04의 어떤 블록 쌍도 위 칸을 덮지 않는다.
    for (let i = 0; i < layout.length; i += 1) {
      for (let j = i + 1; j < layout.length; j += 1) {
        const overlap = Math.min(layout[i].bottom, layout[j].bottom) - Math.max(layout[i].top, layout[j].top);
        assert.ok(overlap <= 1, `${layout[i].start}과 ${layout[j].start}가 세로로 겹칩니다.`);
      }
    }

    // (iv) 반 칸 라벨은 placementRangeLabel 규칙(정수 시작 'U4', 반 칸 시작 'U4.5')을 따른다.
    for (const half of halves) assert.equal(half.label, `U${half.start}`);

    // (v) 3D로 전환해도 반 칸 섀시가 오류 없이 그려진다.
    await page.locator('[data-rack-view="3d"]').click();
    await page.waitForFunction(() => window.__rackMeshRack3D?.debug().dropZones > 0);
    assert.equal(pageErrors.length, 0, `3D 전환 중 오류가 있었습니다: ${pageErrors.map((error) => error.message).join('; ')}`);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('a 2U server dragged under a 0.5U panel sits flush at a half-U start', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();

    // 사용자가 겪은 배치를 만든다: RACK 04에 0.5U 패널을 넣고 inspector에서 U13.5로 옮긴다.
    await page.locator('[data-rack-sidebar-tab="racks"]').click();
    await page.locator('[data-rack-select="rack-04-budget"]').click();
    await page.locator('[data-rack-sidebar-tab="devices"]').click();
    await page.locator('.rack-palette-item[data-rack-kind="blank-panel"]').click();
    const form = page.locator('form[data-rack-form="placement-edit"]');
    await form.locator('input[name="startU"]').fill('13.5');
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device[data-half-u]')?.style.getPropertyValue('--rack-start') === '13.5');

    // 2U 서버의 중심을 랙 안쪽 바닥에서 11.5U 높이에 놓으면 시작 U는 11.5, 윗면은 패널 아랫면(13.5)이 된다.
    const serverBlock = page.locator('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device').filter({ has: page.locator('strong', { hasText: /^API A$/ }) });
    await serverBlock.scrollIntoViewIfNeeded();
    const from = await serverBlock.boundingBox();
    const dropY = await page.evaluate(() => {
      const node = document.querySelector('.rack-elevation[data-rack-id="rack-04-budget"]');
      const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
      const bottom = box.bottom - parseFloat(style.borderBottomWidth); const top = box.top + parseFloat(style.borderTopWidth);
      return bottom - 11.5 * ((bottom - top) / Number(node.style.getPropertyValue('--rack-capacity')));
    });
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 - 8);
    await page.mouse.move(from.x + from.width / 2, dropY, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => /U로 옮겼습니다/.test(document.getElementById('toast').textContent));
    assert.match(await page.locator('#toast').textContent(), /API A을 RACK 04 11\.5U로 옮겼습니다/);

    const layout = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.rack-elevation[data-rack-id="rack-04-budget"] .rack-device')];
      const serverNode = nodes.find((node) => node.querySelector('strong').textContent === 'API A');
      const panelNode = nodes.find((node) => node.hasAttribute('data-half-u'));
      return { start: serverNode.style.getPropertyValue('--rack-start'), label: serverNode.querySelector('span').textContent, serverTop: serverNode.getBoundingClientRect().top, panelBottom: panelNode.getBoundingClientRect().bottom };
    });
    assert.equal(layout.start, '11.5');
    assert.equal(layout.label, 'U11.5–13');
    assert.ok(Math.abs(layout.serverTop - layout.panelBottom) <= 1, `서버와 패널 사이가 ${layout.panelBottom - layout.serverTop}px 떠 있습니다.`);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('a rack changes its place in the row by dragging its 2D header or with the inspector buttons', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
    await page.locator('[data-workspace="rack"]').click();
    const order = () => page.evaluate(() => [...document.querySelectorAll('#rack-2d-canvas .rack-elevation')].map((node) => node.dataset.rackId));
    assert.deepEqual(await order(), ['security-budget', 'rack-04-budget', 'rack-07-budget']);

    // RACK 07 머리글을 잡아 SECURITY 왼쪽에 놓는다. 끄는 동안 놓일 자리가 보여야 한다.
    const handle = await page.locator('[data-rack-order-handle="rack-07-budget"]').boundingBox();
    const firstHandle = await page.locator('[data-rack-order-handle="security-budget"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 20, handle.y + handle.height / 2);
    await page.mouse.move(firstHandle.x + 10, firstHandle.y + firstHandle.height / 2, { steps: 10 });
    assert.equal(await page.locator('.rack-elevation-wrap[data-order-drop="before"] [data-rack-order-handle="security-budget"]').count(), 1, '놓일 자리 표시가 SECURITY 왼쪽에 없습니다.');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#rack-2d-canvas .rack-elevation')?.dataset.rackId === 'rack-07-budget');
    assert.deepEqual(await order(), ['rack-07-budget', 'security-budget', 'rack-04-budget']);
    assert.match(await page.locator('#toast').textContent(), /RACK 07을 1번째 자리로 옮겼습니다/);
    assert.equal(await page.locator('[data-order-drop]').count(), 0, '놓은 뒤에는 자리 표시가 남지 않아야 합니다.');

    // 옮긴 랙이 선택되고, 맨 앞이므로 왼쪽 버튼은 막혀 있다. 오른쪽 버튼으로 한 칸 옮긴다.
    assert.equal(await page.locator('[data-rack-action="move-rack-left"]').isDisabled(), true);
    await page.locator('[data-rack-action="move-rack-right"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#rack-2d-canvas .rack-elevation')[1]?.dataset.rackId === 'rack-07-budget');
    assert.deepEqual(await order(), ['security-budget', 'rack-07-budget', 'rack-04-budget']);
    assert.match(await page.locator('#toast').textContent(), /RACK 07을 2번째 자리로 옮겼습니다/);
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
    await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
    await page.goto('http://127.0.0.1:' + port + '/?lang=ko', { waitUntil: 'networkidle' });
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
    const target = Number(/ ([\d.]+)U로 옮겼습니다/.exec(toast)[1]);
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
