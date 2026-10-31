/* Apiarius's web page: the basics. The helpers every view words things
 * with (ages, durations, counts, paths, the statuses), what the page keeps
 * in this browser (`store`), the tiny keyed virtual DOM the page renders
 * through (h/patch), and the icons. It imports nothing, so every module may
 * use it while it loads (app.js says what the others hold).
 */

// ===================================================================== basics

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
export const total = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0);

/** How long ago, in the mod's words (hooks/format.ts `since`): "now", "3m", "2h", "4d". */
export function since(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** A duration in the mod's words (hooks/format.ts `dur`): "42s", "4m", "1h 05m". */
export function dur(ms) {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** 842, 4.2k, 48k, 1.2M. */
export function num(n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e5) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}
/** The session's spend, "≈$6.42": /cost's estimate at API list prices, never a bill. */
export const usd = x => (x == null ? '—' : `≈$${x.toFixed(2)}`);
export function msText(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return dur(ms);
}
export function splitPath(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? ['', p] : [p.slice(0, i + 1), p.slice(i + 1)];
}
/** A path outside the repository as its last two parts, "…/Temp/bench.js"; one of two parts or fewer as it is. */
export function shortPath(p) {
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : String(p);
}
export const oneLine = text => String(text || '').replace(/\s+/g, ' ').trim();
/** The first line that says something, a Markdown list or heading mark left off. */
export function firstLine(text, max = 180) {
  const line = String(text || '').split('\n').find(l => l.trim()) || '';
  const bare = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '').trim();
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem(`apiarius:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`apiarius:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

const STATUS = {
  starting: { hue: 'run', label: 'starting' },
  running: { hue: 'run', label: 'running' },
  waiting: { hue: 'wait', label: 'waiting on you' },
  done: { hue: 'done', label: 'done' },
  failed: { hue: 'fail', label: 'failed' },
  stopped: { hue: 'idle', label: 'stopped' },
  idle: { hue: 'idle', label: 'idle' },
};
export const statusOf = st => STATUS[st] || STATUS.idle;
/** A row's status as it shows: a stopped agent's says failed, but it shows as stopped. */
export const stateOf = a => (a.isStopped ? 'stopped' : a.status);
export const isLive = st => st === 'running' || st === 'starting' || st === 'waiting';
export const isRunning = st => st === 'running' || st === 'starting';

// ================================================================ virtual DOM
//
// h(tag, props, ...children) builds a vnode. Children are matched to the old
// ones by `key` when they have one, else by their slot among the unkeyed
// children. A `null`/`false` child keeps its slot, so `cond && h(...)` never
// shifts its siblings. Props: `class`, `style` (string or object), `on<Event>`
// handlers, `html` (trusted static markup such as icons), `ref` (called once
// with the element when it is created), `enter` (animate when added to a live
// list); anything else is an attribute.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const NOPROPS = {};

export function h(t, p, ...kids) {
  p = p || NOPROPS;
  return { t, p, c: norm(kids, [], false), k: p.key != null ? p.key : null, el: null };
}

function norm(list, out, nested) {
  for (const x of list) {
    if (x == null || x === false || x === true || x === '') { if (!nested) out.push(null); continue; }
    if (Array.isArray(x)) { norm(x, out, true); continue; }
    out.push(typeof x === 'object' ? x : { t: '#', s: String(x), k: null, el: null });
  }
  return out;
}

export function create(v, svg) {
  if (v.t === '#') return (v.el = document.createTextNode(v.s));
  svg = svg || v.t === 'svg';
  const el = (v.el = svg ? document.createElementNS(SVG_NS, v.t) : document.createElement(v.t));
  for (const k in v.p) setProp(el, k, undefined, v.p[k], svg);
  if (v.p.html == null) for (const c of v.c) if (c) el.appendChild(create(c, svg));
  if (v.p.ref) v.p.ref(el);
  return el;
}

function dropEnter(e) {
  if (e.animationName !== 'enter') return;
  this.classList.remove('enter');
  this.removeEventListener('animationend', dropEnter);
}

function dispatch(e) {
  const f = this._on && this._on[e.type];
  if (f) f(e, this);
}

function setProp(el, k, a, b, svg) {
  if (k === 'key' || k === 'ref' || k === 'enter') return;
  if (k === 'class') {
    if (svg) b == null ? el.removeAttribute('class') : el.setAttribute('class', b);
    else el.className = b || '';
    return;
  }
  if (k === 'style') {
    if (b == null || typeof b === 'string') { el.style.cssText = b || ''; return; }
    const old = a && typeof a === 'object' ? a : {};
    if (typeof a === 'string') el.style.cssText = '';
    for (const s in old) if (!(s in b)) el.style.removeProperty(s);
    for (const s in b) if (old[s] !== b[s]) el.style.setProperty(s, b[s]);
    return;
  }
  if (k === 'html') { el.innerHTML = b == null ? '' : b; return; }
  if (k[0] === 'o' && k[1] === 'n') {
    const type = k.slice(2).toLowerCase();
    const on = el._on || (el._on = {});
    if (!(type in on)) el.addEventListener(type, dispatch);
    on[type] = b || null;
    return;
  }
  if (k === 'value' || k === 'checked') { if (el[k] !== b) el[k] = b; return; }
  if (b == null || b === false) el.removeAttribute(k);
  else el.setAttribute(k, b === true ? '' : b);
}

function sameStyle(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (!(k in a)) return false;
  return true;
}

export function patch(o, n, svg) {
  if (o === n) return n.el;
  const el = (n.el = o.el);
  if (n.t === '#') { if (o.s !== n.s) el.data = n.s; return el; }
  svg = svg || n.t === 'svg';
  const op = o.p, np = n.p;
  if (op !== np) {
    for (const k in op) if (!(k in np)) setProp(el, k, op[k], undefined, svg);
    for (const k in np) {
      const b = np[k];
      if (op[k] === b || (k === 'style' && sameStyle(op[k], b))) continue;
      setProp(el, k, op[k], b, svg);
    }
  }
  if (np.html == null) patchKids(el, o.c, n.c, svg);
  return el;
}

function patchKids(el, oc, nc, svg) {
  let keyed = null;
  const loose = [];
  for (const c of oc) {
    if (c && c.k != null) (keyed || (keyed = new Map())).set(c.k, c);
    else loose.push(c);
  }
  let slot = 0;
  const nodes = [];
  for (const c of nc) {
    if (c === null) { slot++; continue; }
    let o;
    if (c.k != null) { o = keyed && keyed.get(c.k); if (o) keyed.delete(c.k); }
    else { o = loose[slot]; loose[slot] = null; slot++; }
    if (o && o.t === c.t && o.k === c.k) patch(o, c, svg);
    else {
      if (o) o.el.remove();
      create(c, svg);
      if (c.p && c.p.enter) { c.el.classList.add('enter'); c.el.addEventListener('animationend', dropEnter); }
    }
    nodes.push(c.el);
  }
  if (keyed) for (const o of keyed.values()) o.el.remove();
  for (const o of loose) if (o) o.el.remove();
  let ref = el.firstChild;
  for (const node of nodes) {
    if (node === ref) ref = ref.nextSibling;
    else el.insertBefore(node, ref);
  }
}

// ====================================================================== icons
// Lucide-style 24px stroke icons, drawn in currentColor by .ic in the CSS.

export const IC = {
  org: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  tree: '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  commit: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  gantt: '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  octagon: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circleX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  circlePause: '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>',
  circleDashed: '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  progress: '<circle cx="12" cy="12" r="10" pathLength="100" stroke-dasharray="78 22"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  // Background's kinds and Stop
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  square: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  laptop: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  squareTerminal: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  // Inspect's: a refusal, the model, memory, an MCP server, a hook, a compaction
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  hook: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  shrink: '<path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"/><path d="M9 19.8V15m0 0H4.2M9 15l-6 6"/><path d="M15 4.2V9m0 0h4.8M15 9l6-6"/><path d="M9 4.2V9m0 0H4.2M9 9 3 3"/>',
  // an agent's words between its calls, and its thinking as Claude Code shows it
  said: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  thought: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
};

export function icon(name, cls) {
  return h('svg', { class: cls ? `ic ${cls}` : 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true', html: IC[name] || IC.circle });
}

export const TOOL_ICON = { Read: 'eye', Edit: 'pencil', MultiEdit: 'pencil', NotebookEdit: 'pencil', Write: 'filePlus', Bash: 'terminal', PowerShell: 'terminal', Grep: 'search', Glob: 'folder', WebFetch: 'globe', WebSearch: 'globe', Agent: 'bot', Task: 'bot', SendMessage: 'message', TodoWrite: 'listChecks', TaskCreate: 'listChecks', TaskUpdate: 'listChecks', TaskGet: 'listChecks', TaskList: 'listChecks', ToolSearch: 'search', Skill: 'sparkles', AskUserQuestion: 'help' };
/** Tools whose words are a path or a command: drawn in the mono face. */
export const PATHY = new Set(['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Glob', 'Grep', 'Bash', 'PowerShell']);
