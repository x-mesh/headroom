import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyDrawioImport, createDrawioPreview, parseDrawioDocument } from '../public/drawio-import.js';
import { parseProject, serializeProject } from '../public/project.js';

const directory = process.env.DRAWIO_CORPUS_DIR;
if (!directory) { console.log(JSON.stringify({ status: 'skipped', reason: 'DRAWIO_CORPUS_DIR is required' })); process.exit(0); }
const files = (await readdir(directory)).filter((name) => /\.drawio$/i.test(name));
const expectedCounts = process.env.DRAWIO_EXPECTED_COUNTS ?? (process.env.DRAWIO_EXPECTED_FILES ? '' : 'IN=10,IV=10,TECH=10');
const expectedSpaces = Object.fromEntries(expectedCounts.split(',').filter(Boolean).map((item) => { const [space, count] = item.split('='); return [space, Number(count)]; }));
const expectedPages = Number(process.env.DRAWIO_EXPECTED_PAGES || (process.env.DRAWIO_EXPECTED_FILES ? 0 : 38));
const spaces = Object.fromEntries(Object.keys(expectedSpaces).map((space) => [space, files.filter((name) => name.startsWith(`${space}-`)).length]));
const expectedFiles = Number(process.env.DRAWIO_EXPECTED_FILES || Object.values(expectedSpaces).reduce((sum, count) => sum + count, 0));
if (files.length !== expectedFiles || Object.entries(expectedSpaces).some(([space, count]) => spaces[space] !== count)) { console.log(JSON.stringify({ status: 'failed', files: files.length, spaces })); process.exit(1); }
const aggregate = { files: 0, pages: 0, elements: 0, warnings: 0, previews: 0, dryRuns: 0, roundTrips: 0, acceptedRoundTrips: 0, acceptedDevices: 0, acceptedLinks: 0, acceptedZones: 0 };
for (const file of files.sort()) {
  const document = await parseDrawioDocument(await readFile(join(directory, file), 'utf8'));
  aggregate.files += 1; aggregate.pages += document.pages.length; aggregate.warnings += document.warnings.length;
  for (const page of document.pages) {
    const preview = createDrawioPreview(document, page.id);
    const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, preview);
    aggregate.elements += page.elements.length; aggregate.previews += 1; aggregate.dryRuns += 1;
    if (applied.applied.devices || applied.applied.links) throw new Error('baseline dry-run created semantic resources');
    parseProject(serializeProject(applied.topology, { scale: 1 })); aggregate.roundTrips += 1;
    const decisions = {};
    for (const candidate of preview.candidates) {
      if (candidate.suggestion.confidence !== 'high') continue;
      if (candidate.suggestion.classification === 'zone') decisions[candidate.id] = 'zone';
      if (candidate.suggestion.classification === 'device' && candidate.suggestion.suggestedDeviceKind) decisions[candidate.id] = { type: 'device', kind: candidate.suggestion.suggestedDeviceKind };
    }
    const accepted = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document, page.id, decisions), decisions);
    parseProject(serializeProject(accepted.topology, { scale: 1 })); aggregate.acceptedRoundTrips += 1;
    aggregate.acceptedDevices += accepted.applied.devices; aggregate.acceptedLinks += accepted.applied.links; aggregate.acceptedZones += accepted.applied.zones;
  }
}
const digest = createHash('sha256').update(JSON.stringify(aggregate)).digest('hex');
const pagesMatch = expectedPages === 0 || aggregate.pages === expectedPages;
const passed = aggregate.files === expectedFiles && pagesMatch && aggregate.roundTrips === aggregate.pages && aggregate.acceptedRoundTrips === aggregate.pages;
console.log(JSON.stringify({ status: passed ? 'passed' : 'failed', ...aggregate, digest }));
process.exit(passed ? 0 : 1);
