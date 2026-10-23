import { createTutorial, tutorialAction, TUTORIAL_KEY } from './tutorial-model.js';
import { localMineHighlights } from './engine.js';
import { DOG_SVG, MEAT_SVG, centerFromRects, interpolatePoint } from './visuals.js';

export function setupTutorial(storage) {
  const byId = id => document.getElementById(id);
  const dialog = byId('tutorial-dialog'), grid = byId('tutorial-board'), dog = byId('tutorial-dog');
  const descriptions = [
    ['点一下，看懂数字', '点击闪动的格子。数字表示周围 8 格（含斜角）的雷数，不是到雷的距离。', 'reveal', 9],
    ['剩一格，就能确定雷', '刚才的 1 周围只剩一个未打开格，所以它有雷。先点「插旗」，再点红色格。旗帜只是标记，不会开格。', 'flag', 6],
    ['空白会自动展开', '切回「探雷」，点击右下角的安全格。没有数字就是周围 0 颗雷，相连的空白会自动打开。小狗一直在 S 等待。', 'reveal', 15],
    ['拿不准，就用线索', '点击「免费线索」，再点提示的安全格。线索不限次数、不扣星；不用猜雷。', 'reveal', 7],
    ['探通道路，小狗才出发', '点击带骨肉的 E。终点保证安全；已打开格按上下左右连通 S → E 后，小狗才按最短路线跑过去。斜角不连通，不必扫完整张图。', 'reveal', 3],
    ['道路连通，出发！', '你在探路时小狗不动；路通了，它才跑。每一关都保证至少有一条可行道路。', null, null],
    ['学会了，去探第一条路', '数字看周围八格，行走只按上下左右。默认每关有 1 次触雷保护；再踩雷才失败。起点和终点安全，放心慢慢玩。', null, null],
  ];
  let state, mode = 'reveal', frame = 0, token = 0, returnFocus;
  dog.innerHTML = `<span class="dog-avatar">${DOG_SVG}</span>`;
  const coord = i => `${'ABCD'[i % 4]}${Math.floor(i / 4) + 1}`;
  function remember() { try { storage?.setItem(TUTORIAL_KEY, 'done'); } catch { /* Tutorial remains usable without storage. */ } }
  function leave() { remember(); token++; cancelAnimationFrame(frame); dog.classList.remove('running'); dialog.close(); returnFocus?.focus(); }
  function render() {
    const [title, text, action, target] = descriptions[state.step], { game } = state;
    byId('tutorial-progress').textContent = state.step < 5 ? `新手教程 · ${state.step + 1} / 5 · 约 1 分钟` : state.step === 5 ? '小狗正在出发' : '新手教程完成';
    byId('tutorial-step-title').textContent = title; byId('tutorial-copy').textContent = text;
    const mines = localMineHighlights(game);
    grid.innerHTML = game.revealed.map((open, i) => {
      const goal = i === game.board.goal, flag = game.flags[i], clue = game.board.clues[i];
      const content = goal ? MEAT_SVG + (open && clue ? `<strong class="goal-clue">${clue}</strong>` : '') + '<small class="endpoint-label">E</small>' : flag ? '⚑' : open ? clue || (i === 12 ? 'S' : '') : '';
      const active = i === target && (state.step !== 3 || state.hinted);
      return `<button class="cell ${open ? `open n${clue}` : 'unknown'} ${flag ? 'flagged' : ''} ${goal ? 'goal' : ''} ${mines.has(i) ? 'deduced-mine' : ''} ${active ? 'tutorial-target' : ''}" data-tutorial-cell="${i}" aria-label="教程 ${coord(i)}，${goal ? '带骨肉终点，' : ''}${flag ? '已插旗' : open ? `周围${clue}颗雷` : '未打开'}${active ? `，请${action === 'flag' ? '插旗' : '探雷'}` : ''}" ${state.step >= 5 ? 'disabled' : ''}>${content}</button>`;
    }).join('');
    byId('tutorial-reveal').setAttribute('aria-pressed', String(mode === 'reveal'));
    byId('tutorial-flag').setAttribute('aria-pressed', String(mode === 'flag'));
    byId('tutorial-reveal').disabled = state.step >= 5; byId('tutorial-flag').disabled = state.step >= 5;
    byId('tutorial-hint').hidden = state.step !== 3; byId('tutorial-hint').disabled = state.hinted;
    byId('tutorial-done').hidden = state.step !== 6; byId('tutorial-tools').hidden = state.step >= 5;
    if (state.step !== 5) position(game.position);
  }
  function position(from, to = from, fraction = 0) {
    const cell = grid.children[from], next = grid.children[to];
    if (!cell || !next) return;
    const rect = byId('tutorial-surface').getBoundingClientRect();
    const a = centerFromRects(cell.getBoundingClientRect(), rect), b = centerFromRects(next.getBoundingClientRect(), rect), point = interpolatePoint(a, b, fraction);
    dog.style.left = `${point.x}px`; dog.style.top = `${point.y}px`; dog.style.width = dog.style.height = `${a.size}px`;
    if (a.x !== b.x) dog.dataset.facing = b.x > a.x ? 'right' : 'left';
  }
  function run() {
    const runToken = ++token, path = [...state.game.runPath]; let elapsed = 0, last = performance.now();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 1600;
    dog.classList.add('running');
    function animate(now) {
      if (runToken !== token || !dialog.open) return;
      if (!document.hidden) elapsed += now - last;
      last = now;
      const distance = Math.min(1, elapsed / duration) * (path.length - 1), segment = Math.min(path.length - 2, Math.floor(distance));
      position(path[segment], path[segment + 1], distance - segment);
      if (elapsed < duration) frame = requestAnimationFrame(animate);
      else { tutorialAction(state, 'finish'); dog.classList.remove('running'); render(); byId('tutorial-done').focus(); }
    }
    position(path[0]); frame = requestAnimationFrame(animate);
  }
  function act(type, index) {
    if (!tutorialAction(state, type, index)) {
      byId('tutorial-feedback').textContent = state.step === 3 && !state.hinted ? '先点「免费线索」，再跟着提示探索。' : `这一步请${descriptions[state.step]?.[2] === 'flag' ? '用插旗模式标记红色格' : '用探雷模式点击闪动格'}，点错也没关系。`;
      return;
    }
    byId('tutorial-feedback').textContent = type === 'hint' ? '线索已指向安全格。它不会替你打开，试着点一下。' : '做对了！继续下一步。';
    render();
    if (state.step === 5) run();
    else if (type !== 'hint') byId('tutorial-step-title').focus({ preventScroll: true });
  }
  function open() {
    if (dialog.open || document.querySelector('dialog[open]')) return;
    returnFocus = document.activeElement; token++; cancelAnimationFrame(frame);
    state = createTutorial(); mode = 'reveal'; dog.classList.remove('running');
    byId('tutorial-feedback').textContent = '跟着闪动格操作即可。这里点错不会失败，也不会影响正式进度。';
    dialog.showModal(); render(); byId('tutorial-step-title').focus({ preventScroll: true });
  }
  grid.addEventListener('click', event => { const cell = event.target.closest('[data-tutorial-cell]'); if (cell) act(mode, Number(cell.dataset.tutorialCell)); });
  grid.addEventListener('contextmenu', event => { const cell = event.target.closest('[data-tutorial-cell]'); if (cell) { event.preventDefault(); act('flag', Number(cell.dataset.tutorialCell)); } });
  byId('tutorial-reveal').addEventListener('click', () => { mode = 'reveal'; render(); });
  byId('tutorial-flag').addEventListener('click', () => { mode = 'flag'; render(); });
  byId('tutorial-hint').addEventListener('click', () => act('hint'));
  byId('tutorial-done').addEventListener('click', leave); byId('tutorial-skip').addEventListener('click', leave);
  byId('tutorial-open').addEventListener('click', open);
  dialog.addEventListener('cancel', event => { event.preventDefault(); leave(); });
  dialog.addEventListener('close', () => { token++; cancelAnimationFrame(frame); });
  new ResizeObserver(() => { if (dialog.open && state && state.step !== 5) position(state.game.position); }).observe(grid);
  let seen = false; try { seen = storage?.getItem(TUTORIAL_KEY) === 'done'; } catch { /* Show tutorial if storage is unavailable. */ }
  if (!seen) open();
  return { open };
}
