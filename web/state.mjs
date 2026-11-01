/* Apiarius's web page: the data. The page's access (its link's ticket, the handle it trades it for); the state shown and
 * the indexes built from it; the connection (SSE, and a reload of the state
 * when it fails); the acks of the page's commands; the files it loads on
 * demand; the router; the UI state that outlives a render; and All
 * sessions, which shows another session's deck in this one's place (app.js
 * says what the other modules hold).
 */
import * as AV from './avatars.mjs';
import { firstLine, h, icon, plural, since, store } from './basics.mjs';
import { Dot, Empty, Glyph, keptDrawerW, noteResolved, STATE_HUE, styleNow, urlOf } from './parts.mjs';
import { notePresses } from './now.mjs';
import { invalidate, renderNow, scroller, shownKey } from './app.js';

// ===================================================================== access
// The page's link carries a one-time ticket (`t`). The page trades it at once
// for a handle (POST /session, the ticket in a header), keeps the handle in this
// tab's sessionStorage so a reload keeps working, and takes the ticket out of the
// address bar. Every data request sends the handle as a header, and /events
// alone as `h`, since an EventSource sends no header. The server sets no cookie.
// The handle's grade is the link's: `pane` (the Desktop's Browser pane, which
// Claude's tools can drive: each message in your voice waits for your Send
// above the prompt in Claude Code) or `full` (your own browser: it goes at once).

const TICKET = (() => { try { return new URLSearchParams(location.search).get('t') || ''; } catch { return ''; } })();
const KEPT = 'apiarius:handle';
/** Every data request's header, once the page has a handle. */
export const AUTH = {};
/** Where the page's access stands: its handle and grade, and, refused, why ('used', 'expired', 'unknown', 'restarted', 'none'). */
export const access = { handle: '', grade: '', why: '', ticket: TICKET };

function keepHandle(handle, grade) {
  access.handle = handle;
  access.grade = grade === 'full' ? 'full' : 'pane';
  AUTH['X-Deck-Handle'] = handle;
  try { sessionStorage.setItem(KEPT, JSON.stringify({ handle, grade: access.grade })); } catch { /* no storage: a reload needs the deck's link again */ }
}

/** The handle this tab kept before a reload, if any; or why it has none any more, so a reload still says it. */
function keptHandle() {
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEPT) || 'null');
    if (kept && typeof kept.handle === 'string' && /^[A-Za-z0-9_-]{43}$/.test(kept.handle)) keepHandle(kept.handle, kept.grade);
    else if (kept && typeof kept.why === 'string' && !access.why) access.why = kept.why;
  } catch { /* none, or unreadable */ }
}

/** The handle let go (the server refused it, or the link), and why, kept in the tab in its place. */
function dropHandle(why) {
  access.handle = '';
  access.why = why;
  delete AUTH['X-Deck-Handle'];
  try { sessionStorage.setItem(KEPT, JSON.stringify({ why })); } catch { /* none */ }
}

/** The ticket out of the address bar, the route kept: it opens one page, and the bar is what a screen or a copy shows. */
function scrubTicket() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('t')) return;
    url.searchParams.delete('t');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch { /* no history here (the tests' page) */ }
}

/**
 * Trades the link's ticket for a handle, once: true once the page has one.
 * A ticket the server refuses (used once already, or one it never sealed: an
 * earlier server's) says why; one that could not reach it is tried again.
 */
async function trade() {
  if (!access.ticket) {
    if (!access.handle) keptHandle();
    if (!access.handle && !access.why) access.why = 'none';
    return !!access.handle;
  }
  scrubTicket();
  let res;
  try {
    res = await fetch('/session', { method: 'POST', headers: { 'X-Deck-Ticket': access.ticket }, cache: 'no-store' });
  } catch {
    return null; // the server is not answering: tried again
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  access.ticket = '';
  if (res.ok && data && typeof data.handle === 'string') {
    access.why = '';
    keepHandle(data.handle, data.grade);
    return true;
  }
  // a link used once already: this tab may hold the handle it was traded for (a reload of a page whose address kept it)
  keptHandle();
  if (access.handle) return true;
  dropHandle(data && (data.error === 'used' || data.error === 'expired') ? data.error : 'unknown');
  return false;
}

// a reload: the handle this tab traded for before is the page's until the server says otherwise
if (!TICKET) keptHandle();

/** The latest v2 state, and the indexes built from it. */
export let S = null;
export let IX = null;
/** This session's own latest state: `S` too, unless another session's deck shows (#/s/<id>/…, "All sessions" below). */
let HOME = null;

const clock = () => Math.max(Date.now(), S ? S.now || 0 : 0);
/** The time ages run to: now while the session is live, its last state's time once it ended (nothing grows after that). */
export const liveNow = () => (conn.status === 'ended' && S && S.now ? S.now : clock());

/**
 * An age, worded as the mod words a need's `age`. The state is written only
 * when something in it changed, so the page runs the same words on its own
 * clock: they read as the state's at the moment it was built, and stay true.
 */
export const ageOf = at => (at ? since(liveNow() - at) : '');
export const agoText = at => { const a = ageOf(at); return a === 'now' ? 'just now' : a ? `${a} ago` : ''; };

// ============================================================== state + index
// The state as the page reads it: v2 (hooks/web.ts), every list a list and
// every field its type, so a field an older or newer mod leaves out never
// breaks a view.

export const arr = v => (Array.isArray(v) ? v : []);
export const str = v => (typeof v === 'string' ? v : '');
export const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
export const numOr = (v, d = null) => (typeof v === 'number' && isFinite(v) ? v : d);
/** A bidirectional control (an override, embedding or isolate, U+202A to U+202E and U+2066 to U+2069, or a mark, U+200E, U+200F and U+061C), which would make a name read in another order: shown as U+FFFD, as the pane does (hooks/ui/v2/text.ts). */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
/** A name the page shows (an agent's, a session's, a tool's caller's): a string, each bidirectional control in it as U+FFFD. */
const shownName = v => str(v).replace(BIDI, '\ufffd');

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
    id: n.id, kind, agent: str(n.agent) || 'main', agentName: shownName(n.agentName), at: numOr(n.at, 0), age: str(n.age), text: str(n.text),
    questions, isAnswerable: n.isAnswerable === true && kind === 'question' && questions.length > 0,
    tool: str(n.tool), command: str(n.command), path: str(n.path), description: str(n.description), type: str(n.type), title: shownName(n.title),
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
    name: shownName(r.name), description: shownName(r.description), type: shownName(r.type), shortId: str(r.shortId),
    title: shownName(str(r.title) || str(r.name) || str(r.description) || str(r.type) || str(r.shortId) || r.id),
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
    id: x.id, kind: BG_KINDS.has(x.kind) ? x.kind : 'other', what: str(x.what), title: shownName(str(x.title) || x.id), status: str(x.status) || 'running',
    by: typeof x.by === 'string' && x.by ? x.by : null, byName: shownName(x.byName), at: numOr(x.at, 0), nextAt: numOr(x.nextAt, null),
    schedule: str(x.schedule), recurring: x.recurring === true, when: str(x.when), stop: stopOf(x.stop),
  }));
  const scheduled = rows.filter(x => x.status === 'scheduled').length;
  return { rows, tasks: numOr(b.tasks, rows.length - scheduled), scheduled: numOr(b.scheduled, scheduled), text: str(b.text) };
}

/** Whether an agent is finished: done, failed, stopped or idle, nothing of its waiting on you; never the Orchestrator (the mod's W.isFinishedRow). The Dashboard and Chat's members fold these behind one "N finished" row. */
export const isFinished = a => a.kind !== 'orchestrator' && !a.needs && (a.status === 'done' || a.status === 'failed' || a.status === 'idle');

function planOf(p) {
  p = obj(p);
  if (!p) return null;
  const board = arr(p.board).filter(t => t && typeof t.subject === 'string').map(t => ({ id: String(t.id == null ? '' : t.id), subject: t.subject, status: ITEM_STATUS.has(t.status) ? t.status : 'pending', owner: typeof t.owner === 'string' && t.owner ? t.owner : null, doing: str(t.doing) }));
  const todos = obj(p.todos) ? { items: todosOf(p.todos.items), at: numOr(p.todos.at, 0) } : null;
  const approved = obj(p.approved) && typeof p.approved.markdown === 'string' ? { markdown: p.approved.markdown, at: numOr(p.approved.at, 0), by: str(p.approved.by) || 'main' } : null;
  const workflows = arr(p.workflows).filter(w => w && typeof w.name === 'string').map(w => ({ id: String(w.id == null ? w.name : w.id), name: w.name, phases: arr(w.phases).filter(x => typeof x === 'string'), startedAt: numOr(w.startedAt, 0), endedAt: numOr(w.endedAt, null) }));
  return { board, todos: todos && todos.items.length ? todos : null, approved, workflows };
}

const chatOf = m => ({ ...m, at: numOr(m.at, 0), from: str(m.from), to: typeof m.to === 'string' && m.to ? m.to : null, who: shownName(m.who), kind: str(m.kind) || 'chat', title: shownName(m.title), text: str(m.text), isCut: m.isCut === true, isCleared: m.isCleared === true, compaction: obj(m.compaction) ? { title: str(m.compaction.title), figures: str(m.compaction.figures) } : null });

function changesOf(c) {
  c = obj(c) || {};
  const repo = obj(c.repo), where = obj(c.where);
  return {
    repo: repo ? { name: str(repo.name), root: str(repo.root), branch: str(repo.branch), ahead: numOr(repo.ahead, 0), behind: numOr(repo.behind, 0), head: str(repo.head) } : null,
    // where the chat runs and how the repository shown is picked; an older mod's state has none
    where: where ? {
      cwd: str(where.cwd), name: str(where.name), isRepo: typeof where.isRepo === 'boolean' ? where.isRepo : null, pinned: str(where.pinned),
      picks: arr(where.picks).filter(p => p && typeof p.root === 'string' && p.root).slice(0, 8).map(p => ({ name: str(p.name) || p.root, root: p.root })),
    } : null,
    files: arr(c.files).filter(f => f && typeof f.path === 'string').map(f => ({ path: f.path, code: str(f.code), added: numOr(f.added, 0), removed: numOr(f.removed, 0), edits: arr(f.edits).filter(x => typeof x === 'string'), diffId: typeof f.diffId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(f.diffId) ? f.diffId : null })),
    edits: arr(c.edits).filter(e => e && typeof e.id === 'string' && typeof e.path === 'string').map(e => ({ id: e.id, agent: str(e.agent), tool: str(e.tool), path: e.path, at: numOr(e.at, 0), added: numOr(e.added, 0), removed: numOr(e.removed, 0), isOutside: e.isOutside === true })),
    commits: arr(c.commits).filter(x => x && typeof x.hash === 'string').map(x => ({ ...x, short: str(x.short) || x.hash.slice(0, 7), subject: str(x.subject), author: str(x.author), at: numOr(x.at, 0), added: numOr(x.added, 0), removed: numOr(x.removed, 0), files: numOr(x.files, 0), agent: typeof x.agent === 'string' && x.agent ? x.agent : null })),
  };
}

/** The newest tool calls of every agent, and what each said between them (`kind` 'said'), newest first. */
function activityOf(list) {
  return arr(list).filter(x => x && typeof x.tool === 'string' && typeof x.agent === 'string' && x.agent && (x.kind !== 'said' || typeof x.text === 'string')).map(x => ({
    id: str(x.id) || `${numOr(x.at, 0)}|${x.agent}|${x.tool}|${str(x.text)}`, at: numOr(x.at, 0), agent: x.agent, agentName: shownName(x.agentName),
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
    agents: arr(i.agents).filter(a => a && typeof a.id === 'string').map(a => ({ id: a.id, title: shownName(str(a.title) || a.id), model: str(a.model), tokens: tok(a.tokens), requests: numOr(a.requests, 0), tools: numOr(a.tools, 0), errors: numOr(a.errors, 0) })),
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
    compactions: arr(i.compactions).filter(x => x && typeof x.agent === 'string').map(x => ({ id: str(x.id), at: nums(x.at, 0), agent: x.agent, agentName: shownName(x.agentName), trigger: str(x.trigger), figures: str(x.figures), text: str(x.text), summary: str(x.summary), skipped: typeof x.skipped === 'string' ? x.skipped : null })),
    permissions: {
      decisions: arr(p.decisions).filter(d => d && typeof d.id === 'string' && typeof d.tool === 'string').map(d => ({ id: d.id, at: nums(d.at, 0), agent: str(d.agent) || 'main', agentName: shownName(d.agentName), tool: d.tool, target: str(d.target), outcome: OUTCOMES.has(d.outcome) ? d.outcome : 'allowed', by: str(d.by), text: str(d.text), why: str(d.why) })),
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
    session: { id: session ? str(session.id) : '', cwd: session ? str(session.cwd) : '', startedAt: session ? numOr(session.startedAt, 0) : 0, isFork: !!session && session.isFork === true },
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

export function group(list, f) {
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
    if (S) { indexViewed(); notePresses(); }
    invalidate();
    return;
  }
  S = HOME;
  IX = buildIndex(S);
  noteResolved();
  notePresses();
  // a style picked here holds until the state names it: from then on the state's (the person's setting) is drawn
  if (ui.picked && S.avatarStyle === ui.picked.style) ui.picked = null;
  invalidate();
}

// ================================================================= connection
// Fetch /state once, then follow /events. On a drop, retry with backoff; after
// a few failed tries in a row the server is gone, which means the session ended.

export const conn = { status: 'loading', fails: 0, timer: 0, es: null, retryAt: 0, endedAt: 0 };

function setConn(status) {
  if (conn.status === status) return;
  conn.status = status;
  if (status === 'ended' && !conn.endedAt) conn.endedAt = Date.now();
  if (status === 'live') conn.endedAt = 0;
  invalidate();
}

export async function connect() {
  clearTimeout(conn.timer);
  conn.retryAt = 0;
  if (!access.handle) {
    const traded = await trade();
    if (traded === null) return retry();
    if (!traded) { setConn('denied'); return; }
  }
  let res;
  try {
    res = await fetch('/state', { headers: AUTH, cache: 'no-store' });
  } catch {
    return retry();
  }
  // the server knows the handle no more: it started again, with a new secret
  if (res.status === 403) { dropHandle('restarted'); setConn('denied'); return; }
  if (!res.ok) return retry();
  try { apply(JSON.parse(await res.text())); } catch { /* a torn write: the stream sends the next one */ }
  follow();
}

function follow() {
  if (conn.es) conn.es.close();
  const es = (conn.es = new EventSource(`/events?h=${encodeURIComponent(access.handle)}`));
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

export function retryNow() {
  conn.fails = Math.min(conn.fails, 3);
  connect();
}

export async function command(body) {
  // another session's deck: every command about its session goes to its own deck, which runs it as its own page's; the avatar style is the person's, this deck's own
  if (route.session && !['view', 'avatarStyle', 'ping'].includes(body.cmd)) {
    const why = notAnswering(sessionRow(route.session));
    if (why) throw new Error(why);
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
      forbidden: 'The deck refused it: its server started again, so this page needs opening again from Claude Code (/apiarius web, or Open in browser at the top of the deck).',
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
export const newCmdId = kind => `${kind}-${Date.now().toString(36)}-${(++cmdSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** How long a send waits for its ack before saying none came. */
export const ACK_WAIT = 20000;
/** How long a question you answered here stays on show, collapsed, once it left the state. */
export const KEEP = 20000;

/** "It reads it…" reads "it reads it…" after a colon; a name ("Claude reads it…") keeps its capital. */
const softText = t => String(t || '').trim().replace(/^(It|Its|The|This|That|They|There|A|An|No|Not|Nothing|Only|Too|Could|Already)\b/, w => w.toLowerCase());
/** `word: text`, unless the text starts with that word already ("Not delivered: it has ended"). */
export const lead = (word, text) => (text.toLowerCase().startsWith(word.toLowerCase()) ? text[0].toUpperCase() + text.slice(1) : `${word}: ${text}`);

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
  // in your voice from the Browser pane: it waits for your Send above the prompt in Claude Code
  if (ack.status === 'held') return { tone: 'wait', icon: 'hand', text: ack.text || 'Press Send above your prompt in Claude Code to send it', held: true };
  // a review put in the prompt box: "In your prompt box: press Enter to send it"
  if (ack.status === 'delivered' && what === 'review') return { tone: 'done', icon: 'check', text: ack.text || 'In your prompt box' };
  if (ack.status === 'delivered') return { tone: 'done', icon: 'check', text: lead('Delivered', text || 'it reads it at its next step') };
  return { tone: 'wait', icon: 'clock', text: lead('Queued', text || (what === 'review' ? 'it runs when Claude is free' : 'Claude reads it when it finishes its current turn')) };
}

/** A send's status line, from its ack, its own error, or the time it has waited. */
export function sendState(sent, what) {
  const ack = IX && IX.acks.get(sent.id);
  if (ack) return { ...ackState(ack, what), ack };
  if (sent.state === 'error') return { tone: 'fail', icon: 'x', text: sent.error || 'Could not send it.' };
  if (Date.now() - sent.at < ACK_WAIT) return { tone: 'run', glyph: 'active', text: what === 'answer' ? 'Sending your answer…' : 'Sending…', busy: true };
  return { tone: 'idle', icon: 'clock', text: 'Sent, but Claude Code hasn\'t confirmed it', late: true };
}

export function StatusNote(st, cls) {
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

export const fullTexts = new Map();

export function fullTextOf(id) {
  let t = fullTexts.get(id);
  if (t) return t;
  t = { status: 'loading', text: '', error: '' };
  fullTexts.set(id, t);
  fetch(`${baseUrl()}/message/${encodeURIComponent(id)}`, { headers: AUTH })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'The rest is not on disk yet.' : `The server answered ${r.status}.`))))
    .then(text => { t.status = 'ok'; t.text = text; })
    .catch(e => { t.status = 'error'; t.error = e.message || 'Could not load the rest.'; })
    // the chat keeps its place: the reader goes on from where the cut was
    .finally(() => { ui.holdChat = true; invalidate(); });
  return t;
}

/** Patches (`patch`) and git's diffs (`gitdiff`), by `<kind>:<id>`. */
export const diffs = new Map();
const DIFF_WORD = { patch: 'The patch', gitdiff: 'Git\'s diff' };

export function diffOf(kind, id) {
  const key = `${kind}:${id}`;
  let p = diffs.get(key);
  if (p) return p;
  p = { status: 'loading', hunks: null, error: '' };
  diffs.set(key, p);
  fetch(`${baseUrl()}/${kind}/${encodeURIComponent(id)}`, { headers: AUTH })
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

export const agentFiles = new Map();

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
export function logOf(f, withWords) {
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

export function agentFileOf(a) {
  const sig = rowSig(a);
  let f = agentFiles.get(a.fileId);
  if (f && (f.sig === sig || f.loading)) return f;
  if (!f) { f = { status: 'loading', data: null, error: '', sig: '', loading: false, tries: 0 }; agentFiles.set(a.fileId, f); }
  f.sig = sig;
  f.loading = true;
  fetch(`${baseUrl()}/agent/${encodeURIComponent(a.fileId)}`, { headers: AUTH, cache: 'no-store' })
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

export const TABS = [['now', 'Dashboard'], ['chat', 'Chat'], ['org', 'Org'], ['changes', 'Changes'], ['inspect', 'Inspect'], ['settings', 'Settings']];
/** The other names a route answers to: the Dashboard's own, and Settings', where Help is. */
const ROUTE_ALIAS = { dashboard: 'now', help: 'settings' };

export function parseRoute() {
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
export let route = parseRoute();

export const hrefOf = (tab, drawer, session = route.session) => (tab === 'sessions' ? '#/sessions' : `${session ? `#/s/${encodeURIComponent(session)}/` : '#/'}${tab}${drawer ? `/agent/${encodeURIComponent(drawer.id)}` : ''}`);

/** Takes the page to `next`, noting the tab it leaves (`i` and `h` go back to it from Settings), and the deck All sessions was opened from (`s` goes back to it). */
export function setRoute(next) {
  if (next.tab !== route.tab) {
    ui.prevTab = route.tab;
    if (next.tab !== 'settings') ui.settingsAt = null;
    if (next.tab === 'sessions') ui.sessionsFrom = { tab: route.tab, session: route.session, href: hrefOf(route.tab, route.drawer, route.session) };
  }
  route = next;
  // another session's deck, or this one's again
  if ((route.session || null) !== VIEW.id) switchView(route.session || null);
}

/** Keeps where the page shown now is scrolled to; the chat read to its end keeps "the end". */
export function saveScroll() {
  if (!scroller) return;
  const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32;
  ui.scroll.set(shownKey, shownKey === 'chat' && atEnd ? 'end' : scroller.scrollTop);
}

/** Goes to `tab`, with `drawer` open over it (the one open now by default). */
export function navigate(tab, drawer = route.drawer) {
  saveScroll();
  const href = hrefOf(tab, drawer);
  if (location.hash !== href) location.hash = href;
  setRoute({ tab, drawer, key: tab, session: tab === 'sessions' ? null : route.session });
  renderNow();
}
export const openAgent = id => navigate(route.tab, { kind: 'agent', id });
export const closeDrawer = () => navigate(route.tab, null);
export const isAgentOpen = id => !!route.drawer && route.drawer.kind === 'agent' && route.drawer.id === id;
/** The window's width from which a drawer sits beside the page rather than over it (app.css's own breakpoint). */
export const WIDE = 1180;
/** The window's width, px; a desktop's when it cannot be read. */
export const viewportW = () => (typeof window.innerWidth === 'number' ? window.innerWidth : 1280);
/** A page wide enough to keep a drawer beside it: there it leaves the page in view, so keys that go to a page keep it open. */
export const isWide = () => typeof window.innerWidth === 'number' && window.innerWidth >= WIDE;

// ================================================================== UI state
// Lives across renders and routes; never reset by a state update.

export const ui = {
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
  sessionsFrom: null,      // { tab, session, href }: the deck All sessions was opened from (its row lit, a row picked on its tab)
  picked: null,            // { style, until }: an avatar style picked here, drawn until the state names it
  toast: null,             // { text, until }
  needAt: -1,              // the need `n` went to last
  presses: new Map(),      // command id -> { key, at, ack }: a Stop, Cancel, Stop turn, Clear finished or pick sent from here, and its ack once the state holds it
  drawerW: keptDrawerW(),  // the width the reader dragged the agent drawer to, px; null for its default
  drawerTo: null,          // { id, until }: an element of the drawer to bring into view once drawn (a call, an edit)
};

/** Brings element `id` of the open drawer into view once it has rendered, and lights it a moment: where a call's "In Edits" and an edit's "In Activity" go. */
export function revealInDrawer(id) {
  ui.drawerTo = { id, until: Date.now() + 4000 };
  invalidate();
}

/** Brings element `id` into view once the page shows route `on` (and the element has rendered: the state may still be on its way). */
export function scrollSoon(id, on = route.key, focus = false) {
  ui.scrollTo = { id, on, until: Date.now() + 4000, focus };
  invalidate();
}

/** A disclosure's state; its default is fixed the first time it is seen so live updates never flip it. */
export function isOpen(key, byDefault) {
  if (!ui.open.has(key)) ui.open.set(key, !!byDefault);
  return ui.open.get(key);
}
export function toggle(key) {
  ui.open.set(key, !ui.open.get(key));
  renderNow();
}

/** The sections folded by their heads (`Section`), kept across reloads. */
export const shut = new Set(arr(store.get('shut', [])).filter(x => typeof x === 'string'));
export function setShut(id, on) {
  if (on === shut.has(id)) return;
  if (on) shut.add(id); else shut.delete(id);
  store.set('shut', [...shut]);
}

export function toast(text) {
  ui.toast = { text, until: Date.now() + 2400 };
  setTimeout(invalidate, 2500);
  invalidate();
}

// ============================================================== all sessions
// Every Claude Code session on this machine that runs Apiarius (the mod's
// `sessions`, hooks/sessions.ts), as peers of one deck: All sessions
// (#/sessions, the header's link and `s`) lists them, here's first, in an
// order their states never move (what needs you is counted, not moved up),
// and the header's tag says whose deck shows ("here", or where another
// runs). A press shows that session's deck in this one's place, on the tab
// All sessions was opened from, #/s/<id>/<tab>, read from its
// folder (/s/<id>/state and its lazy files) every 1.5 s while it shows, its
// own deck asked to keep writing them (`view`, every 30 s). There is no mode
// for another's deck: its header is its own, and its controls are its own
// window's. Every press on it goes to its own deck, which acts on it through
// Claude Code as on its own page's, and the control says what came of it; a
// permission prompt, which only its window answers, says so where it stands
// ("Answer it in its window: Terminal · site."); a deck gone quiet, or one
// that takes nothing from here, says so at its controls before a press.

/** The session whose deck shows (null: this one's), its state as read, why none shows, and its poll. */
const VIEW = { id: null, S: null, error: '', timer: 0, asked: 0, openedAt: 0, seq: 0 };
const VIEW_POLL = 1500, VIEW_AGAIN = 30000;

/** Where the lazy files come from: another session's under /s/<id>, this one's at the root. */
function baseUrl() { return route.session ? `/s/${encodeURIComponent(route.session)}` : ''; }

/** A row's agents at work as the mod gives them (hooks/sessions.ts `SessionFace`: each its id, title, status and its own list's progress), three at most; none from an earlier mod, which names none. */
function sessionFacesOf(list) {
  return arr(list).filter(f => f && typeof f.id === 'string' && f.id && typeof f.title === 'string').slice(0, 3).map(f => ({
    id: f.id, title: f.title, status: f.status === 'starting' ? 'starting' : 'running', progress: typeof f.progress === 'number' && Number.isFinite(f.progress) ? f.progress : undefined,
  }));
}

/** Every session on this machine as the page reads it (the mod's `sessions`); null from a mod that writes none. */
function sessionsOf(x) {
  x = obj(x);
  if (!x) return null;
  const rows = arr(x.rows).filter(r => r && typeof r.id === 'string' && r.id).map(r => {
    const state = STATE_TEXT[r.state] ? r.state : 'idle';
    const isQuiet = r.isQuiet === true;
    return {
      id: r.id, isMe: r.isMe === true, title: shownName(r.title) || 'No request yet', state, stateText: isQuiet ? '' : str(r.stateText) || STATE_TEXT[state],
      surface: str(r.surface), place: shownName(r.place), repo: shownName(r.repo), where: shownName(str(r.where) || [str(r.place), str(r.repo)].filter(Boolean).join(' · ')), cwd: str(r.cwd),
      need: !isQuiet && typeof r.need === 'string' && r.need ? r.need : null, needs: isQuiet ? 0 : numOr(r.needs, 0), say: str(r.say),
      working: numOr(r.working, 0), agents: numOr(r.agents, 0), faces: sessionFacesOf(r.faces),
      costUsd: numOr(r.costUsd), cost: str(r.cost), costNote: str(r.costNote), at: numOr(r.at, 0), startedAt: numOr(r.startedAt, 0),
      isQuiet, heardAt: numOr(r.heardAt, 0), canOpen: r.canOpen === true, canSteer: r.canSteer === true,
    };
  });
  const others = obj(x.others) || {};
  const machine = obj(x.machine) || {};
  const heard = rows.filter(r => !r.isQuiet);
  return {
    rows, text: str(x.text), others: { waiting: numOr(others.waiting, 0), working: numOr(others.working, 0) },
    // an earlier mod's list counts no machine: counted here from its rows
    machine: {
      waiting: numOr(machine.waiting, heard.filter(r => r.state === 'waiting').length),
      working: numOr(machine.working, heard.filter(r => r.state === 'working').length),
      agents: numOr(machine.agents, heard.reduce((n, r) => n + r.working, 0)),
    },
  };
}

const sessionsNow = () => (HOME && HOME.sessions) || null;
export const sessionRow = id => { const list = sessionsNow(); return (list && list.rows.find(r => r.id === id)) || null; };
/** The session whose deck shows: the one picked, else here. */
const shownId = () => route.session || (HOME && HOME.session.id) || '';

/** A note at what is answered only in a session's own window (a permission prompt, Claude Code's notification), as the mod words it (hooks/sessions.ts `inItsWindow`). */
const inItsWindow = (lead, where) => `${lead} in its window${where ? `: ${where}` : ''}.`;
/** Where what no deck answers is answered: `own` on this session's deck, its window on another's. */
export const whereNote = (lead, own) => (S && S.peer ? inItsWindow(lead, S.peer.where) : own);

/** What another session's controls say, before a press, while its deck takes nothing from here (hooks/sessions.ts `NOT_ANSWERING`). */
const NOT_ANSWERING = 'Its deck isn\'t answering';
/** Why another session's controls do nothing from here (hooks/sessions.ts `notAnsweringOf`); '' while its deck takes commands from here. */
function notAnswering(row) {
  if (!row) return `${NOT_ANSWERING}: it is not listed any more.`;
  if (row.isQuiet) return `${NOT_ANSWERING}: ${row.heardAt ? heardText(row.heardAt).replace(/^L/, 'l') : 'not heard from lately'}.`;
  if (!row.canSteer) return `${NOT_ANSWERING}: it runs an older Apiarius.`;
  return '';
}
/** On another session's deck that takes nothing from here, why, said at its controls in their place; '' on this deck's own, and while it does. */
export const deafWhy = () => (S && S.peer && !S.peer.canSteer ? S.peer.why : '');

/** A quiet deck's line on the page's clock: "Last heard 2m ago". */
function heardText(at) {
  const t = since(liveNow() - at);
  return t === 'now' ? 'Last heard just now' : `Last heard ${t} ago`;
}
/** What a row says under its title: its need, what it does, or (quiet) when its deck was last heard. */
const sayOf = r => (r.isQuiet && r.heardAt ? heardText(r.heardAt) : r.say);

/** "This machine" in words (hooks/sessions.ts `machineLineOf`): "◆ 1 needs you" (or ''), then "3 agents working", "1 session working" or "Nothing at work". */
function machineLine(list) {
  const { waiting, working, agents } = list.machine;
  return {
    need: waiting > 0 ? `◆ ${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : '',
    rest: agents > 0 ? `${plural(agents, 'agent')} working` : working > 0 ? `${plural(working, 'session')} working` : 'Nothing at work',
  };
}

/** A row's faces while its agents work (hooks/sessions.ts `facesOf`): each as its session's own deck draws it, three at most, then how many more; none for the Orchestrator (the dot says the session works), nor from an earlier mod's row, which names none. */
function facesOf(r) {
  if (r.state !== 'working' || r.isQuiet || !r.faces.length) return { faces: [], more: 0 };
  const faces = r.faces.slice(0, 3);
  return { faces, more: Math.max(0, r.working - faces.length) };
}

function Faces16(r) {
  const f = facesOf(r);
  if (!f.faces.length) return null;
  // seeded by each agent's id and named by its title, as its deck's own avatar (`faceOf`)
  const svg = AV.avatarStackSvg(styleNow(), f.faces.map(a => ({ id: a.id, name: a.title, role: '', status: a.status, progress: a.progress })), { size: 16, ground: '#0b0b0b' });
  return h('span', { key: 'faces', class: 'sess-faces', title: r.agents > r.working ? `${r.working} of ${plural(r.agents, 'agent')} working` : `${plural(r.working, 'agent')} working` },
    h('img', { class: 'sess-faces-img', alt: '', draggable: 'false', src: urlOf(svg) }),
    f.more > 0 && h('span', { class: 'sess-faces-more' }, `+${f.more}`));
}

/** Where a row goes: here's deck (#/<tab>), another's in its place (#/s/<id>/<tab>), on the tab All sessions was opened from; null for a deck that names no folder. */
function rowHref(r) {
  const tab = route.tab !== 'sessions' ? route.tab : ui.sessionsFrom ? ui.sessionsFrom.tab : 'now';
  if (r.isMe) return hrefOf(tab, null, null);
  return r.canOpen ? hrefOf(tab, null, r.id) : null;
}

/** The index of the session shown, this deck's own acks with its (a send refused here is acked here). */
function indexViewed() {
  IX = buildIndex(S);
  if (HOME) for (const k of HOME.acks) if (!IX.acks.has(k.id)) IX.acks.set(k.id, k);
}

/** Another session's deck from now (`id`), or this one's again (null): the lazy files read afresh, its state read until it shows. */
export function switchView(id) {
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

/** Reads the session shown again, and asks its deck to keep writing it every 30 s; then again in 1.5 s, while it shows. */
async function pollView(seq) {
  if (seq !== VIEW.seq || !VIEW.id) return;
  const id = VIEW.id;
  if (Date.now() - VIEW.asked >= VIEW_AGAIN) {
    VIEW.asked = Date.now();
    command({ cmd: 'view', session: id }).catch(() => {});
  }
  try {
    const res = await fetch(`/s/${encodeURIComponent(id)}/state`, { headers: AUTH, cache: 'no-store' });
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

/**
 * Another session's state as this page shows it (hooks/sessions.ts
 * `peerStateOf`): marked `peer` (its window, whether its deck takes commands
 * from here, why not). Its controls are its own window's: a Stop or Cancel
 * where its own deck's check allows it, its questions answerable through its
 * deck. Where its deck takes nothing from here, none is offered, each saying
 * why instead.
 */
function peerOf(s, row) {
  const why = notAnswering(row);
  const peer = { where: row ? row.where : '', canSteer: !why, why };
  if (!why) return { ...s, peer, sessions: null };
  const deaf = x => (x.stop ? { ...x, stop: { ...x.stop, can: false, why } } : x);
  return {
    ...s, peer, sessions: null,
    needs: s.needs.map(n => ({ ...n, isAnswerable: false })),
    agents: s.agents.map(deaf),
    background: { ...s.background, rows: s.background.rows.map(deaf) },
  };
}

/** The session shown's state, as this page shows it: another session's (`peerOf`), its questions answerable only where its deck takes answers from here. */
function applyViewed(v2) {
  if (VIEW.S && numOr(v2.now, 0) < VIEW.S.now) return;
  const s = peerOf(normalize(v2), sessionRow(VIEW.id));
  VIEW.S = s;
  S = s;
  indexViewed();
  noteResolved();
  notePresses();
}

/** The session whose row All sessions lights: the deck it was opened from, else here. */
const cameFrom = () => (ui.sessionsFrom && ui.sessionsFrom.session) || (HOME && HOME.session.id) || '';

/** `s`: All sessions, the focus on the row of the deck shown; pressed there, back to the deck and tab it was opened from. Nothing while no list is known. */
export function toggleSessions() {
  if (!sessionsNow()) return false;
  saveScroll();
  if (route.tab !== 'sessions') {
    ui.focusTo = `sess-${shownId()}`;
    location.hash = '#/sessions';
  } else location.hash = (ui.sessionsFrom && ui.sessionsFrom.href) || '#/now';
  setRoute(parseRoute());
  renderNow();
  return true;
}

/** The header's quiet tag after the title: "here" on this page's own deck (while a list of sessions is known), where another session runs on its deck ("Terminal · site"; its row's while its state is read). */
export function WhereTag() {
  if (!route.session) return sessionsNow() ? h('span', { key: 'where', class: 'tag hd-where', title: 'The session this page belongs to' }, 'here') : null;
  const row = sessionRow(route.session);
  const where = S && S.peer ? S.peer.where : row ? row.where : '';
  return where ? h('span', { key: 'where', class: 'tag hd-where', title: `Another session's deck: ${where}` }, where) : null;
}

/** The header's way to every session on this machine: the layers icon and "All sessions" (#/sessions, lit there), after "◆ 1 other session needs you" in amber while a session but the one shown waits on you (a quiet one counted nowhere). */
export function SessionsLink() {
  const list = sessionsNow();
  if (!list) return null;
  const on = route.tab === 'sessions';
  const n = list.rows.filter(r => r.id !== shownId() && !r.isQuiet && r.state === 'waiting').length;
  return h('a', { key: 'sessions', class: `hd-sessions${on ? ' on' : ''}`, href: '#/sessions', title: `Every session on this machine (s): ${list.text}`, 'aria-current': on ? 'page' : null },
    n > 0 && h('span', { class: 'hd-sessions-need' }, `◆ ${n}`, h('span', { class: 'hd-sessions-words' }, ` other ${n === 1 ? 'session needs' : 'sessions need'} you`)),
    h('span', { class: 'hd-sessions-label' }, icon('layers'), h('span', { class: 'hd-sessions-word' }, 'All sessions')));
}

/** Stop turn on another session's deck that takes nothing from here: that its deck isn't answering, quietly where the button would be, why under the pointer. */
export function PeerStopTurn() {
  return h('span', { key: 'stopturn', class: 'peer-note hd-peer-stop', title: deafWhy() }, NOT_ANSWERING);
}

/** The header's lead on another session's deck before its state is read: its row's state and title. */
export function PendingHead(row) {
  const state = row && !row.isQuiet ? row.state : 'idle';
  return [
    h('span', { key: 'state', class: `state is-${state}`, role: 'status' }, Dot(STATE_HUE[state], false), row ? row.stateText || sayOf(row) : 'Reading'),
    h('span', { key: 'goal', class: 'goal goal-none' }, h('span', { class: 'goal-text' }, row ? row.title : 'Another session')),
  ];
}

/** Another session's deck before its state is read: why nothing shows yet. */
export function PeerWait() {
  return h('div', { key: 'viewwait', class: 'page' },
    h('div', { class: 'card' }, Empty('layers', VIEW.error ? 'Nothing to show yet' : 'Reading its deck…', VIEW.error || 'Its deck writes its state while another deck shows it; it shows here within seconds.')));
}

/** #/sessions, All sessions: "This machine" and what needs you counted, then every session a row, here's first, the one you came from lit; a press shows its deck on the tab you came from; the keys at the foot. */
export function SessionsPage() {
  const list = sessionsNow();
  const m = list && machineLine(list);
  const lit = cameFrom();
  return h('div', { key: 'sessions', class: 'page page-sessions' },
    h('div', { key: 'top', class: 'sess-top' },
      h('h1', { class: 'sess-title' }, 'All sessions'),
      list && h('span', { class: 'sess-sum' }, 'This machine · ', m.need && h('b', { key: 'need', class: 'sess-need' }, m.need), m.need && ' · ', m.rest)),
    !list
      ? h('div', { key: 'none', class: 'card' }, Empty('layers', 'No sessions listed', HOME && !HOME.empty ? 'This deck lists the sessions on this machine once it has read them.' : 'Waiting for this session\'s deck.'))
      : h('div', { key: 'list', class: 'card list sess-list' }, list.rows.map(r => SessionRow(r, r.id === lit))),
    list && h('p', { key: 'note', class: 'sess-note' }, list.rows.length > 1
      ? 'Every Claude Code session here that runs Apiarius, Desktop and terminal alike. A press shows its deck: its Dashboard, Chat and Changes. What you do there goes through its own deck; only a permission prompt is answered in its window. '
      : 'No other session here runs Apiarius now. Each one that does shows here, Desktop and terminal alike. ',
    h('kbd', { key: 'up' }, '↑'), h('kbd', { key: 'down' }, '↓'), ' pick one, ', h('kbd', { key: 'enter' }, 'Enter'), ' shows its deck, ', h('kbd', { key: 's' }, 's'), ' goes back.'));
}

/** One session: its dot (hollow while quiet); its title, "here" and its needs' amber badge; its surface's icon, where it runs and what it waits on you for (amber), is doing, or when it was last heard; its agents' faces while they work (none for the Orchestrator) over its agents' count; its word, spend and age, a fork's "incl. its parent's" under its word and spend. The one you came from lit. */
function SessionRow(r, on) {
  const href = rowHref(r);
  const say = sayOf(r);
  const kids = [
    r.isQuiet ? h('span', { key: 'dot', class: 'dot dot-quiet', 'aria-hidden': 'true' }) : Dot(STATE_HUE[r.state], r.state === 'working'),
    h('span', { class: 'sess-main' },
      h('span', { class: 'sess-line' },
        h('span', { class: 'sess-name' }, r.title),
        r.isMe && h('span', { class: 'tag sess-here', title: 'The session this page belongs to' }, 'here'),
        r.needs > 0 && h('span', { class: 'tab-n is-need', title: plural(r.needs, 'thing needs you', 'things need you') }, String(r.needs))),
      h('span', { class: 'sess-sub' },
        r.surface && icon(r.surface === 'terminal' ? 'squareTerminal' : 'laptop', 'sess-ic'),
        h('span', { class: 'sess-where' }, r.where),
        say && h('span', { class: `sess-say${r.need ? ' is-need' : ''}${r.isQuiet ? ' is-quiet' : ''}` }, `· ${say}`))),
    h('span', { class: 'sess-face' }, Faces16(r), r.agents > 0 && !r.isQuiet && h('span', { class: 'sess-agents' }, plural(r.agents, 'agent'))),
    h('span', { class: `sess-state is-${r.state}` }, r.stateText),
    h('span', { class: 'sess-cost' }, r.cost),
    h('span', { class: 'sess-age' }, ageOf(r.at)),
    r.costNote && h('span', { class: 'sess-cost-note' }, r.costNote),
  ];
  const cls = `sess-row${on ? ' on' : ''}${r.isMe ? ' is-me' : ''}${r.costNote ? ' is-fork' : ''}${r.isQuiet ? ' is-quiet' : ''}`;
  return href
    ? h('a', { key: r.id, id: `sess-${r.id}`, class: cls, href, 'data-nav': '', title: r.cwd, 'aria-current': on ? 'true' : null }, kids)
    : h('div', { key: r.id, id: `sess-${r.id}`, class: cls, title: r.cwd }, kids);
}
