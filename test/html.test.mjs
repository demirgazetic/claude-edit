// "Edit with Claude" on plain HTML: every element is mapped to the spot right after its start tag, and a direct text
// save through that spot writes the file as HTML (no Astro entities).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotate, htmlProject } from '../html.mjs';
import { replaceText } from '../index.mjs';

const page = '<!doctype html>\r\n<html lang="hr"><head><title>O nama | Site</title><style>p>a{}</style></head>\r\n<body class="a" data-x="1>2">\n  <h1>Hi</h1><br/><img src=x alt="a>b">\n<!-- <p>no</p> --><script>if(a<b){document.write("<p>x</p>")}</script>\n<p>Done {here}</p></body></html>\n';

test('each element: the character before its spot is the ">" of its own start tag; nothing in head, comments or scripts', () => {
  const lines = page.split('\n'), tags = [];
  for (const [, l, c] of annotate(page, '/s/index.html').matchAll(/ data-ce-src="\/s\/index\.html:(\d+):(\d+)"/g)) {
    const at = lines.slice(0, l - 1).reduce((n, x) => n + x.length + 1, 0) + Number(c) - 1;
    assert.equal(page[at - 1], '>');
    tags.push(/^<(\w+)/.exec(page.slice(page.lastIndexOf('<', at - 1)))[1]);
  }
  assert.deepEqual(tags, ['body', 'h1', 'br', 'img', 'script', 'p']);
});

test('a text save in an .html file: written in place, { } stay as they are', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-html-'));
  writeFileSync(join(dir, 'index.html'), page);
  const loc = /<p data-ce-src="[^"]*:(\d+:\d+)"/.exec(annotate(page, 'index.html'))[1];
  assert.ok(replaceText(dir, { file: 'index.html', loc, oldText: 'Done {here}', newText: 'Done {there} & <more>' }));
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<p>Done \{there\} &amp; &lt;more&gt;<\/p>/);
});

test('pages of a plain site: addresses, titles and languages; only .html files are pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-site-'));
  writeFileSync(join(dir, 'index.html'), page);
  writeFileSync(join(dir, 'about.html'), '<html lang="en"><title>About</title></html>');
  const p = htmlProject(dir, dir);
  assert.deepEqual(p.pages(), [{ path: '/', title: 'O nama', lang: 'hr' }, { path: '/about.html', title: 'About', lang: 'en' }]);
  assert.equal(p.route('blog/index.html'), '/blog/');
  assert.equal(p.route('style.css'), null);
  assert.equal(p.route('node_modules/x/index.html'), null);
});
