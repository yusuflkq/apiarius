/**
 * The Agents tab's header and outline, in native text at the host's own
 * size, no image anywhere.
 *
 * The header: the needs-you line (always one row: the copper rail only when
 * something needs you, and Open, key n, selects it), the goal in bold (at
 * most two lines, its minutes at the right) and one summary line that leads
 * with the plan's step in hand, the counts after it dim.
 *
 * The outline you click, one row per Orchestrator, plan step, agent or
 * folded group. Every row keeps its columns whether it is selected or not:
 * the rail (the copper `quote` border on the selected row, the same cells as
 * padding on the others), the indent (two cells a level, four levels at
 * most), the fold toggle (▾ ▸, two cells), the status square or step mark,
 * then the label. An agent's label sits in a fixed column, LABEL + (3 −
 * depth) × 2 cells, so its done/total, minutes and `+a −r` line up right
 * after it at every depth and every width; a step's, the Orchestrator's and a
 * group's label runs the full width. An agent's line two says where it is.
 * Rows never wrap; their order is the tree's, never sorted.
 *
 * Labels are plain Buttons; the selected one is the primary plate, and a
 * press on it again does nothing. Keys: n opens what needs you, o selects the
 * Orchestrator, u goes up one level of the zoom; the detail's Fold (f) and
 * Zoom (z) act on the selection.
 *
 * Pure: Kit, the view-models (./outlineModel) and Actions come from the caller.
 */
import type { RenderElement } from 'claude-code'

import * as F from '../format'
import { delta, emptyLine, rail, square, stepMark } from './common'
import type { Crumb, HeaderVM, NeedsVM, OutlineVM, RowVM, SummaryVM } from './outlineModel'
import { T } from './theme'
import type { Actions, Kit } from './types'

/** The goal's label column: "Goal" and two spaces. */
const GOAL_LABEL = 6
/** The rail every row starts with: the copper border and a space when selected, two cells of padding otherwise. */
const BAR = 2
/** Cells per level of nesting, and the levels indented at most. */
const INDENT = 2
const INDENTS = 4
/** The fold toggle's column and the square's, each a glyph and a space. */
const FOLD = 2
const MARK = 2
/** An agent's label column at depth 3: a level less deep is a level's cells wider, so indent and label end together. */
const LABEL = 20
/** The columns after an agent's label: done/total ("12/12", "done"), minutes ("1h 05m"), `+a −r`. */
const COUNT = 6
const MINUTES = 7
const DELTA = 12
/** Where an agent's label column ends, from the row's left edge, at every depth. */
const LABEL_END = BAR + INDENT * 3 + FOLD + MARK + LABEL
/** The goal line's minutes, at its right. */
const GOAL_MINUTES = 8

/** A fold toggle's label: the arrow and a figure space, so it is two cells wide to click. */
export const FOLD_LABEL = { open: '▾ ', closed: '▸ ' } as const

/** What a Button draws around its label: the terminal's `[ ` and ` ]` on the primary plate; a desktop's native button its padding. */
function chromeOf(kit: Kit): number {
  return kit.surface === 'terminal' ? 4 : 2
}

/** The characters of the goal the header shows at `columns`: about two lines of its column. The Orchestrator's detail shows the whole goal only past this. */
export function goalChars(columns: number): number {
  return Math.floor(Math.max(12, columns - BAR - GOAL_LABEL - GOAL_MINUTES) * 1.8)
}

// The header.

/** The needs-you line, the goal and the summary: the top of the Agents tab. */
export function headerBlock(kit: Kit, vm: HeaderVM, actions: Actions): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column">
      {needsLine(kit, vm.needs, actions)}
      {goalBlock(kit, vm)}
    </Box>
  )
}

/** Always one row. Loud (a blocked prompt, a failure, a shared file): the copper rail, the square, the subject bold, and Open. */
function needsLine(kit: Kit, needs: NeedsVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const target = needs.open
  const button = target ? (
    <Button key="needs:open" label="Open" hotkey="n" onPress={() => actions.select(target)} />
  ) : needs.canReview ? (
    <Button key="needs:review" label="Review" onPress={() => actions.setTab('changes')} />
  ) : null
  const right = button ? <Box flexShrink={0}>{button}</Box> : null

  if (!needs.isLoud) {
    return (
      <Box flexDirection="row" justifyContent="space-between" columnGap={2} {...rail(false, BAR)}>
        <Text dimColor wrap="truncate-end">
          {`${needs.subject}${needs.rest}`}
        </Text>
        {right}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2} {...rail(true, BAR)}>
      <Text wrap="truncate-end">
        {needs.status ? square(kit, needs.status) : null}
        <Text bold>{needs.status ? ` ${needs.subject}` : needs.subject}</Text>
        {needs.rest ? <Text>{needs.rest}</Text> : null}
      </Text>
      {right}
    </Box>
  )
}

/** The goal in bold in its label column, at most two lines, its minutes at the right; the summary line under it. */
function goalBlock(kit: Kit, vm: HeaderVM): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" paddingLeft={BAR}>
      {vm.goal ? (
        <Box flexDirection="row">
          <Box width={GOAL_LABEL} flexShrink={0}>
            <Text dimColor>Goal</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text bold wrap="wrap">
              {F.trunc(vm.goal, goalChars(kit.columns))}
            </Text>
          </Box>
          {vm.minutes ? (
            <Box flexShrink={0} paddingLeft={2}>
              <Text dimColor>{vm.minutes}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
      <Box paddingLeft={GOAL_LABEL}>{summaryLine(kit, vm.summary)}</Box>
    </Box>
  )
}

/** One line: the step in hand plain, the counts dim, `+a −r` in its colours. */
function summaryLine(kit: Kit, summary: SummaryVM): RenderElement {
  const { Text } = kit
  const counts = delta(kit, summary.added, summary.removed)
  return (
    <Text wrap="truncate-end">
      {summary.step ? <Text>{summary.step}</Text> : null}
      {summary.step && summary.lead ? <Text dimColor> · </Text> : null}
      <Text dimColor>{summary.lead}</Text>
      {counts ? <Text> </Text> : null}
      {counts}
    </Text>
  )
}

// The outline.

/** Which columns follow an agent's label (every agent row the same, as the pane's width allows), and the cells its label column gives up in a pane too narrow for it. */
type Columns = { count: boolean; minutes: boolean; squeeze: number }

function columnsFor(kit: Kit): Columns {
  const room = kit.columns - LABEL_END - DELTA
  return { count: room >= MINUTES + COUNT, minutes: room >= MINUTES, squeeze: Math.max(0, -room) }
}

/** An agent's label column at `depth`: LABEL + (3 − depth) × 2 cells, so the columns after it start at the same cell on every row. */
function labelColumn(depth: number, columns: Columns): number {
  return Math.max(8, LABEL + (3 - depth) * INDENT - columns.squeeze)
}

/** The outline: the crumbs while zoomed, then the rows; a quiet line when rows are left out. */
export function outlineBlock(kit: Kit, vm: OutlineVM, actions: Actions): RenderElement {
  const { Box } = kit
  const columns = columnsFor(kit)
  return (
    <Box flexDirection="column">
      {vm.crumbs ? crumbRow(kit, vm.crumbs, actions) : null}
      {vm.rows.map(row => rowBlock(kit, row, columns, actions))}
      {vm.hidden > 0 ? <Box paddingLeft={BAR}>{emptyLine(kit, `${F.plural(vm.hidden, 'more row')} not shown: zoom in on a branch, or fold one.`)}</Box> : null}
    </Box>
  )
}

/** Crumbs a zoom shows before the levels between All and the nearest two give way to "…". */
const CRUMBS = 5

/**
 * While zoomed: All › each level › the zoomed row (bold). Each level above
 * is a Button back up to it, the nearest one answering u. A deep zoom keeps
 * All, "…", the two levels above and the row; every label is cut to fit one row.
 */
function crumbRow(kit: Kit, crumbs: readonly Crumb[], actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const kept: (Crumb | null)[] = crumbs.length > CRUMBS ? [crumbs[0] ?? null, null, ...crumbs.slice(-3)] : [...crumbs]
  const last = kept.length - 1
  const room = Math.max(8, Math.floor((kit.columns - BAR) / kept.length) - 3)
  return (
    <Box flexDirection="row" paddingLeft={BAR} columnGap={1}>
      {kept.map((crumb, i) => {
        if (crumb === null) return <Text dimColor>… ›</Text>
        if (i === last) {
          return (
            <Text bold wrap="truncate-end">
              {F.trunc(crumb.label, room)}
            </Text>
          )
        }
        return (
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            <Button
              key={`crumb:${crumb.id || 'all'}`}
              label={F.trunc(crumb.label, room)}
              plain
              dimColor
              {...(i === last - 1 ? { hotkey: 'u' } : {})}
              onPress={() => actions.zoomTo(crumb.id)}
            />
            <Text dimColor>›</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** The key a row's label Button carries: agents (the Orchestrator too) `agent:<id>`, plan steps `step:<key>`. */
function labelKey(row: RowVM): string {
  return row.kind === 'step' ? `step:${row.id}` : `agent:${row.id}`
}

/** The colour of a line two: waiting on you and failed in their status colours, the rest dim. */
function noteProps(row: RowVM): { color?: string; dimColor?: boolean } {
  if (row.noteTone === 'waiting') return { color: T.warn }
  if (row.noteTone === 'failed') return { color: T.err }
  return { dimColor: true }
}

/**
 * A row's label: a plain Button that selects it, cut to `room` characters.
 * The selected one is the primary plate, and a press on it again does
 * nothing (Zoom and Fold are the detail's, z and f); the Orchestrator's answers o.
 */
function labelButton(kit: Kit, row: RowVM, room: number, actions: Actions): RenderElement {
  const { Button } = kit
  return (
    <Button
      key={labelKey(row)}
      label={F.trunc(row.label, Math.max(4, room))}
      {...(row.isSelected ? { variant: 'primary' as const } : { plain: true as const })}
      {...(row.kind === 'orchestrator' ? { hotkey: 'o' } : {})}
      onPress={() => {
        if (!row.isSelected) actions.select(row.id)
      }}
    />
  )
}

/** One row: the rail, its first line in the reserved columns, and an agent's line two under its label. */
function rowBlock(kit: Kit, row: RowVM, columns: Columns, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const depth = Math.min(row.depth, INDENTS)
  const indent = depth * INDENT
  const lead = indent + FOLD + MARK
  const fold = row.fold ? <Button key={`fold:${row.id}`} label={FOLD_LABEL[row.fold]} plain dimColor onPress={() => actions.toggleFold(row.id)} /> : null
  const mark = row.status === null ? null : row.kind === 'step' ? stepMark(kit, row.status) : square(kit, row.status)
  // the Orchestrator says its state beside its label; an agent says it on line two
  const note = row.note ? (
    <Text wrap="truncate-end" {...noteProps(row)}>
      {row.note}
    </Text>
  ) : null
  const foldColumn = (
    <Box width={indent + FOLD} paddingLeft={indent} flexShrink={0}>
      {fold}
    </Box>
  )
  const markColumn = (
    <Box width={MARK} flexShrink={0}>
      {mark}
    </Box>
  )

  let first: RenderElement
  if (row.kind === 'agent') {
    // a fixed label column, then its numbers right after it: they line up on every row, and stay near the label on a wide pane
    const width = labelColumn(depth, columns)
    first = (
      <Box flexDirection="row">
        {foldColumn}
        {markColumn}
        <Box width={width} flexShrink={0}>
          {labelButton(kit, row, width - chromeOf(kit), actions)}
        </Box>
        {columns.count ? (
          <Box width={COUNT} flexShrink={0} justifyContent="flex-end">
            {row.count ? <Text dimColor>{row.count}</Text> : null}
          </Box>
        ) : null}
        {columns.minutes ? (
          <Box width={MINUTES} flexShrink={0} justifyContent="flex-end">
            {row.minutes ? <Text dimColor>{row.minutes}</Text> : null}
          </Box>
        ) : null}
        <Box width={DELTA} flexShrink={0} justifyContent="flex-end">
          {delta(kit, row.added, row.removed)}
        </Box>
      </Box>
    )
  } else {
    // a step's, the Orchestrator's and a group's label: the full width, no columns after it
    const room = Math.max(6, kit.columns - BAR - lead - chromeOf(kit))
    const isGroup = row.kind === 'background' || row.kind === 'done'
    const label = isGroup ? (
      <Text dimColor wrap="truncate-end">
        {row.label}
      </Text>
    ) : (
      labelButton(kit, row, room, actions)
    )
    const isInline = row.kind === 'orchestrator'
    first = (
      <Box flexDirection="row">
        {foldColumn}
        {markColumn}
        <Box flexDirection="row" flexGrow={1} flexShrink={1} columnGap={2}>
          {isInline ? <Box flexShrink={0}>{label}</Box> : label}
          {isInline ? note : null}
        </Box>
      </Box>
    )
  }

  const second = row.kind !== 'orchestrator' && note ? <Box paddingLeft={lead}>{note}</Box> : null
  return (
    <Box key={`row:${row.id}`} flexDirection="column" {...rail(row.isSelected, BAR)}>
      {first}
      {second}
    </Box>
  )
}
