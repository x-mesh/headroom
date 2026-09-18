import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { server } from '../scripts/serve.mjs';

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const paths = ['/', '/styles.css', '/app.js', '/spatial-3d.js', '/rack-3d.js', '/rack.js', '/vendor/three.module.js', '/vendor/three.core.js', '/engine.js', '/data.js', '/icons.js', '/templates.js'];
  for (const path of paths) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `${path} must load`);
    assert.ok((await response.text()).length > 100, `${path} must have content`);
  }
  const document = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const baseHref = document.match(/<base href="([^"]+)">/)?.[1];
  assert.equal(baseHref, './', 'the document must resolve assets from its deployed directory');
  for (const asset of document.matchAll(/<(?:link|script) [^>]+(?:href|src)="([^"]+)"/g)) {
    const resolved = new URL(asset[1], `${base}/headroom/`);
    if (asset[1].startsWith('./')) assert.equal(resolved.pathname.startsWith('/headroom/'), true, `${asset[1]} must retain the Pages project path`);
  }
  // 링크 미리보기는 크롤러가 JS 없이 정적 문서만 읽어 만든다. 공유 태그는 문서에 절대 주소로
  // 박혀 있어야 하고, 가리키는 이미지는 배포본에 있으며 적어 둔 크기와 같아야 한다.
  const pagesUrl = 'https://x-mesh.github.io/headroom/';
  const share = Object.fromEntries([...document.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)">/g)].map(([, key, value]) => [key, value]));
  for (const key of ['og:site_name', 'og:url', 'og:title', 'og:description', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    assert.ok(share[key], `${key} must be in the static document`);
  }
  assert.equal(share['twitter:card'], 'summary_large_image');
  for (const key of ['og:url', 'og:image', 'twitter:image']) assert.ok(share[key].startsWith(pagesUrl), `${key} must be an absolute Pages URL`);
  const shareImagePath = `/${share['og:image'].slice(pagesUrl.length)}`;
  const shareImage = await fetch(`${base}${shareImagePath}`);
  assert.equal(shareImage.headers.get('content-type'), share['og:image:type'], `${shareImagePath} must be served as its declared type`);
  const shareImageBytes = Buffer.from(await shareImage.arrayBuffer());
  assert.deepEqual([shareImageBytes.readUInt32BE(16), shareImageBytes.readUInt32BE(20)], [Number(share['og:image:width']), Number(share['og:image:height'])],
    'og:image must match its declared width and height');
  // 서버가 내주는 것과 배포 이미지가 담는 것이 같아야 한다. 예전에는 /vendor/three.module.js
  // 를 node_modules 에서 대신 내줘서, 스모크는 통과하는데 운영에서는 404 가 났다.
  const shipped = ['/vendor/three.module.js', '/vendor/three.core.js', '/vendor/mx-edge-style.js', '/fonts/Pretendard-Regular.woff2'];
  for (const path of shipped) {
    const served = Buffer.from(await (await fetch(`${base}${path}`)).arrayBuffer());
    const onDisk = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.ok(served.equals(onDisk), `${path} must come from public/, not from outside the deployed image`);
  }
  const missing = await fetch(`${base}/missing.js`);
  assert.equal(missing.status, 404);
  const outside = await fetch(`${base}/../package.json`);
  assert.notEqual(outside.status, 200, 'public/ 밖은 내주지 않아야 합니다');
  console.log(`Smoke passed: ${paths.length} app resources, ${shipped.length} shipped byte-for-byte, and 404 boundary`);
} finally {
  server.close();
  await once(server, 'close');
}
