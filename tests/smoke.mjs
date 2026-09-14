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
