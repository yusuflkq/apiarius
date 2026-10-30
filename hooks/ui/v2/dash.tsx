/**
 * Now's dashboard sections, as the web deck's page lays them out, on the v2
 * state's own data (./dashModel reads it):
 *
 * - the agents, a card each as the web's run cards, in rows of as many as
 *   fit at 32 cells or more (`cardsPerRow`: two at the pane's usual 68 to 84
 *   cells, up to six at its widest), each row's cards as wide and as tall;
 *   those at work (and the Orchestrator) in front, the finished ones behind
 *   one "3 finished ▸" row that opens on their cards, with "Clear finished"
 *   and "Show 2 cleared" beside it (./parts `finishedRow`).
 *   A card: the avatar (its status dot at its foot), the name, its status
 *   pill right after it and "Open →" at the right; the step box (its glyph,
 *   the agent's own todo in hand or its task's first line, "n/total"); its
 *   now line (its call in flight verbatim, else what it handed back), two
 *   lines at most; "model · tokens" and "Started 6h ago". Every line of it
 *   a plain Button that opens the agent's page (its name keyed `agent:<id>`,
 *   W.agentKeyOf); the edge in the status's hue while it runs, waits or
 *   failed, and in its hue under the pointer, "Open →" lit with it;
 * - the figures: agents running, the plan's steps (only where Claude made a
 *   plan), the session's spend, what waits on you, each in a bordered tile;
 * - Recent activity and Files, each a bordered list with a rule between its
 *   rows, side by side from 120 cells, one under the other below. The ten
 *   newest calls: the agent's face and name, the verb dim, what it was
 *   given; how it went and when in columns at the right; a press opens the
 *   agent. The ten files of the repository edited last: the folder dim and
 *   the name bright, "shared" where two or more agents edited it, the
 *   editors' faces, +a −r; a press opens Changes on that file. Then one dim
 *   row, "n files outside the repo", that opens on those.
 *
 * Each sits under a head that folds it (./parts `foldHead`: "▾ AGENTS 7").
 *
 * A desktop draws a plain Button's label alone, in its own ink, so the
 * colours and weights the web gives its words sit on Text and images beside
 * the pressable words; its gaps are half lines, so cards and lists breathe
 * where the terminal keeps its lines close; and it draws no tree of 2000
 * elements or more, so the lists stay short.
 *
 * Pure but for whether Files' row of files outside the repository is open,
 * kept here while the module lives: Kit, the state and DashActions come
 * from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import { FINISHED_FOLD } from '../../model'
import { agentKeyOf, fileKeyOf, type V2AgentRow, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import {
  activityRows,
  agentRowsOf,
  cardAgentsOf,
  cardLine,
  cardsPerRow,
  chipOf,
  fileGroupsOf,
  figuresOf,
  fitPath,
  isSaidLine,
  modelLine,
  rowOf,
  runShort,
  runTitle,
  ticks,
  tilesOf,
  wrapTicks,
  type ActivityRow,
  type Chip,
  type FileRow,
  type TickPart,
} from './dashModel'
import { editsKeyOf, openEditsOf } from './changes'
import { rowsOf } from './fit'
import { AVATAR, advanceOf, avatar, avatarCells, glyph, icon, quiet, statusPill, svgOf, wordMark } from './look'
import { cardStop, cardStopCells } from './stop'
import { P, mix, toneOf, type IconName } from './palette'
import {
  CARD_CHROME,
  OPEN_LABEL,
  cellsForPx,
  chromeOf,
  edgesOf,
  face,
  faces,
  facesCells,
  finishedRow,
  foldHead,
  glyphCells,
  openButton,
  openFoldsWith,
  pillCells,
  plainSlack,
  pressText,
  rule,
  tag,
  tagCells,
  tickParts,
  tickTexts,
  widthFor,
  wordParts,
  wrapAdvanceOf,
  type Fold,
} from './parts'
import { ago, cellsOf, cut, cutCells, plural } from './text'

/** From this many cells the figures go four a row (as many as there are); two below. */
export const WIDE = 60

/** From a pane this many cells wide Recent activity and Files sit side by side, as the web's two columns; one under the other below. */
export const SIDE_BY_SIDE = 120

/** Whether `kit` lays its gaps out in half lines (a desktop), so cards and lists may breathe; the terminal's gaps are whole lines, so there they stay close. */
export function isAiry(kit: Kit): boolean {
  return kit.surface !== 'terminal'
}

/** A section as Now stacks it: its head, then (while open) what it holds, half a line apart where the surface lays gaps out in half lines. */
export function section(kit: Kit, key: string, head: RenderElement, body: RenderElement | null, width?: number): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" rowGap={isAiry(kit) ? 1 : 0} {...(width === undefined ? {} : { width })}>
      {head}
      {body}
    </Box>
  )
}

// The agents.

/** One card before it is drawn: its agent, its step box, and its now line laid into lines (the row it sits in pads each card to its tallest); `isSaid` when that line is its words. */
type CardModel = { row: V2AgentRow; chip: Chip; lines: TickPart[][]; isSaid: boolean }

function cardOf(kit: Kit, state: WebStateV2, row: V2AgentRow, width: number): CardModel {
  const said = cardLine(row)
  const isSaid = isSaidLine(row)
  // its words sit after their speech mark, in Text: no Button's slack
  const room = Math.max(6, width - chromeOf(kit) - (isSaid ? glyphCells(kit) + 1 : plainSlack(kit)))
  return { row, chip: chipOf(state, row), lines: said ? wrapTicks(said, room, 2, wrapAdvanceOf(kit)) : [], isSaid }
}

/**
 * The agents: their head ("▾ AGENTS 7", a press folds them to it and how
 * many run, wait and so on) and, where the deck has an org chart, the way
 * to it; then the cards of those at work in rows of as many as fit, every
 * card in a row as wide, and as tall; then the "3 finished ▸" row with
 * Clear finished, and, while it is open (`openFolds` holds
 * `finished:now`), the finished ones' cards. The agents Clear finished hid
 * are left out.
 */
export function agentsSection(kit: Kit, state: WebStateV2, actions: DashActions, fold: Fold, openOrg?: () => void, openFolds: readonly string[] = [], maxRows?: number): RenderElement {
  const { Box, Button } = kit
  const isFinishedOpen = openFolds.includes(FINISHED_FOLD.now)
  const { shown, finished, hidden: past, finishedCount } = cardAgentsOf(state, isFinishedOpen)
  const perRow = cardsPerRow(kit.columns)
  const width = widthFor(kit.columns, perRow)
  const grid = (list: readonly V2AgentRow[]) => {
    const cards = list.map(row => cardOf(kit, state, row, width))
    const rows: CardModel[][] = []
    for (let i = 0; i < cards.length; i += perRow) rows.push(cards.slice(i, i + perRow))
    return rows.map(row => {
      const lines = Math.max(1, ...row.map(card => card.lines.length))
      return {
        cards: row.length,
        el: (
          <Box key={`cards:${row[0]?.row.id ?? ''}`} flexDirection="row" columnGap={1}>
            {row.map(card => agentCard(kit, state, card, width, lines, actions))}
          </Box>
        ),
      }
    })
  }
  const toggle = () => actions.setV2View({ openFolds: openFoldsWith(openFolds, FINISHED_FOLD.now) })
  const fin = finishedRow(kit, FINISHED_FOLD.now, finishedCount, isFinishedOpen, state.cleared?.count ?? 0, actions, toggle, state)
  let front = fold.isOpen ? grid(shown) : []
  let behind = fold.isOpen ? grid(finished) : []
  // the terminal, short of rows (`maxRows`): the rows of cards that fit under the head, the finished row kept; the rest counted in the link to Org
  let cut = 0
  if (maxRows !== undefined && fold.isOpen) {
    let left = maxRows - 1 - (fin ? rowsOf(fin, kit.columns) + 1 : 0)
    const keep = (rows: { cards: number; el: RenderElement }[]) =>
      rows.filter(row => {
        const tall = rowsOf(row.el, kit.columns) + 1
        if (tall > left) {
          cut += row.cards
          left = 0
          return false
        }
        left -= tall
        return true
      })
    front = keep(front)
    behind = keep(behind)
  }
  const hidden = past + cut
  const link = openOrg ? <Button key="now:org" label={hidden > 0 ? `${hidden} more in the org chart →` : 'Org chart →'} plain dimColor onPress={openOrg} /> : null
  const head = foldHead(kit, fold, 'Agents', agentRowsOf(state).filter(row => !row.isCleared).length, actions, link)
  if (!fold.isOpen) return section(kit, 'now:agents', head, null)
  return (
    <Box key="now:agents" flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      {head}
      {shown.length === 0 && finishedCount === 0 ? (
        quiet(kit, 'No agents yet: when Claude Code starts working, the Orchestrator and the agents it starts show up here.')
      ) : (
        <Box flexDirection="column" rowGap={1}>
          {front.map(row => row.el)}
          {fin}
          {behind.map(row => row.el)}
          {hidden > 0 && !openOrg ? quiet(kit, `${plural(hidden, 'more agent')}: more than the Dashboard shows. /apiarius web lists them all.`) : null}
        </Box>
      )}
    </Box>
  )
}

/**
 * One agent's card, as the web's run card, every line of it a plain Button
 * that opens its page: its head (avatar, name, pill, "Open →"), its step box,
 * its now line in `lines` lines, its foot. A grey edge, or its hue's while it
 * runs, waits on you or failed; its hue under the pointer.
 */
function agentCard(kit: Kit, state: WebStateV2, card: CardModel, width: number, lines: number, actions: DashActions): RenderElement {
  const { Box } = kit
  const { row } = card
  const tone = toneOf(row.status)
  const inner = Math.max(8, width - chromeOf(kit))
  const open = () => actions.openAgent(row.id)
  return (
    <Box key={`card:${row.id}`} flexDirection="column" width={width} borderStyle="round" borderColor={tone.edge} hover={{ borderColor: tone.hot }} paddingX={1} rowGap={isAiry(kit) ? 1 : 0}>
      {cardHead(kit, row, inner, open, cardStop(kit, row, actions, state), cardStopCells(kit, row, state))}
      {cardStep(kit, row, card.chip, inner, open)}
      {card.isSaid ? cardWords(kit, card.lines, lines) : cardBody(kit, row, card.lines, lines, open)}
      {cardFoot(kit, row, inner, state.now, open)}
    </Box>
  )
}

/** The cells "Open →" takes where a card's head lays it out. */
function openCells(kit: Kit): number {
  return cellsOf(OPEN_LABEL, advanceOf(kit)) + plainSlack(kit)
}

/** The room a name keeps at the least beside "Open →" and the widest pill for a card to show it: about a dozen letters ("Orchestrator"). */
const NAME_MIN = 11

/**
 * A card's head, as the web's: the avatar with its status dot, the name (a
 * plain Button keyed `agent:<id>`, bold where the surface draws a Button's
 * Text), the status pill right after it, and "Open →" at the far right,
 * dim, lit while the pointer is on the card. "Open →" stands where cards
 * this wide leave a name NAME_MIN beside it and the widest pill, and only
 * beside a name that fits whole: a long name keeps its words, not the arrow.
 * A background agent's or a teammate's Stop (./stop `cardStop`), where
 * Claude Code allows it, stands just before "Open →", whatever the width;
 * "Open →" stays beside it while the name still fits whole.
 */
function cardHead(kit: Kit, row: V2AgentRow, inner: number, open: () => void, stop: RenderElement | null = null, stopWidth = 0): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const before = avatarCells(kit, AVATAR.card, true) + 1 + plainSlack(kit) + 1
  const beside = 1 + openCells(kit)
  const word = row.isStopped ? 'stopped' : toneOf(row.status).word
  const stopCells = stop ? stopWidth : 0
  const room = inner - before - pillCells(kit, row.status) - (row.isStopped ? 1 : 0) - stopCells
  const isOpenShown = inner - before - pillCells(kit, 'starting') - beside >= NAME_MIN && cellsOf(row.title, adv) <= room - beside
  const name = cutCells(row.title, Math.max(4, isOpenShown ? room - beside : room), adv)
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, row, AVATAR.card, { dot: true, animated: true })}</Box>
      <Box flexShrink={1} minWidth={0}>
        <Button key={agentKeyOf(row.id)} label={name} plain onPress={open}>
          <Text bold color={P.text}>
            {name}
          </Text>
        </Button>
      </Box>
      <Box flexShrink={0}>{statusPill(kit, row.status, word)}</Box>
      {isOpenShown || stop ? (
        <Box flexGrow={1} flexShrink={0} justifyContent="flex-end" {...(stop ? { columnGap: 2 } : {})}>
          {stop}
          {isOpenShown ? openButton(kit, `card:open:${row.id}`, toneOf(row.status).pillFg, open) : null}
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * A card's step box, as the web's chip: a small bordered box a shade lighter
 * than the pane, its glyph (✓ done, ◐ in hand, ✕ failed, ‖ waiting on you, a
 * dashed ring idle), its words (a plain Button, so it opens the page too),
 * and "n/total" dim at its right.
 */
function cardStep(kit: Kit, row: V2AgentRow, chip: Chip, inner: number, open: () => void): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const room = inner - chromeOf(kit) - glyphCells(kit) - 1 - plainSlack(kit) - (chip.n ? 1 + cellsOf(chip.n, adv) : 0)
  const text = cutCells(chip.text, Math.max(4, room), adv)
  return (
    <Box key={`chip:${row.id}`} flexDirection="row" columnGap={1} alignItems="center" borderStyle="round" borderColor={P.stepEdge} backgroundColor={P.stepBox} paddingX={1}>
      <Box flexShrink={0}>{glyph(kit, chip.glyph)}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Button key={`card:step:${row.id}`} label={text} plain onPress={open}>
          <Text color={P.fg2}>{text}</Text>
        </Button>
      </Box>
      {chip.n ? (
        <Box flexShrink={0}>
          <Text color={P.muted2}>{chip.n}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** A card's now line in `rows` lines (padded to its row's tallest), each a dim plain Button; a dash where it has none. */
function cardBody(kit: Kit, row: V2AgentRow, lines: readonly TickPart[][], rows: number, open: () => void): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {lines.length > 0
        ? lines.map((parts, i) => pressText(kit, `card:now:${row.id}:${i}`, tickParts(kit, parts, P.muted), open, true))
        : pressText(kit, `card:now:${row.id}:0`, [<Text color={P.muted3}>—</Text>], open, true)}
    </Box>
  )
}

/** A card's now line while it is the agent's words: the speech mark, then the words in italics in `rows` lines (Text, as a desktop's Button would draw them plain). */
function cardWords(kit: Kit, lines: readonly TickPart[][], rows: number): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row" columnGap={1} height={rows} overflow="hidden">
      <Box flexShrink={0}>{wordMark(kit, 'said', P.runText)}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {lines.map(parts => (
          <Text wrap="truncate-end">{wordParts(kit, parts, P.muted)}</Text>
        ))}
      </Box>
    </Box>
  )
}

/**
 * A card's foot, as the web's: "opus-5.5 · 13.7M" at the left and
 * "Started 6h ago" at the right, both dim, each a plain Button. Where both
 * do not fit, the tokens go first, then the time's first word ("6h ago"),
 * then the model's name is cut.
 */
function cardFoot(kit: Kit, row: V2AgentRow, inner: number, now: number, open: () => void): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const slack = plainSlack(kit)
  const dim = isAiry(kit)
  const fits = (left: string, right: string) => cellsOf(left, adv) + cellsOf(right, adv) + 2 * slack + 1 <= inner
  const bare = row.model || '—'
  let left = modelLine(row)
  let time = runTitle(row, now)
  if (!fits(left, time)) left = bare
  if (!fits(left, time)) time = runShort(row, now)
  if (!fits(left, time)) left = cutCells(bare, Math.max(4, inner - cellsOf(time, adv) - 2 * slack - 1), adv)
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexShrink={1} minWidth={0}>
        <Button key={`card:foot:${row.id}`} label={left} plain dimColor={dim} onPress={open}>
          <Text color={P.muted2}>{left}</Text>
        </Button>
      </Box>
      <Box flexShrink={0}>
        <Button key={`card:time:${row.id}`} label={time} plain dimColor={dim} onPress={open}>
          <Text color={P.muted2}>{time}</Text>
        </Button>
      </Box>
    </Box>
  )
}

// The figures.

/** Each figure's icon, at its right as the page draws it, in the page's half-strength grey. */
const TILE_ICON: Readonly<Record<string, IconName>> = { running: 'bot', plan: 'listChecks', spend: 'dollar', waiting: 'hand' }
const TILE_HUE = mix(P.muted, P.card, 0.5)

/** The figures under their head, "▾ FIGURES"; folded, the head and each one's value in a few words. */
export function figuresSection(kit: Kit, state: WebStateV2, actions: DashActions, fold: Fold): RenderElement {
  return section(kit, 'now:figures', foldHead(kit, fold, 'Figures', null, actions), fold.isOpen ? tileStrip(kit, state) : null)
}

/** The figures, each in a bordered tile: all in a row where the pane is wide enough, else two. */
function tileStrip(kit: Kit, state: WebStateV2): RenderElement {
  const { Box, Text } = kit
  const tiles = tilesOf(state, figuresOf(state))
  const perRow = kit.columns >= WIDE ? tiles.length : 2
  const width = widthFor(kit.columns, perRow)
  const inner = Math.max(8, width - CARD_CHROME)
  return (
    <Box key="now:tiles" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      {tiles.map(tile => (
        <Box key={`tile:${tile.key}`} flexDirection="column" width={width} borderStyle="round" borderColor={P.border} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Text bold color={P.text} wrap="truncate-end">
              {tile.value}
            </Text>
            {svgOf(kit) ? icon(kit, TILE_ICON[tile.key] ?? 'bot', TILE_HUE, '', 16) : null}
          </Box>
          <Text color={P.muted} wrap="wrap">
            {tile.label}
          </Text>
          <Text wrap="wrap">{tickTexts(kit, cut(tile.desc, inner * 3), P.muted2)}</Text>
        </Box>
      ))}
    </Box>
  )
}

// Recent activity and Files.

/** The calls Recent activity shows: the newest ten, as the web's. */
const MOST_CALLS = 10

/** Recent activity and Files: side by side in a pane of SIDE_BY_SIDE cells or more, each half of it; one under the other below. Each folds by its head on its own. */
export function listsOf(kit: Kit, state: WebStateV2, actions: DashActions, activity: Fold, files: Fold): RenderElement {
  const { Box } = kit
  if (kit.columns + 1 >= SIDE_BY_SIDE) {
    const half = Math.floor((kit.columns - 2) / 2)
    return (
      <Box key="now:lists" flexDirection="row" columnGap={2} alignItems="flex-start">
        {activitySection(kit, state, actions, half, activity)}
        {filesSection(kit, state, actions, half, files)}
      </Box>
    )
  }
  // both folded on the terminal: their heads one under the other, no line between
  return (
    <Box key="now:lists" flexDirection="column" gap={isAiry(kit) ? 2 : !activity.isOpen && !files.isOpen ? 0 : 1}>
      {activitySection(kit, state, actions, kit.columns, activity)}
      {filesSection(kit, state, actions, kit.columns, files)}
    </Box>
  )
}

/** A list as the web's `.card.list`: a bordered box its rows fill edge to edge, a rule between them. */
export function listBox(kit: Kit, key: string, rows: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={0} paddingY={0} overflow="hidden">
      {rows}
    </Box>
  )
}

/** A list's row: its parts in a line, padded so a desktop gives it the web's 48 px, washed under the pointer as the web's rows are. */
export function listRow(kit: Kit, key: string, parts: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="center" paddingX={1} paddingY={isAiry(kit) ? 1 : 0} hover={{ backgroundColor: P.rowHover }}>
      {parts}
    </Box>
  )
}

/** How a call stands, in its hue: running blue, waiting amber, failed red, the rest dim. */
const OUTCOME_HUE: Readonly<Record<ActivityRow['outcome']['tone'], string>> = { live: P.runText, wait: P.waitText, fail: P.failText, quiet: P.muted2 }

/** The cells an activity row's outcome ("◐ running", "837ms") and age ("12m") take at its right. */
const OUTCOME = 9
const TIME = 4

/** Recent activity: the newest ten calls and words of every agent, newest first, in a bordered list; folded, its head and the newest. */
function activitySection(kit: Kit, state: WebStateV2, actions: DashActions, width: number, fold: Fold): RenderElement {
  const head = foldHead(kit, fold, 'Recent activity', null, actions)
  if (!fold.isOpen) return section(kit, 'now:activity', head, null, width)
  const rows = activityRows(state, MOST_CALLS)
  const body =
    rows.length === 0
      ? quiet(kit, "No tool calls yet: every agent's tool calls show here as they happen.")
      : listBox(
          kit,
          'now:calls',
          rows.flatMap((row, i) => [i > 0 ? rule(kit) : null, activityRow(kit, state, row, actions, width)]),
        )
  return section(kit, 'now:activity', head, body, width)
}

/**
 * One call, as the web's row: the agent's face, its name (bold where the
 * surface draws a Button's Text), the verb dim, what it was given; how it
 * went and when, dim, in fixed columns at the right. The name and the words
 * are plain Buttons that open the agent's page. An agent's words ("said")
 * are quoted in italics, in Text of their own, with no outcome.
 */
function activityRow(kit: Kit, state: WebStateV2, row: ActivityRow, actions: DashActions, width: number): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const slack = plainSlack(kit)
  const isKnown = rowOf(state, row.agent) !== undefined
  const open = () => {
    if (isKnown) actions.openAgent(row.agent)
  }
  const faceCells = svgOf(kit) ? cellsForPx(AVATAR.list) : avatarCells(kit, AVATAR.list)
  // the words' room: the row inside the list's edges and its own padding, less the face, the outcome, the age and the gaps
  const room = Math.max(12, width - edgesOf(kit) - 2 - faceCells - 1 - 1 - OUTCOME - 1 - TIME)
  const name = cutCells(row.name, Math.min(22, Math.max(6, room * 0.45)), adv)
  const verb = ` ${row.verb} `
  const text = row.text ? cutCells(row.text, Math.max(4, room - cellsOf(name, adv) - cellsOf(verb, adv) - 2 * slack), adv) : ''
  const said = row.outcome.mark ? `${row.outcome.mark} ${row.outcome.text}` : row.outcome.text
  return listRow(kit, `act:${row.key}`, [
    <Box flexShrink={0}>{face(kit, rowOf(state, row.agent) ?? null, AVATAR.list)}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center">
      <Box flexShrink={0}>
        <Button key={`now:act:${row.key}`} label={name} plain onPress={open}>
          <Text bold color={P.text}>
            {name}
          </Text>
        </Button>
      </Box>
      <Box flexShrink={0}>
        <Text color={P.muted}>{verb}</Text>
      </Box>
      {text ? (
        <Box flexShrink={1} minWidth={0}>
          {row.isSaid ? (
            <Text wrap="truncate-end">{wordParts(kit, ticks(text), P.fg2)}</Text>
          ) : (
            <Button key={`now:acttext:${row.key}`} label={text} plain onPress={open}>
              <Text color={P.fg2}>{text}</Text>
            </Button>
          )}
        </Box>
      ) : null}
    </Box>,
    <Box flexShrink={0} width={OUTCOME} justifyContent="flex-end">
      <Text color={OUTCOME_HUE[row.outcome.tone]}>{said}</Text>
    </Box>,
    <Box flexShrink={0} width={TIME} justifyContent="flex-end">
      <Text color={P.muted2}>{ago(row.at, state.now)}</Text>
    </Box>,
  ])
}

/** The repository's files the list shows: the ten edited last, as the web's. */
const MOST_FILES = 10
/** The files outside the repository its open row shows at most, the newest first. */
const MOST_OUTSIDE = 20
/** The tag on a file two or more agents edited, as the web's amber "shared". */
const SHARED = 'shared'
/** The editors' faces a file row shows at most, and each face's size in px. */
const MOST_FACES = 3
const FACE = 16
/** The file icon's size in px. */
const FILE_ICON = 14

/** Whether Files' row of files outside the repository is open: kept while the module lives, as the web page keeps its own. */
const outsideRow = { isOpen: false }

/**
 * Files, as the web's FILES card: its count the repository's files, and
 * "Changes →" beside its head. The ten of the repository edited last, then
 * one dim row, "n files outside the repo", that opens on those.
 */
function filesSection(kit: Kit, state: WebStateV2, actions: DashActions, width: number, fold: Fold): RenderElement {
  const { Button } = kit
  const groups = fileGroupsOf(state, MOST_FILES)
  const total = groups.insideCount + groups.outside.length
  const link = total > 0 ? <Button key="now:changes" label="Changes →" plain dimColor onPress={() => actions.setV2View({ tab: 'changes', isInspectOpen: false })} /> : null
  const head = foldHead(kit, fold, 'Files', groups.insideCount > 0 ? groups.insideCount : null, actions, link)
  if (!fold.isOpen) return section(kit, 'now:files', head, null, width)
  const rows: (RenderElement | null)[] = []
  const add = (row: RenderElement) => {
    if (rows.length > 0) rows.push(rule(kit))
    rows.push(row)
  }
  for (const row of groups.inside) add(fileRow(kit, state, row, actions, width))
  if (groups.outside.length > 0) {
    add(outsideToggle(kit, groups.outside.length, actions))
    if (outsideRow.isOpen) {
      for (const row of groups.outside.slice(0, MOST_OUTSIDE)) add(fileRow(kit, state, row, actions, width))
      const more = groups.outside.length - MOST_OUTSIDE
      if (more > 0) add(outsideMore(kit, more))
    }
  }
  return section(kit, 'now:files', head, total === 0 ? quiet(kit, 'No files edited yet: the files agents edit show here, with who edited each.') : listBox(kit, 'now:filelist', rows), width)
}

/** The row of files outside the repository: a chevron and "n files outside the repo", dim; a press opens it on them, or shuts it. */
function outsideToggle(kit: Kit, n: number, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const isOpen = outsideRow.isOpen
  const chevron = svgOf(kit) ? icon(kit, isOpen ? 'chevronDown' : 'chevronRight', P.muted2, '', FILE_ICON) : <Text color={P.muted2}>{isOpen ? '▾' : '▸'}</Text>
  const flip = () => {
    outsideRow.isOpen = !outsideRow.isOpen
    actions.redraw()
  }
  return listRow(kit, 'files:outside', [
    <Box flexShrink={0}>{chevron}</Box>,
    <Box flexShrink={1} minWidth={0}>
      <Button key="now:files:outside" label={`${plural(n, 'file')} outside the repo`} plain dimColor onPress={flip} />
    </Box>,
  ])
}

/** Past the open list's last row: how many more files outside the repository there are, dim. */
function outsideMore(kit: Kit, more: number): RenderElement {
  const { Box, Text } = kit
  return listRow(kit, 'files:outside:more', [
    <Box flexShrink={0} width={svgOf(kit) ? Math.ceil(cellsForPx(FILE_ICON)) : 1} />,
    <Text color={P.muted2} wrap="truncate-end">{`and ${plural(more, 'more file')} outside the repo`}</Text>,
  ])
}

/**
 * One file, as the web's row: its icon, its folder dim and its name bright
 * (a plain Button), "shared" where two or more agents edited it, the
 * editors' faces, +a −r in green and red. A press on its name opens Changes
 * on that file (open there, in view): git's file where git lists it, else the
 * agents' edits of it where Changes lists those (with no repository, or
 * outside it); else Changes.
 */
function fileRow(kit: Kit, state: WebStateV2, row: FileRow, actions: DashActions, width: number): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const open = () => {
    actions.setV2View({ tab: 'changes', isInspectOpen: false })
    if (row.changesPath === '' && (state.changes.repo === null || row.isOutside)) {
      openEditsOf(row.path)
      actions.reveal(editsKeyOf(row.path))
      return
    }
    if (row.changesPath === '') return
    // a file already open there would fold at a second press: none open first, then this one
    actions.selectFile('')
    actions.selectFile(row.changesPath)
    actions.reveal(fileKeyOf(row.changesPath))
  }
  const added = `+${row.added}`
  const removed = ` −${row.removed}`
  const iconCells = svgOf(kit) ? cellsForPx(FILE_ICON) : 1
  // the path's room: the row inside the list's edge and its own padding, less the icon, the name's chrome, the tag, the faces, the counts and the gaps
  const taken =
    edgesOf(kit) +
    2 +
    iconCells +
    1 +
    plainSlack(kit) +
    (row.isShared ? tagCells(kit, SHARED) + 1 : 0) +
    (row.editors.length > 0 ? facesCells(kit, row.editors.length, FACE, MOST_FACES) + 1 : 0) +
    cellsOf(added + removed, adv) +
    1
  const path = fitPath(row.dir, row.name, Math.max(8, width - taken), adv)
  return listRow(kit, `files:${row.path}`, [
    <Box flexShrink={0}>{svgOf(kit) ? icon(kit, 'file', P.muted2, '', FILE_ICON) : <Text color={P.muted3}>·</Text>}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center">
      {path.dir ? (
        <Text color={P.muted2} wrap="truncate-end">
          {path.dir}
        </Text>
      ) : null}
      <Box flexShrink={1} minWidth={0}>
        <Button key={`now:file:${row.path}`} label={path.name} plain onPress={open}>
          <Text color={P.fg2}>{path.name}</Text>
        </Button>
      </Box>
    </Box>,
    row.isShared ? <Box flexShrink={0}>{tag(kit, SHARED)}</Box> : null,
    row.editors.length > 0 ? (
      <Box flexShrink={0}>
        {faces(
          kit,
          row.editors.map(id => rowOf(state, id) ?? null),
          FACE,
          row.editors.map(id => rowOf(state, id)?.title ?? id),
          MOST_FACES,
        )}
      </Box>
    ) : null,
    <Box flexShrink={0}>
      <Text color={P.doneText}>{added}</Text>
      <Text color={P.failText}>{removed}</Text>
    </Box>,
  ])
}
