import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyDrawioImport, createDrawioPreview, parseDrawioDocument } from '../public/drawio-import.js';
import { parseProject, serializeProject } from '../public/project.js';

const directory = process.env.DRAWIO_CORPUS_DIR;
if (!directory) { console.log(JSON.stringify({ status: 'skipped', reason: 'DRAWIO_CORPUS_DIR is required' })); process.exit(0); }
const files = (await readdir(directory)).filter((name) => /\.drawio$/i.test(name));
const spaces = Object.fromEntries(['IN', 'IV', 'TECH'].map((space) => [space, files.filter((name) => name.startsWith(`${space}-`)).length]));
if (files.length !== 30 || Object.values(spaces).some((count) => count !== 10)) { console.log(JSON.stringify({ status: 'failed', files: files.length, spaces })); process.exit(1); }
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
const passed = aggregate.files === 30 && aggregate.pages === 38 && aggregate.roundTrips === 38 && aggregate.acceptedRoundTrips === 38;
console.log(JSON.stringify({ status: passed ? 'passed' : 'failed', ...aggregate, digest }));
process.exit(passed ? 0 : 1);
