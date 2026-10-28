/**
 * Org (key 3): who started whom, the Orchestrator at the top and every agent
 * under the one that started it, on the v2 state's rows; a click on an
 * agent opens its page.
 *
 * - On the desktop, the chart in the pane's own elements (./orgChart): a
 *   bordered card an agent, its avatar, name, type, model and one line,
 *   placed where ./orgLayout lays it out, over box-drawing connectors, as
 *   wide as the pane at most and as tall as it needs (the pane scrolls).
 * - Where that chart cannot draw on the desktop (a tree too broad for the
 *   pane even wrapped, or too large for the Desktop's bound), the chart's
 *   Client (./org.client.tsx), which pans: its props (orgPropsOf) carry the
 *   rows the Client is given and the columns they were laid out in, which it
 *   draws to (the desktop tells a fresh Client 1 row). A click on a card
 *   posts `{ type: 'open', id }`, which the hooks module answers by opening
 *   that agent's page. Its key stays `org`, so its pan and hover survive the
 *   deck's redraws.
 * - On the terminal, VS Code and the mobile app, and where the Client failed,
 *   the agents as an indented tree (./orgTree), the terminal's avatars its
 *   coloured glyphs; the Client is tried again the next time Org shows, and
 *   whenever /deck opens.
 *
 * The agents "Clear finished" hid are left out (W.shownStateOf): their
 * pages, Changes and Inspect keep them.
 *
 * Its head carries the Chart · Timeline switch (`org:show:chart`,
 * `org:show:timeline`): the Timeline (./timeline) is each agent's lane over the
 * run. The pick stays in the view (`DeckView2.orgView`) through reloads.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView2 } from '../../../types'
import { agentKeyOf, shownStateOf, type V2AgentRow, type V2Files, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentRowsOf } from './dashModel'
import { quiet, sectionHead } from './look'
import { orgChart, orgChartKeysOf, orgChartPlanOf } from './orgChart'
import { orgPropsOf, type OrgAgent } from './orgLayout'
import { orgLineOf, orgTree, treeRowsOf } from './orgTree'
import { P } from './palette'
import { num, plural } from './text'
import { shownTimelineOf, timelineKeysOf, timelineView } from './timeline'

/** How Org stands on this surface: whether its chart's Client failed here (the tree shows instead), and the agent whose page was opened last (the chart marks it). */
export type OrgSpot = { isDown: boolean; selected: string | null }


/** What a card's type line says: the agent type Claude Code gave; else what kind of loop it is. */
function typeOf(row: V2AgentRow): string {
  if (row.type) return row.type
  if (row.kind === 'orchestrator') return 'main loop'
  if (row.kind === 'engine') return 'Claude Code'
  return row.kind === 'agent' ? '' : row.kind
}


/** The agents as the chart takes them (./orgLayout's OrgAgent): in tree order, the tokens worded ('' for none), the one line with its code spans' backticks dropped (a card draws plain text), each parent one of the agents or null. */
export function chartAgentsOf(state: Pick<WebStateV2, 'agents'>): OrgAgent[] {
  const ids = new Set(agentRowsOf(state).map(row => row.id))
  return treeRowsOf(state).map(({ row }) => ({
    id: row.id,
    label: row.title,
    type: typeOf(row),
    model: row.model,
    tokens: row.tokens > 0 ? num(row.tokens) : '',
    status: row.status,
    now: orgLineOf(row).replace(/`([^`\n]+)`/g, '$1'),
    parent: row.parent !== null && row.parent !== row.id && ids.has(row.parent) ? row.parent : null,
  }))
}

/** Whether Org draws the chart's Client here, where the pane's own chart cannot draw: on the desktop, until the Client fails there. */
export function isClientOn(kit: Kit, org: OrgSpot): boolean {
  return kit.surface === 'desktop' && kit.Client !== undefined && !org.isDown
}

/** What Org shows beside the state: the view's pick (Chart, or the Timeline) and the lazy files the Timeline comes from. */
export type OrgShows = { orgView?: DeckView2['orgView']; files?: V2Files }

/** The rows the focus moves among on Org: the chart's names (W.agentKeyOf), or the tree's agents; none over the Client, whose cards are its own; the Timeline's lanes' names. */
export function orgFocusKeys(kit: Kit, whole: WebStateV2, org: OrgSpot, shows: OrgShows = {}): string[] {
  if (shows.orgView === 'timeline') return timelineKeysOf(shownTimelineOf(shows.files?.timeline(whole) ?? null, whole))
  const state = shownStateOf(whole)
  const plan = orgChartPlanOf(kit, chartAgentsOf(state))
  if (plan) return orgChartKeysOf(plan)
  return isClientOn(kit, org) ? [] : treeRowsOf(state).map(({ row }) => agentKeyOf(row.id))
}

/** The Chart · Timeline switch at the head's right: two plain Buttons, the one shown lit. */
function orgSwitch(kit: Kit, isTimeline: boolean, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key="org:switch" flexDirection="row" columnGap={1}>
      <Button key="org:show:chart" label="Chart" plain dimColor={isTimeline} onPress={() => actions.setV2View({ orgView: 'chart' })} />
      <Text color={P.muted3}>·</Text>
      <Button key="org:show:timeline" label="Timeline" plain dimColor={!isTimeline} onPress={() => actions.setV2View({ orgView: 'timeline' })} />
    </Box>
  )
}

/** Org: its head with the Chart · Timeline switch, then the Timeline once picked; else the chart where the pane draws it, else the chart's Client, else the tree. */
export function orgTab(kit: Kit, whole: WebStateV2, actions: DashActions, org: OrgSpot, shows: OrgShows = {}): RenderElement {
  const { Box, Client } = kit
  const isTimeline = shows.orgView === 'timeline'
  const switcher = orgSwitch(kit, isTimeline, actions)
  if (isTimeline) {
    return (
      <Box key="org:tab" flexDirection="column" gap={1}>
        {sectionHead(kit, 'Timeline', null, switcher)}
        {timelineView(kit, shownTimelineOf(shows.files?.timeline(whole) ?? null, whole), actions)}
      </Box>
    )
  }
  // the agents Clear finished hid are no part of the chart
  const state = shownStateOf(whole)
  const head = sectionHead(kit, 'Org chart', agentRowsOf(state).length, switcher)
  const agents = chartAgentsOf(state)
  const plan = orgChartPlanOf(kit, agents)
  if (plan) {
    const hidden = plan.layout.hidden
    return (
      <Box key="org:tab" flexDirection="column" gap={1}>
        {head}
        {orgChart(kit, state, plan, org.selected, actions)}
        {hidden > 0 ? quiet(kit, `${plural(hidden, 'more agent')}: more than the chart holds. /deck web shows them all.`) : null}
      </Box>
    )
  }
  if (Client && isClientOn(kit, org) && agents.length > 0) {
    const props = orgPropsOf(agents, org.selected, kit.columns)
    return (
      <Box key="org:tab" flexDirection="column" gap={1}>
        {head}
        <Client key="org" module="./org.client.tsx" width="100%" height={props.rows} props={props} />
      </Box>
    )
  }
  return (
    <Box key="org:tab" flexDirection="column" gap={1}>
      {head}
      {kit.surface === 'desktop' && org.isDown ? quiet(kit, 'The chart could not draw here, so the agents are listed instead. Org tries the chart again when you come back to it, as /deck does.') : null}
      {orgTree(kit, state, actions, org.selected)}
    </Box>
  )
}
