/**
 * The Org tab: who started whom, the Orchestrator at the top and every agent
 * under the one that started it; a press on an agent opens its page.
 *
 * Where the surface runs a surface module (the terminal and the desktop) the
 * chart is the org chart Client (./org.client.tsx, laid out by
 * ./orgLayout.ts): bordered cards over box-drawing connectors, as tall as it
 * needs (MAX_ROWS at most; it pans for the rest), across the pane. Its props
 * (orgPropsOf) carry the rows the Client is given and the columns they were
 * laid out in, which it draws to: never what the surface measures of it. A
 * click on a card posts `{ type: 'open', id }`, which the hooks module
 * answers by opening that agent's page. Its key stays `org`, so its pan and
 * hover survive the deck's redraws.
 *
 * Elsewhere (VS Code, the mobile app), and on a surface where the Client
 * failed, the agents are an indented tree (./orgTree); the chart is tried
 * again the next time the Org tab shows, and whenever /deck opens.
 *
 * Pure: Kit, the state, DashModel and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebState } from '../../web'
import type { DashActions, DashModel, Kit } from '../types'
import { chartAgentsOf } from './dashModel'
import { orgPropsOf } from './orgLayout'
import { orgTree } from './orgTree'
import { quiet, sectionHead } from './parts'

export function orgTab(kit: Kit, state: WebState, actions: DashActions, dash: DashModel): RenderElement {
  const { Box, Client } = kit
  const head = sectionHead(kit, 'Org chart', state.agents.length)
  if (Client && !dash.isOrgDown) {
    const props = orgPropsOf(chartAgentsOf(state), dash.selected, kit.columns)
    return (
      <Box flexDirection="column" gap={1}>
        {head}
        <Client key="org" module="./org.client.tsx" width="100%" height={props.rows} props={props} />
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {head}
      {dash.isOrgDown ? quiet(kit, 'The chart could not draw here, so the agents are listed instead. The Org tab tries the chart again when you come back to it, as /deck does.') : null}
      {orgTree(kit, state, actions, dash.selected)}
    </Box>
  )
}
