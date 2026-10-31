/* Apiarius's web page: the Dashboard (#/now, tab 1). */
import {
  firstLine, h, icon, isLive, isRunning, num, oneLine, PATHY, plural, shortPath, since, stateOf, statusOf, usd
} from './basics.mjs';
import {
  ACK_WAIT, ageOf, agoText, command, deafWhy, hrefOf, isAgentOpen, isFinished, isOpen, isWide, IX, lead, liveNow,
  navigate, newCmdId, openAgent, route, S, scrollSoon, setShut, toast, toggle, ui
} from './state.mjs';
import {
  askerOf, AvatarDot, AvatarStack, DiffStat, Dot, Empty, Glyph, inline, NameLink, nameOf, needGist, NeedsList, Outcome,
  OutsideRows, PathText, resolvedCalls, Section, stop, whoAvatar
} from './parts.mjs';
import { KIND_WORD, modelLine, PlanSection, ROW_WORD } from './org.mjs';
import { goToNeed, invalidate, renderNow, Welcome } from './app.js';

// ================================================================== dashboard
// The Dashboard (#/now): what needs you (only while something does), a run card per
// agent, the session's figures, the plan (only if Claude made one), the
// newest tool calls and the files the agents touched. Each section folds by
// its head; on a wide page the last two sit side by side.

export function NowPage() {
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
export function FinishedRow(scope, n, open) {
  const cleared = S.cleared ? S.cleared.count : 0;
  if (!n && !cleared) return null;
  // another session's whose deck takes nothing from here: why, in Clear finished's place
  const deaf = deafWhy();
  const clearing = isPressing('clear'), showing = isPressing('show');
  return h('div', { key: `fin:${scope}`, class: `finished finished-${scope}` },
    n > 0 && h('button', { key: 'fold', type: 'button', class: 'fin-fold', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggle(`finished|${scope}`) }, `${n} finished ${open ? '▾' : '▸'}`),
    deaf && h('span', { key: 'deaf', class: 'peer-note fin-deaf' }, deaf),
    !deaf && n > 0 && h('button', { key: 'clear', type: 'button', class: 'btn btn-xs fin-clear', disabled: clearing, title: 'Hide the finished agents from this deck: Claude Code keeps them', onClick: () => clearFinished() }, clearing ? 'Clearing…' : 'Clear finished'),
    !deaf && cleared > 0 && h('button', { key: 'show', type: 'button', class: 'btn btn-xs fin-show', disabled: showing, onClick: () => showCleared() }, showing ? 'Showing them…' : `Show ${cleared} cleared`),
    PressNote('clear'), PressNote('show'));
}

/** Clear finished: the mod (another session's: its own deck) hides every finished agent from the deck, here and in the pane, and the next state says so; its ack shows beside it. Nothing in Claude Code changes. */
function clearFinished() {
  return sendPress('clear', { cmd: 'clearFinished' }, 'cl');
}

/** Show N cleared: the agents Clear finished hid come back. */
function showCleared() {
  return sendPress('show', { cmd: 'showCleared' }, 'cl');
}

const PILL = { starting: 'starting', running: 'running', waiting: 'waiting', done: 'done', failed: 'failed', stopped: 'stopped', idle: 'idle' };

export function Pill(st) {
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
export function Words(text, cls) {
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
export const runStartOf = a => Math.max(a.startedAt || 0, a.resumedAt || 0);

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
// only where the state says that check allows it (`stop.can`). On another
// session's deck the same, by its own deck's state: the press goes to that
// deck, which runs it as its own window would. Each press (Clear finished
// and a pick of Changes too) says what came of it at its control: its
// doing until the ack, then the ack's words a while, and a toast.

/** How long a press's control says what came of it, once its ack came. */
const PRESS_SHOW = 10000;

/** Sends a press's command (`body`; its `id` made here, of `kind`) for the control keyed `key`; its ack, once the state holds it, shows at that control and as a toast. */
export async function sendPress(key, body, kind = 'st') {
  const id = newCmdId(kind);
  const sent = { key, at: Date.now(), ack: null };
  ui.presses.set(id, sent);
  renderNow();
  try {
    await command({ ...body, id });
    setTimeout(() => { notePresses(); invalidate(); }, ACK_WAIT + 50);
  } catch (err) {
    sent.ack = { ok: false, text: err.message, at: Date.now() };
    toast(err.message);
    setTimeout(invalidate, PRESS_SHOW + 50);
  }
  renderNow();
}

/** What the newest press of the control keyed `key` says now: `busy` while it waits on its ack, else its ack a while after it came; null for none. */
function pressOf(key) {
  let last = null;
  for (const s of ui.presses.values()) if (s.key === key && (!last || s.at >= last.at)) last = s;
  if (!last) return null;
  if (!last.ack) return Date.now() - last.at < ACK_WAIT ? { busy: true, ack: null } : null;
  return Date.now() - last.ack.at < PRESS_SHOW ? { busy: false, ack: last.ack } : null;
}
export const isPressing = key => !!(pressOf(key) || {}).busy;

/** What came of a press, beside its control: ✓ and its ack's words, or ✕ and why; null while it waits, and for none. */
export function PressNote(key) {
  const p = pressOf(key);
  if (!p || !p.ack) return null;
  return h('span', { key: `press:${key}`, class: `press-note ${p.ack.ok ? 'is-done' : 'is-failed'}`, role: 'status', title: p.ack.text }, p.ack.ok ? '✓ ' : '✕ ', p.ack.text);
}

/** The presses sent from here whose ack the state now holds: each kept for its control and said once, as a toast; one that heard nothing within ACK_WAIT says so; those long past go. */
export function notePresses() {
  for (const [id, s] of ui.presses) {
    if (s.ack) {
      if (Date.now() - s.ack.at > PRESS_SHOW) ui.presses.delete(id);
      continue;
    }
    const k = IX && IX.acks.get(id);
    if (k) {
      s.ack = { ok: k.ok, text: k.text || (k.ok ? 'Done' : 'Not done'), at: Date.now() };
      toast(k.ok ? k.text : lead(s.key === 'clear' || s.key === 'show' || s.key === 'repo' ? 'Not done' : 'Not stopped', k.text));
      setTimeout(invalidate, PRESS_SHOW + 50);
    } else if (Date.now() - s.at > ACK_WAIT) {
      s.ack = { ok: false, text: route.session ? 'Its deck did not answer: it may be busy or gone' : 'The deck did not answer', at: Date.now() };
      setTimeout(invalidate, PRESS_SHOW + 50);
    }
  }
}

/** Stop turn, at the right of the header while the main loop's turn runs: `$.turn.abort` of it, as Esc in Claude Code does; what came of a press before it. */
export function StopTurn() {
  const busy = isPressing('turn');
  return [
    PressNote('turn'),
    h('button', {
      key: 'stopturn', type: 'button', class: 'stop-btn stop-turn', disabled: busy,
      title: 'End the Orchestrator\'s turn, and the foreground agents with it, as Esc in Claude Code does',
      onClick: () => sendPress('turn', { cmd: 'abortTurn', turnId: S.header.turn.id }),
    }, icon('square', 'stop-ic'), busy ? 'Stopping…' : 'Stop turn'),
  ];
}

/** Stop on a background agent or a teammate: Claude Code's own TaskStop of it. */
export function StopAgent(a, cls) {
  const busy = isPressing(`agent:${a.id}`);
  return h('button', {
    key: 'stop', type: 'button', class: cls, disabled: busy, title: `Stop ${a.title}: Claude Code's own TaskStop`,
    onClick: e => { stop(e); sendPress(`agent:${a.id}`, { cmd: 'stopAgent', agentId: a.id }); },
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
  const busy = isPressing(key);
  const next = x.nextAt != null ? `Next run ${new Date(x.nextAt).toLocaleString()}` : '';
  return h('div', { key: x.id, id: `bg-${x.id}`, class: `bg-row${scheduled ? ' is-scheduled' : ''}` },
    icon(BG_ICON[x.kind] || 'circle', 'bg-ic'),
    h('span', { class: 'bg-main' },
      h('span', { class: 'bg-top' },
        // a shell goes by its own description, its command after its kind; with none, by its command, in code's face
        h('span', { class: `bg-title${x.kind === 'shell' && !x.what.includes(' · ') ? ' mono' : ''}`, title: x.title }, x.title),
        x.what && h('span', { class: 'bg-what', title: [x.what, x.schedule].filter(Boolean).join(' · ') }, x.what)),
      x.by && h('span', { class: 'bg-by' }, 'started by ', NameLink(x.by, 14)),
      PressNote(key)),
    BgStatus(x),
    h('span', { class: 'bg-when', title: next }, bgWhen(x)),
    h('span', { class: 'bg-act' },
      x.stop && x.stop.can && h('button', {
        type: 'button', class: 'btn btn-xs bg-stop', disabled: busy, title: `${x.stop.label}: Claude Code's own ${x.stop.tool}`,
        onClick: () => sendPress(key, { cmd: 'stopBackground', bgId: x.id }),
      }, busy ? '…' : x.stop.label)));
}

function BackgroundSection() {
  const bg = S.background;
  if (!bg || !bg.rows.length) return null;
  // another session's whose deck takes nothing from here: its Stop and Cancel are offered nowhere, so the list says why, once
  const deaf = deafWhy() && bg.rows.some(x => x.stop);
  return Section('background', 'Background', bg.rows.length, bg.text ? h('span', { class: 'sec-note' }, bg.text) : null, () => [
    h('div', { key: 'list', class: 'card list bg-list' }, bg.rows.map(BgRow)),
    deaf && h('p', { key: 'deaf', class: 'peer-note bg-where' }, deafWhy()),
  ]);
}

// ----------------------------------------------------------------- figures
// The session's numbers, as the state counts them (v2's `figures`): the
// agents in each state, the plan's items done (only with a plan), the spend,
// and what waits on you.

/** What a need is, in one line: "Orchestrator asks: Which store…?", "Agent builder needs permission: npm test". */
function needLine(n) {
  const { who, mark } = askerOf(n);
  const from = mark ? `${mark} ${who}` : who;
  if (n.kind === 'question') return `${from} asks: ${needGist(n)}`;
  if (n.kind === 'permission') return `${from} needs permission: ${needGist(n)}`;
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
    Figure('dollar', usd(f.costUsd), 'Spend at API prices', spend.join(' · ') || '—'),
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
