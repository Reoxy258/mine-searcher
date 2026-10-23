// Pure game rules. Inference only reads revealed clues, never hidden mine values.
import { LEVELS } from './levels.js';
export const SAVE_KEY = 'pathfinder-minesweeper-v2';
export function neighbors(board, index, diagonal = true) {
  const result = [], x = index % board.cols, y = Math.floor(index / board.cols);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || (!diagonal && Math.abs(dx) + Math.abs(dy) !== 1)) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < board.cols && ny >= 0 && ny < board.rows) result.push(ny * board.cols + nx);
  }
  return result;
}
export function makeBoard(cols, rows, mines, start = (rows - 1) * cols, goal = cols - 1) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) throw Error('Invalid board size');
  const size = cols * rows;
  if (![start, goal, ...mines].every(i => Number.isInteger(i) && i >= 0 && i < size) || mines.includes(start) || mines.includes(goal)) throw Error('Invalid mine positions');
  const board = { cols, rows, start, goal, mines: Array(size).fill(false), clues: Array(size).fill(0) };
  for (const i of mines) board.mines[i] = true;
  board.mineCount = board.mines.filter(Boolean).length;
  board.clues = board.mines.map((_, i) => neighbors(board, i).filter(j => board.mines[j]).length);
  return board;
}
export function createGame(board, level = 0, options = {}) {
  const shields = options.shields === 0 ? 0 : 1;
  const game = { board, level, position: board.start, revealed: Array(board.cols * board.rows).fill(false), flags: Array(board.cols * board.rows).fill(false), trail: [board.start], runPath: [], maxShields: shields, shields, rescues: 0, steps: 0, hints: 0, elapsed: 0, status: 'playing', exploded: -1 };
  flood(game, board.start);
  prepareRun(game);
  return game;
}
function flood(game, index) {
  const { board, revealed, flags } = game, pending = [index];
  while (pending.length) {
    const i = pending.pop();
    if (revealed[i] || flags[i] || board.mines[i]) continue;
    revealed[i] = true;
    if (board.clues[i] === 0) pending.push(...neighbors(board, i));
  }
}
// Minimum-step route inside the revealed, unflagged area. Among equally short
// routes prefer fewer turns; clicks never become mandatory waypoints.
export function knownPath(game, target) {
  const { board, flags, revealed } = game;
  if (!revealed[target] || flags[target] || !revealed[board.start] || flags[board.start]) return null;
  if (target === board.start) return [target];
  const queue = [board.start], distance = Array(revealed.length).fill(-1);
  distance[board.start] = 0;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of neighbors(board, i, false)) {
      if (distance[j] !== -1 || flags[j] || !revealed[j]) continue;
      distance[j] = distance[i] + 1; queue.push(j);
    }
  }
  if (distance[target] < 0) return null;
  const turns = Array(revealed.length * 5).fill(Infinity), parents = Array(revealed.length * 5).fill(-1);
  const startState = board.start * 5 + 4;
  turns[startState] = 0;
  for (const i of queue) {
    if (distance[i] >= distance[target]) continue;
    for (let previous = 0; previous < 5; previous++) {
      const state = i * 5 + previous;
      if (!Number.isFinite(turns[state])) continue;
      for (const j of neighbors(board, i, false)) {
        if (distance[j] !== distance[i] + 1) continue;
        const direction = j === i - board.cols ? 0 : j === i + 1 ? 1 : j === i + board.cols ? 2 : 3;
        const next = j * 5 + direction, cost = turns[state] + (previous === 4 || previous === direction ? 0 : 1);
        if (cost < turns[next]) { turns[next] = cost; parents[next] = state; }
      }
    }
  }
  let endState = target * 5;
  for (let direction = 1; direction < 4; direction++) if (turns[target * 5 + direction] < turns[endState]) endState = target * 5 + direction;
  const path = [];
  for (let state = endState; state !== -1; state = parents[state]) path.unshift(Math.floor(state / 5));
  return path;
}
export function reachable(game) {
  const seen = new Set([game.board.start]), queue = [game.board.start];
  for (let q = 0; q < queue.length; q++) for (const j of neighbors(game.board, queue[q], false)) {
    if (!seen.has(j) && game.revealed[j] && !game.flags[j]) { seen.add(j); queue.push(j); }
  }
  return seen;
}
export function frontier(game) {
  const edge = new Set();
  for (const i of reachable(game)) for (const j of neighbors(game.board, i, false)) if (!game.revealed[j]) edge.add(j);
  return edge;
}
function prepareRun(game) {
  const path = knownPath(game, game.board.goal);
  if (game.status === 'playing' && path) {
    game.status = 'running'; game.runPath = path;
    return path;
  }
  return null;
}
export function explore(game, target) {
  if (game.status !== 'playing') return { ok: false, reason: 'finished' };
  if (!Number.isInteger(target) || target < 0 || target >= game.revealed.length) return { ok: false, reason: 'outside' };
  if (game.flags[target]) return { ok: false, reason: 'flagged' };
  if (game.revealed[target]) return { ok: false, reason: 'revealed' };
  game.steps++;
  if (game.board.mines[target]) {
    if (game.shields > 0) {
      game.shields--; game.rescues++; game.flags[target] = true;
      return { ok: true, type: 'protected', index: target };
    }
    game.status = 'lost'; game.exploded = target;
    return { ok: true, type: 'mine', index: target };
  }
  flood(game, target);
  const path = prepareRun(game);
  return { ok: true, type: path ? 'route' : 'reveal', index: target, path };
}
export function finishRun(game) {
  if (game.status !== 'running') return false;
  const path = game.runPath;
  if (!Array.isArray(path) || path[0] !== game.board.start || path.at(-1) !== game.board.goal) return false;
  if (path.some((i, n) => !game.revealed[i] || game.flags[i] || (n > 0 && !neighbors(game.board, path[n - 1], false).includes(i)))) return false;
  game.position = game.board.goal; game.trail = [...path]; game.status = 'won';
  return true;
}
export function starsFor(game) { return game.rescues > 0 ? 2 : 3; }
export function toggleFlag(game, index) {
  if (game.status !== 'playing' || !Number.isInteger(index) || index < 0 || index >= game.flags.length || game.revealed[index] || index === game.board.goal) return false;
  if (!game.flags[index] && game.flags.filter(Boolean).length >= game.board.mineCount) return false;
  game.flags[index] = !game.flags[index];
  return true;
}
// Passive assistance is deliberately local: compare the original digit with
// all unopened neighbors, including flags. Never chain deductions or subtract flags.
export function localMineHighlights(game) {
  const { board, revealed } = game, mines = new Set();
  for (let i = 0; i < revealed.length; i++) {
    if (!revealed[i] || board.clues[i] <= 0) continue;
    const unopened = neighbors(board, i).filter(j => !revealed[j]);
    if (unopened.length === board.clues[i]) for (const j of unopened) mines.add(j);
  }
  return mines;
}
function subset(a, b) { return a.every(i => b.includes(i)); }
export function deduce(game) {
  const { board, revealed } = game, safe = new Set([board.start, board.goal]), mines = new Set();
  let rounds = 0, changed = true;
  while (changed && rounds++ < 50) {
    changed = false;
    const constraints = [];
    for (let i = 0; i < revealed.length; i++) {
      if (!revealed[i]) continue;
      const around = neighbors(board, i), cells = around.filter(j => !revealed[j] && !safe.has(j) && !mines.has(j));
      const count = board.clues[i] - around.filter(j => mines.has(j)).length;
      if (cells.length) constraints.push({ cells, count, clue: i });
    }
    const learn = (cells, count) => {
      if (count !== 0 && count !== cells.length) return;
      const dest = count === 0 ? safe : mines;
      for (const i of cells) if (!dest.has(i)) { dest.add(i); changed = true; }
    };
    for (const c of constraints) learn(c.cells, c.count);
    for (let a = 0; a < constraints.length; a++) for (let b = 0; b < constraints.length; b++) {
      if (a === b) continue;
      const ca = constraints[a], cb = constraints[b];
      if (ca.cells.length >= cb.cells.length || !subset(ca.cells, cb.cells)) continue;
      learn(cb.cells.filter(i => !ca.cells.includes(i)), cb.count - ca.count);
    }
  }
  for (let i = 0; i < revealed.length; i++) if (revealed[i]) safe.add(i);
  return { safe, mines };
}
export function getHint(game) {
  if (game.status !== 'playing') return null;
  const { safe } = deduce(game), mines = localMineHighlights(game), edge = frontier(game);
  // Flags are player hypotheses; they are never treated as proof.
  for (const i of safe) if (game.flags[i]) return { type: 'unflag', index: i, text: '这格可由线索确定安全，请先移除旗帜。' };
  for (const i of safe) if (edge.has(i) && !game.revealed[i]) return { type: 'safe', index: i, text: '根据已打开的数字，这一格一定安全。小狗会等在起点，先把道路探出来。' };
  for (const i of safe) if (!game.revealed[i]) return { type: 'safe', index: i, text: i === game.board.goal ? '终点保证安全，可以先打开，借用附近的数字。' : '这格可由已打开的数字证明安全，可以直接探索。' };
  for (const i of mines) if (!game.flags[i]) return { type: 'mine', index: i, text: '根据已打开的数字，这一格一定有雷。可以先插旗，再比较周围线索。' };
  return null;
}
export function solveBoard(board) {
  const game = createGame(board);
  let deductions = 0;
  for (let turn = 0; turn < board.cols * board.rows; turn++) {
    if (game.status === 'running') { finishRun(game); return { solved: true, deductions, game }; }
    const { safe } = deduce(game), edge = frontier(game);
    const next = [...safe].find(i => edge.has(i) && !game.revealed[i]);
    if (next === undefined) return { solved: false, deductions, game };
    explore(game, next); deductions++;
    if (game.status === 'running') { finishRun(game); return { solved: true, deductions, game }; }
  }
  return { solved: false, deductions, game };
}
function random(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const cache = new Map();
export function generateBoard(level = 0) {
  if (!Number.isInteger(level) || !LEVELS[level]) throw Error('Invalid level');
  if (cache.has(level)) return structuredClone(cache.get(level));
  const spec = LEVELS[level], { cols, rows } = spec, start = (rows - 1) * cols, goal = cols - 1;
  const rng = random(spec.seed), candidates = [];
  // The start and its surrounding cells are safe; the exit is safe too.
  const opening = level < 10 ? 3 : 2;
  for (let i = 0; i < cols * rows; i++) if (i !== goal && !(i % cols < opening && Math.floor(i / cols) >= rows - opening)) candidates.push(i);
  let best = null, bestScore = -Infinity;
  for (let attempt = 0; attempt < 350; attempt++) {
    const bag = [...candidates];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    const board = makeBoard(cols, rows, bag.slice(0, spec.mineCount), start, goal);
    const initial = createGame(board);
    if (initial.status === 'running') continue;
    const opened = initial.revealed.filter(Boolean).length;
    if (level < 10 && opened < (level < 5 ? 28 : 24)) continue;
    const solution = solveBoard(board);
    if (!solution.solved) continue;
    const score = level < 10 ? opened / 4 - solution.deductions : solution.deductions * 2 - opened / 4;
    if (score > bestScore) { best = board; bestScore = score; }
    if (level < 10 ? solution.deductions >= 2 && solution.deductions <= 10 && opened < cols * rows * .78 : solution.deductions >= 5 && opened < cols * rows * .65) break;
  }
  if (!best) throw Error(`Could not generate a logically solvable level: ${level}`);
  cache.set(level, best);
  return structuredClone(best);
}
export function saveProgress(storage, game, completed = {}) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 2, level: game.level, revealed: game.revealed, flags: game.flags, position: game.position, steps: game.steps, hints: game.hints, elapsed: game.elapsed, status: game.status, exploded: game.exploded, maxShields: game.maxShields, shields: game.shields, rescues: game.rescues, completed }));
    return true;
  } catch { return false; }
}
export function loadProgress(storage) {
  try {
    const current = storage.getItem(SAVE_KEY);
    const data = JSON.parse(current || storage.getItem('pathfinder-minesweeper-v1'));
    if (![1, 2].includes(data?.version) || !Number.isInteger(data.level) || !LEVELS[data.level]) return null;
    const completed = {};
    for (const [k, v] of Object.entries(data.completed || {})) if (/^(0|[1-9]\d*)$/.test(k) && LEVELS[Number(k)] && Number.isInteger(v) && v >= 1 && v <= 3) completed[k] = v;
    if (data.version === 1 && !current) return { game: createGame(generateBoard(data.level), data.level), completed, migrated: true };
    if (data.version !== 2 || ![0, 1].includes(data.maxShields) || ![0, 1].includes(data.shields) || ![0, 1].includes(data.rescues) || data.shields + data.rescues !== data.maxShields) return null;
    const game = createGame(generateBoard(data.level), data.level, { shields: data.maxShields }), size = game.revealed.length;
    if (![data.revealed, data.flags].every(a => Array.isArray(a) && a.length === size && a.every(v => typeof v === 'boolean'))) return null;
    if (!Number.isInteger(data.position) || data.position < 0 || data.position >= size) return null;
    if (data.position !== (data.status === 'won' ? game.board.goal : game.board.start)) return null;
    if (data.revealed.some((v, i) => v && (game.board.mines[i] || data.flags[i]))) return null;
    if (!['playing', 'running', 'won', 'lost'].includes(data.status)) return null;
    if (data.status === 'lost' && (!Number.isInteger(data.exploded) || !game.board.mines[data.exploded] || data.shields !== 0)) return null;
    if (!data.revealed[game.board.start]) return null;
    Object.assign(game, { revealed: data.revealed, flags: data.flags, position: data.position, status: data.status, maxShields: data.maxShields, shields: data.shields, rescues: data.rescues });
    const route = knownPath(game, game.board.goal);
    if (['running', 'won'].includes(game.status) && !route) return null;
    if (game.status === 'playing' && route) game.status = 'running';
    game.runPath = route || []; game.trail = game.status === 'won' ? [...route] : [game.board.start];
    for (const k of ['steps', 'hints', 'elapsed']) game[k] = Number.isFinite(data[k]) && data[k] >= 0 ? Math.min(data[k], 1e9) : 0;
    game.exploded = data.status === 'lost' ? data.exploded : -1;
    return { game, completed };
  } catch { return null; }
}
