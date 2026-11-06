// Spacing inspector for the selected element ("Spacing" tab of the editor):
// - plain-language rows: Space inside / Space outside / Gap between items / Text size, each with −/+ steps
// - says where each value comes from: shared by N elements, from the theme, only here, or not set
// - steps follow the design system's scale and preview live (temporary inline style)
// - overlays on the page in matching colours; hold Shift and point at something to measure the distance
// Nothing is saved here; "Apply with Claude" hands the change over, for this element only or everywhere it's shared.
// The top bar's Spacing menu drives the same preview in plain steps: Less / Normal / More for a whole group (nudge).

const COLOR = { margin: 'rgba(245,158,11,.36)', padding: 'rgba(22,163,74,.30)', gap: 'rgba(147,51,234,.28)', measure: '#e11d74' };
const LADDER = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 96, 110, 120, 140, 160, 200];
const TYPE_FALLBACK = [11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 54, 64];
const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
const isFlexGrid = (el) => !!el && /flex|grid/.test(getComputedStyle(el).display);
const gapOf = (el) => (isFlexGrid(el) ? Math.max(parseFloat(getComputedStyle(el).rowGap) || 0, parseFloat(getComputedStyle(el).columnGap) || 0) : 0);
// The space next to an item inside a grid/flex row is the container's gap (also when the item is a flex box itself, like a card).
const inRow = (el) => gapOf(el.parentElement) > 0;
const GROUPS = [
  { name: 'Space inside', swatch: '#86EFAC', edge: '#16A34A', rows: [
    { key: 'padding-top', label: 'Top', long: 'Space inside, top', props: ['padding-top'] },
    { key: 'padding-bottom', label: 'Bottom', long: 'Space inside, bottom', props: ['padding-bottom'] },
    { key: 'padding-x', label: 'Left and right', long: 'Space inside, left and right', props: ['padding-left', 'padding-right'] },
  ] },
  { name: 'Space outside', swatch: '#FCD34D', edge: '#D97706', rows: [
    { key: 'margin-top', label: 'Above', long: 'Space above', props: ['margin-top'] },
    { key: 'margin-bottom', label: 'Below', long: 'Space below', props: ['margin-bottom'] },
  ] },
  { name: 'Gap between items', swatch: '#D8B4FE', edge: '#9333EA', when: (cs) => /flex|grid/.test(cs.display), rows: [
    { key: 'gap', label: 'Gap', long: 'Gap between items', props: ['row-gap', 'column-gap'] },
  ] },
  { name: 'Gap to neighbours', swatch: '#D8B4FE', edge: '#9333EA', when: (cs, el) => inRow(el), rows: [
    { key: 'parent-gap', label: 'Gap', long: 'Gap between this and its neighbours (set on the container around it)', props: ['row-gap', 'column-gap'], on: 'parent' },
  ] },
  { name: 'Text', when: (cs, el) => ownText(el), rows: [
    { key: 'font-size', label: 'Text size', long: 'Text size', props: ['font-size'], type: true },
  ] },
];
const ROWS = GROUPS.flatMap((g) => g.rows);

export const inspectorCss = `
  .spacing-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482999; }
  .spacing-layer div { position: fixed; box-sizing: border-box; }
  .spacing-layer b { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 600 10px/1 system-ui, sans-serif; color: #fff;
    background: rgba(22,24,29,.85); padding: 2px 4px; border-radius: 3px; white-space: nowrap; }
  .spacing-layer .measure-box { outline: 1px dashed ${COLOR.measure}; }
  .spacing { display: flex; flex-direction: column; min-height: 0; }
  .spacing .groups { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 16px; }
  .spacing .group { display: flex; flex-direction: column; gap: 4px; }
  .spacing .group > p { margin: 0 0 4px; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
  .spacing .key { width: 12px; height: 12px; border-radius: 3px; border: 1px solid; }
  .spacing .row { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 10px; border-radius: 10px; }
  .spacing .row.changed { background: var(--tint); }
  .spacing .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .spacing .what span { font-size: 13px; }
  .spacing .what small { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacing .stepper { display: flex; align-items: center; height: 36px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--bg); overflow: hidden; flex-shrink: 0; }
  .spacing .row.changed .stepper { border-color: #d71920; }
  .spacing .stepper button { width: 36px; height: 36px; border: 0; background: transparent; font-size: 18px; line-height: 1; color: var(--text); }
  .spacing .stepper button:hover { background: var(--bg-2); }
  .spacing .stepper output { min-width: 58px; text-align: center; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .spacing .row.changed output { font-weight: 600; color: var(--accent-text); }
  .spacing .around { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--tint); border: 1px solid var(--tint-line); font-size: 13px; }
  .spacing .around p { margin: 0; color: var(--text); }
  .spacing .around div { display: flex; align-items: center; gap: 8px; }
  .spacing .around span { flex: 1; color: var(--muted); font-size: 12px; }
  .spacing .tip { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .spacing .apply { flex-shrink: 0; padding: 14px 16px 16px; border-top: 1px solid var(--line); background: var(--bg-foot); display: flex; flex-direction: column; gap: 12px; }
  .spacing fieldset { margin: 0; padding: 0; border: 0; display: flex; flex-direction: column; gap: 8px; }
  .spacing legend { padding: 0; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
  .spacing fieldset label { display: flex; align-items: center; gap: 10px; font-size: 13px; cursor: pointer; }
  .spacing fieldset label small { margin-left: -4px; font-size: 12px; color: var(--muted); }
  .spacing fieldset label small::before { content: "· "; }
  .spacing fieldset label.off { color: var(--muted); cursor: not-allowed; }
  .spacing fieldset input { width: 18px; height: 18px; margin: 0; accent-color: #d71920; }
  .spacing .apply-btns { display: flex; gap: 8px; }
`;

export function createInspector({ canvas, mount, touch, onApply, onSelect = () => {}, parentOf = (el) => el.parentElement, nameOf = () => 'Block' }) {
  const layer = document.createElement('div');
  layer.className = 'spacing-layer';
  canvas.prepend(layer);
  let target = null, meta = {}, sources = {}, previews = {}, originals = {}, measureEl = null, frame = 0, overlay = true, scope = null;

  // ── where a value comes from ──
  // meta: { kind: 'Section', plural: 'sections' } so the scope choice can say "Only this section".
  function setTarget(el, m = {}) {
    if (el && el === target) return; // the same element again (the panel calls this for many reasons): keep its preview
    resetPreview();
    target = el;
    meta = m;
    measureEl = null;
    sources = {};
    scope = null;
    if (el) for (const row of ROWS) { const at = rowEl(row); if (at) sources[row.key] = findSource(at, row.props[0]); }
    renderRows();
    render();
  }

  // ── live preview ──
  const rowEl = (row) => (row.on === 'parent' ? target?.parentElement : target);
  function step(row, dir) {
    const el = rowEl(row);
    const cs = getComputedStyle(el);
    const current = parseFloat(cs.getPropertyValue(row.props[0])) || 0;
    const scale = row.type ? typeScale() : spacingScale();
    const next = dir > 0 ? scale.find((v) => v > current + 0.5) : [...scale].reverse().find((v) => v < current - 0.5);
    if (next === undefined) return;
    const original = previews[row.key]?.from ?? current;
    for (const prop of row.props) {
      const key = `${row.on ?? 'self'}|${prop}`;
      if (!(key in originals)) originals[key] = [el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
      el.style.setProperty(prop, `${next}px`);
    }
    if (next === original) delete previews[row.key];
    else previews[row.key] = { row, from: original, to: next };
    renderRows();
    render();
  }
  function resetPreview() {
    for (const [el, prop, value, priority] of Object.values(originals)) {
      if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
      if (!el.getAttribute('style')) el.removeAttribute('style'); // leave the DOM exactly as it was
    }
    originals = {};
    previews = {};
  }

  // ── panel ──
  const sharedCount = (src) => (src && (src.kind === 'token' || src.kind === 'rule') ? src.count : 0);
  function subline(src, preview) {
    const was = preview ? ` · was ${preview.from}` : '';
    if (!src || src.kind === 'default') return `Not set${was}`;
    if (src.kind === 'inline') return `Only here${was}`;
    const here = src.count > 1 ? `${src.count} ${meta.plural ?? 'elements'} on this page` : 'only one on this page';
    return (isGlobal(src) ? `Shared style · ${here}` : src.count > 1 ? `This page's style · ${here}` : 'Only here') + was;
  }
  function renderRows() {
    if (!target) return void mount.replaceChildren();
    const cs = getComputedStyle(target);
    const groups = GROUPS.filter((g) => !g.when || g.when(cs, target)).map((g) => {
      const rows = g.rows.map((r) => {
        const rcs = getComputedStyle(rowEl(r));
        const values = r.props.map((p) => Math.round(parseFloat(rcs.getPropertyValue(p)) || 0));
        const shown = values.every((v) => v === values[0]) ? `${values[0]} px` : `${values.join(' / ')} px`;
        const p = previews[r.key];
        return `<div class="row${p ? ' changed' : ''}" data-key="${r.key}" title="${esc(sourceText(sources[r.key]))}">
          <span class="what"><span>${r.label}</span><small>${esc(subline(sources[r.key], p))}</small></span>
          <span class="stepper"><button type="button" data-dir="-1" aria-label="Less: ${esc(r.long)}">−</button><output>${shown}</output><button type="button" data-dir="1" aria-label="More: ${esc(r.long)}">+</button></span>
        </div>`;
      }).join('');
      const key = g.swatch ? `<span class="key" style="background:${g.swatch};border-color:${g.edge}"></span>` : '';
      return `<div class="group"><p>${key}${g.name}</p>${rows}</div>`;
    }).join('');
    const tip = touch ? '' : '<p class="tip">Tip: hold <kbd>Shift</kbd> and point at something on the page to measure the distance to it.</p>';
    mount.innerHTML = `<div class="groups">${aroundHint(cs)}${groups}${tip}</div>${applyBar()}`;
    mount.querySelectorAll('[data-around]').forEach((b) => (b.onclick = () => onSelect(around[Number(b.dataset.around)])));
    mount.querySelectorAll('.stepper button').forEach((b) => (b.onclick = () => step(ROWS.find((r) => r.key === b.closest('.row').dataset.key), Number(b.dataset.dir))));
    mount.querySelectorAll('input[name="ce-scope"]').forEach((i) => (i.onchange = () => { scope = i.value; }));
    mount.querySelector('.reset')?.addEventListener('click', () => { resetPreview(); renderRows(); render(); });
    mount.querySelector('.apply-go')?.addEventListener('click', () => apply(scope ?? 'this'));
  }
  // When the selection has no spacing of its own, say where the space you see comes from, with a way to select it.
  let around = [];
  function aroundHint(cs) {
    around = [];
    const own = ['padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin-top', 'margin-bottom'].some((p) => parseFloat(cs.getPropertyValue(p)) > 0);
    if (own) return '';
    const items = [];
    for (let a = parentOf(target); a && items.length < 2; a = parentOf(a)) {
      const acs = getComputedStyle(a), pad = sides(acs, 'padding'), gap = gapOf(a), parts = [];
      if (gap) parts.push(`gap ${Math.round(gap)} px`);
      if (pad.t || pad.b) parts.push(`space inside ${Math.round(pad.t)}${pad.b !== pad.t ? ` / ${Math.round(pad.b)}` : ''} px`);
      if (!parts.length) continue;
      around.push(a);
      items.push(`<div><span><b>${esc(nameOf(a))}</b> · ${parts.join(', ')}</span><button type="button" class="btn sm" data-around="${around.length - 1}">Select</button></div>`);
    }
    if (!items.length) return '';
    return `<div class="around"><p>This ${esc((meta.kind ?? 'element').toLowerCase())} has no spacing of its own. The space you see comes from:</p>${items.join('')}</div>`;
  }
  // Three reaches: this one element, every element on this page that shares the style, or the shared style itself.
  function scopeOptions() {
    const changes = Object.values(previews);
    if (!changes.length) return [];
    const srcs = changes.map((c) => sources[c.row.key]);
    const count = Math.min(...srcs.map(sharedCount));
    const kind = (meta.kind ?? 'element').toLowerCase(), plural = meta.plural ?? 'elements';
    const options = [
      { value: 'this', label: `Only this ${kind}`, on: true },
      { value: 'page', label: `All ${count} ${plural} on this page`, on: count > 1, why: 'There is no other one like it on this page.' },
      { value: 'everywhere', label: `All ${plural} on every page`, note: 'changes the shared style', on: srcs.every(isGlobal), why: 'This style is set on this page only, not in a shared component or the theme.' },
    ];
    if (!options.find((o) => o.value === scope)?.on) scope = 'this';
    return options;
  }
  function applyBar() {
    const changes = Object.values(previews), options = scopeOptions();
    if (!changes.length) return '';
    const radio = (o) => `<label class="${o.on ? '' : 'off'}" title="${o.on ? '' : esc(o.why)}"><input type="radio" name="ce-scope" value="${o.value}" ${scope === o.value ? 'checked' : ''} ${o.on ? '' : 'disabled'}>${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</label>`;
    return `<div class="apply"><fieldset><legend>${changes.length} change${changes.length > 1 ? 's' : ''} previewed. Apply ${changes.length > 1 ? 'them' : 'it'} to:</legend>
      ${options.map(radio).join('')}
      </fieldset>
      <div class="apply-btns"><button type="button" class="btn reset">Reset</button><button type="button" class="btn primary grow apply-go">Apply with Claude</button></div></div>`;
  }

  // ── Less / Normal / More: one step on the scale for every value of a group, or back to how it was ──
  const PLAIN = { inside: 'Space inside', outside: 'Space outside', gap: 'Gap between items' };
  const groupRows = (key) => GROUPS.find((g) => g.name === PLAIN[key]).rows;
  function plainGroups() {
    if (!target) return [];
    const cs = getComputedStyle(target);
    return Object.keys(PLAIN).filter((key) => { const g = GROUPS.find((x) => x.name === PLAIN[key]); return !g.when || g.when(cs, target); });
  }
  function revertRow(row) {
    for (const prop of row.props) {
      const k = `${row.on ?? 'self'}|${prop}`;
      if (!(k in originals)) continue;
      const [el, , value, priority] = originals[k];
      if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
      if (!el.getAttribute('style')) el.removeAttribute('style');
      delete originals[k];
    }
    delete previews[row.key];
  }
  // A plain step is one you can see: at least 8 px or a fifth of the current value, along the scale.
  function nudge(key, dir) {
    for (const row of groupRows(key)) {
      revertRow(row);
      if (!dir) continue;
      const from = parseFloat(getComputedStyle(rowEl(row)).getPropertyValue(row.props[0])) || 0, enough = Math.max(8, from * 0.2);
      for (let i = 0; i < 8; i++) {
        step(row, dir);
        const p = previews[row.key];
        if (!p || Math.abs(p.to - p.from) >= enough) break;
      }
    }
    renderRows(); render();
  }
  // -1 / 0 / 1: what the group is set to now (0 = as it is on the site)
  function level(key) {
    const p = groupRows(key).map((r) => previews[r.key]).find(Boolean);
    return !p ? 0 : p.to > p.from ? 1 : -1;
  }

  // ── hand the change to Claude ──
  async function apply(where) {
    const changes = Object.values(previews);
    if (!changes.length) return;
    const lines = changes.map((c) => {
      const token = tokenNames(c.to, c.row.type)[0];
      return `- ${c.row.long} (${c.row.props.join(' + ')}): ${c.from}px → ${c.to}px${token ? ` (= ${token} at this width)` : ''}. Currently ${sourceText(sources[c.row.key])}.`;
    });
    // Always the same way of writing each reach, so the code looks the same no matter who asked.
    const value = 'Use an existing token (var(--…)) when one matches the new value, otherwise the px value.';
    const how = {
      this: `Apply to THIS ELEMENT ONLY. Do not change shared rules or tokens. Set it in the \`style\` attribute of this one usage in the page file. If that usage is a component that does not pass \`style\` through to its root element yet, add a \`style\` prop to it that does (nothing else in the component). ${value}`,
      page: `Apply to EVERY element on THIS PAGE that uses this style, and nowhere else. Do not change the shared rule, the token or any component. Put it in one \`<style is:global>\` block at the end of this page's file in src/pages (add the block if it is missing, otherwise add to it), reusing the matched selector prefixed with \`body \` so it wins over the shared rule. ${value}`,
      everywhere: 'Apply EVERYWHERE: change the shared rule or token itself so every element using it, on every page, changes. If a token has different values per breakpoint, scale the other breakpoints proportionally.',
    }[where];
    const instruction = `Spacing change from the inspector, previewed by the editor at ${innerWidth}px wide:\n${lines.join('\n')}\n${how}`;
    const kind = (meta.kind ?? 'element').toLowerCase();
    const label = `${changes.map((c) => `${c.row.long} ${c.from} → ${c.to} px`).join(', ')} (${{ this: `only this ${kind}`, page: `all ${meta.plural ?? 'elements'} on this page`, everywhere: 'every page' }[where]})`;
    await onApply(instruction, label); // screenshot is taken while the preview is still showing
    resetPreview();
    renderRows();
    render();
  }

  // ── overlays ──
  function render() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  }
  function draw() {
    layer.replaceChildren();
    if (!overlay || !target?.isConnected) return;
    const cs = getComputedStyle(target), r = target.getBoundingClientRect();
    const m = sides(cs, 'margin'), p = sides(cs, 'padding'), b = sides(cs, 'border', '-width');
    box(r.left - m.l, r.top - m.t, r.width + m.l + m.r, m.t, COLOR.margin, m.t);
    box(r.left - m.l, r.bottom, r.width + m.l + m.r, m.b, COLOR.margin, m.b);
    box(r.left - m.l, r.top, m.l, r.height, COLOR.margin, m.l);
    box(r.right, r.top, m.r, r.height, COLOR.margin, m.r);
    const x = r.left + b.l, y = r.top + b.t, w = r.width - b.l - b.r, h = r.height - b.t - b.b;
    box(x, y, w, p.t, COLOR.padding, p.t);
    box(x, y + h - p.b, w, p.b, COLOR.padding, p.b);
    box(x, y + p.t, p.l, h - p.t - p.b, COLOR.padding, p.l);
    box(x + w - p.r, y + p.t, p.r, h - p.t - p.b, COLOR.padding, p.r);
    if (/flex|grid/.test(cs.display)) gaps(target, x + p.l, w - p.l - p.r);
    if (inRow(target)) {
      const parent = target.parentElement, pr = parent.getBoundingClientRect(), pp = sides(getComputedStyle(parent), 'padding');
      gaps(parent, pr.left + pp.l, pr.width - pp.l - pp.r);
    }
    if (measureEl?.isConnected && measureEl !== target) measure(r, measureEl.getBoundingClientRect());
  }
  function gaps(container, innerX, innerW) {
    const kids = [...container.children].slice(0, 40).map((k) => k.getBoundingClientRect()).filter((k) => k.width && k.height);
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i], c = kids[i + 1];
      if (c.left >= a.right - 1 && c.top < a.bottom && c.bottom > a.top) { // side by side
        const top = Math.max(a.top, c.top);
        box(a.right, top, c.left - a.right, Math.min(a.bottom, c.bottom) - top, COLOR.gap, c.left - a.right);
      } else if (c.top >= a.bottom - 1) { // next row
        const rowBottom = Math.max(...kids.slice(0, i + 1).filter((k) => k.top <= a.top + 1).map((k) => k.bottom));
        box(innerX, rowBottom, innerW, c.top - rowBottom, COLOR.gap, c.top - rowBottom);
      }
    }
  }
  function measure(a, o) {
    const outline = document.createElement('div');
    outline.className = 'measure-box';
    Object.assign(outline.style, { left: `${o.left}px`, top: `${o.top}px`, width: `${o.width}px`, height: `${o.height}px` });
    layer.append(outline);
    const inside = (outer, inner) => outer.left <= inner.left + 0.5 && outer.top <= inner.top + 0.5 && outer.right >= inner.right - 0.5 && outer.bottom >= inner.bottom - 0.5;
    if (inside(o, a) || inside(a, o)) {
      const [out, inn] = inside(o, a) ? [o, a] : [a, o];
      const cx = inn.left + inn.width / 2, cy = inn.top + inn.height / 2;
      line(cx, out.top, cx, inn.top); line(cx, inn.bottom, cx, out.bottom);
      line(out.left, cy, inn.left, cy); line(inn.right, cy, out.right, cy);
      return;
    }
    const overlapX = Math.max(a.left, o.left) < Math.min(a.right, o.right), overlapY = Math.max(a.top, o.top) < Math.min(a.bottom, o.bottom);
    const x = overlapX ? (Math.max(a.left, o.left) + Math.min(a.right, o.right)) / 2 : a.left + a.width / 2;
    const y = overlapY ? (Math.max(a.top, o.top) + Math.min(a.bottom, o.bottom)) / 2 : a.top + a.height / 2;
    if (o.top >= a.bottom) line(x, a.bottom, x, o.top); else if (a.top >= o.bottom) line(x, o.bottom, x, a.top);
    if (o.left >= a.right) line(a.right, y, o.left, y); else if (a.left >= o.right) line(o.right, y, a.left, y);
  }
  function box(x, y, w, h, color, value) {
    if (w < 0.5 || h < 0.5) return;
    const d = document.createElement('div');
    Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, background: color });
    if (value >= 1) d.innerHTML = `<b>${Math.round(value)}</b>`;
    layer.append(d);
  }
  function line(x1, y1, x2, y2) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const d = document.createElement('div');
    const vertical = x1 === x2;
    Object.assign(d.style, vertical
      ? { left: `${x1}px`, top: `${Math.min(y1, y2)}px`, width: '1px', height: `${len}px`, background: COLOR.measure }
      : { left: `${Math.min(x1, x2)}px`, top: `${y1}px`, width: `${len}px`, height: '1px', background: COLOR.measure });
    d.innerHTML = `<b style="background:${COLOR.measure}">${Math.round(len)}px</b>`;
    layer.append(d);
  }

  return {
    setTarget,
    render,
    plainGroups,
    nudge,
    level,
    scopeOptions,
    get scope() { return scope ?? 'this'; },
    set scope(v) { scope = v; },
    changed: () => Object.keys(previews).length,
    apply: (where) => apply(where),
    reset() { resetPreview(); renderRows(); render(); },
    measure(el) { if (el !== measureEl) { measureEl = el; render(); } },
    setOverlay(on) { overlay = on; render(); },
    refresh() { if (target) { renderRows(); render(); } }, // redraw after a resize (values change per breakpoint); keeps any preview
  };
}

// ── CSS source lookup ──
function findSource(el, prop) {
  const inline = declared(el.style, prop);
  if (inline) return { kind: 'inline', value: inline };
  let best = null;
  eachRule(true, (rule, sheet) => {
    if (!(rule instanceof CSSStyleRule)) return;
    const selector = matchingSelector(el, rule.selectorText);
    if (!selector) return;
    const value = declared(rule.style, prop);
    if (!value) return;
    const spec = specificity(selector);
    // ponytail: ignores !important and @layer order; last rule wins among equal specificity, like the browser
    if (!best || compare(spec, best.spec) >= 0) best = { rule, sheet, value, spec, selector };
  });
  if (!best) return { kind: 'default' };
  const token = best.value.match(/var\((--[\w-]+)/)?.[1];
  let count = 0;
  try { count = document.querySelectorAll(best.selector).length; } catch {} // elements sharing the part that matched
  return { kind: token ? 'token' : 'rule', value: best.value, token, selector: best.selector, rule: best.rule.selectorText, file: sheetFile(best.sheet), count };
}
// Shared = comes from the theme (a token) or from a stylesheet that isn't this page's own (a component, theme.css).
function isGlobal(src) {
  return !!src && (src.kind === 'token' || (src.kind === 'rule' && !/(^|\/)src\/pages\//.test(src.file)));
}
function sourceText(src) {
  if (!src || src.kind === 'default') return 'not set (browser default)';
  if (src.kind === 'inline') return `set only on this element (inline style "${src.value}")`;
  const where = `\`${src.selector}\` (rule \`${src.rule}\`) in ${src.file}${src.count > 1 ? ` (matches ${src.count} elements on this page)` : ''}`;
  return src.kind === 'token' ? `from ${where}, via token ${src.token} (shared)` : `from ${where}: ${src.value}`;
}

const SHORT = {
  'padding-top': ['padding', 0], 'padding-right': ['padding', 1], 'padding-bottom': ['padding', 2], 'padding-left': ['padding', 3],
  'margin-top': ['margin', 0], 'margin-right': ['margin', 1], 'margin-bottom': ['margin', 2], 'margin-left': ['margin', 3],
  'row-gap': ['gap', 0], 'column-gap': ['gap', 1],
};
// The declared (not computed) value, so var(--token) references survive. Reads shorthands too.
function declared(style, prop) {
  const own = style.getPropertyValue(prop).trim();
  if (own) return own;
  if (prop === 'font-size') {
    const font = style.getPropertyValue('font').trim();
    return font ? font.match(/var\(--[\w-]*size[\w-]*\)/)?.[0] ?? font.match(/(\S+)\s*\//)?.[1] ?? '' : '';
  }
  const [shorthand, i] = SHORT[prop] ?? [];
  if (!shorthand) return '';
  const parts = splitTop(style.getPropertyValue(shorthand).trim());
  if (!parts.length) return '';
  if (shorthand === 'gap') return parts[Math.min(i, parts.length - 1)];
  const [t, r = t, b = t, l = r] = parts;
  return [t, r, b, l][i];
}
function splitTop(value) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ' ' && !depth) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function matchingSelector(el, list) {
  for (const s of splitList(list)) { try { if (el.matches(s)) return s; } catch {} }
  return null;
}
function splitList(list) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function specificity(sel) {
  const s = sel.replace(/:where\([^)]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (s.match(/(^|[\s>+~(])[a-z][\w-]*/gi) ?? []).length + (s.match(/::[\w-]+/g) ?? []).length;
  return [ids, classes, types];
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function eachRule(activeOnly, fn) {
  const walk = (rules, sheet) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && activeOnly && !matchMedia(rule.conditionText).matches) continue;
      if (rule.cssRules && !(rule instanceof CSSStyleRule)) walk(rule.cssRules, sheet);
      else fn(rule, sheet);
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules, sheet); } catch {} // cross-origin sheets (Google Fonts) can't be read
  }
}
function sheetFile(sheet) {
  const id = sheet.ownerNode?.dataset?.viteDevId ?? sheet.href ?? 'an inline <style>';
  return id.replace(/^.*?\/(packages|apps)\//, '$1/');
}

// ── scales ──
function tokens() {
  const names = new Set();
  eachRule(false, (rule) => {
    if (rule instanceof CSSStyleRule && splitList(rule.selectorText).includes(':root')) for (const n of rule.style) if (n.startsWith('--')) names.add(n);
  });
  const root = getComputedStyle(document.documentElement);
  return [...names].map((name) => ({ name, value: root.getPropertyValue(name).trim() }))
    .filter((t) => /^\d*\.?\d+px$/.test(t.value)).map((t) => ({ name: t.name, px: parseFloat(t.value) }));
}
const isSpace = (t) => /pad|gap|gutter|space|spacing|margin/.test(t.name);
const isType = (t) => /size/.test(t.name);
function spacingScale() {
  return [...new Set([...LADDER, ...tokens().filter(isSpace).map((t) => t.px)])].sort((a, b) => a - b);
}
function typeScale() {
  const scale = [...new Set(tokens().filter(isType).map((t) => t.px))].sort((a, b) => a - b);
  return scale.length >= 3 ? scale : TYPE_FALLBACK;
}
function tokenNames(px, type) {
  return tokens().filter((t) => (type ? isType(t) : isSpace(t)) && Math.abs(t.px - px) < 0.5).map((t) => t.name);
}

function sides(cs, prefix, suffix = '') {
  const v = (s) => parseFloat(cs.getPropertyValue(`${prefix}-${s}${suffix}`)) || 0;
  return { t: v('top'), r: v('right'), b: v('bottom'), l: v('left') };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
