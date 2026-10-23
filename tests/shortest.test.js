import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, createGame, knownPath, generateBoard, deduce, explore } from '../src/engine.js';
import { LEVELS } from '../src/levels.js';

// Deliberately independent of the engine's neighbor and route implementations.
function adjacent(board, index) {
  const x = index % board.cols, y = Math.floor(index / board.cols), cells = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < board.cols && ny >= 0 && ny < board.rows) cells.push(ny * board.cols + nx);
  }
  return cells;
}
function distances(game) {
  const d = Array(game.revealed.length).fill(Infinity), pending = [game.board.start];
  if (!game.revealed[game.board.start] || game.flags[game.board.start]) return d;
  d[game.board.start] = 0;
  for (let q = 0; q < pending.length; q++) for (const next of adjacent(game.board, pending[q])) {
    if (game.revealed[next] && !game.flags[next] && !Number.isFinite(d[next])) {
      d[next] = d[pending[q]] + 1; pending.push(next);
    }
  }
  return d;
}
function checkShortest(game, target = game.board.goal) {
  const distance = distances(game)[target], route = knownPath(game, target);
  if (!Number.isFinite(distance)) { assert.equal(route, null); return; }
  assert.ok(route); assert.equal(route.length - 1, distance);
  assert.equal(route[0], game.board.start); assert.equal(route.at(-1), target);
  for (let n = 0; n < route.length; n++) {
    assert.equal(game.revealed[route[n]], true, `unknown cell ${route[n]}`);
    assert.equal(game.flags[route[n]], false, `flagged cell ${route[n]}`);
    if (n) assert.ok(adjacent(game.board, route[n - 1]).includes(route[n]), 'nonorthogonal step');
  }
}
function fixture(cols, rows, opened, flags = []) {
  const game = createGame(makeBoard(cols, rows, []));
  game.revealed.fill(false); game.flags.fill(false);
  for (const i of opened) game.revealed[i] = true;
  for (const i of flags) game.flags[i] = true;
  return game;
}
function turns(route, cols) {
  let count = 0;
  for (let i = 2; i < route.length; i++) {
    const delta = (a, b) => [a % cols - b % cols, Math.floor(a / cols) - Math.floor(b / cols)].join(',');
    if (delta(route[i], route[i - 1]) !== delta(route[i - 1], route[i - 2])) count++;
  }
  return count;
}
// Only follow increasing distance layers; among those shortest paths, independently
// retain the cheapest turn count for each incoming direction.
function fewestShortestTurns(game) {
  const d = distances(game), costs = Array.from({ length: d.length }, () => new Map());
  costs[game.board.start].set('start', 0);
  const ordered = d.map((distance, i) => ({ distance, i })).filter(s => Number.isFinite(s.distance)).sort((a, b) => a.distance - b.distance);
  for (const { i } of ordered) for (const j of adjacent(game.board, i)) {
    if (d[j] !== d[i] + 1) continue;
    const direction = [j % game.board.cols - i % game.board.cols, Math.floor(j / game.board.cols) - Math.floor(i / game.board.cols)].join(',');
    for (const [previous, count] of costs[i]) {
      const nextCount = count + (previous !== 'start' && previous !== direction ? 1 : 0);
      costs[j].set(direction, Math.min(costs[j].get(direction) ?? Infinity, nextCount));
    }
  }
  return Math.min(...costs[game.board.goal].values());
}

test('shortest route uses the opened corridor rather than hidden shortcuts', () => {
  const game = fixture(5, 5, [20, 15, 10, 11, 12, 17, 18, 19, 14, 9, 4]);
  checkShortest(game);
  assert.deepEqual(knownPath(game, 4), [20, 15, 10, 11, 12, 17, 18, 19, 14, 9, 4]);
  // Even an opened extra side branch does not require visiting every clicked cell.
  game.revealed[16] = true; checkShortest(game);
});

test('shortest route handles competing paths and avoids a longer opened detour', () => {
  const game = fixture(6, 5, Array.from({ length: 30 }, (_, i) => i), [7, 8, 9, 10, 19, 20, 21]);
  for (let i = 0; i < 30; i++) checkShortest(game, i);
  assert.equal(knownPath(game, game.board.goal).length - 1, 9);
});

test('equally short routes prefer fewer turns without increasing step count', () => {
  const game = fixture(5, 5, Array.from({ length: 25 }, (_, i) => i));
  const route = knownPath(game, game.board.goal);
  checkShortest(game); assert.equal(turns(route, game.board.cols), 1);
});

test('unknown, flagged, disconnected and diagonal cells cannot bridge a route', () => {
  const game = fixture(4, 4, [12, 8, 4, 0, 1, 2, 3]);
  checkShortest(game); game.revealed[4] = false; checkShortest(game);
  game.revealed[4] = true; game.flags[4] = true; checkShortest(game);
  const diagonal = fixture(4, 4, [12, 9, 6, 3]); checkShortest(diagonal);
  const unopenedExit = fixture(4, 4, [12, 8, 4, 0, 1, 2]); checkShortest(unopenedExit);
  assert.deepEqual(knownPath(game, game.board.start), [game.board.start]);
});

test('independent distance checks cover hundreds of differently revealed regions', () => {
  let seed = 481516;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 300; trial++) {
    const cols = 3 + Math.floor(random() * 7), rows = 3 + Math.floor(random() * 7);
    const opened = Array.from({ length: cols * rows }, (_, i) => i).filter(() => random() < .7);
    const game = fixture(cols, rows, opened);
    game.revealed[game.board.start] = true; game.revealed[game.board.goal] = true;
    for (let i = 0; i < game.flags.length; i++) if (random() < .08) game.flags[i] = true;
    checkShortest(game);
    const path = knownPath(game, game.board.goal);
    if (path) assert.equal(turns(path, cols), fewestShortestTurns(game), `unnecessary turns in trial ${trial}`);
  }
});

test('every deduction during all 30 levels proves actual mines without trusting player flags or hidden cells', () => {
  let checkedStates = 0, checkedMines = 0;
  for (const level of LEVELS) {
    const game = createGame(generateBoard(level.id), level.id, { shields: 0 });
    for (let move = 0; game.status === 'playing' && move < game.revealed.length; move++) {
      const expected = deduce(game); checkedStates++;
      for (const i of expected.mines) { assert.equal(game.board.mines[i], true, `level ${level.id}, false mine ${i}`); checkedMines++; }
      for (const i of expected.safe) assert.equal(game.board.mines[i], false, `level ${level.id}, false safe ${i}`);
      const tampered = structuredClone(game);
      tampered.flags = tampered.flags.map((_, i) => !tampered.revealed[i] && (i + move) % 3 === 0);
      tampered.board.mines = tampered.board.mines.map((_, i) => (i + move) % 2 === 0);
      assert.deepEqual(deduce(tampered), expected, `level ${level.id}, deduction relies on hidden state or flags`);
      const next = [...expected.safe].find(i => !game.revealed[i]);
      assert.notEqual(next, undefined, `level ${level.id} requires guessing`);
      explore(game, next); checkShortest(game);
    }
    assert.equal(game.status, 'running'); checkShortest(game);
  }
  assert.ok(checkedStates > 30); assert.ok(checkedMines > 0);
});
