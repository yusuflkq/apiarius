/**
 * The band above the prompt, drawn only while subagents run: one line of
 * who is at work and on what ("■ fixer Edit src/auth.ts · ■ helper Bash npm
 * test"), and an Open button into the deck. No hotkeys: a bare digit in an
 * empty prompt would answer a band Button.
 *
 * Pure: Kit, DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { isLive, labelOf, statusOf } from '../model'
import { nowLineOf } from './adapt'
import { glyph } from './common'
import type { Actions, DeckModel, Kit } from './types'

/** Agents the line names before it counts the rest. */
const MOST = 4

/** The band's line over what the engine drew there (`theirs`); null while no subagent runs. */
export function bandView(kit: Kit, model: DeckModel, actions: Actions, theirs: RenderElement | null): RenderElement | null {
  const { Box, Text, Button } = kit
  const live = model.data.agents.filter(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && isLive(agent.status))
  if (live.length === 0) return null
  const named = live.slice(0, MOST)
  const more = live.length - named.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          {named.flatMap((agent, i) => [
            i > 0 ? <Text dimColor> · </Text> : null,
            glyph(kit, statusOf(agent)),
            <Text bold>{` ${labelOf(agent)}`}</Text>,
            <Text dimColor>{` ${nowLineOf(agent)}`}</Text>,
          ])}
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
