// Spell checking for the editor (dev only): a page's words against the dictionary for its language, plus the
// project's word list (claude-edit-words.txt at the repo root: names, brands and terms everyone accepted). Edit mode underlines what's left.
// Hunspell itself (WebAssembly): the Croatian dictionary needs features simpler checkers lack.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHunspellFromFiles } from 'hunspell-wasm';

// English: British or American spelling is fine (sites mix them). Bosnian has no usable dictionary package
// (dictionary-bs ships web pages, not word lists): a word is fine when the Croatian one knows it (the ijekavian forms:
// vrijednost, hiljada), the Serbian Latin one (definisati, preduzeće, uslovi), or the English ones (the English
// terms these pages use: cloud, hosting, backup).
const DICTS = { en: ['dictionary-en', 'dictionary-en-gb'], bs: ['dictionary-hr', 'dictionary-sr-latn', 'dictionary-en', 'dictionary-en-gb'] };
const LANGS = { en: 'en', bs: 'bs', hr: 'bs', sr: 'bs' };
const HEADER = "# Words the editor's spell check accepts on every site: names, brands and terms. One per line.\n# Added from edit mode (\"Add to the word list\") or by hand.\n";
const WORD = /^\p{L}[\p{L}\p{M}'’.-]{0,47}$/u;

// `file`: the project's word list (a path or file URL), created on the first added word.
export function createSpelling(file) {
  const loading = new Map(); // language → Promise of its dictionaries, loaded on first use
  const dictionaries = (lang) => {
    if (!loading.has(lang)) {
      // Next to the package's index.js, wherever the package manager put it (its exports only name index.js).
      const path = (pkg, ext) => fileURLToPath(new URL(`index.${ext}`, import.meta.resolve(pkg)));
      loading.set(lang, Promise.all(DICTS[lang].map((pkg) => createHunspellFromFiles(path(pkg, 'aff'), path(pkg, 'dic')))));
    }
    return loading.get(lang);
  };
  // Read fresh each time: another site's dev server (or a git pull) may have added words.
  const listed = () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : []);
  const langOf = (lang) => LANGS[String(lang ?? '').toLowerCase().split('-')[0]] ?? null;
  // A word is fine as written, in lower case (a sentence's first word), or as parts of a hyphenated word (long-term).
  const known = (dicts, words, w) =>
    words.has(w.toLowerCase()) || dicts.some((d) => d.testSpelling(w) || d.testSpelling(w.toLowerCase())) ||
    (/[-–]/.test(w) && w.split(/[-–]/).every((part) => part.length < 2 || known(dicts, words, part)));

  return {
    langOf,
    /** The words of `list` that are not known, for a page in `lang` ([] for a language without a dictionary). */
    async check(lang, list) {
      const l = langOf(lang);
      if (!l || !Array.isArray(list)) return [];
      const dicts = await dictionaries(l), words = new Set(listed().map((w) => w.toLowerCase()));
      return [...new Set(list)].slice(0, 5000).filter((w) => typeof w === 'string' && WORD.test(w) && !known(dicts, words, w));
    },
    /** Up to four corrections: one word each (Hunspell also offers splits like "greška a"). */
    async suggest(lang, word) {
      const l = langOf(lang);
      if (!l || !WORD.test(String(word))) return [];
      const all = (await dictionaries(l)).flatMap((d) => d.getSpellingSuggestions(String(word)));
      // An all-caps suggestion (an abbreviation) for a word that isn't one is noise: "jkk" is not "JFK"
      const caps = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
      return [...new Set(all)].filter((s) => !/\s/.test(s) && (caps(String(word)) || !caps(s))).slice(0, 4);
    },
    /** Add a word to the word list (kept sorted, so its changes read well in git). */
    add(word) {
      const w = String(word ?? '').trim();
      if (!WORD.test(w)) return false;
      const words = listed();
      if (!words.some((x) => x.toLowerCase() === w.toLowerCase())) {
        writeFileSync(file, HEADER + [...words, w].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join('\n') + '\n');
      }
      return true;
    },
  };
}
