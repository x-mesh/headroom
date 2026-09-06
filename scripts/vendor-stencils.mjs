// drawio 스텐실 서브셋을 vendor/ 로 가져온다. 네트워크를 쓰는 유일한 스크립트이며 수동 실행한다.
// 빌드(scripts/build-icons.mjs)는 이 스크립트의 산출물만 읽으므로 완전히 오프라인이다.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = resolve(root, 'vendor/drawio-stencils');
const repo = 'jgraph/drawio';
const stencilPath = 'src/main/webapp/stencils/networks.xml';
const licensePath = 'src/main/webapp/stencils/LICENSE';

export const SHAPES = [
  'Switch', 'Router', 'Firewall', 'Load Balancer', 'Server', 'Storage', 'Rack', 'Cloud',
  'Proxy Server', 'Web Server', 'Virtual Server', 'NAS Filer', 'Hub', 'Mainframe',
  'Secured', 'Comm Link', 'Security Camera', 'Wireless Hub', 'Modem',
  'Mail Server', 'External Storage', 'Tape Storage', 'Users',
];

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function fetchText(url, accept = 'text/plain') {
  const response = await fetch(url, { headers: { accept, 'user-agent': 'rack-mesh-vendor-stencils' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}

async function resolveCommit(ref) {
  const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(stencilPath)}&sha=${ref}&per_page=1`;
  const [commit] = JSON.parse(await fetchText(url, 'application/vnd.github+json'));
  if (!commit?.sha) throw new Error(`${stencilPath}의 커밋을 찾지 못했습니다.`);
  return { sha: commit.sha, date: commit.commit?.committer?.date || null };
}

// 업스트림 바이트를 그대로 잘라낸다. 재직렬화하지 않으므로 grep 으로 원본과 대조할 수 있다.
export function extractShapes(xml, names) {
  const blocks = xml.match(/<shape\b[^>]*>[\s\S]*?<\/shape>/g) || [];
  const found = new Map();
  for (const block of blocks) {
    const name = block.match(/\bname="([^"]*)"/)?.[1];
    if (!name) continue;
    if (found.has(name)) throw new Error(`도형 이름이 중복입니다: ${name}`);
    found.set(name, block);
  }
  const missing = names.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`업스트림에 없는 도형: ${missing.join(', ')}`);
  return names.map((name) => found.get(name));
}

async function main() {
  const ref = process.argv[2] || 'dev';
  const commit = await resolveCommit(ref);
  const raw = `https://raw.githubusercontent.com/${repo}/${commit.sha}`;
  const [xml, license] = await Promise.all([fetchText(`${raw}/${stencilPath}`), fetchText(`${raw}/${licensePath}`)]);
  const subset = `<shapes name="mxgraph.networks">\n${extractShapes(xml, SHAPES).join('\n')}\n</shapes>\n`;

  await mkdir(vendorDir, { recursive: true });
  await writeFile(resolve(vendorDir, 'networks.subset.xml'), subset);
  await writeFile(resolve(vendorDir, 'LICENSE.txt'), license);
  await writeFile(resolve(vendorDir, 'PROVENANCE.json'), `${JSON.stringify({
    upstream: `https://github.com/${repo}`,
    path: stencilPath,
    commit: commit.sha,
    commitDate: commit.date,
    fetchedAt: new Date().toISOString().slice(0, 10),
    upstreamBytes: Buffer.byteLength(xml, 'utf8'),
    upstreamSha256: sha256(xml),
    subsetSha256: sha256(subset),
    shapes: SHAPES,
    license: 'Apache-2.0 + stencils/LICENSE restriction',
  }, null, 2)}\n`);

  console.log(`networks.subset.xml  ${Buffer.byteLength(subset, 'utf8')} bytes · ${SHAPES.length} shapes`);
  console.log(`upstream             ${commit.sha} (${commit.date})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
