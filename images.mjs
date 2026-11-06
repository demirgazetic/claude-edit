// The editor's Images feature, HTTP side (dev only): the routes the panel calls, answered by the project's images
// adapter (the `images` option, see README). Uploads are up to 20 MB; every request must come from the dev page itself.
// An error with `expose: true` (and optionally `status`) is shown to the editor as it is; any other is logged.
export const MAX_UPLOAD = 20 * 1024 * 1024; // bytes

export const PREFIX = '/__claude-edit/images';
const LOCAL_HOST = /^(localhost|[\w-]+\.localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/** Why a request is refused (a short reason), or null when it comes from the dev page on this server. */
export function refuse(req) {
  const h = req.headers;
  // A custom header: another site can't send it without a CORS preflight, which this server never answers.
  if (h['x-claude-edit'] !== '1') return 'missing editor header';
  const host = h.host;
  if (!host || !LOCAL_HOST.test(host.replace(/:\d+$/, ''))) return 'not the local dev server';
  if (h['sec-fetch-site'] && h['sec-fetch-site'] !== 'same-origin') return 'not same-origin';
  // Browsers always send Origin with a POST; a GET from the page itself may leave it out.
  if (!h.origin && req.method !== 'GET') return 'no origin';
  if (h.origin) {
    let origin;
    try { origin = new URL(h.origin); } catch { return 'not same-origin'; }
    if (origin.host !== host || !/^https?:$/.test(origin.protocol)) return 'not same-origin';
  }
  return null;
}

/** The request body, at most `max` bytes (checked before and while reading). */
export function readBody(req, max = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const tooBig = () => Object.assign(new Error('The file is larger than 20 MB.'), { status: 413, expose: true });
    if (Number(req.headers['content-length']) > max) { req.resume(); return reject(tooBig()); }
    const chunks = [];
    let size = 0, done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > max) { done = true; req.resume(); return reject(tooBig()); }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

/** Connect middleware for PREFIX. `busy()`: Claude is editing. `begin()` before a change, `end(result | null, job)` after
 *  the answer is sent (null when nothing changed; job: what begin() returned). */
export function imageMiddleware({ images, busy, begin = () => {}, end = () => {}, logger }) {
  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://dev');
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return next();
    const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
    const why = refuse(req);
    if (why) { req.resume(); return reply(403, { ok: false, message: `Refused: ${why}.` }); }
    if (req.method === 'GET' && url.pathname === PREFIX) {
      try { return reply(200, await images.list()); } catch (err) { logger?.warn(`images: ${err.stack ?? err}`); return reply(500, { ok: false, message: 'Could not read the image library.' }); }
    }
    if (req.method !== 'POST') return reply(405, { ok: false, message: 'Not allowed.' });
    const action = url.pathname.slice(PREFIX.length + 1);
    if (!['replace', 'alt', 'focus', 'suggest', 'attach', 'attach-path'].includes(action)) return reply(404, { ok: false, message: 'Not found.' });
    // Refused before reading a large upload. Attaching a picture to a message or a suggestion changes no file, so they can't clash with Claude.
    if (busy() && !action.startsWith('attach') && action !== 'suggest') { req.resume(); return reply(409, { ok: false, message: 'Wait until Claude is done, then try again.' }); }
    let result = null;
    const job = begin();
    try {
      const body = await readBody(req, action === 'replace' || action === 'attach' ? MAX_UPLOAD : 10_000);
      const params = Object.fromEntries(url.searchParams);
      if (action === 'replace') result = await images.replace(params, body);
      else if (action === 'attach') result = await images.attach(params, body);
      else {
        let json;
        try { json = JSON.parse(body.toString('utf8')); } catch { throw Object.assign(new Error('That request was not readable.'), { expose: true }); }
        result = action === 'alt' ? images.alt(json) : action === 'focus' ? images.focus(json) : action === 'suggest' ? await images.suggest(json) : await images.attachPath(json);
      }
      reply(200, result);
    } catch (err) {
      if (err?.expose) reply(err.status ?? 400, { ok: false, message: err.message });
      else { logger?.warn(`images: ${err.stack ?? err}`); reply(500, { ok: false, message: 'Something went wrong. Check History before trying again.' }); }
    } finally {
      end(result && { action, ...result }, job);
    }
  };
}
