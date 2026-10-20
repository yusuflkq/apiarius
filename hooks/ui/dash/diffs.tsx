/**
 * An agent's own diffs, as its page on the native dashboard draws them
 * (`agentDiffsBlock`): the patches of its Edit and Write calls, each file's
 * header over its exact hunks, from the deck model. The drawing itself
 * (`diffs`, `blocksOf`, `groupsOf`) is shared with the earlier builds' detail
 * (../detail), which reads it from here.
 *
 * Pure: Kit and the deck model come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckAgent, DeckData, DeckEdit } from '../../../types'
import { hunksOf } from '../../diff'
import * as F from '../../format'
import { agentOf, labelOf, samePath, shownStatusOf } from '../../model'
import { codeBlocks, delta, emptyLine, treeSize } from '../common'
import type { Kit } from '../types'

/** How much one detail draws: diff characters, files and edits a file, and rows of each list. */
export type DetailRoom = { diffChars: number; files: number; editsPerFile: number; talk: number; items: number; steps: number }

/** The detail as it is drawn first: well inside the tree's bounds beside the outline (each Code under 10,000 characters). */
export const DETAIL_ROOM: DetailRoom = { diffChars: 24_000, files: 10, editsPerFile: 6, talk: 200, items: 30, steps: 30 }
/** The detail drawn again when the first passes DETAIL_CHARS. */
export const DETAIL_LEAN: DetailRoom = { diffChars: 6_000, files: 4, editsPerFile: 2, talk: 30, items: 12, steps: 12 }
/** The characters of text the detail's tree may hold, its share of the host's 100,000 beside the outline and Files. */
export const DETAIL_CHARS = 50_000

/** Below this many characters left in the budget, a diff is noted as cut rather than drawn a few lines deep. */
export const LEAST_DIFF = 400

/** One edit's exact patch; `order` is its place among the edits read (higher is newer). */
export type DiffEditVM = { id: string; path: string; patch: string; order: number }

/** One file's edits, oldest first; `last` is its newest edit's order. */
export type DiffGroupVM = { path: string; added: number; removed: number; isNew: boolean; edits: DiffEditVM[]; last: number }

/** Diffs: the files in the order they were first edited. */
export type DiffsVM = { groups: DiffGroupVM[]; empty: string }

/** Edits grouped by file, files in first-edit order and each file's edits oldest first. */
export function groupsOf(edits: readonly DeckEdit[]): DiffGroupVM[] {
  const groups: DiffGroupVM[] = []
  edits.forEach((edit, order) => {
    let group = groups.find(one => samePath(one.path, edit.path))
    if (!group) {
      group = { path: edit.path, added: 0, removed: 0, isNew: false, edits: [], last: 0 }
      groups.push(group)
    }
    group.edits.push({ id: edit.id, path: edit.path, patch: edit.patch, order })
    group.last = order
    group.added += edit.added
    group.removed += edit.removed
    group.isNew ||= edit.isNew
  })
  return groups
}

/** The smaller of each cap of `room` and DETAIL_LEAN. */
export function leaner(room: DetailRoom): DetailRoom {
  return {
    diffChars: Math.min(room.diffChars, DETAIL_LEAN.diffChars),
    files: Math.min(room.files, DETAIL_LEAN.files),
    editsPerFile: Math.min(room.editsPerFile, DETAIL_LEAN.editsPerFile),
    talk: Math.min(room.talk, DETAIL_LEAN.talk),
    items: Math.min(room.items, DETAIL_LEAN.items),
    steps: Math.min(room.steps, DETAIL_LEAN.steps),
  }
}

/**
 * An agent's Diffs as its page on the native dashboard draws them, from the
 * deck model `data` (this session's, or the sample's): the patches of its
 * own Edit and Write calls, each file's header over its exact hunks, the
 * files edited last drawn from the budget first; drawn again with
 * DETAIL_LEAN's shorter lists and diffs past DETAIL_CHARS. Null for an id
 * that names no agent. (The page draws its tabs, its Activity and its Talk
 * itself, from the web deck's state: ./dash/agent. Classic's detail keeps
 * its own switch: Diffs · Talk · Tool calls.)
 */
export function agentDiffsBlock(kit: Kit, data: DeckData, id: string): RenderElement | null {
  const agent = agentOf(data, id)
  if (!agent || agent.kind === 'you') return null
  const vm: DiffsVM = { groups: groupsOf(data.edits.filter(edit => edit.agent === agent.id)), empty: pageNoEdits(data, agent) }
  const full = diffs(kit, vm, DETAIL_ROOM)
  if (treeSize(full).chars <= DETAIL_CHARS) return full
  return diffs(kit, vm, leaner(DETAIL_ROOM))
}

/** Diffs with none: why, in the page's words. */
function pageNoEdits(data: DeckData, agent: DeckAgent): string {
  const name = labelOf(agent)
  if (agent.kind === 'peer') return 'A peer edits outside this session; what it sends is under Talk.'
  const status = shownStatusOf(agent, data)
  if (status === 'running' || status === 'waiting') return `No edits by ${name} yet: its Edit and Write patches show here the moment it makes them.`
  return agent.kind === 'main' ? 'The Orchestrator edited no files itself: its agents did.' : `${name} did not edit any files.`
}

/** Code blocks for `edits`, the newest drawn first from `budget` (what is left after them is noted as cut), keyed by edit. */
export function blocksOf(kit: Kit, edits: readonly DiffEditVM[], budget: { chars: number }): Map<string, RenderElement[]> {
  const blocks = new Map<string, RenderElement[]>()
  for (const edit of [...edits].sort((a, b) => b.order - a.order)) {
    blocks.set(edit.id, budget.chars < LEAST_DIFF ? [emptyLine(kit, 'Cut to fit the pane.')] : codeBlocks(kit, hunksOf(edit.patch), edit.path, budget))
  }
  return blocks
}

/** Diffs: each file's header row and its exact patches; the files edited last are drawn from the budget first, all shown in first-edit order. */
export function diffs(kit: Kit, vm: DiffsVM, room: DetailRoom): RenderElement {
  const { Box } = kit
  if (vm.groups.length === 0) return emptyLine(kit, vm.empty)

  const latest = [...vm.groups].sort((a, b) => b.last - a.last).slice(0, Math.max(1, room.files))
  const shown = vm.groups.filter(group => latest.includes(group))
  const kept = new Map(shown.map(group => [group, group.edits.slice(-Math.max(1, room.editsPerFile))]))
  const budget = { chars: room.diffChars }
  const blocks = blocksOf(
    kit,
    shown.flatMap(group => kept.get(group) ?? []),
    budget,
  )
  const earlier = vm.groups.length - shown.length

  return (
    <Box flexDirection="column" gap={1}>
      {earlier > 0 ? emptyLine(kit, `${F.plural(earlier, 'file')} edited earlier not shown, to fit the pane.`) : null}
      {shown.map(group => {
        const edits = kept.get(group) ?? []
        return (
          <Box flexDirection="column">
            {diffHeader(kit, group)}
            {group.edits.length > edits.length ? emptyLine(kit, `${F.plural(group.edits.length - edits.length, 'earlier edit')} not shown.`) : null}
            {edits.flatMap(edit => blocks.get(edit.id) ?? [])}
          </Box>
        )
      })}
    </Box>
  )
}

/** A diff file's header row: its directory dim (cut from the start), its name bold, `+a −r`, and "new" for a file it made. */
export function diffHeader(kit: Kit, group: DiffGroupVM): RenderElement {
  const { Box, Text } = kit
  const name = F.baseName(group.path)
  const dir = group.path.slice(0, Math.max(0, group.path.length - name.length))
  return (
    <Box flexDirection="row" columnGap={2}>
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          {dir ? <Text dimColor>{F.truncStart(dir, Math.max(6, kit.columns - Array.from(name).length - 16))}</Text> : null}
          <Text bold>{name}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexShrink={0}>
        {delta(kit, group.added, group.removed)}
        {group.isNew ? <Text dimColor>new</Text> : null}
      </Box>
    </Box>
  )
}
