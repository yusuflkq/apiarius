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
import { rowsOf } from './ui/v2/fit'
import { quiet } from './ui/v2/look'
import { P } from './ui/v2/palette'
import { viewingBar } from './ui/v2/sessions'

/** What the hooks module's presses run (its `actionsFor`): the screens' own, as they press them. */
export type DeckActions = DashActions

/** The band above the prompt (./ui/band): its one line from `model.band`; null when it has nothing to say. */
export function bandOf(kit: Kit, model: DeckModel, actions: DeckActions, theirs: RenderElement | null): RenderElement | null {
  return bandView(kit, model.band, actions, theirs)
}

/** The whole pane: the sample's header when it shows, then the v2 deck (./ui/v2/deck); another session's deck under its bar while one is viewed (`dash.viewing`). */
export function deckView(kit: Kit, model: DeckModel, actions: DeckActions, dash: DashModel): RenderElement {
  const { Box } = kit
  if (dash.viewing) return viewedView(kit, dash.viewing, dash)
  const state = dash.v2
  const head = dash.isDemo ? demoHeader(kit, actions) : null
  // the terminal: the deck gets the rows the sample's header and its gap leave
  const deck = head && kit.rows !== undefined ? { ...kit, rows: Math.max(1, kit.rows - rowsOf(head, kit.columns) - 1) } : kit
  return (
    <Box flexDirection="column" gap={1}>
      {head}
      {state ? v2Deck(deck, state, dash.v2Files, model, actions, dash.isDemo, { isDown: dash.isOrgDown, selected: dash.selected }) : quiet(kit, dash.demoNote || 'Reading the sample…')}
    </Box>
  )
}

/** Another session's deck, read-only, under its bar ("Viewing <title>", Back to this chat): its own state, lazy files, model and presses. */
function viewedView(kit: Kit, viewing: NonNullable<DashModel['viewing']>, dash: DashModel): RenderElement {
  const { Box } = kit
  const bar = viewingBar(kit, viewing.bar, viewing.actions)
  // the terminal: the deck gets the rows the bar and its gap leave
  const deck = kit.rows !== undefined ? { ...kit, rows: Math.max(1, kit.rows - rowsOf(bar, kit.columns) - 1) } : kit
  return (
    <Box flexDirection="column" gap={1}>
      {bar}
      {viewing.state ? v2Deck(deck, viewing.state, viewing.files, viewing.model, viewing.actions, false, { isDown: dash.isOrgDown, selected: null }) : quiet(kit, viewing.bar.note || 'Reading its deck…')}
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
