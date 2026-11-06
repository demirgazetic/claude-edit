// Which pages use each source file ("Changes N pages"), from the import graph. Pure: reads source files, no dependencies.
// Paths are repo-relative and posix. Imports resolve relative paths and workspace packages (apps/*, packages/*) by
// their package.json exports; anything else (npm packages, tsconfig aliases) is not followed.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

export const SOURCE = /\.(astro|ts|tsx|mjs|js|md|mdx)$/;
const IMPORT = /^\s*import\s+(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm;

// Workspace packages by name, for imports like '@acme/ui/Card' (exports "./*": "./src/*.astro").
export function packages(root) {
  const map = new Map();
  for (const dir of ['apps', 'packages']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir))) {
      try { const pkg = JSON.parse(readFileSync(join(root, dir, name, 'package.json'), 'utf8')); map.set(pkg.name, { dir: `${dir}/${name}`, exports: pkg.exports ?? {} }); } catch {}
    }
  }
  return map;
}

function resolveImport(root, pkgs, from, spec) {
  let base;
  if (spec.startsWith('.')) base = posix.join(posix.dirname(from), spec);
  else {
    const name = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'), sub = spec.slice(name.length);
    const pkg = pkgs.get(name);
    if (!pkg) return null;
    const exp = typeof pkg.exports === 'string' ? { '.': pkg.exports } : pkg.exports;
    const target = exp[`.${sub}`] ?? (sub && exp['./*']?.replace('*', sub.slice(1)));
    if (typeof target !== 'string') return null;
    base = posix.join(pkg.dir, target);
  }
  for (const ext of ['', '.astro', '.ts', '.mjs', '.js', '/index.ts']) if (existsSync(join(root, base + ext)) && SOURCE.test(base + ext)) return base + ext;
  return null;
}

/** Source files under `dirs` (repo-relative). */
export const filesIn = (root, dirs) => dirs.filter((d) => existsSync(join(root, d)))
  .flatMap((d) => readdirSync(join(root, d), { recursive: true }).map((f) => posix.join(d, String(f).split('\\').join('/')))).filter((f) => SOURCE.test(f));
export const importsOf = (root, pkgs, file, text) => [...text.matchAll(IMPORT)].map((m) => resolveImport(root, pkgs, file, m[1])).filter(Boolean);

/** URL of a page file under `pages` (repo-relative): <pages>/products/index.astro → /products; null for other files. */
export const routeIn = (pages) => (file) => {
  if (!file.startsWith(`${pages}/`)) return null;
  const m = file.slice(pages.length + 1).match(/^(.+)\.(astro|md|mdx)$/);
  return m && `/${m[1].replace(/(^|\/)index$/, '')}`;
};

/** file → routes of the pages that reach it through imports (a page reaches itself), from file → imported files */
export function reachOf(imports, routeOf) {
  const reach = new Map();
  for (const page of [...imports.keys()].filter(routeOf)) {
    const seen = new Set(), stack = [page];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      for (const g of imports.get(f) ?? []) stack.push(g);
    }
    for (const f of seen) (reach.get(f) ?? reach.set(f, []).get(f)).push(routeOf(page));
  }
  for (const routes of reach.values()) routes.sort();
  return reach;
}

/** Which pages use each source file under `dirs`, directly or through other components. `pages`: the pages folder.
 * Read once; update(file) re-reads just that file after a change, routes() answers from memory. */
export function pageIndex(root, { dirs, pages }) {
  const pkgs = packages(root), imports = new Map(), routeOf = routeIn(pages);
  const read = (file) => { try { imports.set(file, importsOf(root, pkgs, file, readFileSync(join(root, file), 'utf8'))); } catch { imports.delete(file); } };
  for (const file of filesIn(root, dirs)) read(file);
  let reach = null;
  return {
    /** A source file under `dirs` changed (repo-relative, posix); false when it isn't one. */
    update(file) {
      if (!SOURCE.test(file) || !dirs.some((d) => file.startsWith(`${d}/`))) return false;
      read(file);
      reach = null;
      return true;
    },
    /** Map: repo-relative file → sorted routes */
    routes: () => (reach ??= reachOf(imports, routeOf)),
  };
}
