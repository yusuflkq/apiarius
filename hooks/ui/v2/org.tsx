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
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { agentKeyOf, type V2AgentRow, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentRowsOf } from './dashModel'
import { quiet, sectionHead } from './look'
import { orgChart, orgChartKeysOf, orgChartPlanOf } from './orgChart'
import { orgPropsOf, type OrgAgent } from './orgLayout'
import { orgLineOf, orgTree, treeRowsOf } from './orgTree'
import { num, plural } from './text'

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

/** The rows the focus moves among on Org: the chart's names (W.agentKeyOf), or the tree's agents; none over the Client, whose cards are its own. */
export function orgFocusKeys(kit: Kit, state: WebStateV2, org: OrgSpot): string[] {
  const plan = orgChartPlanOf(kit, chartAgentsOf(state))
  if (plan) return orgChartKeysOf(plan)
  return isClientOn(kit, org) ? [] : treeRowsOf(state).map(({ row }) => agentKeyOf(row.id))
}

/** Org: its head, then the chart where the pane draws it, else the chart's Client, else the tree. */
export function orgTab(kit: Kit, state: WebStateV2, actions: DashActions, org: OrgSpot): RenderElement {
  const { Box, Client } = kit
  const head = sectionHead(kit, 'Org chart', agentRowsOf(state).length)
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
