/**
 * Chat: the one global stream (the v2 state's `chat`, oldest first), every
 * message Claude Code carried, drawn as a group chat.
 *
 * - The members at the top, one bordered list: Everyone, then every agent of
 *   the session (the Orchestrator first, in the tree's order), each with its
 *   avatar, its name and a word for its status. Two or three columns where
 *   the pane is wide; where it is not, folded to one "▸ 8 agents" line that
 *   opens it (the line folds or opens it either way).
 *   - A press on an agent shows your conversation with it (the messages
 *     from it or to it, `DeckView.v2.chatFilter`), marks it, and points the
 *     composer at it.
 *   - Everyone shows the whole chat, the composer to the Orchestrator; beside
 *     the list's line, "Between agents" keeps to what agents said to each
 *     other.
 *   - The finished agents (done, failed, stopped or idle) sit behind one
 *     "3 finished ▸" row at the list's foot, which opens on them, with
 *     "Clear finished" beside it: the agents it hides leave the list, and
 *     their messages Everyone and Between agents ("Show 2 cleared" brings
 *     them back; nothing in Claude Code changes).
 * - Others' messages, on the left: the sender's avatar and name; when the
 *   words went to someone other than you, a dim "to" and the recipient's own
 *   small avatar and name; and when. Each name is a press that opens that
 *   agent's page. Under them the words in a rounded dark bubble, as Markdown
 *   (a SendMessage's summary in bold over them). One sender's messages
 *   within five minutes stack under one avatar and name; one to another
 *   recipient says so over it.
 * - Yours, on the right: a blue bubble at most three quarters of the pane
 *   wide, "to" its recipient over it when that is neither the Orchestrator
 *   nor the agent you are talking with. Under it, dim, what came of it (the
 *   state's `acks` by its `ackId`: Sending…, Queued, Delivered, Not
 *   delivered; dimmer once the one it went to spoke after it) and when. How
 *   you answered a question ("You answered: …") is a bubble of yours too.
 * - Claude Code's own notices (`engine`: its notifications, a task's end)
 *   centred, small and dim: "Claude Code · Agent "X" completed · 12m". A
 *   slash command you ran alone sits there too: "You ran /login · 12m".
 * - A question held on you: its bubble edged amber, and "Answer on
 *   Dashboard →", which takes the Dashboard's card for it into view, the
 *   focus on it.
 * - A long message shows about six lines, then Show more opens it in place,
 *   its whole text read when the state cut it (`loadMessage`).
 * - A window: the newest messages only, "Show earlier" adding more, so the
 *   drawing keeps inside the pane's bounds (its elements and characters),
 *   the member list's share counted. On the terminal it keeps inside the
 *   rows it may take too (`Kit.rows`): the newest that fit between the
 *   member list and the composer, "N earlier" over them.
 * - The composer: with an agent picked, words go to it by SendMessage, no @
 *   needed ("Message builder…"); with Everyone, words with no @ go to the
 *   Orchestrator and `@name` sends the rest to that agent (`W.recipientOf`).
 *   While words are typed, where they would go ("→ builder via
 *   SendMessage"), or why they cannot; a name several agents answer to
 *   offers them ("Did you mean: …"), each a press that puts its handle in. A
 *   send shows at once, "Sending…" until its ack, and keeps its key once the
 *   state holds it, so nothing flashes.
 *
 * The terminal draws no image: an avatar is its glyph in its colour
 * (web/avatars.mjs `terminalFace`), the member list one wrapped line of
 * glyphs and names (the one picked on a blue ground), and a bubble an
 * indented block, yours at the right after a `›`.
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * window, the messages opened, the texts read, the draft, the list folded or
 * open and the sends not yet in the state are this module's own, kept while
 * it lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import { FINISHED_FOLD, MAIN, ORCHESTRATOR } from '../../model'
import { isFinishedRow, needKeyOf, recipientOf, type V2AgentRow, type V2ChatRow, type V2Files, type V2Need, type WebAck, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { rowsOf } from './fit'
import { AVATAR, icon, quiet, svgOf } from './look'
import { P, mix, toneOf } from './palette'
import { chevronOf, face, finishedRow, openFoldsWith } from './parts'
import { ago, cut, flat, foldText, plural } from './text'

/** The messages the window shows at first, and the more each "Show earlier" adds. */
const PAGE = 30
/** The most messages the window grows to. */
const MOST = 200
/** The elements the messages may take, the rest of the pane's drawing beside them inside its 2000. */
const ROW_NODES = 1500
/** The characters they may take (words, avatars, keys), the rest of the pane's beside them inside its 90k or so. */
const ROW_CHARS = 60_000
/** What the member list takes before the messages give it room of theirs: about what the filter row before it took. */
const LIST_SHARE = { nodes: 60, chars: 4000 }
/** The rows a folded message shows. */
const FOLD_ROWS = 6
/** The characters of a message's whole text drawn at most once it is open. */
const WHOLE_MOST = 8000
/** How long a send waits for its ack before saying none came. */
const ACK_WAIT = 20_000
/** How close in time one sender's messages are to stack under one name. */
const GROUP_MS = 5 * 60_000
/** The characters of a name beside a sender's, and of one in the terminal's member line. */
const TO_MOST = 32
/** The characters of a notice of Claude Code's. */
const NOTICE_MOST = 200
/** The most agents the member list names: the Orchestrator, the one picked, then the latest to speak or start. */
const MEMBERS_MOST = 30
/** The cells a column of the member list wants on a desktop: an avatar, a name of twenty-odd letters, a status word. */
const MEMBER_CELLS = 40
/** The most agents "Did you mean" offers. */
const MEAN_MOST = 6
/** A recipient's avatar beside "to", in CSS px: a little under the sender's. */
const TO_FACE = 16

/** The bubbles: others' dark, a held question's amber-edged, yours blue. */
const BUBBLE = '#262626'
const BUBBLE_EDGE = '#303030'
const HELD_EDGE = mix(P.wait, P.card, 0.45)
const HELD_GROUND = mix(BUBBLE, P.wait, 0.08)
const BLUE = '#2563eb'
const ON_BLUE = '#ffffff'
const ON_BLUE_DIM = '#dbeafe'
/** The member picked: a desktop row on a dark blue; the terminal's name on a deeper one. */
const PICKED = mix(BLUE, P.ground, 0.8)
const PICKED_TERMINAL = '#1e3a8a'

/** Everyone's face where Svg draws: two people (Lucide's `users`), in the list's grey. */
function everyoneSvg(px: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${P.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
}

/** A message sent from here that the state may not hold yet: its command id, to whom, the words, when (the state's time it was sent at). */
type Send = { id: string; to: string; who: string; text: string; at: number }

/** A cut message's whole text, as read: on its way, read, or not to be had. */
type Whole = { status: 'loading' | 'ok' | 'error'; text: string }

/** Where a message stands: yours at the right, others' at the left, Claude Code's own in the middle. */
type Side = 'mine' | 'theirs' | 'notice'

/** One message of the window: its key, its row (a send not in the state yet as the row it becomes), the send it was, its side. */
type Entry = { key: string; row: V2ChatRow; send: Send | null; side: Side }

/** Where words go: the agent, its name, the words without the @. */
export type Route = { agentId: string; title: string; text: string }

/** An agent a name could have meant: its row, and the `@` handle that names it alone. */
export type Candidate = { row: V2AgentRow; handle: string }

/** Why words cannot go, and the agents a name could have meant (none when it meant none). */
export type Refusal = { error: string; candidates: Candidate[] }

/** What one drawing of Chat works from: the open folds the view keeps (`DeckView2.openFolds`) among it. */
type Ctx = { kit: Kit; state: WebStateV2; files: V2Files; actions: DashActions; held: ReadonlyMap<string, V2Need>; picked: string; openFolds: readonly string[] }

const view = {
  /** How many messages the window shows, by filter. */
  shown: new Map<string, number>(),
  /** The messages opened. */
  opened: new Set<string>(),
  /** The whole texts read, by message id. */
  wholes: new Map<string, Whole>(),
  /** What the composer holds. */
  draft: '',
  /** Bumped to start the composer anew (empty, or holding a new draft). */
  field: 0,
  /** Why the last send did not go; null for none. */
  refusal: null as Refusal | null,
  /** The preview the last drawing showed, so typing redraws only when it changes. */
  preview: '',
  sends: [] as Send[],
  /** The command ids of the sends from here: their messages keep the key their "Sending…" bubble had. */
  own: new Set<string>(),
  count: 0,
  /** The member list open or folded by a press; null while the pane's width has it. */
  isListOpen: null as boolean | null,
}

/** The composer's key as drawn now: `m` moves the focus to it. */
export function composerKey(): string {
  return view.field === 0 ? 'chat:composer' : `chat:composer:${view.field}`
}

/** Puts `text` in the composer (an agent page's `m`: `@name `), drawn anew so the field holds it. */
export function draftFor(text: string): void {
  view.draft = text
  view.refusal = null
  view.field += 1
}

/** The handle `@` names an agent row by: its name, else its short id; '' for the Orchestrator and a row with neither. */
export function handleOf(row: V2AgentRow): string {
  if (row.id === MAIN) return ''
  return row.name !== '' && !/\s/.test(row.name) ? row.name : row.shortId
}

/** The handle that names `row` alone among the session's agents: its handle, else its short id when another carries the same name. */
function onlyHandleOf(state: WebStateV2, row: V2AgentRow): string {
  const handle = handleOf(row)
  const isShared = agentRows(state).some(one => one.id !== row.id && one.name !== '' && one.name.toLowerCase() === handle.toLowerCase())
  return isShared && row.shortId !== '' ? row.shortId : handle
}

function agentRows(state: WebStateV2): V2AgentRow[] {
  return state.agents.filter((row): row is V2AgentRow => row.row === 'agent')
}

function rowOf(state: WebStateV2, id: string | null): V2AgentRow | undefined {
  return id === null ? undefined : agentRows(state).find(row => row.id === id)
}

/** Whether a party is an agent (or a name SendMessage used): neither you, nor Claude Code, nor nobody. */
function isAgentParty(party: string | null): boolean {
  return party !== null && party !== 'you' && party !== 'engine'
}

/** The filter Chat draws: `DeckView2.chatFilter`, with the You of before as Everyone. */
function filterOf(raw: string): string {
  return raw === 'you' ? '' : raw
}

/** Whether a filter is an agent's: neither Everyone nor Between agents. */
function isAgentFilter(filter: string): boolean {
  return filter !== '' && filter !== 'you' && filter !== 'between'
}

/** Whether `row` passes filter `filter` (`DeckView2.chatFilter`): an agent's takes the words from it and to it. */
export function passes(row: V2ChatRow, filter: string): boolean {
  if (filter === '') return true
  if (filter === 'you') return row.from === 'you' || row.to === 'you'
  if (filter === 'between') return isAgentParty(row.from) && isAgentParty(row.to)
  return row.from === filter || row.to === filter || row.agent === filter
}

/** One of the member list: an agent's id, its name, its row (null for a name SendMessage used that no agent carries). */
export type Member = { id: string; title: string; row: V2AgentRow | null }

/**
 * The member list: every agent of the session in the tree's order (Claude
 * Code's own loops only when the chat names one), at most 30 (the
 * Orchestrator, the one picked, then the latest to speak or start); the one
 * picked kept though the state holds no agent for it. Those at work (and the
 * Orchestrator, and the one picked) are `members`, in front; the finished
 * ones (W.isFinishedRow) `finished`, behind their fold row. The agents
 * "Clear finished" hid are left out, but the one picked. `hidden`: the
 * agents left out past 30.
 */
export function membersOf(state: WebStateV2, filter: string): { members: Member[]; finished: Member[]; hidden: number } {
  const named = new Set(state.chat.flatMap(row => [row.from, row.to ?? '', row.agent ?? '']))
  const rows = agentRows(state).filter(row => (row.kind !== 'engine' || named.has(row.id) || row.id === filter) && (!row.isCleared || row.id === filter))
  let kept = rows
  if (rows.length > MEMBERS_MOST) {
    const last = new Map<string, number>()
    for (const one of state.chat) for (const id of [one.from, one.to ?? '', one.agent ?? '']) last.set(id, one.at)
    const rank = (row: V2AgentRow) => (row.id === MAIN || row.id === filter ? Infinity : Math.max(last.get(row.id) ?? 0, row.startedAt))
    const top = new Set([...rows].sort((a, b) => rank(b) - rank(a)).slice(0, MEMBERS_MOST).map(row => row.id))
    kept = rows.filter(row => top.has(row.id))
  }
  const all: Member[] = kept.map(row => ({ id: row.id, title: row.title, row }))
  const isBehind = (one: Member) => one.row !== null && isFinishedRow(one.row) && one.id !== filter
  const members = all.filter(one => !isBehind(one))
  const finished = all.filter(isBehind)
  if (isAgentFilter(filter) && !all.some(one => one.id === filter)) members.push({ id: filter, title: filter, row: null })
  return { members, finished, hidden: rows.length - kept.length }
}

/** The last word on command `id` in the state's acks: a later one replaces an earlier one. */
function ackOf(state: WebStateV2, id: string): WebAck | undefined {
  for (let i = state.acks.length - 1; i >= 0; i--) if (state.acks[i]?.id === id) return state.acks[i]
  return undefined
}

/** `word: text`, unless the text starts with that word already. */
function lead(word: string, text: string): string {
  const said = String(text || '').trim()
  if (said.toLowerCase().startsWith(word.toLowerCase())) return said
  return `${word}: ${said.replace(/^(It|Its|The|This|That|They|There|A|An|No|Not|Nothing|Only|Too|Could|Already)\b/, one => one.toLowerCase())}`
}

/** What a send's ack says under it: its mark, its hue, its words. */
export function ackLine(ack: WebAck): { mark: string; hue: string; text: string } {
  if (!ack.ok || ack.status === 'failed') return { mark: '✕', hue: P.failText, text: lead('Not delivered', ack.text || 'Claude Code refused it') }
  if (ack.status === 'answered') return { mark: '✓', hue: P.doneText, text: lead('Answered', ack.text || 'Claude carries on') }
  if (ack.status === 'delivered') return { mark: '✓', hue: P.doneText, text: lead('Delivered', ack.text || 'it reads it at its next step') }
  return { mark: '◷', hue: P.waitText, text: lead('Queued', ack.text || 'Claude reads it when it finishes its current turn') }
}

function sideOf(row: V2ChatRow): Side {
  // a slash command you ran alone is no words of yours: a line in the middle
  if (row.kind === 'command') return 'notice'
  if (row.from === 'you') return 'mine'
  if (row.from === 'engine') return 'notice'
  return 'theirs'
}

/**
 * The messages under `filter`, oldest first, then the sends from here the
 * state does not hold yet; a send's message keyed as its bubble was. A
 * send leaves this module's list once the state holds its message.
 */
function entriesOf(state: WebStateV2, filter: string): Entry[] {
  view.sends = view.sends.filter(send => !state.chat.some(row => row.ackId === send.id)).slice(-10)
  const taken = new Set<string>()
  const entries: Entry[] = []
  for (const row of state.chat) {
    if (!passes(row, filter)) continue
    // what the agents Clear finished hid said or were told leaves Everyone and Between agents; their own conversation keeps it
    if (row.isCleared && (filter === '' || filter === 'between')) continue
    const own = row.ackId && view.own.has(row.ackId) ? `send:${row.ackId}` : ''
    const key = own && !taken.has(own) ? own : `msg:${row.id}`
    taken.add(key)
    entries.push({ key, row, send: null, side: sideOf(row) })
  }
  for (const send of view.sends) {
    const row: V2ChatRow = { id: send.id, at: send.at, from: 'you', to: send.to, who: send.who, kind: 'chat', text: send.text, ackId: send.id }
    if (passes(row, filter) && !taken.has(`send:${send.id}`)) entries.push({ key: `send:${send.id}`, row, send, side: 'mine' })
  }
  return entries
}

/** What the chat ends with under `filter`, as one string: how many, the last one's key and its ack. A change says something new is at its end. */
export function chatEndOf(state: WebStateV2, filter: string): string {
  const entries = entriesOf(state, filterOf(filter))
  const last = entries[entries.length - 1]
  if (!last) return ''
  const ack = last.row.ackId ? ackOf(state, last.row.ackId) : undefined
  return `${entries.length}|${last.key}|${ack ? `${ack.status}:${ack.text}` : ''}`
}

/** How Chat keeps to its newest message, as the hooks module holds it: whether Chat showed at the last drawing, what it ended with then, whether you are at the pane's end. */
export type ChatFollow = { isShown: boolean; end: string; isAtEnd: boolean }

/**
 * One drawing's step of Chat keeping to its newest message, `follow`
 * updated in place: `end` is what Chat ends with now (`chatEndOf`), null
 * while Chat is not on show (which forgets it all). True when the pane is to
 * go to its end: Chat came into view (you are at its end then), or
 * something new is at its end while you were there.
 */
export function followStep(follow: ChatFollow, end: string | null): boolean {
  if (end === null) {
    follow.isShown = false
    follow.isAtEnd = false
    follow.end = ''
    return false
  }
  const isNew = !follow.isShown
  const isGoing = isNew || (end !== follow.end && follow.isAtEnd)
  if (isNew) {
    follow.isShown = true
    follow.isAtEnd = true
  }
  follow.end = end
  return isGoing
}

/** Whether a window `offset` rows down a tree `contentRows` tall, `bodyRows` of it showing, shows the tree's end (a row short counts). */
export function isAtEndOf(scroll: { offset: number; bodyRows: number; contentRows: number }): boolean {
  return scroll.offset >= scroll.contentRows - scroll.bodyRows - 1
}

/** Whether `next` stacks under `prev`'s name: the same sender (not Claude Code), on the same side, within a few minutes. */
function joins(prev: Entry | undefined, next: Entry): boolean {
  if (!prev || next.side === 'notice' || prev.side !== next.side || prev.row.from !== next.row.from) return false
  return next.row.at - prev.row.at <= GROUP_MS
}

/** A party's name: an agent row's title, "you", "Claude Code", else the name the state gave (`fallback`), else the id. */
function partyName(state: WebStateV2, id: string | null, fallback: string): string {
  if (id === null) return fallback
  if (id === 'you') return 'you'
  if (id === 'engine') return 'Claude Code'
  const row = rowOf(state, id)
  if (row) return row.title
  if (id === MAIN) return ORCHESTRATOR
  return fallback || id
}

/** Who sent a message, by name. */
function senderOf(state: WebStateV2, row: V2ChatRow): string {
  return partyName(state, row.from, row.who.split(' → ')[0] ?? '')
}

/** To whom a message went, by name ('' for nobody in particular), cut to fit beside its sender. */
function recipientName(state: WebStateV2, row: V2ChatRow): string {
  if (row.to === null) return ''
  return cut(partyName(state, row.to, row.who.split(' → ')[1] ?? ''), TO_MOST)
}

/** Whether a group's head names the recipient: others' words to anyone but you; yours to anyone but the Orchestrator and the agent you are talking with. */
function namesTo(ctx: Ctx, entry: Entry): boolean {
  const to = entry.row.to
  if (to === null) return false
  if (entry.side === 'mine') return to !== MAIN && to !== ctx.picked
  return to !== 'you'
}

/** The elements and characters a drawing holds, as the pane's bounds count them: every element and string, and every string prop. */
function sizeOf(node: unknown): { nodes: number; chars: number } {
  if (node === null || node === undefined || typeof node === 'boolean') return { nodes: 0, chars: 0 }
  if (Array.isArray(node)) {
    let nodes = 0
    let chars = 0
    for (const one of node) {
      const size = sizeOf(one)
      nodes += size.nodes
      chars += size.chars
    }
    return { nodes, chars }
  }
  if (typeof node !== 'object') return { nodes: 1, chars: String(node).length }
  const props = (node as { props?: Record<string, unknown> }).props ?? {}
  let chars = 0
  for (const value of Object.values(props)) if (typeof value === 'string') chars += value.length
  const inner = sizeOf((node as { children?: unknown }).children ?? [])
  return { nodes: 1 + inner.nodes, chars: chars + inner.chars }
}

/** The elements a group's frame adds around its messages. */
const GROUP_FRAME = 4

/** One message drawn, and its group's head when it starts one (the sender's avatar and name; for yours, whom they went to). */
type Drawn = { entry: Entry; el: RenderElement; head: RenderElement[] | null }

/** Chat: the member list, the window of messages as groups, the composer. */
export function chatTab(kit: Kit, state: WebStateV2, files: V2Files, view2: DeckView2, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box, Button } = kit
  const filter = filterOf(view2.chatFilter)
  const picked = isAgentFilter(filter) ? filter : ''
  const ctx: Ctx = { kit, state, files, actions, held: new Map(state.needs.filter(need => need.kind === 'question').map(need => [need.id, need])), picked, openFolds: view2.openFolds }
  const members = memberList(ctx, filter)
  const compose = composer(ctx, isDemo)
  const share = sizeOf(members)
  const roomNodes = ROW_NODES - Math.max(0, share.nodes - LIST_SHARE.nodes)
  const roomChars = ROW_CHARS - Math.max(0, share.chars - LIST_SHARE.chars)
  // the terminal: the rows the member list, the composer, the "earlier" line and the gaps leave the messages
  const roomRows = kit.rows === undefined ? Infinity : kit.rows - rowsOf(members, kit.columns) - rowsOf(compose, kit.columns) - 5
  const entries = entriesOf(state, filter)
  const want = Math.min(MOST, view.shown.get(filter) ?? PAGE)
  const draw = (i: number, isHead: boolean) => {
    const entry = entries[i] as Entry
    const prev = entries[i - 1]
    const showTo = !isHead && prev !== undefined && prev.row.to !== entry.row.to
    return entryOf(ctx, entry, showTo)
  }
  // the newest first, while the window and the pane's room for them last
  const drawn: Drawn[] = []
  let nodes = 0
  let chars = 0
  let rows = 0
  let isFull = false
  // cut by the terminal's rows, not by the pane's bounds
  let isShort = false
  for (let i = entries.length - 1; i >= 0 && drawn.length < want; i--) {
    const entry = entries[i] as Entry
    const isHead = !joins(entries[i - 1], entry)
    const el = draw(i, isHead)
    const head = isHead ? headOf(ctx, entry) : null
    const size = sizeOf([el, head])
    const more = size.nodes + (head ? GROUP_FRAME : 0)
    // its rows on the terminal: its own, its head's line, the gap over it
    const tall = roomRows === Infinity ? 0 : rowsOf(el, kit.columns) + (head && head.length > 0 ? Math.max(1, rowsOf(head[head.length - 1], Math.max(1, kit.columns - 2))) : 0) + 1
    if ((nodes + more > roomNodes || chars + size.chars > roomChars || rows + tall > roomRows) && drawn.length > 0) {
      isFull = true
      isShort = nodes + more <= roomNodes && chars + size.chars <= roomChars
      break
    }
    nodes += more
    chars += size.chars
    rows += tall
    drawn.unshift({ entry, el, head })
  }
  // the oldest drawn starts a group, with its head, though its sender spoke just before it
  const first = drawn[0]
  if (first && first.head === null) {
    first.head = headOf(ctx, first.entry)
    first.el = draw(entries.length - drawn.length, true)
  }
  const earlier = entries.length - drawn.length
  const empty = picked
    ? `Nothing between you and ${partyName(state, picked, picked)} yet: what you write below goes to it.`
    : filter === 'between'
      ? 'Nothing between agents yet: what they say to each other shows here.'
      : 'Nothing said yet: your prompts, Claude’s answers and what its agents say to each other show here.'
  return (
    <Box key="chat" flexDirection="column" gap={1}>
      {members}
      {earlier > 0 && isFull ? quiet(kit, !isShort ? `${earlier} earlier: more than the pane holds. Pick an agent above, or read them all with /deck web.` : `${earlier} earlier: more than the terminal holds. Pick an agent above, make the pane taller, or read them all with /deck web.`) : null}
      {earlier > 0 && !isFull ? (
        <Box flexDirection="row" justifyContent="center">
          <Button
            key="chat:earlier"
            label={`Show earlier · ${earlier} more`}
            plain
            dimColor
            onPress={() => {
              view.shown.set(filter, Math.min(MOST, want + PAGE))
              actions.redraw()
            }}
          />
        </Box>
      ) : null}
      {drawn.length === 0 ? quiet(kit, empty) : null}
      {groupsOf(kit, drawn)}
      {compose}
    </Box>
  )
}

/**
 * The member list. A desktop: a line ("▾ 8 agents", a press folds or opens
 * the list; "Between agents" at its right while Everyone is picked), then
 * the bordered list in two or three columns, down each, folded where the
 * pane is narrow until opened. The terminal: one wrapped line of glyphs and
 * names. A press on one picks it, the pane to the newest message and the
 * focus to the composer.
 */
function memberList(ctx: Ctx, filter: string): RenderElement {
  const { kit, state, actions, picked } = ctx
  const { Box, Text, Button } = kit
  const isTerminal = kit.surface === 'terminal'
  const { members, finished, hidden } = membersOf(state, filter)
  const pick = (id: string) => {
    actions.setV2View({ chatFilter: id })
    actions.reveal('chat:compose', 'nearest')
    actions.focusNext(1, [composerKey()])
  }
  // the finished behind one row at the list's foot: "3 finished ▸", Clear finished, Show 2 cleared
  const isFinishedOpen = ctx.openFolds.includes(FINISHED_FOLD.chat)
  const fin = finishedRow(kit, FINISHED_FOLD.chat, finished.length, isFinishedOpen, state.cleared?.count ?? 0, actions, () => actions.setV2View({ openFolds: openFoldsWith(ctx.openFolds, FINISHED_FOLD.chat) }))
  const behind = isFinishedOpen ? finished : []
  const between =
    picked === '' ? (
      <Button key="chat:filter:between" label="Between agents" plain dimColor={filter !== 'between'} onPress={() => actions.setV2View({ chatFilter: filter === 'between' ? '' : 'between' })} />
    ) : null
  const more = hidden > 0 ? <Text color={P.muted2}>{`and ${hidden} more on the Dashboard`}</Text> : null
  if (isTerminal) {
    const items = [
      memberChip(ctx, '', 'Everyone', picked === '', () => pick('')),
      ...members.map(one => memberChip(ctx, one.id, one.title, one.id === picked, () => pick(one.id))),
    ]
    return (
      <Box key="chat:members" flexDirection="row" flexWrap="wrap" columnGap={2}>
        {items}
        {fin}
        {behind.map(one => memberChip(ctx, one.id, one.title, one.id === picked, () => pick(one.id)))}
        {between}
        {more}
      </Box>
    )
  }
  const across = Math.max(1, Math.min(3, Math.floor((kit.columns + 4) / MEMBER_CELLS), members.length + 1))
  const isWide = across >= 2
  const isOpen = view.isListOpen ?? isWide
  // a press that brings back what the width would have is no choice of its own: the width has it again
  const fold = () => {
    view.isListOpen = !isOpen === isWide ? null : !isOpen
    actions.redraw()
  }
  const current = picked ? members.find(one => one.id === picked) : undefined
  const head = (
    <Box key="chat:members:head" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
      <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
        <Box flexShrink={0}>
          <Button key="chat:members:fold" label={`${chevronOf(isOpen)} ${plural(members.length + finished.length, 'agent')}`} plain dimColor onPress={fold} />
        </Box>
        {isOpen ? null : <Text color={P.muted3}>·</Text>}
        {isOpen ? null : <Box flexShrink={0}>{current ? face(kit, current.row, TO_FACE) : everyoneFace(kit, TO_FACE)}</Box>}
        {isOpen ? null : (
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.fg2} wrap="truncate-end">
              {current ? current.title : 'Everyone'}
            </Text>
          </Box>
        )}
      </Box>
      {between ? <Box flexShrink={0}>{between}</Box> : null}
    </Box>
  )
  if (!isOpen) {
    return (
      <Box key="chat:members" flexDirection="column">
        {head}
      </Box>
    )
  }
  const running = members.filter(one => one.row && (one.row.status === 'running' || one.row.status === 'starting')).length
  const rows = [
    memberRow(ctx, { id: '', title: 'Everyone', row: null }, picked === '', running > 0 ? { word: `${running} at work`, hue: P.runText } : null, () => pick('')),
    ...members.map(one => memberRow(ctx, one, one.id === picked, statusOf(one.row), () => pick(one.id))),
  ]
  // down each column, two or three across
  const columnsOf = (list: readonly RenderElement[], key: string) => {
    const down = Math.ceil(list.length / across)
    const columns = Array.from({ length: across }, (_, i) => list.slice(i * down, (i + 1) * down)).filter(one => one.length > 0)
    return (
      <Box key={key} flexDirection="row" columnGap={1}>
        {columns.map(column => (
          <Box flexDirection="column" gap={1} width={`${Math.floor(100 / across)}%`} flexShrink={1} minWidth={0}>
            {column}
          </Box>
        ))}
      </Box>
    )
  }
  return (
    <Box key="chat:members" flexDirection="column">
      {head}
      <Box key="chat:members:list" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1} rowGap={fin ? 1 : 0}>
        {columnsOf(rows, 'chat:members:front')}
        {fin}
        {behind.length > 0 ? columnsOf(behind.map(one => memberRow(ctx, one, one.id === picked, statusOf(one.row), () => pick(one.id))), 'chat:members:finished') : null}
        {more}
      </Box>
    </Box>
  )
}

/** Everyone's face: two people where Svg draws, else a ring in grey. */
function everyoneFace(kit: Kit, px: number): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (Svg) return <Svg source={everyoneSvg(px)} alt="Everyone" width={px} height={px} />
  return <Text color={P.muted}>◎</Text>
}

/** The word an agent's status takes at the right of its row, in its hue while it is at work, waiting or failed; none for a name no agent carries. */
function statusOf(row: V2AgentRow | null): { word: string; hue: string } | null {
  if (row === null) return null
  if (row.isStopped) return { word: 'stopped', hue: P.muted2 }
  const tone = toneOf(row.status)
  const hue = row.status === 'running' || row.status === 'starting' ? P.runText : row.status === 'waiting' ? P.waitText : row.status === 'failed' ? P.failText : P.muted2
  return { word: tone.word, hue }
}

/** One row of the desktop's member list: the face, the name as a plain Button (lit, on blue, when picked), the status word at the right. */
function memberRow(ctx: Ctx, member: Member, isPicked: boolean, status: { word: string; hue: string } | null, onPress: () => void): RenderElement {
  const { kit } = ctx
  const { Box, Text, Button } = kit
  const id = member.id || 'all'
  const look = member.id === '' ? everyoneFace(kit, AVATAR.list) : face(kit, member.row, AVATAR.list)
  return (
    <Box key={`chat:member:${id}`} flexDirection="row" alignItems="center" columnGap={1} paddingX={1} {...(isPicked ? { backgroundColor: PICKED } : {})}>
      <Box flexShrink={0}>{look}</Box>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>
        <Button key={`chat:filter:${id}`} label={member.title} plain dimColor={!isPicked} onPress={onPress} />
      </Box>
      {status ? (
        <Box flexShrink={0}>
          <Text color={status.hue}>{status.word}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** One name of the terminal's member line: its glyph in its colour and its name, the one picked on blue. */
function memberChip(ctx: Ctx, id: string, title: string, isPicked: boolean, onPress: () => void): RenderElement {
  const { kit, state } = ctx
  const { Text, Button } = kit
  const row = id === '' ? undefined : rowOf(state, id)
  const name = cut(title, TO_MOST)
  return (
    <Button key={`chat:filter:${id || 'all'}`} label={title} plain dimColor={false} onPress={onPress}>
      {id === '' ? <Text color={P.muted}>◎</Text> : face(kit, row ?? null, AVATAR.row)}
      {isPicked ? (
        <Text bold color={ON_BLUE} backgroundColor={PICKED_TERMINAL}>
          {` ${name} `}
        </Text>
      ) : (
        <Text color={P.muted}>{` ${name}`}</Text>
      )}
    </Button>
  )
}

/** The drawn messages as groups: each head with the messages that stack under it. */
function groupsOf(kit: Kit, drawn: readonly Drawn[]): RenderElement[] {
  const groups: RenderElement[] = []
  let at = 0
  while (at < drawn.length) {
    const start = drawn[at] as Drawn
    let end = at + 1
    while (end < drawn.length && drawn[end]?.head === null) end++
    groups.push(groupOf(kit, start, drawn.slice(at, end).map(one => one.el)))
    at = end
  }
  return groups
}

/**
 * A group: Claude Code's notice alone in the middle; yours at the right,
 * whom they went to over them when it says something; others' at the left,
 * the sender's avatar beside its name and the messages under the name.
 */
function groupOf(kit: Kit, start: Drawn, els: RenderElement[]): RenderElement {
  const { Box } = kit
  const key = `grp:${start.entry.key}`
  const head = start.head ?? []
  if (start.entry.side === 'notice') return els[0] as RenderElement
  if (start.entry.side === 'mine') {
    return (
      <Box key={key} flexDirection="column">
        {head}
        <Box flexDirection="column" alignItems="flex-end" gap={1}>
          {els}
        </Box>
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="flex-start">
      <Box flexShrink={0}>{head[0] ?? null}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {head[1] ?? null}
        <Box flexDirection="column" gap={1}>
          {els}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * A party's name: a plain Button that opens its agent's page where the
 * state holds one (a desktop draws the label alone; the terminal the
 * sender's bold, a recipient's grey), else its name as words.
 */
function partyPress(ctx: Ctx, id: string | null, name: string, key: string, isSender: boolean): RenderElement {
  const { kit, state, actions } = ctx
  const { Text, Button } = kit
  const row = rowOf(state, id)
  const ink = isSender ? P.text : P.muted
  if (!row) {
    return (
      <Text bold={isSender} color={ink} wrap="truncate-end">
        {name}
      </Text>
    )
  }
  const open = () => actions.openAgent(row.id)
  if (kit.surface === 'terminal') {
    return (
      <Button key={key} label={name} plain onPress={open}>
        <Text bold={isSender} color={ink}>
          {name}
        </Text>
      </Button>
    )
  }
  return <Button key={key} label={name} plain dimColor={!isSender} onPress={open} />
}

/** "to", the recipient's small avatar (none for you) and name (a press opens its page): `key` the name's. */
function toParts(ctx: Ctx, entry: Entry, key: string): RenderElement[] {
  const { kit, state } = ctx
  const { Box, Text } = kit
  const to = entry.row.to
  const row = rowOf(state, to)
  return [
    <Box flexShrink={0}>
      <Text color={P.muted2}>to</Text>
    </Box>,
    ...(isAgentParty(to) ? [<Box flexShrink={0}>{face(kit, row ?? null, TO_FACE)}</Box>] : []),
    <Box flexDirection="row" flexShrink={2} minWidth={0}>
      {partyPress(ctx, to, recipientName(state, entry.row), key, false)}
    </Box>,
  ]
}

/** A group's head: the sender's avatar and its line (name, "to …", when); for yours, at the right, whom they went to when it says something; none for a notice. */
function headOf(ctx: Ctx, entry: Entry): RenderElement[] {
  const { kit, state } = ctx
  const { Box, Text } = kit
  const row = entry.row
  const isTo = namesTo(ctx, entry)
  if (entry.side === 'notice') return []
  if (entry.side === 'mine') {
    if (!isTo) return []
    return [
      <Box key={`head:${entry.key}`} flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={1}>
        {toParts(ctx, entry, `chat:to:${entry.key}`)}
      </Box>,
    ]
  }
  return [
    face(kit, rowOf(state, row.from) ?? null, AVATAR.list),
    <Box key={`head:${entry.key}`} flexDirection="row" alignItems="center" columnGap={1}>
      <Box flexDirection="row" flexShrink={1} minWidth={0}>
        {partyPress(ctx, row.from, senderOf(state, row), `chat:from:${entry.key}`, true)}
      </Box>
      {isTo ? toParts(ctx, entry, `chat:to:${entry.key}`) : null}
      <Box flexShrink={0}>
        <Text color={P.muted2}>{ago(row.at, state.now)}</Text>
      </Box>
    </Box>,
  ]
}

/** One message: a notice, yours or another's; `showTo` names its recipient over it (stacked under a name that spoke to another). */
function entryOf(ctx: Ctx, entry: Entry, showTo: boolean): RenderElement {
  if (entry.side === 'notice') return noticeOf(ctx, entry)
  if (entry.side === 'mine') return mineOf(ctx, entry, showTo)
  return theirsOf(ctx, entry, showTo)
}

/** The cells a bubble's words are folded to: three quarters of the pane for yours, nearly all beside the avatar for others'. */
function foldWidth(kit: Kit, side: Side): number {
  const isTerminal = kit.surface === 'terminal'
  if (side === 'mine') return Math.max(16, Math.floor(kit.columns * 0.75) - (isTerminal ? 2 : 4))
  return Math.max(16, Math.floor((kit.columns - (isTerminal ? 2 : 4)) * (isTerminal ? 1 : 0.88)) - (isTerminal ? 0 : 4))
}

/** "to scout · 4m" over a message stacked under a name that spoke to another (yours say when under the bubble). */
function toLine(ctx: Ctx, entry: Entry): RenderElement | null {
  const { kit, state } = ctx
  const { Box, Text } = kit
  if (entry.row.to === null || recipientName(state, entry.row) === '') return null
  return (
    <Box key={`to:${entry.key}`} flexDirection="row" alignItems="center" columnGap={1}>
      {toParts(ctx, entry, `chat:to:${entry.key}`)}
      {entry.side === 'mine' ? null : (
        <Box flexShrink={0}>
          <Text color={P.muted2}>{`· ${ago(entry.row.at, state.now)}`}</Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * Another's message: its words in the dark bubble as Markdown (a
 * SendMessage's summary bold over them); a question held on you amber-edged
 * with "Answer on Dashboard →"; on the terminal, an indented block. What came of
 * it under it, when Claude Code said it was not delivered.
 */
function theirsOf(ctx: Ctx, entry: Entry, showTo: boolean): RenderElement {
  const { kit, actions } = ctx
  const { Box, Text, Button } = kit
  const row = entry.row
  const isTerminal = kit.surface === 'terminal'
  const need = row.kind === 'question' && row.callId !== undefined ? ctx.held.get(row.callId) : undefined
  const title = row.title && row.kind === 'message' ? flat(clean(row.title)) : ''
  const words = wordsOf(ctx, entry, foldWidth(kit, 'theirs'))
  const go = (callId: string) => () => {
    actions.setV2View({ tab: 'now', isInspectOpen: false })
    actions.reveal(`needs:${callId}`, 'start')
    actions.focusNext(1, [needKeyOf(callId)])
  }
  const answer = need ? (
    <Box flexDirection="row">
      <Button key={`chat:answer:${row.id}`} label="Answer on Dashboard →" plain hover={{ color: P.waitText }} onPress={go(need.id)} />
    </Box>
  ) : null
  const body = [
    title ? (
      <Text bold color={P.text} wrap="wrap">
        {title}
      </Text>
    ) : null,
    ...words,
    answer,
  ]
  const inner =
    row.kind === 'question' ? (
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{icon(kit, 'help', need ? P.waitText : P.muted, '?')}</Box>
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          {body}
        </Box>
      </Box>
    ) : (
      body
    )
  const bubble = isTerminal ? (
    <Box flexDirection="column">{inner}</Box>
  ) : (
    <Box flexDirection="column" borderStyle="round" borderColor={need ? HELD_EDGE : BUBBLE_EDGE} backgroundColor={need ? HELD_GROUND : BUBBLE} paddingX={1}>
      {inner}
    </Box>
  )
  return (
    <Box key={entry.key} flexDirection="column" alignItems="flex-start" {...(isTerminal ? {} : { width: '88%' })}>
      {showTo ? toLine(ctx, entry) : null}
      {bubble}
      {noteOf(ctx, entry)}
    </Box>
  )
}

/** One of yours: the blue bubble at the right (on the terminal, a block after a `›`), what came of it and when under it. */
function mineOf(ctx: Ctx, entry: Entry, showTo: boolean): RenderElement {
  const { kit } = ctx
  const { Box, Text } = kit
  const isTerminal = kit.surface === 'terminal'
  const words = wordsOf(ctx, entry, foldWidth(kit, 'mine'))
  const bubble = isTerminal ? (
    <Box flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text bold color={P.runText}>
          ›
        </Text>
      </Box>
      <Box flexDirection="column" flexShrink={1} minWidth={0}>
        {words}
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" borderStyle="round" borderColor={BLUE} backgroundColor={BLUE} paddingX={1}>
      {words}
    </Box>
  )
  return (
    <Box key={entry.key} flexDirection="column" alignItems="flex-end" width="75%">
      {showTo ? toLine(ctx, entry) : null}
      {bubble}
      {noteOf(ctx, entry)}
    </Box>
  )
}

/** Claude Code's own notice, centred, small and dim: "Claude Code · Agent "X" completed · 12m"; a slash command you ran alone, "You ran /login · 12m". */
function noticeOf(ctx: Ctx, entry: Entry): RenderElement {
  const { kit, state } = ctx
  const { Box, Text } = kit
  const row = entry.row
  const words = cut(flat(clean(row.text)), NOTICE_MOST)
  const about = row.kind === 'notification' && row.agent && row.agent !== MAIN ? partyName(state, row.agent, '') : ''
  const parts =
    row.kind === 'command'
      ? [`You ran ${words}`, ago(row.at, state.now)]
      : ['Claude Code', words || flat(clean(row.title ?? '')), about && !words.includes(about) ? about : '', ago(row.at, state.now)].filter(Boolean)
  return (
    <Box key={entry.key} flexDirection="row" justifyContent="center">
      <Box flexShrink={1} minWidth={0}>
        <Text color={P.muted2} wrap="truncate-end">
          {parts.join(' · ')}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * A message's words: folded to about six lines, with Show more when there
 * is more (or the state cut it); open, its whole text, read once (and
 * kept) when the state cut it, then Show less. Others' as Markdown; yours
 * as plain words, white on the blue.
 */
function wordsOf(ctx: Ctx, entry: Entry, width: number): RenderElement[] {
  const { kit, files, actions } = ctx
  const { Box, Text, Button, Markdown } = kit
  const row = entry.row
  const isMine = entry.side === 'mine'
  const isTerminal = kit.surface === 'terminal'
  const isOpen = view.opened.has(row.id)
  // what was sent from here is whole on the page already, even where the state would cut it
  const isCut = entry.send === null && row.isCut === true
  const said = clean(entry.send ? entry.send.text : row.text)
  // the whole text while the deck holds it (or the sample's file), else as read from its file
  const kept = isCut && isOpen ? files.message(row.id) : null
  const whole: Whole | undefined = kept !== null ? { status: 'ok', text: kept } : view.wholes.get(row.id)
  const folded = foldText(said, width, FOLD_ROWS)
  const hasMore = folded.isCut || isCut
  const read = () => {
    view.wholes.set(row.id, { status: 'loading', text: '' })
    actions.loadMessage(row.id, text => {
      view.wholes.set(row.id, text === null ? { status: 'error', text: '' } : { status: 'ok', text })
      actions.reveal(entry.key, 'nearest')
    })
  }
  const open = () => {
    view.opened.add(row.id)
    if (isCut && files.message(row.id) === null && (!whole || whole.status === 'error')) read()
    actions.redraw()
  }
  const fold = () => {
    view.opened.delete(row.id)
    actions.redraw()
  }
  const shown = isOpen ? cut(isCut && whole?.status === 'ok' ? clean(whole.text) : said, WHOLE_MOST) : folded.text
  const hue = isMine && !isTerminal ? ON_BLUE_DIM : P.muted2
  const words = isMine ? (
    <Text color={isTerminal ? P.fg2 : ON_BLUE} wrap="wrap">
      {shown}
    </Text>
  ) : (
    <Markdown text={shown} />
  )
  if (!hasMore) return [words]
  const more =
    isOpen && isCut && whole?.status === 'loading' ? (
      <Text color={hue}>Loading the rest…</Text>
    ) : isOpen && isCut && whole?.status === 'error' ? (
      <Text color={isMine && !isTerminal ? ON_BLUE : P.failText}>The rest is not on disk.</Text>
    ) : (
      <Box flexDirection="row">
        <Button key={`chat:more:${row.id}`} label={isOpen ? 'Show less' : 'Show more'} plain dimColor onPress={isOpen ? fold : open} />
      </Box>
    )
  return [words, more]
}

/**
 * Under a message, dim, what came of it. Yours: its ack's words (dimmer once
 * the one it went to spoke after it); a send not acked yet "Sending…", or
 * after a while that no word came; and when. Others': that Claude Code could
 * not deliver it, if it said so. Under how you answered a question, when
 * alone.
 */
function noteOf(ctx: Ctx, entry: Entry): RenderElement | null {
  const { kit, state } = ctx
  const { Text } = kit
  const row = entry.row
  const ack = row.kind === 'choice' || !row.ackId ? undefined : ackOf(state, row.ackId)
  let line: { mark: string; hue: string; text: string } | null = null
  let isSettled = false
  if (row.kind === 'choice') line = null
  else if (ack) {
    line = ackLine(ack)
    isSettled = line.hue !== P.failText && row.to !== null && state.chat.some(one => one.from === row.to && one.at > row.at)
  } else if (entry.send) {
    line = state.now - entry.send.at > ACK_WAIT ? { mark: '◷', hue: P.muted2, text: 'Sent, but Claude Code hasn’t confirmed it' } : { mark: '◐', hue: P.runText, text: 'Sending…' }
  } else if (row.isDelivered === false) {
    line = { mark: '✕', hue: P.failText, text: 'Not delivered' }
  }
  const time = entry.side === 'mine' ? ago(row.at, state.now) : ''
  if (!line && !time) return null
  return (
    <Text wrap="wrap">
      {line ? <Text color={isSettled ? P.muted2 : line.hue}>{`${line.mark} `}</Text> : null}
      {line ? <Text color={isSettled ? P.muted2 : line.hue === P.failText ? P.failText : P.muted}>{line.text}</Text> : null}
      {time ? <Text color={P.muted2}>{line ? ` · ${time}` : time}</Text> : null}
    </Text>
  )
}

/** The agent a candidate names, as `W.recipientOf` may give one: its id, its row, or a name. */
function candidateRow(state: WebStateV2, one: unknown): V2AgentRow | undefined {
  const rows = agentRows(state)
  if (typeof one === 'string') {
    const said = one.replace(/^@/, '').toLowerCase()
    return rows.find(row => row.id === one) ?? rows.find(row => [row.name, row.shortId, row.title].some(name => name !== '' && name.toLowerCase() === said))
  }
  if (one === null || typeof one !== 'object') return undefined
  const fields = one as Record<string, unknown>
  const id = typeof fields.agentId === 'string' ? fields.agentId : typeof fields.id === 'string' ? fields.id : ''
  const row = id ? rows.find(each => each.id === id) : undefined
  if (row) return row
  const name = typeof fields.title === 'string' ? fields.title : typeof fields.name === 'string' ? fields.name : ''
  return name ? candidateRow(state, name) : undefined
}

/**
 * What `W.recipientOf` answered, as a route or a refusal: `{ agentId, title,
 * text }` or `{ error }`; for a name several agents answer to, `ambiguous`
 * (or `candidates`, `matches`), as `{ agentId, title, handle }`, ids, rows or
 * names, each with the handle it gave (else one that names it alone).
 */
export function routeFrom(state: WebStateV2, found: unknown): Route | Refusal {
  const fields = (found !== null && typeof found === 'object' ? found : {}) as Record<string, unknown>
  if (typeof fields.agentId === 'string' && typeof fields.text === 'string' && fields.error === undefined) {
    return { agentId: fields.agentId, title: typeof fields.title === 'string' && fields.title !== '' ? fields.title : partyName(state, fields.agentId, fields.agentId), text: fields.text }
  }
  const list: unknown = fields.ambiguous ?? fields.candidates ?? fields.matches
  const candidates: Candidate[] = []
  for (const one of Array.isArray(list) ? (list as unknown[]) : []) {
    const row = candidateRow(state, one)
    const given = one !== null && typeof one === 'object' ? (one as { handle?: unknown }).handle : undefined
    if (row && !candidates.some(each => each.row === row)) candidates.push({ row, handle: typeof given === 'string' && given !== '' ? given.replace(/^@/, '') : onlyHandleOf(state, row) })
  }
  const error = typeof fields.error === 'string' && fields.error !== '' ? fields.error : candidates.length > 1 ? 'More than one agent goes by that name' : 'No agent goes by that name'
  return { error, candidates: candidates.slice(0, MEAN_MOST) }
}

/** Where `words` go: to the agent picked (`to`) with no @, else as `W.recipientOf` reads them (no @ to the Orchestrator, `@name` to that agent). */
function routeOf(state: WebStateV2, words: string, to: V2AgentRow | undefined): Route | Refusal {
  const said = words.trim()
  if (said === '') return { error: 'Nothing to send', candidates: [] }
  if (to && to.id !== MAIN && !said.startsWith('@')) return { agentId: to.id, title: to.title, text: said }
  return routeFrom(state, recipientOf(state, said))
}

/** What the composer's words would do, or why they cannot go: "→ builder via SendMessage"; '' while it is empty. */
type Preview = { text: string; isError: boolean; candidates: Candidate[] }

function previewOf(state: WebStateV2, words: string, to: V2AgentRow | undefined): Preview {
  if (words.trim() === '') return { text: '', isError: false, candidates: [] }
  const route = routeOf(state, words, to)
  if ('error' in route) return { text: route.error, isError: true, candidates: route.candidates }
  if (route.agentId === MAIN) return { text: `→ ${route.title}: ${state.header.turn ? 'Claude reads it when it finishes its current turn' : 'your next prompt'}`, isError: false, candidates: [] }
  return { text: `→ ${route.title} via SendMessage`, isError: false, candidates: [] }
}

/** A preview as one string: typing redraws when it changes. */
function previewKey(preview: Preview): string {
  return `${preview.text}|${preview.candidates.map(one => one.row.id).join(',')}`
}

/**
 * The composer: an Input and Send, the words to the agent picked (no @
 * needed), else to the Orchestrator or the agent an `@name` names. Under the
 * field while words are typed, where they would go (or why they cannot, and
 * "Did you mean: …" for a name several agents answer to). A send goes
 * through the deck's own `sendChat` with an ack id and shows at once as your
 * bubble, the pane brought to it; the field starts empty again. In the
 * sample nothing is sent, and the words stay.
 */
function composer(ctx: Ctx, isDemo: boolean): RenderElement {
  const { kit, state, actions, picked } = ctx
  const { Box, Text, Button, Input } = kit
  if (!Input) return quiet(kit, 'Message Claude from the Claude Code conversation: this surface has no field to type in.')
  const to = picked ? rowOf(state, picked) : undefined
  const preview: Preview = view.refusal ? { text: view.refusal.error, isError: true, candidates: view.refusal.candidates } : previewOf(state, view.draft, to)
  view.preview = previewKey(preview)
  const send = (text: string) => {
    const route = routeOf(state, text.trim().slice(0, 4000), to)
    if ('error' in route) {
      view.refusal = route
      actions.redraw()
      return
    }
    if (isDemo) {
      actions.sendChat(route.agentId, route.text)
      return
    }
    view.count += 1
    const ackId = `p${state.now.toString(36)}${view.count.toString(36)}`
    view.sends.push({ id: ackId, to: route.agentId, who: `You → ${route.title}`, text: route.text, at: state.now })
    view.own.add(ackId)
    if (view.own.size > 50) view.own.delete(view.own.values().next().value as string)
    view.draft = ''
    view.field += 1
    view.refusal = null
    actions.sendChat(route.agentId, route.text, ackId)
    actions.reveal('chat:compose', 'nearest')
  }
  const placeholder = to && to.id !== MAIN ? `Message ${cut(to.title, 48)}…` : to ? `Message the ${ORCHESTRATOR}…` : `Message the ${ORCHESTRATOR}, or @name an agent…`
  // a name several agents answer to: "Did you mean" says it, each a press
  const said = preview.candidates.length > 1 ? '' : preview.text
  const line = [said, isDemo ? 'Sample data: nothing is sent.' : ''].filter(Boolean).join(' · ')
  return (
    <Box key="chat:compose" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <Input
            key={composerKey()}
            placeholder={placeholder}
            value={view.draft}
            submitLabel="send"
            onInput={text => {
              view.draft = text
              view.refusal = null
              if (previewKey(previewOf(state, text, to)) !== view.preview) actions.redraw()
            }}
            onSubmit={send}
          />
        </Box>
        <Box flexShrink={0}>
          <Button key="chat:send" label="Send" variant="primary" onPress={() => send(view.draft)} />
        </Box>
      </Box>
      {line ? (
        <Text color={preview.isError && said !== '' ? P.waitText : P.muted2} wrap="wrap">
          {line}
        </Text>
      ) : null}
      {preview.candidates.length > 0 ? meanLine(ctx, preview.candidates) : null}
    </Box>
  )
}

/** "Did you mean:" and each agent a name could have meant, its face and name: a press puts the handle that names it alone in the composer in place of the @name. */
function meanLine(ctx: Ctx, candidates: readonly Candidate[]): RenderElement {
  const { kit, actions } = ctx
  const { Box, Text, Button } = kit
  const use = (handle: string) => () => {
    const rest = view.draft.trim().replace(/^@\S*\s*/, '')
    view.draft = handle ? `@${handle} ${rest}` : rest
    view.refusal = null
    view.field += 1
    actions.redraw()
    actions.focusNext(1, [composerKey()])
  }
  return (
    <Box key="chat:mean" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
      <Text color={P.muted2}>Did you mean:</Text>
      {candidates.map(({ row, handle }) => (
        <Box key={`chat:mean:${row.id}:box`} flexDirection="row" alignItems="center">
          <Box flexShrink={0}>{face(kit, row, TO_FACE)}</Box>
          <Button key={`chat:mean:${row.id}`} label={row.title} plain onPress={use(handle)} />
        </Box>
      ))}
    </Box>
  )
}
