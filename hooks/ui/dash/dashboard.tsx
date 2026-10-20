/**
 * The Dashboard tab, the deck's first screen, drawn from the same state the
 * web deck's page reads (`webStateOf`), so the two always agree, and laid out
 * as that page lays it out, top to bottom:
 *
 * - what needs you (./needs): questions to answer here, permissions to give
 *   in Claude Code, or the needs-you banner;
 * - the goal: its headline and up to two lines of its words, the follow-up
 *   last typed, "Step n of m · <step>" (a press opens that step on the
 *   Plan tab) and the plan's segmented bar;
 * - the agents, a card each as the web's run cards, in rows of as many as fit
 *   at 32 cells or more (`cardsPerRow`: two at the pane's usual 68 to 84
 *   cells, up to six at its widest), each row's cards as wide and as tall.
 *   A card: the avatar (its status dot at the foot), the name, its status
 *   pill right after it and "Open →" at the right; the step box (its status
 *   glyph, the agent's scope or the Orchestrator's place in the plan,
 *   "n/total"); its now line or result, two lines at most; "model · tokens"
 *   and "Started 6h ago". Every line of it a press that opens the agent's
 *   page; the edge in the status's hue while it runs, waits or failed, and
 *   in its hue under the pointer, "Open →" lit with it;
 * - the KPI strip: agents running, plan steps, session spend, waiting on you;
 * - recent activity and files, each a bordered list with a rule between its
 *   rows, side by side from 120 cells as the web's two columns, one under the
 *   other below. The newest ten calls: the agent's face and name, the verb
 *   dim, the target; how it went and when in columns at the right; a press
 *   opens the agent on its Activity. The ten files of the repository edited
 *   last: the folder dim and the name bright, a live dot, "shared", the
 *   editors' faces, +a −r; a press opens the file in Changes where Changes
 *   lists it, else the Diffs of the agent that edited it last (always so in
 *   the sample, which has no Changes of its own). Then one dim row, "n files
 *   outside the repo", that opens on those (`isOutside`: mostly scratch and
 *   temp files, each by its last two parts);
 * - Open in browser, the web deck one press away (not in the sample).
 *
 * Each of the goal, the agents, the figures, recent activity and files sits
 * under a head that folds it (`foldHead`: "▾ AGENTS 7", a plain Button): a
 * press folds the section to its head and one dim line of what it holds
 * ("▸ AGENTS 7 · 2 running · 1 waiting"), another opens it again. What is
 * folded lives in the deck's view (`DeckView.collapsed`, toggled by
 * `toggleSection`), so redraws, live updates and reloads keep it.
 *
 * A desktop draws a plain Button's label alone, in its own ink, so the
 * colours and weights the web gives its words sit on Text and images beside
 * the pressable words, not in them, and a line the web draws dim is a dim
 * Button there. Its gaps are half lines, so cards and lists breathe as the
 * web's do, where the terminal keeps its lines close; and it draws no tree
 * of 2000 elements or more, so its lists stay short. Every time is coarse
 * ("4m"), so a redraw a minute is the most time alone asks.
 *
 * Pure but for whether the Files list's row of files outside the repository
 * is open, kept here while the module lives: Kit, the state and DashActions
 * come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebAgent, WebState } from '../../web'
import type { DashActions, Kit, WebPane } from '../types'
import {
  FOLD,
  activityFoldOf,
  activityRows,
  agentOf,
  agentsFoldOf,
  ago,
  cardLine,
  cardsPerRow,
  cellsOf,
  chipOf,
  cut,
  cutCells,
  dashAgents,
  fileGroupsOf,
  filesFoldOf,
  figuresFoldOf,
  firstLine,
  fitPath,
  flat,
  goalFoldOf,
  goalRest,
  kpisOf,
  modelLine,
  nameOf,
  plural,
  runShort,
  runTitle,
  stepLineOf,
  wrapTicks,
  type ActivityRow,
  type Chip,
  type FileRow,
  type TickPart,
} from './dashModel'
import { needsBanner, needsCards } from './needs'
import { P, STEP_HUE, mix, stepsSvg, toneOf, type IconName } from './palette'
import {
  AVATAR,
  CARD_CHROME,
  OPEN_LABEL,
  advanceOf,
  avatar,
  buttonSlack,
  cellsForPx,
  chromeOf,
  edgesOf,
  faces,
  facesCells,
  foldHead,
  glyph,
  glyphCells,
  icon,
  openAgentPage,
  openButton,
  pillCells,
  plainSlack,
  pressLine,
  pressText,
  quiet,
  rule,
  sectionFold,
  statusPill,
  svgOf,
  tag,
  tagCells,
  tickParts,
  tickTexts,
  widthFor,
  webLine,
  wrapAdvanceOf,
  type Fold,
} from './parts'

/** From this many cells the KPI boxes go four a row; two below. */
export const WIDE = 60

/** From a pane this many cells wide (the tab drawn a cell narrower) Recent activity and Files sit side by side, as the web's two columns; one under the other below. */
export const SIDE_BY_SIDE = 120

/**
 * Whether `kit` lays its gaps out in half lines (a desktop: a gap of one is
 * half a line, about the web's 10 to 12 px), so cards and lists may breathe
 * without a blank line between their parts; the terminal's gaps are whole
 * lines, so there they stay close.
 */
function isAiry(kit: Kit): boolean {
  return kit.surface !== 'terminal'
}

/**
 * The tab: what needs you, the goal, the agents, the figures, the activity
 * and the files, each folded to its head where `collapsed` (the view's
 * `DeckView.collapsed`) holds its FOLD id; and the web deck's button.
 */
export function dashboardTab(kit: Kit, state: WebState, actions: DashActions, now: number, web: WebPane | null, collapsed: readonly string[] = []): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column" gap={isAiry(kit) ? 2 : 1}>
      {needsCards(kit, state, actions, now, 'dash')}
      {needsBanner(kit, state, actions)}
      {goalSection(kit, state, now, actions, sectionFold(collapsed, FOLD.goal, goalFoldOf(state)))}
      {agentsSection(kit, state, actions, now, sectionFold(collapsed, FOLD.agents, agentsFoldOf(state)))}
      {figuresSection(kit, state, actions, sectionFold(collapsed, FOLD.figures, figuresFoldOf(state)))}
      {listsOf(kit, state, actions, now, web !== null, collapsed)}
      {web ? webBlock(kit, web, actions) : null}
    </Box>
  )
}

/** A section as the Dashboard stacks it: its head, then (while open) what it holds, half a line apart where the surface lays gaps out in half lines. */
function section(kit: Kit, key: string, head: RenderElement, body: RenderElement | null, width?: number): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" rowGap={isAiry(kit) ? 1 : 0} {...(width === undefined ? {} : { width })}>
      {head}
      {body}
    </Box>
  )
}

/** The goal under its head, "▾ GOAL"; folded, the head and "· <headline> · Step 2 of 5". */
function goalSection(kit: Kit, state: WebState, now: number, actions: DashActions, fold: Fold): RenderElement {
  return section(kit, 'dash:goal:section', foldHead(kit, fold, 'Goal', null, actions), fold.isOpen ? goalCard(kit, state, now, actions) : null)
}

/** The plan's bar: the steps as one rounded segment each where Svg draws (the slot's width), else a run of cells a step in its colour. */
function stepsBar(kit: Kit, statuses: readonly string[], room: number): RenderElement {
  const { Box, Text } = kit
  const Svg = svgOf(kit)
  const done = statuses.filter(status => status === 'done').length
  if (Svg) return <Svg source={stepsSvg(statuses, Math.max(120, room * 8))} alt={`Plan: ${done} of ${statuses.length} steps done`} />
  const n = Math.max(1, statuses.length)
  const cell = Math.max(1, Math.floor((room - (n - 1)) / n))
  return (
    <Box flexDirection="row" columnGap={1}>
      {statuses.map(status => (
        <Text backgroundColor={STEP_HUE[status] ?? P.track}>{' '.repeat(cell)}</Text>
      ))}
    </Box>
  )
}

/**
 * Where the plan stands, "Step 2 of 5 · <step>", as one plain Button: it
 * opens the Plan tab on the step in hand (`openStep`, that step open and in
 * view), or the Plan tab itself while no step is in hand. Cut to one line.
 */
function stepLink(kit: Kit, state: WebState, step: { lead: string; text: string }, room: number, actions: DashActions): RenderElement {
  const { Text } = kit
  const active = state.plan.steps.find(one => one.status === 'active')
  const open = () => (active ? actions.openStep(active.key) : actions.setTab('plan'))
  const width = Math.max(8, room - buttonSlack(kit))
  const lead = cut(step.lead, width)
  const textRoom = width - Array.from(lead).length - 3
  const parts = [
    <Text color={P.fg2}>{lead}</Text>,
    ...(step.text && textRoom >= 4 ? [<Text color={P.muted3}> · </Text>, <Text color={P.muted}>{cut(step.text, textRoom)}</Text>] : []),
  ]
  return pressLine(kit, 'dash:step', parts, open)
}

/** The goal: its headline bold beside its age, two lines of its words at most, the follow-up typed last, then where the plan stands (a press opens that step on the Plan tab). */
function goalCard(kit: Kit, state: WebState, now: number, actions: DashActions): RenderElement {
  const { Box, Text } = kit
  const goal = state.goal
  const room = Math.max(16, kit.columns - CARD_CHROME - 2)
  if (!goal) {
    return (
      <Box key="dash:goal" flexDirection="row" columnGap={1} borderStyle="round" borderColor={P.border} paddingX={1}>
        <Box flexShrink={0}>{icon(kit, 'target', P.muted) ?? <Text color={P.muted}>◎</Text>}</Box>
        <Text color={P.muted} wrap="wrap">
          No goal yet. Your next prompt to Claude Code becomes the goal.
        </Text>
      </Box>
    )
  }
  const rest = flat(goalRest(goal))
  const last = goal.followUps[goal.followUps.length - 1]
  const step = stepLineOf(state)
  const statuses = state.plan.steps.map(one => one.status)
  return (
    <Box key="dash:goal" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{icon(kit, 'target', P.muted) ?? <Text color={P.muted}>◎</Text>}</Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold color={P.text} wrap="wrap">
            {goal.headline || firstLine(goal.text)}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={P.muted2}>{ago(goal.at, now)}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {rest ? (
          <Text color={P.muted} wrap="wrap">
            {cut(rest, room * 2)}
          </Text>
        ) : null}
        {last ? (
          <Box flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>{icon(kit, 'cornerDownRight', P.muted2, 14) ?? <Text color={P.muted2}>↳</Text>}</Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={P.fg2} wrap="truncate-end">
                {flat(last.text)}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={P.muted2}>{ago(last.at, now)}</Text>
            </Box>
          </Box>
        ) : null}
        {step ? stepLink(kit, state, step, room, actions) : null}
        {statuses.length > 0 ? stepsBar(kit, statuses, room) : null}
      </Box>
    </Box>
  )
}

// The agents.

/** One card before it is drawn: its agent, its step box, and its body laid into lines (the row it sits in pads each card to its tallest). */
type CardModel = { agent: WebAgent; chip: Chip; lines: TickPart[][] }

/** An agent's card laid out for a card `width` cells wide: its step box, and its now line or result in two lines at most. */
function cardOf(kit: Kit, state: WebState, agent: WebAgent, width: number): CardModel {
  const chip = chipOf(state, agent)
  const said = cardLine(agent, chip.text)
  const room = Math.max(6, width - chromeOf(kit) - plainSlack(kit))
  return { agent, chip, lines: said ? wrapTicks(said, room, 2, wrapAdvanceOf(kit)) : [] }
}

/**
 * The agents: their head ("▾ AGENTS 7", a press folds them to it and how
 * many run, wait and so on) and the way to the org chart, then their cards in
 * rows of as many as fit (`cardsPerRow`), every card in a row as wide, and as
 * tall: each body padded to the row's longest, one line or two.
 */
function agentsSection(kit: Kit, state: WebState, actions: DashActions, now: number, fold: Fold): RenderElement {
  const { Box, Button } = kit
  const { shown, hidden } = dashAgents(state)
  const perRow = cardsPerRow(kit.columns)
  const width = widthFor(kit.columns, perRow)
  const link = <Button key="dash:org" label={hidden > 0 ? `${hidden} more in the org chart →` : 'Org chart →'} plain dimColor onPress={() => actions.setTab('org')} />
  const cards = shown.map(agent => cardOf(kit, state, agent, width))
  const rows: CardModel[][] = []
  for (let i = 0; i < cards.length; i += perRow) rows.push(cards.slice(i, i + perRow))
  const head = foldHead(kit, fold, 'Agents', state.agents.length, actions, link)
  if (!fold.isOpen) return section(kit, 'dash:agents', head, null)
  return (
    <Box key="dash:agents" flexDirection="column" rowGap={isAiry(kit) ? 1 : 0}>
      {head}
      {shown.length === 0 ? (
        quiet(kit, 'No agents yet: when Claude Code starts working, the Orchestrator and the agents it delegates to show up here.')
      ) : (
        <Box flexDirection="column" rowGap={1}>
          {rows.map(row => {
            const lines = Math.max(1, ...row.map(card => card.lines.length))
            return <Box flexDirection="row" columnGap={1}>{row.map(card => agentCard(kit, state, card, width, lines, actions, now))}</Box>
          })}
        </Box>
      )}
    </Box>
  )
}

/**
 * One agent's card, as the web's run card, every line of it a plain Button
 * that opens its page: its head (avatar, name, pill, "Open →"), its step box,
 * its now line in `lines` lines, its foot. A grey edge, or its hue's while it
 * runs, waits on you or failed; its hue under the pointer, "Open →" lit with it.
 */
function agentCard(kit: Kit, state: WebState, card: CardModel, width: number, lines: number, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const { agent } = card
  const tone = toneOf(agent.status)
  const inner = Math.max(8, width - chromeOf(kit))
  const open = () => openAgentPage(actions, state, agent.id)
  return (
    <Box key={`card:${agent.id}`} flexDirection="column" width={width} borderStyle="round" borderColor={tone.edge} hover={{ borderColor: tone.hot }} paddingX={1} rowGap={isAiry(kit) ? 1 : 0}>
      {cardHead(kit, agent, inner, open)}
      {cardStep(kit, agent, card.chip, inner, open)}
      {cardBody(kit, agent, card.lines, lines, open)}
      {cardFoot(kit, agent, inner, now, open)}
    </Box>
  )
}

/** An avatar's status dot, as the web's card draws it: its status's hue, a darker grey while idle. */
function dotOf(status: string): string {
  return status === 'idle' ? P.idleDot : toneOf(status).hue
}

/** The cells "Open →" takes where a card's head lays it out. */
function openCells(kit: Kit): number {
  return cellsOf(OPEN_LABEL, advanceOf(kit)) + plainSlack(kit)
}

/** The room a name keeps at the least beside "Open →" and the widest pill for a card to show it: about a dozen letters ("Orchestrator"). */
const NAME_MIN = 11

/**
 * A card's head, as the web's: the avatar with its status dot, the name (a
 * plain Button, bold where the surface draws a Button's Text), the status
 * pill right after it, and "Open →" at the far right, dim, lit while the
 * pointer is on the card. "Open →" stands where cards this wide leave a name
 * NAME_MIN beside it and the widest pill, so a width's cards agree, and only
 * beside a name that fits whole: a long name keeps its words, not the arrow.
 */
function cardHead(kit: Kit, agent: WebAgent, inner: number, open: () => void): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const before = (svgOf(kit) ? cellsForPx(AVATAR.card) : 1) + 1 + plainSlack(kit) + 1
  const beside = 1 + openCells(kit)
  const room = inner - before - pillCells(kit, agent.status)
  const isOpenShown = inner - before - pillCells(kit, 'starting') - beside >= NAME_MIN && cellsOf(agent.label, adv) <= room - beside
  const name = cutCells(agent.label, Math.max(4, isOpenShown ? room - beside : room), adv)
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, agent.avatar, AVATAR.card, agent.label, dotOf(agent.status))}</Box>
      <Box flexShrink={1} minWidth={0}>
        <Button key={`dash:agent:${agent.id}`} label={name} plain onPress={open}>
          <Text bold color={P.text}>
            {name}
          </Text>
        </Button>
      </Box>
      <Box flexShrink={0}>{statusPill(kit, agent.status)}</Box>
      {isOpenShown ? (
        <Box flexGrow={1} flexShrink={0} justifyContent="flex-end">
          {openButton(kit, `dash:open:${agent.id}`, toneOf(agent.status).pillFg, open)}
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * A card's step box, as the web's chip: a small bordered box a shade lighter
 * than the pane, its status glyph (✓ done, ◐ in hand, ✕ failed, ‖ waiting on
 * you, a dashed ring idle), its words (a plain Button, so it opens the page
 * too), and "n/total" dim at its right.
 */
function cardStep(kit: Kit, agent: WebAgent, chip: Chip, inner: number, open: () => void): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const room = inner - chromeOf(kit) - glyphCells(kit) - 1 - plainSlack(kit) - (chip.n ? 1 + cellsOf(chip.n, adv) : 0)
  const text = cutCells(chip.text, Math.max(4, room), adv)
  return (
    <Box key={`chip:${agent.id}`} flexDirection="row" columnGap={1} alignItems="center" borderStyle="round" borderColor={P.stepEdge} backgroundColor={P.stepBox} paddingX={1}>
      <Box flexShrink={0}>{glyph(kit, chip.glyph)}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Button key={`dash:chip:${agent.id}`} label={text} plain onPress={open}>
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

/** A card's now line or result in `rows` lines (padded to its row's tallest), each a dim plain Button; a dash where it has none. */
function cardBody(kit: Kit, agent: WebAgent, lines: readonly TickPart[][], rows: number, open: () => void): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      {lines.length > 0
        ? lines.map((parts, i) => pressText(kit, `dash:now:${agent.id}:${i}`, tickParts(kit, parts, P.muted), open, true))
        : pressText(kit, `dash:now:${agent.id}:0`, [<Text color={P.muted3}>—</Text>], open, true)}
    </Box>
  )
}

/**
 * A card's foot, as the web's: "opus-5.5 · 13.7M" at the left and
 * "Started 6h ago" at the right, both dim, each a plain Button. Where both
 * do not fit, the tokens go first, then the time's first word ("6h ago"),
 * then the model's name is cut.
 */
function cardFoot(kit: Kit, agent: WebAgent, inner: number, now: number, open: () => void): RenderElement {
  const { Box, Button, Text } = kit
  const adv = advanceOf(kit)
  const slack = plainSlack(kit)
  const dim = isAiry(kit)
  const fits = (left: string, right: string) => cellsOf(left, adv) + cellsOf(right, adv) + 2 * slack + 1 <= inner
  const bare = agent.model || '—'
  let left = modelLine(agent)
  let time = runTitle(agent, now)
  if (!fits(left, time)) left = bare
  if (!fits(left, time)) time = runShort(agent, now)
  if (!fits(left, time)) left = cutCells(bare, Math.max(4, inner - cellsOf(time, adv) - 2 * slack - 1), adv)
  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexShrink={1} minWidth={0}>
        <Button key={`dash:foot:${agent.id}`} label={left} plain dimColor={dim} onPress={open}>
          <Text color={P.muted2}>{left}</Text>
        </Button>
      </Box>
      <Box flexShrink={0}>
        <Button key={`dash:time:${agent.id}`} label={time} plain dimColor={dim} onPress={open}>
          <Text color={P.muted2}>{time}</Text>
        </Button>
      </Box>
    </Box>
  )
}

// The figures.

/** Each figure's icon, at its right as the page draws it, in the page's half-strength grey. */
const KPI_ICON: Readonly<Record<string, IconName>> = { running: 'bot', plan: 'listChecks', spend: 'dollar', waiting: 'hand' }
const KPI_HUE = mix(P.muted, P.card, 0.5)

/** The figures under their head, "▾ FIGURES"; folded, the head and each one's value in a few words. */
function figuresSection(kit: Kit, state: WebState, actions: DashActions, fold: Fold): RenderElement {
  return section(kit, 'dash:figures', foldHead(kit, fold, 'Figures', null, actions), fold.isOpen ? kpiStrip(kit, state) : null)
}

/** The four figures, each in a bordered box: four a row where the pane is wide enough, else two. */
function kpiStrip(kit: Kit, state: WebState): RenderElement {
  const { Box, Text } = kit
  const kpis = kpisOf(state)
  const perRow = kit.columns >= WIDE ? 4 : 2
  const width = widthFor(kit.columns, perRow)
  const inner = Math.max(8, width - CARD_CHROME)
  return (
    <Box key="dash:kpis" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      {kpis.map(kpi => (
        <Box key={`kpi:${kpi.key}`} flexDirection="column" width={width} borderStyle="round" borderColor={P.border} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Text bold color={P.text} wrap="truncate-end">
              {kpi.value}
            </Text>
            {icon(kit, KPI_ICON[kpi.key] ?? 'bot', KPI_HUE)}
          </Box>
          <Text color={P.muted} wrap="wrap">
            {kpi.label}
          </Text>
          <Text wrap="wrap">{tickTexts(kit, cut(kpi.desc, inner * 3), P.muted2)}</Text>
        </Box>
      ))}
    </Box>
  )
}

// Recent activity and Files.

/** Recent activity and Files: side by side in a pane of SIDE_BY_SIDE cells or more, each half of it, as the web's two columns; one under the other below. Each folds by its head on its own. */
function listsOf(kit: Kit, state: WebState, actions: DashActions, now: number, hasChanges: boolean, collapsed: readonly string[]): RenderElement {
  const { Box } = kit
  const activity = sectionFold(collapsed, FOLD.activity, activityFoldOf(state, now, MOST_CALLS))
  const files = sectionFold(collapsed, FOLD.files, filesFoldOf(state))
  if (kit.columns + 1 >= SIDE_BY_SIDE) {
    const half = Math.floor((kit.columns - 2) / 2)
    return (
      <Box flexDirection="row" columnGap={2} alignItems="flex-start">
        {activitySection(kit, state, actions, now, half, activity)}
        {filesSection(kit, state, actions, hasChanges, half, files)}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={isAiry(kit) ? 2 : 1}>
      {activitySection(kit, state, actions, now, kit.columns, activity)}
      {filesSection(kit, state, actions, hasChanges, kit.columns, files)}
    </Box>
  )
}

/** A list as the web's `.card.list`: a bordered box its rows fill edge to edge (each row its own padding, so its hover wash reaches the edge), a rule between them. */
function listBox(kit: Kit, key: string, rows: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={0} paddingY={0} overflow="hidden">
      {rows}
    </Box>
  )
}

/** A list's row: its parts in a line, padded so a desktop gives it the web's 48 px, washed under the pointer as the web's rows are. */
function listRow(kit: Kit, key: string, parts: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  return (
    <Box key={key} flexDirection="row" columnGap={1} alignItems="center" paddingX={1} paddingY={isAiry(kit) ? 1 : 0} hover={{ backgroundColor: P.rowHover }}>
      {parts}
    </Box>
  )
}

/** The calls Recent activity shows: the newest ten, as the web's. */
const MOST_CALLS = 10

/** How a call stands, in its hue: running blue, waiting amber, failed red, the rest dim. */
const OUTCOME_HUE: Readonly<Record<ActivityRow['outcome']['tone'], string>> = { live: P.runText, wait: P.waitText, fail: P.failText, quiet: P.muted2 }

/** The cells an activity row's outcome ("◐ running", "837ms") and age ("12m") take at its right, as the agent page's Activity. */
const OUTCOME = 9
const TIME = 4

/** Recent activity: the newest ten calls of every agent, newest first, in a bordered list; folded, its head and the newest call. */
function activitySection(kit: Kit, state: WebState, actions: DashActions, now: number, width: number, fold: Fold): RenderElement {
  const head = foldHead(kit, fold, 'Recent activity', null, actions)
  if (!fold.isOpen) return section(kit, 'dash:activity', head, null, width)
  const rows = activityRows(state, MOST_CALLS)
  const body =
    rows.length === 0
      ? quiet(kit, "No tool calls yet: every agent's tool calls show here as they happen.")
      : listBox(
          kit,
          'dash:calls',
          rows.flatMap((row, i) => [i > 0 ? rule(kit) : null, activityRow(kit, state, row, actions, now, width)]),
        )
  return section(kit, 'dash:activity', head, body, width)
}

/**
 * One call, as the web's row: the agent's face, its name (bold where the
 * surface draws a Button's Text), the verb dim, the target; how it went and
 * when, dim, in fixed columns at the right. The name and the target are
 * plain Buttons that open the agent on its Activity.
 */
function activityRow(kit: Kit, state: WebState, row: ActivityRow, actions: DashActions, now: number, width: number): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const slack = plainSlack(kit)
  const open = () => openAgentPage(actions, state, row.agent, 'activity')
  const face = svgOf(kit) ? cellsForPx(AVATAR.row) : 1
  // the words' room: the row inside the list's edges and its own padding, less the face, the outcome, the age and the gaps
  const room = Math.max(12, width - edgesOf(kit) - 2 - face - 1 - 1 - OUTCOME - 1 - TIME)
  const name = cutCells(row.name, Math.min(22, Math.max(6, room * 0.45)), adv)
  const verb = ` ${row.verb} `
  const target = row.target ? cutCells(row.target, Math.max(4, room - cellsOf(name, adv) - cellsOf(verb, adv) - 2 * slack), adv) : ''
  const said = row.outcome.mark ? `${row.outcome.mark} ${row.outcome.text}` : row.outcome.text
  return listRow(kit, `act:${row.key}`, [
    <Box flexShrink={0}>{avatar(kit, row.avatar, AVATAR.row, row.name)}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center">
      <Box flexShrink={0}>
        <Button key={`dash:act:${row.key}`} label={name} plain onPress={open}>
          <Text bold color={P.text}>
            {name}
          </Text>
        </Button>
      </Box>
      <Box flexShrink={0}>
        <Text color={P.muted}>{verb}</Text>
      </Box>
      {target ? (
        <Box flexShrink={1} minWidth={0}>
          <Button key={`dash:acttarget:${row.key}`} label={target} plain onPress={open}>
            <Text color={P.fg2}>{target}</Text>
          </Button>
        </Box>
      ) : null}
    </Box>,
    <Box flexShrink={0} width={OUTCOME} justifyContent="flex-end">
      <Text color={OUTCOME_HUE[row.outcome.tone]}>{said}</Text>
    </Box>,
    <Box flexShrink={0} width={TIME} justifyContent="flex-end">
      <Text color={P.muted2}>{ago(row.at, now)}</Text>
    </Box>,
  ])
}

/** The repository's files the list shows: the ten edited last, as the web's. */
const MOST_FILES = 10
/** The files outside the repository its open row shows at most, the newest first: a desktop draws no tree of 2000 elements or more, and these are mostly scratch files. */
const MOST_OUTSIDE = 20
/** The tag on a file more than one agent edited, as the web's amber "shared". */
const SHARED = 'shared'
/** The editors' faces a file row shows at most, and each face's size in px. */
const MOST_FACES = 3
const FACE = 16
/** The file icon's size in px. */
const FILE_ICON = 14

/** Whether the Files list's row of files outside the repository is open: kept while the module lives, as the web page keeps its own. */
const outsideRow = { isOpen: false }

/**
 * Files, as the web's FILES card: its count the repository's files, and
 * "Changes →" beside its head where this session's Changes tab can show them
 * (`hasChanges`: not in the sample). The ten of the repository edited last,
 * then one dim row, "n files outside the repo", that opens on those. Folded,
 * its head and how many are shared, its lines, how many lie outside.
 */
function filesSection(kit: Kit, state: WebState, actions: DashActions, hasChanges: boolean, width: number, fold: Fold): RenderElement {
  const { Button } = kit
  const groups = fileGroupsOf(state, MOST_FILES)
  const link = hasChanges && state.files.length > 0 ? <Button key="dash:changes" label="Changes →" plain dimColor onPress={() => actions.setTab('changes')} /> : null
  const head = foldHead(kit, fold, 'Files', groups.insideCount > 0 ? groups.insideCount : null, actions, link)
  if (!fold.isOpen) return section(kit, 'dash:files', head, null, width)
  const rows: (RenderElement | null)[] = []
  const add = (row: RenderElement) => {
    if (rows.length > 0) rows.push(rule(kit))
    rows.push(row)
  }
  for (const row of groups.inside) add(fileRow(kit, state, row, actions, hasChanges, width))
  if (groups.outside.length > 0) {
    add(outsideToggle(kit, groups.outside.length, actions))
    if (outsideRow.isOpen) {
      for (const row of groups.outside.slice(0, MOST_OUTSIDE)) add(fileRow(kit, state, row, actions, hasChanges, width))
      const more = groups.outside.length - MOST_OUTSIDE
      if (more > 0) add(outsideMore(kit, more))
    }
  }
  return section(
    kit,
    'dash:files',
    head,
    state.files.length === 0 ? quiet(kit, 'No files touched yet: the files agents edit show here, with who is on each.') : listBox(kit, 'dash:filelist', rows),
    width,
  )
}

/** The row of files outside the repository, as the web's: a chevron and "n files outside the repo", dim; a press opens it on them, or shuts it. */
function outsideToggle(kit: Kit, n: number, actions: DashActions): RenderElement {
  const { Box, Button, Text } = kit
  const isOpen = outsideRow.isOpen
  const chevron = icon(kit, isOpen ? 'chevronDown' : 'chevronRight', P.muted2, FILE_ICON) ?? <Text color={P.muted2}>{isOpen ? '▾' : '▸'}</Text>
  const flip = () => {
    outsideRow.isOpen = !outsideRow.isOpen
    actions.redraw()
  }
  return listRow(kit, 'files:outside', [
    <Box flexShrink={0}>{chevron}</Box>,
    <Box flexShrink={1} minWidth={0}>
      <Button key="dash:files:outside" label={`${plural(n, 'file')} outside the repo`} plain dimColor onPress={flip} />
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
 * (a plain Button), a live dot while an agent is on it, "shared" when more
 * than one edited it, the editors' faces, +a −r in green and red. A press on
 * its name opens the file in the Changes tab where Changes lists it (its own
 * diff open there), else the Diffs of the agent that edited it last.
 */
function fileRow(kit: Kit, state: WebState, row: FileRow, actions: DashActions, hasChanges: boolean, width: number): RenderElement {
  const { Box, Text, Button } = kit
  const adv = advanceOf(kit)
  const open = () => {
    if (hasChanges && row.inChanges) {
      // a file already open there would fold at a second press: none open first, then this one
      actions.selectFile('')
      actions.setTab('changes')
      actions.selectFile(row.path)
      return
    }
    if (row.editor) actions.openAgent(row.editor, 'edits')
  }
  const added = `+${row.added}`
  const removed = ` −${row.removed}`
  const iconCells = svgOf(kit) ? cellsForPx(FILE_ICON) : 1
  // the path's room: the row inside the list's edge and its own padding, less the icon, the name's chrome, the dot, the tag, the faces, the counts and the gaps
  const taken =
    edgesOf(kit) +
    2 +
    iconCells +
    1 +
    plainSlack(kit) +
    (row.live ? 2 : 0) +
    (row.isShared ? tagCells(kit, SHARED) + 1 : 0) +
    (row.editors.length > 0 ? facesCells(kit, row.editors.length, FACE, MOST_FACES) + 1 : 0) +
    cellsOf(added + removed, adv) +
    1
  const path = fitPath(row.dir, row.name, Math.max(8, width - taken), adv)
  return listRow(kit, `files:${row.path}`, [
    <Box flexShrink={0}>{icon(kit, 'file', P.muted2, FILE_ICON) ?? <Text color={P.muted3}>·</Text>}</Box>,
    <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" alignItems="center">
      {path.dir ? (
        <Text color={P.muted2} wrap="truncate-end">
          {path.dir}
        </Text>
      ) : null}
      <Box flexShrink={1} minWidth={0}>
        <Button key={`dash:file:${row.path}`} label={path.name} plain onPress={open}>
          <Text color={P.fg2}>{path.name}</Text>
        </Button>
      </Box>
    </Box>,
    row.live ? (
      <Box flexShrink={0}>
        <Text color={P.run}>●</Text>
      </Box>
    ) : null,
    row.isShared ? <Box flexShrink={0}>{tag(kit, SHARED)}</Box> : null,
    row.editors.length > 0 ? (
      <Box flexShrink={0}>
        {faces(
          kit,
          row.editors.map(id => agentOf(state, id)?.avatar ?? null),
          FACE,
          row.editors.map(id => nameOf(state, id)),
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

/** Open in browser: the web deck (`/deck web`) one press away, and how it stands once asked for. */
function webBlock(kit: Kit, web: WebPane, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Button key="dash:web" label="Open in browser" plain dimColor onPress={() => actions.openWeb()} />
      </Box>
      {webLine(kit, web)}
    </Box>
  )
}
