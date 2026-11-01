/* Apiarius's web page: Chat (#/chat, tab 2), the session as a group chat, and its composer. */
import { h, icon, isLive, isRunning, oneLine, stateOf, statusOf } from './basics.mjs';
import {
  access, ACK_WAIT, ageOf, command, deafWhy, fullTextOf, fullTexts, isFinished, isOpen, IX, newCmdId, openAgent, S, sendState,
  StatusNote, toggle, ui, whereNote
} from './state.mjs';
import { Avatar, Dot, Markdown, nameOf, stop, whoAvatar } from './parts.mjs';
import { FinishedRow } from './now.mjs';
import { goToNeed, invalidate, renderNow } from './app.js';

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

/** Where a message stands: yours at the right, others' at the left, Claude Code's own (and a slash command you ran alone, what you stopped, and a compaction) in the middle, a hand-off a line of its own. */
const sideOf = m => (m.kind === 'command' || m.kind === 'stop' || m.kind === 'compaction' || m.from === 'engine' ? 'notice' : m.kind === 'spawn' ? 'handoff' : m.from === 'you' ? 'mine' : 'theirs');

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

export const timeTitle = at => (at ? new Date(at).toLocaleString() : '');

/**
 * A group: Claude Code's notice alone in the middle; one sender's hand-offs
 * a line each, one under the other; yours at the right, "You" over them;
 * others' at the left, the sender's avatar beside its name and the messages
 * under the name. A message to another recipient than the one before it says
 * so over it.
 */
function ChatGroup(list) {
  const e = list[0], m = e.m;
  if (e.side === 'notice') return Notice(e);
  if (e.side === 'handoff') return h('div', { key: `g:${e.key}`, class: 'cgroup handoffs' }, list.map(Handoff));
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
      : h('p', { class: 'b-held' }, deafWhy() || whereNote('Answer it', 'Answer it in Claude Code.')))),
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
 * A hand-off (a spawn row: the task an agent was started with), one line:
 * "▸ Orchestrator → scout: Find the off-by-one in …" and when, its words
 * cut to the line, each name opening its drawer; a press on the chevron or
 * the words opens them under it, in a bubble as any message's (folded when
 * long), and folds them again.
 */
function Handoff(e) {
  const m = e.m;
  const key = `handoff|${m.id}`, open = isOpen(key, false);
  const flip = () => { ui.holdChat = true; toggle(key); };
  return h('div', { key: e.key, class: `handoff${open ? ' open' : ''}`, 'data-nav': 'chat', tabindex: '-1', enter: true, title: timeTitle(m.at) },
    h('div', { class: 'handoff-line' },
      h('button', { type: 'button', class: 'handoff-fold', 'aria-expanded': open ? 'true' : 'false', 'aria-label': open ? 'Hide the task' : 'The task it was given', onClick: flip }, icon('chevronRight', 'chev')),
      h('span', { class: 'handoff-who' }, h('span', { class: 'handoff-from' }, Party(m.from, 0)), h('span', { class: 'handoff-arrow' }, '→'), Party(m.to, 14)),
      open ? h('span', { class: 'handoff-gist' }) : h('button', { type: 'button', class: 'handoff-gist', onClick: flip }, oneLine(m.text)),
      h('span', { class: 'handoff-time' }, ageOf(m.at))),
    open && h('div', { class: 'handoff-words' }, Bubble(e, false)));
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

export function ChatPage() {
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
export const composerId = scope => (scope === 'chat' ? 'composer-chat' : `composer-${(IX.byId.get(scope.slice(6)) || { fileId: 'x' }).fileId}`);

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
  // another session's whose deck takes nothing from here: why, before anything is sent
  if (deafWhy()) return { text: deafWhy(), hint: true };
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

export function setDraft(scope, value, focus = true) {
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

export function Composer(scope) {
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
      // the Browser pane's page, which Claude's tools can drive: what you send waits for your Send above the prompt in Claude Code
      access.grade === 'pane'
        ? h('span', { class: 'composer-keys', title: 'What you send from here waits above your prompt in Claude Code until you press Send there.' }, 'Enter sends · then press Send above your prompt in Claude Code')
        : h('span', { class: 'composer-keys' }, 'Enter sends · Shift+Enter adds a line')));
}
