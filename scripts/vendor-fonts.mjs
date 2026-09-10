// Pretendard 한글 웹폰트를 vendor/ 고지와 public/fonts/ 로 가져온다.
// 네트워크를 쓰는 스크립트이며 수동 실행한다. 빌드와 앱은 내려받은 woff2 만 읽는다.
//
// 왜 폰트를 벤더링하는가: DESIGN.md 의 타이포 스택은 Avenir Next 인데 이 서체에 한글이
// 없어서, 그동안 한글은 전부 OS 대체 서체(macOS 는 Apple SD Gothic Neo)로 그려졌다.
// 음절 블록이 좁고 세로로 길어 옆의 라틴 숫자보다 길어 보였고, 무엇보다 어느 서체로
// 그려질지가 보는 사람의 OS 에 달려 있었다. 판정 화면의 글자가 기계마다 달라지면 안 된다.
//
// 서브셋을 쓰지 않고 두 굵기 전체를 가져오는 이유: 사용자가 장비 이름과 영역을 직접
// 입력하고 프로젝트 파일로 불러온다. 상용 2350자만 담으면 그 밖의 글자가 대체 서체로
// 빠져 한 줄 안에서 서체가 섞인다. @font-face 의 unicode-range 로 한글에만 적용하므로
// 라틴은 여전히 Avenir Next 가 그리고, font-display: swap 이라 첫 페인트를 막지도 않는다.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = resolve(root, 'vendor/pretendard');
const fontDir = resolve(root, 'public/fonts');
const version = '1.3.9';
const registry = `https://cdn.jsdelivr.net/npm/pretendard@${version}/dist/web/static/woff2`;

// UI 가 실제로 쓰는 굵기만. body 는 400, 제목과 데이터 라벨은 600 이다.
export const WEIGHTS = [
  { name: 'Regular', weight: 400 },
  { name: 'SemiBold', weight: 600 },
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function fetchBinary(url) {
  const response = await fetch(url, { headers: { accept: 'font/woff2', 'user-agent': 'rack-mesh-vendor-fonts' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// woff2 는 'wOF2' 시그니처로 시작한다. CDN 이 오류 페이지를 200 으로 돌려주는 경우를 잡는다.
export function assertWoff2(buffer, label) {
  const signature = buffer.subarray(0, 4).toString('latin1');
  if (signature !== 'wOF2') throw new Error(`${label}: woff2 시그니처가 아닙니다 (${signature}).`);
  if (buffer.byteLength < 100_000) throw new Error(`${label}: ${buffer.byteLength} 바이트로 너무 작습니다.`);
  return buffer;
}

async function main() {
  await mkdir(vendorDir, { recursive: true });
  await mkdir(fontDir, { recursive: true });

  const files = [];
  for (const { name, weight } of WEIGHTS) {
    const file = `Pretendard-${name}.woff2`;
    const buffer = assertWoff2(await fetchBinary(`${registry}/${file}`), file);
    await writeFile(resolve(fontDir, file), buffer);
    files.push({ file, weight, bytes: buffer.byteLength, sha256: sha256(buffer) });
    process.stdout.write(`${file} ${(buffer.byteLength / 1024).toFixed(0)} KB\n`);
  }

  await writeFile(resolve(vendorDir, 'PROVENANCE.json'), `${JSON.stringify({
    upstream: 'https://github.com/orioncactus/pretendard',
    package: `pretendard@${version}`,
    path: 'dist/web/static/woff2',
    fetchedAt: new Date().toISOString().slice(0, 10),
    files,
    license: 'SIL Open Font License 1.1',
  }, null, 2)}\n`);

  await writeFile(resolve(vendorDir, 'NOTICE.md'), `# Pretendard — third-party notice

Rack Mesh draws Hangul with Pretendard. The pinned display face, Avenir Next, has no
Hangul coverage, so before this the glyphs came from whatever the reader's OS chose.

## Source

- Upstream: https://github.com/orioncactus/pretendard
- Package: \`pretendard@${version}\`, files \`dist/web/static/woff2/Pretendard-{Regular,SemiBold}.woff2\`
- Checksums and byte counts: see \`PROVENANCE.json\`

The two files under \`public/fonts/\` are copied byte for byte from that package.
Run \`npm run fonts:vendor\` to refetch them.

## License

Pretendard is licensed under the SIL Open Font License, Version 1.1, with the
Reserved Font Name Pretendard. Copyright (c) 2021 Kil Hyung-jin.

- License text: https://github.com/orioncactus/pretendard/blob/main/LICENSE
- The OFL permits bundling and web use. It requires this notice to ship with the
  font files and forbids releasing a modified version under the reserved name.

Rack Mesh ships the files unmodified and does not rename them.

## Scope

\`styles.css\` binds these faces with a \`unicode-range\` limited to Hangul, so Latin
text, digits, and the monospace data voice are unaffected.
`);

  process.stdout.write(`vendor/pretendard 고지 갱신 완료\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
}
