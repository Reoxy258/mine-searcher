import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { SAVE_KEY, neighbors, makeBoard, createGame, generateBoard, knownPath, reachable, frontier, explore, finishRun, toggleFlag, deduce, getHint, solveBoard, starsFor, saveProgress, loadProgress } from '../src/engine.js';

function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}
function checkPath(board, path) {
  assert.equal(path[0], board.start); assert.equal(path.at(-1), board.goal);
  for (const index of path) assert.equal(board.mines[index], false);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    assert.equal(Math.abs(a % board.cols - b % board.cols) + Math.abs(Math.floor(a / board.cols) - Math.floor(b / board.cols)), 1);
  }
}
function roundtrip(game, completed = {}) {
  const store = storage(); assert.equal(saveProgress(store, game, completed), true);
  const loaded = loadProgress(store); assert.ok(loaded);
  for (const k of ['level', 'position', 'revealed', 'flags', 'trail', 'runPath', 'maxShields', 'shields', 'rescues', 'steps', 'hints', 'elapsed', 'status', 'exploded']) assert.deepEqual(loaded.game[k], game[k], k);
  assert.deepEqual(loaded.game.board, game.board);
  return loaded;
}
function revealByDeductions(game) {
  for (let turn = 0; turn < game.revealed.length && game.status === 'playing'; turn++) {
    const { safe, mines } = deduce(game);
    for (const i of safe) assert.equal(game.board.mines[i], false, `false safe ${i}`);
    for (const i of mines) assert.equal(game.board.mines[i], true, `false mine ${i}`);
    const next = [...safe].find(i => !game.revealed[i]);
    assert.notEqual(next, undefined, `level ${game.level} requires a guess`);
    assert.equal(explore(game, next).ok, true);
    assert.equal(game.position, game.board.start); assert.deepEqual(game.trail, [game.board.start]);
  }
  return game;
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
  assert.equal(game.revealed[20], true); assert.equal(game.revealed[5], true); assert.equal(game.board.clues[5], 2);
  for (let i = 0; i < 25; i++) if (game.board.mines[i]) assert.equal(game.revealed[i], false);
  const divided = createGame(makeBoard(5, 5, [10, 11, 12, 13, 14]));
  assert.equal(divided.revealed[15], true); assert.equal(divided.revealed[5], false);
});

test('known paths never include an unknown target, even next to S', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  assert.deepEqual(game.revealed.map((v,i) => v ? i : -1).filter(i => i >= 0), [12]);
  for (const target of [8, 13, 14, 3, -1, 1.5]) assert.equal(knownPath(game, target), null);
  assert.deepEqual([...frontier(game)].sort((a,b) => a-b), [8, 13]);
});

test('any unknown safe cell can be explored while S remains still; isolated E does not win', () => {
  const game = createGame(makeBoard(4, 4, [2, 6, 9, 13]));
  assert.equal(knownPath(game, 3), null); assert.equal(explore(game, 3).ok, true);
  assert.equal(game.revealed[3], true); assert.equal(game.position, 12); assert.deepEqual(game.trail, [12]);
  assert.equal(game.steps, 1); assert.equal(game.status, 'playing'); assert.equal(knownPath(game, 3), null);
});

test('invalid, flagged and already revealed clicks do not count as exploration', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  for (const target of [-1, 16, 1.5, NaN, '8']) assert.equal(explore(game, target).reason, 'outside');
  assert.equal(explore(game, 12).reason, 'revealed'); toggleFlag(game, 8);
  assert.equal(explore(game, 8).reason, 'flagged'); assert.equal(game.steps, 0); assert.equal(game.position, 12);
});

test('flags are reversible, limited, and unavailable on revealed and exit cells', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  for (const target of [12, 3, -1, 1.5]) assert.equal(toggleFlag(game, target), false);
  assert.equal(toggleFlag(game, 8), true); assert.equal(toggleFlag(game, 13), true);
  assert.equal(toggleFlag(game, 9), false); assert.equal(toggleFlag(game, 8), true); assert.equal(toggleFlag(game, 9), true);
});

test('a flagged safe cell survives flood expansion until explicitly unflagged', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  toggleFlag(game, 4); explore(game, 0);
  assert.equal(game.flags[4], true); assert.equal(game.revealed[4], false);
  toggleFlag(game, 4); assert.equal(explore(game, 4).ok, true);
  assert.equal(game.revealed[4], true); assert.equal(game.position, 12);
});

test('a flagged chokepoint blocks the route until unflagged and revealed', () => {
  const game = createGame(makeBoard(4, 4, [5, 6, 7, 9, 13]));
  toggleFlag(game, 8); for (const i of [4, 0, 1, 2, 3]) explore(game, i);
  assert.equal(game.revealed[3], true); assert.equal(game.status, 'playing');
  assert.equal(knownPath(game, 3), null); assert.equal(reachable(game).has(3), false);
  toggleFlag(game, 8); assert.equal(explore(game, 8).ok, true);
  assert.equal(game.status, 'running'); checkPath(game.board, game.runPath);
});

test('diagonally touching revealed cells do not form a route', () => {
  const game = createGame(makeBoard(4, 4, [1, 2, 4, 7, 8, 11, 13, 14]));
  game.revealed.fill(false); for (const i of [12, 9, 6, 3]) game.revealed[i] = true;
  assert.equal(knownPath(game, 3), null); assert.deepEqual([...reachable(game)], [12]); assert.equal(finishRun(game), false);
});

test('complete route starts running and finishRun alone completes victory', () => {
  const game = createGame(makeBoard(4, 4, [5, 6, 7, 9, 13]));
  for (const i of [3, 2, 1, 0, 4]) explore(game, i);
  assert.equal(game.status, 'playing'); const result = explore(game, 8);
  assert.equal(result.type, 'route'); assert.equal(game.status, 'running');
  assert.equal(game.position, game.board.start); assert.deepEqual(game.trail, [game.board.start]);
  checkPath(game.board, result.path); for (const i of result.path) assert.equal(game.revealed[i], true);
  assert.equal(explore(game, 10).reason, 'finished'); assert.equal(toggleFlag(game, 10), false); assert.equal(getHint(game), null);
  assert.equal(finishRun(game), true); assert.equal(game.status, 'won'); assert.equal(game.position, game.board.goal);
  assert.deepEqual(game.trail, result.path); assert.equal(finishRun(game), false); assert.equal(explore(game, 10).reason, 'finished');
});

test('an initially clear route also enters running and requires finishing the animation', () => {
  const game = createGame(makeBoard(4, 4, []));
  assert.equal(game.status, 'running'); assert.equal(game.position, game.board.start); checkPath(game.board, game.runPath);
  assert.equal(finishRun(game), true); assert.equal(game.status, 'won');
});

test('finishRun rejects incomplete, nonorthogonal, unknown or flagged animation routes', () => {
  const game = createGame(makeBoard(4, 4, [])), valid = [...game.runPath];
  for (const path of [[12, 3], [12, 13], []]) { game.runPath = path; assert.equal(finishRun(game), false); assert.equal(game.position, 12); }
  game.runPath = valid; game.flags[valid[1]] = true; assert.equal(finishRun(game), false);
  game.flags[valid[1]] = false; game.revealed[valid[1]] = false; assert.equal(finishRun(game), false);
});

test('easy mode absorbs one mine, marks it, then loses on a second without moving S', () => {
  const game = createGame(makeBoard(4, 4, [9, 13]));
  assert.equal(game.shields, 1); assert.equal(explore(game, 13).type, 'protected');
  assert.equal(game.flags[13], true); assert.equal(game.revealed[13], false); assert.equal(game.shields, 0); assert.equal(game.rescues, 1);
  assert.equal(game.status, 'playing'); assert.equal(game.position, 12); assert.equal(explore(game, 9).type, 'mine');
  assert.equal(game.status, 'lost'); assert.equal(game.exploded, 9); assert.equal(game.position, 12); assert.deepEqual(game.trail, [12]);
  assert.equal(explore(game, 8).reason, 'finished'); assert.equal(toggleFlag(game, 8), false); assert.equal(getHint(game), null);
});

test('standard mode loses immediately; full incorrect flags cannot disable an easy shield', () => {
  const standard = createGame(makeBoard(4, 4, [9, 13]), 0, { shields: 0 });
  assert.equal(explore(standard, 13).type, 'mine'); assert.equal(standard.status, 'lost'); assert.equal(standard.position, 12);
  const easy = createGame(makeBoard(4, 4, [9, 13])); toggleFlag(easy, 0); toggleFlag(easy, 1);
  assert.equal(explore(easy, 9).type, 'protected'); assert.equal(easy.flags[9], true); assert.equal(easy.shields, 0);
});

test('all 30 boards have a real orthogonal safe route and solve without guesses or shields', () => {
  assert.equal(LEVELS.length, 30);
  for (const level of LEVELS) {
    const board = generateBoard(level.id);
    assert.equal(board.mineCount, level.mineCount); assert.equal(board.mines[board.start], false); assert.equal(board.mines[board.goal], false);
    assert.deepEqual(board, generateBoard(level.id)); const copy = generateBoard(level.id); copy.clues[0] = -99;
    assert.notEqual(generateBoard(level.id).clues[0], -99);
    const queue = [board.start], visited = new Set(queue);
    for (let q = 0; q < queue.length; q++) for (const j of neighbors(board, queue[q], false)) if (!board.mines[j] && !visited.has(j)) { visited.add(j); queue.push(j); }
    assert.equal(visited.has(board.goal), true, `level ${level.id} has no safe route`);
    const game = createGame(board, level.id, { shields: 0 }); assert.equal(game.status, 'playing', `level ${level.id} solved on load`);
    revealByDeductions(game); assert.equal(game.status, 'running', `level ${level.id} failed`); checkPath(board, game.runPath);
    assert.equal(finishRun(game), true); assert.equal(game.position, board.goal); assert.equal(solveBoard(board).solved, true);
  }
});

test('first ten levels have fewer mines and a larger guaranteed opening', () => {
  const previousMineCounts = [8, 9, 10, 8, 9, 12, 13, 14, 12, 13];
  for (let level = 0; level < 10; level++) {
    const board = generateBoard(level), game = createGame(board, level);
    assert.ok(board.mineCount < previousMineCounts[level], `level ${level} mine count`);
    assert.ok(game.revealed.filter(Boolean).length >= (level < 5 ? 28 : 24));
    for (let y = board.rows - 3; y < board.rows; y++) for (let x = 0; x < 3; x++) {
      assert.equal(board.mines[y * board.cols + x], false); assert.equal(game.revealed[y * board.cols + x], true);
    }
  }
});

test('inference ignores hidden mine arrays and incorrect player flags', () => {
  const game = createGame(generateBoard(0)), expected = deduce(game), changed = structuredClone(game);
  changed.board.mines.fill(true); changed.flags = changed.flags.map((_, i) => !changed.revealed[i] && i % 2 === 0);
  assert.deepEqual(deduce(changed), expected);
  const safe = [...expected.safe].find(i => !game.revealed[i] && i !== game.board.goal); assert.notEqual(safe, undefined);
  assert.equal(toggleFlag(game, safe), true); assert.deepEqual(deduce(game), expected);
  assert.equal(getHint(game).type, 'unflag'); assert.equal(getHint(game).index, safe);
});

test('hints are provable, repeatable and free of score penalties', () => {
  for (const level of [0, 7, 15, 29]) {
    const game = createGame(generateBoard(level), level), before = structuredClone(game), hint = getHint(game); assert.ok(hint);
    assert.equal(game.board.mines[hint.index], hint.type === 'mine'); assert.equal(typeof hint.text, 'string');
    assert.deepEqual(getHint(game), hint); assert.deepEqual(game, before);
    game.hints = 100; assert.equal(starsFor(game), 3); game.rescues = 1; assert.equal(starsFor(game), 2);
  }
});

test('playing, running, won and lost saves restore without dropping state', () => {
  const playing = createGame(generateBoard(0)); playing.hints = 2; playing.elapsed = 42; roundtrip(playing, { 0: 3 });
  const running = revealByDeductions(createGame(generateBoard(1), 1)), resumed = roundtrip(running).game;
  assert.equal(resumed.status, 'running'); assert.equal(resumed.position, resumed.board.start); assert.equal(finishRun(resumed), true); roundtrip(resumed);
  const lost = createGame(generateBoard(2), 2, { shields: 0 }); explore(lost, lost.board.mines.findIndex(Boolean));
  assert.equal(lost.status, 'lost'); roundtrip(lost);
});

test('used shield is saved and cannot be reused after reload', () => {
  const game = createGame(generateBoard(3), 3), mines = game.board.mines.flatMap((v, i) => v ? [i] : []);
  explore(game, mines[0]); const restored = roundtrip(game).game; assert.equal(restored.flags[mines[0]], true);
  assert.equal(explore(restored, mines[1]).type, 'mine'); assert.equal(restored.status, 'lost');
});

test('malformed saves are rejected and numeric metadata is sanitized', () => {
  const store = storage(); assert.equal(loadProgress(store), null); store.setItem(SAVE_KEY, '{bad json'); assert.equal(loadProgress(store), null);
  const original = createGame(generateBoard(0)); saveProgress(store, original); const valid = JSON.parse(store.getItem(SAVE_KEY));
  const corruptions = [d => d.version = 99, d => d.level = 30, d => d.level = -1, d => d.revealed.pop(), d => d.flags[0] = 1,
    d => d.position = -1, d => d.status = 'other', d => d.status = 'won', d => d.status = 'running',
    d => d.revealed[original.board.mines.findIndex(Boolean)] = true, d => d.flags[original.position] = true,
    d => d.status = 'lost', d => d.shields = 5, d => d.rescues = 2];
  for (const corrupt of corruptions) { const d = structuredClone(valid); corrupt(d); store.setItem(SAVE_KEY, JSON.stringify(d)); assert.equal(loadProgress(store), null); }
  const d = structuredClone(valid); Object.assign(d, { hints: -2, steps: 1e15, elapsed: 'oops', completed: { 0: 3, 1: 0, 2: 4, 3: 1, 30: 3, bad: 2 } });
  store.setItem(SAVE_KEY, JSON.stringify(d)); const loaded = loadProgress(store); assert.ok(loaded);
  assert.equal(loaded.game.hints, 0); assert.equal(loaded.game.steps, 1e9); assert.equal(loaded.game.elapsed, 0); assert.deepEqual(loaded.completed, { 0: 3, 3: 1 });
});

test('old saves retain completed levels and restart under the new rules', () => {
  const store = storage(); store.setItem('pathfinder-minesweeper-v1', JSON.stringify({ version: 1, level: 5, completed: { 0: 3, 1: 2, 30: 3 }, position: 999 }));
  const loaded = loadProgress(store); assert.equal(loaded.migrated, true); assert.equal(loaded.game.level, 5);
  assert.equal(loaded.game.position, loaded.game.board.start); assert.equal(loaded.game.status, 'playing'); assert.deepEqual(loaded.completed, { 0: 3, 1: 2 });
});

test('storage exceptions fail gracefully', () => {
  const broken = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
  assert.equal(saveProgress(broken, createGame(generateBoard(0))), false); assert.equal(loadProgress(broken), null);
});

test('invalid board sizes, mine positions and level ids reject cleanly', () => {
  for (const args of [[1,4,[]], [4,1,[]], [2.5,4,[]], [4,4,[-1]], [4,4,[16]], [4,4,[12]], [4,4,[3]]]) assert.throws(() => makeBoard(...args));
  for (const level of [-1, 30, 0.5, '0', null]) assert.throws(() => generateBoard(level));
});
