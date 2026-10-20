/**
 * The Plan tab, as the web deck's Plan page reads (web/app.js `PlanPage`,
 * `StepRow`, `StepAgent`, `SelfStep`), top to bottom:
 *
 * - the goal: its headline, its words (folded past five lines, Show more
 *   for the rest) and each follow-up typed since, with its age; a press on
 *   its head ("▾ GOAL") folds it to the head and its headline, as the view
 *   keeps (`DeckView.collapsed`);
 * - the progress card: "x/n done · n in progress · n failed", where the
 *   plan came from ("from the todo list", "inferred from the agents"), and
 *   the steps as one segmented bar (an Svg where it draws, cells elsewhere);
 * - the steps, a row each, the row one press that opens or folds it: its
 *   status glyph (✓ done, ◐ in progress, ○ pending, ✕ failed), its number,
 *   its words, "needs you" while one of its agents waits on you, the avatars
 *   of the agents on it and its status in a word;
 * - an open step: each agent on it, the ones it started under it (each
 *   once), a card each: avatar, name, type and pill; its now line and its
 *   checklist's progress; its last three tool calls; the files it touched;
 *   its result, folded to four lines; what it waits on you for (./needs);
 *   Open agent → and Talk →. A step the Orchestrator does itself shows its
 *   checklist item for it and, while it is in hand, what it just did.
 *
 * What is open lives in the deck's view (`DeckView.planOpen`, toggled by
 * `togglePlan`, a step opened from elsewhere by `openStep`), so a redraw or
 * a reload keeps it. A plan too big to draw whole is drawn leaner.
 *
 * Pure: Kit, the state, the view and DashActions come from the hooks module.
 */
import type { RenderElement } from 'claude-code'

import type { DeckStepStatus, DeckView } from '../../../types'
import { baseName, clean } from '../../format'
import { cutMarkdown, type WebAgent, type WebState } from '../../web'
import { fitsTree } from '../common'
import type { DashActions, Kit } from '../types'
import { FOLD, activityRows, agentOf, ago, cut, firstLine, flat, goalRest, isRunning, nameOf, nowLine, type ActivityRow } from './dashModel'
import { needsCards } from './needs'
import { P, STEP_HUE, mix, stepsSvg, toneOf } from './palette'
import { AVATAR, CARD_CHROME, avatar, foldHead, icon, pill, quiet, sectionFold, svgOf, tickTexts, type Fold } from './parts'

type Step = WebState['plan']['steps'][number]

/** A step's id in `DeckView.planOpen`. */
export function stepOpenId(key: string): string {
  return `step:${key}`
}

/** The key of a step's row in the drawing: what `openStep` scrolls to. */
export function stepRowKey(key: string): string {
  return `plan:step:${key}`
}

/** The goal's whole words' id in `DeckView.planOpen`. */
export const GOAL_OPEN = 'goal'

/** An agent's whole result's id in `DeckView.planOpen`. */
export function resultOpenId(agentId: string): string {
  return `result:${agentId}`
}

/** A step's key: the plan's own, or its place when it has none (the web's `stepKeyOf`). */
export function stepKeyOf(step: Step, i: number): string {
  return String(step.key || i + 1)
}

/** Where the plan came from, in the page's words. */
const SOURCE: Readonly<Record<string, string>> = {
  board: 'from the task board',
  todo: 'from the todo list',
  plan: 'from the plan',
  workflow: 'from the workflow',
  implicit: 'inferred from the agents',
  none: '',
}

/** A step's status in a word, its glyph, and their hues; its words' hue. */
const STEP_LABEL: Readonly<Record<DeckStepStatus, string>> = { done: 'Done', active: 'In progress', pending: 'Pending', failed: 'Failed' }
const GLYPH: Readonly<Record<DeckStepStatus, string>> = { done: '✓', active: '◐', pending: '○', failed: '✕' }
const GLYPH_HUE: Readonly<Record<DeckStepStatus, string>> = { done: P.doneText, active: P.runText, pending: mix(P.idle, P.card, 0.38), failed: P.failText }
const LABEL_HUE: Readonly<Record<DeckStepStatus, string>> = { done: P.doneText, active: P.runText, pending: P.muted2, failed: P.failText }
const TEXT_HUE: Readonly<Record<DeckStepStatus, string>> = { done: P.muted, active: P.text, pending: P.fg2, failed: '#fecaca' }

/** How a call stands, in its hue, as the Dashboard's activity draws it. */
const OUTCOME_HUE: Readonly<Record<ActivityRow['outcome']['tone'], string>> = { live: P.runText, wait: P.waitText, fail: P.failText, quiet: P.muted2 }

/** A row under the pointer, and the needs-you tag, flattened from the web's translucent tints. */
const HOVER = mix(P.card, '#ffffff', 0.035)
const WAIT_TAG = mix(P.card, P.wait, 0.12)
const NEEDS_TAG = ' needs you '

/** The cells a step's status word takes at its row's right ("In progress"), and its lead before its words ("▸ ✓ 01"). */
const STATUS_CELLS = 11
const LEAD_CELLS = 7
/** The avatars a step's row shows at most; past them "+n". */
const MOST_AVATARS = 4
/** An open step's body, under its glyph; each level of agents started by another, and the most levels indented. */
const BODY_INDENT = 2
const INDENT = 2
const LEVELS = 3
/** What an agent's card shows at most: its newest tool calls, the files it names. */
const MOST_CALLS = 3
const MOST_FILES = 5
/** A result folds past this many characters or lines; the goal's words past these. */
const RESULT_CHARS = 280
const RESULT_LINES = 4
const GOAL_CHARS = 420
const GOAL_LINES = 5
/** A call row's outcome and age, at its right. */
const OUTCOME = 8
const TIME = 4
/** A checklist's meter, in cells. */
const METER = 8
/** The steps a lean drawing keeps open: the ones opened last. */
const LEAN_STEPS = 3

/** What a drawing opens: the steps (by key), the results (by `planOpen` id), the goal's whole words; and a note when it was drawn leaner. */
type Shown = { steps: ReadonlySet<string>; results: ReadonlySet<string>; isGoalOpen: boolean; isLean: boolean; note: string }

/**
 * What to open at `level`: 0 all the view asks; 1 with every result and the
 * goal folded; 2 with the last LEAN_STEPS steps opened alone; 3 none.
 */
function shownAt(view: DeckView, level: number): Shown {
  const ids = view.planOpen
  const steps = ids.filter(id => id.startsWith('step:')).map(id => id.slice('step:'.length))
  return {
    steps: new Set(level >= 3 ? [] : level >= 2 ? steps.slice(-LEAN_STEPS) : steps),
    results: new Set(level >= 1 ? [] : ids.filter(id => id.startsWith('result:'))),
    isGoalOpen: level < 1 && ids.includes(GOAL_OPEN),
    isLean: level >= 1,
    note:
      level >= 3
        ? "Every step is folded so the pane can draw the plan: an agent's page shows all of its work."
        : level >= 2
          ? `Only the ${LEAN_STEPS} steps opened last stay open, to fit the pane: an agent's page shows all of its work.`
          : '',
  }
}

/** The tab: the goal, the progress card and the steps; drawn leaner while it would not fit the pane's bounds. */
export function planTab(kit: Kit, state: WebState, view: DeckView, actions: DashActions, now: number): RenderElement {
  const goal = sectionFold(view.collapsed, FOLD.planGoal, state.goal ? cut(state.goal.headline || firstLine(state.goal.text), 80) : '')
  let tree = drawPlan(kit, state, shownAt(view, 0), goal, actions, now)
  for (let level = 1; level <= 3 && !fitsTree(tree); level++) tree = drawPlan(kit, state, shownAt(view, level), goal, actions, now)
  return tree
}

function drawPlan(kit: Kit, state: WebState, shown: Shown, goal: Fold, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const steps = state.plan.steps
  return (
    <Box key="plan" flexDirection="column" gap={1}>
      {state.goal ? goalBlock(kit, state.goal, shown, goal, actions, now) : null}
      {steps.length === 0 ? emptyPlan(kit) : progressCard(kit, state)}
      {steps.length > 0 ? stepsCard(kit, state, shown, actions, now) : null}
      {shown.note ? quiet(kit, shown.note) : null}
    </Box>
  )
}

// The goal.

/** How many lines `text` takes at `room` cells: each of its own lines, wrapped. */
function linesOf(text: string, room: number): number {
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / Math.max(1, room))), 0)
}

/** Its head ("▾ GOAL", its age at the right; a press folds it to the head and its headline), its headline, its words after it (five lines, then Show more), each follow-up with its age. */
function goalBlock(kit: Kit, goal: NonNullable<WebState['goal']>, shown: Shown, fold: Fold, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const head = foldHead(kit, fold, 'Goal', null, actions, <Text color={P.muted2}>{ago(goal.at, now)}</Text>)
  if (!fold.isOpen) {
    return (
      <Box key="plan:goal" flexDirection="column">
        {head}
      </Box>
    )
  }
  const rest = clean(goalRest(goal))
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const isLong = rest.length > GOAL_CHARS || linesOf(rest, kit.columns) > GOAL_LINES
  const isFolded = isLong && !shown.isGoalOpen
  const words = (
    <Text color={P.muted} wrap="wrap">
      {rest}
    </Text>
  )
  return (
    <Box key="plan:goal" flexDirection="column">
      {head}
      <Text bold color={P.text} wrap="wrap">
        {goal.headline || firstLine(goal.text)}
      </Text>
      {rest ? (
        isFolded ? (
          <Box height={GOAL_LINES} overflow="hidden" flexDirection="column">
            {words}
          </Box>
        ) : (
          words
        )
      ) : null}
      {isLong && !shown.isLean ? (
        <Box flexDirection="row">
          <Button key="plan:goal:more" label={isFolded ? 'Show more' : 'Show less'} plain dimColor onPress={() => actions.togglePlan(GOAL_OPEN)} />
        </Box>
      ) : null}
      {goal.followUps.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {goal.followUps.map(one => (
            <Box flexDirection="row" columnGap={1}>
              <Box flexShrink={0}>{icon(kit, 'cornerDownRight', P.muted2, 14) ?? <Text color={P.muted2}>↳</Text>}</Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={P.fg2} wrap="wrap">
                  {flat(one.text)}
                </Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={P.muted2}>{ago(one.at, now)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

// The progress card.

/** No steps yet: what will show here. */
function emptyPlan(kit: Kit): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key="plan:empty" flexDirection="row" columnGap={1} borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexShrink={0}>{icon(kit, 'listChecks', P.muted) ?? <Text color={P.muted}>☰</Text>}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold color={P.text}>
          No plan yet
        </Text>
        <Text color={P.muted} wrap="wrap">
          When the Orchestrator writes a todo list or a plan, its steps show here with who works on each.
        </Text>
      </Box>
    </Box>
  )
}

/** "x/n done · n in progress · n failed", where the plan came from, and its bar. */
function progressCard(kit: Kit, state: WebState): RenderElement {
  const { Box, Text } = kit
  const steps = state.plan.steps
  const count = (status: DeckStepStatus) => steps.filter(step => step.status === status).length
  const failed = count('failed')
  const source = SOURCE[state.plan.source] ?? ''
  return (
    <Box key="plan:progress" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text wrap="truncate-end">
          <Text bold color={P.text}>{`${count('done')}/${steps.length} done`}</Text>
          <Text color={P.muted3}> · </Text>
          <Text color={P.muted}>{`${count('active')} in progress`}</Text>
          <Text color={P.muted3}> · </Text>
          <Text color={failed > 0 ? P.failText : P.muted}>{`${failed} failed`}</Text>
        </Text>
        {source ? (
          <Box flexShrink={0}>
            <Text color={P.muted} backgroundColor={P.chip}>{` ${source} `}</Text>
          </Box>
        ) : null}
      </Box>
      {stepsBar(kit, steps.map(step => step.status), Math.max(16, kit.columns - CARD_CHROME))}
    </Box>
  )
}

/** The plan's bar, as the Dashboard's goal card draws it: a rounded segment a step where Svg draws (the slot's width), else a run of cells a step in its colour. */
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

// The steps.

/** Who started whom, and what waits on you by agent: what the step rows look up. */
type Index = { kids: ReadonlyMap<string, readonly WebAgent[]>; pending: ReadonlyMap<string, number> }

function indexOf(state: WebState): Index {
  const ids = new Set(state.agents.map(agent => agent.id))
  const kids = new Map<string, WebAgent[]>()
  for (const agent of state.agents) {
    const parent = agent.parent && agent.parent !== agent.id && ids.has(agent.parent) ? agent.parent : null
    if (parent !== null) kids.set(parent, [...(kids.get(parent) ?? []), agent])
  }
  const order = (x: WebAgent, y: WebAgent) => Number(y.kind === 'orchestrator') - Number(x.kind === 'orchestrator') || x.startedAt - y.startedAt || (x.id < y.id ? -1 : 1)
  for (const list of kids.values()) list.sort(order)
  const pending = new Map<string, number>()
  for (const item of state.pending) pending.set(item.agentId, (pending.get(item.agentId) ?? 0) + 1)
  return { kids, pending }
}

/** The agents on a step, each followed by the ones it started (deeper each level), each once; the Orchestrator's own helpers are other steps'. */
function stepAgents(state: WebState, index: Index, step: Step): { agent: WebAgent; depth: number }[] {
  const rows: { agent: WebAgent; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (agent: WebAgent | undefined, depth: number) => {
    if (!agent || seen.has(agent.id)) return
    seen.add(agent.id)
    rows.push({ agent, depth })
    if (agent.kind !== 'orchestrator') for (const kid of index.kids.get(agent.id) ?? []) walk(kid, depth + 1)
  }
  for (const id of step.agents) walk(agentOf(state, id), 0)
  return rows
}

/** The steps in one card, a row each; an open one's body under it. */
function stepsCard(kit: Kit, state: WebState, shown: Shown, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const index = indexOf(state)
  const inner: Kit = { ...kit, columns: Math.max(24, kit.columns - CARD_CHROME) }
  const steps = state.plan.steps
  // the Orchestrator's question shows on the first step in hand it does itself, once
  const selfAt = steps.findIndex(step => step.status === 'active' && step.agents.length === 0)
  return (
    <Box key="plan:steps" flexDirection="column" borderStyle="round" borderColor={P.border} paddingX={1}>
      {steps.map((step, i) => stepItem(inner, state, index, step, i, { isSelfFirst: i === selfAt, isLast: i === steps.length - 1 }, shown, actions, now))}
    </Box>
  )
}

/** A status the state names, or pending for one it does not. */
function statusOf(step: Step): DeckStepStatus {
  return step.status in STEP_LABEL ? step.status : 'pending'
}

/** Where a step stands among the others: the first in hand the Orchestrator does itself (its question shows there), the last (no room after its body). */
type Place = { isSelfFirst: boolean; isLast: boolean }

/** A step's row, one press that opens or folds it; its body under it while open. */
function stepItem(kit: Kit, state: WebState, index: Index, step: Step, i: number, place: Place, shown: Shown, actions: DashActions, now: number): RenderElement {
  const { Box, Text, Button } = kit
  const key = stepKeyOf(step, i)
  const isOpen = shown.steps.has(key)
  const status = statusOf(step)
  const rows = stepAgents(state, index, step)
  const waits = rows.some(row => (index.pending.get(row.agent.id) ?? 0) > 0) || (rows.length === 0 && status === 'active' && (index.pending.get('main') ?? 0) > 0)
  const shownIds = step.agents.slice(0, MOST_AVATARS)
  const more = step.agents.length - shownIds.length
  const avatarCells = shownIds.length === 0 ? 1 : shownIds.length * (kit.surface === 'terminal' ? 1 : 2) + (more > 0 ? String(more).length + 2 : 0)
  const room = Math.max(8, kit.columns - LEAD_CELLS - 1 - (waits ? NEEDS_TAG.length + 1 : 0) - avatarCells - 1 - STATUS_CELLS)
  const text = flat(step.text)
  return (
    <Box key={stepRowKey(key)} flexDirection="column">
      <Box key={`plan:row:${key}`} flexDirection="row" columnGap={1} alignItems="center" hover={{ backgroundColor: HOVER }}>
        <Box flexGrow={1} flexShrink={1}>
          <Button key={`plan:toggle:${key}`} plain onPress={() => actions.togglePlan(stepOpenId(key))}>
            <Text color={P.muted2}>{isOpen ? '▾ ' : '▸ '}</Text>
            <Text color={GLYPH_HUE[status]}>{GLYPH[status]}</Text>
            <Text color={P.muted2}>{` ${String(i + 1).padStart(2, '0')} `}</Text>
            <Text color={TEXT_HUE[status]} bold={status === 'active'}>
              {cut(text, room)}
            </Text>
          </Button>
        </Box>
        {waits ? (
          <Box flexShrink={0}>
            <Text color={P.waitText} backgroundColor={WAIT_TAG}>
              {NEEDS_TAG}
            </Text>
          </Box>
        ) : null}
        <Box flexShrink={0} flexDirection="row" alignItems="center">
          {avatarStack(kit, state, step.agents)}
        </Box>
        <Box flexShrink={0} width={STATUS_CELLS} justifyContent="flex-end">
          <Text color={LABEL_HUE[status]}>{STEP_LABEL[status]}</Text>
        </Box>
      </Box>
      {isOpen ? stepBody(kit, state, step, key, rows, Array.from(text).length > room ? text : '', place, shown, actions, now) : null}
    </Box>
  )
}

/** The avatars of the agents on a step, at most four then "+n"; a dash for none. */
function avatarStack(kit: Kit, state: WebState, ids: readonly string[]): RenderElement[] {
  const { Text } = kit
  if (ids.length === 0) return [<Text color={P.muted3}>—</Text>]
  const shown = ids.slice(0, MOST_AVATARS)
  const more = ids.length - shown.length
  return [
    ...shown.map(id => {
      const agent = agentOf(state, id)
      return avatar(kit, agent ? agent.avatar : null, AVATAR.row, agent ? agent.label : id)
    }),
    ...(more > 0 ? [<Text color={P.muted2}>{` +${more}`}</Text>] : []),
  ]
}

/** An open step: its words whole when the row cut them, then a card for each agent on it, or the Orchestrator's own. */
function stepBody(
  kit: Kit,
  state: WebState,
  step: Step,
  key: string,
  rows: readonly { agent: WebAgent; depth: number }[],
  whole: string,
  place: Place,
  shown: Shown,
  actions: DashActions,
  now: number,
): RenderElement {
  const { Box, Text } = kit
  const inner: Kit = { ...kit, columns: Math.max(20, kit.columns - BODY_INDENT) }
  const cards =
    rows.length > 0
      ? rows.map(row => agentCard(inner, state, row.agent, row.depth, key, shown, actions, now))
      : step.agents.length > 0
        ? [quiet(inner, 'The agents on this step are no longer in the session.')]
        : [selfCard(inner, state, step, key, place.isSelfFirst, actions, now)]
  return (
    <Box key={`plan:body:${key}`} flexDirection="column" gap={1} paddingLeft={BODY_INDENT} marginBottom={place.isLast ? 0 : 1}>
      {whole ? (
        <Text color={TEXT_HUE[statusOf(step)]} wrap="wrap">
          {whole}
        </Text>
      ) : null}
      {cards}
    </Box>
  )
}

// An agent on an open step.

/** One agent on an open step: who, its line and checklist, its last calls, its files, its result, what waits on you, and the ways to its page. */
function agentCard(kit: Kit, state: WebState, agent: WebAgent, depth: number, stepKey: string, shown: Shown, actions: DashActions, now: number): RenderElement {
  const { Box } = kit
  const indent = Math.min(depth, LEVELS) * INDENT
  const tone = toneOf(agent.status)
  const inner: Kit = { ...kit, columns: Math.max(16, kit.columns - indent - CARD_CHROME) }
  const boss = depth > 0 && agent.parent ? nameOf(state, agent.parent) : ''
  const type = [agent.type || agent.kind, boss ? `started by ${boss}` : ''].filter(Boolean).join(' · ')
  return (
    <Box key={`plan:agent:${stepKey}:${agent.id}`} flexDirection="column" marginLeft={indent} borderStyle="round" borderColor={tone.edge} hover={{ borderColor: tone.hot }} paddingX={1}>
      {cardHead(inner, agent, type, stepKey, actions)}
      {nowRow(inner, agent)}
      {callRows(inner, state, agent.id, now)}
      {filesLine(inner, agent)}
      {resultBlock(inner, agent, stepKey, shown, actions)}
      {needsCards(inner, state, actions, now, 'agent', agent.id)}
      {links(inner, agent.id, stepKey, actions)}
    </Box>
  )
}

/** Its avatar (its status dot at the foot), its name (a press opens its page), its type, its pill. */
function cardHead(kit: Kit, agent: WebAgent, type: string, stepKey: string, actions: DashActions): RenderElement {
  const { Box, Text, Button } = kit
  return (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexShrink={0}>{avatar(kit, agent.avatar, AVATAR.card, agent.label, toneOf(agent.status).hue)}</Box>
      <Box flexShrink={0}>
        <Button key={`plan:name:${stepKey}:${agent.id}`} label={cut(agent.label, 24)} plain onPress={() => actions.openAgent(agent.id)} />
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={P.muted2} wrap="truncate-end">
          {type}
        </Text>
      </Box>
      <Box flexShrink={0}>{pill(kit, agent.status)}</Box>
    </Box>
  )
}

/** Its now line (a dot while a call runs), two lines kept; its checklist's meter and count at the right. */
function nowRow(kit: Kit, agent: WebAgent): RenderElement {
  const { Box, Text } = kit
  const list = agent.checklist
  const isLive = isRunning(agent.status) && agent.lastAction?.isLive === true
  const said = nowLine(agent) || toneOf(agent.status).word
  const room = Math.max(8, kit.columns - (list.total > 0 ? METER + 7 : 0) - (isLive ? 2 : 0))
  return (
    <Box flexDirection="row" columnGap={1}>
      {isLive ? (
        <Box flexShrink={0}>
          <Text color={P.run}>●</Text>
        </Box>
      ) : null}
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">{tickTexts(kit, cut(said, room * 2), P.fg2)}</Text>
      </Box>
      {list.total > 0 ? <Box flexShrink={0}>{meter(kit, list.done, list.total)}</Box> : null}
    </Box>
  )
}

/** A checklist's progress: a bar of cells (green once all are done) and "done/total". */
function meter(kit: Kit, done: number, total: number): RenderElement {
  const { Text } = kit
  const filled = Math.max(0, Math.min(METER, Math.round((done / Math.max(1, total)) * METER)))
  return (
    <Text>
      <Text color={done >= total ? P.done : P.run}>{'━'.repeat(filled)}</Text>
      <Text color={P.track}>{'━'.repeat(METER - filled)}</Text>
      <Text color={P.muted}>{` ${done}/${total}`}</Text>
    </Text>
  )
}

/** Its newest three tool calls, newest first, as the Dashboard words them: the verb and its target, how it went, when. */
function callRows(kit: Kit, state: WebState, agentId: string, now: number): RenderElement | null {
  const { Box, Text } = kit
  const rows = activityRows({ ...state, activity: state.activity.filter(one => one.agent === agentId) }, MOST_CALLS)
  if (rows.length === 0) return null
  const room = Math.max(8, kit.columns - OUTCOME - TIME - 2)
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Box flexDirection="row" columnGap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={P.muted}>{row.verb}</Text>
              {row.target ? <Text color={P.fg2}>{` ${cut(row.target, Math.max(4, room - Array.from(row.verb).length - 1))}`}</Text> : null}
            </Text>
          </Box>
          <Box flexShrink={0} width={OUTCOME} justifyContent="flex-end">
            <Text color={OUTCOME_HUE[row.outcome.tone]}>{row.outcome.text}</Text>
          </Box>
          <Box flexShrink={0} width={TIME} justifyContent="flex-end">
            <Text color={P.muted2}>{ago(row.at, now)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** The files it touched, by name on a chip each, five at most then "+n more". */
function filesLine(kit: Kit, agent: WebAgent): RenderElement | null {
  const { Text } = kit
  const files = agent.files.slice(0, MOST_FILES)
  if (files.length === 0) return null
  const more = agent.files.length - files.length
  const chips = files.flatMap((path, i) => [
    ...(i > 0 ? [<Text> </Text>] : []),
    <Text color={P.fg2} backgroundColor={P.chip}>{` ${cut(baseName(path) || path, 32)} `}</Text>,
  ])
  return (
    <Text wrap="wrap">
      <Text color={P.muted2}>Files </Text>
      {chips}
      {more > 0 ? <Text color={P.muted2}>{` +${more} more`}</Text> : null}
    </Text>
  )
}

/** A Markdown code fence: three backticks. */
const FENCE = '`'.repeat(3)

/** A long text's first lines, as its folded card shows it: RESULT_LINES lines at most, RESULT_CHARS characters, a fence it opened closed. */
function foldOf(text: string): string {
  let shown = cutMarkdown(text.split('\n').slice(0, RESULT_LINES).join('\n').trimEnd(), RESULT_CHARS)
  if (shown !== text && !shown.endsWith('…')) shown = `${shown} …`
  const fences = shown.split('\n').filter(line => line.trimStart().startsWith(FENCE)).length
  return fences % 2 === 1 ? `${shown}\n${FENCE}` : shown
}

/** Its result once it has one, as Markdown: four lines, then Show more for the rest; a failed one's head says so. */
function resultBlock(kit: Kit, agent: WebAgent, stepKey: string, shown: Shown, actions: DashActions): RenderElement | null {
  const { Box, Text, Button, Markdown } = kit
  const text = clean(String(agent.result || '')).trim()
  if (!text) return null
  const id = resultOpenId(agent.id)
  const isLong = text.length > RESULT_CHARS || text.split('\n').length > RESULT_LINES
  const isOpen = shown.results.has(id)
  const isFailed = agent.status === 'failed'
  return (
    <Box flexDirection="column">
      <Text bold color={isFailed ? P.failText : P.muted2}>
        {isFailed ? 'RESULT · FAILED' : 'RESULT'}
      </Text>
      <Markdown text={isLong && !isOpen ? foldOf(text) : text} />
      {isLong && !shown.isLean ? (
        <Box flexDirection="row">
          <Button key={`plan:more:${stepKey}:${agent.id}`} label={isOpen ? 'Show less' : 'Show more'} plain dimColor onPress={() => actions.togglePlan(id)} />
        </Box>
      ) : null}
    </Box>
  )
}

/** Open agent → (its page) and Talk → (its page on Talk). */
function links(kit: Kit, agentId: string, stepKey: string, actions: DashActions): RenderElement {
  const { Box, Button } = kit
  return (
    <Box flexDirection="row" columnGap={3}>
      <Button key={`plan:open:${stepKey}:${agentId}`} label="Open agent →" plain dimColor onPress={() => actions.openAgent(agentId)} />
      <Button key={`plan:talk:${stepKey}:${agentId}`} label="Talk →" plain dimColor onPress={() => actions.openAgent(agentId, 'chat')} />
    </Box>
  )
}

// A step the Orchestrator does itself.

/** A checklist item's mark: ✓ done, ◐ in hand (amber while the Orchestrator waits on you, red once it failed), ○ not started, ✕ a failed step. */
function itemMark(kit: Kit, status: string, agentStatus: string): RenderElement {
  const { Text } = kit
  if (status === 'done') return <Text color={P.doneText}>✓</Text>
  if (status === 'failed') return <Text color={P.failText}>✕</Text>
  if (status === 'active') return <Text color={agentStatus === 'waiting' ? P.waitText : agentStatus === 'failed' ? P.failText : P.runText}>◐</Text>
  return <Text color={GLYPH_HUE.pending}>○</Text>
}

/**
 * The Orchestrator on a step no agent was given: its checklist item for it
 * (its words in hand beside it), then while the step is in hand its last
 * calls and what it waits on you for (on the first such step alone, so a
 * question shows once); "Not started yet." before it starts.
 */
function selfCard(kit: Kit, state: WebState, step: Step, stepKey: string, isSelfFirst: boolean, actions: DashActions, now: number): RenderElement {
  const { Box, Text } = kit
  const main = agentOf(state, 'main') ?? state.agents.find(agent => agent.kind === 'orchestrator')
  if (!main) return quiet(kit, 'No agent is on this step.')
  const norm = (text: string) => flat(text).toLowerCase()
  const item = main.checklist.items.find(one => norm(one.text) === norm(step.text))
  const status = statusOf(step)
  const isActive = status === 'active'
  const type = status === 'pending' ? 'takes this step itself' : status === 'done' ? 'did this step itself' : 'does this step itself'
  const tone = toneOf(main.status)
  const inner: Kit = { ...kit, columns: Math.max(16, kit.columns - CARD_CHROME) }
  return (
    <Box key={`plan:agent:${stepKey}:${main.id}`} flexDirection="column" borderStyle="round" borderColor={tone.edge} hover={{ borderColor: tone.hot }} paddingX={1}>
      {cardHead(inner, main, type, stepKey, actions)}
      <Box flexDirection="row" columnGap={1}>
        <Box flexShrink={0}>{itemMark(kit, item ? item.status : status, main.status)}</Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="wrap">
            <Text color={P.fg2}>{flat(item ? item.text : step.text)}</Text>
            {item && item.status === 'active' && item.doing ? <Text color={P.muted}>{`  ${flat(item.doing)}`}</Text> : null}
          </Text>
        </Box>
      </Box>
      {isActive ? callRows(inner, state, main.id, now) : status === 'pending' ? quiet(inner, 'Not started yet.') : null}
      {isActive && isSelfFirst ? needsCards(inner, state, actions, now, 'agent', main.id) : null}
      {links(inner, main.id, stepKey, actions)}
    </Box>
  )
}
