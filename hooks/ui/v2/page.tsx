/**
 * An agent's page, over the tab it was opened from (`b` goes back): who it
 * is (its avatar, name, status, how long, its model and tokens, who started
 * it), its live call verbatim, what it waits on you for (./needs), its task
 * (the prompt it was given), its own TodoWrite list, its result, then on
 * demand its Activity (its latest tool calls, from its lazy agent file,
 * `v2Files.agent(fileId)`) and its edits (its own patches), and "Chat with
 * <agent>": Chat filtered to it, `@` it in the composer.
 *
 * Pure: Kit, the state, its lazy files and DashActions come from the hooks
 * module; what is unfolded is this module's own.
 */
import type { RenderElement } from 'claude-code'

import { clean } from '../../format'
import { MAIN } from '../../model'
import type { V2AgentFile, V2AgentRow, V2Files, WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { composerKey, draftFor, handleOf } from './chat'
import { editBlock, titleOf, type Budget } from './diffs'
import { AVATAR, avatar, glyph, keyButton, quiet, sectionHead, statusPill } from './look'
import { needsSection } from './needs'
import { P } from './palette'
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

/** The agent page for row `id`; a quiet line and Back when the state holds no such agent. */
export function agentPage(kit: Kit, state: WebStateV2, files: V2Files, id: string, actions: DashActions): RenderElement {
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
      {row.live ? liveLine(kit, state, row) : null}
      {needsSection(kit, state, state.needs.filter(need => need.agent === row.id), actions, 'page')}
      {textPart(kit, row, 'task', 'Task', file?.task || row.task, false, actions)}
      {todosPart(kit, file?.todos ?? row.todos)}
      {textPart(kit, row, 'result', row.id === MAIN ? 'Latest answer' : 'Result', file?.result || row.result, true, actions)}
      {activityPart(kit, state, row, file, actions)}
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

/** A fold's head: "▸ ACTIVITY 14", a plain Button that opens or folds it. */
function foldHead(kit: Kit, row: V2AgentRow, part: string, title: string, count: number | null, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const open = isOpen(row.id, part)
  const label = `${open ? '▾' : '▸'} ${title.toUpperCase()}${count !== null ? ` ${count}` : ''}`
  return (
    <Box flexDirection="row">
      <Button key={`page:fold:${part}`} label={label} plain dimColor={kit.surface !== 'terminal'} onPress={toggler(row.id, part, actions)}>
        <Text color={P.muted2}>{`${open ? '▾' : '▸'} `}</Text>
        <Text bold color={P.muted}>
          {title.toUpperCase()}
        </Text>
        {count !== null ? <Text color={P.muted2}>{` ${count}`}</Text> : null}
      </Button>
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

/** Its latest tool calls, from its agent file, on demand: each its outcome, the tool and what it was given, how long, when. */
function activityPart(kit: Kit, state: WebStateV2, row: V2AgentRow, file: V2AgentFile | null, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const calls = file?.activity ?? []
  const open = isOpen(row.id, 'activity')
  return (
    <Box key="page:activity" flexDirection="column">
      {foldHead(kit, row, 'activity', 'Activity', calls.length, actions)}
      {open && calls.length === 0 ? quiet(kit, file ? 'No tool calls yet.' : 'Its agent file is not to be had.') : null}
      {open
        ? calls.map(call => (
            <Box key={`page:call:${call.id}`} flexDirection="row" columnGap={1}>
              <Box flexShrink={0}>{glyph(kit, call.ok === true ? 'done' : call.ok === false ? 'failed' : 'active')}</Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text wrap="truncate-end">
                  <Text bold color={P.fg2}>
                    {call.tool}
                  </Text>
                  <Text color={P.muted}>{` ${flat(call.command ?? call.target)}`}</Text>
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={P.muted2}>{[msText(call.ms), ago(call.at, state.now)].filter(one => one !== '').join(' · ')}</Text>
              </Box>
            </Box>
          ))
        : null}
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

/** "Chat with <agent>": Chat filtered to it, the focus on the composer, `@` it there (but the Orchestrator, which words with no `@` reach). */
function chatLine(kit: Kit, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  const chat = () => {
    const handle = handleOf(row)
    if (handle) draftFor(`@${handle} `)
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
