import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile as readTextFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { server } from '../scripts/serve.mjs';
import { cloneTopology } from '../public/data.js';
import { templates } from '../public/templates.js';
const templateCount = templates.length;

await mkdir('.impeccable/review', { recursive: true });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const browser = await chromium.launch();
const failures = [];

// 캔버스 편집은 선택·스크롤·설계를 모두 바꾸므로 깨끗한 페이지에서 따로 확인한다.
async function verifyCanvasEditing() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => localStorage.clear());
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}\n${String(error.stack).split("\n").slice(1, 4).join("\n")}`));
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
  await page.locator('[data-editor-action="undo"]').click();
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before, linkCount);

  const someNode = page.locator('.mesh-node:not(.disabled)').first();
  await someNode.click({ button: 'right' });
  await page.waitForSelector('#context-menu [role="menuitem"]');
  // 카탈로그가 있는 클래스에는 장비 선택이, 없는 클래스에는 나오지 않는다.
  assert.deepEqual(await page.locator('#context-menu [role="menuitem"]').allTextContents(),
    ['삭제', '장비 고르기', '복제', '여기서 링크 시작', '장애 주입']);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.contextAction), 'swap', 'arrow keys move through the menu');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#context-menu')?.hidden);
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('#context-menu [role="menuitem"]');
  await page.keyboard.press('Escape');

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
  await page.locator('[data-editor-action="undo"]').click();
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before, nodeCount);

  // 자유 도형도 계산 그래프와 분리된 채 같은 편집 이력에 들어간다.
  await page.locator('[data-editor-action="shape-rect"]').click();
  assert.equal(await page.locator('.diagram-shape').count(), 1);
  await page.locator('[data-editor-action="undo"]').click();
  assert.equal(await page.locator('.diagram-shape').count(), 0);
  await page.locator('[data-editor-action="redo"]').click();
  assert.equal(await page.locator('.diagram-shape').count(), 1);
  const svgDownload = page.waitForEvent('download');
  await page.locator('[data-editor-action="export-svg"]').click();
  assert.match((await svgDownload).suggestedFilename(), /\.svg$/);
  const pngDownload = page.waitForEvent('download');
  await page.locator('[data-editor-action="export-png"]').click();
  assert.match((await pngDownload).suggestedFilename(), /\.png$/);

  await page.locator('[data-editor-action="shape-text"]').click();
  await page.locator('.diagram-shape').first().click({ modifiers: ['Shift'] });
  await page.locator('[data-editor-action="annotation-connect"]').click();
  assert.equal(await page.locator('.diagram-connector').count(), 1, 'annotation connectors remain visually connected but outside the traffic graph');

  const drawio = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="설명" vertex="1" parent="1"><mxGeometry x="20" y="30" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
  await page.locator('#drawio-file-input').setInputFiles({ name: 'sample.drawio', mimeType: 'application/xml', buffer: Buffer.from(drawio) });
  await page.waitForFunction(() => document.querySelector('.diagram-shape')?.textContent === '설명');
  assert.match(await page.locator('#toast').textContent(), /계산 의미는 장비에 별도로 지정/);
  const devicesBeforeMapping = await page.locator('.mesh-node').count();
  await page.locator('[data-editor-action="map-device"]').click();
  await page.locator('[data-editor-form="device"] button[type="submit"]').click();
  assert.equal(await page.locator('.diagram-shape').count(), 0);
  assert.equal(await page.locator('.mesh-node').count(), devicesBeforeMapping + 1, 'an imported shape can receive infrastructure meaning explicitly');
  // 토스트는 화면 하단에 고정이라 아래쪽 노드를 덮는다. 다음 클릭 전에 걷히기를 기다린다.
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });
  await page.close();
}

// LB 뒤에 서버를 붙이면 손으로 demand 를 적지 않아도 트래픽이 간다. 그게 보이지 않으면
// 사용자는 장비를 그려 놓고 왜 0 인지 알 수 없다 — 붙이기 전과 후를 한 페이지에서 본다.
async function verifyBackendPool() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => localStorage.clear());
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`pool console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pool pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.locator('[data-editor-action="new"]').click();
  await page.locator('[data-template="dual-stack"]').click();

  await page.locator('[data-editor-action="device"]').click();
  await page.locator('[data-editor-form="device"] input[name="name"]').fill('WEB 02 복제');
  await page.locator('[data-editor-form="device"] select[name="kind"]').selectOption('web');
  // 클래스를 바꾸면 물어보는 축도 바뀐다. 서버에 forwarding_bps 를 받으면 NIC 가 unknown 으로 남는다.
  await page.locator('[data-editor-form="device"] input[name="nic_bps"]').fill('8000000000');
  await page.locator('[data-editor-form="device"] button[type="submit"]').click();
  const replica = await page.locator('.mesh-node', { hasText: '복제' }).first().getAttribute('data-device-id');
  await page.waitForFunction((id) => document.querySelector(`.mesh-node[data-device-id="${id}"] .node-pool[data-warn]`),
    replica, { timeout: 8000 });

  await page.locator('[data-editor-action="connect"]').click();
  await page.locator('.mesh-node[data-device-id="lb-b"]').click();
  await page.locator(`.mesh-node[data-device-id="${replica}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`.mesh-node[data-device-id="${id}"] .node-pool:not([data-warn])`),
    replica, { timeout: 8000 });

  const shares = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mesh-node')]
    .map((node) => [node.querySelector('.node-name').textContent, node.querySelector('.node-pool')?.textContent])
    .filter(([, pool]) => pool)));
  // LB A 에서는 복제로 갈 길이 없다. 세 대 균등이 아니라 갈래대로 나뉜다.
  assert.deepEqual(shares, { 'WEB 01': '풀 3대 · 42%', 'WEB 02': '풀 3대 · 42%', 'WEB 02 복제': '풀 3대 · 17%' });

  await page.locator('[data-editor-action="demand"]').click();
  await page.locator('.demand-editor-row input[name="single"]').first().check();
  await page.locator('.demand-editor-row button[type="submit"]').first().click();
  await page.waitForFunction(() => document.querySelector('.demand-pool span')?.textContent.includes('꺼짐'), null, { timeout: 8000 });
  await page.close();
}

async function verify(viewport, screenshot, interact = false) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => localStorage.clear());
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}\n${String(error.stack).split("\n").slice(1, 4).join("\n")}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#summary-faults').textContent(), '00');
  // 캔버스 아래가 지금 무엇이 막고 있는지 문장으로 말해야 한다.
  const restingNote = await page.locator('#bottleneck-note').textContent();
  assert.match(restingNote, /가장 빠듯합니다/);
  assert.match(restingNote, /LEAF B → API 02/, 'a link must read by its endpoints, not its id');
  // 미확인 축이 남은 설계는 알려진 축이 정상이어도 통과로 읽히면 안 된다.
  assert.equal(await page.locator('#run-state').textContent(), 'EVIDENCE INCOMPLETE',
    'unknown constraints must take precedence over a safe-looking headline');
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
  assert.equal(liveBefore, liveAfter, 'deterministic results must not drift while the input is unchanged');
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
  // 칸의 선은 그 칸의 숫자를 그려야 한다. 예전에는 활성 장애 칸이 배율을, 과부하 칸이
  // 헤드룸의 역수를 그렸다. 선이 다른 것을 말하면 읽는 사람은 선을 믿고 잘못 읽는다.
  const paired = await page.evaluate(() => [...document.querySelectorAll('.summary-metric')].map((cell) => ({
    figure: cell.querySelector('strong[id^="summary-"]')?.id.replace('summary-', '') ?? '',
    series: cell.querySelector('.metric-sparkline')?.dataset.series ?? '',
  })));
  assert.equal(paired.length, 4);
  for (const cell of paired) assert.equal(cell.series, cell.figure, `${cell.figure} 칸이 ${cell.series} 를 그립니다`);

  assert.ok(await page.locator('.topology-group').count() > 0, 'zones must draw as group boxes');
  assert.ok(await page.locator('.topology-group[data-depth="2"]').count() > 0, 'a slash in a zone nests one box inside another');
  // 이름표는 선 위에 뜨지만 배경이 없으면 선이 글자 사이를 지난다. 상자는 글자를 실제로 재서
  // 깔므로, 글꼴이 대체되어 글자가 넓어지면 상자 밖으로 새어 나온다.
  const tags = await page.evaluate(() => [...document.querySelectorAll('.group-tag')].map((tag) => ({
    label: tag.querySelector('.group-label').textContent,
    text: tag.querySelector('.group-label').getBBox().width,
    frame: Number(tag.querySelector('.group-tag-frame').getAttribute('width') || 0),
  })));
  assert.ok(tags.length > 0, '그룹마다 이름표 상자가 있어야 한다');
  for (const tag of tags) assert.ok(tag.frame >= tag.text, `${tag.label} 의 상자(${Math.round(tag.frame)})가 글자(${Math.round(tag.text)})를 덮지 못합니다`);
  assert.ok(await page.locator('.node-axis[style*="--util"]').count() > 0, 'a judged axis carries the meter value');

  // 심볼과 클래스 표기는 확정됐다. 배지만 취향이라 토글로 남아 있다.
  assert.equal(await page.locator('[data-class-badge]').count(), 2);
  // 배지는 기본이 켬이다. 끄고 켜는 두 방향이 다 도는지 본다.
  assert.equal(await page.locator('[data-device-id="fw-a"] .node-class-badge').textContent(), 'FW');
  await page.locator('[data-class-badge="off"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.node-class-badge').length === 0);
  await page.locator('[data-class-badge="on"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.node-class-badge').length > 0);
  assert.ok(await page.locator('.mesh-node .node-vendor-mark').count() > 0, 'a known manufacturer draws its mark');
  assert.ok(await page.locator('.mesh-node .node-vendor').count() > 0, 'a manufacturer with no mark falls back to a text badge');
  assert.equal(await page.locator('[data-device-id="leaf-a"] .node-model').textContent(), 'DEMO-LEAF-12G');
  assert.equal(await page.locator('[data-device-id="api-a"] .node-axis[data-axis-state="unknown"][style*="--util"]').count(), 0,
    'an unknown limit must draw no meter, so it never reads as spare capacity');

  // 한계값은 숫자를 치는 것보다 막대를 끌어 정하는 편이 이 도구가 답하는 질문에 가깝다.
  await page.locator('[data-device-id="fw-a"]').click();
  await page.waitForFunction(() => document.querySelector('[data-axis-drag]'));
  const meter = page.locator('[data-axis-drag]').first();
  await meter.scrollIntoViewIfNeeded();
  const axisKey = await meter.getAttribute('data-axis-drag');
  const meterBox = await meter.boundingBox();
  const limitBefore = await page.locator(`[data-axis-limit="${axisKey}"]`).first().textContent();
  await page.mouse.move(meterBox.x + meterBox.width * 0.4, meterBox.y + meterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(meterBox.x + meterBox.width * 0.88, meterBox.y + meterBox.height / 2, { steps: 6 });
  // 끄는 동안 상태 이름과 상태 색이 같은 말을 해야 한다. 하나만 바뀌면 둘이 어긋난다.
  const dragging = await page.locator('.axis-row').first().evaluate((row) => ({
    state: row.className.replace('axis-row ', ''),
    title: row.querySelector('.axis-title span:last-child').textContent.trim(),
  }));
  const stateName = { healthy: '정상', warning: '주의', overloaded: '용량 초과' }[dragging.state];
  assert.ok(stateName, `끄는 동안 상태가 ${dragging.state} 였습니다.`);
  assert.ok(dragging.title.startsWith(stateName), `상태 색은 ${dragging.state} 인데 글자는 "${dragging.title}" 입니다.`);
  const draggedPercent = Number(dragging.title.match(/(\d+)%/)[1]);
  assert.equal(dragging.state === 'healthy', draggedPercent < 80, '80% 를 기준으로 상태와 백분율이 함께 움직여야 합니다.');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('한계를'));
  const limitAfter = await page.locator(`[data-axis-limit="${axisKey}"]`).first().textContent();
  assert.notEqual(limitAfter, limitBefore, 'dragging the meter must change the stored limit');
  // 숫자 입력이 여전히 정본이다. 끌어서 정한 값이 그대로 보인다.
  assert.ok(Number(await page.locator(`[data-resource-form="device"] input[name="${axisKey}"]`).inputValue()) > 0);
  // 키보드로도 같은 일을 할 수 있어야 한다.
  await meter.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((before) => document.querySelector('[data-axis-limit]')?.textContent !== before, limitAfter);
  await page.locator('[data-editor-action="undo"]').click();
  await page.locator('[data-editor-action="undo"]').click();
  await page.waitForFunction((before) => document.querySelector('[data-axis-limit]')?.textContent === before, limitBefore);

  // 안내는 언제든 다시 열 수 있어야 한다. 작업 사본을 복원하면 첫 화면 설명이 함께 오지 않고,
  // 사용자가 만든 설계에는 애초에 가르칠 것이 없다.
  const beforeTour = await page.evaluate(() => ({
    scale: document.querySelector('#scale-input').value, faults: document.querySelector('#summary-faults').textContent,
  }));
  await page.locator('#guide-button').click();
  await page.waitForFunction(() => document.querySelector('#tour')?.hidden === false);
  assert.match(await page.locator('.tour-count').textContent(), /^1 \/ \d+$/);
  const tourTexts = [];
  let spotted = 0;
  for (let step = 1; ; step += 1) {
    tourTexts.push(await page.locator('.tour-text').textContent());
    // 부드러운 스크롤이 끝나야 자리가 정해진다. 멈춘 뒤에 잰다. 단계가 바뀌면 기준을 비운다 —
    // 앞 단계의 마지막 위치가 남아 있으면 첫 폴에서 "이미 멈췄다"로 잘못 읽는다.
    await page.evaluate(() => { window.__tourSettle = null; });
    await page.waitForFunction(() => {
      const spot = document.querySelector('#tour-spot');
      if (spot.hidden) return true;
      const top = Math.round(spot.getBoundingClientRect().top);
      const settled = window.__tourSettle === top;
      window.__tourSettle = top;
      return settled;
    }, null, { polling: 120 });
    // 실선 박스는 실제 조작 대상 위에 있어야 하고, 설명 상자가 그것을 덮으면 안 된다.
    assert.equal(await page.evaluate(() => {
      const spot = document.querySelector('#tour-spot');
      if (spot.hidden) return true;
      const box = document.querySelector('#tour').getBoundingClientRect();
      const rect = spot.getBoundingClientRect();
      const inView = rect.top >= -1 && rect.bottom <= window.innerHeight + 1 && rect.width > 4 && rect.height > 4;
      const clear = box.right < rect.left || box.left > rect.right || box.bottom < rect.top || box.top > rect.bottom;
      return inView && clear;
    }), true, `${step}단계의 실선 박스가 화면 밖이거나 설명 상자에 가렸습니다.`);
    if (!await page.locator('#tour-spot').evaluate((node) => node.hidden)) spotted += 1;
    const last = await page.locator('[data-tour="next"]').textContent() === '닫기';
    await page.locator('[data-tour="next"]').click();
    if (last) break;
    await page.waitForFunction((previous) => document.querySelector('.tour-text')?.textContent !== previous, tourTexts.at(-1));
  }
  assert.ok(tourTexts.length >= 6, `단계가 ${tourTexts.length}개뿐입니다.`);
  // 안내는 지금 설계에서 계산한 값으로 말한다. 못 박은 숫자면 다른 설계에서 틀린 말이 된다.
  assert.match(tourTexts.join(' '), /1\.\d\d배에서/, 'the tour must read the breach scale off the live calculation');
  assert.match(tourTexts.join(' '), /미확인은 0%가 아닙니다|한계를 모르는 축은 막대를 채우지 않고/,
    'the tour must state the one rule a newcomer gets wrong');
  // 단계마다 화면의 실제 조작 대상을 가리켜야 한다. 설명만 하는 단계는 마무리 하나뿐이다.
  assert.ok(spotted >= tourTexts.length - 1, `실선 박스가 ${spotted}단계에만 떴습니다.`);
  // 안내가 만진 것은 시나리오 상태뿐이고, 끝나면 그대로 돌아와야 한다.
  await page.waitForFunction(() => document.querySelector('#tour')?.hidden === true);
  assert.deepEqual(await page.evaluate(() => ({
    scale: document.querySelector('#scale-input').value, faults: document.querySelector('#summary-faults').textContent,
  })), beforeTour, 'the tour must put the design back where it found it');
  assert.equal(await page.locator('#tour-spot').evaluate((node) => node.hidden), true, 'the box must not outlive the tour');

  // 처음 오는 사람이 보는 화면에도 설명이 있어야 한다. 답은 실험을 누른 뒤에 편다.
  assert.match(await page.locator('#learning-panel').textContent(), /독립인 한계를 여럿/, 'the first screen must state what the tool claims');
  assert.equal(await page.locator('#learning-panel output').isHidden(), true, 'the answer must not sit beside the question');
  await page.locator('#learning-panel [data-lesson-action="fault-device"]').click();
  await page.waitForFunction(() => !document.querySelector('#learning-panel output')?.hidden);
  assert.match(await page.locator('#topology-heading').textContent(), /신규 세션 171%/, 'the experiment must land on the number it promised');
  await page.locator('[data-failure-type="device"][data-failure-id="fw-a"]').click();
  await page.waitForFunction(() => document.querySelector('#summary-faults')?.textContent === '00');

  // 장비를 바꾸는 것은 인스펙터까지 가지 않고 자리에서 하는 일이다.
  await page.locator('[data-device-id="fw-a"]').click({ button: 'right' });
  await page.waitForFunction(() => !document.querySelector('#context-menu')?.hidden);
  assert.equal(await page.locator('[data-context-action="swap"]').count(), 1, 'a class with a catalogue must offer the swap in place');
  await page.locator('[data-context-action="swap"]').click();
  await page.waitForFunction(() => document.querySelector('[data-swap-catalog]'));
  const choices = await page.locator('[data-swap-catalog]').count();
  assert.ok(choices >= 20, `고를 수 있는 조건이 ${choices}개뿐입니다.`);
  await page.locator('#swap-search').fill('ASA');
  await page.waitForFunction(() => document.querySelectorAll('[data-swap-catalog]:not([hidden])').length < 20);
  const narrowed = await page.locator('[data-swap-catalog]:not([hidden])').count();
  assert.ok(narrowed > 0 && narrowed < choices, '검색이 조건 목록을 좁혀야 합니다.');
  await page.locator('[data-swap-catalog]:not([hidden])').first().click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('바꿨습니다'));
  assert.match(await page.locator('#toast').textContent(), /FW A를 .+으?로 바꿨습니다/, 'the toast must name what it became, with the right particle');
  assert.match(await page.locator('[data-device-id="fw-a"] .node-model').textContent(), /Firewall/);
  // 같은 메뉴에서 되돌릴 수 있어야 한다. 데이터시트를 뗀 뒤에는 고르기로 이름이 바뀐다.
  await page.locator('[data-editor-action="undo"]').click();
  await page.waitForFunction(() => !document.querySelector('#toast')?.textContent.includes('바꿨습니다'));

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

    // 데이터시트 프로필 · 워크로드 조건 · 축 단위 수락 · 사용자 보정
    await page.locator('[data-device-id="fw-b"]').click();
    await page.selectOption('[data-spec-field="catalog"]', 'fortinet-fortigate-100f');
    await page.waitForFunction(() => document.querySelector('.source-note')?.textContent.includes('데이터시트'));
    assert.match(await page.locator('.limit-field small').first().textContent(), /데이터시트 20 Gbps/);
    // 대조할 워크로드 조건이 없으면 20 Gbps 를 알면서도 판정할 수 없다.
    assert.match(await page.locator('.evidence-state[data-applicability="unknown"]').first().textContent(), /적용 조건 미확인/,
      'a datasheet limit with no workload to compare against must read as unjudged');
    assert.equal(await page.locator('[data-device-id="fw-b"] .node-axis').evaluateAll((rows) =>
      rows.every((row) => row.dataset.axisState === 'unknown')), true, 'nothing is calculated until the conditions can be compared');

    // 워크로드 조건을 적으면 같은 조건에서 잰 축이 판정을 통과하고 계산에 들어간다.
    await page.locator('[data-editor-action="workload"]').click();
    await page.locator('input[name="packet_size_bytes"]').fill('1518');
    await page.locator('input[name="transport"]').fill('udp');
    await page.locator('input[name="features_mode"][value="none"]').check();
    await page.locator('[data-editor-form="workload"] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.evidence-state[data-applicability="applicable"]'));
    assert.match(await page.locator('.evidence-state[data-applicability="applicable"]').first().textContent(), /조건 일치/,
      'the 1518-byte datasheet row must match a 1518-byte workload');
    assert.ok((await page.locator('[data-device-id="fw-b"] .node-axis').evaluateAll((rows) =>
      rows.map((row) => `${row.querySelector('b').textContent}:${row.dataset.axisState}`))).includes('BPS:healthy'));

    // 위협 방어 값은 데이터시트가 프레임 크기를 밝히지 않는다. 워크로드를 적어도 판정할 수 없다.
    await page.selectOption('[data-spec-field="profile"]', 'threat');
    await page.waitForFunction(() => document.querySelector('#inspector-content')?.textContent.includes('위협 방어'));
    assert.equal(await page.locator('[data-device-id="fw-b"] .node-axis').evaluateAll((rows) =>
      rows.every((row) => row.dataset.axisState === 'unknown')), true,
      'a datasheet number measured on an unstated packet mix cannot be judged by comparison');

    // 그래서 축 하나씩 수락한다. 프로필을 통째로 통과시키는 길은 두지 않는다.
    await page.locator('[data-evidence-accept="forwarding_bps"]').click();
    await page.waitForFunction(() => document.querySelector('.evidence-state[data-applicability="user-asserted"]'));
    const threatAxes = await page.locator('[data-device-id="fw-b"] .node-axis').evaluateAll((rows) =>
      rows.map((row) => `${row.querySelector('b').textContent}:${row.dataset.axisState}`));
    assert.ok(threatAxes.includes('BPS:overloaded'), 'threat protection drops 20 Gbps to 1 Gbps once the user accepts that number');
    assert.ok(threatAxes.includes('CPS:unknown'), 'the datasheet says nothing about sessions under inspection, so it stays unknown');
    // 데이터시트가 값을 적지 않은 축에는 수락할 대상이 없다. 수락 버튼도 두지 않는다.
    assert.equal(await page.locator('[data-evidence-accept]').count(), 0,
      'an axis with no datasheet number has nothing to accept');
    await page.locator('[data-evidence-release="forwarding_bps"]').click();
    await page.waitForFunction(() => !document.querySelector('.evidence-state[data-applicability="user-asserted"]'));

    await page.selectOption('[data-spec-field="profile"]', 'fw-1518');
    await page.waitForFunction(() => document.querySelector('input[name="new_sessions_per_sec"]')?.value === '56000');
    await page.locator('input[name="new_sessions_per_sec"]').fill('40000');
    await page.locator('[data-resource-form="device"] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.limit-field.corrected'));
    assert.match(await page.locator('.source-correction').textContent(), /보정한 축이 1개/);
    assert.match(await page.locator('.limit-field.corrected small').textContent(), /데이터시트 56 Kcps/,
      'the datasheet value stays visible next to the correction');

    // 내보낸 그림은 화면과 같은 심볼·축·판정을 담는다. 이름표 상자가 아니다.
    const [svgDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-editor-action="export-svg"]').click(),
    ]);
    const exported = await readTextFile(await svgDownload.path(), 'utf8');
    assert.match(exported, /엔진 \d+\.\d+\.\d+/, 'the exported frame must say which engine computed it');
    assert.match(exported, /<g transform="translate\([-\d.]+ [-\d.]+\) scale\(/, 'the exported frame must carry the device symbols, not name boxes');
    assert.match(exported, />—</, 'an unknown axis must reach the file as an em dash, not a number');
    assert.match(exported, /장애 fw-a/, 'the exported frame must name the fault it was computed under');
    assert.doesNotMatch(exported, /<script|<image|foreignObject/);
    await page.locator('[data-reset-axis="new_sessions_per_sec"]').click();
    await page.waitForFunction(() => document.querySelector('input[name="new_sessions_per_sec"]')?.value === '56000');
    assert.equal(await page.locator('.limit-field.corrected').count(), 0);
    await page.selectOption('[data-spec-field="catalog"]', '');
    await page.waitForFunction(() => !document.querySelector('[data-spec-field="profile"]'));
    // 설계 편집은 현재 장애 시나리오와 사용자가 확정한 기준선을 바꾸지 않는다.
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

    // 헤더와 계산 노트는 하드코딩이 아니라 지금 열린 설계와 엔진에서 온다.
    assert.equal(await page.locator('#calculation-note').textContent(), 'DETERMINISTIC · HOP-BRANCH WEIGHTED · ENGINE 3.0.0',
      'the calculation note must name the split the engine actually uses, and the engine version');
    assert.match(await page.locator('#scenario-subtitle').textContent(), /^합성 데모 · 장비 \d+ · 링크 \d+/,
      'the header must say whether these values came from a synthetic template');

    // 새 설계는 템플릿 목록을 연다. 각 템플릿은 서로 다른 축이 먼저 차는 구성이다.
    const beforePanel = await page.evaluate(() => Math.round(document.querySelector('.main-grid').getBoundingClientRect().top));
    await page.locator('[data-editor-action="new"]').click();
    assert.ok(await page.locator('.template-item').count() >= 16, 'the picker must offer architectures, not just a blank sheet');
    // 목록이 길어지면 검색이 필요하다.
    await page.locator('#template-search').fill('TLS');
    const total = await page.locator('.template-item').count();
    const matched = await page.locator('.template-item:not([hidden])').count();
    // 목록이 자랄 때마다 고쳐야 하는 못 박은 숫자를 두지 않는다. 검색은 목록을 좁혀야 한다.
    assert.ok(matched >= 2 && matched < total / 2, `search must narrow the list, got ${matched} of ${total}`);
    assert.match(await page.locator('#template-count').textContent(), /개 일치/);
    // 자식이 전부 숨은 섹션은 제목만 남아 빈 칸을 만든다.
    for (const section of await page.locator('.template-section').all()) {
      const visible = await section.locator('.template-item:not([hidden])').count();
      assert.equal(await section.isHidden(), visible === 0, '자식이 없는 섹션은 숨어야 하고, 있는 섹션은 보여야 한다');
    }
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
    await page.waitForFunction(() => document.querySelector('#scenario-subtitle')?.textContent.startsWith('사용자 설계'));
    assert.equal(await page.locator('#scenario-title').textContent(), '빈 설계', 'the header must name the design that is open');
    // 한계를 모르면 스파크라인이 선을 그리지 않는다. 0 은 위험, 0% 는 안전으로 읽혀 둘 다 거짓말이다.
    // 개수를 세는 칸은 다르다 - 자원이 없으면 과부하 0개는 모르는 것이 아니라 사실이다.
    for (const series of ['headroom']) {
      assert.equal(await page.locator(`.metric-sparkline[data-series="${series}"]`).getAttribute('data-unknown'), '',
        `the ${series} sparkline must show unknown instead of inventing a value`);
      assert.equal(await page.locator(`.metric-sparkline[data-series="${series}"] path`).getAttribute('d'), null,
        `the ${series} sparkline must not have drawn a line`);
    }
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 0);
    // 되돌리기가 실제로 되돌려야 한다.
    await page.locator('#toast [data-toast-undo]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 5);
    await page.locator('[data-editor-action="new"]').click();
    await page.locator('[data-template="blank"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 0);
    assert.equal(await page.locator('.mesh-node').count(), 0);
    assert.match(await page.locator('#inspector-content').textContent(), /장비가 없습니다/);
    // 폼이 물어보는 한계 축은 클래스를 따른다. 스위치는 처리량, 서버는 NIC 다.
    for (const [name, kind, axis] of [['Source A', 'switch', 'forwarding_bps'], ['Target A', 'server', 'nic_bps']]) {
      await page.locator('[data-editor-action="device"]').click();
      const form = page.locator('[data-editor-form="device"]');
      await form.locator('[name="name"]').fill(name);
      await form.locator('[name="kind"]').selectOption(kind);
      await form.locator(`[name="${axis}"]`).fill('10000000000');
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

    // 이어 놓기만 해서는 트래픽이 흐르지 않는다. 한계값이 비어서 0인 것과 지나는 수요가 없어서
    // 0인 것이 화면에서는 똑같이 0 으로 보이므로, 이 자리에서 이유를 말하고 고칠 길을 내야 한다.
    await page.locator('[data-device-id="target-a"]').click();
    assert.match(await page.locator('#inspector-content .idle-note').textContent(), /트래픽 수요가 없습니다/);
    await page.locator('#inspector-content [data-demand-target="target-a"]').click();
    const preset = page.locator('[data-editor-form="demand"]');
    assert.equal(await preset.locator('[name="target"]').inputValue(), 'target-a', '노드에서 열면 그 장비가 목적지로 잡혀 있어야 한다');
    assert.notEqual(await preset.locator('[name="source"]').inputValue(), 'target-a', '출발지가 목적지와 같으면 만들 수 없다');
    await page.keyboard.press('Escape');

    // 복제는 장비만이 아니라 그 장비가 물려 있던 자리까지 옮긴다. 이어 놓지 않고 떨어뜨려 두면
    // 지나는 수요가 없어 아무것도 계산되지 않고, 사용자는 왜 0인지 알 길이 없다.
    await page.locator('[data-device-id="target-a"]').click();
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 3);
    const copied = await page.evaluate(() => [...document.querySelectorAll('.mesh-node .node-name')].map((node) => node.textContent));
    assert.ok(copied.some((name) => /복제/.test(name)), `붙여넣은 장비의 이름에 복제가 붙어야 원본과 구분된다: ${copied.join(' / ')}`);
    assert.equal(await page.locator('.link-group').count(), 2, '원본이 물려 있던 상대에 그대로 이어져야 한다');
    assert.equal(await page.locator('.mesh-node .node-name').evaluateAll((nodes) => new Set(nodes.map((n) => n.textContent)).size), 3, '같은 이름이 둘이면 캔버스에서 구분할 수 없다');
    // 뒤 흐름은 장비 두 대를 전제하므로 복제를 되돌려 이 검사만 떼어 둔다.
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 2);
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
    await page.locator('[data-editor-action="verification"]').click();
    const serviceForm = page.locator('[data-editor-form="service"]');
    await serviceForm.locator('[name="name"]').fill('Public API');
    await serviceForm.locator('[name="demandIds"]').check();
    await serviceForm.locator('button[type="submit"]').click();
    assert.match(await page.locator('[data-editor-form="service"]').locator('xpath=preceding-sibling::ul[1]').textContent(), /Public API/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-editor-action="save"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const project = JSON.parse(await readFile(downloadPath, 'utf8'));
    assert.equal(project.schemaVersion, 3);
    assert.ok(project.scenario.baseline?.topology, 'the project keeps the explicit comparison baseline');
    assert.equal(project.topology.devices.length, 2);
    assert.equal(project.topology.links.length, 1);
    assert.equal(project.topology.demands.length, 1);
    assert.equal(project.topology.services[0].name, 'Public API');
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
    assert.ok(Math.abs((movedLeft - startLeft) - 120 / zoomed.zoom) <= 8,
      `a drag must divide screen distance by zoom and snap to the 15px grid, got ${movedLeft - startLeft}`);

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

// 숫자가 움직이는 두 가지를 나눠 확인한다. 값이 실제로 바뀌었을 때 잇는 것은 계산이 원인이라
// 항상 돌고, 떨림은 지어낸 값이라 끌 수 있어야 한다. 둘을 섞으면 화면의 숫자가
// 왜 움직이는지 설명할 수 없다.
async function verifyNumberMotion() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => localStorage.clear());
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}\n${String(error.stack).split("\n").slice(1, 4).join("\n")}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });

  assert.equal(await page.locator('[data-number-motion="on"]').getAttribute('aria-pressed'), 'true',
    '떨림은 기본이 켜짐이다. 대신 끄는 스위치가 늘 화면에 있어야 한다');

  // 배율을 바꾸면 숫자가 곧바로 튀지 않고 이전 값에서 새 값으로 이어진다.
  // 표본은 페이지 안에서 뜬다. 브라우저를 왕복하며 읽으면 260ms 트윈을 놓친다.
  const tween = await page.evaluate(async () => {
    const read = () => document.querySelector('.binding-callout strong span:last-child').textContent;
    const first = read();
    const seen = new Set([first]);
    const input = document.getElementById('scale-input');
    input.value = '150';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((done) => {
      const started = performance.now();
      const tick = () => { seen.add(read()); (performance.now() - started < 420 ? requestAnimationFrame(tick) : done()); };
      requestAnimationFrame(tick);
    });
    return { first, settled: read(), seen: [...seen] };
  });
  assert.notEqual(tween.settled, tween.first, '배율을 바꾸면 값이 달라져야 한다');
  assert.ok(tween.seen.length >= 4, `값이 이어지지 않고 곧바로 튀었습니다: ${tween.seen.join(' ')}`);

  // 떨림이 켜져 있으면 같은 계산 결과 위에서 값이 미세하게 달라진다. 헤드라인은 떨지 않는다.
  // 미확인 축에는 애초에 흔들 값이 없으므로, 사용률이 실제로 있는 축을 고른다.
  const sampleMotion = (ms) => page.evaluate(async (window) => {
    const axis = document.querySelector('.axis-title b[data-live-util]:not([data-live-util=""])');
    const headline = document.querySelector('.binding-callout strong span:last-child');
    const seen = { axis: new Set([axis.textContent]), headline: new Set([headline.textContent]) };
    await new Promise((done) => {
      const started = performance.now();
      const tick = () => {
        seen.axis.add(axis.textContent); seen.headline.add(headline.textContent);
        (performance.now() - started < window ? requestAnimationFrame(tick) : done());
      };
      requestAnimationFrame(tick);
    });
    return { axis: [...seen.axis], headline: [...seen.headline] };
  }, ms);

  const moving = await sampleMotion(2000);
  assert.ok(moving.axis.length >= 2, `떨림이 켜져 있는데 값이 그대로입니다: ${moving.axis.join(' ')}`);

  // 사용률만 떨고 부하는 그대로면 한쪽만 살아 있는 것처럼 보인다. 그리고 떨리는 값이 자릿수까지
  // 정하면 10.0G 가 9.85G 와 10.2G 사이를 오가며 열 너비가 춤춘다 - 움직임이 아니라 고장이다.
  const loads = await page.evaluate(async () => {
    const cells = [...document.querySelectorAll('.node-axis em[data-live-load]')];
    const seen = cells.map((cell) => new Set([cell.textContent]));
    const widths = cells.map((cell) => new Set([cell.textContent.length]));
    await new Promise((done) => {
      const started = performance.now();
      const tick = () => {
        cells.forEach((cell, index) => { seen[index].add(cell.textContent); widths[index].add(cell.textContent.length); });
        (performance.now() - started < 2000 ? requestAnimationFrame(tick) : done());
      };
      requestAnimationFrame(tick);
    });
    return { total: cells.length, moved: seen.filter((set) => set.size > 1).length, resized: widths.filter((set) => set.size > 1).length };
  });
  assert.ok(loads.total > 0, '노드 칸의 부하 숫자를 찾지 못했습니다');
  assert.equal(loads.moved, loads.total, `부하 숫자 ${loads.total}개 중 ${loads.moved}개만 떨립니다`);
  assert.equal(loads.resized, 0, `부하 숫자 ${loads.resized}개가 글자 수까지 바뀌어 열이 흔들립니다`);
  assert.equal(moving.headline.length, 1, `헤드라인 숫자는 흔들리지 않아야 한다: ${moving.headline.join(' ')}`);

  // 끄면 멈춘다. 켜 둔 채로는 값을 적을 수 없으므로 끌 수 있어야 한다.
  await page.locator('[data-number-motion="off"]').click();
  const stopped = await sampleMotion(1400);
  assert.equal(stopped.axis.length, 1, `떨림을 껐는데 값이 계속 움직입니다: ${stopped.axis.join(' ')}`);
  await page.close();
}

// 설명은 설명하는 것 옆에 있어야 한다. 화면 구석에 붙어 있으면 눈이 버튼과 글 사이를 계속
// 오가야 하고, 화면이 넓을수록 그 거리가 멀어져 무엇을 가리키는지 흐려진다.
async function verifyTourAnchoring() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => localStorage.clear());
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.locator('#guide-button').click();
  await page.waitForSelector('.tour');
  // 안내 문구가 못 박은 개수를 말하면 설계를 더할 때마다 틀린 말이 된다.
  assert.match(await page.locator('.tour-text').textContent(), new RegExp(`${templateCount}개 설계`),
    '첫 단계가 실제 설계 개수를 말해야 한다');
  for (let step = 0; step < 9; step += 1) {
    await page.waitForTimeout(380);
    const placed = await page.evaluate(() => {
      const box = document.querySelector('.tour').getBoundingClientRect();
      const spotEl = document.getElementById('tour-spot');
      if (spotEl.hidden) return null;
      const spot = spotEl.getBoundingClientRect();
      const gapX = Math.max(0, Math.max(spot.left - box.right, box.left - spot.right));
      const gapY = Math.max(0, Math.max(spot.top - box.bottom, box.top - spot.bottom));
      return {
        title: document.querySelector('.tour h2')?.textContent ?? '',
        distance: Math.hypot(gapX, gapY),
        overlaps: box.left < spot.right && spot.left < box.right && box.top < spot.bottom && spot.top < box.bottom,
        inView: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
      };
    });
    if (placed) {
      assert.ok(placed.distance <= 40, `${placed.title}: 설명 상자가 강조한 곳에서 ${Math.round(placed.distance)}px 떨어져 있습니다`);
      assert.equal(placed.overlaps, false, `${placed.title}: 설명 상자가 가리키는 곳을 덮습니다`);
      assert.equal(placed.inView, true, `${placed.title}: 설명 상자가 화면 밖으로 나갔습니다`);
    }
    const next = page.locator('[data-tour="next"]');
    if (!(await next.isEnabled())) break;
    await next.click();
  }
  await page.close();
}

try {
  await verify({ width: 1440, height: 1000 }, '.impeccable/review/desktop.png', true);
  await verify({ width: 390, height: 844 }, '.impeccable/review/mobile.png');
  await verifyCanvasEditing();
  await verifyBackendPool();
  await verifyNumberMotion();
  await verifyTourAnchoring();
  const reducedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reducedPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  assert.equal(await reducedPage.locator('.packet-dot').first().evaluate((node) => getComputedStyle(node).display), 'none');
  await reducedPage.close();
  assert.deepEqual(failures, []);
  console.log('Browser smoke passed: interaction, backend pool, number motion, overflow, console, desktop and mobile captures');
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
