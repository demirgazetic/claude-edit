// "Edit with Claude": typed text is written straight into the source only where the clicked element's own text is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPages, replaceText } from '../index.mjs';

const page = (src) => { const dir = mkdtempSync(join(tmpdir(), 'ce-')); writeFileSync(join(dir, 'p.astro'), src); return dir; };
const loc = (src, tag) => { const i = src.indexOf(tag) + tag.length, lines = src.slice(0, i).split('\n'); return `${lines.length}:${lines.at(-1).length + 1}`; };

test('replaces the text written right inside the element', () => {
  const src = '<h1>Hello world</h1>\n<p>Hello world, again</p>\n';
  const dir = page(src);
  assert.ok(replaceText(dir, { file: 'p.astro', loc: loc(src, '<h1>'), oldText: 'Hello world', newText: 'Hi there' }));
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8'), '<h1>Hi there</h1>\n<p>Hello world, again</p>\n');
});

test('text from an expression is left to Claude, never matched further down', () => {
  const src = '<h3>{item.name}</h3>\n<p>Managed according to ISO 27001 requirements.</p>\n';
  const dir = page(src);
  assert.equal(replaceText(dir, { file: 'p.astro', loc: loc(src, '<h3>'), oldText: 'ISO 27001', newText: 'ISO 9001' }), false);
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8'), src);
});

test('a link can be set to open in a new tab, and back to the same tab', () => {
  const src = '<a class="x" href="/contact">\n  Contact\n</a>\n';
  const dir = page(src), at = loc(src, '<a class="x" href="/contact">');
  assert.ok(replaceText(dir, { file: 'p.astro', loc: at, attr: 'href', oldText: '/contact', newText: 'https://example.com', linkTarget: '_blank' }));
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8'), '<a class="x" href="https://example.com" target="_blank">\n  Contact\n</a>\n');
  // no reload in between: the location is still the one from before the first save
  assert.ok(replaceText(dir, { file: 'p.astro', loc: at, attr: 'href', oldText: 'https://example.com', newText: '/about-us', linkTarget: '' }));
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8'), '<a class="x" href="/about-us">\n  Contact\n</a>\n');
});

test('a target written before href is replaced, a target={expr} is left to Claude', () => {
  const src = "<a target='_self' href=\"/a\">A</a>\n<a href=\"/b\" target={t}>B</a>\n";
  const dir = page(src);
  assert.ok(replaceText(dir, { file: 'p.astro', loc: loc(src, '<a target=\'_self\' href="/a">'), attr: 'href', oldText: '/a', newText: '/a', linkTarget: '_blank' }));
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8').split('\n')[0], '<a href="/a" target="_blank">A</a>');
  const now = readFileSync(join(dir, 'p.astro'), 'utf8');
  assert.equal(replaceText(dir, { file: 'p.astro', loc: loc(now, '<a href="/b" target={t}>'), attr: 'href', oldText: '/b', newText: '/c', linkTarget: '' }), false);
});

test('the link editor lists the site pages with their titles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-pages-'));
  mkdirSync(join(dir, 'bs-ba', 'blog'), { recursive: true });
  writeFileSync(join(dir, 'index.astro'), '<Layout title="Acme Cloud | Home">');
  writeFileSync(join(dir, 'about-us.astro'), '<Layout title="About us | Acme Cloud">');
  writeFileSync(join(dir, 'bs-ba', 'index.astro'), '');
  writeFileSync(join(dir, 'bs-ba', 'blog', '[slug].astro'), '');
  assert.deepEqual(listPages(dir), [{ path: '/', title: 'Acme Cloud' }, { path: '/about-us', title: 'About us' }, { path: '/bs-ba', title: '' }]);
});

test('an empty old text is never "found" (it would insert the new text at the element)', () => {
  const src = '<p></p>\n';
  const dir = page(src);
  assert.equal(replaceText(dir, { file: 'p.astro', loc: loc(src, '<p>'), oldText: ' ', newText: 'Hi' }), false);
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8'), src);
});

test('text saved with { } < > & (written as entities) or a &nbsp; can be edited again', () => {
  const src = '<p>Price</p>\n<h2>Acme&nbsp;Cloud &quot;Pro&quot;</h2>\n';
  const dir = page(src), at = loc(src, '<p>');
  assert.ok(replaceText(dir, { file: 'p.astro', loc: at, oldText: 'Price', newText: '{a} < b & c' }));
  assert.ok(replaceText(dir, { file: 'p.astro', loc: at, oldText: '{a} < b & c', newText: 'Price' }));
  const now = readFileSync(join(dir, 'p.astro'), 'utf8');
  assert.equal(now.split('\n')[0], '<p>Price</p>');
  assert.ok(replaceText(dir, { file: 'p.astro', loc: loc(now, '<h2>'), oldText: 'Acme Cloud "Pro"', newText: 'Acme Cloud' }));
  assert.equal(readFileSync(join(dir, 'p.astro'), 'utf8').split('\n')[1], '<h2>Acme Cloud</h2>');
});

test('only web, mail and phone links are saved, however the scheme is disguised', () => {
  const src = '<a href="/a">A</a>\n';
  const dir = page(src), at = loc(src, '<a href="/a">');
  for (const bad of ['javascript:alert(1)', 'java\tscript:alert(1)', '\x01javascript:alert(1)', 'jav\nascript:x', 'data:text/html,x', 'file:///etc/passwd']) {
    assert.equal(replaceText(dir, { file: 'p.astro', loc: at, attr: 'href', oldText: '/a', newText: bad }), false, JSON.stringify(bad));
  }
  for (const ok of ['/b', '#top', 'https://example.com', 'mailto:a@b.ba', 'tel:+387 33 000']) {
    const old = readFileSync(join(dir, 'p.astro'), 'utf8').match(/href="([^"]*)"/)[1];
    assert.ok(replaceText(dir, { file: 'p.astro', loc: at, attr: 'href', oldText: old, newText: ok }), ok);
  }
});

test('only page sources inside the repo are written, never through a symlink', () => {
  const dir = page('<p>Hi</p>\n'), outside = page('<p>Hi</p>\n');
  mkdirSync(join(dir, '.husky'));
  writeFileSync(join(dir, '.husky', 'pre-commit'), '<p>Hi</p>\n');
  assert.equal(replaceText(dir, { file: '.husky/pre-commit', loc: '1:4', oldText: 'Hi', newText: 'rm -rf ~' }), false);
  symlinkSync(join(outside, 'p.astro'), join(dir, 'link.astro'));
  assert.throws(() => replaceText(dir, { file: 'link.astro', loc: '1:4', oldText: 'Hi', newText: 'Bye' }));
  assert.equal(readFileSync(join(outside, 'p.astro'), 'utf8'), '<p>Hi</p>\n');
});

test('a save that changes the number of lines says so (the locations below it are from page load)', () => {
  const src = '<p>\n  Long text\n  wrapped\n</p>\n<p>Short</p>\n';
  const dir = page(src);
  assert.equal(replaceText(dir, { file: 'p.astro', loc: loc(src, '<p>'), oldText: 'Long text wrapped', newText: 'One line' }).moved, true);
  const now = readFileSync(join(dir, 'p.astro'), 'utf8');
  assert.equal(replaceText(dir, { file: 'p.astro', loc: loc(now, '</p>\n<p>'), oldText: 'Short', newText: 'Tiny' }).moved, false);
});
