/**
 * The deck's pane: in the sample (`/deck demo`) a header saying so, then one
 * row of tabs (Dashboard · Org · Plan · Changes, hotkeys 1 to 4) over the
 * open tab, or over an agent's page opened from it (Back returns to the tab).
 * The Dashboard, Org, Plan and the agent pages draw the web deck's state
 * (./ui/dash), so the pane and the page always agree; Changes draws the
 * deck's own model (./ui), as do Stats and Classic (the summary and outline
 * of earlier builds), off the tab row now but still opened by `/deck stats`
 * and `/deck classic`. The band above the prompt is `./ui/band`.
 *
 * Pure: Kit, DeckModel, DashModel and DeckActions come from the hooks module,
 * which works out no outline: Classic's select, fold, zoom and Details are
 * made here of its `pick`, `setOutline` and `openDetails`
 * (`classicActionsOf`).
 */
import type { RenderElement } from 'claude-code'

import type { DeckTab, DeckView } from '../types'
import { agentsTab } from './ui/agents'
import { bandView } from './ui/band'
import { changesTab } from './ui/changes'
import { toggles, type ToggleItem } from './ui/common'
import { agentPage } from './ui/dash/agent'
import { dashboardTab } from './ui/dash/dashboard'
import { orgTab } from './ui/dash/org'
import { P } from './ui/dash/palette'
import { quiet } from './ui/dash/parts'
import { planTab } from './ui/dash/plan'
import * as O from './ui/outlineModel'
import { statsTab } from './ui/stats'
import type { DashActions, DashModel, DeckModel, Kit } from './ui/types'

/** The outline's folds and zoom, as `DeckView` keeps them. */
export type OutlineSpot = Pick<DeckView, 'folded' | 'zoom'>

/**
 * What the hooks module's presses run (its `actionsFor`): the deck's own,
 * with the outline's folds and zoom set as they are handed over, never
 * worked out there. `classicActionsOf` makes Classic's select, fold, zoom
 * and Details of them.
 */
export type DeckActions = Omit<DashActions, 'select' | 'toggleFold' | 'zoomTo' | 'selectAgent' | 'showDetails'> & {
  /** Opens row `id` in the detail block (an agent's id, a plan step's key, `file:` and a path); with `outline`, the outline's folds and zoom become it. */
  pick: (id: string, outline?: OutlineSpot) => void
  /** Sets the outline's folds, its zoom, or both; what is left out stays. */
  setOutline: (outline: Partial<OutlineSpot>) => void
  /** Shows the Agents tab's full outline (Details); with `id` ('' for none), that row picked as `pick` picks it. */
  openDetails: (id: string, outline?: OutlineSpot) => void
}

/**
 * The actions Classic's screens press, made of the hooks module's: a row
 * picked shows in the outline (out of a zoom it lies outside, the branches
 * folded above it opened: `O.revealed`), a fold toggles (`O.foldToggled`), a
 * zoom re-roots it or, on the branch already zoomed, comes back out
 * (`O.zoomFor`). Each works on `model`'s data and view, the hooks module's
 * own, as they stand when the press runs.
 */
export function classicActionsOf(model: Pick<DeckModel, 'data' | 'view'>, actions: DeckActions): DashActions {
  const { data, view } = model
  const { pick, setOutline, openDetails, ...rest } = actions
  return {
    ...rest,
    select: id => pick(id, O.revealed(data, view, id)),
    selectAgent: id => pick(id),
    toggleFold: id => setOutline({ folded: O.foldToggled(data, view, id) }),
    // zooming on the branch already zoomed comes back out: the detail's Zoom and the outline's z both toggle
    zoomTo: id => setOutline({ zoom: id !== '' && id === view.zoom ? '' : O.zoomFor(data, view, id) }),
    showDetails: id => openDetails(id, id !== '' ? O.revealed(data, view, id) : undefined),
  }
}

/** The band above the prompt (./ui/band), its presses Classic's: null when it has nothing to say. */
export function bandOf(kit: Kit, model: DeckModel, actions: DeckActions, theirs: RenderElement | null): RenderElement | null {
  return bandView(kit, model, classicActionsOf(model, actions), theirs)
}

/** The tab row. Stats and Classic (`agents`) are off it: `/deck stats` and `/deck classic` open them, and no tab shows lit there. */
export const TABS: readonly ToggleItem<DeckTab>[] = [
  { id: 'dashboard', label: 'Dashboard', hotkey: '1' },
  { id: 'org', label: 'Org', hotkey: '2' },
  { id: 'plan', label: 'Plan', hotkey: '3' },
  { id: 'changes', label: 'Changes', hotkey: '4' },
]

/** The whole pane: the sample's header when it shows, the tab row, then the open tab or the agent page over it. */
export function deckView(kit: Kit, model: DeckModel, deckActions: DeckActions, dash: DashModel): RenderElement {
  const { Box } = kit
  const actions = classicActionsOf(model, deckActions)
  return (
    <Box flexDirection="column" gap={1}>
      {dash.isDemo ? demoHeader(kit, actions) : null}
      {toggles(kit, 'tab', TABS, model.view.tab, one => actions.setTab(one))}
      {bodyOf(kit, model, actions, dash)}
    </Box>
  )
}

/** Under the tab row: the agent page while one is open, else the tab; the sample has no Changes (nor Stats or Classic) of its own. */
function bodyOf(kit: Kit, model: DeckModel, actions: DashActions, dash: DashModel): RenderElement {
  const { view, now } = model
  const state = dash.state
  if (state === null) return quiet(kit, dash.demoNote || 'Reading the sample…')
  if (view.page !== '') return agentPage(kit, state, dash.paneData, view, actions, now)
  if (view.tab === 'dashboard') return dashboardTab(kit, state, actions, now, dash.isDemo ? null : (model.web ?? null), view.collapsed)
  if (view.tab === 'org') return orgTab(kit, state, actions, dash)
  if (view.tab === 'plan') return planTab(kit, state, view, actions, now)
  if (dash.isDemo) return quiet(kit, "The sample covers the Dashboard, Org, Plan and the agent pages. Back to this chat shows this session's Changes.")
  if (view.tab === 'changes') return changesTab(kit, model, actions)
  if (view.tab === 'stats') return statsTab(kit, model, actions)
  return agentsTab(kit, model, actions)
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
