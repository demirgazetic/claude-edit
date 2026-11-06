// "Edit with Claude": which pages use each component ("Changes N pages"), kept current one file at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pageIndex } from '../pages.mjs';
import { pageLang } from '../index.mjs';

test('a changed file is read again on its own: new and removed imports change the pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ce-usage-'));
  const put = (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text); };
  put('apps/demo/src/pages/index.astro', "---\nimport Hero from '../components/Hero.astro';\n---\n<Hero />\n");
  put('apps/demo/src/pages/about.astro', '<h1>About</h1>\n');
  put('apps/demo/src/components/Hero.astro', "---\nimport Button from './Button.astro';\n---\n<Button />\n");
  put('apps/demo/src/components/Button.astro', '<a>Go</a>\n');
  const index = pageIndex(dir, { dirs: ['apps/demo/src'], pages: 'apps/demo/src/pages' });
  assert.deepEqual(index.routes().get('apps/demo/src/components/Button.astro'), ['/'], 'through Hero');
  put('apps/demo/src/pages/about.astro', "---\nimport Hero from '../components/Hero.astro';\n---\n<Hero />\n");
  assert.equal(index.update('apps/demo/src/pages/about.astro'), true);
  assert.deepEqual(index.routes().get('apps/demo/src/components/Button.astro'), ['/', '/about']);
  put('apps/demo/src/components/Hero.astro', '<h1>No button</h1>\n');
  index.update('apps/demo/src/components/Hero.astro');
  assert.equal(index.routes().get('apps/demo/src/components/Button.astro'), undefined);
  assert.equal(index.update('apps/other/src/pages/index.astro'), false, 'another site');
  // A plain Astro project: src/ at the repo root.
  put('src/pages/index.astro', "---\nimport Hero from '../components/Hero.astro';\n---\n<Hero />\n");
  put('src/components/Hero.astro', '<h1>Hi</h1>\n');
  assert.deepEqual(pageIndex(dir, { dirs: ['src'], pages: 'src/pages' }).routes().get('src/components/Hero.astro'), ['/']);
  assert.equal(index.update('apps/demo/src/styles.css'), false, 'not a source file');
});

test('pageLang: the locale whose path the address starts with, else the default', () => {
  const i18n = { defaultLocale: 'en', locales: ['en', { path: 'bs-ba', codes: ['bs'] }] };
  assert.equal(pageLang(i18n, '/services'), 'en');
  assert.equal(pageLang(i18n, '/bs-ba'), 'bs');
  assert.equal(pageLang(i18n, '/bs-ba/o-nama'), 'bs');
  assert.equal(pageLang(i18n, '/bs-bank'), 'en');
  assert.equal(pageLang({ defaultLocale: 'bs', locales: ['bs'] }, '/kontakt'), 'bs');
  assert.equal(pageLang(undefined, '/'), '');
});
