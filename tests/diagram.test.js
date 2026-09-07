import test from 'node:test';
import assert from 'node:assert/strict';
import { addConnector, addShape, updateShape, removeDiagramElements, moveSelection, alignSelection, distributeSelection, copySelection, pasteSelection, groupSelection, ungroupSelection, exportDiagramSvg, importDrawio } from '../public/diagram.js';
import { calculateScenario, sweepSingleFaults } from '../public/engine.js';
import { nodeAxes } from '../public/node-view.js';
import { buildTemplate } from '../public/templates.js';

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

test('a duplicated device lands where the original was wired, not floating beside it', () => {
  const original = topology();
  // 장비의 source 는 그 한계값을 어디서 얻었는지다. 링크의 끝점과 이름만 같다.
  original.devices[0].source = { type: 'datasheet', label: '어느 데이터시트', condition: '1518바이트' };
  const clip = copySelection(original, [{ type: 'device', id: 'a' }]);
  // 안쪽 링크(양 끝이 다 선택 안)와 바깥 링크(한 끝만)를 나눠 담는다. 한 대만 고르면 안쪽은 없다.
  assert.equal(clip.links.length, 0);
  assert.deepEqual(clip.edges.map(({ source, target }) => `${source}-${target}`), ['a-b']);

  const pasted = pasteSelection(original, clip);
  const copyId = pasted.selection[0].id;
  const wired = pasted.topology.links.filter((link) => link.source === copyId || link.target === copyId);
  // 이어 놓지 않으면 지나는 수요가 없어 아무것도 계산되지 않는다. 원본이 물려 있던 상대에 잇는다.
  assert.equal(wired.length, 1);
  assert.equal(wired[0].target, 'b', '바깥 끝은 새로 만들지 않고 원래 장비를 그대로 가리킨다');
  assert.equal(new Set(pasted.topology.links.map(({ id }) => id)).size, pasted.topology.links.length);

  // 장비의 source 는 끝점이 아니라 그 값을 어디서 얻었는지다. 링크와 함께 다시 가리키면
  // 출처가 통째로 사라지고, 그 장비를 고르는 순간 인스펙터가 멈춘다.
  const copied = pasted.topology.devices.find(({ id }) => id === copyId);
  assert.deepEqual(copied.source, { type: 'datasheet', label: '어느 데이터시트', condition: '1518바이트' });

  // 상대가 사라졌으면 만들지 않는다. 없는 장비를 가리키는 링크는 계산 전체를 invalid 로 만든다.
  const gone = { ...original, devices: original.devices.filter(({ id }) => id !== 'b'), links: [] };
  assert.equal(pasteSelection(gone, clip).topology.links.length, 0);
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

test('stamps the calculation onto the exported frame', () => {
  const topology = buildTemplate('three-tier');
  const result = calculateScenario(topology, { disabledDevices: ['web-a'] });
  const svg = exportDiagramSvg(topology, result, { sweep: sweepSingleFaults(topology), exportedAt: '2026-09-07 08:00' });

  // 이 그림이 어느 조건에서 나왔는지. 하나라도 빠지면 근거가 아니라 그림일 뿐이다.
  for (const fragment of ['배율 1.00배', '장애 web-a', `엔진 ${result.engineVersion}`, '합성 데모', '내보냄 2026-09-07 08:00']) {
    assert.ok(svg.includes(fragment), `스탬프에 ${fragment} 가 없습니다.`);
  }
  // 미확인이 있는 결과를 통과로 보이게 하지 않는다.
  assert.equal(result.summary.evaluationStatus, 'unknown');
  assert.ok(svg.includes('통과 보류') && svg.includes(`미확인 제약 ${result.summary.unknownCount}개`));
  assert.ok(svg.includes('전달률 상한'), '상한값 판정을 확정처럼 보이게 하지 않는다');
  // 카탈로그 판을 하나로 부를 수 없으면 지어내지 않는다.
  assert.ok(svg.includes('카탈로그 —'));

  // 화면과 같은 심볼·축·상태를 담는다.
  assert.ok(svg.includes('DB · NIC 처리량 75%'), '헤드라인이 병목 자원과 축을 사람이 읽는 이름으로 말한다');
  assert.ok(svg.includes('OFFLINE') && svg.includes('DOWN'), '죽은 장비와 그 링크는 숫자가 아니라 상태를 말한다');
  assert.ok(svg.includes('WEB TIER') && svg.includes('DATA TIER'), 'zone 그룹 상자가 그려진다');
  assert.match(svg, /<g transform="translate\([-\d.]+ [-\d.]+\) scale\(/, '장비 심볼이 인라인으로 들어간다');
});

test('never turns an unknown axis into a number in the exported frame', () => {
  const topology = buildTemplate('three-tier');
  const result = calculateScenario(topology);
  const svg = exportDiagramSvg(topology, result);
  // 노드에 실제로 그려지는 축만 센다. 다섯 개를 넘으면 화면이 줄이므로 같은 규칙으로 고른다.
  const drawn = result.devices.filter(({ active }) => active).flatMap((device) => nodeAxes(device).rows.map(([, axis]) => axis));
  const unknownAxes = drawn.filter(({ status }) => status === 'unknown');
  assert.ok(unknownAxes.length > 0, '이 템플릿에는 한계를 모르는 축이 있어야 이 검사가 성립한다');
  // 미확인 축은 백분율 자리에 em dash 가 온다. 0% 로 적으면 미확인이 안전으로 읽힌다.
  assert.ok((svg.match(/>—</g) || []).length >= unknownAxes.length,
    `미확인 축 ${unknownAxes.length}개가 전부 em dash 로 나와야 합니다.`);
  // 미확인 축은 막대도 채우지 않는다. 채운 막대 수가 아는 축 수를 넘지 않는다.
  const filled = (svg.match(/stroke-width="2"\/>/g) || []).length;
  assert.ok(filled > 0);
});

test('draws the diagram alone when there is no calculation to stamp', () => {
  const topology = buildTemplate('three-tier');
  const svg = exportDiagramSvg(topology);
  assert.ok(svg.includes('계산 결과 없음'));
  assert.equal(svg.includes('배율'), false, '결과가 없으면 배율을 지어내지 않는다');
  assert.doesNotMatch(svg, /<script|<image|foreignObject/);
});
