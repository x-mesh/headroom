import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { applyDrawioImport, classifyDrawioElement, createDrawioPreview, parseDrawioDocument, plainDrawioText, renderDrawioPageSvg } from '../public/drawio-import.js';
import { DRAWIO_STENCILS } from '../public/icons.js';
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

test('drawio reader assigns stable IDs to unreferenced vertices without source IDs', async () => {
  const source = graph('<mxCell value="label" vertex="1" parent="1"><mxGeometry x="4" y="8" width="40" height="20" as="geometry"/></mxCell>');
  const first = await parseDrawioDocument(source);
  const second = await parseDrawioDocument(source);
  assert.equal(first.pages[0].elements.length, 1);
  assert.equal(first.pages[0].warnings[0].code, 'missing-cell-id');
  assert.equal(first.pages[0].elements[0].sourceId, second.pages[0].elements[0].sourceId);
  assert.equal(first.pages[0].elements[0].id, second.pages[0].elements[0].id);
});

test('drawio reader preserves bare leading shape tokens', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+7t+5WAAAAABJRU5ErkJggg==';
  const source = graph(`<mxCell id="text" value="note" style="text;html=1;align=center" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="20" as="geometry"/></mxCell><mxCell id="group" style="group;container=1" vertex="1" parent="1"><mxGeometry x="50" y="0" width="40" height="20" as="geometry"/></mxCell><mxCell id="image" style="image;image=data:image/png,${png}" vertex="1" parent="1"><mxGeometry x="100" y="0" width="40" height="20" as="geometry"/></mxCell>`);
  const document = await parseDrawioDocument(source);
  assert.deepEqual(document.pages[0].elements.map(({ drawioShape }) => drawioShape), ['text', 'container', 'image']);
  assert.equal(document.pages[0].elements.at(-1).imageAssetId != null, true);
  assert.equal(document.warnings.some(({ code }) => code === 'unsupported-style'), false);
});

test('long safe label runs split without losing project round-trip safety', async () => {
  const label = `&lt;span style="font-family:Helvetica"&gt;${'safe text '.repeat(70)}&lt;/span&gt;`;
  const document = await parseDrawioDocument(graph(`<mxCell id="long-label" value="${label}" style="text;html=1" vertex="1" parent="1"><mxGeometry x="10" y="20" width="300" height="80" as="geometry"/></mxCell>`));
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  const runs = applied.topology.diagram.shapes[0].labelRuns.flat();
  assert.equal(runs.every(({ text }) => text.length <= 240 && !/[<>]/.test(text)), true);
  assert.doesNotThrow(() => parseProject(serializeProject(applied.topology, { scale: 1 })));
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

test('network stencil tokens keep drawio underscore names in the exact registry', async () => {
  const document = await parseDrawioDocument(graph(`<mxCell id="vm" style="shape=mxgraph.networks.virtual_server" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="60" as="geometry"/></mxCell><mxCell id="lb" style="shape=mxgraph.networks.load_balancer" vertex="1" parent="1"><mxGeometry x="120" y="20" width="80" height="60" as="geometry"/></mxCell>`));
  assert.deepEqual(document.pages[0].elements.map(({ drawioShape }) => drawioShape), ['network:vm', 'network:lb']);
  assert.equal(document.pages[0].warnings.some(({ code }) => code === 'unsupported-vendor-stencil'), false);
});

test('reference XML stencils use the generated upstream registry and stay exact', async () => {
  const tokens = Object.keys(DRAWIO_STENCILS);
  assert.equal(tokens.length, 67);
  for (const token of tokens) assert.match(DRAWIO_STENCILS[token].body, /<(?:path|rect|ellipse)\b/);
  const cells = tokens.map((token, index) => `<mxCell id="s${index}" style="shape=${token}" vertex="1" parent="1"><mxGeometry x="${index * 20}" y="0" width="16" height="16" as="geometry"/></mxCell>`).join('');
  const document = await parseDrawioDocument(graph(cells));
  assert.deepEqual(document.pages[0].elements.map(({ drawioShape }) => drawioShape), tokens.map((token) => `stencil:${token}`));
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  assert.deepEqual(Object.values(applied.topology.diagram.drawioImport.outcomes), tokens.map(() => 'rendered-exact'));
});

test('upstream custom ports are counted as exact and preserve safe AWS resource options', async () => {
  const tokens = [
    'mxgraph.cisco19.lock', 'mxgraph.aws4.network_firewall_endpoints', 'mxgraph.arrows2.stripedarrow',
    'mxgraph.cisco_safe.capability.web_application_firewall', 'mxgraph.cisco19.rect', 'l3_switch', 'l2_switch', 'ips_ids',
  ];
  const cells = tokens.map((token, index) => `<mxCell id="n${index}" style="shape=${token}" vertex="1" parent="1"><mxGeometry x="${index * 20}" y="0" width="16" height="16" as="geometry"/></mxCell>`).join('');
  const resource = `<mxCell id="resource" style="shape=mxgraph.aws4.resourceicon;resIcon=mxgraph.aws4.network_firewall;prIcon=mxgraph.aws4.network_firewall" vertex="1" parent="1"><mxGeometry x="0" y="30" width="16" height="16" as="geometry"/></mxCell>`;
  const document = await parseDrawioDocument(graph(`${cells}${resource}`));
  assert.equal(document.pages[0].elements.some(({ drawioShape }) => /fallback/.test(drawioShape)), false);
  const imported = document.pages[0].elements.at(-1);
  assert.deepEqual(imported.drawioOptions, { resIcon: 'mxgraph.aws4.network_firewall', prIcon: 'mxgraph.aws4.network_firewall' });
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  const outcomes = Object.values(applied.topology.diagram.drawioImport.outcomes);
  assert.equal(outcomes.filter((value) => value === 'rendered-composer').length, 0);
  assert.equal(outcomes.filter((value) => value === 'rendered-exact').length, 9);
  assert.doesNotThrow(() => parseProject(serializeProject(applied.topology, { scale: 1 })));
});

test('AWS group icons prefer their exact pinned group stencil over legacy aliases', async () => {
  const source = graph('<mxCell id="group" style="shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_subnet;container=1" vertex="1" parent="1"><mxGeometry x="10" y="20" width="240" height="160" as="geometry"/></mxCell>');
  const document = await parseDrawioDocument(source);
  const svg = renderDrawioPageSvg(document.pages[0], document.assets);
  assert.match(svg, /data-drawio-stencil="mxgraph\.aws4\.group_subnet"/);
  assert.doesNotMatch(svg, /data-drawio-stencil="mxgraph\.aws4\.subnet"/);
});

test('AWS container_1 keeps its server-container stencil instead of a plain rectangle', async () => {
  const source = graph('<mxCell id="container" style="shape=mxgraph.aws4.container_1;fillColor=#ED7100;strokeColor=none;aspect=fixed" vertex="1" parent="1"><mxGeometry x="10" y="20" width="46.45" height="30" as="geometry"/></mxCell>');
  const document = await parseDrawioDocument(source);
  const [element] = document.pages[0].elements;
  assert.equal(element.drawioShape, 'port:mxgraph.aws4.container_1');
  const svg = renderDrawioPageSvg(document.pages[0], document.assets);
  assert.match(svg, /M 15.54 45.22 L 17.65 45.22/);
  assert.doesNotMatch(svg, /<rect x="10" y="20" width="46.45" height="30"/);
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

test('semantic devices retain the source visual, embedded image, and source z-order', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+7t+5WAAAAABJRU5ErkJggg==';
  const source = graph(`<mxCell id="before" style="shape=ellipse;fillColor=#abcdef" vertex="1" parent="1"><mxGeometry x="0" y="0" width="20" height="20" as="geometry"/></mxCell><mxCell id="vm" style="shape=mxgraph.networks.virtual_server;image=data:image/png,${png}" vertex="1" parent="1"><mxGeometry x="30" y="10" width="80" height="60" as="geometry"/></mxCell><mxCell id="edge" style="strokeColor=#123456" edge="1" source="before" target="vm" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  const document = await parseDrawioDocument(source);
  const preview = createDrawioPreview(document);
  const decisions = { 'drawio-vm': { type: 'device', kind: 'server' } };
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, preview, decisions);
  const device = applied.topology.devices[0];
  assert.equal(applied.topology.diagram.shapes.length, 1);
  assert.equal(device.drawioVisual.drawioShape, 'network:vm');
  assert.equal(device.drawioVisual.width, 80); assert.equal(device.drawioVisual.height, 60);
  assert.ok(device.drawioVisual.imageAssetId); assert.equal(device.drawioVisual.zIndex, 1);
  assert.equal(applied.topology.diagram.connectors[0].zIndex, 2);
  const restored = parseProject(serializeProject(applied.topology, { scale: 1 })).topology;
  assert.equal(restored.devices[0].drawioVisual.imageAssetId, device.drawioVisual.imageAssetId);
  const svg = (await import('../public/diagram.js')).exportDiagramSvg(restored, null, { detailLevel: 'off' });
  assert.ok(svg.indexOf('#abcdef') < svg.indexOf('data:image/png'));
  assert.ok(svg.indexOf('data:image/png') < svg.indexOf('#123456'));
});

test('drawio visual rejects missing embedded image assets', () => {
  const topology = { devices: [{ id: 'vm', name: 'vm', kind: 'server', zone: 'UNASSIGNED', position: { x: 0, y: 0 }, drawioVisual: { width: 80, height: 60, drawioShape: 'network:vm', imageAssetId: 'missing-asset' } }], links: [], demands: [], diagram: { shapes: [], connectors: [], groups: [], drawioAssets: [] } };
  assert.throws(() => parseProject(serializeProject(topology, { scale: 1 })), /unknown asset/);
});

test('drawio annotations keep only project-safe connector styles and labels', async () => {
  const source = graph(`${shape('a')}<mxCell id="free" value="&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;" edge="1" source="a" parent="1" style="strokeColor=#123456;fontColor=#ffffff;fontSize=22;rounded=1;dashed=1"><mxGeometry relative="1" as="geometry"><mxPoint x="140" y="80" as="targetPoint"/></mxGeometry></mxCell>`);
  const document = await parseDrawioDocument(source);
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  assert.deepEqual(Object.keys(applied.topology.diagram.connectors[0]).sort(), ['dashed', 'drawioGeometry', 'drawioOptions', 'id', 'kind', 'label', 'source', 'stroke', 'target', 'waypoints', 'zIndex']);
  assert.doesNotMatch(applied.topology.diagram.connectors[0].label, /[<>]/);
  assert.doesNotThrow(() => parseProject(serializeProject(applied.topology, { scale: 1 })));
});

test('visual preview draws safe shapes and connections without source markup or images', async () => {
  const source = graph(`${shape('a')}<mxCell id="b" value="Target &amp;lt;script&amp;gt;x&amp;lt;/script&amp;gt;" style="shape=image;image=https://example.invalid/a.png;fillColor=#ddeeff" vertex="1" parent="1"><mxGeometry x="210" y="80" width="100" height="60" as="geometry"/></mxCell><mxCell id="edge" edge="1" source="a" target="b" parent="1" style="strokeColor=#123456;dashed=1"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  const document = await parseDrawioDocument(source);
  const svg = renderDrawioPageSvg(document.pages[0]);
  assert.match(svg, /<svg[^>]+viewBox=/);
  assert.match(svg, /<path[^>]+stroke="#123456"/);
  assert.match(svg, /Target x/);
  assert.doesNotMatch(svg, /<script|<image|https:\/\/|javascript:/i);
});

test('drawio raster assets accept implicit base64 once and reject unsafe image inputs', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+7t+5WAAAAABJRU5ErkJggg==';
  const source = graph(`<mxCell id="a" style="shape=image;image=${png}" vertex="1" parent="1"><mxGeometry x="1" y="2" width="10" height="10" as="geometry"/></mxCell><mxCell id="b" style="shape=image;image=data:image/png;base64,${png}" vertex="1" parent="1"><mxGeometry x="20" y="2" width="10" height="10" as="geometry"/></mxCell><mxCell id="c" style="shape=image;image=https://example.invalid/a.png" vertex="1" parent="1"><mxGeometry x="40" y="2" width="10" height="10" as="geometry"/></mxCell>`);
  const document = await parseDrawioDocument(source);
  assert.equal(document.assets.length, 1);
  assert.equal(document.pages[0].elements.filter((item) => item.imageAssetId).length, 2);
  assert.ok(document.warnings.some((item) => item.code === 'inert-image-reference'));
  const preview = createDrawioPreview(document); const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, preview);
  const restored = parseProject(serializeProject(applied.topology, { scale: 1 }));
  assert.equal(restored.topology.diagram.drawioAssets.length, 1);
  assert.equal(renderDrawioPageSvg(document.pages[0], document.assets).match(/data:image\/png/g)?.length, 2);
});

test('blocked external images remain visible placeholders and are never reported exact', async () => {
  const document = await parseDrawioDocument(graph('<mxCell id="remote" style="shape=image;image=https://example.invalid/a.png" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="60" as="geometry"/></mxCell>'));
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  assert.equal(applied.topology.diagram.drawioImport.outcomes.remote, 'inert-placeholder');
  assert.equal(applied.applied.visual.placeholder, 1);
  assert.equal(applied.applied.visual.exact, 0);
});

test('drawio image style does not confuse base64 padding with the next style field', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+7t+5WAAAAABJRU5ErkJggg==';
  const source = graph(`<mxCell id="a" style="shape=image;image=data:image/png,${png};fillColor=#ffffff" vertex="1" parent="1"><mxGeometry x="1" y="2" width="10" height="10" as="geometry"/></mxCell>`);
  const document = await parseDrawioDocument(source);
  assert.equal(document.pages[0].elements[0].imageAssetId != null, true);
  assert.equal(document.warnings.some((item) => item.code === 'inert-image-reference'), false);
});

test('drawio geometry renderer carries shapes, transforms, arrows and safe export through apply', async () => {
  const source = graph(`<mxCell id="cube" value="Cube" style="shape=cube;rotation=90;flipH=1;fillColor=#ffffff;strokeColor=#123456" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="60" as="geometry"/></mxCell><mxCell id="hex" value="Hex" style="shape=hexagon" vertex="1" parent="1"><mxGeometry x="160" y="20" width="80" height="60" as="geometry"/></mxCell><mxCell id="edge" edge="1" source="cube" target="hex" parent="1" style="dashed=1;startArrow=classic;endArrow=block"><mxGeometry relative="1" as="geometry"><mxPoint x="130" y="120" as="point"/></mxGeometry></mxCell>`);
  const document = await parseDrawioDocument(source); const preview = createDrawioPreview(document);
  const markup = renderDrawioPageSvg(preview.page, preview.assets);
  assert.match(markup, /rotate\(90/); assert.match(markup, /marker-end/);
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, preview);
  const svg = (await import('../public/diagram.js')).exportDiagramSvg(applied.topology, null, { detailLevel: 'off' });
  assert.match(svg, /rotate\(90/); assert.match(svg, /marker-end/);
  assert.doesNotMatch(svg, /<script|foreignObject|href="(?:https?:|javascript:)/i);
});

test('edge geometry keeps typed points, one path, arrow variants, and visual text styles', async () => {
  const source = graph(`<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry x="220" y="80" width="80" height="40" as="geometry"/></mxCell><mxCell id="edge" value="edge label" style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=.5;entryX=0;entryY=.5;startArrow=oval;startFill=0;startSize=7;endArrow=blockThin;endFill=1;endSize=6;dashed=1;dashPattern=2 3;fontFamily=Helvetica;textDirection=vertical;labelBackgroundColor=#ffffff" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="15" y="22" as="sourcePoint"/><mxPoint x="270" y="100" as="targetPoint"/><mxPoint x="4" y="6" as="offset"/><Array as="points"><mxPoint x="130" y="20"/><mxPoint x="130" y="100"/></Array></mxGeometry></mxCell>`);
  const document = await parseDrawioDocument(source); const edge = document.pages[0].elements.find((item) => item.type === 'edge');
  assert.deepEqual(edge.geometry.sourcePoint, { x: 15, y: 22 });
  assert.deepEqual(edge.geometry.targetPoint, { x: 270, y: 100 });
  assert.deepEqual(edge.geometry.offset, { x: 4, y: 6 });
  assert.deepEqual(edge.geometry.waypoints, [{ x: 130, y: 20 }, { x: 130, y: 100 }]);
  const svg = renderDrawioPageSvg(document.pages[0]);
  assert.equal((svg.match(/class="drawio-edge-line"/g) || []).length, 1);
  assert.match(svg, /stroke-dasharray="2 3"/); assert.match(svg, /marker-start=/); assert.match(svg, /marker-end=/);
  assert.match(svg, /font-family="Helvetica"/); assert.match(svg, /rotate\(-90/); assert.match(svg, /fill="#ffffff"/);
});

test('orthogonal edges retain draw.io black and the path its router produces', async () => {
  const source = graph('<mxCell id="source" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell><mxCell id="target" style="shape=rect" vertex="1" parent="1"><mxGeometry x="200" y="60" width="80" height="40" as="geometry"/></mxCell><mxCell id="edge" style="edgeStyle=orthogonalEdgeStyle" edge="1" source="source" target="target" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>');
  const document = await parseDrawioDocument(source);
  const svg = renderDrawioPageSvg(document.pages[0]);
  assert.match(svg, /stroke="#000000"/);
  assert.match(svg, /class="drawio-edge-line"[^>]*stroke-width="1"[^>]*stroke-miterlimit="10"/);
  assert.match(svg, /d="M 80 20 L 240 20 L 240 53.63"/);
});

test('orthogonal waypoints route through right angles instead of a diagonal', async () => {
  const body = (style, points) => `<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="60" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry x="400" y="300" width="100" height="60" as="geometry"/></mxCell><mxCell id="edge" style="${style}" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"><Array as="points">${points}</Array></mxGeometry></mxCell>`;
  const draw = async (style, points) => renderDrawioPageSvg((await parseDrawioDocument(graph(body(style, points)))).pages[0]).match(/class="drawio-edge-line" d="([^"]*)"/)[1];
  // A waypoint sharing no axis with its neighbour used to draw two diagonals.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle', '<mxPoint x="250" y="150"/>'), 'M 50 60 L 50 150 L 250 150 L 250 330 L 393.63 330');
  // The first leg leaves along the exit face and the last arrives along the entry face.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle;exitX=.5;exitY=1;entryX=.5;entryY=0', '<mxPoint x="250" y="150"/>'), 'M 50 60 L 50 150 L 250 150 L 250 300 L 443.63 300');
  // Waypoints draw.io already squared off keep their turns.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle', '<mxPoint x="130" y="30"/><mxPoint x="130" y="330"/>'), 'M 100 30 L 130 30 L 130 330 L 393.63 330');
  // An edge without an orthogonal style still runs straight through its waypoint.
  assert.equal(await draw('', '<mxPoint x="250" y="150"/>'), 'M 100 60 L 250 150 L 411.93 295.74');
});

test('edges stop short of the arrow and meet the perimeter where the run arrives', async () => {
  const body = (style, points, target) => `<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="60" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry ${target} as="geometry"/></mxCell><mxCell id="edge" style="${style}" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"><Array as="points">${points}</Array></mxGeometry></mxCell>`;
  const draw = async (style, points, target = 'x="400" y="300" width="100" height="60"') => renderDrawioPageSvg((await parseDrawioDocument(graph(body(style, points, target)))).pages[0]).match(/class="drawio-edge-line" d="([^"]*)"/)[1];
  // A tall target the run meets at y=150 is entered there, not at its centre.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle', '<mxPoint x="250" y="150"/>', 'x="400" y="100" width="100" height="400"'), 'M 100 30 L 250 30 L 250 150 L 393.63 150');
  // A run that passes below the face falls back to the face centre, and the
  // pull-back follows the incoming leg, so it moves back down the way it came.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle', '<mxPoint x="250" y="900"/>', 'x="400" y="100" width="100" height="400"'), 'M 50 60 L 50 900 L 250 900 L 250 300 L 393.63 300');
  // mxGraph pulls the line back by (size + strokeWidth) * 3/4 + strokeWidth * 1.118.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle;endArrow=classic;endSize=6;strokeWidth=2', '<mxPoint x="130" y="30"/><mxPoint x="130" y="330"/>'), 'M 100 30 L 130 30 L 130 330 L 391.76 330');
  // A block arrow runs its full length, so the line stops further back.
  assert.equal(await draw('edgeStyle=orthogonalEdgeStyle;endArrow=block;endSize=6;strokeWidth=2', '<mxPoint x="130" y="30"/><mxPoint x="130" y="330"/>'), 'M 100 30 L 130 30 L 130 330 L 389.76 330');
});

test('every draw.io line jump style draws the detour draw.io draws', async () => {
  const box = (id, x, y, w, h) => `<mxCell id="${id}" style="shape=rect" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
  const draw = async (style) => {
    const source = graph(`${box('a', 0, 35, 40, 30)}${box('b', 160, 35, 40, 30)}${box('c', 95, 0, 10, 10)}${box('d', 95, 190, 10, 10)}<mxCell id="base" style="edgeStyle=orthogonalEdgeStyle" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="0" y="50" as="sourcePoint"/><mxPoint x="200" y="50" as="targetPoint"/></mxGeometry></mxCell><mxCell id="jump" style="jumpStyle=${style};jumpSize=8" edge="1" source="c" target="d" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="100" y="0" as="sourcePoint"/><mxPoint x="100" y="200" as="targetPoint"/></mxGeometry></mxCell>`);
    const svg = renderDrawioPageSvg((await parseDrawioDocument(source)).pages[0]);
    return [...svg.matchAll(/class="drawio-edge-line" d="([^"]*)"/g)].map((match) => match[1])[1];
  };
  // Graph.js puts the gap half a jump size either side of the crossing at y=50,
  // so every style turns at y=46 and returns at y=54.
  assert.equal(await draw('arc'), 'M 100 10 L 100 46 C 105.2 46 105.2 54 100 54 L 100 183.63');
  assert.equal(await draw('sharp'), 'M 100 10 L 100 46 L 104 46 L 104 54 L 100 54 L 100 183.63');
  assert.equal(await draw('line'), 'M 100 10 L 100 46 M 96 46 L 104 46 M 104 54 L 96 54 M 100 54 L 100 183.63');
  assert.equal(await draw('gap'), 'M 100 10 L 100 46 M 100 54 L 100 183.63');
  // An unknown style leaves the run whole.
  assert.equal(await draw('none'), 'M 100 10 L 100 183.63');
  // Both ends sit on a perimeter, not on the stale mxPoint the file stores: the
  // fixture's sourcePoint is y=0 while the shape's lower edge is y=10.
});

test('later jump edge crosses earlier orthogonal edge deterministically and round-trips exactly', async () => {
  const point = (x, y, name) => `<mxPoint x="${x}" y="${y}" as="${name}"/>`;
  const edge = (id, source, target, style, a, b) => `<mxCell id="${id}" style="${style}" edge="1" source="${source}" target="${target}" parent="1"><mxGeometry relative="1" as="geometry">${point(a[0], a[1], 'sourcePoint')}${point(b[0], b[1], 'targetPoint')}</mxGeometry></mxCell>`;
  const box = (id, x, y) => `<mxCell id="${id}" style="shape=rect" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="40" height="30" as="geometry"/></mxCell>`;
  const source = graph(`${box('a', 0, 35)}${box('b', 160, 35)}<mxCell id="c" style="shape=rect" vertex="1" parent="1"><mxGeometry x="95" y="0" width="10" height="10" as="geometry"/></mxCell><mxCell id="d" style="shape=rect" vertex="1" parent="1"><mxGeometry x="95" y="190" width="10" height="10" as="geometry"/></mxCell>${edge('base', 'a', 'b', 'edgeStyle=orthogonalEdgeStyle', [0, 50], [200, 50])}${edge('jump', 'c', 'd', 'jumpStyle=arc;jumpSize=8', [100, 0], [100, 200])}`);
  const document = await parseDrawioDocument(source); const preview = createDrawioPreview(document); const svg = renderDrawioPageSvg(preview.page);
  assert.match(svg, /class="drawio-edge-line" d="[^"]*C 105.2 46 105.2 54 100 54/);
  assert.equal((svg.match(/ C 105\.2 46 105\.2 54 100 54 /g) || []).length, 1);
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, preview);
  assert.equal(applied.topology.diagram.drawioImport.outcomes.jump, 'rendered-exact');
  assert.equal(applied.warnings.some((item) => item.code === 'partial-jump-arc'), false);
  const restored = parseProject(serializeProject(applied.topology, { scale: 1 }));
  const exported = (await import('../public/diagram.js')).exportDiagramSvg(restored.topology, null, { detailLevel: 'off' });
  assert.match(exported, /C 105\.2 46 105\.2 54 100 54/);
});

test('jump arc has no arc when no earlier edge crosses it and preserves target perimeter spacing', async () => {
  const document = await parseDrawioDocument(graph(`${shape('a')}${shape('b')}<mxCell id="edge" style="jumpStyle=arc;targetPerimeterSpacing=1" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`));
  const edge = document.pages[0].elements.find((item) => item.type === 'edge');
  assert.equal(edge.drawioOptions.targetPerimeterSpacing, 1);
  assert.doesNotMatch(renderDrawioPageSvg(document.pages[0]), / A /);
});
