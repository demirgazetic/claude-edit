// "Edit with Claude": page reloads wait while someone types, so nothing reloads the typing away; Claude's edits
// still show up once typing ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reloadGate } from '../index.mjs';

const RELOAD = { type: 'full-reload', path: '*' };
const setup = () => { const sent = []; return { sent, gate: reloadGate((p) => sent.push(p)) }; };

test('a reload while a tab types is held, and sent once that tab stops', () => {
  const { sent, gate } = setup();
  gate.hold('tab');
  gate.send(RELOAD); gate.send(RELOAD); // Claude edits two files
  gate.send({ type: 'update', updates: [] }); // anything else passes
  assert.deepEqual(sent.map((p) => p.type), ['update']);
  gate.release('tab');
  assert.deepEqual(sent.map((p) => p.type), ['update', 'full-reload']); // one reload for both
  gate.release('tab'); // a second "stopped" (or its tab closing) sends nothing more
  assert.equal(sent.length, 2);
});

test('nothing is sent when nothing was held, and the last of two holders sends it', () => {
  const { sent, gate } = setup();
  gate.hold('a'); gate.release('a');
  assert.equal(sent.length, 0);
  gate.hold('a'); gate.hold('images');
  gate.send(RELOAD);
  gate.release('a');
  assert.equal(sent.length, 0);
  gate.release('images');
  assert.equal(sent.length, 1);
});

test('drop: the last holder can swallow a reload that would show nothing new (an alt text)', () => {
  const { sent, gate } = setup();
  gate.hold('images'); gate.send(RELOAD); gate.release('images', { drop: true });
  assert.equal(sent.length, 0);
});

test("a direct save's own reload is dropped once, and quiet(0) ends that", () => {
  const { sent, gate } = setup();
  gate.quiet(3000); gate.send(RELOAD); gate.send(RELOAD);
  assert.equal(sent.length, 1);
  gate.quiet(3000); gate.quiet(0); gate.send(RELOAD);
  assert.equal(sent.length, 2);
});

test("drop only drops a reload no other holder was waiting for", () => {
  const { sent, gate } = setup();
  gate.hold('tab'); gate.hold('images');
  gate.send(RELOAD); // Claude's edits while the tab typed
  gate.release('tab');
  gate.release('images', { drop: true }); // an alt text, last to finish
  assert.equal(sent.length, 1);
});
