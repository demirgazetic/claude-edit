// "Edit with Claude", the dev-server side as a whole: the integration's hooks with a stand-in dev server, toolbar and
// `claude` (a script that edits a page the way Claude would and answers in stream-json).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import claudeEdit from '../index.mjs';

const bin = mkdtempSync(join(tmpdir(), 'ce-bin-'));
writeFileSync(join(bin, 'claude'), `#!${process.execPath}
const fs = require('fs');
require('readline').createInterface({ input: process.stdin }).on('line', () => {
  if (process.env.FAKE_CLAUDE === 'die') process.kill(process.pid, 'SIGKILL');
  fs.writeFileSync('apps/site/src/pages/index.astro', '<h1>Edited by Claude</h1>\\n'); // no Edit tool call in the stream
  console.log(JSON.stringify({ type: 'result', result: 'Changed the title.' }));
});
`);
chmodSync(join(bin, 'claude'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what) {
  for (let i = 0; i < 500; i++) { if (check()) return; await sleep(30); } // the first run of a new script can take seconds (macOS checks it)
  assert.fail(`timed out waiting for ${what}`);
}

// A stand-in image library adapter: a focal point writes a file (a history entry), a suggestion without a key is an error.
const images = {
  dir: 'images',
  create: ({ root, history }) => ({
    focus({ key, x, y, page }) {
      const before = history.snapshot();
      writeFileSync(join(root, 'images', 'focal-points.json'), JSON.stringify({ [key]: { x, y } }));
      return { ok: true, key, x, y, id: history.record(`Focal point: ${key.split('/').pop()}`, before, page)?.id };
    },
    suggest({ key }) { if (!key) throw Object.assign(new Error('Which image?'), { expose: true }); return { ok: true, key, x: 0.5, y: 0.5 }; },
  }),
};

const servers = [];
after(() => { for (const s of servers) s.send('claude-edit:reset'); }); // stops the claude processes

function devServer() {
  const root = mkdtempSync(join(tmpdir(), 'ce-server-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
  mkdirSync(join(root, 'apps', 'site', 'src', 'pages'), { recursive: true });
  writeFileSync(join(root, 'apps', 'site', 'src', 'pages', 'index.astro'), '<h1>Hello</h1>\n');
  mkdirSync(join(root, 'images'), { recursive: true });
  const handlers = new Map(), sent = [], reloads = [], warnings = [], hot = new EventEmitter(), watcher = new EventEmitter();
  const ws = { send: (p) => reloads.push(p) }; // the integration puts its reload gate in front of this
  let middleware, failSend = null;
  const { hooks } = claudeEdit({ images });
  hooks['astro:config:setup']({ command: 'dev', config: { root: pathToFileURL(join(root, 'apps', 'site') + '/'), srcDir: pathToFileURL(join(root, 'apps', 'site', 'src') + '/') }, addDevToolbarApp() {}, injectScript() {} });
  hooks['astro:server:setup']({
    toolbar: { on: (e, fn) => handlers.set(e, fn), send: (e, d) => { if (e === failSend) throw new Error(`${e} failed`); sent.push([e, d]); } },
    logger: { warn: (m) => warnings.push(m) },
    server: { ws, hot, watcher, middlewares: { use: (m) => { middleware = m; } } },
  });
  const events = () => sent.filter(([e]) => e === 'claude-edit:event').map(([, d]) => d);
  // An HTTP request to the image endpoints whose body arrives when `finish()` is called.
  const request = (action, json) => {
    const req = Object.assign(new PassThrough(), { method: 'POST', url: `/__claude-edit/images/${action}`, headers: { 'x-claude-edit': '1', host: 'localhost:4321', origin: 'http://localhost:4321' } });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); this.done(); } };
    const answered = new Promise((r) => { res.done = r; });
    middleware(req, res, () => assert.fail('not handled'));
    return { finish: () => { req.end(JSON.stringify(json)); return answered.then(() => res); } };
  };
  return servers[servers.push({ root, ws, send: (e, d = {}, client = 'tab') => handlers.get(e)(d, client), sent, events, reloads, warnings, watcher, request, failOn: (e) => { failSend = e; } }) - 1];
}

test('a git checkout that makes the site unreadable while it is read does not take the dev server down', () => {
  const s = devServer(), locked = join(s.root, 'apps', 'site', 'src', 'components');
  mkdirSync(locked);
  chmodSync(locked, 0);
  try {
    assert.doesNotThrow(() => s.watcher.emit('all', 'add', join(s.root, 'apps', 'site', 'src', 'pages', 'new.astro')));
  } finally { chmodSync(locked, 0o755); }
});

test("Claude's edits are undoable even when the stream shows no Edit or Write call", async () => {
  const s = devServer();
  s.send('claude-edit:ask', { instruction: 'Change the title', page: '/' });
  await until(() => s.events().some((e) => e.kind === 'idle'), 'the turn to end');
  const history = s.sent.filter(([e]) => e === 'claude-edit:history').at(-1)?.[1].entries ?? [];
  assert.deepEqual(history.map((e) => e.label), ['Change the title']);
});

test("Claude's next turn waits for an image change that is under way", async () => {
  const s = devServer();
  const focus = s.request('focus', { key: 'img:uploads/a', x: 0.2, y: 0.3, page: '/' });
  s.send('claude-edit:ask', { instruction: 'Change the title', page: '/' });
  await sleep(50);
  assert.ok(!s.events().some((e) => e.kind === 'busy'), 'Claude started while the image change was being written');
  assert.equal((await focus.finish()).body.ok, true);
  await until(() => s.events().some((e) => e.kind === 'idle'), 'the turn to end');
  const labels = s.sent.filter(([e]) => e === 'claude-edit:history').at(-1)[1].entries.map((e) => e.label);
  assert.deepEqual(labels, ['Change the title', 'Focal point: a']); // two entries, neither holding the other's change
});

test('with two image requests at once, reloads wait until both are answered', async () => {
  const s = devServer();
  const one = s.request('suggest', {}), two = s.request('suggest', {}); // (no key: answered with an error, no file changes)
  s.ws.send({ type: 'full-reload', path: '*' }); // Astro reloads after some file change meanwhile
  await one.finish();
  await sleep(500);
  assert.equal(s.reloads.length, 0, 'reloaded before request two was answered');
  await two.finish();
  await sleep(500);
  assert.equal(s.reloads.length, 1);
});

test('an undo that fails while writing still answers the page', () => {
  const s = devServer(), page = join(s.root, 'apps', 'site', 'src', 'pages', 'index.astro');
  s.send('claude-edit:text', { id: 1, file: page, loc: '1:5', oldText: 'Hello', newText: 'Hi', page: '/' });
  const id = s.sent.find(([e]) => e === 'claude-edit:history')[1].entries[0].id;
  chmodSync(page, 0o444);
  try { s.send('claude-edit:undo', { id }); } finally { chmodSync(page, 0o644); }
  const answer = s.sent.find(([e]) => e === 'claude-edit:restore-result')?.[1];
  assert.equal(answer?.ok, false);
});

test('an image change whose follow-up fails does not take the dev server down', async () => {
  const s = devServer();
  s.failOn('claude-edit:history');
  let crashed = null;
  const onCrash = (err) => { crashed = err; };
  process.prependListener('uncaughtException', onCrash);
  try {
    assert.equal((await s.request('focus', { key: 'img:uploads/a', x: 0.2, y: 0.3, page: '/' }).finish()).body.ok, true);
    await sleep(500);
  } finally { process.off('uncaughtException', onCrash); }
  assert.equal(crashed, null);
});

test('a Claude process killed by a signal is reported, not silently dropped', async () => {
  const s = devServer();
  process.env.FAKE_CLAUDE = 'die';
  try {
    s.send('claude-edit:ask', { instruction: 'Change the title', page: '/' });
    await until(() => s.events().some((e) => e.kind === 'idle'), 'the turn to end');
  } finally { delete process.env.FAKE_CLAUDE; }
  assert.ok(s.events().some((e) => e.kind === 'error'));
});
