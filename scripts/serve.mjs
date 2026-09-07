import { createReadStream, existsSync, readFileSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 브라우저가 쓰는 것만 내준다. 예전에는 저장소 루트를 그대로 서빙해서 .git 과 node_modules,
// 내부 문서까지 열려 있었다 - Makefile 의 기본 HOST 가 0.0.0.0 이라 같은 망 전체에 열렸다.
const root = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const port = Number(process.env.RACK_MESH_PORT || process.argv[2] || 4173);
const host = process.env.RACK_MESH_HOST || process.argv[3] || '127.0.0.1';
const dev = process.env.RACK_MESH_DEV === '1';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const reloadPath = '/__reload';
const reloadTag = `<script>new EventSource(${JSON.stringify(reloadPath)}).onmessage = () => location.reload();</script>`;
const clients = new Set();

export const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname);
  if (dev && pathname === reloadPath) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    response.write('retry: 500\n\n'); clients.add(response); request.on('close', () => clients.delete(response)); return;
  }
  const relative = normalize(pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  const path = resolve(join(root, relative));
  if (!path.startsWith(`${root}/`) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found'); return;
  }
  const type = mime[extname(path)] || 'application/octet-stream';
  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  if (dev && extname(path) === '.html') {
    const html = readFileSync(path, 'utf8');
    response.end(html.includes('</body>') ? html.replace('</body>', `${reloadTag}</body>`) : html + reloadTag); return;
  }
  createReadStream(path).pipe(response);
});

function watchRoot() {
  let timer = null;
  watch(root, { recursive: true }, (_event, name) => {
    if (!name || /^(node_modules|\.)/.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { for (const client of clients) client.write('data: reload\n\n'); }, 60);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (dev) watchRoot();
  server.listen(port, host, () => console.log(`Rack Mesh: http://${host}:${port}${dev ? ' (reload on)' : ''}`));
}
