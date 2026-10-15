/**
 * An agent page's Talk, as the web deck's thread draws it (web/app.js
 * `TalkTab`, `Message`, `MessageText`, `sendNoteOf`, `Composer`): the
 * messages to and from the agent, oldest first, as chat bubbles, then the
 * box that sends.
 *
 * - Others' messages, on the left: the sender's avatar, its name in bold,
 *   what the message was in the web's words ("delegated", "reported back",
 *   "message", "chat", "replied", "asked you"; "to <name>" after it when
 *   the agent itself wrote to another, "chat to you"; "asks you" while its
 *   question is held on you) and when; under them its words in a rounded,
 *   bordered box on a dark ground: Markdown for a brief, a report (its edge
 *   green) and the Orchestrator's answer, plain text for the rest.
 * - A question: its words in bold beside a question mark, the box amber
 *   while the question is held on you, with "Answer it above ↑" (the card
 *   above the tabs) or where to answer it.
 * - Yours, on the right: "You" and when, then a blue bubble at most three
 *   quarters of the pane wide; how you answered a question in a dark bubble
 *   with a green ✓. Under a message sent from the deck (here or the web
 *   page), what came of it, from the state's `acks` by its `ackId`, as the
 *   web words it: "Sending…", "Queued: …", "Delivered: …", "Not delivered:
 *   …"; dim once the agent replied after it, where the web lets it go.
 * - A message the state cut (`isCut`) ends in Show more, which reads its
 *   whole text as the web's `/message/<id>` serves it (DashActions
 *   `loadMessage`) and brings it into view; Show less folds it again.
 * - The newest 24 show; "Show n earlier" pages back.
 * - The box: an Input and Send, the deck's own send (`sendChat`) with an
 *   ack id, so the message shows at once, "Sending…" until the mod says
 *   what came of it; how the agent reads it under them. Sending, or opening
 *   Talk with a press, takes the pane to its end (DashActions `followTalk`).
 *
 * Pure: Kit, the state and DashActions come from the hooks module; what is
 * open, the texts read, the drafts and the sends not yet in the state are
 * this module's own, kept while it lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView } from '../../../types'
import { clean } from '../../format'
import type { WebAck, WebAgent, WebPending, WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentOf, ago, cut, isAnswerable, isLive, nameOf } from './dashModel'
import { P, mix } from './palette'
import { AVATAR, avatar, icon, quiet } from './parts'

type Message = WebState['messages'][number]

/** A message sent from this page that the state may not hold yet: the command id its ack comes under, the words, when (0 until the next drawing stamps it). */
type Send = { id: string; text: string; at: number }

/** A cut message's whole text, as read: on its way, read, or not to be had. */
type Whole = { status: 'loading' | 'ok' | 'error'; text: string }

/** What came of a message you sent, under it: a mark and words in a status's hue; `isSettled` once the agent replied after it (drawn dim). */
export type SendNote = { mark: string; tone: 'run' | 'wait' | 'done' | 'fail' | 'idle'; text: string; isSettled: boolean }

/** The messages a thread shows at first, and the more each "Show earlier" adds. */
const PAGE = 24
/** The characters of words a thread draws at most, so the page keeps inside the pane's room. */
const BUDGET = 40_000
/** The most of a whole text drawn once read. */
const WHOLE_MOST = 12_000
/** How long a send waits for its ack before saying none came, as the web's. */
const ACK_WAIT = 20_000
/** The longest message the deck takes. */
const MOST_TEXT = 4000

/** The kinds drawn as Markdown, as the web's: a brief, a report, the Orchestrator's answer. */
const MARKDOWN: ReadonlySet<string> = new Set(['result', 'spawn', 'answer'])
/** What each kind of message was, as the web words it. */
const KIND_LABEL: Readonly<Record<string, string>> = { prompt: 'prompt', spawn: 'delegated', result: 'reported back', message: 'message', chat: 'chat', answer: 'replied', question: 'asked you' }

/** The web's grounds and edges, flattened: a message's box, a report's green edge, a held question's amber, your choice's edge, your bubble. */
const CARD = '#1d1d1d'
const RESULT_EDGE = mix(P.card, P.done, 0.3)
const HELD_EDGE = mix(P.card, P.wait, 0.4)
const HELD_GROUND = mix(CARD, P.wait, 0.06)
const CHOICE_EDGE = mix(P.card, '#ffffff', 0.16)
const BLUE = '#2563eb'
const ON_BLUE = '#ffffff'
const ON_BLUE_DIM = '#dbeafe'
const HELD_GO = '#fde68a'
const HELD_WHERE = mix(P.card, '#fde68a', 0.68)
const NOTE_HUE: Readonly<Record<SendNote['tone'], string>> = { run: P.runText, wait: P.waitText, done: P.doneText, fail: P.failText, idle: P.muted2 }

// What this module keeps while it lives.

const opened = new Set<string>()
const wholes = new Map<string, Whole>()
const drafts = new Map<string, string>()
/** Each agent's field, counted up at each send: a new field is an empty one. */
const fields = new Map<string, number>()
const outbox = new Map<string, Send[]>()
const shownMost = new Map<string, number>()
let sends = 0

/** The agent's thread, as the web's: every message from it or to it, oldest first. */
export function threadOf(state: WebState, agentId: string): Message[] {
  return state.messages.filter(message => message.from === agentId || message.to === agentId)
}

/** One entry of a thread: a message the state holds, or a send of this page's it does not hold yet; each with its key. */
type Entry = { key: string; message: Message | null; send: Send | null }

/**
 * The thread with this page's sends: each message, keyed by its id (one of
 * yours that went with an ack id by that id, so the bubble that said
 * "Sending…" turns into it in place), then the sends the state does not
 * hold yet.
 */
function entriesOf(state: WebState, agentId: string): Entry[] {
  const messages = threadOf(state, agentId)
  const mine = outbox.get(agentId) ?? []
  const byId = new Map(mine.map(send => [send.id, send]))
  const taken = new Set<string>()
  const entries: Entry[] = messages.map(message => {
    const ackKey = message.from === 'you' && message.ackId ? `msg:out:${message.ackId}` : ''
    const key = ackKey && !taken.has(ackKey) ? ackKey : `msg:${message.id}`
    taken.add(key)
    return { key, message, send: message.ackId ? (byId.get(message.ackId) ?? null) : null }
  })
  const held = new Set(messages.map(message => message.ackId).filter(Boolean))
  for (const send of mine) if (!held.has(send.id) && !taken.has(`msg:out:${send.id}`)) entries.push({ key: `msg:out:${send.id}`, message: null, send })
  return entries
}

/** What a thread ends with, as one string: its length, its last entry's key and that one's ack. A change says something new is at its end. */
export function talkEndOf(state: WebState, agentId: string): string {
  const entries = entriesOf(state, agentId)
  const last = entries[entries.length - 1]
  if (!last) return ''
  const id = last.send?.id ?? last.message?.ackId ?? ''
  const ack = id ? ackOf(state, id) : undefined
  return `${entries.length}|${last.key}|${ack ? `${ack.status}:${ack.text}` : ''}`
}

/** What a message was, as the web words it after its sender's name: its kind's word ("asks you" while its question is held), and to whom when the agent itself wrote to another or to you. */
export function kindLabelOf(state: WebState, message: Message, agentId: string, isHeld: boolean): string {
  const label = isHeld ? 'asks you' : (KIND_LABEL[message.kind] ?? message.kind)
  if (message.from !== agentId || message.kind === 'answer' || message.kind === 'question') return label
  return `${label} ${message.to === 'you' ? 'to you' : `to ${nameOf(state, message.to)}`}`
}

/** The last word on command `id` in the state's acks: a later one replaces an earlier one. */
function ackOf(state: WebState, id: string): WebAck | undefined {
  for (let i = state.acks.length - 1; i >= 0; i--) {
    const ack = state.acks[i]
    if (ack?.id === id) return ack
  }
  return undefined
}

/** "It reads it…" reads "it reads it…" after a colon; a name ("Claude reads it…") keeps its capital. */
function softText(text: string): string {
  return String(text || '')
    .trim()
    .replace(/^(It|Its|The|This|That|They|There|A|An|No|Not|Nothing|Only|Too|Could|Already)\b/, word => word.toLowerCase())
}

/** `word: text`, unless the text starts with that word already ("Not delivered" said twice never). */
function lead(word: string, text: string): string {
  return text.toLowerCase().startsWith(word.toLowerCase()) ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : `${word}: ${text}`
}

/** What an ack says under the message it came of, as the web's `ackState` words a chat's: Not delivered, Answered, Delivered or Queued, and the mod's words. */
export function ackLineOf(ack: WebAck): Omit<SendNote, 'isSettled'> {
  const text = softText(ack.text)
  if (!ack.ok || ack.status === 'failed') return { mark: '✕', tone: 'fail', text: lead('Not delivered', text || 'Claude Code refused it') }
  if (ack.status === 'answered') return { mark: '✓', tone: 'done', text: lead('Answered', text || 'Claude carries on') }
  if (ack.status === 'delivered') return { mark: '✓', tone: 'done', text: lead('Delivered', text || 'it reads it at its next step') }
  return { mark: '◷', tone: 'wait', text: lead('Queued', text || 'Claude reads it when it finishes its current turn') }
}

/**
 * The note under a message of yours, or null: its ack's words (a choice
 * has none: its bubble says how it was answered); a send of this page's
 * not acked yet "Sending…", or after a while that none came. A failure
 * always shows; any other word is settled (drawn dim) once the agent
 * replied after the message.
 */
export function sendNoteOf(state: WebState, agentId: string, message: Message | null, send: Send | null, now: number): SendNote | null {
  if (message?.kind === 'choice') return null
  const id = send?.id ?? message?.ackId ?? ''
  if (id === '') return null
  const ack = ackOf(state, id)
  if (ack) {
    const line = ackLineOf(ack)
    const at = message?.at ?? send?.at ?? now
    const isSettled = line.tone !== 'fail' && state.messages.some(one => one.from === agentId && one.to === 'you' && one.at > at)
    return { ...line, isSettled }
  }
  if (!send) return null
  if (send.at === 0 || now - send.at < ACK_WAIT) return { mark: '◐', tone: 'run', text: 'Sending…', isSettled: false }
  return { mark: '◷', tone: 'idle', text: "Sent, but Claude Code hasn't confirmed it", isSettled: false }
}

/** The characters an entry draws: its words, or its whole text once opened and read. */
function costOf(entry: Entry): number {
  const message = entry.message
  if (!message) return Array.from(entry.send?.text ?? '').length
  const whole = message.isCut && opened.has(message.id) ? wholes.get(message.id) : undefined
  return Math.min(WHOLE_MOST, Array.from(whole?.status === 'ok' ? whole.text : message.text).length)
}

/**
 * The tab: "Show n earlier" while older messages are left out; the newest
 * messages (24, more as you page back; fewer when the words would pass the
 * pane's room), each a bubble; then the box that sends.
 */
export function talkTab(kit: Kit, state: WebState, agent: WebAgent, view: DeckView, actions: DashActions, now: number): RenderElement {
  const { Box, Button } = kit
  // a send made since the last drawing takes this drawing's time: its "Sending…" waits from here
  for (const send of outbox.get(agent.id) ?? []) if (send.at === 0) send.at = now
  const entries = entriesOf(state, agent.id)
  const most = shownMost.get(agent.id) ?? PAGE
  let from = entries.length
  let room = BUDGET
  while (from > 0 && entries.length - from < most) {
    const cost = costOf(entries[from - 1] as Entry)
    if (from < entries.length && cost > room) break
    room -= cost
    from -= 1
  }
  const isRoomCut = from > 0 && entries.length - from < most
  const more = () => {
    shownMost.set(agent.id, most + PAGE)
    actions.redraw()
  }
  return (
    <Box key="page:talk" flexDirection="column" gap={1}>
      {from > 0 && !isRoomCut ? (
        <Box flexDirection="row">
          <Button key={`talk:earlier:${agent.id}`} label={`Show ${Math.min(PAGE, from)} earlier`} plain dimColor onPress={more} />
        </Box>
      ) : null}
      {isRoomCut ? quiet(kit, `${from} earlier ${from === 1 ? 'message is' : 'messages are'} left out, to fit the pane.`) : null}
      {entries.length === 0 ? quiet(kit, `No messages with ${agent.label} yet.`) : null}
      {entries.slice(from).map(entry => (entry.message && entry.message.from !== 'you' ? theirs(kit, state, agent, entry.message, entry.key, actions, now) : mine(kit, state, agent, entry, actions, now)))}
      {composer(kit, agent, view, actions, now)}
    </Box>
  )
}

/** How an avatar and the gap after it indent the words under a name: the terminal's dot, a desktop's 20 px face. */
function indentOf(kit: Kit): number {
  return kit.surface === 'terminal' ? 2 : 3
}

/** Someone else's message: avatar, name, what it was and when; under them its words in a bordered dark box (a held question's amber, a report's edge green). */
function theirs(kit: Kit, state: WebState, agent: WebAgent, message: Message, key: string, actions: DashActions, now: number): RenderElement {
  const { Box, Text } = kit
  const sender = agentOf(state, message.from)
  const name = sender ? sender.label : nameOf(state, message.from)
  const held = message.kind === 'question' && message.callId ? state.pending.find(item => item.id === message.callId && item.kind === 'question') : undefined
  const edge = held ? HELD_EDGE : message.kind === 'result' ? RESULT_EDGE : P.border
  return (
    <Box key={key} flexDirection="column">
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexShrink={0}>{avatar(kit, sender ? sender.avatar : null, AVATAR.row, name)}</Box>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color={P.text}>
              {name}
            </Text>
            <Text color={P.muted2}>{`  ${kindLabelOf(state, message, agent.id, held !== undefined)}  ${ago(message.at, now)}`}</Text>
          </Text>
        </Box>
      </Box>
      <Box flexDirection="row" paddingLeft={indentOf(kit)}>
        <Box width="88%" flexDirection="column" alignItems="flex-start">
          <Box flexDirection="column" borderStyle="round" borderColor={edge} backgroundColor={held ? HELD_GROUND : CARD} paddingX={1}>
            {message.kind === 'question' ? questionBody(kit, message, key, held, actions) : wordsOf(kit, message, key, MARKDOWN.has(message.kind) ? 'markdown' : 'plain', actions)}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

/** A question in the thread: a question mark (amber while it is held), its words in bold, and where to answer it while it is held: above, on its card, or in Claude Code. */
function questionBody(kit: Kit, message: Message, key: string, held: WebPending | undefined, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const hue = held ? P.waitText : P.muted
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        {icon(kit, 'help', hue, 14) ?? (
          <Text bold color={hue}>
            ?
          </Text>
        )}
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        {wordsOf(kit, message, key, 'question', actions)}
        {held && isAnswerable(held) ? (
          <Box flexDirection="row">
            <Button key={`msg:answer:${message.id}`} plain onPress={() => actions.reveal(`needs:${held.id}`, 'start')}>
              <Text color={HELD_GO}>Answer it above ↑</Text>
            </Button>
          </Box>
        ) : null}
        {held && !isAnswerable(held) ? <Text color={HELD_WHERE}>Answer it in Claude Code.</Text> : null}
      </Box>
    </Box>
  )
}

/** How a message's words are drawn: Markdown, plain words in a box, a question's bold words, or your words on the blue bubble. */
type WordsMode = 'markdown' | 'plain' | 'question' | 'bubble'

/**
 * A message's words as `mode` draws them; one the state cut ends in Show
 * more, which reads its whole text once (cached) and brings the message
 * into view, then Show less; "Loading the rest…" while it is read, and why
 * not with Retry when it cannot be.
 */
function wordsOf(kit: Kit, message: Message, key: string, mode: WordsMode, actions: DashActions): RenderElement[] {
  const { Box, Text, Button, Markdown } = kit
  const isOpen = message.isCut === true && opened.has(message.id)
  const whole = isOpen ? wholes.get(message.id) : undefined
  const text = clean(whole?.status === 'ok' ? cut(whole.text, WHOLE_MOST) : message.text)
  const words =
    mode === 'markdown' ? (
      <Markdown text={text} />
    ) : (
      <Text bold={mode === 'question'} color={mode === 'bubble' ? ON_BLUE : mode === 'question' ? P.text : P.fg2} wrap="wrap">
        {text}
      </Text>
    )
  if (message.isCut !== true) return [words]
  const read = () => {
    wholes.set(message.id, { status: 'loading', text: '' })
    actions.loadMessage(message.id, said => {
      wholes.set(message.id, said === null ? { status: 'error', text: '' } : { status: 'ok', text: said })
      actions.reveal(key, 'nearest')
    })
  }
  const open = () => {
    opened.add(message.id)
    const known = wholes.get(message.id)
    if (!known || known.status === 'error') read()
    else if (known.status === 'ok') actions.reveal(key, 'nearest')
    actions.redraw()
  }
  const fold = () => {
    opened.delete(message.id)
    actions.redraw()
  }
  const hue = mode === 'bubble' ? ON_BLUE_DIM : P.muted
  const more =
    isOpen && whole?.status === 'loading' ? (
      <Text color={hue}>Loading the rest…</Text>
    ) : isOpen && whole?.status === 'error' ? (
      <Box flexDirection="row" columnGap={1}>
        <Text color={mode === 'bubble' ? ON_BLUE : P.failText}>The rest is not on disk.</Text>
        <Button
          key={`msg:retry:${message.id}`}
          plain
          onPress={() => {
            read()
            actions.redraw()
          }}
        >
          <Text color={hue}>Retry</Text>
        </Button>
      </Box>
    ) : (
      <Box flexDirection="row">
        <Button key={`msg:more:${message.id}`} plain onPress={isOpen ? fold : open}>
          <Text color={hue}>{isOpen ? 'Show less' : 'Show more'}</Text>
        </Button>
      </Box>
    )
  return [words, more]
}

/** One of yours on the right: "You" (and "prompt" for a prompt) and when; your words on the blue bubble, or how you answered in a dark one with a green ✓; what came of it under them. */
function mine(kit: Kit, state: WebState, agent: WebAgent, entry: Entry, actions: DashActions, now: number): RenderElement {
  const { Box, Text } = kit
  const message = entry.message
  const send = entry.send
  const label = message && message.to !== agent.id ? `to ${nameOf(state, message.to)}` : message?.kind === 'prompt' ? 'prompt' : ''
  const at = message?.at || send?.at || now
  const note = sendNoteOf(state, agent.id, message, send, now)
  const isChoice = message?.kind === 'choice'
  // what was sent from here is whole on the page already, even where the state cut it
  const words = send ? (
    <Text color={ON_BLUE} wrap="wrap">
      {clean(send.text)}
    </Text>
  ) : message ? (
    wordsOf(kit, message, entry.key, 'bubble', actions)
  ) : null
  return (
    <Box key={entry.key} flexDirection="column" alignItems="flex-end">
      <Text wrap="truncate-end">
        <Text bold color={P.text}>
          You
        </Text>
        <Text color={P.muted2}>{`${label ? `  ${label}` : ''}  ${ago(at, now)}`}</Text>
      </Text>
      <Box width="75%" flexDirection="column" alignItems="flex-end">
        {isChoice && message ? (
          <Box flexDirection="row" columnGap={1} borderStyle="round" borderColor={CHOICE_EDGE} backgroundColor={CARD} paddingX={1}>
            <Box flexShrink={0}>{icon(kit, 'circleCheck', P.doneText, 14) ?? <Text color={P.doneText}>✓</Text>}</Box>
            <Box flexShrink={1}>
              <Text color={P.text} wrap="wrap">
                {clean(message.text)}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" backgroundColor={BLUE} paddingX={1}>
            {words}
          </Box>
        )}
        {note ? noteLine(kit, note) : null}
      </Box>
    </Box>
  )
}

/** What came of a message of yours: its mark in its status's hue and the words, red when it failed; both dim once settled. */
function noteLine(kit: Kit, note: SendNote): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Text color={note.isSettled ? P.muted2 : NOTE_HUE[note.tone]}>{note.mark}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text color={note.isSettled ? P.muted2 : note.tone === 'fail' ? P.failText : P.muted} wrap="wrap">
          {note.text}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * The box that sends: an Input and Send, then how the agent reads what you
 * send, as the web words it. A send goes through the deck's own `sendChat`
 * with an ack id; it shows at once, "Sending…" until its ack, and the field
 * starts empty again. In the sample nothing is sent, and the words stay.
 */
function composer(kit: Kit, agent: WebAgent, view: DeckView, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button, Input } = kit
  const id = agent.id
  if (agent.kind === 'peer') return quiet(kit, 'Only the Orchestrator, its agents and teammates take messages from here.')
  if (!Input) return quiet(kit, `Message ${agent.label} from the Claude Code conversation: this surface has no field to type in.`)
  const n = fields.get(id) ?? 0
  const send = (text: string) => {
    const said = text.trim().slice(0, MOST_TEXT)
    if (said === '') return
    if (view.isDemo) {
      actions.sendChat(id, said)
      return
    }
    sends += 1
    const ackId = `t${now.toString(36)}${sends.toString(36)}`
    const box = [...(outbox.get(id) ?? []), { id: ackId, text: said, at: 0 }]
    outbox.set(id, box.slice(-20))
    drafts.delete(id)
    fields.set(id, n + 1)
    actions.sendChat(id, said, ackId)
    actions.followTalk()
  }
  const hint =
    agent.kind === 'orchestrator'
      ? isLive(agent.status)
        ? 'Claude reads it when it finishes its current turn.'
        : 'Goes to Claude Code as your next prompt.'
      : isLive(agent.status)
        ? 'It reads it at its next step; nothing is interrupted.'
        : 'Resumes the agent to answer.'
  return (
    <Box key="talk:composer" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1}>
          <Input
            key={n === 0 ? `chat:${id}` : `chat:${id}:${n}`}
            placeholder={`Message ${agent.label}…`}
            value={drafts.get(id) ?? ''}
            submitLabel="send"
            onInput={text => {
              drafts.set(id, text)
            }}
            onSubmit={send}
          />
        </Box>
        <Box flexShrink={0}>
          <Button key={`talk:send:${id}`} label="Send" variant="primary" onPress={() => send(drafts.get(id) ?? '')} />
        </Box>
      </Box>
      <Text color={P.muted2} wrap="wrap">
        {hint}
      </Text>
    </Box>
  )
}
