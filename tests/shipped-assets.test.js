import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';

// 배포 이미지는 public/ 만 담는다(Dockerfile, .dockerignore). 그래서 public/ 안에서 절대
// 경로로 부르는 것은 전부 public/ 안에 파일로 있어야 한다. 개발 서버가 node_modules 에서
// 대신 내주던 /vendor/three.module.js 가 운영에서 404 났던 적이 있다.
const root = resolve(import.meta.dirname, '../public');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(root).filter((path) => ['.js', '.html', '.css'].includes(extname(path)));

// import '/x', url(/x), src="/x", href="/x" 처럼 앱이 브라우저에 시키는 절대 경로만 모은다.
// //cdn 같은 프로토콜 상대 주소와 data:, 앵커는 뺀다.
function referencesIn(text) {
  const found = new Set();
  for (const pattern of [/from\s+['"](\/[^'"]+)['"]/g, /import\(\s*['"](\/[^'"]+)['"]/g,
    /\b(?:src|href)\s*=\s*['"](\/[^'"#?]+)['"]/g, /url\(\s*['"]?(\/[^'")?#]+)/g]) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return [...found].filter((href) => !href.startsWith('//'));
}

test('every absolute path the app loads is a file the image actually ships', () => {
  const missing = [];
  for (const path of sources) {
    for (const href of referencesIn(readFileSync(path, 'utf8'))) {
      const target = resolve(join(root, href.replace(/^\/+/, '')));
      if (!target.startsWith(`${root}/`) || !existsSync(target)) missing.push(`${path.slice(root.length + 1)} → ${href}`);
    }
  }
  assert.deepEqual(missing, [], `public/ 밖을 가리키거나 없는 파일:\n${missing.join('\n')}`);
});

test('the three.js the 3D views import is vendored next to them', () => {
  // 두 파일 다 필요하다. three.module.js 가 three.core.js 를 상대 경로로 가져온다.
  for (const file of ['three.module.js', 'three.core.js']) {
    assert.equal(existsSync(join(root, 'vendor', file)), true, `public/vendor/${file} 이 없습니다`);
  }
  assert.match(readFileSync(join(root, 'vendor/three.module.js'), 'utf8'), /three\.core\.js/);
});
