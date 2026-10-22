import { LEVELS, CHAPTERS } from './levels.js';
import { generateBoard, createGame, travel, toggleFlag, getHint, frontier, saveProgress, loadProgress } from './engine.js';

const $ = id => document.getElementById(id);
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const restored = loadProgress(storage);
let game = restored?.game || createGame(generateBoard(0)), completed = restored?.completed || {};
let mode = 'walk', currentHint = null, cells = [], started = game.steps > 0 || game.hints > 0 || game.elapsed > 0 || game.flags.some(Boolean);
let sound = false, audio, lastTick = performance.now(), levelShown = -1;
const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const coord = i => `${String.fromCharCode(65 + i % game.board.cols)}${Math.floor(i / game.board.cols) + 1}`;
const modalOpen = () => Boolean(document.querySelector('dialog[open]'));
function persist() {
  const ok = saveProgress(storage, game, completed);
  $('save-note').innerHTML = ok ? '<span></span> 进度自动保存在此浏览器' : '本次会话可玩 · 浏览器未允许保存进度';
}
function tone(type) {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    const frequencies = type === 'win' ? [440, 554, 659, 880] : type === 'mine' ? [140, 90] : type === 'flag' ? [420, 520] : [600];
    frequencies.forEach((frequency, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + i * .09;
      osc.type = 'sine'; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.045, start + .01); gain.gain.exponentialRampToValueAtTime(.0001, start + .15);
      osc.connect(gain); gain.connect(audio.destination); osc.start(start); osc.stop(start + .17);
    });
  } catch { /* Audio is optional; all feedback is visible as well. */ }
}
function setStatus(text, danger = false) {
  $('status').textContent = text;
  $('status').parentElement.classList.toggle('danger', danger);
}
function setMode(value, announce = true) {
  mode = value;
  $('walk-mode').setAttribute('aria-pressed', String(mode === 'walk'));
  $('flag-mode').setAttribute('aria-pressed', String(mode === 'flag'));
  if (announce && game.status === 'playing') setStatus(mode === 'flag' ? '插旗模式：点击未知格标雷，再点一次撤销。按 F 或点「探路」返回。' : '探路模式：点击边界未知格探索；点击已知安全格自动走过去。');
}
function renderLevels() {
  const markup = CHAPTERS.map(chapter => {
    const levels = LEVELS.filter(l => l.chapter === chapter.id), cleared = levels.filter(l => completed[l.id]).length;
    return `<section class="level-group ${LEVELS[game.level].chapter === chapter.id ? 'current' : ''}"><div class="level-group-label"><span><i>${String(chapter.id + 1).padStart(2, '0')}</i> ${chapter.name}</span><span>${cleared}/5</span></div><div class="level-row">${levels.map(l => `<button class="level-button ${l.id === game.level ? 'current' : ''} ${completed[l.id] ? 'completed' : ''}" data-level="${l.id}" aria-label="第${l.id + 1}关，${l.region}，${l.name}${completed[l.id] ? `，已获${completed[l.id]}星` : '，未完成'}" ${l.id === game.level ? 'aria-current="step"' : ''}>${String(l.id + 1).padStart(2, '0')}${completed[l.id] ? `<span class="mini-star" aria-hidden="true">${'★'.repeat(completed[l.id])}</span>` : ''}</button>`).join('')}</div></section>`;
  }).join('');
  $('level-list').innerHTML = markup; $('dialog-level-list').innerHTML = markup;
  const total = Object.keys(completed).length;
  $('completion').innerHTML = `${total} <small>/ 30</small>`;
  $('progress-fill').style.width = `${total / 30 * 100}%`;
}
function buildBoard() {
  const { board } = game;
  $('map-with-axis').classList.toggle('dense', board.cols >= 9);
  $('pan-note').hidden = board.cols < 9;
  $('board').style.setProperty('--cols', board.cols); $('board').style.setProperty('--rows', board.rows);
  $('axis-top').style.setProperty('--cols', board.cols); $('axis-side').style.setProperty('--rows', board.rows);
  $('axis-top').innerHTML = Array.from({ length: board.cols }, (_, x) => `<span>${String.fromCharCode(65 + x)}</span>`).join('');
  $('axis-side').innerHTML = Array.from({ length: board.rows }, (_, y) => `<span>${y + 1}</span>`).join('');
  $('board').innerHTML = Array.from({ length: board.cols * board.rows }, (_, i) => `<button class="cell" data-cell="${i}" tabindex="${i === game.position ? 0 : -1}"></button>`).join('');
  cells = [...$('board').children];
  $('trail').setAttribute('viewBox', `0 0 ${board.cols * 100} ${board.rows * 100}`);
  levelShown = game.level;
}
function renderBoard() {
  const { board } = game, edge = game.status === 'playing' ? frontier(game) : new Set();
  if (levelShown !== game.level) buildBoard();
  const anyFocus = $('board').contains(document.activeElement);
  $('board').classList.toggle('finished', game.status !== 'playing');
  $('board').setAttribute('aria-label', `第${game.level + 1}关，${board.cols}列${board.rows}行，当前位置${coord(game.position)}。方向键或WASD行走，F切换插旗模式。`);
  const focusIndex = anyFocus ? Number(document.activeElement.dataset.cell) : game.position;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i], open = game.revealed[i], mine = game.status === 'lost' && board.mines[i];
    const classes = ['cell', board.cols >= 10 ? 'compact' : ''];
    if (open) classes.push('open', `n${board.clues[i]}`); else if (!game.flags[i] && !mine && i !== board.goal) classes.push('unknown');
    if (edge.has(i) && !game.flags[i] && i !== board.goal) classes.push('edge');
    if (game.flags[i]) classes.push('flagged');
    if (i === board.start) classes.push('start');
    if (i === board.goal) classes.push('goal');
    if (mine) classes.push('bomb');
    if (i === game.exploded) classes.push('exploded');
    if (game.status === 'lost' && game.flags[i] && !board.mines[i]) classes.push('wrong-flag');
    if (i === game.position && game.status !== 'lost') classes.push('player');
    if (currentHint?.index === i) classes.push('hint-cell');
    cell.className = classes.join(' ');
    let content = mine ? '✳' : game.flags[i] ? '⚑' : i === board.goal ? 'E' : open && board.clues[i] ? String(board.clues[i]) : i === board.start ? 'S' : '';
    if (i === game.position && game.status !== 'lost') content = `${board.clues[i] ? `<small class="under-clue">${board.clues[i]}</small>` : ''}<span class="scout" aria-hidden="true"></span>`;
    cell.innerHTML = content;
    const info = mine ? '地雷' : game.flags[i] ? '已插旗' : open ? `已探索，周围${board.clues[i]}颗雷` : '未知格';
    cell.setAttribute('aria-label', `${coord(i)}，${info}${i === board.goal ? '，终点，保证安全' : ''}${i === board.start ? '，起点' : ''}${i === game.position ? '，你的位置' : ''}${edge.has(i) ? '，可探索' : ''}`);
    cell.tabIndex = i === focusIndex ? 0 : -1;
    cell.setAttribute('aria-disabled', String(game.status !== 'playing'));
  }
  // Only show recent footsteps to keep long routes readable.
  const route = game.trail.slice(-22), bx = board.cols * 100, by = board.rows * 100;
  const points = route.map(i => `${(i % board.cols + .5) * ((bx - 14) / board.cols) + 7},${(Math.floor(i / board.cols) + .5) * ((by - 14) / board.rows) + 7}`).join(' ');
  $('trail').innerHTML = `<polyline points="${points}"/>`;
  if (anyFocus) cells[focusIndex]?.focus({ preventScroll: true });
}
function renderResult() {
  const done = game.status !== 'playing';
  $('result').hidden = !done;
  $('result').classList.toggle('lost', game.status === 'lost');
  $('hint').disabled = done; $('walk-mode').disabled = done; $('flag-mode').disabled = done;
  if (!done) return;
  const won = game.status === 'won', total = Object.keys(completed).length, stars = game.hints === 0 ? 3 : game.hints <= 3 ? 2 : 1;
  $('result-kicker').textContent = won ? (total === 30 ? 'ALL ROUTES COMPLETE' : 'ROUTE COMPLETE') : 'ONE MORE TRY';
  $('result-title').textContent = won ? (total === 30 ? '30 段路，全都被你找到了。' : '这条路，被你找到了。') : '这一步，踩到了小意外。';
  $('result-note').textContent = won ? `${game.steps} 步 · ${formatTime(game.elapsed)} · ${game.hints ? `使用 ${game.hints} 次线索` : '全程独立推理'}。` : `雷区已揭晓。地图不变，带着刚才的发现再走一次。`;
  $('stars').textContent = won ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : '↻';
  $('stars').setAttribute('aria-label', won ? `本关${stars}星` : '可以重试');
  $('result-button').textContent = won ? (game.level === 29 ? '回看全部路线 →' : '下一段路 →') : '再试一次 →';
}
function render() {
  const spec = LEVELS[game.level];
  $('level-label').textContent = `ROUTE ${String(game.level + 1).padStart(2, '0')} / 30`;
  $('level-title').textContent = `${spec.region} · ${spec.name}`;
  $('map-size').textContent = `${spec.cols} × ${spec.rows}`;
  $('map-caption').textContent = game.status === 'won' ? '已抵达 · 你把线索连成了路' : game.status === 'lost' ? '本关结束 · 所有地雷已显示' : '探索中 · 从左下出发，向右上前进';
  $('mine-total').textContent = String(game.board.mineCount).padStart(2, '0');
  $('flag-total').textContent = String(game.flags.filter(Boolean).length).padStart(2, '0');
  $('step-total').textContent = String(game.steps).padStart(2, '0');
  $('time-total').textContent = formatTime(game.elapsed);
  renderBoard(); renderResult();
}
function startLevel(level) {
  if (!LEVELS[level]) return;
  // Close modals before resetting the clock; no stale dialog pauses a fresh run.
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  game = createGame(generateBoard(level), level); started = false; currentHint = null; levelShown = -1;
  lastTick = performance.now(); setMode('walk', false); render(); renderLevels(); persist();
  setStatus(level === 0 ? '起点周围已经展开。数字为 1，表示周围八格中恰好藏着一颗雷。' : LEVELS[level].note);
}
function flag(index) {
  if (game.status !== 'playing') return;
  if (!toggleFlag(game, index)) {
    setStatus(game.revealed[index] ? '已打开的格子不能插旗。' : index === game.board.goal ? '终点保证安全，不需要插旗。' : '旗帜数量已达到本关雷数；可以先撤销其他标记。');
    return;
  }
  started = true; currentHint = null; tone('flag'); render(); persist();
  setStatus(game.flags[index] ? `${coord(index)} 已标记。旗帜是你的判断，探索前记得切回「探路」。` : `已移除 ${coord(index)} 的旗帜。`);
}
function move(index) {
  const result = travel(game, index);
  if (!result.ok) {
    const reasons = { flagged: '这格已插旗。若确认安全，请切换插旗模式撤销标记。', unreachable: '暂时走不到这里。请从虚线边界逐步探索，只能上下左右行走。', outside: '到地图边缘了，试试另一个方向。', same: '你已经在这里了。数字是周围八格的雷数。', finished: '本关已结束。可以重试或选择另一条路线。' };
    setStatus(reasons[result.reason], false); return;
  }
  started = true; currentHint = null; tone(result.type);
  if (game.status === 'won') {
    const stars = game.hints === 0 ? 3 : game.hints <= 3 ? 2 : 1;
    completed[game.level] = Math.max(completed[game.level] || 0, stars); renderLevels();
    setStatus('已安全抵达终点！不必翻开所有格子，这条路就足够了。');
  } else if (game.status === 'lost') setStatus(`${coord(game.position)} 藏着一颗雷。本关结束，可以查看雷区并重试。`, true);
  else setStatus(`抵达 ${coord(game.position)}。${game.board.clues[game.position] ? `周围八格中有 ${game.board.clues[game.position]} 颗雷，比较相邻数字再走下一步。` : '周围没有雷，安全区域已经自动展开。'}`);
  render(); persist();
  cells.forEach((cell, i) => { cell.tabIndex = i === game.position ? 0 : -1; });
  cells[game.position].focus({ preventScroll: true });
  cells[game.position].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (game.status !== 'playing') $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function showDialog(id) {
  if (modalOpen()) return;
  tick(); persist(); $(id).showModal();
}
$('board').addEventListener('click', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || modalOpen()) return;
  const i = Number(cell.dataset.cell);
  mode === 'flag' ? flag(i) : move(i);
});
$('board').addEventListener('contextmenu', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || modalOpen()) return;
  event.preventDefault(); flag(Number(cell.dataset.cell));
});
$('walk-mode').addEventListener('click', () => setMode('walk'));
$('flag-mode').addEventListener('click', () => setMode(mode === 'flag' ? 'walk' : 'flag'));
$('hint').addEventListener('click', () => {
  if (game.status !== 'playing') return;
  const hint = getHint(game);
  if (!hint) { setStatus('先比较虚线边界附近的数字，或检查是否有旗帜挡住了已知安全路线。'); return; }
  if (currentHint?.index !== hint.index || currentHint?.type !== hint.type) game.hints++;
  currentHint = hint; started = true; render(); persist();
  cells[hint.index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  setStatus(`${coord(hint.index)}：${hint.text}`);
});
$('retry').addEventListener('click', () => game.status === 'playing' && started ? showDialog('retry-dialog') : startLevel(game.level));
$('confirm-retry').addEventListener('click', () => startLevel(game.level));
$('result-button').addEventListener('click', () => game.status === 'lost' ? startLevel(game.level) : game.level === 29 ? showDialog('levels-dialog') : startLevel(game.level + 1));
for (const id of ['help-open', 'tip-help']) $(id).addEventListener('click', () => showDialog('help-dialog'));
$('levels-open').addEventListener('click', () => showDialog('levels-dialog'));
$('pause').addEventListener('click', () => showDialog('pause-dialog'));
for (const list of [$('level-list'), $('dialog-level-list')]) list.addEventListener('click', event => {
  const button = event.target.closest('[data-level]');
  if (!button) return;
  const level = Number(button.dataset.level);
  if (level === game.level) { $('levels-dialog').close(); return; }
  startLevel(level);
});
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { lastTick = performance.now(); });
}
$('sound').addEventListener('click', () => {
  sound = !sound; $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', sound ? '关闭音效' : '开启音效');
  $('sound').title = sound ? '关闭音效' : '开启音效';
  $('sound').querySelector('.sound-off').hidden = sound; tone('flag');
});
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (modalOpen()) return;
  const key = event.key.toLowerCase();
  if (key === 'p' || key === 'escape') { event.preventDefault(); showDialog('pause-dialog'); return; }
  if (game.status !== 'playing') return;
  if (key === 'f') { event.preventDefault(); setMode(mode === 'flag' ? 'walk' : 'flag'); return; }
  if (key === 'g') { event.preventDefault(); setMode('walk'); return; }
  const dirs = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
  if (!dirs[key]) return;
  event.preventDefault();
  if (event.repeat) return;
  const selecting = mode === 'flag' || event.shiftKey;
  const selected = selecting && event.target.dataset.cell !== undefined ? Number(event.target.dataset.cell) : game.position;
  const [dx, dy] = dirs[key], x = selected % game.board.cols + dx, y = Math.floor(selected / game.board.cols) + dy;
  if (x < 0 || x >= game.board.cols || y < 0 || y >= game.board.rows) { setStatus('已经到地图边缘了。'); return; }
  const target = y * game.board.cols + x;
  if (selecting) {
    cells.forEach((cell, i) => { cell.tabIndex = i === target ? 0 : -1; });
    cells[target].focus();
    setStatus(`选中 ${coord(target)}。${mode === 'flag' ? '按 Enter / 空格插旗或撤销；F 返回探路。' : '按 Enter / 空格探索，F 切换插旗。'}`);
  } else move(target);
});
function tick() {
  const now = performance.now(), delta = (now - lastTick) / 1000;
  lastTick = now;
  if (started && game.status === 'playing' && !document.hidden && !modalOpen()) game.elapsed += delta;
  $('time-total').textContent = formatTime(game.elapsed);
}
setInterval(tick, 250);
setInterval(() => { if (started && game.status === 'playing') persist(); }, 5000);
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); persist(); });
window.addEventListener('pagehide', persist);
render(); renderLevels(); persist();
if (game.status === 'lost') setStatus('上次在这里踩到了雷。地图已揭晓，可以重试。', true);
else if (game.status === 'won') setStatus('这条路线已经抵达，继续下一段路吧。');
else if (restored) setStatus('已恢复上次的地图与脚步，继续慢慢推理。');
