/**
 * The Agents tab's summary, the pane's default now that the full dashboard
 * opens in the Browser pane (`/deck web`), top to bottom: the needs-you
 * line, the goal with the plan's step in hand, one row per agent at work
 * (its status, label and the one line of what it is doing), then the Open
 * dashboard button. Details shows the full outline the tab drew before
 * (./outline, ./files, ./detail), so nothing is lost when the web route fails.
 *
 * Native text at the host's size, no timer-driven text. Pure: Kit,
 * DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckData, DeckShownStatus } from '../../types'
import * as F from '../format'
import type { GitState } from '../git'
import * as M from '../model'
import { agentLineOf } from '../web'
import { emptyLine, square } from './common'
import { goalChars, needsLine } from './outline'
import { headerOf, shownStatusOf, type HeaderVM } from './outlineModel'
import { webLine } from './dash/parts'
import { T } from './theme'
import type { Actions, DeckModel, Kit, WebPane } from './types'

/** The agents at work the summary lists before it counts the rest. */
export const SLIM_ROWS = 12
/** The rail's cells, the goal's label column ("Goal" and two spaces), and an agent's label column at most. */
const BAR = 2
const GOAL_LABEL = 6
const LABEL = 20

/** One agent at work as the summary lists it: its status square, label and one line. */
export type SlimRow = { id: string; status: DeckShownStatus; label: string; now: string }

/**
 * The summary: the header's needs-you line, goal and minutes; the plan's step
 * in hand ("Step 2 of 4 · …", '' without a real plan) and the counts the
 * header's summary line leads with; the agents at work.
 */
export type SlimVM = { header: HeaderVM; step: string; lead: string; rows: SlimRow[]; more: number }

/**
 * The summary's figures: the Orchestrator while it works or waits on you,
 * then each agent the outline shows that is at work or waits on you, in
 * spawn order; the first twelve, the rest counted.
 */
export function slimVM(data: DeckData, git: GitState, now: number): SlimVM {
  const header = headerOf(data, git, now)
  const rows: SlimRow[] = []
  let count = 0
  for (const agent of data.agents) {
    if (agent.kind !== 'main' && !M.isShownAgent(agent)) continue
    const status = shownStatusOf(agent, data)
    const isLive = agent.kind === 'main' ? status === 'running' : M.isLive(agent.status)
    if (!isLive && status !== 'waiting') continue
    count += 1
    if (rows.length < SLIM_ROWS) rows.push({ id: agent.id, status, label: M.labelOf(agent), now: agentLineOf(data, agent, git.root) })
  }
  return { header, step: header.summary.step, lead: header.summary.lead, rows, more: count - rows.length }
}

const OFF: WebPane = { status: 'off', url: '', opened: '', note: '' }

/** What a Button draws around its label: the terminal's `[ ` and ` ]`; a desktop's native button its padding. */
function chromeOf(kit: Kit): number {
  return kit.surface === 'terminal' ? 4 : 2
}

/** The Agents tab's summary: the needs-you line and the goal, the agents at work, the dashboard's button. */
export function slimTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box } = kit
  const vm = slimVM(model.data, model.git, model.now)
  // Open (n) shows what needs you where it can be seen: in the full outline, selected
  const opening: Actions = { ...actions, select: id => actions.showDetails(id) }
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {needsLine(kit, vm.header.needs, opening)}
        {goalBlock(kit, vm)}
      </Box>
      {rowsBlock(kit, vm, actions)}
      {dashboardBlock(kit, model.web, actions, 'summary')}
    </Box>
  )
}

/** The goal in bold in its label column, its minutes at the right; under it the plan's step in hand, else the counts (dim). */
function goalBlock(kit: Kit, vm: SlimVM): RenderElement {
  const { Box, Text } = kit
  const { goal, minutes } = vm.header
  return (
    <Box flexDirection="column" paddingLeft={BAR}>
      {goal ? (
        <Box flexDirection="row">
          <Box width={GOAL_LABEL} flexShrink={0}>
            <Text dimColor>Goal</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text bold wrap="wrap">
              {F.trunc(goal, goalChars(kit.columns))}
            </Text>
          </Box>
          {minutes ? (
            <Box flexShrink={0} paddingLeft={2}>
              <Text dimColor>{minutes}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
      <Box key="slim:step" paddingLeft={GOAL_LABEL}>
        {vm.step ? (
          <Text wrap="truncate-end">{vm.step}</Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {vm.lead}
          </Text>
        )}
      </Box>
    </Box>
  )
}

/** One row per agent at work: its square, its label (a press shows it in the full outline) and its line, waiting on you in ochre. */
function rowsBlock(kit: Kit, vm: SlimVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  if (vm.rows.length === 0) return <Box paddingLeft={BAR}>{emptyLine(kit, 'No agent at work right now.')}</Box>
  const width = Math.max(8, Math.min(LABEL, Math.floor((kit.columns - BAR) / 3)))
  return (
    <Box flexDirection="column">
      {vm.rows.map(row => (
        <Box key={`slim:${row.id}`} flexDirection="row" paddingLeft={BAR}>
          <Box width={2} flexShrink={0}>
            {square(kit, row.status)}
          </Box>
          <Box width={width} flexShrink={0}>
            <Button key={`slim:agent:${row.id}`} label={M.fitLabel(row.label, Math.max(4, width - chromeOf(kit)))} plain onPress={() => actions.showDetails(row.id)} />
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" {...(row.status === 'waiting' ? { color: T.warn } : { dimColor: true })}>
              {row.now}
            </Text>
          </Box>
        </Box>
      ))}
      {vm.more > 0 ? <Box paddingLeft={BAR}>{emptyLine(kit, `${F.plural(vm.more, 'more agent')} at work: Details lists them all.`)}</Box> : null}
    </Box>
  )
}

/**
 * The dashboard's row: Open dashboard (the pane's one primary button, w),
 * which starts the web deck if it is not running and opens it in the
 * Browser pane, and the Details toggle (e) beside it ('none' before the
 * first prompt, when there is no outline to show). Under them, how the web
 * deck stands: starting, why it failed, or the page's link while it runs and
 * the Browser pane did not open it.
 */
export function dashboardBlock(kit: Kit, web: WebPane | undefined, actions: Actions, details: 'summary' | 'details' | 'none'): RenderElement {
  const { Box, Button } = kit
  const state = web ?? OFF
  return (
    <Box flexDirection="column" paddingLeft={BAR}>
      <Box flexDirection="row" columnGap={2}>
        <Button key="web:open" label="Open dashboard" variant="primary" hotkey="w" onPress={() => actions.openWeb()} />
        {details === 'none' ? null : (
          <Button key="agents:details" label={details === 'details' ? 'Hide details' : 'Details'} plain dimColor hotkey="e" onPress={() => actions.toggleDetails()} />
        )}
      </Box>
      {webLine(kit, state)}
    </Box>
  )
}

