// "Edit with Claude": edit the page you see in the dev server, backed by ONE long-lived Claude Code session.
// Hosts: this Astro integration (a dev toolbar app) and the Vite plugin in vite.mjs (any Vite project or plain HTML
// folder, see cli.mjs). Both run startEditor below. Dev only. Runs `claude` with your own login, never an API key.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHistory } from './history.mjs';
import { imageMiddleware } from './images.mjs';
import { pageIndex, routeIn } from './pages.mjs';
import { createSpelling } from './spelling.mjs';

// The project's spelling word list (repo-relative): names, brands and terms, shared by every site and kept in git.
export const WORDS = 'claude-edit-words.txt';

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/><path d="M19 15v4M17 17h4"/></svg>';

const SYSTEM = (kind, rules) => `You are the editing assistant for this ${kind}. Content editors talk to you from the page in the browser; they are not developers.
- Each request names the element they clicked and the file:line:column where it is written. Go straight there. Only search if that spot does not contain the text.
- Make the smallest edit that does what they asked. Keep the existing classes, components and markup style.
${rules}
- If they ask a question, answer briefly without editing.
- Never run builds, installs or shell commands.
- After editing, reply with ONE short sentence saying what you changed. No code, no file paths.`;

const ASTRO_RULES = `- Write visible text directly in the page markup, never as component props, so editors can click it later.
- To add a section or block, use the components described below and copy patterns already used on the page.`;

// Options (all optional):
// - model: the Claude model for the session ('sonnet', 'opus', or a full model id).
// - guide: a repo-relative file (e.g. the component library's README) added to Claude's instructions.
// - sources: more repo-relative folders with components the pages use (a shared UI package), for "Changes N pages".
// - images: the project's image library adapter (see README). Without it the Images view and pictures are off.
export default function claudeEdit(options = {}) {
  let project;
  return {
    name: 'claude-edit',
    hooks: {
      'astro:config:setup': ({ command, config, addDevToolbarApp, injectScript }) => {
        if (command !== 'dev') return; // never part of a build
        const root = repoRoot(fileURLToPath(config.root));
        const posixRel = (abs) => relative(root, abs).split(sep).join('/').replace(/\/$/, '');
        const pagesDir = fileURLToPath(new URL('pages/', config.srcDir)), pagesRel = posixRel(pagesDir);
        project = {
          root,
          site: basename(fileURLToPath(config.root)), // the project folder (apps/<site> in a monorepo)
          kind: 'Astro site', rules: ASTRO_RULES,
          pagesDir: pagesRel, dirs: [posixRel(fileURLToPath(config.srcDir)), ...(options.sources ?? [])],
          route: routeIn(pagesRel),
          pages: () => listPages(pagesDir).map((p) => ({ ...p, lang: pageLang(config.i18n, p.path) })),
        };
        addDevToolbarApp({ id: 'claude-edit', name: 'Edit with Claude', icon: ICON, entrypoint: new URL('./app.js', import.meta.url) });
        // Astro's audit app deletes data-astro-source-* when it starts (on idle). Copy them into memory first;
        // nothing is written into the page's DOM.
        injectScript('head-inline', `document.addEventListener('DOMContentLoaded',()=>{const m=window.__claudeEditSrc=new WeakMap();for(const e of document.querySelectorAll('[data-astro-source-file]'))m.set(e,[e.getAttribute('data-astro-source-file'),e.getAttribute('data-astro-source-loc')])})`);
      },
      'astro:server:setup': ({ toolbar, logger, server }) => {
        if (project) startEditor({ ...options, ...project, toolbar, logger, server });
      },
    },
  };
}

// The editor's server side on a Vite dev server. `toolbar`: { on(event, fn(data, client)), send(event, data) }.
// The project: root (repo), site (a name), kind and rules (for Claude), pagesDir (repo-relative), dirs (sources for
// "Changes N pages"), route(repo-relative file) → its address, null for a file that is no page, pages() → [{ path, title, lang }].
export function startEditor({ root, site, kind, rules, pagesDir: pagesRel, dirs, route, pages, toolbar, logger, server, model = 'sonnet', guide, images: imageLib = null }) {
  if (server.claudeEdit) return; // the Astro integration and the Vite plugin both added: one editor
  server.claudeEdit = true;
  // Every page reload the dev server sends after a file changes goes through the gate (reloadGate below).
  const gate = reloadGate(server.ws.send.bind(server.ws));
  server.ws.send = gate.send;
  const guideText = guide && existsSync(join(root, guide)) ? readFileSync(join(root, guide), 'utf8') : '';
  // The editor's own state (history, image copies for undo) stays out of git in any project.
  mkdirSync(join(root, '.claude-edit'), { recursive: true });
  if (!existsSync(join(root, '.claude-edit', '.gitignore'))) writeFileSync(join(root, '.claude-edit', '.gitignore'), '*\n');
  const isPage = (file) => route(file) !== null;
  const history = createHistory(root, site, { binary: imageLib?.dir, isPage });
  const sendHistory = () => toolbar.send('claude-edit:history', { entries: history.list() });
  // Image changes under way (HTTP, async): Claude's next turn waits for them, or its "before" would include them.
  const imageJobs = new Set();
  const session = createSession({ root, model, route, system: [SYSTEM(kind, rules), imageLib?.prompt, guideText].filter(Boolean).join('\n\n'), logger, history, onHistory: sendHistory, emit: (e) => toolbar.send('claude-edit:event', e), waiting: () => imageJobs.size > 0 });
  // A bug in the editor must never take down the dev server: every handler and timer is isolated.
  const safe = (what, fn) => (...args) => {
    try { fn(...args); } catch (err) { logger.warn(`${what}: ${err.stack ?? err}`); }
  };
  const on = (event, fn) => toolbar.on(event, safe(event, (data, client) => fn(data ?? {}, client)));
  // A tab that is typing holds every reload until it saves or cancels: a reload would throw the typing away
  // (the browser keeps a copy too, see app.js). Claude's edits show up with the reload that follows.
  const typing = new Set();
  on('claude-edit:typing', ({ active }, client) => {
    if (active) { typing.add(client); gate.hold(client); }
    else { typing.delete(client); setTimeout(() => typing.has(client) || gate.release(client), 400); } // a save's write reaches the file watcher within this time
  });
  server.hot.on('vite:client:disconnect', (_, client) => { typing.delete(client); gate.release(client); }); // closed or reloaded

  // "Changes N pages": which pages use each file (usage.mjs), read once and kept current file by file as they change,
  // with each page's title and language. Sent when the page connects and whenever the answer changes.
  let pageUse = pageIndex(root, { dirs, pages: pagesRel }), usageSent = '', usageTimer;
  const sendUsage = (force) => {
    // ponytail: the titles are read from every page file on each change of a source file; cache them if sites grow large
    const msg = JSON.stringify({
      files: Object.fromEntries([...pageUse.routes()].map(([file, routes]) => [join(root, file).split(sep).join('/'), routes])),
      pages: pages(),
    });
    if (force || msg !== usageSent) toolbar.send('claude-edit:usage', JSON.parse(usageSent = msg));
  };
  // (a git checkout can remove or lock folders while they are read)
  server.watcher.on('all', safe('usage', (event, abs) => {
    const file = relative(root, abs).split(sep).join('/');
    if (!['add', 'change', 'unlink'].includes(event) || !pageUse.update(file)) return; // not a source file of this site
    // A new or removed file can change what other files' imports point to: read the site again (rare).
    if (event !== 'change') pageUse = pageIndex(root, { dirs, pages: pagesRel });
    clearTimeout(usageTimer);
    usageTimer = setTimeout(safe('usage', sendUsage), 300);
  }));

  on('claude-edit:hello', () => { toolbar.send('claude-edit:state', { ...session.state(), images: !!imageLib, pagesDir: join(root, pagesRel).split(sep).join('/') }); sendHistory(); sendUsage(true); });
  // Undo / go back / redo. Not while Claude is editing, so the two never write the same file at once.
  // Vite doesn't refresh an image module whose file changed in place (stale size, no reload): drop them all, reload.
  const imagesDir = imageLib && join(root, imageLib.dir) + sep;
  const imagesChanged = () => {
    for (const env of Object.values(server.environments ?? {})) {
      for (const [file, mods] of env.moduleGraph?.fileToModulesMap ?? []) if (file.startsWith(imagesDir)) for (const m of mods) env.moduleGraph.invalidateModule(m);
    }
    server.ws.send({ type: 'full-reload', path: '*' });
  };
  const restore = (action) => ({ id, force }) => {
    if (session.state().busy) return toolbar.send('claude-edit:restore-result', { ok: false, message: 'Wait until Claude is done, then try again.' });
    let result;
    try { result = history[action](Number(id), !!force); } catch (err) {
      logger.warn(`${action}: ${err.stack ?? err}`); // e.g. a file that can't be written: the page still gets an answer
      result = { ok: false, message: `That could not be ${action === 'undo' ? 'undone' : 'redone'}: ${err.message}` };
    }
    toolbar.send('claude-edit:restore-result', { id, action, ...result });
    if (!result.ok) return;
    if (imageLib && result.files.some((f) => f.startsWith(`${imageLib.dir}/`))) imagesChanged();
    const what = action === 'undo' ? (result.undone.length > 1 ? `Undid ${result.undone.length} changes` : `Undid: ${result.undone[0]}`) : `Redid: ${result.redone}`;
    session.note(`${what}. The files are back to how they were.`);
    sendHistory();
  };
  // Images view and "Replace image": HTTP, same-origin only (see images.mjs). Undo goes through the history above.
  // The page must get the answer before it reloads, so reloads wait until the answer is out; then one reload
  // shows the new image (none for an alt text, which changes nothing visible).
  const images = imageLib?.create({ root, site, history });
  if (images) server.middlewares.use(imageMiddleware({
    images,
    busy: () => session.state().busy,
    logger,
    begin: () => { const job = {}; imageJobs.add(job); gate.hold(job); return job; }, // one per request: two can overlap
    end: (r, job) => {
      imageJobs.delete(job);
      session.resume(); // a request that waited for this one
      setTimeout(safe('images', () => {
        // Held reload dropped: a replace sends its own (imagesChanged), an alt text changes nothing visible, a
        // picture for a message no page, a focal-point suggestion no file. A saved focal point lets its reload through.
        gate.release(job, { drop: /^(replace|alt|attach|suggest)/.test(r?.action ?? '') });
        if (r?.action === 'replace') imagesChanged();
        if (!r || r.action.startsWith('attach') || r.action === 'suggest' || (r.action === 'focus' && !r.id)) return; // these change no file
        session.note(r.action === 'alt' ? `Changed an alt text to "${r.text}"` : r.action === 'focus' ? `Set the focal point of ${r.key} to ${Math.round(r.x * 100)}% across, ${Math.round(r.y * 100)}% down` : r.mode === 'everywhere' ? `Replaced the image file of ${r.oldKey}, so every use shows the new picture` : `Changed one use of ${r.oldKey} to ${r.key}`);
        sendHistory();
      }), 400); // the file watcher reports the writes within this time
    },
  }));
  // The link editor's list: every page of this site, read fresh so new pages show up.
  on('claude-edit:pages', () => toolbar.send('claude-edit:pages', { pages: pages() }));
  // Typos: the page's words against its language's dictionary and the project's word list (spelling.mjs)
  const spelling = createSpelling(join(root, WORDS));
  const warn = (err) => logger.warn(`spelling: ${err.stack ?? err}`);
  on('claude-edit:spell', ({ id, lang, words }) => spelling.check(lang, words).then((bad) => toolbar.send('claude-edit:spell-result', { id, bad }), warn));
  on('claude-edit:suggest', ({ id, lang, word }) => spelling.suggest(lang, word).then((suggestions) => toolbar.send('claude-edit:suggest-result', { id, suggestions }), warn));
  on('claude-edit:word', ({ id, word }) => {
    const ok = spelling.add(word);
    toolbar.send('claude-edit:word-result', { id, word, ok });
    if (ok) session.note(`Added "${word}" to the spelling word list (${WORDS})`);
  });
  on('claude-edit:undo', restore('undo'));
  on('claude-edit:redo', restore('redo'));
  on('claude-edit:reset', () => session.reset());
  on('claude-edit:ask', ({ instruction, label, target, page, image, check, attachments }) => {
    if (typeof instruction !== 'string' || !instruction.trim()) return;
    const wanted = images && Array.isArray(attachments) ? attachments.slice(0, 6) : [];
    const where = !target ? '' :
      `Element: <${target.tag}> written at ${rel(root, target.file)}:${target.loc}\nIts text: "${String(target.text).slice(0, 400)}"\n` +
      (target.usedAt
        ? `That element is inside a component. This instance is used at ${rel(root, target.usedAt.file)}:${target.usedAt.loc}. Edit the instance there, not the component file, unless they ask to change it everywhere.\n`
        : '');
    // Pictures the editor attached: Claude sees them and gets their library keys, to use them on a page as they are.
    Promise.all(wanted.map((a) => images.picture(String(a.key)).then((p) => ({ ...p, key: String(a.key), name: String(a.name || a.key).slice(0, 120) })))).then((pictures) => {
      const shot = image ? `${pictures.length ? 'The first image' : 'The attached screenshot'} is what the editor sees right now; the selected element is outlined in red.\n` : '';
      const listed = pictures.length
        ? `The editor attached ${pictures.length === 1 ? 'this picture' : 'these pictures'} (shown ${image ? 'after the screenshot' : 'above'}, in this order). Each is in the image library; put one on a page by its key, like the other images:\n${pictures.map((p, n) => `${n + 1}. ${p.name}: ${p.key} (${p.path})`).join('\n')}\n`
        : '';
      // label: a short version for the chat bubble (the inspector sends a long, precise instruction)
      session.ask(`Page: ${page}\n${where}${shot}${listed}Request: ${instruction}`, { instruction: typeof label === 'string' && label ? label : instruction, target, image, pictures, check: !!check, page: String(page || '/') });
    }).catch((err) => toolbar.send('claude-edit:event', { kind: 'error', text: err?.message || 'The attached pictures could not be read.' }));
  });
  on('claude-edit:check', ({ id, image }) => session.check(id, image));
  // Fast path: plain text change written straight into the source, no Claude involved.
  on('claude-edit:text', (req) => {
    // While Claude edits, a direct write would race its edits and end up inside its history entry.
    // Answering "not placed" makes the browser queue it for Claude instead.
    if (session.state().busy) return toolbar.send('claude-edit:text-result', { id: req.id, ok: false });
    let done = false;
    const before = history.snapshot();
    gate.quiet(3000); // the file watcher reports the write within a moment
    try { done = replaceText(root, req); } catch (err) { logger.warn(String(err)); }
    // A save that moved the lines below it lets its reload through: the page gets their new locations from it.
    if (!done || done.moved) gate.quiet(0);
    toolbar.send('claude-edit:text-result', { id: req.id, ok: !!done });
    if (!done) return;
    const link = req.attr === 'href';
    const tab = req.linkTarget === '_blank' ? ' (opens in a new tab)' : req.linkTarget === '' ? ' (opens in the same tab)' : '';
    session.note(link ? `Changed the link to "${req.newText}"${tab}` : `Changed text to "${req.newText}"`);
    session.recorded(history.record(`${link ? 'Link' : 'Text'}: "${String(req.newText).trim().slice(0, 60)}"`, before, String(req.page || '/')));
  });
}

function createSession({ root, model, route, system, logger, emit, history, onHistory, waiting = () => false }) {
  let proc, sessionId, busy = false, turn = null, pendingCheck = null, checkSeq = 0, lastPage = '/';
  const queue = [], log = [], notes = [];

  const push = (entry) => { log.push(entry); if (log.length > 80) log.shift(); emit(entry); };
  // A history entry becomes an "undo-able" row in the chat.
  const recorded = (entry) => {
    if (!entry) return;
    // A page file that did not exist before is a new page: the chat offers to open it.
    const pages = entry.files.filter((f) => f.before === null && route(f.path) !== null).map((f) => route(f.path));
    push({ kind: 'change', id: entry.id, text: `Changed ${entry.files.map((f) => f.path.split('/').pop()).join(', ')}`, pages });
    onHistory();
  };
  // Recorded by comparing the files, not by the tool calls seen: edits can come from other tools (or subagents).
  const recordTurn = () => {
    if (!turn || turn.recorded) return;
    turn.recorded = true;
    try { recorded(history.record(turn.meta.isCheck ? 'Fix after the visual check' : turn.meta.instruction, turn.before, turn.meta.page)); }
    catch (err) { logger.warn(`history: ${err}`); }
  };

  function start() {
    const env = { ...process.env };
    delete env.CLAUDECODE;        // allow starting from a terminal that itself runs Claude Code
    delete env.ANTHROPIC_API_KEY; // force the logged-in subscription instead of API billing
    const p = proc = spawn('claude', [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--model', model,
      '--allowedTools', 'Read,Edit,Write,Glob,Grep', '--disallowedTools', 'Bash,WebFetch,WebSearch',
      '--permission-mode', 'acceptEdits',
      '--strict-mcp-config', '--setting-sources', 'project,local', // skip MCP servers, global hooks and plugins: faster turns
      '--append-system-prompt', system,
    ], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: p.stdout }).on('line', (line) => proc === p && onLine(line));
    p.stderr.on('data', (d) => logger.warn(String(d).trim()));
    p.stdin.on('error', (err) => logger.warn(`claude stdin: ${err.message}`)); // EPIPE if it dies mid-write; 'exit' handles the rest
    p.on('error', (err) => {
      if (proc !== p) return;
      proc = undefined;
      push({ kind: 'error', text: `Could not start claude (${err.message}). Is Claude Code installed and logged in?` });
      if (busy) finish();
    });
    p.on('exit', (code, signal) => {
      if (proc !== p) return; // an old session that was reset
      if (code || signal) push({ kind: 'error', text: `Claude session stopped (${code ? `exit ${code}` : signal}). The next request starts a new one.` });
      proc = undefined; sessionId = undefined;
      if (busy) finish();
    });
  }

  function onLine(line) {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      sessionId = ev.session_id;
      emit({ kind: 'session', sessionId });
    } else if (ev.type === 'assistant') {
      for (const block of ev.message?.content ?? []) {
        if (block.type !== 'tool_use') continue;
        push({ kind: 'tool', text: describeTool(root, block) });
        if ((block.name === 'Edit' || block.name === 'Write') && turn) turn.edited = true;
      }
    } else if (ev.type === 'result') {
      const text = ev.is_error ? `Error: ${ev.result ?? ev.subtype}` : ev.result?.trim() || 'Done.';
      push({ kind: ev.is_error ? 'error' : 'assistant', text, ms: ev.duration_ms });
      recordTurn();
      // After an edit, ask the browser for an "after" screenshot so Claude can look for visual bugs.
      // Only once per request: the check turn itself never triggers another check.
      if (!ev.is_error && turn?.edited && turn.meta.check && !turn.meta.isCheck) {
        pendingCheck = { id: ++checkSeq };
        push({ kind: 'info', text: 'Taking a screenshot to check the result…' });
        emit({ kind: 'check', id: pendingCheck.id });
      }
      finish();
    }
  }

  function finish() {
    recordTurn(); // also covers a session that died mid-edit
    busy = false;
    turn = null;
    emit({ kind: 'idle' });
    next();
  }

  function next() {
    if (busy || !queue.length || waiting()) return;
    if (!proc) start();
    busy = true;
    const { prompt, meta } = queue.shift();
    turn = { meta, edited: false, before: history.snapshot() };
    if (meta.page) lastPage = meta.page;
    const text = (notes.length ? `(Since your last turn, outside of you: ${notes.splice(0).join('; ')}. Re-read before editing those files.)\n` : '') + prompt;
    if (meta.isCheck) push({ kind: 'info', text: 'Claude is checking the screenshot…' });
    else push({ kind: 'user', text: meta.instruction, shot: !!meta.image, pictures: meta.pictures?.map((p) => ({ key: p.key, name: p.name })), target: meta.target && { tag: meta.target.tag, text: String(meta.target.text).slice(0, 80) } });
    emit({ kind: 'busy' });
    const content = [{ type: 'text', text }];
    content.unshift(...(meta.pictures ?? []).map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } })));
    if (meta.image) content.unshift({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: meta.image } });
    proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  }

  return {
    ask(prompt, meta) { pendingCheck = null; queue.push({ prompt, meta }); next(); },
    check(id, image) {
      if (!pendingCheck || pendingCheck.id !== id) return; // stale, or another tab already sent it
      pendingCheck = null;
      if (!image) return push({ kind: 'info', text: 'Could not take the check screenshot; skipped.' });
      queue.push({
        prompt: 'This is a screenshot of the same area AFTER your change. Look for visual bugs: overlapping or cut-off text, broken layout, wrong spacing or alignment, unreadable contrast, missing images. If it looks right, reply with one short sentence. If something is wrong, fix it, then say in one sentence what you fixed.',
        meta: { isCheck: true, image, page: lastPage },
      });
      next();
    },
    // Direct text edits go into the transcript so Claude knows about them on the next request.
    note(text) { push({ kind: 'info', text }); notes.push(text); },
    recorded,
    resume: next,
    reset() {
      recordTurn(); // edits Claude already made this turn stay undoable
      queue.length = 0;
      const p = proc; proc = undefined; sessionId = undefined;
      p?.kill();
      log.length = 0; notes.length = 0;
      busy = false; turn = null; pendingCheck = null;
      emit({ kind: 'reset' });
    },
    state: () => ({ busy, log, sessionId, model, pendingCheck, queued: queue.length }), // queued: requests waiting their turn
  };
}

const VERBS = { Read: 'Reading', Edit: 'Editing', Write: 'Writing', Glob: 'Looking for', Grep: 'Searching for' };
function describeTool(root, { name, input = {} }) {
  const what = input.file_path ? rel(root, input.file_path) : input.pattern ?? '';
  return VERBS[name] ? `${VERBS[name]} ${what}` : name;
}

// Text as the browser shows it → a pattern for how the source may write it: as entities (the way replaceText writes
// { } < > &, or &nbsp; &quot;), and any run of white space as any other (the source may wrap the line).
const ENTITY = { '&': '&(?:amp;)?', '<': '(?:<|&lt;)', '>': '(?:>|&gt;)', '{': '(?:\\{|&#123;)', '}': '(?:\\}|&#125;)', '"': '(?:"|&quot;)', "'": "(?:'|&#39;)" };
const sourcePattern = (text) => text.trim().split(/\s+/)
  .map((word) => [...word].map((c) => ENTITY[c] ?? c.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('')).join('(?:\\s|&nbsp;|&#160;)+');
// Written. `moved`: the file has more or fewer lines now, so the locations below it (from page load) are off.
const write = (abs, src, out) => (writeFileSync(abs, out), { moved: out.split('\n').length !== src.split('\n').length });

// Replace the clicked element's text (or, with attr: 'href', its link) in its source file, starting at the element's own location.
// linkTarget (with attr: 'href'): '_blank' opens it in a new tab, '' in the same tab, undefined leaves it as it is.
// Returns false when it isn't there (Claude does it then), else { moved }.
export function replaceText(root, { file, loc, oldText, newText, attr, linkTarget }) {
  if (attr && attr !== 'href') return false;
  // Web, mail and phone links only. Browsers skip tabs, line breaks and control characters in a URL ("java\tscript:").
  const url = attr && newText.replace(/[\x00-\x20]/g, '');
  if (attr && /^[a-z][a-z\d+.-]*:/i.test(url) && !/^(https?|mailto|tel):/i.test(url)) return false;
  if (!attr && !oldText.trim()) return false; // an empty pattern would "find" the start of the element
  const abs = inside(root, file);
  if (!abs) return false;
  const src = readFileSync(abs, 'utf8');
  const [line, col] = loc.split(':').map(Number);
  const start = src.split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
  const old = sourcePattern(oldText);
  let at, length, escaped;
  if (attr) {
    // Astro's location is just after the element's start tag, so the tag is the last "<" before it. It runs to its
    // ">" (the location is from page load: a link saved before without a reload has a longer or shorter tag now).
    // Only a plain quoted value is replaced (href={expr} is left to Claude).
    const tagStart = src.lastIndexOf('<', start - 1), tagEnd = src.indexOf('>', tagStart) + 1;
    const m = new RegExp(`\\shref\\s*=\\s*(["'])(${old})\\1`).exec(src.slice(tagStart, tagEnd));
    if (tagStart < 0 || !m) return false;
    at = tagStart + m.index + m[0].length - m[2].length - 1;
    length = m[2].length;
    escaped = newText.trim().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    if (linkTarget !== undefined) {
      // The whole start tag is rebuilt: new href, target="_blank" right after it or no target at all.
      // ponytail: no rel="noopener"; browsers imply it for target="_blank"
      const tag = src.slice(tagStart, tagEnd), hrefEnd = m.index + m[0].length;
      if (/\starget\s*=\s*\{/.test(tag)) return false; // target={expr}: Claude
      const noTarget = (s) => s.replace(/\s+target\s*=\s*(["'])[^"']*\1/, '');
      const newTag = noTarget(tag.slice(0, m.index)) + tag.slice(m.index, hrefEnd - m[2].length - 1) + escaped + m[1] +
        (linkTarget === '_blank' ? ' target="_blank"' : '') + noTarget(tag.slice(hrefEnd));
      return write(abs, src, src.slice(0, tagStart) + newTag + src.slice(tagEnd));
    }
  } else {
    // ponytail: only looks within the element's first 4000 chars; longer elements fall back to Claude
    const m = new RegExp(old).exec(src.slice(start, start + 4000));
    // Only text written right inside the element counts. Text that comes from a list or an expression ({item.name})
    // isn't there, and the first match further down would be some other text: Claude does those instead.
    if (!m || src.slice(start, start + m.index).trim()) return false;
    at = start + m.index;
    length = m[0].length;
    // { and } start an expression in Astro and MDX markup, so they are written as entities there too.
    escaped = newText.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!/\.html?$/i.test(abs)) escaped = escaped.replace(/{/g, '&#123;').replace(/}/g, '&#125;');
  }
  return write(abs, src, src.slice(0, at) + escaped + src.slice(at + length));
}

// The full-page reloads Astro sends after a file changes:
// - quiet(ms): the next one is dropped. A direct text/link save only changes what the browser already shows, so its
//   reload would just make the page and the panel flash; the server side is still refreshed. 0 ends it.
// - hold(who) / release(who): while anyone holds, reloads wait; one is sent once nobody holds any more (none when
//   every holder released with drop: true). Holders: a tab that is typing, an image request whose answer must reach
//   the page first.
export function reloadGate(send) {
  let quietUntil = 0, held = false, wanted = false;
  const holders = new Set();
  return {
    send(payload, ...rest) {
      if (payload?.type === 'full-reload') {
        if (Date.now() < quietUntil) return void (quietUntil = 0);
        if (holders.size) return void (held = true);
      }
      return send(payload, ...rest);
    },
    quiet(ms) { quietUntil = ms && Date.now() + ms; },
    hold(who) { holders.add(who); },
    release(who, { drop = false } = {}) {
      if (!holders.delete(who)) return;
      wanted ||= !drop; // a reload held for one holder may be another's (Claude's edits while a tab typed)
      if (holders.size) return;
      if (held && wanted) send({ type: 'full-reload', path: '*' });
      held = wanted = false;
    },
  };
}

// Pages of the site for the link editor: address and title, from src/pages. Pages built from [params] are skipped.
export function listPages(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((f) => f.split(sep).join('/'))
    .filter((f) => /\.(astro|mdx?)$/.test(f) && !f.includes('['))
    .map((f) => {
      const title = /\btitle\s*[=:]\s*(["'])(.*?)\1/.exec(readFileSync(join(dir, f), 'utf8'))?.[2];
      return { path: `/${f.replace(/\.(astro|mdx?)$/, '').replace(/(^|\/)index$/, '')}`, title: title?.split(' | ')[0].trim() || '' };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

// The language of a page from the site's i18n config: the locale whose path the address starts with (/bs-ba/… → bs),
// else the default locale.
export function pageLang(i18n, path) {
  for (const l of i18n?.locales ?? []) {
    const [dir, code] = typeof l === 'string' ? [l, l] : [l.path, l.codes[0]];
    if (dir !== i18n.defaultLocale && (path === `/${dir}` || path.startsWith(`/${dir}/`))) return code;
  }
  return i18n?.defaultLocale ?? '';
}

// Only page sources inside the repo can be touched (the files Astro marks elements with), never through a symlink
// that leads out. Null for another kind of file.
function inside(root, file) {
  const abs = realpathSync(resolve(root, file)), base = realpathSync(root);
  if (!abs.startsWith(base + sep)) throw new Error(`Refusing to edit outside the repo: ${file}`);
  return /\.(astro|mdx?|html?)$/i.test(abs) && !relative(base, abs).split(sep).includes('node_modules') ? abs : null;
}

const rel = (root, file) => (isAbsolute(file) ? relative(root, file) : file);

/** The repo a project is in: the nearest folder up with pnpm-workspace.yaml or .git, else the project itself. */
export function repoRoot(dir) {
  for (let d = dir; d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-workspace.yaml')) || existsSync(join(d, '.git'))) return d;
  }
  return dir;
}
