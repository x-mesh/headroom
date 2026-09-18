import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { server } from './serve.mjs';

const WIDTH = 1200;
const HEIGHT = 630;
const SHOT_WIDTH = 524;
const SHOT_HEIGHT = 518;
const outputPath = new URL('../public/assets/og-image.png', import.meta.url);

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const browser = await chromium.launch();

// 카드의 그림은 지어낸 목업이 아니라 도입 시연이 실제로 그리는 장면이다. 공유 링크를 연 사람이
// 처음 보는 화면과 같아야 카드가 약속한 것을 앱이 지킨다.
const app = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await app.goto(`http://127.0.0.1:${port}/?lang=en`, { waitUntil: 'networkidle' });
await app.evaluate(() => document.fonts.ready);
await app.waitForSelector('#cold-open');
await app.locator('.cold-open-line').click();
await app.waitForFunction(() => document.querySelectorAll('.mesh-node.cold-open-lit').length === 2 && document.querySelector('.cold-open-tether text'));
await app.waitForTimeout(900);
const clip = await app.evaluate(({ aspect, minWidth }) => {
  const boxes = [...document.querySelectorAll('.mesh-node.cold-open-lit'), document.querySelector('.cold-open-tether rect')].map((node) => node.getBoundingClientRect());
  const left = Math.min(...boxes.map((box) => box.left)) - 60;
  const right = Math.max(...boxes.map((box) => box.right)) + 60;
  // 캔버스 밖의 설명 문장이 잘린 채 들어오면 카드가 읽히지 않는다. 레일 아래, 캔버스 안에서만 자른다.
  const canvas = document.querySelector('.topology-scroll').getBoundingClientRect();
  const floor = Math.max(canvas.top, document.querySelector('.cold-open-rail').getBoundingClientRect().bottom + 8);
  const height = Math.min(Math.max(minWidth, right - left) / aspect, canvas.bottom - floor);
  const width = height * aspect;
  const middle = (Math.min(...boxes.map((box) => box.top)) + Math.max(...boxes.map((box) => box.bottom))) / 2;
  const top = Math.min(Math.max(floor, middle - height / 2), canvas.bottom - height);
  return { x: (left + right) / 2 - width / 2, y: top, width, height };
}, { aspect: SHOT_WIDTH / SHOT_HEIGHT, minWidth: 560 });
const shot = (await app.screenshot({ clip })).toString('base64');
await app.close();

const card = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await card.setContent(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #16332d; color: #f4fbf7; font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif; }
  main { display: grid; grid-template-columns: 1fr ${SHOT_WIDTH}px; gap: 44px; height: 100%; padding: 56px; }
  .copy { display: flex; flex-direction: column; min-width: 0; }
  .brand { display: flex; gap: 14px; align-items: center; }
  .brand svg { width: 40px; height: 40px; fill: none; stroke: #b8e737; stroke-width: 1.6; }
  .brand circle { fill: #b8e737; stroke: none; }
  .brand strong { font: 700 22px/1 "SFMono-Regular", Menlo, Consolas, monospace; letter-spacing: .16em; }
  .kicker { margin: 16px 0 0; color: #b8e737; font: 600 13px/1 "SFMono-Regular", Menlo, Consolas, monospace; letter-spacing: .16em; }
  h1 { margin: auto 0 0; font-size: 54px; font-weight: 600; line-height: 1.08; letter-spacing: -.02em; }
  h1 em { color: #b8e737; font-style: normal; }
  .lede { margin: 22px 0 0; color: #dceae2; font-size: 22px; line-height: 1.4; }
  .url { margin: 34px 0 0; padding-top: 18px; border-top: 1px solid #365a50; color: #9fbcb1; font: 600 15px/1 "SFMono-Regular", Menlo, Consolas, monospace; letter-spacing: .06em; }
  figure { position: relative; margin: 0; height: ${SHOT_HEIGHT}px; overflow: hidden; border: 1px solid #365a50; background: #eaf2ed; }
  figure img { display: block; width: 100%; height: 100%; object-fit: cover; }
  figcaption { position: absolute; top: 14px; left: 14px; padding: 7px 10px; background: #16332d; color: #f4fbf7; font: 700 11px/1 "SFMono-Regular", Menlo, Consolas, monospace; letter-spacing: .14em; }
</style>
</head>
<body>
<main>
  <section class="copy">
    <div class="brand">
      <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M6 8h24M6 18h24M6 28h24M10 5v26M26 5v26"/><circle cx="10" cy="8" r="2"/><circle cx="26" cy="18" r="2"/><circle cx="10" cy="28" r="2"/></svg>
      <strong>HEADROOM</strong>
    </div>
    <p class="kicker">CAPACITY &amp; RESILIENCE PLANNING</p>
    <h1>Redundancy is<br>not bought.<br><em>It is verified.</em></h1>
    <p class="lede">Find what breaks first, inject faults, and see how far a design holds before you buy the hardware.</p>
    <p class="url">x-mesh.github.io/headroom</p>
  </section>
  <figure>
    <img src="data:image/png;base64,${shot}" alt="">
    <figcaption>SYNTHETIC DEMO · ENGINE-COMPUTED</figcaption>
  </figure>
</main>
</body>
</html>`, { waitUntil: 'load' });
await card.evaluate(() => document.fonts.ready);
await writeFile(outputPath, await card.screenshot({ type: 'png' }));
await browser.close();
server.close();
console.log(outputPath.pathname);
