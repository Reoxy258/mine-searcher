import { makeBoard, createGame, explore, toggleFlag, finishRun } from './engine.js';

export const TUTORIAL_KEY = 'mine-searcher-tutorial-v1';
export function createTutorial() {
  const game = createGame(makeBoard(4, 4, [1, 6]));
  game.revealed.fill(false);
  for (const i of [4, 5, 8, 10, 12, 13, 14]) game.revealed[i] = true;
  Object.assign(game, { status: 'playing', runPath: [], trail: [12], position: 12 });
  return { game, step: 0, hinted: false };
}
export function tutorialAction(state, type, index) {
  const expected = [['reveal', 9], ['flag', 6], ['reveal', 15], ['reveal', 7], ['reveal', 3]];
  if (state.step === 3 && type === 'hint' && !state.hinted) { state.hinted = true; return true; }
  if (state.step === 5 && type === 'finish') {
    if (!finishRun(state.game)) return false;
    state.step = 6; return true;
  }
  const action = expected[state.step];
  if (!action || action[0] !== type || action[1] !== index || (state.step === 3 && !state.hinted)) return false;
  const ok = type === 'flag' ? toggleFlag(state.game, index) : explore(state.game, index).ok;
  if (!ok) return false;
  state.step++; return true;
}
