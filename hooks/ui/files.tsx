/**
 * The Agents tab's Files section: the files the agents are changing, who is
 * on each, and the ones two live agents share.
 *
 *     Files  5 changed · 3 more in Changes
 *     ■ hooks/model.ts                    +88 −12  Phase A · editing
 *     ■ hooks/ui/agents.tsx               +52 −20  Phase B + C · shared
 *
 * While agents work, the rows are the files in work: the one each working
 * agent has in hand ("· editing") and the ones two of them share ("· shared",
 * in ochre); the rest are "N more in Changes". Once none works, the files
 * edited last show, for review. A row: the copper rail when it is the
 * selection, a status square while a live agent is on the file, the path in a
 * fixed column (cut from its start so the file name stays), `+a −r` right
 * after it, then who edited it. The path column ends where the outline's
 * agent labels end, and nothing is pinned to a wide pane's far edge. Rows
 * keep the order the files were first edited in; at most ROWS show, and a
 * press opens the file in the detail (`select('file:<path>')`). With nothing
 * changed the section draws nothing.
 *
 * Editors read the same everywhere (`editorsText`): in spawn order, joined
 * with " + ", a leading word they share said once ("Phase B + C").
 *
 * `filesVM` reads the data into rows; `filesSection` draws them, and
 * `fileLine` draws one row's columns for the step detail too. Pure: no clock
 * reads, and equal data gives an equal drawing.
 */
import type { RenderElement } from 'claude-code'

import type { DeckData, DeckShownStatus } from '../../types'
import * as F from '../format'
import type { GitState } from '../git'
import * as M from '../model'
import { delta, rail, square } from './common'
import { waitsOnYou } from './outlineModel'
import { T } from './theme'
import type { Actions, Kit } from './types'

/** The most file rows the section shows; the rest are counted, and Changes lists them all. */
export const ROWS = 6
/** The rail and the square's column, each two cells, as the outline's rows keep them. */
const BAR = 2
const MARK = 2
/** The path's column: it ends where the outline's agent labels end (their column at depth 3 and its indent). */
const PATH = 28
/** `+a −r`'s column, right after the path, as the outline's. */
const DELTA = 12
/** The least room the editors keep after `+a −r`; a narrower pane takes it from the path. */
const EDITORS_ROOM = 14
/** Cells a desktop's native button takes beyond its label's characters. */
const BUTTON_SLACK = 4

export type FileNote = 'editing' | 'shared' | ''

export type FileRowVM = {
  path: string
  /** The square's status while a live agent is on the file (waiting before running); null leaves the column blank. */
  status: DeckShownStatus | null
  /** The editors' labels, joined (`editorsText`). */
  editors: string
  note: FileNote
  added: number
  removed: number
  isSelected: boolean
}

export type FilesVM = {
  rows: FileRowVM[]
  /** Every file the agents changed this session. */
  total: number
  /** The files not shown here: "N more in Changes". */
  more: number
}

// 1. The data worker's query (model.ts `filesOf`), read here and nowhere else in the section.

/** One file the agents changed: its path and absolute path, who edited it, which of them are at work now, its counts and when it was first and last edited. */
export type FileFacts = {
  path: string
  abs: string
  editors: string[]
  live: string[]
  /** Two agents at work now are both on it: they edited it while both were live, and both still are. */
  isShared: boolean
  added: number
  removed: number
  firstAt: number
  lastAt: number
}

/** Whether agent `id` is at work now: running, or held waiting. */
export function isOn(data: DeckData, id: string): boolean {
  const agent = M.agentOf(data, id)
  if (!agent) return false
  const status = M.statusOf(agent, data)
  return status === 'running' || status === 'waiting'
}

/** Every file the agents changed (the model's `filesOf`), in the order each was first edited (on a tie, the order the deck first kept them). */
export function fileFactsOf(data: DeckData): FileFacts[] {
  const firstOf = new Map<string, number>()
  const keptAt = new Map<string, number>()
  Object.values(data.files).forEach((file, i) => {
    const key = M.fileKeyOf(file.abs || file.path)
    firstOf.set(key, Math.min(file.lastAt, ...file.editors.map(editor => editor.firstAt)))
    keptAt.set(key, i)
  })
  const rankOf = (one: FileFacts) => keptAt.get(M.fileKeyOf(one.abs || one.path)) ?? Number.MAX_SAFE_INTEGER
  const facts = M.filesOf(data).map((file): FileFacts => {
    const live = file.live ? file.editors.filter(id => isOn(data, id)) : []
    return {
      path: file.path,
      abs: file.abs,
      editors: [...file.editors],
      live,
      isShared: file.isShared && live.length >= 2,
      added: file.added,
      removed: file.removed,
      firstAt: firstOf.get(M.fileKeyOf(file.abs || file.path)) ?? file.lastAt,
      lastAt: file.lastAt,
    }
  })
  return facts.sort((a, b) => a.firstAt - b.firstAt || rankOf(a) - rankOf(b))
}

/** Whether `edit` (its path or its absolute path) is of the file `facts` describes. */
export function isEditOf(edit: { path: string; abs: string }, path: string, abs = ''): boolean {
  return M.samePath(edit.path, path) || (abs !== '' && edit.abs !== '' && M.samePath(edit.abs, abs))
}

// 2. The rows.

/** The label the deck gives an editor: its agent's, the Orchestrator's, else a short form of the id. */
export function editorLabel(data: DeckData, id: string): string {
  const agent = M.agentOf(data, id)
  if (agent) return M.labelOf(agent)
  if (id === M.MAIN) return M.ORCHESTRATOR
  return F.trunc(id.replace(/^peer:/, ''), 18)
}

/**
 * Labels joined with " + ", a leading word they all share said once
 * ("Phase B", "Phase C" is "Phase B + C"); past three, "+N".
 */
export function joinLabels(labels: readonly string[]): string {
  const shown = labels.slice(0, 3)
  const extra = labels.length - shown.length
  const words = shown.map(label => label.split(' '))
  const first = words[0] ?? []
  let common = 0
  while (shown.length > 1 && words.every(one => one.length > common + 1 && one[common] === first[common])) common += 1
  const parts = shown.map((label, i) => (i === 0 || common === 0 ? label : (words[i] ?? []).slice(common).join(' ')))
  return `${parts.join(' + ')}${extra > 0 ? ` +${extra}` : ''}`
}

/**
 * Who edited something, as every list of editors says it (Files, a step's
 * files, Changes): the editors in spawn order (the outline's), each once,
 * joined by `joinLabels`.
 */
export function editorsText(data: DeckData, ids: readonly string[]): string {
  const order = new Map(data.agents.map((agent, i) => [agent.id, i] as const))
  const ranked = [...new Set(ids)].map((id, i) => ({ id, rank: order.get(id) ?? data.agents.length + i }))
  return joinLabels(ranked.sort((a, b) => a.rank - b.rank).map(one => editorLabel(data, one.id)))
}

/** The square a file shows: waiting while the agent on it waits on you, running while one is at work; null while none is on it. */
export function fileStatusOf(data: DeckData, live: readonly string[]): DeckShownStatus | null {
  const on = live.filter(id => M.agentOf(data, id) !== undefined)
  if (on.some(id => waitsOnYou(data, id))) return 'waiting'
  return on.length > 0 ? 'running' : null
}

/** The paths each agent at work touched last: its "editing" file. */
function editingPathsOf(data: DeckData): string[] {
  const lastOf = new Map<string, { path: string; at: number }>()
  for (const edit of data.edits) {
    const last = lastOf.get(edit.agent)
    if (!last || edit.at >= last.at) lastOf.set(edit.agent, { path: edit.path, at: edit.at })
  }
  return [...lastOf.entries()].filter(([id]) => isOn(data, id)).map(([, last]) => last.path)
}

/**
 * The section's rows. While an agent is at work on a file, only the files in
 * work show: each working agent's file in hand ("· editing") and the files
 * two of them share; the rest are "N more in Changes". Once none is at work,
 * the files edited last show, for review. `selected` is the outline's
 * selection (`view.agent`): the row of `file:<path>` carries the copper rail
 * and is always shown. `git` and `now` are read nowhere: the rows are the
 * agents' own edits, and nothing here moves with the clock.
 */
export function filesVM(data: DeckData, git: GitState, now: number, selected = ''): FilesVM {
  void git
  void now
  const facts = fileFactsOf(data)
  const editing = editingPathsOf(data)

  const rows = facts.map(
    (one): FileRowVM => ({
      path: one.path,
      status: fileStatusOf(data, one.live),
      editors: editorsText(data, one.editors),
      note: one.isShared ? 'shared' : editing.some(path => isEditOf({ path, abs: '' }, one.path)) ? 'editing' : '',
      added: one.added,
      removed: one.removed,
      isSelected: selected === `file:${one.path}`,
    }),
  )

  // while agents work: only the files in work (each one's file in hand, the shared ones) and the selection; once none is
  // at work, the files edited last, for review. Drawn in first-edit order either way.
  const isInWork = rows.some(row => row.status !== null)
  const lastAt = facts.map(one => one.lastAt)
  const picked = rows
    .map((row, i) => ({ row, i }))
    .filter(one => !isInWork || one.row.isSelected || one.row.note !== '')
    .sort((a, b) => rank(b.row) - rank(a.row) || (lastAt[b.i] ?? 0) - (lastAt[a.i] ?? 0) || a.i - b.i)
    .slice(0, ROWS)
    .map(one => one.i)
    .sort((a, b) => a - b)
  const shown = picked.flatMap(i => (rows[i] ? [rows[i]] : []))
  return { rows: shown, total: rows.length, more: rows.length - shown.length }
}

/** How strongly a row asks to be shown: the selection, then a shared file, then one a live agent is on. */
function rank(row: FileRowVM): number {
  return (row.isSelected ? 4 : 0) + (row.note === 'shared' ? 2 : 0) + (row.status ? 1 : 0)
}

// 3. The drawing.

/** A file row's columns in cells: the path's box and the label it holds, and `+a −r`'s. */
export type FileCols = { path: number; label: number; delta: number }

/** The columns every file row keeps, here and in a step's detail: fixed, so they never move with the paths shown. */
export function fileColsOf(kit: Kit): FileCols {
  const path = Math.max(12, Math.min(PATH, kit.columns - BAR - MARK - DELTA - 2 - EDITORS_ROOM))
  const slack = kit.surface === 'terminal' ? 0 : BUTTON_SLACK
  return { path, label: Math.max(8, path - slack), delta: DELTA }
}

/**
 * One file row's columns after the rail: the square, the path (a plain
 * Button keyed `key`, dim while no live agent is on it and it is not the
 * selection), `+a −r`, then the editors and their note.
 */
export function fileLine(kit: Kit, cols: FileCols, row: FileRowVM, key: string, onPress: () => void): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row">
      <Box width={MARK} flexShrink={0}>
        {row.status ? square(kit, row.status) : null}
      </Box>
      <Box width={cols.path} flexShrink={0}>
        <Button key={key} label={F.truncStart(row.path, cols.label)} plain dimColor={!row.isSelected && row.status === null} onPress={onPress} />
      </Box>
      <Box width={cols.delta} flexShrink={0} justifyContent="flex-end">
        {delta(kit, row.added, row.removed)}
      </Box>
      <Box flexGrow={1} flexShrink={1} paddingLeft={2}>
        <Text wrap="truncate-end">
          {row.editors}
          {row.note === 'shared' ? <Text color={T.warn}> · shared</Text> : null}
          {row.note === 'editing' ? <Text dimColor> · editing</Text> : null}
        </Text>
      </Box>
    </Box>
  )
}

/** The Files section: a header with the count (and "N more in Changes"), then a row per file shown; nothing while no file changed. */
export function filesSection(kit: Kit, vm: FilesVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  if (vm.rows.length === 0) return <Box flexDirection="column" />
  const cols = fileColsOf(kit)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1} paddingLeft={BAR}>
        <Text wrap="truncate-end">
          <Text bold>Files</Text>
          <Text dimColor>{`  ${F.num(vm.total)} changed${vm.more > 0 ? ' ·' : ''}`}</Text>
        </Text>
        {vm.more > 0 ? <Button key="files:more" label={`${F.num(vm.more)} more in Changes`} plain dimColor onPress={() => actions.setTab('changes')} /> : null}
      </Box>
      {vm.rows.map(row => (
        <Box flexDirection="column" {...rail(row.isSelected, BAR)}>
          {fileLine(kit, cols, row, `files:${row.path}`, () => actions.select(`file:${row.path}`))}
        </Box>
      ))}
    </Box>
  )
}
