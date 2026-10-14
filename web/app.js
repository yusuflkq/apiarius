/* Agent Deck: the web deck page.
 *
 * A Paperclip-style dashboard of a Claude Code session's agents, live over SSE
 * (see CONTRACT.md for the state schema, the routes and the commands). No
 * dependencies and no build step.
 *
 * The page renders through a tiny keyed virtual DOM (h/patch below). Every
 * state update builds the view again and patches the live DOM in place, so the
 * route, the selection, the open tab, scroll positions, the org chart's pan and
 * zoom, and a half-typed message all survive it. Elements keep their identity
 * by key (lists) or by position (fixed structure); nothing is re-rendered whole.
 */

// ===================================================================== basics

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const AUTH = TOKEN ? { 'X-Deck-Token': TOKEN } : {};
const QT = TOKEN ? `?t=${encodeURIComponent(TOKEN)}` : '';

/** The latest state (v1) and the indexes derived from it. */
let S = null;
let IX = null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const total = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0);
const clock = () => Math.max(Date.now(), S ? S.now || 0 : 0);

/** A coarse age: "now", "4m", "2h", "3d". */
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (clock() - t) / 1000);
  if (s < 45) return 'now';
  const m = Math.max(1, Math.floor(s / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
const agoText = t => (ago(t) === 'now' ? 'just now' : `${ago(t)} ago`);

/** A coarse duration: "<1m", "4m", "1h 12m". */
function span(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

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
  return span(ms);
}
const tokensOf = a => (a.tokens ? (a.tokens.in || 0) + (a.tokens.out || 0) + (a.tokens.cacheRead || 0) : 0);
/** "haiku-4.5 · 48k": the model and the tokens spent, these left out until there are some (no "· 0"). */
const modelLine = a => [a.model || '—', tokensOf(a) > 0 ? num(tokensOf(a)) : ''].filter(Boolean).join(' · ');
/** The time a duration runs to: now while the session is live, its last state's time once it ended (a run's length stops growing). */
const liveNow = () => (conn.status === 'ended' && S && S.now ? S.now : clock());
function splitPath(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i < 0 ? ['', p] : [p.slice(0, i + 1), p.slice(i + 1)];
}
function firstLine(text, max = 140) {
  const line = String(text || '').split('\n').find(l => l.trim()) || '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(`agent-deck:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`agent-deck:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

const STATUS = {
  running: { hue: 'run', label: 'running' },
  starting: { hue: 'run', label: 'starting' },
  waiting: { hue: 'wait', label: 'waiting' },
  done: { hue: 'done', label: 'done' },
  failed: { hue: 'fail', label: 'failed' },
  idle: { hue: 'idle', label: 'idle' },
};
const statusOf = st => STATUS[st] || STATUS.idle;
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
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  org: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  plan: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  changes: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  commit: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  dollar: '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  cornerDownRight: '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
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
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
};

function icon(name, cls) {
  return h('svg', { class: cls ? `ic ${cls}` : 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true', html: IC[name] || IC.circle });
}

const TOOL_ICON = { Read: 'eye', Edit: 'pencil', MultiEdit: 'pencil', NotebookEdit: 'pencil', Write: 'filePlus', Bash: 'terminal', PowerShell: 'terminal', Grep: 'search', Glob: 'folder', WebFetch: 'globe', WebSearch: 'globe', Agent: 'bot', Task: 'bot', SendMessage: 'message', TodoWrite: 'listChecks', TaskCreate: 'listChecks', TaskUpdate: 'listChecks', TaskGet: 'listChecks', TaskList: 'listChecks', ToolSearch: 'search', Skill: 'sparkles', AskUserQuestion: 'help' };
// A task-board call's target is its task's subject ("Add jitter → done" for an update), a tool search's the tools it loads, a question's its first question.
const TOOL_VERB = { Read: 'read', Edit: 'edited', MultiEdit: 'edited', NotebookEdit: 'edited', Write: 'wrote', Bash: 'ran', PowerShell: 'ran', Grep: 'searched', Glob: 'listed', WebFetch: 'fetched', WebSearch: 'searched the web for', Agent: 'started', Task: 'started', SendMessage: 'messaged', TodoWrite: 'updated its checklist', TaskCreate: 'added the step', TaskUpdate: 'updated', TaskGet: 'read', TaskList: 'read', ToolSearch: 'loaded', Skill: 'used', AskUserQuestion: 'asked you:' };
const PATHY = new Set(['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Glob', 'Grep', 'Bash', 'PowerShell']);

// ==================================================================== avatars
// Paperclip's ten persona gradients, on a gumdrop character with a small face.

const AV = [
  ['#f7cfdc', '#1f7a3a'], ['#c9a9e8', '#ee79a1'], ['#28164b', '#7a1530'], ['#f3e6c4', '#e3a21a'], ['#1f4dd6', '#3aa35c'],
  ['#e94b27', '#5a1122'], ['#7eb6e3', '#ee79a1'], ['#9ce8a7', '#bd7ff0'], ['#f3b49e', '#1f4ed4'], ['#f2d95f', '#4fbcba'],
];
const BLOB = 'M16 2.6c7.1 0 12.4 5.3 12.4 12.4v9.2a5.2 5.2 0 0 1-5.2 5.2H8.8a5.2 5.2 0 0 1-5.2-5.2V15C3.6 7.9 8.9 2.6 16 2.6z';
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const AV_HTML = AV.map(([a, b], i) => {
  const mid = (luminance(a) + luminance(b)) / 2;
  const f = mid < 0.18 ? 'rgba(255,255,255,.92)' : 'rgba(23,23,28,.82)';
  return `<path d="${BLOB}" fill="url(#ag${i})"/><path d="${BLOB}" fill="url(#agl)"/>` +
    `<circle cx="12.3" cy="16.4" r="1.45" fill="${f}"/><circle cx="19.7" cy="16.4" r="1.45" fill="${f}"/>` +
    `<path d="M14.3 20.3q1.7 1.3 3.4 0" fill="none" stroke="${f}" stroke-width="1.2" stroke-linecap="round"/>`;
});

function installDefs() {
  const stops = AV.map(([a, b], i) => `<linearGradient id="ag${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join('');
  const sheen = '<linearGradient id="agl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>';
  document.body.insertAdjacentHTML('afterbegin', `<svg class="defs" aria-hidden="true" focusable="false"><defs>${stops}${sheen}</defs></svg>`);
}

function Avatar(a, size = 24) {
  if (!a) return h('span', { class: 'av-ghost', style: { width: `${size}px`, height: `${size}px` } });
  const i = (((a.avatar | 0) % 10) + 10) % 10;
  return h('svg', { class: 'av', width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': 'true', html: AV_HTML[i] });
}
function YouAvatar(size = 24) {
  return h('span', { class: 'av-you', style: { width: `${size}px`, height: `${size}px`, 'font-size': `${Math.max(8, Math.round(size * 0.38))}px` } }, 'YO');
}
const whoAvatar = (id, size) => (id === 'you' ? YouAvatar(size) : Avatar(IX.byId.get(id), size));

/** An avatar with its status dot. */
function AvatarDot(a, size = 24) {
  const st = statusOf(a.status);
  return h('span', { class: 'avd', style: { width: `${size}px`, height: `${size}px` } },
    Avatar(a, size),
    h('span', { class: `avd-dot hue-${st.hue}${isRunning(a.status) ? ' pulse' : ''}` }));
}

function AvatarStack(ids, size = 20, max = 4) {
  const shown = ids.slice(0, max);
  return h('span', { class: 'stack', title: ids.map(nameOf).join(', ') },
    shown.map(id => h('span', { key: id, class: 'stack-item' }, whoAvatar(id, size))),
    ids.length > max && h('span', { class: 'stack-more' }, `+${ids.length - max}`));
}

const nameOf = id => (id === 'you' ? 'You' : IX && IX.byId.has(id) ? IX.byId.get(id).label : id);

// ============================================================== state + index

function buildIndex(s) {
  const byId = new Map();
  for (const a of s.agents) byId.set(a.id, a);
  const kids = new Map(), roots = [];
  for (const a of s.agents) {
    const p = a.parent && a.parent !== a.id && byId.has(a.parent) ? a.parent : null;
    if (p) (kids.get(p) || kids.set(p, []).get(p)).push(a);
    else roots.push(a);
  }
  const order = (x, y) => (y.kind === 'orchestrator') - (x.kind === 'orchestrator') || x.startedAt - y.startedAt || (x.id < y.id ? -1 : 1);
  roots.sort(order);
  for (const list of kids.values()) list.sort(order);

  // Tree order, depth, and for the list view's guides whether each ancestor has a later sibling.
  const tree = [], depth = new Map(), rails = new Map(), seen = new Set();
  const walk = (a, d, rail) => {
    if (seen.has(a.id)) return;
    seen.add(a.id); depth.set(a.id, d); rails.set(a.id, rail); tree.push(a);
    const list = kids.get(a.id) || [];
    list.forEach((c, i) => walk(c, d + 1, rail.concat(i < list.length - 1)));
  };
  roots.forEach(r => walk(r, 0, []));
  for (const a of s.agents) if (!seen.has(a.id)) { roots.push(a); walk(a, 0, []); }

  const group = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
  const talk = new Map();
  for (const m of s.messages) {
    (talk.get(m.from) || talk.set(m.from, []).get(m.from)).push(m);
    if (m.to !== m.from) (talk.get(m.to) || talk.set(m.to, []).get(m.to)).push(m);
  }
  return {
    byId, kids, roots, tree, depth, rails,
    editsBy: group(s.edits, e => e.agent),
    editsByPath: group(s.edits, e => e.path),
    actBy: group(s.activity, x => x.agent),
    talk,
    pendingBy: group(s.pending, p => p.agentId),
    pendingById: new Map(s.pending.map(p => [p.id, p])),
    // a later word on the same id replaces the earlier one: the last wins
    acks: new Map(s.acks.map(k => [k.id, k])),
  };
}

/** Questions first (the deck can answer them), then permissions; the oldest first in each. */
const byUrgency = (x, y) => (x.kind === 'question' ? 0 : 1) - (y.kind === 'question' ? 0 : 1) || (x.at || 0) - (y.at || 0);

/** A pending item as the page reads it: a question's questions and options always lists, an answer offered only when the mod says it can take one. */
function normalizePending(p) {
  const arr = v => (Array.isArray(v) ? v : []);
  const str = v => (typeof v === 'string' ? v : '');
  const questions = arr(p.questions).filter(q => q && typeof q.question === 'string').map(q => ({
    question: q.question,
    header: str(q.header),
    multiSelect: q.multiSelect === true,
    options: arr(q.options).filter(o => o && typeof o.label === 'string' && o.label.trim()).map(o => ({ label: o.label, description: str(o.description) })),
  }));
  return {
    ...p,
    kind: p.kind === 'permission' ? 'permission' : 'question',
    tool: str(p.tool),
    at: typeof p.at === 'number' ? p.at : 0,
    questions,
    command: str(p.command), path: str(p.path), description: str(p.description),
    isAnswerable: p.isAnswerable === true && p.kind !== 'permission' && questions.length > 0,
  };
}

function normalize(s) {
  const arr = v => (Array.isArray(v) ? v : []);
  s.session = s.session && typeof s.session === 'object' ? s.session : { id: '', cwd: '', startedAt: 0, model: '' };
  s.repo = s.repo && typeof s.repo === 'object' ? s.repo : null;
  s.goal = s.goal && typeof s.goal === 'object' ? s.goal : null;
  s.agents = arr(s.agents).filter(a => a && a.id);
  for (const a of s.agents) {
    a.label = a.label || a.id;
    a.type = a.type || (a.kind === 'orchestrator' ? 'main loop' : 'agent');
    a.checklist = a.checklist && Array.isArray(a.checklist.items) ? a.checklist : { items: [], done: 0, total: 0 };
    a.files = arr(a.files);
    a.tokens = a.tokens || { in: 0, out: 0, cacheRead: 0 };
  }
  s.messages = arr(s.messages); s.activity = arr(s.activity); s.files = arr(s.files);
  s.edits = arr(s.edits); s.changes = arr(s.changes); s.commits = arr(s.commits);
  s.pending = arr(s.pending).filter(p => p && typeof p.id === 'string' && p.id && typeof p.agentId === 'string').map(normalizePending).sort(byUrgency);
  s.acks = arr(s.acks).filter(k => k && typeof k.id === 'string' && k.id);
  s.plan = s.plan && Array.isArray(s.plan.steps) ? s.plan : { source: 'none', steps: [] };
  s.summary = s.summary || {};
  s.needs = s.needs || { tone: 'quiet', kind: 'quiet', text: '' };
  return s;
}

function apply(next) {
  if (!next || typeof next !== 'object' || next.v !== 1) return;
  // An older write of the same session (a slow fetch racing the stream) never replaces a newer one.
  if (S && S.session && next.session && S.session.id && next.session.id === S.session.id && next.now < S.now) return;
  S = normalize(next);
  IX = buildIndex(S);
  noteResolved();
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
/** How long a question the deck answered (or saw answered) stays on show once it resolved. */
const KEEP = 12000;

/** "It reads it…" reads "it reads it…" after a colon; a name ("Claude reads it…") keeps its capital. */
const softText = t => String(t || '').trim().replace(/^(It|Its|The|This|That|They|There|A|An|No|Not|Nothing|Only|Too|Could|Already)\b/, w => w.toLowerCase());
/** `word: text`, unless the text starts with that word already ("Answered in Claude Code"). */
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

// ============================================================ whole messages
// A message the state cut short ("isCut") is whole at /message/<id>, fetched
// the first time someone asks for the rest; cached.

const fullTexts = new Map();

function fullTextOf(id) {
  let t = fullTexts.get(id);
  if (t) return t;
  t = { status: 'loading', text: '', error: '' };
  fullTexts.set(id, t);
  fetch(`/message/${encodeURIComponent(id)}${QT}`, { headers: AUTH })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'The rest is not on disk yet.' : `The server answered ${r.status}.`))))
    .then(text => { t.status = 'ok'; t.text = text; })
    .catch(e => { t.status = 'error'; t.error = e.message || 'Could not load the rest.'; })
    // the thread keeps its place: the reader goes on from where the cut was
    .finally(() => { ui.holdThread = true; invalidate(); });
  return t;
}

// ==================================================================== patches
// Fetched lazily from /patch/<id> the first time a view shows them; cached.

const patches = new Map();

function patchOf(id) {
  let p = patches.get(id);
  if (p) return p;
  p = { status: 'loading', hunks: null, error: '' };
  patches.set(id, p);
  fetch(`/patch/${encodeURIComponent(id)}${QT}`, { headers: AUTH })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'The patch is not on disk yet.' : `The server answered ${r.status}.`))))
    .then(text => { p.status = 'ok'; p.hunks = parsePatch(text); })
    .catch(e => { p.status = 'error'; p.error = e.message || 'Could not load the patch.'; })
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

// ===================================================================== router

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  if (parts[0] === 'org') return { name: 'org', key: 'org' };
  // #/plan/<key> opens the Plan with that step open, scrolled into view
  if (parts[0] === 'plan') return { name: 'plan', key: 'plan', step: parts[1] || null };
  if (parts[0] === 'changes') return { name: 'changes', key: 'changes' };
  if (parts[0] === 'agent' && parts[1]) return { name: 'agent', id: parts[1], key: `agent:${parts[1]}` };
  return { name: 'dash', key: 'dash' };
}
let route = parseRoute();
const agentHref = id => `#/agent/${encodeURIComponent(id)}`;
const stepHref = key => `#/plan/${encodeURIComponent(key)}`;

// ================================================================== UI state
// Lives across renders and routes; never reset by a state update.

const ui = {
  orgView: store.get('orgView', 'chart'),
  tabs: new Map(),         // agent id -> 'diffs' | 'activity' | 'talk'
  open: new Map(),         // disclosure key -> open
  drafts: new Map(),       // agent id -> half-typed message
  inputs: new Map(),       // agent id -> its textarea
  sends: new Map(),        // agent id -> { status, text, at }: the POST in flight, or its error
  outbox: new Map(),       // agent id -> [{ id, text, at }]: what you sent it from here, matched to acks by id
  calls: new Map(),        // pending call id -> { item, sel, other, touched, sent, gone }: a question being answered here
  review: new Map(),       // scope -> { status, id, text, at }
  scroll: new Map(),       // route key -> scrollTop
  scrollTo: null,          // { id, on, until }: an element to bring into view once route `on` shows it (Open, #/plan/<key>)
  holdThread: false,       // the next render leaves the chat thread where it is ("Show more")
  pinThread: false,        // the next render takes the chat thread to its newest message (a send)
  focusTab: null,
};

/**
 * Brings element `id` into view once the page shows route `on` (a link's
 * click runs before its hashchange) and the element has rendered (the state
 * may still be on its way).
 */
function scrollSoon(id, on = route.key) {
  ui.scrollTo = { id, on, until: Date.now() + 4000 };
  invalidate();
}

/** What a route asks of the page beyond showing it: #/plan/<key> opens that step and scrolls to it. */
function followRoute() {
  if (route.name === 'plan' && route.step) {
    ui.open.set(`step|${route.step}`, true);
    scrollSoon(`step-${route.step}`);
  }
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

// ================================================================ components

function Pill(st, extra) {
  const s = statusOf(st);
  return h('span', { class: `pill hue-${s.hue}${extra ? ` ${extra}` : ''}` }, s.label);
}
function Dot(hue, pulse) {
  return h('span', { class: `dot hue-${hue}${pulse ? ' pulse' : ''}`, 'aria-hidden': 'true' });
}
function LiveCount(n) {
  return h('span', { class: 'live-count' }, Dot('run', true), h('span', null, `${n} live`));
}

/** The status glyph family: done, active (spinning), pending, failed, waiting, idle. */
const GLYPH = {
  done: ['circleCheck', 'done'], active: ['progress', 'run'], running: ['progress', 'run'], starting: ['progress', 'run'],
  pending: ['circle', 'idle'], failed: ['circleX', 'fail'], waiting: ['circlePause', 'wait'], idle: ['circleDashed', 'idle'],
};
function Glyph(st, size = 16) {
  const [ic, hue] = GLYPH[st] || GLYPH.pending;
  return h('svg', { class: `glyph hue-${hue}${ic === 'progress' ? ' spin' : ''}`, width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', html: IC[ic] });
}

function SecHead(title, count, right) {
  return h('div', { class: 'sec-head' },
    h('h2', { class: 'sec-title' }, title, count != null && h('span', { class: 'sec-count' }, String(count))),
    right || null);
}

function DiffStat(add, rem) {
  return h('span', { class: 'diffstat' },
    h('span', { class: 'plus' }, `+${add || 0}`),
    h('span', { class: 'minus' }, `−${rem || 0}`));
}

function PathText(p, cls) {
  const [dir, base] = splitPath(p);
  return h('span', { class: `path${cls ? ` ${cls}` : ''}`, title: p },
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

function AgentLink(id, size = 16) {
  const a = IX.byId.get(id);
  if (id === 'you') return h('span', { class: 'who' }, YouAvatar(size), 'You');
  if (!a) return h('span', { class: 'who' }, id);
  return h('a', { class: 'who who-link', href: agentHref(id) }, Avatar(a, size), a.label);
}

/** The plan's steps as one bar, a segment each; a segment opens its step on the Plan page. */
function ProgressBar(steps) {
  return h('nav', { class: 'segbar', 'aria-label': `Plan: ${steps.filter(s => s.status === 'done').length} of ${steps.length} steps done` },
    steps.map((s, i) => h('a', {
      key: stepKeyOf(s, i), class: `seg seg-${s.status}`, href: stepHref(stepKeyOf(s, i)),
      title: `Step ${i + 1}: ${s.text} (${(STEP_LABEL[s.status] || s.status).toLowerCase()})`,
      'aria-label': `Step ${i + 1}, ${(STEP_LABEL[s.status] || s.status).toLowerCase()}: ${s.text}`,
    })));
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

/** One line with `code` spans, as the mod words a wait ("Needs your OK to run `npm test`"): the spans read as code. */
function Ticks(text) {
  const parts = String(text || '').split(/`([^`\n]+)`/);
  return parts.length === 1 ? parts[0] : parts.map((p, i) => (i % 2 ? h('code', { key: `t${i}`, class: 'code' }, p) : p));
}
const plainTicks = text => String(text || '').replace(/`([^`\n]+)`/g, '$1');

/** What an agent waits on you for, after its name: the mod's words ("asks: …", "needs your OK to …"), or an older mod's ("allow Bash …"). */
const waitWords = a => (/^(asks|needs|waits)\b/.test(a.needsYou || '') ? `${a.label} ${a.needsYou}` : `${a.label} waits on you: ${a.needsYou}`);

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

// --------------------------------------------------------------------- diffs

function PatchView(id, scope) {
  const p = patchOf(id);
  if (p.status === 'loading') return h('div', { class: 'diff diff-wait' }, h('span', { class: 'sk sk-line' }), h('span', { class: 'sk sk-line short' }));
  if (p.status === 'error') {
    return h('div', { class: 'diff-err' }, icon('alert'), h('span', null, p.error),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: () => { patches.delete(id); renderNow(); } }, 'Retry'));
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

/** One file's edits, collapsible, each edit with its patch. */
function FileGroup(path, edits, opts) {
  const key = `${opts.scope}|${path}`;
  const open = isOpen(key, opts.open);
  const add = total(edits, e => e.added), rem = total(edits, e => e.removed);
  const live = opts.live;
  return h('div', { key: path, class: `fgroup${open ? ' open' : ''}` },
    h('button', { class: 'fgroup-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      icon('file', 'fic'),
      PathText(path, 'grow'),
      live && Dot('run', true),
      opts.editors && AvatarStack(opts.editors, 18),
      h('span', { class: 'fgroup-n' }, plural(edits.length, 'edit')),
      DiffStat(add, rem)),
    open && h('div', { class: 'fgroup-body' },
      edits.map(e => h('div', { key: e.id, class: 'edit' },
        h('div', { class: 'edit-head' },
          ToolTag(e.tool),
          opts.showAgent && AgentLink(e.agent),
          h('span', { class: 'edit-time' }, agoText(e.at)),
          DiffStat(e.added, e.removed)),
        PatchView(e.id, opts.scope)))));
}

// ================================================================== needs you
// What waits on you, from the state's `pending`: a question (AskUserQuestion)
// you can answer right here when the mod can take the answer, or a permission
// prompt, shown in full and answered in Claude Code. The same card shows on
// the Dashboard, above the agent page's tabs and in its Plan step. Once its
// call resolves the item leaves the state; a card you answered (or began to)
// stays a few seconds more to say how it ended.

const EDITS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);

/** What a permission is for: "run" a command, "edit" a path, "use WebFetch". */
function permitOf(p) {
  if (p.command) return { verb: 'run', what: p.command };
  if (p.path) return { verb: EDITS.has(p.tool) ? 'edit' : p.tool === 'Write' ? 'write' : p.tool === 'Read' ? 'read' : `use ${p.tool || 'a tool'} on`, what: p.path };
  return { verb: `use ${p.tool || 'a tool'}`, what: '' };
}

/** One line for a pending item: "Orchestrator asks: Which store?", "Tests needs your OK to run npm test". */
function pendingText(p) {
  const name = nameOf(p.agentId);
  if (p.kind === 'question') {
    const qs = p.questions;
    return qs.length > 1 ? `${name} asks ${qs.length} questions` : `${name} asks: ${qs.length ? qs[0].question : 'a question'}`;
  }
  const { verb, what } = permitOf(p);
  const shown = firstLine(what, 90);
  // the command or path as code (one with backticks of its own stays as it is)
  return `${name} needs your OK to ${verb}${shown ? ` ${shown.includes('`') ? shown : `\`${shown}\``}` : ''}`;
}

/** The answering state of a question call: per question the option chosen (one) or the ones checked (many) and the Other text, and what was sent. */
function callOf(p) {
  let c = ui.calls.get(p.id);
  if (!c || c.sel.length !== p.questions.length) {
    c = { item: p, sel: p.questions.map(q => (q.multiSelect ? [] : null)), other: p.questions.map(() => ''), touched: false, sent: null, gone: 0 };
    ui.calls.set(p.id, c);
  }
  c.item = p;
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

/** Notes each call that left the state, so a card answered here can say how it ended for a few seconds; forgets the rest. */
function noteResolved() {
  const live = new Set(S.pending.map(p => p.id));
  const now = Date.now();
  for (const [id, c] of ui.calls) {
    if (live.has(id)) { c.gone = 0; continue; }
    if (!c.touched && !c.sent) { ui.calls.delete(id); continue; }
    if (!c.gone) { c.gone = now; setTimeout(invalidate, KEEP + 50); }
    else if (now - c.gone > KEEP) ui.calls.delete(id);
  }
}

/** The calls that resolved a moment ago after you answered or began to (for `agentId`, or all). */
function resolvedCalls(agentId) {
  const now = Date.now();
  return [...ui.calls.values()].filter(c => c.gone && now - c.gone < KEEP && (c.touched || c.sent) && (!agentId || c.item.agentId === agentId));
}

async function sendAnswers(p, answers) {
  const c = callOf(p);
  const id = newCmdId('a');
  c.touched = true;
  c.sent = { id, state: 'sending', at: Date.now(), answers };
  renderNow();
  try {
    await command({ cmd: 'answer', id, callId: p.id, answers });
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

function Option(p, q, qi, o, oi, c, mode) {
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
    if (mode.instant) sendAnswers(p, { [q.question]: o.label });
    else renderNow();
  };
  return h('button', {
    key: `o${oi}:${o.label}`, type: 'button', class: `q-opt${on ? ' on' : ''}`, disabled: mode.locked,
    role: mode.instant ? null : multi ? 'checkbox' : 'radio', 'aria-checked': mode.instant ? null : on ? 'true' : 'false',
    onClick: pick,
  }, body);
}

function OtherField(p, q, qi, c, mode) {
  const text = String(c.other[qi] || '');
  const chosen = text.trim() && (q.multiSelect || c.sel[qi] == null);
  const sendOther = () => { if (text.trim()) sendAnswers(p, { [q.question]: text.trim().slice(0, 2000) }); };
  return h('div', { class: `q-other${chosen ? ' on' : ''}` },
    h('input', {
      key: `other:${p.id}:${qi}`, class: 'q-other-input', type: 'text', maxlength: '2000', disabled: mode.locked,
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

function QuestionBlock(p, q, qi, c, mode) {
  return h('div', { key: `q${qi}`, class: 'q', role: 'group', 'aria-label': q.question },
    h('p', { class: 'q-head' },
      q.header && h('span', { class: 'q-chip' }, q.header),
      h('span', { class: 'q-text' }, q.question),
      q.multiSelect && h('span', { class: 'q-hint' }, mode.readOnly ? 'several allowed' : 'pick any')),
    q.options.length > 0 && h('div', { class: 'q-opts', role: mode.instant || mode.readOnly ? null : q.multiSelect ? 'group' : 'radiogroup', 'aria-label': q.question },
      q.options.map((o, oi) => Option(p, q, qi, o, oi, c, mode))),
    !mode.readOnly && OtherField(p, q, qi, c, mode));
}

/** A question card's form: one question with one answer sends on a click; several, or checkboxes, take a Submit. */
function QuestionForm(p) {
  const c = callOf(p);
  const qs = p.questions;
  const st = answerState(c);
  const readOnly = !p.isAnswerable;
  const instant = qs.length === 1 && !qs[0].multiSelect;
  const locked = readOnly || !!(st && (st.busy || st.done));
  const answers = {};
  qs.forEach((q, qi) => { const v = answerOf(q, qi, c); if (v) answers[q.question] = v.slice(0, 2000); });
  const ready = Object.keys(answers).length === qs.length;
  const submit = () => { if (ready && !locked) sendAnswers(p, answers); };
  const mode = { readOnly, instant, locked, submit };
  return h('div', { class: 'qform' },
    h('div', { class: `qform-qs${qs.length > 1 ? ' several' : ''}` }, qs.map((q, qi) => QuestionBlock(p, q, qi, c, mode))),
    h('div', { class: 'qform-foot' },
      st ? StatusNote(st) : h('span', { class: 'needs-where' }, readOnly ? 'Answer it in Claude Code.' : 'Or answer it in Claude Code.'),
      !readOnly && !instant && h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !ready || locked, onClick: submit }, qs.length > 1 ? 'Submit answers' : 'Submit')));
}

function PermissionBody(p) {
  const { what } = permitOf(p);
  return h('div', { class: 'permit' },
    what && (p.command
      ? h('pre', { class: 'permit-cmd' }, h('code', null, what))
      : h('p', { class: 'permit-path' }, icon('file', 'fic'), PathText(what, 'grow'))),
    p.description && h('p', { class: 'permit-desc' }, p.description),
    h('p', { class: 'needs-where' }, 'Allow or deny it in Claude Code.'));
}

/** The card for one pending item; `where` is 'dash' (it gets Open), 'agent' or 'plan'. */
function PendingCard(p, where) {
  const question = p.kind === 'question';
  const name = nameOf(p.agentId);
  const title = question
    ? p.questions.length > 1 ? `${name} asks ${p.questions.length} questions` : `${name} asks you`
    : `${name} needs your OK to ${permitOf(p).verb}`;
  const open = () => scrollSoon(`pending-${p.id}`, `agent:${p.agentId}`);
  return h('section', { key: `pend:${p.id}`, id: `pending-${p.id}`, class: `needs needs-${p.kind}`, 'aria-label': title },
    h('div', { class: 'needs-head' },
      icon(question ? 'help' : 'shield', 'needs-ic'),
      h('p', { class: 'needs-title' }, title),
      h('span', { class: 'needs-time', title: p.at ? new Date(p.at).toLocaleString() : '' }, ago(p.at)),
      where === 'dash' && IX.byId.has(p.agentId) && h('a', { class: 'btn btn-sm banner-btn', href: agentHref(p.agentId), onClick: open }, 'Open', icon('arrowRight'))),
    question ? QuestionForm(p) : PermissionBody(p));
}

/** A question's card once its call resolved: how it ended, and what was picked. */
function ResolvedCard(c) {
  const p = c.item;
  const st = c.sent ? sendState(c.sent, 'answer') : null;
  // the thread's word on it: "You answered: …", "Answered in Claude Code: …", "Auto-answered after idle: …"
  const choice = (IX.talk.get(p.agentId) || []).filter(m => m.kind === 'choice' && (m.callId ? m.callId === p.id : m.at >= (p.at || 0) - 1000)).pop();
  let line;
  if (st && st.ack) line = st;
  else if (choice) line = { tone: /^you answered/i.test(choice.text) ? 'done' : 'idle', icon: 'check', text: choice.text };
  else if (st && st.busy) line = st;
  else line = { tone: 'idle', icon: 'check', text: c.sent ? 'Answered' : 'Answered in Claude Code' };
  // each question, with the answer sent from here when there was one
  const said = c.sent ? c.sent.answers : {};
  return h('section', { key: `pend:${p.id}`, id: `pending-${p.id}`, class: `needs needs-resolved tone-${line.tone}`, role: 'status' },
    h('div', { class: 'needs-head' },
      line.glyph ? Glyph(line.glyph, 16) : h('span', { class: `needs-ic hue-${line.tone}` }, icon(line.icon === 'x' ? 'circleX' : line.icon === 'clock' ? 'clock' : 'circleCheck')),
      h('p', { class: 'needs-title' }, line.text),
      h('span', { class: 'needs-time' }, ago(c.gone))),
    p.questions.map((q, i) => h('p', { key: `r${i}`, class: 'needs-recap' },
      h('span', { class: 'needs-recap-q' }, i === 0 ? `${nameOf(p.agentId)} asked: ${q.question}` : q.question),
      said[q.question] && [h('span', { key: 'arrow', class: 'needs-recap-arrow', 'aria-hidden': 'true' }, ' → '), h('span', { key: 'a', class: 'needs-recap-a' }, said[q.question])])));
}

/** A pending item as one row: the Dashboard's "also waiting on you". */
function PendingRow(p) {
  const a = IX.byId.get(p.agentId);
  return h('a', { key: `row:${p.id}`, class: 'needs-row', href: agentHref(p.agentId), onClick: () => scrollSoon(`pending-${p.id}`, `agent:${p.agentId}`) },
    a ? Avatar(a, 20) : icon(p.kind === 'question' ? 'help' : 'shield'),
    h('span', { class: 'needs-row-text', title: plainTicks(pendingText(p)) }, Ticks(pendingText(p))),
    h('span', { class: 'needs-row-time' }, ago(p.at)),
    icon('arrowRight', 'needs-row-go'));
}

/** An agent's pending cards (and the ones that just resolved), for its page and its Plan step. */
function AgentNeeds(a, where) {
  const list = IX.pendingBy.get(a.id) || [];
  const done = resolvedCalls(a.id);
  if (!list.length && !done.length) return null;
  return h('div', { class: 'needs-stack', key: `needs:${a.id}` }, done.map(ResolvedCard), list.map(p => PendingCard(p, where)));
}

// ========================================================================= pages

// ----------------------------------------------------------------- dashboard

/**
 * The top of the Dashboard: the first pending item as a card (questions
 * first: you can answer them here), the others as rows, and the cards that
 * just resolved; or, with nothing pending, the mod's one-line banner.
 */
function NeedsYou() {
  const list = S.pending;
  const done = resolvedCalls();
  const n = S.needs;
  // the banner says the same as a card about the same agent: leave it out then
  const covered = n && n.agentId && list.some(p => p.agentId === n.agentId);
  if (!list.length && !done.length) return NeedsBanner();
  const [first, ...rest] = list;
  return h('div', { class: 'needs-stack' },
    done.map(ResolvedCard),
    first && PendingCard(first, 'dash'),
    rest.length > 0 && h('div', { key: 'more', class: 'card list needs-more', 'aria-label': 'Also waiting on you' }, rest.map(PendingRow)),
    covered ? null : NeedsBanner());
}

function NeedsBanner() {
  const n = S.needs;
  if (n && n.text && n.tone === 'done') {
    return h('div', { class: 'banner banner-done', role: 'status' },
      icon('circleCheck', 'banner-ic'),
      h('div', { class: 'banner-body' },
        h('p', { class: 'banner-title' }, n.text),
        h('p', { class: 'banner-text' }, S.changes.length ? `${plural(S.changes.length, 'file')} changed and not committed yet.` : 'Nothing left to commit.')),
      S.changes.length > 0 && h('a', { class: 'btn btn-sm banner-btn', href: '#/changes' }, 'Review changes', icon('arrowRight')));
  }
  if (!n || !n.text || !(n.tone === 'alert' || n.tone === 'attention')) return null;
  const alert = n.tone === 'alert';
  const target = n.agentId && IX.byId.has(n.agentId) ? agentHref(n.agentId) : n.path ? '#/changes' : null;
  return h('div', { class: `banner banner-${alert ? 'fail' : 'wait'}`, role: 'status' },
    icon(alert ? 'octagon' : 'hand', 'banner-ic'),
    h('div', { class: 'banner-body' },
      h('p', { class: 'banner-title' }, Ticks(n.text)),
      h('p', { class: 'banner-text' }, alert ? 'Open the agent to see what went wrong, then tell Claude how to go on.' : 'Answer it in the Claude Code conversation; the agent carries on once you do.')),
    target && h('a', { class: 'btn btn-sm banner-btn', href: target }, 'Open', icon('arrowRight')));
}

/** Where `lead` ends in `text`, a run of white space in either matching any in the other; -1 when the text does not start with it. */
function endOfLead(text, lead) {
  let i = 0;
  for (let j = 0; j < lead.length; j++) {
    if (/\s/.test(lead[j])) {
      if (!/\s/.test(text[i] || '')) return -1;
      while (i < text.length && /\s/.test(text[i])) i++;
      while (j + 1 < lead.length && /\s/.test(lead[j + 1])) j++;
    } else if (text[i++] !== lead[j]) return -1;
  }
  return i;
}

/**
 * The goal's words after its headline, so nothing reads twice. The headline
 * is the text's first line, or its first 80 characters cut with "…": then
 * the rest starts at the word the cut fell in. A headline of other words
 * (a slash command's) leaves the text whole.
 */
function goalRest(g) {
  const text = String(g.text || '').trim();
  const head = String(g.headline || '').trim();
  if (!head) return text;
  const isCut = head.endsWith('…');
  let at = endOfLead(text, isCut ? head.slice(0, -1).trimEnd() : head);
  if (at < 0) return text;
  if (isCut) while (at > 0 && /\S/.test(text[at - 1]) && /\S/.test(text[at] || '')) at--;
  return text.slice(at).replace(/^[\s.:;,!?-]+/, '');
}

function GoalCard() {
  const g = S.goal, sum = S.summary, steps = S.plan.steps;
  if (!g) {
    return h('section', { class: 'sec' }, SecHead('Goal'),
      h('div', { class: 'card goal goal-empty' }, icon('target', 'goal-ic'), h('p', { class: 'muted' }, 'No goal yet. Your next prompt to Claude Code becomes the goal.')));
  }
  const rest = goalRest(g);
  const last = g.followUps && g.followUps.length ? g.followUps[g.followUps.length - 1] : null;
  return h('section', { class: 'sec' },
    SecHead('Goal', null, h('a', { class: 'sec-link', href: '#/plan' }, 'Plan', icon('arrowRight'))),
    h('div', { class: 'card goal' },
      h('div', { class: 'goal-top' },
        icon('target', 'goal-ic'),
        h('div', { class: 'goal-main' },
          h('p', { class: 'goal-head' }, g.headline || firstLine(g.text)),
          rest && h('p', { class: 'goal-text' }, rest)),
        h('span', { class: 'goal-time', title: new Date(g.at).toLocaleString() }, ago(g.at))),
      last && h('p', { class: 'goal-follow' }, icon('cornerDownRight'), h('span', { class: 'goal-follow-text' }, last.text), h('span', { class: 'goal-follow-time' }, ago(last.at))),
      steps.length > 0 && h('div', { class: 'goal-step' },
        ProgressBar(steps),
        h('p', { class: 'goal-step-text' },
          h('span', { class: 'goal-step-n' }, sum.step ? `Step ${sum.step}` : `${steps.filter(s => s.status === 'done').length} of ${steps.length} done`),
          sum.stepText && h('span', { class: 'goal-step-sep' }, '·'),
          sum.stepText && h('span', { class: 'goal-step-name' }, sum.stepText)))));
}

function runTime(a) {
  if (a.status === 'done') return `Finished ${agoText(a.endedAt || a.startedAt)}`;
  if (a.status === 'failed') return `Failed ${agoText(a.endedAt || a.startedAt)}`;
  if (a.status === 'waiting') return `Waiting · ${span(liveNow() - a.startedAt)}`;
  return `Started ${agoText(a.startedAt)}`;
}

/**
 * What a run card's chip says: an agent's scope or task; the Orchestrator's
 * place in the plan (the goal it would repeat stands right above it), with
 * the steps done beside it.
 */
function chipOf(a) {
  const steps = S.plan.steps;
  if (a.kind === 'orchestrator' && steps.length) {
    const done = steps.filter(x => x.status === 'done').length;
    const isAllDone = done === steps.length;
    const text = S.summary.stepText || (isAllDone ? 'Plan done' : `${done} of ${steps.length} steps done`);
    const glyph = isAllDone ? 'done' : S.agents.some(x => isRunning(x.status)) ? 'active' : 'idle';
    return { text, glyph, n: `${done}/${steps.length}` };
  }
  const cl = a.checklist;
  const glyph = a.status === 'waiting' ? 'waiting' : a.status === 'failed' ? 'failed' : a.status === 'done' ? 'done' : a.status === 'idle' ? 'idle' : 'active';
  return { text: a.scope || firstLine(a.task) || a.type, glyph, n: cl.total > 0 ? `${cl.done}/${cl.total}` : '' };
}

function RunCard(a) {
  const chip = chipOf(a);
  // the line under the chip never repeats it (an agent that just started says its scope in both)
  const now = a.now && a.now !== chip.text ? a.now : isRunning(a.status) ? 'Working' : a.now;
  return h('a', { key: a.id, class: `run-card is-${a.status}`, href: agentHref(a.id), enter: true, 'aria-label': `${a.label}, ${statusOf(a.status).label}` },
    h('div', { class: 'run-head' },
      AvatarDot(a, 24),
      h('span', { class: 'run-name', title: `${a.label} · ${a.type}` }, a.label),
      Pill(a.status, 'pill-fixed')),
    h('div', { class: 'run-chip' },
      Glyph(chip.glyph, 15),
      h('span', { class: 'run-chip-text', title: chip.text }, chip.text),
      chip.n && h('span', { class: 'run-chip-n' }, chip.n)),
    h('p', { class: 'run-now', title: plainTicks(now) }, a.lastAction && a.lastAction.isLive && isRunning(a.status) ? h('span', { class: 'run-now-live' }, Dot('run', true)) : null, now ? Ticks(now) : ' '),
    h('div', { class: 'run-foot' },
      h('span', { class: 'run-model' }, modelLine(a)),
      h('span', { class: 'run-time' }, runTime(a))));
}

/** The dashboard's cards: the Orchestrator, then agents in the order they started (stable: new ones append). */
function dashAgents() {
  const list = IX.tree.slice().sort((x, y) => (y.kind === 'orchestrator') - (x.kind === 'orchestrator') || x.startedAt - y.startedAt);
  const cap = 12;
  if (list.length <= cap) return { shown: list, hidden: 0 };
  return { shown: [list[0], ...list.slice(list.length - (cap - 1))], hidden: list.length - cap };
}

function Kpi(ic, value, label, desc, href, onClick) {
  const inner = [
    h('div', { class: 'kpi-main' },
      h('p', { class: 'kpi-value' }, String(value)),
      h('p', { class: 'kpi-label' }, label),
      h('p', { class: 'kpi-desc', title: plainTicks(desc) }, Ticks(desc))),
    icon(ic, 'kpi-ic'),
  ];
  return href ? h('a', { class: 'kpi', href, onClick: onClick || null }, inner) : h('div', { class: 'kpi' }, inner);
}

/** How many of `list` are in each state, as their cards and pills show it: the same numbers on every page. */
function countsOf(list) {
  const c = { running: 0, waiting: 0, done: 0, failed: 0, idle: 0 };
  for (const a of list) {
    if (isRunning(a.status)) c.running++;
    else if (a.status in c) c[a.status]++;
  }
  return c;
}

function Kpis() {
  const s = S.summary, steps = S.plan.steps;
  const done = steps.filter(x => x.status === 'done').length;
  const c = countsOf(S.agents);
  // the agents that wait on you: an item pending (the Orchestrator's question too), or a wait the mod saw some other way
  const waiting = new Set([...S.pending.map(p => p.agentId), ...S.agents.filter(a => a.status === 'waiting').map(a => a.id)]);
  const first = S.pending[0];
  const waiter = first ? null : S.agents.find(a => a.needsYou) || S.agents.find(a => a.status === 'waiting');
  const parts = [];
  if (s.tokens) parts.push(`${num(s.tokens)} tokens`);
  if (s.minutes != null) parts.push(s.minutes < 1 ? '<1 min' : `${s.minutes} min`);
  if (s.contextPercent != null) parts.push(`context ${Math.round(s.contextPercent)}%`);
  const stepLine = !steps.length ? 'No plan yet' : s.stepText ? `Now: ${s.stepText}` : done === steps.length ? 'All steps done' : 'No step in progress';
  const waitLine = first ? pendingText(first) : waiter ? (waiter.needsYou ? waitWords(waiter) : `${waiter.label}: ${waiter.now || 'waiting'}`) : 'Nothing waits on you';
  const waitHref = first ? agentHref(first.agentId) : waiter ? agentHref(waiter.id) : null;
  return h('div', { class: 'kpis' },
    Kpi('bot', c.running, 'Agents running', `${c.waiting} waiting · ${c.done} done · ${c.failed} failed`, '#/org'),
    Kpi('listChecks', steps.length ? `${done}/${steps.length}` : '—', 'Plan steps done', stepLine, '#/plan'),
    Kpi('dollar', usd(s.costUsd), 'Session spend', parts.join(' · ') || '—'),
    Kpi('hand', Math.max(waiting.size, s.waiting || 0), 'Waiting on you', waitLine, waitHref, first ? () => scrollSoon(`pending-${first.id}`, `agent:${first.agentId}`) : null));
}

function describe(x) {
  const verb = TOOL_VERB[x.tool] || `used ${x.tool} on`;
  const mono = PATHY.has(x.tool);
  return { verb, target: x.target || '', mono };
}

function Outcome(x) {
  if (x.ok === null || x.ok === undefined) {
    const a = IX.byId.get(x.agent);
    if (a && a.status === 'waiting') return h('span', { class: 'outcome is-wait' }, Glyph('waiting', 12), 'waiting');
    if (a && !isLive(a.status)) return h('span', { class: 'outcome' }, '—');
    return h('span', { class: 'outcome is-live' }, Glyph('active', 12), 'running');
  }
  if (x.ok === false) return h('span', { class: 'outcome is-fail' }, icon('x'), 'failed');
  return h('span', { class: 'outcome' }, msText(x.ms) || 'ok');
}

const actKey = x => `${x.at}|${x.agent}|${x.tool}|${x.target}`;

function ActivityRow(x) {
  const a = IX.byId.get(x.agent);
  const d = describe(x);
  return h('a', { key: actKey(x), class: 'act-row', href: agentHref(x.agent), enter: true, onClick: () => ui.tabs.set(x.agent, 'activity') },
    Avatar(a, 24),
    h('p', { class: 'act-text' },
      h('span', { class: 'act-who' }, a ? a.label : x.agent), ' ',
      h('span', { class: 'act-verb' }, d.verb), ' ',
      d.target && h('span', { class: d.mono ? 'act-target mono' : 'act-target' }, d.target)),
    Outcome(x),
    h('span', { class: 'act-time' }, ago(x.at)));
}

function FileRow(f) {
  // opens on the Changes page whichever list holds it: the uncommitted files, or the other edits
  return h('a', { key: f.path, class: 'file-row', href: '#/changes', onClick: () => { ui.open.set(`chg|${f.path}`, true); ui.open.set(`byfile|${f.path}`, true); } },
    icon('file', 'fic'),
    PathText(f.path, 'grow'),
    f.live && Dot('run', true),
    f.isShared && h('span', { class: 'tag tag-wait', title: 'More than one agent edited this file' }, 'shared'),
    AvatarStack(f.editors || [], 18),
    DiffStat(f.added, f.removed));
}

function Welcome() {
  return h('div', { key: 'welcome', class: 'page page-dash' },
    h('div', { class: 'card welcome' },
      h('div', { class: 'welcome-art', 'aria-hidden': 'true' },
        [8, 1, 5].map((i, n) => h('span', { key: n, class: `welcome-av w${n}` }, Avatar({ avatar: i }, n === 1 ? 44 : 34)))),
      h('p', { class: 'welcome-title' }, 'No agents yet'),
      h('p', { class: 'welcome-text' }, 'Prompt Claude Code and this page fills in live: the Orchestrator, every agent it delegates to, what each is doing, and the files they change.'),
      h('p', { class: 'welcome-live' }, Dot(conn.status === 'live' ? 'run' : 'idle', conn.status === 'live'), conn.status === 'live' ? 'Connected and listening' : 'Waiting for the session')));
}

function Dashboard() {
  if (S.empty || (!S.agents.length && !S.goal)) return Welcome();
  const { shown, hidden } = dashAgents();
  const recent = S.activity.slice(-10).reverse();
  // The mod's order (first touched first), so a file never jumps when it is edited again; live ones pulse.
  const files = S.files.slice(-10);
  return h('div', { key: 'dash', class: 'page page-dash' },
    NeedsYou(),
    GoalCard(),
    h('section', { class: 'sec' },
      SecHead('Agents', S.agents.length, h('a', { class: 'sec-link', href: '#/org' }, hidden ? `${hidden} more in the org chart` : 'Org chart', icon('arrowRight'))),
      S.agents.length
        ? h('div', { class: 'run-grid' }, shown.map(RunCard))
        : h('div', { class: 'card' }, Empty('bot', 'No agents yet', 'When Claude Code starts working, the Orchestrator and the agents it delegates to show up here.'))),
    Kpis(),
    h('div', { class: 'dash-cols' },
      h('section', { class: 'sec' },
        SecHead('Recent activity'),
        recent.length ? h('div', { class: 'card list' }, recent.map(ActivityRow)) : h('div', { class: 'card' }, Empty('activity', 'No tool calls yet', 'Every agent\'s tool calls show here as they happen.'))),
      h('section', { class: 'sec' },
        SecHead('Files', S.files.length || null, S.files.length ? h('a', { class: 'sec-link', href: '#/changes' }, 'Changes', icon('arrowRight')) : null),
        files.length ? h('div', { class: 'card list' }, files.map(FileRow)) : h('div', { class: 'card' }, Empty('file', 'No files touched yet', 'Files the agents edit show here, with who is on each.')))));
}

// ----------------------------------------------------------------- org chart

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
 * shows the whole chart instead, as small as that takes, and new agents keep
 * it whole.
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
/** A scroll (two fingers, a wheel; Shift for across) pans the chart, so the rest of a tall tree is a scroll away; a pinch or Ctrl+wheel zooms at the pointer. */
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

function OrgCard(n) {
  const a = n.a, st = statusOf(a.status);
  return h('button', {
    key: a.id, type: 'button', class: `org-card is-${a.status}`, style: { left: `${n.x}px`, top: `${n.y}px` },
    title: `${a.label}: ${a.now || st.label}`, 'aria-label': `${a.label}, ${a.type}, ${st.label}`,
    onClick: e => { if (suppressClick) { e.preventDefault(); return; } location.hash = agentHref(a.id); },
  },
  h('span', { class: 'org-av' }, Avatar(a, 22), h('span', { class: `org-dot hue-${st.hue}${isRunning(a.status) ? ' pulse' : ''}` })),
  h('span', { class: 'org-text' },
    h('span', { class: 'org-name' }, a.label),
    h('span', { class: 'org-type' }, a.type),
    h('span', { class: 'org-meta' }, modelLine(a)),
    h('span', { class: 'org-now' }, a.now ? Ticks(a.now) : st.label)));
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

/** Tree guides for the list view: a rail per ancestor level that continues, and this row's elbow. */
function Guides(a) {
  const d = IX.depth.get(a.id) || 0, rails = IX.rails.get(a.id) || [];
  const out = [];
  for (let l = 1; l <= d; l++) {
    const more = rails[l - 1];
    if (l < d) { if (more) out.push(h('span', { key: `r${l}`, class: 'g-rail', style: { '--l': String(l) } })); }
    else out.push(h('span', { key: `e${l}`, class: `g-elbow${more ? ' more' : ''}`, style: { '--l': String(l) } }));
  }
  if ((IX.kids.get(a.id) || []).length) out.push(h('span', { key: 'down', class: 'g-down', style: { '--l': String(d + 1) } }));
  return out;
}

function TreeRow(a) {
  const d = IX.depth.get(a.id) || 0;
  return h('a', { key: a.id, class: `tree-row is-${a.status}`, href: agentHref(a.id), style: { '--d': String(d) } },
    Guides(a),
    h('span', { class: 'tree-who' },
      AvatarDot(a, 28),
      h('span', { class: 'tree-id' },
        h('span', { class: 'tree-name' }, a.label),
        h('span', { class: 'tree-sub' }, a.scope ? `${a.type} · ${a.scope}` : a.type))),
    h('span', { class: 'tree-now' }, Ticks(a.now)),
    h('span', { class: 'tree-meta' }, modelLine(a)),
    h('span', { class: 'tree-status' }, Pill(a.status, 'pill-fixed')));
}

function OrgPage() {
  // what its cards show, counted as the dashboard and the sidebar count it
  const c = countsOf(S.agents);
  const counts = [plural(S.agents.length, 'agent')];
  if (c.running) counts.push(`${c.running} running`);
  if (c.waiting) counts.push(`${c.waiting} waiting`);
  if (c.failed) counts.push(`${c.failed} failed`);
  const view = ui.orgView === 'list' ? 'list' : 'chart';
  const setView = v => { ui.orgView = v; store.set('orgView', v); renderNow(); };
  return h('div', { key: 'org', class: `page page-org view-${view}` },
    h('div', { class: 'org-bar' },
      h('p', { class: 'org-count' }, counts.join(' · ')),
      h('div', { class: 'seg-toggle', role: 'group', 'aria-label': 'View' },
        h('button', { type: 'button', class: view === 'list' ? 'on' : '', 'aria-pressed': view === 'list' ? 'true' : 'false', title: 'List', onClick: () => setView('list') }, icon('list'), h('span', { class: 'sr' }, 'List')),
        h('button', { type: 'button', class: view === 'chart' ? 'on' : '', 'aria-pressed': view === 'chart' ? 'true' : 'false', title: 'Org chart', onClick: () => setView('chart') }, icon('org'), h('span', { class: 'sr' }, 'Org chart')))),
    !S.agents.length
      ? h('div', { class: 'card' }, Empty('org', 'No agents yet', 'The Orchestrator and the agents it delegates to appear here as a tree.'))
      : view === 'list'
        ? h('div', { key: 'list', class: 'card list tree' }, IX.tree.map(TreeRow))
        : OrgChart());
}

// ----------------------------------------------------------------- agent page

function tabOf(a) {
  if (!ui.tabs.has(a.id)) ui.tabs.set(a.id, (IX.editsBy.get(a.id) || []).length ? 'diffs' : isLive(a.status) ? 'activity' : 'talk');
  return ui.tabs.get(a.id);
}

function reviewText(a) {
  const files = a.files.length ? ` It touched ${a.files.slice(0, 6).join(', ')}${a.files.length > 6 ? ` and ${a.files.length - 6} more` : ''}.` : '';
  return `Review what the ${a.label} agent did against its task.${files} Tell me what is wrong or missing before I commit.`;
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
      ? h('div', { key: 'ask', class: 'confirm', role: 'dialog', 'aria-label': 'Ask Claude for a review', onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); close(); } } },
        h('p', { class: 'confirm-text' }, 'Ask Claude to review these changes? It runs when Claude is free.'),
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn btn-xs', type: 'button', onClick: close }, 'Cancel'),
          h('button', { class: 'btn btn-xs btn-primary', type: 'button', ref: el => requestAnimationFrame(() => el.focus()), onClick: go }, 'Ask Claude')))
      : note ? h('div', { key: 'note', class: 'confirm confirm-note' }, StatusNote(note, 'review-note')) : null);
}

function AgentHeader(a) {
  const parent = a.parent && IX.byId.get(a.parent);
  const live = isLive(a.status);
  const ran = (a.endedAt || liveNow()) - a.startedAt;
  return h('header', { class: 'agent-head' },
    h('span', { class: 'agent-av' }, Avatar(a, 40)),
    h('div', { class: 'agent-id' },
      h('h2', { class: 'agent-name' }, a.label),
      h('p', { class: 'agent-sub' },
        h('span', null, a.type),
        h('span', { class: 'sep' }, '·'),
        h('span', null, 'reports to '),
        parent ? AgentLink(parent.id) : a.kind === 'orchestrator' ? AgentLink('you') : h('span', null, '—')),
      h('p', { class: 'agent-meta' },
        live ? `started ${agoText(a.startedAt)}` : `ran ${span(ran)}`,
        h('span', { class: 'sep' }, '·'), `${a.tools || 0} tool calls`,
        a.errors ? [h('span', { class: 'sep' }, '·'), h('span', { class: 'err' }, plural(a.errors, 'error'))] : null)),
    h('div', { class: 'agent-actions' },
      a.kind !== 'orchestrator' && ReviewButton(`agent:${a.id}`, reviewText(a), 'Review'),
      Pill(a.status, 'pill-fixed')));
}

/** Paperclip's live-run strip: what a running agent is doing this moment. */
function NowStrip(a) {
  if (!isRunning(a.status)) return null;
  const la = a.lastAction, live = la && la.isLive;
  return h('div', { class: 'nowstrip', role: 'status' },
    Glyph('active', 16),
    h('span', { class: 'nowstrip-label' }, 'Now'),
    live ? ToolTag(la.tool) : null,
    h('span', { class: live && PATHY.has(la.tool) ? 'nowstrip-text mono' : 'nowstrip-text', title: live ? la.text : plainTicks(a.now) }, live ? la.text : a.now ? Ticks(a.now) : 'Working'),
    h('span', { class: 'nowstrip-time' }, la ? ago(la.at) : ''));
}

function Stat(ic, label, value, sub, cls) {
  return h('div', { class: 'stat card' },
    h('p', { class: 'stat-label' }, icon(ic), label),
    h('p', { class: `stat-value${cls ? ` ${cls}` : ''}` }, value),
    h('p', { class: 'stat-sub' }, sub));
}

function AgentStats(a) {
  const t = a.tokens;
  return h('div', { class: 'stats' },
    Stat('cpu', 'Model', a.model || '—', a.kind === 'orchestrator' ? 'the main loop' : a.kind),
    Stat('coins', 'Tokens', num(tokensOf(a)), `${num(t.in)} in · ${num(t.out)} out · ${num(t.cacheRead)} cache`),
    Stat('diff', 'Lines changed', h('span', { class: 'diffstat big' }, h('span', { class: 'plus' }, `+${a.added || 0}`), h('span', { class: 'minus' }, `−${a.removed || 0}`)), a.files.length ? plural(a.files.length, 'file') : isLive(a.status) ? 'no files yet' : 'no files changed'),
    Stat('wrench', 'Tool calls', String(a.tools || 0), a.errors ? plural(a.errors, 'error') : 'no errors', a.errors ? 'has-err' : ''));
}

function TaskCard(a) {
  const text = String(a.task || '').trim();
  const long = text.length > 360 || text.split('\n').length > 6;
  const key = `task|${a.id}`, open = isOpen(key, false);
  return h('section', { class: 'card panel task' },
    h('div', { class: 'panel-head' }, h('h3', { class: 'panel-title' }, 'Task'), a.scope && h('span', { class: 'panel-note' }, a.scope)),
    text ? h('div', { class: `task-text${long && !open ? ' clamped' : ''}` }, text) : h('p', { class: 'muted' }, a.kind === 'orchestrator' ? 'Your prompts in the Claude Code conversation.' : 'No task recorded.'),
    long && h('button', { class: 'more', type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) }, open ? 'Show less' : 'Show more', icon('chevronDown', open ? 'flip' : '')));
}

function ChecklistCard(a) {
  const cl = a.checklist;
  const pct = cl.total ? Math.round((cl.done / cl.total) * 100) : 0;
  return h('section', { class: `card panel checklist agent-${a.status}` },
    h('div', { class: 'panel-head' },
      h('h3', { class: 'panel-title' }, 'Checklist'),
      cl.total > 0 && h('span', { class: 'panel-count' }, `${cl.done}/${cl.total}`)),
    cl.total > 0 && h('div', { class: 'bar', role: 'img', 'aria-label': `${cl.done} of ${cl.total} done` }, h('span', { class: `bar-fill${cl.done === cl.total ? ' full' : ''}`, style: { width: `${pct}%` } })),
    cl.items.length
      ? h('ul', { class: 'checks' }, cl.items.map((it, i) => h('li', { key: `${i}:${it.text}`, class: `check is-${it.status}` },
        Glyph(it.status === 'active' && !isRunning(a.status) ? (a.status === 'waiting' ? 'waiting' : a.status === 'failed' ? 'failed' : 'active') : it.status, 16),
        h('span', { class: 'check-body' },
          h('span', { class: 'check-text' }, it.text),
          it.status === 'active' && it.doing && h('span', { class: 'check-doing' }, it.doing)))))
      : h('p', { class: 'muted' }, 'No checklist yet.'));
}

function ResultCard(a) {
  if (!a.result) return null;
  // the Orchestrator's is its latest answer to you, one per turn
  const title = a.kind === 'orchestrator' ? 'Latest answer' : a.status === 'failed' ? 'Result · failed' : 'Result';
  return h('section', { class: `card panel result${a.status === 'failed' ? ' is-failed' : ''}` },
    h('div', { class: 'panel-head' }, h('h3', { class: 'panel-title' }, title), a.endedAt && h('span', { class: 'panel-note mono' }, agoText(a.endedAt))),
    Markdown(a.result));
}

const TABS = [['diffs', 'Diffs'], ['activity', 'Activity'], ['talk', 'Talk']];

function Tabs(a, tab) {
  const counts = {
    diffs: new Set((IX.editsBy.get(a.id) || []).map(e => e.path)).size,
    activity: (IX.actBy.get(a.id) || []).length,
    talk: (IX.talk.get(a.id) || []).length,
  };
  const go = (id, byKey) => { ui.tabs.set(a.id, id); if (byKey) ui.focusTab = id; renderNow(); };
  const keys = e => {
    const i = TABS.findIndex(t => t[0] === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    go(TABS[(next + TABS.length) % TABS.length][0], true);
  };
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Agent detail', onKeyDown: keys },
    TABS.map(([id, label]) => h('button', {
      key: id, type: 'button', role: 'tab', id: `tab-${id}`, class: id === tab ? 'tab on' : 'tab',
      'aria-selected': id === tab ? 'true' : 'false', 'aria-controls': 'tabpanel', tabindex: id === tab ? '0' : '-1',
      onClick: () => go(id),
    }, label, h('span', { class: 'tab-n' }, String(counts[id])))));
}

function DiffsTab(a) {
  const edits = IX.editsBy.get(a.id) || [];
  if (!edits.length) return h('div', { class: 'card' }, isLive(a.status) ? Empty('changes', 'No edits yet', 'Its Edit and Write patches show here the moment it makes them.') : Empty('changes', 'No edits', 'This agent did not edit any files.'));
  const byPath = new Map();
  for (const e of edits) (byPath.get(e.path) || byPath.set(e.path, []).get(e.path)).push(e);
  const live = new Set(S.files.filter(f => f.live).map(f => f.path));
  let i = 0;
  return h('div', { class: 'fgroups' },
    [...byPath].map(([path, list]) => FileGroup(path, list, { scope: `agent:${a.id}`, open: i++ < 4, live: live.has(path) && isRunning(a.status) })));
}

function ActivityTab(a) {
  const rows = (IX.actBy.get(a.id) || []).slice(-80).reverse();
  if (!rows.length) return h('div', { class: 'card' }, Empty('activity', 'No tool calls yet', 'Its tool calls show here as it makes them.'));
  return h('div', { class: 'card list acts' },
    rows.map(x => h('div', { key: actKey(x), class: `act-line${x.ok === false ? ' is-fail' : ''}`, enter: true },
      ToolTag(x.tool),
      h('span', { class: PATHY.has(x.tool) ? 'act-line-target mono' : 'act-line-target', title: x.target }, x.target || ''),
      Outcome(x),
      h('span', { class: 'act-time' }, ago(x.at)))));
}

// The Orchestrator's answers are its replies to you; a question it asked you, and your choice, read in the thread too.
const KIND_LABEL = { prompt: 'prompt', spawn: 'delegated', result: 'reported back', message: 'message', chat: 'chat', answer: 'replied', question: 'asked you' };
const MARKDOWN_KINDS = new Set(['result', 'spawn', 'answer']);

/**
 * A message's words: Markdown for a report, a brief or an answer, else as
 * written. One the state cut short gets "Show more", which fetches the rest
 * once and leaves the thread, the focus and the draft where they are.
 */
function MessageText(m) {
  const md = MARKDOWN_KINDS.has(m.kind);
  const key = `msg|${m.id}`;
  const open = !!m.isCut && isOpen(key, false);
  const full = open ? fullTextOf(m.id) : null;
  const text = full && full.status === 'ok' ? full.text : m.text;
  if (!m.isCut) return md ? Markdown(text) : text;
  const body = md ? Markdown(text) : h('div', { class: 'msg-plain' }, text);
  const flip = () => { ui.holdThread = true; toggle(key); };
  return [
    body,
    open && full.status === 'error' && h('p', { key: 'err', class: 'msg-err' }, icon('alert'), h('span', null, full.error),
      h('button', { class: 'btn btn-xs', type: 'button', onClick: () => { fullTexts.delete(m.id); ui.holdThread = true; renderNow(); } }, 'Retry')),
    h('button', { key: 'more', class: 'more more-start msg-more', type: 'button', 'aria-expanded': open && full.status === 'ok' ? 'true' : 'false', disabled: open && full.status === 'loading', onClick: flip },
      open ? (full.status === 'loading' ? 'Loading the rest…' : full.status === 'ok' ? 'Show less' : 'Show more') : 'Show more',
      icon('chevronDown', open && full.status === 'ok' ? 'flip' : '')),
  ];
}

/** A message in an agent's thread; `sent` is the send it came from here (its status shows under it). */
function Message(m, a, sent) {
  const mine = m.from === 'you';
  const dir = m.from === a.id ? (m.to === 'you' ? 'to you' : `to ${nameOf(m.to)}`) : null;
  // a message sent from here keeps the key of its "Sending…" bubble, so it never blinks when the mod records it
  const key = sent ? `out:${sent.id}` : m.id;
  if (mine) {
    const choice = m.kind === 'choice';
    const note = sendNoteOf(m, a, sent);
    return h('div', { key, class: `msg mine${choice ? ' kind-choice' : ''}`, enter: true },
      h('div', { class: 'msg-meta' },
        h('span', { class: 'msg-who' }, 'You'),
        m.to !== a.id ? h('span', { class: 'msg-kind' }, `to ${nameOf(m.to)}`) : m.kind === 'prompt' ? h('span', { class: 'msg-kind' }, 'prompt') : null,
        h('span', { class: 'msg-time' }, ago(m.at)),
        YouAvatar(20)),
      choice
        ? h('div', { class: 'bubble bubble-choice' }, icon('circleCheck'), h('span', null, m.text))
        // what you sent from here is whole on the page already, even where the state cut it
        : h('div', { class: 'bubble' }, sent ? sent.text : m.isCut ? MessageText(m) : m.text),
      note ? StatusNote(note, 'msg-status') : null);
  }
  const sender = IX.byId.get(m.from);
  // a question still held on you is answered on its card, pinned above the tabs: the thread points there
  const held = m.kind === 'question' && m.callId ? IX.pendingById.get(m.callId) : null;
  const label = held ? 'asks you' : KIND_LABEL[m.kind] || m.kind;
  return h('div', { key, class: `msg theirs kind-${m.kind}${held ? ' is-held' : ''}`, enter: true },
    h('div', { class: 'msg-meta' },
      whoAvatar(m.from, 20),
      h('span', { class: 'msg-who' }, sender ? sender.label : nameOf(m.from)),
      h('span', { class: 'msg-kind' }, dir && m.kind !== 'answer' && m.kind !== 'question' ? `${label} ${dir}` : label),
      h('span', { class: 'msg-time' }, ago(m.at))),
    m.kind === 'question'
      ? h('div', { class: 'msg-card msg-question' },
        icon('help', 'msg-q-ic'),
        h('div', { class: 'msg-q-body' },
          h('div', { class: 'msg-q-text' }, MessageText(m)),
          held && (held.isAnswerable
            ? h('button', { class: 'more more-start msg-q-go', type: 'button', onClick: () => scrollSoon(`pending-${held.id}`) }, 'Answer it above', icon('arrowUp'))
            : h('p', { class: 'msg-q-where' }, 'Answer it in Claude Code.'))))
      : MARKDOWN_KINDS.has(m.kind) ? h('div', { class: 'msg-card' }, MessageText(m)) : h('div', { class: 'msg-text' }, MessageText(m)));
}

/** A send from here not in the thread yet (or refused): built as the message it becomes, so it turns into it in place. */
function OutboxMessage(sent, a) {
  return Message({ id: sent.id, at: sent.at, from: 'you', to: a.id, kind: 'chat', text: sent.text }, a, sent);
}

/** "Hello…" as the state cut it, against what was sent: the same words, or the start of them. */
function sameText(shown, sent) {
  const a = String(shown || '').trim(), b = String(sent || '').trim();
  if (a === b) return true;
  const cut = a.replace(/…$/, '').trimEnd();
  return a.endsWith('…') && cut.length >= 12 && b.startsWith(cut);
}

/**
 * An agent's thread: its messages, each send from here paired with the
 * message it became (the mod records it with the command's id as `ackId`;
 * the same words sent then, for a mod that does not), and the sends not in
 * it yet.
 */
function threadOf(a) {
  const msgs = IX.talk.get(a.id) || [];
  const box = ui.outbox.get(a.id) || [];
  const sentBy = new Map(), loose = [];
  for (const sent of box) {
    const m = msgs.find(x => x.ackId === sent.id) ||
      msgs.find(x => !x.ackId && !sentBy.has(x.id) && x.from === 'you' && x.to === a.id && x.kind !== 'choice' && x.at >= sent.at - 60000 && sameText(x.text, sent.text));
    if (m && !sentBy.has(m.id)) sentBy.set(m.id, sent);
    else loose.push(sent);
  }
  return { msgs, sentBy, loose };
}

/**
 * The status line under a message of yours, or null: what its ack says
 * while it matters (a failure, a send still waiting, or until the agent
 * answers after it: then a "Queued" is old news). `sent` is its send from
 * this page; a message sent before the page loaded has its ack by `ackId`.
 */
function sendNoteOf(m, a, sent) {
  if (m.kind === 'choice') return null;
  const send = sent || (m.ackId && IX.acks.has(m.ackId) ? { id: m.ackId, at: m.at, state: 'sent' } : null);
  if (!send) return null;
  const st = sendState(send, 'chat');
  if (st.tone === 'fail' || st.busy) return st;
  const replied = (IX.talk.get(a.id) || []).some(x => x.from === a.id && x.to === 'you' && x.at > m.at);
  return replied ? null : st;
}

async function sendChat(a) {
  const el = ui.inputs.get(a.id);
  const text = (ui.drafts.get(a.id) || '').trim();
  if (!text || (ui.sends.get(a.id) || {}).status === 'sending') return;
  const id = newCmdId('c');
  const at = Date.now();
  ui.sends.set(a.id, { status: 'sending', at });
  renderNow();
  try {
    await command({ cmd: 'chat', id, agentId: a.id, text: text.slice(0, 4000) });
    // Clear the box only if it still holds what was sent (typing during the send is kept).
    if ((ui.drafts.get(a.id) || '').trim() === text) {
      ui.drafts.delete(a.id);
      if (el) { el.value = ''; autosize(el); }
    }
    // it shows in the thread now, "Sending…" until the mod's ack says what became of it
    const box = ui.outbox.get(a.id) || ui.outbox.set(a.id, []).get(a.id);
    box.push({ id, text: text.slice(0, 4000), at, state: 'sent' });
    if (box.length > 40) box.shift();
    ui.sends.delete(a.id);
    ui.pinThread = true;
    setTimeout(invalidate, ACK_WAIT + 50);
  } catch (e) {
    ui.sends.set(a.id, { status: 'error', text: e.message, at: Date.now() });
  }
  renderNow();
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

function Composer(a) {
  const st = ui.sends.get(a.id);
  // how a message reaches it: the Orchestrator takes it as a prompt of its own once its turn ends; an agent reads it at its next step
  const hint = a.kind === 'orchestrator'
    ? isLive(a.status) ? 'Claude reads it when it finishes its current turn.' : 'Goes to Claude Code as your next prompt.'
    : isLive(a.status) ? 'It reads it at its next step; nothing is interrupted.' : 'Resumes the agent to answer.';
  return h('div', { class: 'composer' },
    h('textarea', {
      key: `ta:${a.id}`, class: 'composer-input', rows: '2', maxlength: '4000', placeholder: `Message ${a.label}…`, 'aria-label': `Message ${a.label}`,
      ref: el => { ui.inputs.set(a.id, el); el.value = ui.drafts.get(a.id) || ''; requestAnimationFrame(() => autosize(el)); },
      onInput: e => { ui.drafts.set(a.id, e.target.value); autosize(e.target); },
      onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(a); } },
    }),
    h('div', { class: 'composer-foot' },
      h('span', { class: 'composer-hint' }, hint, h('span', { class: 'kbd-hint' }, ' Enter sends, Shift+Enter adds a line.')),
      // a send that reached the deck shows in the thread with its status; one that did not says why here, its words kept in the box
      h('span', { class: 'composer-status', role: 'status', 'aria-live': 'polite' },
        st && st.status === 'error' ? h('span', { class: 'note note-err' }, st.text) : null),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: st && st.status === 'sending', onClick: () => sendChat(a) }, icon('send'), st && st.status === 'sending' ? 'Sending' : 'Send')));
}

function TalkTab(a) {
  const { msgs, sentBy, loose } = threadOf(a);
  return h('div', { class: 'talk card' },
    msgs.length || loose.length
      ? h('div', { key: 'thread', class: 'thread', ref: el => requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; }) },
        msgs.map(m => Message(m, a, sentBy.get(m.id))),
        loose.map(sent => OutboxMessage(sent, a)))
      : h('div', { key: 'empty', class: 'thread thread-empty' }, h('p', { class: 'muted' }, `No messages with ${a.label} yet.`)),
    Composer(a));
}

function AgentPage() {
  const a = IX.byId.get(route.id);
  if (!a) {
    return h('div', { key: route.key, class: 'page page-agent narrow' },
      h('div', { class: 'card' }, Empty('bot', 'This agent is not in the session', 'It may belong to an earlier session, or the link is old.', h('a', { class: 'btn btn-sm', href: '#/org' }, 'Open the org chart'))));
  }
  const tab = tabOf(a);
  const pending = IX.pendingBy.get(a.id) || [];
  return h('div', { key: route.key, class: 'page page-agent narrow' },
    AgentHeader(a),
    // what waits on you shows in full above the tabs; up here, only a wait the mod knows no more of (an idle prompt)
    a.needsYou && !pending.length && h('div', { class: 'banner banner-wait', role: 'status' },
      icon('hand', 'banner-ic'),
      h('div', { class: 'banner-body' },
        h('p', { class: 'banner-title' }, Ticks(waitWords(a))),
        h('p', { class: 'banner-text' }, 'Answer it in the Claude Code conversation; the agent carries on once you do.'))),
    pending.length > 0 && h('a', { class: 'needs-jump', href: `#pending-${pending[0].id}`, onClick: e => { e.preventDefault(); scrollSoon(`pending-${pending[0].id}`); } },
      icon(pending[0].kind === 'question' ? 'help' : 'shield'),
      h('span', { class: 'needs-jump-text' }, Ticks(pendingText(pending[0]))),
      h('span', { class: 'needs-jump-go' }, pending[0].kind === 'question' && pending[0].isAnswerable ? 'Answer' : 'See it', icon('chevronDown'))),
    NowStrip(a),
    AgentStats(a),
    // an agent with no checklist (most never write one) gives its task the whole row, rather than an empty card
    h('div', { class: a.checklist.items.length ? 'agent-cols' : 'agent-cols single' }, TaskCard(a), a.checklist.items.length ? ChecklistCard(a) : null),
    ResultCard(a),
    AgentNeeds(a, 'agent'),
    h('div', { class: 'tabs-wrap', id: 'agent-tabs' },
      Tabs(a, tab),
      h('div', { key: tab, class: 'tabpanel', role: 'tabpanel', id: 'tabpanel', 'aria-labelledby': `tab-${tab}` },
        tab === 'diffs' ? DiffsTab(a) : tab === 'activity' ? ActivityTab(a) : TalkTab(a))));
}

// ----------------------------------------------------------------------- plan

const SOURCE = { board: 'from the task board', todo: 'from the todo list', plan: 'from the plan', workflow: 'from the workflow', implicit: 'inferred from the agents', none: '' };
const STEP_LABEL = { done: 'Done', active: 'In progress', pending: 'Pending', failed: 'Failed' };

/** The goal's words under its headline on the Plan page: its own lines, a long prompt folded to five of them until asked. */
function GoalText(g) {
  const rest = goalRest(g);
  if (!rest) return null;
  const long = rest.length > 420 || rest.split('\n').length > 5;
  const key = 'plan-goal', open = isOpen(key, false);
  return [
    h('p', { key: 'goal-text', class: `plan-text${long && !open ? ' clamped' : ''}` }, rest),
    long && h('button', { key: 'goal-more', class: 'more more-start', type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) }, open ? 'Show less' : 'Show the whole goal', icon('chevronDown', open ? 'flip' : '')),
  ];
}

function PlanPage() {
  const steps = S.plan.steps, g = S.goal;
  const n = st => steps.filter(s => s.status === st).length;
  const done = n('done'), active = n('active'), failed = n('failed');
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  return h('div', { key: 'plan', class: 'page page-plan narrow' },
    g && h('div', { class: 'plan-goal' },
      h('p', { class: 'eyebrow' }, 'Goal'),
      h('h2', { class: 'plan-title' }, g.headline || firstLine(g.text)),
      GoalText(g),
      g.followUps && g.followUps.length > 0 && h('ul', { class: 'follows' }, g.followUps.map((f, i) => h('li', { key: `${i}:${f.at}` }, icon('cornerDownRight'), h('span', null, f.text), h('span', { class: 'mono muted' }, ago(f.at)))))),
    !steps.length
      ? h('div', { class: 'card' }, Empty('listChecks', 'No plan yet', 'When the Orchestrator writes a todo list or a plan, its steps show here with who works on each.'))
      : [
        h('div', { key: 'prog', class: 'card progress' },
          h('div', { class: 'progress-top' },
            h('p', { class: 'progress-nums' },
              h('strong', null, `${done}/${steps.length} done`),
              h('span', null, `${active} in progress`),
              h('span', { class: failed ? 'err' : '' }, `${failed} failed`)),
            S.plan.source && SOURCE[S.plan.source] && h('span', { class: 'tag' }, SOURCE[S.plan.source])),
          h('div', { class: 'bar big', role: 'img', 'aria-label': `${pct}% done` },
            h('span', { class: `bar-fill${done === steps.length ? ' full' : ''}`, style: { width: `${pct}%` } }),
            h('span', { class: 'bar-active', style: { left: `${pct}%`, width: `${steps.length ? Math.round((active / steps.length) * 100) : 0}%` } }))),
        h('div', { key: 'steps', class: 'card list steps' }, steps.map(StepRow)),
      ]);
}

/** A step's key: the plan's own, or its place when it has none. */
const stepKeyOf = (st, i) => String(st.key || i + 1);

/** The agents on a step, each followed by the ones it started (deepest last), each once; the Orchestrator's own helpers are other steps'. */
function stepAgents(st) {
  const rows = [], seen = new Set();
  const walk = (a, d) => {
    if (!a || seen.has(a.id)) return;
    seen.add(a.id);
    rows.push({ a, d });
    if (a.kind !== 'orchestrator') for (const k of IX.kids.get(a.id) || []) walk(k, d + 1);
  };
  for (const id of st.agents) walk(IX.byId.get(id), 0);
  return rows;
}

/** A step's row, a button that opens it (#/plan/<key> opens it too): who is on it, what they do, and anything of theirs that waits on you. */
function StepRow(st, i) {
  const key = stepKeyOf(st, i);
  const open = isOpen(`step|${key}`, false);
  const rows = stepAgents(st);
  const waits = rows.some(r => (IX.pendingBy.get(r.a.id) || []).length) || (!rows.length && (IX.pendingBy.get('main') || []).length > 0 && st.status === 'active');
  return h('div', { key, id: `step-${key}`, class: `step-item${open ? ' open' : ''}` },
    h('button', { class: `step is-${st.status}`, type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(`step|${key}`) },
      icon('chevronRight', 'chev'),
      Glyph(st.status, 18),
      h('span', { class: 'step-n' }, String(i + 1).padStart(2, '0')),
      h('span', { class: 'step-text' }, st.text),
      h('span', { class: 'step-who' },
        waits && h('span', { class: 'tag tag-wait step-wait' }, 'needs you'),
        st.agents.length ? AvatarStack(st.agents, 22, 4) : h('span', { class: 'muted' }, '—')),
      h('span', { class: `step-st st-${st.status}` }, STEP_LABEL[st.status] || st.status)),
    open && h('div', { class: 'step-body' },
      rows.length ? rows.map(r => StepAgent(r.a, r.d))
        : st.agents.length ? h('p', { class: 'sa-none' }, 'The agents on this step are no longer in the session.')
          : SelfStep(st)));
}

function MiniAct(x) {
  return h('div', { key: actKey(x), class: `act-line mini${x.ok === false ? ' is-fail' : ''}` },
    ToolTag(x.tool),
    h('span', { class: PATHY.has(x.tool) ? 'act-line-target mono' : 'act-line-target', title: x.target }, x.target || ''),
    Outcome(x),
    h('span', { class: 'act-time' }, ago(x.at)));
}

/** "Open agent →" and "Talk →": its page, and its page at Talk. */
function AgentLinks(a) {
  return h('p', { class: 'sa-links' },
    h('a', { class: 'sec-link', href: agentHref(a.id) }, 'Open agent', icon('arrowRight')),
    h('a', { class: 'sec-link', href: agentHref(a.id), onClick: () => { ui.tabs.set(a.id, 'talk'); scrollSoon('agent-tabs', `agent:${a.id}`); } }, 'Talk', icon('arrowRight')));
}

/** One agent on an open step: who, its line and checklist, its last three tool calls, its files, its report folded, what waits on you. */
function StepAgent(a, d) {
  const cl = a.checklist;
  const acts = (IX.actBy.get(a.id) || []).slice(-3).reverse();
  const files = a.files.slice(0, 5);
  const resKey = `sres|${a.id}`, resOpen = isOpen(resKey, false);
  const long = a.result.length > 280 || a.result.split('\n').length > 4;
  return h('div', { key: a.id, class: `sa is-${a.status}${d ? ' sub' : ''}`, style: { '--d': String(Math.min(d, 3)) } },
    h('div', { class: 'sa-head' },
      AvatarDot(a, 24),
      h('a', { class: 'sa-name', href: agentHref(a.id) }, a.label),
      h('span', { class: 'sa-type' }, d ? `${a.type} · started by ${nameOf(a.parent)}` : a.type),
      Pill(a.status, 'pill-fixed')),
    h('div', { class: 'sa-now' },
      isRunning(a.status) && a.lastAction && a.lastAction.isLive ? Dot('run', true) : null,
      h('span', { class: 'sa-now-text', title: plainTicks(a.now) }, a.now ? Ticks(a.now) : statusOf(a.status).label),
      cl.total > 0 && h('span', { class: 'sa-check', title: `Checklist: ${cl.done} of ${cl.total} done` },
        h('span', { class: 'bar sa-bar' }, h('span', { class: `bar-fill${cl.done === cl.total ? ' full' : ''}`, style: { width: `${Math.round((cl.done / cl.total) * 100)}%` } })),
        h('span', { class: 'sa-check-n' }, `${cl.done}/${cl.total}`))),
    acts.length > 0 && h('div', { class: 'sa-acts' }, acts.map(MiniAct)),
    files.length > 0 && h('p', { class: 'sa-files' },
      icon('file', 'fic'),
      files.map(f => h('span', { key: f, class: 'sa-file', title: f }, splitPath(f)[1] || f)),
      a.files.length > files.length && h('span', { class: 'sa-more' }, `+${a.files.length - files.length} more`)),
    a.result && h('div', { class: `sa-result${a.status === 'failed' ? ' is-failed' : ''}` },
      h('p', { class: 'sa-label' }, a.status === 'failed' ? 'Result · failed' : 'Result'),
      h('div', { class: long && !resOpen ? 'sa-md clamped' : 'sa-md' }, Markdown(a.result)),
      long && h('button', { class: 'more more-start', type: 'button', 'aria-expanded': resOpen ? 'true' : 'false', onClick: () => toggle(resKey) }, resOpen ? 'Show less' : 'Show the whole result', icon('chevronDown', resOpen ? 'flip' : ''))),
    AgentNeeds(a, 'plan'),
    AgentLinks(a));
}

/** A step the Orchestrator does itself: its checklist item for it, and while it is on it, what it just did. */
function SelfStep(st) {
  const main = IX.byId.get('main') || S.agents.find(a => a.kind === 'orchestrator');
  if (!main) return h('p', { class: 'sa-none' }, 'No agent is on this step.');
  const norm = t => String(t || '').trim().toLowerCase();
  const item = main.checklist.items.find(it => norm(it.text) === norm(st.text));
  const acts = st.status === 'active' ? (IX.actBy.get(main.id) || []).slice(-3).reverse() : [];
  const glyph = item ? (item.status === 'active' && !isRunning(main.status) ? (main.status === 'waiting' ? 'waiting' : 'active') : item.status) : st.status;
  return h('div', { key: 'self', class: `sa is-${main.status}` },
    h('div', { class: 'sa-head' },
      AvatarDot(main, 24),
      h('a', { class: 'sa-name', href: agentHref(main.id) }, main.label),
      h('span', { class: 'sa-type' }, st.status === 'pending' ? 'takes this step itself' : st.status === 'done' ? 'did this step itself' : 'does this step itself'),
      Pill(main.status, 'pill-fixed')),
    h('div', { class: 'sa-item' },
      Glyph(glyph, 16),
      h('span', { class: 'check-body' },
        h('span', { class: 'check-text' }, item ? item.text : st.text),
        item && item.status === 'active' && item.doing && h('span', { class: 'check-doing' }, item.doing))),
    acts.length > 0 ? h('div', { class: 'sa-acts' }, acts.map(MiniAct)) : st.status === 'pending' ? h('p', { class: 'sa-none' }, 'Not started yet.') : null,
    st.status === 'active' ? AgentNeeds(main, 'plan') : null,
    AgentLinks(main));
}

// -------------------------------------------------------------------- changes

const CODE = { M: ['M', 'wait', 'Modified'], A: ['A', 'done', 'Added'], N: ['N', 'done', 'New'], D: ['D', 'fail', 'Deleted'], R: ['R', 'run', 'Renamed'], C: ['C', 'run', 'Copied'], U: ['U', 'fail', 'Conflict'], '?': ['?', 'idle', 'Untracked'], '??': ['?', 'idle', 'Untracked'] };

function CodeBadge(code) {
  const [ch, hue, label] = CODE[(code || '').trim()] || CODE[(code || '').trim()[0]] || [String(code || '?').slice(0, 1), 'idle', code || 'Changed'];
  return h('span', { class: `code-badge hue-${hue}`, title: label }, ch);
}

function ChangeRow(c) {
  const key = `chg|${c.path}`;
  const edits = IX.editsByPath.get(c.path) || [];
  const open = isOpen(key, false);
  return h('div', { key: c.path, class: `chg${open ? ' open' : ''}` },
    h('button', { class: 'chg-head', type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      icon('chevronRight', 'chev'),
      CodeBadge(c.code),
      PathText(c.path, 'grow'),
      c.editors && c.editors.length ? AvatarStack(c.editors, 18) : h('span', { class: 'muted small' }, 'not by an agent'),
      DiffStat(c.added, c.removed)),
    open && h('div', { class: 'chg-body' },
      edits.length
        ? edits.map(e => h('div', { key: e.id, class: 'edit' },
          h('div', { class: 'edit-head' }, ToolTag(e.tool), AgentLink(e.agent), h('span', { class: 'edit-time' }, agoText(e.at)), DiffStat(e.added, e.removed)),
          PatchView(e.id, 'chg')))
        : h('p', { class: 'chg-none' }, 'No agent edited this file in this session; it changed outside the deck.')));
}

function CommitRow(c) {
  return h('div', { key: c.hash, class: 'commit' },
    icon('commit', 'commit-ic'),
    h('span', { class: 'commit-hash' }, c.short || String(c.hash).slice(0, 7)),
    h('span', { class: 'commit-subject', title: c.subject }, c.subject),
    c.agent ? AgentLink(c.agent) : h('span', { class: 'commit-author' }, c.author),
    h('span', { class: 'commit-files' }, plural(c.files || 0, 'file')),
    DiffStat(c.added, c.removed),
    h('span', { class: 'act-time' }, ago(c.at)));
}

function ChangesPage() {
  const ch = S.changes, repo = S.repo;
  const add = total(ch, c => c.added), rem = total(ch, c => c.removed);
  // in a repository each uncommitted file opens on its agents' edits already: the edits listed again are the rest
  // (committed since, undone, or outside the repository); outside one, every file the agents edited
  const uncommitted = new Set(ch.map(c => c.path));
  const editedPaths = [...IX.editsByPath.keys()].filter(p => !repo || !uncommitted.has(p));
  const live = new Set(S.files.filter(f => f.live).map(f => f.path));
  const editorsOf = new Map(S.files.map(f => [f.path, f.editors]));
  const scope = 'changes';
  return h('div', { key: 'changes', class: 'page page-changes narrow' },
    h('div', { class: 'chg-top' },
      h('div', { class: 'chg-sum' },
        h('p', { class: 'chg-count' }, repo ? plural(ch.length, 'file') : 'No repository', repo && ch.length ? [' ', h('span', { class: 'diffstat' }, h('span', { class: 'plus' }, `+${add}`), h('span', { class: 'slash' }, '/'), h('span', { class: 'minus' }, `−${rem}`))] : null),
        repo ? h('p', { class: 'chg-repo' }, icon('branch'), h('span', null, repo.branch || 'detached'),
          repo.ahead ? h('span', null, `↑${repo.ahead}`) : null, repo.behind ? h('span', null, `↓${repo.behind}`) : null,
          h('span', { class: 'sep' }, '·'), h('span', null, String(repo.head || '').slice(0, 7)), h('span', { class: 'sep' }, '·'), h('span', null, repo.name))
          : h('p', { class: 'chg-repo' }, 'The session is not in a git repository; the agents\' edits are below.')),
      ch.length > 0 && ReviewButton(scope, `Review the uncommitted changes (${plural(ch.length, 'file')}, +${add} −${rem}) and tell me what to fix before I commit.`)),
    repo && h('section', { class: 'sec' },
      SecHead('Uncommitted', ch.length),
      ch.length ? h('div', { class: 'card list chgs' }, ch.map(ChangeRow)) : h('div', { class: 'card' }, Empty('check', 'Working tree clean', 'Nothing to commit.'))),
    (!repo || editedPaths.length > 0) && h('section', { class: 'sec' },
      SecHead(repo ? 'Other agent edits' : 'Edits by file', editedPaths.length),
      editedPaths.length
        ? h('div', { class: 'fgroups' }, editedPaths.map((p, i) => FileGroup(p, IX.editsByPath.get(p), { scope: 'byfile', open: false, showAgent: true, live: live.has(p), editors: editorsOf.get(p) || [...new Set(IX.editsByPath.get(p).map(e => e.agent))] })))
        : h('div', { class: 'card' }, Empty('pencil', 'No agent edits yet', 'Each Edit and Write an agent makes shows here, grouped by file.'))),
    S.commits.length > 0 && h('section', { class: 'sec' },
      SecHead('Recent commits', S.commits.length),
      h('div', { class: 'card list commits' }, S.commits.map(CommitRow))));
}

// ===================================================================== shell

function NavItem(href, ic, label, active, trailing) {
  return h('a', { key: href, class: active ? 'nav active' : 'nav', href, 'aria-current': active ? 'page' : null, title: label },
    h('span', { class: 'nav-ic' }, icon(ic), trailing && trailing.rail ? trailing.rail : null),
    h('span', { class: 'nav-label' }, label),
    trailing ? trailing.full : null);
}

function AgentNav(a) {
  const active = route.name === 'agent' && route.id === a.id;
  const st = statusOf(a.status);
  const mark = a.status === 'running' || a.status === 'starting' ? Dot('run', true) : a.status === 'waiting' ? Dot('wait') : a.status === 'failed' ? Dot('fail') : null;
  return h('a', {
    key: a.id, class: `nav nav-agent is-${a.status}${active ? ' active' : ''}`, href: agentHref(a.id),
    'aria-current': active ? 'page' : null, title: `${a.label}: ${st.label}`, style: { '--d': String(Math.min(IX.depth.get(a.id) || 0, 4)) },
  },
  h('span', { class: 'nav-ic' }, Avatar(a, 18), h('span', { class: `rail-dot hue-${st.hue}${isRunning(a.status) ? ' pulse' : ''}` })),
  h('span', { class: 'nav-label' }, a.label),
  mark && h('span', { class: 'nav-mark' }, mark));
}

function navKeys(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll('a.nav')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  items[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1)].focus();
}

function Sidebar() {
  const running = S ? S.agents.filter(a => isRunning(a.status)).length : 0;
  const steps = S ? S.plan.steps : [];
  const changes = S ? S.changes.length : 0;
  const repo = S && S.repo;
  return h('aside', { class: 'sb', 'aria-label': 'Agent Deck' },
    h('div', { class: 'sb-head' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      h('span', { class: 'brand-name' }, 'Agent Deck')),
    h('nav', { class: 'sb-nav', 'aria-label': 'Pages', onKeyDown: navKeys },
      NavItem('#/', 'dashboard', 'Dashboard', route.name === 'dash', running ? { full: LiveCount(running), rail: h('span', { class: 'rail-dot hue-run pulse' }) } : null),
      NavItem('#/org', 'org', 'Org chart', route.name === 'org'),
      NavItem('#/plan', 'plan', 'Plan', route.name === 'plan', steps.length ? { full: h('span', { class: 'nav-count' }, `${steps.filter(s => s.status === 'done').length}/${steps.length}`) } : null),
      NavItem('#/changes', 'changes', 'Changes', route.name === 'changes', changes ? { full: h('span', { class: 'nav-count' }, String(changes)) } : null),
      S && S.agents.length > 0 && h('div', { class: 'sb-section' }, h('span', { class: 'sb-label' }, 'Agents'), h('span', { class: 'sb-rule', 'aria-hidden': 'true' })),
      S ? IX.tree.map(AgentNav) : null),
    h('div', { class: 'sb-foot' },
      repo
        ? h('div', { class: 'sb-repo', title: repo.root },
          h('span', { class: 'sb-repo-ic' }, icon('branch')),
          h('span', { class: 'sb-repo-text' },
            h('span', { class: 'sb-repo-name' }, repo.name),
            h('span', { class: 'sb-repo-branch' }, `${repo.branch || 'detached'}${repo.ahead ? ` ↑${repo.ahead}` : ''}${repo.behind ? ` ↓${repo.behind}` : ''}`)))
        : S && S.session.cwd
          ? h('div', { class: 'sb-repo', title: S.session.cwd },
            h('span', { class: 'sb-repo-ic' }, icon('folder')),
            h('span', { class: 'sb-repo-text' },
              h('span', { class: 'sb-repo-name' }, splitPath(String(S.session.cwd).replace(/[\\/]+$/, ''))[1] || S.session.cwd),
              h('span', { class: 'sb-repo-branch' }, S.session.model || '')))
          : null));
}

function ConnPill() {
  const st = conn.status;
  if (st === 'live') return h('span', { class: 'conn conn-live', title: 'Updating live' }, Dot('run', true), 'Live');
  if (st === 'reconnecting') return h('span', { class: 'conn conn-wait' }, Dot('wait'), 'Reconnecting');
  if (st === 'ended') return h('span', { class: 'conn conn-idle' }, Dot('idle'), 'Session ended');
  if (st === 'denied') return h('span', { class: 'conn conn-fail' }, Dot('fail'), 'No access');
  return h('span', { class: 'conn conn-idle' }, Dot('idle'), 'Connecting');
}

function Topbar() {
  let title;
  if (route.name === 'agent') {
    const a = S && IX.byId.get(route.id);
    title = [h('a', { class: 'crumb', href: '#/org' }, 'Agents'), icon('chevronRight', 'crumb-sep'), h('span', { class: 'crumb-here' }, a ? a.label : route.id)];
  } else {
    title = { dash: 'Dashboard', org: 'Org chart', plan: 'Plan', changes: 'Changes' }[route.name];
  }
  return h('header', { class: 'topbar' },
    h('h1', { class: 'topbar-title' }, title),
    h('div', { class: 'topbar-right' },
      S && S.session && S.session.model && h('span', { class: 'topbar-model', title: 'The session\'s model' }, S.session.model),
      ConnPill()));
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
    h('div', { class: 'sk sk-banner' }),
    h('div', { class: 'run-grid' }, [0, 1, 2, 3].map(i => h('div', { key: i, class: 'sk sk-card' }))),
    h('div', { class: 'kpis' }, [0, 1, 2, 3].map(i => h('div', { key: i, class: 'sk sk-kpi' }))),
    h('div', { class: 'sk sk-list' }));
}

function Unreachable() {
  const denied = conn.status === 'denied';
  return h('div', { key: 'unreachable', class: 'page narrow' },
    h('div', { class: 'card' }, Empty(denied ? 'octagon' : 'wifiOff',
      denied ? 'This link no longer works' : 'Can\'t reach the deck',
      denied ? 'The deck needs the link it opened with. Run /deck web in Claude Code to open it again.' : 'The deck server is not answering. If the Claude Code session ended, run /deck web in a new one.',
      denied ? null : h('button', { class: 'btn btn-sm', type: 'button', onClick: retryNow }, icon('refresh'), 'Try again'))));
}

function Page() {
  if (!S) return conn.status === 'denied' || conn.fails >= 2 ? Unreachable() : Loading();
  switch (route.name) {
    case 'org': return OrgPage();
    case 'plan': return PlanPage();
    case 'changes': return ChangesPage();
    case 'agent': return AgentPage();
    default: return Dashboard();
  }
}

function App() {
  return h('div', { id: 'app', class: `app deck-${conn.status}${S ? '' : ' no-state'}` },
    Sidebar(),
    h('div', { class: 'main' },
      Topbar(),
      ConnBanner(),
      h('div', { class: 'scroll', ref: el => { scroller = el; } }, Page())));
}

// ==================================================================== render

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
  // Keep a chat thread pinned to its newest message when the reader is already there (a send takes it there;
  // "Show more" leaves it where it is, so the reader goes on from the cut).
  const thread = document.querySelector('.thread');
  const pinned = ui.pinThread || (!ui.holdThread && thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24);
  ui.pinThread = false;
  ui.holdThread = false;
  const v = App();
  if (!vroot) document.getElementById('app').replaceWith(create(v, false));
  else patch(vroot, v, false);
  vroot = v;
  if (pinned) { const t = document.querySelector('.thread'); if (t) t.scrollTop = t.scrollHeight; }
  afterRender();
  stats.renders++;
  stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
  stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
}

function afterRender() {
  // Scroll memory per route: restore where the reader was when they come back.
  if (route.key !== shownKey && scroller) {
    scroller.scrollTop = ui.scroll.get(route.key) || 0;
    shownKey = route.key;
  }
  if (ui.focusTab) { const t = document.getElementById(`tab-${ui.focusTab}`); if (t) t.focus(); ui.focusTab = null; }
  // Open and #/plan/<key> bring their card or step into view, once it has rendered.
  if (ui.scrollTo) {
    const want = ui.scrollTo;
    const el = scroller && want.on === route.key ? document.getElementById(want.id) : null;
    if (el) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
      scroller.scrollTop = Math.max(0, top);
      ui.scrollTo = null;
    } else if (Date.now() > want.until) ui.scrollTo = null;
  }
  // The org chart fits itself until the reader pans or zooms it.
  if (route.name === 'org' && ui.orgView !== 'list' && org.view && org.view.isConnected && lastLayout) {
    const size = `${org.view.clientWidth}x${org.view.clientHeight}`;
    if (!org.touched && (org.sig !== lastLayout.sig || org.size !== size)) fitOrg(lastLayout);
    org.sig = lastLayout.sig; org.size = size;
  }
  const s = S && S.summary;
  document.title = S ? `${s.waiting || S.pending.length ? '● ' : ''}Agent Deck · ${S.repo ? S.repo.name : 'session'}` : 'Agent Deck';
}

function boot() {
  window.addEventListener('hashchange', () => {
    if (scroller) ui.scroll.set(shownKey, scroller.scrollTop);
    route = parseRoute();
    followRoute();
    renderNow();
  });
  window.addEventListener('resize', () => invalidate());
  // Coarse times ("2m") move on their own; the retry countdown ticks every second while it shows.
  setInterval(invalidate, 15000);
  setInterval(() => { if (conn.status === 'reconnecting') invalidate(); }, 1000);

  installDefs();
  followRoute();
  renderNow();
  connect();
}

// web/test/page.test.js reads this file without a browser and drives its views itself: it boots nothing then.
if (!globalThis.__deckTest) boot();
