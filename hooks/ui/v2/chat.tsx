/**
 * Chat: the one global stream (the v2 state's `chat`, oldest first), every
 * message Claude Code carried, drawn as a group chat.
 *
 * - Others' messages, on the left: the sender's avatar (./parts' `face`, as
 *   Now's cards draw it), its name in bold, a dim "to <recipient>" when the
 *   words went to someone other than you, and when; under them the words in
 *   a rounded dark bubble, as Markdown (a SendMessage's summary in bold over
 *   them). Consecutive messages from one sender within five minutes stack
 *   under one avatar and name; one to another recipient says so over it.
 * - Yours, on the right: "You" and when, then a blue bubble at most three
 *   quarters of the pane wide; under it what came of it, from the state's
 *   `acks` by its `ackId`: Sending…, Queued, Delivered, Not delivered (dim
 *   once the one it went to spoke after it). How you answered a question
 *   ("You answered: …") is a bubble of yours too.
 * - Claude Code's own notices (`engine`: its notifications, a task's end)
 *   centred, small and dim: "Claude Code · Agent "X" completed · 12m".
 * - A question held on you: its bubble edged amber, and "Answer on Now →",
 *   which takes Now's card for it into view, the focus on it.
 * - A long message shows about six lines, then Show more opens it in place,
 *   its whole text read when the state cut it (`loadMessage`).
 * - The filter, one row: Filter · All · You · Between agents · the agents
 *   the chat names (each cut to 16 characters), as many as fit, then
 *   "+n more", which opens the rest as a short list
 *   (`DeckView.v2.chatFilter`); `f` steps through them all.
 * - A window: the newest messages only, "Show earlier" adding more, so the
 *   drawing keeps inside the pane's bounds (its elements and characters).
 * - The composer: words with no @ go to the Orchestrator; `@name` sends the
 *   rest to that agent by SendMessage (`W.recipientOf`), previewed as
 *   "→ name via SendMessage". A send shows at once, "Sending…" until its
 *   ack, and keeps its key once the state holds it, so nothing flashes.
 *
 * The terminal draws no image: there an avatar is its glyph in its colour
 * (web/avatars.mjs `terminalFace`), and a bubble an indented block, yours
 * at the right after a `›`.

 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * window, the messages opened, the texts read, the draft, the list of more
 * agents and the sends not yet in the state are this module's own, kept
 * while it lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import { MAIN, ORCHESTRATOR } from '../../model'
import { needKeyOf, recipientOf, type V2AgentRow, type V2ChatRow, type V2Files, type V2Need, type WebAck, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { AVATAR, advanceOf, icon, keyButton, quiet } from './look'
import { P, mix } from './palette'
import { face } from './parts'
import { ago, cellsOf, cut, flat, foldText } from './text'

/** The messages the window shows at first, and the more each "Show earlier" adds. */
const PAGE = 30
/** The most messages the window grows to. */
const MOST = 200
/** The elements the messages may take, the rest of the pane's drawing beside them inside its 2000. */
const ROW_NODES = 1500
/** The characters they may take (words, avatars, keys), the rest of the pane's beside them inside its 90k or so. */
const ROW_CHARS = 60_000
/** The rows a folded message shows. */
const FOLD_ROWS = 6
/** The characters of a message's whole text drawn at most once it is open. */
const WHOLE_MOST = 8000
/** How long a send waits for its ack before saying none came. */
const ACK_WAIT = 20_000
/** How close in time one sender's messages are to stack under one name. */
const GROUP_MS = 5 * 60_000
/** The characters of an agent's name in the filter row. */
const LABEL_MOST = 16
/** The characters of a recipient's name beside a sender's. */
const TO_MOST = 32
/** The characters of a notice of Claude Code's. */
const NOTICE_MOST = 200

/** The bubbles: others' dark, a held question's amber-edged, yours blue. */
const BUBBLE = '#262626'
const BUBBLE_EDGE = '#303030'
const HELD_EDGE = mix(P.wait, P.card, 0.45)
const HELD_GROUND = mix(BUBBLE, P.wait, 0.08)
const BLUE = '#2563eb'
const ON_BLUE = '#ffffff'
const ON_BLUE_DIM = '#dbeafe'

/** A message sent from here that the state may not hold yet: its command id, to whom, the words, when (the state's time it was sent at). */
type Send = { id: string; to: string; who: string; text: string; at: number }

/** A cut message's whole text, as read: on its way, read, or not to be had. */
type Whole = { status: 'loading' | 'ok' | 'error'; text: string }

/** Where a message stands: yours at the right, others' at the left, Claude Code's own in the middle. */
type Side = 'mine' | 'theirs' | 'notice'

/** One message of the window: its key, its row (a send not in the state yet as the row it becomes), the send it was, its side. */
type Entry = { key: string; row: V2ChatRow; send: Send | null; side: Side }

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
  /** Why the last send did not go; '' for none. */
  refusal: '',
  /** The preview the last drawing showed, so typing redraws only when it changes. */
  preview: '',
  sends: [] as Send[],
  /** The command ids of the sends from here: their messages keep the key their "Sending…" bubble had. */
  own: new Set<string>(),
  count: 0,
  /** The filter's list of more agents is open. */
  isMoreOpen: false,
}

/** The composer's key as drawn now: `m` moves the focus to it. */
export function composerKey(): string {
  return view.field === 0 ? 'chat:composer' : `chat:composer:${view.field}`
}

/** Puts `text` in the composer (an agent page's `m`: `@name `), drawn anew so the field holds it. */
export function draftFor(text: string): void {
  view.draft = text
  view.refusal = ''
  view.field += 1
}

/** The handle `@` names an agent row by: its name, else its short id; '' for the Orchestrator and a row with neither. */
export function handleOf(row: V2AgentRow): string {
  if (row.id === MAIN) return ''
  return row.name !== '' && !/\s/.test(row.name) ? row.name : row.shortId
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

/** Whether `row` passes filter `filter` (`DeckView2.chatFilter`). */
export function passes(row: V2ChatRow, filter: string): boolean {
  if (filter === '') return true
  if (filter === 'you') return row.from === 'you' || row.to === 'you'
  if (filter === 'between') return isAgentParty(row.from) && isAgentParty(row.to)
  return row.from === filter || row.to === filter || row.agent === filter
}

/** The filters in their order: All, You, Between agents, each agent the chat names (tree order); with the one set kept even when no row names it. */
export function filtersOf(state: WebStateV2, current: string): { id: string; label: string }[] {
  const named = new Set(state.chat.flatMap(row => [row.from, row.to ?? '', row.agent ?? '']))
  const agents = agentRows(state).filter(row => named.has(row.id) || row.id === current)
  const list = [{ id: '', label: 'All' }, { id: 'you', label: 'You' }, { id: 'between', label: 'Between agents' }, ...agents.map(row => ({ id: row.id, label: row.title }))]
  if (!list.some(one => one.id === current)) list.push({ id: current, label: current })
  return list
}

/** The filter after `current` (`f`), round to All. */
export function nextFilter(state: WebStateV2, current: string): string {
  const list = filtersOf(state, current)
  const at = list.findIndex(one => one.id === current)
  return list[(at + 1) % list.length]?.id ?? ''
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
  const entries = entriesOf(state, filter)
  const last = entries[entries.length - 1]
  if (!last) return ''
  const ack = last.row.ackId ? ackOf(state, last.row.ackId) : undefined
  return `${entries.length}|${last.key}|${ack ? `${ack.status}:${ack.text}` : ''}`
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

/** The recipient a head names: others' words to anyone but you, yours to anyone but the Orchestrator. */
function headTo(state: WebStateV2, entry: Entry): string {
  const to = entry.row.to
  if (entry.side === 'mine') return to === null || to === MAIN ? '' : recipientName(state, entry.row)
  return to === null || to === 'you' ? '' : recipientName(state, entry.row)
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

/** One message drawn, and its group's head when it starts one (the sender's avatar and name, or "You"). */
type Drawn = { entry: Entry; el: RenderElement; head: RenderElement[] | null }

/** Chat: the filter, the window of messages as groups, the composer. */
export function chatTab(kit: Kit, state: WebStateV2, files: V2Files, view2: DeckView2, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box, Button } = kit
  const filter = view2.chatFilter
  const entries = entriesOf(state, filter)
  const want = Math.min(MOST, view.shown.get(filter) ?? PAGE)
  const held = new Map(state.needs.filter(need => need.kind === 'question').map(need => [need.id, need]))
  const draw = (i: number, isHead: boolean) => {
    const entry = entries[i] as Entry
    const prev = entries[i - 1]
    const showTo = !isHead && prev !== undefined && prev.row.to !== entry.row.to
    return entryOf(kit, state, files, entry, showTo, held, actions)
  }
  // the newest first, while the window and the pane's room for them last
  const drawn: Drawn[] = []
  let nodes = 0
  let chars = 0
  let isFull = false
  for (let i = entries.length - 1; i >= 0 && drawn.length < want; i--) {
    const entry = entries[i] as Entry
    const isHead = !joins(entries[i - 1], entry)
    const el = draw(i, isHead)
    const head = isHead ? headOf(kit, state, entry) : null
    const size = sizeOf([el, head])
    const more = size.nodes + (head ? GROUP_FRAME : 0)
    if ((nodes + more > ROW_NODES || chars + size.chars > ROW_CHARS) && drawn.length > 0) {
      isFull = true
      break
    }
    nodes += more
    chars += size.chars
    drawn.unshift({ entry, el, head })
  }
  // the oldest drawn starts a group, with its head, though its sender spoke just before it
  const first = drawn[0]
  if (first && first.head === null) {
    first.head = headOf(kit, state, first.entry)
    first.el = draw(entries.length - drawn.length, true)
  }
  const earlier = entries.length - drawn.length
  return (
    <Box key="chat" flexDirection="column" gap={1}>
      {filterRow(kit, state, filter, actions)}
      {earlier > 0 && isFull ? quiet(kit, `${earlier} earlier: more than the pane holds. Filter by an agent, or read them all with /deck web.`) : null}
      {earlier > 0 && !isFull ? (
        <Box flexDirection="row">
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
      {drawn.length === 0 ? quiet(kit, filter === '' ? 'Nothing said yet: your prompts, Claude’s answers and what its agents say to each other show here.' : 'Nothing under this filter yet.') : null}
      {groupsOf(kit, drawn)}
      {composer(kit, state, view2, actions, isDemo)}
    </Box>
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
 * "You" over them; others' at the left, the sender's avatar beside its
 * name and the messages under the name.
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

/** A group's head: the sender's avatar and its line (name, "to …", when); "You" at the right; none for a notice. */
function headOf(kit: Kit, state: WebStateV2, entry: Entry): RenderElement[] {
  const { Box, Text } = kit
  const row = entry.row
  const time = ago(row.at, state.now)
  const to = headTo(state, entry)
  if (entry.side === 'notice') return []
  if (entry.side === 'mine') {
    return [
      <Box flexDirection="row" justifyContent="flex-end" columnGap={1}>
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text bold color={P.text}>
              You
            </Text>
            {to ? <Text color={P.muted}>{` to ${to}`}</Text> : null}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={P.muted2}>{time}</Text>
        </Box>
      </Box>,
    ]
  }
  const name = senderOf(state, row)
  return [
    face(kit, rowOf(state, row.from) ?? null, AVATAR.list),

    <Box flexDirection="row" columnGap={1}>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text bold color={P.text}>
            {name}
          </Text>
          {to ? <Text color={P.muted}>{` to ${to}`}</Text> : null}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={P.muted2}>{time}</Text>
      </Box>
    </Box>,
  ]
}

/** One message: a notice, yours or another's; `showTo` names its recipient over it (stacked under a name that spoke to another). */
function entryOf(kit: Kit, state: WebStateV2, files: V2Files, entry: Entry, showTo: boolean, held: ReadonlyMap<string, V2Need>, actions: DashActions): RenderElement {
  if (entry.side === 'notice') return noticeOf(kit, state, entry)
  if (entry.side === 'mine') return mineOf(kit, state, files, entry, showTo, actions)
  return theirsOf(kit, state, files, entry, showTo, held, actions)
}

/** The cells a bubble's words are folded to: three quarters of the pane for yours, nearly all beside the avatar for others'. */
function foldWidth(kit: Kit, side: Side): number {
  const isTerminal = kit.surface === 'terminal'
  if (side === 'mine') return Math.max(16, Math.floor(kit.columns * 0.75) - (isTerminal ? 2 : 4))
  return Math.max(16, Math.floor((kit.columns - (isTerminal ? 2 : 4)) * (isTerminal ? 1 : 0.88)) - (isTerminal ? 0 : 4))
}

/** "to scout" over a message stacked under a name that spoke to another. */
function toLine(kit: Kit, state: WebStateV2, entry: Entry): RenderElement | null {
  const { Text } = kit
  const to = entry.row.to === null ? '' : recipientName(state, entry.row)
  if (to === '') return null
  return (
    <Text color={P.muted2} wrap="truncate-end">
      {`to ${to} · ${ago(entry.row.at, state.now)}`}
    </Text>
  )
}

/**
 * Another's message: its words in the dark bubble as Markdown (a
 * SendMessage's summary bold over them); a question held on you amber-edged
 * with "Answer on Now →"; on the terminal, an indented block. What came of
 * it under it, when Claude Code said it was not delivered.
 */
function theirsOf(kit: Kit, state: WebStateV2, files: V2Files, entry: Entry, showTo: boolean, held: ReadonlyMap<string, V2Need>, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const row = entry.row
  const isTerminal = kit.surface === 'terminal'
  const need = row.kind === 'question' && row.callId !== undefined ? held.get(row.callId) : undefined
  const title = row.title && row.kind === 'message' ? flat(clean(row.title)) : ''
  const words = wordsOf(kit, files, entry, foldWidth(kit, 'theirs'), actions)
  const go = (callId: string) => () => {
    actions.setV2View({ tab: 'now', isInspectOpen: false })
    actions.reveal(`needs:${callId}`, 'start')
    actions.focusNext(1, [needKeyOf(callId)])
  }
  const answer = need ? (
    <Box flexDirection="row">
      <Button key={`chat:answer:${row.id}`} label="Answer on Now →" plain hover={{ color: P.waitText }} onPress={go(need.id)} />
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
      {showTo ? toLine(kit, state, entry) : null}
      {bubble}
      {noteOf(kit, state, entry)}
    </Box>
  )
}

/** One of yours: the blue bubble at the right (on the terminal, a block after a `›`), what came of it under it. */
function mineOf(kit: Kit, state: WebStateV2, files: V2Files, entry: Entry, showTo: boolean, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const isTerminal = kit.surface === 'terminal'
  const words = wordsOf(kit, files, entry, foldWidth(kit, 'mine'), actions)
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
      {showTo ? toLine(kit, state, entry) : null}
      {bubble}
      {noteOf(kit, state, entry)}
    </Box>
  )
}

/** Claude Code's own notice, centred, small and dim: "Claude Code · Agent "X" completed · 12m". */
function noticeOf(kit: Kit, state: WebStateV2, entry: Entry): RenderElement {
  const { Box, Text } = kit
  const row = entry.row
  const words = cut(flat(clean(row.text)), NOTICE_MOST)
  const about = row.kind === 'notification' && row.agent && row.agent !== MAIN ? partyName(state, row.agent, '') : ''
  const parts = ['Claude Code', words || flat(clean(row.title ?? '')), about && !words.includes(about) ? about : '', ago(row.at, state.now)].filter(Boolean)
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
function wordsOf(kit: Kit, files: V2Files, entry: Entry, width: number, actions: DashActions): RenderElement[] {
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
 * Under a message of yours, what came of it: its ack's words (dim once the
 * one it went to spoke after it); a send not acked yet "Sending…", or after
 * a while that no word came. Under any message Claude Code said it could
 * not deliver, that. None under how you answered a question.
 */
function noteOf(kit: Kit, state: WebStateV2, entry: Entry): RenderElement | null {
  const { Text } = kit
  const row = entry.row
  if (row.kind === 'choice') return null
  const ack = row.ackId ? ackOf(state, row.ackId) : undefined
  let line: { mark: string; hue: string; text: string } | null = null
  let isSettled = false
  if (ack) {
    line = ackLine(ack)
    isSettled = line.hue !== P.failText && row.to !== null && state.chat.some(one => one.from === row.to && one.at > row.at)
  } else if (entry.send) {
    line = state.now - entry.send.at > ACK_WAIT ? { mark: '◷', hue: P.muted2, text: 'Sent, but Claude Code hasn’t confirmed it' } : { mark: '◐', hue: P.runText, text: 'Sending…' }
  } else if (row.isDelivered === false) {
    line = { mark: '✕', hue: P.failText, text: 'Not delivered' }
  }
  if (!line) return null
  return (
    <Text wrap="wrap">
      <Text color={isSettled ? P.muted2 : line.hue}>{`${line.mark} `}</Text>
      <Text color={isSettled ? P.muted2 : line.hue === P.failText ? P.failText : P.muted}>{line.text}</Text>
    </Text>
  )
}

/**
 * The filter, one row: `f` (Filter) steps to the next; All · You · Between
 * agents; the agents the chat names, each cut to 16 characters, the one set
 * first, as many as fit; then "+n more", which opens the rest as a short
 * list (each with its avatar). The one set lit, the rest dim; a pick takes
 * the pane to the newest message.
 */
function filterRow(kit: Kit, state: WebStateV2, filter: string, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const advance = advanceOf(kit)
  const list = filtersOf(state, filter)
  const isAgent = (id: string) => id !== '' && id !== 'you' && id !== 'between'
  const fixed = list.filter(one => !isAgent(one.id))
  const agents = list.filter(one => isAgent(one.id)).map(one => ({ id: one.id, label: cut(one.label, LABEL_MOST), title: one.label }))
  const ordered = [...agents.filter(one => one.id === filter), ...agents.filter(one => one.id !== filter)]
  // what each part takes: its label, a desktop button's padding, the gap and dot after it
  const slack = kit.surface === 'terminal' ? 0 : 1.2
  const costOf = (label: string) => cellsOf(label, advance) + slack + 2 + cellsOf('·', advance)
  let room = kit.columns - 2 - costOf('Filter') - fixed.reduce((sum, one) => sum + costOf(one.label), 0)
  const inRow: typeof ordered = []
  for (const [i, one] of ordered.entries()) {
    const rest = ordered.length - i - 1
    if (costOf(one.label) + (rest > 0 ? costOf(`+${rest} more`) : 0) > room) break
    inRow.push(one)
    room -= costOf(one.label)
  }
  const hidden = agents.filter(one => !inRow.includes(one))
  if (hidden.length === 0) view.isMoreOpen = false
  const pick = (id: string) => {
    view.isMoreOpen = false
    actions.setV2View({ chatFilter: id })
    actions.reveal('chat:compose', 'nearest')
  }
  const dot = (key: string) => (
    <Text key={key} color={P.muted3}>
      ·
    </Text>
  )
  const parts: RenderElement[] = []
  for (const one of [...fixed, ...inRow]) {
    if (parts.length > 0) parts.push(dot(`chat:dot:${one.id || 'all'}`))
    parts.push(<Button key={`chat:filter:${one.id || 'all'}`} label={one.label} plain dimColor={one.id !== filter} onPress={() => pick(one.id)} />)
  }
  if (hidden.length > 0) {
    parts.push(dot('chat:dot:more'))
    parts.push(
      <Button
        key="chat:filter:more"
        label={`+${hidden.length} more`}
        plain
        dimColor={!view.isMoreOpen}
        onPress={() => {
          view.isMoreOpen = !view.isMoreOpen
          actions.redraw()
        }}
      />,
    )
  }
  return (
    <Box key="chat:filters" flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        {keyButton(kit, 'key:f', 'f', 'Filter', () => pick(nextFilter(state, filter)))}
        {parts}
      </Box>
      {view.isMoreOpen && hidden.length > 0 ? (
        <Box key="chat:filters:more" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
          {hidden.map(one => (
            <Box key={`chat:more-agent:${one.id}`} flexDirection="row" columnGap={1} alignItems="center">
              <Box flexShrink={0}>{face(kit, rowOf(state, one.id) ?? null, AVATAR.row)}</Box>
              <Box flexShrink={1} minWidth={0}>
                <Button key={`chat:filter:${one.id}`} label={cut(one.title, 48)} plain dimColor onPress={() => pick(one.id)} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

/** What the composer's words would do, or why they cannot go: "→ builder via SendMessage". */
function previewOf(state: WebStateV2, words: string): { text: string; isError: boolean } {
  if (words.trim() === '') return { text: '', isError: false }
  const to = recipientOf(state, words)
  if ('error' in to) return { text: to.error, isError: true }
  if (to.agentId === MAIN) return { text: `→ ${to.title}: ${state.header.turn ? 'Claude reads it when it finishes its current turn' : 'your next prompt'}`, isError: false }
  return { text: `→ ${to.title} via SendMessage`, isError: false }
}

/**
 * The composer: an Input and Send. Words with no @ go to the Orchestrator,
 * `@name` to that agent by SendMessage; under the field, where they would
 * go (or why they cannot). A send goes through the deck's own `sendChat`
 * with an ack id and shows at once as your bubble, the pane brought to it;
 * the field starts empty again. In the sample nothing is sent, and the
 * words stay.
 */
function composer(kit: Kit, state: WebStateV2, view2: DeckView2, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box, Text, Button, Input } = kit
  if (!Input) return quiet(kit, 'Message Claude from the Claude Code conversation: this surface has no field to type in.')
  const preview = view.refusal ? { text: view.refusal, isError: true } : previewOf(state, view.draft)
  view.preview = preview.text
  const filtered = agentRows(state).find(row => row.id === view2.chatFilter)
  const handle = filtered ? handleOf(filtered) : ''
  const send = (text: string) => {
    const said = text.trim().slice(0, 4000)
    const to = recipientOf(state, said)
    if ('error' in to) {
      view.refusal = to.error
      actions.redraw()
      return
    }
    if (isDemo) {
      actions.sendChat(to.agentId, to.text)
      return
    }
    view.count += 1
    const ackId = `p${state.now.toString(36)}${view.count.toString(36)}`
    view.sends.push({ id: ackId, to: to.agentId, who: `You → ${to.title}`, text: to.text, at: state.now })
    view.own.add(ackId)
    if (view.own.size > 50) view.own.delete(view.own.values().next().value as string)
    view.draft = ''
    view.field += 1
    view.refusal = ''
    actions.sendChat(to.agentId, to.text, ackId)
    actions.reveal('chat:compose', 'nearest')
  }
  const hint = preview.text || (handle ? `No @: to the ${ORCHESTRATOR} · @${handle}: to ${filtered?.title ?? handle} by SendMessage` : `No @: to the ${ORCHESTRATOR} · @name: to that agent by SendMessage`)
  return (
    <Box key="chat:compose" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <Input
            key={composerKey()}
            placeholder={handle ? `Message the ${ORCHESTRATOR}, or @${handle} …` : `Message the ${ORCHESTRATOR}, or @name an agent…`}
            value={view.draft}
            submitLabel="send"
            onInput={text => {
              view.draft = text
              view.refusal = ''
              if (previewOf(state, text).text !== view.preview) actions.redraw()
            }}
            onSubmit={send}
          />
        </Box>
        <Box flexShrink={0}>
          <Button key="chat:send" label="Send" variant="primary" onPress={() => send(view.draft)} />
        </Box>
      </Box>
      <Text color={preview.isError ? P.waitText : P.muted2} wrap="wrap">
        {isDemo && !preview.isError ? `${hint} · Sample data: nothing is sent.` : hint}
      </Text>
    </Box>
  )
}
