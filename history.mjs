// Change history for the editor. Every change (a Claude turn, a direct text edit, an image replace) is stored with each
// file's content before and after, so editors can undo it, go back to before an earlier change, or redo.
// Each page has its own history: undo / go back / redo only walk through changes made on that page.
// All sites share the file, so a page is its site plus its path ("/" on one site is not "/" on another).
// A change to a shared file (theme, components, layouts, images) is marked `shared`; if a later change elsewhere touched
// the same file, undo reports a conflict instead of silently overwriting it.
// Image files in the image library (`binary`: its repo-relative folder) are kept as { blob: <sha256> }, the bytes in .claude-edit/blobs/.
// Saved in <repo>/.claude-edit/history.json so it survives dev-server restarts.
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', '.astro', '.claude-edit', '.claude', '.vite', 'pnpm-lock.yaml', 'package-lock.json']);
const TEXT = /\.(astro|css|scss|js|mjs|cjs|ts|tsx|jsx|md|mdx|json|html|svg|ya?ml|txt)$/;
const IMAGE = /\.(jpe?g|png|webp|avif|gif)$/i;
const MAX_FILE = 1_000_000;
const MAX_ENTRIES = 200; // all pages together
const pageOf = (e) => e.page ?? '/'; // entries from before per-page history count as the home page
// Entries from before the site was stored: the site whose files (apps/<site>/) they changed.
const siteOf = (e) => e.site ?? e.files.map((f) => f.path.match(/^apps\/([^/]+)\//)?.[1]).find(Boolean) ?? '';
const keyOf = (e) => `${siteOf(e)} ${pageOf(e)}`;
const same = (a, b) => (a && typeof a === 'object' && b && typeof b === 'object' ? a.blob === b.blob : a === b);

// `isPage(path)`: the file is one page's own (a change to any other file is shared by many pages).
export function createHistory(root, site = '', { binary, isPage = (path) => /(^|\/)src\/pages\//.test(path) } = {}) {
  const isBinary = (path) => !!binary && path.startsWith(`${binary}/`) && IMAGE.test(path);
  // Also skip what git ignores at the top level (.lighthouseci alone can be a gigabyte of reports).
  const skip = new Set(SKIP);
  try { for (const l of readFileSync(join(root, '.gitignore'), 'utf8').split('\n')) if (/^[\w.-]+\/?$/.test(l.trim())) skip.add(l.trim().replace(/\/$/, '')); } catch {}
  const store = join(root, '.claude-edit', 'history.json');
  const blobs = join(root, '.claude-edit', 'blobs');
  // Every site's dev server shares this file: each change reads it fresh and writes it back while holding a lock, so
  // none overwrites another's entries (or gives two changes the same id).
  let entries = [], seq = 0;
  const load = () => {
    try { entries = JSON.parse(readFileSync(store, 'utf8')); } catch {}
    seq = entries.reduce((n, e) => Math.max(n, e.id), seq);
  };
  load();
  const lock = join(root, '.claude-edit', 'history.lock');
  // ponytail: a lock folder (mkdir is atomic); one left by a dev server that died is taken over after 5 s
  const locked = (fn) => {
    mkdirSync(dirname(lock), { recursive: true });
    for (const until = Date.now() + 5000; ;) {
      try { mkdirSync(lock); break; } catch (err) { if (err.code !== 'EEXIST') throw err; }
      if (Date.now() > until) { rmSync(lock, { recursive: true, force: true }); continue; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // the other dev server needs a few ms
    }
    try { load(); return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
  };
  const hashes = new Map(); // path → { mtimeMs, size, blob }: binary files are only re-hashed when they change

  // A binary file as { blob }, its bytes kept in the blob store (a copy-on-write clone where the disk supports it).
  const blobOf = (path, st) => {
    const known = hashes.get(path);
    if (known && known.mtimeMs === st.mtimeMs && known.size === st.size && existsSync(join(blobs, known.blob))) return { blob: known.blob };
    const abs = join(root, path);
    const blob = createHash('sha256').update(readFileSync(abs)).digest('hex');
    mkdirSync(blobs, { recursive: true });
    if (!existsSync(join(blobs, blob))) copyFileSync(abs, join(blobs, blob), constants.COPYFILE_FICLONE);
    hashes.set(path, { mtimeMs: st.mtimeMs, size: st.size, blob });
    return { blob };
  };
  const save = () => {
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify(entries));
    // Drop blobs nothing needs any more: not in any entry, not a file's current content.
    if (!existsSync(blobs)) return;
    const keep = new Set([...hashes.values()].map((h) => h.blob));
    for (const e of entries) for (const f of e.files) for (const c of [f.before, f.after]) if (c?.blob) keep.add(c.blob);
    for (const b of readdirSync(blobs)) if (!keep.has(b)) unlinkSync(join(blobs, b));
  };
  const read = (path) => {
    try {
      if (!isBinary(path)) return readFileSync(join(root, path), 'utf8');
      return blobOf(path, statSync(join(root, path)));
    } catch { return null; }
  };
  const write = (path, content) => {
    const abs = join(root, path);
    if (content === null) {
      if (existsSync(abs)) unlinkSync(abs);
      try { if (!readdirSync(dirname(abs)).length) rmdirSync(dirname(abs)); } catch {} // e.g. the uploads folder of an undone upload
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    if (typeof content === 'string') return writeFileSync(abs, content);
    // Binary: copy next to the blobs, then move into place in one step, so the dev server never reads half a file.
    const tmp = join(blobs, `.restore-${process.pid}`);
    copyFileSync(join(blobs, content.blob), tmp);
    renameSync(tmp, abs);
  };

  // Every editable text file and every library image in the repo, by repo-relative path.
  // ponytail: full scan per change is fine for a site repo; scope it to apps/ and packages/ if the repo gets huge
  function snapshot() {
    const files = new Map();
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const abs = join(dir, name);
        let st;
        try { st = lstatSync(abs); } catch { continue; } // file removed mid-scan
        const path = relative(root, abs);
        if (st.isSymbolicLink()) continue; // a link to a folder could loop or lead out of the repo
        if (st.isDirectory()) walk(abs);
        else if (isBinary(path)) files.set(path, blobOf(path, st));
        else if (TEXT.test(name) && st.size < MAX_FILE) files.set(path, readFileSync(abs, 'utf8'));
      }
    };
    walk(root);
    return files;
  }

  function record(label, before, page = '/') {
    const after = snapshot(); // the slow part, outside the lock
    const files = [];
    for (const [path, content] of after) if (!same(before.get(path), content)) files.push({ path, before: before.get(path) ?? null, after: content });
    for (const [path, content] of before) if (!after.has(path)) files.push({ path, before: content, after: null });
    if (!files.length) return null;
    return locked(() => {
      const entry = { id: ++seq, label, at: Date.now(), site, page, shared: files.some((f) => !isPage(f.path)), files };
      entries = entries.filter((e) => !(e.undone && keyOf(e) === keyOf(entry))); // a new change ends this page's redo trail
      entries.push(entry);
      entries = entries.slice(-MAX_ENTRIES);
      save();
      return entries.at(-1);
    });
  }
  // Image bytes a restore needs that are gone (blobs deleted by hand or by git clean): checked before writing anything.
  const missing = (contents) => [...contents].filter(([, c]) => c?.blob && !existsSync(join(blobs, c.blob))).map(([path]) => path);

  // Undo this change and every newer one ON THE SAME PAGE (newest first).
  // Refuses if a file was changed since (by anything else, e.g. a change on another page), unless forced.
  const undo = (id, force = false) => locked(() => {
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0 || entries[i].undone) return { ok: false, message: 'That change is already undone.' };
    const batch = entries.slice(i).filter((e) => !e.undone && keyOf(e) === keyOf(entries[i]));
    const expected = new Map(), restore = new Map();
    for (const e of [...batch].reverse()) for (const f of e.files) {
      if (!expected.has(f.path)) expected.set(f.path, f.after); // newest version this batch produced
      restore.set(f.path, f.before);                            // ends at the oldest "before"
    }
    const conflicts = [...expected].filter(([path, content]) => !same(read(path), content)).map(([path]) => path);
    if (conflicts.length && !force) return { ok: false, conflicts, message: `${conflicts.join(', ')} changed after this, maybe by a change on another page. Undo anyway and lose those changes?` };
    const gone = missing(restore);
    if (gone.length) return { ok: false, message: `The saved copy of ${gone.join(', ')} is gone, so this can't be undone.` };
    for (const [path, content] of restore) write(path, content);
    for (const e of batch) e.undone = true;
    save();
    return { ok: true, undone: batch.map((e) => e.label), files: [...restore.keys()] };
  });

  // Redo the page's oldest undone change (redo goes forward one step at a time).
  const redo = (id, force = false) => locked(() => {
    const target = entries.find((e) => e.id === id);
    const next = target && entries.find((e) => e.undone && keyOf(e) === keyOf(target));
    if (!next || next.id !== id) return { ok: false, message: 'Redo the earlier undone change first.' };
    const conflicts = next.files.filter((f) => !same(read(f.path), f.before)).map((f) => f.path);
    if (conflicts.length && !force) return { ok: false, conflicts, message: `${conflicts.join(', ')} changed since. Redo anyway and lose those changes?` };
    const gone = missing(next.files.map((f) => [f.path, f.after]));
    if (gone.length) return { ok: false, message: `The saved copy of ${gone.join(', ')} is gone, so this can't be redone.` };
    for (const f of next.files) write(f.path, f.after);
    next.undone = false;
    save();
    return { ok: true, redone: next.label, files: next.files.map((f) => f.path) };
  });

  // Only this site's changes (and old ones that touched no site's own files).
  const list = () => (load(), entries).filter((e) => !site || [site, ''].includes(siteOf(e))).map((e) => ({ id: e.id, label: e.label, at: e.at, page: pageOf(e), shared: !!e.shared, undone: !!e.undone, files: e.files.map((f) => f.path) })).reverse();

  return { snapshot, record, undo, redo, list };
}

// Self-check: node packages/claude-edit/history.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const assert = (await import('node:assert')).strict;
  const dir = mkdtempSync(join(tmpdir(), 'history-'));
  writeFileSync(join(dir, 'a.astro'), 'one');
  const h = createHistory(dir, '', { binary: 'packages/images' });
  let before = h.snapshot(); writeFileSync(join(dir, 'a.astro'), 'two'); const e1 = h.record('first', before);
  before = h.snapshot(); writeFileSync(join(dir, 'a.astro'), 'three'); writeFileSync(join(dir, 'b.css'), 'new'); const e2 = h.record('second', before);
  assert.equal(h.record('nothing', h.snapshot()), null);
  assert.deepEqual(h.list().map((e) => e.label), ['second', 'first']);
  assert.ok(h.undo(e1.id).ok);                                   // back to before "first": undoes both
  assert.equal(readFileSync(join(dir, 'a.astro'), 'utf8'), 'one');
  assert.ok(!existsSync(join(dir, 'b.css')));                   // file created by "second" is removed
  assert.equal(h.redo(e2.id).ok, false);                         // must redo "first" first
  assert.ok(h.redo(e1.id).ok);
  assert.equal(readFileSync(join(dir, 'a.astro'), 'utf8'), 'two');
  writeFileSync(join(dir, 'a.astro'), 'edited elsewhere');
  assert.equal(h.undo(e1.id).ok, false);                         // conflict is reported…
  assert.ok(h.undo(e1.id, true).ok);                             // …and can be forced
  assert.equal(readFileSync(join(dir, 'a.astro'), 'utf8'), 'one');
  assert.equal(createHistory(dir).list().length, 2);             // survives a restart

  // Per page: undo on one page never undoes another page's changes.
  const pages = join(dir, 'src', 'pages'); (await import('node:fs')).mkdirSync(pages, { recursive: true });
  writeFileSync(join(pages, 'index.astro'), 'home 1'); writeFileSync(join(pages, 'about.astro'), 'about 1');
  before = h.snapshot(); writeFileSync(join(pages, 'index.astro'), 'home 2'); const home = h.record('home edit', before, '/');
  before = h.snapshot(); writeFileSync(join(pages, 'about.astro'), 'about 2'); const about = h.record('about edit', before, '/about');
  assert.equal(home.shared, false);
  assert.ok(h.undo(home.id).ok);                                 // newer change on /about is NOT undone with it
  assert.equal(readFileSync(join(pages, 'index.astro'), 'utf8'), 'home 1');
  assert.equal(readFileSync(join(pages, 'about.astro'), 'utf8'), 'about 2');
  assert.ok(h.redo(home.id).ok);
  // A shared file changed later from another page is reported, not overwritten.
  before = h.snapshot(); writeFileSync(join(dir, 'theme.css'), 'red'); const theme = h.record('theme from home', before, '/');
  assert.equal(theme.shared, true);
  before = h.snapshot(); writeFileSync(join(dir, 'theme.css'), 'blue'); h.record('theme from about', before, '/about');
  assert.equal(h.undo(theme.id).ok, false);
  assert.equal(readFileSync(join(dir, 'theme.css'), 'utf8'), 'blue');
  assert.deepEqual(h.list().filter((e) => e.page === '/about').map((e) => e.label), ['theme from about', 'about edit']);
  // Binary image files: bytes are restored exactly, a file the change created is removed again.
  const imgs = join(dir, 'packages', 'images', 'gallery', 'f'); (await import('node:fs')).mkdirSync(imgs, { recursive: true });
  const jpg = join(imgs, 'a.jpg'), one = Buffer.from([0xff, 0xd8, 1, 2, 3]), two = Buffer.from([0xff, 0xd8, 9, 9]);
  writeFileSync(jpg, one);
  before = h.snapshot(); writeFileSync(jpg, two); writeFileSync(join(imgs, 'b.webp'), two); const bin = h.record('image', before, '/');
  assert.equal(bin.files.length, 2);
  assert.ok(h.undo(bin.id).ok);
  assert.deepEqual(readFileSync(jpg), one);
  assert.ok(!existsSync(join(imgs, 'b.webp')));
  assert.ok(existsSync(imgs));                                   // a folder that still has files stays
  assert.ok(h.redo(bin.id).ok);
  assert.deepEqual(readFileSync(jpg), two);
  // Sites share the file: "/" on one site is another page than "/" on the other.
  const siteA = createHistory(dir, 'a'), siteB = createHistory(dir, 'b');
  for (const s of ['a', 'b']) { mkdirSync(join(dir, 'apps', s, 'src', 'pages'), { recursive: true }); writeFileSync(join(dir, 'apps', s, 'src', 'pages', 'index.astro'), `${s} 1`); }
  before = siteA.snapshot(); writeFileSync(join(dir, 'apps', 'a', 'src', 'pages', 'index.astro'), 'a 2'); const q = siteA.record('a home', before, '/');
  before = siteB.snapshot(); writeFileSync(join(dir, 'apps', 'b', 'src', 'pages', 'index.astro'), 'b 2'); const pl = siteB.record('b home', before, '/');
  assert.ok(!siteB.list().some((e) => e.id === q.id));              // not offered on the other site
  assert.ok(siteB.undo(pl.id).ok);
  assert.equal(readFileSync(join(dir, 'apps', 'a', 'src', 'pages', 'index.astro'), 'utf8'), 'a 2');
  assert.ok(siteA.undo(q.id).ok);                                  // the same "/" on the other site: only its own change
  assert.equal(readFileSync(join(dir, 'apps', 'b', 'src', 'pages', 'index.astro'), 'utf8'), 'b 1');
  console.log('history self-check passed');
}
