/**
 * Diffs as the deck draws them: hunks as native `Code format="diff"`
 * blocks, each under the element's 10,000 characters, spent from one budget
 * so a screen keeps inside the pane's bounds; and an agent's own edit (its
 * Edit or Write patch, the v2 state's `changes.edits` and its lazy patch
 * file) under a line saying which tool, whose and when. Git's hunks are
 * never tagged by agent.
 *
 * Pure: Kit, the state and its lazy files come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { codeSourcesOf, hunksOf, type Hunk } from '../../diff'
import type { V2AgentRow, V2Changes, V2Files, WebStateV2 } from '../../web'
import type { Kit } from '../types'
import { quiet } from './look'
import { P } from './palette'
import { ago, num } from './text'

/** Below this many characters left in a budget, a diff is noted as cut rather than drawn a few lines deep. */
const LEAST = 400

export type Budget = { chars: number }

/** `+a −r` in the add and remove hues, a zero side left out; null when nothing changed. */
export function delta(kit: Kit, added: number, removed: number): RenderElement | null {
  const { Text } = kit
  if (added <= 0 && removed <= 0) return null
  return (
    <Text>
      {added > 0 ? <Text color={P.doneText}>{`+${num(added)}`}</Text> : null}
      {added > 0 && removed > 0 ? ' ' : null}
      {removed > 0 ? <Text color={P.failText}>{`−${num(removed)}`}</Text> : null}
    </Text>
  )
}

/** Hunks as diff Code blocks, spending from `budget`; a quiet note when some or all were cut to fit. */
export function diffBlocks(kit: Kit, hunks: readonly Hunk[], path: string, budget: Budget): RenderElement[] {
  const { Code } = kit
  if (hunks.length === 0) return [quiet(kit, 'No line changes to show.')]
  if (budget.chars < LEAST) return [quiet(kit, 'Cut to fit the pane: close another diff to read this one.')]
  const { sources, isCut, used } = codeSourcesOf(hunks, budget.chars)
  budget.chars -= used
  const blocks: RenderElement[] = sources.map(source => <Code source={source} format="diff" path={path.slice(-200)} />)
  if (isCut) blocks.push(quiet(kit, 'The rest is cut to fit the pane.'))
  return blocks
}

/** The title an agent id goes by in the state's tree; the id itself for one it does not hold. */
export function titleOf(state: Pick<WebStateV2, 'agents'>, id: string): string {
  const row = state.agents.find((one): one is V2AgentRow => one.row === 'agent' && one.id === id)
  return row?.title ?? id
}

/** The agents whose own edits (`ids`) touched a file, by their ids in tree order, each once. */
export function editorIdsOf(state: Pick<WebStateV2, 'agents' | 'changes'>, ids: readonly string[]): string[] {
  const by = new Set(state.changes.edits.filter(edit => ids.includes(edit.id)).map(edit => edit.agent))
  return state.agents.filter((row): row is V2AgentRow => row.row === 'agent' && by.has(row.id)).map(row => row.id)
}

/** The agents whose own edits touched a file, by their titles in tree order, each once: "builder, tester". */
export function editorsOf(state: Pick<WebStateV2, 'agents' | 'changes'>, ids: readonly string[]): string {
  return editorIdsOf(state, ids)
    .map(id => titleOf(state, id))
    .join(', ')
}

/** One edit of an agent's: "Write by builder · 3m" and `+a −r`, then its exact patch (from its lazy file). */
export function editBlock(kit: Kit, state: WebStateV2, files: V2Files, edit: V2Changes['edits'][number], budget: Budget, withPath = false): RenderElement {
  const { Box, Text } = kit
  const patch = files.patch(edit.id)
  const counts = delta(kit, edit.added, edit.removed)
  return (
    <Box key={`edit:${edit.id}`} flexDirection="column">
      <Text wrap="truncate-end">
        <Text color={P.muted}>{withPath ? `${edit.path}  ` : ''}</Text>
        <Text color={P.muted}>{`${edit.tool} by ${titleOf(state, edit.agent)} · ${ago(edit.at, state.now)}`}</Text>
        {counts ? <Text>  </Text> : null}
        {counts}
      </Text>
      {patch === null ? quiet(kit, 'Its patch is not on disk.') : diffBlocks(kit, hunksOf(patch), edit.path, budget)}
    </Box>
  )
}
