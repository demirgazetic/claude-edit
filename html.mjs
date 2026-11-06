// Plain HTML pages for the editor: where each element is written, the site's pages and their addresses.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Their content is text, not elements (or, for template, not on the page)
const RAW = new Set(['script', 'style', 'textarea', 'title', 'template', 'noscript', 'iframe', 'xmp', 'svg', 'math']);
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** The page with data-ce-src="<file>:<line>:<column>" on each element of its body: the spot right after the element's
 * start tag in `html`, as Astro's data-astro-source-loc (replaceText in index.mjs starts there). Nothing in <head>. */
export function annotate(html, file) {
  const out = [];
  let i = 0, last = 0, line = 1, lineStart = 0, inHead = false;
  const advance = (to) => { for (; i < to; i++) if (html[i] === '\n') { line++; lineStart = i + 1; } };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    advance(lt);
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i + 4); advance(end < 0 ? html.length : end + 3); continue; }
    if (html[i + 1] === '!' || html[i + 1] === '?') { const end = html.indexOf('>', i); advance(end < 0 ? html.length : end + 1); continue; }
    const close = html[i + 1] === '/';
    const name = /^[a-zA-Z][\w:-]*/.exec(html.slice(i + 1 + close, i + 64))?.[0]?.toLowerCase();
    if (!name) { advance(i + 1); continue; }
    // The tag runs to its ">", skipping quoted attribute values (they may hold a ">").
    let j = i + 1 + close + name.length, quote = null;
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break;
    }
    if (j >= html.length) break; // an unfinished tag: leave the rest as it is
    const end = j + 1;
    if (close) { if (name === 'head') inHead = false; advance(end); continue; }
    if (name === 'head') inHead = true;
    if (name === 'body') inHead = false;
    if (!inHead && name !== 'html' && name !== 'head') {
      advance(end);
      const at = html[j - 1] === '/' ? j - 1 : j; // <br/>: before the "/"
      out.push(html.slice(last, at), ` data-ce-src="${escapeAttr(file)}:${line}:${end - lineStart + 1}"`);
      last = at;
    } else advance(end);
    if (RAW.has(name) && html[j - 1] !== '/') {
      const stop = html.toLowerCase().indexOf(`</${name}`, end);
      advance(stop < 0 ? html.length : stop);
    }
  }
  out.push(html.slice(last));
  return out.join('');
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'out', '.git']);
/** Every .html file under `dir` (absolute), as paths relative to it (posix). */
const htmlFiles = (dir, sub = '') => readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((d) => {
  if (d.name.startsWith('.') || SKIP.has(d.name)) return [];
  const rel = sub ? `${sub}/${d.name}` : d.name;
  return d.isDirectory() ? htmlFiles(dir, rel) : /\.html?$/i.test(d.name) ? [rel] : [];
});

/** The address of a page file relative to the site folder: index.html → /, about.html → /about.html, blog/index.html → /blog/ */
export const htmlRoute = (rel) => `/${rel.replace(/(^|\/)index\.html?$/i, '$1')}`;

/** A plain HTML site served from `dir`, for startEditor (index.mjs): its pages, routes and the rules Claude follows. */
export function htmlProject(root, dir) {
  const base = relative(root, dir).split(sep).join('/');
  const inSite = (file) => (base ? (file.startsWith(`${base}/`) ? file.slice(base.length + 1) : null) : file);
  return {
    kind: 'website',
    rules: `- Write visible text directly in the HTML, so editors can click it later.
- To add a section or block, copy the markup and classes already used on the page or the site's other pages.`,
    pagesDir: base,
    dirs: [], // plain pages import nothing: every element is written in its own page
    route: (file) => { const rel = inSite(file); return rel !== null && /\.html?$/i.test(rel) && !rel.split('/').some((p) => SKIP.has(p) || p.startsWith('.')) ? htmlRoute(rel) : null; },
    pages: () => htmlFiles(dir).map((rel) => {
      const text = readFileSync(join(dir, rel), 'utf8');
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1].trim() ?? '';
      return { path: htmlRoute(rel), title: title.split(' | ')[0].trim(), lang: /<html[^>]*\slang=["']?([\w-]+)/i.exec(text)?.[1] ?? '' };
    }).sort((a, b) => a.path.localeCompare(b.path)),
  };
}
