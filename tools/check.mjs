#!/usr/bin/env node
// Pre-push check: run before committing app changes.   node tools/check.mjs
//   - every file the app loads is in SHELL_FILES in sw.js (a missing one breaks the app offline), and every
//     listed file exists
//   - SHELL_VERSION was bumped if the list changed since the last commit
//   - relative imports resolve; no root-absolute URLs (GitHub Pages serves the site under /recipe-book/)
//   - every script parses, and the tests pass
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = p => path.relative(root, p).split(path.sep).join('/');
const read = p => readFileSync(path.join(root, p), 'utf8');
const problems = [];
const walk = dir => readdirSync(path.join(root, dir)).flatMap(f => {
  const p = `${dir}/${f}`;
  return statSync(path.join(root, p)).isDirectory() ? walk(p) : [p];
});

// ---- SHELL_FILES in sw.js ----
const parseShell = src => {
  const list = src.match(/const SHELL_FILES = \[([\s\S]*?)\];/)?.[1];
  return { files: [...(list ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]), version: src.match(/const SHELL_VERSION = (\d+);/)?.[1] };
};
const sw = read('sw.js');
const shell = parseShell(sw);
const listed = new Set(shell.files);
if (!shell.files.length || !shell.version) problems.push('sw.js: could not read SHELL_FILES or SHELL_VERSION');

const indexHtml = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));
const loaded = new Set([
  'index.html', 'manifest.webmanifest',
  ...walk('js').filter(f => f.endsWith('.js')),
  ...walk('css').filter(f => f.endsWith('.css')),
  ...[...indexHtml.matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => m[1]).filter(p => !p.startsWith('#')),
  ...manifest.icons.map(i => i.src),
]);
for (const f of loaded) if (!listed.has(f)) problems.push(`sw.js: SHELL_FILES is missing ${f} (the app may not start offline)`);
for (const f of listed) if (f !== './' && !existsSync(path.join(root, f))) problems.push(`sw.js: SHELL_FILES lists ${f}, which does not exist`);

const head = spawnSync('git', ['show', 'HEAD:sw.js'], { cwd: root, encoding: 'utf8' });
if (head.status === 0) {
  const before = parseShell(head.stdout);
  const changed = before.files.join('\n') !== shell.files.join('\n');
  if (changed && before.version === shell.version) problems.push(`sw.js: SHELL_FILES changed since the last commit; bump SHELL_VERSION (now ${shell.version})`);
}

// ---- imports and URLs ----
for (const file of [...loaded].filter(f => f.endsWith('.js'))) {
  const src = read(file);
  for (const [, spec] of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'/gm)) {
    if (!spec.startsWith('.')) { problems.push(`${file}: import '${spec}' is not relative`); continue; }
    const target = rel(path.resolve(path.dirname(path.join(root, file)), spec));
    if (!existsSync(path.join(root, target))) problems.push(`${file}: import '${spec}' does not exist`);
  }
}
for (const file of [...loaded].filter(f => /\.(js|css|html)$/.test(f) && !f.includes('vendor/'))) {
  const src = read(file);
  const abs = src.match(/(?:href|src)="\/[^"]*"|fetch\(\s*['"`]\/|url\(\s*['"]?\/[^)]*\)|['"`]\/api\//);
  if (abs) problems.push(`${file}: root-absolute URL ${abs[0]} (use a relative path)`);
}

// ---- syntax ----
for (const file of [...walk('js'), 'sw.js', ...walk('tools'), ...walk('tests')].filter(f => /\.m?js$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`${file}: syntax error\n${r.stderr.trim()}`);
}

// ---- tests ----
const tests = spawnSync(process.execPath, ['--test', path.join(root, 'tests')], { cwd: root, encoding: 'utf8' });
const summary = (tests.stdout.match(/^ℹ (tests|pass|fail) \d+$/gm) ?? []).join(', ').replace(/ℹ /g, '');
if (tests.status !== 0) problems.push(`tests failed (${summary}):\n${tests.stdout.split('\n').filter(l => /✖|Error|expected|actual/.test(l)).slice(0, 30).join('\n')}`);

if (problems.length) {
  console.error(`✖ ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`✔ shell list (${listed.size} files, v${shell.version}), imports, URLs and syntax OK; tests: ${summary}`);
