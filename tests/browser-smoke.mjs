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

async function clickEditorAction(page, action) {
  const button = page.locator(`[data-editor-action="${action}"]`);
  const inEditorMenu = await button.evaluate((node) => Boolean(node.closest('.editor-menu')));
  const inPalette = await button.evaluate((node) => Boolean(node.closest('#component-palette')));
  if (!await button.isVisible()) {
    if (inEditorMenu) await page.locator('.editor-menu').evaluate((menu) => { menu.open = true; });
    else {
      if (await page.locator('#toggle-left-panel').getAttribute('aria-pressed') === 'true') await page.locator('#toggle-left-panel').click();
      if (inPalette && await page.locator('#panel-palette').isHidden()) await page.locator('#tab-palette').click();
    }
  }
  await button.click();
  if (inEditorMenu) await page.locator('.editor-menu').evaluate((menu) => { menu.open = false; });
}

// 캔버스 편집은 선택·스크롤·설계를 모두 바꾸므로 깨끗한 페이지에서 따로 확인한다.
async function verifyCanvasEditing() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}\n${String(error.stack).split("\n").slice(1, 4).join("\n")}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('#failure-grade')?.textContent.includes('단일 장애점'));
  const survivalTile = page.locator('#summary-survival');
  assert.match(await survivalTile.textContent(), /단일 장애점\s*\d+/, '무장애 상태는 활성 장애 0 대신 단일 장애점 수를 보여야 합니다');
  assert.match(await survivalTile.getAttribute('aria-label'), /단일 장애점 \d+개/, '생존성 타일은 장애 목록으로 가는 목적을 읽어야 합니다');
  await survivalTile.click();
  assert.equal(await page.locator('#tab-failure').getAttribute('aria-selected'), 'true', '생존성 타일을 누르면 장애 목록이 열려야 합니다');
  await page.locator('#tab-palette').click();
  await page.waitForFunction(() => document.querySelector('#panel-palette')?.hidden === false);
  // 시작 방법은 좌측 상단 한곳에 모으되, 가장 흔한 템플릿 시작은 한 번 눌러 연다.
  assert.equal(await page.locator('#new-design-button').textContent(), '설계 시작');
  await page.locator('#start-menu-button').click();
  assert.equal(await page.locator('#start-menu').isVisible(), true);
  assert.equal(await page.locator('#start-menu [data-editor-action="new"]').count(), 1);
  assert.equal(await page.locator('#start-menu [data-editor-action="new-blank"]').count(), 1);
  assert.equal(await page.locator('#start-menu [data-editor-action="open"]').count(), 1);
  assert.equal(await page.locator('#start-menu [data-editor-action="import-drawio"]').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#start-menu').isHidden(), true);
  await page.locator('#project-menu-button').click();
  assert.equal(await page.locator('#project-menu [data-editor-action="open"]').count(), 0);
  assert.equal(await page.locator('#project-menu [data-editor-action="import-drawio"]').count(), 0);
  await page.keyboard.press('Escape');

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
  await clickEditorAction(page, 'undo');
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
  await clickEditorAction(page, 'undo');
  await page.waitForFunction((before) => document.querySelectorAll('.link-group').length === before, nodeCount);

  // 팔레트 클릭은 즉시 현재 보이는 캔버스 중앙에 도형 하나를 만들고 선택한다.
  await page.locator('[data-editor-action="shape-rect"]').click();
  assert.equal(await page.locator('.diagram-shape').count(), 1);
  assert.equal(await page.locator('.diagram-shape.selected').count(), 1);
  assert.equal(await page.locator('#inspector-code').textContent(), 'DRAW.IO INSPECTOR');
  assert.equal(await page.locator('[data-shape-inspector-tab="style"]').getAttribute('aria-selected'), 'true');
  await page.locator('[data-shape-inspector-tab="style"]').click();
  assert.equal(await page.locator('[data-shape-eyedropper="fill"]').count(), 1, 'fill provides an eyedropper control');
  assert.equal(await page.locator('[data-shape-native-color="fill"]').count(), 1, 'fill provides the native color picker');
  await page.locator('[data-shape-color-toggle="fill"]').click();
  assert.ok(await page.locator('[data-shape-color-value="fill"]').count() >= 18, 'fill provides a default color palette');
  await page.locator('[data-shape-color-value="fill"][data-color="#fff2cc"]').click();
  assert.match(await page.locator('.diagram-shape').first().getAttribute('style'), /background:#fff2cc/);
  await page.locator('[data-shape-color-toggle="stroke"]').click();
  await page.locator('[data-shape-color-value="stroke"][data-color="#087d70"]').click();
  assert.match(await page.locator('.diagram-shape').first().getAttribute('style'), /border-color:#087d70/);
  await page.locator('[data-shape-effect][name="gradient"]').check();
  assert.match(await page.locator('.diagram-shape').first().getAttribute('style'), /linear-gradient/);
  await page.locator('.shape-effects > summary').click();
  await page.locator('[data-shape-effect][name="shadow"]').check();
  assert.match(await page.locator('.diagram-shape').first().getAttribute('class'), /shadow/);
  await page.locator('[data-shape-inspector-tab="text"]').click();
  await page.locator('[data-resource-form="shape"] input[name="text"]').fill('검사 도형');
  await page.locator('[data-resource-form="shape"] button[type="submit"]').click();
  assert.equal(await page.locator('.diagram-shape').first().textContent(), '검사 도형');
  await page.locator('[data-shape-inspector-tab="arrange"]').click();
  await page.locator('[data-resource-form="shape"] select[name="kind"]').selectOption('ellipse');
  assert.equal(await page.locator('.diagram-shape').first().getAttribute('data-kind'), 'ellipse');
  await page.locator('[data-resource-form="shape"] input[name="x"]').fill('45');
  await page.locator('[data-resource-form="shape"] button[type="submit"]').click();
  assert.match(await page.locator('.diagram-shape').first().getAttribute('style'), /left:45px/);
  await clickEditorAction(page, 'undo');
  assert.doesNotMatch(await page.locator('.diagram-shape').first().getAttribute('style'), /left:45px/);
  await clickEditorAction(page, 'redo');
  assert.match(await page.locator('.diagram-shape').first().getAttribute('style'), /left:45px/);
  const svgDownload = page.waitForEvent('download');
  await page.locator('#export-menu-button').click();
  await page.locator('[data-editor-action="export-svg"]').click();
  assert.match((await svgDownload).suggestedFilename(), /\.svg$/);
  const pngDownload = page.waitForEvent('download');
  await page.locator('#export-menu-button').click();
  await page.locator('[data-editor-action="export-png"]').click();
  assert.match((await pngDownload).suggestedFilename(), /\.png$/);

  await page.locator('[data-editor-action="shape-text"]').click();
  assert.equal(await page.locator('.diagram-shape').count(), 2);
  await page.locator('[data-editor-action="annotation-connect"]').click();
  await page.locator('.diagram-shape').first().click();
  await page.keyboard.press('Escape');
  assert.match(await page.locator('#editor-mode').textContent(), /SELECT/);
  assert.equal(await page.locator('.diagram-connector').count(), 0, 'canceling annotation mode must not create a connector');
  await page.locator('[data-editor-action="annotation-connect"]').click();
  await page.locator('.diagram-shape').first().click();
  await page.locator('.diagram-shape').nth(1).click();
  assert.equal(await page.locator('.diagram-connector').count(), 1, 'annotation connectors remain visually connected but outside the traffic graph');
  const annotationHit = page.locator('.diagram-connector-hit');
  await annotationHit.focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#inspector-heading').textContent(), /연결선 검사/);

  // 잠금은 저장 모델뿐 아니라 화면 조작도 막아야 한다. 일반 클릭은 잠금 안내만 보이고,
  // Alt/Option+클릭으로 인스펙터를 열어 해제한 뒤에만 다시 편집할 수 있다.
  const lockedShape = page.locator('.diagram-shape').first();
  await lockedShape.click();
  await page.locator('[data-diagram-lock]').check();
  assert.match(await lockedShape.getAttribute('class'), /locked/);
  assert.equal(await lockedShape.locator('.diagram-lock-mark').count(), 1);
  await lockedShape.click();
  assert.match(await page.locator('#toast').textContent(), /잠긴 도형/);
  await lockedShape.click({ modifiers: ['Alt'] });
  await page.locator('[data-diagram-lock]').uncheck();
  assert.doesNotMatch(await lockedShape.getAttribute('class'), /locked/);

  await lockedShape.click();
  await page.locator('.diagram-shape').nth(1).click({ modifiers: ['Shift'] });
  await clickEditorAction(page, 'group');
  const groupFrame = page.locator('[data-diagram-group-id] rect');
  assert.equal(await groupFrame.count(), 1, 'a diagram group has a canvas frame that can be selected again');
  await groupFrame.focus();
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#inspector-heading').textContent(), /그룹 검사/);
  await page.locator('[data-diagram-lock]').check();
  assert.equal(await page.locator('[data-diagram-group-id].locked').count(), 1);
  await groupFrame.click({ position: { x: 1, y: 1 } });
  assert.match(await page.locator('#toast').textContent(), /잠긴 그룹/);
  await groupFrame.click({ modifiers: ['Alt'], position: { x: 1, y: 1 } });
  await page.locator('[data-diagram-lock]').uncheck();

  const pageModel = (id, label, x) => `<diagram id="${id}" name="${label}"><mxGraphModel><root><mxCell id="0-${id}"/><mxCell id="1-${id}" parent="0-${id}"/><mxCell id="2-${id}" value="${label}" vertex="1" parent="1-${id}"><mxGeometry x="${x}" y="30" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram>`;
  const drawio = `<mxfile>${pageModel('one', '첫 페이지', 20)}${pageModel('two', '눈으로 확인', 220)}</mxfile>`;
  const historyBeforeDrawio = await page.evaluate(() => window.history.length);
  const shapesBeforeDrawio = await page.locator('.diagram-shape').count();
  await page.evaluate((source) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([source], 'sample.drawio', { type: 'application/vnd.jgraph.mxfile' }));
    document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    window.__drawioSmokeTransfer = transfer;
  }, drawio);
  assert.equal(await page.locator('#drawio-drop-overlay').isVisible(), true, 'drawio 파일이 들어오면 놓을 위치를 화면 전체에 표시한다');
  await page.evaluate(() => document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__drawioSmokeTransfer })));
  await page.waitForFunction(() => document.querySelector('#editor-panel-heading')?.textContent.includes('미리보기'));
  assert.equal(await page.locator('#drawio-drop-overlay').isHidden(), true);
  assert.equal(await page.locator('.diagram-shape').count(), shapesBeforeDrawio, '미리보기를 열어도 현재 캔버스는 바꾸지 않는다');
  assert.equal(await page.locator('.drawio-page-svg').count(), 1, '드롭한 drawio를 적용 전에 구성도로 보여준다');
  assert.match(await page.locator('.drawio-page-svg').textContent(), /첫 페이지/);
  await page.locator('[data-drawio-page]').selectOption({ index: 1 });
  await page.waitForFunction(() => document.querySelector('.drawio-page-svg')?.textContent.includes('눈으로 확인'));
  await page.locator('[data-drawio-decision]').selectOption('device');
  await page.waitForSelector('[data-drawio-kind]');
  await page.locator('[data-drawio-kind]').selectOption('router');
  await page.locator('[data-drawio-apply]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.mesh-node')].some((node) => node.textContent.includes('눈으로 확인')));
  assert.equal(await page.locator('.diagram-shape').count(), 0, '새 구성도로 적용하면 이전 설계 도형을 남기지 않는다');
  assert.equal(await page.evaluate(() => window.history.length), historyBeforeDrawio, 'SPA 가져오기는 페이지를 다시 열지 않는다');
  const devicesBeforeMapping = await page.locator('.mesh-node').count();
  assert.ok(devicesBeforeMapping > 0, '명시한 장비 후보만 토폴로지 장비가 된다');

  const orderedDrawio = `<mxfile><diagram id="ordered" name="순서"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="앞" style="shape=ellipse;fillColor=#abcdef" vertex="1" parent="1"><mxGeometry x="20" y="20" width="40" height="40" as="geometry"/></mxCell><mxCell id="vm" value="가상 서버" style="shape=mxgraph.networks.virtual_server" vertex="1" parent="1"><mxGeometry x="120" y="20" width="80" height="60" as="geometry"/></mxCell><mxCell id="edge" style="strokeColor=#123456" edge="1" source="a" target="vm" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  await page.evaluate((source) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([source], 'ordered.drawio', { type: 'application/vnd.jgraph.mxfile' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, orderedDrawio);
  await page.waitForFunction(() => document.querySelector('#editor-panel-heading')?.textContent.includes('미리보기'));
  await page.locator('[data-drawio-decision]').nth(1).selectOption('device');
  await page.locator('[data-drawio-kind]').selectOption('server');
  await page.locator('[data-drawio-append]').click();
  await page.waitForFunction(() => document.querySelector('.drawio-import-layer')?.innerHTML.includes('#abcdef'));
  const sourceOrder = await page.locator('#drawio-import-layer > [data-drawio-z-index]').evaluateAll((items) =>
    items.map((item) => [Number(item.dataset.drawioZIndex), item.dataset.drawioRole]));
  assert.deepEqual(sourceOrder.slice(-3).map(([zIndex, role]) => [zIndex - sourceOrder.at(-3)[0], role]),
    [[0, 'shape'], [1, 'device'], [2, 'connector']], '가져온 레이어는 새 페이지 안의 도형·장비·연결선 순서를 보존한다');
  assert.equal(sourceOrder.at(-3)[0] > sourceOrder.at(-4)[0], true, '나중에 적용한 페이지는 기존 가져오기 뒤에 쌓인다');
  assert.equal(await page.locator('.mesh-node.drawio-source-hit').count() > 0, true, 'semantic 장비에는 시각 요소를 중복하지 않는 선택 대상이 남는다');
  // 그리지 못한 도형은 개수가 아니라 이름으로 알려야 원본에서 고칠 수 있다.
  const ghostDrawio = `<mxfile><diagram id="ghost" name="유령"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="g" value="없는 도형" style="shape=mxgraph.aws3.server" vertex="1" parent="1"><mxGeometry x="20" y="20" width="40" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  await page.evaluate((source) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([source], 'ghost.drawio', { type: 'application/vnd.jgraph.mxfile' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, ghostDrawio);
  await page.waitForFunction(() => document.querySelector('#editor-panel-heading')?.textContent.includes('미리보기'));
  assert.match(await page.locator('.drawio-warning').last().textContent(), /mxgraph\.aws3\.server/, '미리보기는 그리지 못한 도형의 이름을 말한다');
  await page.locator('[data-drawio-cancel]').click();
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });

  // 가져온 링크에도 트래픽이 보여야 한다. 선은 draw.io 모양 그대로 두고 그 위에 부하를 얹는다.
  // 용량이 비어 있으면 엔진이 limit-missing 으로 재지 않은 값이라고 답하므로 점도 그리지 않는다.
  const trafficDrawio = `<mxfile><diagram id="traffic" name="트래픽"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="src" value="스위치 A" style="shape=mxgraph.networks.switch" vertex="1" parent="1"><mxGeometry x="40" y="400" width="80" height="60" as="geometry"/></mxCell><mxCell id="dst" value="서버 B" style="shape=mxgraph.networks.server" vertex="1" parent="1"><mxGeometry x="360" y="400" width="80" height="60" as="geometry"/></mxCell><mxCell id="wire" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#123456" edge="1" source="src" target="dst" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  await page.evaluate((source) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([source], 'traffic.drawio', { type: 'application/vnd.jgraph.mxfile' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, trafficDrawio);
  await page.waitForFunction(() => document.querySelector('#editor-panel-heading')?.textContent.includes('미리보기'));
  await page.locator('[data-drawio-accept-high]').click();
  await page.locator('[data-drawio-apply]').click();
  await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 2);
  assert.equal(await page.locator('#drawio-import-layer [data-drawio-role="link"]').count(), 1, '장비 두 대를 잇는 선은 주석이 아니라 링크로 들어온다');
  assert.equal(await page.locator('.packet-dot').count(), 0, '용량을 모르는 링크에는 움직이는 점을 그리지 않는다');

  const importedHit = await page.evaluate(() => {
    for (const hit of document.querySelectorAll('.link-hit')) {
      const box = hit.getBoundingClientRect();
      for (let t = 0.3; t <= 0.7; t += 0.1) {
        const x = box.left + box.width * t; const y = box.top + box.height * 0.5;
        if (document.elementFromPoint(x, y) === hit) return { x, y };
      }
    }
    return null;
  });
  assert.ok(importedHit, '가져온 링크의 클릭 영역은 그려진 선 위에 있다');
  await page.mouse.click(importedHit.x, importedHit.y);
  await page.waitForSelector('[data-resource-form="link"]');
  assert.equal(await page.locator('[data-resource-form="link"] input[name="capacityBps"]').inputValue(), '', '가져온 링크의 용량 칸은 null 이 아니라 비어 있다');
  await page.locator('[data-resource-form="link"] input[name="capacityBps"]').fill('10000000000');
  await page.locator('[data-resource-form="link"] button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });

  await page.mouse.click(importedHit.x, importedHit.y);
  await page.waitForSelector('[data-demand-link]');
  await page.locator('[data-demand-link]').click();
  await page.waitForSelector('[data-editor-form="demand"]');
  // 수요 이름은 그대로 id 가 되므로 여기서는 id 로 쓸 수 있는 이름을 넣는다.
  await page.locator('[data-editor-form="demand"] input[name="name"]').fill('imported-demand');
  await page.locator('[data-editor-form="demand"] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.packet-dot').length > 0, null, { timeout: 8000 });
  assert.ok(await page.locator('.link-group .packet-dot').count() > 0, '가져온 링크 위에 트래픽이 흐른다');
  assert.equal(await page.locator('#drawio-import-layer [data-drawio-role="link"]').count(), 1, '트래픽을 얹어도 draw.io 선은 그대로 한 번만 그린다');

  // 가져온 장비는 용량이 비어 있어 계산에 들어가지 못한다. 종류별로 데이터시트를 붙이는
  // 경로가 실제로 값을 채우는지 본다.
  const capacityBefore = await page.evaluate(() => [...document.querySelectorAll('.mesh-node')].length);
  assert.ok(capacityBefore >= 2, '앞 단계에서 가져온 장비가 남아 있다');
  await page.locator('#start-menu-button').click();
  await page.locator('#start-menu [data-editor-action="fill-capacity"]').click();
  await page.waitForSelector('[data-editor-form="capacity-fill"]');
  const kindSelects = page.locator('[data-editor-form="capacity-fill"] select');
  assert.ok(await kindSelects.count() > 0, '용량이 비어 있는 종류가 목록에 뜬다');
  const options = await kindSelects.first().locator('option').count();
  assert.ok(options > 1, '카탈로그 모델이 선택지로 뜬다');
  await kindSelects.first().selectOption({ index: 1 });
  await page.locator('[data-editor-form="capacity-fill"] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('데이터시트 용량'), null, { timeout: 8000 });
  assert.match(await page.locator('#toast').textContent(), /데이터시트 용량을 채웠습니다/);
  // 같은 종류가 남지 않았으면 두 번째 호출은 채울 대상이 없다고 답한다.
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });

  // 가져온 연결선은 그림 레이어에만 그려지고 그 레이어는 클릭을 받지 않는다. 잡이줄이 없으면
  // 선을 고를 수 없고, 고를 수 없으면 끝을 고쳐 링크로 만들 수도 없다.
  const lineDrawio = `<mxfile><diagram id="line" name="선"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="sw" value="스위치" style="shape=mxgraph.networks.switch" vertex="1" parent="1"><mxGeometry x="40" y="300" width="80" height="60" as="geometry"/></mxCell><mxCell id="srv" value="서버" style="shape=mxgraph.networks.server" vertex="1" parent="1"><mxGeometry x="360" y="300" width="80" height="60" as="geometry"/></mxCell><mxCell id="p" value="왼쪽 상자" style="shape=rect" vertex="1" parent="1"><mxGeometry x="40" y="460" width="80" height="50" as="geometry"/></mxCell><mxCell id="q" value="오른쪽 상자" style="shape=rect" vertex="1" parent="1"><mxGeometry x="360" y="460" width="80" height="50" as="geometry"/></mxCell><mxCell id="wire" value="연결" style="edgeStyle=orthogonalEdgeStyle;strokeColor=#993333" edge="1" source="p" target="q" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  await page.evaluate((source) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([source], 'line.drawio', { type: 'application/vnd.jgraph.mxfile' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, lineDrawio);
  await page.waitForFunction(() => document.querySelector('#editor-panel-heading')?.textContent.includes('미리보기'));
  await page.locator('[data-drawio-accept-high]').click();
  await page.locator('[data-drawio-apply]').click();
  await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 2);

  const connectorHit = await page.evaluate(() => {
    const hit = document.querySelector('[data-connector-id*="wire"] .diagram-connector-hit');
    if (!hit) return null;
    const box = hit.getBoundingClientRect();
    for (let t = 0.3; t <= 0.7; t += 0.1) {
      const x = box.left + box.width * t; const y = box.top + box.height * 0.5;
      if (document.elementFromPoint(x, y) === hit) return { x, y };
    }
    return null;
  });
  assert.ok(connectorHit, '가져온 연결선에도 잡이줄이 있어 포인터로 집힌다');
  await page.mouse.click(connectorHit.x, connectorHit.y);
  await page.waitForSelector('[data-resource-form="connector"]');
  // 두 끝이 아직 도형이라 승격은 막혀 있고, 무엇이 막고 있는지 그 자리에서 말해 준다.
  assert.equal(await page.locator('[data-promote-connector]').count(), 0);
  assert.match(await page.locator('[data-resource-form="connector"] .editor-hint').last().textContent(), /장비가 아닙니다/);

  // 끝을 장비로 다시 지정하면 같은 선이 계산에 들어갈 수 있게 된다.
  const deviceValues = await page.locator('[data-resource-form="connector"] select[name="source"] optgroup[label="장비"] option').evaluateAll((items) => items.map((item) => item.value));
  assert.equal(deviceValues.length, 2, '가져온 장비가 끝점 후보로 뜬다');
  await page.locator('[data-resource-form="connector"] select[name="source"]').selectOption(deviceValues[0]);
  await page.locator('[data-resource-form="connector"] select[name="target"]').selectOption(deviceValues[1]);
  await page.locator('[data-resource-form="connector"] button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });
  // 끝이 바뀌면 선도 옮겨 간다. 옛 좌표로 다시 누르면 빈 캔버스를 누르게 된다.
  const movedHit = await page.evaluate(() => {
    const hit = document.querySelector('[data-connector-id*="wire"] .diagram-connector-hit');
    if (!hit) return null;
    const box = hit.getBoundingClientRect();
    for (let t = 0.3; t <= 0.7; t += 0.1) {
      const x = box.left + box.width * t; const y = box.top + box.height * 0.5;
      if (document.elementFromPoint(x, y) === hit) return { x, y };
    }
    return null;
  });
  assert.ok(movedHit, '끝을 옮긴 선도 계속 집힌다');
  await page.mouse.click(movedHit.x, movedHit.y);
  await page.waitForSelector('[data-promote-connector]');
  await page.locator('[data-promote-connector]').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('트래픽 링크로'), null, { timeout: 8000 });
  assert.equal(await page.locator('[data-connector-id*="wire"]').count(), 0, '승격한 선은 주석으로 남지 않는다');
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });

  // 토스트는 화면 하단에 고정이라 아래쪽 노드를 덮는다. 다음 클릭 전에 걷히기를 기다린다.
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, { timeout: 8000 });
  await page.close();
}

// LB 뒤에 서버를 붙이면 손으로 demand 를 적지 않아도 트래픽이 간다. 그게 보이지 않으면
// 사용자는 장비를 그려 놓고 왜 0 인지 알 수 없다 — 붙이기 전과 후를 한 페이지에서 본다.
async function verifyBackendPool() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`pool console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pool pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.locator('#new-design-button').click();
  assert.equal(await page.locator('[data-template="dual-fabric"]').count(), 1, '공유 전원 템플릿을 설계 목록에서 열 수 있어야 합니다');
  await page.locator('[data-template="dual-stack"]').click();
  await page.locator('#tab-palette').click();
  await page.waitForFunction(() => document.querySelector('#panel-palette')?.hidden === false);

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

async function verifySharedPowerTemplate() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
  page.on('pageerror', (error) => failures.push(`shared power template pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.locator('#new-design-button').click();
  const template = page.locator('[data-template="dual-fabric"]');
  await template.waitFor();
  assert.match(await template.textContent(), /PDU-3|공유 전원/, '템플릿 카드가 공유 전원 위험을 설명해야 합니다');
  await template.click();
  const lesson = page.locator('#learning-panel');
  await lesson.locator('[data-lesson-action="fault-domain"]').click();
  await page.waitForFunction(() => document.querySelector('[data-failure-type="domain"][data-failure-id="pdu-3"]')?.getAttribute('aria-pressed') === 'true');
  assert.match(await page.locator('#summary-survival').textContent(), /활성 장애\s*1/);
  await page.locator('#tab-failure').click();
  assert.match(await page.locator('#failure-grade').textContent(), /이중화 무효 PDU-3 SPINE 공용 전원/);
  await page.close();
}

async function verify(viewport, screenshot, interact = false) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}\n${String(error.stack).split("\n").slice(1, 4).join("\n")}`));
  page.on('requestfailed', (request) => failures.push(`request: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  if (viewport.width > 1180) {
    const canvasWidth = await page.locator('.topology-panel').evaluate((node) => node.getBoundingClientRect().width);
    await page.locator('#toggle-left-panel').click();
    await page.waitForFunction(() => document.querySelector('#design-board').getBoundingClientRect().width < 1);
    assert.ok(await page.locator('#design-board').evaluate((node) => node.getBoundingClientRect().width < 1), '접힌 도구 패널은 세로 레일을 남기지 않아야 합니다');
    assert.equal(await page.locator('#toggle-left-panel').isVisible(), true, '도구 펼치기 화살표는 도면 위에 남아야 합니다');
    assert.equal(await page.locator('#panel-palette').evaluate((node) => node.inert), true, '접힌 도구 내용은 키보드 탐색에서 제외해야 합니다');
    await page.locator('#toggle-right-panel').click();
    await page.waitForFunction(() => document.querySelector('#inspector-panel').getBoundingClientRect().width < 1);
    assert.ok(await page.locator('#inspector-panel').evaluate((node) => node.getBoundingClientRect().width < 1), '접힌 검사 패널은 세로 레일을 남기지 않아야 합니다');
    assert.equal(await page.locator('#toggle-right-panel').isVisible(), true, '검사 펼치기 화살표는 도면 위에 남아야 합니다');
    assert.equal(await page.locator('#inspector-content').evaluate((node) => node.inert), true, '접힌 검사 내용은 키보드 탐색에서 제외해야 합니다');
    await page.locator('#toggle-left-panel').click();
    await page.locator('#toggle-right-panel').click();
    await page.waitForFunction((width) => Math.abs(document.querySelector('.topology-panel').getBoundingClientRect().width - width) < 2, canvasWidth);
  }
  assert.match(await page.locator('#summary-survival').textContent(), /단일 장애점\s*\d+/);
  // 캔버스 아래가 지금 무엇이 막고 있는지 문장으로 말해야 한다.
  const restingNote = await page.locator('#bottleneck-note').textContent();
  assert.match(restingNote, /가장 빠듯합니다|한계를 넘었습니다/);
  assert.match(restingNote, /LEAF B → API B/, 'a link must read by its endpoints, not its id');
  // 근거와 용량은 서로 덮지 않는다. 미확정 근거가 있어도 실제 용량 상태를 함께 말한다.
  assert.match(await page.locator('#evidence-state').textContent(), /한계 미확인 [0-9]+개/);
  assert.match(await page.locator('#capacity-state').textContent(), /기준 상태 안정|자원 주의/);
  assert.ok(await page.locator('.summary-strip').evaluate((summary) => summary.compareDocumentPosition(document.querySelector('.editor-deck')) & Node.DOCUMENT_POSITION_FOLLOWING),
    'the judgement summary must appear before the editing toolbar');
  assert.equal(await page.locator('[data-editor-action="verification"]').count(), 1);
  await page.locator('#analysis-menu-button').click();
  await page.locator('[data-editor-action="verification"]').click();
  const verificationCounts = await page.locator('[data-verification-tab] span').allTextContents();
  assert.deepEqual(verificationCounts, ['1', '3', '3', '0'], 'the default scenario exposes service, rack domains, and rack budgets');
  await page.locator('[data-verification-tab="scenario"]').click();
  const scenarioForm = page.locator('[data-editor-form="scenario"]');
  await scenarioForm.locator('[name="name"]').fill('기준 시나리오');
  await scenarioForm.locator('button[type="submit"]').click();
  const savedScenario = page.locator('.saved-scenario', { hasText: '기준 시나리오' });
  await savedScenario.waitFor();
  assert.match(await savedScenario.textContent(), /Public API[\s\S]*(통과|통과 보류|실패|입력 오류)[\s\S]*기준선 동일/,
    'saved scenarios show a service verdict and its baseline comparison');
  await page.locator('[data-verification-tab="domain"]').click();
  const headroomBeforeSuggestion = await page.locator('#summary-headroom').textContent();
  await page.locator('[data-delete-model="domain"][data-model-id="rack-04"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-domain-suggestion]')]
    .some((suggestion) => suggestion.textContent.includes('RACK 04')));
  assert.equal(await page.locator('#summary-headroom').textContent(), headroomBeforeSuggestion, 'a domain suggestion does not change the current calculation');
  await page.locator('[data-domain-suggestion]').filter({ hasText: 'RACK 04' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-delete-model="domain"]').length === 3);
  assert.match(await page.locator('[data-delete-model="domain"][data-model-id="rack-04"]').locator('xpath=parent::*').textContent(), /공간/);
  assert.equal(await page.locator('#summary-headroom').textContent(), headroomBeforeSuggestion, 'accepting a domain declaration does not change the current calculation');
  await page.locator('#editor-close').click();
  assert.match(await page.locator('#topology-heading').textContent(), /(버팁니다|용량을 넘었습니다|계산할 수 없습니다|더 막히는 지점이 없습니다)$/, 'the canvas headline states the answer, not the question');
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
  const voxelKinds = await page.locator('[data-voxel-kind]').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.voxelKind))].sort());
  assert.deepEqual(voxelKinds, ['firewall', 'router', 'server', 'switch'], '대표 장비 네 종류는 voxel chassis를 사용해야 합니다');
  assert.equal(await page.locator('[data-voxel-kind] .voxel-front').count(), await page.locator('[data-voxel-kind]').count(), '각 voxel chassis에는 정면이 있어야 합니다');
  assert.equal(await page.locator('[data-voxel-kind] .voxel-top').count(), await page.locator('[data-voxel-kind]').count(), '각 voxel chassis에는 윗면이 있어야 합니다');
  assert.equal(await page.locator('[data-voxel-kind] .voxel-side').count(), await page.locator('[data-voxel-kind]').count(), '각 voxel chassis에는 측면이 있어야 합니다');
  // 선이 곧을 수도 굽을 수도 있으므로 좌표 속성이 아니라 그려진 길의 끝을 잰다. 어느 모양이든
  // 끝은 심볼 가운데여야 한다 - 거기서 벗어나면 선이 어느 장비에 닿았는지 그림이 말하지 못한다.
  const anchored = await page.evaluate(() => {
    const drawn = document.querySelector('[data-link-id="edge-a-fw-a"] .link');
    const [originX, originY] = document.querySelector('#link-layer').getAttribute('viewBox').split(' ').map(Number);
    const end = drawn.getPointAtLength(drawn.getTotalLength());
    return [end.x - originX, end.y - originY];
  });
  const target = symbols.find((symbol) => symbol.id === 'fw-a').center;
  assert.ok(Math.abs(target[0] - anchored[0]) < 1.5 && Math.abs(target[1] - anchored[1]) < 1.5,
    `link endpoint ${anchored} must land on the symbol center ${target.map((value) => Math.round(value))}`);
  assert.equal(await page.locator('[data-device-id="fw-a"] .node-axis').count(), 4, 'firewall shows one row per configured axis');
  assert.equal(await page.locator('[data-device-id="api-a"] .node-axis').count(), 2, 'server shows one row per configured axis');
  const unknownAxis = await page.locator('[data-device-id="api-a"] .node-axis').last().innerText();
  assert.match(unknownAxis, /—/, 'an unknown limit must read as an em dash');
  assert.doesNotMatch(unknownAxis, /\d%/, 'an unknown limit must never read as a percentage');
  assert.equal(await page.locator('#tab-failure').getAttribute('aria-selected'), 'true', 'a non-empty design opens on the fault sweep');
  assert.equal(await page.locator('.failure-scope-guide p').count(), 3, '장애 분석은 자원 N-1, 도메인 N-1, 도메인 N-2 범위를 구분해야 합니다.');
  assert.match(await page.locator('.failure-scope-guide').textContent(), /장비 또는 링크 하나[\s\S]*함께 실패[\s\S]*동시에 실패/, '각 장애 범위의 단위를 설명해야 합니다.');
  const failureReadingOrder = await page.locator('[data-failure-type="device"]').first().innerText();
  assert.ok(failureReadingOrder.indexOf('끄면') < failureReadingOrder.indexOf('FABRIC'), 'the fault verdict must precede the resource zone');
  const absorbsToggle = page.locator('[data-failure-absorbs-toggle]');
  if (await absorbsToggle.count()) {
    assert.equal(await absorbsToggle.getAttribute('aria-expanded'), 'false', 'absorbing N-2 pairs start collapsed');
    await absorbsToggle.click();
    assert.equal(await absorbsToggle.getAttribute('aria-expanded'), 'true', 'absorbing N-2 pairs expand on demand');
  }
  const resourceAbsorbsToggle = page.locator('[data-failure-resource-absorbs-toggle]');
  if (await resourceAbsorbsToggle.count()) {
    assert.equal(await resourceAbsorbsToggle.getAttribute('aria-expanded'), 'false', 'absorbing resources start collapsed');
    assert.match(await resourceAbsorbsToggle.first().textContent(), /견딤 \d+개 펼치기/, 'the collapsed resource count stays visible');
    await resourceAbsorbsToggle.first().dispatchEvent('click');
    assert.equal(await resourceAbsorbsToggle.first().getAttribute('aria-expanded'), 'true', 'absorbing resources expand on demand');
  }
  assert.deepEqual(await page.locator('.summary-group-label').allTextContents(), ['용량', '전달', '복원력'], '상단 판정을 세 그룹으로 합쳐야 합니다');
  assert.equal(await page.locator('.metric-sparkline').count(), 0, '도면 높이를 차지하던 추이 그래프를 제거해야 합니다');

  // 카드가 담는 수치는 세 단으로 줄일 수 있다. 줄이는 것은 보이는 것뿐이고 계산은 그대로다.
  // 다만 어느 단에서도 미확인은 숨기지 않는다 - 접어 두면 아는 값만 남아 다 안다고 읽힌다.
  const detail = async (level) => {
    if (!await page.locator(`[data-node-detail="${level}"]`).isVisible()) await page.locator('.view-settings > summary').click();
    await page.locator(`[data-node-detail="${level}"]`).click();
    await page.waitForTimeout(150);
    return page.evaluate(() => ({
      rows: document.querySelectorAll('.node-axis').length,
      unknown: [...document.querySelectorAll('.node-axis')].filter((row) => row.textContent.includes('—')).length,
    }));
  };
  assert.equal(await page.locator('[data-node-detail="full"]').getAttribute('aria-pressed'), 'true', '기본은 전체다');
  const full = await detail('full');
  const brief = await detail('brief');
  const off = await detail('off');
  assert.ok(brief.rows < full.rows, `요약이 전체보다 줄어야 한다: ${brief.rows} / ${full.rows}`);
  assert.equal(off.rows, 0, '없앰은 축 줄을 하나도 그리지 않는다');
  assert.equal(await page.locator('.link-label').evaluateAll((labels) => labels.every((label) => label.textContent === 'DOWN')), true, '구성도는 살아 있는 링크의 퍼센트를 숨긴다');
  await page.locator('#export-menu-button').click();
  assert.match(await page.locator('#export-view-state').textContent(), /현재 캔버스 보기\(구성도\)/);
  await page.keyboard.press('Escape');
  assert.equal(brief.unknown, full.unknown, `요약이 미확인 축을 숨겼습니다: ${brief.unknown} / ${full.unknown}`);
  await detail('full');

  // 여러 개를 고르는 두 손놀림. 예전에는 pointerdown 이 보조키를 무시하고 선택을 덮어써서,
  // 이어지는 click 의 토글이 방금 넣은 것을 도로 빼 아무것도 안 남았다.
  const picked = () => page.evaluate(() => document.querySelectorAll('.mesh-node.multi-selected').length);
  for (const [id, modifiers, want, why] of [
    ['fw-a', [], 1, '보조키 없는 클릭은 하나만 고른다'],
    ['fw-b', ['Shift'], 2, 'shift 클릭은 선택에 더해야 한다'],
    ['spine-a', ['Meta'], 3, 'cmd 클릭도 같은 손놀림이다'],
    ['fw-b', ['Shift'], 2, '이미 고른 것을 다시 누르면 빠져야 한다'],
    ['fw-a', [], 1, '보조키 없는 클릭은 하나로 되돌린다'],
  ]) {
    await page.locator(`[data-device-id="${id}"]`).click({ modifiers });
    assert.equal(await picked(), want, why);
  }

  // 그룹을 만들면 그 그룹이 곧바로 선택되어 해제할 수 있어야 한다. 장비만 묶은 그룹은
  // 캔버스에서 다시 집을 별도 표식이 없으므로, 이 선택 전환이 빠지면 해제 경로가 막힌다.
  await page.locator('[data-device-id="fw-a"]').click();
  await page.locator('[data-device-id="fw-b"]').click({ modifiers: ['Shift'] });
  await clickEditorAction(page, 'group');
  assert.equal(await page.locator('[data-editor-action="ungroup"]').isDisabled(), false, 'a newly created group must be ready to ungroup');
  await clickEditorAction(page, 'ungroup');
  assert.equal(await page.locator('[data-editor-action="group"]').isDisabled(), false, 'ungrouping must reselect its members');

  // 여럿을 고른 채 하나를 끌면 나머지도 같이 따라와야 한다. 놓는 순간에는 원래도 전부
  // 옮겨졌지만, 끄는 동안 잡은 것만 움직여서 나머지는 안 딸려온다고 읽혔다.
  const spots = () => page.evaluate(() => Object.fromEntries(['fw-a', 'fw-b', 'spine-a'].map((id) => {
    const node = document.querySelector(`[data-device-id="${id}"]`);
    return [id, [Math.round(parseFloat(node.style.left)), Math.round(parseFloat(node.style.top))]];
  })));
  await page.locator('[data-device-id="fw-a"]').click();
  for (const id of ['fw-b', 'spine-a']) await page.locator(`[data-device-id="${id}"]`).click({ modifiers: ['Shift'] });
  const startSpots = await spots();
  await page.locator('[data-device-id="fw-a"]').evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }));
  const grab = await page.locator('[data-device-id="fw-a"]').boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + 20);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2 + 90, grab.y + 80, { steps: 10 });
  const midSpots = await spots();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const endSpots = await spots();
  const shift = (from, to, id) => [to[id][0] - from[id][0], to[id][1] - from[id][1]];
  const led = shift(startSpots, midSpots, 'fw-a');
  assert.ok(led[0] > 40, `끄는 동안 잡은 노드가 따라와야 한다: ${led}, start=${JSON.stringify(startSpots)}, mid=${JSON.stringify(midSpots)}, grab=${JSON.stringify(grab)}`);
  for (const id of ['fw-b', 'spine-a']) {
    assert.deepEqual(shift(startSpots, midSpots, id), led, `${id} 가 끄는 동안 함께 움직여야 한다`);
    assert.deepEqual(shift(startSpots, endSpots, id), shift(startSpots, endSpots, 'fw-a'), `${id} 가 놓은 뒤에도 같은 만큼 옮겨져야 한다`);
  }
  // 뒤 검사는 노드가 제자리에 있는 것을 전제한다.
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(150);
  assert.deepEqual(await spots(), startSpots, '되돌리면 세 노드가 모두 제자리로 온다');

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
  if (viewport.width <= 760) await page.locator('#mobile-inspector-open').click();
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
  if (viewport.width <= 760) await page.locator('#inspector-close-mobile').click();
  await clickEditorAction(page, 'undo');
  await clickEditorAction(page, 'undo');
  await page.waitForFunction((before) => document.querySelector('[data-axis-limit]')?.textContent === before, limitBefore);

  // 안내는 언제든 다시 열 수 있어야 한다. 작업 사본을 복원하면 첫 화면 설명이 함께 오지 않고,
  // 사용자가 만든 설계에는 애초에 가르칠 것이 없다.
  const beforeTour = await page.evaluate(() => ({
    scale: document.querySelector('#scale-input').value, faults: document.querySelector('#summary-faults').textContent,
  }));
  await page.locator('#guide-button').click();
  await page.waitForFunction(() => document.querySelector('#tour')?.hidden === false);
  await page.locator('[data-guide="start"]').click();
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
      const rect = spot.getBoundingClientRect();
      const signature = [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(':');
      const settled = window.__tourSettle === signature;
      window.__tourSettle = signature;
      return settled;
    }, null, { polling: 120 });
    // 실선 박스는 실제 조작 대상 위에 있어야 하고, 설명 상자가 그것을 덮으면 안 된다.
    await page.waitForFunction(() => {
      const spot = document.querySelector('#tour-spot');
      if (spot.hidden) return true;
      const box = document.querySelector('#tour').getBoundingClientRect();
      const rect = spot.getBoundingClientRect();
      const inView = rect.top >= -1 && rect.bottom <= window.innerHeight + 1 && rect.width > 4 && rect.height > 4;
      const clear = box.right < rect.left || box.left > rect.right || box.bottom < rect.top || box.top > rect.bottom;
      return inView && clear;
    }, null, { timeout: 3000 });
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
  const lessonAction = page.locator('#learning-panel [data-lesson-action]').first();
  assert.match(await lessonAction.textContent(), /PDU-3 SPINE 공용 전원 장애 실험/, '이중화 무효 도메인이 템플릿의 고정 실험보다 먼저 제안되어야 합니다');
  await lessonAction.click();
  await page.waitForFunction(() => !document.querySelector('#learning-panel output')?.hidden);
  assert.match(await page.locator('#learning-panel output').textContent(), /끄면 서비스 단절/, 'the experiment result must state the forecast shown for the selected failure');
  assert.equal(await page.locator('[data-failure-type="domain"][data-failure-id="pdu-3"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-failure-type="domain"][data-failure-id="pdu-3"]').click();
  await page.waitForFunction(() => document.querySelector('#summary-fault-label')?.textContent === '단일 장애점');

  // 장비를 바꾸는 것은 인스펙터까지 가지 않고 자리에서 하는 일이다.
  await page.locator('[data-device-id="fw-a"]').dispatchEvent('contextmenu', { bubbles: true, clientX: 240, clientY: 240 });
  await page.waitForFunction(() => !document.querySelector('#context-menu')?.hidden);
  const swap = page.locator('[data-context-action="swap"]');
  await swap.waitFor({ state: 'visible' });
  await swap.evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelector('[data-swap-catalog]'));
  assert.equal(await page.locator('[data-swap-scope="slot"]').getAttribute('aria-pressed'), 'true', 'same-slot replacement is the default');
  assert.match(await page.locator('[data-swap-scope="slot"]').textContent(), /전체 2대/, 'the selected firewall pair is named as one slot');
  await page.locator('[data-swap-scope="single"]').click();
  assert.equal(await page.locator('[data-swap-scope="single"]').getAttribute('aria-pressed'), 'true', 'one device can be selected for staged replacement');
  const choices = await page.locator('[data-swap-catalog]').count();
  assert.ok(choices >= 20, `고를 수 있는 조건이 ${choices}개뿐입니다.`);
  const bindingAxisChoices = await page.locator('[data-swap-binding-axis]').count();
  assert.ok(bindingAxisChoices > 0 && bindingAxisChoices <= choices,
    '병목 축 데이터 표식은 근거가 있는 후보만 구분하고 후보를 숨기지 않아야 합니다.');
  await page.locator('[data-swap-compare]').nth(1).click();
  await page.locator('[data-swap-compare]').nth(2).click();
  assert.match(await page.locator('[data-swap-open-comparison]').textContent(), /2\/4/, '사용자가 고른 후보 수를 비교 전에 보여야 합니다.');
  await page.locator('[data-swap-open-comparison]').click();
  assert.equal(await page.locator('[data-swap-comparison-row]').count(), 2, '선택한 후보만 나란히 비교해야 합니다.');
  const comparison = await page.locator('#editor-panel-content').textContent();
  assert.match(comparison, /현재 설계와 워크로드 조건에서만 유효/, '후보 비교의 토폴로지 종속 고지가 필요합니다.');
  assert.doesNotMatch(comparison, /권장|1위|최고/, '후보 비교가 추천이나 순위를 말하면 안 됩니다.');
  await page.locator('[data-swap-back-picker]').click();
  await page.locator('#swap-search').fill('ASA');
  await page.waitForFunction(() => document.querySelectorAll('[data-swap-catalog]:not([hidden])').length < 20);
  const narrowed = await page.locator('[data-swap-catalog]:not([hidden])').count();
  assert.ok(narrowed > 0 && narrowed < choices, '검색이 조건 목록을 좁혀야 합니다.');
  await page.locator('[data-swap-catalog]:not([hidden])').first().click();
  await page.waitForFunction(() => document.querySelector('[data-swap-variant="candidate"]')?.getAttribute('aria-pressed') === 'true');
  assert.match(await page.locator('.swap-preview').textContent(), /한 대만 치환합니다/, 'single-device replacement warns about asymmetric capacity');
  assert.equal(await page.locator('[data-swap-variant="current"]').getAttribute('aria-label'), '현재 장비: DEMO-FW-42K');
  assert.match(await page.locator('[data-swap-variant="candidate"]').getAttribute('aria-label'), /^치환 장비: Secure Firewall 3105$/);
  const blockedPreview = await page.locator('.swap-preview').textContent();
  assert.match(blockedPreview, /수치 비교는 보류합니다/, 'unmatched candidate evidence must defer numeric comparison');
  assert.doesNotMatch(blockedPreview, /병목 (이동|그대로)|생존 배수|정상시 배수|과부하 자원|전력·랙 U 변화/,
    'any unaccepted candidate axis must block every derived comparison');
  const replacementModel = await page.locator('[data-device-id="fw-a"] .node-model').textContent();
  assert.notEqual(replacementModel, 'DEMO-FW-42K', 'selecting a candidate must activate it without a second apply action');
  const adjustments = page.locator('.swap-adjustments');
  assert.equal(await adjustments.isVisible(), true);
  assert.equal(await adjustments.evaluate((node) => node.open), false, 'condition adjustments start folded');
  assert.equal(await page.locator('[data-swap-evidence-accept]').first().isHidden(), true, 'per-axis acceptance stays hidden until adjustment is requested');
  await adjustments.locator('summary').click();
  assert.equal(await adjustments.evaluate((node) => node.open), true, 'condition adjustments open on demand');
  let acceptedAxes = 0;
  while (await page.locator('[data-swap-evidence-accept]').count()) {
    await page.locator('[data-swap-evidence-accept]').first().click();
    acceptedAxes += 1;
  }
  assert.ok(acceptedAxes > 0, 'the preview must offer per-axis acceptance');
  const swapResult = await page.locator('.swap-preview').textContent();
  assert.match(swapResult, /사용자가 현재 워크로드 조건에서 수락/,
    'accepted axes must state that the user accepted them for the current workload conditions');
  assert.match(swapResult, /생존 배수/, 'accepted axes must unlock the comparison metrics');
  assert.match(swapResult, /랙 예산 미확인/, 'a candidate without a documented power draw must not make the rack budget look safe');
  const resultOrder = ['병목 그대로', '병목 이동', '생존 배수', '정상시 배수', '과부하 자원', '전력·랙 U'];
  const first = resultOrder.find((label) => swapResult.includes(label));
  assert.ok(first, `치환 결과의 병목 문구가 없습니다: ${swapResult}`);
  assert.ok(swapResult.indexOf(first) < swapResult.indexOf('생존 배수'), '병목 결과가 생존 배수보다 먼저 나와야 합니다');
  for (const label of ['생존 배수', '정상시 배수', '과부하 자원', '전력·랙 U']) {
    assert.ok(swapResult.includes(label), `치환 결과에 ${label}가 없습니다: ${swapResult}`);
  }
  assert.ok(swapResult.indexOf('생존 배수') < swapResult.indexOf('정상시 배수')
    && swapResult.indexOf('정상시 배수') < swapResult.indexOf('과부하 자원')
    && swapResult.indexOf('과부하 자원') < swapResult.indexOf('전력·랙 U'), '치환 지표 순서가 PRD와 다릅니다');
  assert.equal(await page.locator('#evidence-state').textContent(), '한계 미확인 6개',
    'accepting the candidate axes must not hide unrelated unknown evidence');
  assert.ok(await page.locator('.evidence-state[data-applicability="user-asserted"]').count() > 0, 'accepted preview axes must persist after application');
  await page.locator('[data-swap-variant="current"]').click();
  assert.equal(await page.locator('[data-swap-variant="current"]').getAttribute('aria-pressed'), 'true', 'current device must be an explicit alternative to the replacement');
  assert.equal(await page.locator('[data-device-id="fw-a"] .node-model').textContent(), 'DEMO-FW-42K', 'current device restores without closing the panel');
  await page.locator('[data-swap-variant="candidate"]').click();
  assert.equal(await page.locator('[data-swap-variant="candidate"]').getAttribute('aria-pressed'), 'true', 'replacement device can be reactivated from the same control');
  assert.equal(await page.locator('[data-device-id="fw-a"] .node-model').textContent(), replacementModel);
  await page.locator('#editor-close').click();

  assert.equal(await page.locator('[data-failure-type="device"], [data-failure-type="link"]').count(), 20, 'every device and link must be failable, not two classes');
  assert.equal(await page.locator('[data-failure-type="domain"]').count(), 3, 'the default rack failure domains must be injectable');
    assert.match(await page.locator('#failure-grade').textContent(), /단일 장애점 \d+개/, 'the panel must grade the design before anything is turned off');
    assert.match(await page.locator('.failure-worst-axes').textContent(), /단일 장애 최악 사용률/);
  const forecasts = await page.locator('[data-failure-type="device"] .failure-forecast, [data-failure-type="link"] .failure-forecast').evaluateAll((nodes) => nodes.map((node) => node.dataset.verdict));
  assert.ok(forecasts.every((verdict) => ['severs', 'overloads', 'absorbs', 'endpoint'].includes(verdict)), 'every row must carry a forecast');
  assert.ok((await page.locator('[data-failure-type="domain"] .failure-forecast').allTextContents()).every((text) => text.includes('끄면 서비스 단절') && text.includes('한계 미확인')),
    '도메인 단절도 한계 미확인 경계를 숨기지 않습니다');
  assert.equal(forecasts[0], 'severs', 'the rows that sever the service sort first');
  assert.ok(await page.locator('.failure-rows').count() > 0, '장애 결과는 목록 구조로 제공해야 합니다');
  const firstFailure = page.locator('[data-failure-type="device"], [data-failure-type="link"]').first();
  const firstFailureName = await firstFailure.getAttribute('aria-label');
  assert.match(firstFailureName, /^[^,]+, 끄면 서비스 단절, .*현재 UP$/, '접근성 이름은 자원명 뒤에 판정과 현재 상태를 읽어야 합니다');
  const failureFilter = page.locator('[data-failure-filter]');
  assert.match(await failureFilter.locator('[data-failure-filter-count]').textContent(), /전체 26개 중 26개 표시/);
  await failureFilter.locator('[data-failure-filter-verdict="severs"]').dispatchEvent('click');
  assert.match(await failureFilter.locator('[data-failure-filter-count]').textContent(), /필터 적용 중 · 전체 26개 중 12개 표시/);
  assert.equal(await page.locator('[data-failure-type="device"] .failure-forecast[data-verdict="overloads"], [data-failure-type="link"] .failure-forecast[data-verdict="overloads"]').count(), 0, 'severity filter hides overload rows');
  await failureFilter.locator('input').fill('leaf a');
  assert.match(await failureFilter.locator('[data-failure-filter-count]').textContent(), /전체 26개 중 2개 표시/);
  await failureFilter.locator('[data-failure-filter-verdict="all"]').dispatchEvent('click');
  await failureFilter.locator('input').fill('');
  assert.match(await page.locator('#bottleneck-note').textContent(), /단일 장애점이 \d+개/, 'the note must name the design as single-point');
  assert.ok(await page.locator('.mesh-node', { hasText: 'SPOF' }).count() > 0, 'a single point of failure must be marked on the canvas too');
  if (viewport.width <= 760) {
    await page.locator('.mesh-node').first().click();
    await page.locator('#mobile-inspector-open').click();
    assert.equal(await page.locator('.inspector-panel').evaluate((node) => node.classList.contains('mobile-open')), true, '모바일에서는 선택 장비의 inspector가 하단 sheet로 열려야 한다');
    assert.equal(await page.locator('#inspector-close-mobile').isVisible(), true);
    await page.locator('#inspector-close-mobile').click();
    assert.equal(await page.locator('.inspector-panel').isVisible(), false);
    assert.equal(await page.locator('.mobile-fault-tray').isVisible(), true);
    assert.match(await page.locator('.mobile-pan-cue').textContent(), /좌우로 탐색/);
    const quickFailure = page.locator('[data-quick-failure]');
    assert.match(await quickFailure.getAttribute('aria-label'), /이중화 무효 도메인 실험: PDU-3 SPINE 공용 전원/);
    await quickFailure.click();
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 1);
    assert.equal(await quickFailure.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#failure-change-live').textContent(), /PDU-3 SPINE 공용 전원 장애를 주입했습니다. 최소 headroom .* 변화/);
  }
  if (interact) {
    const failure = page.locator('[data-failure-type="device"][data-failure-id="fw-a"]');
    await failure.click();
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 1);
    assert.equal(await failure.getAttribute('aria-pressed'), 'true');
    const disabledVoxel = page.locator('[data-device-id="fw-a"] .voxel-chassis');
    const disabledTransform = await disabledVoxel.evaluate((node) => getComputedStyle(node).transform);
    await page.locator('[data-device-id="fw-a"]').hover();
    assert.equal(await disabledVoxel.evaluate((node) => getComputedStyle(node).transform), disabledTransform, '장애 장비는 hover 상태에서도 움직이지 않아야 합니다');
    assert.equal(await disabledVoxel.evaluate((node) => getComputedStyle(node).transitionDuration), '0s', '장애 장비에는 transition이 없어야 합니다');
    assert.equal(await page.locator('[data-device-id="fw-a"] .voxel-led').first().evaluate((node) => getComputedStyle(node).animationName), 'none', '장애 장비 LED는 멈춰야 합니다');
    assert.match(await page.locator('#evidence-state').textContent(), /한계 확인됨|한계 미확인 [0-9]+개/);
    assert.equal(await page.locator('#capacity-state').textContent(), '용량 초과');
    const faultNote = await page.locator('#bottleneck-note').textContent();
    assert.match(faultNote, /한계를 넘었습니다/);
    assert.match(faultNote, /드롭됩니다/, 'the note must say what the overload costs');
    assert.match(faultNote, /거절됩니다/, 'refused sessions are separate from dropped bytes');
    assert.ok(await page.locator('.packet-dot.dropped').count() > 0, 'overloaded packet dots stop before the destination');
    assert.ok(await page.locator('.link.overloaded').first().locator('xpath=..').locator('.packet-dot').count() >= 4, 'overloaded links show the maximum packet density');
    await page.waitForTimeout(900);
    assert.match(await page.locator('[data-device-id="fw-a"]').innerText(), /OFFLINE[\s\S]*DOWN/, 'a disabled node must stay DOWN across telemetry ticks');
    await page.locator('[data-failure-type="link"][data-failure-id="spine-a-leaf-a"]').click();
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 2);
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
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 1);
    assert.match(await page.locator('#comparison-grid').textContent(), /설계 변화[\s\S]*수치 비교 보류/, '기준선 이후 설계가 바뀌면 숫자 델타를 만들면 안 됩니다');

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
    await page.locator('#analysis-menu-button').click();
    await page.locator('[data-editor-action="workload"]').click();
    assert.equal(await page.locator('[data-workload-preset]').count(), 4, '워크로드는 원시 필드보다 프리셋을 먼저 제안해야 한다');
    await page.locator('input[name="packet_size_bytes"]').fill('1518');
    await page.locator('input[name="transport"][value="udp"] + span').click();
    await page.locator('input[name="features_mode"][value="none"] + span').click();
    await page.locator('[data-editor-form="workload"] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.evidence-state[data-applicability="applicable"]'));
    assert.match(await page.locator('.evidence-state[data-applicability="applicable"]').first().textContent(), /조건 일치/,
      'the 1518-byte datasheet row must match a 1518-byte workload');
    assert.ok((await page.locator('[data-device-id="fw-b"] .node-axis').evaluateAll((rows) =>
      rows.map((row) => `${row.querySelector('b').textContent}:${row.dataset.axisState}`))).includes('처리량:healthy'));

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
    assert.ok(threatAxes.includes('처리량:overloaded'), 'threat protection drops 20 Gbps to 1 Gbps once the user accepts that number');
    assert.ok(threatAxes.includes('신규세션:unknown'), 'the datasheet says nothing about sessions under inspection, so it stays unknown');
    // 데이터시트가 값을 적지 않은 축에는 수락할 대상이 없다. 수락 버튼도 두지 않는다.
    assert.equal(await page.locator('[data-evidence-accept]').count(), 0,
      'an axis with no datasheet number has nothing to accept');
    await page.locator('[data-evidence-release="forwarding_bps"]').click();
    await page.waitForFunction(() => !document.querySelector('.evidence-state[data-applicability="user-asserted"]'));

    await page.selectOption('[data-spec-field="profile"]', 'fw-1518');
    await page.waitForFunction(() => document.querySelector('input[name="new_sessions_per_sec"]')?.value === '56000');
    assert.ok(await page.locator('.unit-input select[name="new_sessions_per_sec__unit"]').count(), '한계값은 숫자와 단위를 함께 보여야 한다');
    await page.locator('input[name="new_sessions_per_sec"]').fill('40000');
    await page.locator('[data-resource-form="device"] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.limit-field.corrected'));
    assert.match(await page.locator('.source-correction').textContent(), /보정한 축이 1개/);
    assert.match(await page.locator('.limit-field.corrected small').textContent(), /데이터시트 56 Kcps/,
      'the datasheet value stays visible next to the correction');

    // 내보낸 그림은 화면과 같은 심볼·축·판정을 담는다. 이름표 상자가 아니다.
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-menu-button').click().then(() => page.locator('[data-editor-action="export-svg"]').click()),
  ]);
    const exported = await readTextFile(await svgDownload.path(), 'utf8');
    assert.match(exported, /엔진 \d+\.\d+\.\d+/, 'the exported frame must say which engine computed it');
    assert.match(exported, /<g transform="translate\([-\d.]+ [-\d.]+\) scale\(/, 'the exported frame must carry the device symbols, not name boxes');
    assert.match(exported, />—</, 'an unknown axis must reach the file as an em dash, not a number');
    assert.match(exported, /장애 fw-a/, 'the exported frame must name the fault it was computed under');
    assert.doesNotMatch(exported, /<script|<image|foreignObject/);
    await page.locator('#export-menu-button').click();
    assert.equal(await page.locator('[data-editor-action="export-svg-anonymized"]').count(), 1, '익명 SVG 내보내기를 선택할 수 있어야 합니다');
    assert.equal(await page.locator('[data-editor-action="export-png-anonymized"]').count(), 1, '익명 PNG 내보내기를 선택할 수 있어야 합니다');
    await page.keyboard.press('Escape');
    await page.locator('[data-reset-axis="new_sessions_per_sec"]').click();
    await page.waitForFunction(() => document.querySelector('input[name="new_sessions_per_sec"]')?.value === '56000');
    assert.equal(await page.locator('.limit-field.corrected').count(), 0);
    await page.selectOption('[data-spec-field="catalog"]', '');
    await page.waitForFunction(() => !document.querySelector('[data-spec-field="profile"]'));
    // 설계 편집은 현재 장애 시나리오와 사용자가 확정한 기준선을 바꾸지 않는다.
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 1);
    await failure.click();
    await page.waitForFunction(() => document.querySelector('#summary-fault-label')?.textContent === '단일 장애점');
    const severs = page.locator('.failure-switch').filter({ has: page.locator('.failure-forecast[data-verdict="severs"]') }).first();
    const severId = await severs.getAttribute('data-failure-id');
    await severs.click();
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 1);
    assert.equal(await page.locator('#capacity-state').textContent(), '경로 단절',
      `the forecast promised ${severId} would sever the service, so turning it off must do that`);
    await page.locator(`[data-failure-id="${severId}"]`).click();
    await page.waitForFunction(() => document.querySelector('#summary-fault-label')?.textContent === '단일 장애점');
    await failure.click();
    await page.waitForFunction(() => Number(document.querySelector('#summary-faults')?.textContent) === 1);
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
    await page.locator('#new-design-button').click();
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
    await page.locator('#new-design-button').click();
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
    await page.waitForFunction(() => document.querySelector('#headline-detail').textContent.includes('TLS'));
    assert.match(await page.locator('[data-device-id="lb"] .node-meta').textContent(), /DSR/,
      'the node must say which mode it runs so the device is findable');
    assert.equal(await page.locator('.behavior-choice input:checked').inputValue(), 'dsr');

    // 선 위는 노드 카드가 절반쯤 덮고 있어 화면 좌표로 누르면 카드가 먼저 잡는다. 여기서 재는
    // 것은 겨냥이 아니라 고른 뒤에 벌어지는 일이므로, 클릭을 선의 판정 영역에 곧장 보낸다.
    const clickLink = (index, shift) => page.evaluate(({ index, shift }) => {
      const hit = document.querySelectorAll('.link-hit')[index];
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: shift }));
      return hit.closest('[data-link-id]').dataset.linkId;
    }, { index, shift });
    await clickLink(0, false);
    assert.equal(await page.locator('.link-selection').count(), 1, '고른 선은 화면에서 고른 것으로 보여야 한다');
    await clickLink(1, true);
    const many = await page.locator('.link-selection').count();
    assert.equal(many, 2, `Shift 로 선을 더했는데 ${many}개만 표시됩니다. 여럿을 골라야 한꺼번에 지울 수 있습니다.`);
    // 후광은 선 자체의 색을 덮지 않는다. 넘친 선을 골랐다고 빨강이 사라지면 안 된다.
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.link-selection')]
      .every((halo) => halo.parentElement.querySelector('.link'))), true, '고른 선에도 상태를 말하는 선이 남아야 한다');

    // 상자도 선을 담아야 한다. 두 선의 가운데를 함께 덮는 상자를 그려 확인한다.
    const span = await page.evaluate(() => {
      const mid = [...document.querySelectorAll('.link-hit')].slice(0, 2).map((hit) => {
        const m = hit.getScreenCTM();
        const point = hit.ownerSVGElement.createSVGPoint();
        const midpoint = hit.getPointAtLength(hit.getTotalLength() / 2);
        point.x = midpoint.x; point.y = midpoint.y;
        return point.matrixTransform(m);
      });
      return { left: Math.min(...mid.map((p) => p.x)), right: Math.max(...mid.map((p) => p.x)),
        top: Math.min(...mid.map((p) => p.y)), bottom: Math.max(...mid.map((p) => p.y)) };
    });
    await page.mouse.move(span.left - 24, span.top - 24);
    await page.mouse.down();
    await page.mouse.move(span.right + 24, span.bottom + 24, { steps: 10 });
    await page.mouse.up();
    const boxed = await page.locator('.link-selection').count();
    assert.ok(boxed >= 2, `상자가 선을 ${boxed}개만 담았습니다. 상자는 지나가는 선을 집어야 합니다.`);
    await page.keyboard.press('Escape');

    await page.locator('#new-design-button').click();
    await page.locator('[data-template="blank"]').click();
    await page.waitForFunction(() => document.querySelector('#scenario-subtitle')?.textContent.startsWith('사용자 설계'));
    assert.equal(await page.locator('#scenario-title').textContent(), '빈 설계', 'the header must name the design that is open');
    assert.equal(await page.locator('#summary-headroom').textContent(), '미확인', '한계를 모르면 요약도 미확인으로 남아야 합니다');
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 0);
    // 되돌리기가 실제로 되돌려야 한다.
    await page.locator('#toast [data-toast-undo]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 5);
    await page.locator('#new-design-button').click();
    await page.locator('[data-template="blank"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 0);
    assert.equal(await page.locator('.mesh-node').count(), 0);
    assert.match(await page.locator('#inspector-content').textContent(), /장비가 없습니다/);
    await page.locator('#tab-palette').click();
    // 폼이 물어보는 한계 축은 클래스를 따른다. 스위치는 처리량, 서버는 NIC 다.
    for (const [name, kind, axis] of [['Source A', 'switch', 'forwarding_bps'], ['Target A', 'server', 'nic_bps']]) {
      await clickEditorAction(page, 'device');
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
    await clickEditorAction(page, 'connect');
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
    await page.locator('#analysis-menu-button').click();
    await page.locator('[data-editor-action="verification"]').click();
    assert.equal(await page.locator('[data-verification-tab]').count(), 4, '검증 작업은 네 개 탭으로 나뉘어야 한다');
    assert.equal(await page.locator('[data-verification-panel]:not([hidden])').count(), 1, '검증 폼은 한 번에 하나만 보여야 한다');
    await page.locator('[data-verification-tab="service"]').click();
    const serviceForm = page.locator('[data-editor-form="service"]');
    await serviceForm.locator('[name="name"]').fill('Public API');
    await serviceForm.locator('[name="demandIds"]').check();
    await serviceForm.locator('button[type="submit"]').click();
    assert.match(await page.locator('[data-editor-form="service"]').locator('xpath=preceding-sibling::ul[1]').textContent(), /Public API/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#project-menu-button').click();
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
    const measuredProject = { schemaVersion: 3, product: 'Rack Mesh', topology: cloneTopology(), scenario: { scale: 1, disabledDevices: [], disabledLinks: [], disabledDomains: [], selectedId: 'fw-a' } };
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#project-file-input').setInputFiles({ name: 'measured-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(measuredProject)) });
    await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 10);
    await page.locator('#measured-limits-file-input').setInputFiles({ name: 'measured-limits.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schema: 'rack-mesh-measured-limits', as_of: '2026-09-09T03:00:00Z', entries: [{ target: { kind: 'device', id: 'fw-a' }, axis: 'new_sessions_per_sec', value: 58, unit: 'Kcps', conditions: {}, saturated: false }] })) });
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('관측 하한 1개 보관'));
    await page.locator('#analysis-menu-button').click();
    await page.locator('[data-editor-action="measured-import"]').click();
    const measuredResults = page.locator('.measured-import-results');
    assert.match(await measuredResults.textContent(), /한계 적용 0[\s\S]*관측 하한 1[\s\S]*FW A.*신규 세션.*58 Kcps.*한계 미승격/);
    await page.locator('#editor-close').click();
    await page.locator('[data-device-id="fw-a"]').click();
    assert.match(await page.locator('#inspector-content .observed-floor').textContent(), /관측 하한 58 Kcps · 2026-09-09T03:00:00Z/);
    assert.match(await page.locator('#inspector-content [data-axis-limit="new_sessions_per_sec"]').textContent(), /42 Kcps/, 'an unsaturated observation must not replace the catalog limit');

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
    assert.equal(await page.locator('.palette-group').count(), 5, 'the palette keeps device classes and modeling tools in distinct groups');
    assert.equal(await page.locator('[data-palette-group-toggle="네트워크"]').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-palette-group-toggle="보안 · 트래픽"]').getAttribute('aria-expanded'), 'false');
    await page.locator('[data-palette-group-toggle="보안 · 트래픽"]').click();
    assert.equal(await page.locator('[data-palette-group-toggle="보안 · 트래픽"]').getAttribute('aria-expanded'), 'true',
      'a component group can be expanded without changing the selected tab');
    await page.locator('[data-palette-group-toggle="보안 · 트래픽"]').click();
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.palette-item use')]
      .filter((use) => use.closest('.palette-group-items')?.hidden !== true)
      .every((use) => document.querySelector(use.getAttribute('href')) && use.getBBox().width > 0)), 'every visible palette symbol must resolve');
    // 스텐실이 클래스를 구별해 주지 못하는 자리에서는 손으로 그린 심볼이 앞선다.
    for (const [kind, id] of [['mail', '#glyph-mail'], ['waf', '#glyph-waf'], ['ips', '#glyph-ips'], ['vpn', '#glyph-vpn'], ['server', '#icon-server'], ['db', '#icon-db']]) {
      assert.equal(await page.locator(`.palette-item[data-palette-kind="${kind}"] use`).getAttribute('href'), id,
        `${kind} must draw the symbol that tells its class apart`);
    }
    // 접힌 클래스는 사양 없는 일반 장비다. 펼친 목록은 실제 카탈로그 프로필을 배치한다.
    const switchCount = await page.locator('.mesh-node').count();
    await page.locator('.palette-family [data-palette-kind="switch"]:not([data-palette-catalog])').click();
    await page.waitForFunction((before) => document.querySelectorAll('.mesh-node').length === before + 1, switchCount);
    assert.equal(await page.locator('.mesh-node.selected .node-model').count(), 0, 'the folded switch stays generic');
    assert.ok(await page.locator('.mesh-node.selected .node-axis').evaluateAll((rows) => rows.every((row) => row.dataset.axisState === 'unknown')),
      'the generic switch keeps every limit unknown');

    await page.locator('[data-palette-expand="switch"]').click();
    assert.equal(await page.locator('#palette-catalog-switch').isHidden(), false);
    const catalogChoices = await page.locator('#palette-catalog-switch [data-palette-catalog]').count();
    assert.ok(catalogChoices >= 7, 'the switch family exposes each catalog profile');
    await page.locator('[data-palette-search-input="switch"]').fill('7050SDX4');
    assert.equal(await page.locator('#palette-catalog-switch [data-palette-catalog]:visible').count(), 1, 'search narrows the model profiles');
    assert.match(await page.locator('#palette-catalog-switch [data-palette-result-count]').textContent(), /1개 일치/);
    const profiledCount = await page.locator('.mesh-node').count();
    await page.locator('#palette-catalog-switch [data-palette-catalog]:visible').click();
    await page.waitForFunction((before) => document.querySelectorAll('.mesh-node').length === before + 1, profiledCount);
    assert.equal(await page.locator('.mesh-node.selected .node-model').textContent(), '7050SDX4-48D8');
    assert.match(await page.locator('#toast').textContent(), /프로필을 적용/);

    await page.locator('[data-palette-search-input="switch"]').fill('Nexus 93180');
    const nexusItem = page.locator('#palette-catalog-switch [data-palette-catalog]:visible');
    const nexusBox = await nexusItem.boundingBox();
    const modelDrop = await page.locator('.topology-scroll').boundingBox();
    const beforeModelDrag = await page.locator('.mesh-node').count();
    await page.mouse.move(nexusBox.x + nexusBox.width / 2, nexusBox.y + nexusBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(modelDrop.x + modelDrop.width / 2, modelDrop.y + modelDrop.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((before) => document.querySelectorAll('.mesh-node').length === before + 1, beforeModelDrag);
    assert.equal(await page.locator('.mesh-node.selected .node-model').textContent(), 'Nexus 93180YC-FX',
      'dragging a catalog result keeps the selected model');

    await page.locator('[data-palette-group-toggle="보안 · 트래픽"]').click();
    await page.locator('.palette-item[data-palette-kind="firewall"]').scrollIntoViewIfNeeded();
    const paletteItem = await page.locator('.palette-item[data-palette-kind="firewall"]').boundingBox();
    const canvasBox = await page.locator('#topology-canvas').boundingBox();
    await page.mouse.move(paletteItem.x + paletteItem.width / 2, paletteItem.y + paletteItem.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 240, canvasBox.y + 300, { steps: 10 });
    assert.equal(await page.locator('.palette-ghost').count(), 1, 'dragging must show a ghost');
    assert.ok(await page.locator('.topology-scroll').evaluate((node) => node.classList.contains('drop-target')), 'the topology area must mark itself as a drop target');
    await page.mouse.up();
    await page.waitForFunction((before) => document.querySelectorAll('.mesh-node').length === before + 1, beforeModelDrag + 1);
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
    await page.locator('[data-palette-group-toggle="서버 · 스토리지"]').click();
    await page.locator('.palette-item[data-palette-kind="storage"]').scrollIntoViewIfNeeded();
    const edgeItem = await page.locator('.palette-item[data-palette-kind="storage"]').boundingBox();
    await page.mouse.move(edgeItem.x + edgeItem.width / 2, edgeItem.y + edgeItem.height / 2);
    await page.mouse.down();
    await page.mouse.move(scrolledCanvas.x + 300, beyond, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction((base) => parseFloat(getComputedStyle(document.querySelector('#topology-canvas')).height) > base, beforeEdgeDrop);
    assert.equal(await page.locator('.palette-ghost').count(), 0, 'the ghost must not outlive a drop past the canvas edge');

    const beforeServer = await page.locator('.mesh-node').count();
    await page.locator('.palette-item[data-palette-kind="server"]').click();
    await page.waitForFunction((before) => document.querySelectorAll('.mesh-node').length === before + 1, beforeServer);
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
      const drawn = document.querySelector('[data-link-id="source-a-target-a"] .link');
      const start = drawn.getPointAtLength(0);
      const symbol = document.querySelector('[data-device-id="source-a"] .node-symbol').getBoundingClientRect();
      return Math.hypot((symbol.left + symbol.width / 2) - (svg.left + start.x - x),
        (symbol.top + symbol.height / 2) - (svg.top + start.y - y));
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
    assert.deepEqual([atRest.label, atRest.zoom, atRest.nodeWidth], ['100%', 1, 120]);
    assert.ok(atRest.pad > 0, 'the stage must pad the canvas so there is always empty space to grab');
    assert.equal(atRest.stageWidth, atRest.canvasWidth + atRest.pad * 2);

    await page.locator('[data-zoom="in"]').click();
    const zoomed = await zoomState();
    assert.ok(zoomed.zoom > 1 && zoomed.label === `${Math.round(zoomed.zoom * 100)}%`);
    assert.equal(zoomed.stageWidth, Math.round(atRest.canvasWidth * zoomed.zoom) + zoomed.pad * 2,
      'the stage must carry the scaled canvas plus its padding so the area can scroll');
    assert.equal(zoomed.nodeWidth, Math.round(120 * zoomed.zoom), 'nodes scale with the canvas');

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
    assert.ok((await zoomState()).zoom >= 1, 'fit magnifies a compact diagram to use the available viewport');
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
    assert.ok(emptySpot, 'the topology area must expose empty space to work in');
    // drawio 와 같은 손놀림이다. 빈 곳 왼쪽 드래그는 고르는 것이라 커서도 고르는 모양이어야 한다.
    assert.equal(emptySpot.cursor, 'crosshair', 'empty space must show the selecting cursor');

    const panBefore = await page.evaluate(() => {
      const area = document.querySelector('.topology-scroll');
      return { left: Math.round(area.scrollLeft), top: Math.round(area.scrollTop),
        maxLeft: Math.round(area.scrollWidth - area.clientWidth), maxTop: Math.round(area.scrollHeight - area.clientHeight) }
    });
    assert.ok(panBefore.maxLeft > 0 && panBefore.maxTop > 0, 'the stage padding must leave room to pan in both directions');

    // 왼쪽 드래그는 상자를 그린다. 화면은 밀리지 않아야 한다 - 예전에는 여기서 화면이 밀렸고
    // 상자는 Shift 뒤에 숨어 있어 아무도 찾지 못했다.
    await page.mouse.move(emptySpot.x, emptySpot.y);
    await page.mouse.down();
    await page.mouse.move(emptySpot.x - 200, emptySpot.y - 160, { steps: 8 });
    assert.equal(await page.evaluate(() => !document.getElementById('selection-marquee').hidden), true,
      'dragging empty space with the left button must draw the selection box');
    assert.equal(await page.locator('.topology-scroll.panning').count(), 0, 'the selection box must not pan the area');
    await page.mouse.up();
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('.topology-scroll').scrollLeft)), panBefore.left,
      'drawing a selection box must leave the scroll position alone');
    assert.equal(await page.evaluate(() => !document.getElementById('selection-marquee').hidden), false,
      'the selection box must disappear with the pointer');

    // 선 모양 토글. 굽은 선은 노드 카드를 비켜 가고, 패킷 점도 그 길을 따라야 한다 - 점만
    // 곧게 질러가면 어느 길로 흐르는지가 그림과 어긋난다.
    const shapeOf = () => page.evaluate(() => {
      const paths = [...document.querySelectorAll('.link')];
      return {
        bent: paths.filter((path) => path.getAttribute('d').split(/[LQ]/).length > 2).length,
        total: paths.length,
        motion: document.querySelectorAll('.packet-dot animateMotion').length,
        straightAttrs: paths.filter((path) => path.tagName.toLowerCase() !== 'path').length,
      };
    });
    for (const [mode, label] of [['straight', '직선'], ['orthogonal', '직각'], ['curved', '곡선']]) {
      await page.locator(`[data-link-route="${mode}"]`).click();
      await page.waitForTimeout(120);
      const shape = await shapeOf();
      assert.equal(shape.straightAttrs, 0, '선은 어느 모양이든 path 로 그려야 굽힐 수 있다');
      assert.equal(await page.locator(`[data-link-route="${mode}"]`).getAttribute('aria-pressed'), 'true', `${label} 을 고른 것이 버튼에 나타나야 한다`);
      if (mode === 'curved') assert.equal(shape.bent, shape.total, `${label} 은 모든 선을 굽혀야 한다`);
      if (mode === 'straight') assert.equal(shape.bent, 0, `${label} 은 마디를 만들지 않는다`);
      assert.ok(shape.motion > 0, `${label} 에서도 패킷 점이 선을 따라가야 한다`);
    }
    await page.locator('[data-link-route="straight"]').click();

    // 선을 고르는 일은 고른 것이 보여야 성립한다. 예전에는 고르기는 되는데 화면이 그대로여서
    // 아무 일도 일어나지 않은 것처럼 읽혔고, 상자는 장비와 도형만 담아 선은 하나씩만 고를 수 있었다.

    // 빈 곳에서 오른쪽 버튼을 누르면 브라우저 메뉴가 뜨면 안 된다. macOS 는 누르는 순간 그것을
    // 여는데, 그러면 포인터 잡기가 풀려 밀기가 시작하자마자 죽는다. 헤드리스는 네이티브 메뉴를
    // 열지 않아 스크롤만 재면 이 회귀를 놓친다 - 기본 동작이 막혔는지를 직접 잰다.
    const menuBlocked = await page.evaluate((spot) => new Promise((done) => {
      const area = document.querySelector('.topology-scroll');
      area.addEventListener('contextmenu', (event) => done(event.defaultPrevented), { once: true });
      area.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: spot.x, clientY: spot.y }));
    }), emptySpot);
    assert.equal(menuBlocked, true, 'right-pressing empty space must not open the browser menu, or the pan dies at once');

    // 오른쪽 드래그가 화면을 민다.
    await page.mouse.move(emptySpot.x, emptySpot.y);
    await page.mouse.down({ button: 'right' });
    assert.equal(await page.locator('.topology-scroll.panning').count(), 1, 'panning must mark the area');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.topology-scroll')).cursor), 'grabbing',
      'panning must show the closed hand');
    await page.mouse.move(emptySpot.x - 120, emptySpot.y - 90, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(60);
    const panAfter = await page.evaluate(() => {
      const area = document.querySelector('.topology-scroll');
      return { left: Math.round(area.scrollLeft), top: Math.round(area.scrollTop) };
    });
    assert.ok(Math.abs(panAfter.left - Math.min(panBefore.left + 120, panBefore.maxLeft)) < 3,
      `right-dragging empty space must scroll horizontally, ${panBefore.left} to ${panAfter.left}`);
    assert.ok(Math.abs(panAfter.top - Math.min(panBefore.top + 90, panBefore.maxTop)) < 3,
      `right-dragging empty space must scroll vertically, ${panBefore.top} to ${panAfter.top}`);
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

    // 응답은 되돌아온다. 요청 점과 같은 모양으로 그리면 returnPath 로 응답을 옮겨 놓고도 그림은
    // 예전과 같아져, 무엇이 달라졌는지 화면에서 읽히지 않는다. 응답을 적은 설계에서만 잰다 -
    // 적지 않은 설계의 역방향은 0 이 아니라 미확인이고, 모르는 양을 움직이는 점으로 그리지 않는다.
    await page.locator('#new-design-button').click();
    await page.locator('[data-template="dsr-farm"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.packet-dot.response').length > 0);
    const flows = await page.evaluate(() => ({
      request: document.querySelectorAll('.packet-dot:not(.response)').length,
      response: document.querySelectorAll('.packet-dot.response').length,
      backward: [...document.querySelectorAll('.packet-dot.response animateMotion')]
        .filter((motion) => motion.getAttribute('keyPoints') === '1;0').length,
    }));
    assert.ok(flows.request > 0, '요청 패킷이 흘러야 한다');
    assert.ok(flows.response > 0, '응답 패킷이 요청과 다른 모양으로 되돌아와야 한다');
    assert.equal(flows.backward, flows.response, '응답 패킷은 선을 거꾸로 달려야 한다');

    // 굴곡을 손으로 옮긴다. 자동 경로가 늘 원하는 자리로 가지는 않으므로, 고른 선에 손잡이가
    // 붙고 끌면 마디가 생겨야 한다. 두 번 누르면 그 마디가 사라져 자동 경로로 돌아간다.
    // 도면을 갈아 끼우므로 interact 의 맨 끝에 둔다 - 앞에 두면 뒤따르는 단계가 앞 도면의
    // 장비를 찾지 못하고, 앞에서 재 둔 빈 자리도 빈 자리가 아니게 된다.
    await page.locator('#new-design-button').click();
    await page.locator('[data-template="three-tier"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.link-hit').length >= 4);
    await page.locator('.zoom-control [data-zoom="fit"]').click();
    await page.waitForTimeout(150);
    // 여백을 눈대중으로 잡지 않고, 그 자리를 눌렀을 때 실제로 손잡이가 잡히는지로 고른다.
    // 노드 카드가 선 위에 그려지므로 화면 밖이거나 카드 밑인 손잡이는 눌러도 다른 것이 눌린다.
    const grab = await page.evaluate(() => {
      const reachable = (handle) => {
        const box = handle.getBoundingClientRect();
        const x = box.left + box.width / 2; const y = box.top + box.height / 2;
        return document.elementFromPoint(x, y) === handle ? { x, y } : null;
      };
      // id 를 먼저 모은다. 링크를 고를 때마다 층이 다시 그려져 앞서 담아 둔 요소는 떨어져
      // 나가고, 그것에 보낸 클릭은 문서에 닿지 않는다 - 첫 링크만 재고 끝나 버린다.
      const ids = [...document.querySelectorAll('.link-hit')].map((hit) => hit.closest('[data-link-id]').dataset.linkId);
      for (const id of ids) {
        document.querySelector(`[data-link-id="${id}"] .link-hit`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        for (const handle of document.querySelectorAll(`[data-link-id="${id}"] .link-handle[data-bend-kind="insert"]`)) {
          const at = reachable(handle);
          if (at) return { id, ...at };
        }
      }
      return null;
    });
    assert.ok(grab, '굴곡 손잡이가 눌리는 링크가 하나는 있어야 잰다');
    const shapeAt = () => page.evaluate((id) => document.querySelector(`[data-link-id="${id}"] .link`).getAttribute('d'), grab.id);
    const beforeBend = await shapeAt();
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 70, grab.y - 80, { steps: 6 });
    assert.notEqual(await shapeAt(), beforeBend, '끄는 동안 선이 따라와야 어디에 놓을지 정할 수 있다');
    await page.mouse.up();
    await page.waitForFunction((id) => document.querySelectorAll(`[data-link-id="${id}"] .link-handle[data-bend-kind="move"]`).length === 1, grab.id);
    const pinned = await page.locator(`[data-link-id="${grab.id}"] .link-handle[data-bend-kind="move"]`).first().boundingBox();
    // 두 번 누르면 지운다. dblclick 이 아니라 눌린 간격을 직접 재는 것은, 끌기를 위해 기본
    // 동작을 막으면 호환 마우스 이벤트가 오지 않기 때문이다.
    await page.mouse.click(pinned.x + pinned.width / 2, pinned.y + pinned.height / 2);
    await page.mouse.click(pinned.x + pinned.width / 2, pinned.y + pinned.height / 2);
    await page.waitForFunction((id) => document.querySelectorAll(`[data-link-id="${id}"] .link-handle[data-bend-kind="move"]`).length === 0, grab.id);

  }
  if (process.env.UPDATE_SCREENSHOTS === '1') await page.screenshot({ path: screenshot, fullPage: true });
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
  await page.locator('.view-settings > summary').click();

  assert.equal(await page.locator('[data-number-motion="on"]').getAttribute('aria-pressed'), 'true',
    '떨림은 기본이 켜짐이다. 대신 끄는 스위치가 늘 화면에 있어야 한다');

  // 배율을 바꾸면 숫자가 곧바로 튀지 않고 이전 값에서 새 값으로 이어진다.
  // 표본은 페이지 안에서 뜬다. 브라우저를 왕복하며 읽으면 260ms 트윈을 놓친다.
  const tween = await page.evaluate(async () => {
    const read = () => document.querySelector('[data-device-id="fw-b"] .node-axis[data-binding] s').textContent;
    const raw = () => document.querySelector('[data-device-id="fw-b"] .node-axis[data-binding] s').dataset.liveUtil;
    const first = read();
    const rawFirst = raw();
    const seen = new Set([first]);
    const input = document.getElementById('scale-input');
    input.value = '150';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((done) => {
      const started = performance.now();
      const tick = () => { seen.add(read()); (performance.now() - started < 420 ? requestAnimationFrame(tick) : done()); };
      requestAnimationFrame(tick);
    });
    return { first, settled: read(), rawFirst, rawSettled: raw(), seen: [...seen] };
  });
  assert.notEqual(tween.rawSettled, tween.rawFirst, '배율을 바꾸면 원값이 달라져야 한다');
  assert.notEqual(tween.settled, tween.first, '배율을 바꾸면 표시값도 달라져야 한다');
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
  const arithmetic = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.axis-row')].find((item) => item.querySelector('[data-live-util]') && item.querySelector('[data-live-load]') && item.querySelector('[data-axis-limit]'));
    const percentNode = row.querySelector('[data-live-util]');
    const loadNode = row.querySelector('[data-live-load]');
    const rawPercent = Number(percentNode.dataset.liveUtil);
    const rawLoad = Number(loadNode.dataset.liveLoad);
    const percent = Number(percentNode.dataset.livePainted);
    const shownLoad = Number(loadNode.dataset.livePainted);
    const limit = rawLoad / rawPercent;
    return { percent, derived: shownLoad / limit };
  });
  assert.ok(Math.abs(arithmetic.percent - arithmetic.derived) <= 1e-6, 'displayed load and percent must share one drift factor');

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
async function verifyTopologyViews() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('rack-mesh-view-test-initialized')) { localStorage.clear(); sessionStorage.setItem('rack-mesh-view-test-initialized', '1'); }
    sessionStorage.setItem('rack-mesh-demo-teaser', '1');
  });
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });

  assert.equal(await page.locator('button[data-topology-view="voxel"]').getAttribute('aria-pressed'), 'true', 'Voxel 도면은 기본 표시 방식이어야 합니다');
  const paletteKinds = await page.locator('[data-palette-kind]').evaluateAll((items) => [...new Set(items.map((item) => item.dataset.paletteKind))]);
  for (const kind of paletteKinds) {
    if (!await page.locator(`[data-voxel-kind="${kind}"]`).count()) {
      await page.locator(`[data-palette-kind="${kind}"]`).first().evaluate((button) => button.click());
    }
  }
  const voxelKinds = await page.locator('[data-voxel-kind]').evaluateAll((items) => [...new Set(items.map((item) => item.dataset.voxelKind))].sort());
  assert.deepEqual(voxelKinds, [...paletteKinds].sort(), '팔레트의 모든 장비 종류는 Voxel 도면을 가져야 합니다');

  await page.locator('button[data-topology-view="classic"]').click();
  assert.equal(await page.locator('[data-voxel-kind]').count(), 0, '기본 도면은 기존 SVG 심볼만 사용해야 합니다');
  assert.equal(await page.locator('.node-glyph').count(), await page.locator('.mesh-node').count(), '기본 도면의 모든 장비에 SVG 심볼이 있어야 합니다');

  await page.locator('button[data-topology-view="spatial"]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.topology-panel').getAttribute('data-topology-view-mode'), 'spatial');
  assert.equal(await page.locator('#spatial-view-tools').isVisible(), true, '3D 공간에는 시점 컨트롤이 보여야 합니다');
  await page.waitForFunction(() => window.__rackMeshSpatial3D?.debug().renderer === 'WebGLRenderer');
  const webglBefore = await page.evaluate(() => window.__rackMeshSpatial3D.debug());
  assert.equal(webglBefore.renderer, 'WebGLRenderer', '3D 공간은 WebGLRenderer를 사용해야 합니다');
  assert.ok(webglBefore.meshes > await page.locator('.mesh-node').count(), '3D 공간은 장비마다 실제 geometry mesh를 만들어야 합니다');
  assert.ok(webglBefore.packets > 0, '3D 공간은 링크 위에 움직이는 traffic mesh를 만들어야 합니다');
  assert.equal(await page.locator('#topology-stage').evaluate((node) => getComputedStyle(node).display), 'none', '3D 공간에서는 DOM 토폴로지를 숨겨야 합니다');
  assert.equal(await page.locator('#spatial-webgl').isVisible(), true, '3D 공간에서는 WebGL 표면을 보여야 합니다');
  await page.locator('[data-spatial-orbit="right"]').click();
  await page.locator('[data-spatial-orbit="right"]').click();
  await page.waitForTimeout(300);
  const webglAfter = await page.evaluate(() => window.__rackMeshSpatial3D.debug());
  assert.notDeepEqual(webglAfter.camera, webglBefore.camera, '시점 버튼은 실제 perspective camera를 움직여야 합니다');
  const canvas = await page.locator('#spatial-webgl-canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * .45, canvas.y + canvas.height * .55);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .42, { steps: 5 });
  await page.mouse.up();
  if (process.env.UPDATE_SCREENSHOTS === '1') await page.screenshot({ path: '.impeccable/review/spatial-desktop.png', fullPage: true });

  await page.locator('button[data-topology-view="voxel"]').click();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('button[data-topology-view="voxel"]').getAttribute('aria-pressed'), 'true', '선택한 표시 방식은 다시 열어도 유지되어야 합니다');
  await page.evaluate(() => {
    localStorage.setItem('rack-mesh-topology-view', 'spatial');
    localStorage.setItem('rack-mesh-spatial-pitch', '30');
    localStorage.setItem('rack-mesh-spatial-yaw', '105');
    localStorage.setItem('rack-mesh-spatial-distance', '24');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rackMeshSpatial3D?.debug().renderer === 'WebGLRenderer');
  const restoredView = await page.evaluate(() => window.__rackMeshSpatial3D.debug().view);
  assert.ok(Math.abs(restoredView.pitch - 30) < .1, `저장한 WebGL pitch를 복원해야 합니다: ${restoredView.pitch}`);
  assert.ok(Math.abs(restoredView.yaw - 105) < .1, `저장한 WebGL yaw를 복원해야 합니다: ${restoredView.yaw}`);
  assert.equal(restoredView.distance, 24, '저장한 WebGL zoom distance를 복원해야 합니다');
  await page.close();
}

async function verifyTourAnchoring() {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  await page.addInitScript(() => localStorage.clear());
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.stack || error.message}`));
  await page.addInitScript(() => window.addEventListener('error', (event) => console.error(`failure-location ${event.filename}:${event.lineno}:${event.colno}`)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tour:not([hidden])');
  assert.match(await page.locator('#tour-title').textContent(), /설계가 어디서 무너지는지/, '첫 방문은 제품 범위를 먼저 설명해야 합니다');
  assert.equal(await page.locator('.guide-capabilities section').count(), 3, '중앙 안내는 세 가지 핵심 기능을 보여야 합니다');
  assert.equal(await page.evaluate(() => localStorage.getItem('rack-mesh-guide-seen')), null, '선택하기 전에는 첫 방문 안내를 본 것으로 기록하지 않아야 합니다');
  await page.locator('[data-guide="start"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('rack-mesh-guide-seen')), '1', '안내를 선택하면 본 상태를 저장해야 합니다');
  await page.locator('[data-tour="skip"]').click();
  await page.waitForFunction(() => document.querySelector('#tour')?.hidden === true);
  await page.locator('#guide-button').click();
  await page.waitForSelector('.tour');
  await page.locator('[data-guide="start"]').click();
  assert.equal(await page.locator('.workspace-switch [data-workspace="rack"]').textContent(), '랙 배치', '랙 기능은 상단 진입점에서 용도를 밝혀야 합니다');
  assert.equal(await page.locator('.topology-view-choice > span').textContent(), '보기', '3D는 토폴로지 표시 방식임을 밝혀야 합니다');
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
  await page.locator('#guide-button').click();
  await page.locator('[data-guide="start"]').click();
  for (let step = 1; step < 9; step += 1) await page.locator('[data-tour="next"]').click();
  await page.locator('[data-tour-destination="spatial"]').click();
  assert.equal(await page.locator('[data-topology-view="spatial"]').getAttribute('aria-pressed'), 'true', '완료 화면에서 3D 토폴로지를 열어야 합니다');
  await page.locator('#guide-button').click();
  await page.locator('[data-guide="start"]').click();
  for (let step = 1; step < 9; step += 1) await page.locator('[data-tour="next"]').click();
  await page.locator('[data-tour-destination="rack"]').click();
  assert.equal(await page.locator('.workspace-switch [data-workspace="rack"]').getAttribute('aria-selected'), 'true', '완료 화면에서 랙 배치를 열어야 합니다');
  await page.close();
}

async function verifyVirtualFailureList() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  const project = await page.evaluate(() => {
    const topology = {
      devices: Array.from({ length: 24 }, (_, index) => ({ id: `n-${index}`, name: `NODE ${index}`, kind: 'hub', zone: 'TEST', position: { x: index * 12, y: 120 }, limits: { forwarding_bps: 1e12 } })),
      links: [],
      demands: [],
    };
    return JSON.stringify({ schemaVersion: 3, product: 'Rack Mesh', topology, scenario: { scale: 1, disabledDevices: [], disabledLinks: [], disabledDomains: [], viewMode: 'edit', selectedId: 'n-0' } });
  });
  const dialog = page.waitForEvent('dialog');
  await page.setInputFiles('#project-file-input', { name: 'large-project.json', mimeType: 'application/json', buffer: Buffer.from(project) });
  (await dialog).accept();
  await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 24);
  await page.locator('#tab-failure').click();
  await page.waitForSelector('[data-failure-virtual]', { timeout: 25000 });
  const virtual = page.locator('[data-failure-virtual^="device-"]').first();
  const virtualKey = await virtual.getAttribute('data-failure-virtual');
  assert.equal(await virtual.getAttribute('role'), 'list', '대량 단일 장애 목록은 접근 가능한 목록이어야 합니다');
  assert.equal(await page.locator('[data-failure-type="device"]').count() < 40, true, '보이는 범위 밖 장비 행은 DOM 에 남기지 않습니다');
  const first = page.locator(`[data-failure-virtual="${virtualKey}"] [data-failure-index="0"] button`);
  await first.focus();
  await page.keyboard.press('End');
  await page.waitForSelector(`[data-failure-virtual="${virtualKey}"] [data-failure-index="23"]`);
  assert.equal(await page.locator(':focus').evaluate((node) => node.closest('[data-failure-index]')?.dataset.failureIndex), '23', 'End 키는 가상 목록의 마지막 장비로 이동해야 합니다');
  assert.equal(await page.locator(':focus').evaluate((node) => node.closest('[data-failure-index]')?.getAttribute('aria-setsize')), '24', '키보드 탐색은 전체 후보 수를 유지해야 합니다');
  await page.close();
}

async function verifyInferredSwapSlot() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-guide-seen', '1'); });
  page.on('pageerror', (error) => failures.push(`swap slot pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  const project = await page.evaluate(() => JSON.stringify({ schemaVersion: 3, product: 'Rack Mesh', topology: {
    devices: [
      { id: 'edge-a', name: 'EDGE A', kind: 'router', zone: 'EDGE', position: { x: 10, y: 10 }, limits: { forwarding_bps: 1e12 } },
      { id: 'edge-b', name: 'EDGE B', kind: 'router', zone: 'EDGE', position: { x: 10, y: 200 }, limits: { forwarding_bps: 1e12 } },
      { id: 'fw-a', name: 'FW A', kind: 'firewall', zone: 'SECURITY', position: { x: 200, y: 10 }, manufacturer: 'Acme', model: 'Pair', limits: { forwarding_bps: 1e12 } },
      { id: 'fw-b', name: 'FW B', kind: 'firewall', zone: 'SECURITY', position: { x: 200, y: 200 }, manufacturer: 'Acme', model: 'Pair', limits: { forwarding_bps: 1e12 } },
      { id: 'spine-a', name: 'SPINE A', kind: 'switch', zone: 'FABRIC', position: { x: 400, y: 10 }, limits: { forwarding_bps: 1e12 } },
      { id: 'spine-b', name: 'SPINE B', kind: 'switch', zone: 'FABRIC', position: { x: 400, y: 200 }, limits: { forwarding_bps: 1e12 } },
    ],
    links: [
      { id: 'edge-a-fw-a', source: 'edge-a', target: 'fw-a', capacity: { forwarding_bps: 10e9 } },
      { id: 'edge-b-fw-b', source: 'edge-b', target: 'fw-b', capacity: { forwarding_bps: 10e9 } },
      { id: 'fw-a-spine-a', source: 'fw-a', target: 'spine-a', capacity: { forwarding_bps: 10e9 } },
      { id: 'fw-b-spine-b', source: 'fw-b', target: 'spine-b', capacity: { forwarding_bps: 10e9 } },
    ], demands: [],
  }, scenario: { scale: 1, disabledDevices: [], disabledLinks: [], disabledDomains: [], viewMode: 'edit', selectedId: 'fw-a' } }));
  const dialog = page.waitForEvent('dialog');
  await page.setInputFiles('#project-file-input', { name: 'symmetric-pair.json', mimeType: 'application/json', buffer: Buffer.from(project) });
  (await dialog).accept();
  await page.waitForFunction(() => document.querySelectorAll('.mesh-node').length === 6);
  await page.locator('[data-device-id="fw-a"]').dispatchEvent('contextmenu', { bubbles: true, clientX: 240, clientY: 240 });
  await page.locator('[data-context-action="swap"]').evaluate((button) => button.click());
  await page.waitForSelector('[data-swap-scope="slot"]');
  assert.match(await page.locator('[data-swap-scope="slot"]').textContent(), /전체 2대/, 'symmetric non-HA peers form one replacement slot');
  await page.close();
}

try {
  if (process.env.ONLY_VIRTUAL_FAILURE_LIST) await verifyVirtualFailureList();
  else {
    await verify({ width: 1440, height: 1000 }, '.impeccable/review/desktop.png', true);
    await verify({ width: 390, height: 844 }, '.impeccable/review/mobile.png');
    await verifyCanvasEditing();
    await verifyBackendPool();
    await verifySharedPowerTemplate();
    await verifyNumberMotion();
    await verifyTopologyViews();
    await verifyTourAnchoring();
    await verifyVirtualFailureList();
    await verifyInferredSwapSlot();
    const reducedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await reducedPage.addInitScript(() => localStorage.setItem('rack-mesh-guide-seen', '1'));
    await reducedPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
    await reducedPage.locator('button[data-topology-view="spatial"]').click();
  assert.equal(await reducedPage.locator('.packet-dot').first().evaluate((node) => getComputedStyle(node).display), 'none');
    assert.equal(await reducedPage.locator('.voxel-led').first().evaluate((node) => getComputedStyle(node).animationName), 'none');
    assert.equal(await reducedPage.locator('.voxel-fan').first().evaluate((node) => getComputedStyle(node).animationName), 'none');
  assert.ok(await reducedPage.locator('#topology-canvas').evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration)) < 0.001);
  await reducedPage.waitForFunction(() => window.__rackMeshSpatial3D?.debug().reducedMotion === true);
  assert.equal(await reducedPage.evaluate(() => window.__rackMeshSpatial3D.debug().reducedMotion), true, '움직임 감소 설정은 WebGL traffic motion도 멈춰야 합니다');
    if (process.env.UPDATE_SCREENSHOTS === '1') await reducedPage.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
    await reducedPage.close();
  }
  assert.deepEqual(failures, []);
  console.log('Browser smoke passed: interaction, backend pool, number motion, overflow, console, desktop and mobile captures');
} finally {
  await browser.close();
  server.close();
  await once(server, 'close');
}
