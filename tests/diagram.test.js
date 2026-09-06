import test from 'node:test';
import assert from 'node:assert/strict';
import { addConnector, addShape, updateShape, removeDiagramElements, moveSelection, alignSelection, distributeSelection, copySelection, pasteSelection, groupSelection, ungroupSelection, exportDiagramSvg, importDrawio } from '../src/diagram.js';

const topology = () => ({ devices: [{ id: 'a', name: 'A', position: { x: 100, y: 100 }, spec: { limits: { nic_bps: 100 } } }, { id: 'b', name: 'B', position: { x: 300, y: 100 } }], links: [{ id: 'ab', source: 'a', target: 'b', capacityBps: 200, waypoints: [{ x: 150, y: 140 }] }], demands: [{ id: 'traffic', source: 'a', target: 'b' }] });
const selection = [{ type: 'device', id: 'a' }, { type: 'device', id: 'b' }];

test('diagram editing remains separate from infrastructure and validates coordinates', () => {
  const original = topology(); const added = addShape(original, 'note', { text: '설명', x: -20 });
  assert.equal(original.diagram, undefined);
  assert.deepEqual(added.devices, original.devices);
  const id = added.diagram.shapes[0].id;
  const edited = updateShape(added, id, { text: '수정', x: 10 });
  assert.equal(added.diagram.shapes[0].text, '설명');
  assert.equal(edited.diagram.shapes[0].x, 10);
  assert.throws(() => updateShape(edited, id, { width: 0 }));
  assert.throws(() => addShape(original, 'rect', { x: Infinity }));
  assert.throws(() => addShape(original, 'rect', { id: 'a' }));
});

test('annotation connectors stay outside infrastructure routing', () => {
  let next = addShape(topology(), 'note', { id: 'note', text: '운영 메모' });
  next = addConnector(next, { source: 'a', target: 'note', kind: 'annotation', label: '설명' });
  assert.equal(next.links.length, 1);
  assert.deepEqual(next.diagram.connectors[0], { id: 'connector-1', source: 'a', target: 'note', kind: 'annotation', label: '설명', waypoints: [] });
  assert.throws(() => addConnector(next, { source: 'a', target: 'missing' }));
});

test('selection moves, aligns and distributes without losing metadata or traffic', () => {
  const original = topology();
  const moved = moveSelection(original, selection, 10, 20);
  assert.deepEqual(moved.devices.map((d) => d.position), [{ x: 110, y: 120 }, { x: 310, y: 120 }]);
  assert.deepEqual(original.devices[0].position, { x: 100, y: 100 });
  assert.deepEqual(moved.demands, original.demands);
  assert.deepEqual(moved.links[0].waypoints, [{ x: 160, y: 160 }]);
  const snapped = moveSelection(original, selection, 11, 11, { grid: 20 });
  assert.deepEqual(snapped.devices.map((d) => d.position), [{ x: 120, y: 120 }, { x: 320, y: 120 }]);
  assert.equal(alignSelection(moved, selection, 'left').devices[1].position.x, 110);
  let three = addShape(moved, 'rect', { x: 500, y: 80, width: 128, height: 80 });
  const all = [...selection, { type: 'shape', id: three.diagram.shapes[0].id }];
  three = distributeSelection(three, all, 'x');
  assert.equal(three.devices[1].position.x - three.devices[0].position.x, three.diagram.shapes[0].x + 64 - three.devices[1].position.x);
  assert.throws(() => moveSelection(original, selection, NaN, 0));
});

test('clipboard remaps only internal references and does not duplicate service demands', () => {
  let original = addShape(topology(), 'note', { text: 'annotation' });
  const note = original.diagram.shapes[0].id;
  original.diagram.connectors.push({ id: 'annotation', source: 'a', target: note, kind: 'annotation', waypoints: [] });
  original = groupSelection(original, [...selection, { type: 'shape', id: note }]);
  const clip = copySelection(original, [{ type: 'group', id: original.diagram.groups[0].id }]);
  const pasted = pasteSelection(original, clip);
  assert.equal(pasted.topology.devices.length, 4);
  assert.equal(pasted.topology.links.length, 2);
  assert.equal(pasted.topology.demands.length, 1);
  assert.deepEqual(pasted.topology.devices[2].spec, original.devices[0].spec);
  assert.equal(pasted.topology.links[1].source, pasted.topology.devices[2].id);
  assert.equal(pasted.topology.diagram.connectors[1].target, pasted.topology.diagram.shapes[1].id);
  assert.deepEqual(pasted.topology.links[1].waypoints, [{ x: 174, y: 164 }]);
  assert.equal(new Set([...pasted.topology.devices, ...pasted.topology.links, ...pasted.topology.diagram.shapes, ...pasted.topology.diagram.connectors, ...pasted.topology.diagram.groups].map((v) => v.id)).size, 12);
  assert.equal(copySelection(original, [{ type: 'device', id: 'a' }]).links.length, 0);
});

test('groups move members together and removal cleans visual references', () => {
  let t = addShape(topology(), 'text'); const id = t.diagram.shapes[0].id;
  t.diagram.connectors.push({ id: 'c', source: 'a', target: id });
  t = groupSelection(t, [{ type: 'device', id: 'a' }, { type: 'shape', id }]);
  const groupId = t.diagram.groups[0].id;
  const moved = moveSelection(t, [{ type: 'group', id: groupId }], 40, 20);
  assert.equal(moved.devices[0].position.x, 140); assert.equal(moved.diagram.shapes[0].x, 140);
  assert.equal(ungroupSelection(t, [{ type: 'shape', id }]).diagram.groups.length, 0);
  const removed = removeDiagramElements(t, [{ type: 'shape', id }]);
  assert.equal(removed.diagram.connectors.length, 0);
  assert.deepEqual(removed.diagram.groups[0].memberIds, ['a']);
});

test('SVG export includes labels and routes but never executable markup or external references', () => {
  const t = addShape(topology(), 'note', { text: '<script>alert("x")</script> &', x: -200 });
  t.links[0].label = '<image href="https://example.test"/>';
  const svg = exportDiagramSvg(t);
  assert.match(svg, /&lt;script&gt;/); assert.match(svg, /&amp;/);
  assert.doesNotMatch(svg, /<script|<image|foreignObject/);
  assert.match(svg, /150,140/); assert.match(svg, /viewBox="-224/);
});

test('drawio importer rejects unsafe, oversized and compressed XML with actionable errors', () => {
  assert.throws(() => importDrawio('<!DOCTYPE a>'), /엔터티/);
  assert.throws(() => importDrawio('x'.repeat(2 * 1024 * 1024 + 1)), /2 MB/);
  const parser = { parseFromString: () => ({ querySelector: () => null, querySelectorAll: () => [] }) };
  assert.throws(() => importDrawio('<mxfile><diagram>compressed</diagram></mxfile>', parser), /압축/);
});
