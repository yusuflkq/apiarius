/**
 * The deck's pane: in the sample (`/deck demo`) a header saying so, then one
 * row of tabs (Dashboard · Org · Plan · Changes · Stats · Classic, hotkeys 1
 * to 6) over the open tab, or over an agent's page opened from it (Back
 * returns to the tab). The Dashboard, Org, Plan and the agent pages draw the
 * web deck's state (./ui/dash), so the pane and the page always agree;
 * Changes, Stats and Classic (the summary and outline of earlier builds)
 * draw the deck's own model (./ui). The band above the prompt is `./ui/band`.
 *
 * Pure: Kit, DeckModel, DashModel and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckTab } from '../types'
import { agentsTab } from './ui/agents'
import { changesTab } from './ui/changes'
import { toggles, type ToggleItem } from './ui/common'
import { agentPage } from './ui/dash/agent'
import { dashboardTab } from './ui/dash/dashboard'
import { orgTab } from './ui/dash/org'
import { P } from './ui/dash/palette'
import { quiet } from './ui/dash/parts'
import { planTab } from './ui/dash/plan'
import { statsTab } from './ui/stats'
import type { DashActions, DashModel, DeckModel, Kit } from './ui/types'

/** The tab row; `agents` is Classic. */
export const TABS: readonly ToggleItem<DeckTab>[] = [
  { id: 'dashboard', label: 'Dashboard', hotkey: '1' },
  { id: 'org', label: 'Org', hotkey: '2' },
  { id: 'plan', label: 'Plan', hotkey: '3' },
  { id: 'changes', label: 'Changes', hotkey: '4' },
  { id: 'stats', label: 'Stats', hotkey: '5' },
  { id: 'agents', label: 'Classic', hotkey: '6' },
]

/** The whole pane: the sample's header when it shows, the tab row, then the open tab or the agent page over it. */
export function deckView(kit: Kit, model: DeckModel, actions: DashActions, dash: DashModel): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column" gap={1}>
      {dash.isDemo ? demoHeader(kit, actions) : null}
      {toggles(kit, 'tab', TABS, model.view.tab, one => actions.setTab(one))}
      {bodyOf(kit, model, actions, dash)}
    </Box>
  )
}

/** Under the tab row: the agent page while one is open, else the tab; the sample has no Changes, Stats or Classic of its own. */
function bodyOf(kit: Kit, model: DeckModel, actions: DashActions, dash: DashModel): RenderElement {
  const { view, now } = model
  const state = dash.state
  if (state === null) return quiet(kit, dash.demoNote || 'Reading the sample…')
  if (view.page !== '') return agentPage(kit, state, dash.paneData, view, actions, now)
  if (view.tab === 'dashboard') return dashboardTab(kit, state, actions, now, dash.isDemo ? null : (model.web ?? null))
  if (view.tab === 'org') return orgTab(kit, state, actions, dash)
  if (view.tab === 'plan') return planTab(kit, state, view, actions, now)
  if (dash.isDemo) return quiet(kit, "The sample covers the Dashboard, Org, Plan and the agent pages. Back to this chat shows this session's Changes, Stats and Classic.")
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
