// simple-icons 에서 장비 제조사 마크만 골라 vendor/ 와 src/logos.js 로 가져온다.
// 네트워크를 쓰는 두 스크립트 중 하나이며 수동 실행한다. 빌드와 앱은 산출물만 읽는다.
//
// 패키지는 CC0-1.0 이지만 마크 자체의 상표권은 각 소유자에게 있다. 식별 목적으로만 쓰고,
// 제휴나 승인을 뜻하지 않는다는 고지를 NOTICE.md 가 담는다.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = resolve(root, 'vendor/brand-logos');
const outputFile = resolve(root, 'src/logos.js');
const registry = 'https://cdn.jsdelivr.net/npm/simple-icons';

// 이 도구가 다루는 장비를 만드는 회사들. 카탈로그에 없는 제조사는 약칭 배지로 남는다.
export const VENDORS = [
  'Cisco', 'Juniper Networks', 'Fortinet', 'Palo Alto Networks', 'F5', 'Huawei',
  'Dell', 'NVIDIA', 'Broadcom', 'MikroTik', 'Ubiquiti', 'NETGEAR', 'TP-Link',
  'Citrix', 'VMware', 'NGINX', 'Cloudflare', 'Akamai',
];

const slugOf = (title) => title.toLowerCase().replace(/[^a-z0-9]/g, '');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function fetchText(url, accept) {
  const response = await fetch(url, { headers: { accept, 'user-agent': 'rack-mesh-vendor-logos' } });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}
const fetchJson = async (url) => JSON.parse(await fetchText(url, 'application/json'));

// 마크는 24x24 뷰박스에 path 하나다. 그 형태를 벗어나면 우리 렌더 모델이 틀렸다는 신호다.
export function pathFromSvg(svg, title) {
  if (!/viewBox="0 0 24 24"/.test(svg)) throw new Error(`${title}: 24x24 뷰박스가 아닙니다.`);
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(([, d]) => d);
  if (paths.length !== 1) throw new Error(`${title}: path 가 ${paths.length}개입니다.`);
  if (!/^[Mm]/.test(paths[0])) throw new Error(`${title}: path 가 이동 명령으로 시작하지 않습니다.`);
  return paths[0];
}

export function pickIcons(icons, wanted) {
  const bySlug = new Map(icons.map((icon) => [icon.slug || slugOf(icon.title), icon]));
  const missing = wanted.filter((title) => !bySlug.has(slugOf(title)));
  if (missing.length) throw new Error(`카탈로그에 없는 제조사: ${missing.join(', ')}`);
  return wanted.map((title) => {
    const icon = bySlug.get(slugOf(title));
    if (!/^[0-9a-fA-F]{6}$/.test(icon.hex || '')) throw new Error(`${title}: hex 색이 없습니다.`);
    return { slug: icon.slug || slugOf(title), title: icon.title, hex: `#${icon.hex.toLowerCase()}` };
  });
}

function renderModule(icons, provenance) {
  const entries = icons.map(({ slug, title, path, hex }) =>
    `  ${slug}: Object.freeze({ title: ${JSON.stringify(title)}, hex: '${hex}', path: ${JSON.stringify(path)} }),`).join('\n');
  return `// 생성 파일. 고치지 말 것. scripts/vendor-logos.mjs 를 실행해 다시 만든다.
// 출처: ${provenance.upstream} @ ${provenance.version} (${provenance.license})
// 마크의 상표권은 각 소유자에게 있다. 식별 목적이며 제휴나 승인을 뜻하지 않는다.

/** simple-icons 24x24 단일 path 마크. 키는 제조사명을 소문자 영숫자로 줄인 값이다. */
export const VENDOR_LOGOS = Object.freeze({
${entries}
});

export const VENDOR_LOGO_SOURCE = Object.freeze(${JSON.stringify(provenance, null, 2).replace(/\n/g, '\n')});

/** 사용자가 적은 제조사 문자열에서 카탈로그 키를 찾는다. 없으면 null 이다. */
export function vendorLogoFor(vendor) {
  if (!vendor) return null;
  return VENDOR_LOGOS[String(vendor).toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
}
`;
}

async function main() {
  const pkg = await fetchJson(`${registry}@latest/package.json`);
  const data = await fetchJson(`${registry}@${pkg.version}/data/simple-icons.json`);
  const picked = pickIcons(Array.isArray(data) ? data : data.icons || [], VENDORS);
  const icons = await Promise.all(picked.map(async (icon) => ({
    ...icon, path: pathFromSvg(await fetchText(`${registry}@${pkg.version}/icons/${icon.slug}.svg`, 'image/svg+xml'), icon.title),
  })));
  const provenance = {
    upstream: 'https://github.com/simple-icons/simple-icons',
    version: pkg.version,
    license: pkg.license,
    fetchedAt: new Date().toISOString().slice(0, 10),
    vendors: icons.map(({ slug, title }) => ({ slug, title })),
    subsetSha256: sha256(icons.map(({ slug, path }) => `${slug}:${path}`).join('\n')),
    note: 'Marks remain trademarks of their owners. Used for identification only.',
  };

  await mkdir(vendorDir, { recursive: true });
  await writeFile(resolve(vendorDir, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(resolve(vendorDir, 'NOTICE.md'), `# Brand marks

Device manufacturer marks come from simple-icons (${pkg.license}), version ${pkg.version}.

Each mark stays the trademark of its owner. Rack Mesh shows a mark to identify which
device a limit belongs to. A mark does not mean the owner endorses, certifies, or
partners with this project.

To remove a mark, delete its entry from \`VENDORS\` in \`scripts/vendor-logos.mjs\` and run
\`npm run logos:vendor\`. A device whose manufacturer has no mark shows a short text badge.
`);
  await writeFile(outputFile, renderModule(icons, provenance));
  console.log(`src/logos.js  ${icons.length} marks · simple-icons ${pkg.version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exit(1); });
