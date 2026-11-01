/**
 * The deck's pane and its band, on the v2 view model,
 * the one state the web page, the Desktop pane and the terminal draw:
 *
 * - the pane (`deckView`): in the sample (`/apiarius demo`) a header saying so,
 *   then ./ui/v2: the header, the tabs (1 Dashboard · 2 Chat · 3 Org ·
 *   4 Changes · 5 Inspect · 6 Settings) and the open tab, or an agent's page
 *   over it; Org's chart as the surface allows (`dash.isOrgDown`,
 *   `dash.selected`); the deck of whichever session is picked from the
 *   header's switcher, this one's or another's, drawn the same way;
 * - the band above the prompt (`bandOf`): one line, ./ui/band, and a row for
 *   each thing the Browser pane's page sent in your voice, waiting for your Send.
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
import { pendingDeck } from './ui/v2/sessions'

/** What the hooks module's presses run (its `actionsFor`): the screens' own, as they press them. */
export type DeckActions = DashActions

/** The band above the prompt (./ui/band): the rows waiting for your Send (`model.held`), then its one line from `model.band`; null when it has nothing to say. */
export function bandOf(kit: Kit, model: DeckModel, actions: DeckActions, theirs: RenderElement | null): RenderElement | null {
  return bandView(kit, model.band, actions, theirs, model.held ?? [])
}

/** The whole pane: the sample's header when it shows, then the v2 deck (./ui/v2/deck) of the session picked: this one's, or another's in its place (`dash.viewing`), its own state, lazy files, model and presses, its switcher saying where to go next. */
export function deckView(kit: Kit, model: DeckModel, actions: DeckActions, dash: DashModel): RenderElement {
  const { Box } = kit
  const state = dash.v2
  const head = dash.isDemo ? demoHeader(kit, actions) : null
  // the terminal: the deck gets the rows the sample's header and its gap leave
  const deck = head && kit.rows !== undefined ? { ...kit, rows: Math.max(1, kit.rows - rowsOf(head, kit.columns) - 1) } : kit
  const shown = dash.viewing
  const body = shown
    ? shown.state
      ? v2Deck(deck, shown.state, shown.files, shown.model, shown.actions, false, { isDown: dash.isOrgDown, selected: null })
      : pendingDeck(deck, shown.id, shown.row, shown.list, shown.model.isSessionsOpen === true, shown.note, shown.actions)
    : state
      ? v2Deck(deck, state, dash.v2Files, model, actions, dash.isDemo, { isDown: dash.isOrgDown, selected: dash.selected })
      : quiet(kit, dash.demoNote || 'Reading the sample…')
  return (
    <Box flexDirection="column" gap={1}>
      {head}
      {body}
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
