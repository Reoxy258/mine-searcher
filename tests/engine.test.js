import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { SAVE_KEY, neighbors, makeBoard, createGame, generateBoard, knownPath, reachable, frontier, travel, toggleFlag, deduce, getHint, solveBoard, saveProgress, loadProgress } from '../src/engine.js';

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}
function checkPath(board, path) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    assert.equal(Math.abs(a % board.cols - b % board.cols) + Math.abs(Math.floor(a / board.cols) - Math.floor(b / board.cols)), 1);
  }
}
function roundtrip(game, completed = {}) {
  const store = storage();
  assert.equal(saveProgress(store, game, completed), true);
  const loaded = loadProgress(store);
  assert.ok(loaded);
  for (const k of ['level', 'position', 'revealed', 'flags', 'trail', 'steps', 'hints', 'elapsed', 'status', 'exploded']) assert.deepEqual(loaded.game[k], game[k], k);
  assert.deepEqual(loaded.game.board, game.board);
  return loaded;
}

test('eight-neighbor clues match an independent coordinate count, including corners', () => {
  const board = makeBoard(4, 4, [1, 5, 6, 10]);
  for (let i = 0; i < 16; i++) {
    let count = 0;
    for (let j = 0; j < 16; j++) if (i !== j && board.mines[j] && Math.abs(i % 4 - j % 4) <= 1 && Math.abs(Math.floor(i / 4) - Math.floor(j / 4)) <= 1) count++;
    assert.equal(board.clues[i], count, `clue ${i}`);
  }
  assert.deepEqual(neighbors(board, 0).sort((a,b) => a-b), [1, 4, 5]);
  assert.deepEqual(neighbors(board, 0, false).sort((a,b) => a-b), [1, 4]);
  assert.equal(neighbors(board, 5).length, 8);
});

test('zero expansion reveals zero region and numbered boundary, never mines', () => {
  const game = createGame(makeBoard(5, 5, [0, 1, 2]));
  assert.equal(game.revealed[20], true);
  assert.equal(game.revealed[5], true);
  assert.equal(game.board.clues[5], 2);
  for (let i = 0; i < 25; i++) if (game.board.mines[i]) assert.equal(game.revealed[i], false);
  const divided = createGame(makeBoard(5, 5, [10, 11, 12, 13, 14]));
  assert.equal(divided.revealed[15], true);
  assert.equal(divided.revealed[5], false);
});

test('unknown intervening squares cannot be skipped or reached diagonally', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  assert.deepEqual(game.revealed.map((v,i) => v ? i : -1).filter(i => i >= 0), [12]);
  assert.equal(knownPath(game, 14), null);
  assert.equal(knownPath(game, 9), null);
  assert.equal(travel(game, 14).reason, 'unreachable');
  assert.equal(travel(game, 9).reason, 'unreachable');
  assert.equal(game.position, 12);
  assert.equal(game.steps, 0);
  assert.deepEqual([...frontier(game)].sort((a,b) => a-b), [8, 13]);
});

test('walking across known squares counts every orthogonal step', () => {
  const game = createGame(makeBoard(4, 4, []));
  const result = travel(game, 14);
  assert.equal(result.type, 'move');
  assert.deepEqual(result.path, [12, 13, 14]);
  assert.equal(game.steps, 2);
  assert.deepEqual(game.trail, [12, 13, 14]);
  assert.equal(reachable(game).size, 16);
  assert.equal(travel(game, 14).reason, 'same');
  assert.equal(travel(game, -1).reason, 'outside');
  assert.equal(travel(game, 1.5).reason, 'outside');
});

test('flags block movement, are reversible, limited, and unavailable on revealed/exit squares', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  assert.equal(toggleFlag(game, 12), false);
  assert.equal(toggleFlag(game, 3), false);
  assert.equal(toggleFlag(game, -1), false);
  assert.equal(toggleFlag(game, 8), true);
  assert.equal(travel(game, 8).reason, 'flagged');
  assert.equal(toggleFlag(game, 13), true);
  assert.equal(toggleFlag(game, 9), false);
  assert.equal(toggleFlag(game, 8), true);
  assert.equal(toggleFlag(game, 9), true);
});

test('a flagged safe square survives flood expansion until explicitly unflagged', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  toggleFlag(game, 4);
  travel(game, 8);
  assert.equal(game.flags[4], true);
  assert.equal(game.revealed[4], false);
  toggleFlag(game, 4);
  assert.equal(travel(game, 4).ok, true);
  assert.equal(game.revealed[4], true);
});

test('stepping on a mine loses and terminal games reject movement and flags', () => {
  const game = createGame(makeBoard(4, 4, [13]));
  assert.equal(travel(game, 13).type, 'mine');
  assert.equal(game.status, 'lost');
  assert.equal(game.exploded, 13);
  assert.equal(game.position, 13);
  assert.equal(game.revealed[13], false);
  assert.equal(travel(game, 8).reason, 'finished');
  assert.equal(toggleFlag(game, 9), false);
  assert.equal(getHint(game), null);
});

test('an already revealed exit requires reaching it to win', () => {
  const game = createGame(makeBoard(4, 4, []));
  assert.equal(game.revealed[3], true);
  assert.equal(game.status, 'playing');
  const result = travel(game, 3);
  checkPath(game.board, result.path);
  assert.equal(result.type, 'win');
  assert.equal(game.status, 'won');
  assert.equal(game.position, 3);
  assert.equal(game.steps, 6);
  assert.equal(travel(game, 2).reason, 'finished');
  assert.equal(getHint(game), null);
});

test('auto walking stops at exit when exit lies in the middle of a route', () => {
  const game = createGame(makeBoard(3, 3, [], 6, 7));
  const result = travel(game, 8);
  assert.equal(result.type, 'win');
  assert.deepEqual(result.path, [6, 7]);
  assert.equal(game.position, 7);
  assert.equal(game.steps, 1);
});

test('all 30 authored boards are deterministic, independent and solvable by sound visible deductions', () => {
  assert.equal(LEVELS.length, 30);
  for (const level of LEVELS) {
    const board = generateBoard(level.id);
    assert.equal(board.mineCount, level.mineCount);
    assert.equal(board.mines[board.start], false);
    assert.equal(board.mines[board.goal], false);
    assert.deepEqual(board, generateBoard(level.id));
    const copy = generateBoard(level.id); copy.clues[0] = -99;
    assert.notEqual(generateBoard(level.id).clues[0], -99);
    const game = createGame(board, level.id);
    for (let turn = 0; turn < board.cols * board.rows && game.status === 'playing'; turn++) {
      const { safe, mines } = deduce(game);
      for (const i of safe) assert.equal(board.mines[i], false, `level ${level.id}, false safe ${i}`);
      for (const i of mines) assert.equal(board.mines[i], true, `level ${level.id}, false mine ${i}`);
      const edge = frontier(game);
      const next = knownPath(game, board.goal) ? board.goal : [...safe].find(i => edge.has(i) && !game.revealed[i]);
      assert.notEqual(next, undefined, `level ${level.id} requires a guess`);
      const result = travel(game, next);
      assert.equal(result.ok, true);
      checkPath(board, result.path);
      assert.notEqual(game.status, 'lost');
    }
    assert.equal(game.status, 'won', `level ${level.id} failed`);
    assert.equal(game.position, board.goal);
    assert.equal(solveBoard(board).solved, true);
  }
});

test('inference ignores hidden mine arrays and incorrect player flags', () => {
  const game = createGame(generateBoard(0));
  const expected = deduce(game);
  const changed = structuredClone(game);
  changed.board.mines.fill(true);
  changed.flags = changed.flags.map((_, i) => !changed.revealed[i] && i % 2 === 0);
  assert.deepEqual(deduce(changed), expected);
  const safe = [...expected.safe].find(i => !game.revealed[i] && i !== game.board.goal);
  assert.notEqual(safe, undefined);
  assert.equal(toggleFlag(game, safe), true);
  assert.deepEqual(deduce(game), expected);
  assert.equal(getHint(game).type, 'unflag');
  assert.equal(getHint(game).index, safe);
});

test('hints always identify provable safe squares or mines', () => {
  for (const level of [0, 7, 15, 29]) {
    const game = createGame(generateBoard(level), level);
    const hint = getHint(game);
    assert.ok(hint);
    assert.equal(game.board.mines[hint.index], hint.type === 'mine');
    assert.equal(typeof hint.text, 'string');
  }
});

test('playing, won and lost saves restore without dropping state', () => {
  const playing = createGame(generateBoard(0));
  playing.hints = 2; playing.elapsed = 42;
  roundtrip(playing, { 0: 3 });
  const won = solveBoard(generateBoard(1)).game; won.level = 1;
  roundtrip(won);
  const lost = createGame(generateBoard(2), 2);
  // Deliberately explore until a reachable mine is available, simulating a player mistake.
  while (lost.status === 'playing') {
    const edge = [...frontier(lost)];
    const mine = edge.find(i => lost.board.mines[i]);
    if (mine !== undefined) { travel(lost, mine); break; }
    const next = edge.find(i => !lost.board.mines[i]);
    assert.notEqual(next, undefined);
    travel(lost, next);
  }
  assert.equal(lost.status, 'lost');
  roundtrip(lost);
});

test('malformed and inconsistent saves are rejected, numeric metadata is sanitized', () => {
  const store = storage();
  assert.equal(loadProgress(store), null);
  store.setItem(SAVE_KEY, '{bad json'); assert.equal(loadProgress(store), null);
  const original = createGame(generateBoard(0)); saveProgress(store, original);
  const valid = JSON.parse(store.getItem(SAVE_KEY));
  const corruptions = [
    d => d.version = 99, d => d.level = 30, d => d.level = -1,
    d => d.revealed.pop(), d => d.flags[0] = 1, d => d.position = -1,
    d => d.status = 'other', d => d.status = 'won',
    d => d.revealed[original.board.mines.findIndex(Boolean)] = true,
    d => d.flags[original.position] = true,
    d => d.status = 'lost',
  ];
  for (const corrupt of corruptions) {
    const d = structuredClone(valid); corrupt(d); store.setItem(SAVE_KEY, JSON.stringify(d));
    assert.equal(loadProgress(store), null);
  }
  const d = structuredClone(valid);
  Object.assign(d, { hints: -2, steps: 1e15, elapsed: 'oops', completed: { 0: 3, 1: 0, 2: 4, 3: 1, 30: 3, bad: 2 }, trail: [-1, 0, 'a', 999] });
  store.setItem(SAVE_KEY, JSON.stringify(d));
  const loaded = loadProgress(store);
  assert.ok(loaded);
  assert.equal(loaded.game.hints, 0); assert.equal(loaded.game.steps, 1e9); assert.equal(loaded.game.elapsed, 0);
  assert.deepEqual(loaded.completed, { 0: 3, 3: 1 });
  assert.deepEqual(loaded.game.trail, [0]);
});

test('storage exceptions fail gracefully', () => {
  const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
  assert.equal(saveProgress(broken, createGame(generateBoard(0))), false);
  assert.equal(loadProgress(broken), null);
});

test('invalid board sizes, mine positions and level ids reject cleanly', () => {
  for (const args of [[1,4,[]], [4,1,[]], [2.5,4,[]], [4,4,[-1]], [4,4,[16]], [4,4,[12]], [4,4,[3]]]) assert.throws(() => makeBoard(...args));
  for (const level of [-1, 30, 0.5, '0', null]) assert.throws(() => generateBoard(level));
});
