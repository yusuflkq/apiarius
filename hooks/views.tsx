/**
 * The deck's pane and its band, on the v2 view model (web/CONTRACT.md v2),
 * the one state the web page, the Desktop pane and the terminal draw:
 *
 * - the pane (`deckView`): in the sample (`/deck demo`) a header saying so,
 *   then ./ui/v2: the header, the tabs (1 Dashboard · 2 Chat · 3 Org ·
 *   4 Changes · 5 Settings) and the open tab, or an agent's page over it;
 *   Org's chart as the surface allows (`dash.isOrgDown`, `dash.selected`);
 * - the band above the prompt (`bandOf`): one line, ./ui/band.
 *
 * Pure: Kit, DeckModel, DashModel and DeckActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { bandView } from './ui/band'
import type { DashActions, DashModel, DeckModel, Kit } from './ui/types'
import { v2Deck } from './ui/v2/deck'
import { quiet } from './ui/v2/look'
import { P } from './ui/v2/palette'

/** What the hooks module's presses run (its `actionsFor`): the screens' own, as they press them. */
export type DeckActions = DashActions

/** The band above the prompt (./ui/band): its one line from `model.band`; null when it has nothing to say. */
export function bandOf(kit: Kit, model: DeckModel, actions: DeckActions, theirs: RenderElement | null): RenderElement | null {
  return bandView(kit, model.band, actions, theirs)
}

/** The whole pane: the sample's header when it shows, then the v2 deck (./ui/v2/deck). */
export function deckView(kit: Kit, model: DeckModel, actions: DeckActions, dash: DashModel): RenderElement {
  const { Box } = kit
  const state = dash.v2
  return (
    <Box flexDirection="column" gap={1}>
      {dash.isDemo ? demoHeader(kit, actions) : null}
      {state ? v2Deck(kit, state, dash.v2Files, model, actions, dash.isDemo, { isDown: dash.isOrgDown, selected: dash.selected }) : quiet(kit, dash.demoNote || 'Reading the sample…')}
    </Box>
  )
}

/** The sample's header: Sample data, what it is, and Back to this chat. */
function demoHeader(kit: Kit, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box key="demo:head" flexDirection="row" columnGap={2} alignItems="center">
      <Box flexShrink={0}>
        <Text bold color={P.waitText} backgroundColor="#451a03">
          {' Sample data '}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={P.muted} wrap="wrap">
          A recorded session, its times moved to now. Nothing here reaches Claude.
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Button key="demo:back" label="Back to this chat" variant="primary" onPress={() => actions.exitDemo()} />
      </Box>
    </Box>
  )
}
