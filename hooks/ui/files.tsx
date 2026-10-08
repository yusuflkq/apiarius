/**
 * The Agents tab's Files section: the files the agents are changing, who is
 * on each, and the ones two live agents share.
 *
 *     Files  5 changed · 3 more in Changes
 *       ■ hooks/model.ts         Phase A · editing      +88 −12
 *         hooks/ui/agents.tsx    Phase B + C · shared   +52 −20
 *
 * One row per file: the copper bar when it is the selection, a status
 * square while a live agent is on it, the path cut from its start so the
 * file name stays, who edited it ("· editing" on the file each running
 * agent touched last, "· shared" in ochre when two live agents are on it),
 * and `+a −r` at the right. Rows keep the order the files were first
 * edited in, so a row never moves; at most ROWS show, the live and shared
 * ones picked first, and a press opens the file in the detail
 * (`select('file:<path>')`).
 *
 * `filesVM` reads the data into rows; `filesSection` draws them. Pure: no
 * clock reads, and equal data gives an equal drawing.
 */
import type { RenderElement } from 'claude-code'

import type { DeckData, DeckShownStatus } from '../../types'
import * as F from '../format'
import type { GitState } from '../git'
import * as M from '../model'
import { copperBar, delta, deltaWidth, emptyLine, square } from './common'
import { T } from './theme'
import type { Actions, Kit } from './types'

/** The most file rows the section shows; the rest are counted, and Changes lists them all. */
export const ROWS = 6
/** The reserved bar column and the square's, each a glyph and a space, as the outline's rows keep them. */
const BAR = 2
const MARK = 2
/** Cells a desktop's native button takes beyond its label's characters. */
const BUTTON_SLACK = 4
/** The least room the editors' column keeps. */
const EDITORS_ROOM = 14

export type FileNote = 'editing' | 'shared' | ''

export type FileRowVM = {
  path: string
  /** The square's status while a live agent is on the file (waiting before running); null leaves the column blank. */
  status: DeckShownStatus | null
  /** The editors' labels, joined ("Phase B + C"). */
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

/** Whether agent `id` is at work now: running, or held waiting on you. */
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

/** The square a file shows: waiting while a live agent on it waits on you, running while one runs; null while none is on it. */
export function fileStatusOf(data: DeckData, live: readonly string[]): DeckShownStatus | null {
  const statuses = live.flatMap(id => {
    const agent = M.agentOf(data, id)
    return agent ? [M.statusOf(agent, data)] : []
  })
  if (statuses.includes('waiting')) return 'waiting'
  return statuses.length > 0 ? 'running' : null
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
 * The section's rows. `selected` is the outline's selection (`view.agent`):
 * the row of `file:<path>` carries the copper bar and is always shown. `git`
 * and `now` are read nowhere: the rows are the agents' own edits, and
 * nothing here moves with the clock.
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
      editors: joinLabels(one.editors.map(id => editorLabel(data, id))),
      note: one.isShared ? 'shared' : editing.some(path => isEditOf({ path, abs: '' }, one.path)) ? 'editing' : '',
      added: one.added,
      removed: one.removed,
      isSelected: selected === `file:${one.path}`,
    }),
  )

  // which rows show: the selection, shared files, files a live agent is on, then the files edited last; drawn in first-edit order
  const lastAt = facts.map(one => one.lastAt)
  const picked = rows
    .map((row, i) => ({ row, i }))
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

/** The rows' columns in cells: the path's label and its box, and `+a −r` at the right. */
type Cols = { label: number; box: number; counts: number }

function colsOf(kit: Kit, rows: readonly FileRowVM[]): Cols {
  const counts = Math.max(0, ...rows.map(row => deltaWidth(row.added, row.removed)))
  const longest = Math.max(8, ...rows.map(row => Array.from(row.path).length))
  const slack = kit.surface === 'terminal' ? 0 : BUTTON_SLACK
  const room = kit.columns - BAR - MARK - 1 - EDITORS_ROOM - 1 - counts - slack
  const label = Math.max(12, Math.min(longest, room, Math.floor(kit.columns * 0.55)))
  return { label, box: label + slack, counts }
}

/** The Files section: a header with the count (and "N more in Changes"), then a row per file shown. */
export function filesSection(kit: Kit, vm: FilesVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const head = (
    <Box flexDirection="row" columnGap={1} paddingLeft={BAR}>
      <Text wrap="truncate-end">
        <Text bold>Files</Text>
        {vm.total > 0 ? <Text dimColor>{`  ${F.num(vm.total)} changed${vm.more > 0 ? ' ·' : ''}`}</Text> : null}
      </Text>
      {vm.more > 0 ? <Button key="files:more" label={`${F.num(vm.more)} more in Changes`} plain dimColor onPress={() => actions.setTab('changes')} /> : null}
    </Box>
  )
  if (vm.rows.length === 0) {
    return (
      <Box flexDirection="column">
        {head}
        <Box paddingLeft={BAR + MARK}>{emptyLine(kit, 'No files changed yet. Files the agents edit show here as they change.')}</Box>
      </Box>
    )
  }

  const cols = colsOf(kit, vm.rows)
  return (
    <Box flexDirection="column">
      {head}
      {vm.rows.map(row => fileRow(kit, cols, row, actions))}
    </Box>
  )
}

function fileRow(kit: Kit, cols: Cols, row: FileRowVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row">
      <Box width={BAR} flexShrink={0}>
        {copperBar(kit, row.isSelected)}
      </Box>
      <Box width={MARK} flexShrink={0}>
        {row.status ? square(kit, row.status) : null}
      </Box>
      <Box width={cols.box} flexShrink={0}>
        <Button
          key={`files:${row.path}`}
          label={F.truncStart(row.path, cols.label)}
          plain
          dimColor={!row.isSelected && row.status === null}
          onPress={() => actions.select(`file:${row.path}`)}
        />
      </Box>
      <Box flexGrow={1} flexShrink={1} paddingLeft={1}>
        <Text wrap="truncate-end">
          {row.editors}
          {row.note === 'shared' ? <Text color={T.warn}> · shared</Text> : null}
          {row.note === 'editing' ? <Text dimColor> · editing</Text> : null}
        </Text>
      </Box>
      {cols.counts > 0 ? (
        <Box width={cols.counts} flexShrink={0} justifyContent="flex-end" marginLeft={1}>
          {delta(kit, row.added, row.removed)}
        </Box>
      ) : null}
    </Box>
  )
}
