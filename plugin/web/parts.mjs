/* Apiarius's web page: what every tab shows or uses. The agents' avatars,
 * the components (Markdown and diffs among them), what needs you, the
 * header, and the agent drawer (app.js says what the other modules hold).
 */
import * as AV from './avatars.mjs';
import {
  firstLine, h, IC, icon, isLive, isRunning, msText, NOPROPS, num, oneLine, PATHY, plural, shortPath, splitPath,
  stateOf, statusOf, store, TOOL_ICON, total
} from './basics.mjs';
import {
  ACK_WAIT, agentFileOf, agentFiles, ageOf, agoText, closeDrawer, command, conn, deafWhy, diffOf, diffs, fullTextOf,
  group, hrefOf, isOpen, isWide, IX, KEEP, logOf, navigate, newCmdId, openAgent, PeerStopTurn, PendingHead,
  revealInDrawer, route, S, sendState, sessionRow, SessionsLink, setShut, shut, StatusNote, TABS, toast, toggle, ui,
  viewportW, whereNote, WhereTag, WIDE
} from './state.mjs';
import { PressNote, StopAgent, StopTurn } from './now.mjs';
import { Composer, composerId } from './chat.mjs';
import { doneOf, elapsedOf, Item, KIND_WORD } from './org.mjs';
import { invalidate, renderNow } from './app.js';

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
export function urlOf(svg) {
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
export function Avatar(a, size = 24, opts = NOPROPS) {
  if (!a) return h('span', { class: 'av-ghost', style: px(size) });
  const svg = AV.avatarSvg(opts.style || styleNow(), faceOf(a), { size, dot: opts.dot === true, animated: opts.live === true && !isStill() });
  return h('img', { class: 'av', width: size, height: size, alt: '', draggable: 'false', src: urlOf(svg) });
}

/** The style the avatars are drawn in: one picked here until the state names it (10 s at most), else the state's (the person's setting). */
export function styleNow() {
  const picked = ui.picked;
  if (picked && S && S.avatarStyle !== picked.style && Date.now() < picked.until) return picked.style;
  return S ? S.avatarStyle : AV.DEFAULT_STYLE;
}

/** Draws the agents in another style: the mod keeps it as the person's own (the Desktop pane and every session follow), and its next state says so; drawn here at once. */
export async function pickStyle(style) {
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
export const whoAvatar = (id, size) => (id === 'you' ? YouAvatar(size) : id === 'engine' ? EngineAvatar(size) : Avatar(IX && IX.byId.get(id), size));

/** An avatar with its status dot, moving as its status does. */
export function AvatarDot(a, size = 24) {
  return h('span', { class: 'avd', style: px(size) }, Avatar(a, size, { dot: true, live: true }));
}

export function AvatarStack(ids, size = 18, max = 4) {
  const shown = ids.slice(0, max);
  return h('span', { class: 'stack', title: ids.map(nameOf).join(', ') },
    shown.map(id => h('span', { key: id, class: 'stack-item' }, whoAvatar(id, size))),
    ids.length > max && h('span', { class: 'stack-more' }, `+${ids.length - max}`));
}

/** What a row of the state calls `id`: you, Claude Code, an agent's title, or the name a message used for one no agent carries. */
export const nameOf = id => (id === 'you' ? 'You' : id === 'engine' ? 'Claude Code' : IX && IX.byId.has(id) ? IX.byId.get(id).title : String(id || ''));

// ================================================================ components

export const stop = e => { if (e && e.stopPropagation) e.stopPropagation(); };

export function Dot(hue, pulse) {
  return h('span', { class: `dot hue-${hue}${pulse ? ' pulse' : ''}`, 'aria-hidden': 'true' });
}

/** The status glyph family: done, active (spinning), pending, failed, waiting, idle. */
const GLYPH = {
  done: ['circleCheck', 'done'], active: ['progress', 'run'], running: ['progress', 'run'], starting: ['progress', 'run'],
  pending: ['circle', 'idle'], failed: ['circleX', 'fail'], waiting: ['circlePause', 'wait'], idle: ['circleDashed', 'idle'], stopped: ['circleX', 'idle'],
};
export function Glyph(st, size = 16) {
  const [ic, hue] = GLYPH[st] || GLYPH.pending;
  return h('svg', { class: `glyph hue-${hue}${ic === 'progress' ? ' spin' : ''}`, width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', html: IC[ic] });
}

/**
 * A section: its head, whose title (and count) folds it, with `right` beside
 * it; then its body while it is open. `body` is a function, so a folded
 * section builds (and fetches) nothing.
 */
export function Section(id, title, count, right, body) {
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

export function DiffStat(add, rem) {
  return h('span', { class: 'diffstat' },
    h('span', { class: 'plus' }, `+${add || 0}`),
    h('span', { class: 'minus' }, `−${rem || 0}`));
}

/** A path, its folder muted; `full` is the whole path one shortened (`shortPath`) stands for, shown on hover. */
export function PathText(p, cls, full) {
  const [dir, base] = splitPath(p);
  return h('span', { class: `path${cls ? ` ${cls}` : ''}`, title: full || p },
    dir && h('span', { class: 'path-dir' }, dir),
    h('span', { class: 'path-base' }, base));
}

function ToolTag(tool) {
  return h('span', { class: 'tooltag' }, icon(TOOL_ICON[tool] || 'wrench'), tool);
}

export function Empty(ic, title, text, action) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty-ic' }, icon(ic)),
    h('p', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    action || null);
}

/** A name that opens its agent's drawer; you, Claude Code and a name no agent carries read as text. */
export function NameLink(id, size = 16) {
  const a = IX.byId.get(id);
  if (!a) return h('span', { class: 'who' }, size ? whoAvatar(id, size) : null, h('span', { class: 'who-name' }, nameOf(id)));
  return h('button', { type: 'button', class: 'who who-link', title: a.title, onClick: e => { stop(e); openAgent(id); } }, size ? Avatar(a, size) : null, h('span', { class: 'who-name' }, a.title));
}

// ----------------------------------------------------------------- markdown
// Paragraphs, headings, lists, code spans, bold, fenced blocks. Built as
// vnodes, never innerHTML, so agent text cannot inject markup.

export function inline(text) {
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

/** Inline words (`inline`) with their links as plain words: for words inside a link of their own. */
export const unlinked = parts => parts.map(x => (x && typeof x === 'object' && x.t === 'a' ? x.c : x));

export function Markdown(text) {
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
export function Folded(key, long, body, more = 'Show more') {
  const open = long && isOpen(key, false);
  return [
    h('div', { key: `${key}:body`, class: long && !open ? 'folded' : 'unfolded' }, body),
    long && h('button', { key: `${key}:more`, class: 'more more-start', type: 'button', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) },
      open ? 'Show less' : more, icon('chevronDown', open ? 'flip' : '')),
  ];
}

// --------------------------------------------------------------------- diffs

/** A patch (`kind` 'patch', an agent's edit) or git's own diff of a file ('gitdiff'), its lines numbered and tinted. */
export function PatchView(id, scope, kind = 'patch') {
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
export function EditBlock(e, scope, showAgent = true) {
  return h('div', { key: e.id, class: 'edit' },
    h('div', { class: 'edit-head' },
      ToolTag(e.tool),
      showAgent && NameLink(e.agent),
      h('span', { class: 'edit-time' }, agoText(e.at)),
      DiffStat(e.added, e.removed)),
    PatchView(e.id, scope));
}

/** One file's edits, collapsible, each with its patch; on its agent's drawer (`opts.own`), newest first, each as OwnEdit draws it. */
export function FileGroup(path, edits, opts) {
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
    open && h('div', { class: 'fgroup-body' }, opts.own
      ? [...edits].reverse().map((e, i) => OwnEdit(e, opts.own, i === 0, edits.length > 1))
      : edits.map(e => EditBlock(e, opts.scope, opts.showAgent))));
}

/**
 * The files outside the repository (an agent's scratch and temp files), after
 * the repository's own: one dim row, "n files outside the repo", that opens
 * on them (`rows()`). `where` keeps its open state apart per list.
 */
export function OutsideRows(n, where, rows) {
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
export function noteResolved() {
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
export function resolvedCalls(agentId) {
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
  // one held for your Send above the prompt stays as sent until it went, or did not
  const locked = readOnly || !!(st && (st.busy || st.done || st.held));
  const answers = {};
  qs.forEach((q, qi) => { const v = answerOf(q, qi, c); if (v) answers[q.question] = v.slice(0, 2000); });
  const ready = Object.keys(answers).length === qs.length;
  const submit = () => { if (ready && !locked) sendAnswers(n, answers); };
  const mode = { readOnly, instant, locked, submit };
  return h('div', { class: 'qform' },
    h('div', { class: `qform-qs${qs.length > 1 ? ' several' : ''}` }, qs.map((q, qi) => QuestionBlock(n, q, qi, c, mode))),
    h('div', { class: 'qform-foot' },
      // one its deck answers, as its own window's deck says it; one no deck can answer, where; another session's whose deck takes nothing from here, why
      st ? StatusNote(st) : h('span', { class: 'need-where' }, readOnly ? deafWhy() || whereNote('Answer it', 'Answer it in Claude Code.') : 'Or answer it in Claude Code.'),
      !readOnly && !instant && h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: !ready || locked, onClick: submit }, qs.length > 1 ? 'Submit answers' : 'Submit')));
}

/** A permission prompt as Claude Code shows it: the exact command, or the path; what the call says it does. */
function PermissionBody(n) {
  return h('div', { class: 'permit' },
    n.command
      ? h('pre', { class: 'permit-cmd' }, h('code', null, n.command))
      : n.path ? h('p', { class: 'permit-path' }, icon('file', 'fic'), PathText(n.path, 'grow')) : null,
    n.text && n.text !== n.command && n.text !== n.path && n.text !== n.tool && h('p', { class: 'permit-desc' }, n.text),
    h('p', { class: 'need-where' }, whereNote('Answer it', 'Answer in Claude Code.')));
}

function NoteBody(n) {
  return h('div', { class: 'permit' },
    h('p', { class: 'note-text' }, n.text),
    h('p', { class: 'need-where' }, whereNote('Answer it', 'Answer in Claude Code.')));
}

const NEED_ICON = { question: 'help', permission: 'shield', notification: 'bell' };

/**
 * Who a need is from: its name, and, for any agent but the Orchestrator, what
 * it is ("Agent", "Teammate"), so a question from an agent that named itself
 * "Claude Code" never reads as Claude Code's own notification.
 */
export function askerOf(n) {
  const a = IX && IX.byId.get(n.agent);
  const kind = a ? a.kind : n.agent === 'main' ? 'orchestrator' : 'agent';
  return { who: n.agentName || nameOf(n.agent), mark: kind === 'orchestrator' ? '' : kind === 'teammate' ? 'Teammate' : 'Agent' };
}

/** What a folded need says on its one line: its question, its command or path, its words. */
export const needGist = n => (n.kind === 'question' ? n.questions.map(q => q.question).join(' · ') || n.text : n.kind === 'permission' ? n.command || n.path || n.text : n.text);

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
  const { who, mark } = askerOf(n);
  const name = h('span', { key: 'who', class: 'need-who' }, IX.byId.has(n.agent) ? NameLink(n.agent, 0) : who);
  const from = mark ? [h('span', { key: 'mark', class: 'need-mark' }, `${mark} `), name] : [name];
  const title = n.kind === 'question' ? [...from, ' asks'] : n.kind === 'permission' ? [...from, ' needs permission'] : h('span', { key: 'who', class: 'need-who' }, n.title || 'Claude Code');
  return h('section', {
    key: `need:${n.id}`, id: `need-${n.id}`, class: `need need-${n.kind}${open ? ' open' : ' folded-need'}`, tabindex: '-1', 'data-nav': 'need',
    'aria-label': n.kind === 'notification' ? n.title || 'Claude Code' : `${mark ? `${mark} ` : ''}${who} ${n.kind === 'question' ? 'asks' : 'needs permission'}`,
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
export function NeedsList(agentId) {
  const list = agentId ? IX.needsBy.get(agentId) || [] : S.needs;
  const done = resolvedCalls(agentId);
  if (!list.length && !done.length) return null;
  return h('div', { class: 'needs-list' }, done.map(AnsweredCard), list.map((n, i) => NeedCard(n, !!agentId || i === 0)));
}

// ===================================================================== header
// Always in view: the session's state in one word, your latest request in
// your words, and the model, context and spend; then the tabs.

export const STATE_HUE = { working: 'run', waiting: 'wait', idle: 'idle' };

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

/** The header of the session shown, here's or another's alike (its tag says which): its state, your latest request and where it runs, its line, All sessions, and Stop turn (another's: where to stop it). */
export function Header() {
  const has = S && !S.empty;
  const hd = has ? S.header : null;
  // another session's deck before its state is read: its row says what it can
  const pending = !S && route.session ? PendingHead(sessionRow(route.session)) : null;
  return h('header', { class: 'hd' },
    h('div', { class: 'hd-top' },
      h('span', { class: 'brand-mark', title: 'Apiarius', 'aria-hidden': 'true' }),
      hd ? StateWord() : pending ? pending[0] : h('span', { class: 'state is-idle' }, Dot('idle'), S ? 'Idle' : 'Connecting'),
      h('span', { class: 'hd-title' },
        hd ? GoalButton() : pending ? pending[1] : h('span', { class: 'goal goal-none' }),
        WhereTag()),
      hd && hd.line ? HeaderLine(hd, 'hd-line-top') : null,
      SessionsLink(),
      hd && hd.turn ? (deafWhy() ? PeerStopTurn() : StopTurn()) : null),
    GoalPanel(),
    h('nav', { class: 'hd-tabs', 'aria-label': 'Pages' },
      TABS.map(([id, label]) => Tab(id, label)),
      h('span', { class: 'hd-tabs-end' },
        hd && hd.line ? HeaderLine(hd, 'hd-line-tabs') : null,
        ConnPill())));
}

/** The header's line, "opus-5.5 · auto mode · context 41% · $4.12": its permission mode lit as Claude Code's footer lights it (bypass permissions in red). */
function HeaderLine(hd, cls) {
  const mode = hd.mode;
  const at = mode ? hd.line.indexOf(mode) : -1;
  return h('span', { class: `hd-line ${cls}`, title: hd.line }, at < 0 ? hd.line : [hd.line.slice(0, at), h('span', { key: 'mode', class: `hd-mode${mode === 'bypass permissions' ? ' is-fail' : ''}` }, mode), hd.line.slice(at + mode.length)]);
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

/** A drawer's block: its head (the title, a note, and `extra` such as a switch at the right; with one, the note goes on a line of its own under them, so the switch always fits), then its body. */
function Block(key, title, note, body, extra) {
  return h('section', { key, class: 'block' },
    h('div', { class: extra ? 'block-head has-extra' : 'block-head' }, h('h3', { class: 'block-title' }, title), note != null && note !== '' && h('span', { class: 'block-note' }, note), extra ? h('span', { class: 'block-extra' }, extra) : null),
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

export function Outcome(a, x) {
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

/** One tool call, as its file holds it; it opens on all of it: the command, what it says it does, its patch for an edit and the way to it in Edits. */
function ActRow(a, x, i) {
  const id = x.id || `${x.at}:${x.tool}:${i}`;
  const key = `act|${a.id}|${id}`, open = isOpen(key, false);
  const edit = x.id ? IX.editById.get(x.id) : null;
  return h('div', { key: id, id: x.id ? actAnchor(a, x.id) : null, class: `act${open ? ' open' : ''}${x.ok === false ? ' is-fail' : ''}` },
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
      edit && h('button', { type: 'button', class: 'link-btn', onClick: () => showEdit(a, edit) }, icon('arrowDown'), 'In Edits'),
      h('p', { class: 'act-meta' }, [x.id, x.ms != null ? msText(x.ms) : '', x.ok === true ? 'ok' : x.ok === false ? 'failed' : 'no result yet', x.at ? new Date(x.at).toLocaleTimeString() : ''].filter(Boolean).join(' · '))));
}

/** The word a thought of the log leads with, muted beside its cloud. */
const THOUGHT_WORD = 'thinking';
/** What Activity's head says once while it shows a thought: Claude Code's live view of the thinking, which may be a summary. */
const THOUGHT_NOTE = 'thinking as Claude Code shows it, which may be a summary';

/**
 * A step's words in the log. What it said, after a speech mark: a line of it
 * quoted in italics; words of more lines as Chat draws a message, its
 * Markdown, unquoted. Or its thinking, dimmer, after a cloud and "thinking".
 * Long ones fold.
 */
function WordRow(a, kind, w) {
  const key = `word|${a.id}|${kind}|${w.at}|${w.step}`;
  const isThought = kind === 'thought';
  const long = w.text.length > 420 || w.text.split('\n').length > 6;
  const said = String(w.text || '').trim();
  const text = isThought ? h('p', { class: 'word-text' }, h('span', { class: 'word-lead' }, THOUGHT_WORD), inline(said), w.isCut ? '…' : '')
    : said.includes('\n') ? h('div', { class: 'word-md' }, Markdown(w.isCut ? `${said}…` : said))
    : h('p', { class: 'word-text' }, '“', inline(said), w.isCut ? '…' : '', '”');
  return h('div', { key, class: `act-word is-${kind}` },
    h('span', { class: 'word-mark' }, icon(isThought ? 'thought' : 'said')),
    h('div', { class: 'word-body' },
      Folded(key, long, text)),
    h('span', { class: 'act-time', title: w.at ? new Date(w.at).toLocaleString() : '' }, ageOf(w.at)));
}

/** The ids an agent drawer's calls and edits go by on the page, so each can be brought into view from the other. */
const actAnchor = (a, id) => `act-${a.fileId}-${id}`;
const editAnchor = (a, id) => `edit-${a.fileId}-${id}`;

/** A call's "In Edits": the drawer's Edits opened on that edit (its file, its diff), brought into view. */
function showEdit(a, e) {
  ui.open.set(`agent:${a.id}|${e.path}`, true);
  ui.open.set(`edit|${a.id}|${e.id}`, true);
  revealInDrawer(editAnchor(a, e.id));
}

/** An edit's "In Activity": the call that made it opened in the drawer's Activity, brought into view. */
function showCall(a, id) {
  ui.open.set(`act|${a.id}|${id}`, true);
  revealInDrawer(actAnchor(a, id));
}

/**
 * An agent's own edits, as the pane's page has them: a file a card, the one
 * edited last first and the only one open at first; in it its edits newest
 * first, each its tool's chip, when and its lines, "In Activity" where its
 * file keeps the call that made it, the newest open on its numbered diff and
 * the rest a press away.
 */
function OwnEdits(a, edits, calls) {
  const lastOf = list => Math.max(...list.map(e => e.at || 0));
  const files = [...group(edits, e => e.path)].sort((x, y) => lastOf(y[1]) - lastOf(x[1]));
  return h('div', { class: 'fgroups' }, files.map(([p, list], i) => FileGroup(p, list, { scope: `agent:${a.id}`, open: i === 0, showAgent: false, outside: list.some(e => e.isOutside), own: { a, calls } })));
}

/**
 * One edit on its agent's drawer: its chip, when, its lines, and at the right the way to its call and, among several,
 * Show diff; its diff while open. Among several, all of its head but its links is one button that shows or hides its
 * diff, as Show diff does, the head lit under the pointer; "In Activity" keeps its own press.
 */
function OwnEdit(e, own, isNewest, isOneOfMany) {
  const key = `edit|${own.a.id}|${e.id}`;
  const open = isOpen(key, isNewest);
  const said = [ToolTag(e.tool), h('span', { class: 'edit-time' }, agoText(e.at)), DiffStat(e.added, e.removed)];
  return h('div', { key: e.id, id: editAnchor(own.a, e.id), class: `edit edit-own${open ? '' : ' shut'}` },
    h('div', { class: 'edit-head' },
      isOneOfMany
        ? h('button', { key: 'toggle', type: 'button', class: 'edit-toggle', 'aria-expanded': open ? 'true' : 'false', title: open ? 'Hide its diff' : 'Show its diff', onClick: () => toggle(key) }, said)
        : said,
      h('span', { key: 'links', class: 'edit-links' },
        own.calls.has(e.id) && h('button', { type: 'button', class: 'link-btn', onClick: () => showCall(own.a, e.id) }, icon('arrowUp'), 'In Activity'),
        isOneOfMany && h('button', { type: 'button', class: 'link-btn', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(key) }, open ? 'Hide diff' : 'Show diff'))),
    open && PatchView(e.id, `agent:${own.a.id}`));
}

/** "Calls only · With responses": what an agent's Activity lists, kept for every drawer. */
function WordsToggle() {
  const set = on => { ui.actWords = on; store.set('actView', on ? 'words' : 'calls'); renderNow(); };
  const Toggle = (on, label) => h('button', { key: label, type: 'button', class: ui.actWords === on ? 'on' : '', 'aria-pressed': ui.actWords === on ? 'true' : 'false', onClick: () => set(on) }, h('span', null, label));
  return h('div', { class: 'seg-toggle seg-sm', role: 'group', 'aria-label': 'Activity shows' }, Toggle(false, 'Calls only'), Toggle(true, 'With responses'));
}

/**
 * Its log, newest first: each tool call (it opens on all of it) and, unless
 * "Calls only" is picked, what it said between them and its thinking as
 * Claude Code showed it, as its file holds them; the head says once that
 * the thinking may be a summary.
 */
function ActivityBlock(a, f) {
  let body;
  let hasThought = false;
  const hasWords = !!f.data && f.data.words.length > 0;
  if (!f.data) {
    body = f.status === 'error'
      ? h('div', { class: 'diff-err' }, icon('alert'), h('span', null, f.error), h('button', { class: 'btn btn-xs', type: 'button', onClick: () => { agentFiles.delete(a.fileId); renderNow(); } }, 'Retry'))
      : h('div', { class: 'act-wait' }, h('span', { class: 'sk sk-line' }), h('span', { class: 'sk sk-line short' }));
  } else {
    const log = logOf(f.data, ui.actWords).reverse();
    hasThought = log.some(e => e.kind === 'thought');
    body = log.length ? h('div', { class: 'acts' }, log.map((e, i) => (e.kind === 'call' ? ActRow(a, e.call, i) : WordRow(a, e.kind, e.word)))) : h('p', { class: 'muted small' }, 'No tool calls yet.');
  }
  const n = f.data ? f.data.activity.length : 0;
  // the file keeps an agent's newest 14 calls; that thinking may be a summary is said once, here
  const note = [n >= 14 ? `the newest ${n}` : n ? plural(n, 'tool call') : '', hasThought ? THOUGHT_NOTE : ''].filter(Boolean).join(' · ');
  return Block('activity', 'Activity', note, body, hasWords ? WordsToggle() : null);
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
        a.stop && a.stop.can && StopAgent(a, 'btn btn-sm stop-drawer'),
        PressNote(`agent:${a.id}`)),
      a.stop && !a.stop.can && a.stop.why && h('p', { key: 'stopwhy', class: 'stop-why' }, a.stop.why),
      NeedsList(a.id),
      // its call in flight, unless a need above already shows that very call; else its words since its latest call
      a.live ? !(IX.needsBy.get(a.id) || []).length && LiveStrip(a) : a.said && SaidStrip(a),
      task && Block('task', 'Task', a.isTaskCut && !file ? 'cut short: the whole of it is on its way' : '', Folded(`task|${a.id}`, task.length > 360 || task.split('\n').length > 6, h('p', { class: 'task-text' }, task))),
      todos.length > 0 && Block('todos', 'Todos', doneOf(todos), h('ul', { class: 'items' }, todos.map((t, i) => Item(`${i}:${t.text}`, t.status, t.text, t.doing)))),
      result && Block('result', a.id === 'main' ? 'Latest answer' : st === 'failed' ? 'Result · failed' : 'Result', a.endedAt ? agoText(a.endedAt) : '', Folded(`result|${a.id}`, result.length > 600 || result.split('\n').length > 10, Markdown(result))),
      ActivityBlock(a, f),
      edits.length > 0 && Block('edits', 'Edits', plural(byPath.size, 'file'), OwnEdits(a, edits, new Set(file ? file.activity.map(x => x.id) : [])))),
    h('div', { key: 'foot', class: 'drawer-foot' }, Composer(scope)),
  ];
}

export function Drawer() {
  const d = route.drawer;
  if (!d || d.kind !== 'agent' || !S || S.empty) return null;
  return h('aside', { key: `drawer:${d.id}`, class: 'drawer drawer-agent', role: 'dialog', 'aria-label': `Agent: ${nameOf(d.id)}` }, DrawerGrip(), AgentDrawer(d.id));
}

// ------------------------------------------------------------- its width
// The drawer's left edge drags it wider or narrower, its width kept per
// viewer in this browser (localStorage, each access guarded: the page works
// without it); a double click goes back to the default; focused, ← and →
// resize it. Over a narrow window, where the drawer takes the window's width,
// there is no edge to drag.

/** The drawer's widths, px: the least, the most, its default, an arrow key's step (Shift's), and what it leaves the page beside it and the window's edge over it. */
const DRAWER_W = { min: 360, max: 1200, def: 520, step: 16, bigStep: 64, page: 420, edge: 24 };

/** The widest the drawer may be in a window `vw` wide: beside the page, leaving the page DRAWER_W.page; over it, the window less its edge. */
function drawerMaxOf(vw) {
  const room = vw >= WIDE ? vw - DRAWER_W.page : vw - DRAWER_W.edge;
  return Math.max(DRAWER_W.min, Math.min(DRAWER_W.max, Math.round(room)));
}

/** Width `w` as the drawer takes it in a window `vw` wide: whole px, within its bounds; null for no width. */
function drawerWidthOf(w, vw) {
  const n = typeof w === 'number' ? w : typeof w === 'string' && w.trim() !== '' ? Number(w) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(drawerMaxOf(vw), Math.max(DRAWER_W.min, n)));
}

/** The width this browser keeps for the drawer; null for none (the default), and where its storage is refused. */
export function keptDrawerW() {
  try {
    const n = Number(JSON.parse(localStorage.getItem('apiarius:drawerW')));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Keeps the drawer's width in this browser (null: forgets it); storage refused, it lasts this visit. */
function keepDrawerW(w) {
  try {
    if (w == null) localStorage.removeItem('apiarius:drawerW');
    else localStorage.setItem('apiarius:drawerW', JSON.stringify(w));
  } catch { /* private mode, or storage off: the width lasts this visit */ }
}

/** The drawer's width now, px: the one dragged to, else the default, as the window lets it be. */
const drawerWNow = () => drawerWidthOf(ui.drawerW == null ? DRAWER_W.def : ui.drawerW, viewportW());

/** The root's style: the drawer's width, once dragged. */
export const drawerStyle = () => (ui.drawerW == null ? null : { '--drawer-w': `${drawerWNow()}px` });

/** Sets the drawer's width (null: its default), drawn at once without a render; `keep` keeps it in this browser. */
function setDrawerW(w, keep) {
  ui.drawerW = w == null ? null : drawerWidthOf(w, viewportW());
  const app = typeof document.getElementById === 'function' ? document.getElementById('app') : null;
  if (app && app.style) {
    if (ui.drawerW == null) app.style.removeProperty('--drawer-w');
    else app.style.setProperty('--drawer-w', `${ui.drawerW}px`);
  }
  if (keep) keepDrawerW(ui.drawerW);
}

/** A drag of the drawer's edge: its width follows the pointer (its left edge moves with it) until the button is let go, then is kept. */
function dragDrawer(e, grip) {
  if (e.button !== 0) return;
  e.preventDefault();
  const startX = e.clientX, startW = drawerWNow();
  const root = document.documentElement;
  try { grip.setPointerCapture(e.pointerId); } catch { /* an old browser: the window's moves still come */ }
  root.classList.add('is-resizing');
  const move = ev => setDrawerW(startW + (startX - ev.clientX), false);
  const done = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', done);
    grip.removeEventListener('pointercancel', done);
    root.classList.remove('is-resizing');
    keepDrawerW(ui.drawerW);
    renderNow();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', done);
  grip.addEventListener('pointercancel', done);
}

/** The focused edge's keys: ← widens the drawer (its edge moves left), → narrows it, Shift by a bigger step; the page's own keys pass by. */
function drawerKey(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const step = (e.shiftKey ? DRAWER_W.bigStep : DRAWER_W.step) * (e.key === 'ArrowLeft' ? 1 : -1);
  setDrawerW(drawerWNow() + step, true);
  e.preventDefault();
  if (e.stopPropagation) e.stopPropagation();
  renderNow();
}

/** A double click on the edge: the default width again, forgotten in this browser. */
function resetDrawerW() {
  setDrawerW(null, true);
  renderNow();
}

/** The drawer's left edge: a separator to drag, focusable, that says its width. */
function DrawerGrip() {
  return h('div', {
    key: 'grip', class: 'drawer-grip', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical',
    'aria-label': 'Drawer width', 'aria-valuemin': String(DRAWER_W.min), 'aria-valuemax': String(drawerMaxOf(viewportW())), 'aria-valuenow': String(drawerWNow()),
    title: 'Drag to resize (← →); double-click for the default width',
    onPointerDown: dragDrawer, onKeyDown: drawerKey, onDblClick: resetDrawerW,
  });
}
