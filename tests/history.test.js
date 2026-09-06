import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../src/history.js';

test('history snapshots isolate mutations, retain a saved checkpoint and discard redo on a new edit', () => {
  const initial = { position: { x: 0 }, failed: ['a'] };
  const h = createHistory(initial);
  initial.position.x = 999;
  assert.equal(h.current.position.x, 0);
  const edited = h.current; edited.position.x = 10;
  h.record(edited, '이동'); edited.position.x = 999;
  assert.equal(h.current.position.x, 10);
  assert.equal(h.isDirty, true);
  h.markSaved(); assert.equal(h.isDirty, false);
  const undone = h.undo(); undone.failed.length = 0;
  assert.deepEqual(h.current.failed, ['a']);
  assert.equal(h.isDirty, true);
  assert.equal(h.redo().position.x, 10);
  assert.equal(h.isDirty, false);
  h.undo(); h.record({ position: { x: 20 }, failed: ['a'] });
  assert.equal(h.canRedo, false);
  assert.equal(h.label, '');
});

test('history enforces a bounded command count, deduplicates no-ops and resets cleanly', () => {
  const h = createHistory(0, { limit: 2 });
  h.record(1); h.record(2); h.record(3); h.record(3);
  assert.equal(h.undo(), 2); assert.equal(h.undo(), 1);
  assert.equal(h.canUndo, false); assert.equal(h.undo(), 1);
  h.reset(8); assert.equal(h.current, 8); assert.equal(h.isDirty, false); assert.equal(h.canRedo, false);
  assert.throws(() => createHistory(0, { limit: 0 }));
});
