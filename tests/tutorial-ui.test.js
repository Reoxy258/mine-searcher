import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTutorial, tutorialAction, TUTORIAL_KEY } from '../src/tutorial-model.js';
import { localMineHighlights } from '../src/engine.js';
import { DOG_SVG, MEAT_SVG, centerFromRects, interpolatePoint } from '../src/visuals.js';

const source = readFileSync(new URL('../src/tutorial.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function harness({ seen = false, denied = false, otherModal = false } = {}) {
  const nodes = new Map(), frames = new Map(), saved = new Map([['main-game-save', 'unchanged']]);
  if (seen) saved.set(TUTORIAL_KEY, 'done');
  const writes = [], document = { hidden: false, activeElement: null, getElementById: id => nodes.get(id), querySelector: () => otherModal || nodes.get('tutorial-dialog')?.open ? {} : null };
  function node(id = '') {
    const handlers = new Map(), classes = new Set();
    const el = { id, dataset: {}, style: {}, attributes: {}, children: [], open: false, hidden: false, disabled: false, textContent: '',
      addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      focus() { document.activeElement = this; },
      showModal() { this.open = true; },
      close() { this.open = false; dispatch(this, 'close'); },
      getBoundingClientRect() { const i = Number(this.dataset.tutorialCell); return Number.isInteger(i) ? { left: i % 4 * 60, top: Math.floor(i / 4) * 60, width: 56, height: 56 } : { left: 0, top: 0, width: 240, height: 240 }; },
      closest(selector) { return selector === '[data-tutorial-cell]' && this.dataset.tutorialCell !== undefined ? this : null; },
      classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } },
      set innerHTML(value) {
        this._html = value;
        if (id === 'tutorial-board') this.children = [...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, content]) => {
          const button = node(); button.dataset.tutorialCell = attributes.match(/data-tutorial-cell="(\d+)"/)[1];
          button.attributes['aria-label'] = attributes.match(/aria-label="([^"]*)"/)[1];
          button.className = attributes.match(/class="([^"]*)"/)[1]; button.disabled = /\sdisabled/.test(attributes); button._html = content;
          return button;
        });
      }, get innerHTML() { return this._html || ''; }, _handlers: handlers,
    };
    return el;
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, node(id));
  const origin = node('origin'); document.activeElement = origin;
  const storage = { getItem(key) { if (denied) throw Error('denied'); return saved.get(key) ?? null; }, setItem(key, value) { if (denied) throw Error('denied'); writes.push([key, value]); saved.set(key, value); } };
  function dispatch(element, type, target = element) {
    const event = { target, prevented: false, preventDefault() { this.prevented = true; } };
    for (const callback of element._handlers.get(type) || []) callback(event);
    return event;
  }
  let sequence = 0;
  const scope = { document, createTutorial, tutorialAction, TUTORIAL_KEY, localMineHighlights, DOG_SVG, MEAT_SVG, centerFromRects, interpolatePoint, performance: { now: () => 0 }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; }, cancelAnimationFrame(id) { frames.delete(id); }, ResizeObserver: class { observe() {} }, storage,
  };
  runInNewContext(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nsetupTutorial(storage);', scope);
  return { nodes, saved, writes, document, origin, frames, dispatch,
    click(id) { dispatch(nodes.get(id), 'click'); },
    cell(i) { dispatch(nodes.get('tutorial-board'), 'click', nodes.get('tutorial-board').children[i]); },
    frame(time) { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); },
  };
}

test('first visit opens practice and focuses the current step without touching main saves', () => {
  const h = harness();
  assert.equal(h.nodes.get('tutorial-dialog').open, true);
  assert.equal(h.document.activeElement.id, 'tutorial-step-title');
  assert.equal(h.nodes.get('tutorial-board').children.length, 16);
  assert.match(h.nodes.get('tutorial-progress').textContent, /1 \/ 5/);
  assert.deepEqual(h.writes, []); assert.equal(h.saved.get('main-game-save'), 'unchanged');
  const before = h.nodes.get('tutorial-board').innerHTML;
  h.cell(0); assert.equal(h.nodes.get('tutorial-board').innerHTML, before);
  assert.match(h.nodes.get('tutorial-feedback').textContent, /点错也没关系/);
});

test('skip and Escape persist completion, restore focus, and allow a fresh replay', () => {
  for (const action of ['skip', 'escape']) {
    const h = harness(); h.cell(9);
    if (action === 'skip') h.click('tutorial-skip');
    else assert.equal(h.dispatch(h.nodes.get('tutorial-dialog'), 'cancel').prevented, true);
    assert.equal(h.nodes.get('tutorial-dialog').open, false);
    assert.equal(h.saved.get(TUTORIAL_KEY), 'done');
    assert.equal(h.document.activeElement, h.origin);
    h.nodes.get('tutorial-open').focus(); h.click('tutorial-open');
    assert.equal(h.nodes.get('tutorial-dialog').open, true);
    assert.match(h.nodes.get('tutorial-progress').textContent, /1 \/ 5/);
    assert.equal(h.nodes.get('tutorial-reveal').attributes['aria-pressed'], 'true');
    h.click('tutorial-skip'); assert.equal(h.document.activeElement.id, 'tutorial-open');
  }
});

test('return visits stay in the game while the permanent tutorial entry remains available', () => {
  const h = harness({ seen: true });
  assert.equal(h.nodes.get('tutorial-dialog').open, false);
  h.click('tutorial-open'); assert.equal(h.nodes.get('tutorial-dialog').open, true);
  assert.deepEqual(h.writes, []);
  const blocked = harness({ seen: false, otherModal: true });
  assert.equal(blocked.nodes.get('tutorial-dialog').open, false, 'tutorial must not stack over another modal');
});

test('five interactive steps run the dog and finish only after animation, preserving main progress', () => {
  const h = harness();
  h.cell(9); assert.match(h.nodes.get('tutorial-progress').textContent, /2 \/ 5/);
  h.cell(6); assert.match(h.nodes.get('tutorial-progress').textContent, /2 \/ 5/, 'wrong mode cannot advance');
  h.click('tutorial-flag'); h.cell(6); assert.match(h.nodes.get('tutorial-progress').textContent, /3 \/ 5/);
  h.click('tutorial-reveal'); h.cell(15); assert.match(h.nodes.get('tutorial-progress').textContent, /4 \/ 5/);
  h.cell(7); assert.match(h.nodes.get('tutorial-feedback').textContent, /先点「免费线索」/);
  h.click('tutorial-hint'); assert.equal(h.nodes.get('tutorial-hint').disabled, true);
  h.cell(7); assert.match(h.nodes.get('tutorial-progress').textContent, /5 \/ 5/);
  h.cell(3); assert.equal(h.nodes.get('tutorial-dog').classList.contains('running'), true);
  assert.equal(h.nodes.get('tutorial-done').hidden, true);
  h.frame(800); assert.equal(h.nodes.get('tutorial-done').hidden, true);
  h.frame(1700); assert.equal(h.nodes.get('tutorial-done').hidden, false);
  assert.equal(h.document.activeElement.id, 'tutorial-done');
  assert.equal(h.nodes.get('tutorial-dog').style.left, '208px');
  assert.equal(h.nodes.get('tutorial-dog').style.top, '28px');
  h.click('tutorial-done'); assert.equal(h.nodes.get('tutorial-dialog').open, false);
  assert.deepEqual(h.writes, [[TUTORIAL_KEY, 'done']]);
  assert.equal(h.saved.get('main-game-save'), 'unchanged');
});

test('storage denial still permits opening, skipping, and replaying the practice', () => {
  const h = harness({ denied: true });
  assert.equal(h.nodes.get('tutorial-dialog').open, true);
  assert.doesNotThrow(() => h.click('tutorial-skip'));
  assert.doesNotThrow(() => h.click('tutorial-open'));
  assert.equal(h.nodes.get('tutorial-dialog').open, true);
});

test('tutorial has accessible labels, live feedback, constrained mobile layout, and main timer pause', () => {
  const dialog = html.match(/<dialog\b[^>]*id="tutorial-dialog"[^>]*>[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog); assert.match(dialog, /aria-labelledby="tutorial-title"/);
  assert.match(dialog, /aria-describedby="tutorial-copy"/); assert.match(dialog, /id="tutorial-step-title" tabindex="-1"/);
  assert.match(dialog, /id="tutorial-feedback"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(dialog, /id="tutorial-skip"/); assert.match(html, /id="tutorial-open"[^>]*aria-label="新手教程"/);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.tutorial-dialog\{[^}]*width:min\(490px,calc\(100% - 24px\)\)/);
  assert.match(css, /\.tutorial-dialog\{[^}]*max-height:94dvh/);
  assert.match(css, /@media\(max-width:400px\)/);
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /const modalOpen = \(\) => Boolean\(document.querySelector\('dialog\[open\]'\)\)/);
  assert.match(app, /if \(started && game.status === 'playing' && !document.hidden && !modalOpen\(\)\) game.elapsed \+= delta/);
});
