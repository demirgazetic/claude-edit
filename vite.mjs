// "Edit with Claude" as a Vite plugin: any Vite project's .html pages, or a plain HTML folder through cli.mjs.
// Dev only (apply: 'serve'). The browser side is client.js; the server side is startEditor (index.mjs).
import { readFileSync } from 'node:fs';
import { basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotate, htmlProject } from './html.mjs';
import { repoRoot, startEditor } from './index.mjs';

const CLIENT = fileURLToPath(new URL('./client.js', import.meta.url)).split(sep).join('/');
const posix = (p) => p.split(sep).join('/');

/** Options: as the Astro integration's (README). */
export default function claudeEdit(options = {}) {
  let config;
  return {
    name: 'claude-edit',
    apply: 'serve',
    configResolved(c) { config = c; },
    transformIndexHtml: {
      order: 'pre', // the page as written, so each location points into the file
      handler(html, ctx) {
        if (!ctx.server) return;
        let out = html;
        // Only a page read straight from its file can be mapped to it (another plugin may have changed it first).
        try { if (ctx.filename && readFileSync(ctx.filename, 'utf8') === html) out = annotate(html, posix(ctx.filename)); } catch {}
        return { html: out, tags: [{ tag: 'script', attrs: { type: 'module', src: `/@fs${CLIENT.startsWith('/') ? '' : '/'}${CLIENT}` }, injectTo: 'body' }] };
      },
    },
    configureServer(server) {
      const root = repoRoot(config.root);
      const hot = server.environments?.client?.hot ?? server.ws;
      startEditor({
        ...options,
        ...htmlProject(root, config.root),
        root,
        site: basename(config.root),
        toolbar: { on: (event, fn) => server.hot.on(event, fn), send: (event, data) => hot.send(event, data) },
        logger: { warn: (m) => config.logger.warn(`[claude-edit] ${m}`) },
        server,
      });
    },
  };
}
