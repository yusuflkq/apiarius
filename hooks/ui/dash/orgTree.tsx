/**
 * The org chart as an indented tree: where the surface runs no Client (VS
 * Code, the mobile app) and where the chart's Client failed. Each agent one
 * row under the agent that started it: its avatar, its name (a press opens
 * its page; the one opened last is the primary plate), its pill and its now
 * line.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import { cut, nowLine, treeOf } from './dashModel'
import { P, toneOf } from './palette'
import { AVATAR, PILL, avatar, pill, quiet, tickTexts } from './parts'

/** The cells each level of the tree indents, and the most levels it indents. */
const INDENT = 2
const LEVELS = 5

export function orgTree(kit: Kit, state: WebState, actions: DashActions, selected: string | null): RenderElement {
  const { Box, Text, Button } = kit
  const rows = treeOf(state)
  if (rows.length === 0) return quiet(kit, 'No agents yet: the Orchestrator and the agents it starts show here, each under the one that started it.')
  return (
    <Box key="org:tree" flexDirection="column">
      {rows.map(({ agent, depth }) => {
        const indent = Math.min(depth, LEVELS) * INDENT
        const room = Math.max(8, kit.columns - indent - 4 - PILL)
        const isPicked = agent.id === selected
        return (
          <Box key={`org:${agent.id}`} flexDirection="column" paddingLeft={indent}>
            <Box flexDirection="row" columnGap={1} alignItems="center">
              {depth > 0 ? <Text color={P.muted3}>└</Text> : null}
              <Box flexShrink={0}>{avatar(kit, agent.avatar, AVATAR.row, agent.label, toneOf(agent.status).hue)}</Box>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`org:agent:${agent.id}`} label={cut(agent.label, Math.min(28, room))} {...(isPicked ? { variant: 'primary' as const } : { plain: true as const })} onPress={() => actions.openAgent(agent.id)} />
              </Box>
              <Box flexShrink={0}>{pill(kit, agent.status)}</Box>
            </Box>
            <Box paddingLeft={depth > 0 ? 4 : 3}>
              <Text wrap="truncate-end">{tickTexts(kit, cut(nowLine(agent) || '—', room + PILL), P.muted)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
