import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorial, tutorialAction } from '../src/tutorial-model.js';
import { explore, toggleFlag, finishRun, knownPath, localMineHighlights } from '../src/engine.js';

const actions = [['reveal', 9], ['flag', 6], ['reveal', 15], ['hint'], ['reveal', 7], ['reveal', 3], ['finish']];
function advance(state, count) {
  for (const [type, index] of actions.slice(0, count)) assert.equal(tutorialAction(state, type, index), true);
  return state;
}
function rejectWithoutMutation(state, type, index) {
  const before = structuredClone(state);
  assert.equal(tutorialAction(state, type, index), false, `unexpected ${type}(${String(index)}) at step ${before.step}`);
  assert.deepEqual(state, before, 'rejected actions must leave the tutorial unchanged');
}

test('tutorial starts with a separate 4x4 board and genuine visible clue values', () => {
  const state = createTutorial(), { game } = state;
  assert.equal(state.step, 0); assert.equal(state.hinted, false);
  assert.equal(game.board.cols, 4); assert.equal(game.board.rows, 4);
  assert.equal(game.board.start, 12); assert.equal(game.board.goal, 3);
  assert.deepEqual(game.board.mines.flatMap((mine, i) => mine ? [i] : []), [1, 6]);
  assert.deepEqual(game.revealed.flatMap((open, i) => open ? [i] : []), [4, 5, 8, 10, 12, 13, 14]);
  assert.ok(game.flags.every(flag => !flag)); assert.equal(game.status, 'playing');
  assert.equal(game.position, 12); assert.equal(knownPath(game, 3), null);
  assert.equal(game.board.clues[9], 1); assert.equal(game.board.clues[15], 0);
  for (let i = 0; i < 16; i++) {
    let count = 0;
    for (const mine of [1, 6]) if (i !== mine && Math.abs(i % 4 - mine % 4) <= 1 && Math.abs(Math.floor(i / 4) - Math.floor(mine / 4)) <= 1) count++;
    assert.equal(game.board.clues[i], count, `incorrect tutorial clue ${i}`);
  }
});

test('guided reveal, flag and zero expansion use the same real game engine', () => {
  const state = createTutorial();
  for (const [type, index] of actions.slice(0, 3)) {
    const expected = structuredClone(state.game);
    if (type === 'reveal') assert.equal(explore(expected, index).ok, true);
    else assert.equal(toggleFlag(expected, index), true);
    assert.equal(tutorialAction(state, type, index), true);
    assert.deepEqual(state.game, expected);
  }
  assert.equal(state.step, 3);
  assert.equal(state.game.revealed[15], true); assert.equal(state.game.revealed[11], true, 'zero expansion must reveal its numbered boundary');
  assert.equal(state.game.flags[6], true); assert.equal(state.game.revealed[6], false);
  assert.equal(state.game.position, state.game.board.start);
});

test('the first clue proves exactly the mine to flag without relying on the flag itself', () => {
  const state = advance(createTutorial(), 1);
  assert.equal(state.step, 1); assert.ok(localMineHighlights(state.game).has(6));
  const before = structuredClone(state.game.revealed);
  assert.equal(tutorialAction(state, 'flag', 6), true);
  assert.deepEqual(state.game.revealed, before); assert.equal(state.game.flags[6], true);
  assert.ok(localMineHighlights(state.game).has(6));
});

test('hint must be requested before its guided reveal and does not itself open or flag a tile', () => {
  const state = advance(createTutorial(), 3);
  rejectWithoutMutation(state, 'reveal', 7);
  const revealed = [...state.game.revealed], flags = [...state.game.flags], position = state.game.position;
  assert.equal(tutorialAction(state, 'hint'), true); assert.equal(state.hinted, true); assert.equal(state.step, 3);
  assert.deepEqual(state.game.revealed, revealed); assert.deepEqual(state.game.flags, flags); assert.equal(state.game.position, position);
  rejectWithoutMutation(state, 'hint');
  assert.equal(tutorialAction(state, 'reveal', 7), true); assert.equal(state.step, 4);
  assert.equal(state.game.revealed[7], true); assert.equal(state.game.status, 'playing');
});

test('opening the exit triggers the shortest orthogonal run, then finish completes the lesson', () => {
  const state = advance(createTutorial(), 5);
  assert.equal(state.step, 4); assert.equal(knownPath(state.game, 3), null);
  const expected = structuredClone(state.game); assert.equal(explore(expected, 3).type, 'route');
  assert.equal(tutorialAction(state, 'reveal', 3), true); assert.deepEqual(state.game, expected);
  assert.equal(state.step, 5); assert.equal(state.game.status, 'running'); assert.equal(state.game.position, 12);
  const path = state.game.runPath;
  assert.equal(path[0], 12); assert.equal(path.at(-1), 3); assert.equal(path.length - 1, 6, 'opened tutorial region has a six-step minimum route');
  for (let n = 0; n < path.length; n++) {
    const index = path[n];
    assert.equal(state.game.revealed[index], true); assert.equal(state.game.flags[index], false); assert.equal(state.game.board.mines[index], false);
    if (n) assert.equal(Math.abs(index % 4 - path[n - 1] % 4) + Math.abs(Math.floor(index / 4) - Math.floor(path[n - 1] / 4)), 1);
  }
  assert.equal(finishRun(expected), true);
  assert.equal(tutorialAction(state, 'finish'), true); assert.equal(state.step, 6); assert.deepEqual(state.game, expected);
  assert.equal(state.game.position, 3); assert.equal(state.game.status, 'won');
  for (const [type, index] of actions) rejectWithoutMutation(state, type, index);
});

test('wrong cells, wrong action types and actions from another step are safely rejected', () => {
  for (let count = 0; count <= actions.length; count++) {
    const state = advance(createTutorial(), count);
    for (const type of ['', 'walk', 'reset', null, undefined]) rejectWithoutMutation(state, type, 9);
    for (const index of [-1, 16, 1.5, NaN, Infinity, '9', null, undefined]) {
      rejectWithoutMutation(state, 'reveal', index); rejectWithoutMutation(state, 'flag', index);
    }
    const expected = [['reveal', 9], ['flag', 6], ['reveal', 15], ['reveal', 7], ['reveal', 3]][state.step];
    for (let index = 0; index < 16; index++) for (const type of ['reveal', 'flag']) {
      if (expected?.[0] === type && expected?.[1] === index && (state.step !== 3 || state.hinted)) continue;
      rejectWithoutMutation(state, type, index);
    }
    // Hidden mines can never be accidentally revealed by a mistaken tutorial tap.
    for (const mine of [1, 6]) rejectWithoutMutation(state, 'reveal', mine);
    if (state.step !== 0) rejectWithoutMutation(state, 'reveal', 9);
    if (state.step !== 1) rejectWithoutMutation(state, 'flag', 6);
    if (state.step !== 2) rejectWithoutMutation(state, 'reveal', 15);
    if (state.step !== 3) rejectWithoutMutation(state, 'hint');
    if (state.step !== 4) rejectWithoutMutation(state, 'reveal', 3);
    if (state.step !== 5) rejectWithoutMutation(state, 'finish');
  }
});

test('each tutorial instance is independent and replay starts from fresh state', () => {
  const first = createTutorial(), second = createTutorial(), unchanged = structuredClone(second);
  advance(first, actions.length);
  assert.deepEqual(second, unchanged); assert.deepEqual(createTutorial(), unchanged);
  assert.notEqual(first.game, second.game); assert.notEqual(first.game.board, second.game.board);
  assert.equal(second.game.steps, 0); assert.equal(second.game.hints, 0);
});
