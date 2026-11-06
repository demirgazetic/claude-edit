// "Edit with Claude": the typo check. English (British or American) and Bosnian pages, the shared word list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSpelling } from '../spelling.mjs';

const words = join(mkdtempSync(join(tmpdir(), 'ce-words-')), 'words.txt');
const spelling = createSpelling(pathToFileURL(words));

test('English: British and American spellings pass, typos and unknown names are flagged', async () => {
  assert.deepEqual(await spelling.check('en', ['analyse', 'organization', 'long-term', 'infrastucture', 'Acmeo']), ['infrastucture', 'Acmeo']);
  assert.deepEqual(await spelling.suggest('en', 'infrastucture'), ['infrastructure', 'infrastructural']);
});

test('Bosnian: ijekavian and Bosnian forms and English terms pass', async () => {
  const ok = ['vrijednost', 'hiljada', 'historija', 'definisati', 'preduzeće', 'Uslovi', 'hosting', 'cloud'];
  assert.deepEqual(await spelling.check('bs-BA', [...ok, 'greškaa']), ['greškaa']);
  assert.equal((await spelling.suggest('bs', 'greškaa')).includes('greška'), true);
});

test('no all-caps suggestions for an ordinary word', async () => {
  assert.equal((await spelling.suggest('en', 'jkk')).some((s) => s === s.toUpperCase()), false);
});

test('the word list: added words pass on every page, kept sorted, nothing else goes in', async () => {
  assert.equal(spelling.add('Acmeo'), true);
  assert.equal(spelling.add('EnergyNx'), true);
  assert.equal(spelling.add('acmeo'), true); // already there, any case
  assert.equal(spelling.add('<script>'), false);
  assert.deepEqual(await spelling.check('en', ['Acmeo', 'acmeo', 'EnergyNx']), []);
  assert.deepEqual(readFileSync(words, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')), ['Acmeo', 'EnergyNx']);
});

test('a language without a dictionary checks nothing', async () => {
  assert.deepEqual(await spelling.check('de', ['Wörterbuch', 'xyzzy']), []);
});
