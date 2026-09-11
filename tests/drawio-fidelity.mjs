import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { applyDrawioImport, createDrawioPreview, parseDrawioDocument, renderDrawioPageSvg } from '../public/drawio-import.js';
import { exportDiagramSvg } from '../public/diagram.js';
import { parseProject, serializeProject } from '../public/project.js';

const exec = promisify(execFile);
const target = process.argv.includes('--target');
const manifestPath = target ? process.env.DRAWIO_TARGET_MANIFEST : process.env.DRAWIO_REFERENCE_MANIFEST;
if (!manifestPath) { console.log(JSON.stringify({ status: 'skipped', reason: target ? 'DRAWIO_TARGET_MANIFEST is required' : 'DRAWIO_REFERENCE_MANIFEST is required' })); process.exit(0); }
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.references) || !manifest.references.length) throw new Error('reference manifest is empty');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const viewBox = (svg) => (svg.match(/\bviewBox="([^"]+)"/)?.[1] || '').trim().split(/\s+/).map(Number);
const unsafe = (svg) => /<script\b|<foreignObject\b|\bon[a-z]+\s*=|(?:href|xlink:href)="(?:https?:|javascript:)/i.test(svg);
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

async function comparePng(referencePath, candidatePath) {
  const [referenceBytes, candidateBytes] = await Promise.all([readFile(referencePath), readFile(candidatePath)]);
  assert.deepEqual(pngSize(referenceBytes), pngSize(candidateBytes), 'raster dimensions differ');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ reference, candidate }) => {
      const load = (encoded) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `data:image/png;base64,${encoded}`; });
      const [aImage, bImage] = await Promise.all([load(reference), load(candidate)]); const width = aImage.width; const height = aImage.height; const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(aImage, 0, 0); const a = context.getImageData(0, 0, width, height).data; context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bImage, 0, 0); const b = context.getImageData(0, 0, width, height).data;
      const lum = (data, i) => .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; const ink = (data, i) => Math.min(data[i], data[i + 1], data[i + 2]) < 245;
      const near = (data, x, y) => { for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy += 1) for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx += 1) if (ink(data, (yy * width + xx) * 4)) return true; return false; };
      let abs = 0; let changed = 0; let inter = 0; let union = 0; let tp = 0; let fp = 0; let fn = 0; let minAX = width; let minAY = height; let maxAX = -1; let maxAY = -1; let minBX = width; let minBY = height; let maxBX = -1; let maxBY = -1; const luminanceA = new Float64Array(width * height); const luminanceB = new Float64Array(width * height);
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const i = (y * width + x) * 4; const at = y * width + x; const av = luminanceA[at] = lum(a, i); const bv = luminanceB[at] = lum(b, i); abs += Math.abs(av - bv); if (Math.abs(av - bv) > 16) changed += 1; const ia = ink(a, i); const ib = ink(b, i); if (ia || ib) union += 1; if (ia && ib) inter += 1; if (ia) { minAX = Math.min(minAX, x); minAY = Math.min(minAY, y); maxAX = Math.max(maxAX, x); maxAY = Math.max(maxAY, y); if (near(b, x, y)) tp += 1; else fn += 1; } if (ib) { minBX = Math.min(minBX, x); minBY = Math.min(minBY, y); maxBX = Math.max(maxBX, x); maxBY = Math.max(maxBY, y); if (!near(a, x, y)) fp += 1; } }
      const windowSize = 8; const c1 = 6.5025; const c2 = 58.5225; let ssim = 0; let windows = 0;
      for (let top = 0; top + windowSize <= height; top += windowSize) for (let left = 0; left + windowSize <= width; left += windowSize) { let sa = 0; let sb = 0; let saa = 0; let sbb = 0; let sab = 0; for (let y = top; y < top + windowSize; y += 1) for (let x = left; x < left + windowSize; x += 1) { const av = luminanceA[y * width + x]; const bv = luminanceB[y * width + x]; sa += av; sb += bv; saa += av * av; sbb += bv * bv; sab += av * bv; } const n = windowSize * windowSize; const ma = sa / n; const mb = sb / n; const va = saa / n - ma ** 2; const vb = sbb / n - mb ** 2; const cov = sab / n - ma * mb; ssim += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2)); windows += 1; }
      const n = width * height; return { windowedSsim: ssim / windows, edgeF1: 2 * tp / Math.max(1, 2 * tp + fp + fn), inkIou: inter / Math.max(1, union), mae: abs / n, changedPercent: changed / n * 100, inkBounds: { reference: [minAX, minAY, maxAX, maxAY], candidate: [minBX, minBY, maxBX, maxBY] } };
    }, { reference: referenceBytes.toString('base64'), candidate: candidateBytes.toString('base64') });
  } finally { await browser.close(); }
}

async function rasterizeSvgInChromium(svg, path, width, height, graphicsOnly = false) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const style = `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:${width}px!important;height:${height}px!important}${graphicsOnly ? 'foreignObject,text{display:none!important}' : ''}</style>`;
    await page.setContent(`${style}${svg}`);
    await writeFile(path, await page.screenshot({ type: 'png' }));
  } finally { await browser.close(); }
}

async function metricControls() {
  const dir = await mkdtemp(join(tmpdir(), 'rack-mesh-fidelity-control-'));
  try {
    const base = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="white"/><rect x="5" y="5" width="8" height="8" fill="black"/></svg>';
    const moved = base.replace('x="5"', 'x="8"'); const recolored = base.replace('fill="black"', 'fill="#e7157b"');
    for (const [name, svg] of [['base', base], ['moved', moved], ['recolored', recolored]]) { await writeFile(join(dir, `${name}.svg`), svg); await exec('rsvg-convert', ['-w', '20', '-h', '20', '-o', join(dir, `${name}.png`), join(dir, `${name}.svg`)]); }
    const identical = await comparePng(join(dir, 'base.png'), join(dir, 'base.png')); const translated = await comparePng(join(dir, 'base.png'), join(dir, 'moved.png')); const color = await comparePng(join(dir, 'base.png'), join(dir, 'recolored.png'));
    assert.ok(identical.windowedSsim > translated.windowedSsim && identical.edgeF1 > translated.edgeF1 && identical.inkIou > translated.inkIou); assert.ok(identical.windowedSsim > color.windowedSsim); return { identical, translated, recolored: color };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const total = { references: 0, pages: 0, elements: 0, accounted: 0, missing: 0, images: 0, fallback: 0, unsupportedStyle: 0, dangling: 0, unsafe: 0 };
const officialPngDiagnostic = []; const sameSvgRasterizerDiagnostic = []; const sameSvgChromium = []; const scratch = await mkdtemp(join(tmpdir(), 'rack-mesh-fidelity-'));
try {
  for (const reference of manifest.references) {
    const document = await parseDrawioDocument(await readFile(reference.drawioPath || reference.path, 'utf8')); total.references += 1;
    for (const page of document.pages) {
      const officialSvg = target && reference.officialSvgPath ? await readFile(reference.officialSvgPath, 'utf8') : null; const officialView = officialSvg ? viewBox(officialSvg) : null; const officialPng = target && reference.officialPngPath ? await readFile(reference.officialPngPath) : null; const size = officialPng ? pngSize(officialPng) : null;
      const preview = createDrawioPreview(document, page.id); const variant = process.env.DRAWIO_RENDER_VARIANT; const svg = renderDrawioPageSvg(page, document.assets, officialView ? { viewport: { x: officialView[0], y: officialView[1], width: officialView[2], height: officialView[3] }, includeSourceIds: true, ...(variant === 'no-resource-background' ? { renderResourceBackground: false } : {}), ...(variant === 'no-labels' ? { renderLabels: false } : {}), ...(variant === 'no-aws-glyphs' ? { renderAwsGlyphs: false } : {}), ...(variant === 'no-frames' ? { renderFrames: false } : {}), ...(variant === 'no-edges' ? { renderEdges: false } : {}) } : {}); const restored = parseProject(serializeProject(applyDrawioImport({ devices: [], links: [], demands: [] }, preview).topology, { scale: 1 })); const exported = exportDiagramSvg(restored.topology, null, { detailLevel: 'off' }); const outcomes = restored.topology.diagram.drawioImport.outcomes;
      total.pages += 1; total.elements += page.elements.length; total.accounted += Object.keys(outcomes).length; total.missing += page.elements.length - Object.keys(outcomes).length; total.images += page.elements.filter((x) => x.imageAssetId).length; total.fallback += page.elements.filter((x) => /fallback/.test(x.drawioShape)).length; total.unsupportedStyle += page.warnings.filter((x) => x.code === 'unsupported-style').length; total.dangling += page.warnings.filter((x) => x.code === 'dangling-edge').length; total.unsafe += Number(unsafe(svg) || unsafe(exported));
      if (officialView && size) { const candidateSvg = join(scratch, `${officialPngDiagnostic.length}.svg`); const candidatePng = join(scratch, `${officialPngDiagnostic.length}.png`); const officialRasterPng = join(scratch, `${officialPngDiagnostic.length}-official-rsvg.png`); const officialChromiumPng = join(scratch, `${officialPngDiagnostic.length}-official-chromium.png`); const candidateChromiumPng = join(scratch, `${officialPngDiagnostic.length}-candidate-chromium.png`); const officialGraphicsPng = join(scratch, `${officialPngDiagnostic.length}-official-graphics.png`); const candidateGraphicsPng = join(scratch, `${officialPngDiagnostic.length}-candidate-graphics.png`); await writeFile(candidateSvg, svg); await exec('rsvg-convert', ['-w', String(size.width), '-h', String(size.height), '-o', candidatePng, candidateSvg]); await exec('rsvg-convert', ['-w', String(size.width), '-h', String(size.height), '-o', officialRasterPng, reference.officialSvgPath]); await Promise.all([rasterizeSvgInChromium(officialSvg, officialChromiumPng, size.width, size.height), rasterizeSvgInChromium(svg, candidateChromiumPng, size.width, size.height), rasterizeSvgInChromium(officialSvg, officialGraphicsPng, size.width, size.height, true), rasterizeSvgInChromium(svg, candidateGraphicsPng, size.width, size.height, true)]); officialPngDiagnostic.push({ ...(await comparePng(reference.officialPngPath, candidatePng)), viewBoxDelta: officialView.map((v, i) => Math.abs(v - viewBox(svg)[i])), aspectDelta: Math.abs((viewBox(svg)[2] / viewBox(svg)[3]) / (officialView[2] / officialView[3]) - 1) * 100 }); sameSvgRasterizerDiagnostic.push(await comparePng(officialRasterPng, candidatePng)); sameSvgChromium.push({ full: await comparePng(officialChromiumPng, candidateChromiumPng), graphicsOnly: await comparePng(officialGraphicsPng, candidateGraphicsPng) }); }
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
const controls = target ? await metricControls() : null; const expectation = target ? manifest.references[0] : null; const gates = target && officialPngDiagnostic.length ? { viewBox: officialPngDiagnostic.every((x) => x.viewBoxDelta.every((d) => d <= 2)), aspect: officialPngDiagnostic.every((x) => x.aspectDelta <= .2), sameRendererSsim: sameSvgChromium.every((x) => x.full.windowedSsim >= .96), edgeF1: sameSvgChromium.every((x) => x.full.edgeF1 >= .95), inkIou: sameSvgChromium.every((x) => x.full.inkIou >= .9) } : null;
const passed = total.missing === 0 && total.unsafe === 0 && (!target || (total.elements === expectation.expectedElements && total.images === expectation.expectedImages && total.fallback === expectation.expectedFallback && total.unsupportedStyle === expectation.expectedUnsupportedStyle && total.dangling === expectation.expectedDanglingWarnings && Object.values(gates).every(Boolean)));
console.log(JSON.stringify({ status: passed ? 'passed' : 'failed', ...total, ...(gates ? { gates, officialPngDiagnostic, sameSvgRasterizerDiagnostic, sameSvgChromium, controls } : {}), digest: digest(JSON.stringify({ total, officialPngDiagnostic, sameSvgRasterizerDiagnostic, sameSvgChromium })) })); process.exit(passed ? 0 : 1);
