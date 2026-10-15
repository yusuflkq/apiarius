/**
 * The Agents tab's detail block, the one part that changes on a click: the
 * outline's selection (`view.agent`) in full. Nothing is selected at rest
 * (`view.agent` is ''), and then there is no detail block at all.
 *
 * - An agent: label and scope, Fold, Zoom, minutes and `+a −r`; its task (two
 *   lines, "more" for the rest); what it waits on, and where to answer; its
 *   checklist, the live call beside the item in hand; its result once it
 *   ended; then Diffs · Talk · Tool calls.
 * - The Orchestrator (`main`): the goal only when the header had to cut it,
 *   the follow-ups, what it waits on; then its own Diffs, Talk (the whole
 *   message log, open first) and Tool calls.
 * - A plan step (its key: `todo:<item>`, `task:<id>`, `plan:<n>`…): its
 *   status, and the files its agents changed in the Files section's columns
 *   (the agents themselves are the outline's rows under it).
 * - A file (`file:<path>`): its hunks by the agent that made them, and Open in Changes.
 *
 * The header carries the copper rail, and Fold (f) and Zoom (z) for the
 * selected branch: the outline's own labels do nothing when pressed again.
 *
 * `detailVM` reads the deck into plain rows; `detailBlock` draws them. No
 * text moves with the clock alone: times are times of day and an agent's
 * minutes are the coarse ones the screen signature covers. The "more" a
 * person opens and the pane the Orchestrator shows are the detail's own
 * state, kept here while the module lives.
 */
import type { RenderElement } from 'claude-code'

import type { DeckActivity, DeckAgent, DeckAgentPane, DeckData, DeckEdit, DeckMessage, DeckShownStatus, DeckStepStatus, DeckView } from '../../types'
import { hunksOf, type Hunk } from '../diff'
import * as F from '../format'
import type { FileDiff, GitState } from '../git'
import {
  MAIN,
  ORCHESTRATOR,
  YOU,
  agentOf,
  checklistOf,
  elapsedOf,
  goalOf,
  isLive,
  labelOf,
  lastActionOf,
  nowOf,
  parentIdOf,
  planOf,
  samePath,
  scopeOf,
  statusOf,
  waitLineOf,
  waitPhraseOf,
  type DeckPlanSource,
  type DeckStepLink,
} from '../model'
import { codeBlocks, delta, deltaText, emptyLine, rail, square, stepMark, toggles, treeSize, type ToggleItem } from './common'
import { ago, msText, verbOf } from './dash/dashModel'
import { P } from './dash/palette'
import { editorsText, fileColsOf, fileFactsOf, fileLine, fileStatusOf, isEditOf, type FileRowVM } from './files'
import { goalChars } from './outline'
import { foldStateOf, goalLineOf, shownStatusOf, waitsOnYou } from './outlineModel'
import { NATIVE_TEXT, T } from './theme'
import type { Actions, ChatLine, Kit } from './types'

/** How much one detail draws: diff characters, files and edits a file, and rows of each list. */
export type DetailRoom = { diffChars: number; files: number; editsPerFile: number; talk: number; items: number; steps: number }

/** The detail as it is drawn first: well inside the tree's bounds beside the outline (each Code under 10,000 characters). */
export const DETAIL_ROOM: DetailRoom = { diffChars: 24_000, files: 10, editsPerFile: 6, talk: 200, items: 30, steps: 30 }
/** The detail drawn again when the first passes DETAIL_CHARS. */
export const DETAIL_LEAN: DetailRoom = { diffChars: 6_000, files: 4, editsPerFile: 2, talk: 30, items: 12, steps: 12 }
/** The characters of text the detail's tree may hold, its share of the host's 100,000 beside the outline and Files. */
export const DETAIL_CHARS = 50_000

/** The label column of Task, Todo, Result, Goal, Status, in cells. */
const LABEL_WIDTH = 8
/** The rail and the mark's column, each two cells, as the outline's rows keep them; the body sits under the mark. */
const BAR = 2
const MARK = 2
/** The most characters a message, task or result opened in full holds. */
const FULL_CHARS = 2400
/** Below this many characters left in the budget, a diff is noted as cut rather than drawn a few lines deep. */
const LEAST_DIFF = 400
/** Where the person answers what the engine waits on them for. */
const ANSWER_WHERE = 'Answer the prompt in the conversation.'

// The view model.

/** The header row: the copper rail, a mark, the title bold and a dim note; Fold, Zoom, minutes and `+a −r` at the right. */
export type HeaderVM = {
  /** The mark before the title: an agent's status square, or a step's ✓ ■ □ (`isStep`); null for none. */
  status: DeckShownStatus | null
  isStep: boolean
  title: string
  /** The title is a path: its directory dim, its name bold. */
  isPath: boolean
  /** Its scope or state, dim; '' for none (never a bare type). */
  sub: string
  /** The selected branch's fold as its outline toggle has it (f folds or opens it); null where there is nothing to fold. */
  fold: 'open' | 'closed' | null
  /** The outline id Fold and Zoom act on. */
  id: string
  /** The outline id Zoom re-roots on; '' draws no Zoom. */
  zoom: string
  /** The outline is zoomed on it already: the button zooms back out to everything. */
  isZoomed: boolean
  minutes: string
  added: number
  removed: number
}

/** A text drawn short with "more" for the rest; `key` names it among the texts the person opened. */
export type ExpandVM = { key: string; text: string; isOpen: boolean }

/** A checklist row: ✓ done, ■ in hand (in its agent's status colour), □ not started; the live call beside the one in hand. */
export type CheckVM = { text: string; status: DeckShownStatus; isCurrent: boolean; live: string }

/** The checklist: its rows, done of total, and the done items folded before them and the open ones after, past the room. */
export type ChecklistVM = { rows: CheckVM[]; done: number; total: number; earlierDone: number; laterTodo: number }

export type TalkRowVM = { id: string; at: string; route: string; text: string; isOpen: boolean }

export type TalkVM = {
  /** Oldest first. */
  rows: TalkRowVM[]
  earlier: number
  empty: string
  /** The field that sends to the agent (the Orchestrator: your next prompt); null where nothing can be sent from here. */
  send: { id: string; label: string; placeholder: string } | null
  how: string
}

export type CallVM = { id: string; at: string; tool: string; what: string; isLive: boolean; isFailed: boolean; took: string }

export type CallsVM = { rows: CallVM[]; counted: string; empty: string }

/** One edit's exact patch; `order` is its place among the edits read (higher is newer). */
export type DiffEditVM = { id: string; path: string; patch: string; order: number }

/** One file's edits, oldest first; `last` is its newest edit's order. */
export type DiffGroupVM = { path: string; added: number; removed: number; isNew: boolean; edits: DiffEditVM[]; last: number }

/** Diffs: the files in the order they were first edited. */
export type DiffsVM = { groups: DiffGroupVM[]; empty: string }

/**
 * The switch and the one pane it shows: only the open pane's rows are read.
 * An agent shows the view's pane (`view.agentPane`, Diffs first); the
 * Orchestrator keeps its own, Talk first (`isMain`). `viewPane` is the
 * view's, which a press that only redraws sends back unchanged.
 */
export type PaneVM = {
  open: DeckAgentPane
  isMain: boolean
  viewPane: DeckAgentPane
  talk: number
  calls: number
  diffs: DiffsVM | null
  chat: TalkVM | null
  activity: CallsVM | null
}

export type AgentDetailVM = {
  kind: 'agent'
  id: string
  header: HeaderVM
  task: ExpandVM | null
  /** Said where there is no task: why ('' draws no Task row). */
  noTask: string
  /** "Waits on you: …" while the engine waits on the person for it; '' otherwise. */
  needs: string
  checklist: ChecklistVM | null
  /** What it is doing (or holds on) when it keeps no checklist, or what it waits on that is not you; '' once it stopped. */
  now: string
  result: (ExpandVM & { isFailed: boolean }) | null
  pane: PaneVM
  room: DetailRoom
}

export type OrchestratorDetailVM = {
  kind: 'orchestrator'
  header: HeaderVM
  needs: string
  /** The whole goal, for the Markdown; '' before any. */
  goal: string
  /** The goal's words on one line, and the line the header shows: the detail repeats the goal only when the header cut it. */
  goalWords: string
  goalLine: string
  followUps: { at: string; text: string }[]
  pane: PaneVM
  room: DetailRoom
}

export type StepDetailVM = {
  kind: 'step'
  key: string
  header: HeaderVM
  /** The step's state in a word or two, and where the plan came from. */
  status: string
  source: string
  /** The files its agents (and theirs) changed, as the Files section's rows. */
  files: FileRowVM[]
  room: DetailRoom
}

export type FileByAgentVM = { id: string; label: string; status: DeckShownStatus; added: number; removed: number; edits: DiffEditVM[] }

export type FileDetailVM = {
  kind: 'file'
  path: string
  header: HeaderVM
  /** Two live agents on it, said in ochre; '' otherwise. */
  shared: string
  /** What git says of it, dim; '' outside a repository. */
  gitNote: string
  isOpenInChanges: boolean
  byAgent: FileByAgentVM[]
  /** git's hunks, when no agent's edit of the file is kept and Changes read its diff. */
  gitHunks: Hunk[] | null
  room: DetailRoom
}

export type EmptyDetailVM = { kind: 'empty'; text: string; room: DetailRoom }

/** Nothing selected: no detail block. */
export type NoDetailVM = { kind: 'none'; room: DetailRoom }

export type DetailVM = AgentDetailVM | OrchestratorDetailVM | StepDetailVM | FileDetailVM | EmptyDetailVM | NoDetailVM

// What the person opened with "more" or a press on a message, and the Orchestrator's pane: the detail's own, kept while the module lives.

const opened = new Set<string>()

/** The pane the Orchestrator's detail shows: Talk (its whole log) until the person picks another for it. */
let mainPane: DeckAgentPane = 'chat'

/** Opens or closes the text `key` names ("task:<id>", "result:<id>", "msg:<id>"). */
export function toggleOpen(key: string): void {
  if (opened.has(key)) opened.delete(key)
  else opened.add(key)
}

/** Whether the text `key` names is open. */
export function isOpen(key: string): boolean {
  return opened.has(key)
}

/**
 * Draws again after a "more" or a pick of the Orchestrator's pane: the
 * detail's own state changed, not the deck's, so it asks for the view's pane
 * as it is, which only redraws.
 */
function redrawFor(actions: Actions, viewPane: DeckAgentPane): void {
  actions.setAgentPane(viewPane)
}

// 1. The data worker's queries (model.ts), read here and nowhere else in the detail.

type CheckItem = { text: string; state: DeckStepStatus }
type PlanStep = { key: string; text: string; status: DeckShownStatus; agents: string[] }
type Plan = { source: string; steps: PlanStep[]; links: Record<string, DeckStepLink> }
type Goal = { text: string; followUps: { text: string; at: number }[] }

/** The agent's checklist: its items in order, the one in hand in its own words ("Running the tests"); null while it keeps none. */
function checklistFor(data: DeckData, agent: DeckAgent): { items: CheckItem[]; done: number; total: number } | null {
  const list = checklistOf(agent, data)
  if (list.items.length === 0) return null
  const items = list.items.map(item => ({ text: item.status === 'active' ? (item.doing ?? item.text) : item.text, state: item.status }))
  return { items, done: list.done, total: list.total }
}

/** The agent's latest call in words, while it is at work; '' otherwise. */
function liveCallOf(data: DeckData, agent: DeckAgent): string {
  const status = statusOf(agent, data)
  if (status !== 'running' && status !== 'waiting') return ''
  return F.oneLine(lastActionOf(agent)?.text ?? '')
}

/** A step's mark: done, failed, not started, or in hand (waiting while one of its agents waits on you). */
function stepStatusOf(data: DeckData, status: DeckStepStatus, agents: readonly string[]): DeckShownStatus {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'idle'
  return agents.some(id => waitsOnYou(data, id)) ? 'waiting' : 'running'
}

/** Where a plan came from, in words. */
const SOURCE_WORDS: Readonly<Record<DeckPlanSource, string>> = {
  board: 'the task board',
  todo: "the Orchestrator's todo list",
  plan: 'the approved plan',
  workflow: "the workflow's phases",
  implicit: 'each Agent call',
  none: 'nothing yet',
}

/**
 * The plan: the steps in order, each with its status and the agents that
 * serve it, and how each agent was tied to its step; null while there is
 * none, and for an implicit plan (each Agent call a step), which only
 * repeats the agents.
 */
function planFor(data: DeckData): Plan | null {
  const plan = planOf(data)
  if (plan.steps.length === 0 || plan.source === 'implicit' || plan.source === 'none') return null
  return {
    source: SOURCE_WORDS[plan.source],
    steps: plan.steps.map(step => ({ key: step.key, text: step.text, status: stepStatusOf(data, step.status, step.agents), agents: [...step.agents] })),
    links: plan.links,
  }
}

/** The plan's steps as the detail reads them (the key `select` takes for each, its words and its agents); none without a real plan. */
export function planStepsOf(data: DeckData): { key: string; text: string; agents: string[] }[] {
  return (planFor(data)?.steps ?? []).map(step => ({ key: step.key, text: step.text, agents: step.agents }))
}

/** The goal in hand and its follow-ups; before the deck kept goals, your first prompt and the ones after it; null before any. */
function goalFor(data: DeckData): Goal | null {
  const goal = goalOf(data)
  if (goal && goal.text.trim() !== '') return { text: goal.text, followUps: goal.followUps }
  const prompts = data.messages.filter(message => message.kind === 'prompt' && message.to === MAIN)
  const [first, ...rest] = prompts
  if (!first) return null
  return { text: first.text, followUps: rest.map(message => ({ text: message.text, at: message.at })) }
}

// 2. Reading the deck.

/** The time of day `ms` falls at, `HH:MM` local: the same text for the life of the row. */
function clockOf(ms: number): string {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** The name the detail gives an id: its agent's label, the Orchestrator, You, else a short form of the id. */
function nameOf(data: DeckData, id: string): string {
  const agent = agentOf(data, id)
  if (agent) return labelOf(agent)
  if (id === MAIN) return ORCHESTRATOR
  if (id === YOU) return 'You'
  return F.trunc(id.replace(/^peer:/, ''), 18)
}

/** An agent's minutes as its outline row shows them: coarse while it runs, its run's length once it ended, else nothing. */
function minutesOf(agent: DeckAgent, now: number): string {
  if (agent.kind !== 'agent' && agent.kind !== 'teammate') return ''
  return isLive(agent.status) || agent.endedAt !== undefined ? elapsedOf(agent, now) : ''
}

/** "Asks: Which library?", "Needs your OK to run `npm test`" while the engine waits on the person for `id`; '' otherwise (an idle prompt is not a question). */
function waitsOf(data: DeckData, id: string): string {
  return waitsOnYou(data, id, false) ? waitLineOf(waitPhraseOf(data, id)) : ''
}

/** What an agent the engine holds, but not on you, waits on: the child of its own at work, else its background work; '' when it is not held. */
function heldOf(data: DeckData, agent: DeckAgent): string {
  if (statusOf(agent, data) !== 'waiting' || waitsOnYou(data, agent.id)) return ''
  const child = data.agents.find(one => one.id !== agent.id && (one.kind === 'agent' || one.kind === 'teammate') && isLive(one.status) && parentIdOf(data, one) === agent.id)
  return child ? `Waiting on ${labelOf(child)}` : 'Waiting on background work'
}

/** The agent's checklist as rows: the item in hand in its status colour with the live call beside it. */
function checklistVM(data: DeckData, agent: DeckAgent): ChecklistVM | null {
  const list = checklistFor(data, agent)
  if (!list) return null
  const status = shownStatusOf(agent, data)
  const live = liveCallOf(data, agent)
  const rows = list.items.map(
    (item): CheckVM => ({
      text: F.oneLine(item.text),
      status: item.state === 'done' ? 'done' : item.state === 'pending' ? 'idle' : item.state === 'failed' ? 'failed' : status,
      isCurrent: item.state === 'active',
      live: item.state === 'active' ? live : '',
    }),
  )
  return { rows, done: list.done, total: list.total, earlierDone: 0, laterTodo: 0 }
}

/** The checklist cut to `most` rows: done items folded from its start, open ones counted after; the item in hand stays. */
function foldChecklist(list: ChecklistVM, most: number): ChecklistVM {
  const rows = [...list.rows]
  let earlierDone = list.earlierDone
  while (rows.length > most && rows[0]?.status === 'done' && !rows[0].isCurrent) {
    rows.shift()
    earlierDone += 1
  }
  const laterTodo = Math.max(0, rows.length - most)
  return { ...list, rows: rows.slice(0, rows.length - laterTodo), earlierDone, laterTodo: list.laterTodo + laterTodo }
}

/** Edits grouped by file, files in first-edit order and each file's edits oldest first. */
function groupsOf(edits: readonly DeckEdit[]): DiffGroupVM[] {
  const groups: DiffGroupVM[] = []
  edits.forEach((edit, order) => {
    let group = groups.find(one => samePath(one.path, edit.path))
    if (!group) {
      group = { path: edit.path, added: 0, removed: 0, isNew: false, edits: [], last: 0 }
      groups.push(group)
    }
    group.edits.push({ id: edit.id, path: edit.path, patch: edit.patch, order })
    group.last = order
    group.added += edit.added
    group.removed += edit.removed
    group.isNew ||= edit.isNew
  })
  return groups
}

function diffsVM(data: DeckData, agent: DeckAgent): DiffsVM {
  const groups = groupsOf(data.edits.filter(edit => edit.agent === agent.id))
  const empty =
    agent.kind === 'peer'
      ? 'A peer edits outside this session; what it sends is under Talk.'
      : agent.kind === 'main'
        ? 'No edits by the Orchestrator itself.'
        : `No edits by ${labelOf(agent)} yet.`
  return { groups, empty }
}

/** Talk: every message to and from `agent` (for the Orchestrator, every message), oldest first; the newest `room.talk`. */
function talkVM(data: DeckData, agent: DeckAgent, room: DetailRoom): TalkVM {
  const isAll = agent.kind === 'main'
  const all = isAll ? data.messages : data.messages.filter(message => message.from === agent.id || message.to === agent.id)
  const shown = all.slice(-room.talk)
  const name = labelOf(agent)
  const canSend = agent.kind === 'main' || agent.kind === 'agent' || agent.kind === 'teammate'
  const how = isAll
    ? 'Sent as your next prompt; it runs when the current turn ends.'
    : canSend
      ? `Goes to ${name} through SendMessage; a finished agent wakes to answer.`
      : 'Only agents of this session take messages from here.'
  return {
    rows: shown.map(message => talkRowOf(data, message)),
    earlier: all.length - shown.length,
    empty: isAll ? 'No messages yet.' : `No messages with ${name} yet.`,
    send: canSend ? { id: agent.id, label: `To ${name}`, placeholder: isAll ? 'Your next prompt for the Orchestrator…' : `Message ${name}…` } : null,
    how,
  }
}

function talkRowOf(data: DeckData, message: DeckMessage): TalkRowVM {
  return {
    id: message.id,
    at: clockOf(message.at),
    route: `${nameOf(data, message.from)} → ${nameOf(data, message.to)}`,
    text: message.text,
    isOpen: opened.has(`msg:${message.id}`),
  }
}

function callsVM(agent: DeckAgent): CallsVM {
  const recent = agent.recent
  const counted = [F.plural(agent.tools, 'call'), agent.errors > 0 ? `${agent.errors} failed` : '', recent.length > 0 && recent.length < agent.tools ? `the last ${recent.length} below` : '']
    .filter(Boolean)
    .join(' · ')
  return {
    rows: recent.map(call => ({
      id: call.id,
      at: clockOf(call.at),
      tool: call.tool.startsWith('mcp__') ? 'MCP' : call.tool,
      what: F.oneLine(call.description || call.target),
      isLive: call.ms === undefined,
      isFailed: call.ok === false,
      took: call.ms === undefined ? 'running' : F.dur(call.ms),
    })),
    counted,
    empty: `No tool calls by ${labelOf(agent)} yet.`,
  }
}

function paneVM(data: DeckData, view: DeckView, agent: DeckAgent, room: DetailRoom): PaneVM {
  const viewPane = PANES.includes(view.agentPane) ? view.agentPane : 'edits'
  const isMain = agent.kind === 'main'
  const open = isMain ? mainPane : viewPane
  const talk = isMain ? data.messages.length : data.messages.filter(message => message.from === agent.id || message.to === agent.id).length
  return {
    open,
    isMain,
    viewPane,
    talk,
    calls: agent.tools,
    diffs: open === 'edits' ? diffsVM(data, agent) : null,
    chat: open === 'chat' ? talkVM(data, agent, room) : null,
    activity: open === 'activity' ? callsVM(agent) : null,
  }
}

function agentDetailVM(data: DeckData, view: DeckView, agent: DeckAgent, now: number, room: DetailRoom): AgentDetailVM {
  const status = shownStatusOf(agent, data)
  const scope = F.oneLine(scopeOf(agent))
  const task = F.clean(agent.prompt || agent.description).trim()
  const checklist = checklistVM(data, agent)
  const isEnded = status === 'done' || status === 'failed'
  const answer = F.clean(agent.answer ?? '').trim()
  const held = heldOf(data, agent)
  const result =
    isEnded && (answer || status === 'failed')
      ? {
          key: `result:${agent.id}`,
          text: answer || (agent.status === 'killed' ? 'Stopped before it answered.' : 'Failed before it answered.'),
          isOpen: opened.has(`result:${agent.id}`),
          isFailed: status === 'failed',
        }
      : null
  return {
    kind: 'agent',
    id: agent.id,
    header: {
      status,
      isStep: false,
      title: labelOf(agent),
      isPath: false,
      sub: scope || (agent.kind === 'peer' ? 'a session outside this one' : ''),
      fold: agent.kind === 'peer' ? null : foldStateOf(data, view, agent.id),
      id: agent.id,
      zoom: agent.kind === 'peer' ? '' : agent.id,
      isZoomed: view.zoom === agent.id,
      minutes: minutesOf(agent, now),
      added: agent.added,
      removed: agent.removed,
    },
    task: task ? { key: `task:${agent.id}`, text: task, isOpen: opened.has(`task:${agent.id}`) } : null,
    noTask: agent.kind === 'peer' ? '' : 'No task was given in words.',
    needs: waitsOf(data, agent.id),
    checklist: checklist ? foldChecklist(checklist, room.items) : null,
    now: held || (checklist === null && status === 'running' ? liveCallOf(data, agent) || nowOf(agent) : ''),
    result,
    pane: paneVM(data, view, agent, room),
    room,
  }
}

/**
 * The Orchestrator's note, as its outline row says it: waiting on you; on the
 * agents it started itself (a workflow's and the engine's own loops left
 * out) while it makes no call of its own; else at work, stopped or idle.
 */
function orchestratorSub(data: DeckData, main: DeckAgent): string {
  if (waitsOf(data, MAIN)) return 'waits on you'
  const live = data.agents.filter(
    agent => (agent.kind === 'agent' || agent.kind === 'teammate') && agent.origin !== 'workflow' && agent.origin !== 'engine' && isLive(agent.status) && parentIdOf(data, agent) === MAIN,
  ).length
  if (live > 0 && !main.current) return `waiting on ${F.plural(live, 'agent')}`
  const status = shownStatusOf(main, data)
  return status === 'running' ? 'working' : status === 'failed' ? 'stopped' : 'idle'
}

function orchestratorDetailVM(data: DeckData, view: DeckView, room: DetailRoom): OrchestratorDetailVM | EmptyDetailVM {
  const main = agentOf(data, MAIN)
  if (!main) return { kind: 'empty', text: 'The Orchestrator is not tracked yet; it shows here once the session runs.', room }
  const goal = goalFor(data)
  return {
    kind: 'orchestrator',
    header: {
      status: shownStatusOf(main, data),
      isStep: false,
      title: ORCHESTRATOR,
      isPath: false,
      sub: orchestratorSub(data, main),
      fold: foldStateOf(data, view, MAIN),
      id: MAIN,
      zoom: '',
      isZoomed: false,
      minutes: '',
      added: main.added,
      removed: main.removed,
    },
    needs: waitsOf(data, MAIN),
    goal: goal ? F.clean(goal.text).trim() : '',
    goalWords: goal ? F.oneLine(goal.text) : '',
    goalLine: goalLineOf(data),
    followUps: (goal?.followUps ?? []).map(one => ({ at: clockOf(one.at), text: F.firstLine(one.text) })),
    pane: paneVM(data, view, main, room),
    room,
  }
}

const STEP_WORDS: Record<DeckShownStatus, string> = { done: 'Done', running: 'In progress', waiting: 'Waits on you', failed: 'Failed', idle: 'Not started' }

/** The plan step `id` selects: its key, or `step:` and its key. */
function stepAt(plan: Plan | null, id: string): number {
  if (!plan || id === '') return -1
  return plan.steps.findIndex(step => step.key === id || `step:${step.key}` === id)
}

function stepDetailVM(data: DeckData, view: DeckView, plan: Plan, at: number, room: DetailRoom): StepDetailVM | EmptyDetailVM {
  const step = plan.steps[at]
  if (!step) return { kind: 'empty', text: 'That step is no longer in the plan. Pick another row of the outline.', room }
  const key = step.key

  // the step's own agents and the agents they handed work to: their edits are the step's
  const direct = step.agents.flatMap(id => {
    const agent = agentOf(data, id)
    return agent ? [agent] : []
  })
  const nested = data.agents.filter(agent => !step.agents.includes(agent.id) && (plan.links[agent.id]?.key === key || ancestorIn(data, agent, step.agents) !== ''))
  const ids = new Set([...direct, ...nested].map(agent => agent.id))
  const facts = fileFactsOf(data)
  const files = groupsOf(data.edits.filter(edit => ids.has(edit.agent))).map((group): FileRowVM => {
    const fact = facts.find(one => samePath(one.path, group.path))
    const by = [...new Set(data.edits.filter(edit => ids.has(edit.agent) && samePath(edit.path, group.path)).map(edit => edit.agent))]
    return {
      path: group.path,
      status: fileStatusOf(data, (fact?.live ?? []).filter(id => ids.has(id))),
      editors: editorsText(data, by),
      note: '',
      added: group.added,
      removed: group.removed,
      isSelected: false,
    }
  })
  return {
    kind: 'step',
    key,
    header: {
      status: step.status,
      isStep: true,
      title: F.oneLine(step.text),
      isPath: false,
      sub: `step ${at + 1} of ${plan.steps.length}`,
      fold: foldStateOf(data, view, key),
      id: key,
      zoom: key,
      isZoomed: view.zoom === key,
      minutes: '',
      added: files.reduce((sum, one) => sum + one.added, 0),
      removed: files.reduce((sum, one) => sum + one.removed, 0),
    },
    status: STEP_WORDS[step.status],
    source: plan.source,
    files,
    room,
  }
}

/** The one of `ids` that `agent` works under, its parents followed up; '' for none. */
function ancestorIn(data: DeckData, agent: DeckAgent, ids: readonly string[]): string {
  let at: DeckAgent | undefined = agent
  for (let hops = 0; at && hops < 20; hops++) {
    const parent = parentIdOf(data, at)
    if (parent === undefined || parent === MAIN) return ''
    if (ids.includes(parent)) return parent
    at = agentOf(data, parent)
  }
  return ''
}

function fileDetailVM(data: DeckData, view: DeckView, git: GitState, fileDiff: FileDiff | null, path: string, room: DetailRoom): FileDetailVM | EmptyDetailVM {
  const facts = fileFactsOf(data).find(one => samePath(one.path, path))
  const edits = data.edits.filter(edit => isEditOf(edit, path, facts?.abs ?? ''))
  const inGit = git.isRepo ? git.files.find(file => samePath(file.path, path)) : undefined
  const gitHunks = edits.length === 0 && fileDiff && samePath(fileDiff.path, path) && fileDiff.hunks.length > 0 ? fileDiff.hunks : null
  if (edits.length === 0 && !inGit && !gitHunks) return { kind: 'empty', text: `No changes to ${path} are kept. Pick another file, or open Changes for the repository's files.`, room }

  const byAgent: FileByAgentVM[] = []
  edits.forEach((edit, order) => {
    let group = byAgent.find(one => one.id === edit.agent)
    if (!group) {
      const agent = agentOf(data, edit.agent)
      group = { id: edit.agent, label: nameOf(data, edit.agent), status: agent ? shownStatusOf(agent, data) : 'idle', added: 0, removed: 0, edits: [] }
      byAgent.push(group)
    }
    group.edits.push({ id: edit.id, path: edit.path, patch: edit.patch, order })
    group.added += edit.added
    group.removed += edit.removed
  })

  const live = facts?.live ?? []
  const added = edits.length > 0 ? byAgent.reduce((sum, one) => sum + one.added, 0) : (inGit?.added ?? 0)
  const removed = edits.length > 0 ? byAgent.reduce((sum, one) => sum + one.removed, 0) : (inGit?.removed ?? 0)
  const counts = inGit ? deltaText(inGit.added, inGit.removed) : ''
  const gitNote = git.isRepo ? (inGit ? `Uncommitted in git${counts ? `: ${counts} against HEAD` : ''}.` : 'Nothing uncommitted in git: committed, or put back.') : ''
  return {
    kind: 'file',
    path,
    header: {
      status: fileStatusOf(data, live),
      isStep: false,
      title: path,
      isPath: true,
      sub: '',
      fold: null,
      id: `file:${path}`,
      zoom: '',
      isZoomed: false,
      minutes: '',
      added,
      removed,
    },
    shared: facts?.isShared ? `Shared: ${editorsText(data, live)} are both on it now.` : '',
    gitNote,
    isOpenInChanges: view.file === path,
    byAgent,
    gitHunks,
    room,
  }
}

/**
 * The detail of the outline's selection. `view.agent` names it: `file:<path>`,
 * an agent's id (`main` for the Orchestrator), or a plan step's key (or
 * `step:<key>`); '' is nothing selected, and so is what the deck no longer
 * holds (a step gone from the plan says so). `chat` is read nowhere: Talk is
 * the deck's own message log, and its field sends through `sendChat`.
 * `room` caps the lists (DETAIL_LEAN for a lean drawing).
 */
export function detailVM(
  data: DeckData,
  view: DeckView,
  git: GitState,
  chat: ChatLine[] | null,
  fileDiff: FileDiff | null,
  now: number,
  room: DetailRoom = DETAIL_ROOM,
): DetailVM {
  void chat
  const id = view.agent
  if (id === '') return { kind: 'none', room }
  if (id.startsWith('file:')) return fileDetailVM(data, view, git, fileDiff, id.slice(5), room)
  const agent = agentOf(data, id)
  if (agent && agent.kind === 'main') return orchestratorDetailVM(data, view, room)
  if (agent && agent.kind !== 'you') return agentDetailVM(data, view, agent, now, room)
  const plan = planFor(data)
  const at = stepAt(plan, id)
  if (plan && at >= 0) return stepDetailVM(data, view, plan, at, room)
  if (id.startsWith('step:')) return { kind: 'empty', text: 'That step is no longer in the plan. Pick another row of the outline.', room }
  return { kind: 'none', room }
}

// 3. The drawing.

const PANES: readonly DeckAgentPane[] = ['edits', 'chat', 'activity']

/**
 * The detail block: the selection's header, what it is, and (for an agent
 * or the Orchestrator) Diffs · Talk · Tool calls. A drawing past
 * DETAIL_CHARS is drawn again with DETAIL_LEAN's shorter lists and diffs.
 */
export function detailBlock(kit: Kit, vm: DetailVM, actions: Actions): RenderElement {
  const full = drawDetail(kit, vm, actions)
  if (treeSize(full).chars <= DETAIL_CHARS) return full
  return drawDetail(kit, { ...vm, room: leaner(vm.room) }, actions)
}

/** The smaller of each cap of `room` and DETAIL_LEAN. */
function leaner(room: DetailRoom): DetailRoom {
  return {
    diffChars: Math.min(room.diffChars, DETAIL_LEAN.diffChars),
    files: Math.min(room.files, DETAIL_LEAN.files),
    editsPerFile: Math.min(room.editsPerFile, DETAIL_LEAN.editsPerFile),
    talk: Math.min(room.talk, DETAIL_LEAN.talk),
    items: Math.min(room.items, DETAIL_LEAN.items),
    steps: Math.min(room.steps, DETAIL_LEAN.steps),
  }
}

function drawDetail(kit: Kit, vm: DetailVM, actions: Actions): RenderElement {
  const { Box } = kit
  switch (vm.kind) {
    case 'agent':
      return agentDetail(kit, vm, actions)
    case 'orchestrator':
      return orchestratorDetail(kit, vm, actions)
    case 'step':
      return stepDetail(kit, vm, actions)
    case 'file':
      return fileDetail(kit, vm, actions)
    case 'none':
      return <Box flexDirection="column" />
    default:
      return <Box paddingLeft={BAR}>{emptyLine(kit, vm.text)}</Box>
  }
}

/** The header row behind the copper rail: mark, title bold and its note dim; Fold (f), Zoom (z), minutes and `+a −r` at the right. */
function header(kit: Kit, head: HeaderVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const mark = head.status === null ? null : head.isStep ? stepMark(kit, head.status) : square(kit, head.status)
  const name = head.isPath ? F.baseName(head.title) : head.title
  const dir = head.isPath ? head.title.slice(0, Math.max(0, head.title.length - name.length)) : ''
  return (
    <Box flexDirection="row" {...rail(true, BAR)}>
      <Box width={MARK} flexShrink={0}>
        {mark}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          {dir ? <Text dimColor>{F.truncStart(dir, Math.max(8, kit.columns - Array.from(name).length - 24))}</Text> : null}
          <Text bold>{F.trunc(name, kit.columns)}</Text>
          {head.sub ? <Text dimColor>{`  ${F.trunc(head.sub, kit.columns)}`}</Text> : null}
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexShrink={0} marginLeft={2}>
        {head.fold ? <Button key="detail:fold" label={head.fold === 'open' ? 'Fold' : 'Unfold'} plain dimColor hotkey="f" onPress={() => actions.toggleFold(head.id)} /> : null}
        {head.zoom ? (
          <Button key="detail:zoom" label={head.isZoomed ? 'Unzoom' : 'Zoom'} plain dimColor hotkey="z" onPress={() => actions.zoomTo(head.isZoomed ? '' : head.zoom)} />
        ) : null}
        {head.minutes ? <Text dimColor>{head.minutes}</Text> : null}
        {delta(kit, head.added, head.removed)}
      </Box>
    </Box>
  )
}

/** One labelled row: the label dim in its column, the value beside it, and an optional control at the right. */
function field(kit: Kit, label: string, value: RenderElement, side: RenderElement | null = null): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row">
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {value}
      </Box>
      {side ? (
        <Box flexShrink={0} paddingLeft={2}>
          {side}
        </Box>
      ) : null}
    </Box>
  )
}

/** "Now: Waits on you: …" in ochre, and under it where to answer. */
function waitsField(kit: Kit, needs: string): RenderElement {
  const { Box, Text } = kit
  return field(
    kit,
    'Now',
    <Box flexDirection="column">
      <Text color={T.warn} wrap="truncate-end">
        {F.trunc(needs, kit.columns * 2)}
      </Text>
      <Text dimColor wrap="truncate-end">
        {ANSWER_WHERE}
      </Text>
    </Box>,
  )
}

/** The characters two lines of a field's value hold here (a little under, for the "more" beside it). */
function twoLines(kit: Kit): number {
  return Math.max(24, (kit.columns - LABEL_WIDTH - 8) * 2)
}

/** A text two lines long at most, with "more" beside it when there is more; open, the whole text as Markdown and "less". */
function expandable(kit: Kit, label: string, text: ExpandVM, actions: Actions, viewPane: DeckAgentPane, tone: { color?: string } = {}): RenderElement {
  const { Text, Markdown, Button } = kit
  const flat = F.oneLine(text.text)
  const room = twoLines(kit)
  const hasMore = text.isOpen || Array.from(flat).length > room
  const more = hasMore ? (
    <Button
      key={`more:${text.key}`}
      label={text.isOpen ? 'less' : 'more'}
      plain
      dimColor
      onPress={() => {
        toggleOpen(text.key)
        redrawFor(actions, viewPane)
      }}
    />
  ) : null
  const value = text.isOpen ? (
    <Markdown text={F.trunc(text.text, FULL_CHARS)} />
  ) : (
    <Text wrap="wrap" {...tone}>
      {F.trunc(flat, room)}
    </Text>
  )
  return field(kit, label, value, more)
}

function checklist(kit: Kit, list: ChecklistVM, most: number): RenderElement {
  const { Box, Text } = kit
  const folded = foldChecklist(list, most)
  const row = (mark: RenderElement, text: RenderElement) => (
    <Box flexDirection="row" columnGap={1}>
      <Box width={1} flexShrink={0}>
        {mark}
      </Box>
      {text}
    </Box>
  )
  return field(
    kit,
    'Todo',
    <Box flexDirection="column">
      {folded.earlierDone > 0 ? row(stepMark(kit, 'done'), <Text dimColor>{`${F.num(folded.earlierDone)} done`}</Text>) : null}
      {folded.rows.map(item =>
        row(
          stepMark(kit, item.status),
          <Text wrap="truncate-end">
            <Text {...(item.isCurrent ? NATIVE_TEXT.text1 : item.status === 'done' ? NATIVE_TEXT.text3 : NATIVE_TEXT.text2)}>{F.trunc(item.text, kit.columns)}</Text>
            {item.live ? <Text dimColor>{`  ${F.trunc(item.live, kit.columns)}`}</Text> : null}
          </Text>,
        ),
      )}
      {folded.laterTodo > 0 ? row(stepMark(kit, 'idle'), <Text dimColor>{`${F.num(folded.laterTodo)} more`}</Text>) : null}
    </Box>,
  )
}

/** Diffs · Talk N · Tool calls N, and the pane open under it; the Orchestrator's pick is its own, an agent's the view's. */
function paneBlock(kit: Kit, vm: AgentDetailVM | OrchestratorDetailVM, actions: Actions): RenderElement {
  return panesOf(kit, vm.pane, vm.room, actions)
}

/** What the agent page's panes read beside the deck: the time its ages count from, and what a press on one of its tabs notes (the page's own memory of it). */
export type PagePanes = { now: number; onPick: (pane: DeckAgentPane) => void }

/**
 * An agent's Diffs · Activity · Talk, as its page on the native dashboard
 * draws them, from the deck model `data` (this session's, or the sample's):
 * the web deck's names and order, a count after each (files, calls,
 * messages); the detail's own Diffs and Talk, and Activity's calls worded as
 * the dashboard words them ("edited src/a.ts", "ran npm test"), how each
 * went and when at the right, newest first. The pane open is the view's,
 * the Orchestrator's too (`openAgent(id, pane)` opens a page on one). A
 * drawing past DETAIL_CHARS is drawn again with DETAIL_LEAN's shorter lists
 * and diffs. Null for an id that names no agent. (Classic's detail keeps its
 * own switch: Diffs · Talk · Tool calls.)
 */
export function agentPanesBlock(kit: Kit, data: DeckData, view: DeckView, id: string, actions: Actions, page: PagePanes): RenderElement | null {
  const agent = agentOf(data, id)
  if (!agent || agent.kind === 'you') return null
  const full = pagePanesOf(kit, data, view, agent, DETAIL_ROOM, actions, page)
  if (treeSize(full).chars <= DETAIL_CHARS) return full
  return pagePanesOf(kit, data, view, agent, leaner(DETAIL_ROOM), actions, page)
}

/** The page's tabs, in the web deck's order, with the hotkeys that press them. */
const PAGE_TABS: readonly { id: DeckAgentPane; name: string; hotkey: string }[] = [
  { id: 'edits', name: 'Diffs', hotkey: 'd' },
  { id: 'activity', name: 'Activity', hotkey: 'a' },
  { id: 'chat', name: 'Talk', hotkey: 't' },
]

/** The cells an Activity row's outcome and age take at its right. */
const CALL_OUTCOME = 8
const CALL_AGE = 4
/** A failed call's target, as the web deck reddens it. */
const FAIL_TARGET = '#fca5a5'
const SHELLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell'])

function pagePanesOf(kit: Kit, data: DeckData, view: DeckView, agent: DeckAgent, room: DetailRoom, actions: Actions, page: PagePanes): RenderElement {
  const { Box, Text, Button } = kit
  const open = PANES.includes(view.agentPane) ? view.agentPane : 'edits'
  const groups = groupsOf(data.edits.filter(edit => edit.agent === agent.id))
  const talkVm = talkVM(data, agent, room)
  const counts: Record<DeckAgentPane, number> = { edits: groups.length, activity: agent.tools, chat: talkVm.rows.length + talkVm.earlier }
  const pick = (one: DeckAgentPane) => {
    page.onPick(one)
    actions.setAgentPane(one)
  }
  const body = open === 'chat' ? talk(kit, talkVm, room, actions, view.agentPane) : open === 'activity' ? pageCalls(kit, data, agent, page.now) : diffs(kit, { groups, empty: pageNoEdits(data, agent) }, room)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={3}>
        {PAGE_TABS.map(tab => {
          const isOn = tab.id === open
          const n = F.num(counts[tab.id])
          return (
            <Button key={`detail:${tab.id}`} label={`${tab.name} ${n}`} plain dimColor={!isOn} hotkey={tab.hotkey} onPress={() => pick(tab.id)}>
              <Text bold={isOn} underline={isOn}>
                {tab.name}
              </Text>
              <Text color={P.muted2}>{` ${n}`}</Text>
            </Button>
          )
        })}
      </Box>
      {body}
    </Box>
  )
}

/** Diffs with none: why, in the page's words. */
function pageNoEdits(data: DeckData, agent: DeckAgent): string {
  const name = labelOf(agent)
  if (agent.kind === 'peer') return 'A peer edits outside this session; what it sends is under Talk.'
  const status = shownStatusOf(agent, data)
  if (status === 'running' || status === 'waiting') return `No edits by ${name} yet: its Edit and Write patches show here the moment it makes them.`
  return agent.kind === 'main' ? 'The Orchestrator edited no files itself: its agents did.' : `${name} did not edit any files.`
}

/** How a call went, as the dashboard says it: failed, in flight (waiting on you while its agent does), or how long it took; '—' for one its agent left unfinished. */
function callOutcome(call: DeckActivity, status: DeckShownStatus): { text: string; color: string } {
  if (call.ok === false) return { text: 'failed', color: P.failText }
  if (call.ms === undefined) {
    if (status === 'waiting') return { text: 'waiting', color: P.waitText }
    if (status !== 'running') return { text: '—', color: P.muted2 }
    return { text: 'running', color: P.runText }
  }
  return { text: msText(call.ms) || 'ok', color: P.muted2 }
}

/**
 * The page's Activity: the agent's recent calls, newest first, as the
 * dashboard's Recent activity words them without the name ("edited
 * src/a.ts"; a shell call its command, "ran npm test"), how each went and
 * its age at the right; the calls before them counted above.
 */
function pageCalls(kit: Kit, data: DeckData, agent: DeckAgent, now: number): RenderElement {
  const { Box, Text } = kit
  const recent = [...agent.recent].reverse()
  if (recent.length === 0) return emptyLine(kit, `No tool calls by ${labelOf(agent)} yet: they show here as it makes them.`)
  const status = shownStatusOf(agent, data)
  const room = Math.max(12, kit.columns - CALL_OUTCOME - CALL_AGE - 2)
  return (
    <Box flexDirection="column">
      {recent.length < agent.tools ? <Text color={P.muted2}>{`The last ${F.num(recent.length)} of ${F.plural(agent.tools, 'call')}, newest first`}</Text> : null}
      {recent.map(call => {
        const target = F.oneLine((SHELLS.has(call.tool) && call.command) || call.target || '')
        const verb = verbOf(call.tool, target !== '')
        const outcome = callOutcome(call, status)
        return (
          <Box key={`call:${call.id}`} flexDirection="row" columnGap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">
                <Text color={P.muted}>{verb}</Text>
                {target ? <Text color={call.ok === false ? FAIL_TARGET : P.fg2}>{` ${F.trunc(target, Math.max(6, room - Array.from(verb).length - 1))}`}</Text> : null}
              </Text>
            </Box>
            <Box width={CALL_OUTCOME} flexShrink={0} justifyContent="flex-end">
              <Text color={outcome.color}>{outcome.text}</Text>
            </Box>
            <Box width={CALL_AGE} flexShrink={0} justifyContent="flex-end">
              <Text color={P.muted2}>{ago(call.at, now)}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function panesOf(kit: Kit, pane: PaneVM, room: DetailRoom, actions: Actions): RenderElement {
  const { Box } = kit
  const items: readonly ToggleItem<DeckAgentPane>[] = [
    { id: 'edits', label: 'Diffs', hotkey: 'd' },
    { id: 'chat', label: pane.talk > 0 ? `Talk ${F.num(pane.talk)}` : 'Talk', hotkey: 't' },
    { id: 'activity', label: pane.calls > 0 ? `Tool calls ${F.num(pane.calls)}` : 'Tool calls', hotkey: 'c' },
  ]
  const pick = (one: DeckAgentPane) => {
    if (!pane.isMain) return actions.setAgentPane(one)
    mainPane = one
    redrawFor(actions, pane.viewPane)
  }
  const body = pane.chat ? talk(kit, pane.chat, room, actions, pane.viewPane) : pane.activity ? calls(kit, pane.activity) : pane.diffs ? diffs(kit, pane.diffs, room) : null
  return (
    <Box flexDirection="column">
      {toggles(kit, 'detail', items, pane.open, pick)}
      {body}
    </Box>
  )
}

/** The selection's block: its header row, then its sections under the mark's column, a blank row between them. */
function framed(kit: Kit, head: RenderElement, first: readonly (RenderElement | null)[], ...rest: (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  const shown = first.filter(one => one !== null)
  return (
    <Box flexDirection="column">
      {head}
      <Box flexDirection="column" paddingLeft={BAR} gap={1}>
        {shown.length > 0 ? <Box flexDirection="column">{shown}</Box> : null}
        {rest}
      </Box>
    </Box>
  )
}

function agentDetail(kit: Kit, vm: AgentDetailVM, actions: Actions): RenderElement {
  const { Text } = kit
  const viewPane = vm.pane.viewPane
  return framed(
    kit,
    header(kit, vm.header, actions),
    [
      vm.task ? expandable(kit, 'Task', vm.task, actions, viewPane) : null,
      !vm.task && vm.noTask ? field(kit, 'Task', emptyLine(kit, vm.noTask)) : null,
      vm.needs ? waitsField(kit, vm.needs) : null,
      vm.checklist ? checklist(kit, vm.checklist, vm.room.items) : null,
      vm.now && !vm.needs ? field(kit, 'Now', <Text wrap="truncate-end">{F.trunc(vm.now, kit.columns)}</Text>) : null,
      vm.result ? expandable(kit, vm.result.isFailed ? 'Failed' : 'Result', vm.result, actions, viewPane, vm.result.isFailed ? { color: T.err } : {}) : null,
    ],
    paneBlock(kit, vm, actions),
  )
}

/** Whether the header showed the goal whole: then the Orchestrator's detail leaves it out. */
function isGoalCut(kit: Kit, vm: OrchestratorDetailVM): boolean {
  if (vm.goal === '') return false
  return vm.goalLine !== vm.goalWords || Array.from(vm.goalLine).length > goalChars(kit.columns)
}

function orchestratorDetail(kit: Kit, vm: OrchestratorDetailVM, actions: Actions): RenderElement {
  const { Box, Text, Markdown } = kit
  return framed(
    kit,
    header(kit, vm.header, actions),
    [
      isGoalCut(kit, vm) ? field(kit, 'Goal', <Markdown text={F.trunc(vm.goal, FULL_CHARS)} />) : null,
      vm.followUps.length > 0
        ? field(
            kit,
            'Then',
            <Box flexDirection="column">
              {vm.followUps.map(one => (
                <Text wrap="truncate-end">
                  <Text dimColor>{`${one.at}  `}</Text>
                  <Text>{F.trunc(one.text, kit.columns)}</Text>
                </Text>
              ))}
            </Box>,
          )
        : null,
      vm.needs ? waitsField(kit, vm.needs) : null,
    ],
    paneBlock(kit, vm, actions),
  )
}

function stepDetail(kit: Kit, vm: StepDetailVM, actions: Actions): RenderElement {
  const { Box, Text } = kit
  const cols = fileColsOf(kit)
  return framed(
    kit,
    header(kit, vm.header, actions),
    [
      field(
        kit,
        'Status',
        <Text wrap="truncate-end">
          <Text>{vm.status}</Text>
          <Text dimColor>{`  plan from ${vm.source}`}</Text>
        </Text>,
      ),
    ],
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>Files</Text>
        {vm.files.length > 0 ? <Text dimColor>{`  ${F.num(vm.files.length)} changed`}</Text> : null}
      </Text>
      {vm.files.length === 0 ? emptyLine(kit, 'No files changed for this step yet.') : null}
      {vm.files.map(file => fileLine(kit, cols, file, `detail:file:${file.path}`, () => actions.select(`file:${file.path}`)))}
    </Box>,
  )
}

/** Code blocks for `edits`, the newest drawn first from `budget` (what is left after them is noted as cut), keyed by edit. */
function blocksOf(kit: Kit, edits: readonly DiffEditVM[], budget: { chars: number }): Map<string, RenderElement[]> {
  const blocks = new Map<string, RenderElement[]>()
  for (const edit of [...edits].sort((a, b) => b.order - a.order)) {
    blocks.set(edit.id, budget.chars < LEAST_DIFF ? [emptyLine(kit, 'Cut to fit the pane.')] : codeBlocks(kit, hunksOf(edit.patch), edit.path, budget))
  }
  return blocks
}

function fileDetail(kit: Kit, vm: FileDetailVM, actions: Actions): RenderElement {
  const { Box, Text, Button } = kit
  const budget = { chars: vm.room.diffChars }
  const groups = vm.byAgent.map(group => ({ group, kept: group.edits.slice(-Math.max(1, vm.room.editsPerFile)) }))
  const blocks = blocksOf(
    kit,
    groups.flatMap(one => one.kept),
    budget,
  )

  return framed(
    kit,
    header(kit, vm.header, actions),
    [
      vm.shared ? (
        <Text color={T.warn} wrap="truncate-end">
          {vm.shared}
        </Text>
      ) : null,
      vm.gitNote ? (
        <Text dimColor wrap="truncate-end">
          {vm.gitNote}
        </Text>
      ) : null,
      <Box flexDirection="row">
        <Button
          key="detail:changes"
          label="Open in Changes"
          plain
          onPress={() => {
            if (!vm.isOpenInChanges) actions.selectFile(vm.path)
            actions.setTab('changes')
          }}
        />
      </Box>,
    ],
    vm.byAgent.length === 0 && vm.gitHunks ? (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          No agent's edit of it is kept; git's diff against HEAD:
        </Text>
        {codeBlocks(kit, vm.gitHunks, vm.path, budget)}
      </Box>
    ) : null,
    vm.byAgent.length === 0 && !vm.gitHunks ? emptyLine(kit, 'No agent edited this file in this session; its git diff is in Changes.') : null,
    ...groups.map(({ group, kept }) => (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Box width={1} flexShrink={0}>
            {square(kit, group.status)}
          </Box>
          <Button key={`detail:agent:${group.id}`} label={group.label} plain onPress={() => actions.select(group.id)} />
          <Text dimColor>{F.plural(group.edits.length, 'edit')}</Text>
          {delta(kit, group.added, group.removed)}
        </Box>
        {group.edits.length > kept.length ? emptyLine(kit, `${F.plural(group.edits.length - kept.length, 'earlier edit')} not shown.`) : null}
        {kept.flatMap(edit => blocks.get(edit.id) ?? [])}
      </Box>
    )),
  )
}

/** Diffs: each file's header row and its exact patches; the files edited last are drawn from the budget first, all shown in first-edit order. */
function diffs(kit: Kit, vm: DiffsVM, room: DetailRoom): RenderElement {
  const { Box } = kit
  if (vm.groups.length === 0) return emptyLine(kit, vm.empty)

  const latest = [...vm.groups].sort((a, b) => b.last - a.last).slice(0, Math.max(1, room.files))
  const shown = vm.groups.filter(group => latest.includes(group))
  const kept = new Map(shown.map(group => [group, group.edits.slice(-Math.max(1, room.editsPerFile))]))
  const budget = { chars: room.diffChars }
  const blocks = blocksOf(
    kit,
    shown.flatMap(group => kept.get(group) ?? []),
    budget,
  )
  const earlier = vm.groups.length - shown.length

  return (
    <Box flexDirection="column" gap={1}>
      {earlier > 0 ? emptyLine(kit, `${F.plural(earlier, 'file')} edited earlier not shown, to fit the pane.`) : null}
      {shown.map(group => {
        const edits = kept.get(group) ?? []
        return (
          <Box flexDirection="column">
            {diffHeader(kit, group)}
            {group.edits.length > edits.length ? emptyLine(kit, `${F.plural(group.edits.length - edits.length, 'earlier edit')} not shown.`) : null}
            {edits.flatMap(edit => blocks.get(edit.id) ?? [])}
          </Box>
        )
      })}
    </Box>
  )
}

/** A diff file's header row: its directory dim (cut from the start), its name bold, `+a −r`, and "new" for a file it made. */
function diffHeader(kit: Kit, group: DiffGroupVM): RenderElement {
  const { Box, Text } = kit
  const name = F.baseName(group.path)
  const dir = group.path.slice(0, Math.max(0, group.path.length - name.length))
  return (
    <Box flexDirection="row" columnGap={2}>
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          {dir ? <Text dimColor>{F.truncStart(dir, Math.max(6, kit.columns - Array.from(name).length - 16))}</Text> : null}
          <Text bold>{name}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexShrink={0}>
        {delta(kit, group.added, group.removed)}
        {group.isNew ? <Text dimColor>new</Text> : null}
      </Box>
    </Box>
  )
}

/**
 * Talk: two lines a message, so a narrow pane reads them whole: who to whom
 * (a press opens the message) and its time, then its first line under it,
 * or the whole of it once opened; then the field that sends.
 */
function talk(kit: Kit, vm: TalkVM, room: DetailRoom, actions: Actions, viewPane: DeckAgentPane): RenderElement {
  const { Box, Text, Button, Markdown, Input } = kit
  const rows = vm.rows.slice(-Math.max(1, room.talk))
  const earlier = vm.earlier + vm.rows.length - rows.length
  const routeRoom = Math.max(12, kit.columns - BAR - 10)
  const textRoom = Math.max(12, kit.columns - BAR - 2)
  const send = vm.send

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {rows.length === 0 ? emptyLine(kit, vm.empty) : null}
        {earlier > 0 ? <Text dimColor>{`${F.num(earlier)} earlier`}</Text> : null}
        {rows.map(row => (
          <Box flexDirection="column">
            <Box flexDirection="row" columnGap={2}>
              <Box flexShrink={1}>
                <Button
                  key={`msg:${row.id}`}
                  label={F.trunc(row.route, routeRoom)}
                  plain
                  dimColor={!row.isOpen}
                  onPress={() => {
                    toggleOpen(`msg:${row.id}`)
                    redrawFor(actions, viewPane)
                  }}
                />
              </Box>
              <Box flexShrink={0}>
                <Text dimColor>{row.at}</Text>
              </Box>
            </Box>
            <Box paddingLeft={2}>
              {row.isOpen ? (
                <Markdown text={F.trunc(F.clean(row.text), FULL_CHARS)} />
              ) : (
                <Text dimColor wrap="truncate-end">
                  {F.trunc(F.firstLine(row.text), textRoom) || '—'}
                </Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
      {send && Input ? (
        <Box flexDirection="column">
          <Input
            key={`chat:${send.id}`}
            label={send.label}
            placeholder={send.placeholder}
            value=""
            submitLabel="send"
            onSubmit={text => {
              const said = text.trim()
              if (said) actions.sendChat(send.id, said)
            }}
          />
          <Text dimColor wrap="truncate-end">
            {vm.how}
          </Text>
        </Box>
      ) : (
        emptyLine(kit, vm.how)
      )}
    </Box>
  )
}

/** Tool calls: the recent calls, newest last; the one in flight green, a failed one red. */
function calls(kit: Kit, vm: CallsVM): RenderElement {
  const { Box, Text } = kit
  if (vm.rows.length === 0) return emptyLine(kit, vm.empty)
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {vm.counted}
      </Text>
      {vm.rows.map(call => (
        <Box flexDirection="row" columnGap={1}>
          <Box width={1} flexShrink={0}>
            {call.isLive ? square(kit, 'running') : call.isFailed ? square(kit, 'failed') : <Text dimColor>■</Text>}
          </Box>
          <Box width={5} flexShrink={0}>
            <Text dimColor>{call.at}</Text>
          </Box>
          <Box width={12} flexShrink={0}>
            <Text wrap="truncate-end">{call.tool}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            {call.what ? (
              <Text dimColor wrap="truncate-end">
                {F.trunc(call.what, kit.columns)}
              </Text>
            ) : null}
          </Box>
          <Box flexShrink={0}>
            <Text dimColor>{call.took}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
