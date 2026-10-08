/**
 * The band above the prompt, drawn only while subagents run: one line of
 * who is at work and on which step ("■ Run outline tests waits on you:
 * allow Bash "npm test" · ■ Phase A Stamping spawns"), and an Open button
 * into the deck. The agent the engine waits on you for leads, saying what it
 * waits on; then the others in spawn order. Each agent's step is its
 * checklist's (`stepOf`), else what it was given (`scopeOf`), so the line
 * changes when a list does, not with every tool call. Workflow agents and
 * housekeeping loops are left out, as the outline folds them. No hotkeys: a
 * bare digit in an empty prompt would answer a band Button.
 *
 * Pure: Kit, DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as F from '../format'
import { MAIN, agentOf, isLive, isShownAgent, labelOf, scopeOf, stepOf, waitingOnOf } from '../model'
import { square } from './common'
import { shownStatusOf, waitsOnYou } from './outlineModel'
import { T } from './theme'
import type { Actions, DeckModel, Kit } from './types'

/** Agents the line names before it counts the rest. */
const MOST = 4

/** The band's line over what the engine drew there (`theirs`); null while no subagent the outline shows runs. */
export function bandView(kit: Kit, model: DeckModel, actions: Actions, theirs: RenderElement | null): RenderElement | null {
  const { Box, Text, Button } = kit
  const { data } = model
  const live = data.agents.filter(agent => isShownAgent(agent) && isLive(agent.status))
  if (live.length === 0) return null
  // the one the engine waits on you for goes first, saying for what
  const needs = agentOf(data, MAIN)?.needs
  const waiter = needs && needs.kind !== 'idle_prompt' ? live.find(agent => waitsOnYou(data, agent.id)) : undefined
  const ordered = waiter ? [waiter, ...live.filter(agent => agent !== waiter)] : live
  const named = ordered.slice(0, MOST)
  const more = ordered.length - named.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          {named.flatMap((agent, i) => {
            const lead = [i > 0 ? <Text dimColor> · </Text> : null, square(kit, shownStatusOf(agent, data)), <Text bold>{` ${labelOf(agent)}`}</Text>]
            if (agent === waiter && needs) return [...lead, <Text color={T.warn}>{` waits on you: ${waitingOnOf(data, needs)}`}</Text>]
            const step = F.oneLine(stepOf(agent) || scopeOf(agent))
            return [...lead, step ? <Text dimColor>{` ${step}`}</Text> : null]
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
