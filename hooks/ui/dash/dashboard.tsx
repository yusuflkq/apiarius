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
 * - recent activity: the newest eight calls, a press opening the agent on
 *   its Activity;
 * - files: the eight edited last, as the web's FILES panel: the path (its
 *   folder dim, its name bright), a live dot, "shared" where two agents
 *   edit it, the editors' faces, +a −r; a press opens the file in Changes
 *   where Changes lists it, else the Diffs of the agent that edited it last
 *   (always so in the sample, which has no Changes of its own);
 * - Open in browser, the web deck one press away (not in the sample).
 *
 * A desktop draws a plain Button's label alone, in its own ink, so the
 * colours and weights the web gives a card's words sit on Text and images
 * beside the pressable words, not in them, and a line the web draws dim is a
 * dim Button there; its gaps are half lines, so a card breathes as the web's
 * does, where the terminal keeps its lines close. Every time is coarse
 * ("4m"), so a redraw a minute is the most time alone asks.
 *
 * Pure: Kit, the state and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { WebAgent, WebState } from '../../web'
import { webLine } from '../slim'
import type { DashActions, Kit, WebPane } from '../types'
import {
  activityRows,
  agentOf,
  ago,
  cardLine,
  cardsPerRow,
  cellsOf,
  chipOf,
  cut,
  cutCells,
  dashAgents,
  fileRows,
  firstLine,
  fitPath,
  flat,
  goalRest,
  kpisOf,
  modelLine,
  nameOf,
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
import { P, STEP_HUE, TONE, mix, stepsSvg, toneOf, type IconName } from './palette'
import {
  AVATAR,
  CARD_CHROME,
  OPEN_LABEL,
  advanceOf,
  avatar,
  buttonSlack,
  cellsForPx,
  chromeOf,
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
  sectionHead,
  statusPill,
  svgOf,
  tickParts,
  tickTexts,
  widthFor,
  wrapAdvanceOf,
} from './parts'

/** From this many cells the KPI boxes go four a row; two below. */
export const WIDE = 60

/**
 * Whether `kit` lays its gaps out in half lines (a desktop: a gap of one is
 * half a line, about the web's 10 to 12 px), so cards and lists may breathe
 * without a blank line between their parts; the terminal's gaps are whole
 * lines, so there they stay close.
 */
function isAiry(kit: Kit): boolean {
  return kit.surface !== 'terminal'
}

/** The tab: what needs you, the goal, the agents, the figures, the activity and the files; and the web deck's button. */
export function dashboardTab(kit: Kit, state: WebState, actions: DashActions, now: number, web: WebPane | null): RenderElement {
  const { Box } = kit
  return (
    <Box flexDirection="column" gap={1}>
      {needsCards(kit, state, actions, now, 'dash')}
      {needsBanner(kit, state, actions)}
      {goalCard(kit, state, now, actions)}
      {agentsSection(kit, state, actions, now)}
      {kpiStrip(kit, state)}
      {activitySection(kit, state, actions, now)}
      {filesSection(kit, state, actions, web !== null)}
      {web ? webBlock(kit, web, actions) : null}
    </Box>
  )
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
 * The agents: their count and the way to the org chart, then their cards in
 * rows of as many as fit (`cardsPerRow`), every card in a row as wide, and as
 * tall: each body padded to the row's longest, one line or two.
 */
function agentsSection(kit: Kit, state: WebState, actions: DashActions, now: number): RenderElement {
  const { Box, Button } = kit
  const { shown, hidden } = dashAgents(state)
  const perRow = cardsPerRow(kit.columns)
  const width = widthFor(kit.columns, perRow)
  const link = <Button key="dash:org" label={hidden > 0 ? `${hidden} more in the org chart →` : 'Org chart →'} plain dimColor onPress={() => actions.setTab('org')} />
  const cards = shown.map(agent => cardOf(kit, state, agent, width))
  const rows: CardModel[][] = []
  for (let i = 0; i < cards.length; i += perRow) rows.push(cards.slice(i, i + perRow))
  return (
    <Box key="dash:agents" flexDirection="column">
      {sectionHead(kit, 'Agents', state.agents.length, link)}
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

/** How a call stands, in its hue: running blue, waiting amber, failed red, the rest dim. */
const OUTCOME_HUE: Readonly<Record<ActivityRow['outcome']['tone'], string>> = { live: P.runText, wait: P.waitText, fail: P.failText, quiet: P.muted2 }

/** The cells an activity row's outcome and time take at its right. */
const OUTCOME = 8
const TIME = 4

/** Recent activity: the newest eight calls of every agent, newest first. */
function activitySection(kit: Kit, state: WebState, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const rows = activityRows(state, 8)
  return (
    <Box flexDirection="column">
      {sectionHead(kit, 'Recent activity', null)}
      {rows.length === 0 ? (
        quiet(kit, "No tool calls yet: every agent's tool calls show here as they happen.")
      ) : (
        <Box flexDirection="column">{rows.map(row => activityRow(kit, state, row, actions, now))}</Box>
      )}
    </Box>
  )
}

/** One call: the agent's avatar, then its name, the verb and the target as one press that opens the agent; how it went and when at the right. */
function activityRow(kit: Kit, state: WebState, row: ActivityRow, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const room = Math.max(16, kit.columns - 3 - OUTCOME - TIME - 3)
  const name = cut(row.name, 18)
  const verb = row.verb
  const targetRoom = Math.max(8, room - Array.from(name).length - Array.from(verb).length - 2)
  const words = [
    <Text bold color={P.text}>
      {name}
    </Text>,
    <Text color={P.muted}>{` ${verb}`}</Text>,
    ...(row.target ? [<Text color={P.fg2}>{` ${cut(row.target, targetRoom)}`}</Text>] : []),
  ]
  return (
    <Box key={`act:${row.key}`} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, row.avatar, AVATAR.row, row.name)}</Box>
      <Box flexGrow={1} flexShrink={1}>
        <Button key={`dash:act:${row.key}`} plain onPress={() => openAgentPage(actions, state, row.agent, 'activity')}>
          {words}
        </Button>
      </Box>
      <Box flexShrink={0} width={OUTCOME} justifyContent="flex-end">
        <Text color={OUTCOME_HUE[row.outcome.tone]}>{row.outcome.text}</Text>
      </Box>
      <Box flexShrink={0} width={TIME} justifyContent="flex-end">
        <Text color={P.muted2}>{ago(row.at, now)}</Text>
      </Box>
    </Box>
  )
}

/** The files the panel shows at most. */
const MOST_FILES = 8
/** The tag on a file more than one agent edited, as the web's amber "shared". */
const SHARED = ' shared '
/** The editors' faces a file row shows at most, and each face's size in px. */
const MOST_FACES = 3
const FACE = 16

/**
 * Files: the eight agents edited last, as the web's FILES panel, "Changes →"
 * beside the head where this session's Changes tab can show them (`hasChanges`:
 * not in the sample). Each row is a press on its path and on its +a −r.
 */
function filesSection(kit: Kit, state: WebState, actions: DashActions, hasChanges: boolean): RenderElement {
  const { Box, Button } = kit
  const rows = fileRows(state, MOST_FILES)
  const link = hasChanges && rows.length > 0 ? <Button key="dash:changes" label="Changes →" plain dimColor onPress={() => actions.setTab('changes')} /> : null
  return (
    <Box key="dash:files" flexDirection="column">
      {sectionHead(kit, 'Files', state.files.length > 0 ? state.files.length : null, link)}
      {rows.length === 0 ? (
        quiet(kit, 'No files touched yet: the files agents edit show here, with who is on each.')
      ) : (
        <Box flexDirection="column">{rows.map(row => fileRow(kit, state, row, actions, hasChanges))}</Box>
      )}
    </Box>
  )
}

/**
 * One file: its icon, its path (the folder dim, the name bright), a live dot
 * while an agent is on it, "shared" when more than one edited it, the
 * editors' faces, +a −r. A press on the path or the counts opens the file in
 * the Changes tab where Changes lists it (its own diff open there), else
 * the Diffs of the agent that edited it last.
 */
function fileRow(kit: Kit, state: WebState, row: FileRow, actions: DashActions, hasChanges: boolean): RenderElement {
  const { Box, Text, Button } = kit
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
  const slack = buttonSlack(kit)
  const faces = row.editors.slice(0, MOST_FACES)
  const more = row.editors.length - faces.length
  const stat = `+${row.added} −${row.removed}`
  // the path's room: the row less the icon, the dot, the tag, the faces, the counts, their gaps and the buttons' chrome
  const taken = 3 + (row.live ? 2 : 0) + (row.isShared ? SHARED.length + 1 : 0) + faces.length * 2 + (more > 0 ? String(more).length + 2 : 0) + 1 + stat.length + slack + 1 + slack
  const path = fitPath(row.dir, row.name, Math.max(8, kit.columns - taken))
  const pathParts = [
    ...(path.dir ? [<Text color={P.muted2}>{path.dir}</Text>] : []),
    <Text color={P.fg2}>{path.name}</Text>,
  ]
  return (
    <Box key={`files:${row.path}`} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{icon(kit, 'file', P.muted2, 14) ?? <Text color={P.muted3}>·</Text>}</Box>
      <Box flexGrow={1} flexShrink={1}>
        <Button key={`dash:file:${row.path}`} plain onPress={open}>
          {pathParts}
        </Button>
      </Box>
      {row.live ? (
        <Box flexShrink={0}>
          <Text color={P.run}>●</Text>
        </Box>
      ) : null}
      {row.isShared ? (
        <Box flexShrink={0}>
          <Text color={TONE.waiting.pillFg} backgroundColor={TONE.waiting.pillBg}>
            {SHARED}
          </Text>
        </Box>
      ) : null}
      <Box flexShrink={0} flexDirection="row">
        {faces.map(id => {
          const agent = agentOf(state, id)
          return avatar(kit, agent ? agent.avatar : null, FACE, nameOf(state, id))
        })}
        {more > 0 ? <Text color={P.muted2}>{` +${more}`}</Text> : null}
      </Box>
      <Box flexShrink={0}>
        <Button key={`dash:filestat:${row.path}`} plain onPress={open}>
          <Text color={P.doneText}>{`+${row.added}`}</Text>
          <Text> </Text>
          <Text color={P.failText}>{`−${row.removed}`}</Text>
        </Button>
      </Box>
    </Box>
  )
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
