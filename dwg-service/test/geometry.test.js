import test from 'node:test';
import assert from 'node:assert/strict';
import { orderFrames, validateSelection } from '../geometry.js';
const frame = (id, x, y, height = 100) => ({ id, center: [x, y], height });
test('row grouping orders top-to-bottom and left-to-right despite small vertical offsets', () => {
  assert.deepEqual(orderFrames([frame('6', 300, 0), frame('2', 150, 201), frame('4', 0, -2), frame('3', 300, 198), frame('1', 0, 200), frame('5', 150, 1)]).map(f => f.id), ['1', '2', '3', '4', '5', '6']);
});
test('nearby rows with different frame sizes do not merge', () => {
  assert.deepEqual(orderFrames([frame('bottom', 0, 100, 30), frame('top', 50, 130, 100)]).map(f => f.id), ['top', 'bottom']);
});
test('output selection rejects unknown, duplicate, empty pages and invalid paper', () => {
  const frames = [frame('a', 0, 0), frame('b', 1, 0)];
  for (const body of [{ ids: [], paper: 'A3' }, { ids: ['a', 'a'], paper: 'A3' }, { ids: ['x'], paper: 'A3' }, { ids: ['a'], paper: '../x' }]) assert.throws(() => validateSelection(body, frames));
  assert.deepEqual(validateSelection({ ids: ['b', 'a'], paper: 'A1' }, frames), { ids: ['b', 'a'], paper: 'A1' });
});
