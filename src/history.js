/** Snapshot history: callers never receive mutable references to stored commands. */
export function createHistory(initial, { limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer');
  let entries = [{ value: structuredClone(initial), label: '' }];
  let cursor = 0;
  let saved = JSON.stringify(initial);
  const current = () => structuredClone(entries[cursor].value);
  return {
    get current() { return current(); },
    get canUndo() { return cursor > 0; },
    get canRedo() { return cursor < entries.length - 1; },
    get isDirty() { return JSON.stringify(entries[cursor].value) !== saved; },
    get label() { return entries[cursor].label; },
    record(next, label = '') {
      if (JSON.stringify(next) === JSON.stringify(entries[cursor].value)) return current();
      entries = entries.slice(0, cursor + 1);
      entries.push({ value: structuredClone(next), label: String(label) });
      if (entries.length > limit + 1) entries.shift();
      cursor = entries.length - 1;
      return current();
    },
    undo() { if (cursor > 0) cursor -= 1; return current(); },
    redo() { if (cursor < entries.length - 1) cursor += 1; return current(); },
    markSaved() { saved = JSON.stringify(entries[cursor].value); },
    reset(value) { entries = [{ value: structuredClone(value), label: '' }]; cursor = 0; saved = JSON.stringify(value); return current(); },
  };
}
