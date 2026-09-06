import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { server } from '../scripts/serve.mjs';
import { cloneTopology } from '../src/data.js';

await mkdir('.impeccable/review', { recursive: true });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const browser = await chromium.launch();
const failures = [];

// 캔버스 편집은 선택·스크롤·설계를 모두 바꾸므로 깨끗한 페이지에서 따로 확인한다.
async function verifyCanvasEditing() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  // 링크 위에 노드가 겹칠 수 있으니 실제로 링크가 잡히는 지점을 찾는다.
  const linkHit = await page.evaluate(() => {
    for (const hit of document.querySelectorAll('.link-hit')) {
      const box = hit.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) continue;
      for (let t = 0.2; t <= 0.8; t += 0.1) {
        const x = box.left + box.width * t;
        const y = box.top + box.height * (box.height > box.width ? t : 0.5);
        if (document.elementFromPoint(x, y) === hit) return { x, y };
      }
    }
    return null;
  });
  assert.ok(linkHit, 'a link must be reachable by pointer somewhere along its length');
  await page.mouse.click(linkHit.x, linkHit.y);
  await page.waitForFunction(() => document.querySelector('.resource-identity')?.textContent.includes('→'));
  assert.match(await page.locator('.resource-identity strong').textContent(), /^[^-]+ → /, 'a link reads by its endpoints, never by its id');

  await page.mouse.click(linkHit.x, linkHit.y, { button: 'right' });
  await page.waitForSelector('#context-menu [role="menuitem"]');
  assert.deepEqual(await page.locator('#context-menu [role="menuitem"]').allTextContents(), ['삭제', '장애 주입']);
  const linkCount = await page.locator('.link-group').count();
  await page.locator('[data-context-action="delete"]').click();
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before - 1, linkCount);
  await page.locator('[data-toast-undo]').click();
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before, linkCount);

  const someNode = page.locator('.mesh-node:not(.disabled)').first();
  await someNode.click({ button: 'right' });
  await page.waitForSelector('#context-menu [role="menuitem"]');
  assert.deepEqual(await page.locator('#context-menu [role="menuitem"]').allTextContents(), ['삭제', '복제', '여기서 링크 시작', '장애 주입']);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.contextAction), 'duplicate', 'arrow keys move through the menu');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#context-menu')?.hidden);

  // 핸들에서 끌어 링크를 잇는다.
  const nodeCount = await page.locator('.link-group').count();
  await someNode.hover();
  const handle = await someNode.locator('[data-port="right"]').boundingBox();
  const other = await page.locator('.mesh-node:not(.disabled)').nth(1).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y + 20, { steps: 4 });
  assert.equal(await page.locator('.link-draft').count(), 1, 'dragging a port shows where the link would go');
  await page.mouse.move(other.x + other.width / 2, other.y + 15, { steps: 8 });
  assert.equal(await page.locator('.mesh-node.link-target').count(), 1, 'the node under the pointer marks itself as the target');
  await page.mouse.up();
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before + 1, nodeCount);
  assert.equal(await page.locator('.link-draft').count(), 0, 'the rubber band does not outlive the drop');
  await page.locator('[data-toast-undo]').click();
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before, nodeCount);
  // 토스트는 화면 하단에 고정이라 아래쪽 노드를 덮는다. 다음 클릭 전에 걷히기를 기다린다.
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });
  await page.close();
}

async function verify(viewport, screenshot, interact = false) {
  const page = await browser.newPage({ viewport });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#summary-faults').textContent(), '00');
  // 캔버스 아래가 지금 무엇이 막고 있는지 문장으로 말해야 한다.
  const restingNote = await page.locator('#bottleneck-note').textContent();
  assert.match(restingNote, /가장 빠듯합니다/);
  assert.match(restingNote, /LEAF B → API 02/, 'a link must read by its endpoints, not its id');
  // 엔진이 주의로 판정한 자원이 있으면 상단도 그렇게 말해야 한다. 데모는 3개로 시작한다.
  assert.match(await page.locator('#run-state').textContent(), /^CAPACITY WARNING · \d+$/,
    'a design with warning-tier resources must not read as stable');
  assert.match(await page.locator('#topology-heading').textContent(), /\d+%$/, 'the canvas headline states the answer, not the question');
  assert.equal(await page.locator('#summary-headroom').getAttribute('data-tone'), 'amber', 'headroom is coloured by the engine threshold');
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

  const symbols = await page.evaluate(() => {
    const canvas = document.querySelector('#topology-canvas').getBoundingClientRect();
    const svg = document.querySelector('#link-layer').getBoundingClientRect();
    return [...document.querySelectorAll('.mesh-node')].map((node) => {
      const use = node.querySelector('.node-glyph use');
      const box = use?.getBBox();
      const symbol = node.querySelector('.node-symbol').getBoundingClientRect();
      return {
        id: node.dataset.deviceId,
        resolved: !!(use && document.querySelector(use.getAttribute('href'))),
        painted: !!box && box.width * box.height > 0,
        insideCanvas: node.getBoundingClientRect().bottom <= canvas.bottom + 1,
        center: [symbol.left + symbol.width / 2 - svg.left, symbol.top + symbol.height / 2 - svg.top],
      };
    });
  });
  assert.equal(symbols.length, await page.locator('.mesh-node').count());
  for (const symbol of symbols) {
    assert.ok(symbol.resolved, `${symbol.id}: <use> href does not resolve to a symbol`);
    assert.ok(symbol.painted, `${symbol.id}: symbol renders an empty box`);
    assert.ok(symbol.insideCanvas, `${symbol.id}: node overflows the canvas bottom`);
  }
  const anchored = await page.evaluate(() => {
    const line = document.querySelector('[data-link-id="edge-a-fw-a"] .link');
    const [originX, originY] = document.querySelector('#link-layer').getAttribute('viewBox').split(' ').map(Number);
    return [Number(line.getAttribute('x2')) - originX, Number(line.getAttribute('y2')) - originY];
  });
  const target = symbols.find((symbol) => symbol.id === 'fw-a').center;
  assert.ok(Math.abs(target[0] - anchored[0]) < 1.5 && Math.abs(target[1] - anchored[1]) < 1.5,
    `link endpoint ${anchored} must land on the symbol center ${target.map((value) => Math.round(value))}`);
  assert.equal(await page.locator('[data-device-id="fw-a"] .node-axis').count(), 4, 'firewall shows one row per configured axis');
  assert.equal(await page.locator('[data-device-id="api-a"] .node-axis').count(), 2, 'server shows one row per configured axis');
  const unknownAxis = await page.locator('[data-device-id="api-a"] .node-axis').last().innerText();
  assert.match(unknownAxis, /—/, 'an unknown limit must read as an em dash');
  assert.doesNotMatch(unknownAxis, /\d%/, 'an unknown limit must never read as a percentage');
  assert.equal(await page.locator('#tab-palette').getAttribute('aria-selected'), 'true', 'the component tab opens first');
  await page.locator('#tab-failure').click();
  assert.ok(await page.locator('.topology-group').count() > 0, 'zones must draw as group boxes');
  assert.ok(await page.locator('.topology-group[data-depth="2"]').count() > 0, 'a slash in a zone nests one box inside another');
  assert.ok(await page.locator('.node-axis[style*="--util"]').count() > 0, 'a judged axis carries the meter value');

  // 심볼과 클래스 표기는 확정됐다. 배지만 취향이라 토글로 남아 있다.
  assert.equal(await page.locator('[data-class-badge]').count(), 2);
  await page.locator('[data-class-badge="on"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.node-class-badge').length > 0);
  assert.equal(await page.locator('[data-device-id="fw-a"] .node-class-badge').textContent(), 'FW');
  await page.locator('[data-class-badge="off"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.node-class-badge').length === 0);
  assert.ok(await page.locator('.mesh-node .node-vendor-mark').count() > 0, 'a known manufacturer draws its mark');
  assert.ok(await page.locator('.mesh-node .node-vendor').count() > 0, 'a manufacturer with no mark falls back to a text badge');
  assert.equal(await page.locator('[data-device-id="leaf-a"] .node-model').textContent(), 'DEMO-LEAF-12G');
  assert.equal(await page.locator('[data-device-id="api-a"] .node-axis[data-axis-state="unknown"][style*="--util"]').count(), 0,
    'an unknown limit must draw no meter, so it never reads as spare capacity');

  assert.equal(await page.locator('.failure-switch').count(), 20, 'every device and link must be failable, not two classes');
  assert.match(await page.locator('#failure-grade').textContent(), /단일 장애점 \d+개/, 'the panel must grade the design before anything is turned off');
  const forecasts = await page.locator('.failure-forecast').evaluateAll((nodes) => nodes.map((node) => node.dataset.verdict));
  assert.ok(forecasts.every((verdict) => ['severs', 'overloads', 'absorbs', 'endpoint'].includes(verdict)), 'every row must carry a forecast');
  assert.equal(forecasts[0], 'severs', 'the rows that sever the service sort first');
  assert.match(await page.locator('#bottleneck-note').textContent(), /단일 장애점이 \d+개/, 'the note must name the design as single-point');
  assert.ok(await page.locator('.mesh-node', { hasText: 'SPOF' }).count() > 0, 'a single point of failure must be marked on the canvas too');
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
    const faultNote = await page.locator('#bottleneck-note').textContent();
    assert.match(faultNote, /한계를 넘었습니다/);
    assert.match(faultNote, /버려집니다/, 'the note must say what the overload costs');
    assert.match(faultNote, /거절됩니다/, 'refused sessions are separate from dropped bytes');
    await page.waitForTimeout(900);
    assert.match(await page.locator('[data-device-id="fw-a"]').innerText(), /OFFLINE[\s\S]*DOWN/, 'a disabled node must stay DOWN across telemetry ticks');
    await page.locator('[data-failure-type="link"][data-failure-id="spine-a-leaf-a"]').click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '02');
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('[data-link-id="spine-a-leaf-a"] .link-label').textContent(), 'DOWN',
      'a disabled link must stay DOWN across telemetry ticks, not drift to 0%');
    // 끈 것은 fw-a 하나인데 거기 붙은 링크도 트래픽이 흐를 수 없다.
    assert.equal(await page.locator('[data-link-id="edge-a-fw-a"] .link').getAttribute('class'), 'link disabled',
      'a link hanging off a dead device must not draw as an idle healthy line');
    assert.equal(await page.locator('[data-link-id="edge-a-fw-a"] .link-label').textContent(), 'DOWN');
    assert.match(await page.locator('[data-link-id="edge-a-fw-a"] .link-hit').getAttribute('aria-label'), /끊김/);
    const cross = await page.locator('[data-device-id="fw-a"] .node-symbol')
      .evaluate((node) => getComputedStyle(node, '::before').width);
    assert.equal(cross, '40px', 'a dead device must carry a cross over its symbol, not colour alone');
    await page.locator('[data-failure-type="link"][data-failure-id="spine-a-leaf-a"]').click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '01');
    assert.match(await page.locator('#comparison-grid').textContent(), /CHANGED/);

    // 데이터시트 프로필과 사용자 보정
    await page.locator('[data-device-id="fw-b"]').click();
    await page.selectOption('[data-spec-field="catalog"]', 'fortinet-fortigate-100f');
    await page.waitForFunction(() => document.querySelector('.source-note')?.textContent.includes('데이터시트'));
    assert.match(await page.locator('.limit-field small').first().textContent(), /데이터시트 20 Gbps/);
    await page.selectOption('[data-spec-field="profile"]', 'threat');
    await page.waitForFunction(() => document.querySelector('#inspector-content')?.textContent.includes('위협 방어'));
    const threatAxes = await page.locator('[data-device-id="fw-b"] .node-axis').evaluateAll((rows) =>
      rows.map((row) => `${row.querySelector('b').textContent}:${row.dataset.axisState}`));
    assert.ok(threatAxes.includes('BPS:overloaded'), 'threat protection drops 20 Gbps to 1 Gbps');
    assert.ok(threatAxes.includes('CPS:unknown'), 'the datasheet says nothing about sessions under inspection, so it stays unknown');

    await page.selectOption('[data-spec-field="profile"]', 'fw-1518');
    await page.waitForFunction(() => document.querySelector('input[name="new_sessions_per_sec"]')?.value === '56000');
    await page.locator('input[name="new_sessions_per_sec"]').fill('40000');
    await page.locator('[data-resource-form="device"] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.limit-field.corrected'));
    assert.match(await page.locator('.source-note b').textContent(), /보정한 축이 1개/);
    assert.match(await page.locator('.limit-field.corrected small').textContent(), /데이터시트 56 Kcps/,
      'the datasheet value stays visible next to the correction');
    await page.locator('[data-reset-axis="new_sessions_per_sec"]').click();
    await page.waitForFunction(() => document.querySelector('input[name="new_sessions_per_sec"]')?.value === '56000');
    assert.equal(await page.locator('.limit-field.corrected').count(), 0);
    await page.selectOption('[data-spec-field="catalog"]', '');
    await page.waitForFunction(() => !document.querySelector('[data-spec-field="profile"]'));
    // 스펙을 바꾸면 토폴로지가 커밋되고 시나리오가 초기화된다. 장애 흐름을 이어가려면 다시 주입한다.
    await failure.click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '01');

    await failure.click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '00');
    const severs = page.locator('.failure-switch').filter({ has: page.locator('.failure-forecast[data-verdict="severs"]') }).first();
    const severId = await severs.getAttribute('data-failure-id');
    await severs.click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '01');
    assert.equal(await page.locator('#run-state').textContent(), 'TRAFFIC UNREACHABLE',
      `the forecast promised ${severId} would sever the service, so turning it off must do that`);
    await page.locator(`[data-failure-id="${severId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '00');
    await failure.click();
    await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '01');
    await page.locator('[data-device-id="fw-b"]').click();
    assert.match(await page.locator('#inspector-content').textContent(), /신규 세션/);
    assert.match(await page.locator('#inspector-content').textContent(), /용량 초과/);

    // 새 설계는 템플릿 목록을 연다. 각 템플릿은 서로 다른 축이 먼저 차는 구성이다.
    const beforePanel = await page.evaluate(() => Math.round(document.querySelector('.main-grid').getBoundingClientRect().top));
    await page.locator('[data-editor-action="new"]').click();
    assert.ok(await page.locator('.template-item').count() >= 16, 'the picker must offer architectures, not just a blank sheet');
    // 목록이 길어지면 검색이 필요하다.
    await page.locator('#template-search').fill('TLS');
    const matched = await page.locator('.template-item:not([hidden])').count();
    assert.ok(matched >= 2 && matched < 16, `search must narrow the list, got ${matched}`);
    assert.match(await page.locator('#template-count').textContent(), /개 일치/);
    await page.locator('#template-search').fill('');
    assert.equal(await page.locator('.template-item:not([hidden])').count(), await page.locator('.template-item').count());
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.main-grid').getBoundingClientRect().top)), beforePanel,
      'the editor panel must float over the page, not push it down');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#editor-panel').isHidden(), true, 'escape must close the panel');
    await page.locator('[data-editor-action="new"]').click();
    await page.locator('[data-template="inline-lb"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 5);
    assert.equal(await page.locator('#toast [data-toast-undo]').count(), 1, 'replacing a design must offer an undo instead of a confirm');
    assert.match(await page.locator('[data-device-id="lb"] .node-meta').textContent(), /INLINE/);
    await page.locator('[data-device-id="lb"]').click();
    assert.equal(await page.locator('.behavior-choice input:checked').inputValue(), 'inline');
    // 바꾸기 전에 결과가 보여야 한다. 토글하고 기억해서 비교하게 만들지 않는다.
    const preview = await page.locator('.behavior-preview').textContent();
    assert.match(preview, /처리량 94% → 9%/);
    assert.match(preview, /제한 축: 처리량 →/);

    await page.locator('.behavior-choice input[value="dsr"]').check();
    await page.waitForFunction(() => document.querySelector('#summary-binding').textContent.includes('TLS'));
    assert.match(await page.locator('[data-device-id="lb"] .node-meta').textContent(), /DSR/,
      'the node must say which mode it runs so the device is findable');
    assert.equal(await page.locator('.behavior-choice input:checked').inputValue(), 'dsr');

    await page.locator('[data-editor-action="new"]').click();
    await page.locator('[data-template="blank"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 0);
    // 되돌리기가 실제로 되돌려야 한다.
    await page.locator('#toast [data-toast-undo]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 5);
    await page.locator('[data-editor-action="new"]').click();
    await page.locator('[data-template="blank"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 0);
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
    assert.equal(project.schemaVersion, 2);
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

    // invalid is unreachable through the editor: finite(min: EPSILON) rejects zero and negative
    // limits, so a project import is the only way in. It must never paint as healthy.
    const brokenTopology = cloneTopology();
    brokenTopology.devices.find((device) => device.id === 'fw-a').limits.new_sessions_per_sec = 0;
    brokenTopology.links.find((link) => link.id === 'edge-a-fw-a').capacity.forwarding_bps = 0;
    const brokenProject = { schemaVersion: 2, product: 'Rack Mesh', topology: brokenTopology,
      scenario: { scale: 1, disabledDevices: [], disabledLinks: [], selectedId: 'fw-a' } };
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#project-file-input').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(brokenProject)) });
    await page.waitForFunction(() => document.querySelector('.link.invalid') && document.querySelector('.axis-row.invalid'));
    const invalidPaint = await page.evaluate(() => {
      const paint = (node, property) => getComputedStyle(node)[property];
      const link = document.querySelector('.link.invalid');
      const healthyLink = document.querySelector('.link.healthy');
      const row = document.querySelector('.axis-row.invalid');
      return {
        linkStroke: paint(link, 'stroke'),
        linkDash: paint(link, 'strokeDasharray'),
        healthyStroke: healthyLink && paint(healthyLink, 'stroke'),
        healthyDash: healthyLink && paint(healthyLink, 'strokeDasharray'),
        rowColor: paint(row.querySelector('.axis-title span:last-child'), 'color'),
        meterPattern: paint(row.querySelector('.axis-meter'), 'backgroundImage'),
        headerColor: paint(document.querySelector('#resource-state'), 'color'),
        headerText: document.querySelector('#resource-state').textContent,
      };
    });
    assert.ok(invalidPaint.healthyStroke, 'the fixture must keep a healthy link to compare against');
    assert.notEqual(invalidPaint.linkStroke, invalidPaint.healthyStroke, 'an invalid link must not paint as healthy');
    assert.notEqual(invalidPaint.linkDash, invalidPaint.healthyDash, 'an invalid link must pair color with a dash pattern');
    assert.equal(invalidPaint.rowColor, invalidPaint.linkStroke, 'the inspector axis must use the invalid state color');
    assert.equal(invalidPaint.headerColor, invalidPaint.linkStroke, 'the inspector header must use the invalid state color');
    assert.equal(invalidPaint.headerText, '입력 오류');
    assert.match(invalidPaint.meterPattern, /gradient/, 'an invalid meter must carry a pattern, not color alone');

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#project-file-input').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 2);

    // 컴포넌트 팔레트: 탭 분리, 캔버스 드롭, 클릭 폴백
    await page.locator('#tab-palette').click();
    assert.equal(await page.locator('#tab-palette').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#panel-failure').isHidden(), true, 'switching tabs must hide the failure panel');
    assert.equal(await page.locator('#failure-count').isHidden(), true, 'the active-fault badge belongs to the failure tab');
    assert.equal(await page.locator('.palette-item').count(), 22, 'the palette covers the classes a real design uses');
    assert.equal(await page.locator('.palette-group').count(), 4, 'the palette groups its classes so a long list stays findable');
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.palette-item use')]
      .every((use) => document.querySelector(use.getAttribute('href')) && use.getBBox().width > 0)), 'every palette symbol must resolve');
    // 스텐실이 클래스를 구별해 주지 못하는 자리에서는 손으로 그린 심볼이 앞선다.
    for (const [kind, id] of [['mail', '#glyph-mail'], ['waf', '#glyph-waf'], ['ips', '#glyph-ips'], ['vpn', '#glyph-vpn'], ['server', '#icon-server'], ['db', '#icon-db']]) {
      assert.equal(await page.locator(`[data-palette-kind="${kind}"] use`).getAttribute('href'), id,
        `${kind} must draw the symbol that tells its class apart`);
    }

    await page.locator('[data-palette-kind="firewall"]').scrollIntoViewIfNeeded();
    const paletteItem = await page.locator('[data-palette-kind="firewall"]').boundingBox();
    const canvasBox = await page.locator('#topology-canvas').boundingBox();
    await page.mouse.move(paletteItem.x + paletteItem.width / 2, paletteItem.y + paletteItem.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 240, canvasBox.y + 300, { steps: 10 });
    assert.equal(await page.locator('.palette-ghost').count(), 1, 'dragging must show a ghost');
    assert.ok(await page.locator('.topology-scroll').evaluate((node) => node.classList.contains('drop-target')), 'the topology area must mark itself as a drop target');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 3);
    const dropped = await page.evaluate(() => {
      const node = document.querySelector('.mesh-node.selected');
      return { left: node.style.left, top: node.style.top, glyph: node.querySelector('use').getAttribute('href'),
        axes: node.querySelectorAll('.node-axis').length, states: [...node.querySelectorAll('.node-axis')].map((row) => row.dataset.axisState) };
    });
    assert.equal(dropped.left, '240px');
    assert.equal(dropped.top, '300px');
    assert.equal(dropped.glyph, '#icon-firewall');
    assert.equal(dropped.axes, 4, 'a firewall must start with the four axes its class uses');
    assert.ok(dropped.states.every((state) => state === 'unknown'), 'a new device must keep its limits unknown');
    assert.equal(await page.locator('.palette-ghost').count(), 0, 'the ghost must not outlive the drop');

    // 캔버스 아래 여백은 영역보다 아래에 있다. 그 자리를 화면 가운데로 끌어올려야 드롭할 수 있다.
    await page.locator('.topology-scroll').evaluate((node) => {
      const canvas = document.querySelector('#topology-canvas');
      node.scrollTop = canvas.offsetTop + canvas.offsetHeight - node.clientHeight / 2;
    });
    const scrolledCanvas = await page.locator('#topology-canvas').boundingBox();
    const scrollBox = await page.locator('.topology-scroll').boundingBox();
    const beyond = Math.min(scrolledCanvas.y + scrolledCanvas.height + 60, scrollBox.y + scrollBox.height - 20);
    assert.ok(beyond > scrolledCanvas.y + scrolledCanvas.height, 'the fixture needs slack below the canvas to drop into');
    const beforeEdgeDrop = await page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.querySelector('#topology-canvas')).height)));
    await page.locator('[data-palette-kind="storage"]').scrollIntoViewIfNeeded();
    const edgeItem = await page.locator('[data-palette-kind="storage"]').boundingBox();
    await page.mouse.move(edgeItem.x + edgeItem.width / 2, edgeItem.y + edgeItem.height / 2);
    await page.mouse.down();
    await page.mouse.move(scrolledCanvas.x + 300, beyond, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((base) => parseFloat(getComputedStyle(document.querySelector('#topology-canvas')).height) > base, beforeEdgeDrop);
    assert.equal(await page.locator('.palette-ghost').count(), 0, 'the ghost must not outlive a drop past the canvas edge');

    await page.locator('[data-palette-kind="server"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 5);
    const placed = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.mesh-node')].map((node) => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }));
      const last = nodes.at(-1);
      return nodes.slice(0, -1).every((other) => Math.abs(other.x - last.x) >= 140 || Math.abs(other.y - last.y) >= 150);
    });
    assert.ok(placed, 'click placement must find a free slot instead of stacking on an existing node');
    await page.locator('#tab-failure').click();
    assert.equal(await page.locator('#panel-palette').isHidden(), true);

    // 캔버스는 배치를 따라 커진다. 기본 배치는 최소 크기를 그대로 쓴다.
    const canvasSize = () => page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('#topology-canvas'));
      return { width: Math.round(parseFloat(style.width)), height: Math.round(parseFloat(style.height)),
        viewBox: document.querySelector('#link-layer').getAttribute('viewBox') };
    });

    const spreadProject = structuredClone(project);
    spreadProject.topology.devices[0].position = { x: -400, y: -220 };
    spreadProject.topology.devices[1].position = { x: 1600, y: 900 };
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#project-file-input').setInputFiles({ name: 'spread.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(spreadProject)) });
    await page.waitForFunction(() => document.querySelector('#link-layer').getAttribute('viewBox').startsWith('-'));
    const spread = await canvasSize();
    const [originX, originY, spreadWidth, spreadHeight] = spread.viewBox.split(' ').map(Number);
    assert.ok(originX < 0 && originY < 0, `the origin must follow a device placed above and left, got ${spread.viewBox}`);
    assert.ok(spreadWidth > 940 && spreadHeight > 580, 'the canvas must grow past its minimum for a device placed outside');
    assert.deepEqual([spread.width, spread.height], [spreadWidth, spreadHeight], 'the canvas box must match its viewBox');

    // 원점이 음수로 밀려도 링크는 심볼 중심에 붙어 있어야 한다.
    const anchorGap = await page.evaluate(() => {
      const layer = document.querySelector('#link-layer');
      const svg = layer.getBoundingClientRect();
      const [x, y] = layer.getAttribute('viewBox').split(' ').map(Number);
      const line = document.querySelector('[data-link-id="source-a-target-a"] .link');
      const symbol = document.querySelector('[data-device-id="source-a"] .node-symbol').getBoundingClientRect();
      return Math.hypot((symbol.left + symbol.width / 2) - (svg.left + Number(line.getAttribute('x1')) - x),
        (symbol.top + symbol.height / 2) - (svg.top + Number(line.getAttribute('y1')) - y));
    });
    assert.ok(anchorGap < 1.5, `a link must stay on the symbol center after the origin moves, gap ${anchorGap}`);


    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#project-file-input').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelector('#link-layer').getAttribute('viewBox') === '0 0 940 580');
    const restored = await canvasSize();
    assert.deepEqual([restored.width, restored.height], [940, 580], 'a layout that fits returns to the minimum canvas');

    // 확대: 무대가 스크롤 크기를 담고, 좌표는 배율만큼 되돌려 읽어야 한다.
    const zoomState = () => page.evaluate(() => {
      const stage = getComputedStyle(document.querySelector('#topology-stage'));
      return {
        label: document.querySelector('#zoom-level').textContent,
        zoom: Number(stage.getPropertyValue('--zoom')),
        pad: parseFloat(stage.getPropertyValue('--stage-pad')),
        stageWidth: Math.round(parseFloat(stage.width)),
        canvasWidth: Math.round(document.querySelector('#topology-canvas').getBoundingClientRect().width),
        nodeWidth: Math.round(document.querySelector('.mesh-node').getBoundingClientRect().width),
      };
    });
    const atRest = await zoomState();
    assert.deepEqual([atRest.label, atRest.zoom, atRest.nodeWidth], ['100%', 1, 104]);
    assert.ok(atRest.pad > 0, 'the stage must pad the canvas so there is always empty space to grab');
    assert.equal(atRest.stageWidth, atRest.canvasWidth + atRest.pad * 2);

    await page.locator('[data-zoom="in"]').click();
    const zoomed = await zoomState();
    assert.ok(zoomed.zoom > 1 && zoomed.label === `${Math.round(zoomed.zoom * 100)}%`);
    assert.equal(zoomed.stageWidth, Math.round(atRest.canvasWidth * zoomed.zoom) + zoomed.pad * 2,
      'the stage must carry the scaled canvas plus its padding so the area can scroll');
    assert.equal(zoomed.nodeWidth, Math.round(104 * zoomed.zoom), 'nodes scale with the canvas');

    // 확대한 상태에서 화면상 이동 거리는 캔버스 좌표에서 배율만큼 작아야 한다.
    const dragTarget = page.locator('[data-device-id="source-a"]');
    await dragTarget.scrollIntoViewIfNeeded();
    const startLeft = await dragTarget.evaluate((node) => parseFloat(node.style.left));
    const dragBox = await dragTarget.boundingBox();
    await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(dragBox.x + dragBox.width / 2 + 120, dragBox.y + 12, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const movedLeft = await dragTarget.evaluate((node) => parseFloat(node.style.left));
    assert.ok(Math.abs((movedLeft - startLeft) - 120 / zoomed.zoom) < 2,
      `a drag must move the device by the screen distance divided by the zoom, got ${movedLeft - startLeft}`);

    await page.locator('[data-zoom="out"]').click();
    assert.equal((await zoomState()).zoom, 1);
    await page.locator('[data-zoom="fit"]').click();
    assert.ok((await zoomState()).zoom <= 1, 'fit never magnifies past 100%');
    await page.locator('[data-zoom="reset"]').click();
    assert.deepEqual(await zoomState(), atRest, 'reset returns the canvas to 100%');

    // 휠 확대는 한 눈금이 배율을 조금만 움직여야 한다. 트랙패드는 이벤트가 촘촘하게 온다.
    const scrollArea = await page.locator('.topology-scroll').boundingBox();
    const spot = { x: Math.min(scrollArea.x + scrollArea.width - 80, viewport.width - 40),
      y: Math.min(scrollArea.y + 140, viewport.height - 40) };
    await page.mouse.move(spot.x, spot.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(60);
    const afterNotch = (await zoomState()).zoom;
    await page.keyboard.up('Control');
    assert.ok(afterNotch > 1, 'ctrl with the wheel must zoom in');
    assert.ok(afterNotch < 1.1, `one wheel notch must stay gentle, got ${afterNotch}`);
    await page.locator('[data-zoom="reset"]').click();

    const beforeWheel = await page.evaluate(() => Math.round(document.querySelector('.topology-scroll').scrollLeft));
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
    assert.equal((await zoomState()).zoom, 1, 'a wheel without ctrl must not zoom');

    // 빈 공간을 끌면 화면이 그만큼 움직인다. 노드가 없는 지점을 실제로 찾아서 누른다.
    const emptySpot = await page.evaluate(() => {
      const area = document.querySelector('.topology-scroll');
      const rect = area.getBoundingClientRect();
      const left = Math.max(rect.left, 0);
      const right = Math.min(rect.right, window.innerWidth);
      const top = Math.max(rect.top, 0);
      const bottom = Math.min(rect.bottom, window.innerHeight);
      for (let y = bottom - 20; y > top; y -= 15) {
        for (let x = left + 20; x < right; x += 15) {
          const el = document.elementFromPoint(x, y);
          if (el && el.closest('.topology-scroll') && !el.closest('.mesh-node, .link-hit')) {
            return { x, y, cursor: getComputedStyle(el).cursor };
          }
        }
      }
      return null;
    });
    assert.ok(emptySpot, 'the topology area must expose empty space to grab');
    assert.equal(emptySpot.cursor, 'grab', 'empty space must show the open hand');

    const panBefore = await page.evaluate(() => {
      const area = document.querySelector('.topology-scroll');
      return { left: Math.round(area.scrollLeft), top: Math.round(area.scrollTop),
        maxLeft: Math.round(area.scrollWidth - area.clientWidth), maxTop: Math.round(area.scrollHeight - area.clientHeight) };
    });
    assert.ok(panBefore.maxLeft > 0 && panBefore.maxTop > 0, 'the stage padding must leave room to pan in both directions');
    await page.mouse.move(emptySpot.x, emptySpot.y);
    await page.mouse.down();
    assert.equal(await page.locator('.topology-scroll.panning').count(), 1, 'panning must mark the area');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.topology-scroll')).cursor), 'grabbing',
      'pressing empty space must show the closed hand');
    await page.mouse.move(emptySpot.x - 120, emptySpot.y - 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    const panAfter = await page.evaluate(() => {
      const area = document.querySelector('.topology-scroll');
      return { left: Math.round(area.scrollLeft), top: Math.round(area.scrollTop) };
    });
    assert.ok(Math.abs(panAfter.left - Math.min(panBefore.left + 120, panBefore.maxLeft)) < 3,
      `dragging empty space must scroll horizontally, ${panBefore.left} to ${panAfter.left}`);
    assert.ok(Math.abs(panAfter.top - Math.min(panBefore.top + 90, panBefore.maxTop)) < 3,
      `dragging empty space must scroll vertically, ${panBefore.top} to ${panAfter.top}`);
    assert.equal(await page.locator('.topology-scroll.panning').count(), 0, 'panning must end with the pointer');

    // 노드 위에서 시작한 드래그는 이동이지 팬이 아니다.
    const panGuard = page.locator('[data-device-id="source-a"]');
    await panGuard.scrollIntoViewIfNeeded();
    const guardScroll = await page.evaluate(() => Math.round(document.querySelector('.topology-scroll').scrollLeft));
    const guardBox = await panGuard.boundingBox();
    await page.mouse.move(guardBox.x + guardBox.width / 2, guardBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(guardBox.x + guardBox.width / 2 + 70, guardBox.y + 10, { steps: 8 });
    assert.equal(await page.locator('.topology-scroll.panning').count(), 0, 'a drag that starts on a node must not pan the area');
    await page.mouse.up();
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.topology-scroll').scrollLeft)), guardScroll,
      'a drag on a node must leave the scroll position alone');

    // 노드 레이어가 캔버스를 덮어 링크가 포인터를 못 받던 문제. 링크는 눌러서 검사할 수 있어야 한다.
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
}

try {
  await verify({ width: 1440, height: 1000 }, '.impeccable/review/desktop.png', true);
  await verify({ width: 390, height: 844 }, '.impeccable/review/mobile.png');
  await verifyCanvasEditing();
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
