/**
 * Diffs as the deck draws them: hunks as native `Code format="diff"`
 * blocks, each under the element's 10,000 characters, spent from one budget
 * so a screen keeps inside the pane's bounds; or, where a desktop draws them
 * and the budget's rows allow, numbered as the web page numbers them (each
 * line its old and new number, its mark, its words, on its add or remove
 * wash), the Desktop's own diff block numbering none. And an agent's own
 * edit (its Edit or Write patch, the v2 state's `changes.edits` and its lazy
 * patch file) under a line saying which tool, whose and when; on its agent's
 * page its tool's chip, when and its lines. Git's hunks are never tagged by
 * agent.
 *
 * Pure: Kit, the state and its lazy files come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { codeSourcesOf, hunksOf, type Hunk } from '../../diff'
import type { V2AgentRow, V2Changes, V2Files, WebStateV2 } from '../../web'
import type { Kit } from '../types'
import { quiet, svgOf, toolTag } from './look'
import { P, mix } from './palette'
import { isRowButton, veil } from './parts'
import { ago, num } from './text'

/** Below this many characters left in a budget, a diff is noted as cut rather than drawn a few lines deep. */
const LEAST = 400

/** What one drawing spends on diffs: characters, and the numbered lines it may draw (each a few elements; none left, the Code block draws the rest). */
export type Budget = { chars: number; rows?: number }

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

/**
 * Hunks as diff Code blocks, spending from `budget`; a quiet note when some
 * or all were cut to fit. With `numbered`, where a desktop draws them and
 * the budget's rows hold them all, numbered rows of the deck's own instead.
 */
export function diffBlocks(kit: Kit, hunks: readonly Hunk[], path: string, budget: Budget, numbered = false): RenderElement[] {
  const { Code } = kit
  if (hunks.length === 0) return [quiet(kit, 'No line changes to show.')]
  if (budget.chars < LEAST) return [quiet(kit, 'Cut to fit the pane: close another diff to read this one.')]
  if (numbered && svgOf(kit)) {
    const rows = numberedRowsOf(hunks)
    if (rows.length <= (budget.rows ?? 0)) {
      budget.rows = (budget.rows ?? 0) - rows.length
      budget.chars -= rows.reduce((sum, row) => sum + row.text.length + 12, 0)
      return [numberedDiff(kit, rows)]
    }
  }
  const { sources, isCut, used } = codeSourcesOf(hunks, budget.chars)
  budget.chars -= used
  const blocks: RenderElement[] = sources.map(source => <Code source={source} format="diff" path={path.slice(-200)} />)
  if (isCut) blocks.push(quiet(kit, 'The rest is cut to fit the pane.'))
  return blocks
}

/** One line of a numbered diff: a hunk's head, a line kept, added or removed (or git's "\ No newline" note), its old and new numbers ('' where it has none), its words. */
export type DiffRow = { kind: 'hunk' | 'same' | 'add' | 'del' | 'meta'; old: string; new: string; text: string }

/** The characters of a line a numbered diff keeps: the row cuts it at its edge anyway. */
const ROW_CHARS = 400

/** Hunks as the rows of a numbered diff: each hunk's head, then its lines, the old side counted from its start, the new from its own. */
export function numberedRowsOf(hunks: readonly Hunk[]): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', old: '', new: '', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` })
    let a = hunk.oldStart
    let b = hunk.newStart
    for (const line of hunk.lines) {
      const text = line.slice(1).replace(/\t/g, '  ').slice(0, ROW_CHARS)
      if (line[0] === '+') rows.push({ kind: 'add', old: '', new: String(b++), text })
      else if (line[0] === '-') rows.push({ kind: 'del', old: String(a++), new: '', text })
      else if (line[0] === '\\') rows.push({ kind: 'meta', old: '', new: '', text: line.slice(0, ROW_CHARS) })
      else rows.push({ kind: 'same', old: String(a++), new: String(b++), text })
    }
  }
  return rows
}

/** The web's diff, flattened over its sunken ground: the ground, each kind's wash, its numbers' ink, its mark and its words' ink. */
const SUNK = '#111111'
const DIFF_LOOK: Readonly<Record<DiffRow['kind'], { wash: string; gutter: string; mark: string; ink: string }>> = {
  hunk: { wash: mix(SUNK, P.run, 0.07), gutter: '#4f4f4f', mark: ' ', ink: '#7f9fd8' },
  same: { wash: SUNK, gutter: '#4f4f4f', mark: ' ', ink: '#d4d4d4' },
  add: { wash: mix(SUNK, P.done, 0.1), gutter: mix(SUNK, P.doneText, 0.6), mark: '+', ink: '#d4d4d4' },
  del: { wash: mix(SUNK, P.fail, 0.1), gutter: mix(SUNK, P.failText, 0.6), mark: '−', ink: '#d4d4d4' },
  meta: { wash: SUNK, gutter: '#4f4f4f', mark: ' ', ink: P.muted2 },
}

/**
 * A numbered diff as the web page draws one (`PatchView`): a sunken block, a
 * row a line, its old and new numbers and its mark dim in the monospaced
 * face, then its words, on its kind's wash; a line too long for the row cut
 * at its edge. Five elements a line, so `diffBlocks` draws it only while the
 * budget's rows last.
 */
function numberedDiff(kit: Kit, rows: readonly DiffRow[]): RenderElement {
  const { Box, Text } = kit
  const width = Math.max(2, ...rows.map(row => Math.max(row.old.length, row.new.length)))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={0} paddingY={0} overflow="hidden" backgroundColor={SUNK}>
      {rows.map(row => {
        const look = DIFF_LOOK[row.kind]
        const gutter = row.kind === 'hunk' || row.kind === 'meta' ? ' '.repeat(width * 2 + 4) : `${row.old.padStart(width)} ${row.new.padStart(width)} ${look.mark} `
        return (
          <Box flexDirection="row" paddingX={1} backgroundColor={look.wash}>
            <Text mono tabular wrap="truncate-end" color={look.ink}>
              <Text color={look.gutter}>{gutter}</Text>
              {row.text || ' '}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
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

/**
 * How an edit's block reads. In Changes, "Write by builder · 3m" and its
 * lines. On its agent's page (`isOwn`), as the web's drawer: its tool's chip,
 * when and its lines, no name, `right` at the line's right (its links), its
 * diff numbered where the surface draws its own; `isShut` leaves the diff
 * out, its head alone. With `toggle` (an edit among several of its file) a
 * press anywhere on its head but its links shows or hides its diff: on the
 * terminal its chip, when and its lines are one Button keyed `key`, on a
 * desktop a veil (./parts) lies over them.
 */
export type EditLook = { isOwn?: boolean; isShut?: boolean; right?: RenderElement | null; toggle?: () => void; key?: string }

/** An edit's head on its agent's page: its tool's chip, when and its lines, its links at the right; with `look.toggle`, all but its links one press. */
function ownHead(kit: Kit, state: WebStateV2, edit: V2Changes['edits'][number], look: EditLook): RenderElement {
  const { Box, Text, Button } = kit
  const counts = delta(kit, edit.added, edit.removed)
  const when = ago(edit.at, state.now)
  const toggle = look.toggle
  const key = look.key ?? `edithead:${edit.id}`
  const right = (
    <Box flexShrink={0} justifyContent="flex-end">
      {look.right ?? null}
    </Box>
  )
  if (toggle && isRowButton(kit)) {
    return (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row">
          <Button key={key} label={`${edit.tool} ${when}`} plain onPress={toggle}>
            {toolTag(kit, edit.tool)}
            <Text color={P.muted2}>{` ${when}`}</Text>
            {counts ? [' ', counts] : null}
          </Button>
        </Box>
        {right}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" columnGap={1} alignItems="center">
        <Box flexShrink={0}>{toolTag(kit, edit.tool)}</Box>
        <Box flexShrink={0}>
          <Text color={P.muted2}>{when}</Text>
        </Box>
        {counts ? <Box flexShrink={0}>{counts}</Box> : null}
        {toggle ? veil(kit, key, toggle) : null}
      </Box>
      {right}
    </Box>
  )
}

/** One edit of an agent's: its head (`look`), then its exact patch (from its lazy file). */
export function editBlock(kit: Kit, state: WebStateV2, files: V2Files, edit: V2Changes['edits'][number], budget: Budget, look: EditLook = {}): RenderElement {
  const { Box, Text } = kit
  const counts = delta(kit, edit.added, edit.removed)
  const patch = files.patch(edit.id)
  const head = look.isOwn ? (
    ownHead(kit, state, edit, look)
  ) : (
    <Text wrap="truncate-end">
      <Text color={P.muted}>{`${edit.tool} by ${titleOf(state, edit.agent)} · ${ago(edit.at, state.now)}`}</Text>
      {counts ? <Text>  </Text> : null}
      {counts}
    </Text>
  )
  return (
    <Box key={`edit:${edit.id}`} flexDirection="column" rowGap={look.isOwn && !look.isShut && svgOf(kit) ? 1 : 0}>
      {head}
      {look.isShut ? null : patch === null ? quiet(kit, 'Its patch is not on disk.') : diffBlocks(kit, hunksOf(patch), edit.path, budget, look.isOwn === true)}
    </Box>
  )
}
