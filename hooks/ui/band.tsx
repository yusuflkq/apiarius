/**
 * The band above the prompt, drawn only while subagents run: one line of
 * who is at work and on which step ("■ Run outline tests needs your OK to
 * run `npm test` · ■ Phase A Stamping spawns"), and an Open button into the
 * deck's Dashboard. The agent the engine waits on you for leads, saying what it waits
 * on (a question it asks, a permission prompt); then the others in spawn
 * order. Each agent's step is its
 * checklist's (`stepOf`), else what it was given (`scopeOf`), so the line
 * changes when a list does, not with every tool call. Workflow agents and
 * housekeeping loops are left out, as the outline folds them. No hotkeys: a
 * bare digit in an empty prompt would answer a band Button.
 *
 * Pure: Kit, DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import * as F from '../format'
import { isLive, isShownAgent, labelOf, scopeOf, stepOf, waitPhraseOf, waitsOnYou } from '../model'
import { square } from './common'
import { shownStatusOf } from './outlineModel'
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
  // the one the engine waits on you for goes first, saying for what (an idle prompt is no question)
  const waiter = live.find(agent => waitsOnYou(data, agent.id, false))
  const ordered = waiter ? [waiter, ...live.filter(agent => agent !== waiter)] : live
  const named = ordered.slice(0, MOST)
  const more = ordered.length - named.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          {named.flatMap((agent, i) => {
            const lead = [i > 0 ? <Text dimColor> · </Text> : null, square(kit, shownStatusOf(agent, data)), <Text bold>{` ${labelOf(agent)}`}</Text>]
            if (agent === waiter) return [...lead, <Text color={T.warn}>{` ${waitPhraseOf(data, agent.id)}`}</Text>]
            const step = F.oneLine(stepOf(agent) || scopeOf(agent))
            return [...lead, step ? <Text dimColor>{` ${step}`}</Text> : null]
          })}
          {more > 0 ? <Text dimColor>{` · +${more} more`}</Text> : null}
        </Text>
        <Box flexShrink={0}>
          <Button key="band:open" label="Open" onPress={() => actions.open('dashboard')} />
        </Box>
      </Box>
      {theirs}
    </Box>
  )
}
