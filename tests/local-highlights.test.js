import test from 'node:test';
import assert from 'node:assert/strict';
import { localMineHighlights, deduce, makeBoard } from '../src/engine.js';

function fixture(cols, rows, unknown, clues = {}) {
  const game = {
    board: { cols, rows, start: (rows - 1) * cols, goal: cols - 1, clues: Array(cols * rows).fill(0), mines: Array(cols * rows).fill(false) },
    revealed: Array(cols * rows).fill(true), flags: Array(cols * rows).fill(false), status: 'playing',
  };
  for (const i of unknown) game.revealed[i] = false;
  for (const [i, clue] of Object.entries(clues)) game.board.clues[i] = clue;
  return game;
}
function result(game) { return [...localMineHighlights(game)].sort((a, b) => a - b); }

test('local highlights require exactly the original clue count of unopened neighbors', () => {
  assert.deepEqual(result(fixture(3, 3, [0, 1], { 4: 2 })), [0, 1]);
  assert.deepEqual(result(fixture(3, 3, [0], { 4: 2 })), [], 'fewer unopened cells is not equality');
  assert.deepEqual(result(fixture(3, 3, [0, 1, 2], { 4: 2 })), [], 'more unopened cells must not infer a subset');
});

test('corners and edges count only existing eight-direction neighbors', () => {
  assert.deepEqual(result(fixture(3, 3, [1, 3, 4], { 0: 3 })), [1, 3, 4]);
  assert.deepEqual(result(fixture(3, 3, [0, 2, 3, 4, 5], { 1: 5 })), [0, 2, 3, 4, 5]);
  assert.deepEqual(result(fixture(4, 3, [3, 4], { 0: 2 })), [], 'last column must not wrap around beside the first');
});

test('multiple qualifying visible numbers contribute the union of their unopened neighbors', () => {
  assert.deepEqual(result(fixture(5, 3, [1, 3, 5, 9], { 0: 2, 4: 2 })), [1, 3, 5, 9]);
  assert.deepEqual(result(fixture(3, 3, [1], { 0: 1, 2: 1 })), [1], 'overlapping highlights are deduplicated');
});

test('flags remain unopened cells and neither create nor reduce the local condition', () => {
  const equal = fixture(3, 3, [0, 1], { 4: 2 });
  equal.flags[0] = true; assert.deepEqual(result(equal), [0, 1]);
  equal.flags[1] = true; assert.deepEqual(result(equal), [0, 1]);
  const larger = fixture(3, 3, [0, 1, 2], { 4: 2 });
  larger.flags[0] = true; larger.flags[1] = true;
  assert.deepEqual(result(larger), [], 'subtracting two flags must not change the original count');
  Object.defineProperty(equal, 'flags', { get() { throw Error('flags must not be read'); } });
  assert.deepEqual(result(equal), [0, 1]);
});

test('local highlights are pure, ignore hidden clues and never access hidden mines', () => {
  const game = fixture(3, 3, [0, 1], { 4: 2 }), before = structuredClone(game);
  assert.deepEqual(result(game), [0, 1]); assert.deepEqual(result(game), [0, 1]);
  assert.deepEqual(game, before, 'rendering a hint must not reveal, flag or otherwise change the game');
  Object.defineProperty(game.board, 'mines', { get() { throw Error('hidden mines must not be read'); } });
  for (const i of [0, 1]) Object.defineProperty(game.board.clues, i, { get() { throw Error('hidden clues must not be read'); } });
  assert.deepEqual(result(game), [0, 1]);
});

test('unopened numbers and zero clues do not originate highlights', () => {
  const unopened = fixture(3, 3, [0, 1, 4], { 4: 2 });
  assert.deepEqual(result(unopened), []);
  assert.deepEqual(result(fixture(3, 3, [0], { 4: 0 })), []);
  assert.deepEqual(result(fixture(3, 3, [])), []);
});

test('combination inference may prove a mine while the local-only highlight remains empty', () => {
  // Clue 1 at (0,0): A+B=1. Clue 3 at (1,0): A+B+C+D=3.
  // Therefore C and D are mines, but neither original clue sees exactly its number
  // of unopened neighbors. Automatic highlights must not use that subtraction.
  const board = makeBoard(4, 3, [2, 4, 6]);
  const game = { board, revealed: Array(12).fill(false), flags: Array(12).fill(false), status: 'playing' };
  game.revealed[0] = true; game.revealed[1] = true;
  assert.ok(deduce(game).mines.has(2) && deduce(game).mines.has(6), 'fixture must exhibit the stronger combination inference');
  assert.deepEqual(result(game), [], 'automatic red highlight must stop at the original single-number rule');
});
