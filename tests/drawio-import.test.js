import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { applyDrawioImport, classifyDrawioElement, createDrawioPreview, parseDrawioDocument, plainDrawioText } from '../public/drawio-import.js';
import { parseProject, serializeProject } from '../public/project.js';

const graph = (body) => `<mxfile><diagram id="one" name="One"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
const shape = (id) => `<mxCell id="${id}" value="${id}" style="shape=router" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="40" as="geometry"/></mxCell>`;

test('drawio reader preserves free edges and plain labels without executable markup', async () => {
  const document = await parseDrawioDocument(graph(`${shape('a')}<mxCell id="free" value="&lt;script&gt;x&lt;/script&gt;&lt;br&gt;note" edge="1" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`));
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].elements.filter((item) => item.type === 'edge').length, 1);
  assert.ok(document.warnings.some((item) => item.code === 'dangling-edge'));
  assert.equal(plainDrawioText('<b>one</b><br>two'), 'one\ntwo');
});

test('drawio reader rejects unsafe XML and resource limits', async () => {
  await assert.rejects(parseDrawioDocument('<!DOCTYPE a>'), /엔터티/);
  await assert.rejects(parseDrawioDocument('x'.repeat(4 * 1024 * 1024 + 1)), /4 MB/);
  const pages = Array.from({ length: 65 }, (_, index) => `<diagram id="${index}"></diagram>`).join('');
  await assert.rejects(parseDrawioDocument(`<mxfile>${pages}</mxfile>`), /64개/);
});

test('drawio reader decodes compressed multi-page documents without choosing a page', async () => {
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  const encoded = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
  const source = `<mxfile><diagram id="first" name="One">${encoded}</diagram><diagram id="second" name="Two">${encoded}</diagram></mxfile>`;
  const document = await parseDrawioDocument(source);
  assert.equal(document.pages.length, 2);
  assert.equal(createDrawioPreview(document, document.pages[1].id).page.index, 1);
});

test('classifier uses stencil namespace order and never guesses labels', () => {
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws4.instance2' }).suggestedDeviceKind, 'server');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws4.application_load_balancer' }).suggestedDeviceKind, 'lb');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws4.group' }).classification, 'zone');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.key_management_service' }).classification, 'device-candidate');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=rectangle', text: 'Firewall' }).classification, 'annotation');
  assert.equal(classifyDrawioElement({ type: 'container', rawStyle: '' }).classification, 'zone');
});

test('preview stays semantic-free until explicit device decisions and keeps capacity unknown', async () => {
  const document = await parseDrawioDocument(graph(`${shape('a')}${shape('b')}<mxCell id="edge" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`));
  const preview = createDrawioPreview(document);
  const baseline = applyDrawioImport({ devices: [], links: [], demands: [] }, preview);
  assert.equal(baseline.applied.devices, 0); assert.equal(baseline.applied.links, 0);
  const decisions = { 'drawio-a': { type: 'device', kind: 'router' }, 'drawio-b': { type: 'device', kind: 'switch' } };
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document, document.pages[0].id, decisions), decisions);
  assert.equal(applied.applied.devices, 2); assert.equal(applied.applied.links, 1);
  assert.equal(applied.topology.links[0].capacity.forwarding_bps, null);
});

test('drawio annotations keep only project-safe connector styles and labels', async () => {
  const source = graph(`${shape('a')}<mxCell id="free" value="&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;" edge="1" source="a" parent="1" style="strokeColor=#123456;fontColor=#ffffff;fontSize=22;rounded=1;dashed=1"><mxGeometry relative="1" as="geometry"><mxPoint x="140" y="80" as="targetPoint"/></mxGeometry></mxCell>`);
  const document = await parseDrawioDocument(source);
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  assert.deepEqual(Object.keys(applied.topology.diagram.connectors[0]).sort(), ['dashed', 'id', 'kind', 'label', 'source', 'stroke', 'target', 'waypoints']);
  assert.doesNotMatch(applied.topology.diagram.connectors[0].label, /[<>]/);
  assert.doesNotThrow(() => parseProject(serializeProject(applied.topology, { scale: 1 })));
});
