import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url), dist = new URL('dist/', root);
await mkdir(dist, { recursive: true });
for (const entry of ['index.html', 'icon.svg', 'src']) await cp(new URL(entry, root), new URL(entry, dist), { recursive: true });
await writeFile(new URL('.nojekyll', dist), '');
// Also ship a dependency-free file that can be opened directly from disk.
const html = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('src/styles.css', root), 'utf8');
const icon = await readFile(new URL('icon.svg', root));
const sources = await Promise.all(['levels.js', 'engine.js', 'visuals.js', 'tutorial-model.js', 'tutorial.js', 'app.js'].map(name => readFile(new URL(`src/${name}`, root), 'utf8')));
const script = sources.map(source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
const standalone = html.replace('<link rel="stylesheet" href="./src/styles.css">', `<style>${css}</style>`)
  .replace('./icon.svg', `data:image/svg+xml;base64,${icon.toString('base64')}`)
  .replace('<script type="module" src="./src/app.js"></script>', `<script type="module">\n${script}\n</script>`);
await writeFile(new URL('standalone.html', dist), standalone);
console.log(`Built: ${fileURLToPath(dist)}`);
