/* Agent Deck: the web page.
 *
 * What Claude Code is doing, who is working on what, and whether anything
 * needs you, live over SSE. It draws the mod's v2 view model (web/CONTRACT.md,
 * "v2: one view model for every surface"), the one the Desktop pane and the
 * terminal draw too, with the same names, order and keys: six routes (#/now,
 * the Dashboard; #/chat, the group chat; #/org, the org chart; #/changes;
 * #/inspect: the context, permissions, what is loaded and the spend;
 * #/settings: the avatar style and Help) and an agent drawer. No
 * dependencies and no build step.
 *
 * The page renders through a tiny keyed virtual DOM (h/patch below). Every
 * state update builds the view again and patches the live DOM in place, so
 * the route, an open drawer, the folds, scroll positions, the chart's pan and
 * zoom, the focus and a half-typed message all survive it. Elements keep
 * their identity by key (lists) or by position (fixed structure).
 *
 * Its one import is the deck's avatar library (avatars.mjs), which the mod
 * draws the pane's avatars from too.
 */
import * as AV from './avatars.mjs';

// ===================================================================== basics

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const AUTH = TOKEN ? { 'X-Deck-Token': TOKEN } : {};
const QT = TOKEN ? `?t=${encodeURIComponent(TOKEN)}` : '';

/** The latest v2 state, and the indexes built from it. */
let S = null;
let IX = null;
/** This session's own latest state: `S` too, unless another session's deck shows (#/s/<id>/…, "All sessions" below). */
let HOME = null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const total = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0);
const clock = () => Math.max(Date.now(), S ? S.now || 0 : 0);
/** The time ages run to: now while the session is live, its last state's time once it ended (nothing grows after that). */
const liveNow = () => (conn.status === 'ended' && S && S.now ? S.now : clock());

/** How long ago, in the mod's words (hooks/format.ts `since`): "now", "3m", "2h", "4d". */
function since(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** A duration in the mod's words (hooks/format.ts `dur`): "42s", "4m", "1h 05m". */
function dur(ms) {
  if (ms < 1000) return '<1s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * An age, worded as the mod words a need's `age`. The state is written only
 * when something in it changed, so the page runs the same words on its own
 * clock: they read as the state's at the moment it was built, and stay true.
 */
const ageOf = at => (at ? since(liveNow() - at) : '');
const agoText = at => { const a = ageOf(at); return a === 'now' ? 'just now' : a ? `${a} ago` : ''; };

/** 842, 4.2k, 48k, 1.2M. */
function num(n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e5) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}
const usd = x => (x == null ? '—' : `$${x.toFixed(2)}`);
function msText(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return dur(ms);
}
function splitPath(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? ['', p] : [p.slice(0, i + 1), p.slice(i + 1)];
}
/** A path outside the repository as its last two parts, "…/Temp/bench.js"; one of two parts or fewer as it is. */
function shortPath(p) {
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : String(p);
}
const oneLine = text => String(text || '').replace(/\s+/g, ' ').trim();
/** The first line that says something, a Markdown list or heading mark left off. */
function firstLine(text, max = 180) {
  const line = String(text || '').split('\n').find(l => l.trim()) || '';
  const bare = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '').trim();
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(`agent-deck:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`agent-deck:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
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
const statusOf = st => STATUS[st] || STATUS.idle;
/** A row's status as it shows: a stopped agent's says failed, but it shows as stopped. */
const stateOf = a => (a.isStopped ? 'stopped' : a.status);
const isLive = st => st === 'running' || st === 'starting' || st === 'waiting';
const isRunning = st => st === 'running' || st === 'starting';

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
const NOPROPS = {};

function h(t, p, ...kids) {
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

function create(v, svg) {
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

function patch(o, n, svg) {
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

const IC = {
  org: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  tree: '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  commit: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
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

function icon(name, cls) {
  return h('svg', { class: cls ? `ic ${cls}` : 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true', html: IC[name] || IC.circle });
}

const TOOL_ICON = { Read: 'eye', Edit: 'pencil', MultiEdit: 'pencil', NotebookEdit: 'pencil', Write: 'filePlus', Bash: 'terminal', PowerShell: 'terminal', Grep: 'search', Glob: 'folder', WebFetch: 'globe', WebSearch: 'globe', Agent: 'bot', Task: 'bot', SendMessage: 'message', TodoWrite: 'listChecks', TaskCreate: 'listChecks', TaskUpdate: 'listChecks', TaskGet: 'listChecks', TaskList: 'listChecks', ToolSearch: 'search', Skill: 'sparkles', AskUserQuestion: 'help' };
/** Tools whose words are a path or a command: drawn in the mono face. */
const PATHY = new Set(['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Glob', 'Grep', 'Bash', 'PowerShell']);

// ==================================================================== avatars
// The deck's avatar library (avatars.mjs; the mod draws the pane's from it
// too): each agent's face in the style the deck is set to (S.avatarStyle), as
// an image of its own SVG document, so its ids and its motion stay inside it.

/** The avatars stay still: the reader asked for less motion, or the session ended (a still picture). */
const isStill = () => conn.status === 'ended' || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** An agent's row as the library takes one: seeded by its id, the Orchestrator `main`, a stopped one stopped, its own list's progress. */
const faceOf = a => ({ id: a.id, name: a.title, role: a.kind === 'orchestrator' ? 'main' : '', status: stateOf(a), progress: AV.progressOf(a.todos) });

const avatarUrls = new Map();
/** An SVG document as an image's address (the newest 600 kept): the same face, the same string, so its image never loads again. */
function urlOf(svg) {
  let url = avatarUrls.get(svg);
  if (url === undefined) {
    url = AV.dataUrl(svg);
    if (avatarUrls.size >= 600) avatarUrls.delete(avatarUrls.keys().next().value);
    avatarUrls.set(svg, url);
  }
  return url;
}

const px = size => ({ width: `${size}px`, height: `${size}px` });
/**
 * An agent's avatar, `size` px square, in the deck's style: with `dot` its
 * status dot, with `live` its status's motion (still while `isStill`). A grey
 * ghost for one the state does not hold.
 */
function Avatar(a, size = 24, opts = NOPROPS) {
  if (!a) return h('span', { class: 'av-ghost', style: px(size) });
  const svg = AV.avatarSvg(opts.style || styleNow(), faceOf(a), { size, dot: opts.dot === true, animated: opts.live === true && !isStill() });
  return h('img', { class: 'av', width: size, height: size, alt: '', draggable: 'false', src: urlOf(svg) });
}

/** The style the avatars are drawn in: one picked here until the state names it (10 s at most), else the state's (the person's setting). */
function styleNow() {
  const picked = ui.picked;
  if (picked && S && S.avatarStyle !== picked.style && Date.now() < picked.until) return picked.style;
  return S ? S.avatarStyle : AV.DEFAULT_STYLE;
}

/** Draws the agents in another style: the mod keeps it as the person's own (the Desktop pane and every session follow), and its next state says so; drawn here at once. */
async function pickStyle(style) {
  if (!AV.isStyle(style) || style === styleNow()) return;
  ui.picked = { style, until: Date.now() + 10000 };
  setTimeout(invalidate, 10100);
  renderNow();
  try {
    await command({ cmd: 'avatarStyle', id: newCmdId('av'), style });
  } catch (err) {
    ui.picked = null;
    toast(err.message);
  }
}
function YouAvatar(size = 24) {
  return h('span', { class: 'av-you', style: { ...px(size), 'font-size': `${Math.max(8, Math.round(size * 0.38))}px` } }, 'YO');
}
/** Claude Code itself, for its own words (a notification, a task's end). */
function EngineAvatar(size = 24) {
  return h('span', { class: 'av-engine', style: px(size) }, icon('terminal'));
}
const whoAvatar = (id, size) => (id === 'you' ? YouAvatar(size) : id === 'engine' ? EngineAvatar(size) : Avatar(IX && IX.byId.get(id), size));

/** An avatar with its status dot, moving as its status does. */
function AvatarDot(a, size = 24) {
  return h('span', { class: 'avd', style: px(size) }, Avatar(a, size, { dot: true, live: true }));
}

function AvatarStack(ids, size = 18, max = 4) {
  const shown = ids.slice(0, max);
  return h('span', { class: 'stack', title: ids.map(nameOf).join(', ') },
    shown.map(id => h('span', { key: id, class: 'stack-item' }, whoAvatar(id, size))),
    ids.length > max && h('span', { class: 'stack-more' }, `+${ids.length - max}`));
}

/** What a row of the state calls `id`: you, Claude Code, an agent's title, or the name a message used for one no agent carries. */
const nameOf = id => (id === 'you' ? 'You' : id === 'engine' ? 'Claude Code' : IX && IX.byId.has(id) ? IX.byId.get(id).title : String(id || ''));

// ============================================================== state + index
// The state as the page reads it: v2 (web/CONTRACT.md), every list a list and
// every field its type, so a field an older or newer mod leaves out never
// breaks a view.

const arr = v => (Array.isArray(v) ? v : []);
const str = v => (typeof v === 'string' ? v : '');
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const numOr = (v, d = null) => (typeof v === 'number' && isFinite(v) ? v : d);

const STATE_TEXT = { working: 'Working', waiting: 'Waiting on you', idle: 'Idle' };
const ROW_STATUS = new Set(['starting', 'running', 'waiting', 'done', 'failed', 'idle']);
const ITEM_STATUS = new Set(['done', 'active', 'pending']);
const ROW_KIND = new Set(['orchestrator', 'agent', 'teammate', 'workflow', 'engine']);

const todosOf = list => arr(list).filter(t => t && typeof t.text === 'string').map(t => ({ text: t.text, status: ITEM_STATUS.has(t.status) ? t.status : 'pending', doing: str(t.doing) }));

function questionsOf(list) {
  return arr(list).filter(q => q && typeof q.question === 'string').map(q => ({
    question: q.question,
    header: str(q.header),
    multiSelect: q.multiSelect === true,
    options: arr(q.options).filter(o => o && typeof o.label === 'string' && o.label.trim()).map(o => ({ label: o.label, description: str(o.description) })),
  }));
}

/** A need as the page reads it: an answer offered only for a question the mod says it can take one for. */
function needOf(n) {
  const kind = ['question', 'permission', 'notification'].includes(n.kind) ? n.kind : 'notification';
  const questions = questionsOf(n.questions);
  return {
    id: n.id, kind, agent: str(n.agent) || 'main', agentName: str(n.agentName), at: numOr(n.at, 0), age: str(n.age), text: str(n.text),
    questions, isAnswerable: n.isAnswerable === true && kind === 'question' && questions.length > 0,
    tool: str(n.tool), command: str(n.command), path: str(n.path), description: str(n.description), type: str(n.type), title: str(n.title),
    // its type in words ("Permission prompt", "MCP input"); an earlier build's state has none: its type as sent
    typeText: str(n.typeText) || str(n.type),
  };
}

function rowOf(r) {
  if (r.row === 'fold') {
    return { row: 'fold', id: r.id, parent: str(r.parent), depth: numOr(r.depth, 1), ids: arr(r.ids).filter(x => typeof x === 'string'), done: numOr(r.done, 0), failed: numOr(r.failed, 0), stopped: numOr(r.stopped, 0), idle: numOr(r.idle, 0), text: str(r.text) };
  }
  const live = obj(r.live);
  return {
    row: 'agent', id: r.id, fileId: str(r.fileId) || r.id.replace(/[^A-Za-z0-9_-]/g, '_'),
    parent: typeof r.parent === 'string' && r.parent ? r.parent : null, depth: numOr(r.depth, 0),
    kind: ROW_KIND.has(r.kind) ? r.kind : 'agent', status: ROW_STATUS.has(r.status) ? r.status : 'idle', isStopped: r.isStopped === true,
    name: str(r.name), description: str(r.description), type: str(r.type), shortId: str(r.shortId),
    title: str(r.title) || str(r.name) || str(r.description) || str(r.type) || str(r.shortId) || r.id,
    live: live && typeof live.tool === 'string' ? { tool: live.tool, text: str(live.text), at: numOr(live.at, 0) } : null,
    said: saidOf(r.said),
    startedAt: numOr(r.startedAt, 0), endedAt: numOr(r.endedAt, null), resumedAt: numOr(r.resumedAt, null), elapsed: str(r.elapsed),
    background: r.background === true, model: str(r.model), avatar: numOr(r.avatar, 0), needs: numOr(r.needs, 0),
    fold: typeof r.fold === 'string' && r.fold ? r.fold : null,
    task: str(r.task), isTaskCut: r.isTaskCut === true, result: str(r.result), isResultCut: r.isResultCut === true,
    todos: todosOf(r.todos), tokens: numOr(r.tokens, 0),
    isCleared: r.isCleared === true,
    stop: stopOf(r.stop),
  };
}

/** An agent's words since its latest call while it is at work, as the state says them; null for none. */
function saidOf(x) {
  const s = obj(x);
  return s && typeof s.text === 'string' && s.text.trim() ? { text: s.text, at: numOr(s.at, 0), isCut: s.isCut === true } : null;
}

/** A Stop or Cancel as the state says it: the call it makes (TaskStop, CronDelete), its label, whether Claude Code's own check allows it here (`can`), and why not; null for none. */
function stopOf(x) {
  x = obj(x);
  if (!x || typeof x.can !== 'boolean') return null;
  return { tool: str(x.tool), label: str(x.label) || 'Stop', can: x.can, why: str(x.why) };
}

const BG_KINDS = new Set(['shell', 'monitor', 'workflow', 'agent', 'other', 'cron', 'wakeup']);

/** What runs in the background and what is scheduled (v2's `background`): its rows, counts and line; none from a mod that writes none. */
function backgroundOf(b) {
  b = obj(b) || {};
  const rows = arr(b.rows).filter(x => x && typeof x.id === 'string' && x.id).map(x => ({
    id: x.id, kind: BG_KINDS.has(x.kind) ? x.kind : 'other', what: str(x.what), title: str(x.title) || x.id, status: str(x.status) || 'running',
    by: typeof x.by === 'string' && x.by ? x.by : null, byName: str(x.byName), at: numOr(x.at, 0), nextAt: numOr(x.nextAt, null),
    schedule: str(x.schedule), recurring: x.recurring === true, when: str(x.when), stop: stopOf(x.stop),
  }));
  const scheduled = rows.filter(x => x.status === 'scheduled').length;
  return { rows, tasks: numOr(b.tasks, rows.length - scheduled), scheduled: numOr(b.scheduled, scheduled), text: str(b.text) };
}

/** Whether an agent is finished: done, failed, stopped or idle, nothing of its waiting on you; never the Orchestrator (the mod's W.isFinishedRow). The Dashboard and Chat's members fold these behind one "N finished" row. */
const isFinished = a => a.kind !== 'orchestrator' && !a.needs && (a.status === 'done' || a.status === 'failed' || a.status === 'idle');

function planOf(p) {
  p = obj(p);
  if (!p) return null;
  const board = arr(p.board).filter(t => t && typeof t.subject === 'string').map(t => ({ id: String(t.id == null ? '' : t.id), subject: t.subject, status: ITEM_STATUS.has(t.status) ? t.status : 'pending', owner: typeof t.owner === 'string' && t.owner ? t.owner : null, doing: str(t.doing) }));
  const todos = obj(p.todos) ? { items: todosOf(p.todos.items), at: numOr(p.todos.at, 0) } : null;
  const approved = obj(p.approved) && typeof p.approved.markdown === 'string' ? { markdown: p.approved.markdown, at: numOr(p.approved.at, 0), by: str(p.approved.by) || 'main' } : null;
  const workflows = arr(p.workflows).filter(w => w && typeof w.name === 'string').map(w => ({ id: String(w.id == null ? w.name : w.id), name: w.name, phases: arr(w.phases).filter(x => typeof x === 'string'), startedAt: numOr(w.startedAt, 0), endedAt: numOr(w.endedAt, null) }));
  return { board, todos: todos && todos.items.length ? todos : null, approved, workflows };
}

const chatOf = m => ({ ...m, at: numOr(m.at, 0), from: str(m.from), to: typeof m.to === 'string' && m.to ? m.to : null, who: str(m.who), kind: str(m.kind) || 'chat', title: str(m.title), text: str(m.text), isCut: m.isCut === true, isCleared: m.isCleared === true, compaction: obj(m.compaction) ? { title: str(m.compaction.title), figures: str(m.compaction.figures) } : null });

function changesOf(c) {
  c = obj(c) || {};
  const repo = obj(c.repo);
  return {
    repo: repo ? { name: str(repo.name), root: str(repo.root), branch: str(repo.branch), ahead: numOr(repo.ahead, 0), behind: numOr(repo.behind, 0), head: str(repo.head) } : null,
    files: arr(c.files).filter(f => f && typeof f.path === 'string').map(f => ({ path: f.path, code: str(f.code), added: numOr(f.added, 0), removed: numOr(f.removed, 0), edits: arr(f.edits).filter(x => typeof x === 'string'), diffId: typeof f.diffId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(f.diffId) ? f.diffId : null })),
    edits: arr(c.edits).filter(e => e && typeof e.id === 'string' && typeof e.path === 'string').map(e => ({ id: e.id, agent: str(e.agent), tool: str(e.tool), path: e.path, at: numOr(e.at, 0), added: numOr(e.added, 0), removed: numOr(e.removed, 0), isOutside: e.isOutside === true })),
    commits: arr(c.commits).filter(x => x && typeof x.hash === 'string').map(x => ({ ...x, short: str(x.short) || x.hash.slice(0, 7), subject: str(x.subject), author: str(x.author), at: numOr(x.at, 0), added: numOr(x.added, 0), removed: numOr(x.removed, 0), files: numOr(x.files, 0), agent: typeof x.agent === 'string' && x.agent ? x.agent : null })),
  };
}

/** The newest tool calls of every agent, and what each said between them (`kind` 'said'), newest first. */
function activityOf(list) {
  return arr(list).filter(x => x && typeof x.tool === 'string' && typeof x.agent === 'string' && x.agent && (x.kind !== 'said' || typeof x.text === 'string')).map(x => ({
    id: str(x.id) || `${numOr(x.at, 0)}|${x.agent}|${x.tool}|${str(x.text)}`, at: numOr(x.at, 0), agent: x.agent, agentName: str(x.agentName),
    kind: x.kind === 'said' ? 'said' : 'call',
    tool: x.tool, text: str(x.text), ok: typeof x.ok === 'boolean' ? x.ok : null, ms: numOr(x.ms),
    refused: x.refused === 'denied' || x.refused === 'blocked' ? x.refused : null,
  })).sort((x, y) => y.at - x.at);
}

/** The files the agents edited, in the state's order (the repository's first, each list the one edited last first). */
function filesOf(list) {
  return arr(list).filter(f => f && typeof f.path === 'string' && f.path).map(f => ({
    path: f.path, editors: arr(f.editors).filter(x => typeof x === 'string' && x), added: numOr(f.added, 0), removed: numOr(f.removed, 0), lastAt: numOr(f.lastAt, 0), isOutside: f.isOutside === true,
  }));
}

/** The session's figures as the state counts them; null from a mod that writes none. */
function figuresOf(f) {
  f = obj(f);
  if (!f) return null;
  const n = k => numOr(f[k], 0);
  const plan = obj(f.plan);
  return {
    running: n('running'), waiting: n('waiting'), done: n('done'), failed: n('failed'), stopped: n('stopped'),
    plan: plan ? { done: numOr(plan.done, 0), total: numOr(plan.total, 0) } : null,
    costUsd: numOr(f.costUsd), tokens: numOr(f.tokens), contextPercent: numOr(f.contextPercent), minutes: numOr(f.minutes), needs: n('needs'),
  };
}

function inspectOf(i) {
  i = obj(i) || {};
  const tok = t => { t = obj(t) || {}; return { in: numOr(t.in, 0), out: numOr(t.out, 0), cacheRead: numOr(t.cacheRead, 0) }; };
  return {
    contextPercent: numOr(i.contextPercent), costUsd: numOr(i.costUsd),
    agents: arr(i.agents).filter(a => a && typeof a.id === 'string').map(a => ({ id: a.id, title: str(a.title) || a.id, model: str(a.model), tokens: tok(a.tokens), requests: numOr(a.requests, 0), tools: numOr(a.tools, 0), errors: numOr(a.errors, 0) })),
    ...inspectMoreOf(i),
  };
}

const OUTCOMES = new Set(['allowed', 'denied', 'blocked', 'waiting', 'deciding']);
const HUE_RE = /^#[0-9a-f]{3,8}$/i;
const nums = (v, d = null) => numOr(v, d);
const fileOf = f => ({ path: str(f.path), name: str(f.name) || str(f.path), kindText: str(f.kindText), lines: nums(f.lines), tokens: nums(f.tokens), how: str(f.how) });

/** Inspect's part beyond the spend (hooks/inspect.ts): the mode, each section's one line, the context, the compactions, the decisions and what is loaded; empty from a mod that writes none. */
function inspectMoreOf(i) {
  const sum = obj(i.summary) || {};
  const c = obj(i.context);
  const p = obj(i.permissions) || {};
  const l = obj(i.loaded);
  const sk = l ? obj(l.skills) || {} : {};
  return {
    mode: str(i.mode), modeText: str(i.modeText),
    summary: { context: str(sum.context), permissions: str(sum.permissions), loaded: str(sum.loaded), spend: str(sum.spend) },
    context: c && typeof c.text === 'string' ? {
      text: c.text, total: nums(c.total, 0), max: nums(c.max, 0), percent: nums(c.percent, 0), autoCompactPercent: nums(c.autoCompactPercent), model: str(c.model), at: nums(c.at, 0),
      rows: arr(c.rows).filter(r => r && typeof r.name === 'string').map(r => ({ name: r.name, tokens: nums(r.tokens, 0), kind: ['used', 'free', 'buffer', 'deferred'].includes(r.kind) ? r.kind : 'used', hue: HUE_RE.test(str(r.hue)) ? r.hue : '#8a8a8a' })),
    } : null,
    compactions: arr(i.compactions).filter(x => x && typeof x.agent === 'string').map(x => ({ id: str(x.id), at: nums(x.at, 0), agent: x.agent, agentName: str(x.agentName), trigger: str(x.trigger), figures: str(x.figures), text: str(x.text), summary: str(x.summary), skipped: typeof x.skipped === 'string' ? x.skipped : null })),
    permissions: {
      decisions: arr(p.decisions).filter(d => d && typeof d.id === 'string' && typeof d.tool === 'string').map(d => ({ id: d.id, at: nums(d.at, 0), agent: str(d.agent) || 'main', agentName: str(d.agentName), tool: d.tool, target: str(d.target), outcome: OUTCOMES.has(d.outcome) ? d.outcome : 'allowed', by: str(d.by), text: str(d.text), why: str(d.why) })),
      total: nums(p.total, 0), denied: nums(p.denied, 0), blocked: nums(p.blocked, 0), waiting: nums(p.waiting, 0),
    },
    loaded: l ? {
      model: str(l.model), modelId: str(l.modelId), effort: str(l.effort), outputStyle: str(l.outputStyle), mode: str(l.mode),
      instructions: arr(l.instructions).filter(obj).map(fileOf), memory: arr(l.memory).filter(obj).map(fileOf),
      skills: { total: nums(sk.total), names: arr(sk.names).filter(x => typeof x === 'string'), used: arr(sk.used).filter(u => u && typeof u.name === 'string').map(u => ({ name: u.name, count: nums(u.count, 1) })) },
      mcp: arr(l.mcp).filter(s => s && typeof s.server === 'string').map(s => ({ server: s.server, tools: nums(s.tools, 0), deferred: nums(s.deferred, 0), calls: nums(s.calls, 0) })),
      hooks: arr(l.hooks).filter(k => k && typeof k.event === 'string').map(k => ({ event: k.event, matcher: str(k.matcher), command: str(k.command), sourceText: str(k.sourceText) || str(k.source) })),
      hookEvents: arr(l.hookEvents).filter(e => e && typeof e.event === 'string').map(e => ({ event: e.event, decided: nums(e.decided, 0), blocked: nums(e.blocked, 0) })),
    } : null,
  };
}

function normalize(s) {
  const hd = obj(s.header) || {};
  const state = STATE_TEXT[hd.state] ? hd.state : 'idle';
  const goal = obj(hd.goal);
  const session = obj(s.session);
  return {
    v: 2, now: numOr(s.now, 0), empty: false,
    session: { id: session ? str(session.id) : '', cwd: session ? str(session.cwd) : '', startedAt: session ? numOr(session.startedAt, 0) : 0 },
    header: {
      state, stateText: str(hd.stateText) || STATE_TEXT[state],
      goal: goal && typeof goal.text === 'string' ? { text: goal.text, headline: str(goal.headline) || firstLine(goal.text, 80), at: numOr(goal.at, 0), isCut: goal.isCut === true, messageId: str(goal.messageId) } : null,
      model: str(hd.model), contextPercent: numOr(hd.contextPercent), costUsd: numOr(hd.costUsd), line: str(hd.line), mode: str(hd.mode),
      turn: obj(hd.turn) && typeof hd.turn.id === 'string' ? { id: hd.turn.id, at: numOr(hd.turn.at) } : null,
    },
    needs: arr(s.needs).filter(n => n && typeof n.id === 'string' && n.id).map(needOf),
    agents: arr(s.agents).filter(r => r && typeof r.id === 'string' && r.id && (r.row === 'agent' || r.row === 'fold')).map(rowOf),
    background: backgroundOf(s.background),
    plan: planOf(s.plan),
    chat: arr(s.chat).filter(m => m && typeof m.id === 'string' && m.id).map(chatOf),
    changes: changesOf(s.changes),
    activity: activityOf(s.activity),
    files: filesOf(s.files),
    figures: figuresOf(s.figures),
    inspect: inspectOf(s.inspect),
    acks: arr(s.acks).filter(k => k && typeof k.id === 'string' && k.id),
    avatarStyle: AV.styleOf(s.avatarStyle),
    // what the deck's Clear finished hid (its rows `isCleared`): how many, and when
    cleared: { count: numOr((obj(s.cleared) || {}).count, 0), at: numOr((obj(s.cleared) || {}).at, null) },
    // every session on this machine (All sessions, below); null from a mod that lists none
    sessions: sessionsOf(s.sessions),
  };
}

/** Nothing to draw yet: the server's empty state before the mod wrote one ('empty'), or a state with no v2 in it, an older mod's ('old'). */
function emptyState(why) {
  const s = normalize({});
  s.empty = why;
  return s;
}

function group(list, f) {
  const m = new Map();
  for (const x of list) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); }
  return m;
}

function buildIndex(s) {
  const rows = s.agents.filter(r => r.row === 'agent');
  const byId = new Map(rows.map(r => [r.id, r]));
  // the agents the Dashboard, Chat's members and Org draw: those Clear finished hid left out (their drawers, Changes and Settings keep them)
  const shown = rows.filter(r => !r.isCleared);
  // who started whom, for the chart: each parent's agents in the order they started
  const kids = new Map(), roots = [];
  for (const r of shown) {
    const p = r.parent && r.parent !== r.id && byId.has(r.parent) ? r.parent : null;
    if (p) (kids.get(p) || kids.set(p, []).get(p)).push(r);
    else roots.push(r);
  }
  for (const list of kids.values()) list.sort((x, y) => x.startedAt - y.startedAt);
  const tree = [], seen = new Set();
  const walk = r => { if (seen.has(r.id)) return; seen.add(r.id); tree.push(r); for (const k of kids.get(r.id) || []) walk(k); };
  roots.forEach(walk);
  const choiceByCall = new Map();
  for (const m of s.chat) if (m.kind === 'choice' && m.callId) choiceByCall.set(m.callId, m);
  return {
    rows, shown, byId, kids, roots, tree,
    needById: new Map(s.needs.map(n => [n.id, n])),
    needsBy: group(s.needs, n => n.agent),
    editById: new Map(s.changes.edits.map(e => [e.id, e])),
    editsBy: group(s.changes.edits, e => e.agent),
    editsByPath: group(s.changes.edits, e => e.path),
    gitPaths: new Set(s.changes.files.map(f => f.path)),
    // a later word on the same id replaces the earlier one: the last wins
    acks: new Map(s.acks.map(k => [k.id, k])),
    chatByAck: new Map(s.chat.filter(m => m.ackId).map(m => [m.ackId, m])),
    choiceByCall,
    byName: group(rows.filter(r => r.name), r => r.name.toLowerCase()),
  };
}

/** The v2 state a write holds: live it sits under v1's `v2` key; the sample is v2 bare. */
function v2Of(next) {
  if (next.v === 2) return next;
  const v2 = obj(next.v2);
  return v2 && v2.v === 2 ? v2 : null;
}

function apply(next) {
  if (!next || typeof next !== 'object') return;
  const v2 = v2Of(next);
  if (!v2) {
    if (HOME && !HOME.empty) return; // never trade a real state for nothing
    HOME = emptyState(next.empty === true ? 'empty' : 'old');
  } else {
    // An older write of the same session (a slow fetch racing the stream) never replaces a newer one.
    const sid = obj(v2.session) ? v2.session.id : '';
    if (HOME && !HOME.empty && HOME.session.id && sid === HOME.session.id && numOr(v2.now, 0) < HOME.now) return;
    HOME = normalize(v2);
  }
  // another session's deck shows: this one's state waits behind it (its list of sessions and its acks are still read)
  if (route.session) {
    if (S) indexViewed();
    invalidate();
    return;
  }
  S = HOME;
  IX = buildIndex(S);
  noteResolved();
  noteStops();
  // a style picked here holds until the state names it: from then on the state's (the person's setting) is drawn
  if (ui.picked && S.avatarStyle === ui.picked.style) ui.picked = null;
  invalidate();
}

// ================================================================= connection
// Fetch /state once, then follow /events. On a drop, retry with backoff; after
// a few failed tries in a row the server is gone, which means the session ended.

const conn = { status: 'loading', fails: 0, timer: 0, es: null, retryAt: 0, endedAt: 0 };

function setConn(status) {
  if (conn.status === status) return;
  conn.status = status;
  if (status === 'ended' && !conn.endedAt) conn.endedAt = Date.now();
  if (status === 'live') conn.endedAt = 0;
  invalidate();
}

async function connect() {
  clearTimeout(conn.timer);
  conn.retryAt = 0;
  let res;
  try {
    res = await fetch(`/state${QT}`, { headers: AUTH, cache: 'no-store' });
  } catch {
    return retry();
  }
  if (res.status === 403) { setConn('denied'); return; }
  if (!res.ok) return retry();
  try { apply(JSON.parse(await res.text())); } catch { /* a torn write: the stream sends the next one */ }
  follow();
}

function follow() {
  if (conn.es) conn.es.close();
  const es = (conn.es = new EventSource(`/events${QT}`));
  es.addEventListener('state', e => {
    try { apply(JSON.parse(e.data)); } catch { return; }
    conn.fails = 0;
    setConn('live');
  });
  es.onopen = () => { conn.fails = 0; setConn('live'); };
  es.onerror = () => {
    if (conn.es !== es) return;
    es.close();
    conn.es = null;
    retry();
  };
}

function retry() {
  conn.fails++;
  setConn(conn.fails >= 4 && S ? 'ended' : 'reconnecting');
  const wait = conn.status === 'ended' ? 15000 : Math.min(1000 * 2 ** (conn.fails - 1), 8000);
  conn.retryAt = Date.now() + wait;
  clearTimeout(conn.timer);
  conn.timer = setTimeout(connect, wait);
}

function retryNow() {
  conn.fails = Math.min(conn.fails, 3);
  connect();
}

async function command(body) {
  // another session's deck: an answer or a message goes to its own deck, which acts on it as on its own page's; nothing else goes from here
  if (route.session && body.cmd !== 'view') {
    const row = sessionRow(route.session);
    if (body.cmd !== 'chat' && body.cmd !== 'answer') throw new Error('Read-only here: this is another session\'s deck. Do that in its window.');
    if (!row || !row.canSteer) throw new Error('Answer it in its window: its deck takes no answers or messages from another.');
    body = { ...body, session: route.session };
  }
  let res;
  try {
    res = await fetch('/cmd', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('The deck server is not answering.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || (data && data.ok === false)) {
    const code = data && (data.error || data.message);
    const plain = {
      forbidden: 'The deck refused it: this page\'s link is stale. Reload the page.',
      'too large': 'That is too long to send.',
      'bad command': 'The deck could not read that message.',
    }[code];
    throw new Error(plain || (code ? code[0].toUpperCase() + code.slice(1) : `The server answered ${res.status}.`));
  }
  return data;
}

// ======================================================================= acks
// Each command carries an id of the page's own; the mod writes what came of
// it to the state's `acks` under that id. A send shows "Sending…" until then.

let cmdSeq = 0;
/** A fresh command id: [A-Za-z0-9_-], under 40 characters. */
const newCmdId = kind => `${kind}-${Date.now().toString(36)}-${(++cmdSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** How long a send waits for its ack before saying none came. */
const ACK_WAIT = 20000;
/** How long a question you answered here stays on show, collapsed, once it left the state. */
const KEEP = 20000;

/** "It reads it…" reads "it reads it…" after a colon; a name ("Claude reads it…") keeps its capital. */
const softText = t => String(t || '').trim().replace(/^(It|Its|The|This|That|They|There|A|An|No|Not|Nothing|Only|Too|Could|Already)\b/, w => w.toLowerCase());
/** `word: text`, unless the text starts with that word already ("Not delivered: it has ended"). */
const lead = (word, text) => (text.toLowerCase().startsWith(word.toLowerCase()) ? text[0].toUpperCase() + text.slice(1) : `${word}: ${text}`);

/**
 * What an ack says, as a status line: its tone (a status hue), an icon and
 * the words. `what` is the command's kind: a refused answer reads "Not
 * answered", a refused message "Not delivered".
 */
function ackState(ack, what = 'chat') {
  const text = softText(ack.text);
  if (!ack.ok || ack.status === 'failed') {
    // an answer that came too late: the question was answered all the same ("Already answered in Claude Code")
    if (what === 'answer' && /answered/i.test(text)) return { tone: 'idle', icon: 'check', text: text[0].toUpperCase() + text.slice(1) };
    // a command this build only acknowledges ("Not in this build yet: …") says so as it is
    if (/^not\b/i.test(text)) return { tone: 'fail', icon: 'x', text: text[0].toUpperCase() + text.slice(1) };
    return { tone: 'fail', icon: 'x', text: lead(what === 'answer' ? 'Not answered' : 'Not delivered', text || 'Claude Code refused it') };
  }
  if (ack.status === 'answered') return { tone: 'done', icon: 'check', text: lead('Answered', text || 'Claude carries on') };
  // a review put in the prompt box: "In your prompt box: press Enter to send it"
  if (ack.status === 'delivered' && what === 'review') return { tone: 'done', icon: 'check', text: ack.text || 'In your prompt box' };
  if (ack.status === 'delivered') return { tone: 'done', icon: 'check', text: lead('Delivered', text || 'it reads it at its next step') };
  return { tone: 'wait', icon: 'clock', text: lead('Queued', text || (what === 'review' ? 'it runs when Claude is free' : 'Claude reads it when it finishes its current turn')) };
}

/** A send's status line, from its ack, its own error, or the time it has waited. */
function sendState(sent, what) {
  const ack = IX && IX.acks.get(sent.id);
  if (ack) return { ...ackState(ack, what), ack };
  if (sent.state === 'error') return { tone: 'fail', icon: 'x', text: sent.error || 'Could not send it.' };
  if (Date.now() - sent.at < ACK_WAIT) return { tone: 'run', glyph: 'active', text: what === 'answer' ? 'Sending your answer…' : 'Sending…', busy: true };
  return { tone: 'idle', icon: 'clock', text: 'Sent, but Claude Code hasn\'t confirmed it', late: true };
}

function StatusNote(st, cls) {
  return h('span', { class: `status-note is-${st.tone}${cls ? ` ${cls}` : ''}`, role: 'status' },
    st.glyph ? Glyph(st.glyph, 13) : h('span', { class: `status-ic hue-${st.tone}` }, icon(st.icon)),
    h('span', { class: 'status-text' }, st.text));
}

// ================================================================ lazy files
// A cut message's whole text (/message/<id>), an edit's patch (/patch/<id>),
// git's own diff of a file (/gitdiff/<diffId>) and an agent's page file
// (/agent/<fileId>), each fetched the first time a view shows it and kept. A
// git diff that changes comes under another id. An agent's file is written
// again as it works, so it is fetched again when its row changes.

const fullTexts = new Map();

function fullTextOf(id) {
  let t = fullTexts.get(id);
  if (t) return t;
  t = { status: 'loading', text: '', error: '' };
  fullTexts.set(id, t);
  fetch(`${baseUrl()}/message/${encodeURIComponent(id)}${QT}`, { headers: AUTH })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'The rest is not on disk yet.' : `The server answered ${r.status}.`))))
    .then(text => { t.status = 'ok'; t.text = text; })
    .catch(e => { t.status = 'error'; t.error = e.message || 'Could not load the rest.'; })
    // the chat keeps its place: the reader goes on from where the cut was
    .finally(() => { ui.holdChat = true; invalidate(); });
  return t;
}

/** Patches (`patch`) and git's diffs (`gitdiff`), by `<kind>:<id>`. */
const diffs = new Map();
const DIFF_WORD = { patch: 'The patch', gitdiff: 'Git\'s diff' };

function diffOf(kind, id) {
  const key = `${kind}:${id}`;
  let p = diffs.get(key);
  if (p) return p;
  p = { status: 'loading', hunks: null, error: '' };
  diffs.set(key, p);
  fetch(`${baseUrl()}/${kind}/${encodeURIComponent(id)}${QT}`, { headers: AUTH })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? `${DIFF_WORD[kind]} is not on disk yet.` : `The server answered ${r.status}.`))))
    .then(text => { p.status = 'ok'; p.hunks = parsePatch(text); })
    .catch(e => { p.status = 'error'; p.error = e.message || `Could not load ${DIFF_WORD[kind].toLowerCase()}.`; })
    .finally(invalidate);
  return p;
}

/** Unified hunks into numbered lines. Each hunk takes exactly the lines its header counts, so file headers between hunks never read as changes. */
function parsePatch(text) {
  const hunks = [];
  let cur = null, a = 0, b = 0, oldLeft = 0, newLeft = 0;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      a = Number(m[1]); b = Number(m[3]);
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      cur = { head: line, lines: [] };
      hunks.push(cur);
      continue;
    }
    if (line[0] === '\\' && hunks.length) { hunks[hunks.length - 1].lines.push({ t: 'meta', a: '', b: '', s: line.slice(2) }); continue; }
    if (!cur) continue;
    const c = line[0];
    if (c === '+' && newLeft > 0) { cur.lines.push({ t: 'add', a: '', b: b++, s: line.slice(1) }); newLeft--; }
    else if (c === '-' && oldLeft > 0) { cur.lines.push({ t: 'del', a: a++, b: '', s: line.slice(1) }); oldLeft--; }
    else if ((c === ' ' || line === '') && oldLeft > 0 && newLeft > 0) { cur.lines.push({ t: 'ctx', a: a++, b: b++, s: line.slice(1) }); oldLeft--; newLeft--; }
    else cur = null;
    if (cur && oldLeft <= 0 && newLeft <= 0) cur = null;
  }
  return hunks.filter(hk => hk.lines.length);
}

const agentFiles = new Map();

/** What an agent's file is fetched against: when its row changes, the mod wrote the file again. */
const rowSig = a => [a.status, a.isStopped, a.live ? `${a.live.tool}@${a.live.at}` : '', a.said ? a.said.at : '', a.endedAt || '', a.tokens, a.result.length, a.todos.length, (IX.editsBy.get(a.id) || []).length].join('|');

/** An agent file as the page reads it: `{ task, result, todos, activity, words, edits }`. */
function agentFileFrom(d) {
  d = obj(d) || {};
  return {
    task: str(d.task), result: str(d.result), todos: todosOf(d.todos),
    activity: arr(d.activity).filter(x => x && typeof x.tool === 'string').map(x => ({ id: str(x.id), at: numOr(x.at, 0), tool: x.tool, target: str(x.target), command: str(x.command), description: str(x.description), ok: typeof x.ok === 'boolean' ? x.ok : null, ms: numOr(x.ms) })),
    words: arr(d.words).filter(w => w && (w.kind === 'said' || w.kind === 'thought') && typeof w.text === 'string' && w.text.trim()).map(w => ({ kind: w.kind, at: numOr(w.at, 0), step: numOr(w.step, 0), text: w.text, after: str(w.after), isCut: w.isCut === true })),
    edits: arr(d.edits).filter(x => typeof x === 'string'),
  };
}

/**
 * An agent's log as its file holds it, oldest first: each call and, with
 * `withWords`, the words that came after it (said and thought, in the
 * order they came); words from before its first call first.
 */
function logOf(f, withWords) {
  const ids = new Set(f.activity.map(x => x.id));
  const after = new Map();
  for (const w of withWords ? f.words : []) {
    const k = ids.has(w.after) ? w.after : '';
    if (!after.has(k)) after.set(k, []);
    after.get(k).push(w);
  }
  const wordsAfter = k => (after.get(k) || []).map(w => ({ kind: w.kind, word: w }));
  return [...wordsAfter(''), ...f.activity.flatMap(x => [{ kind: 'call', call: x }, ...wordsAfter(x.id)])];
}

function agentFileOf(a) {
  const sig = rowSig(a);
  let f = agentFiles.get(a.fileId);
  if (f && (f.sig === sig || f.loading)) return f;
  if (!f) { f = { status: 'loading', data: null, error: '', sig: '', loading: false, tries: 0 }; agentFiles.set(a.fileId, f); }
  f.sig = sig;
  f.loading = true;
  fetch(`${baseUrl()}/agent/${encodeURIComponent(a.fileId)}${QT}`, { headers: AUTH, cache: 'no-store' })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'Its activity is not on disk yet.' : `The server answered ${r.status}.`))))
    .then(text => { f.data = agentFileFrom(JSON.parse(text)); f.status = 'ok'; f.error = ''; f.tries = 0; })
    .catch(e => {
      // a file read while the mod rewrote it is torn: read it again in a moment, a few times
      if (!f.data) f.status = 'error';
      f.error = e instanceof SyntaxError ? 'Could not read its activity.' : e.message || 'Could not load its activity.';
      if (++f.tries <= 3) setTimeout(() => { f.sig = ''; invalidate(); }, 400 * f.tries);
    })
    .finally(() => { f.loading = false; invalidate(); });
  return f;
}

// ===================================================================== router
// #/now (the Dashboard; #/dashboard too), #/chat, #/org, #/changes,
// #/inspect, #/settings; an agent's drawer rides on the route it opened
// over: #/now/agent/<id>. #/ is the Dashboard.

const TABS = [['now', 'Dashboard'], ['chat', 'Chat'], ['org', 'Org'], ['changes', 'Changes'], ['inspect', 'Inspect'], ['settings', 'Settings']];
/** The other names a route answers to: the Dashboard's own, and Settings', where Help is. */
const ROUTE_ALIAS = { dashboard: 'now', help: 'settings' };

function parseRoute() {
  const all = location.hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  // every session on this machine (#/sessions), and another session's deck (#/s/<id>/<tab>…, its tabs and drawer as this one's)
  if (all[0] === 'sessions') return { tab: 'sessions', drawer: null, key: 'sessions', session: null };
  const session = all[0] === 's' && all[1] ? all[1] : null;
  const parts = session ? all.slice(2) : all;
  const name = ROUTE_ALIAS[parts[0]] || parts[0];
  // an Inspect drawer's link of an earlier page (#/<route>/inspect) opens Inspect, a tab of its own now
  const tab = parts[1] === 'inspect' ? 'inspect' : TABS.some(t => t[0] === name) ? name : 'now';
  const drawer = parts[1] === 'agent' && parts[2] ? { kind: 'agent', id: parts[2] } : null;
  return { tab, drawer, key: tab, session };
}
let route = parseRoute();

const hrefOf = (tab, drawer, session = route.session) => (tab === 'sessions' ? '#/sessions' : `${session ? `#/s/${encodeURIComponent(session)}/` : '#/'}${tab}${drawer ? `/agent/${encodeURIComponent(drawer.id)}` : ''}`);

/** Takes the page to `next`, noting the tab it leaves (`i` and `h` go back to it from Settings). */
function setRoute(next) {
  if (next.tab !== route.tab) {
    ui.prevTab = route.tab;
    if (next.tab !== 'settings') ui.settingsAt = null;
  }
  route = next;
  // another session's deck, or this one's again
  if ((route.session || null) !== VIEW.id) switchView(route.session || null);
}

/** Keeps where the page shown now is scrolled to; the chat read to its end keeps "the end". */
function saveScroll() {
  if (!scroller) return;
  const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32;
  ui.scroll.set(shownKey, shownKey === 'chat' && atEnd ? 'end' : scroller.scrollTop);
}

/** Goes to `tab`, with `drawer` open over it (the one open now by default). */
function navigate(tab, drawer = route.drawer) {
  saveScroll();
  const href = hrefOf(tab, drawer);
  if (location.hash !== href) location.hash = href;
  setRoute({ tab, drawer, key: tab, session: tab === 'sessions' ? null : route.session });
  renderNow();
}
const openAgent = id => navigate(route.tab, { kind: 'agent', id });
const closeDrawer = () => navigate(route.tab, null);
const isAgentOpen = id => !!route.drawer && route.drawer.kind === 'agent' && route.drawer.id === id;
/** A page wide enough to keep a drawer beside it: there it leaves the page in view, so keys that go to a page keep it open. */
const isWide = () => typeof window.innerWidth === 'number' && window.innerWidth >= 1180;

// ================================================================== UI state
// Lives across renders and routes; never reset by a state update.

const ui = {
  orgView: ['list', 'timeline'].includes(store.get('orgView', 'chart')) ? store.get('orgView', 'chart') : 'chart', // Org: the chart, the list or the timeline
  actWords: store.get('actView', 'words') !== 'calls', // an agent's Activity: its calls with their words (the default), or its calls only
  open: new Map(),         // disclosure key -> open
  chatFilter: 'all',       // Chat's member picked: 'all' (Everyone) | an agent's id
  drafts: new Map(),       // composer scope ('chat', 'agent:<id>') -> half-typed words
  inputs: new Map(),       // composer scope -> its textarea
  sends: new Map(),        // composer scope -> { status, text, at }: the POST in flight, or why it could not go
  lastSend: new Map(),     // composer scope -> its last send, whose ack its foot shows (the drawer's)
  outbox: [],              // [{ id, agentId, title, text, at, state }]: what you sent from here, matched to chat rows by ackId
  calls: new Map(),        // need id -> { item, sel, other, touched, sent, gone }: a question being answered here
  needOpen: new Map(),     // need id -> open, once you opened or folded it (else the first of the list is open)
  review: new Map(),       // scope -> { status, id, text, at }
  scroll: new Map(),       // route key -> scrollTop
  scrollTo: null,          // { id, on, until, focus }: an element to bring into view once route `on` shows it
  focusTo: null,           // an element id to focus after the next render (a composer)
  holdChat: false,         // the next render leaves the chat where it is ("Show more")
  pinChat: false,          // the next render takes the chat to its newest row (a send)
  goalOpen: false,         // the header's goal, open on its whole text
  prevTab: 'now',          // the tab shown before this one
  settingsAt: null,        // the section of Settings `i` or `h` went to ('inspect', 'help'), while Settings shows
  picked: null,            // { style, until }: an avatar style picked here, drawn until the state names it
  toast: null,             // { text, until }
  needAt: -1,              // the need `n` went to last
  stops: new Map(),        // command id -> { key, at }: a Stop, Cancel or Stop turn sent from here, until its ack
};

/** Brings element `id` into view once the page shows route `on` (and the element has rendered: the state may still be on its way). */
function scrollSoon(id, on = route.key, focus = false) {
  ui.scrollTo = { id, on, until: Date.now() + 4000, focus };
  invalidate();
}

/** A disclosure's state; its default is fixed the first time it is seen so live updates never flip it. */
function isOpen(key, byDefault) {
  if (!ui.open.has(key)) ui.open.set(key, !!byDefault);
  return ui.open.get(key);
}
function toggle(key) {
  ui.open.set(key, !ui.open.get(key));
  renderNow();
}

/** The sections folded by their heads (`Section`), kept across reloads. */
const shut = new Set(arr(store.get('shut', [])).filter(x => typeof x === 'string'));
function setShut(id, on) {
  if (on === shut.has(id)) return;
  if (on) shut.add(id); else shut.delete(id);
  store.set('shut', [...shut]);
}

function toast(text) {
  ui.toast = { text, until: Date.now() + 2400 };
  setTimeout(invalidate, 2500);
  invalidate();
}

// ================================================================ components

const stop = e => { if (e && e.stopPropagation) e.stopPropagation(); };

function Dot(hue, pulse) {
  return h('span', { class: `dot hue-${hue}${pulse ? ' pulse' : ''}`, 'aria-hidden': 'true' });
}

/** The status glyph family: done, active (spinning), pending, failed, waiting, idle. */
const GLYPH = {
  done: ['circleCheck', 'done'], active: ['progress', 'run'], running: ['progress', 'run'], starting: ['progress', 'run'],
  pending: ['circle', 'idle'], failed: ['circleX', 'fail'], waiting: ['circlePause', 'wait'], idle: ['circleDashed', 'idle'], stopped: ['circleX', 'idle'],
};
function Glyph(st, size = 16) {
  const [ic, hue] = GLYPH[st] || GLYPH.pending;
  return h('svg', { class: `glyph hue-${hue}${ic === 'progress' ? ' spin' : ''}`, width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', html: IC[ic] });
}

/**
 * A section: its head, whose title (and count) folds it, with `right` beside
 * it; then its body while it is open. `body` is a function, so a folded
 * section builds (and fetches) nothing.
 */
function Section(id, title, count, right, body) {
  const open = !shut.has(id);
  return h('section', { key: id, id: `sec-${id}`, class: `sec sec-${id}${open ? '' : ' shut'}`, 'aria-label': title },
    h('div', { class: 'sec-head' },
      h('h2', { class: 'sec-title' },
        h('button', { type: 'button', class: 'sec-fold', 'aria-expanded': open ? 'true' : 'false', onClick: () => { setShut(id, open); renderNow(); } },
          h('span', null, title),
          count != null && h('span', { class: 'sec-count' }, String(count)),
          icon('chevronDown', 'sec-chev'))),
      right || null),
    open ? body() : null);
}

function DiffStat(add, rem) {
  return h('span', { class: 'diffstat' },
    h('span', { class: 'plus' }, `+${add || 0}`),
    h('span', { class: 'minus' }, `−${rem || 0}`));
}

/** A path, its folder muted; `full` is the whole path one shortened (`shortPath`) stands for, shown on hover. */
function PathText(p, cls, full) {
  const [dir, base] = splitPath(p);
  return h('span', { class: `path${cls ? ` ${cls}` : ''}`, title: full || p },
    dir && h('span', { class: 'path-dir' }, dir),
    h('span', { class: 'path-base' }, base));
}

function ToolTag(tool) {
  return h('span', { class: 'tooltag' }, icon(TOOL_ICON[tool] || 'wrench'), tool);
}

function Empty(ic, title, text, action) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty-ic' }, icon(ic)),
    h('p', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    action || null);
}

/** A name that opens its agent's drawer; you, Claude Code and a name no agent carries read as text. */
function NameLink(id, size = 16) {
  const a = IX.byId.get(id);
  if (!a) return h('span', { class: 'who' }, size ? whoAvatar(id, size) : null, h('span', { class: 'who-name' }, nameOf(id)));
  return h('button', { type: 'button', class: 'who who-link', title: a.title, onClick: e => { stop(e); openAgent(id); } }, size ? Avatar(a, size) : null, h('span', { class: 'who-name' }, a.title));
}

// ----------------------------------------------------------------- markdown
// Paragraphs, headings, lists, code spans, bold, fenced blocks. Built as
// vnodes, never innerHTML, so agent text cannot inject markup.

function inline(text) {
  const out = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s)<>]+[^\s)<>.,;:!?'"])/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[2] != null) out.push(h('code', { class: 'code' }, m[2]));
    // bold may hold code spans ("**What changed in `src/a.js`:**"): its own words are read the same way
    else if (m[3] != null) out.push(h('strong', null, inline(m[3])));
    else out.push(h('a', { class: 'mdlink', href: m[4], target: '_blank', rel: 'noopener noreferrer' }, m[4]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function Markdown(text) {
  const blocks = [];
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let para = [], list = null;
  const flushPara = () => { if (para.length) blocks.push(h('p', null, inline(para.join('\n')))); para = []; };
  const flushList = () => { if (list) blocks.push(h(list.tag, null, list.items.map(it => h('li', { class: it.deep ? 'deep' : null }, inline(it.text))))); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flushPara(); flushList();
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push(h('pre', { class: 'pre' }, h('code', null, body.join('\n'))));
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line), numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol', m = bullet || numbered;
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push({ text: m[2], deep: m[1].length >= 2 });
      continue;
    }
    const head = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (head) { flushPara(); flushList(); blocks.push(h('p', { class: 'md-h' }, inline(head[1]))); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1].text += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return h('div', { class: 'md' }, blocks);
}

/** Words that fold: the first lines until asked, then all of them. `key` keeps the fold's state. */
function Folded(key, long, body, more = 'Show more') {
  const open = long && isOpen(key, false);
  return [
    h('div', { key: `${key}:body`, class: long && !open ? 'folded' : 'unfolded' }, body),
    long && h('button', { key: `${key}:more`, class: 'more more-start', type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      open ? 'Show less' : more, icon('chevronDown', open ? 'flip' : '')),
  ];
}

// --------------------------------------------------------------------- diffs

/** A patch (`kind` 'patch', an agent's edit) or git's own diff of a file ('gitdiff'), its lines numbered and tinted. */
function PatchView(id, scope, kind = 'patch') {
  const p = diffOf(kind, id);
  if (p.status === 'loading') return h('div', { class: 'diff diff-wait' }, h('span', { class: 'sk sk-line' }), h('span', { class: 'sk sk-line short' }));
  if (p.status === 'error') {
    return h('div', { class: 'diff-err' }, icon('alert'), h('span', null, p.error),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: () => { diffs.delete(`${kind}:${id}`); renderNow(); } }, 'Retry'));
  }
  if (!p.hunks.length) return h('div', { class: 'diff-err muted' }, 'No changed lines.');
  // The rows are cached per patch and per place it shows (a vnode can only be mounted once).
  const views = p.views || (p.views = new Map());
  if (!views.has(scope)) {
    const rows = [];
    p.hunks.forEach((hk, i) => {
      rows.push(h('div', { key: `h${i}`, class: 'dl dl-hunk' }, h('span', { class: 'ln' }), h('span', { class: 'ln' }), h('span', { class: 'sg' }), h('span', { class: 'tx' }, hk.head)));
      hk.lines.forEach((l, j) => rows.push(h('div', { key: `${i}:${j}`, class: `dl dl-${l.t}` },
        h('span', { class: 'ln' }, String(l.a)), h('span', { class: 'ln' }, String(l.b)),
        h('span', { class: 'sg' }, l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''),
        h('span', { class: 'tx' }, l.s || ' '))));
    });
    views.set(scope, rows);
  }
  return h('div', { class: 'diff' }, h('div', { class: 'diff-in' }, views.get(scope)));
}

/** One agent edit: its tool, who made it, when, its size, and its patch. */
function EditBlock(e, scope, showAgent = true) {
  return h('div', { key: e.id, class: 'edit' },
    h('div', { class: 'edit-head' },
      ToolTag(e.tool),
      showAgent && NameLink(e.agent),
      h('span', { class: 'edit-time' }, agoText(e.at)),
      DiffStat(e.added, e.removed)),
    PatchView(e.id, scope));
}

/** One file's edits, collapsible, each with its patch. */
function FileGroup(path, edits, opts) {
  const key = `${opts.scope}|${path}`;
  const open = isOpen(key, opts.open);
  const add = total(edits, e => e.added), rem = total(edits, e => e.removed);
  // Changes' own (the dashboard's Files go there): once in the page, so it can be brought into view
  return h('div', { key: path, id: opts.scope === 'other' ? `file-${path}` : null, class: `fgroup${open ? ' open' : ''}` },
    h('button', { class: 'fgroup-head', type: 'button', 'data-nav': 'file', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      icon('file', 'fic'),
      PathText(opts.outside ? shortPath(path) : path, 'grow', path),
      opts.editors && AvatarStack(opts.editors, 18),
      h('span', { class: 'fgroup-n' }, plural(edits.length, 'edit')),
      DiffStat(add, rem)),
    open && h('div', { class: 'fgroup-body' }, edits.map(e => EditBlock(e, opts.scope, opts.showAgent))));
}

/**
 * The files outside the repository (an agent's scratch and temp files), after
 * the repository's own: one dim row, "n files outside the repo", that opens
 * on them (`rows()`). `where` keeps its open state apart per list.
 */
function OutsideRows(n, where, rows) {
  if (!n) return null;
  const key = `outside|${where}`;
  const open = isOpen(key, false);
  return [
    h('button', { key, class: `outside-row${open ? ' open' : ''}`, type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      h('span', { class: 'outside-text' }, `${plural(n, 'file')} outside the repo`)),
    open ? rows() : null,
  ];
}

// ================================================================= needs you
// What Claude Code holds on you, from the state's `needs`: a question
// (AskUserQuestion) you can answer right here when the mod can take the
// answer, a permission prompt shown exactly and answered in Claude Code, or
// one of Claude Code's notifications, verbatim. Once a question's call
// resolves it leaves the state; one you answered (or began to) collapses to
// a line saying how it ended, for a while.

/** The answering state of a question: per question the option chosen (one) or the ones checked (many) and the Other text, and what was sent. */
function callOf(n) {
  let c = ui.calls.get(n.id);
  if (!c || c.sel.length !== n.questions.length) {
    c = { item: n, sel: n.questions.map(q => (q.multiSelect ? [] : null)), other: n.questions.map(() => ''), touched: false, sent: null, gone: 0 };
    ui.calls.set(n.id, c);
  }
  c.item = n;
  return c;
}

/** A question's answer as picked so far: the option, the options checked joined by ", " (in their order) with any Other text last, or the Other text; '' for none. */
function answerOf(q, qi, c) {
  const other = String(c.other[qi] || '').trim();
  if (q.multiSelect) {
    const labels = q.options.map(o => o.label).filter(l => c.sel[qi].includes(l));
    if (other) labels.push(other);
    return labels.join(', ');
  }
  return c.sel[qi] != null ? c.sel[qi] : other;
}

/** Notes each question that left the state, so one answered here can say how it ended for a while; forgets the rest. */
function noteResolved() {
  const live = new Set(S.needs.map(n => n.id));
  const now = Date.now();
  for (const [id, c] of ui.calls) {
    if (live.has(id)) { c.gone = 0; continue; }
    if (!c.touched && !c.sent) { ui.calls.delete(id); continue; }
    if (!c.gone) { c.gone = now; setTimeout(invalidate, KEEP + 50); }
    else if (now - c.gone > KEEP) ui.calls.delete(id);
  }
}

/** The questions that resolved a moment ago after you answered or began to (for agent `agentId`, or all). */
function resolvedCalls(agentId) {
  const now = Date.now();
  return [...ui.calls.values()].filter(c => c.gone && now - c.gone < KEEP && (c.touched || c.sent) && (!agentId || c.item.agent === agentId));
}

async function sendAnswers(n, answers) {
  const c = callOf(n);
  const id = newCmdId('a');
  c.touched = true;
  c.sent = { id, state: 'sending', at: Date.now(), answers };
  renderNow();
  try {
    await command({ cmd: 'answer', id, callId: n.id, answers });
    if (c.sent && c.sent.id === id) c.sent.state = 'sent';
    setTimeout(invalidate, ACK_WAIT + 50);
  } catch (e) {
    if (c.sent && c.sent.id === id) Object.assign(c.sent, { state: 'error', error: e.message });
  }
  renderNow();
}

/** Where a sent answer stands: null before any; busy while it waits on its ack; done once answered; else it can be tried again. */
function answerState(c) {
  if (!c.sent) return null;
  const st = sendState(c.sent, 'answer');
  return { ...st, done: !!(st.ack && st.tone === 'done') };
}

function Option(n, q, qi, o, oi, c, mode) {
  const multi = q.multiSelect;
  const on = multi ? c.sel[qi].includes(o.label) : c.sel[qi] === o.label;
  const body = [
    h('span', { class: multi ? 'q-box' : 'q-dot', 'aria-hidden': 'true' }, multi && on ? icon('check') : null),
    h('span', { class: 'q-opt-body' },
      h('span', { class: 'q-opt-label' }, o.label),
      o.description && h('span', { class: 'q-opt-desc' }, o.description)),
  ];
  if (mode.readOnly) return h('div', { key: `o${oi}:${o.label}`, class: 'q-opt ro' }, body);
  const pick = () => {
    c.touched = true;
    if (multi) c.sel[qi] = on ? c.sel[qi].filter(l => l !== o.label) : c.sel[qi].concat(o.label);
    else c.sel[qi] = o.label;
    if (mode.instant) sendAnswers(n, { [q.question]: o.label });
    else renderNow();
  };
  return h('button', {
    key: `o${oi}:${o.label}`, type: 'button', class: `q-opt${on ? ' on' : ''}`, disabled: mode.locked,
    role: mode.instant ? null : multi ? 'checkbox' : 'radio', 'aria-checked': mode.instant ? null : on ? 'true' : 'false',
    onClick: pick,
  }, body);
}

function OtherField(n, q, qi, c, mode) {
  const text = String(c.other[qi] || '');
  const chosen = text.trim() && (q.multiSelect || c.sel[qi] == null);
  const sendOther = () => { if (text.trim()) sendAnswers(n, { [q.question]: text.trim().slice(0, 2000) }); };
  return h('div', { class: `q-other${chosen ? ' on' : ''}` },
    h('input', {
      key: `other:${n.id}:${qi}`, class: 'q-other-input', type: 'text', maxlength: '2000', disabled: mode.locked,
      placeholder: q.options.length ? 'Other…' : 'Your answer…', 'aria-label': `Your own answer to: ${q.question}`,
      ref: el => { el.value = c.other[qi] || ''; },
      onInput: e => {
        c.touched = true;
        c.other[qi] = e.target.value;
        if (!q.multiSelect && e.target.value.trim()) c.sel[qi] = null;
        renderNow();
      },
      onKeyDown: e => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        if (mode.instant) sendOther();
        else if (mode.submit) mode.submit();
      },
    }),
    mode.instant && h('button', { class: 'btn btn-sm', type: 'button', disabled: mode.locked || !text.trim(), onClick: sendOther }, 'Send'));
}

function QuestionBlock(n, q, qi, c, mode) {
  return h('div', { key: `q${qi}`, class: 'q', role: 'group', 'aria-label': q.question },
    h('p', { class: 'q-head' },
      q.header && h('span', { class: 'q-chip' }, q.header),
      h('span', { class: 'q-text' }, q.question),
      q.multiSelect && h('span', { class: 'q-hint' }, mode.readOnly ? 'several allowed' : 'pick any')),
    q.options.length > 0 && h('div', { class: 'q-opts', role: mode.instant || mode.readOnly ? null : q.multiSelect ? 'group' : 'radiogroup', 'aria-label': q.question },
      q.options.map((o, oi) => Option(n, q, qi, o, oi, c, mode))),
    !mode.readOnly && OtherField(n, q, qi, c, mode));
}

/** A question's form: one question with one answer sends on a click; several, or checkboxes, take a Submit. */
function QuestionForm(n) {
  const c = callOf(n);
  const qs = n.questions;
  const st = answerState(c);
  const readOnly = !n.isAnswerable;
  const instant = qs.length === 1 && !qs[0].multiSelect;
  const locked = readOnly || !!(st && (st.busy || st.done));
  const answers = {};
  qs.forEach((q, qi) => { const v = answerOf(q, qi, c); if (v) answers[q.question] = v.slice(0, 2000); });
  const ready = Object.keys(answers).length === qs.length;
  const submit = () => { if (ready && !locked) sendAnswers(n, answers); };
  const mode = { readOnly, instant, locked, submit };
  return h('div', { class: 'qform' },
    h('div', { class: `qform-qs${qs.length > 1 ? ' several' : ''}` }, qs.map((q, qi) => QuestionBlock(n, q, qi, c, mode))),
    h('div', { class: 'qform-foot' },
      st ? StatusNote(st) : h('span', { class: 'need-where' }, readOnly ? 'Answer it in Claude Code.' : 'Or answer it in Claude Code.'),
      !readOnly && !instant && h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !ready || locked, onClick: submit }, qs.length > 1 ? 'Submit answers' : 'Submit')));
}

/** A permission prompt as Claude Code shows it: the exact command, or the path; what the call says it does. */
function PermissionBody(n) {
  return h('div', { class: 'permit' },
    n.command
      ? h('pre', { class: 'permit-cmd' }, h('code', null, n.command))
      : n.path ? h('p', { class: 'permit-path' }, icon('file', 'fic'), PathText(n.path, 'grow')) : null,
    n.text && n.text !== n.command && n.text !== n.path && n.text !== n.tool && h('p', { class: 'permit-desc' }, n.text),
    h('p', { class: 'need-where' }, 'Answer in Claude Code.'));
}

function NoteBody(n) {
  return h('div', { class: 'permit' },
    h('p', { class: 'note-text' }, n.text),
    h('p', { class: 'need-where' }, 'Answer in Claude Code.'));
}

const NEED_ICON = { question: 'help', permission: 'shield', notification: 'bell' };

/** What a folded need says on its one line: its question, its command or path, its words. */
const needGist = n => (n.kind === 'question' ? n.questions.map(q => q.question).join(' · ') || n.text : n.kind === 'permission' ? n.command || n.path || n.text : n.text);

/**
 * One need's card. Calm by default: the first of a list is open, the rest
 * fold to one line until opened (or reached with n). A question answered
 * here collapses at once to how it ended.
 */
function NeedCard(n, first = true) {
  const c = n.kind === 'question' ? callOf(n) : null;
  if (c) { const st = answerState(c); if (st && st.done) return AnsweredCard(c); }
  const open = ui.needOpen.has(n.id) ? ui.needOpen.get(n.id) : first || !!(c && c.touched);
  const flip = () => { ui.needOpen.set(n.id, !open); renderNow(); };
  const who = n.agentName || nameOf(n.agent);
  const name = h('span', { key: 'who', class: 'need-who' }, IX.byId.has(n.agent) ? NameLink(n.agent, 0) : who);
  const title = n.kind === 'question' ? [name, ' asks'] : n.kind === 'permission' ? [name, ' needs permission'] : h('span', { key: 'who', class: 'need-who' }, n.title || 'Claude Code');
  return h('section', {
    key: `need:${n.id}`, id: `need-${n.id}`, class: `need need-${n.kind}${open ? ' open' : ' folded-need'}`, tabindex: '-1', 'data-nav': 'need',
    'aria-label': n.kind === 'notification' ? n.title || 'Claude Code' : `${who} ${n.kind === 'question' ? 'asks' : 'needs permission'}`,
    onKeyDown: e => {
      if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
      e.preventDefault();
      if (!open) { flip(); return; }
      const control = e.currentTarget.querySelector('.need-body button:not(:disabled), .need-body input');
      if (control) control.focus();
    },
  },
  h('div', { class: 'need-head', onClick: flip },
    icon(NEED_ICON[n.kind], 'need-ic'),
    h('p', { class: 'need-title' }, title, !open && h('span', { key: 'gist', class: `need-gist${n.kind === 'permission' && (n.command || n.path) ? ' mono' : ''}` }, needGist(n))),
    n.kind === 'permission' && n.tool && ToolTag(n.tool),
    n.kind === 'notification' && n.typeText && open && h('span', { class: 'need-type' }, n.typeText),
    h('span', { class: 'need-age', title: n.at ? new Date(n.at).toLocaleString() : '' }, ageOf(n.at) || n.age),
    h('button', { type: 'button', class: 'need-flip', 'aria-expanded': open ? 'true' : 'false', 'aria-label': open ? 'Fold' : 'Open', onClick: e => { stop(e); flip(); } }, icon('chevronDown', open ? 'flip' : ''))),
  open && h('div', { class: 'need-body' }, n.kind === 'question' ? QuestionForm(n) : n.kind === 'permission' ? PermissionBody(n) : NoteBody(n)));
}

const answersText = answers => Object.values(answers || {}).join('; ');

/** How a question you answered (or began to) ended, in one line: "Answered: Redis", or Claude Code's own word on it. */
function answeredLine(c) {
  const n = c.item;
  const st = c.sent ? sendState(c.sent, 'answer') : null;
  const choice = IX.choiceByCall.get(n.id);
  if (st && st.ack && st.tone === 'done') return { tone: 'done', icon: 'check', text: `Answered: ${answersText(c.sent.answers)}` };
  if (st && st.ack) return st; // refused, or too late ("Already answered in Claude Code")
  // the chat's word on it: "You answered: …", "Answered in Claude Code: …", "Auto-answered after idle: …"
  if (choice) return { tone: /^you answered/i.test(choice.text) ? 'done' : 'idle', icon: 'check', text: choice.text };
  if (st && st.busy) return st;
  return { tone: 'idle', icon: 'check', text: c.sent ? `Answered: ${answersText(c.sent.answers)}` : 'Answered in Claude Code' };
}

function AnsweredCard(c) {
  const n = c.item, line = answeredLine(c);
  return h('div', { key: `need:${n.id}`, id: `need-${n.id}`, class: `need-done tone-${line.tone}`, role: 'status' },
    line.glyph ? Glyph(line.glyph, 15) : h('span', { class: `status-ic hue-${line.tone}` }, icon(line.icon === 'x' ? 'circleX' : line.icon === 'clock' ? 'clock' : 'circleCheck')),
    h('span', { class: 'need-done-text' }, line.text),
    h('span', { class: 'need-done-q', title: n.questions.map(q => q.question).join('\n') }, n.questions.length === 1 ? n.questions[0].question : plural(n.questions.length, 'question')),
    h('span', { class: 'need-age' }, ageOf(c.gone || (c.sent && c.sent.at) || n.at)));
}

/** The needs of one agent (each open), or all of them (the first open), oldest first, after the ones that just resolved. */
function NeedsList(agentId) {
  const list = agentId ? IX.needsBy.get(agentId) || [] : S.needs;
  const done = resolvedCalls(agentId);
  if (!list.length && !done.length) return null;
  return h('div', { class: 'needs-list' }, done.map(AnsweredCard), list.map((n, i) => NeedCard(n, !!agentId || i === 0)));
}

// ===================================================================== header
// Always in view: the session's state in one word, your latest request in
// your words, and the model, context and spend; then the tabs.

const STATE_HUE = { working: 'run', waiting: 'wait', idle: 'idle' };

function StateWord() {
  const hd = S.header;
  return h('span', { class: `state is-${hd.state}`, role: 'status' }, Dot(STATE_HUE[hd.state], hd.state === 'working'), hd.stateText);
}

function GoalButton() {
  const g = S.header.goal;
  if (!g) return h('span', { class: 'goal goal-none' }, 'No request yet');
  const flip = () => { ui.goalOpen = !ui.goalOpen; renderNow(); };
  return h('button', { type: 'button', class: `goal${ui.goalOpen ? ' open' : ''}`, 'aria-expanded': ui.goalOpen ? 'true' : 'false', title: ui.goalOpen ? '' : g.text, onClick: flip },
    h('span', { class: 'goal-text' }, g.headline || firstLine(g.text, 80)),
    h('span', { class: 'goal-age' }, ageOf(g.at)),
    icon('chevronDown', `goal-chev${ui.goalOpen ? ' flip' : ''}`));
}

/** The goal opened: its whole text (fetched once when the state cut it). */
function GoalPanel() {
  const g = S && !S.empty && S.header.goal;
  if (!g || !ui.goalOpen) return null;
  const full = g.isCut && g.messageId ? fullTextOf(g.messageId) : null;
  const text = full && full.status === 'ok' ? full.text : g.text;
  return h('div', { key: 'goal-panel', class: 'goal-panel' },
    h('p', { class: 'goal-panel-label' }, 'Your latest request', h('span', { class: 'sep' }, ' · '), agoText(g.at)),
    h('p', { class: 'goal-panel-text' }, text.trim()),
    full && full.status === 'loading' && h('p', { class: 'muted small' }, 'Loading the rest…'),
    full && full.status === 'error' && h('p', { class: 'msg-err' }, icon('alert'), full.error));
}

function ConnPill() {
  const st = conn.status;
  if (st === 'live') return h('span', { class: 'conn conn-live', title: 'Updating live' }, Dot('run', true), 'Live');
  if (st === 'reconnecting') return h('span', { class: 'conn conn-wait' }, Dot('wait'), 'Reconnecting');
  if (st === 'ended') return h('span', { class: 'conn' }, Dot('idle'), 'Ended');
  if (st === 'denied') return h('span', { class: 'conn conn-fail' }, Dot('fail'), 'No access');
  return h('span', { class: 'conn' }, Dot('idle'), 'Connecting');
}

/** A tab: its name, and for the Dashboard what needs you, for Changes the files uncommitted. Its key works quietly: no badge says it. */
function Tab(id, label) {
  const on = route.tab === id;
  const has = S && !S.empty;
  const n = !has ? 0 : id === 'now' ? S.needs.length : id === 'changes' ? S.changes.files.length : 0;
  return h('a', { key: id, class: `tab${on ? ' on' : ''}`, href: hrefOf(id, route.drawer), 'aria-current': on ? 'page' : null },
    h('span', null, label),
    n > 0 && h('span', { class: `tab-n${id === 'now' ? ' is-need' : ''}`, title: id === 'now' ? plural(n, 'thing needs you', 'things need you') : plural(n, 'uncommitted file') }, String(n)));
}

function Header() {
  const has = S && !S.empty;
  const hd = has ? S.header : null;
  return h('header', { class: 'hd' },
    h('div', { class: 'hd-top' },
      h('span', { class: 'brand-mark', title: 'Agent Deck', 'aria-hidden': 'true' }),
      hd ? StateWord() : h('span', { class: 'state is-idle' }, Dot('idle'), S ? 'Idle' : 'Connecting'),
      hd ? GoalButton() : h('span', { class: 'goal goal-none' }),
      hd && hd.line ? HeaderLine(hd, 'hd-line-top') : null,
      SessionsLink(),
      hd && hd.turn ? StopTurn() : null),
    GoalPanel(),
    h('nav', { class: 'hd-tabs', 'aria-label': 'Pages' },
      TABS.map(([id, label]) => Tab(id, label)),
      h('span', { class: 'hd-tabs-end' },
        hd && hd.line ? HeaderLine(hd, 'hd-line-tabs') : null,
        ConnPill())),
    ViewingBar());
}

/** The header's line, "opus-5.5 · auto mode · context 41% · $4.12": its permission mode lit as Claude Code's footer lights it (bypass permissions in red). */
function HeaderLine(hd, cls) {
  const mode = hd.mode;
  const at = mode ? hd.line.indexOf(mode) : -1;
  return h('span', { class: `hd-line ${cls}`, title: hd.line }, at < 0 ? hd.line : [hd.line.slice(0, at), h('span', { key: 'mode', class: `hd-mode${mode === 'bypass permissions' ? ' is-fail' : ''}` }, mode), hd.line.slice(at + mode.length)]);
}

// ================================================================== dashboard
// The Dashboard (#/now): what needs you (only while something does), a run card per
// agent, the session's figures, the plan (only if Claude made one), the
// newest tool calls and the files the agents touched. Each section folds by
// its head; on a wide page the last two sit side by side.

function NowPage() {
  if (!IX.rows.length && !S.chat.length) return Welcome();
  return h('div', { key: 'now', class: 'page page-now' },
    NeedsSection(),
    AgentsSection(),
    BackgroundSection(),
    FiguresStrip(),
    PlanSection(),
    h('div', { key: 'cols', class: 'dash-cols' }, ActivitySection(), FilesSection()));
}

function NeedsSection() {
  if (!S.needs.length && !resolvedCalls().length) return null;
  return Section('needs', 'Needs you', S.needs.length || null, null, () => NeedsList(null));
}

// ------------------------------------------------------------- run cards

/** How many run cards the Dashboard draws; past that, Org shows them all. */
const CARDS = 12;

/**
 * The run cards: the Orchestrator, then each agent at work or waiting on you
 * in the order it started, so a new one appends and nothing moves; past
 * twelve, the Orchestrator, every one waiting on you and the newest of the
 * rest. The finished ones (`isFinished`)
 * stand behind one "N finished ▸" row, drawn while it is open (the newest
 * twelve). The agents Clear finished hid are in neither.
 */
function cardRows(isFinishedOpen) {
  const list = IX.shown.slice().sort((x, y) => (y.kind === 'orchestrator') - (x.kind === 'orchestrator') || x.startedAt - y.startedAt);
  const front = list.filter(a => !isFinished(a)), behind = list.filter(isFinished);
  // past twelve: the Orchestrator, every one waiting on you, then the newest
  const keep = new Set(front.filter(a => a.kind === 'orchestrator').map(a => a.id));
  for (let i = front.length - 1; i >= 0 && keep.size < CARDS; i--) if (front[i].status === 'waiting') keep.add(front[i].id);
  for (let i = front.length - 1; i >= 0 && keep.size < CARDS; i--) keep.add(front[i].id);
  const shown = front.length <= CARDS ? front : front.filter(a => keep.has(a.id));
  const finished = isFinishedOpen ? behind.slice(-CARDS) : [];
  return { shown, finished, finishedCount: behind.length, hidden: front.length - shown.length + (isFinishedOpen ? behind.length - finished.length : 0) };
}

/**
 * The "N finished" row under the agents in front (the Dashboard's cards,
 * Chat's members): "3 finished ▸", a press opens it on them ("▾") or folds
 * it; "Clear finished" hides them from the deck (the Desktop pane and the
 * terminal too; nothing in Claude Code changes); "Show 2 cleared" brings
 * those it hid back. Null with nothing finished and nothing cleared.
 */
function FinishedRow(scope, n, open) {
  const cleared = S.cleared ? S.cleared.count : 0;
  if (!n && !cleared) return null;
  return h('div', { key: `fin:${scope}`, class: `finished finished-${scope}` },
    n > 0 && h('button', { key: 'fold', type: 'button', class: 'fin-fold', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(`finished|${scope}`) }, `${n} finished ${open ? '▾' : '▸'}`),
    n > 0 && h('button', { key: 'clear', type: 'button', class: 'btn btn-xs fin-clear', title: 'Hide the finished agents from this deck: Claude Code keeps them', onClick: () => clearFinished() }, 'Clear finished'),
    cleared > 0 && h('button', { key: 'show', type: 'button', class: 'btn btn-xs fin-show', onClick: () => showCleared() }, `Show ${cleared} cleared`));
}

/** Clear finished: the mod hides every finished agent from the deck, here and in the pane, and the next state says so. Nothing in Claude Code changes. */
async function clearFinished() {
  try {
    await command({ cmd: 'clearFinished', id: newCmdId('cl') });
    toast('Finished agents cleared from the deck: Claude Code keeps them');
  } catch (err) {
    toast(err.message);
  }
}

/** Show N cleared: the agents Clear finished hid come back. */
async function showCleared() {
  try {
    await command({ cmd: 'showCleared', id: newCmdId('cl') });
  } catch (err) {
    toast(err.message);
  }
}

const PILL = { starting: 'starting', running: 'running', waiting: 'waiting', done: 'done', failed: 'failed', stopped: 'stopped', idle: 'idle' };

function Pill(st) {
  return h('span', { class: `pill hue-${statusOf(st).hue}` }, PILL[st] || st);
}

/**
 * What a run card's inner box says: the agent's own todo in progress, else
 * the first line of its task (the Orchestrator's task is your latest
 * request), with its todos done of all of them.
 */
function stepOf(a) {
  const st = stateOf(a);
  const cur = a.todos.find(t => t.status === 'active');
  const goal = a.kind === 'orchestrator' && S.header.goal ? S.header.goal.headline : '';
  const text = (cur && cur.text) || firstLine(a.task) || goal || a.description || a.type || KIND_WORD[a.kind];
  const n = a.todos.length ? `${a.todos.filter(t => t.status === 'done').length}/${a.todos.length}` : '';
  return { text, n, glyph: isRunning(a.status) ? 'active' : st };
}

/** An agent's words as the deck quotes them, after a speech mark: in italics, their code spans as code. */
function Words(text, cls) {
  return [
    h('span', { key: 'mark', class: 'said-mark' }, icon('said')),
    h('span', { key: 'words', class: `said-words${cls ? ` ${cls}` : ''}` }, '“', inline(text), '”'),
  ];
}

/** A run card's line: its call in flight, verbatim; else, while it is at work, its words since its latest call; else what it handed back; else its status in a word. */
function NowLine(a) {
  if (a.live) {
    return [
      isRunning(a.status) && h('span', { key: 'dot', class: 'run-live' }, Dot('run', true)),
      h('span', { key: 'tool', class: 'run-tool' }, a.live.tool),
      h('span', { key: 'text', class: PATHY.has(a.live.tool) ? 'run-said mono' : 'run-said' }, a.live.text),
    ];
  }
  if (a.said) return Words(firstLine(a.said.text, 280));
  if (a.result) return h('span', { key: 'said', class: 'run-said' }, inline(firstLine(a.result, 280)));
  const st = stateOf(a);
  return h('span', { key: 'quiet', class: 'run-quiet' }, isRunning(a.status) ? 'Working' : ROW_WORD[st] || statusOf(st).label);
}
const nowTitle = a => (a.live ? `${a.live.tool} ${a.live.text}` : a.said ? `“${oneLine(a.said.text)}”` : a.result ? firstLine(a.result, 600) : '');

/** When its run began: its start, or when a message last woke it (resumed). */
const runStartOf = a => Math.max(a.startedAt || 0, a.resumedAt || 0);

/** "Started 4m ago" while it works ("Resumed 1m ago" once a message woke it), "Finished 2m ago" (or failed, stopped) once it ended. */
function runTime(a) {
  const st = stateOf(a);
  if (a.endedAt != null && !isLive(a.status)) return `${st === 'failed' ? 'Failed' : st === 'stopped' ? 'Stopped' : 'Finished'} ${agoText(a.endedAt)}`;
  const from = runStartOf(a);
  return from ? `${from > (a.startedAt || 0) ? 'Resumed' : 'Started'} ${agoText(from)}` : '';
}

function RunCard(a) {
  const st = stateOf(a), step = stepOf(a);
  return h('button', {
    key: a.id, type: 'button', class: `run-card is-${st}${isAgentOpen(a.id) ? ' on' : ''}`, 'data-nav': 'agent', enter: true,
    'aria-label': `${a.title}, ${statusOf(st).label}`, onClick: () => openAgent(a.id),
  },
  h('span', { class: 'run-head' },
    AvatarDot(a, 24),
    h('span', { class: 'run-name', title: [a.title, a.type || KIND_WORD[a.kind]].filter(Boolean).join(' · ') }, a.title),
    Pill(st)),
  h('span', { class: 'run-step' },
    Glyph(step.glyph, 15),
    h('span', { class: 'run-step-text', title: step.text }, step.text),
    step.n && h('span', { class: 'run-step-n' }, step.n)),
  h('span', { class: `run-now${a.live && a.status === 'waiting' ? ' is-waiting' : ''}`, title: nowTitle(a) }, NowLine(a)),
  h('span', { class: 'run-foot' },
    h('span', { class: 'run-model' }, modelLine(a)),
    h('span', { class: 'run-time' }, runTime(a))));
}

function AgentsSection() {
  const open = isOpen('finished|now', false);
  const { shown, finished, finishedCount, hidden } = cardRows(open);
  const link = h('a', { class: 'sec-link', href: hrefOf('org', route.drawer) }, hidden ? `${hidden} more in Org` : 'Org chart', icon('arrowRight'));
  return Section('agents', 'Agents', IX.shown.length || null, link, () => (IX.shown.length || S.cleared.count
    ? h('div', { class: 'run-cards' },
      h('div', { key: 'front', class: 'run-grid' }, shown.map(CardOf)),
      FinishedRow('now', finishedCount, open),
      finished.length > 0 && h('div', { key: 'finished', class: 'run-grid run-grid-finished' }, finished.map(RunCard)))
    : h('div', { class: 'card' }, Empty('bot', 'No agents yet', 'The Orchestrator and the agents it starts show here as they work.'))));
}

// -------------------------------------------------------------- stopping
// Stop turn, Stop and Cancel: the page asks the mod, which stops only
// through Claude Code's own channels (TaskStop, CronDelete, $.turn.abort),
// asking Claude Code's own permission check first; a Stop or Cancel shows
// only where the state says that check allows it (`stop.can`). What came of
// each press comes back as a toast.

/** Sends a stop command (`body`; its `id` made here) for the target keyed `key`; its ack, once the state holds it, is a toast. */
async function sendStop(key, body) {
  const id = newCmdId('st');
  ui.stops.set(id, { key, at: Date.now() });
  renderNow();
  try {
    await command({ ...body, id });
    setTimeout(invalidate, ACK_WAIT + 50);
  } catch (err) {
    ui.stops.delete(id);
    toast(err.message);
  }
  renderNow();
}

/** Whether a stop of the target keyed `key` sent from here waits on its ack. */
const isStopping = key => [...ui.stops.values()].some(s => s.key === key && Date.now() - s.at < ACK_WAIT);

/** The stops sent from here whose ack the state now holds: each said once, as a toast. */
function noteStops() {
  for (const [id, s] of ui.stops) {
    const k = IX.acks.get(id);
    if (k) {
      ui.stops.delete(id);
      toast(k.ok ? k.text : lead('Not stopped', k.text));
    } else if (Date.now() - s.at > ACK_WAIT) ui.stops.delete(id);
  }
}

/** Stop turn, at the right of the header while the main loop's turn runs: `$.turn.abort` of it, as Esc in Claude Code does. */
function StopTurn() {
  const busy = isStopping('turn');
  return h('button', {
    key: 'stopturn', type: 'button', class: 'stop-btn stop-turn', disabled: busy,
    title: 'End the Orchestrator\'s turn, and the foreground agents with it, as Esc in Claude Code does',
    onClick: () => sendStop('turn', { cmd: 'abortTurn', turnId: S.header.turn.id }),
  }, icon('square', 'stop-ic'), busy ? 'Stopping…' : 'Stop turn');
}

/** Stop on a background agent or a teammate: Claude Code's own TaskStop of it. */
function StopAgent(a, cls) {
  const busy = isStopping(`agent:${a.id}`);
  return h('button', {
    key: 'stop', type: 'button', class: cls, disabled: busy, title: `Stop ${a.title}: Claude Code's own TaskStop`,
    onClick: e => { stop(e); sendStop(`agent:${a.id}`, { cmd: 'stopAgent', agentId: a.id }); },
  }, icon('square', 'stop-ic'), busy ? 'Stopping…' : a.stop.label);
}

/** A run card, with its Stop beside it where Claude Code allows one (a card is a button, so its Stop sits over its corner, not in it). */
function CardOf(a) {
  if (!a.stop || !a.stop.can) return RunCard(a);
  return h('div', { key: `wrap:${a.id}`, class: 'run-wrap' }, RunCard(a), StopAgent(a, 'stop-btn run-stop'));
}

// ------------------------------------------------------------- background
// What runs when no agent is talking (v2's `background`): background shells,
// monitors, workflows, crons and wakeups, from the calls that start them and
// Claude Code's own snapshots. Shown only while something runs or is
// scheduled; its line of counts at the head's right.

const BG_ICON = { shell: 'terminal', monitor: 'eye', workflow: 'workflow', agent: 'bot', other: 'circle', cron: 'clock', wakeup: 'timer' };

/** When a row says it runs, on the page's clock: a task's age since its call started it (none for one first seen in a snapshot), a schedule's next run. */
function bgWhen(x) {
  if (x.status !== 'scheduled') return x.by ? ageOf(x.at) : '';
  if (x.nextAt == null) return '';
  const left = x.nextAt - liveNow();
  if (left > 0) { const t = since(left); return `in ${t === 'now' ? '<1m' : t}`; }
  return x.recurring ? '' : 'due';
}

/** A row's status, in its hue: a task's (running blue, else its word), a schedule's "scheduled". */
function BgStatus(x) {
  const scheduled = x.status === 'scheduled', running = x.status === 'running';
  return h('span', { class: `bg-status${scheduled ? ' is-scheduled' : running ? '' : ' is-other'}` },
    scheduled ? icon('clock', 'bg-st-ic') : Glyph(running ? 'active' : 'pending', 12), x.status);
}

function BgRow(x) {
  const scheduled = x.status === 'scheduled';
  const key = `bg:${x.id}`;
  const busy = isStopping(key);
  const next = x.nextAt != null ? `Next run ${new Date(x.nextAt).toLocaleString()}` : '';
  return h('div', { key: x.id, id: `bg-${x.id}`, class: `bg-row${scheduled ? ' is-scheduled' : ''}` },
    icon(BG_ICON[x.kind] || 'circle', 'bg-ic'),
    h('span', { class: 'bg-main' },
      h('span', { class: 'bg-top' },
        h('span', { class: `bg-title${x.kind === 'shell' ? ' mono' : ''}`, title: x.title }, x.title),
        x.what && h('span', { class: 'bg-what', title: [x.what, x.schedule].filter(Boolean).join(' · ') }, x.what)),
      x.by && h('span', { class: 'bg-by' }, 'started by ', NameLink(x.by, 14))),
    BgStatus(x),
    h('span', { class: 'bg-when', title: next }, bgWhen(x)),
    h('span', { class: 'bg-act' },
      x.stop && x.stop.can && h('button', {
        type: 'button', class: 'btn btn-xs bg-stop', disabled: busy, title: `${x.stop.label}: Claude Code's own ${x.stop.tool}`,
        onClick: () => sendStop(key, { cmd: 'stopBackground', bgId: x.id }),
      }, busy ? '…' : x.stop.label)));
}

function BackgroundSection() {
  const bg = S.background;
  if (!bg || !bg.rows.length) return null;
  return Section('background', 'Background', bg.rows.length, bg.text ? h('span', { class: 'sec-note' }, bg.text) : null, () =>
    h('div', { class: 'card list bg-list' }, bg.rows.map(BgRow)));
}

// ----------------------------------------------------------------- figures
// The session's numbers, as the state counts them (v2's `figures`): the
// agents in each state, the plan's items done (only with a plan), the spend,
// and what waits on you.

/** What a need is, in one line: "Orchestrator asks: Which store…?", "builder needs permission: npm test". */
function needLine(n) {
  const who = n.agentName || nameOf(n.agent);
  if (n.kind === 'question') return `${who} asks: ${needGist(n)}`;
  if (n.kind === 'permission') return `${who} needs permission: ${needGist(n)}`;
  return [n.title, n.text].filter(Boolean).join(': ');
}

function Figure(ic, value, label, desc, go) {
  const body = [
    h('span', { key: 'main', class: 'kpi-main' },
      h('span', { class: 'kpi-value' }, String(value)),
      h('span', { class: 'kpi-label' }, label),
      h('span', { class: 'kpi-desc', title: desc }, desc)),
    icon(ic, 'kpi-ic'),
  ];
  return go ? h('button', { key: label, type: 'button', class: 'kpi', onClick: go }, body) : h('div', { key: label, class: 'kpi' }, body);
}

function FiguresStrip() {
  const f = S.figures;
  if (!f) return null;
  const counts = [`${f.waiting} waiting`, `${f.done} done`, `${f.failed} failed`];
  if (f.stopped) counts.push(`${f.stopped} stopped`);
  const spend = [
    f.tokens != null && `${num(f.tokens)} tokens`,
    f.minutes != null && (f.minutes < 1 ? '<1 min' : `${Math.round(f.minutes)} min`),
    f.contextPercent != null && `context ${Math.round(f.contextPercent)}%`,
  ].filter(Boolean);
  const first = S.needs[0];
  const tiles = [
    Figure('bot', f.running, 'Agents running', counts.join(' · '), () => navigate('org')),
    f.plan && Figure('listChecks', `${f.plan.done}/${f.plan.total}`, 'Plan done', f.plan.done >= f.plan.total ? 'All done' : `${f.plan.total - f.plan.done} to go`,
      S.plan ? () => { setShut('plan', false); scrollSoon('sec-plan', 'now'); } : null),
    Figure('dollar', usd(f.costUsd), 'Session spend', spend.join(' · ') || '—'),
    Figure('hand', f.needs, 'Waiting on you', first ? needLine(first) : 'Nothing waits on you', first ? () => goToNeed(first) : null),
  ].filter(Boolean);
  return h('div', { key: 'figures', class: 'kpis', style: { '--n': String(tiles.length) }, role: 'group', 'aria-label': 'Figures' }, tiles);
}

// ----------------------------------------------------------- recent activity

/** A tool call's verb on the activity line: "ran", "edited"; a tool with none "used <tool> on". */
const TOOL_VERB = { Read: 'read', Edit: 'edited', MultiEdit: 'edited', NotebookEdit: 'edited', Write: 'wrote', Bash: 'ran', PowerShell: 'ran', Grep: 'searched', Glob: 'listed', WebFetch: 'fetched', WebSearch: 'searched the web for', Agent: 'started', Task: 'started', SendMessage: 'messaged', TodoWrite: 'updated its todos', TaskCreate: 'added the task', TaskUpdate: 'updated', TaskGet: 'read', TaskList: 'read', ToolSearch: 'loaded', Skill: 'used', AskUserQuestion: 'asked you:' };
/** Tools whose verb says it all: their words would only repeat it. */
const VERB_ONLY = new Set(['TodoWrite']);
/** The activity's words in the mono face: a path or a pattern (a shell call's words are what it says it does). */
const FEED_MONO = new Set(['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Glob', 'Grep']);

function ActivityRow(x) {
  const a = IX.byId.get(x.agent);
  const isSaid = x.kind === 'said';
  const verb = isSaid ? 'said' : TOOL_VERB[x.tool] || `used ${x.tool}${x.text ? ' on' : ''}`;
  const said = VERB_ONLY.has(x.tool) ? '' : x.text;
  return h('button', {
    key: x.id, type: 'button', class: `ra-row${isSaid ? ' is-said' : ''}`, 'data-nav': 'activity', enter: true, title: isSaid ? `“${oneLine(x.text)}”` : `${x.tool} ${x.text}`.trim(),
    onClick: () => { if (a) openAgent(a.id); },
  },
  whoAvatar(x.agent, 22),
  h('span', { class: 'ra-text' },
    h('span', { class: 'ra-who' }, x.agentName || nameOf(x.agent)), ' ',
    h('span', { class: 'ra-verb' }, verb), ' ',
    // its words, quoted in italics: what it said between its calls
    isSaid ? h('span', { class: 'ra-said' }, '“', inline(oneLine(x.text)), '”') : said && h('span', { class: `ra-target${FEED_MONO.has(x.tool) ? ' mono' : ''}` }, said)),
  isSaid ? h('span', { class: 'outcome' }) : Outcome(a || { status: 'done' }, x),
  h('span', { class: 'ra-time', title: x.at ? new Date(x.at).toLocaleString() : '' }, ageOf(x.at)));
}

function ActivitySection() {
  const list = S.activity.slice(0, 10);
  return Section('activity', 'Recent activity', null, null, () => (list.length
    ? h('div', { class: 'card list feed' }, list.map(ActivityRow))
    : h('div', { class: 'card' }, Empty('activity', 'No tool calls yet', 'Every agent\'s tool calls show here as they happen.'))));
}

// ------------------------------------------------------------------- files

/** Takes Changes to file `path`, open: git's file, else the agents' other edit of it (outside the repo, its fold opened too). */
function openFile(f) {
  const inGit = IX.gitPaths.has(f.path);
  ui.open.set(inGit ? `git|${f.path}` : `other|${f.path}`, true);
  if (!inGit && f.isOutside) ui.open.set('outside|changes', true);
  setShut(inGit ? 'uncommitted' : 'other', false);
  navigate('changes', isWide() ? route.drawer : null);
  scrollSoon(`file-${f.path}`, 'changes');
}

function FileRow(f) {
  return h('button', { key: f.path, type: 'button', class: 'file-row', 'data-nav': 'file', onClick: () => openFile(f) },
    icon('file', 'fic'),
    PathText(f.isOutside ? shortPath(f.path) : f.path, 'grow', f.path),
    f.editors.length >= 2 && h('span', { class: 'tag tag-wait', title: 'More than one agent edited this file' }, 'shared'),
    f.editors.length > 0 && AvatarStack(f.editors, 18),
    DiffStat(f.added, f.removed),
    h('span', { class: 'file-time', title: f.lastAt ? new Date(f.lastAt).toLocaleString() : '' }, ageOf(f.lastAt)));
}

/** The files the agents touched: the repository's ten edited last, the rest a click away, then one dim row for those outside it. */
function FilesSection() {
  const own = S.files.filter(f => !f.isOutside), outside = S.files.filter(f => f.isOutside);
  const rest = own.length - 10;
  const link = S.files.length ? h('a', { class: 'sec-link', href: hrefOf('changes', route.drawer) }, 'Changes', icon('arrowRight')) : null;
  const moreKey = 'more|files', more = rest > 0 && isOpen(moreKey, false);
  return Section('files', 'Files', own.length || null, link, () => (S.files.length
    ? h('div', { class: 'card list files' },
      (more ? own : own.slice(0, 10)).map(FileRow),
      rest > 0 && h('button', { key: moreKey, class: `outside-row${more ? ' open' : ''}`, type: 'button', 'aria-expanded': more ? 'true' : 'false', onClick: () => toggle(moreKey) },
        icon('chevronRight', 'chev'), h('span', { class: 'outside-text' }, more ? 'Show the ten edited last' : `${plural(rest, 'more file')}`)),
      OutsideRows(outside.length, 'now', () => outside.map(FileRow)))
    : h('div', { class: 'card' }, Empty('file', 'No files touched yet', 'Files the agents edit show here, with who is on each.'))));
}

// ======================================================================== org
// Every agent under the one that started it: the org chart (pan, zoom, fit)
// or, toggled, the list, the state's tree with its folds.

function OrgPage() {
  const view = ui.orgView;
  const setView = v => { ui.orgView = v; store.set('orgView', v); renderNow(); };
  const Toggle = (id, ic, label) => h('button', { key: id, type: 'button', class: view === id ? 'on' : '', 'aria-pressed': view === id ? 'true' : 'false', title: label, onClick: () => setView(id) }, icon(ic), h('span', null, label));
  // the agents Clear finished hid are no part of the chart
  const count = st => IX.shown.filter(r => stateOf(r) === st || (st === 'running' && r.status === 'starting')).length;
  const counts = [plural(IX.shown.length, 'agent')];
  for (const [st, word] of [['running', 'running'], ['waiting', 'waiting on you'], ['failed', 'failed'], ['stopped', 'stopped']]) if (count(st)) counts.push(`${count(st)} ${word}`);
  if (S.cleared.count) counts.push(`${S.cleared.count} cleared`);
  const said = view === 'timeline' && tl.data ? timelineSummary(tl.data) : counts.join(' · ');
  return h('div', { key: 'org', class: `page page-org view-${view}` },
    h('div', { key: 'bar', class: 'org-bar' },
      h('p', { class: 'org-count' }, said),
      h('div', { class: 'seg-toggle', role: 'group', 'aria-label': 'Show the agents as' }, Toggle('chart', 'org', 'Chart'), Toggle('list', 'list', 'List'), Toggle('timeline', 'gantt', 'Timeline'))),
    !IX.shown.length
      ? h('div', { key: 'none', class: 'card' }, Empty('org', 'No agents yet', 'The Orchestrator and the agents it starts show here, each under the one that started it.'))
      : view === 'list' ? h('div', { key: 'tree', class: 'card tree' }, treeRows().map(r => (r.row === 'fold' ? FoldRow(r) : AgentRow(r)))) : view === 'timeline' ? TimelineView() : OrgChart());
}

// ------------------------------------------------------------ the timeline
// Org's Timeline (web/CONTRACT.md, "The timeline"): one lane an agent from
// its start to its end (or to now), the Orchestrator first, from /timeline
// (timeline.json, which the mod writes before the state that follows it).
// Every span, tick and mark is a time Claude Code reported. A hover says what
// a stretch, a call, a prompt or a message was; a press on a lane opens its
// agent's drawer.

const tl = { data: null, status: 'loading', error: '', loadedFor: -1, loading: false, tries: 0, width: 0, box: null, tip: null, geo: null };
const TL_KINDS = new Set(['work', 'wait', 'idle']);
const TL_WORD = { work: 'Working', wait: 'Waiting on you', idle: 'Idle' };
const OUTCOME_WORD = { done: 'Done', failed: 'Failed', stopped: 'Stopped' };

/** The timeline as the page reads it, each part in its own shape: its times stay ms after `startedAt`. */
function timelineFrom(d) {
  d = obj(d) || {};
  const tools = arr(d.tools).map(str);
  const lanes = arr(d.lanes).filter(l => l && typeof l.id === 'string').map(l => ({
    id: l.id, title: str(l.title) || l.id, parent: typeof l.parent === 'string' ? l.parent : null, depth: numOr(l.depth, 0),
    status: str(l.status), isStopped: l.isStopped === true, start: numOr(l.start, 0), end: numOr(l.end),
    outcome: OUTCOME_WORD[l.outcome] ? l.outcome : null,
    spans: arr(l.spans).filter(s => s && TL_KINDS.has(s.kind)).map(s => ({ kind: s.kind, from: numOr(s.from, 0), to: numOr(s.to) })),
    ticks: arr(l.ticks).filter(t => Array.isArray(t) && t.length >= 4).map(t => ({ at: numOr(t[0], 0), ms: numOr(t[1], -1), tool: tools[t[2]] || '', how: numOr(t[3], -1), text: str(t[4]) })),
  }));
  return {
    now: numOr(d.now, 0), startedAt: numOr(d.startedAt, 0), lanes,
    marks: arr(d.marks).filter(m => m && typeof m.at === 'number').map(m => ({ at: m.at, id: str(m.id), text: str(m.text) })),
    messages: arr(d.messages).filter(m => m && typeof m.at === 'number' && typeof m.from === 'string' && typeof m.to === 'string').map(m => ({ at: m.at, from: m.from, to: m.to, id: str(m.id), title: str(m.title) })),
    background: arr(d.background).filter(b => b && typeof b.start === 'number').map(b => ({ id: str(b.id), title: str(b.title), what: str(b.what), start: b.start, end: numOr(b.end) })),
  };
}

/** The timeline for the state shown: read again once per state (the mod wrote it before that state), the last one read kept while the next loads. */
function timelineNow() {
  const want = S.now;
  if (tl.loading || tl.loadedFor === want) return tl;
  tl.loading = true;
  fetch(`/timeline${QT}`, { headers: AUTH, cache: 'no-store' })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'The timeline is not on disk yet.' : `The server answered ${r.status}.`))))
    .then(text => { tl.data = timelineFrom(JSON.parse(text)); tl.status = 'ok'; tl.error = ''; tl.tries = 0; tl.loadedFor = want; })
    .catch(e => {
      // a file read while the mod rewrote it is torn: read it again in a moment, a few times
      if (!tl.data) tl.status = 'error';
      tl.error = e instanceof SyntaxError ? 'Could not read the timeline.' : e.message || 'Could not load the timeline.';
      if (++tl.tries <= 3) setTimeout(invalidate, 400 * tl.tries);
      else tl.loadedFor = want;
    })
    .finally(() => { tl.loading = false; invalidate(); });
  return tl;
}

/** How long the axis runs, ms: from its start to now on the page's own clock (a minute at least). */
const tlSpanOf = d => Math.max(60000, d.now - d.startedAt, liveNow() - d.startedAt);
const TL_STEPS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map(s => s * 1000);
/** A gridline's words, its time after the axis's start (hooks/ui/v2/timeline.tsx `axisLabelOf`): "0m", "10m", "1h 30m"; "30s" under a minute. */
function tlLabel(ms) {
  if (ms > 0 && ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60);
  return m % 60 ? `${hr}h ${m % 60}m` : `${hr}h`;
}
/** "42m · 8 agents · 2 in the background". */
function timelineSummary(d) {
  const parts = [tlLabel(tlSpanOf(d)), plural(d.lanes.length, 'agent')];
  if (d.background.length) parts.push(`${d.background.length} in the background`);
  return parts.join(' · ');
}
/** `s` cut with "…" to `n` characters. */
const tlCut = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
/** A time of day, to the second. */
const clockText = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The lanes the page draws: the timeline's, less any Clear finished hid since it was written. */
const tlLanesOf = d => d.lanes.filter(l => l.id === 'main' || !IX.byId.has(l.id) || !IX.byId.get(l.id).isCleared);

function TimelineView() {
  const t = timelineNow();
  if (!t.data) {
    return h('div', { key: 'tl', class: 'card tl tl-loading', ref: el => { tl.box = el; } },
      t.status === 'error' ? Empty('gantt', 'No timeline', t.error) : h('p', { class: 'muted small' }, 'Reading the timeline…'));
  }
  const d = t.data;
  const lanes = tlLanesOf(d);
  const W = Math.max(520, Math.round(tl.width || 1000));
  const L = clamp(Math.round(W * 0.16), 120, 200);
  const LANE = 30, TOP = 30, right = W - 20;
  const span = tlSpanOf(d);
  const X = ms => L + ((right - L) * clamp(ms, 0, span)) / span;
  const yOf = i => TOP + i * LANE + LANE / 2;
  const bgTop = TOP + lanes.length * LANE + 10;
  const bottom = d.background.length ? bgTop + 16 + d.background.length * LANE : TOP + lanes.length * LANE;
  const H = bottom + 10;
  tl.geo = { L, right, TOP, LANE, span, lanes, bgTop, d, X, yOf };
  const index = new Map(lanes.map((l, i) => [l.id, i]));
  const n = v => Math.round(v * 10) / 10;
  const out = [];
  // the axis: gridlines and their words, then now
  let step = TL_STEPS[TL_STEPS.length - 1];
  for (const s of TL_STEPS) if ((s / span) * (right - L) >= 64) { step = s; break; }
  const nowX = X(span);
  for (let ms = 0; ms <= span; ms += step) {
    const x = n(X(ms));
    out.push(h('line', { key: `g${ms}`, class: 'tl-grid', x1: x, x2: x, y1: 20, y2: bottom }));
    if (nowX - x > 30) out.push(h('text', { key: `gl${ms}`, class: 'tl-axis', x, y: 13, 'text-anchor': 'middle' }, tlLabel(ms)));
  }
  out.push(h('line', { key: 'now', class: 'tl-now', x1: n(nowX), x2: n(nowX), y1: 20, y2: bottom }));
  out.push(h('text', { key: 'nowl', class: 'tl-axis tl-now-word', x: n(nowX), y: 13, 'text-anchor': 'end' }, 'now'));
  // spawns: from the parent's lane at the child's start
  lanes.forEach((l, i) => {
    const at = l.parent != null ? index.get(l.parent) : undefined;
    if (at === undefined) return;
    const x = n(X(l.start));
    const [a, b] = at < i ? [yOf(at) + 6, yOf(i) - 7] : [yOf(at) - 6, yOf(i) + 7];
    out.push(h('path', { key: `sp:${l.id}`, class: 'tl-spawn', d: `M${x} ${a}V${b}` }));
  });
  // each lane: its name (a link to its drawer), its stretches, its calls, its outcome
  lanes.forEach((l, i) => {
    const y = yOf(i);
    const st = l.isStopped ? 'stopped' : l.status;
    out.push(h('rect', { key: `hit:${l.id}`, class: `tl-row${isAgentOpen(l.id) ? ' on' : ''}`, x: 0, y: y - LANE / 2, width: W, height: LANE }));
    out.push(h('a', { key: `name:${l.id}`, class: 'tl-name', href: hrefOf('org', { kind: 'agent', id: l.id }), 'aria-label': `${l.title}, ${statusOf(st).label}: open its drawer` },
      h('text', { x: Math.min(l.depth, 4) * 10, y: y + 4 }, tlCut(l.title, Math.max(8, Math.floor((L - Math.min(l.depth, 4) * 10 - 12) / 6.8))))));
    for (const s of l.spans) {
      const a = X(s.from), b = X(s.to == null ? span : s.to);
      if (s.kind === 'idle') out.push(h('line', { key: `s:${l.id}:${s.kind}:${s.from}`, class: 'tl-idle', x1: n(a), x2: n(b), y1: y, y2: y }));
      else out.push(h('rect', { key: `s:${l.id}:${s.kind}:${s.from}`, class: `tl-${s.kind}`, x: n(a), y: y - 6, width: n(Math.max(3, b - a)), height: 12, rx: 6 }));
    }
    const ok = [], bad = [];
    let last = -Infinity;
    for (const k of l.ticks) {
      const x = X(k.at);
      if (k.how === 0) { bad.push(`M${n(x)} ${y - 5}v10`); continue; }
      if (x - last < 2) continue;
      ok.push(`M${n(x)} ${y - 4}v8`);
      last = x;
    }
    if (ok.length) out.push(h('path', { key: `t:${l.id}`, class: 'tl-tick', d: ok.join('') }));
    if (bad.length) out.push(h('path', { key: `tf:${l.id}`, class: 'tl-tick-fail', d: bad.join('') }));
    if (l.end != null && l.outcome) {
      const x = X(l.end);
      if (l.outcome === 'done') out.push(h('circle', { key: `o:${l.id}`, class: 'tl-done', cx: n(x), cy: y, r: 5 }));
      else if (l.outcome === 'failed') out.push(h('path', { key: `o:${l.id}`, class: 'tl-failed', d: `M${n(x - 4.5)} ${y - 4.5}l9 9M${n(x + 4.5)} ${y - 4.5}l-9 9` }));
      else out.push(h('rect', { key: `o:${l.id}`, class: 'tl-stopped', x: n(x - 4.5), y: y - 4.5, width: 9, height: 9, rx: 1.5 }));
    }
  });
  // your prompts, on the Orchestrator's lane
  const main = index.get('main');
  if (main !== undefined) d.marks.forEach(m => out.push(h('path', { key: `m:${m.id}:${m.at}`, class: 'tl-you', d: `M${n(X(m.at))} ${yOf(main) - 10}l5.5 5.5-5.5 5.5-5.5-5.5z` })));
  // messages between agents: an arrow from the sender's lane to the receiver's; the newest few named where they fit
  const msgs = d.messages.filter(m => index.has(m.from) && index.has(m.to));
  const taken = [];
  msgs.forEach((m, k) => {
    const a = index.get(m.from), b = index.get(m.to), x = X(m.at), down = b > a;
    out.push(h('path', { key: `msg:${m.id}`, class: 'tl-msg', d: `M${n(x)} ${yOf(a) + (down ? 7 : -7)}V${yOf(b) + (down ? -9 : 9)}`, 'marker-end': 'url(#tl-arrow)' }));
    if (msgs.length - k > 3) return;
    const words = `${lanes[a].title} → ${lanes[b].title}: “${m.title}”`;
    const w = Math.min(words.length * 5.6, x - L - 6);
    const ly = yOf(a) + (down ? 18 : -11);
    if (w < 60 || taken.some(o => Math.abs(o.y - ly) < 12 && o.x0 < x && x - w - 6 < o.x1)) return;
    taken.push({ x0: x - w - 6, x1: x, y: ly });
    out.push(h('text', { key: `msgl:${m.id}`, class: 'tl-msg-word', x: n(x - 5), y: ly, 'text-anchor': 'end' }, tlCut(words, Math.floor(w / 5.6))));
  });
  // the background shells, under the agents
  if (d.background.length) {
    out.push(h('text', { key: 'bg', class: 'tl-bg-head', x: 0, y: bgTop + 4 }, 'BACKGROUND'));
    d.background.forEach((b, i) => {
      const y = bgTop + 16 + i * LANE + LANE / 2 - 4;
      out.push(h('text', { key: `bgn:${b.id}`, class: 'tl-bg-name', x: 0, y: y + 4 }, tlCut(b.title, Math.floor((L - 12) / 6.8))));
      const a = X(b.start);
      out.push(h('rect', { key: `bgr:${b.id}`, class: 'tl-bg', x: n(a), y: y - 4, width: n(Math.max(3, X(b.end == null ? span : b.end) - a)), height: 8, rx: 4 }));
    });
  }
  return h('div', { key: 'tl', class: 'card tl', ref: el => { tl.box = el; } },
    h('svg', {
      key: 'svg', class: 'tl-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': `The timeline: ${timelineSummary(d)}. Hover a stretch, a call or a mark to read it; press a lane to open its agent.`,
      onMouseMove: tlHover, onMouseLeave: tlLeave, onClick: tlPress,
    },
    h('defs', { key: 'defs' }, h('marker', { id: 'tl-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, h('path', { d: 'M0 0L10 5L0 10z', class: 'tl-arrowhead' }))),
    out),
    // its words are written by tlHover only: a vnode child here would fight it
    h('div', { key: 'tip', class: 'tl-tip', role: 'tooltip', ref: el => { tl.tip = el; } }),
    TimelineLegend(d, lanes));
}

/** What the drawing holds, and only that. */
function TimelineLegend(d, lanes) {
  const has = kind => lanes.some(l => l.spans.some(s => s.kind === kind));
  const sw = (key, ...kids) => h('svg', { class: 'tl-sw', width: 18, height: 12, viewBox: '0 0 18 12', 'aria-hidden': 'true' }, kids);
  const items = [
    has('work') && ['work', 'working', sw('w', h('rect', { class: 'tl-work', x: 1, y: 2, width: 16, height: 8, rx: 4 }))],
    has('wait') && ['wait', 'waiting on you', sw('a', h('rect', { class: 'tl-wait', x: 1, y: 2, width: 16, height: 8, rx: 4 }))],
    has('idle') && ['idle', 'idle', sw('i', h('line', { class: 'tl-idle', x1: 1, x2: 17, y1: 6, y2: 6 }))],
    lanes.some(l => l.outcome === 'done') && ['done', 'done', sw('d', h('circle', { class: 'tl-done', cx: 9, cy: 6, r: 4.5 }))],
    lanes.some(l => l.outcome === 'failed') && ['failed', 'failed', sw('f', h('path', { class: 'tl-failed', d: 'M5 2l8 8M13 2l-8 8' }))],
    lanes.some(l => l.outcome === 'stopped') && ['stopped', 'stopped', sw('s', h('rect', { class: 'tl-stopped', x: 5, y: 2, width: 8, height: 8, rx: 1.5 }))],
    d.marks.length && ['you', 'you wrote', sw('y', h('path', { class: 'tl-you', d: 'M9 0.5l5.5 5.5-5.5 5.5-5.5-5.5z' }))],
    lanes.some(l => l.ticks.length) && ['tick', 'a tool call', sw('t', h('rect', { class: 'tl-work', x: 1, y: 2, width: 16, height: 8, rx: 4 }), h('path', { class: 'tl-tick', d: 'M9 2.5v7' }))],
    lanes.some(l => l.parent != null) && ['spawn', 'started by', sw('p', h('path', { class: 'tl-spawn', d: 'M9 0v12' }))],
    d.messages.length && ['msg', 'a message', sw('m', h('path', { class: 'tl-msg', d: 'M9 0v8', 'marker-end': 'url(#tl-arrow)' }))],
  ].filter(Boolean);
  return h('div', { key: 'legend', class: 'tl-legend' }, items.map(([key, label, swatch]) => h('span', { key, class: 'tl-key' }, swatch, label)));
}

/** What sits under the pointer at (x, y) of the drawing: a prompt, a message, a call, an outcome, a stretch or a background task, as lines of words; null for nothing. */
function tlWhat(x, y) {
  const g = tl.geo;
  if (!g) return null;
  const { L, TOP, LANE, span, lanes, d, X } = g;
  const abs = ms => d.startedAt + ms;
  const near = (at, px) => Math.abs(X(at) - x) <= px;
  // a background task, under the agents: what Claude Code said of it, from its call to now
  if (d.background.length && y >= g.bgTop + 16) {
    const b = d.background[Math.floor((y - g.bgTop - 16) / LANE)];
    if (!b) return null;
    const end = b.end == null ? span : b.end;
    return [b.what ? `${b.what}: ${b.title}` : b.title, `${clockText(abs(b.start))} – ${b.end == null ? 'now' : clockText(abs(b.end))} · ${dur(Math.max(0, end - b.start))}`];
  }
  const i = Math.floor((y - TOP) / LANE);
  const l = lanes[i];
  if (!l) return null;
  const st = l.isStopped ? 'stopped' : l.status;
  if (x < L) return [l.title, `${statusOf(st).label[0].toUpperCase()}${statusOf(st).label.slice(1)} · press to open`];
  if (l.id === 'main') {
    const m = d.marks.find(one => near(one.at, 6));
    if (m) return [`You: ${m.text}`, clockText(abs(m.at))];
  }
  const msg = d.messages.find(one => near(one.at, 4) && [one.from, one.to].includes(l.id));
  if (msg) return [`${nameOf(msg.from)} → ${nameOf(msg.to)}: ${msg.title}`, clockText(abs(msg.at))];
  let tick = null, best = 5;
  for (const k of l.ticks) { const dx = Math.abs(X(k.at) - x); if (dx <= best) { best = dx; tick = k; } }
  if (tick) {
    const how = tick.how === 0 ? `failed after ${msText(tick.ms)}` : tick.ms >= 0 ? msText(tick.ms) : tick.how < 0 && l.end == null ? 'running' : 'its end not seen';
    return [[tick.tool, tick.text].filter(Boolean).join(' '), `${clockText(abs(tick.at))} · ${how}`];
  }
  if (l.end != null && l.outcome && near(l.end, 6)) return [`${OUTCOME_WORD[l.outcome]}: ${l.title}`, clockText(abs(l.end))];
  const at = ((x - L) / (g.right - L)) * span;
  const order = { wait: 0, work: 1, idle: 2 };
  const s = l.spans.filter(one => one.from <= at && (one.to == null ? span : one.to) >= at).sort((a, b) => order[a.kind] - order[b.kind])[0];
  if (!s) return null;
  const end = s.to == null ? null : s.to;
  return [`${TL_WORD[s.kind]}: ${l.title}`, `${clockText(abs(s.from))} – ${end == null ? 'now' : clockText(abs(end))} · ${dur(Math.max(0, (end == null ? span : end) - s.from))}`];
}

function tlHover(e) {
  const tip = tl.tip;
  if (!tip) return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const lines = tlWhat(x, y);
  if (!lines) { tip.classList.remove('on'); return; }
  tip.replaceChildren(...lines.map((text, i) => { const el = document.createElement('div'); el.className = i ? 'tl-tip-sub' : 'tl-tip-head'; el.textContent = text; return el; }));
  tip.classList.add('on');
  const box = tl.box ? tl.box.getBoundingClientRect() : r;
  const left = e.clientX - box.left, top = e.clientY - box.top;
  const w = tip.offsetWidth || 240;
  tip.style.left = `${Math.max(8, left + 14 + w > box.width ? left - 14 - w : left + 14)}px`;
  tip.style.top = `${top + 16}px`;
}

function tlLeave() {
  if (tl.tip) tl.tip.classList.remove('on');
}

/** A press on a lane opens its agent's drawer (its name is a link that does the same). */
function tlPress(e) {
  const g = tl.geo;
  if (!g || e.target.closest('a')) return;
  const r = e.currentTarget.getBoundingClientRect();
  const l = g.lanes[Math.floor((e.clientY - r.top - g.TOP) / g.LANE)];
  if (l) openAgent(l.id);
}

// ---------------------------------------------------------------- the list

/** The rows the list draws: a fold row's members only while it is open. */
function treeRows() {
  const shown = [], hidden = new Set();
  for (const r of S.agents) {
    // what Clear finished hid is no row of the list (the mod's fold rows count it out already)
    if (r.row === 'agent' && r.isCleared) { hidden.add(r.id); continue; }
    const hide = r.row === 'fold' ? hidden.has(r.parent) : !!r.fold && !isOpen(`fold|${r.fold}`, false);
    if (hide) hidden.add(r.id);
    else shown.push(r);
  }
  return shown;
}

/** An agent's elapsed time: the state's words, kept current on the page's clock while it is at work (the mod's elapsedOf). */
function elapsedOf(a) {
  if (!a.elapsed || a.endedAt != null || !isLive(a.status)) return a.elapsed;
  const from = a.id === 'main' ? (S.header.turn && S.header.turn.at) : runStartOf(a);
  if (!from) return a.elapsed;
  const ms = Math.max(0, liveNow() - from);
  return ms < 60000 ? '<1m' : dur(ms);
}

const ROW_WORD = { done: 'Done', failed: 'Failed', stopped: 'Stopped', idle: 'Idle', starting: 'Starting', waiting: 'Waiting on you', running: '' };

/** A row's line: its call in flight, verbatim; else, while it is at work, its words since its latest call; else its status and its own last words (its result, else its description). */
function LineOf(a) {
  if (a.live) {
    return [
      h('span', { key: 'tool', class: 'arow-tool' }, a.live.tool),
      h('span', { key: 'text', class: `arow-text${PATHY.has(a.live.tool) ? ' mono' : ''}` }, a.live.text),
    ];
  }
  if (a.said) return h('span', { key: 'said', class: 'arow-text' }, Words(firstLine(a.said.text)));
  const st = stateOf(a);
  // its description says nothing new when it is the row's title already: its task does
  const said = a.result ? firstLine(a.result) : a.description && a.description !== a.title ? a.description : firstLine(a.task);
  return [
    ROW_WORD[st] && h('span', { key: 'st', class: `arow-st st-${st}` }, ROW_WORD[st]),
    said && h('span', { key: 'said', class: 'arow-text' }, inline(said)),
  ];
}

/** The tree's guides: a rail per level above the row, which line up across rows into who-started-whom. */
function Rails(depth) {
  const out = [];
  for (let l = 1; l <= depth; l++) out.push(h('span', { key: `r${l}`, class: 'rail', style: { '--l': String(l) } }));
  return out;
}

function AgentRow(a) {
  const st = stateOf(a);
  return h('button', {
    key: a.id, type: 'button', class: `arow is-${st}${isAgentOpen(a.id) ? ' on' : ''}`, style: { '--d': String(a.depth) }, 'data-nav': 'agent',
    title: `${a.title} · ${statusOf(st).label}`, onClick: () => openAgent(a.id),
  },
  Rails(a.depth),
  AvatarDot(a, 20),
  h('span', { class: 'arow-name' }, a.title),
  h('span', { class: 'arow-line' }, LineOf(a)),
  h('span', { class: 'arow-time' }, elapsedOf(a)));
}

function FoldRow(f) {
  const key = `fold|${f.id}`, open = isOpen(key, false);
  return h('button', {
    key: f.id, type: 'button', class: `frow${open ? ' open' : ''}`, style: { '--d': String(f.depth) }, 'data-nav': 'fold',
    'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key),
  },
  Rails(f.depth),
  icon('chevronRight', 'chev'),
  h('span', { class: 'frow-text' }, f.text),
  AvatarStack(f.ids, 16, 6));
}

// --------------------------------------------------------------- the chart
// The org chart: every agent row as a card under the one that started it,
// over elbow connectors. Pan by drag or scroll, zoom with +/−/fit.

const CW = 208, CH = 104, GX = 24, GY = 64, PAD = 48;
const org = { x: 0, y: 0, k: 1, touched: false, fit: 'open', sig: '', view: null, world: null, label: null, size: '' };
/** The chart's margin from the canvas's edges when it fits itself, and the smallest zoom it opens at: cards stay readable. */
const FIT_MARGIN = 16, OPEN_ZOOM = 0.85;
let drag = null, suppressClick = false;

/** How many cards a wrapped level holds: what the viewport fits, 2 to 4 (an even 2 or 4 keeps the trunk in a gap). */
function rowMaxFor() {
  const w = org.view && org.view.isConnected ? org.view.clientWidth : scroller ? scroller.clientWidth - 48 : 1100;
  const fit = Math.floor((w - 2 * PAD + GX) / (CW + GX));
  return fit >= 4 ? 4 : fit >= 3 ? 3 : 2;
}

function layoutOrg() {
  const ROW_MAX = rowMaxFor();
  const box = new Map();
  const measure = a => {
    const kids = IX.kids.get(a.id) || [];
    if (!kids.length) { box.set(a.id, { w: CW, h: CH, cx: CW / 2, rows: [] }); return; }
    kids.forEach(measure);
    // A wide level wraps into rows; agents with subtrees of their own go last, so the trunk stays short.
    let groups = [kids];
    if (kids.length > ROW_MAX + 1) {
      const deep = k => (IX.kids.get(k.id) || []).length > 0;
      const order = kids.filter(k => !deep(k)).concat(kids.filter(deep));
      groups = Array.from({ length: Math.ceil(order.length / ROW_MAX) }, (_, i) => order.slice(i * ROW_MAX, i * ROW_MAX + ROW_MAX));
    }
    let lo = -CW / 2, hi = CW / 2, y = CH + GY;
    const rows = groups.map((list, ri) => {
      const widths = list.map(k => box.get(k.id).w);
      const rw = total(widths, w => w) + GX * (list.length - 1);
      let start = -rw / 2;
      // A row the trunk must pass (not the last): keep the trunk in a gap, never through a subtree.
      if (ri < groups.length - 1) {
        let x = start, hit = false;
        const gaps = [];
        widths.forEach((w, i) => { if (x < 0 && x + w > 0) hit = true; x += w; if (i < widths.length - 1) gaps.push(x + GX / 2); x += GX; });
        if (hit && gaps.length) {
          const g = gaps.reduce((best, v) => (Math.abs(v) < Math.abs(best) ? v : best), gaps[0]);
          start -= g;
        }
      }
      const rh = Math.max(...list.map(k => box.get(k.id).h));
      const row = { list, start, top: y };
      lo = Math.min(lo, start); hi = Math.max(hi, start + rw);
      y += rh + GY;
      return row;
    });
    box.set(a.id, { w: hi - lo, h: y - GY, cx: -lo, rows });
  };
  IX.roots.forEach(measure);

  const nodes = [], edges = [];
  const place = (a, left, top) => {
    const b = box.get(a.id), cx = left + b.cx;
    nodes.push({ a, x: cx - CW / 2, y: top });
    for (const row of b.rows) {
      let x = cx + row.start;
      for (const k of row.list) {
        const kb = box.get(k.id), kcx = x + kb.cx, ky = top + row.top;
        edges.push({ id: `${a.id}>${k.id}`, heat: isRunning(k.status) ? 2 : k.status === 'waiting' ? 1 : 0, d: elbow(cx, top + CH, kcx, ky, ky - GY / 2) });
        place(k, x, top + row.top);
        x += kb.w + GX;
      }
    }
  };
  let left = PAD, height = 0;
  for (const r of IX.roots) { place(r, left, PAD); left += box.get(r.id).w + GX * 2; height = Math.max(height, box.get(r.id).h); }
  // Hotter edges draw last, so a shared trunk shows the liveliest colour.
  edges.sort((x, y) => x.heat - y.heat);
  const sig = `${ROW_MAX}:${IX.tree.map(a => `${a.id}<${a.parent || ''}`).join(',')}`;
  return { nodes, edges, w: left - GX * 2 + PAD, h: height + PAD * 2, sig };
}

function elbow(x1, y1, x2, y2, yb) {
  if (Math.abs(x2 - x1) < 0.5) return `M${x1} ${y1}V${y2}`;
  const s = x2 > x1 ? 1 : -1;
  const r = Math.min(8, Math.abs(x2 - x1) / 2, yb - y1, y2 - yb);
  return `M${x1} ${y1}V${yb - r}Q${x1} ${yb} ${x1 + s * r} ${yb}H${x2 - s * r}Q${x2} ${yb} ${x2} ${yb + r}V${y2}`;
}

function applyOrg() {
  if (org.world) org.world.style.transform = `translate(${org.x}px, ${org.y}px) scale(${org.k})`;
  if (org.view) {
    org.view.style.backgroundPosition = `${org.x}px ${org.y}px`;
    org.view.style.backgroundSize = `${22 * org.k}px ${22 * org.k}px`;
  }
  if (org.label) org.label.textContent = `${Math.round(org.k * 100)}%`;
}

/** The zoom and offset that fit layout `L` into a `vw` × `vh` canvas; `fit` is 'open' or 'all' (see fitOrg). */
function fitOf(L, vw, vh, fit) {
  if (fit === 'all') {
    const k = clamp(Math.min((vw - 32) / L.w, (vh - 32) / L.h, 1), 0.25, 1);
    return { k, x: Math.round((vw - L.w * k) / 2), y: Math.round(Math.max(0, (vh - L.h * k) * 0.42)) };
  }
  // the cards' own width, the world's padding left out; the Orchestrator's top FIT_MARGIN + 8 below the canvas's
  const cw = L.w - 2 * PAD;
  const k = clamp((vw - 2 * FIT_MARGIN) / cw, OPEN_ZOOM, 1);
  return { k, x: Math.round((vw - cw * k) / 2 - PAD * k), y: Math.round(FIT_MARGIN + 8 - PAD * k) };
}

/**
 * Fits the chart to its canvas. It opens (and follows each new agent, until
 * you pan or zoom) as wide as the canvas allows, never under 85% nor over
 * 100%, the Orchestrator at the top and centred across: a wide or tall tree
 * goes on past the edges, a drag or a scroll away. The fit button (and 0)
 * shows the whole chart instead, as small as that takes.
 */
function fitOrg(L) {
  const v = org.view;
  if (!v || !L) return;
  const vw = v.clientWidth, vh = v.clientHeight;
  if (!vw || !vh) return;
  Object.assign(org, fitOf(L, vw, vh, org.fit));
  applyOrg();
}
function fitAll() {
  org.touched = false;
  org.fit = 'all';
  fitOrg(lastLayout);
}

function zoomAt(k, mx, my) {
  k = clamp(k, 0.25, 2);
  org.x = mx - (mx - org.x) * (k / org.k);
  org.y = my - (my - org.y) * (k / org.k);
  org.k = k;
  org.touched = true;
  applyOrg();
}
function zoomBy(f) {
  const v = org.view;
  if (v) zoomAt(org.k * f, v.clientWidth / 2, v.clientHeight / 2);
}

function orgDown(e) {
  if (e.button !== 0 || e.target.closest('.org-zoom')) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: org.x, oy: org.y, moved: false };
}
function orgMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ }
    e.currentTarget.dataset.dragging = '1';
  }
  org.x = drag.ox + dx; org.y = drag.oy + dy; org.touched = true;
  applyOrg();
}
function orgUp(e) {
  if (!drag) return;
  if (drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  drag = null;
  delete e.currentTarget.dataset.dragging;
}
/** A scroll (two fingers, a wheel; Shift for across) pans the chart; a pinch or Ctrl+wheel zooms at the pointer. */
function orgWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = e.currentTarget.getBoundingClientRect();
    zoomAt(org.k * Math.exp(-clamp(e.deltaY, -20, 20) * 0.01), e.clientX - r.left, e.clientY - r.top);
    return;
  }
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? e.currentTarget.clientHeight : 1;
  const across = e.shiftKey && !e.deltaX;
  org.x -= (across ? e.deltaY : e.deltaX) * unit;
  org.y -= (across ? 0 : e.deltaY) * unit;
  org.touched = true;
  applyOrg();
}
function orgKeys(e) {
  if (e.target !== e.currentTarget) return;
  const step = 48;
  const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) { org.x += moves[e.key][0]; org.y += moves[e.key][1]; org.touched = true; applyOrg(); e.preventDefault(); return; }
  if (e.key === '+' || e.key === '=') { zoomBy(1.2); e.preventDefault(); }
  else if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.2); e.preventDefault(); }
  else if (e.key === '0') { fitAll(); e.preventDefault(); }
}

let lastLayout = null;

const KIND_WORD = { orchestrator: 'main loop', agent: 'agent', teammate: 'teammate', workflow: 'workflow', engine: 'Claude Code' };
/** "haiku-4.5 · 48k": the model and the tokens spent, these left out until there are some. */
const modelLine = a => [a.model || '—', a.tokens > 0 ? num(a.tokens) : ''].filter(Boolean).join(' · ');

function OrgCard(n) {
  const a = n.a, st = stateOf(a), s = statusOf(st);
  const line = a.live ? `${a.live.tool} ${a.live.text}` : a.result ? firstLine(a.result) : a.description;
  return h('button', {
    key: a.id, type: 'button', class: `org-card is-${st}${isAgentOpen(a.id) ? ' on' : ''}`, style: { left: `${n.x}px`, top: `${n.y}px` },
    title: `${a.title}: ${line || s.label}`, 'aria-label': `${a.title}, ${a.type || KIND_WORD[a.kind]}, ${s.label}`,
    onClick: e => { if (suppressClick) { e.preventDefault(); return; } openAgent(a.id); },
  },
  h('span', { class: 'org-av' }, Avatar(a, 34, { dot: true, live: true })),
  h('span', { class: 'org-text' },
    h('span', { class: 'org-name' }, a.title),
    h('span', { class: 'org-type' }, [a.type || KIND_WORD[a.kind], elapsedOf(a)].filter(Boolean).join(' · ')),
    h('span', { class: 'org-meta' }, modelLine(a)),
    h('span', { class: 'org-now' }, line || s.label)));
}

function OrgChart() {
  const L = (lastLayout = layoutOrg());
  return h('div', {
    key: 'chart', class: 'org-view', tabindex: '0', role: 'group',
    'aria-label': 'Org chart. Drag or scroll to pan; pinch, Ctrl+scroll or plus and minus to zoom; 0 shows it all.',
    ref: el => { org.view = el; },
    onPointerDown: orgDown, onPointerMove: orgMove, onPointerUp: orgUp, onPointerCancel: orgUp, onWheel: orgWheel, onKeyDown: orgKeys,
  },
  h('div', { class: 'org-world', ref: el => { org.world = el; applyOrg(); } },
    h('svg', { class: 'org-edges', width: L.w, height: L.h, viewBox: `0 0 ${L.w} ${L.h}`, 'aria-hidden': 'true' },
      L.edges.map(e => h('path', { key: e.id, d: e.d, class: ['edge', 'edge wait', 'edge live'][e.heat] }))),
    L.nodes.map(OrgCard)),
  h('div', { class: 'org-zoom' },
    h('button', { class: 'zbtn', type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => zoomBy(1.2) }, icon('plus')),
    h('button', { class: 'zbtn', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => zoomBy(1 / 1.2) }, icon('minus')),
    h('button', { class: 'zbtn', type: 'button', title: 'Show the whole chart', 'aria-label': 'Show the whole chart', onClick: fitAll }, icon('maximize'))),
  // Its text is written by applyOrg only: a vnode child here would fight it.
  h('span', { class: 'org-pct', 'aria-hidden': 'true', ref: el => { org.label = el; applyOrg(); } }));
}

// ---------------------------------------------------------------- the plan
// Every source Claude used, each as Claude made it: its task board (with the
// owner TaskUpdate named), its TodoWrite list, the plan you approved as
// written, and each Workflow's phases (which carry no status).

function PlanSection() {
  const p = S.plan;
  if (!p) return null;
  const blocks = [];
  if (p.board.length) blocks.push(BoardCard(p.board));
  if (p.todos) blocks.push(TodosCard(p.todos));
  if (p.approved) blocks.push(ApprovedCard(p.approved));
  for (const w of p.workflows) blocks.push(WorkflowCard(w));
  if (!blocks.length) return null;
  return Section('plan', 'Plan', null, null, () => h('div', { class: 'plan' }, blocks));
}

function PlanCard(key, title, note, body, hint) {
  return h('div', { key, class: `card pcard pcard-${key.split(':')[0]}` },
    h('div', { class: 'pcard-head', title: hint || null },
      h('h3', { class: 'pcard-title' }, title),
      note && h('span', { class: 'pcard-note' }, note)),
    body);
}

/** A board task's owner: the agent of that name when one carries it (it opens), else the name as TaskUpdate gave it. */
function Owner(name) {
  const list = IX.byName.get(name.toLowerCase()) || [];
  return list.length === 1 ? NameLink(list[0].id, 16) : h('span', { class: 'who' }, name);
}

const doneOf = items => `${items.filter(t => t.status === 'done').length}/${items.length}`;

function Item(key, status, text, doing, right) {
  return h('li', { key, class: `item is-${status}` },
    Glyph(status, 15),
    h('span', { class: 'item-body' },
      h('span', { class: 'item-text' }, text),
      status === 'active' && doing && h('span', { class: 'item-doing' }, doing)),
    right || null);
}

function BoardCard(board) {
  return PlanCard('board', 'Task board', doneOf(board),
    h('ul', { class: 'items' }, board.map(t => Item(`t${t.id}:${t.subject}`, t.status, t.subject, t.doing, t.owner && h('span', { class: 'item-owner' }, Owner(t.owner))))),
    'TaskCreate and TaskUpdate');
}

function TodosCard(todos) {
  return PlanCard('todos', 'Todo list', doneOf(todos.items),
    h('ul', { class: 'items' }, todos.items.map((t, i) => Item(`${i}:${t.text}`, t.status, t.text, t.doing))),
    `The Orchestrator's TodoWrite list, ${agoText(todos.at)}`);
}

function ApprovedCard(ap) {
  const long = ap.markdown.length > 420 || ap.markdown.split('\n').length > 7;
  return PlanCard('approved', 'Approved plan', [ap.by !== 'main' ? `${nameOf(ap.by)} · ` : '', agoText(ap.at)].join(''),
    Folded('plan|approved', long, Markdown(ap.markdown), 'Show the whole plan'),
    'ExitPlanMode, as written');
}

function WorkflowCard(w) {
  return PlanCard(`wf:${w.id}`, `Workflow · ${w.name}`, w.endedAt ? `ended ${agoText(w.endedAt)}` : `started ${agoText(w.startedAt)}`,
    h('ol', { class: 'phases' }, w.phases.map((p, i) => h('li', { key: `${i}:${p}` }, p))),
    'Its phases, in order: a workflow says nothing of each phase\'s progress');
}

// ======================================================================= chat
// The session as a group chat, as the Desktop pane draws it (hooks/ui/v2/
// chat.tsx): every real message, oldest first. Yours at the right in blue,
// under "You"; others' at the left under the sender's avatar and name, with
// "to X" and X's small avatar when the words went to someone other than you;
// one sender's messages within five minutes stack under one head. Claude
// Code's own notices sit in the middle, small and dim. Every agent named
// opens its drawer. Over it the members: Everyone, then each agent; one
// picked shows your conversation with it, and the composer's words go to it.

/** One sender's messages this close in time stack under one head. */
const GROUP_MS = 5 * 60000;

/** Chat's members after Everyone: each agent in the state's order (Claude Code's own loops are no one to talk to), those Clear finished hid left out. */
const membersOf = () => IX.shown.filter(r => r.kind !== 'engine');

/** The member picked: one no longer in the session reads as Everyone. */
const filterOf = () => (ui.chatFilter !== 'all' && membersOf().some(r => r.id === ui.chatFilter) ? ui.chatFilter : 'all');

/** Whether chat row `m` is in the conversation shown: everything with Everyone; with an agent, all it said and was told, and Claude Code's word about it. */
function inFilter(m, f) {
  if (f === 'all') return true;
  return m.from === f || m.to === f || m.agent === f;
}

/** Picks a member: its conversation shows, at its newest message, and the composer's words go to it. */
function pickMember(id) {
  ui.chatFilter = id;
  ui.pinChat = true;
  if ((ui.sends.get('chat') || {}).status === 'error') ui.sends.delete('chat');
  renderNow();
}

/** A member: its avatar, its name and its status dot, its status's word under its name where there is room; Everyone: how many are at work. */
function MemberButton(a, on) {
  const st = a ? stateOf(a) : '';
  const working = a ? 0 : S.figures ? S.figures.running : IX.rows.filter(r => r.id !== 'main' && r.kind !== 'engine' && isRunning(r.status)).length;
  return h('button', {
    key: a ? a.id : 'all', type: 'button', class: `member${on ? ' on' : ''}${a ? ` is-${st}` : ' member-all'}`, 'aria-pressed': on ? 'true' : 'false',
    title: a ? `${a.title} · ${statusOf(st).label}` : 'Everyone: every message; yours go to the Orchestrator',
    onClick: () => pickMember(a ? a.id : 'all'),
  },
  h('span', { class: 'member-av' }, a ? Avatar(a, 24) : h('span', { class: 'member-all-ic' }, icon('users'))),
  h('span', { class: 'member-name' }, a ? a.title : 'Everyone'),
  h('span', { class: 'member-sub' }, a ? statusOf(st).label : working > 0 ? `${working} at work` : 'every message'),
  a ? Dot(statusOf(st).hue, isRunning(a.status)) : null);
}

/**
 * The members: Everyone, then each agent at work (and the one picked); the
 * finished behind one "N finished ▸" row at the end, with Clear finished. A
 * compact grid over the chat; a narrow column beside it on a wide page.
 */
function Members(f) {
  const all = membersOf();
  const front = all.filter(a => !isFinished(a) || a.id === f), behind = all.filter(a => isFinished(a) && a.id !== f);
  const open = isOpen('finished|chat', false);
  return h('nav', { key: 'members', class: 'members', 'aria-label': 'Chat with' },
    h('p', { key: 'cap', class: 'members-cap' }, 'Chat with'),
    MemberButton(null, f === 'all'),
    front.map(a => MemberButton(a, f === a.id)),
    FinishedRow('chat', behind.length, open),
    open ? behind.map(a => MemberButton(a, f === a.id)) : null);
}

/** Where a message stands: yours at the right, others' at the left, Claude Code's own (and a slash command you ran alone, what you stopped, and a compaction) in the middle. */
const sideOf = m => (m.kind === 'command' || m.kind === 'stop' || m.kind === 'compaction' || m.from === 'engine' ? 'notice' : m.from === 'you' ? 'mine' : 'theirs');

/** A send from here not in the chat yet (or refused): drawn as the row it becomes, so it turns into it in place. */
const pendingRow = o => ({ id: o.id, at: o.at, from: 'you', to: o.agentId, who: `You → ${o.title}`, kind: 'chat', title: '', text: o.text, ackId: o.id });

/**
 * The messages shown with member `f`, oldest first, then the sends from here
 * the state does not hold yet: each with its key (a message sent from here
 * keeps its "Sending…" key, so it never blinks when the mod records it), the
 * send it was, and its side.
 */
function chatEntries(f) {
  const out = [];
  const add = (m, sent) => {
    const send = sent || (m.ackId ? ui.outbox.find(o => o.id === m.ackId) : null);
    out.push({ m, sent: send || null, key: send ? `out:${send.id}` : m.id, side: sideOf(m) });
  };
  // what the agents Clear finished hid said or were told leaves Everyone; their own conversation keeps it
  for (const m of S.chat) if (inFilter(m, f) && !(f === 'all' && m.isCleared)) add(m, null);
  for (const o of ui.outbox) {
    if (IX.chatByAck.has(o.id)) continue;
    const m = pendingRow(o);
    if (inFilter(m, f)) add(m, o);
  }
  return out;
}

/** Whether `next` stacks under `prev`'s head: the same sender (not Claude Code), within a few minutes. */
const joins = (prev, next) => !!prev && next.side !== 'notice' && prev.side === next.side && prev.m.from === next.m.from && next.m.at - prev.m.at <= GROUP_MS;

/** The entries as groups, each a head's messages: those that stack under it. */
function groupsOf(entries) {
  const groups = [];
  entries.forEach((e, i) => {
    if (!joins(entries[i - 1], e)) groups.push([]);
    groups[groups.length - 1].push(e);
  });
  return groups;
}

/** A party a message names: an agent's name (and its avatar, `size` px; none for 0) opens its drawer; you, Claude Code and a name no agent carries are words. */
function Party(id, size) {
  const a = IX.byId.get(id);
  if (!a) return h('span', { class: 'party' }, size ? whoAvatar(id, size) : null, h('span', { class: 'party-name' }, nameOf(id)));
  return h('button', { type: 'button', class: 'party party-link', title: a.title, onClick: e => { stop(e); openAgent(a.id); } },
    size ? Avatar(a, size) : null, h('span', { class: 'party-name' }, a.title));
}

/** The recipient a head names: others' words to anyone but you; yours to anyone but the Orchestrator. */
function headTo(e) {
  const to = e.m.to;
  if (to == null) return null;
  return (e.side === 'mine' ? to === 'main' : to === 'you') ? null : to;
}

const timeTitle = at => (at ? new Date(at).toLocaleString() : '');

/**
 * A group: Claude Code's notice alone in the middle; yours at the right,
 * "You" over them; others' at the left, the sender's avatar beside its name
 * and the messages under the name. A message to another recipient than the
 * one before it says so over it.
 */
function ChatGroup(list) {
  const e = list[0], m = e.m;
  if (e.side === 'notice') return Notice(e);
  const to = headTo(e);
  const head = [
    h('span', { key: 'name', class: 'cg-name' }, e.side === 'mine' ? 'You' : Party(m.from, 0)),
    to && h('span', { key: 'to', class: 'cg-to' }, h('span', { class: 'cg-to-word' }, 'to'), Party(to, 16)),
    h('span', { key: 'time', class: 'cg-time', title: timeTitle(m.at) }, ageOf(m.at)),
  ];
  const items = h('div', { class: 'cg-items' }, list.map((x, i) => Bubble(x, i > 0 && x.m.to !== list[i - 1].m.to)));
  if (e.side === 'mine') return h('div', { key: `g:${e.key}`, class: 'cgroup mine' }, h('div', { class: 'cg-head' }, head), items);
  const a = IX.byId.get(m.from);
  return h('div', { key: `g:${e.key}`, class: 'cgroup theirs' },
    a ? h('button', { type: 'button', class: 'cg-av', tabindex: '-1', title: a.title, 'aria-label': `Open ${a.title}`, onClick: () => openAgent(a.id) }, Avatar(a, 30))
      : h('span', { class: 'cg-av' }, whoAvatar(m.from, 30)),
    h('div', { class: 'cg-main' }, h('div', { class: 'cg-head' }, head), items));
}

/** The kinds of row that are an agent's words back: its answer, its words to nobody in particular, a SendMessage. */
const REPLY_KINDS = new Set(['answer', 'chat', 'message']);

/**
 * The status line under a message of yours, or null: what its ack says
 * while it matters (a failure, a send still waiting, or until the one it
 * went to answers after it: then "Queued" is old news). `sent` is its send
 * from this page; one sent before the page loaded has its ack by `ackId`.
 */
function sendNoteOf(m, sent) {
  if (m.from !== 'you' || m.kind === 'choice') return null;
  const send = sent || (m.ackId && IX.acks.has(m.ackId) ? { id: m.ackId, at: m.at, state: 'sent' } : null);
  if (!send) return null;
  const st = sendState(send, 'chat');
  if (st.tone === 'fail' || st.busy) return st;
  return S.chat.some(x => x.from === m.to && x.at > m.at && REPLY_KINDS.has(x.kind)) ? null : st;
}

/** Words longer than this, or of more lines, fold to about six lines until opened. */
const FOLD_CHARS = 480, FOLD_LINES = 6;

/**
 * One message's bubble: others' words dark, as Markdown (a SendMessage's
 * summary bold over them); yours blue, as written. A question held on you
 * edged amber, with the way to its card. A long one folds; a cut one reads
 * its whole text once when opened. Under it what came of it.
 */
function Bubble(e, showTo) {
  const m = e.m;
  const mine = e.side === 'mine';
  // what was sent from here is whole on the page already, even where the state would cut it
  const text = String(e.sent ? e.sent.text : m.text || '');
  const isCut = !e.sent && m.isCut;
  const long = isCut || text.length > FOLD_CHARS || text.trim().split('\n').length > FOLD_LINES;
  const fold = `chat|${m.id}`;
  const open = long && isOpen(fold, false);
  const full = open && isCut ? fullTextOf(m.id) : null;
  const body = (full && full.status === 'ok' ? full.text : text).trim();
  const held = m.kind === 'question' && m.callId ? IX.needById.get(m.callId) : null;
  const note = sendNoteOf(m, e.sent);
  const flip = () => { ui.holdChat = true; toggle(fold); };
  const words = mine ? h('p', { key: 'w', class: 'b-plain' }, body) : h('div', { key: 'w', class: 'b-md' }, Markdown(body));
  return h('div', {
    key: e.key, class: `brow${open ? ' open' : ''}`, 'data-nav': 'chat', tabindex: '-1', enter: true,
    onKeyDown: ev => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) { ev.preventDefault(); if (long) flip(); else if (IX.byId.has(m.from)) openAgent(m.from); } },
  },
  showTo && m.to && h('p', { class: 'b-to' }, h('span', null, 'to'), Party(m.to, 14), h('span', { class: 'b-to-time' }, `· ${ageOf(m.at)}`)),
  h('div', { class: `bubble kind-${m.kind}${held ? ' is-held' : ''}`, title: timeTitle(m.at) || null },
    !mine && m.title && h('p', { class: 'b-title' }, m.title),
    h('div', { class: `b-words${m.kind === 'question' && !mine ? ' b-question' : ''}${long && !open ? ' folded' : ''}` },
      m.kind === 'question' && !mine ? h('span', { key: 'q', class: 'b-q' }, icon('help')) : null, words),
    full && full.status === 'loading' && h('p', { class: 'b-wait' }, 'Loading the rest…'),
    full && full.status === 'error' && h('p', { class: 'msg-err' }, icon('alert'), h('span', null, full.error),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: () => { fullTexts.delete(m.id); ui.holdChat = true; renderNow(); } }, 'Retry')),
    long && h('button', { class: 'more more-start b-more', type: 'button', 'aria-expanded': open ? 'true' : 'false', disabled: !!(full && full.status === 'loading'), onClick: flip },
      open ? 'Show less' : 'Show more', icon('chevronDown', open ? 'flip' : '')),
    held && (held.isAnswerable
      ? h('button', { type: 'button', class: 'more more-start b-answer', onClick: () => goToNeed(held) }, 'Answer on Dashboard', icon('arrowRight'))
      : h('p', { class: 'b-held' }, 'Answer it in Claude Code.'))),
  m.isDelivered === false && !m.ackId && h('p', { class: 'b-note' }, StatusNote({ tone: 'fail', icon: 'x', text: 'Not delivered' })),
  note && h('p', { class: 'b-note' }, StatusNote(note)));
}

/** Claude Code's own notice, in the middle, small and dim: "Claude Code · Agent "X" completed · 12m"; the agent a notification is about opens. A slash command you ran alone: "You ran /login · 12m". */
function Notice(e) {
  const m = e.m;
  if (m.kind === 'compaction') return CompactionLine(e);
  const said = oneLine(m.text) || oneLine(m.title);
  const words = said.length > 200 ? `${said.slice(0, 199)}…` : said;
  const about = m.kind === 'notification' && m.agent && m.agent !== 'main' && IX.byId.has(m.agent) && !said.includes(nameOf(m.agent)) ? m.agent : null;
  return h('div', { key: e.key, class: `notice${m.kind === 'command' ? ' notice-command' : m.kind === 'stop' ? ' notice-stop' : ''}`, 'data-nav': 'chat', tabindex: '-1', enter: true, title: timeTitle(m.at) },
    // what you stopped from the deck says so itself: "You stopped builder"
    m.kind !== 'stop' && h('span', { class: 'notice-who' }, m.kind === 'command' ? 'You ran' : 'Claude Code'),
    h('span', { class: 'notice-text' }, words),
    about && h('span', { class: 'notice-about' }, Party(about, 14)),
    h('span', { class: 'notice-time' }, ageOf(m.at)));
}

/**
 * A compaction, a divider across the chat: "Context compacted" (the
 * Orchestrator's) or "researcher's context compacted", how full before and
 * after, the trigger and when. After it the loop works from a summary: a
 * press opens it here, read whole from /message/<id> when the state cut it.
 */
function CompactionLine(e) {
  const m = e.m, c = m.compaction || {};
  const key = `cmp|${m.id}`, open = isOpen(key, false);
  const full = open && m.isCut ? fullTextOf(m.id) : null;
  const words = full && full.status === 'ok' ? full.text : m.text;
  return h('div', { key: e.key, class: `cmp-line${open ? ' open' : ''}`, 'data-nav': 'chat', tabindex: '-1', enter: true, title: timeTitle(m.at) },
    h('button', { type: 'button', class: 'cmp-head', 'aria-expanded': open ? 'true' : 'false', title: open ? 'Hide the summary' : 'The summary it goes on from', onClick: () => { ui.holdChat = true; toggle(key); } },
      h('span', { class: 'cmp-rule' }),
      icon('shrink', 'cmp-ic'),
      h('span', { class: 'cmp-title' }, c.title || 'Context compacted'),
      c.figures && h('span', { class: 'cmp-figs' }, c.figures),
      h('span', { class: 'cmp-time' }, ageOf(m.at)),
      h('span', { class: 'cmp-rule' })),
    open && h('div', { class: 'cmp-sum' },
      h('p', { class: 'cmp-cap' }, 'The summary it goes on from'),
      words ? h('div', { class: 'md' }, Markdown(words)) : h('p', { class: 'b-held' }, 'Claude Code gave no summary.'),
      full && full.status === 'loading' && h('p', { class: 'b-wait' }, 'Loading the rest…')));
}

function ChatPage() {
  const f = filterOf();
  const groups = groupsOf(chatEntries(f));
  const a = f === 'all' ? null : IX.byId.get(f);
  return h('div', { key: 'chat', class: 'page page-chat' },
    Members(f),
    h('div', { key: 'main', class: 'chat-main' },
      groups.length
        ? h('div', { key: 'list', class: 'chat-list', role: 'log', 'aria-label': a ? `Chat with ${a.title}` : 'Chat' }, groups.map(ChatGroup))
        : h('div', { key: 'empty', class: 'chat-list chat-empty' }, h('p', { class: 'muted' }, a ? `Nothing to or from ${a.title} yet.` : 'No messages yet.')),
      Composer('chat')));
}

// ------------------------------------------------------------ the composer
// Words with no @ go to the member picked: for Everyone the Orchestrator, for
// an agent that agent, by SendMessage. `@name rest` sends `rest` to the agent
// @name names, by the forgiving rule W.recipientOf has too (hooks/web.ts):
// see matchHandle.

/** A name as @ reads it: lowercase, and nothing but a–z and 0–9 ("Native Chat", "native-chat" and "NativeChat" read alike). */
const normName = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** A handle's words: split at anything but a letter or a digit, and where a lowercase letter or a digit meets a capital ("NativeChat": native, chat). */
const handleWords = s => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** The names an agent answers to: its name and its title, each normalised. */
const namesOf = r => [...new Set([normName(r.name), normName(r.title)])].filter(Boolean);

/**
 * The ways a handle names an agent, tried in this order: its exact id or
 * short id; its exact name; a name that starts with it; a name that holds
 * it; a name that holds every word of it.
 */
const HANDLE_MATCH = [
  (r, q) => r.id.toLowerCase() === q.raw || (r.shortId !== '' && r.shortId.toLowerCase() === q.raw),
  (r, q) => q.norm !== '' && namesOf(r).includes(q.norm),
  (r, q) => q.norm !== '' && namesOf(r).some(n => n.startsWith(q.norm)),
  (r, q) => q.norm !== '' && namesOf(r).some(n => n.includes(q.norm)),
  (r, q) => q.words.length > 0 && namesOf(r).some(n => q.words.every(w => n.includes(w))),
];

/** Those at work or waiting on you first, then the newest. */
const liveRank = r => (isLive(r.status) ? 1 : 0);
const byPreference = (x, y) => liveRank(y) - liveRank(x) || y.startedAt - x.startedAt;

/** The agents a handle can name, best first: those the first way that finds any finds, in preference. Never the Orchestrator: words with no @ go to it. */
function rankHandle(handle) {
  const q = { raw: String(handle || '').toLowerCase(), norm: normName(handle), words: handleWords(handle) };
  const rows = IX.rows.filter(r => r.id !== 'main');
  for (const test of HANDLE_MATCH) {
    const found = rows.filter(r => test(r, q));
    if (found.length) return found.sort(byPreference);
  }
  return [];
}

/** The agent `@handle` names, `{ row }`; `{ tie }` when the best it finds are alike (as much at work, started at once), the ones it could be; `{}` for none. */
function matchHandle(handle) {
  const list = rankHandle(handle);
  if (!list.length) return {};
  const tie = list.filter(r => byPreference(r, list[0]) === 0);
  return tie.length > 1 ? { tie } : { row: list[0] };
}

/** The handle a pick @names an agent by: its name when it has no space, else its short id (W's handleOf). */
const handleOf = r => (r.name !== '' && !/\s/.test(r.name) ? r.name : r.shortId || r.id);
/** A handle that names `r` alone: its own, else its short id. */
function handleFor(r) {
  const m = matchHandle(handleOf(r));
  return m.row && m.row.id === r.id ? handleOf(r) : r.shortId || r.id;
}
/** A choice's name in "Did you mean": its title, with its short id when another choice has that title too. */
/** The handle "Did you mean" offers an agent by, which names it alone: its short id, else its name, else its id (W's candidateOf). */
const candidateHandle = r => r.shortId || r.name || r.id;
/** How many agents "Did you mean" names at most. */
const DID_YOU_MEAN = 4;
/** "Did you mean: Native chat (@a1b2c3d) or Native pane (@e4f5a6b)?", four at most, in W.recipientOf's words. */
function didYouMean(list) {
  const said = list.slice(0, DID_YOU_MEAN).map(r => `${r.title} (@${candidateHandle(r)})`);
  const more = list.length > DID_YOU_MEAN ? `, or ${list.length - DID_YOU_MEAN} more` : '';
  const words = said.length > 1 && !more ? `${said.slice(0, -1).join(', ')} or ${said[said.length - 1]}` : said.join(', ');
  return `Did you mean: ${words}${more}?`;
}

/** Who the chat's words go to, and what of them: W.recipientOf over this state's rows; with no @, member `to` (the Orchestrator for Everyone). */
function recipientOf(words, to = 'all') {
  const said = String(words || '').trim();
  const at = /^@(\S+)\s*([\s\S]*)$/.exec(said);
  if (!at) {
    if (said === '') return { error: 'Nothing to send' };
    const a = to !== 'all' ? IX.byId.get(to) : null;
    if (a) return { agentId: a.id, title: a.title, text: said };
    const main = IX.byId.get('main');
    return { agentId: 'main', title: main ? main.title : 'Orchestrator', text: said };
  }
  const found = matchHandle(at[1]);
  const text = at[2].trim();
  if (found.tie) return { error: didYouMean(found.tie), choices: found.tie };
  if (!found.row) return { error: `No agent named @${at[1]} in this session` };
  if (text === '') return { error: 'Nothing to send' };
  return { agentId: found.row.id, title: found.row.title, text };
}

/** "→ Orchestrator", "→ researcher via SendMessage". */
const viaOf = (id, title) => (id === 'main' ? `→ ${title}` : `→ ${title} via SendMessage`);
const composerId = scope => (scope === 'chat' ? 'composer-chat' : `composer-${(IX.byId.get(scope.slice(6)) || { fileId: 'x' }).fileId}`);

/** Where a composer's words go: the chat's to the member picked or by their @, a drawer's to its agent. */
function targetOf(scope, words) {
  if (scope === 'chat') return recipientOf(words, filterOf());
  const a = IX.byId.get(scope.slice(6));
  const text = String(words || '').trim();
  if (!a) return { error: 'No such agent in this session' };
  return text ? { agentId: a.id, title: a.title, text } : { error: 'Nothing to send' };
}

/** What the composer's foot says of its words: who they go to, the agents an @name could be ("Did you mean"), or why they cannot go. */
function previewOf(scope, draft) {
  if (scope !== 'chat') { const a = IX.byId.get(scope.slice(6)); return a ? { text: viaOf(a.id, a.title) } : { text: 'No such agent in this session', err: true }; }
  const said = draft.trim();
  const at = /^@(\S+)/.exec(said);
  const f = filterOf();
  const a = f !== 'all' ? IX.byId.get(f) : null;
  if (said === '@') return { text: 'Type the agent\'s name', hint: true };
  if (!at) {
    if (a) return said ? { text: viaOf(a.id, a.title) } : { text: `To ${a.title} · @name for another agent`, hint: true };
    const main = IX.byId.get('main');
    return said ? { text: viaOf('main', main ? main.title : 'Orchestrator') } : { text: 'To the Orchestrator · @name for one of its agents', hint: true };
  }
  const found = matchHandle(at[1]);
  if (found.row) return { text: viaOf(found.row.id, found.row.title) };
  if (found.tie) return { text: 'Did you mean:', choices: found.tie, err: true };
  return { text: `No agent named @${at[1]} in this session`, err: true };
}

/** The agents an @name being typed can be, best first; for a bare @ every agent, in the state's order. */
function suggestionsOf(typed) {
  return (typed ? rankHandle(typed) : IX.rows.filter(r => r.id !== 'main')).slice(0, 6);
}

function setDraft(scope, value, focus = true) {
  ui.drafts.set(scope, value);
  const el = ui.inputs.get(scope);
  if (el) {
    el.value = value;
    autosize(el);
    if (focus) { el.focus(); try { el.setSelectionRange(value.length, value.length); } catch { /* not a text field */ } }
  }
  renderNow();
}

function autosize(el) {
  if (!el || !el.style) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

async function sendChat(scope) {
  const words = ui.drafts.get(scope) || '';
  if ((ui.sends.get(scope) || {}).status === 'sending') return;
  const t = targetOf(scope, words);
  // an @name that could be more than one: the foot asks which ("Did you mean"), nothing goes
  if (t.choices) { renderNow(); return; }
  if (t.error) { ui.sends.set(scope, { status: 'error', text: t.error, at: Date.now() }); renderNow(); return; }
  if (t.text.length > 4000) { ui.sends.set(scope, { status: 'error', text: 'Too long: at most 4000 characters', at: Date.now() }); renderNow(); return; }
  const id = newCmdId('c');
  const at = Date.now();
  ui.sends.set(scope, { status: 'sending', at });
  renderNow();
  try {
    await command({ cmd: 'chat', id, agentId: t.agentId, text: t.text });
    // Clear the box only if it still holds what was sent (typing during the send is kept).
    if ((ui.drafts.get(scope) || '') === words) {
      ui.drafts.delete(scope);
      const el = ui.inputs.get(scope);
      if (el) { el.value = ''; autosize(el); }
    }
    // it shows in the chat now, "Sending…" until the mod's ack says what became of it
    const sent = { id, agentId: t.agentId, title: t.title, text: t.text, at, state: 'sent' };
    ui.outbox.push(sent);
    if (ui.outbox.length > 40) ui.outbox.shift();
    ui.lastSend.set(scope, sent);
    ui.sends.delete(scope);
    ui.pinChat = true;
    setTimeout(invalidate, ACK_WAIT + 50);
  } catch (e) {
    ui.sends.set(scope, { status: 'error', text: e.message, at: Date.now() });
  }
  renderNow();
}

/** The composer's foot: where the words go; or the agents an @name could be (four at most), each a button that puts in the handle naming it alone. */
function ToLine(scope, draft, to) {
  const cls = `composer-to${to.err ? ' is-err' : ''}${to.hint ? ' is-hint' : ''}`;
  if (!to.choices) return h('span', { class: cls }, to.text);
  const pick = r => setDraft(scope, draft.replace(/^(\s*)@\S+/, (_, lead) => `${lead}@${candidateHandle(r)}`));
  const more = to.choices.length - DID_YOU_MEAN;
  return h('span', { class: `${cls} has-choices` }, h('span', { key: 'ask' }, to.text),
    to.choices.slice(0, DID_YOU_MEAN).map(r => h('button', { key: r.id, type: 'button', class: 'choice', title: `@${candidateHandle(r)}`, onMouseDown: e => e.preventDefault(), onClick: () => pick(r) },
      Avatar(r, 14), h('span', null, r.title), h('span', { class: 'choice-handle' }, `@${candidateHandle(r)}`))),
    more > 0 && h('span', { key: 'more' }, `or ${more} more`));
}

function Composer(scope) {
  const isChat = scope === 'chat';
  const f = isChat ? filterOf() : 'all';
  const agent = isChat ? (f !== 'all' ? IX.byId.get(f) : null) : IX.byId.get(scope.slice(6));
  const draft = ui.drafts.get(scope) || '';
  const st = ui.sends.get(scope);
  const typing = isChat ? /^@(\S*)$/.exec(draft) : null;
  const picks = typing ? suggestionsOf(typing[1]).filter(r => handleOf(r).toLowerCase() !== typing[1].toLowerCase()) : [];
  const pick = r => setDraft(scope, `@${handleFor(r)} `);
  const to = previewOf(scope, draft);
  const last = !isChat && ui.lastSend.get(scope);
  const lastNote = last && !(st && st.status === 'sending') ? sendState(last, 'chat') : null;
  const placeholder = agent ? `Message ${agent.id === 'main' ? 'the Orchestrator' : agent.title}…` : isChat ? 'Message the Orchestrator, or @name an agent…' : 'Message this agent…';
  return h('div', { key: `composer:${scope}`, class: `composer${isChat ? ' composer-chat' : ''}` },
    picks.length > 0 && h('div', { key: 'picks', class: 'picks', role: 'listbox', 'aria-label': 'Agents' },
      picks.map(r => h('button', { key: r.id, type: 'button', class: 'pick', role: 'option', onMouseDown: e => e.preventDefault(), onClick: () => pick(r) },
        Avatar(r, 14), h('span', { class: 'pick-handle' }, `@${handleFor(r)}`), r.title !== handleFor(r) && h('span', { class: 'pick-title' }, r.title)))),
    h('div', { class: 'composer-box' },
      h('textarea', {
        key: `ta:${scope}`, id: composerId(scope), class: 'composer-input', rows: '1', maxlength: '4200',
        placeholder, 'aria-label': agent ? `Message ${agent.title}` : 'Message the Orchestrator',
        ref: el => { ui.inputs.set(scope, el); el.value = ui.drafts.get(scope) || ''; requestAnimationFrame(() => autosize(el)); },
        onInput: e => {
          ui.drafts.set(scope, e.target.value);
          autosize(e.target);
          if ((ui.sends.get(scope) || {}).status === 'error') ui.sends.delete(scope);
          renderNow();
        },
        onKeyDown: e => {
          if (e.key === 'Tab' && !e.shiftKey && picks.length) { e.preventDefault(); pick(picks[0]); return; }
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(scope); }
        },
      }),
      h('button', { class: 'btn btn-primary btn-sm composer-send', type: 'button', title: 'Send (Enter)', disabled: !!(st && st.status === 'sending'), onClick: () => sendChat(scope) },
        icon('send'), h('span', { class: 'composer-send-label' }, st && st.status === 'sending' ? 'Sending' : 'Send'))),
    h('div', { class: 'composer-foot' },
      ToLine(scope, draft, to),
      h('span', { class: 'composer-status', role: 'status', 'aria-live': 'polite' },
        st && st.status === 'error' ? StatusNote({ tone: 'fail', icon: 'x', text: st.text }) : lastNote ? StatusNote(lastNote) : null),
      h('span', { class: 'composer-keys' }, 'Enter sends · Shift+Enter adds a line')));
}

// ==================================================================== changes
// Git's uncommitted files, each opening on git's own diff of it and, beside
// it, the agents' own edits of it (git's hunks are never tagged by agent:
// nothing maps them); the agents' other edits; the commits; and Review, which
// asks Claude after a confirm.

const CODE = { M: ['M', 'wait', 'Modified'], A: ['A', 'done', 'Added'], N: ['N', 'done', 'New'], D: ['D', 'fail', 'Deleted'], R: ['R', 'run', 'Renamed'], C: ['C', 'run', 'Copied'], U: ['U', 'fail', 'Conflict'], '?': ['?', 'idle', 'Untracked'], '??': ['?', 'idle', 'Untracked'] };

function CodeBadge(code) {
  const [ch, hue, label] = CODE[(code || '').trim()] || CODE[(code || '').trim()[0]] || [String(code || '?').slice(0, 1), 'idle', code || 'Changed'];
  return h('span', { class: `code-badge hue-${hue}`, title: label }, ch);
}

/**
 * Asks Claude for a review, after a confirm: in the Desktop app the mod
 * queues the prompt for when Claude is free; where a prompt box exists it
 * fills it. The ack says which, under the button, for a few seconds.
 */
function ReviewButton(scope, text, label = 'Ask for review') {
  const st = ui.review.get(scope);
  const confirming = st && st.status === 'confirm';
  const close = () => { ui.review.delete(scope); renderNow(); };
  const go = async () => {
    const id = newCmdId('r');
    const sent = { status: 'sent', state: 'sending', id, at: Date.now() };
    ui.review.set(scope, sent);
    renderNow();
    try { await command({ cmd: 'review', id, text }); sent.state = 'sent'; }
    catch (e) { Object.assign(sent, { state: 'error', error: e.message }); }
    renderNow();
    // the note stays until a while after its ack (or the wait for one) ends
    const tidy = () => {
      if (ui.review.get(scope) !== sent) return;
      const now = sendState(sent, 'review');
      if (now.busy) { setTimeout(tidy, 1000); return; }
      if (!sent.settled) { sent.settled = Date.now(); invalidate(); }
      if (Date.now() - sent.settled >= 8000) { ui.review.delete(scope); invalidate(); } else setTimeout(tidy, 1000);
    };
    setTimeout(tidy, 1000);
  };
  const note = st && st.status === 'sent' ? sendState(st, 'review') : null;
  // the confirm, then in its place what came of it: a box under the button, so nothing around it moves
  return h('span', { class: 'review' },
    h('button', {
      class: 'btn btn-sm', type: 'button', 'aria-expanded': confirming ? 'true' : 'false', 'aria-haspopup': 'dialog',
      disabled: !!(note && note.busy), onClick: () => (confirming ? close() : (ui.review.set(scope, { status: 'confirm' }), renderNow())),
    }, icon('eye'), label),
    confirming
      ? h('div', { key: 'ask', class: 'confirm', role: 'dialog', 'aria-label': 'Ask Claude for a review', onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); stop(e); close(); } } },
        h('p', { class: 'confirm-text' }, 'Ask Claude to review these changes? It runs when Claude is free.'),
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn btn-xs', type: 'button', onClick: close }, 'Cancel'),
          h('button', { class: 'btn btn-xs btn-primary', type: 'button', ref: el => requestAnimationFrame(() => el.focus()), onClick: go }, 'Ask Claude')))
      : note ? h('div', { key: 'note', class: 'confirm confirm-note' }, StatusNote(note, 'review-note')) : null);
}

/** An untracked file: git status's '??', which the mod writes 'N'. */
const isUntracked = code => ['N', '?', '??'].includes(String(code || '').trim());

/** Git's own diff of one uncommitted file (/gitdiff/<diffId>), fetched again when its id moves; or why there is none. */
function GitDiff(f) {
  return h('div', { key: 'git', class: 'chg-part' },
    h('p', { class: 'chg-label' }, icon('branch'), h('span', null, 'Git\'s diff'), h('span', { class: 'chg-note' }, isUntracked(f.code) ? 'untracked: its whole text' : 'against HEAD')),
    f.diffId
      ? PatchView(f.diffId, 'git', 'gitdiff')
      : h('p', { class: 'chg-none' }, 'Git\'s diff of this file is not here: not read yet, a binary file, or too long to show.'));
}

function GitFileRow(f) {
  const key = `git|${f.path}`, open = isOpen(key, false);
  const edits = f.edits.map(id => IX.editById.get(id)).filter(Boolean);
  const editors = [...new Set(edits.map(e => e.agent))];
  return h('div', { key: f.path, id: `file-${f.path}`, class: `chg${open ? ' open' : ''}` },
    h('button', { class: 'chg-head', type: 'button', 'data-nav': 'file', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      CodeBadge(f.code),
      PathText(f.path, 'grow'),
      editors.length > 0 && AvatarStack(editors, 18),
      DiffStat(f.added, f.removed)),
    open && h('div', { class: 'chg-body' },
      GitDiff(f),
      h('div', { key: 'edits', class: 'chg-part' },
        edits.length
          ? [h('p', { key: 'label', class: 'chg-label' }, icon('pencil'), h('span', null, `${edits.length === 1 ? 'The agent edit' : `The ${edits.length} agent edits`} of this file`)), edits.map(e => EditBlock(e, 'git'))]
          : h('p', { class: 'chg-none' }, 'No agent edited this file in this session.'))));
}

function CommitRow(c) {
  return h('div', { key: c.hash, class: 'commit' },
    icon('commit', 'commit-ic'),
    h('span', { class: 'commit-hash' }, c.short),
    h('span', { class: 'commit-subject', title: c.subject }, c.subject),
    c.agent ? NameLink(c.agent) : h('span', { class: 'commit-author' }, c.author),
    h('span', { class: 'commit-files' }, plural(c.files, 'file')),
    DiffStat(c.added, c.removed),
    h('span', { class: 'commit-time' }, ageOf(c.at)));
}

function ChangesPage() {
  const ch = S.changes, repo = ch.repo, files = ch.files;
  const add = total(files, f => f.added), rem = total(files, f => f.removed);
  // the agents' edits git does not list (committed since, undone, or outside the repository); with no repository, all of them
  const other = [...IX.editsByPath.keys()].filter(p => !repo || !IX.gitPaths.has(p));
  const isOut = p => (IX.editsByPath.get(p) || []).some(e => e.isOutside);
  const own = other.filter(p => !isOut(p)), outside = other.filter(isOut);
  const fileGroup = p => FileGroup(p, IX.editsByPath.get(p), { scope: 'other', open: false, showAgent: true, editors: [...new Set(IX.editsByPath.get(p).map(e => e.agent))], outside: isOut(p) });
  return h('div', { key: 'changes', class: 'page page-changes' },
    h('div', { class: 'chg-top' },
      h('div', { class: 'chg-sum' },
        h('p', { class: 'chg-count' }, repo ? plural(files.length, 'uncommitted file') : 'No repository', repo && files.length ? DiffStat(add, rem) : null),
        repo
          ? h('p', { class: 'chg-repo' }, icon('branch'), h('span', null, repo.branch || 'detached'),
            repo.ahead ? h('span', null, `↑${repo.ahead}`) : null, repo.behind ? h('span', null, `↓${repo.behind}`) : null,
            h('span', { class: 'sep' }, '·'), h('span', null, repo.head.slice(0, 7)), h('span', { class: 'sep' }, '·'), h('span', null, repo.name))
          : h('p', { class: 'chg-repo' }, 'The session is not in a git repository; the agents\' own edits are below.')),
      files.length > 0 && ReviewButton('changes', `Review the uncommitted changes (${plural(files.length, 'file')}, +${add} −${rem}) and tell me what to fix before I commit.`)),
    repo && Section('uncommitted', 'Uncommitted', files.length || null, null, () => (files.length
      ? h('div', { class: 'card list chgs' }, files.map(GitFileRow))
      : h('div', { class: 'card' }, Empty('check', 'Working tree clean', 'Nothing to commit.')))),
    (other.length > 0 || !repo) && Section('other', repo ? 'Other agent edits' : 'Agent edits', own.length || null, null, () => (other.length
      ? h('div', { class: 'fgroups' }, own.map(fileGroup), OutsideRows(outside.length, 'changes', () => outside.map(fileGroup)))
      : h('div', { class: 'card' }, Empty('pencil', 'No agent edits yet', 'Each Edit and Write an agent makes shows here, grouped by file.')))),
    ch.commits.length > 0 && Section('commits', 'Commits', ch.commits.length, null, () => h('div', { class: 'card list commits' }, ch.commits.map(CommitRow))));
}

// ===================================================================== drawer
// An agent's page, depth on demand: its task, its todos, its live call, its
// result, every tool call (from its file), its edits, its chat and a message
// box. The session's depth (context, cost, tokens per agent) is Settings'.

function DrawerHead(lead, title, sub, extra) {
  return h('div', { key: 'head', class: 'drawer-head' },
    lead,
    h('div', { class: 'drawer-id' }, h('h2', { class: 'drawer-name', title }, title), sub && h('p', { class: 'drawer-sub' }, sub)),
    extra || null,
    h('button', { type: 'button', class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close', onClick: closeDrawer }, icon('x')));
}

function Block(key, title, note, body, extra) {
  return h('section', { key, class: 'block' },
    h('div', { class: 'block-head' }, h('h3', { class: 'block-title' }, title), note != null && note !== '' && h('span', { class: 'block-note' }, note), extra ? h('span', { class: 'block-extra' }, extra) : null),
    body);
}

function LiveStrip(a) {
  const waiting = a.status === 'waiting';
  return h('div', { key: 'live', class: `live${waiting ? ' is-waiting' : ''}`, role: 'status' },
    Glyph(waiting ? 'waiting' : 'active', 15),
    h('span', { class: 'live-label' }, waiting ? 'Waiting on you' : 'Now'),
    ToolTag(a.live.tool),
    h('span', { class: `live-text${PATHY.has(a.live.tool) ? ' mono' : ''}`, title: a.live.text }, a.live.text),
    h('span', { class: 'live-time' }, ageOf(a.live.at)));
}

/** While it is at work with no call in flight: the words it said since its latest call, whole as the state holds them. */
function SaidStrip(a) {
  return h('div', { key: 'live', class: 'live is-said', role: 'status' },
    h('span', { class: 'said-mark' }, icon('said')),
    h('span', { class: 'live-label' }, 'Said'),
    h('span', { class: 'live-text said-words', title: a.said.text }, '“', inline(oneLine(a.said.text)), '”'),
    h('span', { class: 'live-time' }, ageOf(a.said.at)));
}

function Outcome(a, x) {
  // refused, as Inspect's decisions say: by your hook (blocked), or by auto mode, a rule or you (denied)
  if (x.refused) return h('span', { class: 'outcome is-fail', title: x.refused === 'blocked' ? 'Blocked by your hook (Inspect: Permissions)' : 'Denied (Inspect: Permissions)' }, h('span', { class: 'refused-mark' }, '⊘'), x.refused);
  if (x.ok === null) {
    if (a.status === 'waiting') return h('span', { class: 'outcome is-wait' }, Glyph('waiting', 12), 'waiting');
    if (!isLive(a.status)) return h('span', { class: 'outcome' }, '—');
    return h('span', { class: 'outcome is-live' }, Glyph('active', 12), 'running');
  }
  if (x.ok === false) return h('span', { class: 'outcome is-fail' }, icon('x'), 'failed');
  return h('span', { class: 'outcome' }, msText(x.ms) || 'ok');
}

/** One tool call, as its file holds it; it opens on all of it: the command, what it says it does, its patch for an edit. */
function ActRow(a, x, i) {
  const id = x.id || `${x.at}:${x.tool}:${i}`;
  const key = `act|${a.id}|${id}`, open = isOpen(key, false);
  const edit = x.id ? IX.editById.get(x.id) : null;
  return h('div', { key: id, class: `act${open ? ' open' : ''}${x.ok === false ? ' is-fail' : ''}` },
    h('button', { type: 'button', class: 'act-head', 'data-nav': 'act', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      ToolTag(x.tool),
      h('span', { class: `act-target${PATHY.has(x.tool) && !x.command ? ' mono' : ''}`, title: x.command || x.target }, x.target),
      Outcome(a, x),
      h('span', { class: 'act-time' }, ageOf(x.at))),
    open && h('div', { class: 'act-body' },
      x.command && h('pre', { class: 'pre' }, h('code', null, x.command)),
      x.description && x.description !== x.target && h('p', { class: 'act-desc' }, x.description),
      !x.command && x.target && h('p', { class: `act-full${PATHY.has(x.tool) ? ' mono' : ''}` }, x.target),
      edit && PatchView(edit.id, `act:${a.id}`),
      h('p', { class: 'act-meta' }, [x.id, x.ms != null ? msText(x.ms) : '', x.ok === true ? 'ok' : x.ok === false ? 'failed' : 'no result yet', x.at ? new Date(x.at).toLocaleTimeString() : ''].filter(Boolean).join(' · '))));
}

/** What a thought of the log is labelled: Claude Code's live view of the thinking, which may be a summary. */
const THOUGHT_LABEL = 'Thinking, as Claude Code shows it';

/** A step's words in the log: what it said, quoted in italics after a speech mark; or its thinking, dimmer, under its label. Long ones fold. */
function WordRow(a, kind, w) {
  const key = `word|${a.id}|${kind}|${w.at}|${w.step}`;
  const isThought = kind === 'thought';
  const long = w.text.length > 420 || w.text.split('\n').length > 6;
  const text = isThought ? h('p', { class: 'word-text' }, w.text, w.isCut ? '…' : '') : h('p', { class: 'word-text' }, '“', inline(w.text), w.isCut ? '…' : '', '”');
  return h('div', { key, class: `act-word is-${kind}` },
    h('span', { class: 'word-mark' }, icon(isThought ? 'thought' : 'said')),
    h('div', { class: 'word-body' },
      isThought && h('span', { class: 'word-label' }, THOUGHT_LABEL),
      Folded(key, long, text)),
    h('span', { class: 'act-time', title: w.at ? new Date(w.at).toLocaleString() : '' }, ageOf(w.at)));
}

/** "Calls only · With their words": what an agent's Activity lists, kept for every drawer. */
function WordsToggle() {
  const set = on => { ui.actWords = on; store.set('actView', on ? 'words' : 'calls'); renderNow(); };
  const Toggle = (on, label) => h('button', { key: label, type: 'button', class: ui.actWords === on ? 'on' : '', 'aria-pressed': ui.actWords === on ? 'true' : 'false', onClick: () => set(on) }, h('span', null, label));
  return h('div', { class: 'seg-toggle seg-sm', role: 'group', 'aria-label': 'Activity shows' }, Toggle(false, 'Calls only'), Toggle(true, 'With their words'));
}

/**
 * Its log, newest first: each tool call (it opens on all of it) and, unless
 * "Calls only" is picked, what it said between them and its thinking as
 * Claude Code showed it, as its file holds them.
 */
function ActivityBlock(a, f) {
  let body;
  const hasWords = !!f.data && f.data.words.length > 0;
  if (!f.data) {
    body = f.status === 'error'
      ? h('div', { class: 'diff-err' }, icon('alert'), h('span', null, f.error), h('button', { class: 'btn btn-xs', type: 'button', onClick: () => { agentFiles.delete(a.fileId); renderNow(); } }, 'Retry'))
      : h('div', { class: 'act-wait' }, h('span', { class: 'sk sk-line' }), h('span', { class: 'sk sk-line short' }));
  } else {
    const log = logOf(f.data, ui.actWords).reverse();
    body = log.length ? h('div', { class: 'acts' }, log.map((e, i) => (e.kind === 'call' ? ActRow(a, e.call, i) : WordRow(a, e.kind, e.word)))) : h('p', { class: 'muted small' }, 'No tool calls yet.');
  }
  const n = f.data ? f.data.activity.length : 0;
  // the file keeps an agent's newest 14 calls
  return Block('activity', 'Activity', n >= 14 ? `the newest ${n}` : n ? plural(n, 'tool call') : '', body, hasWords ? WordsToggle() : null);
}

function AgentDrawer(id) {
  const a = IX.byId.get(id);
  if (!a) {
    return [
      DrawerHead(h('span', { key: 'lead', class: 'av-ghost', style: px(32) }), id, 'Not in this session'),
      h('div', { key: 'body', class: 'drawer-body' }, Empty('bot', 'This agent is not in the session', 'It may belong to an earlier session, or the link is old.')),
    ];
  }
  const f = agentFileOf(a);
  const file = f.data;
  const st = stateOf(a);
  const task = file && file.task ? file.task : a.task;
  const result = file && file.result ? file.result : a.result;
  const todos = file && file.todos.length ? file.todos : a.todos;
  const editIds = file ? file.edits : (IX.editsBy.get(a.id) || []).map(e => e.id);
  const edits = editIds.map(e => IX.editById.get(e)).filter(Boolean);
  const byPath = group(edits, e => e.path);
  const kind = a.kind === 'teammate' ? 'teammate' : a.background ? 'background' : '';
  const sub = [a.type || KIND_WORD[a.kind], a.model, kind].filter(Boolean).join(' · ');
  const scope = `agent:${a.id}`;
  return [
    DrawerHead(AvatarDot(a, 34), a.title, sub),
    h('div', { key: 'body', class: 'drawer-body' },
      h('div', { key: 'facts', class: 'facts' },
        h('span', { class: `fact st-${st}` }, Dot(statusOf(st).hue, isRunning(a.status)), statusOf(st).label),
        elapsedOf(a) && h('span', { class: 'fact mono' }, elapsedOf(a)),
        a.parent && h('span', { class: 'fact' }, 'started by ', NameLink(a.parent, 14)),
        a.tokens > 0 && h('span', { class: 'fact mono' }, `${num(a.tokens)} tokens`),
        a.shortId && h('span', { class: 'fact mono muted' }, a.shortId)),
      h('div', { key: 'actions', class: 'drawer-actions' },
        h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { ui.focusTo = composerId(scope); renderNow(); } }, icon('message'), 'Message'),
        h('button', { type: 'button', class: 'btn btn-sm', onClick: () => { ui.chatFilter = a.id; ui.pinChat = true; navigate('chat', isWide() ? route.drawer : null); } }, icon('arrowRight'), `Chat with ${a.title}`),
        a.stop && a.stop.can && StopAgent(a, 'btn btn-sm stop-drawer')),
      a.stop && !a.stop.can && a.stop.why && h('p', { key: 'stopwhy', class: 'stop-why' }, a.stop.why),
      NeedsList(a.id),
      // its call in flight, unless a need above already shows that very call; else its words since its latest call
      a.live ? !(IX.needsBy.get(a.id) || []).length && LiveStrip(a) : a.said && SaidStrip(a),
      task && Block('task', 'Task', a.isTaskCut && !file ? 'cut short: the whole of it is on its way' : '', Folded(`task|${a.id}`, task.length > 360 || task.split('\n').length > 6, h('p', { class: 'task-text' }, task))),
      todos.length > 0 && Block('todos', 'Todos', doneOf(todos), h('ul', { class: 'items' }, todos.map((t, i) => Item(`${i}:${t.text}`, t.status, t.text, t.doing)))),
      result && Block('result', a.id === 'main' ? 'Latest answer' : st === 'failed' ? 'Result · failed' : 'Result', a.endedAt ? agoText(a.endedAt) : '', Folded(`result|${a.id}`, result.length > 600 || result.split('\n').length > 10, Markdown(result))),
      ActivityBlock(a, f),
      edits.length > 0 && Block('edits', 'Edits', plural(byPath.size, 'file'), h('div', { class: 'fgroups' }, [...byPath].map(([p, list], i) => FileGroup(p, list, { scope: `agent:${a.id}`, open: i < 2, showAgent: false, outside: list.some(e => e.isOutside) }))))),
    h('div', { key: 'foot', class: 'drawer-foot' }, Composer(scope)),
  ];
}

function Drawer() {
  const d = route.drawer;
  if (!d || d.kind !== 'agent' || !S || S.empty) return null;
  return h('aside', { key: `drawer:${d.id}`, class: 'drawer drawer-agent', role: 'dialog', 'aria-label': `Agent: ${nameOf(d.id)}` }, AgentDrawer(d.id));
}

// ==================================================================== inspect
// The session's depth (#/inspect, tab 5), as the state's `inspect` holds it:
// what fills the context and each compaction, every permission decision and
// who made it, what is loaded, and the spend. Each section folds by its head
// to one line, as the pane's do, and shows only while it has something; `i`
// opens Inspect (again: back to the tab you came from).

function InspectPage() {
  const ins = S.inspect;
  const hasSpend = ins.agents.length > 0 || ins.costUsd != null || ins.contextPercent != null;
  const parts = [
    (ins.context || ins.compactions.length > 0) && ContextSection(),
    ins.permissions.total > 0 && PermissionsSection(),
    ins.loaded && LoadedSection(),
    hasSpend && InspectSection(),
  ];
  return h('div', { key: 'inspect', class: 'page page-inspect' },
    parts.some(Boolean) ? parts : h('div', { class: 'card' }, Empty('gauge', 'Nothing to inspect yet', 'What fills the context, every permission decision, what is loaded and the spend show here as Claude Code reports them.')));
}

/** A section of Inspect: folded, its head and its one line (`summary`); open, `right` at its head's right. */
function InsSection(id, title, count, summary, right, body) {
  const isShut = shut.has(id);
  return Section(id, title, count, isShut ? (summary ? h('span', { class: 'sec-summary', title: summary }, summary) : null) : right, body);
}

/** Context: its size of the window and its share, its rows as /context counts them (a bar, then each row), then the compactions. */
function ContextSection() {
  const ins = S.inspect, c = ins.context;
  return InsSection('ins-context', 'Context', null, ins.summary.context, c && h('span', { class: 'sec-note' }, 'as /context counts it'), () => h('div', { class: 'ins' },
    c ? h('div', { key: 'ctx', class: 'card ctx-card' },
      h('p', { class: 'ctx-figs' },
        h('strong', { class: 'ctx-size' }, c.text),
        h('span', { class: 'ctx-more' }, [`${Math.round(c.percent)}%`, c.autoCompactPercent != null ? `auto-compacts at ${c.autoCompactPercent}%` : 'auto-compact off', c.model].filter(Boolean).join(' · '))),
      ContextBar(c),
      h('div', { class: 'ctx-legend' }, c.rows.map(r => h('div', { key: r.name, class: `ctx-row is-${r.kind}` },
        h('span', { class: 'ctx-sw', style: { background: r.kind === 'free' ? 'transparent' : r.hue } }),
        h('span', { class: 'ctx-name' }, r.kind === 'deferred' && !/deferred|on demand/i.test(r.name) ? `${r.name} (on demand)` : r.name),
        h('span', { class: 'ctx-n' }, num(r.tokens))))))
    : h('div', { key: 'ctx', class: 'card' }, Empty('gauge', 'Not measured yet', 'What fills the context shows once Claude Code has measured it.')),
    ins.compactions.length > 0 && h('div', { key: 'cmp', class: 'ins-by' },
      h('p', { class: 'ins-caption' }, 'Compactions'),
      h('div', { class: 'card list cmps' }, ins.compactions.map(CompactionRow)))));
}

/** The context's bar: each row its share of the window, in its hue (the free space a dark track, the buffer dim); schemas loaded on demand are outside it. */
function ContextBar(c) {
  const rows = c.rows.filter(r => r.kind !== 'deferred' && r.tokens > 0);
  return h('div', { class: 'ctx-bar', role: 'img', 'aria-label': `Context: ${c.text}` },
    rows.map(r => h('span', { key: r.name, class: `ctx-seg is-${r.kind}`, title: `${r.name}: ${num(r.tokens)}`, style: { flex: `${r.tokens} 1 0px`, background: r.kind === 'free' ? '' : r.hue } })));
}

/** One compaction: when, whose (a press opens it), the trigger and how full before and after; the summary's first words, or why it was refused. */
function CompactionRow(x) {
  return h('div', { key: x.id || `${x.at}|${x.agent}`, class: 'cmp-row' },
    h('span', { class: 'cmp-when', title: timeTitle(x.at) }, ageOf(x.at)),
    h('span', { class: 'cmp-who' }, NameLink(x.agent, 16)),
    h('span', { class: 'cmp-how' }, [x.trigger, x.skipped != null ? 'not compacted' : x.figures].filter(Boolean).join(' · ')),
    h('span', { class: 'cmp-said', title: x.skipped != null ? x.skipped : x.summary }, x.skipped != null ? x.skipped : x.summary ? `“${x.summary}”` : ''));
}

/** The decisions Permissions lists until you ask for all of them (the state keeps the newest 100). */
const PERMS_SHOWN = 25;
/** A decision's hue: refused red, yours or waiting on you amber, being decided blue, allowed green. */
const permHue = d => (d.outcome === 'denied' || d.outcome === 'blocked' ? 'fail' : d.outcome === 'waiting' || d.by === 'you' ? 'wait' : d.outcome === 'deciding' ? 'run' : 'done');
/** A decision's mark: ⊘ refused, a clock while open, a hand where you allowed it, else a tick. */
const permIcon = d => (d.outcome === 'denied' || d.outcome === 'blocked' ? 'ban' : d.outcome === 'waiting' || d.outcome === 'deciding' ? 'clock' : d.by === 'you' ? 'hand' : 'check');

/** Permissions: every decision the deck saw, newest first: who, the tool and what it was aimed at; who decided and why, verbatim; when. The mode at the head's right. */
function PermissionsSection() {
  const ins = S.inspect, p = ins.permissions;
  const all = isOpen('perms|all', false);
  const list = all ? p.decisions : p.decisions.slice(0, PERMS_SHOWN);
  const mode = ins.modeText && h('span', { class: `mode-chip${ins.mode === 'bypassPermissions' ? ' is-fail' : ''}`, title: 'The permission mode, as Claude Code names it' }, ins.modeText);
  return InsSection('ins-permissions', 'Permissions', p.total, ins.summary.permissions, mode, () => h('div', { class: 'ins-by' },
    h('div', { class: 'card list perms' }, list.map(PermRow)),
    p.total > PERMS_SHOWN && h('button', { type: 'button', class: 'more more-start', 'aria-expanded': all ? 'true' : 'false', onClick: () => toggle('perms|all') }, all ? `Show the newest ${PERMS_SHOWN}` : `Show all ${p.total}`, icon('chevronDown', all ? 'flip' : ''))));
}

function PermRow(d) {
  const hue = permHue(d);
  return h('div', { key: d.id, class: `perm-row is-${d.outcome}`, 'data-nav': 'perm', tabindex: '-1' },
    h('span', { class: `perm-mark tx-${hue}` }, icon(permIcon(d))),
    h('span', { class: 'perm-main' },
      h('span', { class: 'perm-top' },
        NameLink(d.agent, 16),
        h('span', { class: 'perm-tool' }, d.tool),
        d.target && h('code', { class: 'code perm-target', title: d.target }, d.target)),
      h('span', { class: 'perm-say' },
        h('span', { class: `perm-verdict tx-${hue}` }, d.text),
        d.why && h('span', { class: 'perm-why', title: d.why }, d.why))),
    h('span', { class: 'perm-time', title: timeTitle(d.at) }, ageOf(d.at)));
}

/** Loaded: the model and its settings, the instruction files, memory, the skills, the MCP servers and the hooks, each group only while it has something. */
function LoadedSection() {
  const ins = S.inspect, l = ins.loaded;
  const model = l.model || S.header.model || l.modelId;
  const settings = [l.effort && `effort ${l.effort}`, l.outputStyle && `output style ${l.outputStyle}`].filter(Boolean).join(' · ');
  const memTokens = total(l.memory, f => f.tokens);
  const groups = [
    (model || settings || l.mode) && LoadedGroup('model', 'Model', [LoadedRow('model', 'cpu', model || 'Model not reported yet', settings, l.mode && h('span', { class: 'mode-chip' }, l.mode), l.modelId)]),
    l.instructions.length > 0 && LoadedGroup('instructions', 'Instructions', l.instructions.map((f, i) => LoadedRow(`file:${i}`, 'file', f.name, [f.kindText, f.lines != null && plural(f.lines, 'line'), f.tokens != null && `${num(f.tokens)} tokens`].filter(Boolean).join(' · '), f.how, f.path))),
    l.memory.length > 0 && LoadedGroup('memory', 'Memory', [LoadedRow('memory', 'bookmark', `Memory · ${plural(l.memory.length, 'file')}`, l.memory.map(f => f.name).join(' · '), memTokens ? `${num(memTokens)} tokens` : '', l.memory.map(f => f.path).join('\n'))]),
    (l.skills.total != null || l.skills.used.length > 0) && LoadedGroup('skills', 'Skills', [SkillsRow(l.skills)]),
    l.mcp.length > 0 && LoadedGroup('mcp', 'MCP servers', l.mcp.map(s => LoadedRow(`mcp:${s.server}`, 'plug', s.server, [plural(s.tools, 'tool'), s.deferred > 0 && `${s.deferred} loaded on demand`, s.calls > 0 && `used ${plural(s.calls, 'time')}`].filter(Boolean).join(' · '), ''))),
    l.hooks.length > 0 && LoadedGroup('hooks', 'Hooks', l.hooks.map((k, i) => LoadedRow(`hook:${i}`, 'hook', [k.event, k.matcher].filter(Boolean).join(' · '), k.command, k.sourceText)),
      l.hookEvents.map(e => h('p', { key: e.event, class: 'ld-note' }, `${e.event} hooks decided ${plural(e.decided, 'call')}${e.blocked ? `, blocked ${e.blocked}` : ''}`))),
  ];
  return InsSection('ins-loaded', 'Loaded', null, ins.summary.loaded, null, () => h('div', { class: 'ld' }, groups));
}

function LoadedGroup(key, title, rows, foot) {
  return h('div', { key, class: 'ld-group' }, h('p', { class: 'ins-caption' }, title), h('div', { class: 'card list' }, rows), foot && foot.length ? foot : null);
}

/** One thing loaded: its icon, its name and what it is, and a word at its right (`hover` the whole of it on hover). */
function LoadedRow(key, ic, title, sub, right, hover) {
  return h('div', { key, class: 'ld-row' },
    h('span', { class: 'ld-ic' }, icon(ic)),
    h('span', { class: 'ld-main' },
      h('span', { class: 'ld-title', title: hover || title }, title),
      sub && h('span', { class: 'ld-sub', title: sub }, sub)),
    right ? h('span', { class: 'ld-right' }, right) : null);
}

/** The skills: how many the context lists, those the Skill tool ran (most used first), and every name on demand. */
function SkillsRow(sk) {
  const open = isOpen('skills|names', false);
  return h('div', { key: 'skills', class: 'ld-row ld-skills' },
    h('span', { class: 'ld-ic' }, icon('sparkles')),
    h('span', { class: 'ld-main' },
      h('span', { class: 'ld-title' }, sk.total != null ? plural(sk.total, 'skill') : 'Skills'),
      h('span', { class: 'ld-sub' }, sk.used.length ? `used this session: ${sk.used.map(u => (u.count > 1 ? `${u.name} ×${u.count}` : u.name)).join(', ')}` : 'none used this session'),
      open && h('span', { class: 'ld-names' }, sk.names.join(' · '))),
    sk.names.length > 0 && h('button', { type: 'button', class: 'btn btn-xs', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle('skills|names') }, open ? 'Hide names' : 'Every name'));
}

function InspectStat(label, value, extra) {
  return h('div', { key: label, class: 'ins-stat' }, h('p', { class: 'ins-label' }, label), h('p', { class: 'ins-value' }, value), extra || null);
}

/** Spend: the context, the spend and the tokens, then each agent's tokens, requests, tool calls and failures. */
function InspectSection() {
  const ins = S.inspect;
  const sum = total(ins.agents, a => a.tokens.in + a.tokens.out + a.tokens.cacheRead);
  const pct = ins.contextPercent;
  const COLS = [['Agent', ''], ['Model', ''], ['In', 'Input tokens'], ['Out', 'Output tokens'], ['Cache', 'Cache reads'], ['Total', 'In, out and cache reads'], ['Req', 'Model requests'], ['Tools', 'Tool calls'], ['Err', 'Tool calls that failed']];
  return InsSection('ins-spend', 'Spend', null, ins.summary.spend, h('span', { class: 'sec-note' }, 'This session'), () => h('div', { class: 'ins' },
    h('div', { key: 'stats', class: 'ins-stats' },
      InspectStat('Context', pct == null ? '—' : `${Math.round(pct)}%`,
        pct != null && h('span', { class: 'bar' }, h('span', { class: `bar-fill${pct >= 80 ? ' hot' : ''}`, style: { width: `${clamp(pct, 0, 100)}%` } }))),
      InspectStat('Spend', usd(ins.costUsd)),
      InspectStat('Tokens', num(sum)),
      InspectStat('Agents', String(ins.agents.length))),
    h('div', { key: 'by', class: 'ins-by' },
      h('p', { class: 'ins-caption' }, 'Tokens by agent'),
      ins.agents.length
        ? h('div', { class: 'ins-table', role: 'table', 'aria-label': 'Tokens by agent' },
          h('div', { class: 'ins-row ins-th', role: 'row' }, COLS.map(([t, title]) => h('span', { key: t, role: 'columnheader', title: title || null }, t))),
          ins.agents.map(r => h('div', { key: r.id, class: 'ins-row', role: 'row' },
            h('span', { class: 'ins-who' }, NameLink(r.id, 18)),
            h('span', { class: 'mono ins-model' }, r.model || '—'),
            h('span', { class: 'mono' }, num(r.tokens.in)),
            h('span', { class: 'mono' }, num(r.tokens.out)),
            h('span', { class: 'mono' }, num(r.tokens.cacheRead)),
            h('span', { class: 'mono ins-total' }, num(r.tokens.in + r.tokens.out + r.tokens.cacheRead)),
            h('span', { class: 'mono' }, String(r.requests)),
            h('span', { class: 'mono' }, String(r.tools)),
            h('span', { class: `mono${r.errors ? ' err' : ' muted'}` }, String(r.errors)))))
        : h('div', { class: 'card' }, Empty('gauge', 'No agent has spent tokens yet', 'Each agent\'s tokens, requests and tool calls show here as it works.')))));
}

// =================================================================== settings
// The deck's own: the avatar style, and Help (what each tab is for, and the
// keys). Each section folds by its head, as the Dashboard's do; `h` brings
// Help into view.

function SettingsPage() {
  return h('div', { key: 'settings', class: 'page page-settings' },
    AvatarSection(),
    HelpSection());
}

/** The avatar style: every style the library draws, each a preview of three agents (done, at work, waiting on you) and its name; the one drawn checked. */
function AvatarSection() {
  const now = styleNow();
  return Section('avatars', 'Avatar style', null, null, () => h('div', { class: 'avatars' },
    h('p', { class: 'sec-text' }, 'How the agents look here, in the Desktop pane and in /deck demo, in every session. /deck avatars <style> picks one too.'),
    h('div', { class: 'styles', role: 'radiogroup', 'aria-label': 'Avatar style' },
      AV.STYLES.map(s => h('button', {
        key: s.id, type: 'button', role: 'radio', class: `style-pick${s.id === now ? ' on' : ''}`, 'aria-checked': s.id === now ? 'true' : 'false',
        title: `Draw the agents as ${s.name}`, onClick: () => pickStyle(s.id),
      },
      h('span', { class: 'style-faces', 'aria-hidden': 'true' }, WELCOME.map(a => h('span', { key: a.id }, Avatar(a, 30, { dot: true, style: s.id })))),
      h('span', { class: 'style-name' }, s.name),
      s.id === now && icon('check', 'style-check'))))));
}

/** What each tab is for, in its order. */
const TAB_HELP = [
  ['now', 'What needs you, a card per agent, the session\'s figures, the plan Claude made, the newest tool calls and the files the agents touched.'],
  ['chat', 'The session as a group chat. Pick Everyone or one agent at the top: your words go to the one picked (Everyone: the Orchestrator), or @name another.'],
  ['org', 'Every agent under the one that started it, as a chart (drag to pan, pinch or + and − to zoom) or as a list; or the Timeline, each agent’s work, waits on you and idle time over the run (hover to read one, press a lane to open it).'],
  ['changes', 'Git\'s uncommitted files, each with git\'s own diff and the agents\' own edits of it; their other edits; the commits; and Review.'],
  ['inspect', 'What fills the context and each compaction, every permission decision and who made it, what is loaded (model, CLAUDE.md, memory, skills, MCP servers, hooks), and the spend per agent.'],
  ['settings', 'This page: how the agents look, and these notes.'],
];

const KEYS = [
  ['1 2 3 4 5 6', 'Dashboard · Chat · Org · Changes · Inspect · Settings'],
  ['j  k', 'Move the focus down, up'],
  ['Enter', 'Open the focused row: an agent, a fold, a need, a file'],
  ['b', 'Back: close the agent'],
  ['s', 'All sessions: every Claude Code session on this machine'],
  ['n', 'The next thing that needs you'],
  ['m', 'Message: the composer (in an agent\'s drawer, that agent)'],
  ['i', 'Inspect (again: back)'],
  ['h  ?', 'Help, here in Settings'],
  ['/', 'The composer'],
  ['@', 'The composer, with @ typed'],
  ['Esc', 'Close the drawer'],
];

function HelpSection() {
  return Section('help', 'Help', null, null, () => h('div', { class: 'help' },
    h('dl', { key: 'tabs', class: 'card list help-tabs' }, TAB_HELP.map(([id, what]) => h('div', { key: id, class: 'help-tab' },
      h('dt', null, h('a', { class: 'help-tab-name', href: hrefOf(id, null) }, TABS.find(t => t[0] === id)[1])),
      h('dd', null, what)))),
    h('div', { key: 'keys', class: 'card help-keys' },
      h('p', { class: 'ins-caption' }, 'Keys'),
      h('p', { class: 'sec-text' }, '1 to 6, Enter and b work in the Desktop pane and the terminal too; the rest are this page\'s own. None fires while you type.'),
      h('dl', { class: 'keys' }, KEYS.map(([k, what]) => [h('dt', { key: `k:${k}` }, k.split(/\s+/).map((one, i) => h('kbd', { key: i }, one))), h('dd', { key: `d:${k}` }, what)])))));
}

// ===================================================================== notes

function Toast() {
  const t = ui.toast;
  return t && Date.now() < t.until ? h('div', { key: 'toast', class: 'toast', role: 'status' }, t.text) : null;
}

function ConnBanner() {
  const st = conn.status;
  if (st === 'reconnecting' && S) {
    const secs = conn.retryAt ? Math.max(0, Math.ceil((conn.retryAt - Date.now()) / 1000)) : 0;
    return h('div', { class: 'connbar connbar-wait', role: 'status' }, icon('wifiOff'),
      h('span', null, h('strong', null, 'Disconnected.'), ` Showing the last state; retrying${secs ? ` in ${secs}s` : ''}…`),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: retryNow }, 'Retry now'));
  }
  if (st === 'ended') {
    const at = S && S.now ? new Date(S.now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return h('div', { class: 'connbar connbar-idle', role: 'status' }, icon('power'),
      h('span', null, h('strong', null, 'The session ended.'), ` This is its last state${at ? ` (${at})` : ''}. Run /deck web in a new session to follow it live.`),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: retryNow }, 'Try again'));
  }
  if (st === 'denied' && S) {
    return h('div', { class: 'connbar connbar-idle', role: 'status' }, icon('octagon'),
      h('span', null, h('strong', null, 'This page lost access.'), ' The deck\'s link changed; run /deck web in Claude Code to open it again.'));
  }
  return null;
}

function Loading() {
  return h('div', { key: 'loading', class: 'page page-loading', 'aria-busy': 'true' },
    h('div', { class: 'sk sk-head' }),
    h('div', { class: 'sk sk-list' }),
    h('div', { class: 'sk sk-list short' }));
}

function Unreachable() {
  const denied = conn.status === 'denied';
  return h('div', { key: 'unreachable', class: 'page' },
    h('div', { class: 'card' }, Empty(denied ? 'octagon' : 'wifiOff',
      denied ? 'This link no longer works' : 'Can\'t reach the deck',
      denied ? 'The deck needs the link it opened with. Run /deck web in Claude Code to open it again.' : 'The deck server is not answering. If the Claude Code session ended, run /deck web in a new one.',
      denied ? null : h('button', { class: 'btn btn-sm', type: 'button', onClick: retryNow }, icon('refresh'), 'Try again'))));
}

/** The welcome's three agents: one done, one at work, one waiting on you. */
const WELCOME = [
  { id: 'bob', title: 'bob', kind: 'agent', status: 'done', todos: [] },
  { id: 'helper', title: 'helper', kind: 'agent', status: 'running', todos: [] },
  { id: 'deck-1', title: 'deck', kind: 'agent', status: 'waiting', todos: [] },
];

function Welcome() {
  const old = S && S.empty === 'old';
  return h('div', { key: 'welcome', class: 'page' },
    h('div', { class: 'card welcome' },
      h('div', { class: 'welcome-art', 'aria-hidden': 'true' },
        WELCOME.map((a, n) => h('span', { key: n, class: `welcome-av w${n}` }, Avatar(a, n === 1 ? 44 : 34, { live: true })))),
      h('p', { class: 'welcome-title' }, old ? 'Waiting for the deck\'s state' : 'Nothing yet'),
      h('p', { class: 'welcome-text' }, old
        ? 'The mod writing this session\'s state is older than this page. Start a new session (or reload the mod) and run /deck web again.'
        : 'Prompt Claude Code and this page fills in live: what Claude is doing, every agent it starts, what needs you, and the files they change.'),
      h('p', { class: 'welcome-live' }, Dot(conn.status === 'live' ? 'run' : 'idle', conn.status === 'live'), conn.status === 'live' ? 'Connected and listening' : 'Waiting for the session')));
}

function Page() {
  // every session on this machine, and another session's deck while it is read
  if (route.tab === 'sessions') return SessionsPage();
  if (route.session && !S) return ViewingWait();
  if (!S) return conn.status === 'denied' || conn.fails >= 2 ? Unreachable() : Loading();
  // Settings holds with nothing yet too: the avatar style and the help are the deck's own
  if (route.tab === 'settings') return SettingsPage();
  if (S.empty) return Welcome();
  if (route.tab === 'inspect') return InspectPage();
  return route.tab === 'chat' ? ChatPage() : route.tab === 'org' ? OrgPage() : route.tab === 'changes' ? ChangesPage() : NowPage();
}

function App() {
  const drawer = !!route.drawer && !!S && !S.empty;
  return h('div', { id: 'app', class: `app deck-${conn.status}${S ? '' : ' no-state'}${drawer ? ' has-drawer' : ''} on-${route.tab}` },
    Header(),
    ConnBanner(),
    h('main', { class: 'scroll', ref: el => { scroller = el; } }, Page()),
    drawer ? h('div', { key: 'scrim', class: 'scrim', onClick: closeDrawer }) : null,
    Drawer(),
    Toast());
}

// ======================================================================= keys
// The same keys as the Desktop pane and the terminal (web/CONTRACT.md,
// "Keys"), plus the page's own /, @, ? and Esc. None fires while you type,
// and no badge in the header says them: Settings' Help lists them.

const isTyping = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);

/** `i`: Inspect (an agent's drawer stays where the page is wide enough to keep it); pressed again there, back to the tab you came from. */
function openInspect() {
  if (route.tab === 'inspect') { navigate(ui.prevTab && ui.prevTab !== 'inspect' ? ui.prevTab : 'now'); return; }
  navigate('inspect', isWide() ? route.drawer : null);
}

/**
 * `h`: Settings' Help opened and brought into view (an agent's drawer stays
 * where the page is wide enough to keep it); pressed again there, back to
 * the tab you came from.
 */
function openSettings(section) {
  if (route.tab === 'settings' && ui.settingsAt === section) { navigate(ui.prevTab && ui.prevTab !== 'settings' ? ui.prevTab : 'now'); return; }
  setShut(section, false);
  navigate('settings', isWide() ? route.drawer : null);
  ui.settingsAt = section;
  scrollSoon(`sec-${section}`, 'settings');
}

/** Back: closes what is open over the page, the topmost first. */
function back() {
  if (route.drawer) { closeDrawer(); return true; }
  if (ui.goalOpen) { ui.goalOpen = false; renderNow(); return true; }
  return false;
}

/** Takes the Dashboard to need `n`'s card, open, and the focus with it. */
function goToNeed(n) {
  ui.needOpen.set(n.id, true);
  setShut('needs', false);
  navigate('now', isWide() ? route.drawer : null);
  scrollSoon(`need-${n.id}`, 'now', true);
}

function nextNeed() {
  if (!S.needs.length) { toast('Nothing needs you'); return; }
  ui.needAt = (ui.needAt + 1) % S.needs.length;
  goToNeed(S.needs[ui.needAt]);
}


/** The chat's composer, focused (`/`), with `@` typed when it is empty (`@`). */
function composeInChat(withAt) {
  if (withAt && !(ui.drafts.get('chat') || '').trim()) setDraft('chat', '@', false);
  ui.focusTo = composerId('chat');
  navigate('chat', isWide() ? route.drawer : null);
}

/** m: the composer of an open agent's drawer (its words go to that agent), else the chat's. */
function message() {
  const d = route.drawer;
  if (d && d.kind === 'agent' && IX.byId.has(d.id)) { ui.focusTo = composerId(`agent:${d.id}`); renderNow(); return; }
  composeInChat(false);
}

/** j/k: the focus to the next or the previous row of the layer in front (an open drawer, else the page). */
function moveFocus(dir) {
  if (typeof document.querySelectorAll !== 'function') return;
  const active = document.activeElement;
  const drawer = document.querySelector('.drawer');
  const layer = drawer && ((active && drawer.contains(active)) || !isWide()) ? drawer : document.querySelector('.scroll');
  if (!layer) return;
  const items = [...layer.querySelectorAll('[data-nav]')].filter(el => el.getClientRects().length > 0);
  if (!items.length) return;
  const cur = active && active.closest ? active.closest('[data-nav]') : null;
  const i = items.indexOf(cur);
  const next = items[i < 0 ? (dir > 0 ? 0 : items.length - 1) : clamp(i + dir, 0, items.length - 1)];
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest' });
}

/** What a key does (false: nothing, and it goes on to the browser). */
function keyAction(key) {
  // s: every session on this machine, or back from the list
  if (key === 's') { toggleSessions(); return true; }
  if (!S) return false;
  // nothing yet: the tabs and Settings' keys, the rest have nothing to act on
  if (S.empty && !/^[1-6ih?]$/.test(key)) return false;
  switch (key) {
    case '1': case '2': case '3': case '4': case '5': case '6': navigate(TABS[Number(key) - 1][0]); return true;
    case 'j': moveFocus(1); return true;
    case 'k': moveFocus(-1); return true;
    case 'b': return back();
    case 'n': nextNeed(); return true;
    case 'm': message(); return true;
    case 'i': openInspect(); return true;
    case 'h': case '?': openSettings('help'); return true;
    case '/': composeInChat(false); return true;
    case '@': composeInChat(true); return true;
    default: return false;
  }
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (isTyping(e.target)) { e.target.blur(); e.preventDefault(); return; }
    if (back()) e.preventDefault();
    return;
  }
  if (isTyping(e.target)) return;
  if (keyAction(e.key)) e.preventDefault();
}

// ===================================================================== render

let vroot = null, scroller = null, frame = 0, frameTimer = 0, shownKey = route.key;
/** Render counts and timings, for checking the page stays cheap (read it from the console). */
const stats = (window.__deckStats = { renders: 0, lastMs: 0, maxMs: 0 });

/** Render on the next frame. A hidden or occluded pane pauses frames, so a timer backs it up: the page is current the moment it shows. */
function invalidate() {
  if (frame) return;
  frame = requestAnimationFrame(renderNow);
  frameTimer = setTimeout(renderNow, 200);
}

function renderNow() {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (frameTimer) { clearTimeout(frameTimer); frameTimer = 0; }
  const t0 = performance.now();
  // Keep the chat at its newest row when the reader is already there (a send takes it there;
  // "Show more" leaves it where it is, so the reader goes on from the cut).
  const sc = scroller;
  const atEnd = !!sc && route.tab === 'chat' && shownKey === 'chat' && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 32;
  const pin = route.tab === 'chat' && (ui.pinChat || (!ui.holdChat && atEnd));
  ui.pinChat = false;
  ui.holdChat = false;
  const v = App();
  if (!vroot) document.getElementById('app').replaceWith(create(v, false));
  else patch(vroot, v, false);
  vroot = v;
  afterRender(pin);
  stats.renders++;
  stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
  stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
}

function afterRender(pin) {
  // Scroll memory per route: back where the reader was when they come back; the chat opens at its newest row
  // (and comes back to it, new rows and all, when the reader left it there).
  if (scroller && route.key !== shownKey) {
    const was = ui.scroll.get(route.key);
    scroller.scrollTop = was === 'end' || (was == null && route.key === 'chat') ? scroller.scrollHeight : was || 0;
    shownKey = route.key;
  } else if (scroller && pin) scroller.scrollTop = scroller.scrollHeight;
  if (ui.focusTo) {
    const el = document.getElementById(ui.focusTo);
    if (el) { el.focus(); if (el.setSelectionRange) { const n = el.value.length; try { el.setSelectionRange(n, n); } catch { /* not text */ } } }
    ui.focusTo = null;
  }
  // n and "Answer on Dashboard" bring a need's card into view (and the focus to it), once it has rendered; i and h a section of Settings.
  if (ui.scrollTo) {
    const want = ui.scrollTo;
    const el = scroller && want.on === route.key ? document.getElementById(want.id) : null;
    if (el) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
      scroller.scrollTop = Math.max(0, top);
      if (want.focus && el.focus) el.focus({ preventScroll: true });
      ui.scrollTo = null;
    } else if (Date.now() > want.until) ui.scrollTo = null;
  }
  // The timeline is as wide as its card: measured once drawn, drawn again when that changed.
  if (route.tab === 'org' && ui.orgView === 'timeline' && tl.box && tl.box.isConnected) {
    const w = tl.box.clientWidth - 32;
    if (w > 0 && Math.abs(w - tl.width) > 2) { tl.width = w; invalidate(); }
  }
  // The org chart fits itself until the reader pans or zooms it.
  if (route.tab === 'org' && ui.orgView === 'chart' && org.view && org.view.isConnected && lastLayout) {
    const size = `${org.view.clientWidth}x${org.view.clientHeight}`;
    if (!org.touched && (org.sig !== lastLayout.sig || org.size !== size)) fitOrg(lastLayout);
    org.sig = lastLayout.sig; org.size = size;
  }
  document.title = S && !S.empty ? `${S.needs.length ? '● ' : ''}${S.header.stateText} · Agent Deck` : 'Agent Deck';
}

// ============================================================== all sessions
// Every Claude Code session on this machine whose Agent Deck runs (the mod's
// `sessions`, hooks/sessions.ts): #/sessions lists them, this chat first; a
// press opens one's deck read-only at #/s/<id>/<tab>, under "Viewing <title>",
// read from its folder (/s/<id>/state and its lazy files) every 1.5 s while
// it shows, its own deck asked to keep writing them (`view`, every 30 s). An
// answer or a message goes to its own deck, which acts on it through Claude
// Code as on its own page's; where its deck takes none, "Answer it in its window".

/** The session whose deck shows (null: this one's), its state as read, why none shows, and its poll. */
const VIEW = { id: null, S: null, error: '', timer: 0, asked: 0, openedAt: 0, seq: 0 };
const VIEW_POLL = 1500, VIEW_AGAIN = 30000;

/** Where the lazy files come from: another session's under /s/<id>, this one's at the root. */
function baseUrl() { return route.session ? `/s/${encodeURIComponent(route.session)}` : ''; }

/** Every session on this machine as the page reads it (the mod's `sessions`); null from a mod that writes none. */
function sessionsOf(x) {
  x = obj(x);
  if (!x) return null;
  const rows = arr(x.rows).filter(r => r && typeof r.id === 'string' && r.id).map(r => {
    const state = STATE_TEXT[r.state] ? r.state : 'idle';
    return {
      id: r.id, isMe: r.isMe === true, title: str(r.title) || 'No request yet', state, stateText: str(r.stateText) || STATE_TEXT[state],
      surface: str(r.surface), place: str(r.place), repo: str(r.repo), cwd: str(r.cwd),
      need: typeof r.need === 'string' && r.need ? r.need : null, say: str(r.say), working: numOr(r.working, 0),
      costUsd: numOr(r.costUsd), cost: str(r.cost), at: numOr(r.at, 0), startedAt: numOr(r.startedAt, 0),
      canOpen: r.canOpen === true, canSteer: r.canSteer === true,
    };
  });
  const others = obj(x.others) || {};
  return { rows, text: str(x.text), others: { waiting: numOr(others.waiting, 0), working: numOr(others.working, 0) } };
}

const sessionsNow = () => (HOME && HOME.sessions) || null;
const sessionRow = id => { const list = sessionsNow(); return (list && list.rows.find(r => r.id === id)) || null; };

/** The index of the session viewed, this deck's own acks with its (a send refused here is acked here). */
function indexViewed() {
  IX = buildIndex(S);
  if (HOME) for (const k of HOME.acks) if (!IX.acks.has(k.id)) IX.acks.set(k.id, k);
}

/** Another session's deck from now (`id`), or this one's again (null): the lazy files read afresh, its state read until it shows. */
function switchView(id) {
  clearTimeout(VIEW.timer);
  Object.assign(VIEW, { id, S: null, error: '', asked: 0, openedAt: Date.now(), seq: VIEW.seq + 1 });
  agentFiles.clear();
  fullTexts.clear();
  diffs.clear();
  if (!id) {
    S = HOME;
    IX = S ? buildIndex(S) : null;
    if (S) noteResolved();
    invalidate();
    return;
  }
  S = null;
  IX = null;
  pollView(VIEW.seq);
}

/** Reads the session viewed again, and asks its deck to keep writing it every 30 s; then again in 1.5 s, while it shows. */
async function pollView(seq) {
  if (seq !== VIEW.seq || !VIEW.id) return;
  const id = VIEW.id;
  if (Date.now() - VIEW.asked >= VIEW_AGAIN) {
    VIEW.asked = Date.now();
    command({ cmd: 'view', session: id }).catch(() => {});
  }
  try {
    const res = await fetch(`/s/${encodeURIComponent(id)}/state${QT}`, { headers: AUTH, cache: 'no-store' });
    if (seq !== VIEW.seq) return;
    if (res.status === 404) VIEW.error = 'That session is not running any more: its deck lists it no longer.';
    else if (res.ok) {
      const v2 = v2Of(JSON.parse(await res.text()));
      if (seq !== VIEW.seq) return;
      if (v2) { applyViewed(v2); VIEW.error = ''; }
      else if (!VIEW.S) VIEW.error = Date.now() - VIEW.openedAt > 15000 ? 'Its deck has not written its state: answer it in its window.' : 'Asking its deck for its state…';
    }
  } catch { /* a torn write, or the server between restarts: the next poll reads it */ }
  if (seq !== VIEW.seq) return;
  invalidate();
  VIEW.timer = setTimeout(() => pollView(seq), VIEW_POLL);
}

/** The session viewed's state, as this page shows it: read-only, its questions answerable only where its deck takes answers from here. */
function applyViewed(v2) {
  if (VIEW.S && numOr(v2.now, 0) < VIEW.S.now) return;
  const s = normalize(v2);
  s.sessions = null;
  const row = sessionRow(VIEW.id);
  if (!row || !row.canSteer) s.needs = s.needs.map(n => ({ ...n, isAnswerable: false }));
  VIEW.S = s;
  S = s;
  indexViewed();
  noteResolved();
}

/** s: the list of sessions, or back to where it was opened from. */
function toggleSessions() {
  if (route.tab !== 'sessions') { ui.beforeSessions = location.hash || '#/now'; location.hash = '#/sessions'; setRoute(parseRoute()); renderNow(); return; }
  location.hash = ui.beforeSessions && ui.beforeSessions !== '#/sessions' ? ui.beforeSessions : '#/now';
  setRoute(parseRoute());
  renderNow();
}

/** The header's way to the list: "All sessions", after "◆ 1 other session needs you" while another waits on you. */
function SessionsLink() {
  const list = sessionsNow();
  if (!list) return null;
  const n = list.others.waiting;
  return h('a', { key: 'sessions', class: `hd-sessions${route.tab === 'sessions' ? ' on' : ''}`, href: '#/sessions', title: list.text },
    n > 0 && h('span', { class: 'hd-sessions-need' }, `◆ ${n}`, h('span', { class: 'hd-sessions-words' }, ` other ${n === 1 ? 'session needs' : 'sessions need'} you`)),
    h('span', { class: 'hd-sessions-label' }, icon('layers'), h('span', { class: 'hd-sessions-word' }, 'All sessions')));
}

/** Over another session's deck: "Viewing" and its title, where it runs, what goes from here, All sessions and Back to this chat. */
function ViewingBar() {
  if (!route.session) return null;
  const row = sessionRow(route.session);
  const where = row ? [row.place, row.repo].filter(Boolean).join(' · ') : '';
  const note = VIEW.error || (row && row.canSteer ? 'Read-only: answers and messages go through its own deck.' : 'Read-only: answer it in its window.');
  return h('div', { key: 'viewbar', class: 'viewbar' },
    h('span', { class: 'viewbar-tag' }, 'Viewing'),
    h('span', { class: 'viewbar-title' }, row ? row.title : 'Another session'),
    where && h('span', { class: 'viewbar-where' }, where),
    h('span', { class: 'viewbar-note' }, note),
    h('span', { class: 'viewbar-end' },
      h('a', { class: 'viewbar-link', href: '#/sessions' }, 'All sessions'),
      h('a', { class: 'btn btn-sm btn-primary', href: '#/now' }, 'Back to this chat')));
}

/** Another session's deck before its state is read: why nothing shows yet. */
function ViewingWait() {
  return h('div', { key: 'viewwait', class: 'page' },
    h('div', { class: 'card' }, Empty('layers', VIEW.error ? 'Nothing to show yet' : 'Reading its deck…', VIEW.error || 'Its deck writes its state while another deck looks; it shows here within seconds.')));
}

/** #/sessions: every session on this machine, this chat first, a row each; a press opens its deck (this chat's: the Dashboard). */
function SessionsPage() {
  const list = sessionsNow();
  return h('div', { key: 'sessions', class: 'page page-sessions' },
    h('div', { key: 'top', class: 'sess-top' },
      h('h1', { class: 'sess-title' }, 'All sessions'),
      list && h('span', { class: 'sess-sum' }, list.text)),
    !list
      ? h('div', { key: 'none', class: 'card' }, Empty('layers', 'No sessions listed', HOME && !HOME.empty ? 'This deck lists the sessions on this machine once it has read them.' : 'Waiting for this session\'s deck.'))
      : h('div', { key: 'list', class: 'card list sess-list' }, list.rows.map(SessionRow)),
    list && h('p', { key: 'note', class: 'sess-note' }, list.rows.length > 1
      ? 'Every Claude Code session here whose Agent Deck runs, Desktop and terminal alike. A press opens its deck: its Dashboard, Chat and Changes, read-only.'
      : 'No other session here runs Agent Deck now. Each one that does shows here, Desktop and terminal alike.'));
}

/** One session: its state's dot; its title and "this chat"; where it runs and what it waits on you for (amber) or is doing; its word, spend and age. */
function SessionRow(r) {
  const href = r.isMe ? '#/now' : r.canOpen ? `#/s/${encodeURIComponent(r.id)}/now` : null;
  const kids = [
    Dot(STATE_HUE[r.state], r.state === 'working'),
    h('span', { class: 'sess-main' },
      h('span', { class: 'sess-line' },
        h('span', { class: 'sess-name' }, r.title),
        r.isMe && h('span', { class: 'tag tag-wait' }, 'this chat')),
      h('span', { class: 'sess-sub' },
        r.surface && icon(r.surface === 'terminal' ? 'squareTerminal' : 'laptop', 'sess-ic'),
        h('span', { class: 'sess-where' }, [r.place, r.repo].filter(Boolean).join(' · ')),
        r.say && h('span', { class: `sess-say${r.need ? ' is-need' : ''}` }, `· ${r.say}`))),
    h('span', { class: `sess-state is-${r.state}` }, r.stateText),
    h('span', { class: 'sess-cost' }, r.cost),
    h('span', { class: 'sess-age' }, ageOf(r.at)),
  ];
  return href
    ? h('a', { key: r.id, class: `sess-row${r.isMe ? ' is-me' : ''}`, href, 'data-nav': '', title: r.cwd }, kids)
    : h('div', { key: r.id, class: 'sess-row', title: r.cwd }, kids);
}

function boot() {
  window.addEventListener('hashchange', () => {
    saveScroll();
    setRoute(parseRoute());
    renderNow();
  });
  window.addEventListener('resize', () => invalidate());
  document.addEventListener('keydown', onKey);
  // Coarse times ("2m") move on their own; the retry countdown ticks every second while it shows.
  setInterval(invalidate, 15000);
  setInterval(() => { if (conn.status === 'reconnecting') invalidate(); }, 1000);

  renderNow();
  connect();
  // a reload on another session's deck reads it again
  if (route.session) switchView(route.session);
}

// web/test/page.test.js reads this file without a browser and drives its views itself: it boots nothing then.
if (!globalThis.__deckTest) boot();
