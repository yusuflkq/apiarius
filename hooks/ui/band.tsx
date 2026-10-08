/**
 * The band above the prompt, drawn only while subagents run: one line of
 * who is at work and on which step ("■ Phase A Stamping spawns · ■ Phase B
 * Running the tests"), and an Open button into the deck. Each agent's step
 * is its checklist's (`stepOf`), else what it was given (`scopeOf`), so the
 * line changes when a list does, not with every tool call. Workflow agents
 * and housekeeping loops are left out, as the outline folds them. No
 * hotkeys: a bare digit in an empty prompt would answer a band Button.
 *
 * Pure: Kit, DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as F from '../format'
import { isLive, isShownAgent, labelOf, scopeOf, statusOf, stepOf } from '../model'
import { square } from './common'
import type { Actions, DeckModel, Kit } from './types'

/** Agents the line names before it counts the rest. */
const MOST = 4

/** The band's line over what the engine drew there (`theirs`); null while no subagent the outline shows runs. */
export function bandView(kit: Kit, model: DeckModel, actions: Actions, theirs: RenderElement | null): RenderElement | null {
  const { Box, Text, Button } = kit
  const { data } = model
  const live = data.agents.filter(agent => isShownAgent(agent) && isLive(agent.status))
  if (live.length === 0) return null
  const named = live.slice(0, MOST)
  const more = live.length - named.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          {named.flatMap((agent, i) => {
            const step = F.oneLine(stepOf(agent) || scopeOf(agent))
            return [
              i > 0 ? <Text dimColor> · </Text> : null,
              square(kit, statusOf(agent, data)),
              <Text bold>{` ${labelOf(agent)}`}</Text>,
              step ? <Text dimColor>{` ${step}`}</Text> : null,
            ]
          })}
          {more > 0 ? <Text dimColor>{` · +${more} more`}</Text> : null}
        </Text>
        <Box flexShrink={0}>
          <Button key="band:open" label="Open" onPress={() => actions.open('agents')} />
        </Box>
      </Box>
      {theirs}
    </Box>
  )
}
