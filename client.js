// The editor on a page without Astro (the Vite plugin, vite.mjs, injects this module): what Astro's dev toolbar gives
// app.js — a canvas (a shadow root over the page), an on/off switch and the dev server's messages — plus a button to open it.
import editor from './app.js';

// Where each element is written: data-ce-src="<file>:<line>:<column>" (added by html.mjs). Kept in memory like Astro's
// source attributes (see index.mjs), and taken off the page so its markup stays as written.
const where = (window.__claudeEditSrc ??= new WeakMap());
for (const el of document.querySelectorAll('[data-ce-src]')) {
  const v = el.getAttribute('data-ce-src'), at = v.lastIndexOf(':', v.lastIndexOf(':') - 1);
  where.set(el, [v.slice(0, at), v.slice(at + 1)]);
  el.removeAttribute('data-ce-src');
}

if (!customElements.get('claude-edit-canvas')) {
  customElements.define('claude-edit-canvas', class extends HTMLElement {});
  customElements.define('claude-edit-button', class extends HTMLElement {});

  const canvas = document.createElement('claude-edit-canvas');
  canvas.attachShadow({ mode: 'open' });
  canvas.style.cssText = 'position: absolute; top: 0; left: 0; display: none;';

  const button = document.createElement('claude-edit-button');
  button.attachShadow({ mode: 'open' }).innerHTML = `<style>
    button { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: flex; align-items: center; gap: 8px;
      height: 40px; padding: 0 16px; border: 0; border-radius: 20px; background: #16181D; color: #fff; cursor: pointer;
      font: 500 14px/1 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    button:focus-visible { outline: 3px solid #E23B3F; outline-offset: 2px; }
    svg { width: 18px; height: 18px; }
  </style><button type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/><path d="M19 15v4M17 17h4"/></svg>Edit with Claude</button>`;

  // The same events as Astro's ToolbarAppEventTarget
  const app = new EventTarget();
  app.toggleState = ({ state }) => {
    canvas.style.display = state ? 'block' : 'none';
    button.hidden = state;
    app.dispatchEvent(new CustomEvent('app-toggled', { detail: { state } }));
  };
  app.onToggled = (fn) => app.addEventListener('app-toggled', (e) => fn(e.detail));
  app.toggleNotification = () => {};
  button.shadowRoot.querySelector('button').onclick = () => app.toggleState({ state: true });

  const server = {
    send: (event, data) => import.meta.hot?.send(event, data),
    on: (event, fn) => import.meta.hot?.on(event, fn),
  };
  document.body.append(canvas, button);
  editor.init(canvas.shadowRoot, app, server);
}
