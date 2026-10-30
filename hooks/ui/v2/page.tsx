/**
 * An agent's page, over the tab it was opened from (`b` goes back), laid out
 * as the web page's drawer: its head (its avatar and name, its type, model
 * and kind, Back at its right), its facts (its status, how long, who started
 * it, its tokens, its short id), Message and "Chat with <agent>", its Stop,
 * what it waits on you for (./needs), its live call verbatim (else, while it
 * is at work, the words it said since its latest call), its task (the
 * prompt it was given), its own TodoWrite list, its result and when it
 * handed it back, its Activity (a log of its latest tool calls, newest
 * first, each opening on all of it, and by default the words and thinking
 * between them, from its lazy agent file, `v2Files.agent(fileId)`), its
 * Edits (its own patches by file, the newest open on its newest edit, each
 * edit and the call that made it a press apart), and a composer whose words
 * go to it. "Chat with <agent>" is Chat with that agent picked in its member
 * list, so the composer there sends to it with no `@`.
 *
 * Pure: Kit, the state, its lazy files and DashActions come from the hooks
 * module; what is folded or opened, and the composer's words, are this
 * module's own.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { hunksOf } from '../../diff'
import { clean } from '../../format'
import { MAIN, ORCHESTRATOR } from '../../model'
import { agentLogOf, type V2AgentFile, type V2AgentRow, type V2Changes, type V2Files, type V2LogEntry, type V2Word, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { chevron, chevronCells, editGroupsOf, editsRow, type EditGroup } from './changes'
import { ackLine, composerKey, viaText } from './chat'
import { isAiry, listBox } from './dash'
import { ticks, unmarked } from './dashModel'
import { diffBlocks, editBlock, titleOf, type Budget } from './diffs'
import { AVATAR, advanceOf, avatar, glyph, icon, keyButton, quiet, svgOf, toolTag, toolTagCells, wordMark } from './look'
import { needsSection } from './needs'
import { P } from './palette'
import { face, plainSlack, rule, veil, wordParts } from './parts'
import { pageStop } from './stop'
import { ago, cellsOf, cut, cutCells, flat, foldText, msText, num, plural } from './text'

/** What a press changed on each page while the module lives, by agent id and part: a part folded or unfolded, a call, a file or an edit opened or shut. What no press changed reads as its default. */
const pressed = new Map<string, boolean>()

function isOpen(id: string, part: string, byDefault: boolean): boolean {
  return pressed.get(`${id}|${part}`) ?? byDefault
}

function setOpen(id: string, part: string, open: boolean): void {
  pressed.set(`${id}|${part}`, open)
}

function toggler(id: string, part: string, byDefault: boolean, actions: DashActions): () => void {
  return () => {
    setOpen(id, part, !isOpen(id, part, byDefault))
    actions.redraw()
  }
}

/** The rows a folded task or result shows. */
const FOLD_ROWS = 4

/** What one drawing of a page spends on diffs: its characters, and the numbered lines a desktop draws of its own (each a few elements) before the engine's diff block draws the rest. */
const DIFF_CHARS = 30_000
const NUMBERED_ROWS = 120

/**
 * The agent page for row `id`; a quiet line and Back when the state holds
 * no such agent. `activityView` is the view's pick for its Activity ("Calls
 * only", else with their words); in the sample (`isDemo`) its composer
 * sends nothing.
 */
export function agentPage(kit: Kit, state: WebStateV2, files: V2Files, id: string, actions: DashActions, activityView?: DeckView2['activityView'], isDemo = false): RenderElement {
  const { Box } = kit
  const row = state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === id)
  if (!row) {
    return (
      <Box key="page" flexDirection="column" gap={1}>
        <Box flexDirection="row">{backButton(kit, actions)}</Box>
        {quiet(kit, 'That agent is not in this session’s state any more.')}
      </Box>
    )
  }
  const file = files.agent(row.fileId)
  const budget: Budget = { chars: DIFF_CHARS, rows: NUMBERED_ROWS }
  return (
    <Box key={`page:${row.id}`} flexDirection="column" gap={1}>
      {head(kit, state, row, actions)}
      {actionsLine(kit, row, actions)}
      {pageStop(kit, row, actions, state)}
      {row.live ? liveLine(kit, state, row) : row.said ? saidLine(kit, state, row) : null}
      {needsSection(kit, state, state.needs.filter(need => need.agent === row.id), actions, 'page')}
      {textPart(kit, row, 'task', 'Task', '', file?.task || row.task, false, actions)}
      {todosPart(kit, file?.todos ?? row.todos)}
      {textPart(kit, row, 'result', resultTitleOf(row), row.endedAt ? agoText(row.endedAt, state.now) : '', file?.result || row.result, true, actions)}
      {activityPart(kit, state, files, row, file, activityView, budget, actions)}
      {editsPart(kit, state, files, row, file, budget, actions)}
      {composerPart(kit, state, row, isDemo, actions)}
    </Box>
  )
}

/** Back (`b`), as the web drawer's close: a plain Button at full strength. */
function backButton(kit: Kit, actions: DashActions): RenderElement {
  return keyButton(kit, 'key:b', 'b', '← Back', () => actions.back(), false)
}

/** What its result is called, as the web's drawer calls it: the Orchestrator's latest answer; a failed agent's "Result · failed". */
function resultTitleOf(row: V2AgentRow): string {
  if (row.id === MAIN) return 'Latest answer'
  return row.status === 'failed' && !row.isStopped ? 'Result · failed' : 'Result'
}

/** How long ago, as the web's notes say it: "4h ago", "just now"; '' with no time. */
export function agoText(at: number, now: number): string {
  const age = ago(at, now)
  return age === 'now' ? 'just now' : age ? `${age} ago` : ''
}

/** What the Orchestrator and Claude Code's own loops are where they have no type: as the web's KIND_WORD. */
const KIND_WORD: Readonly<Record<V2AgentRow['kind'], string>> = { orchestrator: 'main loop', agent: 'agent', teammate: 'teammate', workflow: 'workflow', engine: 'Claude Code' }

/** Its status in its hue's ink, as the web's facts colour it; a stopped one grey. */
const STATUS_INK: Readonly<Record<string, string>> = { running: P.runText, starting: P.runText, waiting: P.waitText, done: P.doneText, failed: P.failText }

/** The face of whoever started it, beside "started by". */
const PARENT_FACE = 16

/**
 * Who it is, as the web drawer's head: its avatar (its status dot, moving),
 * its name, under it its type, model and kind ("general-purpose · opus-5.5 ·
 * background"), and Back at the right. Then its facts on a line of their own:
 * its status in its hue, how long, "started by" and who (a press opens that
 * page), its tokens, its short id.
 */
function head(kit: Kit, state: WebStateV2, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const kind = row.kind === 'teammate' ? 'teammate' : row.background ? 'background' : ''
  const sub = [row.type || KIND_WORD[row.kind], row.model, kind].filter(one => one !== '').join(' · ')
  return (
    <Box key="page:head" flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexShrink={0}>{avatar(kit, row, AVATAR.page, { dot: true, animated: true })}</Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text bold color={P.text} wrap="truncate-end">
            {row.title}
          </Text>
          {sub ? (
            <Text color={P.muted2} wrap="truncate-end">
              {sub}
            </Text>
          ) : null}
        </Box>
        <Box flexShrink={0}>{backButton(kit, actions)}</Box>
      </Box>
      {factsLine(kit, state, row, actions)}
    </Box>
  )
}

/** "● done <1m · started by [face] Orchestrator · 113k tokens · aefbbb6": each fact that it has, apart by a dim dot, wrapping where the pane is narrow. */
function factsLine(kit: Kit, state: WebStateV2, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const word = row.isStopped ? 'stopped' : row.status === 'waiting' ? 'waiting on you' : row.status
  const ink = row.isStopped ? P.muted : (STATUS_INK[row.status] ?? P.muted)
  const parent = row.parent ? state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === row.parent) : undefined
  const facts: RenderElement[] = [
    <Box flexShrink={0} flexDirection="row" columnGap={1}>
      <Text color={ink}>{`● ${word}`}</Text>
      {row.elapsed ? <Text color={P.muted2}>{row.elapsed}</Text> : null}
    </Box>,
  ]
  if (row.parent) {
    facts.push(
      <Box flexShrink={0} flexDirection="row" columnGap={1} alignItems="center">
        <Text color={P.muted2}>started by</Text>
        <Box flexShrink={0}>{face(kit, parent ?? null, PARENT_FACE)}</Box>
        <Button key={`page:parent:${row.parent}`} label={titleOf(state, row.parent)} plain dimColor onPress={() => actions.openAgent(row.parent ?? MAIN)} />
      </Box>,
    )
  }
  if (row.tokens > 0) facts.push(<Text color={P.muted2}>{`${num(row.tokens)} tokens`}</Text>)
  if (row.shortId) facts.push(<Text color={P.muted2}>{row.shortId}</Text>)
  return (
    <Box key="page:facts" flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
      {facts.flatMap((fact, i) => [i > 0 ? <Text color={P.muted3}>·</Text> : null, fact])}
    </Box>
  )
}

/**
 * Message and "Chat with <agent>", as the web drawer's buttons: Message takes
 * the focus to the composer at the page's foot (words there go to it);
 * Chat with opens Chat with it picked in the member list (words with no `@`
 * go to it), the focus on Chat's composer. Each with its icon beside it
 * where Svg draws.
 */
function actionsLine(kit: Kit, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  const hasSvg = svgOf(kit) !== undefined
  const message = () => {
    actions.reveal('page:compose', 'nearest')
    actions.focusNext(1, [pageComposerKey(row.id)])
  }
  const chat = () => {
    actions.setV2View({ tab: 'chat', chatFilter: row.id })
    actions.back()
    actions.focusNext(1, [composerKey()])
  }
  return (
    <Box key="page:actions" flexDirection="row" flexWrap="wrap" columnGap={3} alignItems="center">
      <Box flexShrink={0} flexDirection="row" columnGap={1} alignItems="center">
        {hasSvg ? <Box flexShrink={0}>{icon(kit, 'message', P.muted, '', 14)}</Box> : null}
        <Button key="page:message" label="Message" plain onPress={message} />
      </Box>
      <Box flexShrink={1} minWidth={0} flexDirection="row" columnGap={1} alignItems="center">
        {hasSvg ? <Box flexShrink={0}>{icon(kit, 'arrowRight', P.muted, '', 14)}</Box> : null}
        <Button key="page:chatwith" label={`${hasSvg ? '' : '→ '}Chat with ${row.title}`} plain onPress={chat} />
      </Box>
    </Box>
  )
}

/** Its call in flight, verbatim. */
function liveLine(kit: Kit, state: WebStateV2, row: V2AgentRow): RenderElement {
  const { Box, Text } = kit
  const live = row.live
  if (!live) return <Box />
  return (
    <Box key="page:live" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{glyph(kit, row.status === 'waiting' ? 'waiting' : 'active')}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">
          <Text bold color={P.fg2}>
            {live.tool}
          </Text>
          <Text color={P.fg2}>{` ${clean(live.text)}`}</Text>
          <Text color={P.muted2}>{`  ${ago(live.at, state.now)}`}</Text>
        </Text>
      </Box>
    </Box>
  )
}

/** Its words since its latest call, while it is at work with no call in flight: in italics after a speech mark, their Markdown marks dropped, quoted when they are one line (cut at a few rows), then how long ago. */
function saidLine(kit: Kit, state: WebStateV2, row: V2AgentRow): RenderElement | null {
  const { Box, Text } = kit
  const said = row.said
  if (!said) return null
  const text = unmarked(clean(said.text))
  const words = foldText(text.includes('\n') ? text : `“${text}”`, kit.columns - 3, SAID_ROWS)
  return (
    <Box key="page:said" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{wordMark(kit, 'said', P.runText)}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">
          {wordParts(kit, ticks(words.text), P.fg2)}
          <Text color={P.muted2}>{`  ${ago(said.at, state.now)}`}</Text>
        </Text>
      </Box>
    </Box>
  )
}

/** The rows the words under the head show at most. */
const SAID_ROWS = 3

/** A part's head as the web's blocks have it: its title in muted capitals, then its note dim ("4h ago", "3 tool calls"). */
function partHead(kit: Kit, title: string, note: string): RenderElement {
  const { Text } = kit
  return (
    <Text wrap="truncate-end">
      <Text bold color={P.muted}>
        {title.toUpperCase()}
      </Text>
      {note ? <Text color={P.muted2}>{`  ${note}`}</Text> : null}
    </Text>
  )
}

/** A head that folds its part: "▾ ACTIVITY", a plain Button that folds or opens it, its note dim beside it, a control at the right. */
function foldHead(kit: Kit, row: V2AgentRow, part: string, title: string, note: string, open: boolean, actions: DashActions, right: RenderElement | null = null): RenderElement {
  const { Box, Text, Button } = kit
  const label = `${open ? '▾' : '▸'} ${title.toUpperCase()}`
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>
        <Button key={`page:fold:${part}`} label={label} plain dimColor={kit.surface !== 'terminal'} onPress={toggler(row.id, part, true, actions)}>
          <Text color={P.muted2}>{`${open ? '▾' : '▸'} `}</Text>
          <Text bold color={P.muted}>
            {title.toUpperCase()}
          </Text>
        </Button>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {note ? (
          <Text color={P.muted2} wrap="truncate-end">
            {note}
          </Text>
        ) : null}
      </Box>
      {right ? <Box flexShrink={0}>{right}</Box> : null}
    </Box>
  )
}

/** How many fence lines Markdown holds. */
function fencesOf(text: string): number {
  return text.match(/^\s*(?:```|~~~)/gm)?.length ?? 0
}

/** Markdown cut inside a fence, the fence closed, so what follows draws as words again; a fence the cut left empty dropped. */
function closeFence(text: string): string {
  if (fencesOf(text) % 2 === 0) return text
  const lines = text.split('\n')
  if (/^\s*(?:```|~~~)/.test(lines[lines.length - 1] ?? '')) return lines.slice(0, -1).join('\n').trimEnd()
  return `${text}\n\`\`\``
}

/**
 * Its task or result, under its head and note: folded to a few rows with
 * Show more, as the web's; a result as Markdown, folded or open (a fence the
 * fold cuts inside closed).
 */
function textPart(kit: Kit, row: V2AgentRow, part: string, title: string, note: string, text: string, isMarkdown: boolean, actions: DashActions): RenderElement | null {
  const { Box, Text, Button, Markdown } = kit
  const words = clean(text).trim()
  if (words === '') return null
  const open = isOpen(row.id, part, false)
  const folded = foldText(words, kit.columns - 2, FOLD_ROWS)
  const shown = open ? words : folded.text
  return (
    <Box key={`page:${part}`} flexDirection="column">
      {partHead(kit, title, note)}
      {isMarkdown ? (
        <Markdown text={open ? shown : foldedMarkdown(shown, folded.isCut)} />
      ) : (
        <Text color={P.fg2} wrap="wrap">
          {shown}
        </Text>
      )}
      {folded.isCut ? (
        <Box flexDirection="row">
          <Button key={`page:more:${part}`} label={open ? 'Show less' : 'Show more'} plain dimColor onPress={toggler(row.id, part, false, actions)} />
        </Box>
      ) : null}
    </Box>
  )
}

/** Markdown folded to a few rows: its fence closed (or dropped, left empty), "…" where the fold cut words. */
function foldedMarkdown(text: string, isCut: boolean): string {
  const closed = closeFence(text)
  return isCut && fencesOf(closed) === fencesOf(text) && !/(?:```|~~~)$/.test(closed) ? `${closed}…` : closed
}

/** Its own TodoWrite list, with Claude's statuses (the one in hand in its own words). */
function todosPart(kit: Kit, todos: V2AgentRow['todos']): RenderElement | null {
  const { Box, Text } = kit
  if (todos.length === 0) return null
  const done = todos.filter(item => item.status === 'done').length
  return (
    <Box key="page:todos" flexDirection="column">
      {partHead(kit, 'Todos', `${done} of ${todos.length} done`)}
      {todos.map((item, i) => (
        <Box key={`page:todo:${i}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>{glyph(kit, item.status === 'done' ? 'done' : item.status === 'active' ? 'active' : 'pending')}</Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color={item.status === 'done' ? P.muted : P.fg2} wrap="wrap">
              {clean(item.status === 'active' && item.doing ? item.doing : item.text)}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** The entries of its log the page shows at most, the newest: a pane's drawing is capped, so "and n more" counts the earlier ones. */
const MOST_LOG = 40

/** The calls an agent's file keeps: Activity's note says "the newest 14" once it holds them all. */
const FILE_CALLS = 14

/** The rows a word or a thought of the log shows at most. */
const WORD_ROWS = 4

/** The cells a log row's outcome ("◐ running", "2.4s") and its age ("12m") take at its right. */
const OUTCOME = 9
const AGE = 4

/** The word a thought of the log leads with, muted beside its cloud. */
export const THOUGHT_WORD = 'thinking'

/** What Activity says once, under its head, while it shows a thought: Claude Code's live view of the thinking, which may be a summary. */
export const THOUGHT_NOTE = 'Thinking as Claude Code shows it, which may be a summary.'

/** The note at Activity's head, as the web's: "3 tool calls", "the newest 14"; '' with none. */
export function activityNoteOf(calls: number): string {
  if (calls === 0) return ''
  return calls >= FILE_CALLS ? `the newest ${calls}` : plural(calls, 'tool call')
}

/** The log as the page lists it, as the web's drawer does: newest first, the newest MOST_LOG, and how many earlier ones that leaves out. */
export function logShownOf(file: Pick<V2AgentFile, 'activity'> & { words?: readonly V2Word[] }, withWords: boolean): { shown: V2LogEntry[]; more: number } {
  const log = agentLogOf(file, withWords).reverse()
  return { shown: log.slice(0, MOST_LOG), more: Math.max(0, log.length - MOST_LOG) }
}

/**
 * Its log, from its agent file, open until folded: each tool call (the
 * chevron that opens it on all of it, its tool's chip, its own description
 * else its target, how it went or how long it took, when) and, unless
 * "Calls only" is picked (`activityView`), what it said between them after a
 * speech mark (one line quoted in italics; more as Chat draws a message, its
 * Markdown), and its thinking as Claude Code showed it, dimmer, after a
 * cloud and the word "thinking" (THOUGHT_NOTE says once, under the head,
 * that it may be a summary); newest first, the newest MOST_LOG. The switch
 * at the head's right, shown while it has words, keeps the pick in the view.
 */
function activityPart(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, file: V2AgentFile | null, activityView: DeckView2['activityView'], budget: Budget, actions: DashActions): RenderElement {
  const { Box } = kit
  const withWords = activityView !== 'calls'
  const { shown, more } = file ? logShownOf(file, withWords) : { shown: [], more: 0 }
  const hasWords = (file?.words?.length ?? 0) > 0
  const open = isOpen(row.id, 'activity', true)
  const room = kit.columns - 4 - 2 - 2 - AGE
  const hasThought = shown.some(entry => entry.kind === 'thought')
  const edits = new Set((file?.edits ?? []).filter(id => state.changes.edits.some(edit => edit.id === id)))
  return (
    <Box key="page:activity" flexDirection="column" rowGap={open && isAiry(kit) ? 1 : 0}>
      {foldHead(kit, row, 'activity', 'Activity', activityNoteOf(file?.activity.length ?? 0), open, actions, open && hasWords ? wordsSwitch(kit, withWords, actions) : null)}
      {open && hasThought ? quiet(kit, THOUGHT_NOTE) : null}
      {open && shown.length === 0 ? quiet(kit, file ? 'No tool calls yet.' : 'Its agent file is not to be had.') : null}
      {open && shown.length > 0 ? listBox(kit, 'page:log', shown.flatMap((entry, i) => [i > 0 ? rule(kit) : null, logRow(kit, state, files, row, entry, room, edits, budget, actions)])) : null}
      {open && more > 0 ? quiet(kit, `and ${more} more`) : null}
    </Box>
  )
}

/** The "Calls only · With their words" switch at Activity's head: two plain Buttons, the one shown lit; the pick stays in the view (`activityView`). */
function wordsSwitch(kit: Kit, withWords: boolean, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key="page:words" flexDirection="row" columnGap={1}>
      <Button key="page:words:calls" label="Calls only" plain dimColor={withWords} onPress={() => actions.setV2View({ activityView: 'calls' })} />
      <Text color={P.muted3}>·</Text>
      <Button key="page:words:with" label="With their words" plain dimColor={!withWords} onPress={() => actions.setV2View({ activityView: 'words' })} />
    </Box>
  )
}

/** One entry of the log: a call, or a step's words. */
function logRow(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, entry: V2LogEntry, room: number, edits: ReadonlySet<string>, budget: Budget, actions: DashActions): RenderElement {
  if (entry.kind === 'call') return callRow(kit, state, files, row, entry.call, edits, budget, actions)
  return wordRow(kit, state, entry.kind, entry.word, room)
}

type Call = V2AgentFile['activity'][number]

/**
 * How a call went, as the web's outcome says it, in its hue: refused ("⊘
 * denied", "⊘ blocked"), still running or waiting on you, "—" for one whose
 * end never came, "✕ failed", else how long it took ("ok" when not known).
 */
export function outcomeOf(state: Pick<WebStateV2, 'activity'>, row: Pick<V2AgentRow, 'status'>, call: Pick<Call, 'id' | 'ok' | 'ms'>): { text: string; hue: string } {
  const refused = state.activity.find(one => one.id === call.id && one.kind !== 'said')?.refused
  if (refused) return { text: `⊘ ${refused}`, hue: P.failText }
  if (call.ok === null) {
    if (row.status === 'waiting') return { text: '‖ waiting', hue: P.waitText }
    if (row.status !== 'running' && row.status !== 'starting') return { text: '—', hue: P.muted2 }
    return { text: '◐ running', hue: P.runText }
  }
  if (call.ok === false) return { text: '✕ failed', hue: P.failText }
  return { text: msText(call.ms) || 'ok', hue: P.muted2 }
}

/** What a call's row leads with: its own description, else its target, on one line; its tool where it has neither. */
export function callTextOf(call: Pick<Call, 'tool' | 'target' | 'description'>): string {
  return flat(call.description || call.target) || call.tool
}

/** The language a shell call's command is drawn in. */
const SHELL_LANGUAGE: Readonly<Record<string, string>> = { Bash: 'bash', PowerShell: 'powershell' }

/** The cells past which a row's words are drawn whole again when it opens. */
const WHOLE_AFTER = 40

/**
 * A call of the log, as the web's row: its chevron, its tool's chip, its own
 * description else its target (a plain Button that opens or shuts it), how
 * it went, when. Open, all of it as the web's: its command, its target
 * whole, an edit's numbered diff and "↓ In Edits" (that edit, opened and
 * brought into view), and a dim line of its id, its time, how it went and
 * when it began.
 */
function callRow(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, call: Call, edits: ReadonlySet<string>, budget: Budget, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const part = `act:${call.id}`
  const open = isOpen(row.id, part, false)
  const outcome = outcomeOf(state, row, call)
  // the words' room: the row inside the list's edges and padding, less the chevron, the chip, the outcome, the age, the gaps and the Button's chrome
  const room = Math.max(8, kit.columns - 4 - chevronCells(kit) - toolTagCells(kit, call.tool) - OUTCOME - AGE - 4 - plainSlack(kit))
  const text = callTextOf(call)
  return (
    <Box key={`page:call:${call.id}`} flexDirection="column" paddingX={1} paddingY={isAiry(kit) ? 1 : 0} rowGap={open && isAiry(kit) ? 1 : 0} hover={{ backgroundColor: P.rowHover }}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexShrink={0}>{chevron(kit, open)}</Box>
        <Box flexShrink={0}>{toolTag(kit, call.tool)}</Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Button key={`page:act:${call.id}`} label={cutCells(text, room, adv)} plain onPress={toggler(row.id, part, false, actions)} />
        </Box>
        <Box flexShrink={0} width={OUTCOME} justifyContent="flex-end">
          <Text color={outcome.hue}>{outcome.text}</Text>
        </Box>
        <Box flexShrink={0} width={AGE} justifyContent="flex-end">
          <Text color={P.muted2}>{ago(call.at, state.now)}</Text>
        </Box>
      </Box>
      {open ? callBody(kit, state, files, row, call, text, edits.has(call.id), budget, actions) : null}
    </Box>
  )
}

/** An open call's all, under its row: its command, its target whole, an edit's diff and the way to it in Edits, its id, time, outcome and start. */
function callBody(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, call: Call, text: string, isEdit: boolean, budget: Budget, actions: DashActions): RenderElement {
  const { Box, Text, Code, Button } = kit
  const edit = isEdit ? state.changes.edits.find(one => one.id === call.id) : undefined
  const patch = edit ? files.patch(edit.id) : null
  const target = flat(call.target)
  const how = call.ok === true ? 'ok' : call.ok === false ? 'failed' : 'no result yet'
  // its target whole where the row shows something else, or cut it
  const isTargetShown = !call.command && target !== '' && (target !== text || cellsOf(text) > WHOLE_AFTER)
  return (
    <Box flexDirection="column" rowGap={isAiry(kit) ? 1 : 0} paddingLeft={chevronCells(kit) + 1}>
      {call.command ? <Code source={clean(call.command)} language={SHELL_LANGUAGE[call.tool] ?? 'bash'} /> : null}
      {call.description && call.description !== text ? (
        <Text color={P.fg2} wrap="wrap">
          {call.description}
        </Text>
      ) : null}
      {isTargetShown ? (
        <Text color={P.fg2} wrap="wrap">
          {target}
        </Text>
      ) : null}
      {edit && patch !== null ? diffBlocks(kit, hunksOf(patch), edit.path, budget, true) : null}
      {edit ? (
        <Box flexDirection="row">
          <Button key={`page:toedit:${call.id}`} label="↓ In Edits" plain dimColor onPress={() => showEdit(row.id, edit, actions)} />
        </Box>
      ) : null}
      <Text color={P.muted2} wrap="wrap">
        {[call.id, msText(call.ms), how, new Date(call.at).toLocaleTimeString()].filter(one => one !== '').join(' · ')}
      </Text>
    </Box>
  )
}

/** Edits opened on edit `edit` (its file and its diff), brought into view: where "↓ In Edits" goes. */
function showEdit(id: string, edit: V2Changes['edits'][number], actions: DashActions): void {
  setOpen(id, 'edits', true)
  setOpen(id, `file:${edit.path}`, true)
  setOpen(id, `edit:${edit.id}`, true)
  actions.redraw()
  actions.reveal(`edit:${edit.id}`, 'start')
}

/** Activity opened on call `callId`, brought into view: where "↑ In Activity" goes. */
function showCall(id: string, callId: string, actions: DashActions): void {
  setOpen(id, 'activity', true)
  setOpen(id, `act:${callId}`, true)
  actions.redraw()
  actions.reveal(`page:call:${callId}`, 'start')
}

/**
 * A step's words in the log, each cut at WORD_ROWS rows, then when. What it
 * said, after a speech mark, on a shade of its own where the surface draws
 * one: a line of it quoted in italics, its Markdown marks dropped; words of
 * more lines as Chat draws a message, its Markdown (no quotes round them).
 * Or its thinking, dimmer, after a cloud and THOUGHT_WORD, its marks dropped.
 */
function wordRow(kit: Kit, state: WebStateV2, kind: V2Word['kind'], word: V2Word, room: number): RenderElement {
  const { Box, Text, Markdown } = kit
  const isThought = kind === 'thought'
  const raw = clean(word.text).trim()
  const text = unmarked(raw)
  const isLines = !isThought && raw.includes('\n')
  const lead = isThought ? `${THOUGHT_WORD}  ` : ''
  const folded = foldText(isLines ? raw : isThought ? `${lead}${text}` : `“${text}”`, room, WORD_ROWS)
  const cutText = (word.isCut && !folded.isCut ? `${folded.text}…` : folded.text).slice(lead.length)
  const shown = isLines ? closeFence(cutText) : cutText
  const shade = svgOf(kit) && !isThought ? { backgroundColor: P.saidBox } : {}
  return (
    <Box key={`page:${kind}:${word.at}:${word.step}`} flexDirection="row" columnGap={1} alignItems="flex-start" paddingX={1} paddingY={isAiry(kit) ? 1 : 0} {...shade}>
      <Box flexShrink={0}>{wordMark(kit, kind, isThought ? P.muted2 : P.muted)}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {isLines ? (
          <Markdown text={shown} />
        ) : (
          <Text wrap="wrap">
            {isThought ? <Text color={P.muted2}>{lead}</Text> : null}
            {wordParts(kit, ticks(shown), isThought ? P.muted : P.fg2)}
          </Text>
        )}
      </Box>
      <Box flexShrink={0} width={AGE} justifyContent="flex-end">
        <Text color={P.muted2}>{ago(word.at, state.now)}</Text>
      </Box>
    </Box>
  )
}

/** The files Edits draws at most, and the edits of one file; Changes lists them all. */
const MOST_FILES = 12
const MOST_EDITS = 8

/**
 * What Edits opens the first time it is drawn, as the web's drawer: the file
 * edited last, and in each file its newest edit's diff. A default is fixed
 * the first time its fold is drawn, so a later edit opens nothing by itself.
 */
function fixDefaults(id: string, groups: readonly EditGroup[]): void {
  const isFirst = groups.every(group => !pressed.has(`${id}|file:${group.path}`))
  groups.forEach((group, i) => {
    if (!pressed.has(`${id}|file:${group.path}`)) setOpen(id, `file:${group.path}`, isFirst && i === 0)
    const newest = group.edits[group.edits.length - 1]
    for (const edit of group.edits) if (!pressed.has(`${id}|edit:${edit.id}`)) setOpen(id, `edit:${edit.id}`, edit === newest)
  })
}

/** The edits Edits shows of a page's agent, oldest first, as its file lists them (else the state's of it). */
export function ownEditsOf(state: Pick<WebStateV2, 'changes'>, row: Pick<V2AgentRow, 'id'>, file: Pick<V2AgentFile, 'edits'> | null): V2Changes['edits'] {
  const ids = file?.edits ?? state.changes.edits.filter(edit => edit.agent === row.id).map(edit => edit.id)
  return ids.map(id => state.changes.edits.find(edit => edit.id === id)).filter(edit => edit !== undefined)
}

/**
 * Its own edits by file, open until folded, as the web drawer's and Changes'
 * rows: the file edited last first, each its chevron, its folder dim and its
 * name, "n edits" and `+a −r` (./changes' row), a press opening or shutting
 * it. Open, its edits newest first, each its tool's chip, when and its lines
 * (./diffs' block), "↑ In Activity" where its file keeps the call that made
 * it, and its numbered diff: the newest open, the rest a press away
 * ("Show diff").
 */
function editsPart(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, file: V2AgentFile | null, budget: Budget, actions: DashActions): RenderElement | null {
  const { Box } = kit
  const edits = ownEditsOf(state, row, file)
  if (edits.length === 0) return null
  const groups = editGroupsOf(edits)
  const open = isOpen(row.id, 'edits', true)
  fixDefaults(row.id, groups)
  const calls = new Set((file?.activity ?? []).map(call => call.id))
  return (
    <Box key="page:edits" flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      {foldHead(kit, row, 'edits', 'Edits', plural(groups.length, 'file'), open, actions)}
      {open ? groups.slice(0, MOST_FILES).map(group => fileBlock(kit, state, files, row, group, calls, budget, actions)) : null}
      {open && groups.length > MOST_FILES ? quiet(kit, `${plural(groups.length - MOST_FILES, 'more file')}: Changes lists them all.`) : null}
    </Box>
  )
}

/**
 * One file of its edits, and open, its edits newest first: a bordered card
 * as the web's where a desktop draws it; on the terminal, whose rows are
 * few, its row and its edits indented under it, as Changes lays them out.
 */
function fileBlock(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, group: EditGroup, calls: ReadonlySet<string>, budget: Budget, actions: DashActions): RenderElement {
  const { Box } = kit
  const part = `file:${group.path}`
  const open = isOpen(row.id, part, false)
  const toggle = toggler(row.id, part, false, actions)
  const key = `page:edits:${group.path}`
  // on a desktop the veil lies over the padded Box the row stands in, so its padding presses too
  const head = editsRow(kit, state, group, open, toggle, { key, isOwn: true, isVeiled: !isAiry(kit) })
  const earlier = group.edits.length - MOST_EDITS
  const edits = open
    ? [
        ...[...group.edits]
          .reverse()
          .slice(0, MOST_EDITS)
          .map(edit => {
            const isShut = !isOpen(row.id, `edit:${edit.id}`, false)
            const isOneOfMany = group.edits.length > 1
            // among several, a press anywhere on an edit's head but its links shows or hides its diff, as Show diff does
            const toggle = isOneOfMany ? { toggle: toggler(row.id, `edit:${edit.id}`, false, actions), key: `page:edithead:${edit.id}` } : {}
            return editBlock(kit, state, files, edit, budget, { isOwn: true, isShut, right: editLinks(kit, row, edit, calls.has(edit.id), isOneOfMany, isShut, actions), ...toggle })
          }),
        earlier > 0 ? quiet(kit, `${plural(earlier, 'earlier edit')}: Changes lists them all.`) : null,
      ]
    : null
  if (!isAiry(kit)) {
    return (
      <Box key={`page:file:${group.path}`} flexDirection="column">
        {head}
        {edits ? (
          <Box flexDirection="column" paddingLeft={2} rowGap={1} marginBottom={1}>
            {edits}
          </Box>
        ) : null}
      </Box>
    )
  }
  return listBox(kit, `page:file:${group.path}`, [
    <Box paddingX={1} paddingY={1} hover={{ backgroundColor: P.rowHover }}>
      {head}
      {veil(kit, key, toggle)}
    </Box>,
    edits ? rule(kit) : null,
    edits ? (
      <Box flexDirection="column" paddingX={1} paddingY={1} rowGap={1}>
        {edits}
      </Box>
    ) : null,
  ])
}

/** At an edit's head, dim: "↑ In Activity" where its agent's file keeps the call that made it; "Show diff" or "Hide diff" where its file holds more than one. */
function editLinks(kit: Kit, row: V2AgentRow, edit: V2Changes['edits'][number], hasCall: boolean, isOneOfMany: boolean, isShut: boolean, actions: DashActions): RenderElement | null {
  const { Box, Button } = kit
  if (!hasCall && !isOneOfMany) return null
  return (
    <Box flexDirection="row" columnGap={2}>
      {hasCall ? <Button key={`page:tocall:${edit.id}`} label="↑ In Activity" plain dimColor onPress={() => showCall(row.id, edit.id, actions)} /> : null}
      {isOneOfMany ? <Button key={`page:diff:${edit.id}`} label={isShut ? 'Show diff' : 'Hide diff'} plain dimColor onPress={toggler(row.id, `edit:${edit.id}`, false, actions)} /> : null}
    </Box>
  )
}

/** What each page's composer holds, by agent id, and how many times it was started anew (a send empties it). */
const drafts = new Map<string, string>()
const fields = new Map<string, number>()

/** Each page's last send, by agent id: its command's id, whose ack says what came of it, and when. */
const sends = new Map<string, { id: string; at: number }>()
let sendCount = 0

/** How long a send says "Sending" with no ack. */
const ACK_WAIT = 20_000

/** The key of agent `id`'s page composer as drawn now: Message moves the focus to it. */
export function pageComposerKey(id: string): string {
  const n = fields.get(id) ?? 0
  return n === 0 ? `page:composer:${id}` : `page:composer:${id}:${n}`
}

/**
 * The composer at the page's foot, as the web drawer's: one field with its
 * own Send, its words to this agent (by SendMessage; the Orchestrator's, your
 * next prompt), through the deck's own `sendChat` with an ack id; under it
 * where they go, and what came of the last send (its ack). In the sample
 * nothing is sent, and the words stay.
 */
function composerPart(kit: Kit, state: WebStateV2, row: V2AgentRow, isDemo: boolean, actions: DashActions): RenderElement {
  const { Box, Text, Input } = kit
  if (!Input) return quiet(kit, `Message ${row.title} from Chat: this surface has no field to type in.`)
  const last = sends.get(row.id)
  const ack = last ? [...state.acks].reverse().find(one => one.id === last.id) : undefined
  const said = ack ? ackLine(ack) : last && state.now - last.at < ACK_WAIT ? { mark: '…', hue: P.muted, text: 'Sending' } : null
  const send = (text: string) => {
    const words = text.trim().slice(0, 4000)
    drafts.set(row.id, text)
    if (words === '') return
    if (isDemo) {
      actions.sendChat(row.id, words)
      actions.redraw()
      return
    }
    sendCount += 1
    const ackId = `a${state.now.toString(36)}${sendCount.toString(36)}`
    sends.set(row.id, { id: ackId, at: state.now })
    drafts.delete(row.id)
    fields.set(row.id, (fields.get(row.id) ?? 0) + 1)
    actions.sendChat(row.id, words, ackId)
    actions.redraw()
  }
  const placeholder = row.id === MAIN ? `Message the ${ORCHESTRATOR}…` : `Message ${cut(row.title, 48)}…`
  // on another session's deck that takes nothing from here, why not, where the words would go
  const where = [state.peer && !state.peer.canSteer ? state.peer.why : viaText(state, row.id, row.title), isDemo ? 'Sample data: nothing is sent.' : ''].filter(one => one !== '').join(' · ')
  return (
    <Box key="page:compose" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Input key={pageComposerKey(row.id)} placeholder={placeholder} value={drafts.get(row.id) ?? ''} submitLabel="Send" onInput={text => void drafts.set(row.id, text)} onSubmit={send} />
      <Box flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={P.muted2} wrap="truncate-end">
            {where}
          </Text>
        </Box>
        {said ? (
          <Box flexShrink={1} minWidth={0}>
            <Text color={said.hue} wrap="truncate-end">{`${said.mark} ${said.text}`}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
