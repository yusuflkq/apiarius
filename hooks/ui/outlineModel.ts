/**
 * The Agents tab's header and outline, read off the deck's live data.
 *
 * The header: what needs you (one line), the goal and its minutes, and one
 * summary line that leads with the plan's step in hand. The outline you
 * click: the Orchestrator, its plan steps, the agents under the step each
 * serves (straight under the Orchestrator when there is no plan or no step
 * claims them), and sub-agents under the agent that spawned them. Workflow
 * and housekeeping loops fold into one "+N background" row, drawn only while
 * a workflow's agent works (or once the person opened it); a finished step's and a
 * finished agent's branch fold, and once a branch holds more than about
 * twelve agent rows each branch folds its finished agents into "+N done".
 * Zoom re-roots the outline on one branch, with breadcrumbs back up. Before
 * the first prompt there is nothing to outline, and the tab says so in one
 * line (`isUntouched`).
 *
 * `view.folded` holds the person's own choices, which win over those
 * defaults: a branch's id folds it, `+` and its id keeps it open. Nothing is
 * selected until the person picks a row (`view.agent` is '').
 *
 * "Waits on you" is said only of the one the engine waits on the person for
 * (the Orchestrator's needs-you note names it): an agent the engine lists as
 * waiting on its own background work is busy, not waiting on you.
 *
 * Pure: nothing here reads a clock but the `now` it is handed, and the texts
 * it makes change only when the data does (statuses, steps, coarse minutes),
 * so equal data gives equal rows. The data worker's queries are read in the
 * first section, the one place to adapt when their shapes move.
 */
import type { DeckAgent, DeckData, DeckShownStatus, DeckStepStatus, DeckView } from '../../types'
import * as F from '../format'
import type { GitState } from '../git'
import * as M from '../model'

// 1. The data worker's queries (model.ts), read here and nowhere else in the outline.

/**
 * The steps the outline nests agents under, in plan order. An implicit plan
 * (each Agent call its own step) only repeats the agents, so the outline
 * shows none: its agents sit straight under the Orchestrator.
 */
function planStepsOf(data: DeckData): readonly M.DeckPlanStep[] {
  const plan = M.planOf(data)
  return plan.source === 'implicit' || plan.source === 'none' ? [] : plan.steps
}

/**
 * The goal in hand as the header shows it, on one line; '' before the first
 * prompt. A goal whose headline is not its words' first line (a slash
 * command's) shows that headline.
 */
export function goalLineOf(data: DeckData): string {
  const goal = M.goalOf(data)
  if (!goal) return ''
  const text = F.oneLine(goal.text)
  const head = F.oneLine(goal.headline)
  return head === '' || text.startsWith(head.replace(/…$/, '')) ? text : head
}

/** done/total of the agent's checklist (its todos, else its board tasks); null with none. */
function checklistCountOf(agent: DeckAgent, data: DeckData): { done: number; total: number } | null {
  const list = M.checklistOf(agent, data)
  return list.total > 0 ? { done: list.done, total: list.total } : null
}

/**
 * What the agent is working through: its checklist's step; with no list, its
 * last call (kept once it ends, so it never blinks); before its first call,
 * what it was given.
 */
function stepTextOf(agent: DeckAgent): string {
  return F.oneLine(M.stepOf(agent) || M.lastActionOf(agent)?.text || M.scopeOf(agent) || agent.description)
}

function labelTextOf(agent: DeckAgent): string {
  return M.labelOf(agent)
}

/** A workflow's agent or the engine's own loop: folded into the background row. */
function isBackground(agent: DeckAgent): boolean {
  return M.isFolded(agent)
}

/** What the engine waits on the person for agent `id`, as a line of its own ("Asks: Which library?", "Needs your OK to run `npm test`"); '' while it waits on nothing. */
function waitWordsOf(data: DeckData, id: string): string {
  return M.waitLineOf(M.waitPhraseOf(data, id))
}

/**
 * Whether the engine waits on the person for `id`: a call of its is held on
 * them (a question, a permission prompt), or the Orchestrator's needs-you
 * note names it (a note naming no agent is the Orchestrator's own). An
 * agent the engine lists as waiting with neither waits on its own work, not on you.
 * With `isIdleCounted` false, a note that Claude is only idle does not count.
 */
export function waitsOnYou(data: DeckData, id: string, isIdleCounted = true): boolean {
  return M.waitsOnYou(data, id, isIdleCounted)
}

/** `status` (the agent's `statusOf`) as the deck draws it: a wait on anything but you is work going on, so it runs. */
function shownOf(data: DeckData, agent: DeckAgent, status: DeckShownStatus): DeckShownStatus {
  return status === 'waiting' && !waitsOnYou(data, agent.id) ? 'running' : status
}

/** The status the deck draws for `agent`: `statusOf`, save that waiting (ochre) is only ever the one that waits on you. */
export function shownStatusOf(agent: DeckAgent, data: DeckData): DeckShownStatus {
  return shownOf(data, agent, M.statusOf(agent, data))
}

/**
 * Before the first prompt: no goal, no message, no edit, no agent, and the
 * Orchestrator has made no call. The Agents tab is then one quiet line.
 */
export function isUntouched(data: DeckData): boolean {
  if (M.goalOf(data) || data.messages.length > 0 || data.edits.length > 0) return false
  if (data.agents.some(isWorker)) return false
  const main = M.agentOf(data, M.MAIN)
  return main === undefined || (!M.isLive(main.status) && main.tools === 0)
}

/** The one line the Agents tab shows before the first prompt. */
export const UNTOUCHED = 'No goal yet: your next prompt sets it, and its agents show here.'

// 2. The view-models the drawing reads (./outline.tsx).

/** The needs-you line: always one row. */
export type NeedsVM = {
  /** Something needs the person: the line carries the copper rail. */
  isLoud: boolean
  /** The status square before the words; null for none. */
  status: DeckShownStatus | null
  /** The lead (bold on a loud line), then the rest (plain). */
  subject: string
  rest: string
  /** What Open (n) selects; '' when there is nothing to open. */
  open: string
  /** "All done · N files to review": Review opens Changes. */
  canReview: boolean
}

/**
 * The summary line: the plan's step in hand ("Step 2 of 4 · Build the
 * outline view", plain; '' without a real plan), then the counts (dim), then
 * the session's `+a −r`.
 */
export type SummaryVM = { step: string; lead: string; added: number; removed: number }

/** The header: the needs-you line, the goal (bold) with its minutes at the right, and the summary. */
export type HeaderVM = { needs: NeedsVM; goal: string; minutes: string; summary: SummaryVM }

export type RowKind = 'orchestrator' | 'step' | 'agent' | 'background' | 'done'

/** How a row's second line (an inline note on the Orchestrator's) reads: dim, or in its status colour. */
export type NoteTone = 'dim' | 'waiting' | 'failed'

export type RowVM = {
  /** What a press selects or folds: an agent's id, a plan step's key (as `planOf` gives it), or a group's own id. */
  id: string
  kind: RowKind
  /** Levels below the row the outline starts at; the drawing indents at most four. */
  depth: number
  /** The status square (agents) or the step mark (✓ ■ □) it draws; null for the rows that stand for several. */
  status: DeckShownStatus | null
  label: string
  /** ▾ open, ▸ folded; null for a row with nothing under it (or the zoomed row, always open). */
  fold: 'open' | 'closed' | null
  isSelected: boolean
  /** An agent row's columns after its label: done/total ("2/4", "done"), minutes, and its edits. */
  count: string
  minutes: string
  added: number
  removed: number
  /** An agent's line two, the Orchestrator's inline state; '' for none. */
  note: string
  noteTone: NoteTone
}

export type Crumb = { id: string; label: string }

export type OutlineVM = {
  rows: RowVM[]
  /** While zoomed: All, each level between, and last the zoomed row itself; null otherwise. */
  crumbs: Crumb[] | null
  /** Before the first prompt, the one line the tab shows instead of the outline (UNTOUCHED); '' otherwise. */
  empty: string
  /** Rows past the cap, not drawn. */
  hidden: number
}

// 3. The tree: who sits under whom, folded as the person and the defaults say.

/** Agent rows a branch shows before each branch folds its finished agents into "+N done". */
export const ROOMY = 12
/** Rows the outline draws at most; a last line counts the rest. */
export const MOST_ROWS = 160
/** The background row's id. */
export const BACKGROUND = 'group:background'
/** A "+N done" row's id: this, then the id of the branch it sits in. */
export const DONE_GROUP = 'group:done:'
/** Marks a `folded` entry that keeps open a branch folded by default. */
const OPEN = '+'
/** Entries `folded` keeps, the oldest dropped first. */
const FOLDS_KEPT = 200
/** Characters a crumb shows of its row's label. */
const CRUMB_CHARS = 24
/** Characters a step's label carries before the drawing cuts it to the pane. */
const STEP_CHARS = 90

type Node = {
  id: string
  kind: RowKind
  agent?: DeckAgent
  step?: M.DeckPlanStep
  kids: Node[]
  parent: Node | null
}

type Shape = {
  /** The Orchestrator's node, the root of everything. */
  root: Node
  /** The node the outline starts at: the zoomed branch, else the root. */
  top: Node
  byId: Map<string, Node>
  folds: ReadonlySet<string>
  data: DeckData
}

function isWorker(agent: DeckAgent): boolean {
  return agent.kind === 'agent' || agent.kind === 'teammate'
}

/** The status a row draws: a needs-you note counts on the agent whose call waits, not on the Orchestrator that keeps it. */
function statusIn(agent: DeckAgent, data: DeckData): DeckShownStatus {
  return M.statusOf(agent, data)
}

function isFinished(status: DeckShownStatus): boolean {
  return status === 'done' || status === 'failed'
}

/** The agent that spawned `agent` when it is a worker the outline shows; else the Orchestrator. A loop of parents is cut where it closes. */
function parentOf(data: DeckData, agent: DeckAgent, workers: ReadonlyMap<string, DeckAgent>): string {
  const first = M.parentIdOf(data, agent)
  if (first === undefined || !workers.has(first)) return M.MAIN
  const seen = new Set([agent.id])
  for (let at: string | undefined = first; at !== undefined && workers.has(at); ) {
    if (seen.has(at)) return M.MAIN
    seen.add(at)
    const up = workers.get(at)
    at = up ? M.parentIdOf(data, up) : undefined
  }
  return first
}

/**
 * Whether a background loop is at work: a workflow's agent while its run
 * goes on. The engine's own housekeeping loops never say when they end (the
 * deck sees them only through a call), so they never count.
 */
function isBackgroundAtWork(data: DeckData, agent: DeckAgent): boolean {
  if (agent.origin !== 'workflow' || !M.isLive(agent.status)) return false
  const run = agent.workflow === undefined ? undefined : data.workflows.find(one => one.id === agent.workflow)
  return run === undefined || run.endedAt === undefined
}

/** Whether a background loop in `node`'s branch is at work. */
function hasWorkUnder(data: DeckData, node: Node): boolean {
  return node.kids.some(kid => (kid.agent !== undefined && isBackgroundAtWork(data, kid.agent)) || hasWorkUnder(data, kid))
}

/**
 * Every row of the outline, unfolded: the Orchestrator; its plan steps in
 * plan order; the agents each step claims (the first step to name an agent
 * keeps it), then the agents no step claims; sub-agents under their parent;
 * last the background row, every workflow agent and housekeeping loop in it,
 * while a workflow's agent works or once the person opened it (`folds`).
 * Siblings keep spawn order.
 */
function treeOf(data: DeckData, folds: ReadonlySet<string>): { root: Node; byId: Map<string, Node> } {
  const main = M.agentOf(data, M.MAIN)
  const root: Node = { id: M.MAIN, kind: 'orchestrator', ...(main ? { agent: main } : {}), kids: [], parent: null }
  const byId = new Map<string, Node>([[root.id, root]])
  const workers = new Map(data.agents.filter(isWorker).map(agent => [agent.id, agent] as const))
  for (const agent of workers.values()) byId.set(agent.id, { id: agent.id, kind: 'agent', agent, kids: [], parent: null })

  const steps: Node[] = []
  const claimed = new Map<string, Node>()
  for (const step of planStepsOf(data)) {
    // a step's row is its plan key ("todo:…", "task:…"), as the detail block selects and zooms it
    if (step.key === '' || byId.has(step.key)) continue
    const node: Node = { id: step.key, kind: 'step', step, kids: [], parent: root }
    byId.set(node.id, node)
    steps.push(node)
    for (const id of step.agents) if (!claimed.has(id)) claimed.set(id, node)
  }

  const direct: Node[] = []
  const background: Node = { id: BACKGROUND, kind: 'background', kids: [], parent: root }
  for (const agent of workers.values()) {
    const node = byId.get(agent.id)
    if (!node) continue
    const parentId = parentOf(data, agent, workers)
    const above = parentId !== M.MAIN ? byId.get(parentId) : undefined
    // a background loop sits in the background row (under the background loop that started it, if one did)
    const parent = isBackground(agent) ? (above?.agent && isBackground(above.agent) ? above : background) : (above ?? claimed.get(agent.id) ?? root)
    node.parent = parent
    if (parent === root) direct.push(node)
    else parent.kids.push(node)
  }

  root.kids = [...steps, ...direct]
  // at rest the background row is left out: it shows while a workflow's agents work, and stays once the person opened it
  if (background.kids.length > 0 && (folds.has(OPEN + BACKGROUND) || hasWorkUnder(data, background))) {
    root.kids.push(background)
    byId.set(background.id, background)
  }
  return { root, byId }
}

/** Folded until the person opens it: the groups, a finished step's branch, a finished agent's subtree. */
function isFoldedByDefault(node: Node, shape: Shape): boolean {
  if (node.kind === 'background' || node.kind === 'done') return true
  if (node.kind === 'step') return node.step?.status === 'done'
  return node.kind === 'agent' && node.agent !== undefined && isFinished(statusIn(node.agent, shape.data))
}

/** The zoomed branch's own row: always open, with no toggle (the crumbs lead back out). */
function isZoomRoot(node: Node, shape: Shape): boolean {
  return node === shape.top && shape.top !== shape.root
}

/** Whether a branch shows folded: the person's choice, else the default. The zoomed branch's row is always open. */
function isClosed(node: Node, shape: Shape): boolean {
  if (isZoomRoot(node, shape) || node.kids.length === 0) return false
  if (shape.folds.has(node.id)) return true
  if (shape.folds.has(OPEN + node.id)) return false
  return isFoldedByDefault(node, shape)
}

/** The agent rows a branch shows under it, its folds as they stand. */
function agentRowsUnder(node: Node, shape: Shape): number {
  if (isClosed(node, shape)) return 0
  let rows = 0
  for (const kid of node.kids) rows += (kid.kind === 'agent' ? 1 : 0) + agentRowsUnder(kid, shape)
  return rows
}

/** Folds each branch's finished agents (two or more) into one "+N done" row, where the first of them sat. */
function foldDone(node: Node, shape: Shape) {
  const done = node.kids.filter(kid => kid.kind === 'agent' && kid.agent !== undefined && statusIn(kid.agent, shape.data) === 'done')
  const first = done[0]
  if (first && done.length >= 2) {
    const group: Node = { id: DONE_GROUP + node.id, kind: 'done', kids: done, parent: node }
    const at = node.kids.indexOf(first)
    node.kids = node.kids.filter(kid => !done.includes(kid))
    node.kids.splice(at, 0, group)
    for (const kid of done) kid.parent = group
    shape.byId.set(group.id, group)
  }
  for (const kid of node.kids) if (kid.kind !== 'done') foldDone(kid, shape)
}

function isZoomable(node: Node | undefined): node is Node {
  return node !== undefined && (node.kind === 'step' || node.kind === 'agent')
}

/** The outline's tree for `view`: zoomed, folded, and grouped once it runs long. */
function shapeOf(data: DeckData, view: Pick<DeckView, 'folded' | 'zoom'>): Shape {
  const folds = new Set(view.folded)
  const { root, byId } = treeOf(data, folds)
  const zoomed = view.zoom ? byId.get(view.zoom) : undefined
  const shape: Shape = { root, top: isZoomable(zoomed) ? zoomed : root, byId, folds, data }
  if (agentRowsUnder(shape.top, shape) > ROOMY) foldDone(shape.top, shape)
  return shape
}

function isUnder(node: Node, top: Node): boolean {
  for (let at: Node | null = node; at; at = at.parent) if (at === top) return true
  return false
}

/** The rows between the root and `node` a crumb can name (steps and agents), outermost first. */
function levelsAbove(node: Node, root: Node): Node[] {
  const out: Node[] = []
  for (let at = node.parent; at && at !== root; at = at.parent) if (isZoomable(at)) out.unshift(at)
  return out
}

// 4. Rows.

/** The minutes an agent shows: coarse while it runs, its run's length once it ended, none before it started. */
function minutesOf(agent: DeckAgent, status: DeckShownStatus, now: number): string {
  if (!isWorker(agent)) return ''
  return M.isLive(agent.status) || status === 'waiting' || agent.endedAt !== undefined ? M.elapsedOf(agent, now) : ''
}

/** Why an agent failed: its result's line (`resultLineOf`, its own "Failed:" dropped), else its last failed call. */
function failureOf(agent: DeckAgent, root: string): string {
  const said = agent.answer ? M.resultLineOf(agent.answer, root, true) : ''
  if (said) return said
  for (let i = agent.recent.length - 1; i >= 0; i--) {
    const one = agent.recent[i]
    if (one?.ok === false) return `${one.tool} ${one.target} failed`.trim()
  }
  return ''
}

/** "Asks: Which library?", "Needs your OK to run `npm test`": what the engine waits on the person for, for agent `id`. */
function waitsNote(data: DeckData, id: string): { note: string; noteTone: NoteTone } {
  return { note: waitWordsOf(data, id) || 'Waits on you', noteTone: 'waiting' }
}

/** An agent held on work of its own, not on you: the child at work under it, else its background work. */
function heldNote(node: Node): { note: string; noteTone: NoteTone } {
  const child = node.kids.find(kid => kid.agent !== undefined && M.isLive(kid.agent.status))?.agent
  return { note: child ? `Waiting on ${labelTextOf(child)}` : 'Waiting on background work', noteTone: 'dim' }
}

/**
 * An agent's line two: where it is, as its status says it. A finished one's
 * result reads as `resultLineOf` gives it (its first sentence, no "Done:" or
 * "Summary:" of its own, paths made short against `root`, the repository
 * shown); the detail's Result keeps the whole text.
 */
function noteOf(data: DeckData, node: Node, agent: DeckAgent, status: DeckShownStatus, root: string): { note: string; noteTone: NoteTone } {
  switch (status) {
    case 'waiting':
      return waitsOnYou(data, agent.id) ? waitsNote(data, agent.id) : heldNote(node)
    case 'failed': {
      if (agent.status === 'killed') return { note: 'Stopped', noteTone: 'dim' }
      const why = failureOf(agent, root)
      return { note: why ? `Failed: ${why}` : 'Failed', noteTone: 'failed' }
    }
    case 'done': {
      const result = agent.answer ? M.resultLineOf(agent.answer, root) : ''
      return { note: result ? `Done: ${result}` : 'Done', noteTone: 'dim' }
    }
    case 'idle':
      return { note: 'Idle', noteTone: 'dim' }
    default:
      return { note: stepTextOf(agent) || (agent.status === 'starting' ? 'Starting' : 'Working'), noteTone: 'dim' }
  }
}

/** The Orchestrator's state, said inline on its row: waiting on you, on the agents it started, or what it is at. */
function orchestratorNoteOf(data: DeckData, node: Node, main: DeckAgent | undefined, status: DeckShownStatus): { note: string; noteTone: NoteTone } {
  if (status === 'waiting') return waitsOnYou(data, M.MAIN) ? waitsNote(data, M.MAIN) : heldNote(node)
  const live = data.agents.filter(agent => isWorker(agent) && !isBackground(agent) && M.isLive(agent.status) && M.parentIdOf(data, agent) === M.MAIN).length
  if (live > 0 && !main?.current) return { note: `waiting on ${F.plural(live, 'agent')}`, noteTone: 'dim' }
  if (status === 'running' && main) return { note: stepTextOf(main) || 'Working', noteTone: 'dim' }
  return { note: status === 'idle' ? 'Idle' : '', noteTone: 'dim' }
}

const STEP_STATUS: Record<DeckStepStatus, DeckShownStatus> = { done: 'done', active: 'running', pending: 'idle', failed: 'failed' }

function rowOf(data: DeckData, shape: Shape, node: Node, depth: number, selected: string, now: number, root: string): RowVM {
  const closed = isClosed(node, shape)
  const fold: RowVM['fold'] = isZoomRoot(node, shape) || node.kids.length === 0 ? null : closed ? 'closed' : 'open'
  const base = { id: node.id, kind: node.kind, depth, fold, isSelected: node.id === selected, count: '', minutes: '', added: 0, removed: 0, note: '', noteTone: 'dim' as NoteTone }

  if (node.kind === 'orchestrator') {
    const main = node.agent
    const status = main ? statusIn(main, data) : 'idle'
    return { ...base, status: main ? shownOf(data, main, status) : status, label: M.ORCHESTRATOR, ...orchestratorNoteOf(data, node, main, status) }
  }
  if (node.kind === 'step' && node.step) {
    return { ...base, status: STEP_STATUS[node.step.status], label: F.trunc(F.oneLine(node.step.text), STEP_CHARS) }
  }
  if (node.kind === 'background' || node.kind === 'done') {
    const count = node.kids.length
    return { ...base, status: null, label: node.kind === 'background' ? `+${count} background` : `+${count} done` }
  }

  const agent = node.agent
  if (!agent) return { ...base, status: 'idle', label: node.id }
  const status = statusIn(agent, data)
  const list = checklistCountOf(agent, data)
  return {
    ...base,
    status: shownOf(data, agent, status),
    label: labelTextOf(agent),
    count: status === 'done' ? 'done' : list ? `${list.done}/${list.total}` : '',
    minutes: minutesOf(agent, status, now),
    added: agent.added,
    removed: agent.removed,
    ...noteOf(data, node, agent, status, root),
  }
}

function crumbOf(node: Node): Crumb {
  const label = node.kind === 'step' && node.step ? F.oneLine(node.step.text) : node.agent ? labelTextOf(node.agent) : node.id
  return { id: node.id, label: F.trunc(label, CRUMB_CHARS) }
}

/**
 * The outline as the view has it: rows in tree order from the zoomed branch
 * (else the Orchestrator), each folded branch one row; the crumbs while
 * zoomed; `view.agent`'s row selected (none while it is ''). At most `most`
 * rows; `hidden` counts the rest. `root` is the repository shown ('' for
 * none): paths under it in a result's line read relative to it.
 */
export function outlineOf(data: DeckData, view: DeckView, now: number, most = MOST_ROWS, root = ''): OutlineVM {
  const shape = shapeOf(data, view)
  const selected = view.agent
  const rows: RowVM[] = []
  let hidden = 0

  const walk = (node: Node, depth: number) => {
    if (rows.length < most) rows.push(rowOf(data, shape, node, depth, selected, now, root))
    else hidden += 1
    if (!isClosed(node, shape)) for (const kid of node.kids) walk(kid, depth + 1)
  }
  walk(shape.top, 0)

  const isZoomed = shape.top !== shape.root
  return {
    rows,
    crumbs: isZoomed ? [{ id: '', label: 'All' }, ...levelsAbove(shape.top, shape.root).map(crumbOf), crumbOf(shape.top)] : null,
    empty: isUntouched(data) ? UNTOUCHED : '',
    hidden,
  }
}

/** `folded` after the person folds or opens branch `id`: their choice is kept, and wins over the default from then on. */
export function foldToggled(data: DeckData, view: Pick<DeckView, 'folded' | 'zoom'>, id: string): string[] {
  const shape = shapeOf(data, view)
  const node = shape.byId.get(id)
  const rest = view.folded.filter(one => one !== id && one !== OPEN + id)
  if (!node || node.kids.length === 0) return rest
  return [...rest, isClosed(node, shape) ? OPEN + id : id].slice(-FOLDS_KEPT)
}

/**
 * Whether row `id`'s branch shows open or folded, as its toggle says; null
 * for a row with nothing under it, the zoomed row (always open) and an id
 * the outline does not hold. The detail's Fold (f) reads it.
 */
export function foldStateOf(data: DeckData, view: Pick<DeckView, 'folded' | 'zoom'>, id: string): 'open' | 'closed' | null {
  if (id === '') return null
  const shape = shapeOf(data, view)
  const node = shape.byId.get(id)
  if (!node || isZoomRoot(node, shape) || node.kids.length === 0) return null
  return isClosed(node, shape) ? 'closed' : 'open'
}

/**
 * The folds and zoom that show row `id`: out of a zoom it lies outside, and
 * every folded branch above it opened. A row the outline does not hold
 * leaves both as they are.
 */
export function revealed(data: DeckData, view: Pick<DeckView, 'folded' | 'zoom'>, id: string): Pick<DeckView, 'folded' | 'zoom'> {
  let folded = view.folded
  let zoom = view.zoom
  // opening a branch can fold a long one's finished agents into "+N done": look again until the row shows
  for (let pass = 0; pass < 4; pass++) {
    const shape = shapeOf(data, { folded, zoom })
    const node = shape.byId.get(id)
    if (!node) break
    if (!isUnder(node, shape.top)) {
      zoom = ''
      continue
    }
    const shut: Node[] = []
    for (let at = node.parent; at; at = at.parent) if (isClosed(at, shape)) shut.push(at)
    if (shut.length === 0) break
    const entries = new Set(shut.flatMap(one => [one.id, OPEN + one.id]))
    folded = [...folded.filter(one => !entries.has(one)), ...shut.map(one => OPEN + one.id)].slice(-FOLDS_KEPT)
  }
  return { folded, zoom }
}

/** A zoom the outline can take: a step's key or an agent's id it holds; '' (everything) for the Orchestrator, the groups and anything gone. */
export function zoomFor(data: DeckData, view: Pick<DeckView, 'folded' | 'zoom'>, id: string): string {
  if (!id || id === M.MAIN) return ''
  return isZoomable(shapeOf(data, view).byId.get(id)) ? id : ''
}

// 5. The header.

/**
 * The needs-you line (`needsOf`): loud, with the copper rail, for a prompt
 * blocked on you, a failure or a file two live agents share; the agent's
 * label (the two agents' labels for a shared file) leads in bold, and Open
 * selects the agent (the shared file). Quiet otherwise, with Review once
 * all is done and files wait to be reviewed.
 */
function needsVMOf(data: DeckData, git: GitState, now: number): NeedsVM {
  const said = M.needsOf(data, git, now)
  const isLoud = said.tone === 'alert' || said.tone === 'attention'
  const text = F.oneLine(said.text)
  const agent = said.agentId ? M.agentOf(data, said.agentId) : undefined
  const label = agent ? labelTextOf(agent) : ''
  const cut = said.kind === 'shared' ? text.indexOf(' both edit ') : label && text.startsWith(label) ? label.length : text.indexOf(': ')
  const open = !isLoud ? '' : said.kind === 'shared' && said.path ? `file:${said.path}` : (said.agentId ?? '')
  return {
    isLoud,
    status: !isLoud ? null : said.tone === 'alert' ? 'failed' : 'waiting',
    subject: isLoud && cut > 0 ? text.slice(0, cut) : text,
    rest: isLoud && cut > 0 ? text.slice(cut) : '',
    open,
    canReview: said.kind === 'review',
  }
}

/** Whole minutes as the header says them: "<1m", "18m", "1h 05m". */
function minutesText(minutes: number): string {
  return minutes < 1 ? '<1m' : F.dur(minutes * 60_000)
}

/** "Step 2 of 4 · Build the outline view": the real plan's step in hand; with none in hand, how many are done; '' without a real plan. */
function stepLineOf(data: DeckData): string {
  const steps = planStepsOf(data)
  if (steps.length === 0) return ''
  const at = steps.findIndex(step => step.status === 'active')
  const active = steps[at]
  if (active) return `Step ${at + 1} of ${steps.length} · ${F.oneLine(active.text)}`
  const done = steps.filter(step => step.status === 'done').length
  return done === steps.length ? `All ${steps.length} steps done` : `${done} of ${steps.length} steps done`
}

/** This goal's agents at work and waiting on you, the way the rows draw them: one held on its own work counts as running. */
function atWorkOf(data: DeckData): { running: number; waiting: number } {
  const goal = M.goalOf(data)
  let running = 0
  let waiting = 0
  for (const agent of data.agents) {
    if (!M.isShownAgent(agent) || (goal !== undefined && agent.goal !== goal.id)) continue
    const status = shownStatusOf(agent, data)
    if (status === 'waiting') waiting += 1
    else if (status === 'running') running += 1
  }
  if (M.waitsOnYou(data, M.MAIN, false)) waiting += 1
  return { running, waiting }
}

/**
 * The summary line (`summaryOf`): the plan's step in hand (a real plan's
 * only: an implicit one is just the agents, counted next), then this goal's
 * agents by state, the files and lines changed.
 */
function summaryVMOf(data: DeckData, sum: M.DeckSummary): SummaryVM {
  const { running, waiting } = atWorkOf(data)
  const parts = [
    running > 0 ? `${running} running` : '',
    waiting > 0 ? `${waiting} waits on you` : '',
    sum.failed > 0 ? `${sum.failed} failed` : '',
    sum.done > 0 ? `${sum.done} done` : '',
    sum.files > 0 ? F.plural(sum.files, 'file') : 'no files changed',
  ].filter(part => part !== '')
  return { step: stepLineOf(data), lead: parts.join(' · '), added: sum.added, removed: sum.removed }
}

/** The header: what needs you, the goal and its minutes, the summary. */
export function headerOf(data: DeckData, git: GitState, now: number): HeaderVM {
  const goal = goalLineOf(data)
  const sum = M.summaryOf(data, git, now)
  return { needs: needsVMOf(data, git, now), goal, minutes: goal ? minutesText(sum.minutes) : '', summary: summaryVMOf(data, sum) }
}
