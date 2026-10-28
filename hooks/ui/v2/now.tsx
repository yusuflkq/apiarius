/**
 * Now, the deck's first screen: the dashboard, on the v2 state's own data,
 * top to bottom as the web deck's page lays it out:
 *
 * - Needs you (./needs): only when Claude Code holds something on you.
 * - Agents (./dash): a card each, in rows of as many as fit, every line of a
 *   card a press that opens the agent's page; the finished ones behind one
 *   "3 finished ▸" row, with Clear finished beside it.
 * - Figures (./dash): agents running, the plan's steps where Claude made a
 *   plan, the session's spend, what waits on you.
 * - Plan: only where Claude made one, every source it used, each as Claude
 *   made it: its task board, its TodoWrite list, the approved plan as
 *   written (Markdown, folded to its first line until opened) and each
 *   Workflow's phases (no status).
 * - Recent activity and Files (./dash), side by side from 120 cells.
 *
 * Every section but Needs you sits under a head that folds it ("▾ AGENTS 8",
 * ./parts `foldHead`), what is folded kept in the deck's view
 * (`DeckView.collapsed`), so redraws, live updates and reloads keep it.
 *
 * On the terminal Now keeps inside the rows it may take (`Kit.rows`): past
 * them, the sections fold to their heads from the bottom up (Files, Recent
 * activity, the plan, the figures), then the agents' cards are cut to the
 * rows left, "N more in the org chart" saying how many. A press on a head
 * folded so opens that section, the others folding to make room for it.
 *
 * Pure: Kit, the state and DashActions come from the hooks module; the
 * approved plan's fold is this module's own.
 */
import type { RenderElement } from 'claude-code'

import { clean } from '../../format'
import { FINISHED_FOLD } from '../../model'
import { agentKeyOf, needKeyOf, type V2Plan, type V2Todo, type WebStateV2 } from '../../web'
import type { DashActions, Kit } from '../types'
import { BG_FOLD, backgroundFoldOf, backgroundSection } from './background'
import { agentsSection, figuresSection, isAiry, listsOf } from './dash'
import { FOLD, activityFoldOf, agentsFoldOf, cardAgentsOf, figuresFoldOf, filesFoldOf, planFoldOf } from './dashModel'
import { rowsOf } from './fit'
import { glyph, quiet } from './look'
import { MOST_NEED_CARDS, needsSection } from './needs'
import { P } from './palette'
import { foldHead, sectionFold, type Fold } from './parts'
import { ago, flat } from './text'

/** The approved plans opened (by when each was approved), while the module lives. */
const plansOpen = new Set<number>()

/** On a terminal short of rows: the section whose folded head was pressed last, which gets the room first; '' for none. */
const fit = { first: '' }

/** An element's key, as a drawing holds it. */
function keyOf(el: RenderElement): string {
  const node = el as unknown as { key?: unknown; props?: { key?: unknown } }
  return String(node.key ?? node.props?.key ?? '')
}

/**
 * Now: Needs you, the agents' cards, the figures, the plan, then Recent
 * activity and Files; each section but Needs you folded where `collapsed`
 * (the view's `DeckView.collapsed`) holds its FOLD id. `openOrg`, where
 * given, is the way to the org chart beside the agents' head; `openFolds`
 * (the view's `DeckView2.openFolds`) says whether the finished agents' row
 * is open.
 */
export function nowTab(kit: Kit, state: WebStateV2, collapsed: readonly string[], actions: DashActions, openOrg?: () => void, openFolds: readonly string[] = []): RenderElement {
  const { Box } = kit
  const gap = isAiry(kit) ? 2 : 1
  // the sections, those in `shut` folded to their heads to fit (a press on one makes room for it), the agents' cards cut to `agentRows`, `needCards` needs a card each and the rest a line
  const build = (shut: ReadonlySet<string>, agentRows?: number, needCards?: number, needLines?: number): RenderElement[] => {
    const fold = (id: string, summary: string) =>
      shut.has(id)
        ? {
            id,
            isOpen: false,
            summary,
            press: () => {
              fit.first = id
              actions.redraw()
            },
          }
        : sectionFold(collapsed, id, summary)
    const parts: { el: RenderElement | null; isShut: boolean }[] = [
      { el: needsSection(kit, state, state.needs, actions, 'now', needCards, needLines), isShut: false },
      { el: agentsSection(kit, state, actions, fold(FOLD.agents, agentsFoldOf(state)), openOrg, openFolds, agentRows), isShut: shut.has(FOLD.agents) },
      // what runs when no agent is talking (./background), only while something does or is scheduled
      { el: backgroundSection(kit, state, actions, fold(BG_FOLD, backgroundFoldOf(state))), isShut: shut.has(BG_FOLD) },
      { el: figuresSection(kit, state, actions, fold(FOLD.figures, figuresFoldOf(state))), isShut: shut.has(FOLD.figures) },
      { el: state.plan ? planSection(kit, state.plan, state.now, actions, fold(FOLD.plan, planFoldOf(state))) : null, isShut: shut.has(FOLD.plan) },
      { el: listsOf(kit, state, actions, fold(FOLD.activity, activityFoldOf(state)), fold(FOLD.files, filesFoldOf(state))), isShut: shut.has(FOLD.activity) && shut.has(FOLD.files) },
    ]
    // the heads folded to fit stand together, no gap between them
    const out: RenderElement[] = []
    let run: RenderElement[] = []
    const flush = () => {
      if (run.length === 1) out.push(run[0] as RenderElement)
      else if (run.length > 1) {
        out.push(
          <Box key={`now:folded:${keyOf(run[0] as RenderElement)}`} flexDirection="column">
            {run}
          </Box>,
        )
      }
      run = []
    }
    for (const part of parts) {
      if (part.el === null) continue
      if (part.isShut) {
        run.push(part.el)
        continue
      }
      flush()
      out.push(part.el)
    }
    flush()
    return out
  }
  const tallOf = (parts: readonly RenderElement[]) => rowsOf(parts, kit.columns) + gap * Math.max(0, parts.length - 1)
  let parts = build(new Set())
  const room = kit.rows
  if (room !== undefined && tallOf(parts) > room) {
    // the one pressed last first, then the agents, the figures, the plan, Recent activity and Files; folded from the last up until it fits
    const order = [...new Set([fit.first, FOLD.agents, BG_FOLD, FOLD.figures, FOLD.plan, FOLD.activity, FOLD.files])].filter(id => id !== '' && !collapsed.includes(id) && (id !== BG_FOLD || (state.background?.rows.length ?? 0) > 0))
    const shut = new Set<string>()
    for (const id of order.slice(1).reverse()) {
      shut.add(id)
      parts = build(shut)
      if (tallOf(parts) <= room) break
    }
    // still past it: fewer needs drawn as cards, the rest a line each (a press opens the agent that asks)
    let cards: number | undefined
    for (let n = Math.min(state.needs.length, MOST_NEED_CARDS) - 1; tallOf(parts) > room && n >= 0; n--) {
      cards = n
      parts = build(shut, undefined, cards)
    }
    // and then the agents' cards cut to the rows the rest leaves them, and folded too where none is left
    if (tallOf(parts) > room && !shut.has(FOLD.agents) && !collapsed.includes(FOLD.agents)) {
      const agents = parts.find(one => keyOf(one) === 'now:agents') ?? null
      parts = build(shut, room - (tallOf(parts) - rowsOf(agents, kit.columns)), cards)
      if (tallOf(parts) > room) {
        shut.add(FOLD.agents)
        parts = build(shut, undefined, cards)
      }
    }
    // last, fewer needs a line each, the rest counted
    for (let n = state.needs.length - (cards ?? MOST_NEED_CARDS) - 1; tallOf(parts) > room && n >= 0; n--) parts = build(shut, undefined, cards, n)
  }
  return (
    <Box key="now" flexDirection="column" gap={gap}>
      {parts}
    </Box>
  )
}

/**
 * The rows `j` and `k` move the pane's focus among on Now, in the order it
 * draws them: each need (W.needKeyOf), then each agent card's name
 * (W.agentKeyOf) while the agents are open, the finished ones' while their
 * row is open.
 */
export function nowFocusKeys(state: WebStateV2, collapsed: readonly string[], openFolds: readonly string[] = []): string[] {
  const needs = state.needs.map(need => needKeyOf(need.id))
  if (collapsed.includes(FOLD.agents)) return needs
  const cards = cardAgentsOf(state, openFolds.includes(FINISHED_FOLD.now))
  return [...needs, ...[...cards.shown, ...cards.finished].map(row => agentKeyOf(row.id))]
}

/** A plan item's glyph name: Claude's own status. */
function glyphName(status: V2Todo['status']): string {
  return status === 'done' ? 'done' : status === 'active' ? 'active' : 'pending'
}

/** One plan item: its glyph, its words (in hand, its own words for what it is doing), and a dim note after them. */
function itemLine(kit: Kit, key: string, status: V2Todo['status'], text: string, note: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>{glyph(kit, glyphName(status))}</Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">
          <Text color={status === 'done' ? P.muted : P.fg2}>{clean(text)}</Text>
          {note ? <Text color={P.muted2}>{`  ${note}`}</Text> : null}
        </Text>
      </Box>
    </Box>
  )
}

/** A source's label inside Plan, dim. */
function sourceHead(kit: Kit, text: string, note = ''): RenderElement {
  const { Text } = kit
  return (
    <Text wrap="truncate-end">
      <Text color={P.muted}>{text}</Text>
      {note ? <Text color={P.muted2}>{`  ${note}`}</Text> : null}
    </Text>
  )
}

/** The plan under its head, "▾ PLAN": every source Claude used; folded, its head and its items done of all. */
function planSection(kit: Kit, plan: V2Plan, now: number, actions: DashActions, fold: Fold): RenderElement {
  const { Box, Text, Button, Markdown } = kit
  const head = foldHead(kit, fold, 'Plan', null, actions)
  if (!fold.isOpen) {
    return (
      <Box key="now:plan" flexDirection="column">
        {head}
      </Box>
    )
  }
  const parts: RenderElement[] = []
  if (plan.board.length > 0) {
    const done = plan.board.filter(task => task.status === 'done').length
    parts.push(
      <Box key="plan:board" flexDirection="column">
        {sourceHead(kit, 'Task board', `${done} of ${plan.board.length} done`)}
        {plan.board.map(task => itemLine(kit, `plan:task:${task.id}`, task.status, task.status === 'active' && task.doing ? task.doing : task.subject, task.owner ?? ''))}
      </Box>,
    )
  }
  if (plan.todos && plan.todos.items.length > 0) {
    const items = plan.todos.items
    const done = items.filter(item => item.status === 'done').length
    parts.push(
      <Box key="plan:todos" flexDirection="column">
        {sourceHead(kit, 'Orchestrator’s todos', `${done} of ${items.length} done`)}
        {items.map((item, i) => itemLine(kit, `plan:todo:${i}`, item.status, item.status === 'active' && item.doing ? item.doing : item.text, ''))}
      </Box>,
    )
  }
  if (plan.approved) {
    const approved = plan.approved
    const isOpen = plansOpen.has(approved.at)
    const first = flat(approved.markdown.split('\n').find(line => line.trim() !== '') ?? '').replace(/^#+\s*/, '')
    const label = `${isOpen ? '▾' : '▸'} Approved plan`
    const toggle = () => {
      if (isOpen) plansOpen.delete(approved.at)
      else plansOpen.add(approved.at)
      actions.redraw()
    }
    parts.push(
      <Box key="plan:approved" flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Box flexShrink={0}>
            <Button key="plan:approved" label={label} plain dimColor={kit.surface !== 'terminal'} onPress={toggle}>
              <Text color={P.muted}>{label}</Text>
            </Button>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color={P.muted2} wrap="truncate-end">
              {isOpen ? ago(approved.at, now) : `${first}  ${ago(approved.at, now)}`}
            </Text>
          </Box>
        </Box>
        {isOpen ? (
          <Box paddingLeft={2} flexDirection="column">
            <Markdown text={approved.markdown} />
          </Box>
        ) : null}
      </Box>,
    )
  }
  for (const flow of plan.workflows) {
    parts.push(
      <Box key={`plan:workflow:${flow.id}`} flexDirection="column">
        {sourceHead(kit, `Workflow ${flow.name}`, flow.endedAt === null ? 'running' : 'ended')}
        <Box paddingLeft={2}>
          <Text color={P.fg2} wrap="wrap">
            {flow.phases.length > 0 ? flow.phases.map(clean).join(' → ') : 'No phases named'}
          </Text>
        </Box>
      </Box>,
    )
  }
  return (
    <Box key="now:plan" flexDirection="column" gap={1}>
      {head}
      {parts.length > 0 ? parts : quiet(kit, 'Claude made no plan.')}
    </Box>
  )
}
