// Dev toolbar app "Edit with Claude".
// Kept apart from the page: it never takes over normal clicks or keys, writes nothing into the page's DOM
// (apart from contenteditable while you edit text and a temporary spacing preview), and its own errors are caught
// so they can't break the page. Works with mouse, touch and pen on macOS, Windows and Linux.
//
// Edit mode: while the app is on, a dark top bar pushes the page down and is the one place for actions:
//   "Editing" · the path (page ▾ › part ▾ › bigger parts › the selection ▾) · the selection's actions incl. Spacing ▾
//   (Less / Normal / More, previewed, then applied by Claude) and More ▾ (or a hint and Whole page ▾,
//   or "Typing", or a request to Claude) · status · Undo · History · Images · Settings · Done.
//   Clicking text starts typing in it; clicking anything else selects it.
// Colours: red for the editor's own buttons and highlights; outlines on the page stay blue (see OUTLINE).
// Panel (opened from the top bar):
//   header: title · Close
//   main:   Ask Claude: the conversation (Claude's steps folded, its screenshot check inside its answer,
//           "Changed · Undo") + text box with a chip saying what it's about. Or Spacing: the inspector (inspector.js)
//   views:  Images (the site's images; the picked one's panel: focal point, alt texts, replace here or everywhere, where it's
//           used; a picked picture's Edit image opens it at that picture), Replace image (upload or library image, everywhere
//           or only here, then back to the panel), History (undo / go back / redo), Settings (screenshot check,
//           overlay, new chat, shortcuts, panel)
//   page:   friendly label ("Heading", "Header · changes 34 pages") on the hovered and selected element
import { domToCanvas } from 'modern-screenshot';
import { createInspector, inspectorCss } from './inspector.js';

const TOUCH = matchMedia('(hover: none)').matches; // phones/tablets: no hover, usually no keyboard

const ACCENT = '#d71920', ACCENT_HOVER = '#b4141a'; // red: the editor's own buttons and highlights
const OUTLINE = '#2F54EB'; // outlines on the page stay blue: red would vanish on a site's own red logo, buttons and accents
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 3l8 20 3-8.5L22.5 11z" fill="${OUTLINE}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
const CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 3 3, crosshair`;
const STORE = 'claude-edit';
const MIN_W = 320, MIN_H = 300; // smallest panel that still fits the selection, text box and buttons
const TOP = 48; // height of the Edit mode top bar; the page moves down by this much while editing
const AREA = 'section, header, footer, main > *'; // what counts as "the surrounding area" for screenshots

const svg = (d, size = 18, width = 2) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  pick: '<path d="M4 4l7 17 2.5-7.5L21 11z"/>',
  send: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  spacing: '<path d="M4 4h16M4 20h16"/><rect x="7" y="8" width="10" height="8" rx="1"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  text: '<path d="M5 6h14M12 6v13"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 7"/>',
  section: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  button: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  spinner: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  dots: '<circle cx="5" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="19" cy="12" r=".9"/>',
};
const ALT = /Mac|iP/.test(navigator.platform) ? '⌥' : 'Alt'; // ⌥↑ / ⌥↓: bigger and smaller part

const css = `
  :host, .panel, .topbar, .more-menu, .dialog, .ask-pop { font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  [hidden] { display: none !important; } /* sections with their own display rule must still hide */
  button { font: inherit; cursor: pointer; }
  kbd { font: inherit; font-weight: 600; padding: 1px 6px; border: 1px solid var(--line-2); border-radius: 5px; background: var(--bg); color: var(--text); }

  /* on the page */
  .box { position: fixed; pointer-events: none; z-index: 2147483000; box-sizing: border-box; border: 2px solid ${OUTLINE}; border-radius: 4px; display: none; }
  .box.hover { border-style: dashed; border-color: #6E87F0; background: rgba(47,84,235,.05); }
  /* Name tags: the selection's (and Claude's working / done ones) sit on the outline's top-left corner like a tab; placed
     by placeTag. What you point at is named next to the pointer (cursor-tag), so a dashed outline has none. */
  .box > span, .cursor-tag { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px 0 6px; box-sizing: border-box; border-radius: 6px;
    font: 600 11.5px/1 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; letter-spacing: .01em; white-space: nowrap;
    box-shadow: 0 1px 2px rgba(16,24,40,.2), 0 0 0 1px rgba(255,255,255,.75); } /* the white hairline keeps it apart from busy photos */
  .box > span { position: absolute; max-width: 320px; }
  .box > span b { font-weight: inherit; overflow: hidden; text-overflow: ellipsis; }
  .box > span svg { flex-shrink: 0; }
  .box[data-tag="above"] > span { border-bottom-left-radius: 2px; } .box[data-tag="below"] > span { border-top-left-radius: 2px; }
  .box[data-tag="above right"] > span { border-bottom-right-radius: 2px; } .box[data-tag="below right"] > span { border-top-right-radius: 2px; }
  .box.hover > span { display: none !important; }
  .box.selected > span { background: ${OUTLINE}; color: #fff; }
  .cursor-tag { position: fixed; z-index: 2147483002; pointer-events: none; background: #16181D; color: #fff; }
  /* edit mode: each part of the page gets a faint outline and its name, so you see what you can pick */
  .zones div { position: fixed; z-index: 2147482998; pointer-events: none; border: 1px dashed rgba(47,84,235,.4); border-radius: 3px; }
  .zones span { position: absolute; top: 4px; left: 4px; padding: 2px 6px; border-radius: 5px; background: rgba(255,255,255,.92); color: #2440C2; font: 600 10.5px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
  .box.work { border: 2px dashed #F59E0B; background: repeating-linear-gradient(135deg, rgba(245,158,11,.18) 0 12px, rgba(245,158,11,.05) 12px 24px); }
  .box.work > span { background: #FFF4DB; color: #7A4A00; box-shadow: 0 0 0 1px #F59E0B, 0 1px 2px rgba(16,24,40,.2); }
  .box.done { border-color: #16A34A; box-shadow: 0 0 0 1px rgba(255,255,255,.9); }
  .box.done > span { background: #E8F6EE; color: #0F6B3A; box-shadow: 0 0 0 1px #16A34A, 0 1px 2px rgba(16,24,40,.2); }
  /* "Before": the screenshot taken when the request was sent, laid over the same area */
  .before { position: fixed; z-index: 2147483000; display: none; pointer-events: none; outline: 2px solid #16181D; }
  .before img { display: block; width: 100%; }
  .before b { position: absolute; top: 8px; left: 8px; padding: 4px 8px; border-radius: 6px; background: rgba(22,24,29,.85); color: #fff; font: 600 12px/1.2 system-ui, sans-serif; }
  /* the Edit mode top bar (same dark look on every site; the page is pushed down by TOP px) */
  .topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483002; height: ${TOP}px; box-sizing: border-box; display: flex; align-items: center; gap: 6px;
    padding: 0 10px 0 14px; background: #16181D; color: #fff; font-size: 13px; box-shadow: 0 2px 10px rgba(0,0,0,.2); }
  .topbar button { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: #fff; font-size: 13px; font-weight: 500; white-space: nowrap; }
  .topbar button:hover { background: #2A2F3A; }
  .topbar button:disabled { opacity: .45; cursor: default; background: transparent; }
  .topbar button[aria-pressed="true"] { background: #3A3F4A; }
  .topbar button:focus-visible { outline: 2px solid #F7A8AB; outline-offset: 1px; }
  .topbar .tb-fill { background: #2A2F3A; }
  .topbar .tb-fill:hover { background: #3A3F4A; }
  .topbar .tb-primary { background: ${ACCENT}; font-weight: 600; }
  .topbar .tb-primary:hover { background: ${ACCENT_HOVER}; }
  .topbar .tb-done { padding: 0 14px; background: #fff; color: #16181D; font-weight: 600; } /* not red: Ask Claude is the one red button */
  .topbar .tb-done:hover { background: #E3E6EB; }
  .topbar .tb-ic { width: 34px; padding: 0; justify-content: center; color: #C9CFD8; } /* History, Images, Settings: icon and tooltip */
  /* "Editing": edit mode is on (Done leaves it) */
  .tb-on { display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; margin: 0 4px 0 2px; color: #C9CFD8; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .tb-on i { width: 8px; height: 8px; border-radius: 50%; background: ${ACCENT}; box-shadow: 0 0 0 3px rgba(215,25,32,.28); }
  /* Where you are: page ▾ › part ▾ › bigger parts › the selection ▾ (renderPath) */
  .tb-path { display: flex; align-items: center; flex-shrink: 0; height: 36px; padding: 0 4px; box-sizing: border-box; border-radius: 10px; background: #22252D; }
  .tb-step { display: flex; align-items: center; } .tb-step > svg { flex-shrink: 0; color: #5C6370; }
  .topbar .tb-path button { gap: 5px; height: 28px; padding: 0 8px; border-radius: 7px; color: #C9CFD8; }
  .topbar .tb-path button:hover { background: #2F333D; color: #fff; }
  .topbar .tb-path [aria-current] { background: #3A3F4A; color: #fff; font-weight: 600; }
  .topbar .tb-path [aria-expanded="true"] { color: #fff; box-shadow: inset 0 0 0 1px #5C6370; }
  .tb-path b { max-width: 200px; overflow: hidden; text-overflow: ellipsis; font-weight: inherit; }
  .topbar:not(.fold) .tb-step.fold, .topbar.fold .tb-step.mid { display: none; }
  /* a shared piece: how many pages it changes ▾ */
  .topbar .tb-reach { gap: 3px; height: 26px; padding: 0 9px; border-radius: 999px; background: #FFF4DB; color: #7A4A00; font-size: 12px; font-weight: 600; }
  .topbar .tb-reach:hover { background: #FFE7B0; } .topbar .tb-reach:disabled { opacity: 1; background: #FFF4DB; }
  /* When the middle doesn't fit (fitBar), it gives way in steps so the selection's actions stay reachable.
     fold: the path's steps between the part and the selection fold into "…".
     1: Edit text goes (clicking the text already starts typing), the page address gets shorter */
  .topbar.fit1 [data-tb="edit"] { display: none !important; } .topbar.fit1 [data-tb="undo"] { padding: 0 9px; } .topbar.fit1 .tb-pl { max-width: 14vw; }
  /* the page name never pushes the actions away: long addresses end in "…" */
  .tb-pl { min-width: 0; max-width: 22vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 2: icons with tooltips for the rest; the hint and "Editing" go too (the dot stays) */
  .topbar.fit2 .tb-l2, .topbar.fit2 .tb-hint, .topbar.fit2 .tb-keys { display: none; } .topbar.fit2 .tb-mid button { padding: 0 9px; }
  .tb-sep { width: 1px; height: 24px; flex-shrink: 0; margin: 0 4px; background: #3A3F4A; }
  /* the middle scrolls sideways on narrow windows instead of pushing Done off screen */
  .tb-mid { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .tb-mid::-webkit-scrollbar { display: none; }
  .tb-mid > div { display: flex; align-items: center; gap: 6px; }
  .tb-mid > div > * { flex-shrink: 0; white-space: nowrap; }
  /* a request to Claude: working, then the result (see "requests" in the code) */
  .tb-dot { width: 10px; height: 10px; border-radius: 50%; background: #F59E0B; box-shadow: 0 0 0 4px rgba(245,158,11,.25); animation: pulse 1s infinite; }
  .tb-ok { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #16A34A; color: #fff; }
  .tb-time { color: #C9CFD8; font-variant-numeric: tabular-nums; }
  .tb-now { color: #C9CFD8; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
  .tb-seg { display: flex; gap: 3px; padding: 3px; border-radius: 9px; background: #2A2F3A; }
  .topbar .tb-seg button { height: 30px; padding: 0 12px; border-radius: 7px; color: #C9CFD8; }
  .topbar .tb-seg button[aria-pressed="true"] { background: #fff; color: #16181D; font-weight: 600; }
  .topbar.job .status, .topbar.job [data-tb="undo"] { display: none !important; } /* the request row has its own */
  .tb-hint { margin: 0; color: #C9CFD8; white-space: nowrap; }
  .topbar .tb-chip { gap: 2px; height: auto; padding: 3px 9px; border-radius: 999px; background: #2A2F3A; color: #D5D9E0; font-size: 12px; font-weight: 400; }
  .topbar .tb-chip:disabled { opacity: 1; background: #2A2F3A; }
  .topbar .tb-chip.shared { background: #FFF4DB; color: #7A4A00; font-weight: 600; }
  .topbar .tb-chip.shared:hover { background: #FFE7B0; }
  .topbar .tb-chip svg { display: none; } .topbar .tb-chip.shared:enabled svg { display: block; }
  .tb-keys { flex-shrink: 0; color: #C9CFD8; font-size: 12px; white-space: nowrap; }
  .topbar kbd { padding: 1px 5px; border-color: #4A505C; background: transparent; color: #D5D9E0; font-size: 11px; }
  /* More ▾: ready-made requests (red is the editor's colour, so Remove is told apart by its icon and the question) */
  .more-menu { position: fixed; z-index: 2147483003; min-width: 210px; max-width: 280px; padding: 6px; display: flex; flex-direction: column; gap: 2px; background: #fff; color: #16181D;
    border: 1px solid #E3E6EB; border-radius: 12px; box-shadow: 0 12px 32px rgba(16,24,40,.22); font-size: 13px; line-height: 1.4; }
  .more-menu .two { height: auto; align-items: flex-start; padding: 9px 12px; }
  .more-menu .two svg { margin-top: 2px; flex-shrink: 0; }
  .more-menu .two span { display: flex; flex-direction: column; gap: 1px; }
  .more-menu .two small { font-size: 11.5px; color: #4B5260; }
  .msg-pics { display: flex; flex-wrap: wrap; gap: 6px; }
  .more-menu button { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: inherit; font-size: 13px; text-align: left; }
  .more-menu button:hover, .more-menu button:focus-visible { background: #F1F3F6; outline: none; }
  .more-menu .danger { margin-top: 4px; border-top: 1px solid #E3E6EB; border-radius: 0 0 8px 8px; color: #8A1C12; }
  .more-menu p { margin: 6px 8px; }
  .more-menu .row { display: flex; justify-content: flex-end; gap: 6px; padding: 4px; }
  .more-menu .row button { height: 32px; border: 1px solid #C9CFD8; }
  .more-menu .row .yes { border-color: ${ACCENT}; background: ${ACCENT}; color: #fff; font-weight: 600; }
  .more-menu .row .yes:hover { background: ${ACCENT_HOVER}; }
  /* Spacing ▾: Less / Normal / More per group, previewed on the page, then applied by Claude */
  .more-menu.tree { max-width: 360px; max-height: min(480px, calc(100vh - 80px)); overflow: auto; }
  .more-menu.tree button { flex-shrink: 0; height: 32px; }
  .more-menu.tree button > svg { flex-shrink: 0; color: #4B5260; }
  .more-menu.tree button span { flex-shrink: 0; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more-menu.tree button small { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4B5260; }
  .more-menu.tree [aria-current] { background: #EEF1FD; font-weight: 600; }
  .more-menu .pill { flex-shrink: 0; margin-left: auto; padding: 1px 7px; border-radius: 999px; background: #FFF4DB; color: #7A4A00; font-size: 11px; font-style: normal; font-weight: 600; }
  .more-menu.tree button .here { flex: none; margin-left: auto; color: #2440C2; font-size: 11.5px; font-weight: 600; }
  .more-menu p.none { margin: 2px 12px 6px; color: #4B5260; font-size: 12.5px; }
  .more-menu p.keys { margin: 6px 6px 2px; padding: 8px 6px 2px; border-top: 1px solid #E3E6EB; color: #4B5260; font-size: 12px; }
  .more-menu kbd { padding: 0 5px; border: 1px solid #C9CFD8; background: #fff; color: #16181D; font-size: 11px; }
  /* "Changes 34 pages" ▾: the pages a shared piece is on */
  .more-menu a { display: flex; flex-shrink: 0; align-items: center; gap: 8px; min-height: 32px; padding: 0 12px; border-radius: 8px; color: inherit; text-decoration: none; }
  .more-menu a:hover, .more-menu a:focus-visible { background: #F1F3F6; outline: none; }
  .more-menu a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more-menu a small { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4B5260; font-weight: 400; }
  .more-menu a i { flex-shrink: 0; padding: 1px 7px; border-radius: 999px; background: #F1F3F6; color: #4B5260; font-size: 11px; font-style: normal; font-weight: 600; }
  .more-menu a[aria-current] i { background: #2F54EB; color: #fff; }
  .more-menu .reach-title { margin: 4px 12px 6px; font-weight: 600; }
  .more-menu .reach-note { margin: 6px 12px 4px; font-size: 12px; color: #4B5260; }
  .more-menu.tree .cap { margin: 8px 12px 2px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #4B5260; }
  .more-menu.wide { width: min(380px, calc(100vw - 16px)); max-width: none; padding: 12px; gap: 10px; }
  .more-menu .seo { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
  .more-menu .seo small { font-weight: 400; color: #4B5260; }
  .more-menu .seo input, .more-menu .seo textarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid #C9CFD8; border-radius: 8px; background: #fff; color: #16181D; font-family: inherit; font-size: 13px; font-weight: 400; line-height: 1.4; resize: vertical; }
  .more-menu .seo input:focus, .more-menu .seo textarea:focus { outline: none; border-color: ${ACCENT}; box-shadow: 0 0 0 3px #FDE2E3; }
  .space-menu { min-width: 300px; max-width: 340px; padding: 12px; gap: 12px; }
  .space-menu .sp-title { margin: 0; font-weight: 600; }
  .sp-row { display: flex; flex-direction: column; gap: 6px; }
  .sp-row > span { font-size: 13px; }
  .sp-seg { display: flex; gap: 4px; padding: 3px; border-radius: 9px; background: #F1F3F6; }
  .more-menu .sp-seg button { flex: 1; justify-content: center; height: 30px; border-radius: 7px; color: #4B5260; }
  .more-menu .sp-seg button[aria-pressed="true"] { background: #fff; color: #16181D; font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.15); }
  .sp-scope { margin: 0; padding: 10px 0 0; border: 0; border-top: 1px solid #E3E6EB; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
  .sp-scope p { margin: 0 0 2px; font-weight: 600; }
  .sp-scope label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .sp-scope label.off { color: #9AA3B2; cursor: not-allowed; }
  .sp-scope small { color: #4B5260; }
  .sp-scope input { width: 16px; height: 16px; margin: 0; accent-color: ${ACCENT}; }
  .sp-hint { margin: 0; font-size: 12px; color: #4B5260; }
  .more-menu .sp-exact { align-self: flex-start; height: 24px; padding: 0; color: #4B5260; font-size: 12px; text-decoration: underline; }
  .more-menu .sp-exact:hover { background: none; color: #16181D; }
  .topbar.typing .tb-end > :not(.tb-save.off) { display: none !important; } /* while typing, only typing: room for Cancel and Save */

  /* panel */
  /* Colours of the panel (Settings → Appearance). The bar and outlines on the page stay the same in both. */
  .panel, .dialog, .ask-pop, .gal, .typo-pop { color-scheme: light; --bg: #fff; --bg-2: #F1F3F6; --bg-foot: #FAFBFC; --tint: #FEF2F2; --tint-2: #FDE2E3; --tint-line: #F7C1C1;
    --text: #16181D; --muted: #4B5260; --accent-text: #B4141A; --line: #E3E6EB; --line-2: #C9CFD8; --line-3: #9AA3B2;
    --ok: #0F6B3A; --ok-bg: #E8F6EE; --ok-line: #CDEBD9; --warn: #7A4A00; --warn-bg: #FFF4DB; --err: #8A1C12; --err-bg: #FEF0EF; --err-line: #F3C7C9; }
  .panel[data-theme="dark"], .dialog[data-theme="dark"], .ask-pop[data-theme="dark"], .gal[data-theme="dark"], .typo-pop[data-theme="dark"] { color-scheme: dark; --bg: #1B1E24; --bg-2: #272B33; --bg-foot: #202329; --tint: #2E1A1B; --tint-2: #4A2326; --tint-line: #6B2A2E;
    --text: #E9EBEF; --muted: #A4ABB8; --accent-text: #FF9A9E; --line: #2E323B; --line-2: #434957; --line-3: #626979;
    --ok: #7BD9A3; --ok-bg: #173325; --ok-line: #24503A; --warn: #F2C46D; --warn-bg: #3A2E12; --err: #FF9F94; --err-bg: #3A1F1D; --err-line: #5C2C29; }
  /* One fixed height for every view (start, History, Settings), so switching never makes the panel jump. Resizing overrides it. */
  .panel { position: fixed; right: 16px; bottom: 76px; z-index: 2147483001; width: min(400px, calc(100vw - 32px)); height: min(640px, calc(100vh - 100px));
    min-width: min(${MIN_W}px, calc(100vw - 16px)); display: flex; flex-direction: column; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45;
    border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(16,24,40,.16); overflow: hidden; }
  header { flex-shrink: 0; border-bottom: 1px solid var(--line); cursor: move; user-select: none; touch-action: none; }
  /* Chat with Claude: the panel docked on the right, full height, for bigger work (new pages, many changes) */
  .panel.big { top: ${TOP}px !important; right: 0 !important; bottom: 0 !important; left: auto !important; width: min(540px, 100vw) !important; height: auto !important; max-height: none !important; min-width: 0;
    border-width: 0 0 0 1px; border-radius: 0; box-shadow: -12px 0 32px rgba(16,24,40,.14); }
  .panel.big header { cursor: default; }
  .panel.big .grip { display: none; }
  .panel.big #ce-ask { min-height: 88px; }
  .main-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .main-sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel:not(.big) .main-sub { display: none; }
  .hdr { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 14px; min-height: 40px; }
  .sub-hdr { padding-left: 8px; }
  .logo { display: grid; place-items: center; width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px; background: ${ACCENT}; color: #fff; }
  .title { font-size: 15px; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub-meta { font-size: 12px; color: var(--muted); padding-right: 8px; min-width: 0; max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* status in the top bar: only shown while something happens or a reply waits */
  .topbar .status { display: none; height: 30px; padding: 0 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .topbar .status i { width: 8px; height: 8px; border-radius: 50%; }
  .topbar.busy .status { display: inline-flex; color: #7A4A00; background: #FFF4DB; }
  .topbar.busy .status i { background: #D97706; animation: pulse 1s infinite; }
  .topbar.unread:not(.busy) .status { display: inline-flex; color: #fff; background: ${ACCENT}; }
  .topbar.unread .status i { display: none; }
  /* Is your own change saved? Quiet while all is well, red when it is not. "Saving…" shows only after a moment, so a
     quick save goes straight to "Saved" without a flash. */
  .tb-save { display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; height: 30px; padding: 0 10px; border-radius: 999px; color: #C9CFD8; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .tb-save i { width: 8px; height: 8px; border-radius: 50%; background: #D97706; animation: pulse 1s infinite; }
  .tb-save svg { display: none; color: #4ADE80; }
  .tb-save.saved svg { display: block; } .tb-save.saved i { display: none; }
  .tb-save.saving { animation: late .3s; }
  .tb-save.failed, .tb-save.off { padding-right: 4px; background: #3A1D1F; color: #FFB4B6; }
  .tb-save.off { padding-right: 12px; }
  .tb-save.failed i, .tb-save.off i { background: #E5484D; animation: none; }
  .topbar .tb-save button { height: 22px; padding: 0 9px; border-radius: 999px; background: #FFB4B6; color: #16181D; font-size: 12px; font-weight: 600; }
  .topbar .tb-save button:hover { background: #fff; }
  .tb-save:not(.failed) button { display: none; }
  @keyframes late { from, to { visibility: hidden; } }
  /* Text that was not saved and could not go back where it was typed: copy it */
  .tb-lost > svg { color: #FFB4B6; }
  .tb-mid > .tb-lost { flex: 1; min-width: 0; } /* the quote gives way first (the whole text is on Copy's tooltip) */
  .tb-mid > .tb-lost > .tb-quote { flex-shrink: 1; min-width: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; color: #C9CFD8; }
  @keyframes pulse { 50% { opacity: .3; } }
  .icon { width: 40px; height: 40px; flex-shrink: 0; display: grid; place-items: center; border: 0; background: transparent; border-radius: 8px; color: var(--muted); }
  .icon:hover { background: var(--bg-2); color: var(--text); }
  .icon.sm { width: 32px; height: 32px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px; padding: 0 14px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--bg); color: var(--text); font-size: 14px; font-weight: 500; }
  .btn:hover { border-color: var(--line-3); }
  .btn.sm { height: 34px; padding: 0 12px; border-radius: 9px; font-size: 13px; }
  .btn.primary { border-color: ${ACCENT}; background: ${ACCENT}; color: #fff; font-weight: 600; }
  .btn.primary:hover { background: ${ACCENT_HOVER}; }
  .btn.outline { border-color: ${ACCENT}; color: var(--accent-text); font-weight: 600; }
  .btn.danger { border-color: #C4320A; background: #C4320A; color: #fff; font-weight: 600; }
  .btn.grow { flex: 1; }
  .btn:disabled { opacity: .5; cursor: default; }

  .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .scroll { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; }
  .label { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .empty { margin: auto 0 0; font-size: 13px; line-height: 1.5; color: var(--muted); } /* shown until the first message */
  .log:not(:empty) + .empty, .scroll:has(.log:not(:empty)) .empty { display: none; }

  /* changing a link, opened from the top bar's Link button */
  .sel-link { flex-shrink: 0; padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--muted); }
  .link-form { display: flex; flex-direction: column; gap: 8px; }
  .link-form .tabs button { height: 30px; font-size: 12px; }
  .link-pages { max-height: 200px; overflow: auto; display: flex; flex-direction: column; border: 1px solid var(--line-2); border-radius: 9px; }
  .link-pages button { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--line); background: var(--bg); text-align: left; font: inherit; }
  .link-pages button:last-child { border-bottom: 0; }
  .link-pages button:hover { background: var(--bg-2); }
  .link-pages button[aria-selected="true"] { background: var(--tint); }
  .link-pages b { font-size: 13px; font-weight: 500; color: var(--text); }
  .link-pages small { font-size: 11px; color: var(--muted); }
  .link-pages p { margin: 0; padding: 10px; }
  .link-row { display: flex; align-items: center; gap: 8px; } .link-row .tabs { flex: 1; }
  .link-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .link-form input { flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--bg); color: var(--text); font: inherit; font-size: 13px; }
  .link-form input:focus { outline: none; border-color: ${ACCENT}; box-shadow: 0 0 0 3px var(--tint-2); }

  .tabs { display: flex; gap: 4px; padding: 4px; background: var(--bg-2); border-radius: 10px; flex-shrink: 0; }
  .tabs button { flex: 1; height: 36px; border: 0; border-radius: 8px; background: transparent; font-size: 13px; font-weight: 500; color: var(--muted); }
  .tabs button[aria-selected="true"], .tabs button[aria-checked="true"] { background: var(--bg); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.12); }

  .log { display: flex; flex-direction: column; gap: 10px; }
  .log:empty { display: none; }
  .msg { max-width: 92%; padding: 10px 12px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .msg p { margin: 0; }
  .user { align-self: flex-end; max-width: 82%; border-radius: 12px 12px 4px 12px; background: ${ACCENT}; color: #fff; }
  .user small { display: block; margin-bottom: 3px; font-size: 11px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .reply, .error { align-self: flex-start; display: flex; flex-direction: column; gap: 10px; border-radius: 12px 12px 12px 4px; background: var(--bg-2); }
  .error { background: var(--err-bg); color: var(--err); }
  .time { font-size: 11px; color: var(--muted); }
  .steps { font-size: 12px; color: var(--muted); white-space: normal; }
  .steps summary { cursor: pointer; color: var(--accent-text); font-weight: 500; }
  .steps ul { margin: 6px 0 0; padding-left: 18px; }
  .progress { align-self: flex-start; display: flex; align-items: center; gap: 10px; max-width: 92%; padding: 10px 12px; border-radius: 12px 12px 12px 4px; background: var(--bg-2); font-size: 14px; color: ${ACCENT}; }
  .progress .ptext { flex: 1; color: var(--text); }
  .progress .ptime { font-size: 12px; color: var(--muted); }
  .spin { display: grid; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .line { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; line-height: 1.45; color: var(--muted); }
  .line svg { flex-shrink: 0; margin-top: 1px; }
  /* a change Claude made: one quiet line under its answer */
  .change { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ok); white-space: normal; }
  .log > .change { align-self: flex-start; }
  .change .grow { color: var(--ok); }
  .change button { padding: 0; border: 0; background: none; color: var(--text); font-size: 12px; text-decoration: underline; }
  .change button:disabled { color: var(--muted); text-decoration: none; }
  .checked { display: block; margin-top: 6px; font-size: 12px; color: var(--muted); white-space: normal; }

  .composer { flex-shrink: 0; padding: 10px 16px 14px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
  /* what the question is about: the selection, or the whole page once it's removed */
  .scope { align-self: flex-start; max-width: 100%; display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border-radius: 999px; background: var(--tint); color: var(--accent-text); font-size: 12px; font-weight: 500; }
  .scope span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scope button { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; }
  .scope button:hover { background: var(--tint-2); }
  .field { display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--line-2); border-radius: 12px; padding: 7px 7px 7px 12px; background: var(--bg); }
  .composer .field { flex-direction: column; align-items: stretch; gap: 6px; padding: 9px 8px 8px 12px; }
  .field-row { display: flex; align-items: center; gap: 8px; }
  .field-row .hint { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .add-img { height: 32px; padding: 0 10px; font-size: 12.5px; font-weight: 500; }
  /* a project without an image library (no images option): no Images view, no pictures for Claude */
  :host([data-no-images]) :is(.add-img, .ap-pic, [data-tb="images"]) { display: none !important; }
  /* pictures attached to the next message */
  .atts { display: flex; flex-wrap: wrap; gap: 6px; }
  .att { display: inline-flex; align-items: center; gap: 8px; max-width: 220px; padding: 4px 4px 4px 4px; border-radius: 9px; background: var(--bg-2); font-size: 12px; color: var(--text); }
  .att img, .att i { flex-shrink: 0; width: 40px; height: 30px; border-radius: 5px; object-fit: cover; background: var(--line); display: grid; place-items: center; color: var(--muted); }
  .att span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .att button { flex-shrink: 0; width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--muted); }
  .att button:hover { background: var(--line); color: var(--text); }
  .att.loading { opacity: .6; }
  .msg .att { background: rgba(255,255,255,.16); color: inherit; max-width: 100%; margin-top: 6px; }
  .reply .open-page { align-self: flex-start; margin-top: 4px; }
  /* pictures dragged over the panel */
  .drop { position: absolute; inset: 8px; z-index: 5; display: none; place-items: center; border: 2px dashed ${ACCENT}; border-radius: 14px; background: color-mix(in srgb, var(--tint) 92%, transparent); color: var(--accent-text); font-size: 14px; font-weight: 600; pointer-events: none; }
  .panel.dropping .drop, .ask-pop.dropping .drop { display: grid; }
  .ask-pop .drop { inset: 4px; font-size: 13px; }
  .attach-path { display: flex; flex-direction: column; gap: 8px; padding: 6px; font-size: 13px; }
  .attach-path input { height: 36px; padding: 0 10px; border: 1px solid #C9CFD8; border-radius: 9px; font: inherit; color: #16181D; }
  .attach-path input:focus { outline: none; border-color: ${ACCENT}; box-shadow: 0 0 0 3px #FDE2E3; }
  .attach-path small { color: #4B5260; }
  .attach-path .err { color: #8A1C12; }
  .field:focus-within { border-color: ${ACCENT}; box-shadow: 0 0 0 3px var(--tint-2); }
  textarea::placeholder, input::placeholder { color: var(--muted); opacity: 1; }
  textarea { flex: 1; border: 0; resize: none; font: inherit; font-size: 14px; line-height: 1.45; color: var(--text); outline: none; background: transparent; max-height: 160px; }
  .send { width: 38px; height: 38px; flex-shrink: 0; display: grid; place-items: center; border: 0; border-radius: 10px; background: ${ACCENT}; color: #fff; }
  .send:hover { background: ${ACCENT_HOVER}; }

  .tab-spacing .composer, .tab-spacing .sel-link { display: none !important; }
  .tab-spacing .scroll { display: none; }
  .tab-spacing .spacing { flex: 1; }

  .hist-list { flex: 1; min-height: 0; overflow: auto; }
  .hist-list .label { padding: 14px 16px 6px; }
  .h-item { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .h-item.confirming { background: var(--err-bg); }
  .h-row { display: flex; align-items: center; gap: 12px; }
  .h-icon { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: 9px; background: var(--bg-2); color: var(--muted); }
  .h-icon.claude { background: var(--tint-2); color: var(--accent-text); }
  .h-icon.spacing { background: var(--ok-bg); color: var(--ok); }
  .h-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .h-text span { font-size: 14px; font-weight: 500; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .h-text small { font-size: 12px; color: var(--muted); }
  .h-item.undone .h-text span { color: var(--muted); text-decoration: line-through; font-weight: 400; }
  .h-confirm { display: flex; align-items: center; gap: 8px; padding-left: 46px; }
  .h-confirm span { flex: 1; font-size: 12px; line-height: 1.4; color: var(--err); }
  .h-note { margin: 12px 16px 0; padding: 10px 12px; border-radius: 10px; background: var(--warn-bg); color: var(--warn); font-size: 13px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .h-scope { margin: 12px 16px 4px; }
  .h-sub { margin: 0; padding: 10px 16px 4px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .h-shared { font-weight: 600; color: var(--warn); }
  .h-empty { margin: 0; padding: 28px 16px; text-align: center; font-size: 13px; color: var(--muted); }
  .view-foot { flex-shrink: 0; margin: 0; padding: 12px 16px 14px; border-top: 1px solid var(--line); background: var(--bg-foot); font-size: 12px; line-height: 1.5; color: var(--muted); }
  .view-foot code { font-size: 11px; background: var(--bg-2); padding: 1px 4px; border-radius: 4px; word-break: break-all; }

  .settings { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 22px; }
  .settings section { display: flex; flex-direction: column; gap: 12px; }
  .s-row { display: flex; align-items: flex-start; gap: 12px; }
  .s-row > span { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .s-row b { font-size: 14px; font-weight: 500; }
  .s-row small { font-size: 12px; line-height: 1.45; color: var(--muted); }
  .sw { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch { position: relative; width: 40px; height: 24px; flex-shrink: 0; border-radius: 999px; background: var(--line-2); transition: background .15s; cursor: pointer; }
  .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--bg); box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s; }
  .sw:checked + .switch { background: ${ACCENT}; }
  .sw:checked + .switch::after { transform: translateX(16px); }
  .sw:focus-visible + .switch { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
  .s-row { cursor: pointer; }
  .shortcuts { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 12px; font-size: 13px; }
  .shortcuts dt { color: var(--muted); }
  .shortcuts dd { margin: 0; text-align: right; }

  /* images view and replace image */
  .img-tools { flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .search { height: 36px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--bg); color: var(--text); font: inherit; font-size: 13px; }
  .search:focus { outline: none; border-color: ${ACCENT}; box-shadow: 0 0 0 3px var(--tint-2); }
  .img-list { flex: 1; min-height: 0; overflow: auto; }
  .i-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--text); text-align: left; }
  .i-item:hover { background: var(--bg-2); }
  .thumb { width: 56px; height: 42px; flex-shrink: 0; border-radius: 6px; object-fit: cover; background: var(--bg-2); border: 1px solid var(--line); }
  .i-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .i-text b, .i-text small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .i-text b { font-size: 13px; font-weight: 600; }
  .i-text small { font-size: 12px; color: var(--muted); }
  .i-count { flex-shrink: 0; padding: 2px 8px; border-radius: 999px; background: var(--tint); color: var(--accent-text); font-size: 12px; font-weight: 600; }
  .i-detail { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
  .i-detail section { display: flex; flex-direction: column; gap: 8px; }
  .i-preview { width: 100%; max-height: 200px; object-fit: contain; border-radius: 10px; border: 1px solid var(--line); background: var(--bg-2); }
  /* Focal point picker: the picture with a marker, how it crops at three shapes, Save / Suggest / Centre */
  .fp { display: flex; flex-direction: column; gap: 8px; }
  .fp-head { display: flex; justify-content: space-between; gap: 8px; }
  .fp-head span { font-weight: 400; letter-spacing: 0; text-transform: none; }
  .fp-pic { position: relative; align-self: center; max-width: 100%; padding: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--bg-2); cursor: crosshair; touch-action: manipulation; }
  .fp-pic:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
  .fp-pic img { display: block; width: auto; height: auto; max-width: 100%; max-height: 240px; } /* width/height: its space is kept while it loads */
  .fp-dot { position: absolute; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(16,18,24,.55), inset 0 0 0 2px rgba(16,18,24,.55); pointer-events: none; }
  .fp-dot::after { content: ""; position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 1px rgba(16,18,24,.55); }
  .fp-dot.sug { box-shadow: 0 0 0 2px #fff, 0 0 0 3px #7A4A00, inset 0 0 0 2px #7A4A00; outline: 2px dashed #fff; outline-offset: 3px; }
  .fp-frames { display: flex; align-items: flex-end; gap: 10px; }
  .fp-frames span { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--muted); }
  .fp-frames span:last-child { flex: 1; min-width: 0; }
  .fp-frames img { display: block; width: 72px; object-fit: cover; border-radius: 6px; background: var(--bg-2); box-shadow: 0 0 0 1px var(--line); }
  .fp-frames span:nth-child(2) img { width: 96px; }
  .fp-frames span:last-child img { width: 100%; }
  .fp-note { margin: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; font-size: 12px; line-height: 1.45; }
  .fp-note.sug { background: var(--warn-bg); color: var(--warn); }
  .fp-note.ok { background: var(--ok-bg); color: var(--ok); }
  .fp-note span { flex: 1; }
  .fp-note button { padding: 0; border: 0; background: none; color: var(--text); font-size: 12px; font-weight: 500; text-decoration: underline; }
  .fp-btns { display: flex; flex-wrap: wrap; gap: 8px; }
  .facts { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; font-size: 13px; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; overflow-wrap: anywhere; }
  .facts code, .use code { font-size: 11px; background: var(--bg-2); padding: 1px 4px; border-radius: 4px; }
  .use { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
  .use > span { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .use small { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .use a { color: var(--accent-text); }
  .muted-note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .r-pic { display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; }
  .r-pic .thumb { width: 72px; height: 54px; }
  .r-pic span { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; overflow-wrap: anywhere; }
  .r-pic small { font-size: 12px; color: var(--muted); }
  .r-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .choice { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1.5px solid var(--line-2); border-radius: 12px; cursor: pointer; }
  .choice:has(input:checked) { border-color: ${ACCENT}; background: var(--tint); }
  .choice input { margin: 3px 0 0; accent-color: ${ACCENT}; }
  .choice span { display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
  .choice b { font-size: 14px; font-weight: 600; }
  .choice small { font-size: 12px; line-height: 1.45; color: var(--muted); }
  .likely { font-weight: 600; color: var(--accent-text); }
  .lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; max-height: 240px; overflow: auto; padding: 2px; }
  .lib-grid button { padding: 0; aspect-ratio: 4 / 3; overflow: hidden; border: 2px solid transparent; border-radius: 8px; background: var(--bg-2); }
  .lib-grid button[aria-pressed="true"] { border-color: ${ACCENT}; }
  .lib-grid img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .r-error { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--err-bg); color: var(--err); font-size: 13px; }
  .r-done { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--ok-line); border-radius: 12px; background: var(--ok-bg); }
  .r-done.undone { border-color: var(--line); background: var(--bg-2); }
  .r-done .ok { display: grid; place-items: center; width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%; background: var(--bg); color: var(--ok); }
  .r-done > span:not(.ok) { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .r-done b { font-size: 14px; }
  .alt-row { display: flex; flex-direction: column; gap: 6px; }
  .alt-row small { font-size: 12px; color: var(--muted); }
  /* Ask Claude next to the selection */
  /* a possible typo: what the dictionary suggests, the word list, or typing (see "typos") */
  .typo-pop { position: fixed; z-index: 2147483003; width: min(330px, calc(100vw - 16px)); box-sizing: border-box; padding: 14px; display: flex; flex-direction: column; gap: 10px;
    background: var(--bg); color: var(--text); font-size: 14px; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(16,24,40,.18); }
  .tp-head { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
  .tp-head i, .topbar .tb-typos i { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: #E5484D; }
  .tp-word { font-size: 16px; overflow-wrap: anywhere; }
  .tp-sugs { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--muted); }
  .tp-sugs button { height: 32px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 13px; font-weight: 600; }
  .tp-sugs button:hover, .tp-sugs button:focus-visible { border-color: ${ACCENT}; box-shadow: 0 0 0 3px var(--tint-2); outline: none; }
  .typo-pop hr { width: 100%; margin: 0; border: 0; border-top: 1px solid var(--line); }
  .tp-acts { display: flex; flex-direction: column; gap: 2px; }
  .tp-acts button { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font-size: 13px; font-weight: 500; text-align: left; }
  .tp-acts button:hover, .tp-acts button:focus-visible { background: var(--bg-2); outline: none; }
  .typo-pop small { font-size: 11.5px; line-height: 1.45; color: var(--muted); }
  .topbar .tb-typos { color: #FFB4B6; }
  .ask-pop { position: fixed; z-index: 2147483003; width: min(420px, calc(100vw - 16px)); box-sizing: border-box; padding: 12px; display: flex; flex-direction: column; gap: 8px;
    background: var(--bg); color: var(--text); font-size: 14px; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(16,24,40,.22); }
  .ap-what { font-size: 12px; font-weight: 600; color: var(--accent-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ap-foot { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .ap-foot span { flex: 1; }
  .ap-chat { padding: 0; border: 0; background: none; color: var(--text); font-size: 12px; text-decoration: underline; }
  /* the replace image dialog */
  /* Images: the library in a large dialog, grid of pictures + the picked one beside it; also the picker for the chat */
  .gal-scrim { position: fixed; inset: 0; z-index: 2147483004; display: grid; place-items: center; padding: 16px; background: rgba(16,18,24,.55); }
  .gal { width: min(1080px, 100%); height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45;
    border-radius: 14px; box-shadow: 0 24px 64px rgba(0,0,0,.35); overflow: hidden; }
  .gal-head { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 14px 10px 10px 20px; }
  .gal-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .gal-titles b { font-size: 18px; }
  .gal-titles small { font-size: 12.5px; color: var(--muted); }
  .gal-tools { flex-shrink: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 0 20px 14px; border-bottom: 1px solid var(--line); }
  .gal-search { display: flex; align-items: center; gap: 8px; width: min(340px, 100%); height: 38px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--line-2); border-radius: 10px; color: var(--muted); }
  .gal-search:focus-within { border-color: ${ACCENT}; box-shadow: 0 0 0 3px var(--tint-2); }
  .gal-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 13px; }
  .gal-tools .tabs button { flex: 0 0 auto; height: 30px; padding: 0 12px; }
  .gal-gap { flex: 1; }
  .gal-up { cursor: pointer; }
  .gal-body { flex: 1; min-height: 0; display: flex; }
  .gal-grid { flex: 1; min-width: 0; overflow: auto; padding: 16px 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; align-content: start; background: var(--bg-foot); }
  .gal-grid .h-empty { grid-column: 1 / -1; }
  .gal-card { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px; border: 0; border-radius: 12px; background: var(--bg); box-shadow: 0 0 0 1px var(--line); color: var(--text); text-align: left; }
  .gal-card:hover { box-shadow: 0 0 0 1px var(--line-3); }
  .gal-card[aria-pressed="true"] { box-shadow: 0 0 0 2px ${ACCENT}; }
  .gal-card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px; background: var(--bg-2); }
  .gal-card b { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gal-card b.none { color: var(--accent-text); }
  .gal-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11.5px; color: var(--muted); }
  .gal-meta span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gal-chip { flex-shrink: 0; padding: 2px 7px; border-radius: 999px; background: var(--bg-2); color: var(--text); font-size: 11px; font-weight: 500; }
  .gal-tick { position: absolute; top: 14px; left: 14px; width: 22px; height: 22px; display: none; place-items: center; border-radius: 6px; background: #fff; box-shadow: 0 0 0 1.5px #9AA1AD; color: transparent; }
  .gal.picking .gal-tick { display: grid; }
  .gal-card[aria-pressed="true"] .gal-tick { background: ${ACCENT}; box-shadow: none; color: #fff; }
  .gal-detail { width: 360px; flex-shrink: 0; overflow: auto; border-left: 1px solid var(--line); }
  .gal-detail .i-preview { max-height: 240px; }
  .gal-foot { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 10px 20px; border-top: 1px solid var(--line); background: var(--bg-foot); font-size: 12px; color: var(--muted); }
  .gal-note { flex: 1; }
  .gal-pick { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .gal-count { flex: 1; font-size: 12.5px; }
  @media (max-width: 760px) { .gal-body { flex-direction: column; } .gal-detail { width: auto; max-height: 50%; border-left: 0; border-top: 1px solid var(--line); } }
  .scrim { position: fixed; inset: 0; z-index: 2147483004; display: grid; place-items: center; padding: 16px; background: rgba(16,18,24,.55); }
  .dialog { width: min(820px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45;
    border-radius: 16px; box-shadow: 0 24px 64px rgba(0,0,0,.35); overflow: hidden; }
  .dlg-head { flex-shrink: 0; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 12px 10px 12px 20px; border-bottom: 1px solid var(--line); }
  .dlg-head b { flex: 1; font-size: 17px; }
  .dlg-steps { display: flex; gap: 14px; margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
  .dlg-steps li { display: flex; align-items: center; gap: 6px; }
  .dlg-steps i { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--bg-2); font-style: normal; font-weight: 700; font-size: 12px; }
  .dlg-steps .on { color: var(--text); font-weight: 600; }
  .dlg-steps .on i { background: ${ACCENT}; color: #fff; }
  .dlg-steps .done i { background: var(--ok-bg); color: var(--ok); }
  .dlg-body { flex: 1; min-height: 0; overflow: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .dlg-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; align-items: start; }
  .dlg-cols:has(.dlg-main) { grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); }
  @media (max-width: 640px) { .dlg-cols:has(.dlg-main) { grid-template-columns: minmax(0, 1fr); } }
  .dlg-side, .dlg-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .dlg-side { gap: 14px; }
  .dlg-side small { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
  .dlg-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .dlg-name .label { margin: 6px 0 2px; }
  .iname { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.35; }
  small.fname { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
  .dlg-preview { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 10px; background: var(--bg-2); }
  .dlg-side .btn { align-self: flex-start; }
  .dlg-q { margin: 0; font-size: 16px; font-weight: 600; }
  .dlg-main .r-row .search { flex: 1; min-width: 160px; }
  .dlg-main .lib-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); max-height: 300px; }
  .places { margin: 6px 0 0; padding-left: 16px; font-size: 12px; line-height: 1.45; color: var(--muted); }
  .places li + li { margin-top: 3px; }
  /* the page address stays in one piece: it moves to the next line instead of breaking at "/bs-" */
  .choice .places .route { display: inline-block; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  .choice .places .route::before { content: "· "; }
  .dlg-foot { flex-shrink: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--line); background: var(--bg-foot); }
  .dlg-note { flex: 1; font-size: 12px; color: var(--muted); }
  .alt-box { display: flex; flex-direction: column; gap: 8px; }
  .alt-box textarea, .alt-row input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--bg); color: var(--text); font: inherit; font-size: 14px; }
  .alt-box textarea:focus, .alt-row input:focus { outline: none; border-color: ${ACCENT}; box-shadow: 0 0 0 3px var(--tint-2); }
  .alt-same { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .alt-same input { width: 16px; height: 16px; margin: 0; accent-color: ${ACCENT}; }

  /* closed: the top bar opens it again */
  .panel.collapsed { display: none !important; }

  .grip { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none; z-index: 1;
    background: linear-gradient(135deg, transparent 0 55%, #B9C0CC 55% 62%, transparent 62% 72%, #B9C0CC 72% 79%, transparent 79%); }
  .grip:hover { background: linear-gradient(135deg, transparent 0 55%, ${ACCENT} 55% 62%, transparent 62% 72%, ${ACCENT} 72% 79%, transparent 79%); }
`;

// What an element is, in words an editor uses.
function baseKind(el) {
  const t = el.tagName.toUpperCase(), c = typeof el.className === 'string' ? el.className : '';
  const k = (name, plural, icon) => ({ name, plural, icon });
  if (/^H[1-6]$/.test(t)) return k('Heading', 'headings', 'text');
  // An <svg> drawn in code (a brand's Icon component) has no picture file to replace: an icon, not an image
  if (t === 'SVG' && !el.dataset?.img) return k('Icon', 'icons', 'image');
  if (['IMG', 'PICTURE', 'VIDEO', 'SVG'].includes(t)) return k('Image', 'images', 'image');
  if (t === 'BUTTON' || (t === 'A' && /btn|button/.test(c))) return k('Button', 'buttons', 'button');
  if (t === 'A') return k('Link', 'links', 'link');
  if (t === 'UL' || t === 'OL') return k('List', 'lists', 'list');
  if (t === 'LI') return k('List item', 'list items', 'list');
  if (t === 'SUMMARY') return k('Accordion title', 'accordion titles', 'text');
  if (['P', 'SPAN', 'SMALL', 'STRONG', 'EM', 'LABEL', 'BLOCKQUOTE', 'FIGCAPTION'].includes(t)) {
    if (/eyebrow|small|caption|label|stat/.test(c)) return k('Label', 'labels', 'text');
    return t === 'P' ? k('Paragraph', 'paragraphs', 'text') : k('Text', 'texts', 'text');
  }
  if (t === 'SECTION') return k('Section', 'sections', 'section');
  if (t === 'HEADER') return k('Header', 'headers', 'section');
  if (t === 'FOOTER') return k('Footer', 'footers', 'section');
  if (t === 'NAV') return k('Menu', 'menus', 'list');
  if (t === 'FORM') return k('Form', 'forms', 'section');
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t)) return k('Form field', 'form fields', 'button');
  if (t === 'DETAILS') return k('Accordion', 'accordions', 'list');
  if (t === 'ARTICLE' || /card/.test(c)) return k('Card', 'cards', 'section');
  return k('Block', 'blocks', 'section');
}
// Ready-made requests for what's selected. `send` goes straight to Claude; `fill` starts the sentence for the editor.
function quickActions(kind) {
  const remove = { label: 'Remove it', send: 'Remove this element from the page.', danger: true };
  const text = ['Heading', 'Paragraph', 'Text', 'Label', 'List item', 'Accordion title'];
  if (!kind) return [
    { label: 'Fix typos', send: 'Fix spelling and grammar mistakes in the text on this page. Do not change the meaning.' },
    { label: 'Tighten the spacing', fill: 'Make the space between the sections on this page a bit tighter.' },
    { label: 'Add a new section', fill: 'Add a new section below the … section with ' },
  ];
  if (text.includes(kind.name)) return [
    { label: 'Make it shorter', send: 'Make this text shorter. Keep the meaning and the tone.' },
    { label: 'Rewrite it', send: 'Rewrite this text so it reads better. Keep the meaning and roughly the same length.' },
    remove,
    { label: 'Bigger', send: 'Make this text a bit bigger, using the next size up in the type scale.' },
    { label: 'Smaller', send: 'Make this text a bit smaller, using the next size down in the type scale.' },
    { label: 'Add text below', fill: 'Add a paragraph below this that says: ' },
  ];
  if (kind.name === 'Button' || kind.name === 'Link') return [
    { label: 'Change the text', fill: 'Change the text to: ' },
    { label: 'Change the link', link: true },
    remove,
    { label: 'Make it stand out', send: "Make this stand out more, using the design system's primary button style." },
  ];
  // Decorative (aria-hidden), so no alt text; another icon comes from the brand's own set
  if (kind.name === 'Icon') return [
    { label: 'Change the icon', fill: "Use a different icon here, from the site's icon set: " },
    remove,
    { label: 'Bigger', send: 'Make this icon a bit bigger.' },
    { label: 'Smaller', send: 'Make this icon a bit smaller.' },
  ];
  if (kind.name === 'Image') return [
    { label: 'Replace the image', image: true },
    { label: 'Better alt text', send: 'Write a better, descriptive alt text for this image.' },
    remove,
  ];
  return [
    { label: 'Tighten the spacing', send: 'Reduce the space inside this a little.' },
    { label: 'Duplicate it', send: 'Duplicate this right below itself.' },
    remove,
    { label: 'Move it up', send: 'Move this one position up on the page.' },
    { label: 'Move it down', send: 'Move this one position down on the page.' },
    { label: 'Add something inside', fill: 'Add inside this: ' },
  ];
}
const VERB = { Reading: 'reading', Editing: 'editing', Writing: 'writing', 'Searching for': 'searching for', 'Looking for': 'looking for' };
const PAST = { Reading: 'Read', Editing: 'Edited', Writing: 'Wrote', 'Searching for': 'Searched for', 'Looking for': 'Looked for' };
const splitStep = (s) => { const v = Object.keys(VERB).find((x) => s.startsWith(x)); return v ? [v, s.slice(v.length).trim().split('/').pop()] : [null, s]; };

// Report editor bugs to the console only; never let them reach the page.
const safe = (fn) => (...args) => {
  try { const r = fn(...args); return r instanceof Promise ? r.catch((err) => console.warn('[claude-edit]', err)) : r; }
  catch (err) { console.warn('[claude-edit]', err); }
};

export default {
  init: safe((canvas, app, server) => {
    canvas.host?.setAttribute('data-no-images', ''); // until the server says it has an image library
    canvas.innerHTML = `<style>${css}${inspectorCss}</style>
      <div class="zones" aria-hidden="true"></div>
      <div class="box hover"><span></span></div><div class="box selected"><span></span></div><div class="cursor-tag" hidden></div>
      <div class="box work"><span></span></div><div class="box done"><span></span></div>
      <div class="before"><img alt=""><b>Before</b></div>
      <div class="more-menu" role="menu" aria-label="Ready-made requests" hidden></div>
      <div class="more-menu space-menu" role="dialog" aria-label="Spacing" hidden></div>
      <div class="typo-pop" role="dialog" aria-label="Possible typo" hidden>
        <span class="tp-head"><i></i><span class="tp-lang"></span></span>
        <b class="tp-word"></b>
        <div class="tp-sugs"></div>
        <hr>
        <div class="tp-acts">
          <button type="button" class="tp-add">${svg(I.plus, 15)}Add to the word list</button>
          <button type="button" class="tp-edit">${svg(I.pencil, 15)}Edit the text myself</button>
        </div>
        <small>A suggestion is saved straight into the page, like typing it. The word list is shared by everyone editing these sites.</small>
      </div>
      <form class="ask-pop" role="dialog" aria-label="Ask Claude" hidden>
        <span class="ap-what"></span>
        <div class="atts" hidden></div>
        <div class="field"><textarea rows="2" aria-label="What should change?"></textarea><button type="button" class="icon sm ap-pic" aria-label="Add a picture" title="Add a picture (or drop or paste one here)">${svg(I.image, 16)}</button><button type="submit" class="send" aria-label="Send" title="Send (Enter)">${svg(I.send, 18, 2.2)}</button></div>
        <div class="drop">Drop pictures to add them</div>
        <span class="ap-foot"><span>Enter sends · Esc clears</span><button type="button" class="ap-chat">Open the conversation</button></span>
      </form>
      <div class="gal-scrim" hidden>
        <div class="gal" role="dialog" aria-modal="true" aria-labelledby="gal-title">
          <div class="gal-head">
            <div class="gal-titles"><b id="gal-title">Images</b><small class="gal-sub"></small></div>
            <button type="button" class="icon gal-x" aria-label="Close" title="Close (Esc)">${svg(I.x)}</button>
          </div>
          <div class="gal-tools">
            <label class="gal-search">${svg(I.search, 16)}<input type="search" class="img-search" placeholder="Search by description, page or file name" aria-label="Search images" autocomplete="off" spellcheck="false"></label>
            <div class="tabs img-scope" role="tablist" aria-label="Which images">
              <button type="button" role="tab" data-iscope="page">On this page</button><button type="button" role="tab" data-iscope="all">All images</button>
            </div>
            <span class="gal-gap"></span>
            <label class="btn sm gal-up">${svg(I.upload, 16)}Upload images<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple hidden></label>
          </div>
          <div class="gal-body"><div class="gal-grid"></div><aside class="gal-detail" aria-label="Selected image" hidden></aside></div>
          <div class="gal-foot">
            <span class="gal-note">Every image is one file in the library. Replacing it everywhere changes every page that shows it; every replace can be undone in History.</span>
            <span class="gal-pick" hidden><span class="gal-count"></span><button type="button" class="btn sm gal-cancel">Cancel</button><button type="button" class="btn sm primary gal-add"></button></span>
          </div>
        </div>
      </div>
      <div class="scrim" hidden>
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          <div class="dlg-head"><b id="dlg-title">Replace image</b>
            <ol class="dlg-steps"><li data-step="1"><i>1</i>Choose</li><li data-step="2"><i>2</i>Where</li></ol>
            <button type="button" class="icon dlg-x" aria-label="Close" title="Close (Esc)">${svg(I.x)}</button></div>
          <div class="dlg-body"></div>
          <div class="dlg-foot"></div>
        </div>
      </div>
      <div class="topbar" role="toolbar" aria-label="Edit with Claude" hidden>
        <span class="tb-on" title="Edit mode is on. Done leaves it."><i></i><span class="tb-l2">Editing</span></span>
        <nav class="tb-path" aria-label="Where you are on the page"></nav>
        <button type="button" class="tb-reach" data-tb="reach" aria-haspopup="menu" hidden></button>
        <span class="tb-sep"></span>
        <div class="tb-mid">
          <div class="tb-hintrow">
            <p class="tb-hint">Click text to type in it, or anything else to select it.</p>
            <button type="button" class="tb-fill" data-tb="more" aria-haspopup="menu">Whole page${svg(I.down, 14)}</button>
            <button type="button" class="tb-fill tb-typos" data-tb="typos" title="Go to the next possible typo" hidden><i></i><span></span></button>
            <button type="button" class="tb-primary" data-tb="chat" title="Chat with Claude about the whole site: bigger changes, new pages">${svg(I.sparkle, 15)}<span class="tb-l2">Chat with Claude</span></button>
          </div>
          <div class="tb-sel" hidden>
            <button type="button" class="tb-primary" data-tb="ask">${svg(I.sparkle, 15)}Ask Claude…</button>
            <button type="button" class="tb-fill" data-tb="edit">${svg(I.pencil, 15)}Edit text</button>
            <button type="button" class="tb-fill" data-tb="link">${svg(I.link, 15)}<span class="tb-l2"></span></button>
            <button type="button" class="tb-fill" data-tb="image" aria-label="Edit image">${svg(I.image, 15)}<span class="tb-l2">Edit image</span></button>
            <button type="button" class="tb-fill" data-tb="spacing" aria-haspopup="dialog" aria-label="Spacing" title="Spacing">${svg(I.spacing, 15)}<span class="tb-l2">Spacing</span>${svg(I.down, 14)}</button>
            <button type="button" class="tb-fill" data-tb="more" aria-haspopup="menu">More${svg(I.down, 14)}</button>
            <button type="button" data-tb="clear" aria-label="Clear selection" title="Clear selection (Esc)">${svg(I.x, 15)}</button>
          </div>
          <div class="tb-job" hidden>
            <span class="tb-dot"></span><span class="tb-ok">${svg(I.check, 13, 3)}</span><span class="tb-info">${svg(I.info, 18)}</span>
            <b class="tb-job-title"></b><span class="tb-time"></span><span class="tb-now"></span>
            <div class="tb-seg" role="group" aria-label="Compare with how it was"><button type="button" data-cmp="before" aria-pressed="false">Before</button><button type="button" data-cmp="after" aria-pressed="true">After</button></div>
            <button type="button" class="tb-fill" data-tb="job-undo">${svg(I.undo, 15)}Undo</button>
            <button type="button" class="tb-fill" data-tb="job-lang" hidden></button>
            <button type="button" class="tb-fill" data-tb="job-reply"></button>
            <button type="button" class="tb-primary" data-tb="job-keep"></button>
          </div>
          <div class="tb-typing" hidden>
            <b></b><button type="button" class="tb-chip" data-tb="reach"><span></span>${svg(I.down, 12)}</button>
            <span class="tb-keys"><kbd>Esc</kbd> cancel · <kbd>Enter</kbd> save</span>
            <span style="flex: 1"></span>
            <button type="button" class="tb-fill" data-tb="typing-ask" title="Keep what you typed and ask Claude to change it" aria-label="Ask Claude">${svg(I.sparkle, 15)}<span class="tb-l2">Ask Claude…</span></button>
            <button type="button" class="tb-fill" data-tb="typing-link" title="Save the text and change where it links to">${svg(I.link, 15)}Link</button>
            <button type="button" class="tb-fill" data-tb="cancel">Cancel</button>
            <button type="button" class="tb-primary" data-tb="save">${svg(I.check, 15)}Save text</button>
          </div>
          <div class="tb-lost" hidden>
            ${svg(I.info, 18)}<b></b><span class="tb-quote"></span>
            <span style="flex: 1"></span>
            <button type="button" class="tb-fill" data-tb="lost-go"></button>
            <button type="button" class="tb-fill" data-tb="lost-discard">Discard</button>
            <button type="button" class="tb-primary" data-tb="lost-copy">Copy text</button>
          </div>
        </div>
        <div class="tb-end" style="display: contents">
          <span class="tb-save" role="status" hidden><i></i>${svg(I.check, 14, 3)}<span></span><button type="button" data-tb="retry">Retry</button></span>
          <button type="button" class="status" data-tb="status"><i></i><em>Ready</em></button>
          <button type="button" data-tb="undo" aria-label="Undo">${svg(I.undo, 16)}<span class="tb-l2">Undo</span></button>
          <button type="button" class="tb-ic" data-tb="history" title="History" aria-label="History">${svg(I.clock, 16)}</button>
          <button type="button" class="tb-ic" data-tb="images" title="Images" aria-label="Images">${svg(I.image, 16)}</button>
          <button type="button" class="tb-ic" data-tb="settings" title="Settings" aria-label="Settings">${svg(I.gear, 16)}</button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-done" data-tb="done" title="Leave edit mode">Done</button>
        </div>
      </div>
      <div class="panel collapsed">
        <header title="Drag to move · double-click to put it back">
          <div class="hdr main-hdr">
            <span class="logo">${svg(I.sparkle, 16)}</span><span class="main-titles"><span class="title main-title">Ask Claude</span><span class="main-sub"></span></span>
            <button type="button" class="icon size" aria-label="Make the chat bigger" title="Bigger">${svg(I.expand, 16)}</button>
            <button type="button" class="icon fold" aria-label="Close the panel" title="Close the panel">${svg(I.x)}</button>
          </div>
          <div class="hdr sub-hdr" hidden>
            <button type="button" class="icon back" aria-label="Back to editing" title="Back to editing">${svg(I.back)}</button>
            <span class="title sub-title"></span><span class="sub-meta"></span>
            <button type="button" class="icon fold" aria-label="Close the panel" title="Close the panel">${svg(I.x)}</button>
          </div>
        </header>

        <div class="view" data-view="main">
          <div class="sel-link" hidden>
            <span class="link-to"></span>
            <form class="link-form">
              <div class="tabs" role="radiogroup" aria-label="Link to"><button type="button" role="radio" data-link-kind="page">Page on this site</button><button type="button" role="radio" data-link-kind="web">Other website</button></div>
              <input type="text" inputmode="url" autocomplete="off" spellcheck="false" aria-label="Where the link goes">
              <div class="link-pages" role="listbox" aria-label="Pages of this site"></div>
              <div class="link-row"><span>Opens in</span><div class="tabs" role="radiogroup" aria-label="Opens in"><button type="button" role="radio" data-link-open="">Same tab</button><button type="button" role="radio" data-link-open="_blank">New tab</button></div></div>
              <div class="link-actions"><button type="button" class="btn sm link-cancel">Cancel</button><button type="submit" class="btn sm primary">Save</button></div>
            </form>
          </div>
          <div class="scroll">
            <div class="log" aria-live="polite"></div>
            <p class="empty">Tell Claude what to change. It sees a screenshot of the part you picked and edits the page for you. Every change can be undone.</p>
          </div>
          <div class="spacing" hidden></div>
          <form class="composer">
            <span class="scope" hidden><span></span><button type="button" class="scope-x" aria-label="Ask about the whole page instead" title="Ask about the whole page instead">${svg(I.x, 13)}</button></span>
            <div class="field">
              <div class="atts" hidden></div>
              <textarea id="ce-ask" rows="2" aria-label="Ask Claude"></textarea>
              <div class="field-row">
                <button type="button" class="btn sm add-img" aria-haspopup="menu">${svg(I.image, 15)}Add images</button>
                <span class="hint">Enter sends · Shift+Enter for a new line</span>
                <button type="submit" class="send" aria-label="Send" title="Send (Enter)">${svg(I.send, 18, 2.2)}</button>
              </div>
            </div>
            <input type="file" class="att-file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple hidden>
          </form>
          <div class="drop">Drop pictures to add them to the message</div>
        </div>

        <div class="view" data-view="history" hidden>
          <div class="hist-list"></div>
          <p class="view-foot">Each page has its own history. Undo puts the page back exactly as it was. The last 200 changes are kept, also after a restart.</p>
        </div>

        <div class="view" data-view="settings" hidden>
          <div class="settings">
            <section><p class="label">Appearance</p>
              <div class="tabs theme" role="radiogroup" aria-label="Panel colours">
                <button type="button" role="radio" data-theme-set="system">Match computer</button><button type="button" role="radio" data-theme-set="light">Light</button><button type="button" role="radio" data-theme-set="dark">Dark</button>
              </div>
            </section>
            <section><p class="label">While editing</p>
              <label class="s-row"><span><b>Double-check with a screenshot</b><small>After each change Claude looks at the result and fixes layout problems it sees. Turn off for faster edits.</small></span><input type="checkbox" role="switch" class="sw set-check"><i class="switch"></i></label>
              <label class="s-row"><span><b>Show spacing on the page</b><small>Coloured areas for space inside, space outside and gaps in the Spacing tab.</small></span><input type="checkbox" role="switch" class="sw set-overlay"><i class="switch"></i></label>
              <label class="s-row"><span><b>Pause animations while editing</b><small>Stops sliders, moving effects and videos while the editor is open, so things stay still while you pick and edit.</small></span><input type="checkbox" role="switch" class="sw set-still"><i class="switch"></i></label>
              <label class="s-row"><span><b>Check spelling</b><small>Underlines possible typos while editing. Click one to fix it or add the word to the shared word list.</small></span><input type="checkbox" role="switch" class="sw set-spell"><i class="switch"></i></label>
            </section>
            <section><p class="label">Conversation</p>
              <div class="s-row"><span><small>Claude forgets this conversation. Your changes and history stay.</small></span><button type="button" class="btn sm new-chat">Start a new chat</button></div>
            </section>
            <section><p class="label">Shortcuts</p>
              <dl class="shortcuts">
                <dt>Select without pressing it (e.g. a slider arrow)</dt><dd><kbd>Alt</kbd> / <kbd>⌥ Option</kbd> + click</dd>
                <dt>Open a link</dt><dd><kbd>⌘</kbd> / <kbd>Ctrl</kbd> + click</dd>
                <dt>Measure distance</dt><dd><kbd>Shift</kbd> + point</dd>
                <dt>Send</dt><dd><kbd>Enter</kbd></dd>
                <dt>New line</dt><dd><kbd>Shift</kbd> + <kbd>Enter</kbd></dd>
                <dt>Clear the selection</dt><dd><kbd>Esc</kbd></dd>
              </dl>
              <small style="font-size:12px;color:var(--muted)">Alt on Windows and Linux, ⌥ Option on Mac. On a tablet a tap selects; a link does not open.</small>
            </section>
            <section><p class="label">Panel</p>
              <div class="s-row"><span><small>Drag the title bar to move it, the bottom-right corner to resize it.</small></span><button type="button" class="btn sm reset-panel">Reset size and place</button></div>
            </section>
          </div>
          <p class="view-foot session-foot">For developers: no Claude session started yet.</p>
        </div>

        <div class="grip" title="Drag to resize · double-click for the default size"></div>
      </div>`;
    const $ = (s) => canvas.querySelector(s);
    const $$ = (s) => [...canvas.querySelectorAll(s)];
    const hoverBox = $('.box.hover'), cursorTag = $('.cursor-tag'), selBox = $('.box.selected'), topbar = $('.topbar'), panel = $('.panel'), log = $('.log'), scroller = $('.scroll'), galScrim = $('.gal-scrim'), gal = $('.gal'), input = $('#ce-ask'); // the panel's box (the Ask box next to the selection comes first in the markup)
    let open = false, altDown = false, pickedWithAlt = false, hovered = null, selected = null, editing = null, seq = 0, lastPointed = null, typoRanges = []; // typoRanges: see "typos"
    let tab = sessionStorage.getItem(`${STORE}:tab`) || 'ask', view = 'main';
    const pending = new Map();
    // Typing not saved yet, and the save chip (see "typing is never lost")
    const UNSAVED = `${STORE}:unsaved`;
    let unsaved = (() => { try { return JSON.parse(sessionStorage.getItem(UNSAVED) || '[]'); } catch { return []; } })();
    let save = (() => { try { return JSON.parse(sessionStorage.getItem(`${STORE}:save`) || 'null'); } catch { return null; } })(), saveTimer = null, offline = false;
    const pref = (key, fallback) => { try { const v = localStorage.getItem(`${STORE}:${key}`); return v === null ? fallback : v === '1'; } catch { return fallback; } };
    const setPref = (key, on) => { try { localStorage.setItem(`${STORE}:${key}`, on ? '1' : '0'); } catch {} };
    const inspector = createInspector({
      canvas, mount: $('.spacing'), touch: TOUCH,
      onApply: (instruction, label) => ask(instruction, undefined, label),
      onSelect: (el) => select(el),
      parentOf: (el) => pick(el.parentElement),
      nameOf: (el) => kindOf(el).name,
    });
    inspector.setOverlay(pref('overlay', true));

    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = `html.claude-edit-picking, html.claude-edit-picking * { cursor: ${CURSOR} !important; }
      html.claude-edit-on { padding-top: ${TOP}px !important; scroll-padding-top: ${TOP}px; }
      ::highlight(claude-typo) { text-decoration: underline wavy #E5484D; text-decoration-thickness: 1.5px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
      ::highlight(claude-typo-on) { background-color: rgba(229, 72, 77, .16); }
      /* Still = at the end, not frozen halfway: a fade-in stopped at its first frame stays see-through (a slide shown while editing) */
      html[data-motion="paused"] *, html[data-motion="paused"] *::before, html[data-motion="paused"] *::after { animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition: none !important; scroll-behavior: auto !important; }`;
    document.head.append(cursorStyle);

    // Editors only need this app: hide Astro's own buttons (Menu, Inspect, Audit, Settings) and separators.
    // ponytail: CSS on Astro's toolbar markup (#bar-container, data-app-id); recheck after Astro upgrades.
    const hideOthers = document.createElement('style');
    hideOthers.textContent = '#bar-container > :not([data-app-id="claude-edit"]) { display: none !important; }';
    document.querySelector('astro-dev-toolbar')?.shadowRoot?.append(hideOthers);

    // ── where each element is written (kept in memory by the head script, not in the DOM) ──
    const srcMap = window.__claudeEditSrc ?? new WeakMap();
    const src = (el) => srcMap.get(el);
    const pick = (node) => {
      for (let el = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) if (src(el)) return el;
      return null;
    };
    const sameSource = (el) => {
      const [file, loc] = src(el);
      return [...document.body.querySelectorAll('*')].filter((n) => { const s = src(n); return s && s[0] === file && s[1] === loc; });
    };
    // A file in src/pages (or an .html file) is one page; any other file (Header.astro, HeroSlide.astro) is a shared piece used by many.
    const isPageFile = (file) => /(^|\/)src\/pages\/|\.html?$/i.test(file);
    const pieceName = (file) => {
      const n = file.split('/').pop().replace(/\.\w+$/, '');
      return n.length <= 3 ? n.toUpperCase() : n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase()); // Faq → FAQ
    };
    // What an element is, in words an editor uses; a plain block written in a shared piece is named after it ("Hero slide").
    const kindOf = (el) => {
      const k = baseKind(el), s = src(el);
      if (k.name !== 'Block' || !s || isPageFile(s[0])) return k;
      const name = pieceName(s[0]);
      return { ...k, name, plural: `${name.toLowerCase()}s` };
    };
    // Written in a shared piece, so typing there (or changing it) changes every page that uses the piece: its name, or ''.
    const sharedOf = (el) => { const s = el && src(el); return s && !isPageFile(s[0]) ? pieceName(s[0]) : ''; };
    // Worth saying on the page: text that lives in a shared piece, and the header and footer.
    const sharedNote = (el) => !!sharedOf(el) && (isPlainText(el) || !!el.closest('header, footer'));
    // The pages (addresses) a shared piece is on, from the dev server's usage index (index.mjs); null until it arrived.
    let pageUse = null; // { files: { file → routes }, pages: [{ path, title, lang }] }
    const pagesOf = (el) => { const s = sharedOf(el) && src(el); return (s && pageUse?.files[s[0]]) || null; };
    const nPages = (n) => `${n} page${n === 1 ? '' : 's'}`;
    const reachShort = (el) => (pagesOf(el) ? `changes ${nPages(pagesOf(el).length)}` : 'same on all pages');
    // An element written inside a component (Card.astro) is shared by every instance.
    // Find where THIS instance's content is written (the page), so Claude edits the instance, not the component.
    const usedAt = (el) => {
      const [file] = src(el);
      let root = el;
      for (let up = pick(root.parentElement); up && src(up)[0] === file; up = pick(up.parentElement)) root = up;
      const inner = [...root.querySelectorAll('*')].find((n) => src(n) && src(n)[0] !== file);
      return inner && { file: src(inner)[0], loc: src(inner)[1] };
    };
    // The text as written (innerText follows CSS, so an uppercased label would read as shouting)
    const plainText = (el) => (el.tagName === 'IMG' ? el.alt || 'Image' : (el.textContent || '').trim().replace(/\s+/g, ' '));
    const textOf = (el) => (el.tagName === 'IMG' ? el.alt || 'Image' : (el.innerText || '').trim().replace(/\s+/g, ' '));
    const describe = (el) => ({
      file: src(el)[0],
      loc: src(el)[1],
      tag: el.tagName.toLowerCase(),
      kind: kindOf(el).name,
      text: textOf(el) || el.outerHTML.slice(0, 300),
      usedAt: usedAt(el),
    });
    const isPlainText = (el) => el && el.children.length === 0 && textOf(el) && el.tagName !== 'IMG';

    // ── outlines on the page ──
    const visible = (el) => { const r = el?.isConnected && el.getBoundingClientRect(); return !!r && (r.width > 0 || r.height > 0); }; // e.g. not on a hidden slide
    // An outline 4px around the element. A full-width part (header, hero) is kept inside the window, so all four sides
    // show. `label` (HTML) is its name tag; without one the tag is hidden.
    const place = (box, el, label = '') => {
      if (!open || !visible(el)) return void (box.style.display = 'none');
      const r = el.getBoundingClientRect(), left = Math.max(1, r.left - 4), right = Math.min(innerWidth - 1, r.right + 4);
      Object.assign(box.style, { display: 'block', top: `${r.top - 4}px`, left: `${left}px`, width: `${right - left}px`, height: `${r.height + 8}px` });
      const tag = box.querySelector('span');
      tag.hidden = !label;
      if (!label) return;
      if (tag.dataset.label !== label) { tag.innerHTML = label; tag.dataset.label = label; }
      placeTag(box, tag, el, r, left);
    };
    // A tag sits on a corner of the outline, like a tab: top-left where that is empty page, else the first free corner
    // (top-right, bottom-left, bottom-right: in a list the end of the row above is usually empty). With no free corner it
    // stays top-left, over the neighbour above, never over the element's own text: that is what you are working on.
    // An element whose top is scrolled out of view keeps its tag at the top of what is still visible.
    // Designed in Claude Design, "Edit mode outlines and tags": https://claude.ai/artifact/TnyvQQ36qR3AohqWhuA4Xz
    const TAG_H = 20;
    // Free: only the element's own surroundings there, or the empty part of a neighbour's box (a full-width list item
    // whose text ends early). Text, images and buttons count as taken.
    const onText = (px, py) => {
      const p = document.caretPositionFromPoint?.(px, py), node = p ? p.offsetNode : document.caretRangeFromPoint?.(px, py)?.startContainer;
      const at = p ? p.offset : document.caretRangeFromPoint?.(px, py)?.startOffset;
      if (node?.nodeType !== 3) return false;
      const r = document.createRange();
      return [at - 1, at].some((i) => {
        if (i < 0 || i >= node.length) return false;
        r.setStart(node, i); r.setEnd(node, i + 1);
        return [...r.getClientRects()].some((c) => px >= c.left - 1 && px <= c.right + 1 && py >= c.top - 1 && py <= c.bottom + 1);
      });
    };
    // Checked within the element's own width: the outline's 4px beyond it may be another layer (a menu over a photo).
    const free = (el, r, x, y, w) => [y + 4, y + 10, y + 16].every((py) =>
      [x + 2, x + w / 3, x + 2 * w / 3, x + w - 2].map((px) => Math.min(Math.max(px, r.left + 1), r.right - 1)).every((px) => {
        const at = document.elementFromPoint(px, py);
        return !at || at.contains(el) || (!['image', 'button'].includes(baseKind(at).icon) && !onText(px, py));
      }) && ![x - 4, x + w + 4].some((px) => onText(px, py))); // a little air beside text
    function placeTag(box, tag, el, r, left) {
      const w = tag.offsetWidth, right = left + box.offsetWidth, minY = TOP + 4;
      const xl = Math.max(6, Math.min(left, innerWidth - w - 6)), xr = Math.max(xl, Math.min(right - w, innerWidth - w - 6));
      const above = r.top - 4 - TAG_H + 2, below = r.bottom + 4 - 2; // overlapping the 2px outline, so it reads as attached
      const fits = (y) => y >= minY && y + TAG_H <= innerHeight;
      const corners = [['above', xl, above], ['above right', xr, above], ['below', xl, below], ['below right', xr, below]];
      const sticky = ['inside', xl, Math.max(minY, Math.min(r.top + 6, r.bottom - TAG_H - 6))];
      let [spot, x, y] = !fits(above) && r.height >= 3 * TAG_H ? sticky // a big one scrolled past its top: the top of what is visible
        : corners.find(([, cx, cy]) => fits(cy) && free(el, r, cx, cy, w))
          ?? (fits(above) ? corners[0] // over the neighbour above
            : fits(below) ? corners[2] : sticky); // a small one right under the bar: over the neighbour below
      box.dataset.tag = spot;
      Object.assign(tag.style, { left: `${x - left - 2}px`, top: `${y - (r.top - 4) - 2}px` }); // from the box's inner edge (2px border)
    }
    const tagHtml = (icon, text) => `${svg(I[icon], 12, 2.4)}<b>${escapeHtml(text)}</b>`;
    const reposition = () => {
      // A part of the page (About, Header) by its name from the Parts list, anything else by its kind
      place(selBox, selected, selected && tagHtml(editing?.el === selected ? 'pencil' : kindOf(selected).icon, parts().includes(selected) ? partName(selected) : kindOf(selected).name));
      place(hoverBox, hovered !== selected ? hovered : null);
      if (!open || editing || !hovered || hovered === selected) cursorTag.hidden = true;
      placeJob();
      placeZones();
      inspector.render();
    };

    // ── the Edit mode top bar ──
    const lang = (() => { const l = document.documentElement.lang || 'en'; try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(l.split('-')[0]); } catch { return l; } })();
    // "Home" also for a language's home (/bs-ba/); other pages by their address
    const pageLabel = () => { const path = decodeURIComponent(location.pathname).replace(/\/$/, '') || '/'; return `${path === '/' || /^\/[a-z]{2}(-[a-z]{2})?$/i.test(path) ? 'Home' : path}${otherLang() ? ` · ${lang}` : ''}`; }; // the language only where there is another
    const reachText = (el) => (pagesOf(el) ? `Changes ${nPages(pagesOf(el).length)}` : sharedOf(el) ? `Changes every page that uses “${sharedOf(el)}”` : otherLang() ? `Changes the ${lang} page only` : 'Changes this page only');
    function renderBar() {
      topbar.hidden = !open;
      // One thing in the middle: typing, else text that could not be put back, else a request to Claude, else the
      // selection, else the hint.
      const lost = unsaved.find((u) => u.lost), row = editing ? 'typing' : lost ? 'lost' : job ? 'job' : selected ? 'sel' : 'hintrow';
      topbar.classList.toggle('typing', row === 'typing');
      topbar.classList.toggle('job', row === 'job');
      for (const r of ['typing', 'lost', 'job', 'sel', 'hintrow']) $(`.tb-${r}`).hidden = r !== row;
      renderPath();
      if (row === 'job') renderJob();
      if (lost) {
        const here = lost.page === location.pathname;
        $('.tb-lost b').textContent = here ? 'Not saved, its place changed:' : `Not saved, on ${lost.page}:`;
        $('.tb-lost b').title = here ? 'The text where you typed this changed meanwhile, so yours could not be put back. Copy it, then click the text to type it in again.' : 'Go there to keep typing it, or copy it.';
        $('.tb-quote').textContent = `“${lost.text.trim()}”`;
        $('.tb-quote').title = $('[data-tb="lost-copy"]').title = lost.text.trim();
        $('[data-tb="lost-go"]').hidden = here;
        $('[data-tb="lost-go"]').textContent = 'Go to that page';
      }
      renderSave();
      if (editing) {
        $('.tb-typing b').textContent = `${editing.restored ? 'Not saved yet · t' : 'T'}yping`; // in what: the name beside it
        $('.tb-chip span').textContent = reachText(editing.el);
        $('.tb-chip').classList.toggle('shared', !!sharedOf(editing.el));
        $('.tb-chip').disabled = !pagesOf(editing.el);
        $('.tb-chip').title = pagesOf(editing.el) ? `Text in “${sharedOf(editing.el)}” shows on all of them. Show the pages` : '';
        $('[data-tb="typing-link"]').hidden = !linkOf(editing.el); // a button made of plain text: clicking it types, so its link is here
      }
      if (selected) $('[data-tb="edit"]').hidden = !isPlainText(selected);
      // Next to the path: a shared piece says how many pages it changes (while typing, the typing chip says it)
      const reach = $('.tb-reach'), shared = !!selected && !editing && sharedNote(selected);
      reach.hidden = !shared;
      if (shared) {
        reach.innerHTML = `${escapeHtml(reachShort(selected))}${pagesOf(selected) ? svg(I.down, 12, 2.4) : ''}`;
        reach.disabled = !pagesOf(selected);
        reach.title = pagesOf(selected) ? `“${sharedOf(selected)}” is on ${nPages(pagesOf(selected).length)}. Show them` : '';
      }
      const newest = historyEntries.find((e) => !e.undone && e.page === location.pathname);
      $('[data-tb="undo"]').disabled = !newest;
      $('[data-tb="undo"]').title = newest ? `Undo: ${newest.label}` : 'Nothing to undo on this page';
      $$('.topbar [data-tb="history"], .topbar [data-tb="settings"]').forEach((b) => b.setAttribute('aria-pressed', String(!panel.classList.contains('collapsed') && view === b.dataset.tb)));
      $('.topbar [data-tb="images"]').setAttribute('aria-pressed', String(!galScrim.hidden));
      const nTypos = typoRanges.length;
      $('[data-tb="typos"]').hidden = !nTypos;
      $('[data-tb="typos"] span').textContent = `${nTypos} possible typo${nTypos === 1 ? '' : 's'}`;
      fitBar();
    }
    // Shortest labels that still fit: depends on the window, the page address and what is selected, so it is measured.
    function fitBar() {
      if (!open) return;
      const mid = $('.tb-mid'), over = () => mid.scrollWidth > mid.clientWidth + 1;
      topbar.classList.remove('fold', 'fit1', 'fit2');
      for (const step of ['fold', 'fit1', 'fit2']) if (over()) topbar.classList.add(step);
    }
    // While editing the page sits below the bar. Sticky or fixed parts pinned to the top (the site header) move down
    // with it, otherwise they would slide under the bar.
    // ponytail: scans every element once per switch-on; fine for these pages, cache the list if a page gets huge
    let pinned = [];
    function pushPage(on) {
      document.documentElement.classList.toggle('claude-edit-on', on);
      pinned.forEach(([el, top]) => { el.style.top = top; if (!el.getAttribute('style')) el.removeAttribute('style'); }); // leave the page as it was
      pinned = [];
      if (!on) return;
      for (const el of document.body.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if ((s.position === 'sticky' || s.position === 'fixed') && s.top === '0px') { pinned.push([el, el.style.top]); el.style.top = `${TOP}px`; }
      }
    }

    // Sliders, accordions and late images move things without a scroll or resize: follow them.
    // ponytail: a 400 ms poll while editing (outlines of the parts too); switch to ResizeObserver/MutationObserver if it ever shows up in profiles
    setInterval(safe(() => { if (open) { reposition(); fitBar(); } }), 400); // fitBar: also after a resize or a label change

    // ── selection ──
    function select(el, quiet = false) {
      selected = el;
      if (el) {
        const t = describe(el);
        // The top bar has the actions; an open panel follows the selection, a closed one stays closed.
        if (!quiet && !panel.classList.contains('collapsed') && view !== 'main') setView('main');
        const im = imageOf(el);
        $('[data-tb="image"]').hidden = !im;
        if (im) $('[data-tb="image"]').title = `${im.tagName === 'IMG' && im === el ? 'Image' : 'Background image'}: focal point, description, replace`;
        sessionStorage.setItem(`${STORE}:sel`, JSON.stringify({ file: t.file, loc: t.loc, index: sameSource(el).indexOf(el), page: location.pathname }));
      } else sessionStorage.removeItem(`${STORE}:sel`);
      closeMore();
      closeSpace();
      closeAskPop();
      showLink();
      setComposer();
      setTab(el ? tab : 'ask');
      reposition();
      renderBar();
    }
    // The panel shows the conversation ("ask") or, from the top bar's Spacing button, the spacing controls.
    function setTab(next) {
      tab = next;
      sessionStorage.setItem(`${STORE}:tab`, tab);
      const spacing = tab === 'spacing' && !!selected;
      panel.classList.toggle('tab-spacing', spacing);
      $('.spacing').hidden = !spacing;
      $('.main-title').textContent = spacing ? 'Spacing' : panel.classList.contains('big') ? 'Chat with Claude' : 'Ask Claude';
      inspector.setTarget(open && (spacing || spaceOpen) ? selected : null, selected ? { kind: kindOf(selected).name, plural: kindOf(selected).plural } : {});
    }

    // ── More ▾ in the top bar: ready-made requests for what's selected, or for the whole page ──
    // Link, image and text have their own buttons, so they're not repeated here.
    const menu = $('.more-menu');
    let menuBtn = null; // the button whose menu is open (aria-expanded)
    const closeMore = () => {
      if (!menu.hidden && menu.onmouseleave) { hovered = null; menu.onmouseleave = null; reposition(); } // a rows menu was outlining a row
      menuBtn?.removeAttribute('aria-expanded'); menuBtn = null;
      menu.hidden = true;
    };
    function openMore(btn) {
      if (!menu.hidden && menu.dataset.for === 'more') return closeMore();
      menu.dataset.for = 'more';
      menu.classList.remove('wide', 'tree');
      const k = selected && kindOf(selected);
      const offered = quickActions(k).filter((a) => !a.link && !a.image && a.label !== 'Change the text');
      const actions = [...offered.filter((a) => !a.danger), ...offered.filter((a) => a.danger)]; // Remove last, below a line
      menu.innerHTML = actions.map((a, i) => `<button type="button" role="menuitem" data-i="${i}"${a.danger ? ' class="danger"' : ''}>${a.danger ? svg(I.x, 14) : ''}${a.label}${a.danger || a.fill ? '…' : ''}</button>`).join('');
      menu.querySelectorAll('[data-i]').forEach((b) => (b.onclick = safe(() => {
        const a = actions[Number(b.dataset.i)];
        if (a.danger) { // asked in the menu itself, so nothing else on screen moves
          menu.innerHTML = `<p>Remove this ${escapeHtml(k.name.toLowerCase())} from the page?</p><div class="row"><button type="button" class="no">Cancel</button><button type="button" class="yes">Remove</button></div>`;
          menu.querySelector('.no').onclick = safe(closeMore);
          menu.querySelector('.yes').onclick = safe(() => { closeMore(); ask(a.send, undefined, a.label); });
          menu.querySelector('.no').focus();
          return;
        }
        closeMore();
        if (a.fill) return tbActions.ask(a.fill);
        ask(a.send, undefined, a.label);
      })));
      menu.hidden = false;
      const r = btn.getBoundingClientRect();
      Object.assign(menu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px` });
      menu.querySelector('button')?.focus();
    }
    // Clicking anywhere else, or Esc, closes it.
    window.addEventListener('pointerdown', (e) => {
      const path = e.composedPath();
      if (!menu.hidden && !path.some((n) => n === menu || ['more', 'parts', 'page', 'tree', 'reach', 'fold'].includes(n.dataset?.tb))) closeMore();
      if (!spaceMenu.hidden && !path.some((n) => n === spaceMenu || n.dataset?.tb === 'spacing')) closeSpace();
      if (!pop.hidden && !path.some((n) => n === pop || ['ask', 'typing-ask'].includes(n.dataset?.tb) || n === menu)) closeAskPop();
      if (!typoPop.hidden && !path.some((n) => n === typoPop || n.dataset?.tb === 'typos')) closeTypo();
    }, true);
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMore(); } });

    // ── the page name ▾: how the page shows on Google (title, description), and the page in the other language ──
    function openPage(btn) {
      if (!menu.hidden && menu.dataset.for === 'page') return closeMore();
      closeSpace(); closeAskPop();
      const o = otherLang();
      menu.dataset.for = 'page';
      menu.classList.remove('wide', 'tree');
      menu.innerHTML = `<button type="button" role="menuitem" class="pg-seo">Title and description on Google…</button>${o ? `<button type="button" role="menuitem" class="pg-lang">Open the ${escapeHtml(o.name)} page</button>` : ''}`;
      menu.querySelector('.pg-seo').onclick = safe(() => openSeo(btn));
      menu.querySelector('.pg-lang')?.addEventListener('click', safe(() => { location.href = o.path; }));
      showMenuAt(btn);
    }
    const showMenuAt = (btn) => {
      menuBtn?.removeAttribute('aria-expanded');
      menuBtn = btn; btn.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
      const r = btn.getBoundingClientRect();
      Object.assign(menu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px` });
      menu.querySelector('button, input')?.focus();
    };
    function openSeo(btn) {
      const title0 = document.title, desc0 = document.querySelector('meta[name="description"]')?.content ?? '';
      menu.dataset.for = 'seo';
      menu.classList.add('wide');
      menu.innerHTML = `<p class="sp-title">How this page shows on Google</p>
        <label class="seo">Title <small class="seo-n"></small><input class="seo-t" value="${escapeHtml(title0)}" maxlength="120"></label>
        <label class="seo">Description <small class="seo-n"></small><textarea class="seo-d" rows="3" maxlength="320">${escapeHtml(desc0)}</textarea></label>
        <p class="sp-hint">Google shows about 60 characters of the title and 160 of the description. Claude changes them in this page's file; it can be undone.</p>
        <div class="row"><button type="button" class="no">Cancel</button><button type="button" class="yes">Change with Claude</button></div>`;
      const count = () => menu.querySelectorAll('.seo').forEach((l, i) => { const v = l.querySelector('input, textarea').value.length, max = i ? 160 : 60; l.querySelector('.seo-n').textContent = `${v} / ${max}${v > max ? ' · may be cut off' : ''}`; });
      menu.querySelectorAll('.seo input, .seo textarea').forEach((f) => (f.oninput = count));
      count();
      menu.querySelector('.no').onclick = safe(closeMore);
      menu.querySelector('.yes').onclick = safe(() => {
        const title = menu.querySelector('.seo-t').value.trim(), desc = menu.querySelector('.seo-d').value.trim();
        const asks = [title && title !== title0 && `its title (the <title>; the title prop of <Layout>) to: "${title}"`, desc && desc !== desc0 && `its description (meta description; the description prop of <Layout>) to: "${desc}"`].filter(Boolean);
        closeMore();
        if (!asks.length) return;
        ask(`In this page's file (the page for ${location.pathname}), change ${asks.join(' and ')}. Change nothing else.`, null, 'Title and description on Google');
      });
      showMenuAt(btn);
    }

    // ── Page parts ▾: every part of the page by name, so a part that's hard to click (header, footer) is one pick away ──
    // The page's own header and footer (not a card's <header>), and every part of <main>.
    const parts = () => [...document.querySelectorAll('header, footer, main > *')]
      .filter((el, i, all) => all.indexOf(el) === i && src(el) && visible(el) && (el.parentElement?.closest('main') ? el.parentElement.tagName === 'MAIN' : !el.parentElement?.closest('article, section, header, footer')))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const partName = (el) => {
      if (el.tagName === 'HEADER') return 'Header';
      if (el.tagName === 'FOOTER') return 'Footer';
      if (el.id) {
        // The id is often its title as a slug ("why-acme"): then the title itself, with its letters (š, č)
        const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const own = [...el.querySelectorAll('h1, h2, h3, p')].slice(0, 4).map((n) => n.textContent.trim().replace(/\s+/g, ' ')).find((s) => slug(s) === el.id);
        const name = own ? own.replace(/[?:.!]+$/, '') : el.id.replace(/[-_]+/g, ' ');
        return name[0].toUpperCase() + name.slice(1); // eyebrows are often lower case, capitals only by CSS
      }
      const h = el.querySelector('h1, h2, h3')?.textContent.trim().replace(/\s+/g, ' ');
      return h ? (h.length > 34 ? `${h.slice(0, 33)}…` : h) : kindOf(el).name;
    };
    const stepName = (el) => (parts().includes(el) ? partName(el) : kindOf(el).name);
    // What el is part of, outermost first, up to the page part it is in
    const around = (el) => {
      const up = [];
      for (let p = pick(el.parentElement); p && up.length < 6; p = pick(p.parentElement)) { up.unshift(p); if (parts().includes(p)) break; }
      return up;
    };
    const kidsOf = (el) => [...el.querySelectorAll('*')].filter((n) => src(n) && visible(n) && pick(n.parentElement) === el);
    // Selecting from the path or its menus saves what is being typed first (a click in the bar keeps the focus in the text)
    const go = (el) => { if (editing) stopInline(true); closeMore(); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); select(el); };

    // ── the path: page ▾ › part ▾ › bigger parts › the selection ▾ ──
    // One place for where you are: the page's menu, every part of the page, one click to anything around the selection,
    // and what is inside and next to it. Steps between the part and the selection fold into "…" when the bar is full (fitBar).
    // Designed in Claude Design, "Edit bar redesign": https://claude.ai/artifact/Pxcf34jYqNiSzVTErgWPrL
    let pathEls = [], pathKey = '';
    function renderPath() {
      const chain = !selected ? [] : parts().includes(selected) ? [selected] : [...around(selected), selected];
      const key = `${pageLabel()}|${editing ? 'typing' : ''}`;
      if (key === pathKey && chain.length === pathEls.length && chain.every((el, i) => el === pathEls[i])) return; // keeps the focus
      pathEls = chain; pathKey = key;
      const last = chain.at(-1), part = chain[0] && parts().includes(chain[0]) ? chain[0] : null;
      const mids = chain.slice(part ? 1 : 0, -1), folded = mids.length > 2 ? mids.slice(0, -1) : []; // the one right above stays
      const step = (html, cls = '') => `<span class="tb-step${cls}">${svg(I.right, 12)}${html}</span>`;
      const caret = svg(I.down, 12, 2.4);
      let html = `<button type="button" data-tb="page" aria-haspopup="menu" title="${escapeHtml(pageLabel())}: its title on Google, other language">${svg(I.home, 14)}<b class="tb-pl">${escapeHtml(pageLabel())}</b>${caret}</button>`;
      if (!last) html += step(`<button type="button" data-tb="parts" aria-haspopup="menu" title="Every part of this page">${svg(I.list, 14)}<b>Pick a part</b>${caret}</button>`);
      else {
        if (part && part !== last) html += step(`<button type="button" data-tb="parts" aria-haspopup="menu" title="Every part of this page"><b>${escapeHtml(partName(part))}</b>${caret}</button>`);
        if (folded.length) html += step(`<button type="button" data-tb="fold" aria-haspopup="menu" aria-label="${folded.length} more: ${escapeHtml(folded.map(stepName).join(', '))}" title="${escapeHtml(folded.map(stepName).join(' › '))}">${svg(I.dots, 14, 2.4)}</button>`, ' fold');
        mids.forEach((el, i) => (html += step(`<button type="button" data-i="${chain.indexOf(el)}" title="Select the ${escapeHtml(stepName(el).toLowerCase())}"><b>${escapeHtml(stepName(el))}</b></button>`, i < folded.length ? ' mid' : '')));
        html += step(`<button type="button" data-tb="tree" aria-current="true" aria-haspopup="menu" title="What is inside it and next to it">${svg(I[editing?.el === last ? 'pencil' : kindOf(last).icon] ?? I.section, 14)}<b>${escapeHtml(stepName(last))}</b>${caret}</button>`);
      }
      const nav = $('.tb-path');
      nav.innerHTML = html;
      nav.querySelectorAll('[data-tb]').forEach((b) => (b.onclick = safe(() => tbActions[b.dataset.tb](b))));
      nav.querySelectorAll('[data-i]').forEach((b) => {
        const el = chain[Number(b.dataset.i)];
        b.onclick = safe(() => go(el));
        b.onmouseenter = b.onfocus = () => { hovered = el; reposition(); }; // shows on the page what a click selects
        b.onmouseleave = b.onblur = () => { hovered = null; reposition(); };
      });
    }
    // A row in the path's menus: icon, name, and the start of its text
    const row = (el, i, note = '') => {
      const t = plainText(el), name = stepName(el);
      return `<button type="button" role="menuitem" data-r="${i}"${el === selected ? ' aria-current="true"' : ''}>${svg(I[kindOf(el).icon] ?? I.section, 14)}<span>${escapeHtml(name)}</span>${note || (t && t !== name ? `<small>· ${escapeHtml(t.length > 40 ? `${t.slice(0, 39)}…` : t)}</small>` : '')}</button>`;
    };
    // Pointing at a row outlines that part on the page; clicking selects it.
    function rowsMenu(btn, kind, html, els) {
      if (!menu.hidden && menu.dataset.for === kind) return closeMore();
      closeSpace(); closeAskPop();
      menu.dataset.for = kind;
      menu.classList.remove('wide');
      menu.classList.add('tree');
      menu.innerHTML = html;
      const point = (el) => { hovered = el; reposition(); };
      menu.querySelectorAll('[data-r]').forEach((b) => {
        const el = els[Number(b.dataset.r)];
        b.onmouseenter = b.onfocus = () => point(el);
        b.onclick = safe(() => go(el));
      });
      menu.onmouseleave = () => point(null);
      showMenuAt(btn);
      menu.querySelector('[aria-current]')?.focus();
    }
    // The part ▾ (or "Pick a part ▾"): every part of the page, the one you are in marked
    function openParts(btn) {
      const list = parts(), here = pathEls[0];
      const note = (el) => (sharedNote(el) ? `<i class="pill">${pagesOf(el) ? nPages(pagesOf(el).length) : 'all pages'}</i>` : el === here && el !== selected ? '<small class="here">You’re in it</small>' : ' ');
      rowsMenu(btn, 'parts', `<p class="cap">Parts of this page</p>${list.map((el, i) => row(el, i, note(el))).join('') || '<p class="none">No parts found on this page.</p>'}`, list);
      const b = !menu.hidden && menu.querySelector(`[data-r="${list.indexOf(here)}"]`);
      if (b) { b.setAttribute('aria-current', 'true'); b.focus(); }
    }
    // The selection ▾: what is inside it and next to it (for a part: the other parts)
    function openTree(btn) {
      if (!selected) return;
      const inside = kidsOf(selected).slice(0, 20), up = pick(selected.parentElement), isPart = parts().includes(selected);
      const next = (isPart ? parts() : up ? kidsOf(up) : []).filter((n) => n !== selected).slice(0, 20);
      rowsMenu(btn, 'tree', `<p class="cap">Inside this ${escapeHtml(stepName(selected).toLowerCase())}</p>${inside.map((el, i) => row(el, i)).join('') || '<p class="none">Nothing smaller inside</p>'}`
        + (next.length ? `<p class="cap">${isPart ? 'Other parts of the page' : 'Next to it'}</p>${next.map((el, i) => row(el, inside.length + i)).join('')}` : '')
        + `<p class="keys"><kbd>${ALT}</kbd> <kbd>↑</kbd> bigger · <kbd>${ALT}</kbd> <kbd>↓</kbd> smaller</p>`, [...inside, ...next]);
    }
    // "…": the steps folded away on a narrow window
    function openFold(btn) {
      const els = [...$$('.tb-path .mid [data-i]')].map((b) => pathEls[Number(b.dataset.i)]);
      rowsMenu(btn, 'fold', els.map((el, i) => row(el, i)).join(''), els);
    }
    // ── "Changes 34 pages" ▾ (the typing chip, the selection's line): the pages a shared piece is on, this one first and
    // marked, then the others in this language, then the other language's, marked as such. Each opens in a new tab, so
    // what you are typing stays. While typing, clicks in the list don't take the focus (that would save the text). ──
    menu.onmousedown = (e) => { if (editing) e.preventDefault(); };
    function openReach(btn, el) {
      const routes = pagesOf(el);
      if (!routes) return;
      if (!menu.hidden && menu.dataset.for === 'reach') return closeMore();
      closeSpace(); closeAskPop();
      const here = (document.documentElement.lang || 'en').split('-')[0], now = decodeURIComponent(location.pathname).replace(/\/$/, '') || '/';
      const byPath = new Map(pageUse.pages.map((p) => [p.path, p]));
      const langName = (l) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(l); } catch { return l; } };
      const rows = routes.map((path) => ({ path, title: byPath.get(path)?.title || path, lang: (byPath.get(path)?.lang || here).split('-')[0] }))
        .sort((a, b) => (b.path === now) - (a.path === now) || (a.lang !== here) - (b.lang !== here)); // stable: by address within each
      const others = rows.filter((r) => r.lang !== here).length;
      menu.dataset.for = 'reach';
      menu.classList.remove('wide', 'tree');
      menu.classList.add('tree');
      menu.innerHTML = `<p class="reach-title">“${escapeHtml(sharedOf(el))}” is on ${nPages(rows.length)}${others ? ` · ${others} in ${escapeHtml(langName(rows.find((r) => r.lang !== here).lang))}` : ''}</p>` +
        rows.map((r) => `<a role="menuitem" href="${escapeHtml(r.path)}" target="_blank" title="Open ${escapeHtml(r.path)} in a new tab"${r.path === now ? ' aria-current="page"' : ''}><span>${escapeHtml(r.title)}</span><small>${escapeHtml(r.path)}</small>${r.path === now ? '<i>this page</i>' : r.lang !== here ? `<i>${escapeHtml(langName(r.lang))}</i>` : ''}</a>`).join('') +
        `<p class="reach-note">A change here shows on all of them. It can be undone in History.</p>`;
      showMenuAt(btn);
      if (!editing) menu.querySelector('a')?.focus();
    }
    let zonesHtml = '';
    function placeZones() {
      const layer = $('.zones');
      if (!open || editing) { zonesHtml = ''; return void layer.replaceChildren(); }
      const tag = selBox.style.display !== 'none' && !selBox.querySelector('span').hidden && selBox.querySelector('span').getBoundingClientRect();
      const html = parts().map((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < TOP || r.top > innerHeight) return '';
        // The name stays in view while the part is scrolled past (like the selection's tag); the selected part has that tag instead.
        // ponytail: the label's width is guessed from its length (~6.5 px a letter at 10.5 px)
        const top = Math.round(Math.min(Math.max(4, TOP + 6 - r.top), r.height - 30)), y = r.top + 2 + top, x = r.left + 6, label = partName(el) + (sharedNote(el) ? ` · ${reachShort(el)}` : ''), w = label.length * 6.5 + 12;
        const underTag = tag && x < tag.right && x + w > tag.left && y < tag.bottom && y + 16 > tag.top; // our own two labels never overlap
        const name = el === selected || underTag ? '' : `<span style="top:${top}px">${escapeHtml(label)}</span>`;
        return `<div style="top:${r.top + 2}px;left:${r.left + 2}px;width:${r.width - 4}px;height:${r.height - 4}px">${name}</div>`;
      }).join('');
      if (html !== zonesHtml) layer.innerHTML = zonesHtml = html; // the 400 ms poll mostly finds nothing moved
    }

    // ── Spacing ▾: Less / Normal / More for each kind of space, previewed on the page while you choose ──
    // "Normal" is how it is on the site now; each step follows the site's spacing scale (inspector.js). Then you say
    // how far it reaches (only this one, all like it on this page, every page) and Claude writes it. "Exact values…"
    // opens the full inspector with pixel steps in the panel.
    const spaceMenu = $('.space-menu');
    let spaceOpen = false;
    const SPACE_LABEL = { inside: 'Space inside', outside: 'Space above and below', gap: 'Gap between items' };
    function openSpace(btn) {
      if (spaceOpen) return closeSpace();
      if (!selected) return;
      closeMore();
      spaceOpen = true;
      setTab(tab); // gives the inspector the selection
      renderSpace();
      spaceMenu.hidden = false;
      const r = btn.getBoundingClientRect();
      Object.assign(spaceMenu.style, { top: `${r.bottom + 6}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - spaceMenu.offsetWidth - 8))}px` });
      spaceMenu.querySelector('button')?.focus();
    }
    function closeSpace(keep = false) {
      if (!spaceOpen) return;
      spaceOpen = false;
      spaceMenu.hidden = true;
      if (!keep && tab !== 'spacing') inspector.reset(); // closed without applying: the page goes back to how it was
      setTab(tab);
    }
    function renderSpace() {
      const k = kindOf(selected), groups = inspector.plainGroups(), options = inspector.scopeOptions();
      const seg = (g) => `<div class="sp-row"><span>${SPACE_LABEL[g]}</span><div class="sp-seg" role="group" aria-label="${SPACE_LABEL[g]}">${[[-1, 'Less'], [0, 'Normal'], [1, 'More']].map(([d, label]) => `<button type="button" data-g="${g}" data-d="${d}" aria-pressed="${inspector.level(g) === d}">${label}</button>`).join('')}</div></div>`;
      const scope = (o) => `<label class="${o.on ? '' : 'off'}" title="${o.on ? '' : escapeHtml(o.why)}"><input type="radio" name="sp-scope" value="${o.value}" ${inspector.scope === o.value ? 'checked' : ''} ${o.on ? '' : 'disabled'}>${escapeHtml(o.label)}${o.note ? ` <small>· ${escapeHtml(o.note)}</small>` : ''}</label>`;
      spaceMenu.innerHTML = `<p class="sp-title">Spacing of the ${escapeHtml(k.name.toLowerCase())}</p>
        ${groups.map(seg).join('') || `<p class="sp-hint">This has no space of its own to change. Pick a bigger part in the path (${ALT} ↑).</p>`}
        ${options.length ? `<div class="sp-scope" role="radiogroup" aria-label="Apply to"><p>Apply to</p>${options.map(scope).join('')}</div>
          <div class="row"><button type="button" class="sp-reset">Reset</button><button type="button" class="yes sp-apply">Apply with Claude</button></div>`
          : '<p class="sp-hint">The page shows a preview while you choose. Steps follow the site’s spacing scale.</p>'}
        <button type="button" class="sp-exact">Exact values…</button>`;
      spaceMenu.querySelectorAll('[data-g]').forEach((b) => (b.onclick = safe(() => { inspector.nudge(b.dataset.g, Number(b.dataset.d)); renderSpace(); })));
      spaceMenu.querySelectorAll('[name="sp-scope"]').forEach((i) => (i.onchange = safe(() => { inspector.scope = i.value; })));
      spaceMenu.querySelector('.sp-reset')?.addEventListener('click', safe(() => { inspector.reset(); renderSpace(); }));
      spaceMenu.querySelector('.sp-apply')?.addEventListener('click', safe(async () => {
        spaceMenu.querySelector('.sp-apply').disabled = true;
        await inspector.apply(inspector.scope); // screenshot is taken while the preview still shows
        closeSpace(true);
      }));
      // The panel's Spacing tab takes over the preview chosen here
      spaceMenu.querySelector('.sp-exact').onclick = safe(() => { setCollapsed(false); setView('main'); setTab('spacing'); closeSpace(true); });
    }
    spaceMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSpace(); } });

    // ── Ask Claude next to the selection: a small box under (or above) it; Enter sends, the top bar shows the rest ──
    const pop = $('.ask-pop'), popText = pop.querySelector('textarea');
    function openAskPop(prefill = '') {
      closeMore(); closeSpace();
      const k = kindOf(selected), text = plainText(selected);
      pop.querySelector('.ap-what').textContent = `Ask Claude about the ${k.name.toLowerCase()}${sharedNote(selected) ? ` · ${reachShort(selected)}` : ''}${text && text !== k.name ? ` · “${text.slice(0, 50)}${text.length > 50 ? '…' : ''}”` : ''}`;
      popText.placeholder = 'Make it sound friendlier';
      // What you typed stays as a draft when the box closes (picking the next heading), until it is sent or Esc clears it.
      // The line above says what it will be asked about, so a draft carried to another part is never sent unseen.
      if (prefill) popText.value = prefill;
      pop.hidden = false;
      const r = selected.getBoundingClientRect(), h = pop.offsetHeight, w = pop.offsetWidth;
      const below = r.bottom + 10 + h < innerHeight, top = below ? r.bottom + 10 : Math.max(TOP + 8, r.top - h - 10);
      Object.assign(pop.style, { top: `${Math.min(top, innerHeight - h - 8)}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px` });
      popText.focus(); popText.setSelectionRange(popText.value.length, popText.value.length);
    }
    const closeAskPop = () => { pop.hidden = true; };
    pop.onsubmit = safe(async (e) => {
      e.preventDefault();
      const text = popText.value.trim();
      if (!text) return popText.focus();
      await uploading; // a picture still on its way goes with the message
      popText.value = '';
      closeAskPop();
      const pictures = attached.map(({ key, name }) => ({ key, name }));
      attached = []; renderAtts();
      ask(text, undefined, undefined, { pictures });
    });
    pop.querySelector('.ap-pic').onclick = safe(() => $('.att-file').click());
    popText.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); pop.requestSubmit(); }
      if (e.key === 'Escape') { e.stopPropagation(); popText.value = ''; closeAskPop(); }
    };
    pop.querySelector('.ap-chat').onclick = safe(() => { const v = popText.value; popText.value = ''; closeAskPop(); setCollapsed(false); setView('main'); setTab('ask'); input.value = v; input.focus(); });

    // The text box says what the question is about; removing that chip asks about the whole page.
    function setComposer() {
      const k = selected && kindOf(selected), text = selected ? plainText(selected) : '';
      $('.scope').hidden = !k;
      if (k) $('.scope span').textContent = `${k.name} · “${text.slice(0, 40)}${text.length > 40 ? '…' : ''}”`;
      input.placeholder = k ? 'Make it sound friendlier' : panel.classList.contains('big') ? 'Describe a change, or a new page and what it should hold…' : 'Fix the typos on this page';
    }
    $('.scope-x').onclick = safe(() => select(null));

    // ── picking: only while Alt / ⌥ Option is held; otherwise the page gets every event ──
    const picking = () => open && altDown;
    const syncPicking = () => {
      document.documentElement.classList.toggle('claude-edit-picking', picking());
      panel.classList.toggle('picking', picking());
      if (!picking()) hovered = null;
      reposition();
    };
    // In edit mode a plain click on text starts typing in it; on anything else it selects it. The click still does its
    // normal job on the page (a slider still slides), except that links don't open. ⌘ / Ctrl + click opens one anyway.
    // Edit mode off (Done) is the way to use the page normally.
    const clickSelects = (target) => open && !editing && !!pick(target);
    // A link stretched over its card by an ::after layer ("the whole card is clickable", .cloud-post) gets every event on
    // the card. What you point at is the topmost element whose own box is under the pointer: the photo, not the title.
    const targetAt = (e) => {
      if (e.type === 'click' && !e.detail) return e.target; // Enter or Space on a focused link: no pointer position
      const on =(el) => [...el.getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
      return on(e.target) ? e.target : document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.tagName !== 'ASTRO-DEV-TOOLBAR' && on(n)) ?? e.target;
    };
    // A picture laid behind the content (a hero's background <img>): a click on empty space there means the picture.
    const pickAt = (e) => {
      const t = targetAt(e);
      if (t.matches?.('img, a, button, a *, button *') || [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return pick(t);
      const img = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n !== t && n.matches('img[data-img]') && !t.contains(n));
      return (img && pick(img)) || pick(t);
    };
    // Where in the text the click landed, so typing starts there instead of replacing everything.
    const caretAt = (e) => {
      const p = document.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (p) { const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; }
      return document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
    };
    // The name of what you point at, just below-right of the pointer (flipped at the window's edges): the same place
    // every time, unlike a tag on the outline, which in lists and menus has no room without covering the next item.
    function moveCursorTag(e) {
      cursorTag.hidden = !open || !!editing || !hovered || hovered === selected;
      if (cursorTag.hidden) return;
      const k = kindOf(hovered), html = tagHtml(k.icon, k.name);
      if (cursorTag.dataset.label !== html) { cursorTag.innerHTML = html; cursorTag.dataset.label = html; }
      const w = cursorTag.offsetWidth, x = e.clientX + 14, y = e.clientY + 20;
      Object.assign(cursorTag.style, { left: `${x + w > innerWidth - 8 ? e.clientX - w - 8 : x}px`, top: `${y + 26 > innerHeight ? e.clientY - 28 : y}px` });
    }
    const inEditor = (e) => e.composedPath().some((n) => n.tagName === 'ASTRO-DEV-TOOLBAR');
    const pageHandlers = {
      mousemove: (e) => {
        if (inEditor(e)) return void (cursorTag.hidden = true);
        const t = targetAt(e);
        lastPointed = t;
        inspector.measure(e.shiftKey && selected && !picking() ? t : null); // Shift: distance from the selection
        const next = picking() || clickSelects(t) ? (picking() ? pick(t) : pickAt(e)) : null;
        if (next !== hovered) { hovered = next; reposition(); }
        moveCursorTag(e);
      },
      click: (e) => {
        if (inEditor(e) || !e.isTrusted) return; // a page script's el.click() (a slider's autoplay) selects nothing
        // A click inside the text you're typing only moves the caret: a link around it must not open.
        if (editing?.el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); return; } // the caret moves on mousedown
        if (!picking()) {
          // Click-to-select: the click still reaches the page's own scripts; only a link's navigation is stopped.
          if (!clickSelects(targetAt(e))) return;
          if (e.target.closest('a[href]') && !e.metaKey && !e.ctrlKey) e.preventDefault(); // the stretched link still must not open
          if (String(document.getSelection()).trim()) return; // the editor is selecting text to copy
          if (job?.phase === 'done') keepJob(); // moving on keeps the last change
          const el = pickAt(e);
          select(el);
          const typo = typoAt(e);
          if (typo) return openTypo(typo);
          // A <button> is a control on the page (cookie banner, slider arrow): it does its job and is selected, not typed in.
          if (isPlainText(el) && !el.closest('button') && !e.metaKey && !e.ctrlKey) startInline(caretAt(e));
          return;
        }
        e.preventDefault(); e.stopImmediatePropagation(); // Alt: anything, links and buttons included
        pickedWithAlt = true;
        if (pick(targetAt(e))) select(pick(targetAt(e))); // a spot with nothing selectable keeps the current selection
        syncPicking();
        if (tab === 'ask') input.focus();
      },
      keydown: (e) => {
        if (e.key === 'Shift' && selected && lastPointed) inspector.measure(lastPointed);
        if (e.key === 'Alt' && !altDown) { altDown = true; syncPicking(); }
        else if (!scrim.hidden && e.key === 'Escape') { e.stopPropagation(); closeReplace(); }
        else if (!scrim.hidden && e.key === 'Tab') trapFocus(e);
        else if (e.key === 'Escape' && open && selected && !editing && !inEditor(e)) select(null);
        // ⌥↑ the part around the selection, ⌥↓ the first part inside it (not in a text field, where ⌥↑ moves the caret)
        else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && open && selected && !editing && !e.composedPath()[0].matches?.('input, textarea, [contenteditable]')) {
          e.preventDefault();
          const next = e.key === 'ArrowUp' ? pick(selected.parentElement) : kidsOf(selected)[0];
          if (next) go(next);
        }
      },
      keyup: (e) => {
        // Astro's toolbar closes the open app on every Escape keyup; here Esc only cancels typing or closes a menu.
        if (e.key === 'Escape' && open) return void e.stopPropagation();
        if (e.key === 'Shift') inspector.measure(null);
        if (e.key !== 'Alt') return;
        // Windows/Linux browsers focus their menu when Alt is released; skip that only if Alt was used to pick.
        if (pickedWithAlt) { e.preventDefault(); pickedWithAlt = false; }
        altDown = false; syncPicking();
      },
    };
    const windowHandlers = { blur: () => { altDown = false; syncPicking(); inspector.measure(null); }, scroll: reposition, resize: () => { reposition(); inspector.refresh(); } };
    for (const [type, fn] of Object.entries(pageHandlers)) document.addEventListener(type, safe(fn), true);
    for (const [type, fn] of Object.entries(windowHandlers)) window.addEventListener(type, safe(fn), true);

    // ── edit text in place (fast path, no Claude) ──
    // `at`: where the click landed (caret goes there); without it (the Edit text button) the whole text is selected.
    function startInline(at = null) {
      const el = selected;
      if (!isPlainText(el) || editing) return;
      editing = { el, before: el.textContent, target: describe(el), outline: el.style.outline, backup: { ...saveRef(el), page: location.pathname, before: el.textContent, text: el.textContent } };
      unsaved.push(editing.backup); keepUnsaved();
      if (!offline) server.send('claude-edit:typing', { active: true }); // the dev server holds page reloads until typing ends
      el.addEventListener('input', editing.onInput = safe(() => { editing.backup.text = el.textContent; keepUnsaved(); }));
      el.style.outline = 'none'; // the blue outline shows where you type; the browser's focus ring would double it
      try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; } // pasted text arrives as plain text
      el.focus();
      if (at && el.contains(at.startContainer)) { document.getSelection().removeAllRanges(); document.getSelection().addRange(at); }
      else document.getSelection().selectAllChildren(el);
      renderBar();
      el.addEventListener('keydown', editing.onKey = safe((e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); stopInline(true); } // a line break can't be saved into the page file
        else if (e.key === 'Escape') { e.stopPropagation(); stopInline(false); } // stays selected: a button's link, spacing… are next
      }));
      // Pasted text arrives as one line of plain text (the page file can't hold markup or line breaks here).
      el.addEventListener('paste', editing.onPaste = safe((e) => {
        e.preventDefault();
        document.execCommand('insertText', false, (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' '));
      }));
      // Clicking elsewhere saves; switching to another app (to copy something) doesn't.
      el.addEventListener('blur', editing.onBlur = safe(() => { if (document.hasFocus()) stopInline(true); }));
    }
    function stopInline(save) {
      if (!editing) return;
      const { el, before, target, onKey, onBlur, onPaste, onInput, outline, backup } = editing;
      editing = null;
      if (!menu.hidden && menu.dataset.for === 'reach') closeMore();
      el.style.outline = outline;
      if (!el.getAttribute('style')) el.removeAttribute('style');
      el.removeEventListener('paste', onPaste);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('input', onInput);
      el.removeAttribute('contenteditable');
      if (!offline) server.send('claude-edit:typing', { active: false }); // offline: a new server holds nothing
      renderBar();
      const after = el.textContent;
      if (!save || !after.trim()) { forget(backup); return void (el.textContent = before); } // empty: put it back (ask Claude to remove it instead)
      if (after.trim() === before.trim()) return forget(backup);
      saveTyped(el, target, before, after, backup);
    }
    // backup: its entry in `unsaved`, kept until the dev server confirms the save (or Claude has it)
    function saveTyped(el, target, before, after, backup = { ...saveRef(el), page: location.pathname, before, text: after }) {
      backup.saving = true;
      if (!unsaved.includes(backup)) unsaved.push(backup);
      keepUnsaved();
      // Not connected: nothing can be saved now. The text stays on the page and in this tab; the reload after the dev
      // server is back saves it (bringBack).
      if (offline) return add({ kind: 'info', text: 'Not saved: the editor lost its connection to the dev server. Your text is kept and is saved when it is back.' });
      const id = ++seq, msg = { id, file: target.file, loc: target.loc, oldText: before, newText: after, page: location.pathname };
      pending.set(id, { target, el, before, fallback: `Change this text to: "${after.trim()}"`, msg, backup });
      add({ kind: 'info', text: 'Saving your text…' });
      if (job?.phase !== 'working') typedJob(el, `Changed the text to “${after.trim().slice(0, 80)}”`, { from: before.trim(), to: after.trim() }); // don't replace a running request
      server.send('claude-edit:text', msg);
      setSave('saving', { id });
    }

    // ── typing is never lost ──
    // What you type is kept in this tab (sessionStorage) from the first key until the dev server confirms the save:
    // the text being typed, and saves sent but not yet answered. After any reload (yours, the one after Claude's
    // edits, the dev server restarting) bringBack() returns you to typing it, or sends a save again. Text whose place
    // is gone (or on another page) gets a row to copy it: it is never dropped without a word. While you type, the dev
    // server holds its page reloads (index.mjs).
    const keepUnsaved = () => { try { sessionStorage.setItem(UNSAVED, JSON.stringify(unsaved)); } catch {} };
    const forget = (backup) => { unsaved = unsaved.filter((u) => u !== backup); keepUnsaved(); renderBar(); };
    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    function bringBack() {
      for (const u of unsaved.splice(0)) {
        const el = u.page === location.pathname && findSaved(u), now = el && isPlainText(el) ? norm(el.textContent) : null;
        u.lost = false;
        if (now === norm(u.text)) continue; // it was saved before the reload
        if (now !== norm(u.before) || (!u.saving && editing)) { u.lost = true; unsaved.push(u); continue; } // its place changed, or another page
        const before = el.textContent;
        if (u.saving) { el.textContent = u.text; saveTyped(el, describe(el), before, u.text); continue; } // you had pressed Save
        select(el, true);
        startInline();
        el.textContent = editing.backup.text = u.text;
        editing.restored = true;
        document.getSelection().selectAllChildren(el); document.getSelection().collapseToEnd();
      }
      keepUnsaved();
      if (unsaved.length && !open) app.toggleState({ state: true });
      renderBar();
    }

    // The save chip in the top bar, for your own changes: "Saving…" → "Saved" (its time on hover), "Claude is saving it"
    // when a direct save wasn't possible, or "Couldn't save" with Retry when the dev server never answered.
    // "Not connected" wins over all of them.
    function setSave(state, extra = {}) {
      clearTimeout(saveTimer);
      save = state && { state, at: Date.now(), ...extra };
      if (state === 'saving') saveTimer = setTimeout(safe(() => setSave('failed', extra)), 10000);
      try { sessionStorage.setItem(`${STORE}:save`, JSON.stringify(['saved', 'claude'].includes(state) ? save : null)); } catch {} // the others end with the page
      renderSave();
    }
    function renderSave() {
      // "Saved" next to text that could not be saved would contradict it
      const chip = $('.tb-save'), s = offline ? 'off' : save?.state === 'saved' && unsaved.some((u) => u.lost) ? null : save?.state;
      chip.hidden = !s || (!!editing && s !== 'off');
      chip.className = `tb-save ${s}`;
      const time = save && new Date(save.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const [text, title] = {
        off: ['Not connected · not saving', 'The editor lost its connection to the dev server, so nothing can be saved now. What you type is kept in this tab and saved once the dev server runs again.'],
        saving: ['Saving…', ''],
        saved: ['Saved', `Saved at ${time}. Undo it in History.`],
        claude: ['Claude is saving it', 'Your text could not be written into the page directly, so Claude is doing it.'],
        failed: ["Couldn't save", 'The dev server did not answer. Your text is kept in this tab; try again.'],
      }[s] ?? ['', ''];
      chip.querySelector('span').textContent = text;
      chip.title = title;
    }
    // Claude saving your text: done once its change is in the history, or it finished without one (its reply says why).
    function settleClaude() {
      if (save?.state !== 'claude' || serverBusy) return;
      const done = historyEntries.find((e) => e.id > save.afterId && e.label === save.label);
      setSave(done ? 'saved' : null, done ? { at: done.at } : {});
    }
    // The dev server went away (stopped, crashed, restarting). Vite reloads the page once it is back.
    server.on('vite:ws:disconnect', safe(() => { offline = true; renderBar(); }));
    server.on('vite:ws:connect', safe(() => { offline = false; renderBar(); }));

    // ── typos: words the dictionary for the page's language doesn't know (the dev server checks, spelling.mjs) are
    // underlined in edit mode with a CSS highlight, so the page itself is not changed. A click on one opens a small box:
    // a suggestion (saved like typing it), the shared word list, or typing it yourself. ──
    // A soft hyphen (&shy;, a break point in a long word) is part of the word. Not checked: short words, abbreviations
    // (ISO, GDPR), a possessive's 's, and the parts of a web or email address (tools.google.com/dlpage).
    const WORD = /\p{L}[\p{L}\p{M}\u00AD'’-]*[\p{L}\p{M}]/gu;
    const checkable = (w) => w.length > 2 && !/^[\p{Lu}\p{M}-]+$/u.test(w);
    const inAddress = (text, i, end) => /[/@]/.test(text[i - 1] ?? '') || /[/@]/.test(text[end] ?? '') || (text[i - 1] === '.' && /\w/.test(text[i - 2] ?? '')) || (text[end] === '.' && /\w/.test(text[end + 1] ?? ''));
    function* wordsIn(text) {
      for (const m of text.matchAll(WORD)) {
        const raw = m[0].replace(/['’]s$/i, ''), word = raw.replace(/\u00AD/g, '');
        if (checkable(word) && !inAddress(text, m.index, m.index + m[0].length)) yield { word, start: m.index, end: m.index + raw.length };
      }
    }
    const typoPop = $('.typo-pop');
    let typoSeq = 0, typoTimer = null, typoOpen = null, typoIndex = -1;
    const TAB_ID = Math.random().toString(36).slice(2); // results go to every tab: each takes only its own
    // The page's own text: written in a source file the editor knows, not in scripts, form fields or the editor itself
    function pageText() {
      const nodes = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || !n.textContent.trim() || p.closest('script, style, noscript, code, pre, textarea, select, [contenteditable], astro-dev-toolbar')) return NodeFilter.FILTER_REJECT;
        return pick(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
      while (walk.nextNode()) nodes.push(walk.currentNode);
      return nodes;
    }
    // ponytail: checks the whole page each time (a few hundred words, fast); per element if pages ever get huge
    function checkSpelling() {
      clearTimeout(typoTimer);
      typoTimer = setTimeout(safe(() => {
        if (!open || !pref('spell', true) || !globalThis.CSS?.highlights) return paintTypos([]);
        const words = new Set();
        for (const n of pageText()) for (const { word } of wordsIn(n.textContent)) words.add(word);
        server.send('claude-edit:spell', { id: `${TAB_ID}:${++typoSeq}`, lang: document.documentElement.lang || 'en', words: [...words] });
      }), 300);
    }
    server.on('claude-edit:spell-result', safe(({ id, bad }) => { if (open && id === `${TAB_ID}:${typoSeq}`) paintTypos(bad); })); // a late answer after Done must not underline the page
    function paintTypos(bad) {
      const set = new Set(bad);
      typoRanges = [];
      if (set.size) for (const node of pageText()) for (const { word, start, end } of wordsIn(node.textContent)) {
        if (!set.has(word)) continue;
        const range = new Range();
        range.setStart(node, start); range.setEnd(node, end);
        typoRanges.push({ word, node, range });
      }
      if (globalThis.CSS?.highlights) {
        if (typoRanges.length) CSS.highlights.set('claude-typo', new Highlight(...typoRanges.map((t) => t.range))); else CSS.highlights.delete('claude-typo');
      }
      if (typoOpen && !typoRanges.some((t) => t.range.startContainer === typoOpen.node && t.word === typoOpen.word)) closeTypo();
      renderBar();
    }
    const inRect = (e, r) => e.clientX >= r.left - 1 && e.clientX <= r.right + 1 && e.clientY >= r.top - 1 && e.clientY <= r.bottom + 1;
    const typoAt = (e) => typoRanges.find((t) => [...t.range.getClientRects()].some((r) => inRect(e, r)));
    const LANG_NAME = { en: 'English', bs: 'Bosnian', hr: 'Croatian', sr: 'Serbian' };
    function openTypo(t) {
      closeAskPop(); closeMore();
      typoOpen = t;
      typoIndex = typoRanges.indexOf(t);
      CSS.highlights?.set('claude-typo-on', new Highlight(t.range));
      typoPop.querySelector('.tp-lang').textContent = `Possible typo · ${LANG_NAME[(document.documentElement.lang || 'en').split('-')[0].toLowerCase()] ?? 'English'}`;
      typoPop.querySelector('.tp-word').textContent = `“${t.word}”`;
      typoPop.querySelector('.tp-sugs').textContent = 'Looking for suggestions…';
      typoPop.hidden = false;
      const r = t.range.getBoundingClientRect(), h = typoPop.offsetHeight, w = typoPop.offsetWidth;
      const below = r.bottom + 8 + h < innerHeight;
      Object.assign(typoPop.style, { top: `${below ? r.bottom + 8 : Math.max(TOP + 8, r.top - h - 8)}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px` });
      server.send('claude-edit:suggest', { id: `${TAB_ID}:${t.word}`, lang: document.documentElement.lang || 'en', word: t.word });
      typoPop.querySelector('.tp-add').focus();
    }
    function closeTypo() { typoPop.hidden = true; typoOpen = null; CSS.highlights?.delete('claude-typo-on'); }
    server.on('claude-edit:suggest-result', safe(({ id, suggestions }) => {
      if (!typoOpen || id !== `${TAB_ID}:${typoOpen.word}`) return;
      const box = typoPop.querySelector('.tp-sugs');
      box.innerHTML = suggestions.length ? suggestions.map((s) => `<button type="button">${escapeHtml(s)}</button>`).join('') : 'No suggestions from the dictionary.';
      box.querySelectorAll('button').forEach((b) => (b.onclick = safe(() => fixTypo(typoOpen, b.textContent))));
    }));
    // The suggestion goes in like typing it (the fast path); text with markup inside (a <b>) is left to Claude.
    function fixTypo(t, next) {
      const el = pick(t.node.parentElement);
      closeTypo();
      if (!el) return;
      if (isPlainText(el) && el.firstChild === t.node && el.childNodes.length === 1) {
        const before = el.textContent, after = before.slice(0, t.range.startOffset) + next + before.slice(t.range.endOffset);
        const target = describe(el);
        el.textContent = after;
        saveTyped(el, target, before, after);
      } else ask(`Fix the typo "${t.word}": write it as "${next}". Change nothing else.`, describe(el), `Typo: ${t.word} → ${next}`, { el }); // its screenshot and tag: this element, not the selection
      checkSpelling();
    }
    typoPop.querySelector('.tp-add').onclick = safe(() => {
      if (!typoOpen) return;
      server.send('claude-edit:word', { id: TAB_ID, word: typoOpen.word });
      closeTypo();
    });
    server.on('claude-edit:word-result', safe(({ word, ok }) => {
      if (!ok) return;
      paintTypos(typoRanges.filter((t) => t.word.toLowerCase() !== String(word).toLowerCase()).map((t) => t.word)); // every tab: the word is fine now
    }));
    typoPop.querySelector('.tp-edit').onclick = safe(() => {
      const t = typoOpen, el = t && pick(t.node.parentElement);
      closeTypo();
      if (!el || !isPlainText(el)) return el && tbActions.ask(`Fix the typo "${t.word}"`);
      select(el);
      startInline(t.range.cloneRange()); // the word is selected: typing replaces it
    });
    typoPop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeTypo(); } });
    // The top bar's count walks through them: scroll to the next one and open its box
    function nextTypo() {
      if (!typoRanges.length) return;
      // Only ones on screen: a typo on a hidden slide or a closed menu has nothing to scroll to
      const shown = typoRanges.map((t, i) => [t, i]).filter(([t]) => t.range.getClientRects().length);
      if (!shown.length) return add({ kind: 'info', text: `“${typoRanges[0].word}” is on a part that is hidden right now, like another slide or a closed menu. Show it, then click again.` }), setCollapsed(false);
      const [t] = shown.find(([, i]) => i > typoIndex) ?? shown[0];
      t.node.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(safe(() => { select(pick(t.node.parentElement)); openTypo(t); }), 450);
    }
    $('.set-spell').checked = pref('spell', true);
    $('.set-spell').onchange = () => { setPref('spell', $('.set-spell').checked); checkSpelling(); };

    // ── links: show where a button or link goes, change it in place (fast path, no Claude) ──
    const linkOf = (el) => el?.closest('a[href]');
    // The panel's link row is only there while you change a link; the top bar shows where it goes.
    function showLink() {
      const a = linkOf(selected), href = a?.getAttribute('href');
      $('.sel-link').hidden = true;
      $('[data-tb="link"]').hidden = !a;
      if (!a) return;
      $('[data-tb="link"] span').textContent = `Link: ${href.length > 24 ? `${href.slice(0, 23)}…` : href}`;
      $('[data-tb="link"]').title = `Links to ${a.href}. Click to change it.`;
      $('[data-tb="link"]').setAttribute('aria-label', `Change the link (now ${href})`);
    }
    // Where it goes: a page of this site (picked from the list) or another website; and whether it opens in a new tab.
    let sitePages = null, linkKind = 'page', linkOpen = '';
    const isWeb = (href) => /^(https?:|mailto:|tel:|\/\/)/i.test(href);
    const langOf = (path) => /^\/([a-z]{2}-[a-z]{2})(\/|$)/i.exec(path)?.[1] ?? '';
    function editLink() {
      const a = linkOf(selected), href = a?.getAttribute('href');
      if (!a) return;
      setCollapsed(false); setView('main'); setTab('ask');
      $('.sel-link').hidden = false;
      linkOpen = a.getAttribute('target') === '_blank' ? '_blank' : '';
      $('.link-to').textContent = `Where should “${plainText(a).slice(0, 40)}” go? Now: ${href.startsWith('#') ? `${href} (on this page)` : href}${linkOpen ? ', in a new tab' : ''}`;
      if (!sitePages) server.send('claude-edit:pages', {}); // the answer fills the list
      setLinkKind(isWeb(href) ? 'web' : 'page', href);
    }
    function setLinkKind(kind, value) {
      const field = $('.link-form input');
      linkKind = kind;
      $$('[data-link-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.linkKind === kind)));
      $$('[data-link-open]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.linkOpen === linkOpen)));
      field.placeholder = kind === 'web' ? 'https://example.com' : 'Search the pages, or type /address';
      field.value = value;
      field.setCustomValidity('');
      $('.link-pages').hidden = kind !== 'page';
      renderPages('');
      field.focus(); field.select();
      $('.link-pages [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }
    // This language's pages first. Pages without a title get the link text used for them on this page.
    function renderPages(query) {
      const list = $('.link-pages'), current = $('.link-form input').value.split('#')[0], q = query.trim().toLowerCase();
      if (!sitePages) return void (list.innerHTML = '<p>Loading the pages…</p>');
      const named = new Map([...document.querySelectorAll('a[href^="/"]')].map((l) => [l.getAttribute('href'), plainText(l).slice(0, 60)]));
      const here = langOf(location.pathname);
      const rows = sitePages
        .map((p) => ({ ...p, title: (p.path === '/' || /^\/[a-z]{2}-[a-z]{2}$/i.test(p.path) ? 'Home' : '') || p.title || named.get(p.path) || p.path }))
        .filter((p) => !q || `${p.title} ${p.path}`.toLowerCase().includes(q))
        .sort((x, y) => (langOf(x.path) !== here) - (langOf(y.path) !== here));
      list.innerHTML = rows.map((p) => `<button type="button" role="option" aria-selected="${p.path === current}" data-path="${escapeHtml(p.path)}"><b>${escapeHtml(p.title)}</b><small>${escapeHtml(p.path)}</small></button>`).join('')
        || '<p>No page matches. Type an address starting with /, or pick “Other website”.</p>';
    }
    server.on('claude-edit:pages', safe(({ pages }) => { sitePages = pages; if (linkKind === 'page') renderPages(''); }));
    server.on('claude-edit:usage', safe((data) => { pageUse = data; renderBar(); reposition(); }));
    $('.link-pages').onclick = safe((e) => {
      const row = e.target.closest('[data-path]');
      if (!row) return;
      $('.link-form input').value = row.dataset.path;
      $('.link-form input').setCustomValidity('');
      $$('.link-pages [data-path]').forEach((r) => r.setAttribute('aria-selected', String(r === row)));
    });
    $$('[data-link-kind]').forEach((b) => (b.onclick = safe(() => {
      if (b.dataset.linkKind === linkKind) return;
      const old = linkOf(selected)?.getAttribute('href') ?? '', web = b.dataset.linkKind === 'web';
      linkOpen = web ? '_blank' : ''; // the usual choice: other websites in a new tab, own pages in the same one
      setLinkKind(b.dataset.linkKind, isWeb(old) === web ? old : '');
    })));
    $$('[data-link-open]').forEach((b) => (b.onclick = safe(() => {
      linkOpen = b.dataset.linkOpen;
      $$('[data-link-open]').forEach((o) => o.setAttribute('aria-checked', String(o === b)));
    })));
    $('.link-cancel').onclick = safe(showLink);
    $('.link-form input').oninput = (e) => { e.target.setCustomValidity(''); if (linkKind === 'page') renderPages(e.target.value); };
    $('.link-form').onkeydown = (e) => { if (e.key === 'Escape') showLink(); };
    $('.link-form').onsubmit = safe(async (e) => {
      e.preventDefault();
      const a = linkOf(selected), field = $('.link-form input'), old = a?.getAttribute('href');
      let next = field.value.trim();
      const bad = (msg) => { field.setCustomValidity(msg); field.reportValidity(); };
      if (linkKind === 'web') {
        if (next && !/^[a-z][a-z0-9+.-]*:/i.test(next) && !next.startsWith('//')) next = `https://${next}`; // example.com → https://example.com
        if (!/^(https?:\/\/[^\s/]+\.[^\s]+|mailto:\S+@\S+|tel:[+\d\s()-]+)$/i.test(next)) return bad('Enter a web address like https://example.com');
      } else {
        if (!/^[/#]/.test(next)) return bad('Pick a page from the list, or type an address that starts with /');
        // A page on this site that doesn't exist would be a broken link: say so before saving.
        if (next.startsWith('/') && next !== old) {
          const status = await fetch(next.split('#')[0], { method: 'HEAD' }).then((r) => r.status, () => 0);
          if (status === 404) return bad(`There's no page at ${next.split('#')[0]} on this site. Check the address or pick one from the list.`);
        }
      }
      const oldOpen = a?.getAttribute('target') === '_blank' ? '_blank' : '', open = linkOpen !== oldOpen ? linkOpen : undefined;
      showLink();
      if (!a || (next === old && open === undefined)) return;
      const tab = open === undefined ? '' : open ? ', opening in a new tab' : ', opening in the same tab';
      const fallback = `Make this link go to: ${next}${open === undefined ? '' : open ? ' and open in a new tab (target="_blank")' : ' and open in the same tab (no target attribute)'}`;
      if (pick(a) !== a) return ask(fallback, undefined, `Link: ${next}${tab}`); // the <a> itself isn't in a file we know
      const id = ++seq, target = describe(a), msg = { id, file: target.file, loc: target.loc, attr: 'href', oldText: old, newText: next, linkTarget: open, page: location.pathname };
      pending.set(id, { target, fallback, link: a, href: next, open, msg });
      if (job?.phase !== 'working') typedJob(a, `Changed the link to ${next}${tab}`);
      add({ kind: 'info', text: 'Saving the link…' });
      server.send('claude-edit:text', msg);
      setSave('saving', { id });
    });

    // ── top bar buttons ──
    // Keep the caret in the text being typed: pressing Save or Cancel must not blur it first (blur saves).
    topbar.addEventListener('mousedown', (e) => { if (editing) e.preventDefault(); });
    const openPanel = (next) => {
      if (!panel.classList.contains('collapsed') && view === next) return setCollapsed(true); // second click closes it
      setCollapsed(false);
      setView(next);
    };
    const leave = () => app.toggleState({ state: false });
    const tbActions = {
      // With something selected the box opens right next to it; for the whole page, in the panel.
      ask: (prefill = '') => {
        if (typeof prefill !== 'string') prefill = ''; // a click passes the button
        if (selected && visible(selected)) return openAskPop(prefill);
        setCollapsed(false); setView('main'); setTab('ask');
        if (prefill) input.value = prefill;
        input.focus(); input.setSelectionRange(input.value.length, input.value.length);
      },
      spacing: (b) => openSpace(b),
      edit: () => startInline(),
      link: () => editLink(),
      image: () => openImage(),
      clear: () => select(null),
      save: () => stopInline(true),
      cancel: () => stopInline(false),
      'typing-link': () => { stopInline(true); editLink(); },
      'typing-ask': () => { stopInline(true); tbActions.ask(); }, // the typed text is saved first, so Claude works on it
      retry: () => { const p = pending.get(save?.id); if (p && !offline) { server.send('claude-edit:text', p.msg); setSave('saving', { id: save.id }); } },
      'lost-copy': (b) => {
        const u = unsaved.find((x) => x.lost);
        // Without clipboard access (a tablet on the network address: not a secure origin, no navigator.clipboard) the
        // text goes into the conversation, to select and copy from there
        Promise.resolve().then(() => navigator.clipboard.writeText(u.text.trim())).then(() => { b.textContent = 'Copied'; $('[data-tb="lost-discard"]').textContent = 'Close'; },
          () => { add({ kind: 'info', text: `Your text that was not saved: ${u.text.trim()}` }); setCollapsed(false); setView('main'); });
      },
      'lost-discard': () => { forget(unsaved.find((x) => x.lost)); $('[data-tb="lost-copy"]').textContent = 'Copy text'; $('[data-tb="lost-discard"]').textContent = 'Discard'; },
      'lost-go': () => (location.href = unsaved.find((x) => x.lost).page),
      status: () => { setCollapsed(false); setView('main'); },
      'job-reply': () => { setCollapsed(false); setView('main'); },
      'job-keep': () => keepJob(),
      // The same change on the page in the other language (e.g. English ↔ German), translated by Claude.
      'job-lang': () => {
        const o = otherLang();
        if (!o || !job) return;
        // Typed text: what changed, so only that part is translated (not the whole sentence rewritten)
        const label = job.text ? `the text “${job.text.from}” was changed to “${job.text.to}”. Make only that edit there: keep the rest of the ${o.name} text as it is` : job.label;
        const el = jobTarget(), what = el ? ` It was made to the <${el.tagName.toLowerCase()}> written at ${src(el)?.[0]}:${src(el)?.[1]} (now: "${plainText(el).slice(0, 200)}").` : '';
        keepJob();
        ask(`Make the same change on the ${o.name} version of this page (${o.path}), translated into ${o.name} where it is text. The change made on ${location.pathname}: ${label}.${what} Find the matching place in the ${o.name} page's file.`, null, `Same change on the ${o.name} page`, { page: o.path });
      },
      page: (b) => openPage(b),
      more: (b) => openMore(b),
      parts: (b) => openParts(b),
      tree: (b) => openTree(b),
      fold: (b) => openFold(b),
      reach: (b) => openReach(b, editing?.el ?? selected),
      // The oldest change of the request, so its screenshot fix is undone with it.
      'job-undo': () => { const first = jobChanges().at(-1); if (first) { restore('undo', first.id); keepJob(); } },
      undo: () => { const newest = historyEntries.find((e) => !e.undone && e.page === location.pathname); if (newest) restore('undo', newest.id); },
      history: () => openPanel('history'),
      images: () => (galScrim.hidden ? (setHere(null), openLibrary()) : closeLibrary()),
      chat: () => openChat(),
      typos: () => nextTypo(),
      settings: () => openPanel('settings'),
      done: leave,
    };
    $$('[data-tb]').forEach((b) => (b.onclick = safe(() => tbActions[b.dataset.tb](b)))); // the path's buttons: renderPath

    // ── screenshots of what the editor sees, taken in the browser ──
    // The area around the element (its section), the element outlined, max ~1280px wide.
    // Returns { image: for Claude (outlined, base64), clean: the same without the outline (data URL, the "Before"),
    //           area: which AREA it is on the page (index), y: where the picture starts below the area's top (CSS px) }.
    async function screenshot(el) {
      const area = (el && el.closest(AREA)) || document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(AREA);
      if (!area) return null;
      const a = area.getBoundingClientRect();
      const scale = Math.min(1, 1280 / a.width);
      // timeout: off-screen lazy images the page never loaded would otherwise stall the capture for 30s.
      // No backgroundColor option: it replaces the section's own background.
      const full = await domToCanvas(area, { scale, timeout: 1500 });
      // Tall sections: crop to the part around the element (or the part on screen).
      const focus = el ? el.getBoundingClientRect() : { top: Math.max(a.top, 0), bottom: Math.min(a.bottom, innerHeight), left: a.left, width: 0, height: 0 };
      const maxH = 1400;
      let y0 = 0, h = full.height;
      if (h > maxH) {
        const mid = ((focus.top + focus.bottom) / 2 - a.top) * scale;
        y0 = Math.max(0, Math.min(full.height - maxH, mid - maxH / 2));
        h = maxH;
      }
      const out = document.createElement('canvas');
      out.width = full.width; out.height = h;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#fff'; // JPEG has no transparency
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(full, 0, y0, full.width, h, 0, 0, full.width, h);
      const clean = out.toDataURL('image/jpeg', 0.8);
      if (el) {
        const r = el.getBoundingClientRect();
        ctx.strokeStyle = '#ec323a'; ctx.lineWidth = 3; // red stands out on any site in the screenshot Claude sees
        ctx.strokeRect((r.left - a.left) * scale - 4, (r.top - a.top) * scale - y0 - 4, r.width * scale + 8, r.height * scale + 8);
      }
      return { image: out.toDataURL('image/jpeg', 0.8).split(',')[1], clean, area: [...document.querySelectorAll(AREA)].indexOf(area), y: y0 / scale };
    }
    // Never let a slow or failing screenshot hold up a request.
    const screenshotOrNull = (el) => Promise.race([
      screenshot(el).catch((err) => { console.warn('[claude-edit] screenshot failed', err); return null; }),
      new Promise((r) => setTimeout(() => r(null), 5000)),
    ]);

    // ── conversation: Claude's steps fold into one progress line; every change gets an Undo card ──
    let turn = null, lastReply = null, expectCheck = false, replaying = false;
    const node = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; };
    const toBottom = () => (scroller.scrollTop = scroller.scrollHeight);
    function startProgress(text) {
      if (turn) return void (turn.progress.querySelector('.ptext').textContent = text);
      turn = { steps: [], started: Date.now() };
      turn.progress = node('progress', `<span class="spin">${svg(I.spinner, 18, 2.5)}</span><span class="ptext">${text}</span><span class="ptime">0s</span>`);
      log.append(turn.progress);
    }
    function endProgress() {
      const steps = turn?.steps ?? [];
      turn?.progress.remove();
      turn = null;
      return steps;
    }
    setInterval(() => { if (turn) turn.progress.querySelector('.ptime').textContent = `${Math.round((Date.now() - turn.started) / 1000)}s`; }, 1000);
    const line = (icon, text) => log.append(node('line', `${svg(I[icon], 14)}<span>${escapeHtml(text)}</span>`));
    function add(e) {
      if (e.kind === 'user') {
        const pics = (e.pictures ?? []).map((p) => { const i = libImage(p.key); return `<span class="att">${i ? `<img src="${escapeHtml(thumb(i, 120))}" alt="">` : `<i>${svg(I.image, 14)}</i>`}<span>${escapeHtml(p.name)}</span></span>`; }).join('');
        log.append(node('msg user', (e.target ? `<small>${escapeHtml(e.target.text)}</small>` : '') + escapeHtml(e.text) + (pics ? `<span class="msg-pics">${pics}</span>` : '')));
        startProgress('Claude is working…');
      } else if (e.kind === 'tool') {
        startProgress('Claude is working…');
        turn.steps.push(e.text);
        const [verb, what] = splitStep(e.text);
        turn.progress.querySelector('.ptext').textContent = verb ? `Claude is ${VERB[verb]} ${what}…` : 'Claude is working…';
        jobStep(verb ? `${VERB[verb]} ${what}` : '');
      } else if (e.kind === 'assistant' || e.kind === 'error') {
        const steps = endProgress();
        // Claude's look at the "after" screenshot: one quiet line inside the answer it checks
        if (expectCheck && e.kind === 'assistant') {
          expectCheck = false;
          const checked = node('checked', '');
          checked.textContent = `Checked with a screenshot: ${e.text}`;
          (lastReply ?? log).append(checked);
          return void toBottom();
        }
        expectCheck = false;
        const time = e.ms ? ` · ${(e.ms / 1000).toFixed(1)}s` : '';
        const details = steps.length
          ? `<details class="steps"><summary>What Claude did (${steps.length} step${steps.length > 1 ? 's' : ''})${time}</summary><ul>${steps.map((s) => { const [v, w] = splitStep(s); return `<li>${escapeHtml(v ? `${PAST[v]} ${w}` : s)}</li>`; }).join('')}</ul></details>`
          : time ? `<span class="time">${time.slice(3)}</span>` : '';
        lastReply = node(`msg ${e.kind === 'error' ? 'error' : 'reply'}`, `<p>${escapeHtml(e.text)}</p>${details}`);
        log.append(lastReply);
        if (panel.classList.contains('collapsed') && !replaying) { topbar.classList.add('unread'); if (!topbar.classList.contains('busy')) $('.status em').textContent = 'New reply'; }
      } else if (e.kind === 'change') {
        const card = node('change', `${svg(I.check, 13, 3)}<span class="grow">Changed ·</span><button type="button"><span>Undo</span></button>`);
        card.dataset.id = e.id;
        card.querySelector('button').onclick = safe(() => restore('undo', e.id));
        const into = lastReply && lastReply === log.lastElementChild ? lastReply : log;
        into.append(card);
        for (const route of e.pages ?? []) { // a page that did not exist before
          const a = document.createElement('a');
          a.className = 'btn sm primary open-page'; a.href = route; a.title = route;
          a.textContent = e.pages.length > 1 ? `Open ${route} →` : 'Open the new page →';
          into.append(a);
        }
        decorateChanges();
      } else if (e.kind === 'info') {
        if (/checking the screenshot/i.test(e.text)) { expectCheck = true; startProgress('Checking the result with a screenshot…'); jobStep('checking the result with a screenshot'); }
        else if (!/^Taking a screenshot to check/i.test(e.text)) line(/screenshot/i.test(e.text) ? 'camera' : /text/i.test(e.text) ? 'pencil' : 'info', e.text); // the top bar shows that step
      }
      toBottom();
    }
    function setBusy(busy, label) {
      topbar.classList.toggle('busy', busy || !!label);
      $('.status em').textContent = label ?? (busy ? 'Working…' : topbar.classList.contains('unread') ? 'New reply' : 'Ready');
      if (!busy && !label) endProgress();
    }

    // opts.el: the element it's about when that isn't the selection; opts.page: the page it changes (another language's)
    async function ask(instruction, target = selected && describe(selected), label, opts = {}) {
      setBusy(false, 'Taking screenshot…');
      const el = target === null ? null : opts.el ?? selected, shot = await screenshotOrNull(el), queued = serverBusy; // busy now, not before the screenshot
      if (opts.noJob) add({ kind: 'info', text: 'Claude is busy; it will save your text when it is done.' });
      else {
        startJob(el, label || instruction, shot, queued);
        if (opts.page) { job.histPage = opts.page; saveJob(); renderBar(); } // its history entry is on that page
      }
      // Another page's change can't be checked with a screenshot of this one.
      server.send('claude-edit:ask', { instruction, label, target, page: opts.page ?? location.pathname, image: shot?.image ?? null, attachments: opts.pictures ?? [], check: !opts.page && pref('check', true) });
      setBusy(true);
    }

    // ── requests: what Claude is changing, then what changed ──
    // One request at a time is shown on the page (striped while Claude works, green when done) and in the top bar
    // (working… → "changed" with Before / After, Undo, Keep). Claude's edits reload the page, so the request lives in
    // sessionStorage; the "Before" picture is the clean screenshot taken when it was sent.
    // Server order per request: busy → tools → change(s) → [check → idle → busy → check turn] → idle.
    let job = (() => { try { return JSON.parse(sessionStorage.getItem(`${STORE}:job`) || 'null'); } catch { return null; } })();
    if (job && job.page !== location.pathname) job = null; // another page: that request's picture no longer fits
    let jobEl = null, showBefore = false, serverBusy = false, beforeShot; // beforeShot: the "Before" picture, read once (see before())
    const saveJob = () => {
      beforeShot = undefined; // every change of the stored picture goes through here
      try {
        if (!job) { sessionStorage.removeItem(`${STORE}:job`); sessionStorage.removeItem(`${STORE}:job-before`); }
        else sessionStorage.setItem(`${STORE}:job`, JSON.stringify(job));
      } catch {}
    };
    // An element saved as { file, loc, index } (selection and requests survive reloads this way).
    const findSaved = (s) => s && [...document.body.querySelectorAll('*')].filter((n) => { const x = src(n); return x && x[0] === s.file && x[1] === s.loc; })[s.index ?? 0];
    const saveRef = (el) => el && src(el) && { file: src(el)[0], loc: src(el)[1], index: sameSource(el).indexOf(el) };
    // queued: Claude is still busy with an earlier request; this one starts when that one ends (the server queues it).
    function startJob(el, label, shot, queued = false) {
      const lastId = historyEntries.reduce((n, e) => Math.max(n, e.id), 0);
      job = { label, kind: el ? kindOf(el).name : '', at: saveRef(el), page: location.pathname, started: Date.now(), afterId: lastId, phase: 'working', now: '', awaitCheck: false, queued };
      jobEl = el; showBefore = false; jobLost = false;
      try { sessionStorage.removeItem(`${STORE}:job-before`); if (shot) sessionStorage.setItem(`${STORE}:job-before`, JSON.stringify({ src: shot.clean, area: shot.area, y: shot.y })); } catch {} // too big for storage: no "Before"
      saveJob(); renderBar(); reposition();
    }
    // A change you made yourself (typed text, a link): saved at once, so it starts as "changed".
    function typedJob(el, label, text = null) {
      job = { label, text, kind: kindOf(el).name, at: saveRef(el), page: location.pathname, started: Date.now(), afterId: historyEntries.reduce((n, e) => Math.max(n, e.id), 0), phase: 'done', ms: 0, now: '', typed: true };
      jobEl = el; showBefore = false; jobLost = false;
      try { sessionStorage.removeItem(`${STORE}:job-before`); } catch {}
      saveJob(); renderBar(); reposition();
    }
    // The same page in the site's other language, from <link rel="alternate" hreflang> (e.g. /  ↔ /de/).
    function otherLang() {
      const here = (document.documentElement.lang || 'en').split('-')[0];
      const l = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].find((x) => x.hreflang !== 'x-default' && x.hreflang.split('-')[0] !== here);
      if (!l) return null;
      let name = l.hreflang;
      try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(l.hreflang.split('-')[0]); } catch {}
      return { name, path: new URL(l.href).pathname };
    }
    function jobStep(text) { if (job?.phase === 'working' && !job.queued) { job.now = text; saveJob(); renderBar(); } }
    function finishJob() {
      if (job?.phase !== 'working') return;
      job.untilId = historyEntries.reduce((n, x) => Math.max(n, x.id), 0); // its last change (history arrives before idle)
      Object.assign(job, { phase: 'done', ms: Date.now() - job.started, awaitCheck: false });
      saveJob(); renderBar(); reposition();
    }
    function keepJob() {
      job = null; jobEl = null; showBefore = false; jobLost = false;
      topbar.classList.remove('unread'); // the result row already said Claude was done
      saveJob(); renderBar(); reposition();
    }
    // The changes this request made: history entries recorded after it was sent, on this page (the edit and the screenshot fix).
    // Not your own typing saved meanwhile (Text: / Link:), unless this row is about that typing.
    const jobChanges = (undoneToo = false) => {
      if (!job) return [];
      const mine = historyEntries.filter((e) => e.id > job.afterId && e.id <= (job.untilId ?? Infinity) && e.page === (job.histPage ?? job.page) && (undoneToo || !e.undone) && (job.typed || !/^(Text|Link): /.test(e.label)));
      return job.typed ? mine.slice(-1) : mine; // typed text: its own one entry
    };
    // Undo goes back to before the request, so it also undoes anything changed on this page after it.
    const newerThanJob = () => { const c = jobChanges(); return c.length ? historyEntries.filter((e) => e.page === c[0].page && !e.undone && e.id > c[0].id && !c.includes(e)).length : 0; };
    let jobLost = false; // its element wasn't found: don't search the whole page again every tick
    const jobTarget = () => {
      if (!job?.at || jobLost) return null;
      if (!jobEl?.isConnected) { jobEl = findSaved(job.at) ?? null; jobLost = !jobEl; } // after a reload, or the edit moved or removed it
      return jobEl;
    };
    const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    function renderJob() {
      const working = job.phase === 'working', changes = working ? [] : jobChanges(), what = job.kind ? `the ${job.kind.toLowerCase()}` : 'the page';
      $('.tb-dot').hidden = !working;
      const changed = changes.length || job.typed; // typed text is saved at once; its history entry may arrive a moment later
      const elsewhere = !!job.histPage && job.histPage !== job.page; // "Also change the German page": this page didn't change
      $('.tb-ok').hidden = working || !changed;
      $('.tb-info').hidden = working || !!changed;
      $('.tb-job-title').textContent = working && job.queued ? `Waiting: Claude is finishing an earlier request first` : working ? `Claude is changing ${elsewhere ? `the ${otherLang()?.name ?? 'other'} page` : what}` : changed ? (elsewhere ? `The ${otherLang()?.name ?? 'other'} page changed` : `${job.kind || 'Page'} changed`) : 'Claude answered without changing the page';
      $('.tb-time').textContent = clock(working ? Date.now() - job.started : job.ms);
      $('.tb-time').hidden = !!job.typed;
      $('.tb-now').textContent = working && !job.queued ? (job.now || 'reading your request') : '';
      $('.tb-now').hidden = !working;
      $('.tb-seg').hidden = working || !changes.length || !before() || elsewhere;
      $$('[data-cmp]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.cmp === 'before') === showBefore)));
      $('[data-tb="job-undo"]').hidden = working || !changes.length;
      const newer = changes.length ? newerThanJob() : 0;
      $('[data-tb="job-undo"]').title = (changes.length > 1 ? `Undo all ${changes.length} changes of this request` : 'Undo this change') + (newer ? `, and ${newer} newer change${newer > 1 ? 's' : ''} on this page` : '');
      $('[data-tb="job-undo"]').lastChild.textContent = newer ? `Undo (+${newer} newer)` : 'Undo';
      $('[data-tb="job-reply"]').textContent = working ? 'Show steps' : changes.length ? 'What Claude said' : 'Show the reply';
      const o = otherLang();
      // Not for a shared piece (the header, a component): that change is already on every page, in every language.
      const shared = changes.length ? changes.every((x) => x.files.every((f) => !isPageFile(f))) : !!sharedOf(jobTarget());
      $('[data-tb="job-lang"]').hidden = working || !(changes.length || job.typed) || !o || shared || elsewhere;
      if (o) $('[data-tb="job-lang"]').textContent = `Also change the ${o.name} page`;
      $('[data-tb="job-reply"]').hidden = !!job.typed;
      $('[data-tb="job-keep"]').textContent = changes.length || job.typed ? 'Keep' : 'OK';
      $('[data-tb="job-keep"]').hidden = working;
    }
    // Parsed once: placeJob asks on every scroll and every poll while "Before" shows, and the picture is a large data URL
    const before = () => {
      if (beforeShot === undefined) { try { beforeShot = JSON.parse(sessionStorage.getItem(`${STORE}:job-before`) || 'null'); } catch { beforeShot = null; } }
      return beforeShot;
    };
    function placeJob() {
      const work = $('.box.work'), done = $('.box.done'), pic = $('.before'), el = open && job ? jobTarget() : null;
      place(work, job?.phase === 'working' ? el : null, `<i class="spin">${svg(I.spinner, 12, 2.4)}</i><b>${escapeHtml(`Claude is changing this: “${(job?.label ?? '').slice(0, 70)}”${el && sharedNote(el) ? ` · ${reachShort(el)}` : ''}`)}</b>`);
      place(done, job?.phase === 'done' && jobChanges().length && !showBefore ? el : null, tagHtml('check', 'Changed just now'));
      const b = showBefore && open && job && before(), area = b && document.querySelectorAll(AREA)[b.area];
      pic.style.display = area ? 'block' : 'none';
      if (!area) return;
      const r = area.getBoundingClientRect();
      if (pic.querySelector('img').getAttribute('src') !== b.src) pic.querySelector('img').src = b.src;
      Object.assign(pic.style, { top: `${r.top + b.y}px`, left: `${r.left}px`, width: `${r.width}px` });
    }
    $$('[data-cmp]').forEach((b) => (b.onclick = safe(() => { showBefore = b.dataset.cmp === 'before'; renderBar(); reposition(); })));
    setInterval(safe(() => { if (job?.phase === 'working') $('.tb-time').textContent = clock(Date.now() - job.started); }), 1000);
    $('.composer').onsubmit = safe(async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      await uploading;
      input.value = '';
      const pictures = attached.map(({ key, name }) => ({ key, name }));
      attached = []; renderAtts();
      return ask(text, undefined, undefined, { pictures });
    });

    // ── pictures for the next message: uploaded (or dropped, or pasted), from the library, or a path in the project.
    // Each goes into the image library, so Claude sees it and can put it on a page by its key. One list for the panel's
    // box and the Ask box next to the selection, so a picture stays when the question moves to the conversation. ──
    let attached = []; // { key, name, src }
    let uploading = null; // pictures on their way into the library: sending waits for them
    const MAX_ATT = 6;
    const libImage = (key) => imgData && allImages(imgData).find((i) => i.key === key);
    const typingBox = () => (pop.hidden ? input : popText);
    function renderAtts() {
      for (const box of $$('.atts')) {
        box.hidden = !attached.length;
        box.innerHTML = attached.map((a, n) => `<span class="att">${a.src ? `<img src="${escapeHtml(a.src)}" alt="">` : `<i>${svg(I.image, 14)}</i>`}<span title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span><button type="button" data-n="${n}" aria-label="Remove ${escapeHtml(a.name)}" title="Remove">${svg(I.x, 12, 2.4)}</button></span>`).join('');
        box.querySelectorAll('button').forEach((b) => (b.onclick = safe(() => { attached.splice(Number(b.dataset.n), 1); renderAtts(); typingBox().focus(); })));
      }
    }
    function attach(list) {
      for (const a of list) if (!attached.some((x) => x.key === a.key)) attached.push(a);
      if (attached.length > MAX_ATT) { attached = attached.slice(0, MAX_ATT); add({ kind: 'info', text: `A message can carry ${MAX_ATT} pictures; the others were left out.` }); }
      renderAtts();
      typingBox().focus();
    }
    const asAtt = (key, name) => ({ key, name, src: thumb(libImage(key), 120) });
    async function attachFiles(files) {
      const pics = [...files].filter((f) => f.type.startsWith('image/'));
      if (!pics.length) return;
      if (pop.hidden) { setCollapsed(false); setView('main'); setTab('ask'); } // the Ask box keeps them itself
      uploading = uploadPictures(pics);
      attach((await uploading).map((r) => asAtt(r.key, r.name)));
      uploading = null;
    }
    const placeAbove = (btn) => {
      menu.hidden = false;
      const r = btn.getBoundingClientRect();
      Object.assign(menu.style, { top: `${Math.max(8, r.top - menu.offsetHeight - 6)}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px` });
      menu.querySelector('input, button')?.focus();
    };
    function openAttachMenu(btn) {
      if (!menu.hidden && menu.dataset.for === 'attach') return closeMore();
      closeSpace(); closeAskPop();
      menu.dataset.for = 'attach';
      menu.classList.remove('wide', 'tree');
      menu.innerHTML = `<button type="button" role="menuitem" class="two am-up">${svg(I.upload, 16)}<span>Upload from your computer<small>Or drag pictures onto the chat, or paste one</small></span></button>
        <button type="button" role="menuitem" class="two am-lib">${svg(I.image, 16)}<span>Choose from the image library<small>Pictures the sites already use</small></span></button>
        <button type="button" role="menuitem" class="two am-path">${svg(I.link, 16)}<span>Use a file path<small>A picture in this project, e.g. design/hero.png</small></span></button>`;
      menu.querySelector('.am-up').onclick = safe(() => { closeMore(); $('.att-file').click(); });
      menu.querySelector('.am-lib').onclick = safe(() => { closeMore(); openLibrary({ chosen: new Set(), done: (imgs) => attach(imgs.map((i) => ({ key: i.key, name: nameOf(i), src: thumb(i, 120) }))) }); });
      menu.querySelector('.am-path').onclick = safe(() => {
        menu.classList.add('wide');
        menu.innerHTML = `<form class="attach-path"><label for="ce-att-path">Path of a picture in this project</label><input id="ce-att-path" type="text" placeholder="design/hero.png" spellcheck="false" autocomplete="off"><small class="err" hidden></small><small>JPEG, PNG, WebP, AVIF or GIF. A picture outside the library is copied into it.</small><div class="row"><button type="button" class="no">Cancel</button><button type="submit" class="yes">Add</button></div></form>`;
        const form = menu.querySelector('form'), field = form.querySelector('input'), err = form.querySelector('.err');
        form.querySelector('.no').onclick = safe(closeMore);
        form.onsubmit = safe(async (e) => {
          e.preventDefault();
          const r = await api('/attach-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: field.value }) });
          if (!r.ok) { err.hidden = false; err.textContent = r.message; return field.focus(); }
          closeMore();
          await loadImages(true);
          attach([asAtt(r.key, r.name.split('/').slice(-2).join('/'))]); // the end of a long path says what it is
        });
        placeAbove(btn);
      });
      placeAbove(btn);
    }
    $('.add-img').onclick = safe((e) => openAttachMenu(e.currentTarget));
    $('.att-file').onchange = safe(async (e) => { const files = [...e.target.files]; e.target.value = ''; await attachFiles(files); });
    // Dragging pictures over the panel or the Ask box: the whole of it is the drop area
    const hasFiles = (e) => !canvas.host?.hasAttribute('data-no-images') && [...(e.dataTransfer?.types ?? [])].includes('Files');
    for (const area of [panel, pop]) {
      let depth = 0;
      area.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; area.classList.add('dropping'); });
      area.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
      area.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; area.classList.remove('dropping'); } });
      area.addEventListener('drop', safe((e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; area.classList.remove('dropping'); attachFiles(e.dataTransfer.files); }));
    }
    for (const box of [input, popText]) box.addEventListener('paste', safe((e) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length && !canvas.host?.hasAttribute('data-no-images')) { e.preventDefault(); attachFiles(files); }
    }));

    // ── Chat with Claude: the panel docked on the right at full height, about the whole site, for bigger work ──
    function setBig(big) {
      panel.classList.toggle('big', big);
      try { sessionStorage.setItem(`${STORE}:big`, big ? '1' : ''); } catch {}
      const b = $('.size');
      b.innerHTML = svg(big ? I.shrink : I.expand, 16);
      b.title = big ? 'Smaller' : 'Bigger';
      b.setAttribute('aria-label', big ? 'Make the chat smaller' : 'Make the chat bigger');
      $('.main-sub').textContent = `The whole site · you are on ${pageLabel()}`;
      $('.empty').textContent = big
        ? 'Ask for bigger work too: a new page, a new section on several pages, a change across the site. Add pictures for Claude to use or to go by. Every change can be undone.'
        : 'Tell Claude what to change. It sees a screenshot of the part you picked and edits the page for you. Every change can be undone.';
      setTab(tab); // the title
      setComposer(); // the placeholder
      if (!big) keepInView();
    }
    function openChat() {
      select(null); // about the whole site, not a part of this page
      setBig(true);
      setCollapsed(false); setView('main'); setTab('ask');
      input.focus();
    }
    $('.size').onclick = safe(() => setBig(!panel.classList.contains('big')));
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('.composer').requestSubmit(); } };

    // ── history view: Undo / Go back to here / Redo (stored on disk by the dev server) ──
    let historyEntries = [], historyNote = null, confirming = null, broughtBack = false;
    const restore = (action, id, force = false) => server.send(`claude-edit:${action}`, { id, force });
    // Each page has its own history; "All pages" shows every page's list, grouped.
    let historyScope = sessionStorage.getItem(`${STORE}:hist-scope`) || 'page';
    const pageName = (path) => (path === '/' ? 'Home' : path);
    function renderHistory() {
      const here = location.pathname;
      const time = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const kindIcon = (e) => (/^Text:/.test(e.label) ? ['', I.pencil, 'you typed it'] : /^(Image|Alt text|Focal point)/.test(e.label) ? ['', I.image, 'you changed it'] : /^Link:/.test(e.label) ? ['', I.link, 'you changed it'] : /^(Space|Gap|Text size)/.test(e.label) ? ['spacing', I.spacing, 'spacing · by Claude'] : /visual check/.test(e.label) ? ['', I.camera, 'after the screenshot check'] : ['claude', I.sparkle, 'by Claude']);
      // One page's list: Undo on its newest change, Go back to here on older ones, Redo on its next undone one.
      const pageList = (page) => {
        const mine = historyEntries.filter((e) => e.page === page); // newest first
        const done = mine.filter((e) => !e.undone), undone = mine.filter((e) => e.undone);
        const newestDone = done[0], nextRedo = undone.at(-1);
        const item = (e) => {
          const [cls, icon, who] = kindIcon(e);
          const n = done.filter((x) => x.at >= e.at).length; // this change + newer ones on this page
          let button = '';
          if (e === newestDone) button = `<button type="button" class="btn sm outline" data-act="undo" data-id="${e.id}">${svg(I.undo, 14)}Undo</button>`;
          else if (!e.undone) button = `<button type="button" class="btn sm" data-act="ask" data-id="${e.id}">Go back to here</button>`;
          else if (e === nextRedo) button = `<button type="button" class="btn sm" data-act="redo" data-id="${e.id}">Redo</button>`;
          const confirm = confirming === e.id
            ? `<div class="h-confirm"><span>This also undoes ${n - 1} newer change${n > 2 ? 's' : ''} on this page.</span><button type="button" class="btn sm" data-act="cancel">Cancel</button><button type="button" class="btn sm danger" data-act="undo" data-id="${e.id}">Undo ${n} changes</button></div>` : '';
          const tags = [time(e.at), e.undone ? 'undone' : who, e.shared ? '<b class="h-shared">affects all pages</b>' : ''].filter(Boolean).join(' · ');
          return `<div class="h-item${e.undone ? ' undone' : ''}${confirm ? ' confirming' : ''}"><div class="h-row">
            <span class="h-icon ${cls}">${svg(icon, 17)}</span>
            <span class="h-text" title="${escapeHtml(e.files.join(', '))}"><span>${escapeHtml(e.label)}</span><small>${tags}</small></span>
            ${confirm ? '' : button}</div>${confirm}</div>`;
        };
        return (done.length ? done.map(item).join('') : '') + (undone.length ? `<p class="h-sub">Undone</p>${undone.map(item).join('')}` : '');
      };
      const pages = [...new Set(historyEntries.map((e) => e.page))].sort((x, y) => (x === here ? -1 : y === here ? 1 : x.localeCompare(y)));
      const countHere = historyEntries.filter((e) => e.page === here && !e.undone).length;
      const countAll = historyEntries.filter((e) => !e.undone).length;
      const scopeSwitch = `<div class="tabs h-scope" role="tablist" aria-label="Which history">
        <button type="button" role="tab" data-scope="page" aria-selected="${historyScope === 'page'}">This page (${countHere})</button>
        <button type="button" role="tab" data-scope="all" aria-selected="${historyScope === 'all'}">All pages (${countAll})</button></div>`;
      const note = historyNote ? `<div class="h-note">${escapeHtml(historyNote.message)}${historyNote.conflicts ? '<button type="button" class="btn sm force">Yes, do it anyway</button>' : ''}</div>` : '';
      let body;
      if (historyScope === 'page') {
        body = historyEntries.some((e) => e.page === here) ? `<p class="label">${escapeHtml(pageName(here))}</p>${pageList(here)}`
          : `<p class="h-empty">No changes on this page yet.${countAll ? ' Switch to All pages to see the others.' : ''}</p>`;
      } else {
        body = pages.length ? pages.map((page) => `<p class="label">${escapeHtml(pageName(page))}${page === here ? ' · this page' : ''}</p>${pageList(page)}`).join('')
          : '<p class="h-empty">No changes yet. Everything Claude or you change shows up here, so you can undo it.</p>';
      }
      $('.hist-list').innerHTML = scopeSwitch + note + body;
      $$('.h-scope [data-scope]').forEach((b) => (b.onclick = safe(() => {
        historyScope = b.dataset.scope;
        sessionStorage.setItem(`${STORE}:hist-scope`, historyScope);
        confirming = null;
        renderHistory();
      })));
      $$('.hist-list [data-act]').forEach((b) => (b.onclick = safe(() => {
        const act = b.dataset.act, id = Number(b.dataset.id);
        if (act === 'ask') { confirming = id; return renderHistory(); }
        if (act === 'cancel') { confirming = null; return renderHistory(); }
        confirming = null;
        restore(act, id);
      })));
      $('.hist-list .force')?.addEventListener('click', safe(() => { restore(historyNote.action, historyNote.id, true); historyNote = null; }));
      if (view === 'history') $('.sub-meta').textContent = historyScope === 'page' ? pageName(here) : 'All pages';
      decorateChanges();
    }
    // Undo on a chat card only for the newest change of its page; older ones are undone from History.
    function decorateChanges() {
      $$('.change').forEach((card) => {
        const entry = historyEntries.find((e) => e.id === Number(card.dataset.id));
        const newestDone = entry && historyEntries.find((e) => !e.undone && e.page === entry.page);
        const b = card.querySelector('button');
        b.hidden = !entry || (!entry.undone && entry !== newestDone);
        b.disabled = !!entry?.undone;
        b.querySelector('span').textContent = entry?.undone ? 'Undone' : 'Undo';
      });
    }
    server.on('claude-edit:history', safe(({ entries }) => {
      historyEntries = entries ?? [];
      if (!broughtBack) { broughtBack = true; bringBack(); } // after a reload; a save sent again needs the history to show its result
      // Its changes were all undone (top bar Undo, History): the result row has nothing left to show.
      if (job?.phase === 'done' && jobChanges(true).length && !jobChanges().length) return void (keepJob(), renderHistory());
      renderHistory(); renderBar(); settleClaude();
      if (imgDone && !galScrim.hidden) renderImages(); // the replace in the panel: undone or redone
    }));
    server.on('claude-edit:restore-result', safe((r) => {
      historyNote = r.ok ? null : { ...r };
      if (!r.ok) setView('history');
      renderHistory();
    }));

    // ── images: the site's images and where each is used (from the dev server), replace everywhere or only here ──
    // Every rendered library image has data-img="<key>" (dev only). Uploads and replaces go over HTTP (images.mjs).
    let imgData = null, imgLoading = null, imgQuery = '', repFile = null, repPreview = null, libQuery = '', reloadTimer = null;
    let imgScope = sessionStorage.getItem(`${STORE}:img-scope`) || 'page', imgOpen = sessionStorage.getItem(`${STORE}:img-open`);
    let rep = (() => { try { return JSON.parse(sessionStorage.getItem(`${STORE}:rep`) || 'null'); } catch { return null; } })();
    const saveRep = () => (rep ? sessionStorage.setItem(`${STORE}:rep`, JSON.stringify(rep)) : sessionStorage.removeItem(`${STORE}:rep`));
    // The open picture's panel survives the reload a change causes: which picture, the place picked on the page
    // ({ key, file, line, column, sure }) and the replace that just happened ({ id, mode, key, oldKey, n }).
    const stored = (name) => { try { return JSON.parse(sessionStorage.getItem(`${STORE}:${name}`) || 'null'); } catch { return null; } };
    const store = (name, v) => (v ? sessionStorage.setItem(`${STORE}:${name}`, typeof v === 'string' ? v : JSON.stringify(v)) : sessionStorage.removeItem(`${STORE}:${name}`));
    let imgHere = stored('img-here'), imgDone = stored('img-done');
    const setOpen = (key) => store('img-open', (imgOpen = key));
    const setHere = (u) => store('img-here', (imgHere = u));
    const setDone = (d) => store('img-done', (imgDone = d));
    const api = async (path, init = {}) => {
      try {
        const r = await fetch(`/__claude-edit/images${path}`, { ...init, headers: { 'X-Claude-Edit': '1', ...init.headers } });
        const body = await r.json();
        return r.ok ? { ok: true, ...body } : { ok: false, message: body.message || 'That did not work.' };
      } catch { return { ok: false, message: 'The dev server did not answer. Is it still running?' }; }
    };
    const loadImages = (fresh) => {
      if (fresh) imgData = null;
      return imgData ? Promise.resolve(imgData) : (imgLoading ??= api('').then((d) => { imgLoading = null; imgData = d.ok ? d : null; return d; })); // a failure is tried again next time
    };
    const imageOf = (el) => {
      if (!el || el.nodeType !== 1) return null;
      if (el.dataset.img) return el;
      // A block whose background is an image: a CSS background (data-img on the block) or a covering <img> child.
      return [...el.children].find((c) => c.matches('img[data-img]') && getComputedStyle(c).position === 'absolute') || null;
    };
    const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
    const dims = (i) => (i.width ? `${i.width} × ${i.height}` : '');
    const thumb = (i, w) => (i?.src ? `${i.src}&w=${w}` : '');
    const placesOf = (i) => (i?.uses ?? []).filter((u) => u.attr !== 'preload'); // Layout's preload hint is not a place
    const fileName = (f) => f.split('/').pop();
    const altText = (a) => (a ? a.text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\\(.)/g, a.kind === 'js' ? '$1' : '\\$1') : '');
    const pagePath = () => (location.pathname.replace(/\/+$/, '') || '/');
    const repoRel = (abs) => (imgData?.root && abs.startsWith(`${imgData.root}/`) ? abs.slice(imgData.root.length + 1) : abs);
    const onPageKeys = () => new Set([...document.querySelectorAll('[data-img]')].map((n) => n.dataset.img));
    // Alt texts written in the source; for an image on this page whose alt comes from code (e.g. a translation), the rendered one.
    const altsOf = (i) => {
      const written = placesOf(i).map((u) => altText(u.alt)).filter(Boolean);
      const shown = [...document.querySelectorAll(`img[data-img="${CSS.escape(i.key)}"]`)].map((e) => e.alt.trim()).filter(Boolean);
      return [...new Set(written.length ? written : shown)];
    };
    const placesText = (n) => `${n} place${n === 1 ? '' : 's'}`;
    const elsewhereText = (i) => Object.entries(i.elsewhere ?? {}).map(([s, n]) => `${s === 'catalog' ? 'the catalog' : s} (${n})`).join(', ');
    // Where a picked image is written: uses in files that render this page, nearest to the picked element first.
    function usesFor(img, el) {
      const files = new Set([...document.body.querySelectorAll('*')].map((n) => src(n)?.[0]).filter(Boolean).map(repoRel));
      let uses = placesOf(img).filter((u) => files.has(u.file));
      if (!uses.length) uses = placesOf(img).filter((u) => u.routes.includes(pagePath()));
      const score = (u) => {
        let depth = 0;
        for (let a = el; a && a !== document.documentElement; a = a.parentElement, depth++) {
          const lines = [a, ...a.querySelectorAll('*')].map(src).filter((s) => s && repoRel(s[0]) === u.file).map((s) => Number(s[1].split(':')[0]));
          if (lines.length) return depth * 1e6 + Math.min(...lines.map((l) => Math.abs(l - u.line)));
        }
        return 1e12;
      };
      return uses.map((u) => [score(u), u]).sort((a, b) => a[0] - b[0]).map(([, u]) => u);
    }
    const useLabel = (u) => `${u.component || 'List item'}${u.alt ? ` · “${altText(u.alt)}”` : ''}`;
    const useWhere = (u) => `${u.routes.length ? u.routes.map((r) => (r === pagePath() ? `${r} (this page)` : r)).slice(0, 3).join(', ') + (u.routes.length > 3 ? ` and ${u.routes.length - 3} more pages` : '') : 'no page found'} · ${fileName(u.file)} line ${u.line}`;

    // ── Images: the library in a large dialog. Browsing: the picked picture's facts beside the grid. Choosing pictures
    // for a message (galPick): ticks and an Add button instead. ──
    let galPick = null; // { chosen: Set of keys, done(images) } while choosing pictures for the chat
    function openLibrary(pick = null) {
      galPick = pick;
      if (!pick) sessionStorage.setItem(`${STORE}:gal`, '1'); // a focal point change reloads the page: come back here
      closeMore(); closeSpace(); closeAskPop();
      gal.classList.toggle('picking', !!pick);
      galScrim.hidden = false;
      renderBar();
      return renderImages().then(() => gal.querySelector('.img-search').focus());
    }
    function closeLibrary() { galScrim.hidden = true; galPick = null; sessionStorage.removeItem(`${STORE}:gal`); setDone(null); renderBar(); }
    // Used on this site, then library files not used here (a fresh upload), all with the same facts
    const allImages = (data) => [...data.images, ...data.library.filter((l) => !data.images.some((i) => i.key === l.key))];
    async function renderImages() {
      if (galScrim.hidden) return;
      const grid = $('.gal-grid'), side = $('.gal-detail');
      $$('.img-scope [data-iscope]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.iscope === imgScope)));
      if (!imgData) grid.innerHTML = '<p class="h-empty">Loading the images…</p>';
      const data = await loadImages();
      if (galScrim.hidden) return;
      if (!data.ok) { grid.innerHTML = `<p class="h-empty">${escapeHtml(data.message)}</p>`; return; }
      const onPage = onPageKeys(), mine = data.images.filter((i) => onPage.has(i.key)), every = allImages(data);
      $('.img-scope [data-iscope="page"]').textContent = `On this page · ${mine.length}`;
      $('.img-scope [data-iscope="all"]').textContent = `All images · ${every.length}`;
      $('.gal-sub').textContent = galPick ? 'Tick the pictures to add to your message' : `${data.site} · every picture the site uses, one file each`;
      const q = imgQuery.trim().toLowerCase();
      const hay = (i) => [i.name, i.key, ...placesOf(i).flatMap((u) => [altText(u.alt), u.file, u.component, ...u.routes])].join(' ').toLowerCase();
      const shown = (imgScope === 'page' ? mine : every).filter((i) => !q || hay(i).includes(q));
      grid.innerHTML = shown.map((i) => {
        const n = placesOf(i).length, on = galPick ? galPick.chosen.has(i.key) : i.key === imgOpen;
        return `<button type="button" class="gal-card" data-key="${escapeHtml(i.key)}" aria-pressed="${on}"><img src="${escapeHtml(thumb(i, 360))}" alt="" loading="lazy"${i.focus ? ` style="object-position:${pct(i.focus.x)} ${pct(i.focus.y)}"` : ''}><span class="gal-tick">${svg(I.check, 13, 3)}</span>
          <b class="${altsOf(i).length ? '' : 'none'}">${escapeHtml(nameOf(i))}</b>
          <span class="gal-meta"><span>${[dims(i), i.bytes && kb(i.bytes)].filter(Boolean).join(' · ')}</span><span class="gal-chip">${n ? placesText(n) : 'Not used yet'}</span></span></button>`;
      }).join('') || `<p class="h-empty">${q ? 'No image matches that search.' : imgScope === 'page' ? 'No library images on this page. Switch to All images to see the others.' : 'No images yet.'}</p>`;
      $$('.gal-card').forEach((b) => (b.onclick = safe(() => {
        if (galPick) { galPick.chosen.has(b.dataset.key) ? galPick.chosen.delete(b.dataset.key) : galPick.chosen.add(b.dataset.key); return renderImages(); }
        setOpen(b.dataset.key === imgOpen ? null : b.dataset.key); // a second click puts it away
        renderImages();
      })));
      if (imgDone?.mode === 'here' && imgOpen === imgDone.key && historyEntries.find((e) => e.id === imgDone.id)?.undone) { // that place shows the old picture again
        setOpen(imgDone.oldKey);
        if (imgHere?.key === imgDone.key) setHere({ ...imgHere, key: imgDone.oldKey });
      }
      const open = !galPick && imgOpen && every.find((i) => i.key === imgOpen);
      side.hidden = !open;
      if (open) renderImage(open);
      $('.gal-note').hidden = !!galPick;
      $('.gal-pick').hidden = !galPick;
      if (galPick) {
        const n = galPick.chosen.size;
        $('.gal-count').textContent = n ? `${n} chosen` : 'None chosen yet';
        $('.gal-add').textContent = `Add ${n || ''} picture${n === 1 ? '' : 's'}`.replace('  ', ' ');
        $('.gal-add').disabled = !n;
      }
    }
    // The one panel for a picture: what a replace just did, focal point, alt texts, replace here or everywhere, facts and
    // where it's used (the place picked on the page first).
    function renderImage(i) {
      const all = placesOf(i), other = elsewhereText(i);
      const here = imgHere?.key === i.key ? all.find((u) => u.file === imgHere.file && u.line === imgHere.line && u.column === imgHere.column) : null;
      const uses = here ? [here, ...all.filter((u) => u !== here)] : all;
      const done = imgDone && [imgDone.key, imgDone.oldKey].includes(i.key) ? imgDone : null, undone = done && historyEntries.find((e) => e.id === done.id)?.undone;
      const doneText = undone ? ['Undone: the old image is back', 'You can redo it from History.'] : done?.mode === 'everywhere' ? [`Replaced everywhere — ${placesText(done.n)}`, 'The file in the library was replaced, so every place shows the new image.'] : ['Changed here only', 'The new image is in the library and used in this one place.'];
      $('.gal-detail').innerHTML = `<div class="i-detail">
        ${done ? `<div class="r-done${undone ? ' undone' : ''}"><span class="ok">${svg(undone ? I.undo : I.check, 14, 3)}</span><span><b>${doneText[0]}</b><small>${doneText[1]}</small></span>
          ${undone ? '' : `<button type="button" class="btn sm outline r-undo">${svg(I.undo, 14)}Undo</button>`}</div>` : ''}
        <div class="fp-box"></div>
        <section class="alt-box"></section>
        ${uses.length ? `<section><p class="label">Replace</p><div class="fp-btns">${here ? `<button type="button" class="btn sm replace-here">${svg(I.image, 15)}Only here</button>` : ''}
          <button type="button" class="btn sm replace-all">${here ? '' : svg(I.image, 15)}Everywhere (${placesText(uses.length)})</button></div></section>` : ''}
        <dl class="facts"><dt>File</dt><dd>${escapeHtml(i.name)}</dd><dt>Size</dt><dd>${[dims(i) && `${dims(i)} px`, i.bytes && kb(i.bytes)].filter(Boolean).join(' · ')}</dd>
          <dt>Used</dt><dd>${placesText(uses.length)} on this site${other ? `, also on ${escapeHtml(other)}` : ''}</dd><dt>Key</dt><dd><code>${escapeHtml(i.key)}</code></dd></dl>
        <section><p class="label">Where it's used</p>${uses.map((u, n) => `<div class="use"><span>${u === here ? `<small class="likely">${imgHere.sure ? 'The one you picked' : 'Most likely the one you picked'}</small>` : ''}<b>${escapeHtml(useLabel(u))}</b>
          <small>${u.routes.slice(0, 3).map((r) => `<a href="${escapeHtml(r)}">${escapeHtml(r)}</a>${r === pagePath() ? ' (this page)' : ''}`).join(', ')}${u.routes.length > 3 ? ` and ${u.routes.length - 3} more pages` : ''}</small>
          <small><code>${escapeHtml(u.file)}:${u.line}</code></small></span><button type="button" class="btn sm only-here" data-n="${n}">Only here</button></div>`).join('') || '<p class="muted-note">Not on any page yet. Ask Claude to use it, or pick it in Replace image.</p>'}</section>
      </div>`;
      mountFocal($('.gal-detail .fp-box'), i);
      mountAlt($('.gal-detail .alt-box'), i, uses);
      $('.r-undo')?.addEventListener('click', safe(() => restore('undo', done.id)));
      // Replace opens over the library and brings it back when it closes
      const replace = (opts) => { closeLibrary(); openReplace({ key: i.key, back: 'images', ...opts }); };
      $('.replace-here')?.addEventListener('click', safe(() => replace({ use: here, only: 'here' })));
      $('.replace-all')?.addEventListener('click', safe(() => replace({ only: 'everywhere' })));
      $$('.only-here').forEach((b) => (b.onclick = safe(() => replace({ use: uses[Number(b.dataset.n)], only: 'here' }))));
    }
    // ── alt texts: each place has its own; when they all say the same, one field saves them all ──
    let altUi = null; // { key, together, saved, error }
    function mountAlt(box, i, uses) {
      const withAlt = uses.filter((u) => u.alt), texts = [...new Set(withAlt.map((u) => altText(u.alt)))];
      if (altUi?.key !== i.key) altUi = { key: i.key, together: texts.length <= 1, saved: false, error: null };
      if (!withAlt.length) return void (box.innerHTML = uses.length ? `<p class="label">Description</p><p class="muted-note">${uses.length > 1 ? 'These places show' : 'This place shows'} the image as a background or decoration, so there's no description to write.</p>` : '');
      const where = (u) => `${escapeHtml(u.component || 'List item')} · ${escapeHtml(useWhere(u))}`;
      box.innerHTML = `<p class="label">Description</p>
        <p class="muted-note">Read aloud to people who can't see it, and used by search engines. Say what it shows, in a short sentence.</p>
        ${altUi.together ? `<textarea class="alt-all" rows="2" maxlength="300" aria-label="Description of the image">${escapeHtml(texts[0] ?? '')}</textarea>`
          : withAlt.map((u, n) => `<label class="alt-row"><small>${where(u)}</small><input type="text" data-n="${n}" value="${escapeHtml(altText(u.alt))}" maxlength="300"></label>`).join('')}
        ${withAlt.length > 1 ? `<label class="alt-same"><input type="checkbox" ${altUi.together ? 'checked' : ''}> Same description in all ${withAlt.length} places</label>` : `<small class="muted-note">${where(withAlt[0])}</small>`}
        ${altUi.saved ? '<p class="fp-note ok"><span>Saved.</span></p>' : ''}
        ${altUi.error ? `<p class="r-error" role="alert">${escapeHtml(altUi.error)}</p>` : ''}
        <div class="fp-btns"><button type="button" class="btn sm primary alt-save">Save description</button><button type="button" class="btn sm alt-claude">${svg(I.sparkle, 15)}Let Claude write it</button></div>`;
      box.querySelectorAll('textarea, .alt-row input').forEach((f) => (f.oninput = () => { altUi.saved = false; box.querySelector('.fp-note')?.remove(); }));
      box.querySelector('.alt-same input')?.addEventListener('change', safe((e) => { Object.assign(altUi, { together: e.target.checked, saved: false }); mountAlt(box, i, uses); }));
      // Claude looks at the picture and writes them (a normal request: shown in the top bar, undoable).
      box.querySelector('.alt-claude').onclick = safe(() => {
        closeLibrary();
        ask(`Look at the image ${i.key} and write a short, descriptive alt text (one sentence, in the language of each page) in the alt="…" at: ${withAlt.map((u) => `${u.file}:${u.alt.line}`).join(', ')}.`, undefined, 'Write a description for the image');
      });
      box.querySelector('.alt-save').onclick = safe(async () => {
        const one = box.querySelector('.alt-all')?.value.trim();
        const edits = withAlt.map((u, n) => [u, one ?? box.querySelector(`[data-n="${n}"]`).value.trim()]).filter(([u, next]) => next && next !== altText(u.alt));
        const btn = box.querySelector('.alt-save'); btn.disabled = true; btn.textContent = 'Saving…';
        for (const [u, next] of edits) {
          const r = await api('/alt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: u.file, line: u.alt.line, column: u.alt.column, oldText: u.alt.text, newText: next, page: location.pathname }) });
          if (!r.ok) { Object.assign(altUi, { saved: false, error: r.message }); return mountAlt(box, i, uses); }
          const old = altText(u.alt);
          u.alt.text = r.text;
          document.querySelectorAll(`img[data-img="${CSS.escape(i.key)}"]`).forEach((el) => { if (el.alt === old) el.alt = next; }); // no reload for an alt change
        }
        Object.assign(altUi, { saved: edits.length > 0, error: null });
        mountAlt(box, i, uses);
      });
    }
    // ── focal point: the spot that stays in view wherever the picture is cropped (saved in focal-points.json) ──
    // In the picture's panel in Images. Moving the marker only previews; Save writes it (a History entry) and the
    // page reloads to show it. The picker's state (sessionStorage) and the open dialog come back after that reload.
    let fp = (() => { try { return JSON.parse(sessionStorage.getItem(`${STORE}:fp`) || 'null'); } catch { return null; } })(); // { key, saved: {x, y}, x, y, suggested, done: history id, error, busy }
    const pct = (n) => `${Math.round(n * 100)}%`;
    const FRAMES = [['Phone', '3/4'], ['Card', '3/2'], ['Desktop hero', '21/9']];
    function mountFocal(box, i) {
      if (!box || !i?.src) return;
      const point = i.focus ?? { x: 0.5, y: 0.5 };
      // Another picture, or its point changed since (an undo): start from what is saved.
      if (fp?.key !== i.key || fp.saved.x !== point.x || fp.saved.y !== point.y) fp = { key: i.key, saved: point, ...point, suggested: false, done: null, error: null, busy: false };
      sessionStorage.setItem(`${STORE}:fp`, JSON.stringify({ ...fp, busy: false }));
      const src = escapeHtml(thumb(i, 720)), where = `${pct(fp.x)} across, ${pct(fp.y)} down`;
      const changed = fp.x !== fp.saved.x || fp.y !== fp.saved.y;
      box.innerHTML = `<section class="fp"><p class="label fp-head">Focal point<span>${where}</span></p>
        <button type="button" class="fp-pic" aria-label="Focal point: ${where}. ${TOUCH ? 'Tap' : 'Click'} the part of the picture that must stay in view, or use the arrow keys."><img src="${src}" alt=""${i.width ? ` width="${i.width}" height="${i.height}"` : ''}><span class="fp-dot${fp.suggested ? ' sug' : ''}" style="left:${pct(fp.x)};top:${pct(fp.y)}"></span></button>
        <p class="muted-note">${TOUCH ? 'Tap' : 'Click'} the part that must always stay in view, like a face. Arrow keys move it.</p>
        <p class="label">How it crops</p>
        <div class="fp-frames">${FRAMES.map(([name, ratio]) => `<span><img src="${src}" alt="" style="aspect-ratio:${ratio};object-position:${pct(fp.x)} ${pct(fp.y)}">${name}</span>`).join('')}</div>
        ${fp.suggested ? '<p class="fp-note sug">Suggested from the picture. Check it, then save.</p>' : ''}
        ${fp.done && !changed ? '<p class="fp-note ok"><span>Saved. Every place that crops this picture keeps this point in view.</span><button type="button" class="fp-undo">Undo</button></p>' : ''}
        ${fp.error ? `<p class="r-error" role="alert">${escapeHtml(fp.error)}</p>` : ''}
        <div class="fp-btns"><button type="button" class="btn sm primary fp-save" ${changed && !fp.busy ? '' : 'disabled'}>${fp.busy ? 'Saving…' : 'Save focal point'}</button>
          <button type="button" class="btn sm fp-suggest" ${fp.busy ? 'disabled' : ''}>${svg(I.sparkle, 15)}Suggest</button><button type="button" class="btn sm fp-centre">Centre</button></div></section>`;
      const again = (focus) => { mountFocal(box, i); if (focus) box.querySelector(focus)?.focus(); };
      const move = (x, y) => { Object.assign(fp, { x: Math.min(1, Math.max(0, Math.round(x * 100) / 100)), y: Math.min(1, Math.max(0, Math.round(y * 100) / 100)), suggested: false, done: null, error: null }); again('.fp-pic'); };
      const pic = box.querySelector('.fp-pic');
      pic.onclick = safe((e) => {
        const r = pic.querySelector('img').getBoundingClientRect();
        if (e.detail) move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); // detail 0: Enter or Space, not a click
      });
      pic.onkeydown = safe((e) => {
        const step = e.shiftKey ? 0.1 : 0.01, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        move(fp.x + d[0], fp.y + d[1]);
      });
      box.querySelector('.fp-centre').onclick = safe(() => move(0.5, 0.5));
      box.querySelector('.fp-suggest').onclick = safe(async () => {
        fp.busy = true; again();
        const r = await api('/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key }) });
        fp.busy = false;
        if (r.ok) Object.assign(fp, { x: r.x, y: r.y, suggested: true, done: null, error: null }); else fp.error = r.message;
        again('.fp-save');
      });
      box.querySelector('.fp-save').onclick = safe(async () => {
        fp.busy = true; again();
        const r = await api('/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: i.key, x: fp.x, y: fp.y, page: location.pathname }) });
        fp.busy = false;
        if (!r.ok) { fp.error = r.message; return again(); }
        Object.assign(fp, { saved: { x: r.x, y: r.y }, x: r.x, y: r.y, suggested: false, done: r.id, error: null });
        if (imgData) allImages(imgData).filter((x) => x.key === i.key).forEach((x) => (x.focus = { x: r.x, y: r.y }));
        again('.fp-undo');
      });
      // Undo is a History entry like any other: the server restores the file and the page reloads.
      box.querySelector('.fp-undo')?.addEventListener('click', safe(() => restore('undo', fp.done)));
    }

    // Upload into the library: in the chat picker an upload is chosen right away
    async function uploadPictures(files) {
      const added = [];
      for (const f of [...files]) {
        if (!f.type.startsWith('image/')) continue;
        const r = await api(`/attach?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
        if (!r.ok) { add({ kind: 'error', text: `${f.name}: ${r.message}` }); continue; }
        added.push(r);
      }
      if (added.length) await loadImages(true);
      return added;
    }
    gal.querySelector('.gal-up input').onchange = safe(async (e) => {
      const added = await uploadPictures(e.target.files);
      e.target.value = '';
      if (galPick) added.forEach((r) => galPick.chosen.add(r.key));
      else if (added.length) { imgScope = 'all'; imgOpen = added.at(-1).key; }
      renderImages();
    });
    $('.gal-x').onclick = safe(closeLibrary);
    $('.gal-cancel').onclick = safe(closeLibrary);
    $('.gal-add').onclick = safe(async () => {
      const data = await loadImages(), every = data.ok ? allImages(data) : [], pick = galPick;
      closeLibrary();
      pick?.done([...pick.chosen].map((key) => every.find((i) => i.key === key)).filter(Boolean));
    });
    galScrim.addEventListener('pointerdown', (e) => { if (e.target === galScrim) closeLibrary(); }); // a click beside the dialog
    galScrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeLibrary(); }
      if (e.key === 'Tab') trapFocus(e, gal);
    });
    $('.img-search').oninput = safe((e) => { imgQuery = e.target.value; renderImages(); });
    $$('.img-scope [data-iscope]').forEach((b) => (b.onclick = safe(() => { imgScope = b.dataset.iscope; sessionStorage.setItem(`${STORE}:img-scope`, imgScope); renderImages(); })));

    // ── replace image: a dialog in two steps ──
    // 1 Choose: upload a file or pick a library image · 2 Where: everywhere (the file itself) or only here (one use).
    // Then the new picture's panel in Images (its focal point and alt texts), which comes back after the reload.
    const scrim = $('.scrim'), dlg = $('.dialog');
    // A picture picked on the page: its panel in Images, with the place you picked first.
    async function openImage() {
      const el = imageOf(selected);
      if (!el) return;
      const data = await loadImages();
      const img = data.ok && data.images.find((i) => i.key === el.dataset.img);
      if (!img) return openReplace({ key: el.dataset.img, back: 'main' }); // not found in this site's files: only a replace
      const uses = usesFor(img, el);
      setHere(uses.length ? { key: img.key, file: uses[0].file, line: uses[0].line, column: uses[0].column, sure: uses.length === 1 } : null);
      setOpen(img.key);
      return openLibrary().then(() => $('.gal-detail .fp-pic')?.focus());
    }
    function openReplace({ key, use = null, only = null, back = 'main' }) {
      rep = { key, use, only, back, mode: only ?? 'everywhere', step: 1, fromKey: null, error: null };
      repFile = repPreview = null; libQuery = '';
      saveRep();
      showDialog();
    }
    function showDialog() {
      scrim.hidden = false;
      renderReplace().then(() => dlg.querySelector('.dlg-body button, .dlg-body input, .dlg-foot .primary')?.focus());
    }
    function closeReplace() {
      if (rep?.busy) return;
      const back = rep?.back;
      rep = null; repFile = repPreview = null; saveRep();
      scrim.hidden = true;
      if (back === 'images') openLibrary(); // opened from the library: back to it
    }
    $('.dlg-x').onclick = safe(closeReplace);
    // Tab and Shift+Tab stay inside the dialog (aria-modal), also when focus was left on the page behind it.
    function trapFocus(e, box = dlg) {
      const items = [...box.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, [href], label.btn')].filter((n) => n.offsetParent);
      if (!items.length) return;
      const first = items[0], last = items.at(-1), at = canvas.activeElement;
      if (!box.contains(at) || (e.shiftKey ? at === first : at === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    }
    scrim.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeReplace(); } });
    const goStep = (n) => { rep.step = n; rep.error = null; saveRep(); renderReplace(); };

    async function renderReplace() {
      const body = $('.dlg-body'), foot = $('.dlg-foot');
      if (!rep) return closeReplace();
      if (!imgData) { body.innerHTML = '<p class="h-empty">Loading the images…</p>'; foot.innerHTML = ''; }
      const data = await loadImages();
      if (scrim.hidden || !rep) return;
      if (!data.ok) {
        body.innerHTML = `<p class="r-error" role="alert">${escapeHtml(data.message)}</p>`;
        foot.innerHTML = '<button type="button" class="btn primary r-close">Close</button>';
        return void (foot.querySelector('.r-close').onclick = safe(closeReplace));
      }
      const img = data.ok ? data.images.find((i) => i.key === rep.key) ?? data.library?.find((i) => i.key === rep.key) : null;
      const step = rep.step;
      $$('.dlg-steps [data-step]').forEach((li) => { li.classList.toggle('on', Number(li.dataset.step) === step); li.classList.toggle('done', Number(li.dataset.step) < step); });
      if (step === 2) return renderWhere(data, img);
      renderChoose(data, img);
    }
    // Library files are named by hashes ("601935e1…_optimized_1390"): call an image by its description instead.
    const nameOf = (i) => (i && altsOf(i)[0]) || (i && placesOf(i).length ? 'Image without a description' : 'Library image, not used yet');
    const fileLine = (f) => `<small class="fname" title="${escapeHtml(f)}">${escapeHtml(f)}</small>`;
    const pic = (i, label, extra = '') => `<div class="r-pic"><img class="thumb" src="${escapeHtml(thumb(i, 144))}" alt=""><span><b class="iname">${escapeHtml(label)}</b>${fileLine(i.name)}<small>${escapeHtml(extra)}</small></span></div>`;
    // The image you chose: an upload (shown from memory) or a library image.
    const chosenOf = (data) => (repFile ? { name: repFile.name, file: '', src: repPreview || '', note: `${kb(repFile.size)} · from your computer` }
      : rep.fromKey && ((lib) => lib && { name: nameOf(data.images.find((x) => x.key === lib.key) ?? lib), file: lib.name, src: `${lib.src}&w=640`, note: 'from the image library' })(data.library.find((i) => i.key === rep.fromKey)));

    function renderChoose(data, img) {
      const body = $('.dlg-body'), foot = $('.dlg-foot'), uses = placesOf(img), chosen = chosenOf(data);
      const q = libQuery.trim().toLowerCase();
      const libItems = data.library.filter((i) => i.key !== rep.key && (!q || i.key.toLowerCase().includes(q) || (data.images.find((x) => x.key === i.key) && placesOf(data.images.find((x) => x.key === i.key)).some((u) => altText(u.alt).toLowerCase().includes(q)))));
      body.innerHTML = `<div class="dlg-cols">
          <section class="dlg-side"><p class="label">Now</p>${img ? pic(img, nameOf(img), [dims(img), `used in ${placesText(uses.length)}`].filter(Boolean).join(' · ')) : `<p class="muted-note">${escapeHtml(rep.key)}</p>`}
            ${chosen ? `<p class="label">New</p><div class="r-pic"><img class="thumb" src="${escapeHtml(chosen.src)}" alt=""><span><b class="iname">${escapeHtml(chosen.name)}</b>${chosen.file ? fileLine(chosen.file) : ''}<small>${escapeHtml(chosen.note)}</small></span></div>` : ''}</section>
          <section class="dlg-main"><p class="dlg-q">Choose the new image</p>
            <div class="r-row"><label class="btn sm">${svg(I.send, 15)}${repFile ? 'Upload another file' : 'Upload a file'}<input type="file" class="r-file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" hidden></label>
              <input type="search" class="search r-lib-search" placeholder="Search the library" aria-label="Search the library" value="${escapeHtml(libQuery)}"></div>
            <div class="lib-grid">${libItems.map((i) => `<button type="button" data-key="${escapeHtml(i.key)}" aria-pressed="${i.key === rep.fromKey}" title="${escapeHtml(i.name)}"><img src="${escapeHtml(thumb(i, 160))}" alt="${escapeHtml(i.name)}" loading="lazy"></button>`).join('') || '<p class="muted-note">Nothing found.</p>'}</div>
            <p class="muted-note">Uploads: JPEG, PNG, WebP, AVIF or GIF, up to 20 MB. Big pictures are made smaller (at most 2000 px on the long side) and hidden details like the camera location are removed.</p>
            ${rep.error ? `<p class="r-error" role="alert">${escapeHtml(rep.error)}</p>` : ''}</section>
        </div>`;
      foot.innerHTML = `<button type="button" class="btn r-cancel">Cancel</button><button type="button" class="btn primary r-next" ${chosen ? '' : 'disabled'}>Next: where it changes</button>`;
      body.querySelector('.r-file').onchange = safe((e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        rep.error = f.size > 20 * 1024 * 1024 ? 'That file is larger than 20 MB. Use a smaller one.' : null;
        repFile = rep.error ? null : f; repPreview = null; rep.fromKey = null;
        if (repFile) { const r = new FileReader(); r.onload = () => { repPreview = r.result; renderReplace(); }; r.readAsDataURL(f); } // data: URL: the page's CSP allows it, blob: it doesn't
        renderReplace();
      });
      body.querySelector('.r-lib-search').oninput = safe((e) => { libQuery = e.target.value; renderReplace().then(() => { const s = $('.r-lib-search'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }); });
      body.querySelectorAll('.lib-grid [data-key]').forEach((b) => (b.onclick = safe(() => { rep.fromKey = b.dataset.key; repFile = repPreview = null; rep.error = null; saveRep(); renderReplace(); })));
      foot.querySelector('.r-cancel').onclick = safe(closeReplace);
      foot.querySelector('.r-next').onclick = safe(() => goStep(2));
    }

    function renderWhere(data, img) {
      const body = $('.dlg-body'), foot = $('.dlg-foot'), uses = placesOf(img), other = img ? elsewhereText(img) : '', chosen = chosenOf(data);
      if (!chosen) return goStep(1); // an upload isn't kept over a reload: choose it again
      const pages = [...new Set(uses.flatMap((u) => u.routes))];
      const placeList = uses.slice(0, 5).map((u) => `<li>${escapeHtml(useLabel(u))} <span class="route">${escapeHtml(u.routes.map((r) => (r === pagePath() ? `${r} (this page)` : r)).slice(0, 2).join(', ') || 'no page found')}</span></li>`).join('') + (uses.length > 5 ? `<li>and ${uses.length - 5} more</li>` : '');
      body.innerHTML = `<div class="dlg-cols">
          <section class="dlg-side"><img class="dlg-preview" src="${escapeHtml(chosen.src)}" alt="">
            <div class="dlg-name"><b class="iname">${escapeHtml(chosen.name)}</b>${chosen.file ? fileLine(chosen.file) : ''}<small>${escapeHtml(chosen.note)}</small></div>
            ${img ? `<div class="dlg-name"><p class="label">Replaces</p><b class="iname">${escapeHtml(nameOf(img))}</b>${fileLine(img.name)}</div>` : ''}
            <button type="button" class="btn sm r-back">Choose a different image</button></section>
          <section class="dlg-main"><p class="dlg-q">Where should the new image appear?</p>
            ${rep.only === 'here' ? '' : `<label class="choice"><input type="radio" name="r-mode" value="everywhere" ${rep.mode === 'everywhere' ? 'checked' : ''}><span><b>Everywhere — ${placesText(uses.length)}${pages.length > 1 ? ` on ${pages.length} pages` : ''}</b>
              <small>Replaces the image file itself, so every place that shows it changes${other ? `, also on ${escapeHtml(other)}` : ''}.</small><ul class="places">${placeList}</ul></span></label>`}
            ${rep.only === 'everywhere' ? '' : `<label class="choice"><input type="radio" name="r-mode" value="here" ${rep.mode === 'here' ? 'checked' : ''}><span><b>Only here</b>
              <small>${rep.fromKey ? 'Uses the chosen library image in this one place.' : 'Adds the new image to the library and changes only this one place.'} Everywhere else keeps the current image.</small>
              ${rep.use ? `<small>${escapeHtml(useLabel(rep.use))} · ${escapeHtml(useWhere(rep.use))}</small>` : ''}</span></label>`}
            ${rep.mode === 'here' && !rep.use ? '<p class="r-error">This spot could not be found in the page files, so only “Everywhere” is possible here. Or ask Claude to change it.</p>' : ''}
            ${rep.error ? `<p class="r-error" role="alert">${escapeHtml(rep.error)}</p>` : ''}</section>
        </div>`;
      const ready = rep.mode === 'everywhere' || rep.use;
      const go = rep.mode === 'everywhere' ? `Replace in ${placesText(uses.length)}` : 'Replace here only';
      foot.innerHTML = `<span class="dlg-note">Every replace can be undone in History.</span><button type="button" class="btn r-prev" ${rep.busy ? 'disabled' : ''}>Back</button><button type="button" class="btn primary r-go" ${ready && !rep.busy ? '' : 'disabled'}>${rep.busy ? `<span class="spin">${svg(I.spinner, 16, 2.5)}</span>Replacing…` : go}</button>`;
      body.querySelectorAll('[name="r-mode"]').forEach((r) => (r.onchange = safe(() => { rep.mode = r.value; saveRep(); renderReplace(); })));
      body.querySelector('.r-back').onclick = safe(() => goStep(1));
      foot.querySelector('.r-prev').onclick = safe(() => goStep(1));
      foot.querySelector('.r-go').onclick = safe(() => submitReplace(rep.use));
    }
    async function submitReplace(use) {
      const params = new URLSearchParams({ mode: rep.mode, key: rep.key, page: location.pathname });
      if (rep.mode === 'here') Object.entries({ file: use.file, line: use.line, column: use.column }).forEach(([k, v]) => params.set(k, v));
      if (rep.fromKey) params.set('from', rep.fromKey);
      if (repFile) params.set('name', repFile.name);
      rep.busy = true; rep.error = null; renderReplace();
      setBusy(false, 'Replacing image…');
      const r = await api(`/replace?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: repFile && !rep.fromKey ? repFile : undefined });
      setBusy(serverBusy);
      rep.busy = false;
      if (!r.ok) { rep.error = r.message; return renderReplace(); }
      // The new picture's panel: what changed (with Undo), its focal point and its descriptions
      setDone({ id: r.id, mode: r.mode, key: r.key, oldKey: r.oldKey, n: r.affected.length });
      if (use) setHere({ key: r.key, file: use.file, line: use.line, column: use.column, sure: true });
      setOpen(r.key);
      rep = null; repFile = repPreview = null; imgData = null; fp = null; // a new picture: its focal point starts fresh
      saveRep();
      scrim.hidden = true;
      openLibrary();
      // The dev server reloads the page once the new file is in place; reload ourselves if that message gets lost.
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => location.reload(), 4000);
    }

    // ── views: main / history / settings / images ──
    function setView(next) {
      view = next;
      sessionStorage.setItem(`${STORE}:view`, view);
      $$('.view').forEach((v) => (v.hidden = v.dataset.view !== view));
      $('.main-hdr').hidden = view !== 'main';
      $('.sub-hdr').hidden = view === 'main';
      $('.sub-title').textContent = { history: 'History', settings: 'Settings' }[view] ?? '';
      $('.sub-meta').textContent = '';
      if (view === 'history') renderHistory();
      if (view !== 'main') setCollapsed(false);
      renderBar();
    }
    $('.back').onclick = safe(() => setView('main'));

    // ── settings ──
    $('.set-check').checked = pref('check', true);
    $('.set-check').onchange = () => setPref('check', $('.set-check').checked);
    $('.set-overlay').checked = pref('overlay', true);
    $('.set-overlay').onchange = () => { setPref('overlay', $('.set-overlay').checked); inspector.setOverlay($('.set-overlay').checked); };
    $('.set-still').checked = pref('still', true);
    $('.set-still').onchange = () => { setPref('still', $('.set-still').checked); setMotion(); };

    // ── light / dark panel: follows the computer unless the editor picks one ──
    const darkQuery = matchMedia('(prefers-color-scheme: dark)');
    const themeChoice = () => { try { return localStorage.getItem(`${STORE}:theme`) || 'system'; } catch { return 'system'; } };
    function applyTheme() {
      const choice = themeChoice();
      panel.dataset.theme = $('.dialog').dataset.theme = $('.ask-pop').dataset.theme = $('.gal').dataset.theme = $('.typo-pop').dataset.theme = choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice;
      $$('[data-theme-set]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeSet === choice)));
    }
    $$('[data-theme-set]').forEach((b) => (b.onclick = safe(() => {
      try { localStorage.setItem(`${STORE}:theme`, b.dataset.themeSet); } catch {}
      applyTheme();
    })));
    darkQuery.addEventListener('change', safe(applyTheme));
    applyTheme();

    // ── pause the page's motion while editing ──
    // CSS animations, transitions and videos are frozen here. Script-driven motion (slider autoplay) can't be stopped from
    // outside without hacking the page, so components check <html data-motion="paused"> themselves (see the README).
    let pausedAnimations = [], pausedVideos = [];
    function setMotion() {
      const still = open && pref('still', true), html = document.documentElement;
      if (still === (html.dataset.motion === 'paused')) return;
      if (still) {
        html.dataset.motion = 'paused';
        // Running ones jump to their end; only endless ones (finish() throws) are paused and resumed later.
        pausedAnimations = document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.getRootNode?.() === document)
          .filter((a) => { try { a.finish(); return false; } catch { a.pause(); return true; } });
        pausedVideos = [...document.querySelectorAll('video')].filter((v) => !v.paused);
        pausedVideos.forEach((v) => v.pause());
      } else {
        delete html.dataset.motion;
        pausedAnimations.forEach((a) => { try { a.play(); } catch {} });
        pausedVideos.forEach((v) => v.play().catch(() => {}));
        pausedAnimations = []; pausedVideos = [];
      }
    }
    $('.new-chat').onclick = safe(() => { server.send('claude-edit:reset', {}); setView('main'); });
    $('.reset-panel').onclick = safe(() => {
      resetSize();
      Object.assign(panel.style, { left: '', top: '', right: '', bottom: '' });
      try { localStorage.removeItem(`${STORE}:pos`); } catch {}
    });
    const showSession = (id) => { if (id) $('.session-foot').innerHTML = `For developers: this chat is Claude Code session <code>${escapeHtml(id)}</code>. Open it with <code>claude --resume ${escapeHtml(id)}</code>.`; };

    // After Claude edits, the page hot-reloads; whichever page is showing then sends the "after" screenshot.
    let checking = null;
    const sendCheck = safe(async (id) => {
      if (checking === id || job?.phase !== 'working' || job.page !== location.pathname) return; // another tab asked
      // An earlier request's check while ours waits: no picture (the server then skips that check) rather than ours.
      if (job.queued) { checking = id; return void server.send('claude-edit:check', { id, image: null }); }
      const mine = job;
      checking = id;
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 800)); // let images and the reload settle
      if (job !== mine) return void server.send('claude-edit:check', { id, image: null }); // a new request started meanwhile
      const shot = await screenshotOrNull(jobTarget() ?? selected);
      server.send('claude-edit:check', { id, image: shot?.image ?? null });
      if (!shot && job === mine) finishJob(); // the server skips the check, so no second turn follows
    });

    server.on('claude-edit:state', safe((s) => {
      canvas.host?.toggleAttribute('data-no-images', !s.images);
      log.replaceChildren();
      turn = null; lastReply = null; expectCheck = false;
      replaying = true; // old replies after a reload aren't new
      try { s.log.forEach(add); } finally { replaying = false; }
      serverBusy = s.busy;
      setBusy(s.busy);
      showSession(s.sessionId);
      if (s.pendingCheck) sendCheck(s.pendingCheck.id);
      // The page reloaded while a request was running: it may have ended meanwhile (s.queued: requests still waiting).
      if (job?.phase === 'working') {
        if (job.queued && s.queued) return void renderBar(); // still waiting for the earlier one
        if (job.queued) { job.started = Date.now(); job.afterId = historyEntries.reduce((n, x) => Math.max(n, x.id), 0); } // it started while the page reloaded
        job.queued = false; job.awaitCheck = !!s.pendingCheck;
        if (!s.busy && !s.pendingCheck) finishJob(); else { saveJob(); renderBar(); }
      }
    }));
    server.on('claude-edit:event', safe((e) => {
      if (e.kind === 'busy' || e.kind === 'idle') {
        serverBusy = e.kind === 'busy';
        setBusy(serverBusy);
        if (!serverBusy) setTimeout(safe(settleClaude), 500); // unless the next queued request (yours?) starts right away
        if (job?.phase === 'working') {
          // ours starts now: its changes are the ones recorded from here on
          if (job.queued) { if (e.kind === 'busy') { job.queued = false; job.started = Date.now(); job.afterId = historyEntries.reduce((n, x) => Math.max(n, x.id), 0); renderBar(); } }
          else if (e.kind === 'busy') job.awaitCheck = false; // the screenshot check started
          else if (!job.awaitCheck) finishJob();
          saveJob();
        }
      } else if (e.kind === 'check') {
        if (job?.phase === 'working' && !job.queued) { job.awaitCheck = true; job.now = 'checking the result with a screenshot'; saveJob(); renderBar(); }
        sendCheck(e.id);
      }
      else if (e.kind === 'session') showSession(e.sessionId);
      else if (e.kind === 'reset') { log.replaceChildren(); turn = null; lastReply = null; add({ kind: 'info', text: 'New chat started.' }); serverBusy = false; setBusy(false); settleClaude(); if (job?.phase === 'working') keepJob(); }
      else add(e);
    }));
    server.on('claude-edit:text-result', safe(({ id, ok }) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (!ok) {
        add({ kind: 'info', text: 'Could not save that directly, so Claude is doing it.' });
        if (p.el && p.before != null) p.el.textContent = p.before; // the "Before" picture shows how it was
        setSave('claude', { label: p.fallback, afterId: historyEntries.reduce((n, e) => Math.max(n, e.id), 0) });
        // Claude has it once the request is sent (after its screenshot): only then is this tab's copy not needed
        ask(p.fallback, p.target, undefined, { el: p.el, noJob: job?.phase === 'working' }).then(() => p.backup && forget(p.backup));
      }
      else {
        if (p.backup) forget(p.backup);
        if (save?.id === id) setSave('saved');
        if (p.el) checkSpelling(); // the saved text may have fixed (or made) a typo
      }
      if (ok && p.link) { // no page reload after a direct save (see index.mjs)
        p.link.setAttribute('href', p.href);
        if (p.open === '_blank') p.link.setAttribute('target', '_blank'); else if (p.open === '') p.link.removeAttribute('target');
        showLink();
      }
    }));

    // ── drag the panel by its header; position is remembered per browser ──
    const header = $('header');
    const moveTo = (x, y) => {
      const r = panel.getBoundingClientRect();
      const left = Math.min(Math.max(0, x), innerWidth - r.width), top = Math.min(Math.max(0, y), Math.max(0, innerHeight - r.height));
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
      return { left, top };
    };
    try { const p = JSON.parse(localStorage.getItem(`${STORE}:pos`)); if (p) moveTo(p.left, p.top); } catch {}
    header.onpointerdown = safe((e) => {
      if (e.target.closest('button') || panel.classList.contains('big')) return; // docked: nothing to drag
      const r = panel.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      header.setPointerCapture(e.pointerId);
      header.onpointermove = (m) => moveTo(m.clientX - dx, m.clientY - dy);
      header.onpointerup = () => {
        header.onpointermove = header.onpointerup = null;
        if (!panel.style.left) return; // a plain click, never dragged: nothing to save
        try { localStorage.setItem(`${STORE}:pos`, JSON.stringify(moveTo(parseFloat(panel.style.left), parseFloat(panel.style.top)))); } catch {}
      };
    });
    header.ondblclick = safe((e) => {
      if (e.target.closest('button')) return;
      Object.assign(panel.style, { left: '', top: '', right: '', bottom: '' });
      try { localStorage.removeItem(`${STORE}:pos`); } catch {}
    });

    // ── resize from the bottom-right grip; size is remembered per browser ──
    const sizeTo = (w, h) => {
      const r = panel.getBoundingClientRect();
      const width = Math.max(Math.min(w, innerWidth - r.left - 8), Math.min(MIN_W, innerWidth - 16));
      const height = Math.max(Math.min(h, innerHeight - r.top - 8), MIN_H);
      Object.assign(panel.style, { width: `${width}px`, height: `${height}px`, maxHeight: 'none' });
      return { w: width, h: height };
    };
    const grip = $('.grip');
    let lastTap = 0;
    grip.onpointerdown = safe((e) => {
      e.preventDefault();
      const r = panel.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
      let moved = false;
      grip.setPointerCapture(e.pointerId);
      grip.onpointermove = (m) => {
        if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 3) return; // a click, not a drag
        if (!moved) moveTo(r.left, r.top); // pin the top-left corner so the panel grows right and down
        moved = true;
        sizeTo(r.width + m.clientX - sx, r.height + m.clientY - sy);
      };
      grip.onpointerup = () => {
        grip.onpointermove = grip.onpointerup = null;
        if (!moved) { // two quick clicks = back to the default size (works for mouse, touch and pen)
          if (Date.now() - lastTap < 400) resetSize();
          lastTap = Date.now();
          return;
        }
        try {
          localStorage.setItem(`${STORE}:size`, JSON.stringify(sizeTo(parseFloat(panel.style.width), parseFloat(panel.style.height))));
          localStorage.setItem(`${STORE}:pos`, JSON.stringify({ left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) }));
        } catch {}
      };
    });
    function resetSize() {
      Object.assign(panel.style, { width: '', height: '', maxHeight: '' });
      try { localStorage.removeItem(`${STORE}:size`); } catch {}
      keepInView();
    }
    try { const s = JSON.parse(localStorage.getItem(`${STORE}:size`)); if (s) Object.assign(panel.style, { width: `${s.w}px`, height: `${s.h}px`, maxHeight: 'none' }); } catch {}

    // A smaller window must never leave the panel (or part of it) off-screen.
    function keepInView() {
      if (panel.style.height) sizeTo(Math.min(parseFloat(panel.style.width), innerWidth - 16), Math.min(parseFloat(panel.style.height), innerHeight - 16));
      if (panel.style.left) moveTo(parseFloat(panel.style.left), parseFloat(panel.style.top));
    }
    window.addEventListener('resize', safe(keepInView));

    // ── close / open the panel (the top bar opens it: Ask Claude…, Spacing, History, Images, Settings, status) ──
    function setCollapsed(c) {
      panel.classList.toggle('collapsed', c);
      if (c && tab === 'spacing') setTab('ask'); // a spacing preview ends with the panel
      if (!c && topbar.classList.contains('unread')) { topbar.classList.remove('unread'); if (!topbar.classList.contains('busy')) $('.status em').textContent = 'Ready'; }
      try { sessionStorage.setItem(`${STORE}:panel-open`, c ? '' : '1'); } catch {} // per tab, like the rest of the editor's state
      keepInView(); // the opened panel must still fit on screen
      renderBar();
    }
    $$('.fold').forEach((b) => (b.onclick = safe(() => setCollapsed(true))));

    // ── open / close; it reopens itself (same view, tab and selection) after the hot reload that follows every edit ──
    app.onToggled(safe(({ state }) => {
      open = state;
      sessionStorage.setItem(`${STORE}:on`, open ? '1' : '');
      if (!open) { stopInline(true); closeSpace(); closeMore(); closeAskPop(); closeTypo(); }
      checkSpelling();
      pushPage(open);
      if (open && rep) showDialog(); else scrim.hidden = true; // a replace that reloaded the page comes back at step 3
      if (open && !rep && sessionStorage.getItem(`${STORE}:gal`)) openLibrary();
      setTab(tab);
      setMotion();
      syncPicking();
      renderBar();
      if (open) requestAnimationFrame(keepInView); // sizes are only known once it's visible
    }));
    setComposer();
    setTab(tab);
    const wasOpen = sessionStorage.getItem(`${STORE}:panel-open`) === '1'; // closed until the editor opens it
    setBig(sessionStorage.getItem(`${STORE}:big`) === '1');
    setView(['history', 'settings'].includes(sessionStorage.getItem(`${STORE}:view`)) ? sessionStorage.getItem(`${STORE}:view`) : 'main');
    setCollapsed(!wasOpen); // after setView, which opens the panel for History and Settings: closed before the reload stays closed
    server.send('claude-edit:hello', {});
    if (sessionStorage.getItem(`${STORE}:on`)) {
      app.toggleState({ state: true });
      const saved = JSON.parse(sessionStorage.getItem(`${STORE}:sel`) || 'null');
      const el = saved?.page === location.pathname && findSaved(saved); // a shared component's place on another page is another thing
      if (el) select(el, true);
    }
  }),
};

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
