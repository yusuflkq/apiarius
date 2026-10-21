/**
 * Org (key 3): who started whom, the Orchestrator at the top and every agent
 * under the one that started it, on the v2 state's rows; a click on an
 * agent opens its page.
 *
 * Where the surface runs a surface module (the terminal and the desktop) the
 * chart is the org chart Client (./org.client.tsx, laid out by
 * ./orgLayout.ts): bordered cards over box-drawing connectors, as tall as it
 * needs (MAX_ROWS at most; it pans for the rest), across the pane. Its props
 * (orgPropsOf) carry the rows the Client is given and the columns they were
 * laid out in, which it draws to: never what the surface measures of it (the
 * desktop tells a fresh Client 1 row). A click on a card posts
 * `{ type: 'open', id }`, which the hooks module answers by opening that
 * agent's page. Its key stays `org`, so its pan and hover survive the deck's
 * redraws.
 *
 * Elsewhere (VS Code, the mobile app), and on a surface where the Client
 * failed, the agents are an indented tree (./orgTree); the chart is tried
 * again the next time Org shows, and whenever /deck opens.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { agentKeyOf, type V2AgentRow, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { agentRowsOf } from './dashModel'
import { quiet, sectionHead } from './look'
import { orgPropsOf, type OrgAgent } from './orgLayout'
import { orgLineOf, orgTree, treeRowsOf } from './orgTree'
import { num } from './text'

/** How Org stands on this surface: whether its chart's Client failed here (the tree shows instead), and the agent whose page was opened last (the chart marks it). */
export type OrgSpot = { isDown: boolean; selected: string | null }


/** What a card's type line says: the agent type Claude Code gave; else what kind of loop it is. */
function typeOf(row: V2AgentRow): string {
  if (row.type) return row.type
  if (row.kind === 'orchestrator') return 'main loop'
  if (row.kind === 'engine') return 'Claude Code'
  return row.kind === 'agent' ? '' : row.kind
}


/** The agents as the chart's Client takes them (./orgLayout's OrgAgent): in tree order, the tokens worded ('' for none), the one line with its code spans' backticks dropped (a card draws plain text), each parent one of the agents or null. */
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

/** Whether Org draws the chart's Client here (else the tree). */
export function isChartOn(kit: Kit, org: OrgSpot): boolean {
  return kit.Client !== undefined && !org.isDown
}

/** The rows `j` and `k` move among on Org: the tree's agents (W.agentKeyOf); none over the chart, whose cards are its own. */
export function orgFocusKeys(kit: Kit, state: WebStateV2, org: OrgSpot): string[] {
  return isChartOn(kit, org) ? [] : treeRowsOf(state).map(({ row }) => agentKeyOf(row.id))
}

/** Org: its head, then the chart's Client where it draws, else the tree. */
export function orgTab(kit: Kit, state: WebStateV2, actions: DashActions, org: OrgSpot): RenderElement {
  const { Box, Client } = kit
  const head = sectionHead(kit, 'Org chart', agentRowsOf(state).length)
  if (Client && !org.isDown) {
    const props = orgPropsOf(chartAgentsOf(state), org.selected, kit.columns)
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
      {org.isDown ? quiet(kit, 'The chart could not draw here, so the agents are listed instead. Org tries the chart again when you come back to it, as /deck does.') : null}
      {orgTree(kit, state, actions, org.selected)}
    </Box>
  )
}
