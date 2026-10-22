// Pure game rules. Inference only reads revealed clues, never hidden mine values.
import { LEVELS } from './levels.js';
export const SAVE_KEY = 'pathfinder-minesweeper-v1';
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
export function createGame(board, level = 0) {
  const game = { board, level, position: board.start, revealed: Array(board.cols * board.rows).fill(false), flags: Array(board.cols * board.rows).fill(false), trail: [board.start], steps: 0, hints: 0, elapsed: 0, status: 'playing', exploded: -1 };
  flood(game, board.start);
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
// Paths use orthogonal movement only. Flood-fill may expose safe islands across
// a diagonal; those islands are not walkable until an orthogonal link is opened.
export function knownPath(game, target) {
  const { board, flags, revealed, position } = game;
  const queue = [position], parents = new Map([[position, -1]]);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (i === target) {
      const path = [];
      for (let j = i; j !== -1; j = parents.get(j)) path.unshift(j);
      return path;
    }
    for (const j of neighbors(board, i, false)) {
      if (parents.has(j) || flags[j] || (!revealed[j] && j !== target)) continue;
      parents.set(j, i); queue.push(j);
    }
  }
  return null;
}
export function reachable(game) {
  const seen = new Set([game.position]), queue = [game.position];
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
export function travel(game, target) {
  if (game.status !== 'playing') return { ok: false, reason: 'finished' };
  if (!Number.isInteger(target) || target < 0 || target >= game.revealed.length) return { ok: false, reason: 'outside' };
  if (game.flags[target]) return { ok: false, reason: 'flagged' };
  if (target === game.position) return { ok: false, reason: 'same' };
  const path = knownPath(game, target);
  if (!path) return { ok: false, reason: 'unreachable' };
  // Stop at the exit even when it occurs partway through an auto-walk route.
  const exitAt = path.indexOf(game.board.goal);
  const walked = exitAt >= 0 ? path.slice(0, exitAt + 1) : path;
  game.steps += walked.length - 1;
  game.trail.push(...walked.slice(1));
  game.position = walked.at(-1);
  if (game.board.mines[game.position]) {
    game.status = 'lost'; game.exploded = game.position;
    return { ok: true, type: 'mine', path: walked };
  }
  flood(game, game.position);
  if (game.position === game.board.goal) game.status = 'won';
  return { ok: true, type: game.status === 'won' ? 'win' : 'move', path: walked };
}
export function toggleFlag(game, index) {
  if (game.status !== 'playing' || !Number.isInteger(index) || index < 0 || index >= game.flags.length || game.revealed[index] || index === game.board.goal) return false;
  if (!game.flags[index] && game.flags.filter(Boolean).length >= game.board.mineCount) return false;
  game.flags[index] = !game.flags[index];
  return true;
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
  const { safe, mines } = deduce(game), edge = frontier(game);
  // Flags are player hypotheses; they are never treated as proof.
  for (const i of safe) if (game.flags[i]) return { type: 'unflag', index: i, text: '这格可由线索确定安全，请先移除旗帜。' };
  if (knownPath(game, game.board.goal)) return { type: 'safe', index: game.board.goal, text: '已知安全格已经连到终点，可以抵达了。' };
  for (const i of safe) if (edge.has(i) && !game.revealed[i]) return { type: 'safe', index: i, text: '根据已打开的数字，这一格一定安全。点击亮起的格子继续。' };
  for (const i of mines) if (!game.flags[i]) return { type: 'mine', index: i, text: '根据已打开的数字，这一格一定有雷。可以先插旗，再比较周围线索。' };
  // Exposed diagonals can be reached by a known path but never by teleporting.
  for (const i of reachable(game)) if (neighbors(game.board, i, false).includes(game.board.goal)) return { type: 'safe', index: game.board.goal, text: '终点保证安全，最后一步就在眼前。' };
  return null;
}
export function solveBoard(board) {
  const game = createGame(board);
  let deductions = 0;
  for (let turn = 0; turn < board.cols * board.rows; turn++) {
    if (game.revealed[board.goal] && knownPath(game, board.goal)) { travel(game, board.goal); return { solved: true, deductions, game }; }
    const { safe } = deduce(game), edge = frontier(game);
    const next = [...safe].find(i => edge.has(i) && !game.revealed[i]);
    if (next === undefined) return { solved: false, deductions, game };
    travel(game, next); deductions++;
    if (game.status === 'won') return { solved: true, deductions, game };
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
  for (let i = 0; i < cols * rows; i++) if (i !== goal && !(i % cols < 2 && Math.floor(i / cols) >= rows - 2)) candidates.push(i);
  let best = null, bestScore = -1;
  for (let attempt = 0; attempt < 350; attempt++) {
    const bag = [...candidates];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    const board = makeBoard(cols, rows, bag.slice(0, spec.mineCount), start, goal);
    const solution = solveBoard(board);
    if (!solution.solved) continue;
    const opened = createGame(board).revealed.filter(Boolean).length;
    const score = solution.deductions * 3 - opened / 4;
    if (score > bestScore) { best = board; bestScore = score; }
    if (solution.deductions >= Math.min(5 + Math.floor(level / 3), 14) && opened < cols * rows * .60) break;
  }
  if (!best) throw Error(`Could not generate a logically solvable level: ${level}`);
  cache.set(level, best);
  return structuredClone(best);
}
export function saveProgress(storage, game, completed = {}) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, level: game.level, revealed: game.revealed, flags: game.flags, position: game.position, trail: game.trail.slice(-1000), steps: game.steps, hints: game.hints, elapsed: game.elapsed, status: game.status, exploded: game.exploded, completed }));
    return true;
  } catch { return false; }
}
export function loadProgress(storage) {
  try {
    const data = JSON.parse(storage.getItem(SAVE_KEY));
    if (data?.version !== 1 || !Number.isInteger(data.level) || !LEVELS[data.level]) return null;
    const game = createGame(generateBoard(data.level), data.level), size = game.revealed.length;
    if (![data.revealed, data.flags].every(a => Array.isArray(a) && a.length === size && a.every(v => typeof v === 'boolean'))) return null;
    if (!Number.isInteger(data.position) || data.position < 0 || data.position >= size) return null;
    if (data.status === 'lost' ? !game.board.mines[data.position] : !data.revealed[data.position]) return null;
    if (data.revealed.some((v, i) => v && (game.board.mines[i] || data.flags[i]))) return null;
    if (!['playing', 'won', 'lost'].includes(data.status) || (data.status === 'won' && data.position !== game.board.goal)) return null;
    // A lost position is the only allowed unrevealed position.
    Object.assign(game, { revealed: data.revealed, flags: data.flags, position: data.position, status: data.status });
    for (const k of ['steps', 'hints', 'elapsed']) game[k] = Number.isFinite(data[k]) && data[k] >= 0 ? Math.min(data[k], 1e9) : 0;
    game.trail = Array.isArray(data.trail) ? data.trail.filter(i => Number.isInteger(i) && i >= 0 && i < size).slice(-1000) : [data.position];
    game.exploded = data.status === 'lost' && game.board.mines[data.position] ? data.position : -1;
    const completed = {};
    for (const [k, v] of Object.entries(data.completed || {})) if (/^(0|[1-9]\d*)$/.test(k) && LEVELS[Number(k)] && Number.isInteger(v) && v >= 1 && v <= 3) completed[k] = v;
    return { game, completed };
  } catch { return null; }
}
