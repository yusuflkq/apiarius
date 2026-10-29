/**
 * The deck's data: every agent of the session (you, the main loop, each
 * subagent or teammate, outside peers), what each is doing now, the exact
 * edits each made, the messages between them, and per-minute activity.
 *
 * Pure: the hooks module owns the one live copy and mutates it through
 * these helpers; nothing here reaches the engine.
 */
import type {
  DeckAck,
  DeckActivity,
  DeckAgent,
  DeckAgentPane,
  DeckData,
  DeckDuring,
  DeckEdit,
  DeckFile,
  DeckGoal,
  DeckKind,
  DeckMapView,
  DeckMessage,
  DeckMessageKind,
  DeckNeeds,
  DeckOrigin,
  DeckPending,
  DeckQuestion,
  DeckShownStatus,
  DeckStatus,
  DeckStepHow,
  DeckStepStatus,
  DeckTab,
  DeckTask,
  DeckTodoItem,
  DeckView,
  DeckView2,
  DeckWord,
  DeckWorkflow,
} from '../types'
import * as AV from '../web/avatars.mjs'
import { baseName, dur, firstLine, hash, oneLine, plural, trunc, truncStart } from './format'
import type { GitState } from './git'
import * as L from './lane'

export const MAIN = 'main'
export const YOU = 'you'
/** What the deck calls the main loop (internal id `main`) everywhere it draws it. */
export const ORCHESTRATOR = 'Orchestrator'
/** The sender of what Claude Code itself says: its notification to you, a background task's notification to the main loop. */
export const ENGINE = 'engine'
/** What the deck calls that sender, Claude Code itself, where it draws it. */
export const ENGINE_NAME = 'Claude Code'
/**
 * The snapshot's shape. Kept at 2 on purpose: a reload restores the session's
 * agents, and `healData` / `healView` fill or fix what an older shape lacks.
 */
export const SNAPSHOT_VERSION = 2

/** The pane's tabs, in the order the tab row draws them (keys 1 to 4). */
export const TABS: readonly DeckTab[] = ['dashboard', 'org', 'plan', 'changes']

/**
 * The views off the tab row, kept so nothing is lost: Stats, and Classic
 * (`agents`: the summary and outline of earlier builds). `/deck stats` and
 * `/deck classic` still open them, and a saved view on one keeps it.
 */
export const UNLISTED_TABS: readonly DeckTab[] = ['stats', 'agents']

/** Every tab a view may be on: the tab row's, then the unlisted. */
const ALL_TABS: readonly DeckTab[] = [...TABS, ...UNLISTED_TABS]
export const AGENT_PANES: readonly DeckAgentPane[] = ['activity', 'edits', 'chat']
export const MAP_VIEWS: readonly DeckMapView[] = ['tree', 'wire']

/**
 * Earlier builds' tabs, by the tab that took each one's place, so a saved
 * view or a typed `/deck overview` still lands; and `classic`, the name the
 * Agents tab went by on the tab row.
 */
export const OLD_TABS: ReadonlyMap<string, DeckTab> = new Map<string, DeckTab>([
  ['overview', 'stats'],
  ['diffs', 'changes'],
  ['commits', 'changes'],
  ['graph', 'agents'],
  ['flow', 'agents'],
  ['classic', 'agents'],
])

/** The tab `name` is: one of the tab row's or the unlisted, or the one an earlier build's name became; undefined for anything else. */
export function tabNamed(name: unknown): DeckTab | undefined {
  if (typeof name !== 'string') return undefined
  return ALL_TABS.find(tab => tab === name) ?? OLD_TABS.get(name)
}

/** The tab a `/deck` argument asks for: a tab's name or its start (`c`), the tab row's before the unlisted, today's names before earlier builds'. */
export function tabFor(arg: string): DeckTab | undefined {
  const wanted = arg.trim().toLowerCase()
  if (wanted === '') return undefined
  const tab = ALL_TABS.find(one => one.startsWith(wanted))
  if (tab) return tab
  for (const [old, now] of OLD_TABS) if (old.startsWith(wanted)) return now
  return undefined
}

export const LIMITS = {
  recent: 14,
  edits: 160,
  messages: 200,
  minutes: 240,
  patchChars: 3200,
  /** An agent's task and its result, in characters: whole up to what the web deck shows (web/CONTRACT.md: task 2000, result 4000). */
  promptChars: 2000,
  answerChars: 4000,
  messageChars: 700,
  /** A cut message's whole text, kept for the web deck's `messages/<id>.md` until written, on the newest `fullTexts` that have one. */
  fullChars: 20_000,
  fullTexts: 20,
  /** The calls held on the person at once, and the web deck's command outcomes kept. */
  pending: 20,
  acks: 50,
  agents: 80,
  /** The goals a snapshot keeps, and each one's follow-ups. */
  goals: 20,
  followUps: 10,
  goalChars: 2000,
  headlineChars: 80,
  /** The task board's tasks. */
  board: 200,
  /** The items of one agent's checklist. */
  todos: 50,
  /** The files edited. */
  files: 500,
  workflows: 10,
  /** Claude Code's notifications that wait on the person, kept at once. */
  needs: 20,
  /** The approved plan's words, in characters. */
  planChars: 20_000,
  /** The steps a plan is cut to. */
  steps: 30,
  /** An agent's label, in characters. */
  label: 18,
  /** A label's characters when the cut at `label` keeps fewer than two words or very little (`cutAtWord`). */
  labelStretch: 24,
  /** The words and thoughts of its steps one loop keeps (`DeckAgent.words`), and each one's characters. */
  words: 60,
  wordChars: 4000,
} as const

export const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']
export const SHELL_TOOLS: readonly string[] = ['Bash', 'PowerShell']
/** Calls that keep the agent's own lists: never "what it's doing", which their items say instead. */
export const LIST_TOOLS: readonly string[] = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']
/** The task board's own calls. */
export const TASK_TOOLS: readonly string[] = ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']

/** Live: at work or about to be (a placeholder `starting`), or held on something. */
export function isLive(status: DeckStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'pending' || status === 'starting'
}

export function isEnded(status: DeckStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

export function newAgent(
  id: string,
  kind: DeckKind,
  name: string,
  now: number,
  extra: Partial<DeckAgent> = {},
): DeckAgent {
  return {
    id,
    kind,
    name,
    type: kind,
    description: '',
    prompt: '',
    status: 'idle',
    startedAt: now,
    lastAt: now,
    tools: 0,
    errors: 0,
    toolCounts: {},
    files: [],
    added: 0,
    removed: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    requests: 0,
    recent: [],
    ...extra,
  }
}

export function emptyData(now: number): DeckData {
  return {
    startedAt: now,
    agents: [
      newAgent(YOU, 'you', 'You', now, { type: 'person' }),
      newAgent(MAIN, 'main', 'main', now, { type: 'main loop', parentId: YOU }),
    ],
    messages: [],
    edits: [],
    minutes: [],
    commitsBy: {},
    tasks: {},
    turns: 0,
    turnMs: 0,
    goals: [],
    board: {},
    files: {},
    workflows: [],
    pending: [],
    acks: [],
    needs: [],
  }
}

/** A fresh view: the Dashboard, no agent page over it, nothing selected in Classic (no detail until a row is picked), agents' panes on Diffs. */
export function defaultView(): DeckView {
  return {
    tab: 'dashboard',
    agent: '',
    agentPane: 'edits',
    file: '',
    commit: '',
    filter: 'all',
    showFiles: true,
    isBandHidden: false,
    avatarStyle: AV.DEFAULT_STYLE,
    map: 'tree',
    message: '',
    folded: [],
    zoom: '',
    isDetailsOpen: false,
    page: '',
    isDemo: false,
    planOpen: [],
    collapsed: [],
    v2: defaultView2(),
  }
}

/** The v2 screens' own state as a fresh pane has it: the Dashboard (`now`), nothing unfolded, all of Chat, nothing cleared. */
export function defaultView2(): DeckView2 {
  return { tab: 'now', openFolds: [], chatFilter: '', isInspectOpen: false, cleared: [], clearedAt: 0 }
}

/** What Org shows, as `view.v2.orgView` keeps it: the Timeline once picked, else the chart (the field left out). */
function orgViewOf(value: unknown, current: DeckView2['orgView']): Pick<DeckView2, 'orgView'> {
  const view = value === 'timeline' || value === 'chart' ? value : current
  return view === 'timeline' ? { orgView: 'timeline' } : {}
}

/** What an agent page's Activity lists, as `view.v2.activityView` keeps it: its calls alone once "Calls only" is picked, else its calls with their words (the field left out). */
function activityViewOf(value: unknown, current: DeckView2['activityView']): Pick<DeckView2, 'activityView'> {
  const view = value === 'calls' || value === 'words' ? value : current
  return view === 'calls' ? { activityView: 'calls' } : {}
}

/** The agents `view.v2.cleared` keeps at most, the oldest dropped first. */
const CLEARED_KEPT = 500

/** The fold ids of the "N finished" rows: the Dashboard's and Chat's members'. */
export const FINISHED_FOLD = { now: 'finished:now', chat: 'finished:chat' } as const

/**
 * "Clear finished": the agents in `ids` hidden from the Dashboard, Chat's
 * members and Everyone, and Org from `at` on, with those hidden already;
 * nothing in Claude Code changes.
 */
export function clearedWith(current: DeckView2, ids: readonly string[], at: number): DeckView2 {
  return { ...current, cleared: [...new Set([...current.cleared, ...ids])].slice(-CLEARED_KEPT), clearedAt: at }
}

/** The v2 tabs, in their keys' order (1 Dashboard, 2 Chat, 3 Org, 4 Changes, 5 Inspect, 6 Settings); the Dashboard's id stays `now`. */
export const V2_TABS: readonly DeckView2['tab'][] = ['now', 'chat', 'org', 'changes', 'inspect', 'settings']

/** The v2 tab a tab of either build is: Changes, Chat, Org, Inspect and Settings stay as they are; Stats goes to Inspect (its Spend); the Dashboard, Plan and Classic fold into the Dashboard (`now`). */
export function v2TabOf(tab: DeckTab | DeckView2['tab']): DeckView2['tab'] {
  if (tab === 'stats') return 'inspect'
  return tab === 'changes' || tab === 'chat' || tab === 'org' || tab === 'inspect' || tab === 'settings' ? tab : 'now'
}

/** The names `/deck` takes for a v2 tab beside the tabs' own ids: the Dashboard's (its id is `now`), and Help, which Settings holds. */
export const V2_TAB_NAMES: ReadonlyMap<string, DeckView2['tab']> = new Map<string, DeckView2['tab']>([
  ['dashboard', 'now'],
  ['help', 'settings'],
])

/**
 * The v2 tab a `/deck` argument asks for: `now` (or `dashboard`), `chat`,
 * `org`, `changes`, `inspect` or `settings` (or `help`), or the start of
 * one (`c` is Chat, `i` Inspect); else an earlier build's tab, where it went
 * (`v2TabOf` of `tabFor`: `stats` is Inspect). Undefined for anything else.
 */
export function v2TabFor(arg: string): DeckView2['tab'] | undefined {
  const wanted = arg.trim().toLowerCase()
  if (wanted === '') return undefined
  const tab = V2_TABS.find(one => one.startsWith(wanted))
  if (tab) return tab
  for (const [name, named] of V2_TAB_NAMES) if (name.startsWith(wanted)) return named
  const old = tabFor(wanted)
  return old ? v2TabOf(old) : undefined
}

/** The fold rows `view.v2.openFolds` keeps open at most, the oldest dropped first. */
const OPEN_FOLDS_KEPT = 50

/**
 * The v2 screens' state with `patch` laid over it, each field checked as a
 * reload's would be (a tab of the five, fold ids and a filter as strings,
 * the oldest folds dropped past 50); what `patch` leaves out stays.
 *
 * Inspect is a tab of its own now: `isInspectOpen` stays false, and a
 * `true` (a view an earlier build saved) opens Inspect.
 */
export function view2With(current: DeckView2, patch: unknown): DeckView2 {
  const p = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
  return {
    tab: p.isInspectOpen === true ? 'inspect' : oneOf(p.tab, V2_TABS, current.tab),
    openFolds: Array.isArray(p.openFolds) ? [...new Set(p.openFolds.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(-OPEN_FOLDS_KEPT) : current.openFolds,
    chatFilter: typeof p.chatFilter === 'string' ? p.chatFilter : current.chatFilter,
    isInspectOpen: false,
    cleared: Array.isArray(p.cleared) ? [...new Set(p.cleared.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(-CLEARED_KEPT) : current.cleared,
    clearedAt: typeof p.clearedAt === 'number' && Number.isFinite(p.clearedAt) && p.clearedAt >= 0 ? p.clearedAt : current.clearedAt,
    ...orgViewOf(p.orgView, current.orgView),
    ...activityViewOf(p.activityView, current.activityView),
  }
}

/** The outline folds `view.folded` keeps at most, the oldest dropped first. */
const FOLDS_KEPT = 200

/** The Plan tab's open rows and texts `view.planOpen` keeps at most, the oldest dropped first. */
const PLAN_OPEN_KEPT = 100

/**
 * The Plan tab's disclosures (`view.planOpen`) with `id` opened, or folded
 * when `isOpen` is false; toggled when `isOpen` is left out. A reopened one
 * moves to the end, so the oldest go first past PLAN_OPEN_KEPT.
 */
export function planOpenWith(open: readonly string[], id: string, isOpen?: boolean): string[] {
  const rest = open.filter(one => one !== id)
  const isWanted = isOpen ?? !open.includes(id)
  return (isWanted && id !== '' ? [...rest, id] : rest).slice(-PLAN_OPEN_KEPT)
}

/** A plan step's id in `DeckView.planOpen`. */
export function stepOpenId(key: string): string {
  return `step:${key}`
}

/** The key of a plan step's row in the Plan tab's drawing: what `openStep` scrolls to. */
export function stepRowKey(key: string): string {
  return `plan:step:${key}`
}

/** The sections `view.collapsed` keeps folded at most, the oldest dropped first. */
const COLLAPSED_KEPT = 50

/**
 * The sections folded to their heading (`view.collapsed`) with `id` folded,
 * or opened again when `isFolded` is false; toggled when it is left out. A
 * section folded again moves to the end, so the oldest go first past
 * COLLAPSED_KEPT.
 */
export function collapsedWith(collapsed: readonly string[], id: string, isFolded?: boolean): string[] {
  const rest = collapsed.filter(one => one !== id)
  const isWanted = isFolded ?? !collapsed.includes(id)
  return (isWanted && id !== '' ? [...rest, id] : rest).slice(-COLLAPSED_KEPT)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * A view restored from a snapshot, field by field: one missing, of another
 * type, or naming a tab or map view this build lacks takes its default; an
 * earlier build's tab name becomes the tab that took its place (`tabNamed`).
 * With `data`, an agent or a message it no longer holds is let go too; a
 * selected file (`file:…`) or plan step (its key, or `step:` and its key)
 * stays while it is a step of the plan, or names itself one.
 */
export function healView(value: unknown, data?: DeckData): DeckView {
  const base = defaultView()
  if (!value || typeof value !== 'object') return base
  const v = value as Record<string, unknown>
  const text = (field: unknown, fallback: string) => (typeof field === 'string' ? field : fallback)
  const flag = (field: unknown, fallback: boolean) => (typeof field === 'boolean' ? field : fallback)
  const view: DeckView = {
    tab: tabNamed(v.tab) ?? base.tab,
    agent: text(v.agent, base.agent),
    agentPane: oneOf(v.agentPane, AGENT_PANES, base.agentPane),
    file: text(v.file, base.file),
    commit: text(v.commit, base.commit),
    filter: text(v.filter, base.filter),
    showFiles: flag(v.showFiles, base.showFiles),
    isBandHidden: flag(v.isBandHidden, base.isBandHidden),
    avatarStyle: AV.styleOf(v.avatarStyle),
    map: oneOf(v.map, MAP_VIEWS, base.map),
    message: text(v.message, base.message),
    // the outline's folds: strings only, each once, the newest kept
    folded: Array.isArray(v.folded) ? [...new Set(v.folded.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(-FOLDS_KEPT) : base.folded,
    zoom: text(v.zoom, base.zoom),
    isDetailsOpen: flag(v.isDetailsOpen, base.isDetailsOpen),
    page: text(v.page, base.page),
    isDemo: flag(v.isDemo, base.isDemo),
    // the Plan tab's open rows and texts: strings only, each once, the newest kept
    planOpen: Array.isArray(v.planOpen) ? [...new Set(v.planOpen.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(-PLAN_OPEN_KEPT) : base.planOpen,
    // the sections folded to their heading: strings only, each once, the newest kept
    collapsed: Array.isArray(v.collapsed) ? [...new Set(v.collapsed.filter((one): one is string => typeof one === 'string' && one !== ''))].slice(-COLLAPSED_KEPT) : base.collapsed,
    // the v2 screens' own, each field as it would be set
    v2: view2With(base.v2, v.v2),
  }
  if (data) {
    const isRow = (id: string) => id.startsWith('file:') || id.startsWith('step:') || planOf(data).steps.some(step => step.key === id)
    if (view.agent !== '' && !agentOf(data, view.agent) && !isRow(view.agent)) view.agent = base.agent
    // an agent page of this session's names one it holds; the sample's agents are the sample's
    if (view.page !== '' && !view.isDemo && !agentOf(data, view.page)) view.page = base.page
    if (view.message !== '' && !data.messages.some(message => message.id === view.message)) view.message = ''
  }
  return view
}

export function agentOf(data: DeckData, id: string): DeckAgent | undefined {
  return data.agents.find(agent => agent.id === id)
}

/**
 * The agent under `id`, made on first sight (a subagent seen before its spawn
 * was); `origin` classifies a row made here (see `seeLoop`).
 */
export function ensureAgent(data: DeckData, id: string, now: number, origin?: DeckOrigin): DeckAgent {
  const found = agentOf(data, id)
  if (found) return found

  const made = newAgent(id, 'agent', `agent-${id.slice(0, 6)}`, now, {
    type: 'subagent',
    parentId: MAIN,
    status: 'running',
    ...(origin !== undefined ? { origin } : {}),
  })
  data.agents.push(made)
  pruneAgents(data)
  return made
}

/** Over the cap: the oldest ended agents go first, then the oldest background loops, whatever their state. */
function pruneAgents(data: DeckData) {
  if (data.agents.length <= LIMITS.agents) return
  const isKept = (agent: DeckAgent) => agent.kind === 'you' || agent.kind === 'main'
  const ended = data.agents.filter(agent => !isKept(agent) && isEnded(agent.status))
  const background = data.agents.filter(agent => !isKept(agent) && !isEnded(agent.status) && isFolded(agent))
  const drop = new Set([...ended, ...background].slice(0, data.agents.length - LIMITS.agents).map(agent => agent.id))
  data.agents = data.agents.filter(agent => !drop.has(agent.id))
}

// Labels: one short name per agent, fixed when it spawns.

/** The name `ensureAgent` makes up for a loop it knows nothing of. */
function isMadeUpName(agent: DeckAgent): boolean {
  return agent.name === `agent-${agent.id.slice(0, 6)}`
}

/** Words a cut never ends on: there they leave the phrase hanging ("Recover goal and"). */
const HANGING_WORDS: ReadonlySet<string> = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'to', 'for', 'with', 'in', 'on', 'from', 'into', 'by', 'as'])
/** A cut shorter than this keeps very little, and may run on to its stretch. */
const SCANT_CHARS = 10

/** The whole words of `line` (one line) that fit in `max` characters, less the punctuation and the hanging words they end on; '' when none fits. */
function wordsWithin(line: string, max: number): string {
  const words: string[] = []
  let length = -1
  for (const word of line.split(' ')) {
    length += 1 + Array.from(word).length
    if (length > max) break
    words.push(word)
  }
  for (let last = words.pop(); last !== undefined; last = words.pop()) {
    const bare = last.replace(/[,;:.(\-–—]+$/, '')
    if (bare !== '' && !HANGING_WORDS.has(bare.toLowerCase())) return [...words, bare].join(' ')
  }
  return ''
}

/** Whether a cut keeps very little: fewer than two words, or under SCANT_CHARS characters. */
function isScant(cut: string): boolean {
  return cut.split(' ').length < 2 || Array.from(cut).length < SCANT_CHARS
}

/**
 * `text` on one line in at most `max` characters, cut after a whole word:
 * never on punctuation, nor on a word that leaves the phrase hanging (and,
 * or, the, a, an, of, to, for, with, in, on, from, into, by, as). When that
 * keeps fewer than two words or under ten characters, the cut may run on to
 * `stretch` characters. Text within `max` is kept whole; a first word too
 * long for either is cut at `max` with an ellipsis.
 */
export function cutAtWord(text: string, max: number, stretch = max): string {
  const line = oneLine(text)
  if (Array.from(line).length <= max) return line
  const cut = wordsWithin(line, max)
  const kept = stretch > max && isScant(cut) ? wordsWithin(line, stretch) : cut
  return kept !== '' ? kept : trunc(line, max)
}

/** `words` cut as a label: LIMITS.label characters, LIMITS.labelStretch when that keeps very little; `less` held back for a sibling's " 2". */
function labelCut(words: string, less = 0): string {
  return cutAtWord(words, LIMITS.label - less, LIMITS.labelStretch - less)
}

/**
 * How labels were cut before they kept phrases whole: whole words up to 18
 * characters, whatever word came last. Kept only to know such a label again
 * in a restored snapshot (`isOldCut`).
 */
function oldCut(words: string): string {
  const line = oneLine(words)
  if (Array.from(line).length <= LIMITS.label) return line
  let out = ''
  for (const word of line.split(' ')) {
    const next = out === '' ? word : `${out} ${word}`
    if (Array.from(next).length > LIMITS.label) break
    out = next
  }
  out = out.replace(/[\s,;:.(\-–—]+$/, '')
  return out !== '' ? out : trunc(line, LIMITS.label)
}

/** A label fitted to `room` characters (a drawing's column): cut after a whole word as labels are, a sibling's " 2" kept. */
export function fitLabel(label: string, room: number): string {
  if (Array.from(label).length <= room) return label
  const suffix = / \d+$/.exec(label)?.[0] ?? ''
  return `${cutAtWord(label.slice(0, label.length - suffix.length), Math.max(1, room - suffix.length))}${suffix}`
}

/**
 * A description's leading marker and the rest: "Phase A: data, banner" is
 * `{ marker: 'Phase A', scope: 'data, banner' }`. The marker is at most 18
 * characters and three words, before a colon and a space, or a spaced dash.
 */
export function splitMarker(description: string): { marker: string; scope: string } | undefined {
  const found = /^([^:]{1,18}?)\s*(?::\s+|\s[-–—]\s+)(\S.*)$/.exec(oneLine(description))
  if (!found) return undefined
  const marker = (found[1] ?? '').trim()
  const scope = (found[2] ?? '').trim()
  if (marker === '' || scope === '' || marker.split(' ').length > 3) return undefined
  return { marker, scope }
}

/**
 * The label an agent's own words give it, cut by `cut`; the words it is cut
 * from (its name, else its description's leading marker, else its
 * description); and the scope beside it. Undefined while it has no words.
 */
function labelParts(agent: DeckAgent, cut: (words: string) => string = labelCut): { label: string; words: string; scope: string } | undefined {
  const name = agent.name.trim()
  const named = name !== '' && !isMadeUpName(agent) ? name : ''
  const description = oneLine(agent.description)
  const marked = splitMarker(description)
  if (named !== '') {
    const scope = marked ? marked.scope : description
    return { label: cut(named), words: named, scope: scope === named ? '' : scope }
  }
  if (marked) return { label: cut(marked.marker), words: marked.marker, scope: marked.scope }
  if (description !== '') {
    const label = cut(description)
    return { label, words: description, scope: label === description ? '' : description }
  }
  return undefined
}

/** A label for a loop with no words of its own: never its id. */
function fallbackLabel(agent: DeckAgent): string {
  if (agent.origin === 'workflow') return 'Workflow agent'
  if (agent.origin === 'engine') return 'Housekeeping'
  const type = agent.type.trim()
  if (type !== '' && type !== 'subagent' && type !== agent.id) return labelCut(type)
  return agent.kind === 'teammate' ? 'Teammate' : 'Agent'
}

/**
 * Fixes the agent's label once it has words to make one from (its name, else
 * its description's leading marker, else its description), cut after a whole
 * word that leaves no phrase hanging (`cutAtWord`): at most 18 characters, up
 * to 24 when that keeps fewer than two words or very little. Never changed
 * after. A sibling (same parent) already labelled the same makes it "Phase A
 * 2", then "Phase A 3".
 */
export function fixLabel(data: DeckData, agent: DeckAgent): void {
  if (agent.label !== undefined || (agent.kind !== 'agent' && agent.kind !== 'teammate')) return
  const parts = labelParts(agent)
  if (!parts) return
  const parent = parentIdOf(data, agent)
  const taken = new Set<string>()
  for (const other of data.agents) {
    if (other !== agent && other.label !== undefined && parentIdOf(data, other) === parent) taken.add(other.label.toLowerCase())
  }
  let label = parts.label
  for (let n = 2; taken.has(label.toLowerCase()) && n < 1000; n++) {
    const suffix = ` ${n}`
    label = `${labelCut(parts.words, suffix.length)}${suffix}`
  }
  agent.label = label
  if (parts.scope !== '') agent.scope = trunc(parts.scope, 200)
}

/**
 * Whether the agent's label is the one an earlier build's cut (`oldCut`) made
 * of its words as they stand now, a sibling's " 2" after it, where today's cut
 * makes another. Such a label is made again on restore (`healData`); one whose
 * words changed since it was fixed stays as it is.
 */
function isOldCut(agent: DeckAgent): boolean {
  const label = agent.label
  if (label === undefined) return false
  const old = labelParts(agent, oldCut)?.label
  if (old === undefined || old === labelParts(agent)?.label) return false
  if (label === old) return true
  const suffix = / \d+$/.exec(label)?.[0]
  return suffix !== undefined && label === `${Array.from(old).slice(0, LIMITS.label - suffix.length).join('').trimEnd()}${suffix}`
}

/**
 * The agent's label, never an id: the one fixed at its spawn (`fixLabel`),
 * else what its words give, else its type; the main loop is the Orchestrator.
 * At most 18 characters, 24 when the cut at 18 keeps very little.
 */
export function labelOf(agent: DeckAgent): string {
  if (agent.kind === 'main') return ORCHESTRATOR
  if (agent.kind === 'you') return agent.name
  if (agent.kind === 'peer') return labelCut(agent.name)
  return agent.label ?? labelParts(agent)?.label ?? fallbackLabel(agent)
}

/** What the agent was given beside its label ("data, banner" of "Phase A: data, banner"); '' for none. */
export function scopeOf(agent: DeckAgent): string {
  if (agent.kind !== 'agent' && agent.kind !== 'teammate') return ''
  if (agent.label !== undefined) return agent.scope ?? ''
  return labelParts(agent)?.scope ?? ''
}

/**
 * Who handed `agent` its work, for drawing: you for the Orchestrator, the
 * agent that spawned a subagent (the Orchestrator when that one is gone or
 * unknown), nobody for you and outside peers.
 */
export function parentIdOf(data: DeckData, agent: DeckAgent): string | undefined {
  if (agent.kind === 'you' || agent.kind === 'peer') return undefined
  if (agent.kind === 'main') return YOU
  const parent = agent.parentId
  return parent && parent !== agent.id && parent !== YOU && agentOf(data, parent) ? parent : MAIN
}

export function minuteOf(now: number): number {
  return Math.floor(now / 60_000)
}

export function bump(data: DeckData, now: number, field: 'tools' | 'edits' | 'tokens', by = 1) {
  const m = minuteOf(now)
  let last = data.minutes[data.minutes.length - 1]
  if (!last || last.m !== m) {
    last = { m, tools: 0, edits: 0, tokens: 0 }
    data.minutes.push(last)
    if (data.minutes.length > LIMITS.minutes) data.minutes.splice(0, data.minutes.length - LIMITS.minutes)
  }
  last[field] += by
}

/** The last `count` minutes of one field, oldest first, zeros filled in. */
export function series(data: DeckData, now: number, field: 'tools' | 'edits' | 'tokens', count: number): number[] {
  const end = minuteOf(now)
  const byMinute = new Map(data.minutes.map(row => [row.m, row[field]]))
  const out: number[] = []
  for (let m = end - count + 1; m <= end; m++) out.push(byMinute.get(m) ?? 0)
  return out
}

/** Normalizes a path for comparing: forward slashes, no trailing slash. */
export function normPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isCaseless(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path)
}

/** `abs` relative to the repository root `root`, or `abs` itself outside it. */
export function relOf(abs: string, root: string | null): string {
  const path = normPath(abs)
  if (!root) return path
  const base = normPath(root)
  const caseless = isCaseless(path) || isCaseless(base)
  const a = caseless ? path.toLowerCase() : path
  const b = caseless ? base.toLowerCase() : base
  return a === b ? '.' : a.startsWith(`${b}/`) ? path.slice(base.length + 1) : path
}

export function samePath(a: string, b: string): boolean {
  const x = normPath(a)
  const y = normPath(b)
  return isCaseless(x) || isCaseless(y) ? x.toLowerCase() === y.toLowerCase() : x === y
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A task-board call in words: the task's subject (the board's, by its id, when the call names none), and the state an update moves it to. */
function taskTargetOf(tool: string, input: Record<string, unknown>, board: Readonly<Record<string, DeckTask>> | undefined): string {
  if (tool === 'TaskList') return 'the task list'
  const id = taskIdOf(input.taskId)
  const subject = str(input.subject) ?? (id !== undefined ? (board?.[id]?.subject ?? `task ${id}`) : '')
  if (tool !== 'TaskUpdate') return trunc(oneLine(subject), 60)
  const state = taskStateOf(input.status)
  const word = state === 'active' ? 'in progress' : state
  return trunc(word ? `${oneLine(subject)} → ${word}` : oneLine(subject), 60)
}

/**
 * What a tool call is aimed at, in a few words: the file, command, pattern or
 * query; a task-board call's task by its subject (`board`, the deck's, names
 * the task an update gives by id only).
 */
export function targetOf(tool: string, input: Record<string, unknown>, root: string | null, board?: Readonly<Record<string, DeckTask>>): string {
  const file = str(input.file_path) ?? str(input.notebook_path)
  if (file) return truncStart(relOf(file, root), 60)
  if (TASK_TOOLS.includes(tool)) return taskTargetOf(tool, input, board)

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return trunc(oneLine(str(input.description) ?? str(input.command) ?? ''), 70)
    case 'Grep':
      return trunc(`${str(input.pattern) ?? ''}${input.path ? ` in ${baseName(String(input.path))}` : ''}`, 60)
    case 'Glob':
      return trunc(str(input.pattern) ?? '', 60)
    case 'WebFetch':
      return trunc((str(input.url) ?? '').replace(/^https?:\/\//, ''), 60)
    case 'WebSearch':
      return trunc(str(input.query) ?? '', 60)
    case 'Agent':
    case 'Task':
      return trunc(str(input.description) ?? 'subagent', 60)
    case 'SendMessage':
      return trunc(`→ ${String(input.to ?? '?')}: ${oneLine(str(input.message) ?? '')}`, 60)
    case 'Skill':
      return trunc(str(input.skill) ?? '', 60)
    case 'TodoWrite':
      return 'update todos'
    case 'ToolSearch': {
      // "select:TaskCreate,TaskUpdate" loads tools by name: their names are what it is aimed at
      const query = oneLine(str(input.query) ?? '')
      const names = query.startsWith('select:') ? query.slice('select:'.length).split(',').map(name => name.trim()).filter(name => name !== '') : []
      return trunc(names.length > 0 ? names.join(', ') : query, 60)
    }
    case 'AskUserQuestion':
      // what it asks you: its first question
      return trunc(oneLine(questionsOf(input.questions)[0]?.question ?? ''), 80)
    default: {
      if (tool.startsWith('mcp__')) return trunc(tool.split('__').slice(1).join(' / '), 60)
      // the call's own words, not the event's: its tool's name, its id and its loop ride beside them
      const first = Object.entries(input).find(([key, value]) => typeof value === 'string' && !EVENT_FIELDS.includes(key))?.[1]
      return typeof first === 'string' ? trunc(oneLine(first), 60) : ''
    }
  }
}

/** What a `tool.call` event carries beside the tool's own arguments: never what a call is aimed at. */
const EVENT_FIELDS: readonly string[] = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']

/**
 * An AskUserQuestion call's questions as its dialog draws them: each one's
 * question, header (its chip; '' for none), whether several options may be
 * picked, and its options' labels and descriptions. Anything not of that
 * shape is left out; at most four.
 */
export function questionsOf(value: unknown): DeckQuestion[] {
  if (!Array.isArray(value)) return []
  const out: DeckQuestion[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.question !== 'string' || raw.question.trim() === '') continue
    const options = Array.isArray(raw.options)
      ? raw.options.filter(isRecord).flatMap(option => (typeof option.label === 'string' ? [{ label: option.label, description: typeof option.description === 'string' ? option.description : '' }] : []))
      : []
    out.push({ question: raw.question, header: typeof raw.header === 'string' ? raw.header : '', multiSelect: raw.multiSelect === true, options })
    if (out.length >= 4) break
  }
  return out
}

/** One tool call as the deck keeps it: what it is aimed at (`board` names a task-board call's task), and a shell call's own description of itself and its command. */
export function activityOf(id: string, tool: string, input: Record<string, unknown>, root: string | null, at: number, board?: Readonly<Record<string, DeckTask>>): DeckActivity {
  const isShell = SHELL_TOOLS.includes(tool)
  const described = isShell ? str(input.description) : undefined
  const description = described ? trunc(oneLine(described), 80) : ''
  const said = isShell ? str(input.command) : undefined
  const command = said ? trunc(oneLine(said), 120) : ''
  return { id, tool, target: targetOf(tool, input, root, board), at, ...(description ? { description } : {}), ...(command ? { command } : {}) }
}

export function beginTool(data: DeckData, agent: DeckAgent, activity: DeckActivity) {
  L.noteCall(agent, activity)
  agent.current = activity
  agent.tools += 1
  agent.toolCounts[activity.tool] = (agent.toolCounts[activity.tool] ?? 0) + 1
  agent.lastAt = activity.at
  agent.recent.push(activity)
  if (agent.recent.length > LIMITS.recent) agent.recent.splice(0, agent.recent.length - LIMITS.recent)
  if (agent.kind !== 'you' && !isEnded(agent.status)) {
    // an idle teammate at work again starts a new run, with a result of its own to come
    if (agent.status === 'idle' && agent.kind !== 'main') delete agent.resultVia
    agent.status = 'running'
  }
  bump(data, activity.at, 'tools')
}

/**
 * Keeps what one model step of `agent`'s loop gave besides its calls, as
 * Claude Code gave it (`DeckWord`): its visible text (`said`) or its
 * thinking as Claude Code shows it (`thought`), cut at LIMITS.wordChars,
 * after the latest call the loop began; its newest LIMITS.words in all.
 * Words of nothing but white space are none. Answers whether it kept them.
 */
export function noteWord(agent: DeckAgent, word: { kind: DeckWord['kind']; text: string; at: number; turnId: string; step: number; isChat?: boolean }): boolean {
  const text = word.text.trim()
  if (text === '') return false
  const kept = trunc(text, LIMITS.wordChars)
  const words = agent.words ?? []
  words.push({
    kind: word.kind,
    at: word.at,
    turnId: word.turnId,
    step: word.step,
    text: kept,
    ...(kept !== text ? { isCut: true as const } : {}),
    after: agent.recent[agent.recent.length - 1]?.id ?? '',
    ...(word.isChat ? { isChat: true as const } : {}),
  })
  if (words.length > LIMITS.words) words.splice(0, words.length - LIMITS.words)
  agent.words = words
  return true
}

/** The latest words `agent` said (not thought) after the latest call it began, while it began none since; undefined when it has said none since. */
export function saidSinceCallOf(agent: DeckAgent): DeckWord | undefined {
  const words = agent.words ?? []
  const last = agent.recent[agent.recent.length - 1]?.id ?? ''
  for (let i = words.length - 1; i >= 0; i--) {
    const one = words[i] as DeckWord
    if (one.after !== last) return undefined
    if (one.kind === 'said') return one
  }
  return undefined
}

export function endTool(agent: DeckAgent, id: string, ok: boolean, now: number) {
  const entry = agent.recent.find(one => one.id === id)
  L.noteCallEnd(agent, id, entry, ok, now)
  if (entry) {
    entry.ok = ok
    entry.ms = now - entry.at
  }
  if (agent.current?.id === id) agent.current = undefined
  if (!ok) agent.errors += 1
  agent.lastAt = now
}

/** Records one edit: in the capped log with its patch, in its agent's counts, and in the file's record (`filesOf`). */
export function addEdit(data: DeckData, agent: DeckAgent, edit: DeckEdit) {
  data.edits.push(edit)
  if (data.edits.length > LIMITS.edits) data.edits.splice(0, data.edits.length - LIMITS.edits)
  agent.added += edit.added
  agent.removed += edit.removed
  if (!agent.files.includes(edit.path)) agent.files.push(edit.path)
  if (agent.files.length > 200) agent.files.splice(0, agent.files.length - 200)
  bump(data, edit.at, 'edits')
  noteFile(data, edit)
}

/** The key a file's record goes under: its normalised path, lower-cased under a drive letter. */
export function fileKeyOf(abs: string): string {
  const path = normPath(abs)
  return isCaseless(path) ? path.toLowerCase() : path
}

/** Adds one edit to its file's record: who, how much, when; the 500 files edited last are kept. */
export function noteFile(data: DeckData, edit: Pick<DeckEdit, 'agent' | 'path' | 'abs' | 'at' | 'added' | 'removed' | 'isNew' | 'userModified'>): DeckFile {
  const key = fileKeyOf(edit.abs || edit.path)
  const file: DeckFile = data.files[key] ?? { path: edit.path, abs: normPath(edit.abs || edit.path), editors: [], added: 0, removed: 0, lastAt: edit.at }
  file.path = edit.path
  file.added += edit.added
  file.removed += edit.removed
  file.lastAt = Math.max(file.lastAt, edit.at)
  if (edit.isNew) file.isNew = true
  if (edit.userModified) file.userModified = true
  let editor = file.editors.find(one => one.agent === edit.agent)
  if (!editor) {
    editor = { agent: edit.agent, count: 0, added: 0, removed: 0, firstAt: edit.at, lastAt: edit.at }
    file.editors.push(editor)
  }
  editor.count += 1
  editor.added += edit.added
  editor.removed += edit.removed
  editor.firstAt = Math.min(editor.firstAt, edit.at)
  editor.lastAt = Math.max(editor.lastAt, edit.at)
  data.files[key] = file
  const keys = Object.keys(data.files)
  if (keys.length > LIMITS.files) {
    const oldest = keys.sort((a, b) => (data.files[a]?.lastAt ?? 0) - (data.files[b]?.lastAt ?? 0)).slice(0, keys.length - LIMITS.files)
    for (const old of oldest) delete data.files[old]
  }
  return file
}

/**
 * A new message's id, from when it was said and between whom: `[A-Za-z0-9_]`
 * only, so the web deck serves it as a file name as it stands; `_2`, `_3`
 * after one taken.
 */
function messageIdOf(data: DeckData, at: number, from: string, to: string): string {
  const base = `m${at}_${from}_${to}`.replace(/[^A-Za-z0-9_]/g, '_')
  let id = base
  for (let n = 2; data.messages.some(one => one.id === id); n++) id = `${base}_${n}`
  return id
}

/**
 * Gives a message its words: cut at 700 characters, a longer one's whole
 * text (at most 20,000) kept as `full` for the web deck's file, which is
 * written again (`isSaved` cleared).
 */
export function setMessageText(message: DeckMessage, text: string): void {
  const body = text.trim()
  message.text = trunc(body, LIMITS.messageChars)
  if (message.text === body) delete message.full
  else message.full = trunc(body, LIMITS.fullChars)
  delete message.isSaved
}

/** Only the newest messages (LIMITS.fullTexts) keep a whole text the web deck has yet to write: an older one keeps its cut. */
function pruneFull(data: DeckData): void {
  let kept = 0
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const one = data.messages[i]
    if (one?.full === undefined) continue
    kept += 1
    if (kept > LIMITS.fullTexts) delete one.full
  }
}

/**
 * Logs a message, its words cut for the page (`setMessageText`). A prompt
 * of yours is logged as you wrote it (`cleanPrompt`: a paste as `[pasted
 * text]`, no reminder or local command's echo); one with none of your words
 * left is not logged at all, and the message returned is in no list.
 */
export function addMessage(
  data: DeckData,
  message: Omit<DeckMessage, 'id' | 'text'> & { text: string },
): DeckMessage {
  const { text, ...rest } = message
  const made: DeckMessage = { ...rest, id: messageIdOf(data, message.at, message.from, message.to), text: '' }
  const isPrompt = isYourPrompt(message)
  setMessageText(made, isPrompt ? cleanPrompt(text) : text)
  if (isPrompt && made.text === '') return made
  data.messages.push(made)
  if (data.messages.length > LIMITS.messages) data.messages.splice(0, data.messages.length - LIMITS.messages)
  pruneFull(data)
  return made
}

/**
 * Finds an agent a SendMessage `to` names: an id, a name, a teammate address
 * (`name@team`), or "main". A name two agents carried (a reviewer finished,
 * another spawned) is the newest live one's, else the newest's.
 */
export function resolveRecipient(data: DeckData, to: string): DeckAgent | undefined {
  const wanted = to.trim()
  if (wanted === '') return undefined
  if (wanted === MAIN || wanted === 'team-lead' || wanted === 'lead') return agentOf(data, MAIN)
  const byId = agentOf(data, wanted)
  if (byId) return byId
  const lower = wanted.toLowerCase()
  const bare = lower.split('@')[0] ?? lower
  const named = data.agents.filter(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && agent.name !== '' && (agent.name.toLowerCase() === lower || agent.name.toLowerCase() === bare))
  const live = named.filter(agent => isLive(agent.status))
  return live[live.length - 1] ?? named[named.length - 1] ?? (wanted.length >= 6 ? data.agents.find(agent => agent.id.startsWith(wanted)) : undefined)
}

/** The id of an outside peer's node, made on first sight. */
export function peerOf(data: DeckData, address: string, now: number): DeckAgent {
  const id = `peer:${address}`
  const found = agentOf(data, id)
  if (found) return found
  const made = newAgent(id, 'peer', trunc(address.replace(/^peer:/, ''), 24), now, {
    type: 'peer session',
    status: 'idle',
  })
  data.agents.push(made)
  return made
}

export type MessageKindCount = Partial<Record<DeckMessageKind, number>>

/** Messages between each pair, keyed `a|b` in sorted order. */
export function linksOf(data: DeckData): Map<string, { a: string; b: string; ab: number; ba: number; last: number; kinds: MessageKindCount }> {
  const links = new Map<string, { a: string; b: string; ab: number; ba: number; last: number; kinds: MessageKindCount }>()
  for (const message of data.messages) {
    // words to nobody in particular link no one
    if (message.to === '') continue
    const [a, b] = message.from < message.to ? [message.from, message.to] : [message.to, message.from]
    const key = `${a}|${b}`
    const link = links.get(key) ?? { a, b, ab: 0, ba: 0, last: 0, kinds: {} }
    if (message.from === a) link.ab += 1
    else link.ba += 1
    link.last = Math.max(link.last, message.at)
    link.kinds[message.kind] = (link.kinds[message.kind] ?? 0) + 1
    links.set(key, link)
  }
  return links
}

/** Totals over the session's tracked agents. */
export function totalsOf(data: DeckData) {
  let tools = 0
  let errors = 0
  let added = 0
  let removed = 0
  let tokensIn = 0
  let tokensOut = 0
  let cacheRead = 0
  const toolCounts: Record<string, number> = {}
  const files = new Set<string>()

  for (const agent of data.agents) {
    tools += agent.tools
    errors += agent.errors
    added += agent.added
    removed += agent.removed
    tokensIn += agent.tokensIn
    tokensOut += agent.tokensOut
    cacheRead += agent.cacheRead
    for (const [tool, count] of Object.entries(agent.toolCounts)) toolCounts[tool] = (toolCounts[tool] ?? 0) + count
    for (const file of agent.files) files.add(file)
  }

  const subagents = data.agents.filter(agent => agent.kind === 'agent' || agent.kind === 'teammate')

  return {
    tools,
    errors,
    added,
    removed,
    tokensIn,
    tokensOut,
    cacheRead,
    toolCounts,
    files: files.size,
    agents: subagents.length,
    live: subagents.filter(agent => isLive(agent.status)).length,
    done: subagents.filter(agent => agent.status === 'completed').length,
    failed: subagents.filter(agent => agent.status === 'failed' || agent.status === 'killed').length,
    messages: data.messages.length,
  }
}

/** Which agents edited `path` this session, by their labels. */
export function editorsOf(data: DeckData, path: string): DeckAgent[] {
  const ids = new Set(data.edits.filter(edit => samePath(edit.path, path)).map(edit => edit.agent))
  return data.agents.filter(agent => ids.has(agent.id))
}

/** A deep, unfrozen copy of plain data. */
export function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Fills, field by field, what a snapshot from an older shape lacks, drops
 * what it holds of the wrong shape, and cuts each list to its cap (goals 20,
 * board 200, 50 todos per agent, files 500). Agents without a label get one,
 * and so do agents whose label an earlier build cut from the words they still
 * have (`isOldCut`): it is made again, in spawn order, the way labels are cut now.
 */
export function healData(value: DeckData, now: number): DeckData {
  const base = emptyData(now)
  const data = { ...base, ...value }
  data.agents = Array.isArray(value.agents) ? value.agents.filter(isRecord).map(agent => healAgent({ ...newAgent(agent.id, agent.kind, agent.name, now), ...agent })) : base.agents
  if (!agentOf(data, YOU)) data.agents.unshift(base.agents[0] as DeckAgent)
  if (!agentOf(data, MAIN)) data.agents.splice(1, 0, base.agents[1] as DeckAgent)
  // a prompt of yours that an earlier build kept and that holds none of your words (a local command's echo) goes, and so does an idle prompt it kept (titled by its type)
  data.messages = Array.isArray(value.messages) ? value.messages.filter(isRecord).map(healMessage).filter(message => (!isYourPrompt(message) || message.text !== '') && !(message.kind === 'notification' && message.title === IDLE_KIND)) : []
  data.pending = healPending(value.pending)
  data.acks = healAcks(value.acks)
  data.needs = healNeeds(value.needs)
  // an idle prompt an earlier build kept as a need waits on no one
  const main = agentOf(data, MAIN)
  if (main?.needs?.kind === IDLE_KIND) {
    const newest = data.needs[data.needs.length - 1]
    if (newest) main.needs = shownNeedsOf(newest)
    else delete main.needs
  }
  const approved = value.approved as unknown
  if (isRecord(approved) && typeof approved.text === 'string' && approved.text.trim() !== '' && num(approved.at) !== undefined) {
    data.approved = { text: trunc(approved.text, LIMITS.planChars), at: approved.at as number, by: typeof approved.by === 'string' ? approved.by : MAIN }
  } else {
    delete data.approved
  }
  data.edits = Array.isArray(value.edits) ? value.edits : []
  data.minutes = Array.isArray(value.minutes) ? value.minutes : []
  data.commitsBy = value.commitsBy && typeof value.commitsBy === 'object' ? value.commitsBy : {}
  data.tasks = isRecord(value.tasks) ? (value.tasks as Record<string, string>) : {}
  data.goals = healGoals(value.goals)
  data.board = healBoard(value.board)
  data.files = healFiles(value.files)
  data.workflows = healWorkflows(value.workflows)
  if (value.isNewGoalNext !== true) delete data.isNewGoalNext
  if (value.isFork !== true) delete data.isFork
  if (typeof value.mainTurnId !== 'string' || value.mainTurnId === '') delete data.mainTurnId
  if (data.mainTurnId === undefined || typeof value.mainTurnAt !== 'number' || !Number.isFinite(value.mainTurnAt)) delete data.mainTurnAt
  for (const agent of data.agents) {
    if (!isOldCut(agent)) continue
    delete agent.label
    delete agent.scope
  }
  for (const agent of data.agents) fixLabel(data, agent)
  return data
}

const ORIGINS: readonly DeckOrigin[] = ['agent', 'teammate', 'workflow', 'engine']
const ITEM_STATES: readonly DeckTodoItem['status'][] = ['done', 'active', 'pending']

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The results earlier builds wrote for an Agent call that started no agent, or one in a cloud session. */
const MADE_UP_RESULT = /^(?:Not started: |Runs in a cloud session, outside this view$)/

/** One restored agent's newer fields, each kept only in its own shape. */
function healAgent(agent: DeckAgent): DeckAgent {
  const loose = agent as unknown as Record<string, unknown>
  // a label is kept as it was fixed: one line, cut again only past the longest a label may be
  const label = typeof loose.label === 'string' ? oneLine(loose.label) : ''
  if (label === '') delete agent.label
  else agent.label = Array.from(label).length > LIMITS.labelStretch ? labelCut(label) : label
  if (typeof loose.scope !== 'string') delete agent.scope
  if (!ORIGINS.includes(loose.origin as DeckOrigin)) delete agent.origin
  for (const field of ['toolUseId', 'goal', 'workflow'] as const) if (typeof loose[field] !== 'string') delete agent[field]
  if (typeof loose.background !== 'boolean') delete agent.background
  if (num(loose.todosAt) === undefined) delete agent.todosAt
  if (num(loose.resumedAt) === undefined) delete agent.resumedAt
  L.healLane(agent)
  if (!['handback', 'answer', 'call', 'stop'].includes(String(loose.resultVia))) delete agent.resultVia
  // the words earlier builds made up for an Agent call that started no agent: no result of any agent's
  if (agent.resultVia === undefined && agent.kind !== 'main' && typeof agent.answer === 'string' && MADE_UP_RESULT.test(agent.answer)) delete agent.answer
  const during = loose.during
  if (!isRecord(during) || (during.kind !== 'todo' && during.kind !== 'task') || typeof during.key !== 'string' || typeof during.text !== 'string') delete agent.during
  const words = Array.isArray(loose.words) ? healWordList(loose.words) : []
  if (words.length > 0) agent.words = words
  else delete agent.words
  if (Array.isArray(loose.todos)) {
    agent.todos = loose.todos
      .filter(isRecord)
      .filter(item => typeof item.key === 'string' && typeof item.text === 'string' && ITEM_STATES.includes(item.status as DeckTodoItem['status']))
      .slice(0, LIMITS.todos) as DeckTodoItem[]
  } else {
    delete agent.todos
  }
  return agent
}

/** A restored loop's words (`DeckWord`), each kept only in its own shape, cut to the newest LIMITS.words. */
function healWordList(value: readonly unknown[]): DeckWord[] {
  return value
    .filter(isRecord)
    .filter(one => (one.kind === 'said' || one.kind === 'thought') && typeof one.text === 'string' && one.text !== '' && num(one.at) !== undefined && typeof one.turnId === 'string' && num(one.step) !== undefined && typeof one.after === 'string')
    .map(one => ({
      kind: one.kind as DeckWord['kind'],
      at: one.at as number,
      turnId: one.turnId as string,
      step: one.step as number,
      text: trunc(one.text as string, LIMITS.wordChars),
      ...(one.isCut === true ? { isCut: true as const } : {}),
      after: one.after as string,
      ...(one.isChat === true ? { isChat: true as const } : {}),
    }))
    .slice(-LIMITS.words)
}

function healGoals(value: unknown): DeckGoal[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(goal => typeof goal.id === 'string' && typeof goal.text === 'string' && num(goal.at) !== undefined)
    .map(goal => {
      // words an earlier build kept with a paste's or a reminder's tags read as the person wrote them; a goal with none of theirs left keeps what it had
      const text = healWords(goal.text as string) || (goal.text as string)
      const healed: DeckGoal = {
        id: goal.id as string,
        headline: typeof goal.headline === 'string' && healWords(goal.headline) === goal.headline ? goal.headline : headlineOf(text),
        text,
        at: goal.at as number,
        followUps: Array.isArray(goal.followUps)
          ? goal.followUps
              .filter(isRecord)
              .filter(one => typeof one.text === 'string' && num(one.at) !== undefined)
              .map(one => ({ text: healWords(one.text as string), at: one.at as number }))
              .filter(one => one.text !== '')
              .slice(-LIMITS.followUps)
          : [],
        origin: typeof goal.origin === 'string' ? goal.origin : 'composer',
      }
      const plan = goal.plan
      if (isRecord(plan) && Array.isArray(plan.steps) && num(plan.at) !== undefined) {
        healed.plan = { steps: plan.steps.filter((step): step is string => typeof step === 'string').slice(0, LIMITS.steps), at: plan.at as number }
      }
      return healed
    })
    .slice(-LIMITS.goals)
}

function healBoard(value: unknown): Record<string, DeckTask> {
  const board: Record<string, DeckTask> = {}
  if (!isRecord(value)) return board
  for (const task of Object.values(value)) {
    if (!isRecord(task) || typeof task.id !== 'string' || typeof task.subject !== 'string' || !ITEM_STATES.includes(task.status as DeckTask['status'])) continue
    const healed: DeckTask = { id: task.id, subject: task.subject, status: task.status as DeckTask['status'], at: num(task.at) ?? 0 }
    for (const field of ['description', 'doing', 'owner', 'createdBy', 'claimedBy', 'goal'] as const) if (typeof task[field] === 'string') healed[field] = task[field] as string
    for (const field of ['startedAt', 'doneAt'] as const) if (num(task[field]) !== undefined) healed[field] = task[field] as number
    board[healed.id] = healed
  }
  pruneBoard(board)
  return board
}

function healFiles(value: unknown): Record<string, DeckFile> {
  const files: Record<string, DeckFile> = {}
  if (!isRecord(value)) return files
  for (const [key, file] of Object.entries(value)) {
    if (!isRecord(file) || typeof file.path !== 'string' || typeof file.abs !== 'string' || !Array.isArray(file.editors)) continue
    const editors = file.editors
      .filter(isRecord)
      .filter(one => typeof one.agent === 'string')
      .map(one => ({
        agent: one.agent as string,
        count: num(one.count) ?? 0,
        added: num(one.added) ?? 0,
        removed: num(one.removed) ?? 0,
        firstAt: num(one.firstAt) ?? 0,
        lastAt: num(one.lastAt) ?? 0,
      }))
    const healed: DeckFile = { path: file.path, abs: file.abs, editors, added: num(file.added) ?? 0, removed: num(file.removed) ?? 0, lastAt: num(file.lastAt) ?? 0 }
    if (file.isNew === true) healed.isNew = true
    if (file.userModified === true) healed.userModified = true
    files[key] = healed
  }
  const keys = Object.keys(files)
  if (keys.length > LIMITS.files) {
    for (const old of keys.sort((a, b) => (files[a]?.lastAt ?? 0) - (files[b]?.lastAt ?? 0)).slice(0, keys.length - LIMITS.files)) delete files[old]
  }
  return files
}

function healWorkflows(value: unknown): DeckWorkflow[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(run => typeof run.id === 'string' && typeof run.caller === 'string' && num(run.startedAt) !== undefined)
    .map(run => {
      const healed: DeckWorkflow = {
        id: run.id as string,
        caller: run.caller as string,
        name: typeof run.name === 'string' ? run.name : '',
        phases: Array.isArray(run.phases) ? run.phases.filter((one): one is string => typeof one === 'string').slice(0, LIMITS.steps) : [],
        startedAt: run.startedAt as number,
        lastAt: num(run.lastAt) ?? (run.startedAt as number),
      }
      for (const field of ['runId', 'taskId', 'goal'] as const) if (typeof run[field] === 'string') healed[field] = run[field] as string
      if (num(run.endedAt) !== undefined) healed.endedAt = run.endedAt as number
      return healed
    })
    .slice(-LIMITS.workflows)
}

/**
 * One restored message's newer fields, each kept only in its own shape. A
 * prompt of yours that an earlier build kept with a paste's or a reminder's
 * tags reads as you wrote it (`cleanPrompt`; '' with none of your words left).
 */
function healMessage(value: Record<string, unknown>): DeckMessage {
  const message = value as unknown as DeckMessage
  if (typeof value.full !== 'string') delete message.full
  if (value.isSaved !== true) delete message.isSaved
  for (const field of ['ackId', 'callId', 'title', 'agent'] as const) if (typeof value[field] !== 'string') delete message[field]
  // a slash command run alone that an earlier build kept as your words ("/login"): the command you ran
  const line = isYourPrompt(message) && typeof value.text === 'string' ? commandLineOf(message.full ?? value.text) : ''
  if (line) {
    message.kind = 'command'
    message.to = ''
    setMessageText(message, line)
  }
  if (isYourPrompt(message) && typeof value.text === 'string') {
    const kept = message.full ?? value.text
    const words = cleanPrompt(kept)
    if (words !== kept.trim()) setMessageText(message, words)
  }
  return message
}

/** Words an earlier build kept with a paste's, a reminder's or a local command's tags, as the person wrote them (`cleanPrompt`); words with none stay exactly as they were. */
function healWords(text: string): string {
  const words = cleanPrompt(text)
  return words === text.trim() ? text : words
}

const PENDING_KINDS: readonly DeckPending['kind'][] = ['question', 'permission']

/** The calls a snapshot says were held on the person: each of its shape, at most 20. Restored, none has a deck answer waiting on it (`isAnswerable`). */
function healPending(value: unknown): DeckPending[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(item => typeof item.id === 'string' && typeof item.agentId === 'string' && PENDING_KINDS.includes(item.kind as DeckPending['kind']) && typeof item.tool === 'string' && num(item.at) !== undefined)
    .map(item => {
      const healed: DeckPending = { id: item.id as string, agentId: item.agentId as string, kind: item.kind as DeckPending['kind'], tool: item.tool as string, at: item.at as number }
      if (item.questions !== undefined) healed.questions = questionsOf(item.questions)
      for (const field of ['command', 'path', 'description'] as const) if (typeof item[field] === 'string') healed[field] = item[field] as string
      return healed
    })
    .slice(-LIMITS.pending)
}

const ACK_STATES: readonly DeckAck['status'][] = ['queued', 'delivered', 'answered', 'failed']

/** The notifications a snapshot says wait on the person: each of its shape, at most 20. */
function healNeeds(value: unknown): DeckNeeds[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(one => typeof one.text === 'string' && typeof one.kind === 'string' && one.kind !== IDLE_KIND && num(one.at) !== undefined)
    .map(one => {
      const healed: DeckNeeds = { text: one.text as string, kind: one.kind as string, at: one.at as number }
      for (const field of ['agent', 'call', 'title'] as const) if (typeof one[field] === 'string') healed[field] = one[field] as string
      return healed
    })
    .slice(-LIMITS.needs)
}

function healAcks(value: unknown): DeckAck[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .filter(ack => typeof ack.id === 'string' && ACK_STATES.includes(ack.status as DeckAck['status']) && typeof ack.text === 'string' && num(ack.at) !== undefined)
    .map(ack => ({ id: ack.id as string, ok: ack.ok === true, status: ack.status as DeckAck['status'], text: ack.text as string, at: ack.at as number }))
    .slice(-LIMITS.acks)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// What each agent is doing, for the screens: pure reads of the live data.

const NOW_CHARS = 120
const NOTE_CHARS = 160

/** A call in words: a shell call's own description, else the tool and what it is aimed at. */
function saidOf(activity: DeckActivity): string {
  if (activity.description) return activity.description
  return activity.target ? `${activity.tool} ${activity.target}` : activity.tool
}

function lastWorkOf(agent: DeckAgent): DeckActivity | undefined {
  for (let i = agent.recent.length - 1; i >= 0; i--) {
    const one = agent.recent[i]
    if (one && !LIST_TOOLS.includes(one.tool)) return one
  }
  return undefined
}

/**
 * What the agent is doing now, in a few words: its tool call in flight (a
 * shell call's own description before its raw command), else the
 * in-progress item of its todo or task list, else what it did last, else
 * the task it was given; '' when there is nothing to say.
 */
export function nowOf(agent: DeckAgent): string {
  const current = agent.current
  if (current && !LIST_TOOLS.includes(current.tool)) return trunc(oneLine(saidOf(current)), NOW_CHARS)
  if (agent.todo?.text) return trunc(oneLine(agent.todo.text), NOW_CHARS)
  const last = lastWorkOf(agent)
  if (last) return trunc(oneLine(saidOf(last)), NOW_CHARS)
  return trunc(oneLine(agent.description), NOW_CHARS)
}

/**
 * The status the deck draws: `waiting` while the engine waits on the person
 * for it (a needs-you note) or its loop is held; `running` for a starting,
 * pending or running loop; `done` once it completed; `failed` once it failed
 * or was stopped; `idle` between turns, and always for you and outside peers.
 *
 * Without `data` the note counts where it is kept, on the Orchestrator. With
 * it, it counts on the agent whose call waits: a subagent's permission prompt
 * makes that subagent `waiting`, not the Orchestrator, and so does a call of
 * its held on you (`pending`: a question, a permission prompt). With it too, a loop
 * held while a child agent of its own is at work (a background subagent's
 * foreground Agent call) is `running`: busy, nothing waits on you.
 */
export function statusOf(agent: DeckAgent, data?: DeckData): DeckShownStatus {
  if (agent.kind === 'you' || agent.kind === 'peer') return 'idle'
  if (data) {
    // a question or permission prompt of its call held on you, or the needs-you note naming it
    if (waitsOnYou(data, agent.id)) return 'waiting'
  } else if (agent.needs) {
    return 'waiting'
  }
  switch (agent.status) {
    case 'starting':
    case 'running':
    case 'pending':
      return 'running'
    case 'waiting':
      return data !== undefined && hasLiveChild(data, agent.id) ? 'running' : 'waiting'
    case 'completed':
      return 'done'
    case 'failed':
    case 'killed':
      return 'failed'
    default:
      return 'idle'
  }
}

/**
 * How long the agent has been at it: once it ended, how long its run took;
 * while it runs, coarse ("<1m", whole minutes, then hours and minutes), so
 * the figure changes at most once a minute and redraws for it are rare.
 */
export function elapsedOf(agent: DeckAgent, now: number): string {
  // a resumed agent's run is the one since it was woken
  const from = Math.max(agent.startedAt, agent.resumedAt ?? 0)
  if (agent.endedAt !== undefined) return dur(Math.max(0, agent.endedAt - from))
  const ms = Math.max(0, now - from)
  return ms < 60_000 ? '<1m' : dur(ms)
}

// Todos: what an agent says it is working on.

const TASK_BOOK = 100

function bookTask(data: DeckData, id: string, text: string) {
  data.tasks[id] = trunc(oneLine(text), NOTE_CHARS)
  const ids = Object.keys(data.tasks)
  for (const old of ids.slice(0, Math.max(0, ids.length - TASK_BOOK))) delete data.tasks[old]
}

/**
 * Folds a list call that went through into what the agent says it is doing:
 * TodoWrite's whole list (the result's `newTodos`, else the input's `todos`)
 * becomes its checklist (`noteTodos`), its in-progress item (activeForm, else
 * content; none clears it) what it is doing; a TaskUpdate that starts a task
 * (its activeForm, else the words its TaskCreate booked, else its subject)
 * or ends the task in hand. TaskCreate books the task's words for that
 * later start. Others: nothing. `at` stamps the checklist's starts and ends.
 */
export function noteTodo(data: DeckData, agent: DeckAgent, tool: string, input: Record<string, unknown>, result: unknown, at = agent.lastAt): void {
  if (tool === 'TodoWrite') {
    const listed = isRecord(result) && Array.isArray(result.newTodos) ? result.newTodos : Array.isArray(input.todos) ? input.todos : []
    const todos = listed.filter(isRecord)
    noteTodos(agent, todos, at)
    const doing = todos.find(todo => todo.status === 'in_progress')
    const text = doing ? (str(doing.activeForm) ?? str(doing.content)) : undefined
    if (text) agent.todo = { text: trunc(oneLine(text), NOTE_CHARS) }
    else delete agent.todo
    return
  }

  if (tool === 'TaskCreate') {
    const task = isRecord(result) && isRecord(result.task) ? result.task : undefined
    const id = task ? (str(task.id) ?? (typeof task.id === 'number' ? String(task.id) : undefined)) : undefined
    const text = str(input.activeForm) ?? str(input.subject)
    if (id && text) bookTask(data, id, text)
    return
  }

  if (tool === 'TaskUpdate') {
    const id = str(input.taskId)
    if (!id) return
    const form = str(input.activeForm)
    const subject = str(input.subject)
    if (form) bookTask(data, id, form)
    else if (subject && data.tasks[id] === undefined) bookTask(data, id, subject)
    const status = input.status
    if (status === 'in_progress') agent.todo = { text: data.tasks[id] ?? `Task ${id}`, task: id }
    else if (agent.todo?.task === id && (status === 'completed' || status === 'deleted' || status === 'pending')) delete agent.todo
    else if (agent.todo?.task === id && form) agent.todo = { text: data.tasks[id] ?? form, task: id }
  }
}

// Waiting on you: the engine's notifications that ask something of the person.

const NEEDS_KINDS: readonly string[] = ['permission_prompt', 'elicitation_dialog']
/** Claude Code saying its turn ended and it is idle ("Claude is waiting for your input"): no question, whatever its words, so no need and no chat row. */
const IDLE_KIND = 'idle_prompt'
const NOT_NEEDS_KINDS: readonly string[] = [IDLE_KIND, 'auth_success', 'elicitation_complete', 'elicitation_response']

/** Whether a notification asks something of the person: a permission prompt, an MCP server's question; never an idle prompt. */
export function isNeedsYou(kind: string, message: string): boolean {
  if (NEEDS_KINDS.includes(kind)) return true
  if (NOT_NEEDS_KINDS.includes(kind)) return false
  return /permission|waiting for your|needs your|your (input|approval|answer)/i.test(message)
}

const NOTE_TYPE_WORDS: Readonly<Record<string, string>> = { permission_prompt: 'Permission prompt', elicitation_dialog: 'MCP input' }

/** A notification's type in words, for a card's title: "Permission prompt", "MCP input"; one the deck does not know as Claude Code sent it. */
export function noteTypeTextOf(kind: string): string {
  return NOTE_TYPE_WORDS[kind] ?? kind
}

/**
 * The call in flight a notification waits on: the newest call of the tool a
 * permission prompt names ("…permission to use Bash"), or of any MCP tool
 * for a server's question; within `agentId`'s loop when one is named.
 */
function waitingCallOf(data: DeckData, kind: string, message: string, agentId: string | undefined): { agent: string; call: string } | undefined {
  const named = /permission to use (.+)$/i.exec(message.trim())?.[1]?.trim().toLowerCase()
  const fits = (tool: string): boolean => {
    const lower = tool.toLowerCase()
    if (named) return lower === named || (lower.startsWith('mcp__') && named.includes(lower.split('__').pop() ?? lower))
    return kind === 'elicitation_dialog' && lower.startsWith('mcp__')
  }
  let best: { agent: string; call: string; at: number } | undefined
  for (const agent of data.agents) {
    if (agent.kind === 'you' || agent.kind === 'peer' || (agentId !== undefined && agent.id !== agentId)) continue
    for (const call of agent.recent) {
      if (call.ms === undefined && fits(call.tool) && (!best || call.at >= best.at)) best = { agent: agent.id, call: call.id, at: call.at }
    }
  }
  return best && { agent: best.agent, call: best.call }
}

/**
 * Notes that the engine waits on the person, with the agent and the call
 * that wait when they can be told (`agent` is the notification's own
 * `agent_id`, when it carried one): in `data.needs` (the same notice of the
 * same loop and call again replaces the older; the newest 20 kept), its
 * words as Claude Code wrote them, and the newest on the Orchestrator for
 * the screens of earlier builds (`needs`). Answers the note.
 */
export function noteNeeds(data: DeckData, note: { kind: string; text: string; at: number; agent?: string; title?: string }): DeckNeeds | undefined {
  const main = agentOf(data, MAIN)
  if (!main) return undefined
  const named = note.agent !== undefined && agentOf(data, note.agent) ? note.agent : undefined
  const waiting = waitingCallOf(data, note.kind, note.text, named)
  const agent = waiting?.agent ?? named
  const title = trunc(oneLine(note.title ?? ''), 120)
  L.noteWait(agentOf(data, agent ?? MAIN), { kind: 'note', from: note.at, ...(waiting ? { call: waiting.call } : {}) })
  const needs: DeckNeeds = {
    text: trunc(oneLine(note.text), NOTE_CHARS),
    kind: note.kind,
    at: note.at,
    ...(agent !== undefined ? { agent } : {}),
    ...(waiting ? { call: waiting.call } : {}),
    ...(title !== '' ? { title } : {}),
  }
  data.needs = [...data.needs.filter(one => !(one.kind === needs.kind && one.agent === needs.agent && one.call === needs.call)), needs].slice(-LIMITS.needs)
  main.needs = shownNeedsOf(needs)
  return needs
}

/** A note as the screens of earlier builds read it on the Orchestrator: never without words. */
function shownNeedsOf(needs: DeckNeeds): DeckNeeds {
  return needs.text !== '' ? { ...needs } : { ...needs, text: 'Claude is waiting for you' }
}

/** What moved since the engine started waiting on the person. */
export type NeedsMove = { kind: 'turn' } | { kind: 'start'; agent: string } | { kind: 'end'; agent: string; call: string }

/**
 * Takes each needs-you note down once what it waited on moved: the main
 * loop's turn starting (a note of the Orchestrator's); the agent it waits on
 * starting another call; the call it waits on ending (with no call told, any
 * call of that agent ending). The agent is the Orchestrator unless the note
 * names another. The Orchestrator's `needs` follows: the newest note left.
 * Answers whether any went.
 */
export function clearNeeds(data: DeckData, move: NeedsMove): boolean {
  const main = agentOf(data, MAIN)
  if (!main) return false
  const isMoved = (needs: DeckNeeds): boolean => {
    const owner = needs.agent ?? MAIN
    if (move.kind === 'turn') return owner === MAIN
    if (move.kind === 'start') return move.agent === owner
    return needs.call !== undefined ? move.call === needs.call : move.agent === owner
  }
  const kept = data.needs.filter(one => !isMoved(one))
  const isListMoved = kept.length !== data.needs.length
  const isShownMoved = main.needs !== undefined && isMoved(main.needs)
  if (!isListMoved && !isShownMoved) return false
  data.needs = kept
  const newest = kept[kept.length - 1]
  if (newest) main.needs = shownNeedsOf(newest)
  else delete main.needs
  return true
}

/**
 * Claude Code's notification (classic Notification), as it sent it: a chat
 * row from Claude Code to you, its words and its title (else its type)
 * verbatim, about the loop it fired in (the same words of the same type
 * within 30 s are one row); and, when it asks something of the person
 * (`isNeedsYou`), a need (`noteNeeds`). An idle prompt is neither: Claude
 * Code only says its turn ended. Answers whether anything changed.
 */
export function noteNotification(data: DeckData, note: { type: string; message: string; title?: string; agent?: string; at: number }): boolean {
  if (note.type === IDLE_KIND) return false
  const text = note.message.trim()
  const title = trunc(oneLine(note.title?.trim() || note.type), 120)
  const agent = note.agent !== undefined && note.agent !== '' ? note.agent : undefined
  let isChanged = false
  const last = [...data.messages].reverse().find(one => one.kind === 'notification')
  const isAgain = last !== undefined && last.text === trunc(text, LIMITS.messageChars) && (last.title ?? '') === title && note.at - last.at < 30_000
  if (!isAgain && (text !== '' || title !== '')) {
    addMessage(data, { from: ENGINE, to: YOU, kind: 'notification', text, at: note.at, ...(title !== '' ? { title } : {}), ...(agent ? { agent } : {}) })
    isChanged = true
  }
  if (isNeedsYou(note.type, note.message)) {
    noteNeeds(data, { kind: note.type, text: note.message, at: note.at, ...(agent ? { agent } : {}), ...(note.title ? { title: note.title } : {}) })
    isChanged = true
  }
  return isChanged
}

/** One background task's notification (`<task-notification>…</task-notification>`), as its own tags say it. */
export type TaskNotice = { taskId?: string; toolUseId?: string; status?: string; summary?: string }

/** The task notifications a text holds, each block's tags read (task-id, tool-use-id, status, summary); none for text with no block. */
export function taskNoticesOf(text: string): TaskNotice[] {
  const notices: TaskNotice[] = []
  for (const block of text.matchAll(/<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/g)) {
    const body = block[1] ?? ''
    const tag = (name: string): string | undefined => {
      const said = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1]?.trim()
      return said ? said : undefined
    }
    const notice: TaskNotice = {}
    const taskId = tag('task-id')
    const toolUseId = tag('tool-use-id')
    const status = tag('status')
    const summary = tag('summary')
    if (taskId) notice.taskId = taskId
    if (toolUseId) notice.toolUseId = toolUseId
    if (status) notice.status = status
    if (summary) notice.summary = summary
    if (Object.keys(notice).length > 0) notices.push(notice)
  }
  return notices
}

/**
 * The task notifications a prompt or a turn of the main loop's holds, each a
 * chat row from Claude Code to the main loop: its summary verbatim (else its
 * task's id and status), its status as the title, about the agent whose task
 * it is (by its id, or the Agent call that started it). One already logged
 * (the same task, status and words among the last 50 messages) is not
 * logged again. Answers whether any was.
 */
export function noteTaskNotices(data: DeckData, text: string, at: number): boolean {
  let isChanged = false
  for (const notice of taskNoticesOf(text)) {
    const agent = data.agents.find(one => (notice.taskId !== undefined && one.id === notice.taskId) || (notice.toolUseId !== undefined && one.toolUseId === notice.toolUseId))
    const words = notice.summary ?? [notice.taskId, notice.status].filter(Boolean).join(' ')
    const title = notice.status ?? ''
    const body = trunc(words.trim(), LIMITS.messageChars)
    const isLogged = data.messages.slice(-50).some(one => one.kind === 'task' && one.text === body && (one.title ?? '') === title && one.agent === agent?.id)
    if (isLogged || words.trim() === '') continue
    addMessage(data, { from: ENGINE, to: MAIN, kind: 'task', text: words, at, ...(title !== '' ? { title } : {}), ...(agent ? { agent: agent.id } : {}) })
    isChanged = true
  }
  return isChanged
}

/** The plan the person approved (ExitPlanMode), as Claude wrote it, by the loop `by` that made it: the one shown until the next. */
export function noteApproved(data: DeckData, text: string, by: string, at: number): boolean {
  const body = text.trim()
  if (body === '') return false
  data.approved = { text: trunc(body, LIMITS.planChars), at, by }
  return true
}

// Held on you: the calls the engine holds on the person, a question (AskUserQuestion) or a permission prompt.

/** The calls held on the person for agent `id` (every agent's when none is named), oldest first. */
export function pendingOf(data: DeckData, id?: string): DeckPending[] {
  return id === undefined ? data.pending : data.pending.filter(item => item.agentId === id)
}

/** Notes a call held on the person, once per call (a newer note of it replaces the older); the newest 20 are kept. */
export function notePending(data: DeckData, item: DeckPending): DeckPending {
  L.noteWait(agentOf(data, item.agentId), { kind: 'held', from: item.at, call: item.id })
  data.pending = [...data.pending.filter(one => one.id !== item.id), item]
  if (data.pending.length > LIMITS.pending) data.pending.splice(0, data.pending.length - LIMITS.pending)
  return item
}

/** Takes down held call `id` (it ended, was denied, or was answered); answers it, or undefined when none was held. */
export function dropPending(data: DeckData, id: string): DeckPending | undefined {
  const found = data.pending.find(item => item.id === id)
  if (found) data.pending = data.pending.filter(item => item !== found)
  return found
}

/**
 * Agent `id`'s loop moved on (another step, another call, its turn's end):
 * every call of its noted as held on you has ended, save those in `open`,
 * whose ends are still to come (the calls in flight the deck saw start). A
 * reload leaves the others behind with no end to see. Answers whether any went.
 */
export function dropStale(data: DeckData, id: string, open: ReadonlySet<string>): boolean {
  const kept = data.pending.filter(item => item.agentId !== id || open.has(item.id))
  const isDropped = kept.length !== data.pending.length
  data.pending = kept
  return isDropped
}

/**
 * A permission prompt held on the person for a call: its shell command
 * whole (at most 2000 characters), else the file it touches (relative to
 * `root` when inside it), and what the call says it does (a shell call's
 * description) or, for any other tool, what it is aimed at.
 */
export function permissionOf(call: { id: string; tool: string; input: unknown; agentId: string; at: number }, root: string | null): DeckPending {
  const input = isRecord(call.input) ? call.input : {}
  const item: DeckPending = { id: call.id, agentId: call.agentId, kind: 'permission', tool: call.tool, at: call.at }
  const isShell = SHELL_TOOLS.includes(call.tool)
  const command = isShell ? str(input.command) : undefined
  const file = str(input.file_path) ?? str(input.notebook_path)
  if (command) item.command = trunc(command.trim(), 2000)
  else if (file) item.path = relOf(file, root)
  const described = str(input.description) ?? (!isShell && !file ? targetOf(call.tool, input, root) : '')
  if (described && described !== toolNameOf(call.tool)) item.description = trunc(oneLine(described), 200)
  return item
}

/** The tools whose permission prompt names the file they touch, by what they do to it. */
const PATH_VERBS: Readonly<Record<string, string>> = { Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read' }

/** A tool's name as a person reads it: an MCP tool's server and tool (`github / create_issue`). */
function toolNameOf(tool: string): string {
  return tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' / ') : tool
}

/**
 * A permission prompt in words, after the agent's label: `needs your OK to
 * run \`npm test\`` (a shell command), `…to edit \`src/a.ts\`` (a file), or
 * `…to use WebFetch`.
 */
export function permissionPhraseOf(tool: string, command?: string, path?: string): string {
  if (command) return `needs your OK to run \`${trunc(oneLine(command), 60)}\``
  if (path) return `needs your OK to ${PATH_VERBS[tool] ?? `use ${toolNameOf(tool)} on`} \`${truncStart(path, 60)}\``
  return `needs your OK to use ${toolNameOf(tool)}`
}

/** A question in words, after the agent's label: `asks: Which library should we use?`, or `asks 3 questions`. */
export function questionPhraseOf(questions: readonly { question: string }[]): string {
  if (questions.length > 1) return `asks ${questions.length} questions`
  const first = oneLine(questions[0]?.question ?? '')
  return first ? `asks: ${trunc(first, 100)}` : 'asks you a question'
}

/** A call held on the person in words, after its agent's label. */
export function pendingPhraseOf(item: DeckPending): string {
  return item.kind === 'question' ? questionPhraseOf(item.questions ?? []) : permissionPhraseOf(item.tool, item.command, item.path)
}

/**
 * What agent `id` waits on the person for, as the words after its label
 * (`asks: Which library?`, `needs your OK to run \`npm test\``); '' while it
 * waits on nothing. A call held on you speaks before the engine's notification.
 */
export function waitPhraseOf(data: DeckData, id: string): string {
  const held = pendingOf(data, id)[0]
  if (held) return pendingPhraseOf(held)
  const needs = agentOf(data, MAIN)?.needs
  return needs && (needs.agent ?? MAIN) === id ? waitingOnOf(data, needs) : ''
}

/** Those words standing alone, as a line of their own: "Asks: Which library?", "Needs your OK to run `npm test`". */
export function waitLineOf(phrase: string): string {
  return phrase === '' ? '' : `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`
}

/** Whether the engine waits on the person for agent `id`: a call of its is held on them, or the needs-you note names it. */
export function waitsOnYou(data: DeckData, id: string): boolean {
  if (data.pending.some(item => item.agentId === id)) return true
  const needs = agentOf(data, MAIN)?.needs
  return needs !== undefined && (needs.agent ?? MAIN) === id
}

/**
 * The status every screen draws for `agent`: `statusOf`, save that waiting
 * (amber) is only ever the one the engine waits on you for. A loop held on
 * anything else (its own background work) is work going on: it runs.
 */
export function shownStatusOf(agent: DeckAgent, data: DeckData): DeckShownStatus {
  const status = statusOf(agent, data)
  return status === 'waiting' && !waitsOnYou(data, agent.id) ? 'running' : status
}

/** An AskUserQuestion call's questions as one message: each its own paragraph. */
export function questionsTextOf(questions: readonly DeckQuestion[]): string {
  return questions
    .map(one => one.question.trim())
    .filter(text => text !== '')
    .join('\n\n')
}

/**
 * How a question call was answered, in words: the one answer to its one
 * question; with several, each answered one's chip (its question when it has
 * none) and answer, joined with " · ".
 */
export function answeredOf(questions: readonly DeckQuestion[], answers: Readonly<Record<string, string>>): string {
  const said = questions.flatMap(one => {
    const answer = oneLine(answers[one.question] ?? '')
    return answer ? [{ one, answer }] : []
  })
  if (said.length === 0) return Object.values(answers).map(oneLine).filter(answer => answer !== '').join(' · ')
  if (questions.length === 1) return said[0]?.answer ?? ''
  return said.map(({ one, answer }) => `${oneLine(one.header) || trunc(oneLine(one.question), 40)}: ${answer}`).join(' · ')
}

/**
 * What an AskUserQuestion call's result says of how it was answered: its
 * answers by question (strings only), the words typed in place of picking,
 * and whether its dialog answered itself after the person was idle
 * (`afkTimeoutMs`). Undefined for a result of no such shape (a refusal, an error).
 */
export function questionResultOf(result: unknown): { answers: Record<string, string>; response: string; isIdle: boolean } | undefined {
  if (!isRecord(result)) return undefined
  const answers: Record<string, string> = {}
  if (isRecord(result.answers)) for (const [question, answer] of Object.entries(result.answers)) if (typeof answer === 'string') answers[question] = answer
  return { answers, response: typeof result.response === 'string' ? result.response : '', isIdle: typeof result.afkTimeoutMs === 'number' }
}

/** The main loop's turn `turnId` started at `at` (its `turn.start`, never a subagent's): the one Stop turn ends. */
export function noteMainTurn(data: DeckData, turnId: string, at: number): void {
  if (turnId !== '') {
    L.noteTurnStart(data, agentOf(data, MAIN), at)
    data.mainTurnId = turnId
    data.mainTurnAt = at
  } else {
    delete data.mainTurnId
    delete data.mainTurnAt
  }
}

/** The main loop's turn `turnId` ended (at `at`, when told: the timeline keeps the turn): no turn of its runs (one that ended out of order leaves a newer one in place). */
export function endMainTurn(data: DeckData, turnId: string, at?: number): void {
  if (data.mainTurnId !== undefined && turnId !== '' && data.mainTurnId !== turnId) return
  L.noteTurnEnd(data, agentOf(data, MAIN), at)
  delete data.mainTurnId
  delete data.mainTurnAt
}

/** What came of a web deck command (by its own `id`): a later word on it replaces the earlier; the newest 50 are kept. */
export function noteAck(data: DeckData, ack: DeckAck): DeckAck {
  data.acks = [...data.acks.filter(one => one.id !== ack.id), ack]
  if (data.acks.length > LIMITS.acks) data.acks.splice(0, data.acks.length - LIMITS.acks)
  return ack
}

// The banner: the one thing to notice now.

export type BannerTone = 'alert' | 'attention' | 'busy' | 'quiet'
export type Banner = { tone: BannerTone; text: string; agentId?: string }

/** How long an agent that failed leads the banner. */
export const FAILED_SHOWN_MS = 10 * 60_000
/** The window "busiest" counts calls in. */
const BUSY_MS = 120_000

/** The agents that do the work: the Orchestrator, subagents and teammates; not you, not outside peers. */
function workersOf(data: DeckData): DeckAgent[] {
  return data.agents.filter(agent => agent.kind !== 'you' && agent.kind !== 'peer')
}

/** Whether an agent waits on a child agent of its own still at work: busy, not waiting on you. */
function hasLiveChild(data: DeckData, id: string): boolean {
  return data.agents.some(agent => agent.id !== id && agent.parentId === id && (agent.kind === 'agent' || agent.kind === 'teammate') && isLive(agent.status))
}

function failureOf(agent: DeckAgent): string {
  if (agent.answer) return firstLine(agent.answer)
  for (let i = agent.recent.length - 1; i >= 0; i--) {
    const one = agent.recent[i]
    if (one?.ok === false) return `${saidOf(one)} failed`
  }
  return ''
}

function busyOf(agent: DeckAgent, now: number): number {
  return agent.recent.filter(one => now - one.at <= BUSY_MS).length
}

/** A lead and its detail on one line, the detail cut to fit. */
function banner(tone: BannerTone, lead: string, detail: string, agentId?: string): Banner {
  const text = detail ? `${lead}: ${trunc(oneLine(detail), 100)}` : lead
  return agentId !== undefined ? { tone, text, agentId } : { tone, text }
}

/**
 * The one line to notice now, most urgent first:
 * 1. an agent that failed in the last ten minutes (`alert`);
 * 2. the engine waiting on you, or an agent waiting (one waiting on a child
 *    agent of its own is busy, not waiting on you) (`attention`);
 * 3. how many agents run, and what the busiest one is doing (`busy`);
 * 4. uncommitted changes in the repository the deck follows (`quiet`);
 * 5. all quiet (`quiet`).
 *
 * `agentId` names the agent the line is about. The text carries no clock
 * time, so it changes only when what it says does.
 */
export function bannerOf(data: DeckData, git: Pick<GitState, 'isRepo' | 'files'>, now: number): Banner {
  const workers = workersOf(data)
  const endOf = (agent: DeckAgent) => agent.endedAt ?? agent.lastAt

  const failed = workers.filter(agent => agent.status === 'failed' && now - endOf(agent) <= FAILED_SHOWN_MS).sort((a, b) => endOf(b) - endOf(a))
  const lastFailed = failed[0]
  if (lastFailed) {
    const lead = failed.length > 1 ? `${failed.length} failed · ${labelOf(lastFailed)}` : `${labelOf(lastFailed)} failed`
    return banner('alert', lead, failureOf(lastFailed), lastFailed.id)
  }

  // a call held on you (the oldest first), else the engine's notification
  const held = data.pending[0]
  if (held) {
    const agent = agentOf(data, held.agentId)
    return banner('attention', `${agent ? labelOf(agent) : ORCHESTRATOR} ${pendingPhraseOf(held)}`, '', agent ? held.agentId : MAIN)
  }
  const needs = workers.find(agent => agent.needs)?.needs
  if (needs) return banner('attention', needs.text, '', needs.agent ?? MAIN)

  const waiting = workers.filter(agent => statusOf(agent) === 'waiting' && !hasLiveChild(data, agent.id)).sort((a, b) => b.lastAt - a.lastAt)
  const firstWaiting = waiting[0]
  if (firstWaiting) {
    const lead = waiting.length > 1 ? `${waiting.length} waiting · ${labelOf(firstWaiting)}` : `${labelOf(firstWaiting)} is waiting`
    return banner('attention', lead, nowOf(firstWaiting), firstWaiting.id)
  }

  const running = workers.filter(agent => statusOf(agent) === 'running')
  const busiest = [...running].sort(
    (a, b) =>
      busyOf(b, now) - busyOf(a, now) ||
      Number(b.current !== undefined) - Number(a.current !== undefined) ||
      Number(a.kind === 'main') - Number(b.kind === 'main') ||
      b.lastAt - a.lastAt,
  )[0]
  if (busiest) return banner('busy', `${running.length} running · ${labelOf(busiest)}`, nowOf(busiest), busiest.id)

  if (git.isRepo && git.files.length > 0) return banner('quiet', `${plural(git.files.length, 'file')} changed, not committed`, '')
  return banner('quiet', 'All quiet', '')
}

/** Who an agent talked with: the messages it sent each counterpart and got from them, and when they last spoke. */
export type Talk = { id: string; sent: number; received: number; last: number }

/** Message counts per counterpart of `agentId`, the one it talked with most first. */
export function talkOf(data: DeckData, agentId: string): Talk[] {
  const byId = new Map<string, Talk>()
  for (const message of data.messages) {
    if (message.from === message.to || message.to === '') continue
    const isSent = message.from === agentId
    if (!isSent && message.to !== agentId) continue
    const other = isSent ? message.to : message.from
    const talk = byId.get(other) ?? { id: other, sent: 0, received: 0, last: 0 }
    if (isSent) talk.sent += 1
    else talk.received += 1
    talk.last = Math.max(talk.last, message.at)
    byId.set(other, talk)
  }
  return [...byId.values()].sort((a, b) => b.sent + b.received - (a.sent + a.received) || b.last - a.last || a.id.localeCompare(b.id))
}

/**
 * The agent a pick of message `id` opens: the one it went to, or its sender
 * when it went to you; undefined when the deck no longer holds the message
 * or that agent.
 */
export function messageTargetOf(data: DeckData, id: string): string | undefined {
  const message = data.messages.find(one => one.id === id)
  if (!message) return undefined
  const target = message.to === YOU ? message.from : message.to
  return agentOf(data, target) ? target : undefined
}

/**
 * What the screens show of the agents that time alone can change, as one
 * string: each agent's status, now text and (while it runs) coarse elapsed
 * time, and the banner. Equal keys draw the same agents.
 */
export function agentsKeyOf(data: DeckData, git: Pick<GitState, 'isRepo' | 'files'>, now: number): string {
  const rows = data.agents.map(agent => `${agent.id}\t${statusOf(agent)}\t${nowOf(agent)}\t${isLive(agent.status) ? elapsedOf(agent, now) : ''}`)
  const shown = bannerOf(data, git, now)
  rows.push(`banner\t${shown.tone}\t${shown.text}\t${shown.agentId ?? ''}`)
  return rows.join('\n')
}

// ---------------------------------------------------------------------------
// v3: where loops come from, spawns and their placeholders, results, goals,
// checklists, the task board, plans, files, and the queries the Agents tab
// reads (goalOf, planOf, checklistOf, stepOf, lastActionOf, filesOf,
// needsOf, summaryOf, foldOf). All pure, like the rest of this module.

// Loops: where each came from, and the rows that fold away.

/** Where the agent's loop came from (DeckOrigin), or what it is: the main loop, you, an outside peer. */
export function originOf(agent: DeckAgent): DeckOrigin | 'main' | 'you' | 'peer' {
  if (agent.kind === 'main' || agent.kind === 'you' || agent.kind === 'peer') return agent.kind
  return agent.origin ?? (agent.kind === 'teammate' ? 'teammate' : 'agent')
}

/** A workflow's agent or the engine's own loop: folded into one dim row, never one of the Orchestrator's children. */
export function isFolded(agent: DeckAgent): boolean {
  return agent.origin === 'workflow' || agent.origin === 'engine'
}

/** A subagent or teammate the outline shows (not folded away). */
export function isShownAgent(agent: DeckAgent): boolean {
  return (agent.kind === 'agent' || agent.kind === 'teammate') && !isFolded(agent)
}

/** Whether an agent has no name of its own: none given, or the one `ensureAgent` made up. */
export function isNameless(agent: DeckAgent): boolean {
  return agent.name.trim() === '' || isMadeUpName(agent)
}

/** Whether any agent the outline shows is at work (a placeholder counts). */
export function hasLiveAgents(data: DeckData): boolean {
  return data.agents.some(agent => isShownAgent(agent) && isLive(agent.status))
}

/** The ids of the agents `id` spawned that the outline shows, in spawn order. */
export function childrenOf(data: DeckData, id: string): string[] {
  return data.agents.filter(agent => isShownAgent(agent) && parentIdOf(data, agent) === id).map(agent => agent.id)
}

/** The folded loops, as their one dim row draws them. */
export type DeckFold = {
  ids: string[]
  /** How many of them run. */
  live: number
  workflow: number
  engine: number
  /** "3 workflow agents · 1 housekeeping loop · 2 running". */
  text: string
}

/** The workflow agents and housekeeping loops, folded into one dim row; undefined while there are none. */
export function foldOf(data: DeckData): DeckFold | undefined {
  const folded = data.agents.filter(agent => (agent.kind === 'agent' || agent.kind === 'teammate') && isFolded(agent))
  if (folded.length === 0) return undefined
  const workflow = folded.filter(agent => agent.origin === 'workflow').length
  const engine = folded.length - workflow
  const live = folded.filter(agent => isLive(agent.status)).length
  const parts = [workflow > 0 ? plural(workflow, 'workflow agent') : '', engine > 0 ? plural(engine, 'housekeeping loop') : '', live > 0 ? `${live} running` : '']
  return { ids: folded.map(agent => agent.id), live, workflow, engine, text: parts.filter(part => part !== '').join(' · ') }
}

/**
 * The row for a loop id a tool call or a message names: a known one as it
 * is; an unknown one is a workflow's agent while a Workflow run is live
 * (under the loop that called it), else the engine's own housekeeping (a
 * compaction or memory fork, anything with no spawn).
 */
export function seeLoop(data: DeckData, id: string, now: number): DeckAgent {
  const found = agentOf(data, id)
  if (found) return found
  const run = liveWorkflowOf(data, now)
  const made = ensureAgent(data, id, now, run ? 'workflow' : 'engine')
  if (run) {
    made.workflow = run.id
    made.parentId = run.caller
    if (run.goal !== undefined) made.goal = run.goal
    run.lastAt = now
  }
  return made
}

/** Sets an ended or idle agent going again (a message woke it, a step of its loop ran): its run's result is open again, and with `at` it was resumed then. */
export function reopen(agent: DeckAgent, at?: number): boolean {
  if (agent.kind === 'main' || agent.kind === 'you' || agent.kind === 'peer') return false
  if (!isEnded(agent.status) && agent.status !== 'idle') return false
  L.noteWake(agent, at ?? agent.lastAt)
  agent.status = 'running'
  delete agent.endedAt
  delete agent.resultVia
  if (at !== undefined) agent.resumedAt = at
  return true
}

/**
 * A known agent resumed (`agent.spawn` with `resume`: a SendMessage woke it,
 * or Claude Code brought it back): no new spawn, the same row, its task and
 * description as its first spawn gave them, running again from `at`.
 * Undefined for an agent the deck does not know.
 */
export function noteResume(data: DeckData, agentId: string, at: number): DeckAgent | undefined {
  const agent = agentOf(data, agentId)
  if (!agent || agent.kind === 'main' || agent.kind === 'you' || agent.kind === 'peer') return undefined
  reopen(agent, at)
  agent.status = 'running'
  delete agent.endedAt
  agent.resumedAt = at
  agent.lastAt = Math.max(agent.lastAt, at)
  return agent
}

/** How close in time a send and the resume it caused are, to be one message. */
const RESUME_MS = 30_000

/**
 * The message row a send to `to` with these words logged lately (within
 * half a minute of `at`): a SendMessage that wakes a finished agent raises
 * its send and the agent's resume both, and is one message.
 */
export function loggedSendOf(data: DeckData, send: { to: string; text: string; at: number }): DeckMessage | undefined {
  const words = oneLine(send.text)
  if (words === '') return undefined
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const one = data.messages[i]
    if (!one) continue
    if (send.at - one.at > RESUME_MS) return undefined
    // the first words are enough: a row past its cut keeps them
    if (one.kind === 'message' && one.to === send.to && oneLine(one.full ?? one.text).slice(0, 300) === words.slice(0, 300)) return one
  }
  return undefined
}

// Results: what each agent handed back.

const RESULT_RANK: Readonly<Record<NonNullable<DeckAgent['resultVia']>, number>> = { stop: 0, call: 1, answer: 2, handback: 3 }

/** Whether two texts are one report: the same words, one cut or led by a warning, a backslash or two inserted. */
function isSameReport(a: string, b: string): boolean {
  const x = oneLine(a.replace(/\\/g, ''))
  const y = oneLine(b.replace(/\\/g, ''))
  if (x === '' || y === '') return false
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return long.includes(short.slice(0, 120))
}

function lastResultOf(data: DeckData, id: string): DeckMessage | undefined {
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const message = data.messages[i]
    if (message && message.from === id && message.kind === 'result') return message
  }
  return undefined
}

/**
 * Records `text` as the agent's result for this run, from `via`: its
 * SubagentHandback `message` (strongest), its turn's answer, its foreground
 * Agent call's text, or SubagentStop's last message. One result message per
 * run: the same report again adds nothing, a weaker source never replaces a
 * stronger one, and a stronger one rewrites the result in place. A run
 * reopened only to report the same again (an answer, then the hand-back the
 * engine asked for) rewrites its last result message rather than adding one.
 */
export function noteResult(data: DeckData, agent: DeckAgent, text: string, at: number, via: NonNullable<DeckAgent['resultVia']> = 'answer'): boolean {
  const body = text.trim()
  if (body === '') return false
  const held = agent.resultVia
  if (held !== undefined) {
    if (agent.answer !== undefined && isSameReport(agent.answer, body)) {
      if (RESULT_RANK[via] > RESULT_RANK[held]) agent.resultVia = via
      return false
    }
    if (RESULT_RANK[via] < RESULT_RANK[held]) return false
    agent.answer = trunc(body, LIMITS.answerChars)
    agent.resultVia = via
    const shown = lastResultOf(data, agent.id)
    if (shown) {
      setMessageText(shown, body)
      pruneFull(data)
      return true
    }
  } else if (agent.answer !== undefined && isSameReport(agent.answer, body)) {
    // a run reopened to hand back what it reported already (the engine asked for its hand-back): still one result message
    const shown = lastResultOf(data, agent.id)
    if (shown) {
      agent.answer = trunc(body, LIMITS.answerChars)
      agent.resultVia = via
      setMessageText(shown, body)
      pruneFull(data)
      return true
    }
  }
  agent.answer = trunc(body, LIMITS.answerChars)
  agent.resultVia = via
  addMessage(data, { from: agent.id, to: agent.parentId ?? MAIN, kind: 'result', text: body, at })
  return true
}

/**
 * The Orchestrator's latest answer to the person (its turn's last words),
 * kept as its result: what the web deck shows as its report. No message is
 * added: it answers you, and your Claude Code conversation holds it already.
 * Answers whether it changed.
 */
export function noteMainAnswer(agent: DeckAgent, text: string): boolean {
  const body = trunc(typeof text === 'string' ? text.trim() : '', LIMITS.answerChars)
  if (body === '' || agent.answer === body) return false
  agent.answer = body
  return true
}

/** Words that only announce a report ("Done", "Summary", "Verdict"): the row says "Done:" itself. */
const REPORT_WORDS = 'done|all done|finished|complete|completed|summary|results?|report|verdict|outcome|status|answer|conclusion|findings|tl;?\\s?dr|bottom line|overall'

/**
 * A line's opening of `words` ("Done:", "Final report:", "Summary of changes:",
 * "Done —"): an adjective may lead them and an "of …" follow, then a colon, a
 * dash or a stop, or nothing more on the line.
 */
function leadOf(words: string): RegExp {
  return new RegExp(String.raw`^(?:(?:final|short|brief|quick|overall)\s+)?(?:${words})(?:\s+of(?:\s+[\w-]+){1,3})?(?:(?:\s*[:.!](?=\s|$)|\s*[—–]|\s+-(?=\s))\s*|\s*$)`, 'i')
}

const REPORT_LEAD = leadOf(REPORT_WORDS)
/** On a failed row, its own "Failed:" goes too. */
const FAILURE_LEAD = leadOf(`${REPORT_WORDS}|failed|failure`)
/** Abbreviations whose stop ends no sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|cf|approx|incl|esp)\.$/i

/** `line`'s first sentence: up to its first stop (. ! ?) that more words follow, an abbreviation's aside; the whole line with none. */
export function firstSentenceOf(line: string): string {
  const stops = /[.!?](?=\s+\S)/g
  for (let found = stops.exec(line); found; found = stops.exec(line)) {
    const head = line.slice(0, found.index + 1)
    if (!ABBREVIATION.test(head)) return head
  }
  return line
}

/**
 * An absolute path inside a line of text: a drive's (C:\… or C:/…), or a
 * POSIX one of two parts or more, never a URL's; it runs to a space, a quote,
 * a bracket, a comma or a semicolon.
 */
const ABS_PATH = /(?<![\w.~:/\\-])(?:[A-Za-z]:[\\/]|\/(?=[^\s/]+\/))[^\s"'`<>|,;()[\]{}]*/g

/** One absolute path made short: relative under `root`, else its file and the two folders above it after "…/"; one that short already stays. */
function shortPathOf(path: string, root: string): string {
  const norm = normPath(path)
  if (root !== '') {
    const rel = relOf(norm, root)
    if (rel !== norm && rel !== '.') return rel
  }
  const parts = norm.split('/').filter(part => part !== '')
  const below = /^[A-Za-z]:$/.test(parts[0] ?? '') ? parts.slice(1) : parts
  return below.length > 3 ? `…/${below.slice(-3).join('/')}` : path
}

/**
 * `text` with each absolute path in it made short: relative to `root` (the
 * repository shown) when it lies under it, else its file and the two folders
 * above it ("…/demo-repo/src/token.js"). A stop or colon after a path stays.
 */
export function shortPathsIn(text: string, root = ''): string {
  return text.replace(ABS_PATH, found => {
    const path = found.replace(/[.:!?]+$/, '')
    return `${shortPathOf(path, root)}${found.slice(path.length)}`
  })
}

/**
 * The line an ended agent's outline row shows of its result: the first
 * sentence of its report's first line that says something, with the words
 * that only announce a report dropped ("Done:", "Finished:", "Summary:",
 * "Result:", "Report:", "Verdict:" and the like; on a failed row its own
 * "Failed:" too) and its absolute paths made short (`shortPathsIn`, `root`
 * the repository shown). '' when the report says nothing more. The detail's
 * Result keeps the whole text.
 */
export function resultLineOf(text: string, root = '', isFailure = false): string {
  const lead = isFailure ? FAILURE_LEAD : REPORT_LEAD
  for (const raw of text.split('\n')) {
    let line = firstLine(raw)
    for (let pass = 0; pass < 3; pass++) {
      const rest = line.replace(lead, '')
      if (rest === line) break
      line = rest
    }
    if (line !== '') return shortPathsIn(firstSentenceOf(line), root)
  }
  return ''
}

/** Ends a live agent's row now: a teammate goes idle, any other completes. */
function endRow(agent: DeckAgent, at: number): boolean {
  if (!isLive(agent.status)) return false
  agent.status = agent.kind === 'teammate' ? 'idle' : 'completed'
  agent.endedAt = at
  delete agent.current
  delete agent.todo
  return true
}

/** A subagent's loop stopped (classic SubagentStop): its row ends now, and with no result yet, its last message is one. */
export function noteStop(data: DeckData, id: string, lastMessage: string, at: number): boolean {
  const agent = agentOf(data, id)
  if (!agent || (agent.kind !== 'agent' && agent.kind !== 'teammate')) return false
  const isEndedNow = endRow(agent, at)
  const isNoted = agent.resultVia === undefined && lastMessage.trim() !== '' && noteResult(data, agent, lastMessage, at, 'stop')
  return isEndedNow || isNoted
}

/** A teammate went idle (classic TeammateIdle), by its id when the event carried one, else by its name. */
export function noteIdle(data: DeckData, who: { id?: string; name: string }, at: number): boolean {
  const byId = who.id ? agentOf(data, who.id) : undefined
  const agent = byId ?? resolveRecipient(data, who.name)
  if (!agent || (agent.kind !== 'agent' && agent.kind !== 'teammate') || agent.status === 'idle') return false
  agent.status = 'idle'
  agent.endedAt = at
  delete agent.current
  delete agent.todo
  return true
}

// Spawns: a placeholder row the moment the Agent call starts, bound to the agent at its spawn.

/** What an Agent call says of the agent it starts. */
export type AgentCall = { toolUseId: string; parentId: string; name?: string; description: string; prompt: string; type?: string; at: number }

/** A row its Agent call made that no spawn has bound yet. */
export function isPlaceholder(agent: DeckAgent): boolean {
  return agent.toolUseId !== undefined && agent.id === agent.toolUseId
}

/**
 * The row an Agent call makes before the engine spawns anything: keyed by
 * the call's tool_use_id, `starting`, under the loop that called, labelled
 * from the call's `name` or `description`, stamped with the goal and with
 * what its caller had in progress.
 */
export function addPlaceholder(data: DeckData, call: AgentCall): DeckAgent {
  const known = data.agents.find(agent => agent.toolUseId === call.toolUseId)
  if (known) return known
  const goal = goalOf(data)
  const during = duringOf(data, call.parentId)
  const agent = newAgent(call.toolUseId, 'agent', (call.name ?? '').trim(), call.at, {
    type: call.type?.trim() || 'general-purpose',
    description: oneLine(call.description),
    prompt: trunc(call.prompt, LIMITS.promptChars),
    parentId: call.parentId,
    status: 'starting',
    origin: 'agent',
    toolUseId: call.toolUseId,
    ...(goal ? { goal: goal.id } : {}),
    ...(during ? { during } : {}),
  })
  data.agents.push(agent)
  pruneAgents(data)
  fixLabel(data, agent)
  return agent
}

/** What the caller had in progress when it made an Agent call: its one in-progress todo or board task; undefined for none or several. */
export function duringOf(data: DeckData, callerId: string): DeckDuring | undefined {
  const caller = agentOf(data, callerId)
  if (!caller) return undefined
  const doing: DeckDuring[] = []
  for (const item of caller.todos ?? []) if (item.status === 'active') doing.push({ kind: 'todo', key: item.key, text: item.text })
  const name = caller.kind === 'main' || isNameless(caller) ? '' : caller.name.toLowerCase()
  for (const task of Object.values(data.board)) {
    if (task.status !== 'active') continue
    const isCallers =
      task.claimedBy === callerId || (name !== '' && task.owner?.toLowerCase() === name) || (callerId === MAIN && task.claimedBy === undefined && task.owner === undefined)
    if (isCallers) doing.push({ kind: 'task', key: task.id, text: task.subject })
  }
  return doing.length === 1 ? doing[0] : undefined
}

/** Folds a twin row (the agent's own events, seen before its spawn was told) into the row that stays. */
function mergeInto(row: DeckAgent, twin: DeckAgent): void {
  row.tools += twin.tools
  row.errors += twin.errors
  for (const [tool, count] of Object.entries(twin.toolCounts)) row.toolCounts[tool] = (row.toolCounts[tool] ?? 0) + count
  for (const file of twin.files) if (!row.files.includes(file)) row.files.push(file)
  row.added += twin.added
  row.removed += twin.removed
  row.tokensIn += twin.tokensIn
  row.tokensOut += twin.tokensOut
  row.cacheRead += twin.cacheRead
  row.requests += twin.requests
  row.recent = [...row.recent, ...twin.recent].sort((a, b) => a.at - b.at).slice(-LIMITS.recent)
  const words = [...(row.words ?? []), ...(twin.words ?? [])].sort((a, b) => a.at - b.at).slice(-LIMITS.words)
  if (words.length > 0) row.words = words
  row.lastAt = Math.max(row.lastAt, twin.lastAt)
  if (twin.current) row.current = twin.current
  if (twin.todos) row.todos = twin.todos
  if (twin.todosAt !== undefined) row.todosAt = twin.todosAt
  if (twin.todo) row.todo = twin.todo
  if (twin.model && !row.model) row.model = twin.model
  L.mergeLanes(row, twin)
  if (twin.answer !== undefined && row.answer === undefined) {
    row.answer = twin.answer
    if (twin.resultVia) row.resultVia = twin.resultVia
  }
}

/** Every reference to agent `from` (messages, edits, files, parents, the board, commits, the needs note) made to `to`. */
function renameAgent(data: DeckData, from: string, to: string): void {
  for (const message of data.messages) {
    if (message.from === from) message.from = to
    if (message.to === from) message.to = to
  }
  for (const edit of data.edits) if (edit.agent === from) edit.agent = to
  for (const file of Object.values(data.files)) {
    let kept: DeckFile['editors'][number] | undefined
    const editors: DeckFile['editors'] = []
    for (const one of file.editors) {
      if (one.agent !== from && one.agent !== to) {
        editors.push(one)
      } else if (!kept) {
        kept = { ...one, agent: to }
        editors.push(kept)
      } else {
        kept.count += one.count
        kept.added += one.added
        kept.removed += one.removed
        kept.firstAt = Math.min(kept.firstAt, one.firstAt)
        kept.lastAt = Math.max(kept.lastAt, one.lastAt)
      }
    }
    file.editors = editors
  }
  for (const agent of data.agents) if (agent.parentId === from) agent.parentId = to
  for (const task of Object.values(data.board)) {
    if (task.createdBy === from) task.createdBy = to
    if (task.claimedBy === from) task.claimedBy = to
  }
  for (const [commit, by] of Object.entries(data.commitsBy)) if (by === from) data.commitsBy[commit] = to
  const needs = agentOf(data, MAIN)?.needs
  if (needs?.agent === from) needs.agent = to
  for (const item of data.pending) if (item.agentId === from) item.agentId = to
  for (const one of data.needs) if (one.agent === from) one.agent = to
}

/**
 * Binds a placeholder row to the agent the engine started: the same row (its
 * place, label and goal kept) takes the agent's id, and a twin row the
 * agent's own events made first is folded into it. Never a second row.
 */
export function bindAgent(data: DeckData, row: DeckAgent, agentId: string): DeckAgent {
  const from = row.id
  if (from === agentId) return row
  const twin = data.agents.find(agent => agent.id === agentId && agent !== row)
  row.id = agentId
  if (twin) {
    mergeInto(row, twin)
    data.agents = data.agents.filter(agent => agent !== twin)
  }
  renameAgent(data, from, agentId)
  return row
}

/** What `agent.spawn` says of the agent it started. */
export type Spawn = {
  toolUseId: string
  agentId: string
  /** The loop it was spawned in (`parentAgentId`), `main` for the main loop. */
  parentId: string
  name?: string
  description: string
  prompt: string
  type: string
  isTeammate: boolean
  /** A workflow agent's run id (`workflow.runId`, '' outside a real run); undefined for any other agent. */
  workflow?: string
  model?: string
  /** The spawn runs it in the background (`agent.spawn`'s `background`). */
  background?: boolean
  at: number
}

/**
 * Folds a spawn in: the placeholder its Agent call made is bound to the new
 * id (`from` says which row it was), else the agent's row is made or found;
 * then its fields, its origin (a workflow's agent folds under its run), its
 * goal, what its caller had in progress, and its label (fixed once).
 */
export function noteSpawn(data: DeckData, spawn: Spawn): { agent: DeckAgent; isNew: boolean; from?: string } {
  const isWorkflow = spawn.workflow !== undefined
  let from: string | undefined
  let agent: DeckAgent | undefined
  if (!isWorkflow) {
    const placeholder = data.agents.find(one => isPlaceholder(one) && one.toolUseId === spawn.toolUseId)
    if (placeholder) {
      from = placeholder.id
      agent = bindAgent(data, placeholder, spawn.agentId)
    }
  }
  const isNew = agent === undefined && agentOf(data, spawn.agentId) === undefined
  agent ??= ensureAgent(data, spawn.agentId, spawn.at)
  const run = isWorkflow ? workflowForSpawn(data, spawn) : undefined
  agent.kind = spawn.isTeammate ? 'teammate' : 'agent'
  agent.origin = run ? 'workflow' : spawn.isTeammate ? 'teammate' : 'agent'
  if (spawn.name) agent.name = spawn.name
  if (spawn.type) agent.type = spawn.type
  agent.description = spawn.description
  agent.prompt = trunc(spawn.prompt, LIMITS.promptChars)
  agent.parentId = run ? run.caller : spawn.parentId
  if (spawn.model) agent.model = spawn.model
  if (spawn.background !== undefined) agent.background = spawn.background
  // a known agent spawned again after its run ended: the timeline keeps that run
  if (!isNew && agent.endedAt !== undefined) L.noteWake(agent, spawn.at)
  agent.status = 'running'
  delete agent.endedAt
  if (isNew) agent.startedAt = spawn.at
  if (run) {
    agent.workflow = run.id
    run.lastAt = Math.max(run.lastAt, spawn.at)
    if (spawn.workflow) run.runId ??= spawn.workflow
  } else {
    agent.toolUseId ??= spawn.toolUseId
    if (agent.during === undefined) {
      const during = duringOf(data, spawn.parentId)
      if (during) agent.during = during
    }
  }
  if (agent.goal === undefined) {
    const goal = goalOf(data)
    if (goal) agent.goal = goal.id
  }
  fixLabel(data, agent)
  return { agent, isNew, ...(from !== undefined ? { from } : {}) }
}

/** How an Agent call ended: the agent it started, or why none started, and what a foreground agent handed back. */
export type AgentCallEnd = {
  toolUseId: string
  agentId?: string
  /** False when the call was refused or failed before an agent started. */
  isStarted: boolean
  why?: string
  /** A foreground agent's report, which its call returns. */
  report?: string
  /** The call returned with its agent done (a foreground run); an async launch leaves it running. */
  isDone?: boolean
  /** It runs in a cloud session: no local loop will report on it. */
  isRemote?: boolean
  at: number
}

/**
 * Settles the row an Agent call made once the call returns: bound to the
 * agent its result names when no spawn bound it; ended (stopped) when no
 * agent started, and idle when it runs in a cloud session, neither with a
 * word the agent never said; a foreground agent's report recorded and its
 * row ended.
 */
export function settleAgentCall(data: DeckData, end: AgentCallEnd): { agent: DeckAgent; from?: string } | undefined {
  const row = data.agents.find(agent => agent.toolUseId === end.toolUseId)
  if (!row) return undefined
  let from: string | undefined
  if (isPlaceholder(row)) {
    if (end.agentId) {
      from = row.id
      bindAgent(data, row, end.agentId)
      if (row.status === 'starting') row.status = 'running'
    } else if (!end.isStarted) {
      row.status = 'killed'
      row.endedAt = end.at
      return { agent: row }
    } else if (end.isRemote) {
      row.status = 'idle'
      row.endedAt = end.at
      return { agent: row }
    }
  }
  if (end.report) noteResult(data, row, end.report, end.at, 'call')
  if (end.isDone) endRow(row, end.at)
  return { agent: row, ...(from !== undefined ? { from } : {}) }
}

// Your words: a prompt as the person wrote it, without what the app and the engine wrap around it.

/**
 * The engine's blocks in a prompt that are no words of the person's, each
 * taken out whole: a reminder, and a local command's echo (its caveat, the
 * command's name, message and arguments, what it printed; a shell command's
 * too).
 */
const NOT_WORDS: readonly string[] = [
  'system-reminder',
  'local-command-caveat',
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
]

/** One such block with the blanks beside it on its line; one left open runs to the end. */
const NOT_WORDS_BLOCK = new RegExp(`[ \\t]*<(${NOT_WORDS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?(?:</\\1\\s*>|$)[ \\t]*`, 'g')

/** A pasted block's start, `<pasted_content id="3c84">` (the Desktop app's), and any block's end, `</pasted_content id="3c84">`. */
const PASTE_START = /<pasted_content(\s[^>]*)?>/
const PASTE_END = /<\/pasted_content(?:\s[^>]*)?>/

/** What a pasted block of `body` reads as: `[pasted text]`, or `[pasted text, 12 lines]` for more than one line (blank lines at its ends not counted). */
function pasteMarkOf(body: string): string {
  const lines = body.split('\n')
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
  return lines.length > 1 ? `[pasted text, ${lines.length} lines]` : '[pasted text]'
}

/** `text` with each pasted block as its mark: a block ends where the end with its own id is, else at the next end, else at the end of the text. */
function markPastes(text: string): string {
  let out = ''
  let rest = text
  for (let start = PASTE_START.exec(rest); start; start = PASTE_START.exec(rest)) {
    const body = rest.slice(start.index + start[0].length)
    const own = start[1] ? `</pasted_content${start[1]}>` : ''
    const ownAt = own ? body.indexOf(own) : -1
    const next = ownAt >= 0 ? null : PASTE_END.exec(body)
    const end = ownAt >= 0 ? { at: ownAt, length: own.length } : next ? { at: next.index, length: next[0].length } : null
    out += rest.slice(0, start.index) + pasteMarkOf(end ? body.slice(0, end.at) : body)
    rest = end ? body.slice(end.at + end.length) : ''
  }
  return out + rest
}

/**
 * A prompt's text as the person wrote it, for the words people read (the
 * goal's headline and text, its follow-ups, your prompts in Talk): each
 * pasted block (`<pasted_content …>…</pasted_content …>`, the Desktop app's)
 * as `[pasted text]`, or `[pasted text, 12 lines]` past one line, with your
 * words around it kept; no reminder (`<system-reminder>…</system-reminder>`)
 * and no local command's echo (`<command-name>`, `<command-message>`,
 * `<command-args>`, `<local-command-caveat>`, what it printed). Trimmed; ''
 * when none of the person's words are left, as for a local command's echo
 * alone. Text with none of these comes back as it was, trimmed.
 */
export function cleanPrompt(text: string): string {
  const plain = text.replace(/\r\n?/g, '\n')
  const cut = markPastes(plain).replace(NOT_WORDS_BLOCK, (block: string, _name: string, at: number, whole: string) => {
    // words right beside it on both sides, on its line, stay apart
    const before = whole[at - 1] ?? ''
    const after = whole[at + block.length] ?? ''
    return /\S/.test(before) && /\S/.test(after) ? ' ' : ''
  })
  if (cut === plain) return plain.trim()
  // what went leaves no blanks at a line's end, nor more than one empty line in a row
  return cut
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Whether a message is a prompt of yours to the Orchestrator: your words as you typed or pasted them, read as `cleanPrompt` cleans them. */
function isYourPrompt(message: Pick<DeckMessage, 'from' | 'kind'>): boolean {
  return message.from === YOU && message.kind === 'prompt'
}

/** A local command's echo: the command's name (`<command-name>/login</command-name>`) and its arguments. */
const ECHO_NAME = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/
const ECHO_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
/** A slash command typed alone, no words after it: "/login", "/plugin:skill". */
const BARE_COMMAND = /^\/[A-Za-z][\w:.-]*$/

/** A slash command as the engine names it (`prompt.submit`'s `command`), as it was typed: "/review the diff". */
export function commandOf(command: { name: string; args: string }): string {
  const args = oneLine(command.args)
  return `/${command.name.replace(/^\//, '')}${args ? ` ${args}` : ''}`
}

/**
 * The slash command a prompt is and nothing else, as typed ("/login"): a
 * command typed alone, or a local command's echo (`<command-name>`,
 * `<command-args>`) with none of your words beside it. '' for a prompt with
 * any words of yours, one that starts with a command among them.
 */
export function commandLineOf(text: string): string {
  const said = cleanPrompt(text)
  if (said !== '') return BARE_COMMAND.test(said) ? said : ''
  const name = ECHO_NAME.exec(text)?.[1]
  return name ? commandOf({ name, args: ECHO_ARGS.exec(text)?.[1] ?? '' }) : ''
}

/**
 * Logs a prompt of yours to the Orchestrator. A slash command run alone
 * (`commandLineOf`, or the one the engine says the prompt runs: `command`,
 * as typed) is the command you ran (`command`, "/login", to nobody in
 * particular), which the chat draws as a small line of its own, never a
 * bubble of yours; anything else is your words, as `addMessage` logs them.
 */
export function addPrompt(data: DeckData, prompt: { text: string; at: number; command?: string }): DeckMessage {
  const line = prompt.command || commandLineOf(prompt.text)
  if (line) return addMessage(data, { from: YOU, to: '', kind: 'command', text: line, at: prompt.at })
  return addMessage(data, { from: YOU, to: MAIN, kind: 'prompt', text: prompt.text, at: prompt.at })
}

// Goals: what the person asked for.

/** Whether a prompt is the person's own words: typed (composer), from a Remote Control client (bridge), the SDK host's, or a plugin's sent as theirs. */
export function isUsersWords(origin: { kind: string; asUser?: unknown }): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk' || (origin.kind === 'plugin' && origin.asUser === true)
}

export type PromptKind = 'goal' | 'followUp' | 'event'

/**
 * What a submitted prompt starts. Anything not in the person's own words is
 * an event, and so is a prompt with none of their words in its `text` once
 * cleaned (`cleanPrompt`): a local command's echo, a reminder alone. Their
 * words start a new goal while the session is idle (no `turnId`: not typed
 * over a running turn; the Orchestrator not running) with nothing live from
 * the last goal; otherwise they follow it up.
 */
export function promptKindOf(data: DeckData, prompt: { origin: { kind: string; asUser?: unknown }; turnId?: string; text?: string }): PromptKind {
  if (!isUsersWords(prompt.origin)) return 'event'
  if (prompt.text !== undefined && cleanPrompt(prompt.text) === '') return 'event'
  // a slash command typed alone ("/login") asks Claude for nothing
  if (prompt.text !== undefined && commandLineOf(prompt.text) !== '') return 'event'
  const last = goalOf(data)
  if (!last || data.isNewGoalNext === true) return 'goal'
  if (prompt.turnId !== undefined) return 'followUp'
  if (agentOf(data, MAIN)?.status === 'running') return 'followUp'
  // the goal's own agents still at work, a workflow's included; the engine's housekeeping is no one's
  const isLeft = data.agents.some(agent => agent.goal === last.id && (agent.kind === 'agent' || agent.kind === 'teammate') && agent.origin !== 'engine' && isLive(agent.status))
  return isLeft ? 'followUp' : 'goal'
}

/** A goal's headline: its first line that says something, at most 80 characters. */
export function headlineOf(text: string): string {
  return trunc(firstLine(text) || oneLine(text), LIMITS.headlineChars)
}

/**
 * Records a prompt in the person's words: a new goal (the newest 20 kept),
 * or a follow-up of the goal in hand. Its words, and a headline given, are
 * read as they wrote them (`cleanPrompt`); a prompt with none of theirs left
 * records nothing.
 */
export function noteGoal(data: DeckData, kind: 'goal' | 'followUp', prompt: { text: string; origin: string; at: number; headline?: string }): DeckGoal | undefined {
  const text = cleanPrompt(prompt.text)
  if (text === '') return undefined
  const last = goalOf(data)
  if (kind === 'followUp' && last) {
    last.followUps.push({ text: trunc(oneLine(text), 300), at: prompt.at })
    if (last.followUps.length > LIMITS.followUps) last.followUps.splice(0, last.followUps.length - LIMITS.followUps)
    return last
  }
  let id = `g${prompt.at}`
  for (let n = 2; data.goals.some(goal => goal.id === id); n++) id = `g${prompt.at}-${n}`
  const headline = prompt.headline ? trunc(oneLine(cleanPrompt(prompt.headline)), LIMITS.headlineChars) : ''
  const goal: DeckGoal = { id, headline: headline || headlineOf(text), text: trunc(text, LIMITS.goalChars), at: prompt.at, followUps: [], origin: prompt.origin }
  data.goals.push(goal)
  if (data.goals.length > LIMITS.goals) data.goals.splice(0, data.goals.length - LIMITS.goals)
  delete data.isNewGoalNext
  return goal
}

/** The goal in hand: the person's latest; undefined before their first prompt. */
export function goalOf(data: DeckData): DeckGoal | undefined {
  return data.goals[data.goals.length - 1]
}

/** The next prompt in the person's words starts a new goal, whatever is still live (a "new goal" button). */
export function armNewGoal(data: DeckData): void {
  data.isNewGoalNext = true
}

/** Gives the goal in hand a slash command's own words as its headline (as `cleanPrompt` reads them), when it started at or after `since`. */
export function retitleGoal(data: DeckData, headline: string, since: number): boolean {
  const goal = goalOf(data)
  const next = trunc(oneLine(cleanPrompt(headline)), LIMITS.headlineChars)
  if (!goal || goal.at < since || next === '' || next === goal.headline) return false
  goal.headline = next
  return true
}

// Recovery: what a reload lost, read back from the transcripts.

/** A transcript's message as `$.session.messages()` reads it, as far as recovery looks. */
export type TranscriptMessage = {
  role: string
  text: string
  toolUses?: readonly { tool: string; input: Record<string, unknown>; isError?: true }[]
  toolResults?: readonly unknown[]
}

/** Marks of a user message that is not the person's own words, anywhere in its text: a notification, an agent's, a teammate's or another session's message, a command's record, a reminder. */
const NOT_OWN_MARKS: readonly string[] = [
  '<task-notification',
  '<agent-message',
  '[SYSTEM NOTIFICATION',
  '<local-command-caveat>',
  '<command-name>',
  '<system-reminder>',
  '[Subagent hand-back]',
  '<cross-session-message',
  '<teammate-message',
]

/** How the engine's own user messages open: an interruption, a local command's or the shell's output, a skill's text. */
const ENGINE_OPENINGS: readonly string[] = ['[Request interrupted by user', '<local-command-stdout>', '<local-command-stderr>', '<bash-input>', '<bash-stdout>', '<bash-stderr>', 'Base directory for this skill:']

/** An image's place in a prompt's text: `[Image #1]`, or the engine's own `[Image: source: …]` after it. */
const IMAGE_MARK = /\[Image(?: #\d+|:[^\]\n]*)\]/g

/**
 * Whether a user message's text is the person's own words: no notification,
 * agent-message, command or reminder mark anywhere in it, no engine opening,
 * and something left beside whitespace and image marks.
 */
export function isOwnWords(text: string): boolean {
  if (NOT_OWN_MARKS.some(mark => text.includes(mark))) return false
  const lead = text.trimStart()
  if (ENGINE_OPENINGS.some(opening => lead.startsWith(opening))) return false
  return text.replace(IMAGE_MARK, '').trim() !== ''
}

/** How a message the engine or another agent sends the main loop opens: a background task's notification, an agent's, a teammate's or another session's message. */
const NOTICE_OPENINGS: readonly string[] = ['<task-notification', '[SYSTEM NOTIFICATION', '<agent-message', '<teammate-message', '<cross-session-message']

/**
 * Whether a turn's text is a notice to the main loop rather than a prompt:
 * it opens with a notification or another agent's message. The person's
 * own prompt that only quotes one further in stays theirs.
 */
export function isNoticeText(text: string): boolean {
  const lead = text.trimStart()
  return NOTICE_OPENINGS.some(opening => lead.startsWith(opening))
}

/**
 * The goal a transcript holds: its newest user message in the person's own
 * words (`isOwnWords`; one of tool results alone, or of whitespace, is none),
 * read as they wrote it, as a live goal is (`cleanPrompt`: each pasted block
 * as its mark, no reminder or local command's echo), and its headline, the
 * first line that says something (80 characters at most). Undefined when
 * there is none. One goal: the messages before it are not its follow-ups.
 */
export function recoverGoal(messages: readonly TranscriptMessage[]): { text: string; headline: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== 'user' || message.text.trim() === '') continue
    const text = cleanPrompt(message.text)
    if (isOwnWords(text)) return { text, headline: headlineOf(text) }
  }
  return undefined
}

/**
 * Records the goal `recoverGoal` found, while none is in hand, as `recovered`.
 * It takes over what the deck held with no goal (the agents, the board's
 * tasks, the Workflow runs), so the plan and the summary count as before, and
 * dates from the earliest of that work and the Orchestrator's todo list, now
 * at the latest. Undefined while a goal is in hand.
 */
export function noteRecoveredGoal(data: DeckData, recovered: { text: string; headline: string }, now: number): DeckGoal | undefined {
  if (goalOf(data)) return undefined
  const agents = data.agents.filter(agent => agent.kind === 'agent' || agent.kind === 'teammate')
  const tasks = Object.values(data.board)
  const times = [...agents.map(agent => agent.startedAt), ...tasks.map(task => task.at), ...data.workflows.map(run => run.startedAt), agentOf(data, MAIN)?.todosAt ?? now]
  const at = Math.min(now, ...times.filter(time => time > 0))
  const goal = noteGoal(data, 'goal', { text: recovered.text, headline: recovered.headline, origin: 'recovered', at })
  if (!goal) return undefined
  for (const one of [...agents, ...tasks, ...data.workflows]) one.goal = goal.id
  return goal
}

/** The agents the outline shows that ended with no result, the latest to end first: the ones a reload may have cost theirs. */
export function unansweredOf(data: DeckData): DeckAgent[] {
  return data.agents
    .filter(agent => isShownAgent(agent) && !isPlaceholder(agent) && isEnded(agent.status) && !agent.answer?.trim())
    .sort((a, b) => (b.endedAt ?? b.lastAt) - (a.endedAt ?? a.lastAt))
}

/**
 * An ended agent's result as its own transcript holds it: the `message` of
 * its last SubagentHandback (a hand-back), else the text of its last message
 * that says or does anything (SubagentStop's last message); undefined with neither.
 */
export function recoverResult(messages: readonly TranscriptMessage[]): { text: string; via: 'handback' | 'stop' } | undefined {
  let last: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== 'assistant') continue
    const uses = message.toolUses ?? []
    for (let j = uses.length - 1; j >= 0; j--) {
      const use = uses[j]
      const report = use && use.tool === 'SubagentHandback' && use.isError !== true ? use.input.message : undefined
      if (typeof report === 'string' && report.trim() !== '') return { text: report.trim(), via: 'handback' }
    }
    // a message of thinking alone says nothing
    if (last === undefined && (message.text.trim() !== '' || uses.length > 0)) last = message.text.trim()
  }
  return last ? { text: last, via: 'stop' } : undefined
}

// Checklists: each agent's whole todo list, and what it is on now.

/** Lower case, words only: how items, steps and texts are matched. */
function normText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Keeps the agent's whole TodoWrite list as its checklist (at most 50). An
 * item keeps its key and its start and end times across rewrites, matched by
 * its normalised content; one seen in progress or done for the first time is
 * stamped `at`, and a done item put back loses its end.
 */
export function noteTodos(agent: DeckAgent, todos: readonly Record<string, unknown>[], at: number): void {
  const before = new Map<string, DeckTodoItem[]>()
  for (const item of agent.todos ?? []) {
    const norm = normText(item.text)
    before.set(norm, [...(before.get(norm) ?? []), item])
  }
  const seen = new Map<string, number>()
  const items: DeckTodoItem[] = []
  for (const raw of todos) {
    if (items.length >= LIMITS.todos) break
    const text = str(raw.content) ?? str(raw.subject) ?? str(raw.activeForm)
    if (!text) continue
    const norm = normText(text)
    const n = (seen.get(norm) ?? 0) + 1
    seen.set(norm, n)
    const prev = before.get(norm)?.shift()
    const status: DeckTodoItem['status'] = raw.status === 'completed' ? 'done' : raw.status === 'in_progress' ? 'active' : 'pending'
    const item: DeckTodoItem = { key: prev?.key ?? `t${hash(norm).toString(36)}${n > 1 ? `-${n}` : ''}`, text: trunc(oneLine(text), NOTE_CHARS), status }
    const doing = str(raw.activeForm)
    if (doing && oneLine(doing) !== oneLine(text)) item.doing = trunc(oneLine(doing), NOTE_CHARS)
    const startedAt = prev?.startedAt ?? (status === 'pending' ? undefined : at)
    if (startedAt !== undefined) item.startedAt = startedAt
    if (status === 'done') item.doneAt = prev?.doneAt ?? at
    items.push(item)
  }
  agent.todos = items
  agent.todosAt = at
}

/** One item of a checklist as the screens read it. */
export type DeckCheckItem = { key: string; text: string; status: DeckStepStatus; doing?: string; startedAt?: number; doneAt?: number }
export type DeckChecklist = { items: DeckCheckItem[]; done: number; total: number }

function boardItemOf(task: DeckTask): DeckCheckItem {
  return {
    key: `task:${task.id}`,
    text: task.subject,
    status: task.status,
    ...(task.doing ? { doing: task.doing } : {}),
    ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
    ...(task.doneAt !== undefined ? { doneAt: task.doneAt } : {}),
  }
}

/**
 * The agent's checklist: its whole TodoWrite list; with none and `data`
 * given, the board tasks it created, claimed or owns. `done` of `total`.
 */
export function checklistOf(agent: DeckAgent, data?: DeckData): DeckChecklist {
  let items: DeckCheckItem[] = (agent.todos ?? []).map(item => ({ ...item }))
  if (items.length === 0 && data && agent.kind !== 'main' && agent.kind !== 'you' && agent.kind !== 'peer') {
    const name = isNameless(agent) ? '' : agent.name.toLowerCase()
    items = Object.values(data.board)
      .filter(task => task.claimedBy === agent.id || task.createdBy === agent.id || (name !== '' && task.owner?.toLowerCase() === name))
      .sort(taskOrder)
      .map(boardItemOf)
  }
  return { items, done: items.filter(item => item.status === 'done').length, total: items.length }
}

/**
 * The step the agent is on: its checklist's in-progress item (its activeForm,
 * else its content), else the board task it started; '' for none, and for an
 * agent no longer at work. It changes only when the list does, never per call.
 */
export function stepOf(agent: DeckAgent): string {
  if (agent.kind === 'you' || agent.kind === 'peer') return ''
  if (agent.kind !== 'main' && !isLive(agent.status)) return ''
  const active = agent.todos?.find(item => item.status === 'active')
  if (active) return active.doing ?? active.text
  return agent.todo?.text ?? ''
}

/** The agent's latest tool call, kept after it ends: `isLive` while it runs, so the screen dims it rather than clearing it. */
export type DeckAction = { text: string; tool: string; at: number; isLive: boolean; ok?: boolean }

/** The latest tool call of the agent's (its list calls left out); undefined before its first. */
export function lastActionOf(agent: DeckAgent): DeckAction | undefined {
  for (let i = agent.recent.length - 1; i >= 0; i--) {
    const one = agent.recent[i]
    if (!one || LIST_TOOLS.includes(one.tool)) continue
    return {
      text: trunc(oneLine(saidOf(one)), NOW_CHARS),
      tool: one.tool,
      at: one.at,
      isLive: one.ms === undefined && isLive(agent.status),
      ...(one.ok !== undefined ? { ok: one.ok } : {}),
    }
  }
  return undefined
}

// The task board: TaskCreate, TaskUpdate, TaskList, TaskGet, and the TaskCreated and TaskCompleted events.

function taskIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
}

function taskStateOf(value: unknown): DeckTask['status'] | 'deleted' | undefined {
  switch (value) {
    case 'completed':
      return 'done'
    case 'in_progress':
      return 'active'
    case 'pending':
      return 'pending'
    case 'deleted':
      return 'deleted'
    default:
      return undefined
  }
}

/** The task board's tasks (TaskCreate, TaskUpdate), as Claude keeps them, in board order: by numeric id, else as created. */
export function boardTasksOf(data: DeckData): DeckTask[] {
  return Object.values(data.board).sort(taskOrder)
}

/** Board order: by numeric id, else as created. */
function taskOrder(a: DeckTask, b: DeckTask): number {
  const x = Number(a.id)
  const y = Number(b.id)
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y
  return a.at - b.at || a.id.localeCompare(b.id)
}

/** Over 200 tasks: the oldest done go first, then the oldest. */
function pruneBoard(board: Record<string, DeckTask>): void {
  const tasks = Object.values(board)
  if (tasks.length <= LIMITS.board) return
  const byAge = (a: DeckTask, b: DeckTask) => a.at - b.at
  const drop = [...tasks.filter(task => task.status === 'done').sort(byAge), ...tasks.filter(task => task.status !== 'done').sort(byAge)].slice(0, tasks.length - LIMITS.board)
  for (const task of drop) delete board[task.id]
}

type TaskPatch = {
  subject?: string
  description?: string
  doing?: string
  status?: DeckTask['status'] | 'deleted'
  owner?: string
  /** The agent whose call or event it is: it created the task, or claimed it by starting or finishing it. */
  by?: string
  /** An update: the task moves to the goal in hand. */
  isTouch?: boolean
}

function upsertTask(data: DeckData, id: string, patch: TaskPatch, at: number): DeckTask | undefined {
  if (patch.status === 'deleted') {
    delete data.board[id]
    return undefined
  }
  const goal = goalOf(data)?.id
  let task = data.board[id]
  if (!task) {
    task = { id, subject: `Task ${id}`, status: 'pending', at, ...(goal ? { goal } : {}), ...(patch.by ? { createdBy: patch.by } : {}) }
    data.board[id] = task
  } else if (patch.isTouch && goal) {
    task.goal = goal
  }
  if (patch.subject) task.subject = trunc(oneLine(patch.subject), NOTE_CHARS)
  if (patch.description) task.description = trunc(oneLine(patch.description), 400)
  if (patch.doing) task.doing = trunc(oneLine(patch.doing), NOTE_CHARS)
  if (patch.owner) task.owner = patch.owner
  if (patch.status !== undefined && patch.status !== task.status) {
    task.status = patch.status
    if (patch.status !== 'pending') task.startedAt ??= at
    if (patch.status === 'done') task.doneAt = at
    else delete task.doneAt
    if (patch.by && patch.status !== 'pending') task.claimedBy = patch.by
  }
  pruneBoard(data.board)
  return task
}

/** Folds a task board call that went through into the board; answers whether it changed anything. */
export function noteBoard(data: DeckData, agent: DeckAgent, tool: string, input: Record<string, unknown>, result: unknown, at: number): boolean {
  const record = isRecord(result) ? result : {}
  if (tool === 'TaskCreate') {
    const task = isRecord(record.task) ? record.task : undefined
    const id = taskIdOf(task?.id)
    if (!id) return false
    upsertTask(data, id, { subject: str(input.subject) ?? str(task?.subject), description: str(input.description), doing: str(input.activeForm), by: agent.id }, at)
    return true
  }
  if (tool === 'TaskUpdate') {
    const id = taskIdOf(input.taskId) ?? taskIdOf(record.taskId)
    if (!id || record.success === false) return false
    const patch: TaskPatch = {
      subject: str(input.subject),
      description: str(input.description),
      doing: str(input.activeForm),
      status: taskStateOf(input.status),
      owner: str(input.owner),
      by: agent.id,
      isTouch: true,
    }
    upsertTask(data, id, patch, at)
    return true
  }
  if (tool === 'TaskList') {
    const tasks = Array.isArray(record.tasks) ? record.tasks.filter(isRecord) : []
    for (const task of tasks) {
      const id = taskIdOf(task.id)
      if (id) upsertTask(data, id, { subject: str(task.subject), status: taskStateOf(task.status), owner: str(task.owner) }, at)
    }
    return tasks.length > 0
  }
  if (tool === 'TaskGet') {
    const task = isRecord(record.task) ? record.task : undefined
    const id = taskIdOf(task?.id)
    if (!task || !id) return false
    upsertTask(data, id, { subject: str(task.subject), description: str(task.description), status: taskStateOf(task.status) }, at)
    return true
  }
  return false
}

/** A board event (classic TaskCreated, TaskCompleted): the task, and the agent the event names (a teammate), if any. */
export function noteTaskEvent(data: DeckData, kind: 'created' | 'completed', event: { id: string; subject: string; description?: string; by?: string }, at: number): boolean {
  if (event.id === '') return false
  const patch: TaskPatch = { subject: event.subject }
  if (event.description) patch.description = event.description
  if (event.by) patch.by = event.by
  if (kind === 'completed') patch.status = 'done'
  upsertTask(data, event.id, patch, at)
  return true
}

// Plans: an approved ExitPlanMode plan, and a Workflow's phases.

const STEP_SECTION = /\b(steps?|plan|implementation|phases?|tasks?|orchestration|approach|milestones?|to-?dos?|roadmap|work)\b/i
const STEP_HEADING = /^(?:step|phase|stage|part|milestone|task)\b|^\d+[.)]?\s/i

/** A step's words: markdown marks and links dropped, a trailing colon cut, at most 120 characters. */
function cleanStep(text: string): string {
  const plain = oneLine(text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '')).replace(/[\s:]+$/, '')
  return trunc(plain, 120)
}

/**
 * Splits a plan's markdown into its steps: the items (or sub-headings) of a
 * section whose heading says steps, plan, phases, tasks, orchestration...;
 * else headings that are steps ("Step 1", "Phase A"); else the first
 * numbered list; else the headings under the title; else the first bulleted
 * list. Code blocks are skipped; at most 30 steps.
 */
export function planStepsOf(markdown: string): string[] {
  type Line = { kind: 'head' | 'num' | 'bullet' | 'text'; level: number; indent: number; text: string }
  const lines: Line[] = []
  let isFence = false
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      isFence = !isFence
      continue
    }
    if (isFence || raw.trim() === '') continue
    const head = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw)
    if (head) {
      lines.push({ kind: 'head', level: (head[1] ?? '#').length, indent: 0, text: head[2] ?? '' })
      continue
    }
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(raw)
    if (numbered) {
      lines.push({ kind: 'num', level: 0, indent: (numbered[1] ?? '').length, text: numbered[2] ?? '' })
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(raw)
    if (bullet) {
      lines.push({ kind: 'bullet', level: 0, indent: (bullet[1] ?? '').length, text: bullet[2] ?? '' })
      continue
    }
    lines.push({ kind: 'text', level: 0, indent: 0, text: raw.trim() })
  }
  const topItems = (body: readonly Line[], kind: 'num' | 'bullet'): string[] => {
    const items = body.filter(line => line.kind === kind)
    if (items.length < 2) return []
    const top = Math.min(...items.map(line => line.indent))
    return items.filter(line => line.indent === top).map(line => line.text)
  }
  const done = (texts: readonly string[]): string[] => texts.map(cleanStep).filter(text => text !== '').slice(0, LIMITS.steps)

  // 1. a section that names its steps
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]
    if (!head || head.kind !== 'head' || head.level < 2 || !STEP_SECTION.test(head.text)) continue
    const body: Line[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (!line || (line.kind === 'head' && line.level <= head.level)) break
      body.push(line)
    }
    const subheads = body.filter(line => line.kind === 'head' && line.level === head.level + 1).map(line => line.text)
    const numbered = topItems(body, 'num')
    const found = subheads.length >= 2 ? subheads : numbered.length >= 2 ? numbered : topItems(body, 'bullet')
    if (found.length >= 2) return done(found)
  }
  // 2. headings that are steps
  const stepHeads = lines.filter(line => line.kind === 'head' && STEP_HEADING.test(cleanStep(line.text))).map(line => line.text)
  if (stepHeads.length >= 2) return done(stepHeads)
  // 3. the first numbered list, in the blocks headings split
  const blocks: Line[][] = [[]]
  for (const line of lines) {
    if (line.kind === 'head') blocks.push([])
    else blocks[blocks.length - 1]?.push(line)
  }
  for (const block of blocks) {
    const items = topItems(block, 'num')
    if (items.length >= 2) return done(items)
  }
  // 4. the headings under the title
  const heads = lines.filter(line => line.kind === 'head' && line.level >= 2).map(line => line.text)
  if (heads.length >= 2) return done(heads)
  // 5. the first bulleted list
  for (const block of blocks) {
    const items = topItems(block, 'bullet')
    if (items.length >= 2) return done(items)
  }
  return []
}

/**
 * Records a plan approved under the goal in hand (ExitPlanMode), split into
 * its steps. With no goal yet, the plan's first line starts one.
 */
export function notePlan(data: DeckData, markdown: string, at: number): boolean {
  const steps = planStepsOf(markdown)
  if (steps.length === 0) return false
  const goal = goalOf(data) ?? noteGoal(data, 'goal', { text: firstLine(markdown) || 'The approved plan', origin: 'plan', at })
  if (!goal) return false
  goal.plan = { steps, at }
  return true
}

/**
 * Reads one JavaScript literal (object, array, string, number, true, false,
 * null) from `source` at `start`, comments skipped: enough for a Workflow
 * script's `meta`, which must be a pure literal. Undefined when it is not one.
 */
function readLiteral(source: string, start: number): unknown {
  let i = start
  const s = source
  const skip = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i] ?? '')) i++
      if (s.startsWith('//', i)) {
        const end = s.indexOf('\n', i)
        i = end < 0 ? s.length : end + 1
      } else if (s.startsWith('/*', i)) {
        const end = s.indexOf('*/', i + 2)
        i = end < 0 ? s.length : end + 2
      } else {
        return
      }
    }
  }
  const quoted = (): string => {
    const quote = s[i]
    i++
    let out = ''
    while (i < s.length && s[i] !== quote) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const next = s[i + 1] ?? ''
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next
        i += 2
        continue
      }
      out += s[i]
      i++
    }
    if (i >= s.length) throw new Error('unclosed string')
    i++
    return out
  }
  const word = (): string => {
    const found = /^[\w$.+-]+/.exec(s.slice(i, i + 256))?.[0]
    if (!found) throw new Error(`unexpected ${s[i] ?? 'end'}`)
    i += found.length
    return found
  }
  const value = (depth: number): unknown => {
    if (depth > 24) throw new Error('too deep')
    skip()
    const c = s[i]
    if (c === '{') {
      i++
      const out: Record<string, unknown> = {}
      for (;;) {
        skip()
        if (s[i] === '}') {
          i++
          return out
        }
        const key = s[i] === '"' || s[i] === "'" || s[i] === '`' ? quoted() : word()
        skip()
        if (s[i] !== ':') throw new Error('expected :')
        i++
        out[key] = value(depth + 1)
        skip()
        if (s[i] === ',') {
          i++
          continue
        }
        if (s[i] === '}') {
          i++
          return out
        }
        throw new Error('expected , or }')
      }
    }
    if (c === '[') {
      i++
      const out: unknown[] = []
      for (;;) {
        skip()
        if (s[i] === ']') {
          i++
          return out
        }
        out.push(value(depth + 1))
        skip()
        if (s[i] === ',') {
          i++
          continue
        }
        if (s[i] === ']') {
          i++
          return out
        }
        throw new Error('expected , or ]')
      }
    }
    if (c === '"' || c === "'" || c === '`') return quoted()
    const said = word()
    if (said === 'true') return true
    if (said === 'false') return false
    if (said === 'null') return null
    const n = Number(said)
    return Number.isFinite(n) ? n : said
  }
  try {
    return value(0)
  } catch {
    return undefined
  }
}

/** A Workflow script's `export const meta = { name, description, phases }`: its phases' titles in order; undefined without a readable meta. */
export function workflowMetaOf(script: string): { name: string; description: string; phases: string[] } | undefined {
  const found = /\bmeta\s*=\s*\{/.exec(script)
  if (!found) return undefined
  const meta = readLiteral(script, found.index + found[0].length - 1)
  if (!isRecord(meta)) return undefined
  const phases = Array.isArray(meta.phases)
    ? meta.phases
        .map(phase => (typeof phase === 'string' ? phase : isRecord(phase) ? (str(phase.title) ?? str(phase.name) ?? '') : ''))
        .map(title => trunc(oneLine(title), 120))
        .filter(title => title !== '')
        .slice(0, LIMITS.steps)
    : []
  return { name: str(meta.name) ?? '', description: str(meta.description) ?? '', phases }
}

/** Records a Workflow run (its call's tool_use_id), under the goal in hand; the newest 10 are kept. */
export function noteWorkflow(data: DeckData, run: { id: string; caller: string; name: string; phases: readonly string[]; at: number; runId?: string }): DeckWorkflow {
  const known = data.workflows.find(one => one.id === run.id)
  if (known) return known
  const goal = goalOf(data)
  const made: DeckWorkflow = {
    id: run.id,
    caller: run.caller,
    name: run.name,
    phases: run.phases.slice(0, LIMITS.steps),
    startedAt: run.at,
    lastAt: run.at,
    ...(run.runId ? { runId: run.runId } : {}),
    ...(goal ? { goal: goal.id } : {}),
  }
  data.workflows.push(made)
  if (data.workflows.length > LIMITS.workflows) data.workflows.splice(0, data.workflows.length - LIMITS.workflows)
  return made
}

/** What a Workflow call returned: the run's ids to know it by, or an end when it never launched. */
export function launchWorkflow(data: DeckData, id: string, launched: { ok: boolean; runId?: string; taskId?: string; name?: string; at: number }): boolean {
  const run = data.workflows.find(one => one.id === id)
  if (!run) return false
  if (launched.runId) run.runId = launched.runId
  if (launched.taskId) run.taskId = launched.taskId
  if (launched.name && run.name === '') run.name = launched.name
  run.lastAt = launched.at
  if (!launched.ok) run.endedAt = launched.at
  return true
}

function workflowForSpawn(data: DeckData, spawn: Spawn): DeckWorkflow {
  const runId = spawn.workflow ?? ''
  const found = data.workflows.find(run => run.id === spawn.toolUseId || (runId !== '' && run.runId === runId))
  if (found) return found
  return noteWorkflow(data, { id: spawn.toolUseId || runId || `workflow-${spawn.at}`, caller: spawn.parentId, name: '', phases: [], at: spawn.at, ...(runId ? { runId } : {}) })
}

/** How long a run with no news counts as live. */
const WORKFLOW_QUIET_MS = 30 * 60_000

/** The newest Workflow run still going: not ended, and heard from in the last half hour. */
export function liveWorkflowOf(data: DeckData, now: number): DeckWorkflow | undefined {
  for (let i = data.workflows.length - 1; i >= 0; i--) {
    const run = data.workflows[i]
    if (run && run.endedAt === undefined && now - run.lastAt < WORKFLOW_QUIET_MS) return run
  }
  return undefined
}

/** Ends the runs a task notification (or a TaskStop) names by their task or run id. */
export function endWorkflows(data: DeckData, text: string, at: number): boolean {
  let isChanged = false
  for (const run of data.workflows) {
    if (run.endedAt !== undefined) continue
    const ids = [run.taskId, run.runId].filter((id): id is string => id !== undefined && id.length >= 4)
    if (ids.some(id => text.includes(id))) {
      run.endedAt = at
      isChanged = true
    }
  }
  return isChanged
}

// The plan: the goal's steps, first source that exists, and which agent serves each.

/** Where the plan came from: the task board, the Orchestrator's todos, an approved plan, a Workflow's phases, each Agent call (implicit), or none. */
export type DeckPlanSource = 'board' | 'todo' | 'plan' | 'workflow' | 'implicit' | 'none'

/** One step: its key (stable), words, state, and the ids of the agents that serve it directly (their sub-agents nest under them). */
export type DeckPlanStep = { key: string; text: string; status: DeckStepStatus; agents: string[] }

/** How an agent was tied to its step and how sure that is (1 certain, 0.5 and under a guess); a sub-agent's is its parent's (`isInherited`). */
export type DeckStepLink = { key: string; how: DeckStepHow; sure: number; isInherited: boolean }

export type DeckPlan = {
  source: DeckPlanSource
  /** The goal it is the plan of. */
  goal?: string
  steps: DeckPlanStep[]
  /** The Orchestrator's own agents (this goal's) that no step claims: they sit straight under it. */
  unlinked: string[]
  /** Every shown agent's link to its step, by agent id. */
  links: Record<string, DeckStepLink>
}

/** A step as the links are made against it: its words read once (`norm`, `words`), whatever the agents. */
type StepSeed = { key: string; text: string; number: number; norm: string; words: Set<string>; status?: DeckTodoItem['status']; task?: DeckTask; todoKey?: string }

function seedOf(seed: Omit<StepSeed, 'norm' | 'words'>): StepSeed {
  return { ...seed, norm: normText(seed.text), words: wordsOf(seed.text) }
}

const HOW_SURE: Readonly<Record<DeckStepHow, number>> = { owner: 1, self: 0.95, mention: 0.8, during: 0.7, words: 0.5 }

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'that', 'this', 'these', 'those', 'then', 'than', 'are', 'was', 'were', 'its',
  'all', 'any', 'each', 'every', 'not', 'but', 'you', 'your', 'our', 'out', 'one', 'two', 'use', 'using', 'used', 'via', 'per',
  'also', 'when', 'what', 'who', 'how', 'why', 'will', 'can', 'should', 'must', 'have', 'has', 'had', 'been', 'being', 'after',
  'before', 'over', 'under', 'about', 'agent', 'agents', 'task', 'tasks', 'step', 'steps', 'phase', 'make', 'sure', 'just', 'only',
])

/** A text's telling words: lower case, three letters or more, common words left out, a plural or -ing/-ed cut. */
function wordsOf(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue
    out.add(raw.length > 4 ? raw.replace(/(?:ing|ed|es|s)$/, '') : raw)
  }
  return out
}

/** The steps a text refers to by number or id: "step 2", "task #3", "#4", "phase 1". */
function refsOf(text: string): Set<string> {
  const refs = new Set<string>()
  for (const found of text.toLowerCase().matchAll(/(?:\b(?:step|task|item|phase|stage|part)\s*#?\s*|#)([a-z0-9][\w-]*)\b/g)) if (found[1]) refs.add(found[1])
  return refs
}

/** The Orchestrator's own agents under `goal` (all of them with no goal yet), in spawn order. */
function topAgentsOf(data: DeckData, goal: DeckGoal | undefined): DeckAgent[] {
  return data.agents.filter(agent => isShownAgent(agent) && parentIdOf(data, agent) === MAIN && (goal === undefined || agent.goal === goal.id))
}

/** The agent's ancestor the Orchestrator spawned (itself when it is one); undefined for a loop of parents. */
function topOf(data: DeckData, agent: DeckAgent): DeckAgent | undefined {
  let at: DeckAgent | undefined = agent
  for (let hops = 0; at && hops < 32; hops++) {
    const parent = parentIdOf(data, at)
    if (parent === MAIN) return at
    at = parent === undefined ? undefined : agentOf(data, parent)
  }
  return undefined
}

/** The goal's steps from the first source that has any: the board, the Orchestrator's todos, the approved plan, a Workflow's phases, its Agent calls. */
function seedsOf(data: DeckData, goal: DeckGoal | undefined): { source: DeckPlanSource; seeds: StepSeed[]; run?: DeckWorkflow } {
  const tasks = Object.values(data.board)
    .filter(task => goal === undefined || task.goal === goal.id)
    .sort(taskOrder)
  if (tasks.length > 0) return { source: 'board', seeds: tasks.map((task, i) => seedOf({ key: `task:${task.id}`, text: task.subject, number: i + 1, status: task.status, task })) }

  const main = agentOf(data, MAIN)
  const todos = main?.todos ?? []
  if (todos.length > 0 && (goal === undefined || (main?.todosAt ?? 0) >= goal.at)) {
    return { source: 'todo', seeds: todos.map((item, i) => seedOf({ key: `todo:${item.key}`, text: item.text, number: i + 1, status: item.status, todoKey: item.key })) }
  }

  const planned = goal?.plan?.steps ?? []
  if (planned.length > 0) return { source: 'plan', seeds: planned.map((text, i) => seedOf({ key: `plan:${i + 1}`, text, number: i + 1 })) }

  const run = [...data.workflows].reverse().find(one => one.phases.length > 0 && (goal === undefined || one.goal === goal.id))
  if (run) return { source: 'workflow', seeds: run.phases.map((text, i) => seedOf({ key: `phase:${i + 1}`, text, number: i + 1 })), run }

  const agents = topAgentsOf(data, goal)
  if (agents.length > 0) {
    return { source: 'implicit', seeds: agents.map((agent, i) => seedOf({ key: `agent:${agent.id}`, text: oneLine(agent.description) || labelOf(agent), number: i + 1 })) }
  }
  return { source: 'none', seeds: [] }
}

/** The step the agent's own words name: its marker heads the step, the step's words stand whole in its task, "step 2" / "task #3", or the step names the agent. */
function mentionedSeed(agent: DeckAgent, seeds: readonly StepSeed[]): StepSeed | undefined {
  const words = `${agent.description} ${agent.prompt.slice(0, 600)}`
  const said = ` ${normText(words)} `
  const refs = refsOf(words)
  const marker = normText(splitMarker(agent.description)?.marker ?? '')
  const name = isNameless(agent) ? '' : normText(agent.name)
  let best: StepSeed | undefined
  let bestScore = 0
  let isTie = false
  for (const seed of seeds) {
    const step = seed.norm
    if (step === '') continue
    let score = 0
    if (marker !== '' && (step === marker || step.startsWith(`${marker} `))) score = 4
    else if (step.includes(' ') && said.includes(` ${step} `)) score = 3
    else if (refs.has(String(seed.number)) || (seed.task !== undefined && refs.has(seed.task.id.toLowerCase()))) score = 2
    else if (name.length >= 3 && !STOP_WORDS.has(name) && ` ${step} `.includes(` ${name} `)) score = 1
    if (score > bestScore) {
      best = seed
      bestScore = score
      isTie = false
    } else if (score > 0 && score === bestScore) {
      isTie = true
    }
  }
  return bestScore > 0 && !isTie ? best : undefined
}

/** The step whose words overlap `words` most (at least two of the step's, or all of a one-word step); a tie is no answer. */
function bestWords(words: ReadonlySet<string>, seeds: readonly StepSeed[]): { seed: StepSeed; score: number } | undefined {
  let best: StepSeed | undefined
  let bestScore = 0
  let isTie = false
  for (const seed of seeds) {
    const step = seed.words
    if (step.size === 0) continue
    let overlap = 0
    for (const word of step) if (words.has(word)) overlap += 1
    if (overlap < Math.min(2, step.size)) continue
    const score = overlap / step.size
    if (score > bestScore) {
      best = seed
      bestScore = score
      isTie = false
    } else if (score === bestScore) {
      isTie = true
    }
  }
  return best && !isTie ? { seed: best, score: bestScore } : undefined
}

/** The step its caller had in progress at the Agent call: by key when the plan is that list, else by the item's words. */
function duringSeed(agent: DeckAgent, seeds: readonly StepSeed[]): { seed: StepSeed; sure: number } | undefined {
  const during = agent.during
  if (!during) return undefined
  const exact = seeds.find(seed => (during.kind === 'todo' && seed.todoKey === during.key) || (during.kind === 'task' && seed.task?.id === during.key))
  if (exact) return { seed: exact, sure: HOW_SURE.during }
  const text = normText(during.text)
  const same = seeds.find(seed => seed.norm === text)
  if (same) return { seed: same, sure: HOW_SURE.during }
  const close = bestWords(wordsOf(during.text), seeds)
  return close && close.score >= 0.6 ? { seed: close.seed, sure: 0.5 } : undefined
}

/** One of the Orchestrator's agents tied to a step, the surest way first: owner, self, mention, during, words. */
function linkTop(agent: DeckAgent, source: DeckPlanSource, seeds: readonly StepSeed[]): DeckStepLink | undefined {
  if (source === 'implicit') return { key: `agent:${agent.id}`, how: 'self', sure: 1, isInherited: false }
  const link = (seed: StepSeed, how: DeckStepHow, sure = HOW_SURE[how]): DeckStepLink => ({ key: seed.key, how, sure, isInherited: false })
  if (source === 'board') {
    const names = new Set([isNameless(agent) ? '' : agent.name, agent.label ?? '', agent.id].map(one => one.toLowerCase()).filter(one => one !== ''))
    const owned = seeds.filter(seed => seed.task?.owner !== undefined && names.has((seed.task.owner.toLowerCase().split('@')[0] ?? '').trim()))
    const ownedOne = owned.find(seed => seed.task?.status === 'active') ?? owned[0]
    if (ownedOne) return link(ownedOne, 'owner')
    const claimed = seeds.filter(seed => seed.task?.claimedBy === agent.id)
    const claimedOne = claimed.find(seed => seed.task?.status === 'active') ?? claimed[0]
    if (claimedOne) return link(claimedOne, 'self')
  }
  const mentioned = mentionedSeed(agent, seeds)
  if (mentioned) return link(mentioned, 'mention')
  const during = duringSeed(agent, seeds)
  if (during) return link(during.seed, 'during', during.sure)
  const worded = bestWords(wordsOf(`${agent.description} ${agent.scope ?? ''} ${agent.prompt.slice(0, 300)}`), seeds)
  if (worded && worded.score >= 0.5) return link(worded.seed, 'words', Math.round(worded.score * 50) / 100)
  return undefined
}

/** Whether a workflow agent's words name a phase: its title whole, or most of its words. */
function isOfPhase(agent: DeckAgent, seed: StepSeed): boolean {
  const said = ` ${normText(`${agent.description} ${agent.label ?? ''} ${agent.prompt.slice(0, 300)}`)} `
  const step = seed.norm
  if (step !== '' && said.includes(` ${step} `)) return true
  const words = seed.words
  if (words.size === 0) return false
  const mine = wordsOf(said)
  let overlap = 0
  for (const word of words) if (mine.has(word)) overlap += 1
  return overlap >= Math.min(2, words.size) && overlap / words.size >= 0.5
}

function stepStatusOf(seed: StepSeed, agents: readonly DeckAgent[], run: DeckWorkflow | undefined, runAgents: readonly DeckAgent[]): DeckStepStatus {
  const isFailed = (agent: DeckAgent) => agent.status === 'failed' || agent.status === 'killed'
  if (seed.status !== undefined) {
    if (seed.status === 'done') return 'done'
    if (agents.length > 0 && !agents.some(agent => isLive(agent.status)) && agents.some(isFailed)) return 'failed'
    return seed.status
  }
  const pool = run && agents.length === 0 ? runAgents.filter(agent => isOfPhase(agent, seed)) : agents
  if (pool.some(agent => isLive(agent.status))) return 'active'
  if (pool.some(agent => agent.status === 'completed' || agent.status === 'idle')) return 'done'
  if (pool.some(isFailed)) return 'failed'
  if (run?.endedAt !== undefined) return 'done'
  return 'pending'
}

/**
 * The goal in hand's plan, from the first source that has steps: the task
 * board (this goal's tasks), the Orchestrator's TodoWrite, the approved
 * ExitPlanMode plan, a Workflow's `meta.phases`, else one step per Agent call
 * (`implicit`). Each of the Orchestrator's agents is tied to one step (see
 * `links` for how and how sure); sub-agents take their parent's step and nest
 * under it, so a step's `agents` are the Orchestrator's own.
 */
export function planOf(data: DeckData): DeckPlan {
  const goal = goalOf(data)
  const { source, seeds, run } = seedsOf(data, goal)
  const links: Record<string, DeckStepLink> = {}
  const byStep = new Map<string, DeckAgent[]>()
  const unlinked: string[] = []
  for (const agent of topAgentsOf(data, goal)) {
    const link = linkTop(agent, source, seeds)
    if (!link) {
      unlinked.push(agent.id)
      continue
    }
    links[agent.id] = link
    byStep.set(link.key, [...(byStep.get(link.key) ?? []), agent])
  }
  for (const agent of data.agents) {
    if (!isShownAgent(agent) || links[agent.id]) continue
    const top = topOf(data, agent)
    const link = top && top !== agent ? links[top.id] : undefined
    if (link) links[agent.id] = { ...link, isInherited: true }
  }
  const runAgents = run ? data.agents.filter(agent => agent.workflow === run.id) : []
  const steps = seeds.map(seed => {
    const agents = byStep.get(seed.key) ?? []
    return { key: seed.key, text: seed.text, status: stepStatusOf(seed, agents, run, runAgents), agents: agents.map(agent => agent.id) }
  })
  return { source, ...(goal ? { goal: goal.id } : {}), steps, unlinked, links }
}

/** How the agent is tied to the plan's step (a sub-agent through its parent); undefined while no step claims it. */
export function stepLinkOf(data: DeckData, agentId: string): DeckStepLink | undefined {
  return planOf(data).links[agentId]
}

// Files: what changed, who is editing it, and files two agents share.

/** One edited file as the Files section reads it. */
export type DeckFileView = {
  path: string
  abs: string
  /** Who edited it, first editor first. */
  editors: string[]
  /** One of its editors is at work. */
  live: boolean
  /** Two of its editors edited it while both were live. */
  isShared: boolean
  added: number
  removed: number
  lastAt: number
  isNew: boolean
  userModified: boolean
}

/** The agents by id, for the queries that look many up at once. */
function agentsById(data: DeckData): Map<string, DeckAgent> {
  return new Map(data.agents.map(agent => [agent.id, agent]))
}

/** When an editor counts as live: from its start to its end; the Orchestrator, always. */
function liveSpanOf(agent: DeckAgent | undefined): [number, number] {
  if (!agent || agent.kind === 'main') return [-Infinity, Infinity]
  return [agent.startedAt, agent.endedAt ?? Infinity]
}

function pairsOf(byId: ReadonlyMap<string, DeckAgent>, file: DeckFile): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < file.editors.length; i++) {
    for (let j = i + 1; j < file.editors.length; j++) {
      const a = file.editors[i]
      const b = file.editors[j]
      if (!a || !b) continue
      const [startA, endA] = liveSpanOf(byId.get(a.agent))
      const [startB, endB] = liveSpanOf(byId.get(b.agent))
      const from = Math.max(startA, startB)
      const to = Math.min(endA, endB)
      if (from > to) continue
      const isWithin = (one: DeckFile['editors'][number]) => one.lastAt >= from && one.firstAt <= to
      if (isWithin(a) && isWithin(b)) pairs.push([a.agent, b.agent])
    }
  }
  return pairs
}

/** The pairs of a file's editors that edited it while both were live. */
export function sharersOf(data: DeckData, file: DeckFile): [string, string][] {
  return pairsOf(agentsById(data), file)
}

/** Every file agents edited this session, the one edited last first: who edited it, whether one of them is at it now, and whether two share it. */
export function filesOf(data: DeckData): DeckFileView[] {
  const byId = agentsById(data)
  const isLiveId = (id: string) => {
    const agent = byId.get(id)
    return agent !== undefined && isLive(agent.status)
  }
  return Object.values(data.files)
    .map(file => ({
      path: file.path,
      abs: file.abs,
      editors: file.editors.map(editor => editor.agent),
      live: file.editors.some(editor => isLiveId(editor.agent)),
      isShared: pairsOf(byId, file).length > 0,
      added: file.added,
      removed: file.removed,
      lastAt: file.lastAt,
      isNew: file.isNew === true,
      userModified: file.userModified === true,
    }))
    .sort((a, b) => b.lastAt - a.lastAt || a.path.localeCompare(b.path))
}

/** The file two agents at work now both edit, the one edited last; undefined for none. */
function sharedNowOf(data: DeckData): { file: DeckFile; a: DeckAgent; b: DeckAgent } | undefined {
  const byId = agentsById(data)
  const files = Object.values(data.files)
    .filter(file => file.editors.filter(editor => isLive(byId.get(editor.agent)?.status ?? 'idle')).length >= 2)
    .sort((x, y) => y.lastAt - x.lastAt)
  for (const file of files) {
    for (const [first, second] of pairsOf(byId, file)) {
      const a = byId.get(first)
      const b = byId.get(second)
      if (a && b && isLive(a.status) && isLive(b.status)) return { file, a, b }
    }
  }
  return undefined
}

// The header: what needs you, and the summary line.

/** What git says of the repository the deck follows, as the header reads it. */
export type GitFacts = Pick<GitState, 'isRepo' | 'files'> & Partial<Pick<GitState, 'checkedAt' | 'added' | 'removed'>>

/** The one line that leads the Agents tab. */
export type DeckNeedsLine = {
  /** `attention`: waits on you, or a shared file; `alert`: a failure; `done`: all done, files to review; `quiet`: nothing. */
  tone: 'alert' | 'attention' | 'done' | 'quiet'
  kind: 'blocked' | 'failed' | 'shared' | 'review' | 'none'
  text: string
  /** The agent the line is about, which Open (n) selects. */
  agentId?: string
  /** The shared file's path. */
  path?: string
}

/**
 * What a needs-you note waits on, as the words after the agent's label: a
 * question's dialog says what it asks (`asks: Which library?`), a permission
 * prompt what it would let run (`needs your OK to run \`npm test\``, `…to
 * edit \`src/a.ts\``, `…to use WebFetch`), anything else the notification's
 * own words (`waits on you: …`). Never "allow AskUserQuestion".
 */
export function waitingOnOf(data: DeckData, needs: DeckNeeds): string {
  const agent = agentOf(data, needs.agent ?? MAIN)
  const call = needs.call !== undefined && agent ? agent.recent.find(one => one.id === needs.call) : undefined
  if (call?.tool === 'AskUserQuestion') return call.target ? `asks: ${call.target}` : 'asks you a question'
  const isPermission = needs.kind === 'permission_prompt' || /permission/i.test(needs.text)
  if (isPermission && call) return permissionPhraseOf(call.tool, call.command, PATH_VERBS[call.tool] !== undefined && call.target ? call.target : undefined)
  const tool = isPermission ? /permission to use (.+)$/i.exec(needs.text.trim())?.[1]?.trim() : undefined
  if (tool === 'AskUserQuestion') return 'asks you a question'
  return tool ? permissionPhraseOf(tool) : `waits on you: ${needs.text}`
}

/** How many files the work changed: git's uncommitted files once read, else the files agents edited. */
function changedCountOf(data: DeckData, git: GitFacts): number {
  return git.isRepo === true && (git.checkedAt ?? 1) > 0 ? git.files.length : Object.keys(data.files).length
}

/**
 * The single most urgent thing, for the needs-you line: a call held on you,
 * the oldest first (`Orchestrator asks: Which library?`, `Tests needs your OK
 * to run \`npm test\``), else a prompt the engine's notification says waits
 * on you; then a failure of this goal's, then a file two running agents both
 * edit. Otherwise "All done · N files to review" once nothing is at work,
 * else "Nothing needs you". `now` is accepted and unused: the line holds no time.
 */
export function needsOf(data: DeckData, git: GitFacts, now?: number): DeckNeedsLine {
  void now
  const main = agentOf(data, MAIN)
  const held = data.pending[0]
  if (held) {
    const agent = agentOf(data, held.agentId)
    return { tone: 'attention', kind: 'blocked', text: `${agent ? labelOf(agent) : ORCHESTRATOR} ${pendingPhraseOf(held)}`, agentId: agent ? held.agentId : MAIN }
  }
  const needs = main?.needs
  if (needs) {
    const id = needs.agent ?? MAIN
    const agent = agentOf(data, id)
    return { tone: 'attention', kind: 'blocked', text: `${agent ? labelOf(agent) : ORCHESTRATOR} ${waitingOnOf(data, needs)}`, agentId: agent ? id : MAIN }
  }
  const goal = goalOf(data)
  const failed = data.agents
    .filter(agent => isShownAgent(agent) && agent.status === 'failed' && (goal === undefined || agent.goal === goal.id))
    .sort((a, b) => (b.endedAt ?? b.lastAt) - (a.endedAt ?? a.lastAt))[0]
  if (failed) {
    const why = failureOf(failed)
    return { tone: 'alert', kind: 'failed', text: why ? `${labelOf(failed)} failed: ${trunc(oneLine(why), 100)}` : `${labelOf(failed)} failed`, agentId: failed.id }
  }
  const shared = sharedNowOf(data)
  if (shared) {
    return { tone: 'attention', kind: 'shared', text: `${labelOf(shared.a)} and ${labelOf(shared.b)} both edit ${shared.file.path}`, agentId: shared.b.id, path: shared.file.path }
  }
  if (goal && !hasLiveAgents(data) && main?.status !== 'running') {
    const count = changedCountOf(data, git)
    if (count > 0) return { tone: 'done', kind: 'review', text: `All done · ${plural(count, 'file')} to review` }
  }
  return { tone: 'quiet', kind: 'none', text: 'Nothing needs you' }
}

/** The summary line under the goal. */
export type DeckSummary = {
  /** "2 of 4": the step in progress (else the steps done) of the plan's; '' with no plan. */
  step: string
  /** This goal's agents, by what they are doing now (one waiting on you is not running). */
  running: number
  waiting: number
  done: number
  failed: number
  /** Files changed, lines added and removed: git's once read, else the agents' edits. */
  files: number
  added: number
  removed: number
  /** Whole minutes since the goal began, to now while work goes on, else to its last news. */
  minutes: number
}

/** The summary line's figures: the plan's step, this goal's agents by state, the files and lines changed, and its minutes. */
export function summaryOf(data: DeckData, git: GitFacts, now?: number): DeckSummary {
  return summaryWith(data, git, now, planOf(data))
}

/** `summaryOf` over a plan read already. */
function summaryWith(data: DeckData, git: GitFacts, now: number | undefined, plan: DeckPlan): DeckSummary {
  const goal = goalOf(data)
  const steps = plan.steps
  const active = steps.findIndex(step => step.status === 'active')
  const stepsDone = steps.filter(step => step.status === 'done').length
  const step = steps.length === 0 ? '' : `${active >= 0 ? active + 1 : stepsDone} of ${steps.length}`

  let running = 0
  let waiting = 0
  let done = 0
  let failed = 0
  for (const agent of data.agents) {
    if (!isShownAgent(agent) || (goal !== undefined && agent.goal !== goal.id)) continue
    const shown = statusOf(agent, data)
    if (shown === 'waiting') waiting += 1
    else if (shown === 'running') running += 1
    else if (agent.status === 'completed') done += 1
    else if (agent.status === 'failed') failed += 1
  }
  if (waitsOnYou(data, MAIN)) waiting += 1

  let files: number
  let added: number
  let removed: number
  if (git.isRepo === true && (git.checkedAt ?? 1) > 0) {
    files = git.files.length
    added = git.added ?? git.files.reduce((sum, file) => sum + file.added, 0)
    removed = git.removed ?? git.files.reduce((sum, file) => sum + file.removed, 0)
  } else {
    const edited = Object.values(data.files)
    files = edited.length
    added = edited.reduce((sum, file) => sum + file.added, 0)
    removed = edited.reduce((sum, file) => sum + file.removed, 0)
  }

  return { step, running, waiting, done, failed, files, added, removed, minutes: goalMinutesOf(data, now) }
}

/** Whole minutes since the goal began: to `now` while work goes on (an agent live, or the main loop running), else to its last news; 0 with no goal. */
export function goalMinutesOf(data: DeckData, now?: number): number {
  const goal = goalOf(data)
  if (!goal) return 0
  const isBusy = hasLiveAgents(data) || agentOf(data, MAIN)?.status === 'running'
  const news = data.agents.filter(agent => agent.kind === 'main' || agent.goal === goal.id).map(agent => agent.endedAt ?? agent.lastAt)
  const end = isBusy && now !== undefined ? now : Math.max(goal.at, ...news)
  return Math.max(0, Math.floor((end - goal.at) / 60_000))
}

// The redraw policy: what the Agents tab shows, as one signature.

/**
 * Everything the v3 Agents tab draws, as one short signature: the goal, the
 * plan (sources, steps, states, links), each agent's row (label, status, step,
 * last action and whether it runs, checklist, counts, result), the files, the
 * messages, the needs-you line, the summary (minutes included) and the folded
 * row. Equal signatures draw the same tab.
 */
export function deckKeyOf(data: DeckData, git: GitFacts, now: number): string {
  const goal = goalOf(data)
  const plan = planOf(data)
  const parts: string[] = [
    goal ? `goal\t${goal.id}\t${goal.headline}\t${goal.followUps.length}\t${goal.plan?.steps.length ?? 0}` : 'goal',
    `plan\t${plan.source}\t${plan.steps.map(step => `${step.key}:${step.status}:${step.agents.join(',')}:${step.text}`).join('|')}\t${plan.unlinked.join(',')}`,
  ]
  for (const agent of data.agents) {
    const action = lastActionOf(agent)
    const list = checklistOf(agent, data)
    const link = plan.links[agent.id]
    parts.push(
      [
        agent.id,
        labelOf(agent),
        agent.status,
        statusOf(agent, data),
        stepOf(agent),
        action ? `${action.text}:${action.isLive}:${action.ok ?? ''}` : '',
        `${list.done}/${list.total}:${list.items.map(item => `${item.key}${item.status[0] ?? ''}`).join('')}`,
        agent.tools,
        agent.errors,
        agent.recent.filter(one => one.ms !== undefined).length,
        agent.added,
        agent.removed,
        agent.answer?.length ?? 0,
        agent.endedAt ?? '',
        agent.parentId ?? '',
        agent.origin ?? '',
        agent.model ?? '',
        link ? `${link.key}:${link.how}` : '',
      ].join('\t'),
    )
  }
  parts.push(`files\t${filesOf(data).map(file => `${file.path}:${file.editors.join(',')}:${file.live}:${file.isShared}:${file.added}:${file.removed}`).join('|')}`)
  const last = data.messages[data.messages.length - 1]
  parts.push(`messages\t${data.messages.length}\t${last?.id ?? ''}\t${last?.text.length ?? 0}\t${data.messages.filter(one => one.isDelivered).length}`)
  const needs = needsOf(data, git)
  parts.push(`needs\t${needs.kind}\t${needs.text}`, `summary\t${JSON.stringify(summaryWith(data, git, now, plan))}`, `fold\t${foldOf(data)?.text ?? ''}`)
  const text = parts.join('\n')
  return `${hash(text).toString(36)}:${text.length}`
}

// Deliveries: the envelope a message arrives in, and the send it echoes.

/**
 * A delivery's text out of the envelope the engine wraps it in for its
 * receiver (`<agent-message from="reviewer">\n…\n</agent-message>`, and the
 * like for any `*-message` tag: the first one, whatever stands around it),
 * with the sender the envelope names. Text in no envelope comes back as it is.
 */
export function unwrapMessage(text: string): { text: string; from?: string } {
  const found = /<([a-z][\w-]*-message)\b([^>]*)>([\s\S]*?)<\/\1>/i.exec(text)
  if (!found) return { text }
  const body = (found[3] ?? '').replace(/^\s*\n/, '').replace(/\n\s*$/, '').trim()
  const from = /\b(?:from|sender|teammate_id|teammate)\s*=\s*"([^"]*)"/i.exec(found[2] ?? '')?.[1]?.trim()
  return from ? { text: body, from } : { text: body }
}

/** How long after its send a delivery may come and still be its echo: 20 seconds; while its envelope names the very sender, ECHO_SENDER_MS (a message waits for its receiver's next tool round, past a long call). */
export const ECHO_MS = 20_000
export const ECHO_SENDER_MS = 15 * 60_000

/**
 * The send a delivery to `to` echoes, among the last 40 messages: the same
 * words once the envelope is off (or one the start of the other), to the
 * receiver or to an agent of the receiver's name, sent in the last 20
 * seconds, or in the last 15 minutes by the sender its envelope names. A
 * send followed by its receive is then logged once.
 */
export function echoOf(data: DeckData, to: string, text: string, now: number): DeckMessage | undefined {
  const unwrapped = unwrapMessage(text)
  const body = oneLine(unwrapped.text)
  if (body === '') return undefined
  const head = body.slice(0, 40)
  const receiver = agentOf(data, to)
  const name = receiver && !isNameless(receiver) ? receiver.name.toLowerCase() : ''
  const sender = unwrapped.from ? (resolveRecipient(data, unwrapped.from)?.id ?? unwrapped.from) : ''
  const recent = data.messages.slice(-40)
  for (let i = recent.length - 1; i >= 0; i--) {
    const message = recent[i]
    if (!message || message.kind === 'result') continue
    if (now - message.at >= (sender !== '' && message.from === sender ? ECHO_SENDER_MS : ECHO_MS)) continue
    const target = agentOf(data, message.to)
    // a send to a name no agent carried then: the receiver's name now
    const sentName = message.to.toLowerCase()
    const isToName = target === undefined && name !== '' && (sentName === name || sentName.split('@')[0] === name)
    const isToReceiver = message.to === to || isToName || (name !== '' && target !== undefined && !isNameless(target) && target.name.toLowerCase() === name)
    if (!isToReceiver) continue
    const sent = oneLine(message.text)
    if (sent === body || sent.startsWith(head) || body.startsWith(sent.slice(0, 40))) return message
  }
  return undefined
}
