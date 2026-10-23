import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createGame, makeBoard, explore, frontier } from '../src/engine.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const help = html.match(/<dialog\b[^>]*id="help-dialog"[^>]*>([\s\S]*?)<\/dialog>/)?.[1].replace(/<[^>]+>/g, '') || '';

test('UI document IDs are unique and every static controller target exists', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs break labels and controller routing');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.includes(id), `controller references absent #${id}`);
  }
});

test('handbook explains guaranteed routes, stationary exploration and delayed arrival', () => {
  assert.match(help, /每一关保证至少有一条从 S 到 E 的可行道路/);
  assert.match(help, /经过数字推理验证，无需猜雷/);
  assert.match(help, /点击任意未插旗的未知格即可探索，人物保持不动/);
  assert.match(help, /上下左右连通 S 与 E/);
  assert.match(help, /斜对角不算相连/);
  assert.match(help, /仅打开终点并不算通关/);
  assert.match(help, /跑到 E，再显示通关结果/);
  assert.doesNotMatch(help, /点击已打开的格子可自动寻路|沿已知安全路线走过去/);
});

test('handbook states assistance costs and difficulty reset before players commit', () => {
  assert.match(help, /默认轻松模式每关提供 1 次触雷保护/);
  assert.match(help, /自动插旗也可手动撤销，撤销后该格仍然有雷/);
  assert.match(help, /标准模式没有保护，触雷即结束/);
  assert.match(help, /确认后重开本关，星级纪录保留/);
  assert.match(help, /使用多少次都不扣星/);
  assert.match(help, /未触发保护得 3 星，触发过保护得 2 星/);
  assert.doesNotMatch(help, /无提示通关得|使用 1～3 次得|更多得 1 星/);
  const difficultyDialog = html.match(/<dialog\b[^>]*id="difficulty-dialog"[^>]*>([\s\S]*?)<\/dialog>/)?.[1];
  assert.ok(difficultyDialog);
  assert.match(difficultyDialog, /data-close[^>]*>保留当前这一局/);
  assert.match(difficultyDialog, /id="confirm-difficulty"[^>]*>确认并重开本关/);
});

test('keyboard instructions consistently distinguish selection from exploration', () => {
  const shortcut = html.match(/<section\b[^>]*class="shortcut-bar"[^>]*>([\s\S]*?)<\/section>/)?.[1].replace(/<[^>]+>/g, '') || '';
  assert.match(shortcut, /选格，Enter 探雷/);
  assert.match(help, /方向键 \/ WASD 只选格，Enter \/ 空格执行探雷或插旗，F 切换模式/);
  assert.doesNotMatch(shortcut, /行走|点击安全格自动寻路/);
});

test('opened endpoint exposes its numerical clue as well as its E marker', () => {
  // E is safe but may carry a clue that subsequent deductions depend on.
  const game = createGame(makeBoard(3, 3, [1, 4, 5]));
  const element = () => ({
    classList: { toggle() {} }, setAttribute() {},
    set textContent(value) { this._text = String(value); },
    get textContent() { return this._text || ''; },
    set innerHTML(value) { this._text = value.replace(/<[^>]*>/g, ''); },
  });
  const cells = Array.from({ length: 9 }, element), nodes = new Map();
  const scope = {
    game, cells, frontier, selectedIndex: game.board.start, currentHint: null,
    levelShown: game.level, coord: String, buildBoard() {}, drawRoute() {}, placeRunner() {},
    $(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
  };
  const renderer = app.match(/function renderBoard\(\) \{([\s\S]*?)\n\}\nfunction renderResult/);
  assert.ok(renderer, 'board rendering entrypoint must be identifiable');
  const render = () => runInNewContext(`function renderBoard() {${renderer[1]}\n}\nrenderBoard();`, scope);
  render();
  assert.equal(cells[game.board.goal].textContent, 'E', 'unopened endpoint has no exposed clue');
  assert.equal(explore(game, game.board.goal).ok, true);
  assert.equal(game.status, 'playing', 'opening isolated E must not finish the level');
  assert.equal(game.board.clues[game.board.goal], 3);
  render();
  assert.match(cells[game.board.goal].textContent, /3/, 'players must see the same E clue used by inference');
  assert.match(cells[game.board.goal].textContent, /E/, 'endpoint retains its identity');
});

test('every modal has an accessible name connected to visible content', () => {
  const dialogs = [...html.matchAll(/<dialog\b([^>]*)>([\s\S]*?)<\/dialog>/g)];
  assert.ok(dialogs.length >= 4, 'expected help, levels, retry, and pause dialogs');
  for (const [, attributes, content] of dialogs) {
    const name = attr(attributes, 'aria-label');
    if (name?.trim()) continue;
    const labels = attr(attributes, 'aria-labelledby')?.trim().split(/\s+/);
    assert.ok(labels?.length, `#${attr(attributes, 'id')} lacks an accessible name`);
    for (const id of labels) {
      assert.ok(content.includes(`id="${id}"`), `#${attr(attributes, 'id')} names missing #${id}`);
    }
  }
});
