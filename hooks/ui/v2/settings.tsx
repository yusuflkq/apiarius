/**
 * Settings (key 5): the session's depth and the deck's own choices, top to
 * bottom:
 *
 * - Inspect: the context used, the spend, the tokens and the requests, each
 *   in a tile; then a row an agent (its face and name, its model, its tokens
 *   in, out and read from the cache, its requests, tool calls and errors), as
 *   the v2 state's `inspect` holds them, a table where the pane is wide
 *   enough and two lines an agent where it is not;
 * - Avatar style: the ten styles of web/avatars.mjs, each its name beside a
 *   small face drawn in it where Svg draws (the Orchestrator at work), the
 *   one drawn marked; a press draws every agent in it from now on, in every
 *   session and on the web page (`setAvatarStyle`, as `/deck avatars`);
 * - Web page: "Open in browser" (`/deck web`) and how the page stands;
 * - Help: what each tab shows, and the few keys there are.
 *
 * Pure: Kit, the state, the deck model and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as AV from '../../../web/avatars.mjs'
import { MAIN } from '../../model'
import type { V2AgentRow, V2Inspect, WebStateV2 } from '../../web'
import type { DashActions, DeckModel, Kit, WebPane } from '../types'
import { isAiry, listBox, listRow } from './dash'
import { AVATAR, avatar, avatarStyleOf, quiet, sectionHead, svgOf, type Face } from './look'
import { P } from './palette'
import { rule, widthFor } from './parts'
import { num, plural, usd } from './text'

/** Settings: Inspect, the avatar style, the web page and help, each under its head. */
export function settingsTab(kit: Kit, state: WebStateV2, model: DeckModel, actions: DashActions): RenderElement {
  const { Box } = kit
  return (
    <Box key="settings" flexDirection="column" gap={isAiry(kit) ? 2 : 1}>
      {inspectSection(kit, state, actions)}
      {avatarsSection(kit, actions)}
      {webSection(kit, model.web, actions)}
      {helpSection(kit)}
    </Box>
  )
}

/** A section as Settings stacks it: its head, then what it holds, half a line apart where the surface lays gaps out in half lines. */
function section(kit: Kit, key: string, head: RenderElement, body: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      {head}
      {body}
    </Box>
  )
}

// Inspect.

type InspectAgent = V2Inspect['agents'][number]

/** The agents Inspect lists at most, so the pane keeps inside the elements a desktop draws; the rest counted under them. */
export const MOST_AGENTS = 20

/** The figures over the table: what each says, and its value as `inspect` gives it ("—" while Claude Code has not reported it). */
function figuresOf(inspect: V2Inspect): { key: string; value: string; label: string }[] {
  const sum = (of: (agent: InspectAgent) => number) => inspect.agents.reduce((total, agent) => total + of(agent), 0)
  return [
    { key: 'context', value: inspect.contextPercent !== null ? `${Math.round(inspect.contextPercent)}%` : '—', label: 'Context used' },
    { key: 'spend', value: usd(inspect.costUsd), label: 'Spent' },
    { key: 'tokens', value: num(sum(agent => agent.tokens.in + agent.tokens.out + agent.tokens.cacheRead)), label: 'Tokens' },
    { key: 'requests', value: num(sum(agent => agent.requests)), label: 'Requests' },
  ]
}

/** The table's number columns: each one's head, its cells across, and its value for an agent. */
type Column = { head: string; width: number; of: (agent: InspectAgent) => string }
const COLUMNS: readonly Column[] = [
  { head: 'In', width: 6, of: agent => num(agent.tokens.in) },
  { head: 'Out', width: 6, of: agent => num(agent.tokens.out) },
  { head: 'Cache', width: 6, of: agent => num(agent.tokens.cacheRead) },
  { head: 'Requests', width: 8, of: agent => num(agent.requests) },
  { head: 'Tools', width: 5, of: agent => num(agent.tools) },
]
const ERRORS: Column = { head: 'Errors', width: 6, of: agent => num(agent.errors) }
/** The model's column, and the least a name keeps beside the columns: under it the pane draws two lines an agent. */
const MODEL = 11
const NAME_LEAST = 14
/** The most cells Inspect spans: wider, its numbers would stand far from the names they belong to. */
const INSPECT_MOST = 110

/** Inspect: its head, the figures in tiles, then the agents (a table, or two lines an agent where the pane is narrow), INSPECT_MOST cells across at most. */
function inspectSection(kit: Kit, state: WebStateV2, actions: DashActions): RenderElement {
  const { Box } = kit
  const { inspect } = state
  const across = Math.min(kit.columns, INSPECT_MOST)
  const agents = inspect.agents.slice(0, MOST_AGENTS)
  const columns = inspect.agents.some(agent => agent.errors > 0) ? [...COLUMNS, ERRORS] : COLUMNS
  const fixed = 2 + faceCells(kit) + 1 + MODEL + columns.reduce((sum, column) => sum + 1 + column.width, 0) + 1
  const isTable = across - fixed >= NAME_LEAST
  const rows = agents.map(agent => (isTable ? tableRow(kit, state, agent, columns, actions) : stackedRow(kit, state, agent, actions)))
  const more = inspect.agents.length - agents.length
  return section(kit, 'inspect', sectionHead(kit, 'Inspect', null), [
    tiles(kit, figuresOf(inspect), across),
    inspect.contextPercent === null && inspect.costUsd === null ? quiet(kit, 'The context and the spend show once Claude Code reports them.') : null,
    agents.length === 0 ? (
      quiet(kit, 'No agent has made a request yet: each agent’s tokens, requests and tool calls show here.')
    ) : (
      <Box key="inspect:table" flexDirection="column" width={across}>
        {listBox(kit, 'inspect:agents', [isTable ? tableHead(kit, columns) : null, ...rows.flatMap((row, i) => [i > 0 || isTable ? rule(kit) : null, row])])}
      </Box>
    ),
    more > 0 ? quiet(kit, `${plural(more, 'more agent')}: more than Settings lists. /deck web lists them all.`) : null,
  ])
}

/** The figures, each in a bordered tile, across `across` cells: all four in a row where that is wide enough, else two. */
function tiles(kit: Kit, figures: readonly { key: string; value: string; label: string }[], across: number): RenderElement {
  const { Box, Text } = kit
  const perRow = across >= 60 ? figures.length : 2
  const width = widthFor(across, perRow)
  return (
    <Box key="inspect:tiles" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      {figures.map(figure => (
        <Box key={`inspect:tile:${figure.key}`} flexDirection="column" width={width} borderStyle="round" borderColor={P.border} paddingX={1}>
          <Text bold color={P.text} wrap="truncate-end">
            {figure.value}
          </Text>
          <Text color={P.muted} wrap="truncate-end">
            {figure.label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** The cells an agent's face takes in a row: its image's where Svg draws, its glyph on the terminal. */
function faceCells(kit: Kit): number {
  return svgOf(kit) ? Math.ceil(AVATAR.list / 7.85) : 1
}

/** Who an `inspect` agent is, for its face: its row in `agents`, else the Orchestrator or an agent at rest. */
function faceOf(state: WebStateV2, agent: InspectAgent): Face {
  const row = state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === agent.id)
  return row ?? { id: agent.id, title: agent.title, kind: agent.id === MAIN ? 'orchestrator' : 'agent', status: 'idle', isStopped: false }
}

/** Its face and its name, a plain Button that opens its page when the state holds it. */
function who(kit: Kit, state: WebStateV2, agent: InspectAgent, actions: DashActions): RenderElement[] {
  const { Box, Button, Text } = kit
  const isKnown = state.agents.some(one => one.row === 'agent' && one.id === agent.id)
  return [
    <Box flexShrink={0}>{avatar(kit, faceOf(state, agent), AVATAR.list)}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0}>
      {isKnown ? (
        <Button key={`inspect:open:${agent.id}`} label={agent.title} plain onPress={() => actions.openAgent(agent.id)}>
          <Text bold color={P.text}>
            {agent.title}
          </Text>
        </Button>
      ) : (
        <Text bold color={P.text} wrap="truncate-end">
          {agent.title}
        </Text>
      )}
    </Box>,
  ]
}

/** A cell of the table, right-aligned in its width. */
function cell(kit: Kit, text: string, width: number, color: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexShrink={0} width={width} justifyContent="flex-end">
      <Text color={color} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

/** The table's head row: the columns' names, dim. */
function tableHead(kit: Kit, columns: readonly Column[]): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key="inspect:head" flexDirection="row" columnGap={1} paddingX={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted2}>Agent</Text>
      </Box>
      <Box flexShrink={0} width={MODEL}>
        <Text color={P.muted2}>Model</Text>
      </Box>
      {columns.map(column => cell(kit, column.head, column.width, P.muted2))}
    </Box>
  )
}

/** An agent as a row of the table. */
function tableRow(kit: Kit, state: WebStateV2, agent: InspectAgent, columns: readonly Column[], actions: DashActions): RenderElement {
  const { Box, Text } = kit
  return listRow(kit, `inspect:${agent.id}`, [
    ...who(kit, state, agent, actions),
    <Box flexShrink={0} width={MODEL}>
      <Text color={P.muted} wrap="truncate-end">
        {agent.model || '—'}
      </Text>
    </Box>,
    ...columns.map(column => cell(kit, column.of(agent), column.width, column === ERRORS && agent.errors > 0 ? P.failText : P.fg2)),
  ])
}

/** An agent in two lines, where the pane is too narrow for the table: its face, name and model, then its figures. */
function stackedRow(kit: Kit, state: WebStateV2, agent: InspectAgent, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const figures = [`${num(agent.tokens.in)} in`, `${num(agent.tokens.out)} out`, `${num(agent.tokens.cacheRead)} cache`, plural(agent.requests, 'request'), plural(agent.tools, 'tool')].join(' · ')
  return (
    <Box key={`inspect:${agent.id}`} flexDirection="column" paddingX={1} paddingY={isAiry(kit) ? 1 : 0}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {who(kit, state, agent, actions)}
        <Box flexShrink={0}>
          <Text color={P.muted}>{agent.model || '—'}</Text>
        </Box>
      </Box>
      <Text color={P.muted2} wrap="wrap">
        {figures}
        {agent.errors > 0 ? <Text color={P.failText}>{` · ${plural(agent.errors, 'error')}`}</Text> : null}
      </Text>
    </Box>
  )
}

// The avatars' style.

/** Who each style's face draws: the Orchestrator at work. */
const SAMPLE: Face = { id: MAIN, title: 'Orchestrator', kind: 'orchestrator', status: 'running', isStopped: false }

/** A style's face in the picker, in px. */
const PICK_FACE = 24

/** The colour that marks the style drawn: its ring and its tick. */
const PICKED = P.runText

/**
 * The avatars' style: the ten, in rows of as many as fit (about 22 cells
 * each), the one drawn marked. Where Svg draws, each a bordered chip, its
 * face drawn in its style beside its name, the one drawn ringed and ticked;
 * on the terminal, which draws no faces, each a radio line (◉ the one drawn,
 * ○ the rest). Each name is a plain Button keyed `avatars:<style>`.
 */
function avatarsSection(kit: Kit, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const style = avatarStyleOf(kit)
  const perRow = Math.max(1, Math.min(5, Math.floor((kit.columns + 1) / 22)))
  const width = widthFor(kit.columns, perRow)
  const rows: (typeof AV.STYLES)[number][][] = []
  AV.STYLES.forEach((one, i) => {
    if (i % perRow === 0) rows.push([])
    rows[rows.length - 1]?.push(one)
  })
  return section(kit, 'settings:avatars', sectionHead(kit, 'Avatar style', null, <Text color={P.muted2}>{AV.styleName(style)}</Text>), [
    ...rows.map((row, i) => (
      <Box key={`avatars:row:${i}`} flexDirection="row" columnGap={1}>
        {row.map(one => styleChip(kit, one.id, one.name, one.id === style, width, actions))}
      </Box>
    )),
    quiet(kit, 'Yours in every session, on the web page and in /deck demo. /deck avatars <style> picks one by name too.'),
  ])
}

/** One style in the picker: its face and its name, marked when it is the one drawn. */
function styleChip(kit: Kit, id: AV.AvatarStyle, name: string, isOn: boolean, width: number, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const Svg = svgOf(kit)
  const pick = () => actions.setAvatarStyle(id)
  const label = <Button key={`avatars:${id}`} label={name} plain dimColor={!isOn} onPress={pick} />
  if (!Svg) {
    return (
      <Box key={`avatars:chip:${id}`} flexDirection="row" columnGap={1} width={width}>
        <Box flexShrink={0}>
          <Text color={isOn ? PICKED : P.muted2}>{isOn ? '◉' : '○'}</Text>
        </Box>
        <Box flexShrink={1} minWidth={0}>
          {label}
        </Box>
      </Box>
    )
  }
  const source = AV.avatarSvg(id, { id: SAMPLE.id, name: SAMPLE.title, role: 'main', status: SAMPLE.status }, { size: PICK_FACE, dot: false, ground: P.ground })
  return (
    <Box
      key={`avatars:chip:${id}`}
      flexDirection="row"
      columnGap={1}
      alignItems="center"
      width={width}
      borderStyle="round"
      borderColor={isOn ? PICKED : P.border}
      hover={{ borderColor: isOn ? PICKED : P.borderStrong }}
      paddingX={1}
      paddingY={0}
    >
      <Box flexShrink={0}>
        <Svg source={source} alt={`${name}: the Orchestrator drawn in it`} width={PICK_FACE} height={PICK_FACE} />
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {label}
      </Box>
      {isOn ? (
        <Box flexShrink={0}>
          <Text color={PICKED}>✓</Text>
        </Box>
      ) : null}
    </Box>
  )
}

// The web page.

/** What the web page's line says, by how it stands. */
function webNote(web: WebPane | undefined): { text: string; color: string } {
  if (!web || web.status === 'off') return { text: 'The same deck as a page in the Browser pane, live: /deck web.', color: P.muted2 }
  if (web.status === 'starting') return { text: 'Starting the web deck…', color: P.muted2 }
  if (web.status === 'failed') return { text: web.note || 'The web deck could not start.', color: P.failText }
  return { text: web.opened === 'failed' && web.url !== '' ? `Running at ${web.url}: the Browser pane could not open it.` : 'Running: Open in browser shows it again.', color: P.muted }
}

/** The web page: "Open in browser" (as /deck web: started if need be, opened in the Browser pane), and how it stands. */
function webSection(kit: Kit, web: WebPane | undefined, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const note = webNote(web)
  return section(kit, 'settings:web', sectionHead(kit, 'Web page', null), [
    <Box key="settings:web:row" flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>
        <Button key="web:open" label="Open in browser" onPress={() => actions.openWeb()} />
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={note.color} wrap="wrap">
          {note.text}
        </Text>
      </Box>
    </Box>,
  ])
}

// Help.

/** What each tab shows, by its key. */
export const TAB_HELP: readonly (readonly [string, string, string])[] = [
  ['1', 'Dashboard', 'what needs you, the agents at work, the figures, the plan, recent activity and files'],
  ['2', 'Chat', 'the session as a group chat: pick Everyone or one agent, and your words go to the one picked, or @name another'],
  ['3', 'Org', 'who started whom: each agent under the one that started it; or the Timeline, each agent’s work, waits on you and idle time over the run'],
  ['4', 'Changes', 'git’s diff of each changed file, and the agents’ own edits'],
  ['5', 'Settings', 'Inspect, the avatar style, the web page and this help'],
]

/** The keys, as the pane has them. */
export const KEYS: readonly (readonly [string, string])[] = [
  ['1 – 5', 'the tabs'],
  ['Enter', 'opens what has the focus: an agent, a fold, a need, a file'],
  ['b', 'back from an agent’s page'],
]

/** Help: the tabs, then the keys. */
function helpSection(kit: Kit): RenderElement {
  const { Box, Text } = kit
  const line = (key: string, name: string, does: string, width: number) => (
    <Box key={`help:${key}`} flexDirection="row" columnGap={2}>
      <Box flexShrink={0} width={width}>
        <Text bold color={P.text}>
          {name}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={P.muted} wrap="wrap">
          {does}
        </Text>
      </Box>
    </Box>
  )
  return section(kit, 'help', sectionHead(kit, 'Help', null), [
    <Box key="help:tabs" flexDirection="column">
      {TAB_HELP.map(([key, name, does]) => line(`tab:${key}`, `${key}  ${name}`, does, 13))}
    </Box>,
    <Box key="help:keys" flexDirection="column">
      {KEYS.map(([key, does]) => line(`key:${key}`, key, does, 13))}
    </Box>,
    quiet(kit, 'The keys work while the pane has the keyboard: click it, or press ctrl+x then tab. Esc stays Claude Code’s.'),
  ])
}
