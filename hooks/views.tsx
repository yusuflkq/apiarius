/**
 * The deck's pane and its band, on the v2 view model (web/CONTRACT.md v2),
 * the one state the web page, the Desktop pane and the terminal draw:
 *
 * - the pane (`deckView`): in the sample (`/deck demo`) a header saying so,
 *   then ./ui/v2: the header, the tabs (1 Now · 2 Chat · 3 Changes) and the
 *   open tab, or an agent's page, Inspect or help over it;
 * - the band above the prompt (`bandOf`): one line, ./ui/band.
 *
 * Pure: Kit, DeckModel, DashModel and DeckActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView } from '../types'
import { bandView } from './ui/band'
import type { DashActions, DashModel, DeckModel, Kit } from './ui/types'
import { v2Deck } from './ui/v2/deck'
import { quiet } from './ui/v2/look'
import { P } from './ui/v2/palette'

/** The outline's folds and zoom, as `DeckView` keeps them (an earlier build's; nothing draws them now). */
export type OutlineSpot = Pick<DeckView, 'folded' | 'zoom'>

/**
 * What the hooks module's presses run (its `actionsFor`): the deck's own,
 * and three an earlier build's outline took (`pick`, `setOutline`,
 * `openDetails`), which no screen presses now.
 */
export type DeckActions = Omit<DashActions, 'select' | 'toggleFold' | 'zoomTo' | 'selectAgent' | 'showDetails'> & {
  /** Opens row `id` in the detail block (an agent's id, a plan step's key, `file:` and a path); with `outline`, the outline's folds and zoom become it. */
  pick: (id: string, outline?: OutlineSpot) => void
  /** Sets the outline's folds, its zoom, or both; what is left out stays. */
  setOutline: (outline: Partial<OutlineSpot>) => void
  /** Shows the Agents tab's full outline (Details); with `id` ('' for none), that row picked as `pick` picks it. */
  openDetails: (id: string, outline?: OutlineSpot) => void
}

/** The actions the screens press, of the hooks module's. */
function dashActionsOf(actions: DeckActions): DashActions {
  const { pick, setOutline, openDetails, ...rest } = actions
  return {
    ...rest,
    select: id => pick(id),
    selectAgent: id => pick(id),
    toggleFold: () => undefined,
    zoomTo: () => undefined,
    showDetails: id => openDetails(id),
  }
}

/** The band above the prompt (./ui/band): its one line from `model.band`; null when it has nothing to say. */
export function bandOf(kit: Kit, model: DeckModel, actions: DeckActions, theirs: RenderElement | null): RenderElement | null {
  return bandView(kit, model.band, actions, theirs)
}

/** The whole pane: the sample's header when it shows, then the v2 deck (./ui/v2/deck). */
export function deckView(kit: Kit, model: DeckModel, deckActions: DeckActions, dash: DashModel): RenderElement {
  const { Box } = kit
  const actions = dashActionsOf(deckActions)
  const state = dash.v2
  return (
    <Box flexDirection="column" gap={1}>
      {dash.isDemo ? demoHeader(kit, actions) : null}
      {state ? v2Deck(kit, state, dash.v2Files, model, actions, dash.isDemo) : quiet(kit, dash.demoNote || 'Reading the sample…')}
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
