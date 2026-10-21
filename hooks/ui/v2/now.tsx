/**
 * Now, the deck's first screen: does anything need me, who is working on
 * what, and Claude's plan, only where Claude made one.
 *
 * - Needs you (./needs): only when Claude Code holds something on you.
 * - Agents: the tree of who started whom, as the v2 state orders it, each
 *   row indented by its depth: its avatar with its status dot at its foot
 *   (on the terminal, which draws no image, the status dot alone), its
 *   name as a plain Button keyed `agent:<id>` (W.agentKeyOf) that
 *   opens its page, its call in flight verbatim ("Bash npm test"), and how
 *   long it has been at it. The finished and idle fold into one row ("2 done
 *   · 1 stopped"), a plain Button keyed by its own id that opens or folds
 *   its members (`DeckView.v2.openFolds`).
 * - Plan: every source Claude used, each as Claude made it: its task board,
 *   its TodoWrite list, the approved plan as written (Markdown, folded to
 *   its first line until opened) and each Workflow's phases (no status).
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * approved plan's fold is this module's own.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { clean } from '../../format'
import { agentKeyOf, type V2AgentRow, type V2FoldRow, type V2Plan, type V2Todo, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { AVATAR, advanceOf, avatar, glyph, quiet, sectionHead, statusDot, svgOf } from './look'
import { needsSection } from './needs'
import { P, toneOf } from './palette'
import { cutCells, flat, ago } from './text'

/** The tree's rows the pane draws at most, so its drawing keeps inside its bounds. */
const MOST_ROWS = 80

/** The approved plans opened (by when each was approved), while the module lives. */
const plansOpen = new Set<number>()

/** The width from which Now stands in two columns: what needs you (or the agents) at the left, the rest at the right. */
const TWO_COLUMNS = 120

/** Now: Needs you, the agents' tree, the plan; from 120 cells in two columns, the first of them at the left. */
export function nowTab(kit: Kit, state: WebStateV2, view2: DeckView2, actions: DashActions): RenderElement {
  const { Box } = kit
  const hasNeeds = state.needs.length > 0
  if (kit.columns >= TWO_COLUMNS && (hasNeeds || state.plan)) {
    const half = { ...kit, columns: Math.floor((kit.columns - 3) / 2) }
    const left = hasNeeds ? [needsSection(half, state, state.needs, actions, 'now')] : [agentsSection(half, state, view2, actions)]
    const right = hasNeeds ? [agentsSection(half, state, view2, actions), state.plan ? planSection(half, state.plan, state.now, actions) : null] : [state.plan ? planSection(half, state.plan, state.now, actions) : null]
    return (
      <Box key="now" flexDirection="row" columnGap={3}>
        <Box key="now:left" flexDirection="column" gap={1} width="50%" flexShrink={1} minWidth={0}>
          {left}
        </Box>
        <Box key="now:right" flexDirection="column" gap={1} width="50%" flexShrink={1} minWidth={0}>
          {right}
        </Box>
      </Box>
    )
  }
  return (
    <Box key="now" flexDirection="column" gap={1}>
      {needsSection(kit, state, state.needs, actions, 'now')}
      {agentsSection(kit, state, view2, actions)}
      {state.plan ? planSection(kit, state.plan, state.now, actions) : null}
    </Box>
  )
}

/** The word a row without a call in flight says after its name: its status as Claude Code gave it; '' while it runs. */
export function statusWordOf(row: V2AgentRow): string {
  if (row.isStopped) return 'stopped'
  if (row.status === 'waiting') return 'waiting on you'
  if (row.status === 'running') return ''
  return row.status
}


function agentsSection(kit: Kit, state: WebStateV2, view2: DeckView2, actions: DashActions): RenderElement {
  const { Box } = kit
  const open = new Set(view2.openFolds)
  const shown = state.agents.filter(row => row.row === 'fold' || row.fold === null || open.has(row.fold))
  const count = state.agents.filter(row => row.row === 'agent').length
  return (
    <Box key="now:agents" flexDirection="column">
      {sectionHead(kit, 'Agents', count)}
      {shown.slice(0, MOST_ROWS).map(row => (row.row === 'fold' ? foldRow(kit, row, open.has(row.id), view2, actions) : agentRow(kit, row, actions)))}
      {shown.length > MOST_ROWS ? quiet(kit, `${shown.length - MOST_ROWS} more rows: more than the pane holds. Fold a group, or /deck web.`) : null}
    </Box>
  )
}

/** One agent's row: avatar or dot, name (a Button to its page), its live call, its elapsed time. */
export function agentRow(kit: Kit, row: V2AgentRow, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const advance = advanceOf(kit)
  const indent = row.depth * 2
  // stopped reads as failed, as the state has it
  const lead = svgOf(kit) ? avatar(kit, row.avatar, AVATAR.row, row.title, toneOf(row.status).hue) : statusDot(kit, row.status)
  const name = cutCells(row.title, Math.max(10, Math.min(28, Math.floor(kit.columns / 3))), advance)
  const word = statusWordOf(row)
  const live = row.live ? `${row.live.tool} ${flat(row.live.text)}`.trim() : word
  const liveColor = row.live ? P.muted : row.status === 'waiting' ? P.waitText : row.status === 'failed' ? P.failText : P.muted2
  return (
    <Box key={`row:${row.id}`} flexDirection="row" columnGap={1} paddingLeft={indent} alignItems="center">
      <Box flexShrink={0}>{lead}</Box>
      <Box flexShrink={0}>
        <Button key={agentKeyOf(row.id)} label={name} plain onPress={() => actions.openAgent(row.id)}>
          <Text bold color={P.text}>
            {name}
          </Text>
        </Button>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={liveColor} wrap="truncate-end">
          {live}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={P.muted2}>{row.elapsed}</Text>
      </Box>
    </Box>
  )
}

/** A fold row: "▸ 2 done · 1 stopped", a plain Button keyed by its id that opens or folds its members. */
function foldRow(kit: Kit, row: V2FoldRow, isOpen: boolean, view2: DeckView2, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const label = `${isOpen ? '▾' : '▸'} ${row.text}`
  const toggle = () => actions.setV2View({ openFolds: isOpen ? view2.openFolds.filter(id => id !== row.id) : [...view2.openFolds, row.id] })
  return (
    <Box key={`frow:${row.id}`} flexDirection="row" paddingLeft={row.depth * 2}>
      <Box flexShrink={1} minWidth={0}>
        <Button key={row.id} label={label} plain dimColor={kit.surface !== 'terminal'} onPress={toggle}>
          <Text color={P.muted2}>{`${isOpen ? '▾' : '▸'} `}</Text>
          <Text color={P.muted}>{row.text}</Text>
        </Button>
      </Box>
    </Box>
  )
}

/** A plan item's glyph name: Claude's own status. */
function glyphName(status: V2Todo['status']): string {
  return status === 'done' ? 'done' : status === 'active' ? 'active' : 'pending'
}

/** One plan item: its glyph, its words (in hand, its own words for what it is doing), and a dim note after them. */
function itemLine(kit: Kit, key: string, status: V2Todo['status'], text: string, note: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{glyph(kit, glyphName(status))}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">
          <Text color={status === 'done' ? P.muted : P.fg2}>{clean(text)}</Text>
          {note ? <Text color={P.muted2}>{`  ${note}`}</Text> : null}
        </Text>
      </Box>
    </Box>
  )
}

/** A source's label inside Plan, dim. */
function sourceHead(kit: Kit, text: string, note = ''): RenderElement {
  const { Text } = kit
  return (
    <Text wrap="truncate-end">
      <Text color={P.muted}>{text}</Text>
      {note ? <Text color={P.muted2}>{`  ${note}`}</Text> : null}
    </Text>
  )
}

function planSection(kit: Kit, plan: V2Plan, now: number, actions: DashActions): RenderElement {
  const { Box, Text, Button, Markdown } = kit
  const parts: RenderElement[] = []
  if (plan.board.length > 0) {
    const done = plan.board.filter(task => task.status === 'done').length
    parts.push(
      <Box key="plan:board" flexDirection="column">
        {sourceHead(kit, 'Task board', `${done} of ${plan.board.length} done`)}
        {plan.board.map(task => itemLine(kit, `plan:task:${task.id}`, task.status, task.status === 'active' && task.doing ? task.doing : task.subject, task.owner ?? ''))}
      </Box>,
    )
  }
  if (plan.todos && plan.todos.items.length > 0) {
    const items = plan.todos.items
    const done = items.filter(item => item.status === 'done').length
    parts.push(
      <Box key="plan:todos" flexDirection="column">
        {sourceHead(kit, 'Orchestrator’s todos', `${done} of ${items.length} done`)}
        {items.map((item, i) => itemLine(kit, `plan:todo:${i}`, item.status, item.status === 'active' && item.doing ? item.doing : item.text, ''))}
      </Box>,
    )
  }
  if (plan.approved) {
    const approved = plan.approved
    const isOpen = plansOpen.has(approved.at)
    const first = flat(approved.markdown.split('\n').find(line => line.trim() !== '') ?? '').replace(/^#+\s*/, '')
    const label = `${isOpen ? '▾' : '▸'} Approved plan`
    const toggle = () => {
      if (isOpen) plansOpen.delete(approved.at)
      else plansOpen.add(approved.at)
      actions.redraw()
    }
    parts.push(
      <Box key="plan:approved" flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Button key="plan:approved" label={label} plain dimColor={kit.surface !== 'terminal'} onPress={toggle}>
              <Text color={P.muted}>{label}</Text>
            </Button>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {isOpen ? ago(approved.at, now) : `${first}  ${ago(approved.at, now)}`}
            </Text>
          </Box>
        </Box>
        {isOpen ? (
          <Box paddingLeft={2} flexDirection="column">
            <Markdown text={approved.markdown} />
          </Box>
        ) : null}
      </Box>,
    )
  }
  for (const flow of plan.workflows) {
    parts.push(
      <Box key={`plan:workflow:${flow.id}`} flexDirection="column">
        {sourceHead(kit, `Workflow ${flow.name}`, flow.endedAt === null ? 'running' : 'ended')}
        <Box paddingLeft={2}>
          <Text color={P.fg2} wrap="wrap">
            {flow.phases.length > 0 ? flow.phases.map(clean).join(' → ') : 'No phases named'}
          </Text>
        </Box>
      </Box>,
    )
  }
  return (
    <Box key="now:plan" flexDirection="column" gap={1}>
      {sectionHead(kit, 'Plan', null)}
      {parts.length > 0 ? parts : quiet(kit, 'Claude made no plan.')}
    </Box>
  )
}
