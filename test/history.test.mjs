// "Edit with Claude" history: every site's dev server shares one history file, and undo never leaves half a change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistory } from '../history.mjs';

const repo = () => mkdtempSync(join(tmpdir(), 'ce-history-'));
const HISTORY = new URL('../history.mjs', import.meta.url).href;

test('two dev servers recording at the same time keep every entry, each with its own id', async () => {
  const dir = repo();
  // Enough files that a snapshot takes a moment, like the real repo.
  for (let i = 0; i < 400; i++) { mkdirSync(join(dir, 'src', String(i % 20)), { recursive: true }); writeFileSync(join(dir, 'src', String(i % 20), `${i}.astro`), 'x'.repeat(2000)); }
  const server = (name) => new Promise((resolve, reject) => {
    const code = `const { createHistory } = await import(${JSON.stringify(HISTORY)});
      const { writeFileSync } = await import('node:fs');
      const h = createHistory(${JSON.stringify(dir)}, ${JSON.stringify(name)});
      for (let i = 0; i < 15; i++) { const before = h.snapshot(); writeFileSync(${JSON.stringify(join(dir, 'f-'))} + '${name}.astro', String(i)); h.record('${name} ' + i, before); }`;
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'inherit' });
    p.on('exit', (c) => (c ? reject(new Error(`${name} exited ${c}`)) : resolve()));
  });
  await Promise.all([server('one'), server('two')]);
  const entries = JSON.parse(readFileSync(join(dir, '.claude-edit', 'history.json'), 'utf8'));
  assert.equal(entries.length, 30);
  assert.equal(new Set(entries.map((e) => e.id)).size, 30);
});

test('an undo whose image bytes are gone says so and changes nothing', () => {
  const dir = repo(), imgs = join(dir, 'packages', 'images', 'uploads');
  mkdirSync(imgs, { recursive: true });
  writeFileSync(join(dir, 'a.astro'), 'one');
  writeFileSync(join(imgs, 'a.jpg'), Buffer.from([1, 2, 3]));
  const h = createHistory(dir, '', { binary: 'packages/images' });
  const before = h.snapshot();
  writeFileSync(join(dir, 'a.astro'), 'two');
  writeFileSync(join(imgs, 'a.jpg'), Buffer.from([4, 5, 6]));
  const e = h.record('both', before);
  const blob = e.files.find((f) => f.path.endsWith('.jpg')).before.blob;
  unlinkSync(join(dir, '.claude-edit', 'blobs', blob)); // e.g. `git clean -X`, or another dev server cleaned up
  const r = h.undo(e.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /a\.jpg/);
  assert.equal(readFileSync(join(dir, 'a.astro'), 'utf8'), 'two'); // no half undo
  assert.equal(h.list()[0].undone, false);
});

test('a symlinked folder is not followed (no loops, no files outside the repo)', () => {
  const dir = repo(), outside = repo();
  writeFileSync(join(dir, 'a.astro'), 'one');
  writeFileSync(join(outside, 'secret.md'), 'x');
  symlinkSync(dir, join(dir, 'loop'));
  symlinkSync(outside, join(dir, 'out'));
  assert.deepEqual([...createHistory(dir).snapshot().keys()], ['a.astro']);
  rmSync(outside, { recursive: true });
  assert.ok(existsSync(dir) && readdirSync(dir).includes('loop'));
});
