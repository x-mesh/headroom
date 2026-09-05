import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../scripts/serve.mjs';

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const paths = ['/', '/styles.css', '/src/app.js', '/src/engine.js', '/src/data.js'];
  for (const path of paths) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `${path} must load`);
    assert.ok((await response.text()).length > 100, `${path} must have content`);
  }
  const missing = await fetch(`${base}/missing.js`);
  assert.equal(missing.status, 404);
  console.log(`Smoke passed: ${paths.length} app resources and 404 boundary`);
} finally {
  server.close();
  await once(server, 'close');
}
