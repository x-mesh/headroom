import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { server } from './scripts/serve.mjs';
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const browser = await chromium.launch();
const snap = {};
for (const [name, width, height] of [['desktop', 1600, 1050], ['mobile', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  // 떨림이 켜져 있으면 글자가 바뀌어 폭도 바뀐다. CSS 비교에는 잡음이다.
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('rack-mesh-number-motion', 'off'); });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-editor-action="new"]').click();
  await page.waitForTimeout(300);
  snap[name] = await page.evaluate(() => {
    const props = ['display', 'position', 'color', 'background-color', 'border-color', 'border-width', 'font', 'padding', 'margin', 'width', 'height', 'opacity', 'stroke', 'stroke-width', 'fill', 'z-index', 'grid-template-columns', 'flex', 'gap', 'text-align', 'letter-spacing', 'transform'];
    return [...document.querySelectorAll('*')].map((el, index) => {
      const s = getComputedStyle(el);
      return `${index}|${el.tagName}|` + props.map((p) => s.getPropertyValue(p)).join('~');
    });
  });
  await page.close();
}
writeFileSync(process.argv[2], JSON.stringify(snap));
console.log('요소', snap.desktop.length);
await browser.close(); server.close();
