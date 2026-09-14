// three.js 를 public/vendor/ 로 가져오고 vendor/ 에 고지를 쓴다.
//
// 왜 벤더링하는가: 배포 이미지는 public/ 만 담는다(Dockerfile, .dockerignore). 그런데
// spatial-3d.js 와 rack-3d.js 는 /vendor/three.module.js 를 정적으로 import 하고, 그 경로를
// 개발 서버가 node_modules 에서 대신 내주고 있었다. 개발에서는 3D 가 뜨는데 운영에서는 404 가
// 났고, 브라우저 스모크도 개발 서버를 보므로 이 구멍을 잡지 못했다.
//
// 네트워크를 쓰지 않는다. three 는 package.json 이 이미 정확한 버전으로 고정한 의존성이라
// node_modules 에서 그대로 복사하고 체크섬을 남긴다.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = resolve(root, 'vendor/three');
const outDir = resolve(root, 'public/vendor');
const buildDir = resolve(root, 'node_modules/three/build');

// three.module.js 가 three.core.js 를 상대 경로로 가져온다. 둘 다 있어야 한다.
export const FILES = ['three.module.js', 'three.core.js'];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const fail = (message) => { throw new Error(message); };

export async function collect() {
  const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).dependencies?.three
    ?? fail('package.json 에 three 의존성이 없습니다.');
  const files = [];
  for (const file of FILES) {
    const buffer = await readFile(resolve(buildDir, file)).catch(() => fail(`${file} 이 없습니다. npm install 을 먼저 실행하세요.`));
    if (!buffer.length) fail(`${file} 이 비어 있습니다.`);
    files.push({ file, buffer, bytes: buffer.byteLength, sha256: sha256(buffer) });
  }
  return { version, files };
}

function notice(version, files) {
  return `# three.js — third-party notice

Rack Mesh draws the 3D topology and the rack elevation with three.js.

## Source

- Upstream: https://github.com/mrdoob/three.js
- Package: \`three@${version}\`, files \`build/${FILES.join('\`, \`build/')}\`
- Checksums and byte counts: see \`PROVENANCE.json\`

The files under \`public/vendor/\` are copied byte for byte from that package.
Run \`npm run three:vendor\` to refresh them after changing the pinned version.

## Why they are committed

The deployed image copies \`public/\` and nothing else. A path that only the
development server knows how to serve is a path that 404s in production.

## License

three.js is licensed under the MIT License. Copyright (c) 2010-2025 three.js authors.

- License text: https://github.com/mrdoob/three.js/blob/dev/LICENSE
- The MIT licence permits bundling and requires this notice to ship with the files.

Rack Mesh ships them unmodified.
`;
}

function provenance(version, files) {
  return `${JSON.stringify({
    upstream: 'https://github.com/mrdoob/three.js',
    package: `three@${version}`,
    path: 'build',
    fetchedAt: new Date().toISOString().slice(0, 10),
    files: files.map(({ file, bytes, sha256: digest }) => ({ file, bytes, sha256: digest })),
    license: 'MIT',
  }, null, 2)}\n`;
}

async function main() {
  const { version, files } = await collect();
  if (process.argv.includes('--check')) {
    for (const { file, sha256: digest } of files) {
      const current = await readFile(resolve(outDir, file)).catch(() => null);
      if (current === null) fail(`public/vendor/${file} 이 없습니다. \`npm run three:vendor\` 를 실행하세요.`);
      if (sha256(current) !== digest) fail(`public/vendor/${file} 이 three@${version} 과 다릅니다. \`npm run three:vendor\` 를 실행하세요.`);
    }
    process.stdout.write(`three ok · three@${version} · ${files.length} files\n`);
    return;
  }
  await mkdir(outDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  for (const { file, buffer, bytes } of files) {
    await writeFile(resolve(outDir, file), buffer);
    process.stdout.write(`public/vendor/${file} ${(bytes / 1024).toFixed(0)} KB\n`);
  }
  await writeFile(resolve(vendorDir, 'PROVENANCE.json'), provenance(version, files));
  await writeFile(resolve(vendorDir, 'NOTICE.md'), notice(version, files));
  process.stdout.write('vendor/three 고지 갱신 완료\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
