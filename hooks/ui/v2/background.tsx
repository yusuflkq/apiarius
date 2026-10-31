/**
 * Background, as the pane and the terminal draw it (the web page draws the
 * same, web/now.mjs): a Dashboard section under the agents, shown only while
 * something runs in the background or is scheduled (the v2 state's
 * `background`). A bordered list (./dash `listBox`), a row each: its kind's
 * icon (a glyph on the terminal), its title bold and what it is dim, then
 * "started by" with its starter's face and name; its status ("◐ running",
 * "◷ scheduled"), its age or next run, and its Stop or Cancel where Claude
 * Code's own permission check allows it, in columns at the right. Folded,
 * its head and one line: "2 shells · 1 monitor · 2 scheduled".
 *
 * A press goes through DashActions to the hooks module, which stops only
 * through Claude Code's own channels (TaskStop, CronDelete), asking its
 * check again first; in the sample, nothing is stopped. On another
 * session's deck (its state marked `peer`) the same, by its deck's own
 * check: a press goes to that deck, and its row says what came of it; where
 * its deck takes nothing from here, none is offered, and one quiet line
 * under the list says why.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { V2BackgroundRow } from '../../background'
import { clean } from '../../format'
import type { WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { listBox, listRow, section } from './dash'
import { rowOf } from './dashModel'
import { advanceOf, avatar, svgOf } from './look'
import { P } from './palette'
import { cellsForPx, foldHead, pressNote, pressOf, pressSending, rule, type Fold } from './parts'
import { cellsOf, cutCells, plural } from './text'

/** Background's fold id in the view's `collapsed`, beside dashModel's FOLD ids. */
export const BG_FOLD = 'dash:background'

/** The rows the pane draws at most; past them, a line says how many more (the web page lists them all). */
export const MOST_BG_ROWS = 10

/** Background folded: its one line, "2 shells · 1 monitor · 2 scheduled". */
export function backgroundFoldOf(state: Pick<WebStateV2, 'background'>): string {
  return state.background?.text ?? ''
}

/** The icons Background draws, a kind each: Lucide-style 24 px strokes, as the web page's. */
const ICONS = {
  shell: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  monitor: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  other: '<circle cx="12" cy="12" r="10"/>',
  cron: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  wakeup: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
} as const

type IconName = keyof typeof ICONS

/** What the terminal draws in each icon's place. */
const MARKS: Readonly<Record<IconName, string>> = { shell: '$', monitor: '◉', workflow: '≡', agent: '◆', other: '•', cron: '◷', wakeup: '◔' }

/** What each icon says to a reader that cannot see it. */
const ALTS: Readonly<Record<IconName, string>> = { shell: 'Shell', monitor: 'Monitor', workflow: 'Workflow', agent: 'Agent', other: 'Task', cron: 'Cron', wakeup: 'Wakeup' }

/** An icon `px` square in `color` where the surface draws Svg; else its mark. */
function mark(kit: Kit, name: IconName, color: string, px = 16): RenderElement {
  const { Text } = kit
  const Svg = svgOf(kit)
  if (!Svg) return <Text color={color}>{MARKS[name]}</Text>
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return <Svg source={source} alt={ALTS[name]} width={px} height={px} />
}

/** The cells a row's status, its time and its Stop take at its right. */
const STATUS = 12
const WHEN = 7
const STOP = 7

/** A row's status in its hue: a task's "◐ running" (blue) or its own word, a schedule's "◷ scheduled" (dim). */
function statusOf(row: V2BackgroundRow): { text: string; color: string } {
  if (row.status === 'scheduled') return { text: '◷ scheduled', color: P.muted }
  if (row.status === 'running') return { text: '◐ running', color: P.runText }
  return { text: `◌ ${row.status}`, color: P.muted }
}

/**
 * Background under its head, "▾ BACKGROUND 5", its line of counts at the
 * right; the rows in a bordered list. Null when nothing runs in the
 * background or is scheduled: the section is gone. Folded, its head and
 * that line.
 */
export function backgroundSection(kit: Kit, state: WebStateV2, actions: DashActions, fold: Fold): RenderElement | null {
  const { Box, Text } = kit
  const background = state.background
  if (!background || background.rows.length === 0) return null
  const right = fold.isOpen && background.text ? <Text color={P.muted2}>{background.text}</Text> : null
  const head = foldHead(kit, fold, 'Background', background.rows.length, actions, right)
  if (!fold.isOpen) return section(kit, 'now:background', head, null)
  const shown = background.rows.slice(0, MOST_BG_ROWS)
  const more = background.rows.length - shown.length
  const rows = shown.flatMap((row, i) => [i > 0 ? rule(kit) : null, backgroundRow(kit, state, row, actions)])
  if (more > 0) rows.push(rule(kit), listRow(kit, 'bg:more', [<Text color={P.muted2} wrap="truncate-end">{`and ${plural(more, 'more')}: /apiarius web lists them all`}</Text>]))
  // another session's whose deck takes nothing from here: its Stop and Cancel are offered nowhere, so the list says why, once
  const deaf = state.peer && !state.peer.canSteer && background.rows.some(row => row.stop) ? state.peer.why : ''
  const list = listBox(kit, 'bg:list', rows)
  return section(
    kit,
    'now:background',
    head,
    deaf !== '' ? (
      <Box flexDirection="column">
        {list}
        <Text key="bg:deaf" color={P.muted2} wrap="wrap">
          {deaf}
        </Text>
      </Box>
    ) : (
      list
    ),
  )
}

/**
 * One row, as the web's: its kind's icon; its title bold and what it is dim,
 * then "started by" with its starter's face and name; its status, its age
 * or next run, and its Stop or Cancel where allowed, in columns at the right.
 */
function backgroundRow(kit: Kit, state: WebStateV2, row: V2BackgroundRow, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const isTask = row.status !== 'scheduled'
  const status = statusOf(row)
  const by = row.by !== null ? rowOf(state, row.by) : undefined
  const iconCells = svgOf(kit) ? cellsForPx(16) : 1
  // the words' room: the row inside the list's edges and its padding, less the icon, the columns at the right and the gaps
  const room = Math.max(12, kit.columns - 4 - iconCells - 1 - STATUS - 1 - WHEN - 1 - STOP - 1)
  const title = cutCells(clean(row.title), Math.max(8, Math.min(room, Math.ceil(room * 0.6))), adv)
  const what = cutCells(clean(row.what), Math.max(4, room - cellsOf(title, adv) - 1), adv)
  // a press on another session's: "…" in its place while its deck has not answered, and under the words what is under way, then what came of it
  const press = pressOf(state, `bg:${row.id}`)
  const said = press ? (press.status === 'sending' ? pressSending(kit, press, `bg:${row.id}`) : pressNote(kit, press, `bg:${row.id}`)) : null
  const stop = !row.stop?.can ? null : press?.status === 'sending' ? (
    <Text color={P.muted2}>…</Text>
  ) : (
    <Button key={`bg:stop:${row.id}`} label={row.stop.label} plain dimColor onPress={() => actions.stopBackground(row.id)} />
  )
  return listRow(kit, `bg:${row.id}`, [
    <Box flexShrink={0}>{mark(kit, row.kind, isTask ? P.runText : P.muted)}</Box>,
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>
          <Text bold color={P.text}>
            {title}
          </Text>
        </Box>
        <Box flexShrink={1} minWidth={0}>
          <Text color={P.muted2} wrap="truncate-end">
            {what}
          </Text>
        </Box>
      </Box>
      {row.by !== null ? (
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Box flexShrink={0}>
            <Text color={P.muted2}>started by</Text>
          </Box>
          {by ? <Box flexShrink={0}>{avatar(kit, by, 14)}</Box> : null}
          <Box flexShrink={1} minWidth={0}>
            <Text color={P.muted} wrap="truncate-end">
              {row.byName || row.by}
            </Text>
          </Box>
        </Box>
      ) : null}
      {said ? <Box flexDirection="row">{said}</Box> : null}
    </Box>,
    <Box flexShrink={0} width={STATUS} justifyContent="flex-end">
      <Text color={status.color}>{status.text}</Text>
    </Box>,
    <Box flexShrink={0} width={WHEN} justifyContent="flex-end">
      <Text color={P.muted2}>{row.when}</Text>
    </Box>,
    <Box flexShrink={0} width={STOP} justifyContent="flex-end">
      {stop}
    </Box>,
  ])
}
