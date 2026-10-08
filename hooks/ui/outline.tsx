/**
 * The Agents tab's header and outline, in native text at the host's own
 * size, no image anywhere.
 *
 * The header: the needs-you line (always one row: the copper bar only when
 * something needs you, and Open, key n, selects it), the goal (at most two
 * lines) and one dim summary line.
 *
 * The outline you click, one row per Orchestrator, plan step, agent or
 * folded group. Every row keeps the same columns whether it is selected or
 * not: the reserved bar column (the copper ▌ on the selected row), the
 * indent (two cells a level, three levels at most), the fold toggle (▾ ▸),
 * the status square or step mark, the label (a Button that selects the row,
 * the selected one the primary plate), then done/total, minutes and
 * `+a −r` at the right. An agent's line two says where it is. Rows never
 * wrap; their order is the tree's, never sorted.
 *
 * Keys: n opens what needs you, o selects the Orchestrator, z (or a second
 * press on the selected row) zooms on its branch or back out, u goes up one
 * level of the zoom.
 *
 * Pure: Kit, the view-models (./outlineModel) and Actions come from the caller.
 */
import type { RenderElement } from 'claude-code'

import * as F from '../format'
import { copperBar, delta, emptyLine, square, stepMark } from './common'
import type { Crumb, HeaderVM, NeedsVM, OutlineVM, RowVM, SummaryVM } from './outlineModel'
import { T } from './theme'
import type { Actions, Kit } from './types'

/** The goal's label column: "Goal" and two spaces. */
const GOAL_LABEL = 6
/** The reserved bar column every row starts with, the copper ▌ and a space. */
const BAR = 2
/** Cells per level of nesting, and the levels indented at most. */
const INDENT = 2
const INDENTS = 3
/** The fold toggle's column and the square's, each a glyph and a space. */
const FOLD = 2
const MARK = 2
/** The right columns: done/total ("12/12", "done"), minutes ("1h 05m"), `+a −r`. */
const COUNT = 6
const MINUTES = 7
const DELTA = 12
/** What a native Button draws around its label on the terminal: `[ ` and ` ]`. */
const CHROME = 4
/** Below this many cells for the label, the done/total and minutes columns give way (on every row alike). */
const LEAST_LABEL = 14

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

/** Always one row. Loud (a blocked prompt, a failure, a shared file): the copper bar, the square, the subject bold, and Open. */
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
      <Box flexDirection="row" justifyContent="space-between" columnGap={2} paddingLeft={BAR}>
        <Text dimColor wrap="truncate-end">
          {`${needs.subject}${needs.rest}`}
        </Text>
        {right}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={2} borderStyle="quote" borderColor={T.copper} paddingLeft={BAR - 1}>
      <Text wrap="truncate-end">
        {needs.status ? square(kit, needs.status) : null}
        <Text bold>{needs.status ? ` ${needs.subject}` : needs.subject}</Text>
        {needs.rest ? <Text>{needs.rest}</Text> : null}
      </Text>
      {right}
    </Box>
  )
}

/** The goal in its label column, at most two lines, and the summary line under it. */
function goalBlock(kit: Kit, vm: HeaderVM): RenderElement {
  const { Box, Text } = kit
  const room = Math.max(12, kit.columns - BAR - GOAL_LABEL)
  return (
    <Box flexDirection="row" paddingLeft={BAR}>
      <Box width={GOAL_LABEL} flexShrink={0}>
        <Text dimColor>Goal</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {vm.goal ? <Text wrap="wrap">{F.trunc(vm.goal, Math.floor(room * 1.8))}</Text> : emptyLine(kit, 'No goal yet: your next prompt sets it.')}
        {summaryLine(kit, vm.summary)}
      </Box>
    </Box>
  )
}

/** One dim line; only `+a −r` keeps its colours. */
function summaryLine(kit: Kit, summary: SummaryVM): RenderElement {
  const { Text } = kit
  const counts = delta(kit, summary.added, summary.removed)
  return (
    <Text wrap="truncate-end">
      <Text dimColor>{summary.lead}</Text>
      {counts ? <Text> </Text> : null}
      {counts}
      {summary.tail ? <Text dimColor>{summary.tail}</Text> : null}
    </Text>
  )
}

// The outline.

/** Which right columns the rows carry: every row the same, as the pane's width allows. */
type Columns = { count: boolean; minutes: boolean }

function columnsFor(kit: Kit): Columns {
  const fixed = BAR + INDENT * INDENTS + FOLD + MARK + CHROME + DELTA
  const room = kit.columns - fixed
  return { count: room - COUNT - MINUTES >= LEAST_LABEL, minutes: room - MINUTES >= LEAST_LABEL }
}

/** The outline: the crumbs while zoomed, then the rows; a quiet line when nothing is delegated or rows are left out. */
export function outlineBlock(kit: Kit, vm: OutlineVM, actions: Actions): RenderElement {
  const { Box } = kit
  const columns = columnsFor(kit)
  return (
    <Box flexDirection="column">
      {vm.crumbs ? crumbRow(kit, vm.crumbs, actions) : null}
      {vm.rows.map(row => rowBlock(kit, row, columns, actions))}
      {vm.empty ? <Box paddingLeft={BAR + INDENT + FOLD + MARK}>{emptyLine(kit, vm.empty)}</Box> : null}
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
 * A row's label: a Button that selects it. The selected one is the primary
 * plate, and pressing it again (or z) zooms the outline on its branch, or
 * back out when it is the branch zoomed; the Orchestrator's answers o.
 */
function labelButton(kit: Kit, row: RowVM, room: number, actions: Actions): RenderElement {
  const { Button } = kit
  const hotkey = row.kind === 'orchestrator' ? 'o' : row.isSelected ? 'z' : ''
  return (
    <Button
      key={labelKey(row)}
      label={F.trunc(row.label, room)}
      {...(row.isSelected ? { variant: 'primary' as const } : {})}
      {...(hotkey ? { hotkey } : {})}
      onPress={() => (row.isSelected ? actions.zoomTo(row.id) : actions.select(row.id))}
    />
  )
}

/** One row: its first line in the reserved columns, and an agent's line two under its label. */
function rowBlock(kit: Kit, row: RowVM, columns: Columns, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const indent = Math.min(row.depth, INDENTS) * INDENT
  const isGroup = row.kind === 'background' || row.kind === 'done'
  const isInline = row.kind === 'orchestrator'
  const fold = row.fold ? (
    <Button key={`fold:${row.id}`} label={row.fold === 'open' ? '▾' : '▸'} plain dimColor onPress={() => actions.toggleFold(row.id)} />
  ) : null
  const mark = row.status === null ? null : row.kind === 'step' ? stepMark(kit, row.status) : square(kit, row.status)
  const right = DELTA + (columns.count ? COUNT : 0) + (columns.minutes ? MINUTES : 0)
  const room = Math.max(6, kit.columns - BAR - indent - FOLD - MARK - CHROME - right)
  const label = isGroup ? (
    <Text dimColor wrap="truncate-end">
      {row.label}
    </Text>
  ) : (
    labelButton(kit, row, room, actions)
  )
  // the Orchestrator says its state beside its label; an agent says it on line two
  const note = row.note ? (
    <Text wrap="truncate-end" {...noteProps(row)}>
      {row.note}
    </Text>
  ) : null

  const first = (
    <Box flexDirection="row">
      <Box width={BAR} flexShrink={0}>
        {copperBar(kit, row.isSelected)}
      </Box>
      <Box width={indent + FOLD} paddingLeft={indent} flexShrink={0}>
        {fold}
      </Box>
      <Box width={MARK} flexShrink={0}>
        {mark}
      </Box>
      <Box flexDirection="row" flexGrow={1} flexShrink={1} columnGap={2}>
        {isInline ? <Box flexShrink={0}>{label}</Box> : label}
        {isInline ? note : null}
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

  if (isInline || !note) {
    return (
      <Box key={`row:${row.id}`} flexDirection="column">
        {first}
      </Box>
    )
  }
  return (
    <Box key={`row:${row.id}`} flexDirection="column">
      {first}
      <Box flexDirection="row">
        <Box width={BAR} flexShrink={0}>
          {copperBar(kit, row.isSelected)}
        </Box>
        <Box flexGrow={1} flexShrink={1} paddingLeft={indent + FOLD + MARK}>
          {note}
        </Box>
      </Box>
    </Box>
  )
}
