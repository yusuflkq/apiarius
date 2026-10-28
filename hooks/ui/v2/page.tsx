/**
 * An agent's page, over the tab it was opened from (`b` goes back): who it
 * is (its avatar, name, status, how long, its model and tokens, who started
 * it), its live call verbatim (else, while it is at work, the words it said
 * since its latest call), what it waits on you for (./needs), its task (the
 * prompt it was given), its own TodoWrite list, its result, then on demand
 * its Activity (a log of its latest tool calls and, by default, the words
 * and thinking between them, from its lazy agent file,
 * `v2Files.agent(fileId)`) and its edits (its own patches), and "Chat with
 * <agent>": Chat with that agent picked in its member list, so the
 * composer's words go to it with no `@`.
 *
 * Pure: Kit, the state, its lazy files and DashActions come from the hooks
 * module; what is unfolded is this module's own.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import { MAIN } from '../../model'
import { agentLogOf, type V2AgentFile, type V2AgentRow, type V2Files, type V2LogEntry, type V2Word, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { composerKey } from './chat'
import { isAiry, listBox, listRow } from './dash'
import { editBlock, titleOf, type Budget } from './diffs'
import { AVATAR, avatar, glyph, keyButton, quiet, sectionHead, statusPill, svgOf, wordMark } from './look'
import { needsSection } from './needs'
import { P } from './palette'
import { rule } from './parts'
import { pageStop } from './stop'
import { ago, flat, foldText, msText, num } from './text'


/** What is unfolded on each page, by agent id and part (`task`, `result`, `activity`, `edits`), while the module lives. */
const unfolded = new Set<string>()

/** The rows a folded task or result shows. */
const FOLD_ROWS = 4

function isOpen(id: string, part: string): boolean {
  return unfolded.has(`${id}|${part}`)
}

function toggler(id: string, part: string, actions: DashActions): () => void {
  return () => {
    const key = `${id}|${part}`
    if (unfolded.has(key)) unfolded.delete(key)
    else unfolded.add(key)
    actions.redraw()
  }
}

/** The agent page for row `id`; a quiet line and Back when the state holds no such agent. `activityView` is the view's pick for its Activity ("Calls only", else with their words). */
export function agentPage(kit: Kit, state: WebStateV2, files: V2Files, id: string, actions: DashActions, activityView?: DeckView2['activityView']): RenderElement {
  const { Box } = kit
  const row = state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === id)
  const back = <Box flexDirection="row">{keyButton(kit, 'key:b', 'b', '← Back', () => actions.back(), false)}</Box>
  if (!row) {
    return (
      <Box key="page" flexDirection="column" gap={1}>
        {back}
        {quiet(kit, 'That agent is not in this session’s state any more.')}
      </Box>
    )
  }
  const file = files.agent(row.fileId)
  return (
    <Box key={`page:${row.id}`} flexDirection="column" gap={1}>
      {back}
      {head(kit, state, row, actions)}
      {pageStop(kit, row, actions)}
      {row.live ? liveLine(kit, state, row) : row.said ? saidLine(kit, state, row) : null}
      {needsSection(kit, state, state.needs.filter(need => need.agent === row.id), actions, 'page')}
      {textPart(kit, row, 'task', 'Task', file?.task || row.task, false, actions)}
      {todosPart(kit, file?.todos ?? row.todos)}
      {textPart(kit, row, 'result', row.id === MAIN ? 'Latest answer' : 'Result', file?.result || row.result, true, actions)}
      {activityPart(kit, state, row, file, activityView, actions)}
      {editsPart(kit, state, files, row, file, actions)}
      {chatLine(kit, row, actions)}
    </Box>
  )
}

/** Who it is: avatar, name, status, then its facts and who started it. */
function head(kit: Kit, state: WebStateV2, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const word = row.isStopped ? 'stopped' : row.status === 'waiting' ? 'waiting on you' : row.status
  const facts = [row.elapsed, row.model, row.tokens > 0 ? `${num(row.tokens)} tokens` : '', row.kind === 'teammate' ? 'teammate' : row.background ? 'background' : ''].filter(one => one !== '')
  const who = [row.type, row.shortId].filter(one => one !== '').join(' · ')
  const parent = row.parent ? titleOf(state, row.parent) : ''
  return (
    <Box key="page:head" flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, row, AVATAR.page, { dot: true, animated: true })}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Box flexShrink={1} minWidth={0}>
            <Text bold color={P.text} wrap="truncate-end">
              {row.title}
            </Text>
          </Box>
          <Box flexShrink={0}>{statusPill(kit, row.isStopped ? 'failed' : row.status, word)}</Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {facts.join(' · ')}
            </Text>
          </Box>
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {who ? (
            <Box flexShrink={1} minWidth={0}>
              <Text color={P.muted2} wrap="truncate-end">
                {who}
              </Text>
            </Box>
          ) : null}
          {row.parent ? (
            <Box flexShrink={0} flexDirection="row">
              <Text color={P.muted2}>{who ? '· started by ' : 'Started by '}</Text>
              <Button key={`page:parent:${row.parent}`} label={parent} plain dimColor onPress={() => actions.openAgent(row.parent ?? MAIN)} />
            </Box>
          ) : null}
        </Box>
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

/** Its words since its latest call, while it is at work with no call in flight: quoted in italics after a speech mark (cut at a few rows), then how long ago. */
function saidLine(kit: Kit, state: WebStateV2, row: V2AgentRow): RenderElement | null {
  const { Box, Text } = kit
  const said = row.said
  if (!said) return null
  const words = foldText(`“${clean(said.text).trim()}”`, kit.columns - 3, SAID_ROWS)
  return (
    <Box key="page:said" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{wordMark(kit, 'said', P.runText)}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">
          <Text italic color={P.fg2}>
            {words.text}
          </Text>
          <Text color={P.muted2}>{`  ${ago(said.at, state.now)}`}</Text>
        </Text>
      </Box>
    </Box>
  )
}

/** The rows the words under the head show at most. */
const SAID_ROWS = 3

/** A fold's head: "▸ ACTIVITY 14", a plain Button that opens or folds it; a control at the right. */
function foldHead(kit: Kit, row: V2AgentRow, part: string, title: string, count: number | null, actions: DashActions, right: RenderElement | null = null): RenderElement {
  const { Box, Text, Button } = kit
  const open = isOpen(row.id, part)
  const label = `${open ? '▾' : '▸'} ${title.toUpperCase()}${count !== null ? ` ${count}` : ''}`
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>
        <Button key={`page:fold:${part}`} label={label} plain dimColor={kit.surface !== 'terminal'} onPress={toggler(row.id, part, actions)}>
          <Text color={P.muted2}>{`${open ? '▾' : '▸'} `}</Text>
          <Text bold color={P.muted}>
            {title.toUpperCase()}
          </Text>
          {count !== null ? <Text color={P.muted2}>{` ${count}`}</Text> : null}
        </Button>
      </Box>
      {right ? (
        <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
          {right}
        </Box>
      ) : null}
    </Box>
  )
}

/** Its task or result: folded to a few rows with Show more; a result as Markdown once opened. */
function textPart(kit: Kit, row: V2AgentRow, part: string, title: string, text: string, isMarkdown: boolean, actions: DashActions): RenderElement | null {
  const { Box, Text, Button, Markdown } = kit
  const words = clean(text).trim()
  if (words === '') return null
  const open = isOpen(row.id, part)
  const folded = foldText(words, kit.columns - 2, FOLD_ROWS)
  return (
    <Box key={`page:${part}`} flexDirection="column">
      {sectionHead(kit, title, null)}
      {open && isMarkdown ? (
        <Markdown text={words} />
      ) : (
        <Text color={P.fg2} wrap="wrap">
          {open ? words : folded.text}
        </Text>
      )}
      {folded.isCut ? (
        <Box flexDirection="row">
          <Button key={`page:more:${part}`} label={open ? 'Show less' : 'Show more'} plain dimColor onPress={toggler(row.id, part, actions)} />
        </Box>
      ) : null}
    </Box>
  )
}

/** Its own TodoWrite list, with Claude's statuses (the one in hand in its own words). */
function todosPart(kit: Kit, todos: V2AgentRow['todos']): RenderElement | null {
  const { Box, Text } = kit
  if (todos.length === 0) return null
  const done = todos.filter(item => item.status === 'done').length
  return (
    <Box key="page:todos" flexDirection="column">
      {sectionHead(kit, 'Todos', null, <Text color={P.muted2}>{`${done} of ${todos.length} done`}</Text>)}
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

/** The rows a word or a thought of the log shows at most. */
const WORD_ROWS = 4

/** The cells a log row's age takes at its right ("12m"). */
const AGE = 4

/** What a thought of the log is labelled: Claude Code's live view of the thinking, which may be a summary. */
export const THOUGHT_LABEL = 'Thinking, as Claude Code shows it'

/**
 * Its log, from its agent file, on demand: each tool call (its outcome, the
 * tool and what it was given, its lines or how long it took, when) and,
 * unless "Calls only" is picked (`activityView`), what it said between them,
 * quoted in italics after a speech mark, and its thinking as Claude Code
 * showed it, dimmer, under its label; oldest first, the newest MOST_LOG. The
 * switch at the head's right, shown while it has words, keeps the pick in
 * the view.
 */
function activityPart(kit: Kit, state: WebStateV2, row: V2AgentRow, file: V2AgentFile | null, activityView: DeckView2['activityView'], actions: DashActions): RenderElement {
  const { Box } = kit
  const withWords = activityView !== 'calls'
  const log = file ? agentLogOf(file, withWords) : []
  const hasWords = (file?.words?.length ?? 0) > 0
  const open = isOpen(row.id, 'activity')
  const shown = log.slice(-MOST_LOG)
  const more = log.length - shown.length
  const room = kit.columns - 4 - 2 - 2 - AGE
  return (
    <Box key="page:activity" flexDirection="column" rowGap={open && isAiry(kit) ? 1 : 0}>
      {foldHead(kit, row, 'activity', 'Activity', log.length, actions, open && hasWords ? wordsSwitch(kit, withWords, actions) : null)}
      {open && log.length === 0 ? quiet(kit, file ? 'No tool calls yet.' : 'Its agent file is not to be had.') : null}
      {open && more > 0 ? quiet(kit, `and ${more} more`) : null}
      {open && shown.length > 0 ? listBox(kit, 'page:log', shown.flatMap((entry, i) => [i > 0 ? rule(kit) : null, logRow(kit, state, entry, room)])) : null}
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
function logRow(kit: Kit, state: WebStateV2, entry: V2LogEntry, room: number): RenderElement {
  return entry.kind === 'call' ? callRow(kit, state, entry.call) : wordRow(kit, state, entry.kind, entry.word, room)
}

/** A call of the log: its outcome's glyph, the tool and what it was given; why it was refused, that it failed, an edit's lines or how long it took; when. */
function callRow(kit: Kit, state: WebStateV2, call: V2AgentFile['activity'][number]): RenderElement {
  const { Box, Text } = kit
  const refused = state.activity.find(one => one.id === call.id && one.kind !== 'said')?.refused
  const edit = state.changes.edits.find(one => one.id === call.id)
  const how = refused ? `⊘ ${refused}` : call.ok === false ? `✕ ${msText(call.ms) || 'failed'}` : edit ? `+${edit.added} −${edit.removed}` : msText(call.ms)
  return listRow(kit, `page:call:${call.id}`, [
    <Box flexShrink={0}>{glyph(kit, call.ok === true ? 'done' : call.ok === false ? 'failed' : 'active')}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0}>
      <Text wrap="truncate-end">
        <Text bold color={P.text}>
          {call.tool}
        </Text>
        <Text color={P.fg2}>{` ${flat(call.command ?? call.target)}`}</Text>
      </Text>
    </Box>,
    how ? (
      <Box flexShrink={0}>
        <Text color={refused || call.ok === false ? P.failText : P.muted2}>{how}</Text>
      </Box>
    ) : null,
    <Box flexShrink={0} width={AGE} justifyContent="flex-end">
      <Text color={P.muted2}>{ago(call.at, state.now)}</Text>
    </Box>,
  ])
}

/**
 * A step's words in the log: what it said, quoted in italics after a speech
 * mark, on a shade of its own where the surface draws one; or its thinking,
 * dimmer, under THOUGHT_LABEL; each cut at WORD_ROWS rows; then when.
 */
function wordRow(kit: Kit, state: WebStateV2, kind: V2Word['kind'], word: V2Word, room: number): RenderElement {
  const { Box, Text } = kit
  const isThought = kind === 'thought'
  const text = clean(word.text).trim()
  const folded = foldText(isThought ? text : `“${text}”`, room, isThought ? WORD_ROWS - 1 : WORD_ROWS)
  const shade = svgOf(kit) && !isThought ? { backgroundColor: P.saidBox } : {}
  return (
    <Box key={`page:${kind}:${word.at}:${word.step}`} flexDirection="row" columnGap={1} alignItems="flex-start" paddingX={1} paddingY={isAiry(kit) ? 1 : 0} {...shade}>
      <Box flexShrink={0}>{wordMark(kit, kind, isThought ? P.muted2 : P.muted)}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {isThought ? (
          <Text color={P.muted2} wrap="truncate-end">
            {THOUGHT_LABEL}
          </Text>
        ) : null}
        <Text italic color={isThought ? P.muted : P.fg2} wrap="wrap">
          {word.isCut && !folded.isCut ? `${folded.text}…` : folded.text}
        </Text>
      </Box>
      <Box flexShrink={0} width={AGE} justifyContent="flex-end">
        <Text color={P.muted2}>{ago(word.at, state.now)}</Text>
      </Box>
    </Box>
  )
}

/** Its own edits, on demand: each patch under its file, tool and time. */
function editsPart(kit: Kit, state: WebStateV2, files: V2Files, row: V2AgentRow, file: V2AgentFile | null, actions: DashActions): RenderElement | null {
  const { Box } = kit
  const ids = file?.edits ?? state.changes.edits.filter(edit => edit.agent === row.id).map(edit => edit.id)
  const edits = ids.map(id => state.changes.edits.find(edit => edit.id === id)).filter(edit => edit !== undefined)
  if (edits.length === 0) return null
  const open = isOpen(row.id, 'edits')
  const budget: Budget = { chars: 30_000 }

  return (
    <Box key="page:edits" flexDirection="column" gap={open ? 1 : 0}>
      {foldHead(kit, row, 'edits', 'Edits', edits.length, actions)}
      {open ? [...edits].reverse().map(edit => editBlock(kit, state, files, edit, budget, true)) : null}
    </Box>
  )
}

/** "Chat with <agent>": Chat with it picked in the member list (words with no `@` go to it), the focus on the composer. */
function chatLine(kit: Kit, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  const chat = () => {
    actions.setV2View({ tab: 'chat', chatFilter: row.id })
    actions.back()
    actions.focusNext(1, [composerKey()])
  }
  return (
    <Box key="page:chat" flexDirection="row" columnGap={2}>
      <Button key="page:chatwith" label={`Chat with ${row.title}`} plain onPress={chat} />
    </Box>
  )
}
