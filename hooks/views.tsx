/**
 * The deck's pane: one row of tabs (Agents · Changes · Stats, hotkeys 1 to
 * 3) over the open tab, which draws itself from `./ui`. The band above the
 * prompt is `./ui/band`.
 *
 * Pure: Kit, DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckTab } from '../types'
import { agentsTab } from './ui/agents'
import { changesTab } from './ui/changes'
import { toggles, type ToggleItem } from './ui/common'
import { statsTab } from './ui/stats'
import type { Actions, DeckModel, Kit } from './ui/types'

const TABS: readonly ToggleItem<DeckTab>[] = [
  { id: 'agents', label: 'Agents', hotkey: '1' },
  { id: 'changes', label: 'Changes', hotkey: '2' },
  { id: 'stats', label: 'Stats', hotkey: '3' },
]

/** The whole pane: the tab row, then the open tab. */
export function deckView(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const { Box } = kit
  const tab = model.view.tab
  const body = tab === 'changes' ? changesTab(kit, model, actions) : tab === 'stats' ? statsTab(kit, model, actions) : agentsTab(kit, model, actions)
  return (
    <Box flexDirection="column" gap={1}>
      {toggles(kit, 'tab', TABS, tab, one => actions.setTab(one))}
      {body}
    </Box>
  )
}
