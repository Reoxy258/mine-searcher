import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

test('UI document IDs are unique and every static controller target exists', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs break labels and controller routing');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.includes(id), `controller references absent #${id}`);
  }
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
