/**
 * Now, the deck's first screen: the dashboard, on the v2 state's own data,
 * top to bottom as the web deck's page lays it out:
 *
 * - Needs you (./needs): only when Claude Code holds something on you.
 * - Agents (./dash): a card each, in rows of as many as fit, every line of a
 *   card a press that opens the agent's page.
 * - Figures (./dash): agents running, the plan's steps where Claude made a
 *   plan, the session's spend, what waits on you.
 * - Plan: only where Claude made one, every source it used, each as Claude
 *   made it: its task board, its TodoWrite list, the approved plan as
 *   written (Markdown, folded to its first line until opened) and each
 *   Workflow's phases (no status).
 * - Recent activity and Files (./dash), side by side from 120 cells.
 *
 * Every section but Needs you sits under a head that folds it ("▾ AGENTS 8",
 * ./parts `foldHead`), what is folded kept in the deck's view
 * (`DeckView.collapsed`), so redraws, live updates and reloads keep it.
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * approved plan's fold is this module's own.
 */
import type { RenderElement } from 'claude-code'

import { clean } from '../../format'
import { agentKeyOf, needKeyOf, type V2Plan, type V2Todo, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentsSection, figuresSection, isAiry, listsOf } from './dash'
import { FOLD, activityFoldOf, agentsFoldOf, cardAgentsOf, figuresFoldOf, filesFoldOf, planFoldOf } from './dashModel'
import { glyph, quiet } from './look'
import { needsSection } from './needs'
import { P } from './palette'
import { foldHead, sectionFold, type Fold } from './parts'
import { ago, flat } from './text'

/** The approved plans opened (by when each was approved), while the module lives. */
const plansOpen = new Set<number>()

/**
 * Now: Needs you, the agents' cards, the figures, the plan, then Recent
 * activity and Files; each section but Needs you folded where `collapsed`
 * (the view's `DeckView.collapsed`) holds its FOLD id. `openOrg`, where
 * given, is the way to the org chart beside the agents' head.
 */
export function nowTab(kit: Kit, state: WebStateV2, collapsed: readonly string[], actions: DashActions, openOrg?: () => void): RenderElement {
  const { Box } = kit
  const fold = (id: string, summary: string) => sectionFold(collapsed, id, summary)
  return (
    <Box key="now" flexDirection="column" gap={isAiry(kit) ? 2 : 1}>
      {needsSection(kit, state, state.needs, actions, 'now')}
      {agentsSection(kit, state, actions, fold(FOLD.agents, agentsFoldOf(state)), openOrg)}
      {figuresSection(kit, state, actions, fold(FOLD.figures, figuresFoldOf(state)))}
      {state.plan ? planSection(kit, state.plan, state.now, actions, fold(FOLD.plan, planFoldOf(state))) : null}
      {listsOf(kit, state, actions, fold(FOLD.activity, activityFoldOf(state)), fold(FOLD.files, filesFoldOf(state)))}
    </Box>
  )
}

/**
 * The rows `j` and `k` move the pane's focus among on Now, in the order it
 * draws them: each need (W.needKeyOf), then each agent card's name
 * (W.agentKeyOf) while the agents are open.
 */
export function nowFocusKeys(state: WebStateV2, collapsed: readonly string[]): string[] {
  const needs = state.needs.map(need => needKeyOf(need.id))
  if (collapsed.includes(FOLD.agents)) return needs
  return [...needs, ...cardAgentsOf(state).shown.map(row => agentKeyOf(row.id))]
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

/** The plan under its head, "▾ PLAN": every source Claude used; folded, its head and its items done of all. */
function planSection(kit: Kit, plan: V2Plan, now: number, actions: DashActions, fold: Fold): RenderElement {
  const { Box, Text, Button, Markdown } = kit
  const head = foldHead(kit, fold, 'Plan', null, actions)
  if (!fold.isOpen) {
    return (
      <Box key="now:plan" flexDirection="column">
        {head}
      </Box>
    )
  }
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
      {head}
      {parts.length > 0 ? parts : quiet(kit, 'Claude made no plan.')}
    </Box>
  )
}
