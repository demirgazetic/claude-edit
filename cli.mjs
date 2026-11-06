#!/usr/bin/env node
// claude-edit [folder] [--port 4321] [--model sonnet]: a plain HTML site (no build tool) in the editor, served by Vite.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import claudeEdit from './vite.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '4321' }, model: { type: 'string' } } });
const root = resolve(positionals[0] ?? '.');
const server = await createServer({
  root,
  configFile: false,
  appType: 'mpa', // /about serves about.html or a 404, never index.html
  plugins: [claudeEdit(values.model ? { model: values.model } : {})],
  // localhost only: the editor's requests are refused from anywhere else (images.mjs)
  server: { host: 'localhost', port: Number(values.port), fs: { allow: [root, fileURLToPath(new URL('.', import.meta.url))] } },
});
await server.listen();
server.printUrls();
