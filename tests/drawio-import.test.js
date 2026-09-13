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
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.key_management_service' }).suggestedDeviceKind, 'server');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.illustration_users' }).classification, 'device-candidate');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=rectangle', text: 'Firewall' }).classification, 'annotation');
  assert.equal(classifyDrawioElement({ type: 'container', rawStyle: '' }).classification, 'zone');
});

test('managed gateways route, managed buckets store, managed services serve', () => {
  const kindOf = (token) => classifyDrawioElement({ type: 'shape', rawStyle: `shape=${token}` }).suggestedDeviceKind;
  for (const token of ['mxgraph.aws4.nat_gateway', 'mxgraph.aws3.internet_gateway', 'mxgraph.aws4.vpn_gateway', 'mxgraph.aws3.vpn_connection', 'mxgraph.aws3.direct_connect']) {
    assert.equal(kindOf(token), 'router', token);
  }
  for (const token of ['mxgraph.aws3.s3', 'mxgraph.aws4.s3']) assert.equal(kindOf(token), 'storage', token);
  for (const token of ['mxgraph.aws3.route_53', 'mxgraph.aws3.cloudfront', 'mxgraph.aws3.athena', 'mxgraph.aws3.kms', 'mxgraph.aws3.codedeploy', 'mxgraph.aws3.ecr_registry', 'mxgraph.aws3.redis']) {
    assert.equal(kindOf(token), 'server', token);
  }
  // 이름을 붙였다고 한계까지 아는 것은 아니다. 종류만 정해지고 용량은 미확인으로 남아야 한다.
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws3.cloudfront' }).classification, 'device');
});

test('a short abbreviation does not claim the name it is buried in', () => {
  // vpc_nat_gateway 는 통과 경로지 서버가 아니다. 'pc' 가 'vpc' 안에서 터지면 서버가 된다.
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws3.vpc_nat_gateway' }).suggestedDeviceKind, 'router');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws3.vpc_peering' }).suggestedDeviceKind, null);
  // aws3 네임스페이스 자체가 s3 로 끝나므로 저장소 판정이 번지면 안 된다.
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws3.ec2' }).suggestedDeviceKind, 'server');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.aws3.auto_scaling' }).suggestedDeviceKind, null);
});

test('one service keeps one kind whichever stencil set spells it', () => {
  const kindOf = (token) => classifyDrawioElement({ type: 'shape', rawStyle: `shape=${token}` }).suggestedDeviceKind;
  // aws3 와 aws4 는 같은 서비스를 다르게 적는다. 네임스페이스가 종류를 바꾸면 안 된다.
  for (const [older, newer] of [['kms', 'key_management_service'], ['s3', 'bucket'], ['lambda_function', 'lambda'], ['ecs_service', 'ecs']]) {
    assert.equal(kindOf(`mxgraph.aws3.${older}`), kindOf(`mxgraph.aws4.${newer}`), `${older} / ${newer}`);
  }
  // 게이트웨이는 밑줄을 넣기도 빼기도 한다.
  assert.equal(kindOf('mxgraph.aws3d.vpcgateway'), 'router');
  assert.equal(kindOf('mxgraph.aws3d.customergateway'), 'router');
});

test('a network ACL filters packets at the subnet edge, so it counts as a firewall', () => {
  const kindOf = (token) => classifyDrawioElement({ type: 'shape', rawStyle: `shape=${token}` }).suggestedDeviceKind;
  // draw.io 는 "controllist" 로 붙여 적고, aws4 는 끊어 적는다.
  for (const token of ['mxgraph.aws3.network_access_controllist', 'mxgraph.aws4.network_access_control_list', 'mxgraph.aws4.nacl']) {
    assert.equal(kindOf(token), 'firewall', token);
  }
  // 이름에 access control 이 들어간다고 다 패킷을 거르지는 않는다. Azure 쪽은 인증 서비스다.
  assert.equal(kindOf('mxgraph.azure.access_control'), null);
});

test('a drawing of people or a policy is not a device', () => {
  // 통과 대역이 없는 것은 장비가 아니다. 사람·건물 그림, 정책 표시, 주소, 영역.
  for (const token of ['mxgraph.aws4.illustration_users', 'mxgraph.aws4.illustration_office_building', 'mxgraph.aws3.role',
    'mxgraph.aws4.peering', 'mxgraph.aws3.vpc_peering', 'mxgraph.aws4.auto_scaling',
    'mxgraph.aws4.elastic_ip_address', 'mxgraph.aws3.corporate_data_center']) {
    assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: `shape=${token}` }).suggestedDeviceKind, null, token);
  }
});

test('mscae stencils are the Microsoft namespace, not unclassified noise', () => {
  const admin = classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.mscae.system_center.admin_console' });
  assert.equal(admin.ruleId, 'azure');
  assert.equal(admin.suggestedDeviceKind, 'server');
  assert.equal(classifyDrawioElement({ type: 'shape', rawStyle: 'shape=mxgraph.mscae.cloud.unknown_widget' }).classification, 'device-candidate');
});

test('network stencil tokens keep drawio underscore names in the exact registry', async () => {
  const document = await parseDrawioDocument(graph(`<mxCell id="vm" style="shape=mxgraph.networks.virtual_server" vertex="1" parent="1"><mxGeometry x="10" y="20" width="80" height="60" as="geometry"/></mxCell><mxCell id="lb" style="shape=mxgraph.networks.load_balancer" vertex="1" parent="1"><mxGeometry x="120" y="20" width="80" height="60" as="geometry"/></mxCell>`));
  assert.deepEqual(document.pages[0].elements.map(({ drawioShape }) => drawioShape), ['network:vm', 'network:lb']);
  assert.equal(document.pages[0].warnings.some(({ code }) => code === 'unsupported-vendor-stencil'), false);
});

test('reference XML stencils use the generated upstream registry and stay exact', async () => {
  const tokens = Object.keys(DRAWIO_STENCILS);
  assert.equal(tokens.length, 86);
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

test('a kubernetes icon draws its tile and the glyph prIcon names', async () => {
  const cell = (id, prIcon, x) => `<mxCell id="${id}" value="${prIcon}" style="shape=mxgraph.kubernetes.icon;prIcon=${prIcon};fillColor=#2875E2;strokeColor=#ffffff" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="50" height="48" as="geometry"/></mxCell>`;
  const document = await parseDrawioDocument(graph(`${cell('a', 'pod', 0)}${cell('b', 'node', 80)}${cell('c', 'etcd', 160)}`));
  const shapes = document.pages[0].elements;
  assert.deepEqual(shapes.map(({ drawioShape }) => drawioShape), Array(3).fill('port:mxgraph.kubernetes.icon'));
  assert.deepEqual(shapes.map(({ drawioOptions }) => drawioOptions.prIcon), ['pod', 'node', 'etcd']);
  const svg = renderDrawioPageSvg(document.pages[0]);
  const count = (token) => (svg.match(new RegExp(`data-drawio-stencil="${token.replaceAll('.', '\\.')}"`, 'g')) || []).length;
  // mxKubernetes.js draws the frame twice per icon: the border, then the body.
  assert.equal(count('mxgraph.kubernetes.frame'), 6);
  assert.equal(count('mxgraph.kubernetes.pod'), 1);
  assert.equal(count('mxgraph.kubernetes.node'), 1);
  // Only the observed glyphs are vendored, so an unlisted prIcon keeps the tile
  // and draws no glyph rather than substituting a similar one.
  assert.equal(count('mxgraph.kubernetes.etcd'), 0);
  assert.doesNotMatch(svg, /<script|foreignObject/i);
});

test('a curved edge bends through every waypoint instead of past them', async () => {
  const source = graph(`<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="40" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry x="300" y="200" width="60" height="40" as="geometry"/></mxCell><mxCell id="e" style="curved=1;endArrow=none" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="120" y="40"/><mxPoint x="200" y="180"/></Array></mxGeometry></mxCell>`);
  const svg = renderDrawioPageSvg((await parseDrawioDocument(source)).pages[0]);
  // mxPolyline.paintCurvedLine: each waypoint is a control point and the curve
  // passes through the midpoint between it and the next one.
  assert.equal(svg.match(/class="drawio-edge-line" d="([^"]*)"/)[1], 'M 60 26.67 Q 120 40 160 110 Q 200 180 300 210.77');
});

test('a stencil name written without its underscores still finds the stencil', async () => {
  const document = await parseDrawioDocument(graph('<mxCell id="x" style="shape=mxgraph.aws4.applicationloadbalancer" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="40" as="geometry"/></mxCell>'));
  assert.equal(document.pages[0].elements[0].drawioShape, 'stencil:mxgraph.aws4.application_load_balancer');
  assert.deepEqual(document.warnings, [], 'a name draw.io accepts is not an unsupported stencil');
});

test('draw.io built-in shapes draw their own outline instead of a plain box', async () => {
  const cell = (id, style, extra = '') => `<mxCell id="${id}" style="${style}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="60" as="geometry"/></mxCell>${extra}`;
  const document = await parseDrawioDocument(graph(`${cell('actor', 'shape=umlActor')}${cell('memo', 'shape=note;size=14')}${cell('grid', 'shape=table;childLayout=tableLayout')}`));
  const [actor, memo, grid] = document.pages[0].elements;
  assert.deepEqual([actor.drawioShape, memo.drawioShape, grid.drawioShape], ['port:umlActor', 'port:note', 'container']);
  assert.equal(memo.drawioOptions.size, 14, 'the corner fold comes from the style, not from the shape default');
  const svg = renderDrawioPageSvg(document.pages[0]);
  // UmlActorShape.paintBackground: a head ellipse at (w/4, 0, w/2, h/4), then
  // the body, arms and legs.
  assert.match(svg, /<ellipse cx="30" cy="7.5" rx="15" ry="7.5"/);
  assert.match(svg, /d="M 30 15 L 30 40 M 30 20 L 0 20 M 30 20 L 60 20 M 30 40 L 0 60 M 30 40 L 60 60"/);
  // NoteShape.paintVertexShape: the fold is cut from the top right corner.
  assert.match(svg, /d="M 0 0 L 46 0 L 60 14 L 60 60 L 0 60 Z"/);
  assert.doesNotMatch(svg, /<script|foreignObject/i);
});

test('a note keeps its corner fold across a project round trip', async () => {
  const document = await parseDrawioDocument(graph('<mxCell id="memo" style="shape=note;size=14" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="60" as="geometry"/></mxCell>'));
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  const restored = parseProject(serializeProject(applied.topology, { scale: 1 }));
  assert.equal(restored.topology.diagram.shapes[0].drawioOptions.size, 14);
});

test('an iphone mockup draws its body, screen and chrome', async () => {
  const document = await parseDrawioDocument(graph('<mxCell id="phone" style="shape=mxgraph.ios.iPhone" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="60" as="geometry"/></mxCell>'));
  assert.equal(document.pages[0].elements[0].drawioShape, 'port:mxgraph.ios.iPhone');
  assert.deepEqual(document.warnings, []);
  const svg = renderDrawioPageSvg(document.pages[0]);
  // mxMockupiOS.js: a black body with a 4px radius under 100px wide, the screen
  // inset to (6.25%, 15%) at 87.5% by 70%, and the home button at (40%, 87.5%).
  assert.match(svg, /<rect x="0" y="0" width="40" height="60" rx="4" ry="4" fill="#000000"/);
  assert.match(svg, /<rect x="2.5" y="9" width="35" height="42" fill="#1f2923"/);
  assert.match(svg, /<ellipse cx="20" cy="55.5" rx="4" ry="3"/);
  assert.equal((svg.match(/<linearGradient /g) || []).length, 2, 'the bezel and the home button each carry their own ramp');
  assert.doesNotMatch(svg, /<script|foreignObject/i);
});

test('a shape that cannot be drawn names itself in the warning', async () => {
  const document = await parseDrawioDocument(graph('<mxCell id="ghost" style="shape=mxgraph.aws3.server" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="60" as="geometry"/></mxCell><mxCell id="known" style="shape=mxgraph.networks.switch" vertex="1" parent="1"><mxGeometry x="80" y="0" width="40" height="60" as="geometry"/></mxCell>'));
  const missing = document.warnings.filter(({ code }) => code === 'unsupported-vendor-stencil');
  // A count alone cannot be acted on: the reader needs the name to look up.
  assert.deepEqual(missing.map(({ token }) => token), ['mxgraph.aws3.server']);
  assert.equal(missing[0].elementId, 'drawio-ghost');
  // The box it falls back to is the same box draw.io draws for a name it cannot
  // resolve either, so the drawing does not change - only the report does.
  assert.equal(document.pages[0].elements[0].drawioShape, 'vendor-fallback');
  assert.match(renderDrawioPageSvg(document.pages[0]), /<rect x="0" y="0" width="40" height="60" rx="0" fill="#ffffff" stroke="#000000"/);
});

test('a stencil carried inside the style is decoded and drawn', async () => {
  // draw.io URI encodes the stencil XML, deflate-raw compresses it and wraps the
  // result in base64. This payload is <shape w="40" h="50"> with one path.
  const payload = 'fVJRFoIgEDwNv70CvUBmn92BdE1eCD5ApduHLRbaqz9mZpnZXSCssC3vgdA9tz1UjrAToXTkRvCrDDQNSotkvkeoeAfIHLVHyjqj7zCJ2sVaoVowwqE6IZe97rOSsKLSSoUwoZV9E8GDC+VWARc06INXBw4MsrEPH9EuR/xI1TP6hsNXVqMN3IweVI2453PX86nTIyTGv22lUElh9qeyGgx6Hja1EdPYvKcRLzpdL92zdVNsJS9hUltIZ/+M1ggp8ZVSfbuKQOF3YOUT';
  const document = await parseDrawioDocument(graph(`<mxCell id="s" style="shape=stencil(${payload});fillColor=#ff0000;strokeColor=#000000" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="100" as="geometry"/></mxCell>`));
  const shape = document.pages[0].elements[0];
  assert.equal(shape.drawioShape, 'stencil-inline');
  assert.deepEqual(document.warnings, [], 'a stencil the file carries is not an unsupported stencil');
  // The box comes from the stencil, not from the cell, so the cell only scales it.
  assert.deepEqual([shape.drawioStencil.width, shape.drawioStencil.height], [40, 50]);
  assert.equal(shape.drawioStencil.path, 'M 0 0 L 40 0 C 40 25 20 50 0 50 Z');
  const svg = renderDrawioPageSvg(document.pages[0]);
  assert.match(svg, /scale\(2 2\)/, '80 by 100 over a 40 by 50 stencil is a factor of two');
  assert.match(svg, /d="M 0 0 L 40 0 C 40 25 20 50 0 50 Z" fill="#ff0000" stroke="#000000"/);
  assert.doesNotMatch(svg, /<script|foreignObject/i);
});

test('an inline stencil survives a project round trip', async () => {
  const payload = 'fVJRFoIgEDwNv70CvUBmn92BdE1eCD5ApduHLRbaqz9mZpnZXSCssC3vgdA9tz1UjrAToXTkRvCrDDQNSotkvkeoeAfIHLVHyjqj7zCJ2sVaoVowwqE6IZe97rOSsKLSSoUwoZV9E8GDC+VWARc06INXBw4MsrEPH9EuR/xI1TP6hsNXVqMN3IweVI2453PX86nTIyTGv22lUElh9qeyGgx6Hja1EdPYvKcRLzpdL92zdVNsJS9hUltIZ/+M1ggp8ZVSfbuKQOF3YOUT';
  const document = await parseDrawioDocument(graph(`<mxCell id="s" style="shape=stencil(${payload})" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="100" as="geometry"/></mxCell>`));
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(document));
  const restored = parseProject(serializeProject(applied.topology, { scale: 1 }));
  assert.equal(restored.topology.diagram.shapes[0].drawioStencil.path, 'M 0 0 L 40 0 C 40 25 20 50 0 50 Z');
});

test('a stencil payload that is not the drawn dialect falls back to the box', async () => {
  for (const style of ['shape=stencil(not-base64!)', 'shape=stencil(QUJD)']) {
    const document = await parseDrawioDocument(graph(`<mxCell id="s" style="${style}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="40" as="geometry"/></mxCell>`));
    assert.notEqual(document.pages[0].elements[0].drawioShape, 'stencil-inline');
  }
});

test('a fixed connection point keeps the offset its style names', async () => {
  // exitDx/exitDy and entryDx/entryDy move the point off the fraction, and a
  // non-orthogonal edge has to honour them the same way an orthogonal one does.
  const body = (style) => `<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="50" height="50" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry x="200" y="200" width="50" height="50" as="geometry"/></mxCell><mxCell id="e" style="${style}" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  const draw = async (style) => renderDrawioPageSvg((await parseDrawioDocument(graph(body(style)))).pages[0]).match(/class="drawio-edge-line" d="([^"]*)"/)[1];
  const plain = await draw('endArrow=none;exitX=1;exitY=0;entryX=0;entryY=1');
  const offset = await draw('endArrow=none;exitX=1;exitY=0;exitDx=6;exitDy=44;entryX=0;entryY=1;entryDx=44;entryDy=6');
  assert.equal(plain, 'M 50 0 L 200 250');
  assert.equal(offset, 'M 56 44 L 244 256');
});

test('a stored terminal point does not tilt a run between two shapes', async () => {
  // The file keeps the points from before the shapes moved. Aiming at them
  // sloped a run that draw.io draws flat.
  const source = graph('<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="90" y="687" width="50" height="60" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry x="250" y="691" width="49" height="52" as="geometry"/></mxCell><mxCell id="e" style="endArrow=none;exitX=1;exitY=0.5" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="125" y="692" as="sourcePoint"/><mxPoint x="125" y="632" as="targetPoint"/></mxGeometry></mxCell>');
  const path = renderDrawioPageSvg((await parseDrawioDocument(source)).pages[0]).match(/class="drawio-edge-line" d="([^"]*)"/)[1];
  assert.equal(path, 'M 140 717 L 250 717');
});

test('a label reads the way draw.io writes it, entities and all', async () => {
  const document = await parseDrawioDocument(graph('<mxCell id="t" value="Web-admin&amp;nbsp;name" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>'));
  // Left undecoded the six letters of the entity print inside the label.
  assert.equal(document.pages[0].elements[0].text, 'Web-admin\u00a0name');
});

test('a label placed above its shape is drawn above it', async () => {
  const draw = async (style) => {
    const source = graph(`<mxCell id="s" value="Public subnet" style="${style}" vertex="1" parent="1"><mxGeometry x="100" y="200" width="120" height="100" as="geometry"/></mxCell>`);
    return Number(renderDrawioPageSvg((await parseDrawioDocument(source)).pages[0]).match(/<text x="[^"]*" y="([^"]*)"/)[1]);
  };
  const above = await draw('shape=rect;verticalLabelPosition=top;verticalAlign=bottom');
  const below = await draw('shape=rect;verticalLabelPosition=bottom;verticalAlign=top');
  assert.ok(above < 200, `a top label sits above the shape, got ${above}`);
  assert.ok(below > 300, `a bottom label sits below the shape, got ${below}`);
});

test('an edge label rides its edge instead of collapsing to the origin', async () => {
  const source = graph('<mxCell id="a" style="shape=rect" vertex="1" parent="1"><mxGeometry x="0" y="0" width="40" height="40" as="geometry"/></mxCell><mxCell id="b" style="shape=rect" vertex="1" parent="1"><mxGeometry x="400" y="200" width="40" height="40" as="geometry"/></mxCell><mxCell id="e" style="endArrow=none" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="lbl" value="SYNC" style="text;html=1" vertex="1" connectable="0" parent="e"><mxGeometry x="8.33" y="-150" relative="1" as="geometry"/></mxCell>');
  const label = (await parseDrawioDocument(source)).pages[0].elements.find((item) => item.text === 'SYNC');
  // The shape centres are (20, 20) and (420, 220), so the label centres on (220, 120).
  assert.equal(label.geometry.x + label.geometry.width / 2, 220);
  assert.equal(label.geometry.y + label.geometry.height / 2, 120);
});

test('an edge with no cell at either end anchors on its own stored points', async () => {
  const source = graph('<mxCell id="e" style="endArrow=classic" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="115" y="664" as="sourcePoint"/><mxPoint x="115" y="604" as="targetPoint"/></mxGeometry></mxCell>');
  const applied = applyDrawioImport({ devices: [], links: [], demands: [] }, createDrawioPreview(await parseDrawioDocument(source)));
  const anchors = applied.topology.diagram.shapes.filter((shape) => shape.width === 1 && shape.height === 1);
  // Reading the waypoint list instead put both ends at the origin, and the
  // canvas then stretched from there to the diagram.
  assert.deepEqual(anchors.map(({ x, y }) => [x, y]), [[115, 664], [115, 604]]);
  assert.equal(anchors.some(({ x, y }) => x === 0 && y === 0), false);
});
