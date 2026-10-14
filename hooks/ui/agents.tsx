/**
 * The Agents tab, the deck's default view, top to bottom: the header (what
 * needs you, the goal, one summary line) and the outline you click
 * (./outline); the Files section (./files), while files changed; and the
 * detail block (./detail), the one part a click on the outline changes,
 * drawn once a row is selected. Before the first prompt the whole tab is one
 * quiet line.
 *
 * Native text at the host's size throughout: no Svg, no timer-driven text.
 * Pure: Kit, DeckModel and Actions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { emptyLine, fitsTree } from './common'
import { detailBlock, detailVM } from './detail'
import { filesSection, filesVM } from './files'
import { headerBlock, outlineBlock } from './outline'
import { MOST_ROWS, headerOf, outlineOf } from './outlineModel'
import type { Actions, DeckModel, Kit } from './types'

/** The outline rows a drawing keeps when the full one would pass the host's bounds. */
const LEAN_ROWS = 40

/**
 * The Agents tab. Should the whole drawing pass the host's bounds (about
 * 20,000 nodes and 100,000 characters), it is drawn again with a shorter
 * outline rather than refused.
 */
export function agentsTab(kit: Kit, model: DeckModel, actions: Actions): RenderElement {
  const full = drawAgents(kit, model, actions, MOST_ROWS)
  return fitsTree(full) ? full : drawAgents(kit, model, actions, LEAN_ROWS)
}

function drawAgents(kit: Kit, model: DeckModel, actions: Actions, most: number): RenderElement {
  const { Box } = kit
  const { data, view, git, now } = model
  const outline = outlineOf(data, view, now, most, git.root)
  // before the first prompt: one line, not a page of placeholders
  if (outline.empty) return <Box paddingLeft={2}>{emptyLine(kit, outline.empty)}</Box>
  const files = filesVM(data, git, now, view.agent)
  const detail = detailVM(data, view, git, model.chat, model.fileDiff, now)
  return (
    <Box flexDirection="column" gap={1}>
      {headerBlock(kit, headerOf(data, git, now), actions)}
      {outlineBlock(kit, outline, actions)}
      {files.rows.length > 0 ? filesSection(kit, files, actions) : null}
      {detail.kind !== 'none' ? detailBlock(kit, detail, actions) : null}
    </Box>
  )
}
