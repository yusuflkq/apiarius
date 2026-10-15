/**
 * The Plan tab, as the web deck's Plan page reads: the goal, the plan's
 * progress and its steps, each a row that opens to who works on it.
 *
 * Pure: Kit, the state, the view and DashActions come from the hooks module.
 * What is open lives in the deck's view (`DeckView.planOpen`), so a redraw
 * or a reload keeps it.
 */
import type { RenderElement } from 'claude-code'

import type { DeckView } from '../../../types'
import type { WebState } from '../../web'
import type { DashActions, Kit } from '../types'
import { quiet } from './parts'

/** A step's id in `DeckView.planOpen`. */
export function stepOpenId(key: string): string {
  return `step:${key}`
}

/** The key of a step's row in the drawing: what `openStep` scrolls to. */
export function stepRowKey(key: string): string {
  return `plan:step:${key}`
}

/** The tab: the plan's steps, one a line for now. */
export function planTab(kit: Kit, state: WebState, view: DeckView, actions: DashActions, now: number): RenderElement {
  const { Box, Text } = kit
  void view
  void actions
  void now
  const steps = state.plan.steps
  if (steps.length === 0) return quiet(kit, 'No plan yet: when the Orchestrator writes a todo list or a plan, its steps show here with who works on each.')
  return (
    <Box flexDirection="column">
      {steps.map((step, i) => (
        <Box key={stepRowKey(step.key || String(i + 1))} flexDirection="row">
          <Text wrap="truncate-end">{`${String(i + 1).padStart(2, '0')}  ${step.text}`}</Text>
        </Box>
      ))}
    </Box>
  )
}
