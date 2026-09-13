import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { decideCandidates, nameImportedDevices, parseRate, snapConnectors, wireDrawio } from '../scripts/wire-drawio.mjs';

function drawio(body) {
  const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel>`;
  const encoded = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
  return `<mxfile><diagram id="one" name="Page-1">${encoded}</diagram></mxfile>`;
}
const box = (id, shape, x, y, value = '') => `<mxCell id="${id}" value="${value}" style="shape=${shape}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="50" height="50" as="geometry"/></mxCell>`;
// 양끝이 셀에 붙지 않은 선. draw.io 는 이런 선을 허용하고, 좌표만 남긴다.
const floating = (id, from, to) => `<mxCell id="${id}" style="endArrow=classic" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${from[0]}" y="${from[1]}" as="sourcePoint"/><mxPoint x="${to[0]}" y="${to[1]}" as="targetPoint"/></mxGeometry></mxCell>`;

test('a rate reads its unit, and refuses what it cannot read', () => {
  assert.equal(parseRate('10G', 'x'), 10e9);
  assert.equal(parseRate('1.5Gbps', 'x'), 1.5e9);
  assert.equal(parseRate('250M', 'x'), 250e6);
  assert.equal(parseRate('1000', 'x'), 1000);
  assert.throws(() => parseRate('열 기가', 'x'), /읽을 수 없습니다/);
});

test('the classifier decides what it knows and names what it does not', () => {
  const candidates = [
    { id: 'a', drawioShape: 'stencil:mxgraph.aws3.ec2', text: 'EC2', suggestion: { suggestedDeviceKind: 'server', classification: 'device' } },
    { id: 'b', drawioShape: 'cube', text: '', suggestion: { suggestedDeviceKind: null, classification: 'annotation' } },
    { id: 'c', drawioShape: 'image', text: 'Validators', suggestion: { suggestedDeviceKind: null, classification: 'annotation' } },
    { id: 'd', drawioShape: 'stencil:mxgraph.aws3.auto_scaling', text: '', suggestion: { suggestedDeviceKind: null, classification: 'device-candidate' } },
    { id: 'e', drawioShape: 'stencil:mxgraph.aws3.auto_scaling', text: '', suggestion: { suggestedDeviceKind: null, classification: 'device-candidate' } },
  ];
  const { decisions, report } = decideCandidates(candidates, [
    { what: 'cube', isText: false, kind: 'server' },
    { what: 'Validators', isText: true, kind: 'server' },
  ]);
  assert.deepEqual(decisions.a, { type: 'device', kind: 'server' });
  assert.deepEqual(decisions.b, { type: 'device', kind: 'server' });
  assert.deepEqual(decisions.c, { type: 'device', kind: 'server' });
  assert.equal(decisions.d, undefined);
  assert.equal(report.classifier, 1);
  assert.equal(report.byHand, 2);
  // 같은 도형이 두 번 나와도 사람이 읽을 줄은 한 번이면 된다.
  assert.deepEqual(report.undecided, [{ shape: 'stencil:mxgraph.aws3.auto_scaling', text: '' }]);
});

test('a floating line finds the device its end was drawn against', async () => {
  const source = drawio(`${box('left', 'mxgraph.aws3.ec2', 0, 0)}${box('right', 'mxgraph.aws3.ec2', 300, 0)}${floating('line', [60, 25], [290, 25])}`);
  const { topology, report } = await wireDrawio(source, { snap: 60 });
  assert.equal(topology.devices.length, 2);
  assert.equal(topology.links.length, 1);
  assert.equal(report.rows[0].state, 'snapped');
  assert.notEqual(report.rows[0].source, report.rows[0].target);
});

test('a line whose end lands nowhere stays an annotation', async () => {
  const source = drawio(`${box('left', 'mxgraph.aws3.ec2', 0, 0)}${box('right', 'mxgraph.aws3.ec2', 300, 0)}${floating('line', [60, 25], [160, 600])}`);
  const { topology, report } = await wireDrawio(source, { snap: 60 });
  assert.equal(topology.links.length, 0);
  assert.equal(topology.diagram.connectors.length, 1);
  assert.equal(report.rows[0].state, 'unresolved');
});

test('snapping off leaves every floating end where it was', async () => {
  const source = drawio(`${box('left', 'mxgraph.aws3.ec2', 0, 0)}${box('right', 'mxgraph.aws3.ec2', 300, 0)}${floating('line', [60, 25], [290, 25])}`);
  const { topology, report } = await wireDrawio(source, { snap: 0 });
  assert.equal(topology.links.length, 0);
  assert.equal(report.rows[0].how, '스냅 끔 / 스냅 끔');
});

test('a cell that is already glued wins over the point draw.io left behind', async () => {
  // sourcePoint 는 오른쪽 상자 위에 찍혀 있지만, source 는 왼쪽 상자에 붙어 있다.
  // mxGraph 는 이런 경우 셀을 쓰고 좌표를 버린다.
  const edge = `<mxCell id="line" style="endArrow=classic" edge="1" parent="1" source="left"><mxGeometry relative="1" as="geometry"><mxPoint x="310" y="25" as="sourcePoint"/><mxPoint x="290" y="25" as="targetPoint"/></mxGeometry></mxCell>`;
  const source = drawio(`${box('left', 'mxgraph.aws3.ec2', 0, 0, 'Left')}${box('right', 'mxgraph.aws3.ec2', 300, 0, 'Right')}${edge}`);
  const { topology, report } = await wireDrawio(source, { snap: 60 });
  assert.equal(report.rows[0].how, '셀 / 좌표 10px');
  const link = topology.links[0];
  const named = new Map(topology.devices.map((device) => [device.id, device.name]));
  assert.equal(named.get(link.source), 'Left');
  assert.equal(named.get(link.target), 'Right');
});

test('a big container hands the line to a device inside it, not to whatever is closest', async () => {
  const container = `<mxCell id="zone" value="Subnet" style="rounded=0;container=1" vertex="1" parent="1"><mxGeometry x="0" y="0" width="400" height="400" as="geometry"/></mxCell>`;
  const inside = `<mxCell id="inner" style="shape=mxgraph.aws3.ec2" vertex="1" parent="zone"><mxGeometry x="175" y="175" width="50" height="50" as="geometry"/></mxCell>`;
  const outside = box('far', 'mxgraph.aws3.ec2', 900, 0);
  const edge = `<mxCell id="line" style="endArrow=classic" edge="1" parent="1" source="zone" target="far"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  const { topology, report } = await wireDrawio(drawio(`${container}${inside}${outside}${edge}`), { snap: 60 });
  assert.match(report.rows[0].how, /^컨테이너 "Subnet" 대표/);
  assert.equal(topology.links.length, 1);
});

test('capacity and demand stay empty unless someone supplies a number', async () => {
  const source = drawio(`${box('left', 'mxgraph.aws3.ec2', 0, 0)}${box('right', 'mxgraph.aws3.ec2', 300, 0)}${floating('line', [60, 25], [290, 25])}`);
  const bare = await wireDrawio(source, { snap: 60 });
  assert.equal(bare.topology.links[0].capacity.forwarding_bps, null);
  assert.equal(bare.topology.demands.length, 0);
  const filled = await wireDrawio(source, { snap: 60, capacity: 10e9, demand: 1e9 });
  assert.equal(filled.topology.links[0].capacity.forwarding_bps, 10e9);
  assert.equal(filled.topology.demands.length, 1);
  assert.equal(filled.report.flows, 1);
});

test('imported devices carry a name a person can read, and no two share one', () => {
  const topology = { devices: [
    { id: 'a', kind: 'server', drawioVisual: { text: 'EC2' } },
    { id: 'b', kind: 'server', drawioVisual: { text: 'EC2' } },
    { id: 'c', kind: 'server', drawioVisual: { drawioToken: 'mxgraph.aws3.application_load_balancer' } },
    { id: 'd', kind: 'router', drawioVisual: {} },
  ] };
  assert.deepEqual(nameImportedDevices(topology).devices.map(({ name }) => name),
    ['EC2', 'EC2 2', 'application load balancer', 'router 1']);
});

test('a page that does not exist is refused by number', async () => {
  await assert.rejects(() => wireDrawio(drawio(''), { page: 3 }), /페이지 3가 없습니다/);
});

test('snapConnectors does not edit the topology it was handed', async () => {
  const source = drawio(`${box('left', 'mxgraph.aws3.ec2', 0, 0)}${box('right', 'mxgraph.aws3.ec2', 300, 0)}${floating('line', [60, 25], [290, 25])}`);
  const { topology } = await wireDrawio(source, { snap: 0 });
  const before = JSON.stringify(topology.diagram.connectors);
  snapConnectors(topology, { snap: 60 });
  assert.equal(JSON.stringify(topology.diagram.connectors), before);
});
