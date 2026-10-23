import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createGame, makeBoard, localMineHighlights, frontier } from '../src/engine.js';
import { DOG_SVG, MEAT_SVG, centerFromRects, interpolatePoint } from '../src/visuals.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
function element(rect = {}) {
  const node = {
    className: '', attributes: {}, style: {}, dataset: {}, _text: '',
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getBoundingClientRect() { return rect; },
    set textContent(value) { this._text = String(value); this._html = ''; },
    get textContent() { return this._text; },
    set innerHTML(value) { this._html = value; this._text = value.replace(/<[^>]*>/g, ''); },
    get innerHTML() { return this._html || ''; },
  };
  node.classList = {
    contains(value) { return node.className.split(/\s+/).includes(value); },
    toggle(value, force) {
      const classes = new Set(node.className.split(/\s+/).filter(Boolean));
      if (force ?? !classes.has(value)) classes.add(value); else classes.delete(value);
      node.className = [...classes].join(' ');
    },
  };
  return node;
}
function renderFixture(game) {
  const cells = Array.from({ length: game.revealed.length }, () => element()), nodes = new Map();
  const scope = {
    game, cells, frontier, localMineHighlights, MEAT_SVG, selectedIndex: game.board.start,
    currentHint: null, levelShown: game.level, coord: String,
    buildBoard() {}, placeRunner() {},
    $(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
  };
  const renderer = app.match(/function renderBoard\(\) \{([\s\S]*?)\n\}\nfunction renderResult/);
  assert.ok(renderer);
  const render = () => runInNewContext(`function renderBoard() {${renderer[1]}\n}\nrenderBoard();`, scope);
  return { render, cells, nodes, scope };
}

test('dog and bone-in meat are self-contained artwork with separate endpoint clues', () => {
  assert.match(DOG_SVG, /class="dog-art"/);
  assert.match(DOG_SVG, /dog-tail/);
  assert.match(DOG_SVG, /dog-leg-front/);
  assert.match(MEAT_SVG, /class="meat-art"/);
  assert.doesNotMatch(DOG_SVG + MEAT_SVG, /<image|(?:href|src)=["']https?:/);
  const game = createGame(makeBoard(3, 3, [1, 4, 5]));
  const { render, cells } = renderFixture(game);
  render();
  assert.match(cells[2].innerHTML, /meat-art/);
  assert.doesNotMatch(cells[2].innerHTML, /goal-clue/);
  game.revealed[2] = true; render();
  assert.match(cells[2].innerHTML, /class="goal-clue">3<\/strong>/);
  assert.match(cells[2].innerHTML, /meat-art/);
  assert.match(cells[2].attributes['aria-label'], /周围3颗雷.*终点/);
});

test('automatic mine highlights use one local number without chaining and never insert flags', () => {
  const game = createGame(makeBoard(3, 3, [0, 1, 4]));
  game.status = 'playing'; game.revealed.fill(false);
  for (const i of [5, 6, 7, 8]) game.revealed[i] = true;
  const { render, cells } = renderFixture(game);
  const before = [...game.flags];
  render();
  // The 1 at cell 8 has exactly one unopened neighbor (4). Cell 1 can
  // be proved by combining clues, but the automatic UI must not do that.
  assert.deepEqual([...localMineHighlights(game)], [4]);
  assert.ok(cells[4].classList.contains('deduced-mine'));
  assert.equal(cells[4].textContent, '✳');
  assert.match(cells[4].attributes['aria-label'], /有雷/);
  assert.ok(!cells[1].classList.contains('deduced-mine'));
  assert.deepEqual(game.flags, before, 'highlighting must not place flags');
  assert.ok(cells.every(cell => !cell.classList.contains('evidence-clue')));
  game.flags[4] = true; render();
  assert.ok(cells[4].classList.contains('deduced-mine'));
  assert.equal(cells[4].textContent, '⚑');
  assert.ok(!cells[1].classList.contains('deduced-mine'), 'flags must not be subtracted from other clues');
  game.flags[4] = false; render();
  assert.ok(cells[4].classList.contains('deduced-mine'));
  for (const status of ['running', 'won']) {
    game.status = status; game.runPath = [6, 7, 8, 5, 2]; render();
    assert.ok(cells[4].classList.contains('deduced-mine'), `${status} must retain visible local matches`);
    assert.ok(cells.every(cell => !cell.classList.contains('evidence-clue') && !cell.classList.contains('route-cell')));
  }
});

test('uncertain player flags and unread hidden mines do not produce automatic highlights', () => {
  const game = createGame(makeBoard(4, 4, [0, 1, 5, 6]));
  game.status = 'playing'; game.revealed.fill(false); game.revealed[12] = true;
  game.flags[0] = true;
  const { render, cells } = renderFixture(game);
  game.board.mines = new Proxy(game.board.mines, { get() { throw Error('Playing UI read hidden mine values'); } });
  render();
  assert.ok(cells[0].classList.contains('flagged'));
  assert.ok(!cells[0].classList.contains('deduced-mine'));
  assert.match(cells[0].attributes['aria-label'], /尚未由数字确认/);
  assert.equal(cells.filter(cell => cell.classList.contains('deduced-mine')).length, 0);
});

test('dog still follows the opened path coordinates without route lines or painted route cells', () => {
  const rectangles = [
    { left: 130.5, top: 230.25, width: 49.5, height: 50.5 },
    { left: 130.5, top: 285.25, width: 49.5, height: 50.5 },
  ];
  const surface = { left: 120.5, top: 220.25, width: 110, height: 180 };
  const cells = rectangles.map(rect => element(rect)), nodes = new Map();
  const wrap = element(surface), runner = element();
  nodes.set('board-wrap', wrap); nodes.set('runner', runner);
  const scope = { cells, centerFromRects, interpolatePoint, game: { status: 'playing', runPath: [0, 1] }, $(id) { assert.ok(nodes.has(id), `unexpected route overlay #${id}`); return nodes.get(id); } };
  const functions = app.match(/function centerOf\(index\) \{[\s\S]*?\nfunction renderBoard/)[0].replace(/\nfunction renderBoard$/, '');
  runInNewContext(`${functions}\nplaceRunner(0, 1, .5);`, scope);
  assert.equal(runner.style.left, '34.75px');
  assert.equal(runner.style.top, '62.75px');
  assert.equal(runner.dataset.cell, '1');
  runInNewContext('placeRunner(1);', scope);
  assert.equal(runner.style.top, '90.25px');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="trail"|key-evidence/);
  assert.doesNotMatch(app, /function drawRoute|<polyline|route-cell|evidence-clue/);
  assert.doesNotMatch(css, /\.evidence-clue|\.route-cell|\.trail(?:[\s{.]|$)/);
});

test('viewport scroll changes do not shift dog position relative to the board', () => {
  const original = centerFromRects({ left: 80, top: 120, width: 40, height: 40 }, { left: 20, top: 50 });
  const scrolled = centerFromRects({ left: -220, top: -380, width: 40, height: 40 }, { left: -280, top: -450 });
  assert.deepEqual(scrolled, original);
  assert.deepEqual(interpolatePoint(original, { x: 160, y: 130 }, .5), { x: 120, y: 110 });
});
