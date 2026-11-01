/* Apiarius's web page: Org (#/org, tab 3), the org chart, the list and the Timeline. */
import * as TL from './timeline.mjs';
import {
  clamp, dur, firstLine, h, icon, isLive, isRunning, num, oneLine, PATHY, plural, stateOf, statusOf, store, total
} from './basics.mjs';
import {
  ageOf, agoText, arr, AUTH, hrefOf, isAgentOpen, isOpen, IX, liveNow, navigate, numOr, obj, openAgent, S, str,
  toggle, ui
} from './state.mjs';
import {
  Avatar, AvatarDot, AvatarStack, Empty, Folded, Glyph, inline, Markdown, NameLink, nameOf, Section, unlinked,
  whoAvatar
} from './parts.mjs';
import { Pill, runStartOf, Words } from './now.mjs';
import { invalidate, renderNow, scroller } from './app.js';

// ======================================================================== org
// Every agent under the one that started it: the org chart (pan, zoom, fit)
// or, toggled, the list, the state's tree with its folds.

export function OrgPage() {
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
// Org's Timeline (web/timeline.mjs lays it out), from /timeline
// (timeline.json, which the mod writes before the state that follows it),
// laid out by timeline.mjs as the Desktop pane and the terminal lay theirs. A
// row an agent: its face, its name, its status, and what it is doing now or
// did last, all one link to its drawer; its lane beside it, every lane on one
// axis that folds each stretch of 20 minutes or more where nobody worked.
// Its calls are segments named where the name fits ("Read ×10"), a failed
// one red; its waits on you amber; thinking a thin line; its end a cap. The
// shells a loop started sit under its row. Messages are numbered arrow marks
// between the lanes, their words listed under the chart. A hover on a
// segment, a wait, a mark or a cap says what it is; a press on a lane opens
// its agent's drawer.

export const tl = { data: null, status: 'loading', error: '', loadedFor: -1, loading: false, tries: 0, width: 0, box: null };
const TL_KINDS = new Set(['work', 'wait', 'idle']);
const OUTCOME_WORD = { done: 'Done', failed: 'Failed', stopped: 'Stopped' };

/** The timeline as the page reads it, each part in its own shape: its times stay ms after `startedAt`. */
function timelineFrom(d) {
  d = obj(d) || {};
  const tools = arr(d.tools).map(str);
  const lanes = arr(d.lanes).filter(l => l && typeof l.id === 'string').map(l => ({
    id: l.id, title: str(l.title) || l.id, parent: typeof l.parent === 'string' ? l.parent : null, depth: numOr(l.depth, 0),
    kind: str(l.kind), status: str(l.status), isStopped: l.isStopped === true, start: numOr(l.start, 0), end: numOr(l.end),
    outcome: OUTCOME_WORD[l.outcome] ? l.outcome : null,
    spans: arr(l.spans).filter(s => s && TL_KINDS.has(s.kind)).map(s => ({ kind: s.kind, from: numOr(s.from, 0), to: numOr(s.to) })),
    ticks: arr(l.ticks).filter(t => Array.isArray(t) && t.length >= 4).map(t => ({ at: numOr(t[0], 0), ms: numOr(t[1], -1), tool: tools[t[2]] || '', how: numOr(t[3], -1), text: str(t[4]) })),
  }));
  return {
    now: numOr(d.now, 0), startedAt: numOr(d.startedAt, 0), lanes,
    marks: arr(d.marks).filter(m => m && typeof m.at === 'number').map(m => ({ at: m.at, id: str(m.id), text: str(m.text) })),
    messages: arr(d.messages).filter(m => m && typeof m.at === 'number' && typeof m.from === 'string' && typeof m.to === 'string').map(m => ({ at: m.at, from: m.from, to: m.to, id: str(m.id), title: str(m.title) })),
    background: arr(d.background).filter(b => b && typeof b.start === 'number').map(b => ({ id: str(b.id), title: str(b.title), what: str(b.what), by: typeof b.by === 'string' ? b.by : null, start: b.start, end: numOr(b.end) })),
  };
}

/** The timeline for the state shown: read again once per state (the mod wrote it before that state), the last one read kept while the next loads. */
function timelineNow() {
  const want = S.now;
  if (tl.loading || tl.loadedFor === want) return tl;
  tl.loading = true;
  fetch('/timeline', { headers: AUTH, cache: 'no-store' })
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
/** "3h 51m", "40m"; "<1m" under a minute (timeline.mjs `lengthOf`). */
const tlLength = ms => (ms < 60000 ? '<1m' : TL.lengthOf(ms));
/** "3h 51m · 4 agents · 2 in the background · 4 messages". */
function timelineSummary(d, messages = d.messages.length) {
  const parts = [tlLength(tlSpanOf(d)), plural(d.lanes.length, 'agent')];
  if (d.background.length) parts.push(`${d.background.length} in the background`);
  if (messages) parts.push(plural(messages, 'message'));
  return parts.join(' · ');
}
/** "2h 50m idle, folded"; '' with no fold. */
const foldSummary = folds => (folds.length ? `${TL.lengthOf(folds.reduce((t, f) => t + (f.to - f.from), 0))} idle, folded` : '');
/** A time of day, to the second. */
const clockText = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** How wide words are at `size` px in the page's face, near enough to fit a segment's name. */
const tlWidth = (s, size) => Array.from(String(s)).length * size * 0.58;

/** The lanes the page draws: the timeline's, less any Clear finished hid since it was written. */
const tlLanesOf = d => d.lanes.filter(l => l.id === 'main' || !IX.byId.has(l.id) || !IX.byId.get(l.id).isCleared);

/**
 * What a row's second line says, what its agent is doing now or did last
 * (hooks/ui/v2/timeline.tsx `nowLineOf`): waiting on you; how its run ended
 * and what it handed back; its call in flight ("Bash npm test · running
 * 2m"); its words since; else its newest call; else what it handed back.
 */
function tlNowLine(a, l, d) {
  const live = a && a.live ? oneLine(`${a.live.tool} ${a.live.text}`) : '';
  if (l.status === 'waiting') return live ? `Waiting on you: ${live}` : 'Waiting on you';
  const ended = l.isStopped ? 'Stopped' : OUTCOME_WORD[l.status] || '';
  if (ended) {
    const when = agoText(l.end != null ? d.startedAt + l.end : a && a.endedAt);
    return a && a.result ? `${ended} ${when}: “${firstLine(a.result)}”` : `${ended} ${when}`;
  }
  if (a && a.live) { const age = ageOf(a.live.at); return `${live} · ${age === 'now' ? 'now' : `running ${age}`}`; }
  if (a && a.said) return `“${oneLine(a.said.text)}”`;
  const last = l.ticks[l.ticks.length - 1];
  if (last) return `${[last.tool, last.text].filter(Boolean).join(' ')} · ${agoText(d.startedAt + last.at)}`;
  return a && a.result ? `“${firstLine(a.result)}”` : '';
}

/** The room a lane's drawing leaves its axis, px: before it, and after it (an end's cap, the now line); a lane's (on a narrow card, under its words), a shell's and the axis's heights. */
const TL_PAD = { left: 6, right: 14 };
const TL_H = { lane: 48, narrow: 32, bg: 26, axis: 22 };
const tlN = v => Math.round(v * 10) / 10;
/** Whether a lane (or a shell) lived across a fold: it began before it and had not ended when it ended. */
const tlLived = (start, end, f) => start <= f.from && (end == null || end >= f.to);

/** A row's ground: the gridlines, each fold's break, hatched where the row lived across it. */
function tlGround(axis, grid, H, lived) {
  const out = [];
  if (grid.length) out.push(h('path', { key: 'grid', class: 'tl-gridline', d: grid.map(x => `M${tlN(x)} 0V${H}`).join('') }));
  axis.folds.forEach((f, i) => {
    out.push(h('rect', { key: `f${i}`, class: 'tl-fold', x: tlN(f.x0 + 1), y: 0, width: tlN(Math.max(1, f.x1 - f.x0 - 2)), height: H }, h('title', null, `Nobody worked for ${TL.lengthOf(f.to - f.from)}: folded`)));
    const cx = (f.x0 + f.x1) / 2;
    if (lived(f)) out.push(h('path', { key: `fh${i}`, class: 'tl-hatch', d: `M${tlN(cx - 5)} ${H / 2 + 6}l4 -12M${tlN(cx + 1)} ${H / 2 + 6}l4 -12` }));
  });
  return out;
}

/** The messages' marks on a row: out of the sender's lane toward the receiver's row (its number beside it), into the receiver's, a dashed line through the rows between; a hover says the message. */
function tlMarks(d, axis, crossings, messages, H) {
  const mid = H / 2;
  return crossings.map((c, i) => {
    const m = messages[c.n - 1];
    const tip = h('title', null, `${c.n}. ${nameOf(m.from)} → ${nameOf(m.to)}: ${m.title} · ${clockText(d.startedAt + m.at)}`);
    const x = tlN(axis.x(c.at));
    if (c.role === 'pass') return h('path', { key: `m${i}`, class: 'tl-pass', d: `M${x} 0V${H}` });
    const edge = (c.role === 'from') === c.down ? H : 0;
    const bar = (c.role === 'from') === c.down ? mid + 8 : mid - 8;
    const [y1, y2] = c.role === 'from' ? [bar, edge] : [edge, bar];
    const dir = y2 > y1 ? 1 : -1;
    return h('g', { key: `m${i}`, class: 'tl-msg' },
      tip,
      h('path', { class: 'tl-msg-line', d: `M${x} ${tlN(y1)}V${tlN(y2 - dir * 3)}` }),
      h('path', { class: 'tl-msg-head', d: `M${x} ${tlN(y2)}l-3.4 ${tlN(-dir * 5)}h6.8z` }),
      c.role === 'from' && h('text', { class: 'tl-msg-n', x: tlN(axis.x(c.at) + 5), y: tlN(c.down ? H - 3 : 10) }, String(c.n)));
  });
}

/** A lane: its ground, idle dotted, thinking a thin bar, its calls as segments (named where the name fits), its waits on you, your prompts, its end's cap, the messages' marks, now; a hover on each says what it is. */
function TimelineLane(d, l, axis, grid, crossings, messages, w, H) {
  const mid = H / 2, abs = ms => d.startedAt + ms;
  const to = at => axis.x(at == null ? axis.span : at);
  const when = (from, end) => `${clockText(abs(from))} – ${end == null ? 'now' : clockText(abs(end))} · ${dur(Math.max(0, (end == null ? axis.span : end) - from))}`;
  const bar = (a, b, half) => `M${tlN(a)} ${tlN(mid - half)}h${tlN(Math.max(2, b - a))}v${half * 2}h${tlN(-Math.max(2, b - a))}z`;
  const out = tlGround(axis, grid, H, f => tlLived(l.start, l.end, f));
  const idle = l.spans.filter(s => s.kind === 'idle');
  if (idle.length) out.push(h('path', { key: 'idle', class: 'tl-idle', d: idle.map(s => `M${tlN(axis.x(s.from) + 2)} ${mid}H${tlN(Math.max(axis.x(s.from) + 2, to(s.to) - 2))}`).join('') }));
  const work = l.spans.filter(s => s.kind === 'work');
  if (work.length) out.push(h('path', { key: 'think', class: 'tl-think', d: work.map(s => bar(axis.x(s.from), to(s.to), 3)).join('') }));
  const live = l.spans.some(s => s.kind === 'work' && s.to == null);
  TL.segmentsOf(l.ticks, axis, { liveTo: live ? axis.span : null, min: 3, join: 2 }).forEach((s, i) => {
    // a failed call is a thin red mark where it is short: a few among many never paint a lane red
    const width = s.failed ? Math.max(2, axis.x(s.to) - s.x0) : s.x1 - s.x0 > 4 ? s.x1 - s.x0 - 1 : s.x1 - s.x0;
    const one = s.count === 1 ? l.ticks.find(t => t.at === s.from && t.tool === s.tool) : null;
    const what = one && one.text ? `${s.tool} ${one.text}` : TL.toolsText(s);
    const tip = `${what}${s.failed ? ' · failed' : ''} · ${s.running ? `${clockText(abs(s.from))} – now · running` : s.to > s.from ? when(s.from, s.to) : clockText(abs(s.from))}`;
    out.push(h('rect', { key: `c${i}`, class: `tl-seg${s.failed ? ' tl-seg-fail' : ''}`, x: tlN(s.x0), y: mid - 7, width: tlN(width), height: 14, rx: 2 }, h('title', null, tip)));
    const label = TL.segmentLabel(s, width, t => tlWidth(t, 10.5), true, 8);
    if (label) out.push(h('text', { key: `cw${i}`, class: 'tl-seg-word', x: tlN(s.x0 + width / 2), y: tlN(mid + 3.8), 'text-anchor': 'middle' }, label));
  });
  l.spans.forEach((s, i) => {
    if (s.kind !== 'wait') return;
    const a = axis.x(s.from), b = to(s.to);
    out.push(h('rect', { key: `w${i}`, class: 'tl-wait', x: tlN(a), y: mid - 7, width: tlN(Math.max(2, b - a)), height: 14, rx: 2 }, h('title', null, `Waiting on you · ${when(s.from, s.to)}`)));
  });
  if (l.id === 'main') d.marks.forEach((m, i) => out.push(h('path', { key: `y${i}`, class: 'tl-you', d: `M${tlN(axis.x(m.at))} ${mid - 13}l4.5 4.5-4.5 4.5-4.5-4.5z` }, h('title', null, `You: ${m.text} · ${clockText(abs(m.at))}`))));
  if (l.end != null && l.outcome) {
    const x = tlN(Math.min(axis.room + TL_PAD.right - 8, axis.x(l.end) + 2));
    const tip = h('title', null, `${OUTCOME_WORD[l.outcome]}: ${l.title} · ${clockText(abs(l.end))}`);
    if (l.outcome === 'done') out.push(h('g', { key: 'cap', class: 'tl-cap tl-cap-done' }, tip, h('circle', { cx: x, cy: mid, r: 7 }), h('path', { d: `M${tlN(x - 3.2)} ${mid}l2.4 2.4 4.3-4.8` })));
    else if (l.outcome === 'failed') out.push(h('g', { key: 'cap', class: 'tl-cap tl-cap-failed' }, tip, h('circle', { cx: x, cy: mid, r: 7 }), h('path', { d: `M${tlN(x - 2.8)} ${mid - 2.8}l5.6 5.6m0 -5.6l-5.6 5.6` })));
    else out.push(h('rect', { key: 'cap', class: 'tl-cap tl-cap-stopped', x: tlN(x - 5), y: mid - 5, width: 10, height: 10, rx: 1.5 }, tip));
  }
  out.push(...tlMarks(d, axis, crossings, messages, H));
  out.push(h('path', { key: 'now', class: 'tl-nowline', d: `M${tlN(axis.room)} 0V${H}` }));
  return h('svg', { key: `s:${l.id}`, class: `tl-lane${isAgentOpen(l.id) ? ' on' : ''}`, width: w, height: H, viewBox: `0 0 ${w} ${H}`, onClick: () => openAgent(l.id) }, h('g', { transform: `translate(${TL_PAD.left} 0)` }, out));
}

/** A shell (or another background task): a grey bar from its call to its end (a cap there) or to now; a hover says what it is. */
function TimelineShell(d, b, axis, grid, crossings, messages, w) {
  const H = TL_H.bg, mid = H / 2;
  const out = tlGround(axis, grid, H, f => tlLived(b.start, b.end, f));
  const a = axis.x(b.start), e = axis.x(b.end == null ? axis.span : b.end);
  const tip = `${b.what ? `${b.what}: ` : ''}${b.title} · ${clockText(d.startedAt + b.start)} – ${b.end == null ? 'now' : clockText(d.startedAt + b.end)} · ${dur(Math.max(0, (b.end == null ? axis.span : b.end) - b.start))}`;
  out.push(h('rect', { key: 'bar', class: 'tl-bg', x: tlN(a), y: mid - 3, width: tlN(Math.max(3, e - a)), height: 6, rx: 3 }, h('title', null, tip)));
  if (b.end != null) out.push(h('rect', { key: 'end', class: 'tl-bg-end', x: tlN(Math.max(a, e - 3)), y: mid - 4, width: 6, height: 8, rx: 1.5 }, h('title', null, tip)));
  out.push(...tlMarks(d, axis, crossings, messages, H));
  out.push(h('path', { key: 'now', class: 'tl-nowline', d: `M${tlN(axis.room)} 0V${H}` }));
  return h('svg', { key: `s:bg:${b.id}`, class: 'tl-lane tl-lane-bg', width: w, height: H, viewBox: `0 0 ${w} ${H}` }, h('g', { transform: `translate(${TL_PAD.left} 0)` }, out));
}

function TimelineView() {
  const t = timelineNow();
  if (!t.data) {
    return h('div', { key: 'tl', class: 'card tl tl-loading', ref: el => { tl.box = el; } },
      t.status === 'error' ? Empty('gantt', 'No timeline', t.error) : h('p', { class: 'muted small' }, 'Reading the timeline…'));
  }
  const d = t.data;
  const lanes = tlLanesOf(d);
  const shown = new Set(lanes.map(l => l.id));
  const rows = TL.rowsOf(lanes, d.background.filter(b => b.end == null || shown.has(b.by)));
  const ids = rows.map(r => (r.kind === 'lane' ? r.lane.id : `bg:${r.bg.id}`));
  const crossings = TL.crossingsOf(ids, d.messages);
  const messages = TL.numberedOf(ids, d.messages);
  const span = tlSpanOf(d);
  const folds = TL.foldsOf(d.lanes, span);
  // a row's words beside its lane; on a narrow card above it
  const W = Math.max(320, Math.round(tl.width || 1000));
  const narrow = W < 640;
  const left = narrow ? W : clamp(Math.round(W * 0.34), 220, 400);
  const w = narrow ? W : W - left - 20;
  const axis = TL.axisOf(span, folds, w - TL_PAD.left - TL_PAD.right, narrow ? 44 : 72);
  const words = TL.axisWordsOf(axis, d.startedAt, s => tlWidth(s, 11.5), 10);
  const grid = words.filter(x => x.kind === 'tick').map(x => x.x);
  const cells = [];
  rows.forEach((r, i) => {
    if (r.kind === 'bg') {
      const b = r.bg;
      cells.push(h('div', { key: `l:bg:${b.id}`, class: 'tl-left tl-left-bg' },
        h('span', { class: 'tl-corner' }, '└'), h('span', { class: 'tl-bg-name', title: b.title }, b.title),
        b.what && h('span', { class: 'tl-bg-what', title: b.what }, b.what.replace(/^[^·]+·\s*/, ''))));
      cells.push(TimelineShell(d, b, axis, grid, crossings[i], messages, w));
      return;
    }
    const l = r.lane, a = IX.byId.get(l.id), st = l.isStopped ? 'stopped' : l.status;
    const line = tlNowLine(a, l, d);
    // the row's words are one link to its agent's drawer: its face, its name, its status and its line, as its lane beside it opens it
    cells.push(h('a', { key: `l:${l.id}`, class: `tl-left${isAgentOpen(l.id) ? ' on' : ''}`, style: { '--d': String(Math.min(3, Math.max(0, l.depth - 1))) }, href: hrefOf('org', { kind: 'agent', id: l.id }), 'data-nav': 'agent', title: line ? `${l.title}: ${line}` : l.title, 'aria-label': `${l.title}, ${statusOf(st).label}: open its drawer` },
      h('span', { class: 'tl-line' },
        AvatarDot(a || { id: l.id, title: l.title, kind: l.kind, status: l.status, isStopped: l.isStopped, todos: [] }, 22),
        h('span', { class: 'tl-name' }, l.title),
        Pill(st)),
      h('span', { class: 'tl-now' }, line ? unlinked(inline(line)) : ' ')));
    cells.push(TimelineLane(d, l, axis, grid, crossings[i], messages, w, narrow ? TL_H.narrow : TL_H.lane));
  });
  const folded = foldSummary(axis.folds);
  return h('div', { key: 'tl-wrap', class: 'tl-wrap' },
    h('div', { key: 'tl', class: `card tl${narrow ? ' narrow' : ''}`, ref: el => { tl.box = el; }, style: { '--tl-left': `${left}px` } },
      h('div', { key: 'grid', class: 'tl-grid' },
        !narrow && h('div', { key: 'corner', class: 'tl-folded' }, folded && `⋯ ${folded}`),
        h('svg', { key: 'axis', class: 'tl-axis', width: w, height: TL_H.axis, viewBox: `0 0 ${w} ${TL_H.axis}`, role: 'img', 'aria-label': `Time from ${TL.clockOf(d.startedAt)} to now${folded ? `, ${folded}` : ''}` },
          h('g', { transform: `translate(${TL_PAD.left} 0)` }, words.map(x => h('text', { key: `${x.kind}${x.x}`, class: `tl-word tl-word-${x.kind}`, x: tlN(x.x), y: TL_H.axis - 6, 'text-anchor': x.align }, x.text)))),
        cells),
      TimelineLegend(d, lanes, rows, messages, axis)),
    messages.length > 0 && Section('tl-messages', 'Messages', messages.length, h('span', { class: 'sec-link' }, 'Each number marks its arrow on the lanes · a press opens it in Chat'), () =>
      h('div', { class: 'card list tl-messages' }, messages.map(m => h('button', {
        key: m.id || `m${m.n}`, type: 'button', class: 'tl-msg-row', title: 'Open in Chat',
        onClick: () => { ui.chatFilter = m.from; ui.pinChat = true; navigate('chat', null); },
      },
      h('span', { class: 'tl-msg-num' }, String(m.n)),
      h('span', { class: 'tl-msg-when' }, TL.clockOf(d.startedAt + m.at)),
      h('span', { class: 'tl-msg-who' }, whoAvatar(m.from, 16), h('b', null, nameOf(m.from)), h('span', { class: 'sep' }, '→'), whoAvatar(m.to, 16), h('b', null, nameOf(m.to))),
      h('span', { class: 'tl-msg-words' }, `“${m.title}”`))))));
}

/** What the chart holds, and only that. */
function TimelineLegend(d, lanes, rows, messages, axis) {
  const has = kind => lanes.some(l => l.spans.some(s => s.kind === kind));
  const sw = (...kids) => h('svg', { class: 'tl-sw', width: 18, height: 14, viewBox: '0 0 18 14', 'aria-hidden': 'true' }, kids);
  const items = [
    lanes.some(l => l.ticks.length) && ['call', 'a tool call (named where it fits)', sw(h('rect', { class: 'tl-seg', x: 1, y: 2, width: 16, height: 10, rx: 2 }))],
    has('work') && ['think', 'thinking', sw(h('rect', { class: 'tl-think', x: 1, y: 4, width: 16, height: 6, rx: 3 }))],
    lanes.some(l => l.outcome === 'failed' || l.ticks.some(k => k.how === 0)) && ['fail', 'failed', sw(h('rect', { class: 'tl-seg tl-seg-fail', x: 1, y: 2, width: 16, height: 10, rx: 2 }))],
    has('wait') && ['wait', 'waiting on you', sw(h('rect', { class: 'tl-wait', x: 1, y: 2, width: 16, height: 10, rx: 2 }))],
    lanes.some(l => l.outcome === 'done') && ['done', 'done', sw(h('g', { class: 'tl-cap tl-cap-done' }, h('circle', { cx: 9, cy: 7, r: 6 }), h('path', { d: 'M6.3 7l2 2 3.6-4' })))],
    lanes.some(l => l.outcome === 'stopped') && ['stopped', 'stopped', sw(h('rect', { class: 'tl-cap tl-cap-stopped', x: 4, y: 2, width: 10, height: 10, rx: 1.5 }))],
    has('idle') && ['idle', 'idle', sw(h('path', { class: 'tl-idle', d: 'M1 7h16' }))],
    messages.length && ['msg', 'a message', sw(h('path', { class: 'tl-msg-line', d: 'M9 0v9' }), h('path', { class: 'tl-msg-head', d: 'M9 13l-3 -4.5h6z' }))],
    d.marks.length && lanes.some(l => l.id === 'main') && ['you', 'you wrote', sw(h('path', { class: 'tl-you', d: 'M9 2.5l4.5 4.5-4.5 4.5-4.5-4.5z' }))],
    rows.some(r => r.kind === 'bg') && ['bg', 'in the background', sw(h('rect', { class: 'tl-bg', x: 1, y: 4, width: 16, height: 6, rx: 3 }))],
    axis.folds.length && ['fold', 'idle, folded', sw(h('rect', { class: 'tl-fold', x: 2, y: 0, width: 14, height: 14 }), h('path', { class: 'tl-hatch', d: 'M5 12l3 -10M10 12l3 -10' }))],
  ].filter(Boolean);
  return h('div', { key: 'legend', class: 'tl-legend' }, items.map(([key, label, swatch]) => h('span', { key, class: 'tl-key' }, swatch, label)));
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
export function elapsedOf(a) {
  if (!a.elapsed || a.endedAt != null || !isLive(a.status)) return a.elapsed;
  const from = a.id === 'main' ? (S.header.turn && S.header.turn.at) : runStartOf(a);
  if (!from) return a.elapsed;
  const ms = Math.max(0, liveNow() - from);
  return ms < 60000 ? '<1m' : dur(ms);
}

export const ROW_WORD = { done: 'Done', failed: 'Failed', stopped: 'Stopped', idle: 'Idle', starting: 'Starting', waiting: 'Waiting on you', running: '' };

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
export const org = { x: 0, y: 0, k: 1, touched: false, fit: 'open', sig: '', view: null, world: null, label: null, size: '' };
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
export function fitOrg(L) {
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

export let lastLayout = null;

export const KIND_WORD = { orchestrator: 'main loop', agent: 'agent', teammate: 'teammate', workflow: 'workflow', engine: 'Claude Code' };
/** "haiku-4.5 · 48k": the model and the tokens spent, these left out until there are some. */
export const modelLine = a => [a.model || '—', a.tokens > 0 ? num(a.tokens) : ''].filter(Boolean).join(' · ');

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

export function PlanSection() {
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

export const doneOf = items => `${items.filter(t => t.status === 'done').length}/${items.length}`;

export function Item(key, status, text, doing, right) {
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
