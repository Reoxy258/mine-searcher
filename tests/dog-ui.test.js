import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createGame, makeBoard, deduce, frontier } from '../src/engine.js';
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
    game, cells, frontier, deduce, MEAT_SVG, selectedIndex: game.board.start,
    currentHint: null, levelShown: game.level, coord: String,
    buildBoard() {}, drawRoute() {}, placeRunner() {},
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

test('automatic mine highlights follow visible proofs and persist after flagging', () => {
  const game = createGame(makeBoard(3, 3, [0, 1, 4]));
  game.status = 'playing'; game.revealed.fill(false);
  for (const i of [3, 5, 6, 7, 8]) game.revealed[i] = true;
  const { render, cells } = renderFixture(game);
  render();
  assert.deepEqual([...deduce(game).mines].sort(), [0, 1, 4]);
  for (const i of [0, 1, 4]) {
    assert.ok(cells[i].classList.contains('deduced-mine'));
    assert.match(cells[i].attributes['aria-label'], /由已打开数字确定有雷/);
    assert.equal(cells[i].textContent, '✳');
  }
  assert.ok(cells[7].classList.contains('evidence-clue'));
  assert.ok(!cells[2].classList.contains('deduced-mine'));
  game.flags[4] = true; render();
  assert.ok(cells[4].classList.contains('deduced-mine'));
  assert.equal(cells[4].textContent, '⚑');
  game.flags[4] = false; render();
  assert.ok(cells[4].classList.contains('deduced-mine'));
  for (const status of ['running', 'won']) {
    game.status = status; render();
    assert.ok(cells[4].classList.contains('deduced-mine'), `${status} must retain visible deductions`);
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

test('route polyline and dog use the same wrapper-relative coordinates despite nested offsets', () => {
  const rectangles = [
    { left: 130.5, top: 230.25, width: 49.5, height: 50.5 },
    { left: 130.5, top: 285.25, width: 49.5, height: 50.5 },
  ];
  const surface = { left: 120.5, top: 220.25, width: 110, height: 180 };
  const cells = rectangles.map(rect => element(rect)), nodes = new Map();
  const wrap = element(surface), runner = element(), trail = element();
  nodes.set('board-wrap', wrap); nodes.set('runner', runner); nodes.set('trail', trail);
  const scope = { cells, centerFromRects, interpolatePoint, game: { status: 'playing', runPath: [0, 1] }, $(id) { return nodes.get(id); } };
  const functions = app.match(/function centerOf\(index\) \{[\s\S]*?\nfunction renderBoard/)[0].replace(/\nfunction renderBoard$/, '');
  runInNewContext(`${functions}\nplaceRunner(0, 1, .5); drawRoute();`, scope);
  const points = [...trail.innerHTML.matchAll(/([\d.]+),([\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
  assert.deepEqual(points, [[34.75, 35.25], [34.75, 90.25]]);
  assert.equal(runner.style.left, '34.75px');
  assert.equal(runner.style.top, '62.75px');
  assert.equal(trail.attributes.viewBox, '0 0 110 180');
  assert.equal(runner.dataset.cell, '1');
});

test('viewport scroll changes do not shift dog position relative to the board', () => {
  const original = centerFromRects({ left: 80, top: 120, width: 40, height: 40 }, { left: 20, top: 50 });
  const scrolled = centerFromRects({ left: -220, top: -380, width: 40, height: 40 }, { left: -280, top: -450 });
  assert.deepEqual(scrolled, original);
  assert.deepEqual(interpolatePoint(original, { x: 160, y: 130 }, .5), { x: 120, y: 110 });
});
