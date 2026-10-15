/**
 * The org chart as an indented tree: where the surface runs no Client (VS
 * Code, the mobile app) and where the chart's Client failed. Each agent one
 * row under the agent that started it: its avatar, its name (the one opened
 * last is the primary plate), its pill and "Open →"; its now line under it.
 * Every line of a row is a press that opens the agent's page, and "Open →"
 * lights while the pointer is on the row.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import { cut, nowLine, treeOf, wrapTicks } from './dashModel'
import { P, toneOf } from './palette'
import { AVATAR, PILL, avatar, buttonSlack, openAgentPage, openButton, openWidth, pill, pressLine, quiet, tickParts } from './parts'

/** The cells each level of the tree indents, and the most levels it indents. */
const INDENT = 2
const LEVELS = 5
/** The cells a row's name keeps at most. */
const NAME = 28

export function orgTree(kit: Kit, state: WebState, actions: DashActions, selected: string | null): RenderElement {
  const { Box, Text, Button } = kit
  const rows = treeOf(state)
  if (rows.length === 0) return quiet(kit, 'No agents yet: the Orchestrator and the agents it starts show here, each under the one that started it.')
  const slack = buttonSlack(kit)
  return (
    <Box key="org:tree" flexDirection="column">
      {rows.map(({ agent, depth }) => {
        const indent = Math.min(depth, LEVELS) * INDENT
        const lead = depth > 0 ? 4 : 3
        // the name's room: the row less its indent, the corner, the avatar, the pill, "Open →" and the gaps between
        const room = Math.max(8, kit.columns - indent - (depth > 0 ? 2 : 0) - 3 - PILL - 1 - openWidth(kit) - 1 - slack)
        const isPicked = agent.id === selected
        const open = () => openAgentPage(actions, state, agent.id)
        const said = wrapTicks(nowLine(agent) || '—', Math.max(8, kit.columns - indent - lead - slack), 1)[0] ?? []
        return (
          <Box key={`org:${agent.id}`} flexDirection="column" paddingLeft={indent}>
            <Box flexDirection="row" columnGap={1} alignItems="center">
              {depth > 0 ? <Text color={P.muted3}>└</Text> : null}
              <Box flexShrink={0}>{avatar(kit, agent.avatar, AVATAR.row, agent.label, toneOf(agent.status).hue)}</Box>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`org:agent:${agent.id}`} label={cut(agent.label, Math.min(NAME, room))} {...(isPicked ? { variant: 'primary' as const } : { plain: true as const })} onPress={open} />
              </Box>
              <Box flexShrink={0}>{pill(kit, agent.status)}</Box>
              <Box flexShrink={0}>{openButton(kit, `org:open:${agent.id}`, toneOf(agent.status).pillFg, open)}</Box>
            </Box>
            <Box paddingLeft={lead}>{pressLine(kit, `org:now:${agent.id}`, tickParts(kit, said, P.muted), open)}</Box>
          </Box>
        )
      })}
    </Box>
  )
}
