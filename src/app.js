import { LEVELS, CHAPTERS } from './levels.js';
import { generateBoard, createGame, explore, finishRun, starsFor, toggleFlag, getHint, localMineHighlights, frontier, saveProgress, loadProgress } from './engine.js';
import { DOG_SVG, MEAT_SVG, centerFromRects, interpolatePoint } from './visuals.js';
import { setupTutorial } from './tutorial.js';
const $ = id => document.getElementById(id);
$('runner').innerHTML = `<span class="dog-avatar">${DOG_SVG}</span>`;
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const restored = loadProgress(storage);
let game = restored?.game || createGame(generateBoard(0)), completed = restored?.completed || {};
let mode = 'walk', currentHint = null, cells = [], selectedIndex = game.board.start;
let started = game.steps > 0 || game.hints > 0 || game.elapsed > 0 || game.flags.some(Boolean);
let sound = false, audio, lastTick = performance.now(), levelShown = -1;
let animationToken = 0, animationFrame = 0, runProgress = 0, lastRunTick = 0;
const formatTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const coord = i => `${String.fromCharCode(65 + i % game.board.cols)}${Math.floor(i / game.board.cols) + 1}`;
const modalOpen = () => Boolean(document.querySelector('dialog[open]'));
function persist() {
  const ok = saveProgress(storage, game, completed);
  $('save-note').innerHTML = ok ? '<span></span> 进度自动保存在此浏览器' : '本次会话可玩 · 浏览器未允许保存进度';
}
function tone(type) {
  if (!sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume();
    const notes = type === 'win' ? [440, 554, 659, 880] : type === 'mine' ? [140, 90] : type === 'protected' ? [330, 440] : [600];
    notes.forEach((frequency, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + i * .09;
      osc.frequency.value = frequency; gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime(.04, t + .01); gain.gain.exponentialRampToValueAtTime(.0001, t + .15);
      osc.connect(gain); gain.connect(audio.destination); osc.start(t); osc.stop(t + .17);
    });
  } catch { /* Sound is optional. */ }
}
function setStatus(text, danger = false) {
  $('status').textContent = text; $('status').parentElement.classList.toggle('danger', danger);
}
function setMode(value, announce = true) {
  mode = value;
  $('walk-mode').setAttribute('aria-pressed', String(mode === 'walk'));
  $('flag-mode').setAttribute('aria-pressed', String(mode === 'flag'));
  if (announce && game.status === 'playing') setStatus(mode === 'flag' ? '插旗模式：点击未知格标记或撤销。F 返回探雷。小狗仍留在 S。' : '探雷模式：点击任意未知格。小狗在 S 等待，道路连通后才出发。');
}
function renderLevels() {
  const markup = CHAPTERS.map(chapter => {
    const levels = LEVELS.filter(l => l.chapter === chapter.id), cleared = levels.filter(l => completed[l.id]).length;
    return `<section class="level-group ${LEVELS[game.level].chapter === chapter.id ? 'current' : ''}"><div class="level-group-label"><span><i>${String(chapter.id + 1).padStart(2, '0')}</i> ${chapter.name}</span><span>${cleared}/5</span></div><div class="level-row">${levels.map(l => `<button class="level-button ${l.id === game.level ? 'current' : ''} ${completed[l.id] ? 'completed' : ''}" data-level="${l.id}" aria-label="第${l.id + 1}关，${l.region}，${l.name}${completed[l.id] ? `，已获${completed[l.id]}星` : '，未完成'}" ${l.id === game.level ? 'aria-current="step"' : ''}>${String(l.id + 1).padStart(2, '0')}${completed[l.id] ? `<span class="mini-star" aria-hidden="true">${'★'.repeat(completed[l.id])}</span>` : ''}</button>`).join('')}</div></section>`;
  }).join('');
  $('level-list').innerHTML = markup; $('dialog-level-list').innerHTML = markup;
  const total = Object.keys(completed).length;
  $('completion').innerHTML = `${total} <small>/ 30</small>`; $('progress-fill').style.width = `${total / 30 * 100}%`;
}
function buildBoard() {
  const { board } = game;
  $('map-with-axis').classList.toggle('dense', board.cols >= 9); $('pan-note').hidden = board.cols < 9;
  $('board').style.setProperty('--cols', board.cols); $('board').style.setProperty('--rows', board.rows);
  $('axis-top').style.setProperty('--cols', board.cols); $('axis-side').style.setProperty('--rows', board.rows);
  $('axis-top').innerHTML = Array.from({ length: board.cols }, (_, x) => `<span>${String.fromCharCode(65 + x)}</span>`).join('');
  $('axis-side').innerHTML = Array.from({ length: board.rows }, (_, y) => `<span>${y + 1}</span>`).join('');
  $('board').innerHTML = Array.from({ length: board.cols * board.rows }, (_, i) => `<button class="cell" data-cell="${i}" tabindex="${i === selectedIndex ? 0 : -1}"></button>`).join('');
  cells = [...$('board').children]; levelShown = game.level;
}
function centerOf(index) {
  return centerFromRects(cells[index].getBoundingClientRect(), $('board-wrap').getBoundingClientRect());
}
function placeRunner(from, to = from, fraction = 0) {
  if (!cells[from] || !cells[to]) return;
  const a = centerOf(from), b = centerOf(to), { x, y } = interpolatePoint(a, b, fraction);
  const runner = $('runner');
  runner.style.left = `${x}px`; runner.style.top = `${y}px`; runner.style.width = `${a.size}px`; runner.style.height = `${a.size}px`;
  runner.dataset.cell = String(fraction < .5 ? from : to);
  if (b.x !== a.x) runner.dataset.facing = b.x > a.x ? 'right' : 'left';
  if (game.status === 'running') {
    const view = $('map-scroll'), axisWidth = $('axis-side').offsetWidth + 2;
    view.scrollLeft = Math.max(0, x + axisWidth - view.clientWidth / 2);
    view.scrollTop = Math.max(0, y + 20 - view.clientHeight / 2);
  }
}
function renderBoard() {
  if (levelShown !== game.level) buildBoard();
  const { board } = game, edge = game.status === 'playing' ? frontier(game) : new Set();
  const certainMines = game.status !== 'lost' ? localMineHighlights(game) : new Set();
  $('board').classList.toggle('finished', game.status !== 'playing');
  $('board').setAttribute('aria-label', `第${game.level + 1}关。小狗${game.status === 'running' ? '正在沿安全道路跑向终点' : game.status === 'won' ? '已抵达终点' : '在起点S等待'}。方向键选格，Enter探雷，F切换插旗。`);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i], open = game.revealed[i], mine = game.status === 'lost' && board.mines[i];
    cell.className = ['cell', board.cols >= 10 ? 'compact' : '', open ? `open n${board.clues[i]}` : !game.flags[i] && !mine && i !== board.goal ? 'unknown' : '', edge.has(i) && !game.flags[i] && i !== board.goal ? 'edge' : '', game.flags[i] ? 'flagged' : '', i === board.start ? 'start' : '', i === board.goal ? 'goal' : '', mine ? 'bomb' : '', i === game.exploded ? 'exploded' : '', game.status === 'lost' && game.flags[i] && !board.mines[i] ? 'wrong-flag' : '', i === game.position ? 'player' : '', currentHint?.index === i ? 'hint-cell' : ''].join(' ');
    cell.classList.toggle('deduced-mine', certainMines.has(i));
    cell.textContent = mine ? '✳' : game.flags[i] ? '⚑' : i === board.goal ? 'E' : i === board.start ? 'S' : open && board.clues[i] ? String(board.clues[i]) : certainMines.has(i) ? '✳' : '';
    if (i === board.goal) cell.innerHTML = `${MEAT_SVG}${open && board.clues[i] ? `<strong class="goal-clue">${board.clues[i]}</strong>` : ''}<small class="endpoint-label" aria-hidden="true">E</small>`;
    const info = mine ? '地雷' : certainMines.has(i) ? `${game.flags[i] ? '已插旗，' : ''}由已打开数字确定有雷，请插旗` : game.flags[i] ? '已插旗，尚未由数字确认' : open ? `已探索，周围${board.clues[i]}颗雷` : '未知格';
    cell.setAttribute('aria-label', `${coord(i)}，${info}${i === board.goal ? '，带骨肉终点，保证安全' : ''}${i === board.start ? '，起点' : ''}${i === game.position && game.status !== 'running' ? '，小狗位置' : ''}`);
    cell.tabIndex = i === selectedIndex ? 0 : -1; cell.setAttribute('aria-disabled', String(game.status !== 'playing'));
  }
  $('runner').classList.toggle('running', game.status === 'running');
  $('deduction-summary').textContent = certainMines.size ? `周围未打开格数等于数字：${certainMines.size} 格红色提示（不会自动插旗）。` : '仅当某个数字周围未打开格数等于该数字时，才显示红色提示。';
  if (game.status !== 'running') placeRunner(game.position);
}
function renderResult() {
  const done = game.status === 'won' || game.status === 'lost';
  $('result').hidden = !done; $('result').classList.toggle('lost', game.status === 'lost');
  $('hint').disabled = game.status !== 'playing'; $('walk-mode').disabled = game.status !== 'playing'; $('flag-mode').disabled = game.status !== 'playing';
  if (!done) return;
  const won = game.status === 'won', total = Object.keys(completed).length, stars = starsFor(game);
  $('result-kicker').textContent = won ? total === 30 ? 'ALL ROUTES COMPLETE' : 'ROUTE COMPLETE' : 'ONE MORE TRY';
  $('result-title').textContent = won ? total === 30 ? '30 段路，全都被你找到了。' : '路已探明，顺利抵达。' : '这格藏着一颗雷。';
  $('result-note').textContent = won ? `${game.steps} 次探雷 · 路线 ${game.runPath.length - 1} 格 · ${formatTime(game.elapsed)}。${game.rescues ? '使用 1 次保护，获得 2 星。' : '获得 3 星，线索不扣星。'}` : '小狗仍在起点。地图已揭晓，可重试或切换轻松模式。';
  $('stars').textContent = won ? `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}` : '↻'; $('stars').setAttribute('aria-label', won ? `本关${stars}星` : '可以重试');
  $('result-button').textContent = won ? game.level === 29 ? '回看全部路线 →' : '下一段路 →' : '再试一次 →';
}
function render() {
  const spec = LEVELS[game.level];
  $('level-label').textContent = `ROUTE ${String(game.level + 1).padStart(2, '0')} / 30`; $('level-title').textContent = `${spec.region} · ${spec.name}`;
  $('map-size').textContent = `${spec.cols} × ${spec.rows}`;
  $('map-caption').textContent = game.status === 'running' ? `道路已连通 · 最短路线 ${game.runPath.length - 1} 格`  : game.status === 'won' ? '已抵达 · 你把线索连成了路' : game.status === 'lost' ? '本关结束 · 所有地雷已显示' : '小狗在 S 等待 · 先探出一条安全道路';
  $('mine-total').textContent = String(game.board.mineCount).padStart(2, '0'); $('flag-total').textContent = String(game.flags.filter(Boolean).length).padStart(2, '0');
  $('step-total').textContent = String(game.steps).padStart(2, '0'); $('time-total').textContent = formatTime(game.elapsed);
  $('difficulty').textContent = game.maxShields ? `轻松 · 保护 ${game.shields}/1` : '标准 · 无保护';
  $('difficulty').setAttribute('aria-label', `${game.maxShields ? `轻松模式，剩余${game.shields}次保护` : '标准模式，无触雷保护'}，点击切换难度`);
  renderBoard(); renderResult();
}
function cancelAnimation() {
  animationToken++; cancelAnimationFrame(animationFrame); $('map-scroll').classList.remove('is-running'); $('runner').classList.remove('running');
}
function startRunAnimation() {
  cancelAnimation();
  const currentGame = game, token = animationToken, path = [...game.runPath];
  if (game.status !== 'running' || path.length < 2) return;
  $('map-scroll').classList.add('is-running'); $('runner').classList.add('running');
  runProgress = 0; lastRunTick = performance.now(); placeRunner(path[0]);
  $('map-scroll').scrollIntoView({ block: 'start', behavior: 'smooth' });
  setStatus('安全道路已完整连通！小狗沿已打开安全区域内的最短路线跑向带骨肉。');
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 900 : Math.max(2200, Math.min(7500, (path.length - 1) * 210));
  function frame(now) {
    if (token !== animationToken || game !== currentGame || game.status !== 'running') return;
    const delta = now - lastRunTick; lastRunTick = now;
    if (!document.hidden && !modalOpen()) runProgress = Math.min(1, runProgress + delta / duration);
    const distance = runProgress * (path.length - 1), segment = Math.min(path.length - 2, Math.floor(distance));
    placeRunner(path[segment], path[segment + 1], distance - segment);
    if (runProgress < 1) { animationFrame = requestAnimationFrame(frame); return; }
    if (!finishRun(currentGame)) return;
    cancelAnimation(); tone('win'); completed[game.level] = Math.max(completed[game.level] || 0, starsFor(game));
    render(); renderLevels(); persist(); setStatus('已安全抵达终点！只要探通一条路，就能过关。');
    $('result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  animationFrame = requestAnimationFrame(frame);
}
function startLevel(level, shields = game.maxShields) {
  if (!LEVELS[level]) return;
  cancelAnimation(); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  game = createGame(generateBoard(level), level, { shields }); selectedIndex = game.board.start; started = false; currentHint = null; levelShown = -1;
  lastTick = performance.now(); setMode('walk', false); render(); renderLevels(); persist();
  $('map-scroll').scrollLeft = 0; $('map-scroll').scrollTop = 0;
  setStatus('每关至少有一条可行道路。先探雷，小狗在起点等候；安全格四向连通 S 和 E 后自动出发。');
  if (game.status === 'running') startRunAnimation();
}
function selectCell(index, focus = false) {
  selectedIndex = index; cells.forEach((c, i) => { c.tabIndex = i === index ? 0 : -1; });
  if (focus) cells[index].focus();
}
function flag(index) {
  if (game.status !== 'playing') return;
  if (!toggleFlag(game, index)) { setStatus(game.revealed[index] ? '已打开的安全格不能插旗。' : index === game.board.goal ? '终点保证安全，不需要插旗。' : '标记数达到雷数，请先检查并撤销不确定的旗帜。'); return; }
  started = true; currentHint = null; tone('flag'); render(); persist();
  setStatus(game.flags[index] ? `${coord(index)} 已标记。小狗仍在 S，旗帜只是判断，可随时撤销。` : `已移除 ${coord(index)} 的旗帜。`);
}
function reveal(index) {
  const result = explore(game, index);
  if (!result.ok) { setStatus(({ flagged: '这格已插旗，确认安全后先撤旗再探索。', revealed: '这里已经打开。继续探索未知格，小狗仍在起点等你。', finished: '正在跑向终点或本关已结束；可重试或换一关。', outside: '这里不在地图内。' })[result.reason]); return; }
  started = true; currentHint = null; tone(result.type); render(); persist();
  if (result.type === 'route') { startRunAnimation(); return; }
  if (result.type === 'protected') setStatus(`${coord(index)} 有雷，保护已生效并自动插旗！小狗没有移动，剩余保护 ${game.shields} 次。`, true);
  else if (result.type === 'mine') { setStatus(`${coord(index)} 有雷，本关结束。小狗仍在起点。`, true); $('result').scrollIntoView({ block: 'nearest' }); }
  else setStatus(`${coord(index)} 已打开，周围八格有 ${game.board.clues[index]} 颗雷。小狗在 S 等待，道路连通后才跑向终点。`);
}
function tick() {
  const now = performance.now(), delta = (now - lastTick) / 1000; lastTick = now;
  if (started && game.status === 'playing' && !document.hidden && !modalOpen()) game.elapsed += delta;
  $('time-total').textContent = formatTime(game.elapsed);
}
function showDialog(id) { if (!modalOpen()) { tick(); persist(); $(id).showModal(); } }
$('board').addEventListener('click', e => { const cell = e.target.closest('[data-cell]'); if (!cell || modalOpen()) return; const i = Number(cell.dataset.cell); selectCell(i); mode === 'flag' ? flag(i) : reveal(i); });
$('board').addEventListener('contextmenu', e => { const cell = e.target.closest('[data-cell]'); if (!cell || modalOpen()) return; e.preventDefault(); selectCell(Number(cell.dataset.cell)); flag(selectedIndex); });
$('walk-mode').addEventListener('click', () => setMode('walk'));
$('flag-mode').addEventListener('click', () => setMode(mode === 'flag' ? 'walk' : 'flag'));
$('hint').addEventListener('click', () => {
  if (game.status !== 'playing') return;
  const hint = getHint(game); if (!hint) { setStatus('比较相邻数字，或检查是否有误插的旗帜挡住安全格。'); return; }
  if (currentHint?.index !== hint.index || currentHint?.type !== hint.type) game.hints++;
  currentHint = hint; started = true; render(); persist(); cells[hint.index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  setStatus(`${coord(hint.index)}：${hint.text}（免费，不扣星）`);
});
$('retry').addEventListener('click', () => (game.status === 'playing' && started) || game.status === 'running' ? showDialog('retry-dialog') : startLevel(game.level));
$('confirm-retry').addEventListener('click', () => startLevel(game.level));
$('difficulty').addEventListener('click', () => {
  $('difficulty-title').textContent = game.maxShields ? '切换为标准模式？' : '切换为轻松模式？';
  $('difficulty-note').textContent = game.maxShields ? '标准模式无触雷保护。切换会重开本关，已获得的星星保留。' : '轻松模式每关提供 1 次触雷保护，自动标雷并继续。切换会重开本关，已获得的星星保留。';
  showDialog('difficulty-dialog');
});
$('confirm-difficulty').addEventListener('click', () => startLevel(game.level, game.maxShields ? 0 : 1));
$('result-button').addEventListener('click', () => game.status === 'lost' ? startLevel(game.level) : game.level === 29 ? showDialog('levels-dialog') : startLevel(game.level + 1));
for (const id of ['help-open', 'tip-help']) $(id).addEventListener('click', () => showDialog('help-dialog'));
$('levels-open').addEventListener('click', () => showDialog('levels-dialog')); $('pause').addEventListener('click', () => showDialog('pause-dialog'));
for (const id of ['level-list', 'dialog-level-list']) $(id).addEventListener('click', e => { const b = e.target.closest('[data-level]'); if (!b) return; const level = Number(b.dataset.level); if (level === game.level) { $('levels-dialog').close(); return; } startLevel(level); });
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { lastTick = performance.now(); lastRunTick = performance.now(); });
}
$('sound').addEventListener('click', () => { sound = !sound; $('sound').setAttribute('aria-pressed', String(sound)); $('sound').setAttribute('aria-label', sound ? '关闭音效' : '开启音效'); $('sound').title = sound ? '关闭音效' : '开启音效'; $('sound').querySelector('.sound-off').hidden = sound; tone('flag'); });
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || modalOpen()) return;
  const key = e.key.toLowerCase();
  if (key === 'p' || key === 'escape') { e.preventDefault(); showDialog('pause-dialog'); return; }
  if (game.status !== 'playing') return;
  if (key === 'f') { e.preventDefault(); setMode(mode === 'flag' ? 'walk' : 'flag'); return; }
  if (key === 'g') { e.preventDefault(); setMode('walk'); return; }
  const dirs = { arrowup: [0,-1], w: [0,-1], arrowdown: [0,1], s: [0,1], arrowleft: [-1,0], a: [-1,0], arrowright: [1,0], d: [1,0] };
  if (!dirs[key]) return;
  e.preventDefault(); const [dx,dy] = dirs[key], x = selectedIndex % game.board.cols + dx, y = Math.floor(selectedIndex / game.board.cols) + dy;
  if (x < 0 || y < 0 || x >= game.board.cols || y >= game.board.rows) return;
  selectCell(y * game.board.cols + x, true); setStatus(`选中 ${coord(selectedIndex)}。Enter / 空格${mode === 'flag' ? '插旗或撤销' : '探雷'}，小狗保持不动。`);
});
setInterval(tick, 250); setInterval(() => { if (started && game.status === 'playing') persist(); }, 5000);
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); lastRunTick = performance.now(); persist(); });
window.addEventListener('pagehide', persist);
new ResizeObserver(() => { if (cells.length) { if (game.status !== 'running') placeRunner(game.position); } }).observe($('board'));
render(); renderLevels(); persist();
if (game.status === 'running') startRunAnimation();
else if (game.status === 'lost') setStatus('上次触雷后已结束。小狗仍在起点，可以重试或切换轻松模式。', true);
else if (game.status === 'won') setStatus('已完成这条路线，继续下一关吧。');
else if (restored?.migrated) setStatus('已保留旧版星级。新规则已生效，本关重新开始：先探通道路，小狗再跑向终点。');
else setStatus('每关至少有一条可行道路。先探雷，小狗在 S 等待；安全格四向连通 S 和 E 后自动出发。');
setupTutorial(storage);
