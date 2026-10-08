/**
 * The Agents tab's header and outline, read off the deck's live data.
 *
 * The header: what needs you (one line), the goal, and one summary line.
 * The outline you click: the Orchestrator, its plan steps, the agents under
 * the step each serves (straight under the Orchestrator when there is no
 * plan or no step claims them), and sub-agents under the agent that spawned
 * them. Workflow and housekeeping loops fold into one "+N background" row,
 * a finished agent's subtree folds, and once a branch holds more than about
 * twelve agent rows each branch folds its finished agents into "+N done".
 * Zoom re-roots the outline on one branch, with breadcrumbs back up.
 *
 * `view.folded` holds the person's own choices, which win over those
 * defaults: a branch's id folds it, `+` and its id keeps it open.
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
 * The goal in hand, on one line; '' before the first prompt. A goal whose
 * headline is not its words' first line (a slash command's) shows that headline.
 */
function goalTextOf(data: DeckData): string {
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

/** What the engine waits on the person for, in few words (`allow Bash "npm test"`); '' while it waits on nothing. */
function waitWordsOf(data: DeckData): string {
  const needs = M.agentOf(data, M.MAIN)?.needs
  return needs ? M.waitingOnOf(data, needs) : ''
}

// 2. The view-models the drawing reads (./outline.tsx).

/** The needs-you line: always one row. */
export type NeedsVM = {
  /** Something needs the person: the line carries the copper bar. */
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

/** The summary line: its words, then the session's `+a −r`, then its tail (" · 18m"). */
export type SummaryVM = { lead: string; added: number; removed: number; tail: string }

export type HeaderVM = { needs: NeedsVM; goal: string; summary: SummaryVM }

export type RowKind = 'orchestrator' | 'step' | 'agent' | 'background' | 'done'

/** How a row's second line (an inline note on the Orchestrator's) reads: dim, or in its status colour. */
export type NoteTone = 'dim' | 'waiting' | 'failed'

export type RowVM = {
  /** What a press selects or folds: an agent's id, a plan step's key (as `planOf` gives it), or a group's own id. */
  id: string
  kind: RowKind
  /** Levels below the row the outline starts at; the drawing indents at most three. */
  depth: number
  /** The status square (agents) or the step mark (✓ ■ □) it draws; null for the rows that stand for several. */
  status: DeckShownStatus | null
  label: string
  /** ▾ open, ▸ folded; null for a row with nothing under it (or the zoomed row, always open). */
  fold: 'open' | 'closed' | null
  isSelected: boolean
  /** The right columns: done/total ("2/4", "done"), minutes, and the row's edits. */
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
  /** The dim line under the Orchestrator while nothing is delegated; '' otherwise. */
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
 * Every row of the outline, unfolded: the Orchestrator; its plan steps in
 * plan order; the agents each step claims (the first step to name an agent
 * keeps it), then the agents no step claims; sub-agents under their parent;
 * last the background row, every workflow agent and housekeeping loop in it.
 * Siblings keep spawn order.
 */
function treeOf(data: DeckData): { root: Node; byId: Map<string, Node> } {
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
  if (background.kids.length > 0) {
    root.kids.push(background)
    byId.set(background.id, background)
  }
  return { root, byId }
}

function isFoldedByDefault(node: Node, shape: Shape): boolean {
  if (node.kind === 'background' || node.kind === 'done') return true
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
  const { root, byId } = treeOf(data)
  const zoomed = view.zoom ? byId.get(view.zoom) : undefined
  const shape: Shape = { root, top: isZoomable(zoomed) ? zoomed : root, byId, folds: new Set(view.folded), data }
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

/** Why an agent failed: its answer's first line, else its last failed call. */
function failureOf(agent: DeckAgent): string {
  if (agent.answer) return F.firstLine(agent.answer)
  for (let i = agent.recent.length - 1; i >= 0; i--) {
    const one = agent.recent[i]
    if (one?.ok === false) return `${one.tool} ${one.target} failed`.trim()
  }
  return ''
}

/** An agent's line two: where it is, as its status says it. */
function noteOf(data: DeckData, agent: DeckAgent, status: DeckShownStatus): { note: string; noteTone: NoteTone } {
  switch (status) {
    case 'waiting': {
      const what = waitWordsOf(data)
      return { note: what ? `Waits on you: ${what}` : 'Waits on you', noteTone: 'waiting' }
    }
    case 'failed': {
      if (agent.status === 'killed') return { note: 'Stopped', noteTone: 'dim' }
      const why = failureOf(agent)
      return { note: why ? `Failed: ${why}` : 'Failed', noteTone: 'failed' }
    }
    case 'done': {
      const result = agent.answer ? F.firstLine(agent.answer) : ''
      return { note: result ? `Done: ${result}` : 'Done', noteTone: 'dim' }
    }
    case 'idle':
      return { note: 'Idle', noteTone: 'dim' }
    default:
      return { note: stepTextOf(agent) || (agent.status === 'starting' ? 'Starting' : 'Working'), noteTone: 'dim' }
  }
}

/** The Orchestrator's state, said inline on its row: waiting on you, on the agents it started, or what it is at. */
function orchestratorNoteOf(data: DeckData, main: DeckAgent | undefined, status: DeckShownStatus): { note: string; noteTone: NoteTone } {
  if (status === 'waiting') {
    const what = waitWordsOf(data)
    return { note: what ? `Waits on you: ${what}` : 'Waits on you', noteTone: 'waiting' }
  }
  const live = data.agents.filter(agent => isWorker(agent) && !isBackground(agent) && M.isLive(agent.status) && M.parentIdOf(data, agent) === M.MAIN).length
  if (live > 0 && !main?.current) return { note: `waiting on ${F.plural(live, 'agent')}`, noteTone: 'dim' }
  if (status === 'running' && main) return { note: stepTextOf(main) || 'Working', noteTone: 'dim' }
  return { note: status === 'idle' ? 'Idle' : '', noteTone: 'dim' }
}

const STEP_STATUS: Record<DeckStepStatus, DeckShownStatus> = { done: 'done', active: 'running', pending: 'idle', failed: 'failed' }

function rowOf(data: DeckData, shape: Shape, node: Node, depth: number, selected: string, now: number): RowVM {
  const closed = isClosed(node, shape)
  const fold: RowVM['fold'] = isZoomRoot(node, shape) || node.kids.length === 0 ? null : closed ? 'closed' : 'open'
  const base = { id: node.id, kind: node.kind, depth, fold, isSelected: node.id === selected, count: '', minutes: '', added: 0, removed: 0, note: '', noteTone: 'dim' as NoteTone }

  if (node.kind === 'orchestrator') {
    const main = node.agent
    const status = main ? statusIn(main, data) : 'idle'
    return { ...base, status, label: M.ORCHESTRATOR, added: main?.added ?? 0, removed: main?.removed ?? 0, ...orchestratorNoteOf(data, main, status) }
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
    status,
    label: labelTextOf(agent),
    count: status === 'done' ? 'done' : list ? `${list.done}/${list.total}` : '',
    minutes: minutesOf(agent, status, now),
    added: agent.added,
    removed: agent.removed,
    ...noteOf(data, agent, status),
  }
}

function crumbOf(node: Node): Crumb {
  const label = node.kind === 'step' && node.step ? F.oneLine(node.step.text) : node.agent ? labelTextOf(node.agent) : node.id
  return { id: node.id, label: F.trunc(label, CRUMB_CHARS) }
}

/**
 * The outline as the view has it: rows in tree order from the zoomed branch
 * (else the Orchestrator), each folded branch one row; the crumbs while
 * zoomed. At most `most` rows; `hidden` counts the rest.
 */
export function outlineOf(data: DeckData, view: DeckView, now: number, most = MOST_ROWS): OutlineVM {
  const shape = shapeOf(data, view)
  const selected = view.agent || M.MAIN
  const rows: RowVM[] = []
  let hidden = 0

  const walk = (node: Node, depth: number) => {
    if (rows.length < most) rows.push(rowOf(data, shape, node, depth, selected, now))
    else hidden += 1
    if (!isClosed(node, shape)) for (const kid of node.kids) walk(kid, depth + 1)
  }
  walk(shape.top, 0)

  const isZoomed = shape.top !== shape.root
  return {
    rows,
    crumbs: isZoomed ? [{ id: '', label: 'All' }, ...levelsAbove(shape.top, shape.root).map(crumbOf), crumbOf(shape.top)] : null,
    empty: !isZoomed && shape.root.kids.length === 0 ? 'No agents yet; delegated work shows here as it starts.' : '',
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
 * The needs-you line (`needsOf`): loud, with the copper bar, for a prompt
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

/** Whole minutes as the summary says them: "<1m", "18m", "1h 05m". */
function minutesText(minutes: number): string {
  return minutes < 1 ? '<1m' : F.dur(minutes * 60_000)
}

/**
 * The summary line (`summaryOf`): the plan's step (a real plan's only: an
 * implicit one is just the agents, counted next), this goal's agents by
 * state, the files and lines changed, its minutes.
 */
function summaryVMOf(data: DeckData, git: GitState, now: number): SummaryVM {
  const sum = M.summaryOf(data, git, now)
  const parts = [
    sum.step && planStepsOf(data).length > 0 ? `plan ${sum.step}` : '',
    sum.running > 0 ? `${sum.running} running` : '',
    sum.waiting > 0 ? `${sum.waiting} waits on you` : '',
    sum.failed > 0 ? `${sum.failed} failed` : '',
    sum.done > 0 ? `${sum.done} done` : '',
    sum.files > 0 ? F.plural(sum.files, 'file') : 'no files changed',
  ].filter(part => part !== '')
  return { lead: parts.join(' · '), added: sum.added, removed: sum.removed, tail: M.goalOf(data) ? ` · ${minutesText(sum.minutes)}` : '' }
}

/** The header: what needs you, the goal, the summary. */
export function headerOf(data: DeckData, git: GitState, now: number): HeaderVM {
  return { needs: needsVMOf(data, git, now), goal: goalTextOf(data), summary: summaryVMOf(data, git, now) }
}
