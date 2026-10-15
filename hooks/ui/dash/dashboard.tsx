/**
 * The Dashboard tab, the deck's first screen, drawn from the same state the
 * web deck's page reads (`webStateOf`), so the two always agree. Top to
 * bottom, as the page lays it out:
 *
 * - what needs you (./needs): questions to answer here, permissions to give
 *   in Claude Code, or the needs-you banner;
 * - the goal: its headline and up to two lines of its words, the follow-up
 *   last typed, "Step n of m · <step>" and the plan's segmented bar;
 * - the agents: a bordered card each, two a row from 60 cells, one below:
 *   avatar, name, status pill, now line, "model · tokens · started 4m ago",
 *   and "Open →"; every line of it a press that opens the agent's page; the
 *   edge in the status's hue while it runs, waits or failed, and in its hue
 *   under the pointer, "Open →" lit with it;
 * - the KPI strip: agents running, plan steps, session spend, waiting on you;
 * - recent activity: the newest eight calls, a press opening the agent;
 * - Open in browser, the web deck one press away (not in the sample).
 *
 * Every time is coarse ("4m"), so a redraw a minute is the most time alone
 * asks. Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebAgent, WebState } from '../../web'
import { webLine } from '../slim'
import type { DashActions, Kit, WebPane } from '../types'
import { activityRows, ago, cardFoot, cut, dashAgents, firstLine, flat, goalRest, kpisOf, nowLine, stepLineOf, wrapTicks, type ActivityRow } from './dashModel'
import { needsBanner, needsCards } from './needs'
import { P, STEP_HUE, mix, stepsSvg, toneOf, type IconName } from './palette'
import { AVATAR, CARD_CHROME, PILL, avatar, buttonSlack, icon, openAgentPage, openButton, pill, pressLine, quiet, sectionHead, svgOf, tickParts, tickTexts, widthFor } from './parts'

/** From this many cells the agent cards go two a row and the KPI boxes four. */
export const WIDE = 60

/** The tab: what needs you, the goal, the agents, the figures, the activity; and the web deck's button. */
export function dashboardTab(kit: Kit, state: WebState, actions: DashActions, now: number, web: WebPane | null): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column" gap={1}>
      {needsCards(kit, state, actions, now, 'dash')}
      {needsBanner(kit, state, actions)}
      {goalCard(kit, state, now)}
      {agentsSection(kit, state, actions, now)}
      {kpiStrip(kit, state)}
      {activitySection(kit, state, actions, now)}
      {web ? webBlock(kit, web, actions) : null}
    </Box>
  )
}

/** The plan's bar: the steps as one rounded segment each where Svg draws (the slot's width), else a run of cells a step in its colour. */
function stepsBar(kit: Kit, statuses: readonly string[], room: number): RenderElement {
  const { Box, Text } = kit
  const Svg = svgOf(kit)
  const done = statuses.filter(status => status === 'done').length
  if (Svg) return <Svg source={stepsSvg(statuses, Math.max(120, room * 8))} alt={`Plan: ${done} of ${statuses.length} steps done`} />
  const n = Math.max(1, statuses.length)
  const cell = Math.max(1, Math.floor((room - (n - 1)) / n))
  return (
    <Box flexDirection="row" columnGap={1}>
      {statuses.map(status => (
        <Text backgroundColor={STEP_HUE[status] ?? P.track}>{' '.repeat(cell)}</Text>
      ))}
    </Box>
  )
}

/** The goal: its headline bold beside its age, two lines of its words at most, the follow-up typed last, then where the plan stands. */
function goalCard(kit: Kit, state: WebState, now: number): RenderElement {
  const { Box, Text } = kit
  const goal = state.goal
  const room = Math.max(16, kit.columns - CARD_CHROME - 2)
  if (!goal) {
    return (
      <Box key="dash:goal" flexDirection="row" columnGap={1} borderStyle="round" borderColor={P.border} paddingX={1}>
        <Box flexShrink={0}>{icon(kit, 'target', P.muted) ?? <Text color={P.muted}>◎</Text>}</Box>
        <Text color={P.muted} wrap="wrap">
          No goal yet. Your next prompt to Claude Code becomes the goal.
        </Text>
      </Box>
    )
  }
  const rest = flat(goalRest(goal))
  const last = goal.followUps[goal.followUps.length - 1]
  const step = stepLineOf(state)
  const statuses = state.plan.steps.map(one => one.status)
  return (
    <Box key="dash:goal" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{icon(kit, 'target', P.muted) ?? <Text color={P.muted}>◎</Text>}</Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold color={P.text} wrap="wrap">
            {goal.headline || firstLine(goal.text)}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={P.muted2}>{ago(goal.at, now)}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {rest ? (
          <Text color={P.muted} wrap="wrap">
            {cut(rest, room * 2)}
          </Text>
        ) : null}
        {last ? (
          <Box flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>{icon(kit, 'cornerDownRight', P.muted2, 14) ?? <Text color={P.muted2}>↳</Text>}</Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={P.fg2} wrap="truncate-end">
                {flat(last.text)}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={P.muted2}>{ago(last.at, now)}</Text>
            </Box>
          </Box>
        ) : null}
        {step ? (
          <Text wrap="truncate-end">
            <Text color={P.fg2}>{step.lead}</Text>
            {step.text ? <Text color={P.muted3}> · </Text> : null}
            {step.text ? <Text color={P.muted}>{step.text}</Text> : null}
          </Text>
        ) : null}
        {statuses.length > 0 ? stepsBar(kit, statuses, room) : null}
      </Box>
    </Box>
  )
}

/** The agents: their count and the way to the org chart, then a card each, two a row where the pane is wide enough. */
function agentsSection(kit: Kit, state: WebState, actions: DashActions, now: number): RenderElement {
  const { Box, Button } = kit
  const { shown, hidden } = dashAgents(state)
  const perRow = kit.columns >= WIDE ? 2 : 1
  const width = widthFor(kit.columns, perRow)
  const link = <Button key="dash:org" label={hidden > 0 ? `${hidden} more in the org chart →` : 'Org chart →'} plain dimColor onPress={() => actions.setTab('org')} />
  return (
    <Box flexDirection="column">
      {sectionHead(kit, 'Agents', state.agents.length, link)}
      {shown.length === 0 ? (
        quiet(kit, 'No agents yet: when Claude Code starts working, the Orchestrator and the agents it delegates to show up here.')
      ) : (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {shown.map(agent => agentCard(kit, state, agent, width, actions, now))}
        </Box>
      )}
    </Box>
  )
}

/**
 * One agent's card, every line of it a plain Button that opens its page:
 * its avatar (its status dot at the foot) and name beside its pill; its now
 * line, two lines kept, a Button a line; its model, tokens and when it
 * started; "Open →" at the right. A grey edge, or its hue's while it runs,
 * waits on you or failed; its hue under the pointer, "Open →" lit with it.
 */
function agentCard(kit: Kit, state: WebState, agent: WebAgent, width: number, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const tone = toneOf(agent.status)
  const inner = Math.max(8, width - CARD_CHROME)
  const room = Math.max(6, inner - buttonSlack(kit))
  const open = () => openAgentPage(actions, state, agent.id)
  const said = nowLine(agent)
  const lines = said ? wrapTicks(said, room, 2) : []
  return (
    <Box key={`card:${agent.id}`} flexDirection="column" width={width} borderStyle="round" borderColor={tone.edge} hover={{ borderColor: tone.hot }} paddingX={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexShrink={0}>{avatar(kit, agent.avatar, AVATAR.card, agent.label, tone.hue)}</Box>
        <Box flexGrow={1} flexShrink={1}>
          <Button key={`dash:agent:${agent.id}`} label={cut(agent.label, Math.max(6, inner - PILL - 5))} plain onPress={open} />
        </Box>
        <Box flexShrink={0}>{pill(kit, agent.status)}</Box>
      </Box>
      <Box flexDirection="column" height={2} overflow="hidden">
        {lines.length > 0
          ? lines.map((parts, i) => pressLine(kit, `dash:now:${agent.id}:${i}`, tickParts(kit, parts, P.muted), open))
          : pressLine(kit, `dash:now:${agent.id}:0`, [<Text color={P.muted3}>—</Text>], open)}
      </Box>
      {pressLine(kit, `dash:foot:${agent.id}`, [<Text color={P.muted2}>{cut(cardFoot(agent, now), room)}</Text>], open)}
      <Box flexDirection="row" justifyContent="flex-end">
        {openButton(kit, `dash:open:${agent.id}`, tone.pillFg, open)}
      </Box>
    </Box>
  )
}

/** Each figure's icon, at its right as the page draws it, in the page's half-strength grey. */
const KPI_ICON: Readonly<Record<string, IconName>> = { running: 'bot', plan: 'listChecks', spend: 'dollar', waiting: 'hand' }
const KPI_HUE = mix(P.muted, P.card, 0.5)

/** The four figures, each in a bordered box: four a row where the pane is wide enough, else two. */
function kpiStrip(kit: Kit, state: WebState): RenderElement {
  const { Box, Text } = kit
  const kpis = kpisOf(state)
  const perRow = kit.columns >= WIDE ? 4 : 2
  const width = widthFor(kit.columns, perRow)
  const inner = Math.max(8, width - CARD_CHROME)
  return (
    <Box key="dash:kpis" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      {kpis.map(kpi => (
        <Box key={`kpi:${kpi.key}`} flexDirection="column" width={width} borderStyle="round" borderColor={P.border} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Text bold color={P.text} wrap="truncate-end">
              {kpi.value}
            </Text>
            {icon(kit, KPI_ICON[kpi.key] ?? 'bot', KPI_HUE)}
          </Box>
          <Text color={P.muted} wrap="wrap">
            {kpi.label}
          </Text>
          <Text wrap="wrap">{tickTexts(kit, cut(kpi.desc, inner * 3), P.muted2)}</Text>
        </Box>
      ))}
    </Box>
  )
}

/** How a call stands, in its hue: running blue, waiting amber, failed red, the rest dim. */
const OUTCOME_HUE: Readonly<Record<ActivityRow['outcome']['tone'], string>> = { live: P.runText, wait: P.waitText, fail: P.failText, quiet: P.muted2 }

/** The cells an activity row's outcome and time take at its right. */
const OUTCOME = 8
const TIME = 4

/** Recent activity: the newest eight calls of every agent, newest first. */
function activitySection(kit: Kit, state: WebState, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const rows = activityRows(state, 8)
  return (
    <Box flexDirection="column">
      {sectionHead(kit, 'Recent activity', null)}
      {rows.length === 0 ? (
        quiet(kit, "No tool calls yet: every agent's tool calls show here as they happen.")
      ) : (
        <Box flexDirection="column">{rows.map(row => activityRow(kit, state, row, actions, now))}</Box>
      )}
    </Box>
  )
}

/** One call: the agent's avatar, then its name, the verb and the target as one press that opens the agent; how it went and when at the right. */
function activityRow(kit: Kit, state: WebState, row: ActivityRow, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const room = Math.max(16, kit.columns - 3 - OUTCOME - TIME - 3)
  const name = cut(row.name, 18)
  const verb = row.verb
  const targetRoom = Math.max(8, room - Array.from(name).length - Array.from(verb).length - 2)
  const words = [
    <Text bold color={P.text}>
      {name}
    </Text>,
    <Text color={P.muted}>{` ${verb}`}</Text>,
    ...(row.target ? [<Text color={P.fg2}>{` ${cut(row.target, targetRoom)}`}</Text>] : []),
  ]
  return (
    <Box key={`act:${row.key}`} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, row.avatar, AVATAR.row, row.name)}</Box>
      <Box flexGrow={1} flexShrink={1}>
        <Button key={`dash:act:${row.key}`} plain onPress={() => openAgentPage(actions, state, row.agent, 'activity')}>
          {words}
        </Button>
      </Box>
      <Box flexShrink={0} width={OUTCOME} justifyContent="flex-end">
        <Text color={OUTCOME_HUE[row.outcome.tone]}>{row.outcome.text}</Text>
      </Box>
      <Box flexShrink={0} width={TIME} justifyContent="flex-end">
        <Text color={P.muted2}>{ago(row.at, now)}</Text>
      </Box>
    </Box>
  )
}

/** Open in browser: the web deck (`/deck web`) one press away, and how it stands once asked for. */
function webBlock(kit: Kit, web: WebPane, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Button key="dash:web" label="Open in browser" plain dimColor onPress={() => actions.openWeb()} />
      </Box>
      {webLine(kit, web)}
    </Box>
  )
}
