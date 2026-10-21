/**
 * Chat: the one global stream (the v2 state's `chat`, oldest first), every
 * message Claude Code carried, as sentence rows: "A → B: text", the time on
 * the right. A long one folds to a few lines; Show more opens it in place
 * as Markdown, its whole text read when the state cut it (`loadMessage`).
 *
 * - Filter chips: All · You · each agent · Between agents
 *   (`DeckView.v2.chatFilter`); `f` steps through them.
 * - A window: the newest rows only, "Show earlier" adding more, so the
 *   pane's drawing keeps inside its bounds.
 * - Under a message sent from the deck, what came of it (the state's
 *   `acks`, by its `ackId`): delivered, queued or not delivered.
 * - The composer: words with no @ go to the Orchestrator; `@name` sends the
 *   rest to that agent by SendMessage (`W.recipientOf`), previewed as
 *   "→ name via SendMessage". A send shows at once, "Sending…" until its ack.
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * window, the rows opened, the texts read, the draft and the sends not yet
 * in the state are this module's own, kept while it lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import { MAIN, ORCHESTRATOR } from '../../model'
import { recipientOf, type V2AgentRow, type V2ChatRow, type V2Files, type WebAck, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { advanceOf, keyButton, quiet, ticked } from './look'
import { P } from './palette'
import { ago, cellsOf, cut, flat, foldText } from './text'

/** The rows the window shows at first, and the more each "Show earlier" adds. */
const PAGE = 30
/** The most rows the window grows to. */
const MOST = 200
/** The elements the rows may take, the rest of the pane's drawing beside them inside its 2000. */
const ROW_NODES = 1500

/** The elements and strings a drawing holds, as the pane's bound counts them. */
function nodesOf(node: unknown): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (Array.isArray(node)) return node.reduce((sum: number, one) => sum + nodesOf(one), 0)
  if (typeof node !== 'object') return 1
  return 1 + nodesOf((node as { children?: unknown }).children ?? [])
}
/** The rows a folded message shows. */
const FOLD_ROWS = 3
/** The characters of a message's whole text drawn at most once it is open. */
const WHOLE_MOST = 8000
/** How long a send waits for its ack before saying none came. */
const ACK_WAIT = 20_000

/** A message sent from here that the state may not hold yet: its command id, to whom, the words, when (the state's time it was sent at). */
type Send = { id: string; to: string; who: string; text: string; at: number }

/** A cut message's whole text, as read: on its way, read, or not to be had. */
type Whole = { status: 'loading' | 'ok' | 'error'; text: string }

const view = {
  /** How many rows the window shows, by filter. */
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
  count: 0,
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

/** The filters in their order: All, You, each agent the chat names (tree order), Between agents; with the one set kept even when no row names it. */
export function filtersOf(state: WebStateV2, current: string): { id: string; label: string }[] {
  const named = new Set(state.chat.flatMap(row => [row.from, row.to ?? '', row.agent ?? '']))
  const agents = agentRows(state).filter(row => named.has(row.id) || row.id === current)
  const list = [{ id: '', label: 'All' }, { id: 'you', label: 'You' }, ...agents.map(row => ({ id: row.id, label: row.title })), { id: 'between', label: 'Between agents' }]
  if (!list.some(one => one.id === current)) list.splice(list.length - 1, 0, { id: current, label: current })
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

/** Chat: the filter chips, the window of rows, the sends not in the state yet, the composer. */
export function chatTab(kit: Kit, state: WebStateV2, files: V2Files, view2: DeckView2, actions: DashActions, isDemo: boolean): RenderElement {
  const { Box, Button } = kit
  const filter = view2.chatFilter
  const rows = state.chat.filter(row => passes(row, filter))
  const want = Math.min(MOST, view.shown.get(filter) ?? PAGE)
  const held = new Set(state.needs.map(need => need.id))
  // the newest rows first, while the window and the pane's room for them last
  const drawn: RenderElement[] = []
  let nodes = 0
  let isFull = false
  for (let i = rows.length - 1; i >= 0 && drawn.length < want; i--) {
    const row = rows[i]
    if (!row) continue
    const one = chatRow(kit, state, files, row, held, actions)
    nodes += nodesOf(one)
    if (nodes > ROW_NODES && drawn.length > 0) {
      isFull = true
      break
    }
    drawn.unshift(one)
  }
  const earlier = rows.length - drawn.length
  // a send the state holds now (its row, or its ack) is drawn there, not here
  view.sends = view.sends.filter(send => !state.chat.some(row => row.ackId === send.id) && !state.acks.some(ack => ack.id === send.id)).slice(-10)
  const pending = view.sends.filter(send => filter === '' || filter === 'you' || filter === send.to)
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
      {drawn.length === 0 && pending.length === 0 ? quiet(kit, filter === '' ? 'Nothing said yet: your prompts, Claude’s answers and what its agents say to each other show here.' : 'Nothing under this filter yet.') : null}
      {drawn}
      {pending.map(send => sendRow(kit, send, state.now))}
      {composer(kit, state, view2, actions, isDemo)}
    </Box>
  )
}

/** The chips: `f` (Filter) steps to the next, a chip picks its own; the one set lit, the rest dim. */
function filterRow(kit: Kit, state: WebStateV2, filter: string, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  const list = filtersOf(state, filter)
  const pick = (id: string) => actions.setV2View({ chatFilter: id })
  return (
    <Box key="chat:filters" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {keyButton(kit, 'key:f', 'f', 'Filter', () => pick(nextFilter(state, filter)))}
      {list.map(one => (
        <Button key={`chat:filter:${one.id || 'all'}`} label={one.label} plain dimColor={one.id !== filter} onPress={() => pick(one.id)} />
      ))}
    </Box>
  )
}

/** One message as a sentence: who to whom (and its own title), its words, its time; what came of a send under it. */
function chatRow(kit: Kit, state: WebStateV2, files: V2Files, row: V2ChatRow, held: ReadonlySet<string>, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const advance = advanceOf(kit)
  const time = ago(row.at, state.now)
  const isHeld = row.kind === 'question' && row.callId !== undefined && held.has(row.callId)
  const head = `${row.who}:`
  const title = row.title ? clean(row.title) : ''
  const isOpen = view.opened.has(row.id)
  const words = clean(row.text)
  const line = flat(words)
  // a short message on one line reads as the sentence it is: "builder → reviewer: text"
  const room = kit.columns - cellsOf(`${head}  ${time}`, advance) - (title ? cellsOf(` ${title} ·`, advance) : 0) - 4
  const isInline = !isOpen && row.isCut !== true && !words.includes('\n') && cellsOf(line, advance) <= room
  const whoColor = row.from === 'you' ? P.runText : row.from === 'engine' ? P.muted : P.text
  return (
    <Box key={`msg:${row.id}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap={isInline ? 'wrap' : 'truncate-end'}>
            <Text bold color={whoColor}>
              {head}
            </Text>
            {title ? <Text color={P.muted}>{` ${title}${isInline ? ' ·' : ''}`}</Text> : null}
            {isInline ? <Text color={P.fg2}> </Text> : null}
            {isInline ? ticked(kit, line, P.fg2) : null}
            {isHeld ? <Text color={P.waitText}>  waiting on you</Text> : null}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={P.muted2}>{time}</Text>
        </Box>
      </Box>
      {isInline ? null : bodyOf(kit, files, row, words, actions)}
      {noteOf(kit, state, row)}
    </Box>
  )
}

/**
 * A message's words under its head: folded to a few lines, with Show more
 * when there is more (or the state cut it); open, as Markdown, its whole
 * text read once (and kept), then Show less.
 */
function bodyOf(kit: Kit, files: V2Files, row: V2ChatRow, words: string, actions: DashActions): RenderElement {
  const { Box, Text, Button, Markdown } = kit
  const key = `msg:${row.id}`
  const isOpen = view.opened.has(row.id)
  // the whole text while the deck holds it (or the sample's file), else as read from its file
  const held = row.isCut === true && isOpen ? files.message(row.id) : null
  const whole: Whole | undefined = held !== null ? { status: 'ok', text: held } : view.wholes.get(row.id)
  const folded = foldText(words, kit.columns - 2, FOLD_ROWS)
  const hasMore = folded.isCut || row.isCut === true
  const read = () => {
    view.wholes.set(row.id, { status: 'loading', text: '' })
    actions.loadMessage(row.id, said => {
      view.wholes.set(row.id, said === null ? { status: 'error', text: '' } : { status: 'ok', text: said })
      actions.reveal(key, 'nearest')
    })
  }
  const open = () => {
    view.opened.add(row.id)
    if (row.isCut === true && files.message(row.id) === null && (!whole || whole.status === 'error')) read()
    actions.redraw()
  }
  const fold = () => {
    view.opened.delete(row.id)
    actions.redraw()
  }
  const shown = isOpen ? cut(row.isCut === true && whole?.status === 'ok' ? whole.text : words, WHOLE_MOST) : folded.text
  const more = !hasMore ? null : isOpen && row.isCut === true && whole?.status === 'loading' ? (
    <Text color={P.muted2}>Loading the rest…</Text>
  ) : isOpen && row.isCut === true && whole?.status === 'error' ? (
    <Text color={P.failText}>The rest is not on disk.</Text>
  ) : (
    <Box flexDirection="row">
      <Button key={`chat:more:${row.id}`} label={isOpen ? 'Show less' : 'Show more'} plain dimColor onPress={isOpen ? fold : open} />
    </Box>
  )
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {isOpen ? (
        <Markdown text={shown} />
      ) : (
        <Text wrap="wrap">{ticked(kit, shown, P.fg2)}</Text>
      )}
      {more}
    </Box>
  )
}

/** Under a send from the deck, what came of it; under a SendMessage Claude Code said it could not deliver, that. */
function noteOf(kit: Kit, state: WebStateV2, row: V2ChatRow): RenderElement | null {
  const { Text, Box } = kit
  const ack = row.ackId ? ackOf(state, row.ackId) : undefined
  const line = ack ? ackLine(ack) : row.isDelivered === false ? { mark: '✕', hue: P.failText, text: 'Not delivered' } : null
  if (!line) return null
  return (
    <Box paddingLeft={2}>
      <Text wrap="wrap">
        <Text color={line.hue}>{`${line.mark} `}</Text>
        <Text color={line.hue === P.failText ? P.failText : P.muted}>{line.text}</Text>
      </Text>
    </Box>
  )
}

/** A send of this pane's the state does not hold yet: its sentence, then "Sending…" (or, after a while, that no word came). */
function sendRow(kit: Kit, send: Send, now: number): RenderElement {
  const { Box, Text } = kit
  const isLate = now - send.at > ACK_WAIT
  return (
    <Box key={`send:${send.id}`} flexDirection="column">
      <Text wrap="wrap">
        <Text bold color={P.runText}>{`${send.who}:`}</Text>
        <Text color={P.fg2}>{` ${flat(send.text)}`}</Text>
      </Text>
      <Box paddingLeft={2}>
        <Text color={P.muted}>{isLate ? '◷ Sent, but Claude Code hasn’t confirmed it' : '◐ Sending…'}</Text>
      </Box>
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
 * with an ack id and shows at once; the field starts empty again. In the
 * sample nothing is sent, and the words stay.
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
    view.draft = ''
    view.field += 1
    view.refusal = ''
    actions.sendChat(to.agentId, to.text, ackId)
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
